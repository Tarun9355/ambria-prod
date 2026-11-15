-- ═══ LOCKED, AVAILABILITY-CHECKING `blocks` WRITER (bug 4, 2026-11-14 inventory-blocks audit) ═══
-- `blocks` (one row per inventory item, `id` = `item_id`, `data` = a JSONB array of reservation
-- entries) has had no concurrency control at all since it was created: every writer (Studio's own
-- sold-deal reconcile, IMS's independent auto-confirm engine, IMS ops' manual Block/Bulk Block button,
-- an approved amend request) reads the whole row, computes a new array in application code, and
-- upserts it back — a plain read-modify-write, with no row lock and no optimistic version check. Two
-- writers racing on the SAME item within the same few seconds (routine: IMS auto-confirm and Studio's
-- own reconcile both fire within 1-4s of the same sale) can silently clobber each other — whichever
-- writes LAST simply overwrites whatever the other wrote, with no error, no retry, and no visible
-- owner. This is the root cause the "Roman Fibre pot" overbook (21 blocked vs 12 owned, two separate
-- deals, 2026-11-14) traced back to, underneath the specific bugs already fixed in Phase 1.
--
-- This migration adds ONE function, `apply_block_ops`, that becomes the only sanctioned way any app
-- code writes to `blocks` going forward (existing callers are migrated to it in the same release that
-- ships this migration — see src/lib/ims/blocksRpc.js and its call sites). It:
--   a) takes a ROW LOCK (`SELECT ... FOR UPDATE`, locked in a stable `id` order so two concurrent
--      callers touching an overlapping set of items can never deadlock) on every item it's about to
--      touch, so any OTHER writer — including one not yet migrated to this function, since a plain
--      UPDATE/UPSERT also takes a row lock — queues behind it rather than racing it;
--   b) replaces ONLY the calling event's own entries matching the caller-specified (source, date)
--      selectors — every other event's entries, and this SAME event's entries from a DIFFERENT
--      source, are carried through completely untouched, regardless of what the caller's own
--      client-side planning saw before the lock was taken (the lock's own re-read, inside this
--      transaction, is authoritative);
--   c) checks real physical headroom (inventory.qty - inventory.blocked, net of every OTHER live
--      entry on that date) in the SAME transaction as the write, and either rejects, caps, or allows
--      an over-commit (tagged as `qtyToProduce` — bug 10) depending on the caller's own `p_on_short`
--      policy — so the availability check can never again be a separate, earlier, racy read that's
--      stale by the time the actual write lands.
--
-- Nothing here replaces the APPLICATION-level checks (Build's own ceiling, the Sold gate, Deal Check's
-- card picker) — those still exist and still matter for UX (telling the salesperson BEFORE they click
-- Sold, not just rejecting the write after). This is the write-time backstop underneath all of them:
-- even if every client-side check somehow agreed to something wrong, the actual commit cannot.
--
-- Phase-0 sanity check (read-only; the person running this should run it BEFORE this migration and
-- confirm it returns 0 — this function assumes blocks.id always equals blocks.item_id, which every
-- known writer in the app has always set explicitly, but nothing in the schema enforces it):
--   select count(*) from public.blocks where item_id is distinct from id;

-- ── a) one coercion rule for a blocks entry's qty, shared with src/lib/ims/liveBlocks.js's
--      blockEntryQty — a missing/non-numeric/non-positive value counts as 0, never defaults to 1 ──
create or replace function public.block_entry_qty(e jsonb)
returns numeric language sql immutable as $$
  select case jsonb_typeof(e->'qty')
    when 'number' then greatest((e->>'qty')::numeric, 0)
    when 'string' then case when e->>'qty' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then greatest(trim(e->>'qty')::numeric, 0) else 0 end
    else 0 end
$$;

-- ── b) one "is this entry live" rule, shared with src/lib/ims/liveBlocks.js's isLiveBlockStatus +
--      the cancelled-event exclusion (isCancelledEO) — KEEP THIS IN SYNC with RELEASED_BLOCK_STATUSES
--      there if that list ever changes. ──
create or replace function public.block_entry_is_live(e jsonb)
returns boolean language sql stable set search_path = public as $$
  select coalesce(e->>'status','') not in ('released', 'cancelled')
     and not exists (select 1 from public.event_orders eo where eo.id = e->>'eventId' and eo.status = 'cancelled')
$$;

-- ── c) the locked, availability-checking writer ──
-- p_ops: a JSON array, one element per (item, event) the caller wants to change:
--   { item_id, event_id,
--     remove: [{ source: "<tag>" | "" (untagged) | "*" (any), date: "YYYY-MM-DD" | null (any date) }],
--     add:    [{ date, qty, status?, source?, createdAt?, allowOver?: bool, extra?: {} }] }
-- p_on_short: how to handle a date where the requested add(s) exceed real headroom —
--   'reject' (default) — write NOTHING at all if any non-allowOver add would be short;
--   'cap'    — grant what fits, drop the rest, report the shortfall (Studio's own reconcile uses this
--             — "reserve as much as is really free, tell me what wasn't", never a hard stop mid-autosave);
--   'force'  — write exactly what was asked regardless of headroom, report what WOULD have been short
--             (an explicit human override — IMS ops' manual Block button already confirms this with
--             the person before calling, so a 'force' call here is just honoring that confirmation).
-- Returns { ok, applied, items: [{item_id,event_id,date,requested,prior_own,owned,others,free,
--           granted,to_produce,short}], rows: [{item_id,data}] } — `rows` is empty when `applied` is
-- false (a 'reject' call that found a shortfall writes nothing and returns the shortfall report only).
create or replace function public.apply_block_ops(p_ops jsonb, p_on_short text default 'reject')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_ids text[]; v_work jsonb := '{}'::jsonb; v_id text; v_data jsonb;
  v_op jsonb; v_item text; v_event text; v_kept jsonb; v_removed jsonb; v_date text;
  v_owned numeric; v_others numeric; v_prior numeric; v_requested numeric;
  v_free numeric; v_grant numeric; v_left numeric; v_add jsonb; v_q numeric; v_take numeric;
  v_excess numeric; v_prod numeric; v_dropped numeric; v_prod_total numeric; v_created jsonb;
  v_report jsonb := '[]'::jsonb; v_any_short boolean := false; v_rows jsonb;
  v_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_on_short is null or p_on_short not in ('reject','cap','force') then
    raise exception 'apply_block_ops: p_on_short must be reject|cap|force (got %)', p_on_short using errcode = '22023';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'apply_block_ops: p_ops must be a JSON array' using errcode = '22023';
  end if;

  select array_agg(distinct o->>'item_id') into v_ids from jsonb_array_elements(p_ops) o
   where coalesce(o->>'item_id','') <> '' and coalesce(o->>'event_id','') <> '';
  if v_ids is null then
    return jsonb_build_object('ok', true, 'applied', false, 'items', '[]'::jsonb, 'rows', '[]'::jsonb);
  end if;

  -- Create any missing rows first so there's something to lock, then lock every touched row IN ID
  -- ORDER (stable across every caller) — two concurrent calls whose item sets overlap always acquire
  -- their shared locks in the same order, so neither can ever wait on the other in a cycle.
  insert into public.blocks (id, item_id, data) select x, x, '[]'::jsonb from unnest(v_ids) x
  on conflict (id) do nothing;
  for v_id, v_data in
    select b.id, case when jsonb_typeof(b.data) = 'array' then b.data else '[]'::jsonb end
      from public.blocks b where b.id = any(v_ids) order by b.id for update
  loop
    v_work := v_work || jsonb_build_object(v_id, v_data);
  end loop;

  for v_op in select o from jsonb_array_elements(p_ops) o loop
    v_item := v_op->>'item_id'; v_event := v_op->>'event_id';
    if coalesce(v_item,'') = '' or coalesce(v_event,'') = '' then continue; end if;

    -- Split this item's CURRENT (just-locked, authoritative) entries into "removed" (this op's own
    -- event, matching one of its remove selectors) and "kept" (everything else — another event
    -- entirely, or this same event under a source/date this op did NOT ask to touch).
    select coalesce(jsonb_agg(t.e order by t.ord) filter (where not t.m), '[]'::jsonb),
           coalesce(jsonb_agg(t.e order by t.ord) filter (where t.m), '[]'::jsonb)
      into v_kept, v_removed
      from (select a.e, a.ord,
                   (a.e->>'eventId' = v_event and exists (
                      select 1 from jsonb_array_elements(coalesce(v_op->'remove','[]'::jsonb)) r
                       where (r->>'source' = '*' or coalesce(a.e->>'source','') = coalesce(r->>'source',''))
                         and (r->>'date' is null or a.e->>'date' = r->>'date'))) as m
              from jsonb_array_elements(v_work->v_item) with ordinality a(e, ord)) t;

    v_owned := null;
    select (coalesce(i.qty,0) - coalesce(i.blocked,0))::numeric into v_owned from public.inventory i where i.id = v_item;

    for v_date in select distinct a->>'date' from jsonb_array_elements(coalesce(v_op->'add','[]'::jsonb)) a
                   where coalesce(a->>'date','') <> '' loop
      -- others: every live entry KEPT on this date — in practice almost always another event
      -- entirely, since v_prior (below) already covers THIS op's own removed entries. CAVEAT
      -- (regression review, 2026-11-14): if this SAME event already holds a DIFFERENT, untouched
      -- (source,date) group here — e.g. a caller whose own remove selectors only target ITS OWN
      -- source tag, while a different writer already holds this event's real reservation under a
      -- different tag — that untouched group is counted here too, same as any other event's. This
      -- under-states headroom for THIS op rather than over-stating it (never lets an op claim MORE
      -- than physically exists), so it fails toward under-granting, not toward a silent overbook —
      -- the caller-side fix for the specific "a fallback writer shouldn't claim anything once the
      -- authoritative writer already has it" case lives in eventAutoConfirm.js's own pre-check
      -- (executeConfirmBlocks: "Already covered by Studio"), not here, since only the CALLER knows
      -- which of its own tags are "authoritative" vs "fallback" for a given event.
      select coalesce(sum(public.block_entry_qty(e)),0) into v_others
        from jsonb_array_elements(v_kept) e where e->>'date' = v_date and public.block_entry_is_live(e);
      -- prior: what THIS event already held (being removed this op) on this date — never shrinks this
      -- event's own existing hold just because someone else's demand grew since it was granted; an
      -- increase past that is weighed normally, a same-or-smaller re-request always fits.
      select coalesce(sum(public.block_entry_qty(e)),0) into v_prior
        from jsonb_array_elements(v_removed) e where e->>'date' = v_date and public.block_entry_is_live(e);
      select coalesce(sum(public.block_entry_qty(a)),0) into v_requested
        from jsonb_array_elements(v_op->'add') a where a->>'date' = v_date;

      v_free := case when v_owned is null then v_requested else greatest(v_owned - v_others, v_prior, 0) end;
      v_grant := case when p_on_short = 'force' then v_requested else least(v_requested, v_free) end;
      v_left := v_grant; v_dropped := 0; v_prod_total := 0;

      for v_add in select t.a from jsonb_array_elements(v_op->'add') with ordinality t(a, ord)
                    where t.a->>'date' = v_date order by t.ord loop
        v_q := public.block_entry_qty(v_add);
        v_take := least(v_q, v_left); v_left := v_left - v_take; v_excess := v_q - v_take;
        if v_excess > 0 and coalesce((v_add->>'allowOver')::boolean, false) then
          v_prod := v_excess; v_prod_total := v_prod_total + v_excess;
        else
          v_prod := 0; v_dropped := v_dropped + v_excess;
        end if;
        if v_take > 0 or v_prod > 0 then
          -- Keep the createdAt of a removed same-source entry on this date, if one existed — a
          -- re-sent, unchanged, capped request then produces byte-identical data, so the final
          -- `is distinct from` skips the write and no realtime event fires for a no-op run.
          v_created := null;
          select e->'createdAt' into v_created from jsonb_array_elements(v_removed) e
           where e->>'date' = v_date and coalesce(e->>'source','') = coalesce(v_add->>'source','') limit 1;
          v_kept := v_kept || jsonb_build_array(
            (case when jsonb_typeof(v_add->'extra') = 'object' then v_add->'extra' else '{}'::jsonb end)
            || jsonb_strip_nulls(jsonb_build_object(
                 'date', v_date, 'eventId', v_event, 'qty', v_take,
                 'status', coalesce(nullif(v_add->>'status',''), 'confirmed'),
                 'source', nullif(v_add->>'source',''),
                 'createdAt', coalesce(v_add->'createdAt', v_created, to_jsonb(v_now_ms)),
                 'qtyToProduce', case when v_prod > 0 then v_prod end)));
        end if;
      end loop;

      if v_dropped > 0 then v_any_short := true; end if;
      v_report := v_report || jsonb_build_array(jsonb_build_object(
        'item_id', v_item, 'event_id', v_event, 'date', v_date, 'requested', v_requested, 'prior_own', v_prior,
        'owned', v_owned, 'others', v_others, 'free', v_free,
        'granted', v_requested - v_dropped - v_prod_total, 'to_produce', v_prod_total,
        'short', case when p_on_short = 'force' then greatest(v_requested - v_free, 0) else v_dropped end));
    end loop;

    v_work := jsonb_set(v_work, array[v_item], v_kept);
  end loop;

  if p_on_short = 'reject' and v_any_short then
    return jsonb_build_object('ok', false, 'applied', false, 'items', v_report, 'rows', '[]'::jsonb);
  end if;

  update public.blocks b set data = v_work->b.id, item_id = b.id
   where b.id = any(v_ids) and b.data is distinct from v_work->b.id;

  select coalesce(jsonb_agg(jsonb_build_object('item_id', b.id, 'data', b.data) order by b.id), '[]'::jsonb)
    into v_rows from public.blocks b where b.id = any(v_ids);
  return jsonb_build_object('ok', not v_any_short, 'applied', true, 'items', v_report, 'rows', v_rows);
end;
$$;

-- authenticated only (migration 048: this app requires a real logged-in Supabase Auth session —
-- anon has no table access at all, and every RPC's EXECUTE grant was deliberately revoked from it
-- there; matching that convention here, not re-opening it).
revoke all on function public.block_entry_qty(jsonb) from public, anon;
revoke all on function public.block_entry_is_live(jsonb) from public, anon;
revoke all on function public.apply_block_ops(jsonb, text) from public, anon;
grant execute on function public.block_entry_qty(jsonb) to authenticated;
grant execute on function public.block_entry_is_live(jsonb) to authenticated;
grant execute on function public.apply_block_ops(jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL VERIFICATION (optional, run by hand in two separate SQL editor tabs/sessions):
--   Tab 1: begin; select apply_block_ops(
--            '[{"item_id":"TEST_ITEM","event_id":"eo_test_a","add":[{"date":"2099-01-01","qty":5}]}]'::jsonb);
--          -- do NOT commit/rollback yet — this holds the row lock open
--   Tab 2: begin; select apply_block_ops(
--            '[{"item_id":"TEST_ITEM","event_id":"eo_test_b","add":[{"date":"2099-01-01","qty":5}]}]'::jsonb);
--          -- this should HANG until Tab 1 commits or rolls back — confirms the row lock is real
--   Tab 1: rollback;   -- Tab 2's call then completes, its own report's `others` should include Tab 1's
--                         5 units if Tab 1 had committed instead of rolling back
--   Tab 2: rollback;   -- clean up — this was a test item/event, nothing real was touched
-- ─────────────────────────────────────────────────────────────────────────────────────────────

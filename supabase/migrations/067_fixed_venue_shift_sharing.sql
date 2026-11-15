  -- ═══ FIXED VENUE SAME-DAY SHIFT-PAIR SHARING (owner ask, 2026-11-15) ═══
  -- Reported live: "Iron Golden Container Stand" (owned 25) showed "Available on date: -19" for
  -- 2026-11-15 — 3 functions holding it that day: NP Singh (Lunch, Pushpanjali, ×12), RAKESH (Dinner,
  -- Emerald Green, ×20), Sahej Singh (Dinner, Pushpanjali, ×12). Owner's own correction: NP Singh and
  -- Sahej Singh are both at Pushpanjali, which has 12 standing of this item — a Lunch function and a
  -- Dinner function the SAME day at the SAME property can reuse the same 12 units (the item sits idle
  -- between the two and gets moved), so that pair should cost ONE block of 12, not 24. RAKESH is at a
  -- DIFFERENT property (Emerald Green) — no sharing with Pushpanjali's own usage — so the true total
  -- demand that day is 12 (Pushpanjali, shared) + 20 (Emerald Green, alone) = 32 against 25 owned: a
  -- genuine shortfall of 7, not the -19 the flat sum implied.
  --
  -- apply_block_ops (migration 066) is the sole writer of `blocks` and the sole source of the
  -- `to_produce`/`short` numbers every downstream shortfall display (StockShortfallBanner, Deal Check's
  -- Sold gate) ultimately reads — so this has to be fixed at the SAME layer that checks headroom, not
  -- just in a display formula, or the write-time check still rejects/flags things that are actually
  -- fine and the procurement signal (`to_produce`) stays wrong. See src/lib/ims/fixedVenueSharing.js
  -- for the JS mirror of this exact formula, used by the Inventory tab's "Blocked for Functions" popup
  -- and grid, and (via blockEntriesWithVenueShift) by ledgerPreflightShortfalls, the Studio pre-Sold
  -- gate — all three must stay in sync with the arithmetic here; see that file's own header for the
  -- full reasoning (why only a day<->night shift pairing is trusted, why scope is the whole property
  -- and not the exact sub-venue, why it's capped at standing qty, why an event whose own functions span
  -- more than one shift group that day is never credit-eligible either way).
  --
  -- WHAT CHANGES: inside apply_block_ops' per-(item,date) headroom check, `v_others` (every OTHER live
  -- entry on that date) is no longer a flat sum. Two steps, both mirrored exactly from
  -- src/lib/ims/fixedVenueSharing.js (effectiveBlockedTotal + sharingFreeZone — see that file's own
  -- header for the full derivation, including why these are two DIFFERENT sums, not one):
  --   1. `v_others` itself is computed the grouped way effectiveBlockedTotal does: entries are
  --      classified by (Fixed Venue property, day/night shift group), same-group demand at one property
  --      sums, cross-group demand at one property reuses up to the standing qty there, and anything
  --      that doesn't resolve to a Fixed Venue (or has an unrecognized/blank/mixed shift) sums in full.
  --      This step alone is symmetric — it doesn't matter whether the CURRENT op's own event is itself
  --      at a Fixed Venue, every op sees the same correctly-grouped total of everyone ELSE's demand.
  --   2. A further marginal "free zone" (sharingFreeZone) is credited for THIS op's own specific
  --      request, when its own event resolves to a safe day/night shift at a standing Fixed Venue
  --      property: the first `least(opposite-group-total, standing) - same-group-total` units of the
  --      NEW request cost nothing (already absorbed by an existing opposite-group commitment there),
  --      everything beyond that competes for headroom same as an unshared item would. This free zone is
  --      UNCONDITIONAL slack, added on top of whatever headroom remains after `others` — never netted
  --      into `others` itself first — so `v_free = greatest(greatest(owned - others, 0) + free_zone,
  --      prior, 0)`, not `greatest(owned - (others - free_zone), prior, 0)`: the latter under-states free
  --      capacity whenever `others` alone already exceeds owned (round 2 of this review, finding M3 —
  --      the free zone must not be blamed for, or netted against, some OTHER op's pre-existing
  --      over-commitment). Without this step at all, a brand-new request still read an existing
  --      opposite-shift hold as full competing demand even though the two are meant to share the same
  --      units and cost nothing extra together.
  -- Both steps are computed fresh, inside the SAME locked transaction, from `fixed_venues` +
  -- `event_orders.data` + the just-locked `blocks` row — never from a client-supplied number — so this
  -- can never reopen the race condition migration 066 itself exists to close.
  --
  -- Nothing about the LOCKING, the (source,date) replace semantics, or the reject/cap/force policy
  -- changes here — only how `v_others` is computed inside the existing per-date loop.

  -- ── one place to normalize a venue name, mirroring lib/ims/fixedVenues.js's own normVenue exactly:
  --    lowercase, drop a leading "Ambria ", trim, drop trailing .,;: ──
  create or replace function public.norm_venue_name(p_name text)
  returns text language sql immutable as $$
    select trim(regexp_replace(regexp_replace(trim(regexp_replace(lower(coalesce(p_name,'')), '^ambria\s+', '')), '[.,;:]+$', ''), '\s+$', ''))
  $$;

  -- ── resolves a venue name (sub-venue or property) to its Fixed Venue property row, mirroring
  --    fixedVenueFor: the venue itself, or its parent (settings.venueParents), normalized. The
  --    venueParents JSON-string parse is wrapped — a malformed stored string must never abort the
  --    whole write (regression review, 2026-11-15, finding 6), it just means no parent match. ──
  create or replace function public.fixed_venue_property_for(p_venue_name text)
  returns table(id text, name text) language plpgsql stable set search_path = public as $$
  declare
    v_parent_text text; v_parent_json jsonb; v_parent text; v_cand1 text; v_cand2 text;
  begin
    if coalesce(p_venue_name, '') = '' then return; end if;
    select s.value #>> '{}' into v_parent_text from public.settings s where s.key = 'venueParents';
    begin
      v_parent_json := case when v_parent_text is not null then v_parent_text::jsonb else null end;
    exception when others then v_parent_json := null;
    end;
    if v_parent_json is not null and jsonb_typeof(v_parent_json) = 'object' then
      v_parent := v_parent_json ->> p_venue_name;
    end if;
    v_cand1 := public.norm_venue_name(p_venue_name);
    v_cand2 := case when coalesce(v_parent, '') <> '' then public.norm_venue_name(v_parent) else null end;
    return query
      select fv.id, fv.name from public.fixed_venues fv
      where public.norm_venue_name(fv.name) = v_cand1
          or (v_cand2 is not null and public.norm_venue_name(fv.name) = v_cand2)
      limit 1;
  end;
  $$;

  -- ── standing qty (both buckets — qty + fullQty, mirroring totalQtyOf) of one item at one Fixed
  --    Venue property row (by id); 0 if the property doesn't hold this item at all. Reuses
  --    block_entry_qty (migration 066) for the same safe number/string/invalid coercion it already
  --    gives blocks entries, rather than a bare ::numeric cast that would abort on a non-numeric
  --    string (regression review, 2026-11-15, finding 6); also tolerates a non-array `items`. ──
  create or replace function public.fixed_venue_standing_qty(p_fv_id text, p_item_id text)
  returns numeric language sql stable set search_path = public as $$
    select coalesce((
      select public.block_entry_qty(jsonb_build_object('qty', it->'qty'))
          + public.block_entry_qty(jsonb_build_object('qty', it->'fullQty'))
        from public.fixed_venues fv
        cross join lateral jsonb_array_elements(case when jsonb_typeof(fv.items) = 'array' then fv.items else '[]'::jsonb end) it
      where fv.id = p_fv_id and it->>'invId' = p_item_id
      limit 1
    ), 0)
  $$;

  -- ── "day" | "night" | null (not a safe pairing) — mirrors shiftGroupOf in
  --    src/lib/ims/fixedVenueSharing.js EXACTLY; keep both in sync if this set ever changes ──
  create or replace function public.shift_group(p_shift text)
  returns text language sql immutable as $$
    select case lower(trim(coalesce(p_shift, '')))
      when 'brunch' then 'day' when 'morning' then 'day' when 'lunch' then 'day'
      when 'dinner' then 'night' when 'night' then 'night' when 'latenight' then 'night' when 'late night' then 'night'
      else null end
  $$;

  -- ── the venue + shift of ONE event on ONE date, collapsed the same conservative way
  --    collapseVenueShift (src/lib/ims/fixedVenueSharing.js) collapses a deal's own `functions` rows:
  --    zero functionsDetail entries match that date -> fall back to the order's own top-level
  --    venue/shift (a single-function order); exactly one match -> that match's venue/shift; MORE than
  --    one match -> credit-eligible only if every one of them agrees on the same venue AND the same
  --    safe shift group, otherwise (null, null) (regression review, 2026-11-15, finding 2: an event
  --    whose own functions span more than one shift group that day already needs its units in both
  --    windows and has nothing left to share with anyone else — picking just one of its matches, as an
  --    earlier draft of this migration did via a bare `limit 1`, could make that event look free for a
  --    DIFFERENT event to share with, a real overbook, not just a display quirk). ──
  create or replace function public.event_fn_venue_shift(p_event_id text, p_date text)
  returns table(venue text, shift text) language plpgsql stable set search_path = public as $$
  declare
    v_data jsonb; v_fd jsonb;
    v_cnt int; v_distinct_venues int; v_distinct_groups int;
    v_venue text; v_shift text;
  begin
    if coalesce(p_event_id, '') = '' then return; end if;
    select eo.data into v_data from public.event_orders eo where eo.id = p_event_id;
    if v_data is null then return; end if;
    v_fd := v_data->'functionsDetail';
    if jsonb_typeof(v_fd) = 'array' then
      -- count(distinct x) silently SKIPS nulls — shift_group returns null for an unsafe/unrecognized
      -- shift (Sundowner, blank, ...), so [Lunch, Sundowner] would otherwise count as ONE distinct
      -- group (the null just vanishes) instead of being correctly flagged as mixed. Substituting a
      -- sentinel for null before counting distinct values closes this (regression review, 2026-11-15,
      -- round 2, finding C1).
      select count(*),
            count(distinct coalesce(fn->>'venue', fn->>'fnVenue', '')),
            count(distinct coalesce(public.shift_group(fn->>'shift'), '~'))
        into v_cnt, v_distinct_venues, v_distinct_groups
        from jsonb_array_elements(v_fd) fn
      where coalesce(fn->>'date', fn->>'fnDate') = p_date;
      if coalesce(v_cnt, 0) = 0 then
        return query select v_data->>'venue', v_data->>'shift';
        return;
      end if;
      if v_cnt > 1 and (v_distinct_venues > 1 or v_distinct_groups > 1) then
        return query select null::text, null::text; -- spans more than one venue/shift group: never credit-eligible
        return;
      end if;
      select coalesce(fn->>'venue', fn->>'fnVenue'), fn->>'shift' into v_venue, v_shift
        from jsonb_array_elements(v_fd) fn
      where coalesce(fn->>'date', fn->>'fnDate') = p_date
      limit 1;
      return query select v_venue, v_shift;
      return;
    end if;
    return query select v_data->>'venue', v_data->>'shift';
  end;
  $$;

  revoke all on function public.norm_venue_name(text) from public, anon;
  revoke all on function public.fixed_venue_property_for(text) from public, anon;
  revoke all on function public.fixed_venue_standing_qty(text, text) from public, anon;
  revoke all on function public.shift_group(text) from public, anon;
  revoke all on function public.event_fn_venue_shift(text, text) from public, anon;
  grant execute on function public.norm_venue_name(text) to authenticated;
  grant execute on function public.fixed_venue_property_for(text) to authenticated;
  grant execute on function public.fixed_venue_standing_qty(text, text) to authenticated;
  grant execute on function public.shift_group(text) to authenticated;
  grant execute on function public.event_fn_venue_shift(text, text) to authenticated;

  -- ── apply_block_ops itself: same signature, same locking/removal/grant logic — only how `v_others`
  --    is computed changes. Re-declaring the whole function body (CREATE OR REPLACE) since Postgres has
  --    no way to patch one statement inside it. ──
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
    -- Fixed Venue same-day shift-pair sharing (see the per-date loop's own comment)
    v_own_venue text; v_own_shift text; v_own_group text; v_own_fv text;
    v_own_standing numeric; v_own_day numeric; v_own_night numeric; v_free_zone numeric;
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
        -- ── Fixed Venue same-day shift-pair sharing (owner ask, 2026-11-15) ──
        -- Two steps, both mirroring src/lib/ims/fixedVenueSharing.js exactly (keep both in sync):
        --   1. Classify every OTHER kept live entry on this date by (Fixed Venue property, day/night
        --      shift group) and combine per property — same-group demand sums, cross-group demand
        --      reuses up to the standing qty there, anything that doesn't resolve to a Fixed Venue (or
        --      has an unrecognized/blank/mixed shift) sums in full. This alone (v_others_raw) is
        --      symmetric for every op (regression review, 2026-11-15, finding 3: an earlier draft only
        --      computed this when the CURRENT op's own event itself resolved to a shared property).
        --   2. A MARGINAL free-zone credit for THIS op's own specific request (sharingFreeZone in the
        --      JS module): resolve this op's own (property, shift group); if both resolve to a safe,
        --      standing Fixed Venue pairing, the first `least(opposite-group-total, standing) -
        --      same-group-total` units of this op's own request cost NOTHING — they're already fully
        --      absorbed by an existing opposite-group commitment there — only units beyond that compete
        --      for headroom same as an unshared item would (regression review, 2026-11-15, finding 4:
        --      v_others_raw alone, with no op-specific credit, still read NP's existing Lunch hold as
        --      full competing demand against Sahej's brand-new Dinner request, when physically the two
        --      fully share the same standing units and cost nothing extra together).
        v_own_venue := null; v_own_shift := null; v_own_group := null; v_own_fv := null; v_own_standing := 0;
        select evs.venue, evs.shift into v_own_venue, v_own_shift
          from public.event_fn_venue_shift(v_event, v_date) evs;
        v_own_group := public.shift_group(v_own_shift);
        if v_own_group is not null then
          select fvp.id into v_own_fv from public.fixed_venue_property_for(v_own_venue) fvp;
          if v_own_fv is not null then
            v_own_standing := public.fixed_venue_standing_qty(v_own_fv, v_item);
          end if;
        end if;

        with classified as (
          select public.block_entry_qty(e) as q,
                fvp.id as fv_id,
                public.shift_group(evs.shift) as grp
            from jsonb_array_elements(v_kept) e
            left join lateral public.event_fn_venue_shift(e->>'eventId', v_date) evs on true
            left join lateral public.fixed_venue_property_for(evs.venue) fvp on true
          where e->>'date' = v_date and public.block_entry_is_live(e)
        ),
        by_property as (
          select fv_id,
                public.fixed_venue_standing_qty(fv_id, v_item) as standing,
                sum(case when grp = 'day' then q else 0 end) as day_total,
                sum(case when grp = 'night' then q else 0 end) as night_total,
                sum(case when grp is null then q else 0 end) as other_total
            from classified
          where fv_id is not null
          group by fv_id
        )
        select
          coalesce((select sum(q) from classified where fv_id is null), 0)
            + coalesce((select sum(day_total + night_total - least(day_total, night_total, standing) + other_total) from by_property), 0),
          coalesce((select day_total from by_property where fv_id = v_own_fv), 0),
          coalesce((select night_total from by_property where fv_id = v_own_fv), 0)
        into v_others, v_own_day, v_own_night;

        v_free_zone := 0;
        if v_own_group = 'day' and v_own_fv is not null and v_own_standing > 0 then
          v_free_zone := greatest(0, least(v_own_night, v_own_standing) - v_own_day);
        elsif v_own_group = 'night' and v_own_fv is not null and v_own_standing > 0 then
          v_free_zone := greatest(0, least(v_own_day, v_own_standing) - v_own_night);
        end if;
        -- v_free_zone is UNCONDITIONAL slack — it costs nothing regardless of whether v_others already
        -- exceeds v_owned (an existing over-commitment that is some OTHER op's doing, not this one's),
        -- so it is added on top of whatever headroom is left after `others`, never netted into `others`
        -- first (regression review, 2026-11-15, round 2, finding M3: owned - (others - free_zone) can
        -- under-state free capacity once `others` alone already exceeds owned — see v_free below).

        select coalesce(sum(public.block_entry_qty(e)),0) into v_prior
          from jsonb_array_elements(v_removed) e where e->>'date' = v_date and public.block_entry_is_live(e);
        select coalesce(sum(public.block_entry_qty(a)),0) into v_requested
          from jsonb_array_elements(v_op->'add') a where a->>'date' = v_date;

        v_free := case when v_owned is null then v_requested else greatest(greatest(v_owned - v_others, 0) + v_free_zone, v_prior, 0) end;
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

  revoke all on function public.apply_block_ops(jsonb, text) from public, anon;
  grant execute on function public.apply_block_ops(jsonb, text) to authenticated;

  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- MANUAL VERIFICATION (optional, run by hand — needs a real Fixed Venue + a real inventory item;
  -- substitute real ids/names for the placeholders below):
  --
  --   1. Confirm a Fixed Venue + standing item exist:
  --      select id, name, items from public.fixed_venues where name ilike '%pushpanjali%';
  --        -- note its id as FV_ID, and an invId from `items` with qty >= 10 as ITEM_ID
  --
  --   2. Pick three throwaway event_orders rows (or make them) with a functionsDetail entry on the
  --      SAME date, SAME venue (the Fixed Venue's own name):
  --      update event_orders set data = data || '{"functionsDetail":[{"date":"2099-01-01","venue":"<FV NAME>","shift":"Lunch"}]}'::jsonb where id = 'eo_test_a';
  --      update event_orders set data = data || '{"functionsDetail":[{"date":"2099-01-01","venue":"<FV NAME>","shift":"Dinner"}]}'::jsonb where id = 'eo_test_b';
  --      update event_orders set data = data || '{"functionsDetail":[{"date":"2099-01-01","venue":"<FV NAME>","shift":"Dinner"}]}'::jsonb where id = 'eo_test_c';
  --
  --   3. Block 10 for eo_test_a (Lunch), then 10 for eo_test_b (Dinner) — eo_test_b's own report should
  --      show `others: 0` (fully shared with eo_test_a's Lunch), not `others: 10`:
  --      select apply_block_ops('[{"item_id":"ITEM_ID","event_id":"eo_test_a","add":[{"date":"2099-01-01","qty":10}]}]'::jsonb);
  --      select apply_block_ops('[{"item_id":"ITEM_ID","event_id":"eo_test_b","add":[{"date":"2099-01-01","qty":10}]}]'::jsonb);
  --
  --   4. Now block 10 MORE for eo_test_c, also Dinner, same date/venue — this is the overbook-risk
  --      case (two Dinner functions can't share with each other, only with Lunch): eo_test_c's own
  --      report should show `others: 10` (just eo_test_b's Dinner — eo_test_a's Lunch is already fully
  --      absorbed into eo_test_b's own credit) and, if standing qty there is only 10, a real `short: 10`
  --      — NOT `others: 0`/fully granted:
  --      select apply_block_ops('[{"item_id":"ITEM_ID","event_id":"eo_test_c","add":[{"date":"2099-01-01","qty":10}]}]'::jsonb, 'cap');
  --
  --   5. Clean up: delete the three test blocks entries (or just leave 2099-01-01 test data — it never
  --      competes with anything real) and revert the three event_orders' functionsDetail if they were
  --      real rows borrowed for this test.
  -- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ═══ FIXED VENUE SHIFT-PAIR SHARING: THE CAP IS THE ITEM'S OWN OWNED QTY, NOT A PER-VENUE
--     REGISTRATION (owner clarification, 2026-11-15, second live report) ═══
-- Migration 067 capped the day/night sharing credit at `fixed_venue_standing_qty(fv_id, item_id)`
-- — a lookup into that property's own registered standing-inventory list (Admin → Settings →
-- 🏛️ Fixed Venues → [property], the `fixed_venues.items` JSONB column). Reported live: "Arch panel
-- small" (owned 4 total) was used for a Lunch function (2) and a same-day Dinner function (4) at
-- Pushpanjali — the exact same shareable shift pair the feature exists for — but got ZERO credit
-- and showed a false "0 available" (2 + 4 summed to 6), because nobody had separately added this
-- item to Pushpanjali's own standing-inventory list. The owner's original "capped at the standing
-- qty" meant "capped at how many actually exist," not "only for items an ops admin has separately
-- registered at that specific property" — confirmed directly: "it should let them [share], yeah."
--
-- WHAT CHANGES: `fixed_venue_standing_qty(p_fv_id, p_item_id)` keeps its exact name and signature
-- (so apply_block_ops itself needs no changes at all — both of its call sites already just want
-- "the cap" for this item) but now simply returns the item's own `inventory.qty` — gross owned
-- quantity, company-wide, ignoring p_fv_id entirely (kept only so the two existing call sites in
-- apply_block_ops don't need touching). This makes the credit apply to literally every item with no
-- registration step, matching the original "all items" instruction. Mirrors the JS-side change in
-- src/lib/ims/fixedVenueSharing.js (classify/sharingFreeZone now take an explicit `ownedQty` —
-- the caller's own item.qty — instead of calling the old standingQty(settings, venue, invId) lookup).
create or replace function public.fixed_venue_standing_qty(p_fv_id text, p_item_id text)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select i.qty from public.inventory i where i.id = p_item_id), 0)::numeric
$$;

revoke all on function public.fixed_venue_standing_qty(text, text) from public, anon;
grant execute on function public.fixed_venue_standing_qty(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL VERIFICATION (optional, run by hand — needs a real inventory item owned qty 4+, and a
-- real Fixed Venue property name; substitute real ids/names for the placeholders below):
--
--   1. Confirm the item's owned qty (no fixed_venues registration needed at all now):
--      select id, name, qty from public.inventory where name ilike '%arch panel small%';
--        -- note its id as ITEM_ID and owned qty as OWNED_QTY
--
--   2. Pick two throwaway event_orders rows with a functionsDetail entry on the SAME date, SAME
--      venue (a real Fixed Venue property's own name), a Lunch and a Dinner:
--      update event_orders set data = data || '{"functionsDetail":[{"date":"2099-01-02","venue":"<FV NAME>","shift":"Lunch"}]}'::jsonb where id = 'eo_test_d';
--      update event_orders set data = data || '{"functionsDetail":[{"date":"2099-01-02","venue":"<FV NAME>","shift":"Dinner"}]}'::jsonb where id = 'eo_test_e';
--
--   3. Block 2 for eo_test_d (Lunch), then 4 for eo_test_e (Dinner) — eo_test_e's own report should
--      show `others: 2` (shared with eo_test_d's Lunch — not summed in full), not `others: 2+4=6`,
--      and (if OWNED_QTY is 4) `short: 0`, not a false shortfall:
--      select apply_block_ops('[{"item_id":"ITEM_ID","event_id":"eo_test_d","add":[{"date":"2099-01-02","qty":2}]}]'::jsonb);
--      select apply_block_ops('[{"item_id":"ITEM_ID","event_id":"eo_test_e","add":[{"date":"2099-01-02","qty":4}]}]'::jsonb);
--
--   4. Clean up: delete the two test blocks entries (or just leave 2099-01-02 test data — it never
--      competes with anything real) and revert the two event_orders' functionsDetail if they were
--      real rows borrowed for this test.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

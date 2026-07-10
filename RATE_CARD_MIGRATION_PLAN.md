# Rate Card → IMS: Phased Migration Plan

Living tracking doc — check items off as they're built. Full roadmap kept for context; only **Phase 0** and **Phase 1** are in scope right now.

## Status: Phase 0-5 done. Paused before Phase 6.

Phase 0 (data audit), Phase 1 (scaling-factor schema + IMS admin UI), Phase 2 (wiring the scaling factor into pricing math), Phase 3 (moving Rate Card admin to IMS), Phase 4 (cross-app cleanup — fixed a real dead-`rcItems` bug in `EventsTab.jsx`'s AI matching, pointed the batch tagger at live data), and Phase 5 (taxonomy/Deal Check regression checks — all clean, no changes needed) are **complete**. Phase 6 (rollout) is next.

## Context

Studio's pricing/taxonomy ("Rate Card": 155 items in the `rate_card` table + an 11-category list in the `settings` blob `ambria-rccats-v1`) is currently owned and edited by Studio (`src/pages/studio/RateCard.jsx`), while IMS treats it as a "read-only mirror" for its own inventory categories, purchase-order categories, and Flowers→Recipes matching.

Decision made: **IMS becomes the source of truth for pricing and taxonomy.** IMS will expose sub-categories, each carrying a scaling factor applied to every item inside it. Studio pulls pricing, categories, and taxonomy from IMS instead of owning them.

**Key finding from the impact audit that shapes this plan:** the boundary is already half-blurred in exactly this direction. IMS *already writes* into the shared `rate_card` table today (`syncRecipeRatesToStudio` in `IMS.jsx`, florals pricing computed from IMS flower recipes × markup). And ~15 Studio pricing functions (`getElPrice`, `getElPriceForFn`, `calcFunctionCost`, Deal Check's matcher, etc.) all read `rate_card` by row shape (`cat`, `sub`, `name`, `inhouseFlat/S/M/B`, `artificialFlat/S/M/B`), not by any Studio-specific mechanism. That means **the fastest, lowest-risk way to make IMS the source of truth is to move who's allowed to *write* to `rate_card`/`rate_card_categories`/`RC_SK_CATS`, not to rewrite the ~15 functions that read it.** A full data-model rewrite (collapsing Studio elements into direct IMS inventory references) was evaluated and rejected for this plan — it would additionally require rebuilding AI-tagging vocabulary, Deal Check's 3-hop string matcher, and IMS's own inventory-category derivation, for a much larger blast radius than the stated goal requires.

The one genuinely new piece is the **per-sub-category scaling factor** — this does not exist anywhere in IMS today (the closest existing concept, `settings.datePricing.categories[key].multiplier`, is global/date-scoped, not sub-category-scoped) and needs new schema.

---

## Phase 0 — Data audit ✅ done

- [x] Run the coverage query — how many of the 155 rate-card items have zero matching IMS inventory row by name/sub-category
- [x] Confirm `rate_card_categories` row count is 0 (i.e. safe to repurpose)
- [x] Pull the distinct `sub_cat` list from `inventory` to scope which sub-categories need a factor at launch

### Findings

- **`rate_card_categories` row count: 0.** Confirmed dead, safe to repurpose for the scaling-factor column.
- **74 distinct sub-categories exist in `inventory` today** (Truss, Chair, Sofa, Flower Pot Small/Medium/Large, Cushion, Tenting Accessories, etc. — full list captured, used to seed Phase 1; corrected from an initial rough count of 65 when the exact seed list was compiled).
- **52 rate-card items showed as "no matching inventory row" — but 5 are false positives from whitespace drift, not real gaps.** `rc.sub` has leading/trailing spaces on some rows (`"Candle Stick + Stand "`, `"Tenting Accessories "`, `"Food Canopy "`, `"Tree "`, and a leading-space variant for Banjara Props) that don't match the clean inventory `sub_cat` value. **This must be cleaned before Phase 2's scaling-factor join runs on the same field**, or the factor will silently fail to apply to these items exactly the way Deal Check's matcher silently fails today.
- **The remaining ~47 genuine no-matches** break into three groups:
  - **Orphan category `cat_uzqdy`** (Scrolls, BOLSTER, ROUND TABLE OVERLAYS — 3 items) — a broken category id from the existing "orphan category recovery" placeholder logic in `StudioApp.jsx`. Needs reassignment to a real category at some point; not blocking Phase 1.
  - **Size-variant granularity mismatch** — Coffee Table Floral (Small/Medium/Large), Centre Piece (Small/Medium) price by size in the rate card, but inventory only has one flat "Coffee Table" bucket, no size split.
  - **Purely commercial / no physical stock** — Printing, Flower Pattern (recipes — a separate subsystem), Carpet (Old/New), mattress, chowki, Jewellery, Glass Table, Pole Pipes, Wedding/Cocktail Banjara Accessories.
- **Near-duplicate naming across the two sides** (not whitespace, real drift — flag for manual reconciliation when setting factors, don't blind-merge): `Glass Panel 2D` (rate card) vs `3D Glass Panel` (inventory); `3D candle Walls` (rate card) vs `Candle walls` / `Candle Walls 2D` (inventory); `Takhat` (rate card) vs `Table Takhat` (inventory).

### Decision: Phase 1 scaling-factor scope

**All sub-categories, IMS + rate-card-only** — the factor UI will cover the union of the 65 IMS inventory sub-categories and the ~47 rate-card-only sub-category names (whitespace-trimmed, near-duplicates flagged for manual merge rather than auto-combined), all defaulting to 1.0. Every priced item goes through the same scaling mechanism eventually, including ones with no physical stock today.

---

## Phase 1 — Add the scaling-factor schema + IMS admin UI ✅ done

**Schema-shape correction made while building:** the original bullet said "add a `scaling_factor` column to `rate_card_categories`." On closer inspection, that table's actual columns (`id/label/icon/sort_order/subs-as-JSONB-array`) are one-row-per-*top-level-category* (11 rows), not one-row-per-*sub-category* (103 needed). A single column addition would only have supported 11 category-level factors, not the per-sub-category factor the plan requires — and CLAUDE.md's own "no JSON blobs for flat data, row-level updates only" rule rules out nesting sub-categories as a JSONB array on the old shape. Since the table has 0 rows and 0 code references (confirmed in Phase 0), it's redefined with new columns instead: one row per sub-category.

- [x] **Data hygiene:** migration includes `UPDATE rate_card SET sub = trim(sub) WHERE sub <> trim(sub)` — fixes the whitespace drift found in Phase 0 at the source (not just the 5 known cases; catches any others the same way). `cat_uzqdy` orphan items and the near-duplicate naming pairs are left as separate rows, flagged in the UI, not auto-merged.
- [x] `rate_card_categories` redefined as one row per sub-category: `id` (lower/trim of label — the exact join key `itemImsSubcat()`/`filterImsBySubcategory` already use), `label`, `scaling_factor NUMERIC DEFAULT 1.0`, `source` ('inventory' | 'rate_card_only'), `sort_order`, timestamps. RLS mirrors `rate_card`'s current posture (introspected at migration time, not assumed) and the table is added to the realtime publication.
  → `supabase/migrations/012_rate_card_subcategory_scaling.sql`
- [x] Seeded with the union list: 74 sub-categories from live `inventory.sub_cat` + 29 rate-card-only sub-categories (corrected count — Phase 0's "65"/"~47" were rough estimates; exact recount while building the seed came to 74 + 29 = 103), each defaulting to `scaling_factor = 1.0`
- [x] `AdminSettingsTab.jsx`'s "📂 Sub-Categories" panel rebuilt from a read-only Studio mirror into a searchable, editable list (flat + sorted, not category-grouped — no reliable top-level-category mapping exists for the 74 inventory-sourced rows). Each row shows a source badge (📦 stock / 🏷️ rate-card only), a scaling-factor input (commits on blur/Enter), and a "⚠ possible dup" flag on the known near-duplicate pairs (Glass Panel 2D/3D Glass Panel, 3D candle Walls/Candle walls+Candle Walls 2D, Takhat/Table Takhat).
  → `src/pages/ims/AdminSettingsTab.jsx`, wired through `src/pages/ims/AdminTab.jsx` and `src/pages/ims/IMS.jsx` (new `rateCardCategories` state, boot fetch, realtime subscription, `updateSubcatFactor` optimistic-update function)
- [x] Realtime subscription for `rate_card_categories` added in `StudioApp.jsx` (mirrors the existing `rate_card` subscription pattern) — Studio now mirrors factor changes live into a new `rcSubcatFactors` state, read-only, unconsumed until Phase 2.

- [x] **Add sub-category** — inline "+ Add" field (reuses the existing `AddInlineItem` component) for sub-categories that don't exist yet in the seeded 103. New rows default to `scaling_factor = 1.0`, tagged `source = 'manual'` (🖊️ badge).
- [x] **Edit sub-category name** — every row's label is an editable input (blur/Enter to commit). Since `id = lower(trim(label))` is the join key, renaming updates both `id` and `label` together, with a duplicate-name check and rollback-on-failure.

Migration run and confirmed working (103 rows visible in IMS → Admin → Settings → 📂 Sub-Categories). Phase 1 fully done — additive only, nothing existing changes behavior yet.

**⏸ Paused here.** Next step is for you to go through IMS → Admin → Settings → 📂 Sub-Categories and set real scaling factors on the sub-categories that matter (everything currently defaults to 1.0, which is a no-op). Come back to Phase 2 once that's done.

---

## Phase 2 ✅ done — Consolidate Studio's duplicated price-resolution logic

- [x] Extracted the shared SMB/flat rate-resolution branch out of `getElPrice`, `getElPriceForFn`, and `calcFullEventCost`'s inline copy into one function, `resolveRcRate(rc, sz)` (`StudioApp.jsx`, right after `rcIsSMB`)
- [x] `resolveRcRate` multiplies the resolved `realRate`/`artRate` by the matching sub-category's `scaling_factor`, looked up via the existing `itemImsSubcat(rc)` helper (`src/lib/ims/helpers.js:86`) against a memoized map built from `rcSubcatFactors` (the Phase 1 realtime mirror of `rate_card_categories`). Unknown/missing/zero factors fall back to `1` (no-op), so ungoverned sub-categories are unaffected.
- [x] **Scope expanded by one function found during implementation:** `calcFnFloralSourcingCost` (the Deal Check billed-income real/artificial split) had its own, fourth, independent copy of the same SMB/flat block — not in the original checklist, but left unscaled it would have made the client-billed quote reflect the new factor while the Deal Check P&L billed-income figure didn't. Fixed the same way, using `resolveRcRate`.
- [x] Verified with `npx vite build` after each edit — no syntax/reference errors.

**Known, deliberately out-of-scope gap:** two *cosmetic preview* prices — `StudioModals.jsx:170` (Zone Upload Review "NEW element" cost preview) and `ManageLibrary.jsx:862` (Library tagging cost preview) — read `rc.inhouseFlat/S/M/B` directly rather than through `getElPrice`/`resolveRcRate`. Fixing them would mean threading `resolveRcRate` as a prop into two more components; since they're previews only (not the billed price), this was left alone. If a sub-category's factor is set meaningfully away from 1.0, these two previews will read low compared to the real billed price everywhere else — cosmetic only, but worth knowing.

**One incidental behavior fix, not just a refactor:** `calcFullEventCost`'s old inline branch only recognized exact `"S"`/`"B"` size strings, while `getElPrice`/`getElPriceForFn` also recognized `"SMALL"`/`"BIG"`/`"LARGE"`/`"PREMIUM"`/`"HEAVY"`. Consolidating onto one function means `calcFullEventCost` (Browse-tab library video cost badges) now recognizes the full synonym set too — a minor consistency fix, surfaced here rather than shipped silently.

Why this mattered: applying the scaling factor once, in the consolidated function, avoids fixing the same multiplier in four places and re-introducing drift between them (the codebase already had a comment at `DealCheckOverlay.jsx:333` flagging a *different* duplicate as "MUST match DCManpowerTab" — this closes the same class of problem for pricing, not labour).

---

## Phase 3 ✅ done — Move Rate Card admin authority from Studio to IMS

- [x] Extracted `rowToRcItem`/`rcItemToRow` (row↔item mappers) and `rcIsSMB`/`getFloralMode` (pure pricing-mode helpers) out of `StudioApp.jsx` into a new shared file, `src/lib/rateCard.js` — needed by both apps now, so duplicating them into IMS was never on the table.
- [x] Built a new IMS admin UI, `src/pages/ims/RateCardPanel.jsx`, replicating `RateCard.jsx`'s editing capabilities: item CRUD (category, name, sub-category, unit, `imsAlias`, inhouse flat/S-M-B pricing, floral real/artificial/ratio mode, outsource S/M/B, notes, delete), category CRUD (icon/label/color/description, reorder, add, delete-if-empty). Wired in via `AdminSettingsTab.jsx` (new "💰 Rate Card" panel) → `AdminTab.jsx` → `IMS.jsx` (new `saveRateCardItems`/`saveRateCardCats` functions, same rollback-on-error pattern as Studio's `saveRC`/`saveRcCats`), writing to the same `rate_card` table / `ambria-rccats-v1` settings key Studio already reads.
- [x] **Deliberate UX simplification vs. the Studio original:** category edits commit immediately per-field (matching the Phase 1 Sub-Categories panel's blur/change-commit pattern) instead of a staged "Save Categories" button — removes the risk of losing typed edits by navigating away mid-edit.
- [x] **Deliberately NOT ported:** the tagging-visibility toggle (`isSubTagHidden`/`toggleTagHiddenSub`) — that's a Studio-side tagging concern (see Phase 5), not Rate Card pricing, and stays in Studio's read-only page where it's still fully interactive.
- [x] Converted Studio's `RateCard.jsx` to a read-only reference view — search/browse/filter/health-stats all still work (still live via the existing realtime subscription, so IMS edits appear immediately), but all add/edit/delete controls are gone, replaced with a banner pointing to IMS.
- [x] Fixed `saveRC`'s and `saveRcCats`'s no-rollback-on-error gap in `StudioApp.jsx` while touching this code — a failed save now reverts local state instead of leaving it ahead of the DB.

**Known, deliberate scope-limit:** `saveRC`/`saveRcCats` and RateCard.jsx's former UI-only state (`rcCatEditMode`, `rcAddMode`, `rcSubOpen`, `rcNewForm` + setters) are now dead code in `StudioApp.jsx` — no longer called from anywhere. Left in place rather than also ripped out in this same change, specifically to keep this diff's blast radius smaller after an unrelated mistake earlier in this session (a careless `replace_all` edit caused a shipped, if quickly fixed, production crash) — pure dead-code removal is safe but not free, and doing it separately means a smaller, easier-to-review diff for this pass. Worth a follow-up cleanup pass.

---

## Phase 4 ✅ done — Clean up now-inaccurate/broken cross-app artifacts

- [x] Confirmed `InventoryTab.jsx`, `PurchaseTab.jsx`, and Flowers→Recipes matching in `AdminSettingsTab.jsx` don't regress: all three only read `studio.catLabels`/`subcats`/`subcatsByCat`/`floralsItems`/`floralsSubcats`, which are unaffected by *who writes* `rate_card`/`rate_card_categories` — Phase 3 only changed the write path, not this derivation.
- [x] Fixed `EventsTab.jsx`'s dead `studio?.rcItems` reference — the `studio` memo (`IMS.jsx`) never actually exposed an `rcItems` key, so it always evaluated to `[]`. Added `rcItems: studioRcItems` to the memo's return value (one fix, all 3 call sites in `EventsTab.jsx` resolve correctly now, no changes needed there).
  **This is a real behavior fix, not just dead-code cleanup:** recipe-driven floral elements (Reet, Garland, etc.) were never being correctly skipped from inventory matching — `isRecipeDrivenFloral(rc)` always saw `rc = null` and returned `false`, so these elements were fuzzy-matched against physical inventory ("Flower Reet" → some random flower-print cushion) exactly as the code's own comment warned against. And `fn.flowerOrders` was never populated via the auto-confirm path in `createProjectFromEO`, meaning Tier-1 Flowerist labour counts derived from it were likely wrong/incomplete for auto-confirmed EOs. Both should now work as originally intended.
- [x] Pointed `supabase/functions/batch-tagger/index.ts` at the live `rate_card` table instead of the frozen `ambria-ratecard-v4` settings blob (which was only ever populated once, by the original migration script — every item added or renamed since, in Studio and now in IMS, never reached the nightly tagger's vocabulary).
  **⚠️ Action needed from you:** this is a Supabase Edge Function — the code change alone does **not** take effect. Deploy it with `supabase functions deploy batch-tagger` (per the file's own header comment) for the fix to go live on the next cron run.

---

## Phase 5 ✅ done — Verify taxonomy/AI-tagging and Deal Check are unaffected

Pure verification pass — all three checked out clean, no code changes needed.

- [x] `aiTagImage` (`StudioApp.jsx`) and the Phase-4-fixed batch tagger both build vocabulary from `rcItems`/`isSubTagHidden` — Studio-local state fed by the same live realtime subscription that Phase 3 never touched (only *who writes* `rate_card` changed, not how Studio reads it).
- [x] Deal Check's 3-hop matcher (`filterImsBySubcategory` → `nameMatchUnique` → `getCardSpecsForZone`, `StudioApp.jsx:522-588`) still reads `rc.imsAlias`/`rc.sub`/`rc.cat`/`rc.name` — same fields, same join key, same `rate_card` row shape as before any of Phases 1-4.
- [x] `TAG_HIDDEN_SUBS_SK`/`isSubTagHidden`/`toggleTagHiddenSub` confirmed genuinely Studio-only (`RateCard.jsx`, `StudioApp.jsx`, `StudioBuild.jsx`, `ManageLibrary.jsx`). The one hit in `RateCardPanel.jsx` (IMS) is a Phase 3 comment documenting the decision not to port it, not actual usage.

---

## Phase 6 (on hold) — Rollout

- [ ] Stage the IMS admin UI behind a role check or soft-launch to Krati/Ajay/Sudhir first
- [ ] Diff check: sample of open/recent deals, computed totals before/after the scaling-factor multiplier goes live (should be identical while every factor is at 1.0 default)
- [ ] Set real scaling factors per sub-category, flip Studio's `RateCard.jsx` to read-only in production
- [ ] Update `SQL_TO_RUN.md` and `CLAUDE.md` to reflect new ownership

---

## Verification

- **Phase 2, still to do by you:** open a real deal in Studio Build/Deal Check, pick an element whose sub-category now has a non-1.0 factor set, and confirm its price moved by exactly that factor (e.g. factor 1.1 → price up 10%). Then pick an element in an unfactored (1.0) sub-category and confirm its price is unchanged from before.
- After Phase 3: edit an item/category in the new IMS UI, confirm it appears in Studio's Build/Deal Check views via the existing realtime subscription (no Studio code change needed)
- After Phase 6: with all factors at 1.0, run Deal Check + full event cost calc on a real deal before/after cutover and diff the totals — must match exactly
- Manually exercise: add a rate-card item in the new IMS UI → confirm it shows up in Studio's "+Add element" autocomplete and AI-tagging vocabulary on the next tag run

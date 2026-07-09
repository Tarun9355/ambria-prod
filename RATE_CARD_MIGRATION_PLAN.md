# Rate Card → IMS: Phased Migration Plan

Living tracking doc — check items off as they're built. Full roadmap kept for context; only **Phase 0** and **Phase 1** are in scope right now.

## Current scope: Phase 0 + Phase 1 only

Phases 2-6 below are the full roadmap for context, but **only Phase 0 (data audit) and Phase 1 (scaling-factor schema + IMS admin UI) are being built right now.** Phase 2 wires the scaling factor into Studio's pricing math — that needs real factor values set on real sub-categories first, which only makes sense once Phase 1's UI exists and you've populated it. Phases 3-6 (moving Rate Card write-authority to IMS, cleanup, rollout) wait until Phase 2 is validated. Revisit this plan to continue past Phase 1 once the sub-category factors are filled in.

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

## Phase 1 — Add the scaling-factor schema + IMS admin UI ✅ built, pending migration run

**Schema-shape correction made while building:** the original bullet said "add a `scaling_factor` column to `rate_card_categories`." On closer inspection, that table's actual columns (`id/label/icon/sort_order/subs-as-JSONB-array`) are one-row-per-*top-level-category* (11 rows), not one-row-per-*sub-category* (103 needed). A single column addition would only have supported 11 category-level factors, not the per-sub-category factor the plan requires — and CLAUDE.md's own "no JSON blobs for flat data, row-level updates only" rule rules out nesting sub-categories as a JSONB array on the old shape. Since the table has 0 rows and 0 code references (confirmed in Phase 0), it's redefined with new columns instead: one row per sub-category.

- [x] **Data hygiene:** migration includes `UPDATE rate_card SET sub = trim(sub) WHERE sub <> trim(sub)` — fixes the whitespace drift found in Phase 0 at the source (not just the 5 known cases; catches any others the same way). `cat_uzqdy` orphan items and the near-duplicate naming pairs are left as separate rows, flagged in the UI, not auto-merged.
- [x] `rate_card_categories` redefined as one row per sub-category: `id` (lower/trim of label — the exact join key `itemImsSubcat()`/`filterImsBySubcategory` already use), `label`, `scaling_factor NUMERIC DEFAULT 1.0`, `source` ('inventory' | 'rate_card_only'), `sort_order`, timestamps. RLS mirrors `rate_card`'s current posture (introspected at migration time, not assumed) and the table is added to the realtime publication.
  → `supabase/migrations/012_rate_card_subcategory_scaling.sql`
- [x] Seeded with the union list: 74 sub-categories from live `inventory.sub_cat` + 29 rate-card-only sub-categories (corrected count — Phase 0's "65"/"~47" were rough estimates; exact recount while building the seed came to 74 + 29 = 103), each defaulting to `scaling_factor = 1.0`
- [x] `AdminSettingsTab.jsx`'s "📂 Sub-Categories" panel rebuilt from a read-only Studio mirror into a searchable, editable list (flat + sorted, not category-grouped — no reliable top-level-category mapping exists for the 74 inventory-sourced rows). Each row shows a source badge (📦 stock / 🏷️ rate-card only), a scaling-factor input (commits on blur/Enter), and a "⚠ possible dup" flag on the known near-duplicate pairs (Glass Panel 2D/3D Glass Panel, 3D candle Walls/Candle walls+Candle Walls 2D, Takhat/Table Takhat).
  → `src/pages/ims/AdminSettingsTab.jsx`, wired through `src/pages/ims/AdminTab.jsx` and `src/pages/ims/IMS.jsx` (new `rateCardCategories` state, boot fetch, realtime subscription, `updateSubcatFactor` optimistic-update function)
- [x] Realtime subscription for `rate_card_categories` added in `StudioApp.jsx` (mirrors the existing `rate_card` subscription pattern) — Studio now mirrors factor changes live into a new `rcSubcatFactors` state, read-only, unconsumed until Phase 2.

**Not yet done — action needed from you:** run `supabase/migrations/012_rate_card_subcategory_scaling.sql` in the Supabase SQL editor (I don't run SQL directly against your DB). After it runs, refresh IMS → Admin → Settings → 📂 Sub-Categories to confirm all 103 rows appear, then this phase is fully done.

This phase is additive only — nothing existing changes behavior yet.

---

## Phase 2 (on hold — needs real scaling-factor data from Phase 1 first) — Consolidate Studio's duplicated price-resolution logic

- [ ] Extract the shared SMB rate-resolution branch out of `getElPrice` (`StudioApp.jsx:2387`), `getElPriceForFn` (`StudioApp.jsx:2442`), and `calcFullEventCost`'s inline copy (`StudioApp.jsx:2524-2528`) into one function, e.g. `resolveRcRate(rc, el, fnRatio)`
- [ ] Multiply the resolved `realRate`/`artRate` by the matching sub-category's `scaling_factor`, joined via the existing `itemImsSubcat(rc)` helper (`src/lib/ims/helpers.js:86`)

Why now (once unblocked): applying the scaling factor once, in the consolidated function, avoids fixing the same multiplier in three places and re-introducing drift between them (the codebase already has a comment at `DealCheckOverlay.jsx:333` flagging one such duplicate as "MUST match DCManpowerTab" — worth closing here, not compounding).

---

## Phase 3 (on hold) — Move Rate Card admin authority from Studio to IMS

- [ ] Build an IMS admin UI replicating `RateCard.jsx`'s editing capabilities (item CRUD, category CRUD, `imsAlias`, inhouse/artificial pricing fields, real/artificial/ratio mode selector) — writing to the same `rate_card` table and `RC_SK_CATS` settings key
- [ ] Convert Studio's `RateCard.jsx` to read-only or remove its route/redirect to the new IMS tab
- [ ] Fix `saveRC`'s (`StudioApp.jsx:1924-1938`) no-rollback-on-error gap while touching this code

Studio's pricing functions need no changes here — they keep reading `rcItems`/`rcCats` via the existing realtime subscription; only the write path moves.

---

## Phase 4 (on hold) — Clean up now-inaccurate/broken cross-app artifacts

- [ ] Confirm `InventoryTab.jsx`, `PurchaseTab.jsx`, and Flowers→Recipes matching in `AdminSettingsTab.jsx` don't regress once IMS is the real `rate_card` author
- [ ] Fix `EventsTab.jsx`'s dead `studio?.rcItems` reference (lines 447/479/834) — the `studio` memo never exposes an `rcItems` key, so this is a silent no-op today
- [ ] Point `supabase/functions/batch-tagger/index.ts` at the live `rate_card` table instead of the frozen legacy blob (`ambria-ratecard-v4`) it currently reads

---

## Phase 5 (on hold) — Verify taxonomy/AI-tagging and Deal Check are unaffected

- [ ] Regression-check AI tagging (`aiTagImage` in `StudioApp.jsx` + batch tagger post-Phase-4) still builds vocabulary correctly from `rcItems`
- [ ] Regression-check Deal Check's 3-hop matcher (`getCardSpecsForZone` → `filterImsBySubcategory` → `nameMatchUnique`/AI fallback, `StudioApp.jsx:539-660`) — should need no changes, same fields/join key
- [ ] Confirm `TAG_HIDDEN_SUBS_SK` stays Studio-side (tagging concern, not pricing)

---

## Phase 6 (on hold) — Rollout

- [ ] Stage the IMS admin UI behind a role check or soft-launch to Krati/Ajay/Sudhir first
- [ ] Diff check: sample of open/recent deals, computed totals before/after the scaling-factor multiplier goes live (should be identical while every factor is at 1.0 default)
- [ ] Set real scaling factors per sub-category, flip Studio's `RateCard.jsx` to read-only in production
- [ ] Update `SQL_TO_RUN.md` and `CLAUDE.md` to reflect new ownership

---

## Verification

- After Phase 2: unit-check `resolveRcRate` against current `getElPrice`/`getElPriceForFn`/`calcFullEventCost` outputs for a handful of real elements (florals + non-florals, flat + SMB) to confirm byte-for-byte equivalence before the scaling factor changes anything
- After Phase 3: edit an item/category in the new IMS UI, confirm it appears in Studio's Build/Deal Check views via the existing realtime subscription (no Studio code change needed)
- After Phase 6: with all factors at 1.0, run Deal Check + full event cost calc on a real deal before/after cutover and diff the totals — must match exactly
- Manually exercise: add a rate-card item in the new IMS UI → confirm it shows up in Studio's "+Add element" autocomplete and AI-tagging vocabulary on the next tag run

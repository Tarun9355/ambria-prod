# Rate Card Removal — Impact Analysis

**Scope:** Analysis-only. No code changed. Repo: `C:\GYV\ambria-prod` @ `a76a628` (main, post-pull).

## TL;DR before the details

The proposed direction — IMS becomes the pricing/taxonomy source of truth, Studio drops its Rate Card — inverts more than expected, because the *current* system is not a clean two-tier split:

- **The `rate_card` table is already shared, not Studio-exclusive.** IMS writes into it today (`syncRecipeRatesToStudio` in `IMS.jsx`, florals pricing computed from IMS flower recipes × markup, upserted directly into `rate_card`).
- **IMS's own taxonomy is currently derived FROM the rate card**, not the other way around. `IMS.jsx`'s `studio` memo (explicitly commented "Tier 1.1/1.2 source of truth") feeds Inventory's category dropdowns, a "normalize legacy categories" fixer, the Purchase-order category picker, and the entire Flowers→Recipes matching UI. Reversing the flow means rebuilding all four of those, not just removing a read.
- **Every link between a Studio element/rate-card row and an IMS inventory row is a string match** (name, then sub-category, with one manual `imsAlias` override field) — there is no ID-based join anywhere. This is the single largest structural risk for *any* version of this refactor, independent of which direction the source of truth flows.
- **`calcStructCost`** (truss/masking/platform/carpet/arches/pillars/glass) already doesn't read the Rate Card at all — it uses a separate hardcoded `BASE_RATES` constant. Migrating "the Rate Card" doesn't touch this function; it would need net-new IMS wiring if the goal is one true source.
- Two independent already-broken/dead code paths were found during this audit (noted for completeness, not part of the ask): `EventsTab.jsx`'s `studio?.rcItems` is always `[]` (the `studio` memo never sets that key), and `rate_card_categories` is a fully dead table.

---

## 1. Everywhere the Rate Card is READ in Studio

The Rate Card today is a hybrid: **items** (155 rows) live in a real Postgres table `rate_card` (migrated off Redis; `RC_SK`/`ambria-ratecard-v4` is a dead key except for one stale consumer noted below); **categories** (11 rows) still live in a `settings` blob at key `ambria-rccats-v1` (`RC_SK_CATS`).

### `src/pages/studio/StudioApp.jsx` — the core pricing engine (5,700+ lines)

| Location | Reads | Use | Criticality |
|---|---|---|---|
| `rcIsSMB` (2263) | `inhouseS/M/B`, `inhouseMode` | calc — SMB discriminator | Guarded, degrades silently |
| `getFloralMode` (2292-2299) | `cat`, `floralMode`, `artificialFlat/S/M/B`, `defaultRealPct` | calc | Guarded, degrades to `"ratio"` |
| `getElPrice` (2387-2431) | `rcItems.find` by name, then `cat/inhouseS/M/B/Flat/artificialS/M/B/Flat/unit` | **the** per-element pricer, used everywhere | **Highest risk** — unguarded `.find`, no per-item `name` fallback; throws on malformed/missing `rcItems` |
| `getElPriceForFn` (2442-2480) | same pattern | calc | Same unguarded-find risk |
| `calcFullEventCost` (2493-2553) | `rcItems.find` (2524), `inhouseS/M/B/Flat`, `cat`, `sub` | calc + matching | Same risk; feeds Browse cost badges |
| `computeTruckItems` (830-859) | `rcItems.find`, `rc.sub` | calc + matching | Param itself unguarded |
| `calcFunctionCost` (2667-2736) | `rcItems.find` (2708), `rc.sub` | calc + matching | Unguarded; feeds grand total |
| `calcFnFloralSourcingCost` (2738-2811) | `cat, inhouseS/M/B/Flat, artificialS/M/B/Flat, name, inhouseMode, floralMode, defaultRealPct` | calc | Unguarded; drives Deal Check billed-income split |
| `manpowerPlanForBooking→walk` (2816-2897) | `rcItems.find` (per-item guarded, array itself not) | calc | Miscalc risk only |
| `calcFunctionBreakdown` (2904-2986) | `rcItems.find`, `rc.sub` | calc | Unguarded |
| AI-tagging vocabulary (4267-4457) | `rcItems.filter/.forEach/.find`, `cat, sub, name, unit, inhouseMode` | taxonomy + matching | Unguarded; builds the literal Claude prompt text |
| `rebuildTagKB` (2113) | `(rcItems\|\|[]).filter(...)` | taxonomy | **Guarded** |
| `getCardSpecsForZone` (539-586) | `Array.isArray(rcItems)?...`, `id, imsAlias, sub, cat` | matching → taxonomy | **Fully guarded** — the correct pattern; picks which IMS sub-category Deal Check searches |
| ctx exposure (5538-5598) | exposes `rcItems, setRcItems, saveRC, rcCats, ...` | — | Raw `setRcItems` exposed alongside `saveRC` — a child could mutate state without persisting |

### Studio components

- **`StudioBuild.jsx`** — "+Add element" autocomplete (689-698, 1127-1136): `rcItems.filter(name/cat/sub match)`, `rcCats.find` for labels. Also (707-711, 1144-1148): `getElPrice`/`rcIsSMB`/`rc.unit` gates whether S/M/B size selectors render. Display + calc, mostly graceful.
- **`dealcheck/tabs/DCManpowerTab.jsx`** — line 100, core matcher for every labour calculator (Flowerists/Electricians/Tier2/Tier3): `rcItems.find` by name. Lines 134-437: `cat/sub/name/inhouseMode` for productivity tables and IMS sub-category bucketing. Unmatched elements are silently skipped (undercounts labour, no crash).
- **`dealcheck/DealCheckOverlay.jsx`** — line 333/350-439 duplicates DCManpowerTab's labour math (comment: "MUST match DCManpowerTab" — a duplication risk in itself). Lines 896, 1222, 1344, 1397: floral gating and IMS sub-category selection for Deal Check cards.
- **`manage/ManageLibrary.jsx`** — same autocomplete pattern (831-840); 858-862 does an **exact-case** match (`i.name === el.name`), inconsistent with the `.toLowerCase()` pattern used everywhere else.
- **`dealcheck/tabs/DCFloralsTab.jsx`** — line 81, floral cost breakdown gate; line 62, real/artificial blend ratio.
- **`TransportEditor.jsx`**, **`StudioModals.jsx`**, **`components/studio/CustomItemModal.jsx`**, **`manage/ManageSettings.jsx`** — category/sub-category pickers for transport rules, zone-upload review, custom item entry, and department mapping. All fully guarded (`(rcItems||[])`). `StudioModals.jsx`'s zone-upload review is notably the **one place** an unmatched rate-card item is surfaced to the user as "NEW" instead of silently mispriced.

### Cross-app: IMS reads of the rate card

- **`IMS.jsx`** (195-204, 308-392): loads `rate_card` table + `RC_SK_CATS` settings row; derives a `studio` memo (`subcats, catLabels, subcatsByCat, floralsItems, floralsSubcats`) consumed by four other IMS tabs (below).
- **`EventsTab.jsx`** (447, 479, 834): references `studio?.rcItems` — **dead code**, always `[]`, since the `studio` memo never sets that key. AI event-matching against Studio's rate card is a silent no-op today, independent of this refactor.
- **`AdminSettingsTab.jsx`** (816-820, 837, 1002): renders the "Sub-Categories" mirror tab and the Flowers→Recipes matrix from `studio.floralsItems`.

**Bottom line:** ~15 pricing/matching functions across `StudioApp.jsx` plus every Deal Check tab read the rate card by item **name**, not ID. Most degrade to ₹0/skip on a miss rather than crash — except the core `getElPrice`/`getElPriceForFn`/`calcFullEventCost`/`computeTruckItems`/`calcFunctionCost`/`calcFunctionBreakdown` family, which do unguarded `rcItems.find(...)` and would throw if `rcItems` became `null`/`undefined` during an async IMS-backed load (today it's always seeded synchronously, so this risk is latent, not currently triggered).

---

## 2. Everywhere the Rate Card is WRITTEN in Studio

- **`RateCard.jsx`** — the human admin editor: per-field edit (`rcUpd`), delete (`rcDel`), add (`rcAddItem`), category CRUD (`saveRcCats`), `imsAlias` override field, inhouse/artificial pricing fields (disabled when `item._imsDriven` — i.e., IMS-priced florals are already read-only in this UI), real/artificial/ratio mode selector.
- **`StudioApp.jsx`** — persistence layer: `rowToRcItem`/`rcItemToRow`/`loadRcRows` (942-969); boot-seed into Supabase if table empty (1766-1799); `saveRC` (1924-1938) — **optimistic local update with no rollback on Supabase error** (toast-only, so local state and DB can silently diverge on a failed save); `saveRcCats` (1939); realtime subscription (1994-2007) patches local state on any external change — this is the channel through which IMS's writes (below) propagate live into Studio.
- **`src/lib/studio/constants.js`** — `RC_UNITS`, `RC_CATS_DEFAULT`, `RC_D` (155-item default seed, doubles as initial state and one-time DB seed).
- **IMS's own direct write path** — `IMS.jsx` `syncRecipeRatesToStudio` (211-290): computes florals pricing from IMS flower recipes × markup, `supabase.from("rate_card").upsert(...)` directly, bypassing every Studio save function. Runs on a 2.5s debounce automatically, plus a manual "📤 Sync to Studio" button. **This is the clearest existing precedent that the boundary between "Studio owns pricing" and "IMS owns pricing" is already blurred for one category (florals).**
- **Infra**: `supabase/migrations/001_initial_schema.sql` (rate_card, dead rate_card_categories table); `scripts/migrate.mjs` (one-time legacy blob→table migration, also kept the raw blob alive for one consumer below); `SQL_TO_RUN.md` (stale doc — says "60 rate items," current count is 155, suggesting the doc predates catalogue growth).

---

## 3. Everywhere IMS currently READS the Rate Card

Confirmed: it's much broader than the Sub-Categories tab alone.

1. **`IMS.jsx`** `studio` memo (133-160) — the central derivation point, built from `rate_card` table + `ambria-rccats-v1` settings.
2. **`AdminSettingsTab.jsx`** — "📂 Sub-Categories" viewer (explicitly commented "read-only mirror"), labour-tier batch pickers, Heavy Element Add-on pickers, and the **Flowers→Recipes** panel (keyed off `studio.floralsItems`/`floralsSubcats`) — which is also where IMS's write-back (`syncRecipeRatesToStudio`) is triggered from.
3. **`InventoryTab.jsx`** — treats `studio.catLabels`/`subcatsByCat`/`subcats` as **the canonical taxonomy for inventory rows**: populates Category/Sub-Category dropdowns, the sub-category filter strip, and a "normalize categories" one-click fixer that rewrites old inventory spellings to match current rate-card labels. Comment in code literally says *"Studio sub-categories (Tier 1.1 source of truth)."*
4. **`PurchaseTab.jsx`** — Category dropdown on purchase-order forms.
5. **`EventsTab.jsx`** — `rc.cat==="florals"` checks and inventory `cat`/`subCat` display (partially dead per §1).
6. A separate `categories` SQL table is fetched once into IMS state but never written back — vestigial, not a live source.

**Reframing for the proposed refactor:** IMS is not a passive "read-only mirror" today — it's an active *downstream consumer* of the rate card for its own inventory taxonomy, plus an active *upstream writer* for florals pricing. The refactor doesn't just need to stop IMS reading Studio; it needs to replace four existing IMS features (`InventoryTab` categories, `PurchaseTab` categories, `AdminSettingsTab` sub-categories viewer, Flowers→Recipes matching) that currently depend on the very thing being removed.

---

## 4. All pricing helper functions in Studio

All in `StudioApp.jsx` except where noted. **`calcFromElementCard` does not exist anywhere in the codebase** — a repo-wide search found nothing by that name; likely a stale/planned reference (the closest real functions are `getElPrice`/`getElPriceForFn`).

| Function | Rate-card inputs needed | Change needed for IMS-sourced pricing | Can it come from IMS? |
|---|---|---|---|
| `calcElsCost` (2433) | none directly (delegates to `getElPrice`) | none — pure reducer | n/a |
| `getElPrice` (2387) | name match, `cat`, `unit`, `inhouseS/M/B/Flat`, `artificialS/M/B/Flat` | **the** core function to rewrite — swap rate-source for IMS sub-category + scaling factor | S/M/B: **only if IMS adds size tiers**; flat price alone → graceful degrade, not a crash |
| `calcElsCostForFn` (2482) | none directly (delegates to `getElPriceForFn`) | none | n/a |
| `getElPriceForFn` (2442) | ~90% duplicate of `getElPrice` | same rewrite, duplicated — **should be unified with `getElPrice` during migration, not patched twice** | same S/M/B caveat |
| `calcPhotoCost` (2486) | none directly | none | n/a |
| `calcFunctionCost` (2667) | delegates to `getElPriceForFn`, plus its own `rc.sub` lookup for truck-capacity matching | truck-matching key needs re-pointing to IMS sub-category naming | sub-category concept must exist in IMS (it will, by design) |
| `calcFunctionBreakdown` (2904) | same as above | same | same |
| `calcFullEventCost` (2493) | **third independent copy** of the SMB branch (inline, not delegated) — only reads real/inhouse rate, not artificial, for non-florals | should be consolidated into the same shared helper as `getElPrice`/`getElPriceForFn` rather than fixed a third time | same S/M/B caveat |
| `calcStructCost` (210, `taxonomy.js:71` `BASE_RATES`) | **none — doesn't read the rate card at all.** Uses hardcoded `BASE_RATES` for truss/masking/platform/carpet/arches/pillars/glass | Rate Card items *look* like they'd cover these (T01 Box Truss, M01-M04 masking, etc.) but editing them today has **zero effect** on this function | If the goal is one true source, this needs **new** IMS wiring — it's currently neither rate-card- nor IMS-sourced |

**Other pricing functions found (not in the original list):** `calcFnFloralSourcingCost` (2738) — floral *procurement* cost (mandi + artificial), already partly IMS-sourced via flower patterns/mandi catalogue, cleanly separable from the *billed* rate; `calcElCost` (`ManageLibrary.jsx:1827`, trivial wrapper); IMS-sourced precedents in `src/lib/studio/pricing.js` (`calcZoneTrussPreview`, `calcZoneFabric`, `calcFabricAllocCost`, `calcZoneCarpet`, etc.) — these already take an IMS stock array instead of a rate card with flat per-unit rates and **no S/M/B branching**, and are the closest existing template for what an IMS-sourced pricing function should look like.

**S/M/B answer:** IMS inventory has **no size-tiered pricing** — confirmed in §7. `getElPrice`, `getElPriceForFn`, and `calcFullEventCost` are the only functions that branch on it, and all three degrade gracefully to flat pricing (never crash) if the fields are simply absent — the user-visible effect is that S/M/B size chips on floral/prop elements stop changing price.

---

## 5. Taxonomy dependencies

The rate card's `cat`/`sub`/`name` fields are vocabulary, not just prices, in far more places than tagging alone.

- **AI tagging (client `aiTagImage` in `StudioApp.jsx` + server `batch-tagger/index.ts` cron)** — structurally central, not incidental: the prompt is built from `rcItems` ("use EXACT names from this Rate Card list"), and even Claude's freeform output gets fuzzy-matched and rewritten back onto the canonical rate-card name post-hoc. A separate hide-flag (`TAG_HIDDEN_SUBS_SK`) stores `"cat::sub"` keys to exclude from AI vocabulary. **Hard-break** if rate card is removed — needs a full vocabulary rebuild from IMS names, and the server-side batch tagger reads a *stale, frozen* legacy blob already (last updated by a one-time migration script) — a pre-existing staleness bug the refactor should fix regardless.
- **"Palette" feature** — unrelated. It's a color/mood catalogue already sourced from IMS (`imsPaletteCatalogue`), independent of rate-card categories. **Unaffected.**
- **Templates** — zone-type/tier/function presets, no rate-card item/category references. **Unaffected.**
- **Manual "+Add element" autocompletes** (Library, Build, StudioModals, CustomItemModal) — all filter `rcItems`/`rcCats` directly. **Hard-break**, need a replacement item list.
- **Hardcoded category-string checks** (`rc.cat === "florals"` / `"lighting"`, ~10 call sites across `StudioApp.jsx`, `DCFloralsTab.jsx`, `DealCheckOverlay.jsx`) — a magic-string dependency on exact rate-card category spelling. **Silent hard-break** risk: if IMS's category id/casing differs even slightly, calculations silently return 0 rather than erroring.
- **Department attribution (`catToDept`)** — heuristic keyword-matching with an admin override map. **Soft-degrade** — tolerant of some renaming, but exact-match reliance still risks silent miscosting.
- **`imsAlias` field (`itemImsSubcat` helper)** — a hand-maintained alias table bridging rate-card sub-categories to IMS sub-categories for Deal Check matching. This is proof the two taxonomies **already diverge today** and are reconciled manually. **Hard-break** — removing the rate card removes both ends of the bridge it maintains.
- **IMS's own taxonomy is currently sourced FROM the rate card** (`IMS.jsx` `studio` memo, feeding `InventoryTab` categories/normalizer, `PurchaseTab` categories, Flowers→Recipes matching) — this is the **reverse** of the proposed direction. **Hard-break + rebuild**, not just a removal.

---

## 6. Deal Check specifically

Three chained string-match hops, no ID join anywhere:

1. **Studio element → rate-card item** by exact case-insensitive name (`getCardSpecsForZone`, `StudioApp.jsx:549` — notably *not* trimmed, unlike a sibling helper 10 lines away that is; a latent inconsistency).
2. **Rate-card item → IMS sub-category string**: `rc.imsAlias || rc.sub` (`StudioApp.jsx:553`) scopes the ~823-row inventory table to a sub-category. If nothing matches, the "scope" **silently falls back to the entire inventory table** — a taxonomy typo degrades to "search everything" rather than failing loud.
3. **Within the scoped list → one specific row**, tried in order: a deal-local manual pin (`el.imsId` — the only real ID-based link anywhere in the system, but scoped to one client's one element), a "taught" photo-URL-keyed cache (also keyed by rate-card *name string*, so renaming a rate-card item invalidates all learned mappings for it), exact name match, then a Claude vision/text AI fallback that picks from the scoped candidates or returns no match.

**No-match handling:** explicit and visible — a red "⚠ no match" chip, a placeholder card with "No IMS match — pick from alternatives below or browse subcategory," and the salesperson can manually select from the rest of the sub-category or open a full browse view. This never auto-creates inventory; it just asks a human to pick.

**Custom/production items with no IMS counterpart:** a separate escape hatch — `CustomItemModal` ("🏭 Production" / "🛒 Buying" buttons) — pulls its own Category/Sub-Category dropdown from `rcCats`/`rcItems` (not IMS), does a fuzzy reference-pricing lookup against IMS by category+dimension similarity, and falls back to fully manual pricing if nothing matches ("No items with this subcategory in inventory. Enter price manually below."). These are saved separately from matched cards and routed to a department via `catToDept`, never touching physical availability/blocking.

**If Rate Card is removed and Studio elements become IMS items directly:** hops 1-2 collapse (an element *is* an inventory reference, no name-matching needed) — the AI-vision fallback and "browse subcategory" UX still matter for "any item in subcategory X" style design intent, but the name-string matching and the entire `imsAlias` reconciliation layer become dead code. `CustomItemModal`'s taxonomy source needs to switch from `rcCats`/`rcItems` to IMS categories directly — a smaller fix since IMS already has its own category data.

---

## 7. IMS side — capability gaps

**Confirmed `inventory` schema** (`001_initial_schema.sql`):
```
id, code, name, cat, sub_cat, item_class, type, unit,
qty, blocked, price, cost, breakage_pct,
location, img, photo_urls[], dims(jsonb), base_colour, paint_cost,
is_kit, sub_items(jsonb), notes, flags(jsonb), created_at, updated_at, updated_by
```

- **Per-item pricing mode:** flat only — one `price` column. **No S/M/B tiering exists on inventory today.** Rate card's `inhouse_flat/s/m/b` + `out_s/m/b` structure has no IMS equivalent.
- **Sub-category-level pricing:** none. Pricing is per-item (`price` column), never per-sub-category.
- **Scaling-factor concept:** **does not exist yet, needs to be added.** The closest analogs are all *global or date-scoped* multipliers applied uniformly to every item's `price` — `settings.datePricing.categories[key].multiplier` (heavy_saya/competition/non_saya, 1.4/1.0/0.75), plus assorted global scalars (`eventTypeMultipliers`, `sayaMultiplier`, `situationalMultipliers`, `mandiPriceMultipliers`). None are scoped to a sub-category the way the proposal requires ("one scaling factor per sub-category, applied to all items inside it") — this is genuinely new schema and logic, not a repurposing of an existing field.
- **Category/sub-category on inventory:** `cat`/`sub_cat` are plain TEXT columns, kept in sync with the rate-card taxonomy **by convention and a manual "normalize" button**, not a DB foreign key — they can and do drift until someone clicks fix.
- **Row/category counts:** cannot be fully verified from code. The 155-item rate-card seed is confirmed in `src/lib/studio/constants.js`; the live `inventory` row count (user states ~823, CLAUDE.md says "600+") is **not derivable from source** — the table is created empty and filled via the app UI with no seed data, so this needs a live `SELECT count(*)` query, not code inspection.
- **Coverage overlap is unknown from code** — there's no code-level answer to "how many of the 155 rate-card items have a matching inventory row." This needs a live query (e.g. join on name/category) before any migration plan can be finalized. Flag this as the first concrete next step if you proceed.

---

## 8. Migration risks

- **Rate-card items with no matching IMS inventory row** (labour categories, transport/truck line items, some structural categories priced via `BASE_RATES` rather than the rate card at all, purely commercial line items) have no natural home in an "IMS = pricing source" world unless IMS grows non-physical pricing categories. These are likely a non-trivial fraction of the 155 items — needs a live-data check, not guessable from code.
- **IMS inventory items with no rate-card equivalent today** — becoming automatically sellable the moment IMS becomes the pricing source is itself a business decision (do all 823 items have a sane customer-facing price and category story, or are some purely operational/back-of-house — packing materials, spares, etc. — that should never appear in Studio's element picker?). This needs a scope decision, not just a technical mapping.
- **Existing deals/EOs already reference rate-card items by name string**, not ID (confirmed in §1/§6 — every read is `rcItems.find(name match)`). Old deals/photos' `zoneElements` are a **name-string snapshot** taken at build time (confirmed in §5, `StudioSummary.jsx` renders from the deal's own copy, not a live rate-card lookup) — so already-quoted/exported deals are naturally insulated from a taxonomy swap. Deals still *open* in Build/Deal Check at the moment of migration are the risk window: their live element list re-resolves against `rcItems` on every render, so a rate-card rename/removal happening mid-edit would need either a migration script that rewrites in-flight deal element names to the new IMS naming, or a compatibility shim during cutover.
- **Historical pricing preservation** — no versioning exists today. `getElPrice` always reads the *current* `rcItems` value; nothing snapshots "price at time of quote" beyond whatever gets baked into `zoneElements`/exported PDFs at build time. If a sub-category's scaling factor changes tomorrow, any deal still being actively edited (not yet exported/locked) would reprice live under the current architecture — this is already true today for rate-card price edits, so the "retroactive repricing" risk is not new, but the proposal's "scaling factor" being a single dial (versus one price per item) makes an accidental global repricing easier to trigger by mistake (one factor change moves every item in a sub-category at once, whereas today someone has to edit 155 individual rows).
- **Silent taxonomy-string mismatches** are the dominant risk class throughout the whole system (§1, §5, §6) — nothing errors loudly on a category/sub-category rename; things quietly zero out, mis-route costs, or fall back to "search everything." Any migration plan needs an explicit reconciliation/audit pass (ideally automated, comparing old vs. new taxonomy strings) rather than relying on manual QA to catch drift.
- **Duplicated pricing logic** (`getElPrice`/`getElPriceForFn`/`calcFullEventCost` are three ~90%-overlapping implementations of the same SMB-branch pricing resolution) means any rate-source change has to be made correctly in three places today — a pre-existing maintenance risk this migration would either have to fix (consolidate first) or triple its own workload by patching all three independently.

---

## 9. Estimated size of the refactor

Based on concrete file/function counts surfaced above (full migration as described — IMS becomes sole source, Studio's rate card removed entirely):

- **Core pricing engine rewrite:** `getElPrice`, `getElPriceForFn`, `calcFullEventCost` (consolidate + re-source), `calcFunctionCost`, `calcFunctionBreakdown`, `computeTruckItems`, `calcFnFloralSourcingCost` — ~7 functions, all in `StudioApp.jsx`, tightly coupled (~2,500 lines of that file touch rate-card fields somewhere).
- **New IMS schema/logic:** sub-category table + scaling-factor field (net new — doesn't exist), migration to backfill it, plus wiring `calcStructCost` to something IMS-sourced if the "one true source" goal includes structural items (currently neither rate-card- nor IMS-sourced).
- **Taxonomy/vocabulary rebuild:** AI-tagging prompt + schema (client `aiTagImage` + server `batch-tagger/index.ts`, two places), fuzzy-rewrite match list, `TAG_HIDDEN_SUBS_SK` exclusion keys, every "+Add element" autocomplete (4 files), `CustomItemModal` category picker, ~10 hardcoded `cat==="florals"/"lighting"` string checks, `catToDept` mapping.
- **IMS-side reversal:** `InventoryTab.jsx` categories + legacy-normalizer (currently sourced from rate card, needs to become the source instead), `PurchaseTab.jsx` category dropdown, `AdminSettingsTab.jsx` Sub-Categories viewer + Flowers→Recipes matching, `EventsTab.jsx` display logic.
- **Deal Check matching rewrite:** collapse the 3-hop string-match chain in `getCardSpecsForZone`/`filterImsBySubcategory`/`nameMatchUnique`, retire the `imsAlias` bridge (or relocate it), update all Deal Check tabs (`DCManpowerTab`, `DCFloralsTab`, `DealCheckOverlay`) that independently re-derive `rc = rcItems.find(...)`.
- **Admin UI removal/replacement:** `RateCard.jsx` (retire or repurpose as an IMS pricing-mirror admin view), `saveRC`/`saveRcCats`/boot-seed logic in `StudioApp.jsx`.

**Rough count:** ~20-25 files touched (Studio: `StudioApp.jsx`, `RateCard.jsx`, `StudioBuild.jsx`, `StudioModals.jsx`, `ManageLibrary.jsx`, `ManageSettings.jsx`, `TransportEditor.jsx`, `CustomItemModal.jsx`, 3 Deal Check tab files + overlay; IMS: `IMS.jsx`, `InventoryTab.jsx`, `PurchaseTab.jsx`, `AdminSettingsTab.jsx`, `EventsTab.jsx`; infra: migration SQL, `batch-tagger/index.ts`, `scripts/migrate.mjs`), roughly 35-45 individual functions/call sites, likely 1,500-2,500 lines net changed (a mix of rewrites and deletions, not all additions).

**Hour estimate:** this is squarely in **multi-week** territory for one engineer, not a sprint task — realistically **3-5 weeks** including a data-reconciliation pass (§7/§8 unknowns need a live-data audit before design can even be finalized), a taxonomy migration/backfill, the core pricing rewrite, IMS-side taxonomy reversal, Deal Check rework, and a cutover/testing period given how much of this is silent-failure-prone string matching rather than typed/validated code. That's a ballpark from the *shape* of the change, not a committed estimate — the actual number depends heavily on the §7/§8 unknowns (item-to-inventory coverage %, how many rate-card items have no physical counterpart) that can't be resolved from code alone.

---

## 10. Alternative approaches

**A. Keep the Rate Card in Studio, let IMS drive a scaling factor (smallest change).**
Add a per-sub-category scaling factor in IMS; Studio's rate card keeps its own base prices but multiplies by the IMS factor at read time (in `getElPrice` et al.). Everything in §1-§6 stays as-is — no taxonomy rebuild, no Deal Check rework, no AI-tagging vocabulary change. Only new work: an IMS scaling-factor UI/schema and one multiplication in the pricing functions. This directly extends the *existing* precedent (`syncRecipeRatesToStudio` already does something similar for florals — IMS-computed rates flowing into the shared `rate_card` table) rather than fighting it.

**B. Split by category: IMS owns physical/structural item pricing, Studio keeps labour/transport/custom.**
Given `calcStructCost` already doesn't use the rate card (hardcoded `BASE_RATES`) and floral pricing is already partially IMS-driven, a natural boundary already exists: physical/structural/floral categories move to IMS-sourced pricing (formalizing what's half-true today), while labour (dihari-scheme driven, already separate — see `ManpowerTab`/`DCManpowerTab`), transport (truck-capacity rules, already its own subsystem), and custom/production items (already routed through `CustomItemModal`, not the rate card's core price fields) stay in a lighter-weight Studio-side config. Meaningfully smaller than a full migration since it follows lines the codebase has already drawn.

**C. Full migration as originally proposed.**
IMS becomes sole source for pricing + taxonomy; Rate Card removed. Highest risk and cost (§9), but does eliminate the dual-maintenance/drift problem (`imsAlias`, category-string mismatches, the IMS-reads-Studio-reads-IMS circularity for florals) permanently rather than managing it.

**D. Recommendation: start with A, evaluate B once live-data gaps (§7/§8) are resolved.**
Option A is low-risk, ships fast, and directly tests whether "scaling factor per sub-category" actually produces the pricing behavior wanted, without touching taxonomy, tagging, or Deal Check at all. If it proves out, B is the natural next step for the categories where IMS is already the more truthful source (structural, floral). Full migration (C) should only be considered after a live-data audit answers: what % of the 155 rate-card items have an IMS inventory counterpart, and what % of ~823 inventory rows are customer-facing vs. purely operational — those two numbers determine whether C is a clean cutover or a long tail of edge cases.

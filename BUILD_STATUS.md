# Ambria rebuild — build status & resume guide

Last updated by the autonomous build run. Read this first when resuming.

## TL;DR
- **Stack:** Vite + React + react-router (HashRouter) + Tailwind v4 + Supabase. Deploys to GitHub Pages (`/ambria-prod/`) via GitHub Actions.
- **Auth:** unified `/login` (username/password → `users` table), role redirect (Sales→/studio, else→/ims), session in `ambria-auth`. `/studio` and `/ims` are protected routes.
- **IMS:** 8 of 9 top-level tabs functional. **Studio:** foundation shipped (shell + event cards).
- **Before anything works in a fresh DB:** run the SQL in **`SQL_TO_RUN.md`** and deploy the Edge Functions.

## Architecture decisions (locked)
- **Adapters** map each reference "superset"/blob object ⇄ Supabase columns (`src/lib/inventory/adapter.js`, and inline `rowToX/xToRow` in `src/pages/ims/IMS.jsx`). Row-level upserts via a diff (never re-save whole tables).
- **`settings`** is a key→value table; the shell loads it into one object and persists changed keys. `SETTINGS_DEFAULTS` (`src/lib/ims/constants.js`) seeds buffer/min-profit, datePricing, synonyms, mandi catalogue/categories/multipliers so panels don't crash pre-config.
- **Mandi catalogue + flower data** live inside `settings` (faithful to the reference Redis blob), not the `mandi_flowers` table.
- **LMS/ERP:** browser never paginates. The `lms` Edge Function (`op:"sync"`) paginates server-side → `lms_contracts` table; client reads the table instantly; sync runs on the Calendar **🔄 Sync LMS** button or when cache >30 min stale. No auth token (public ERP host). **Season categories** auto-sync via the `season` Edge Function (needs `SEASON_EXPORT_KEY`).
- **AI** (Inventory photo-scan, future Events element-match) proxies via the `anthropic` Edge Function (needs `ANTHROPIC_API_KEY`).
- **Rebuild rule:** match the reference apps exactly; only Redis→Supabase, single-file→multi-file, polling→Realtime, inline-styles→Tailwind. Deferred/placeholdered panels are clearly labelled in-UI.

## Shipped (all committed + pushed to origin/main)
| Area | Status |
|---|---|
| Vite/Tailwind/Supabase scaffold + GH Pages deploy | ✅ |
| Auth (unified login, roles, protected routes) | ✅ |
| IMS — Dashboard | ✅ |
| IMS — Inventory (full: filters, table, all modals, kits, photo-scan*, Realtime) | ✅ |
| IMS — Supply → Purchase (Production sub-tab placeholder) | ✅ |
| IMS — Planning → Paint + Boxes (Manpower/Truss/configs placeholder) | ✅ |
| IMS — Finance → Event P&L + Company P&L + Overheads | ✅ |
| IMS — Calendar + LMS contract sync (DB-cached) + Season categories | ✅ |
| IMS — Admin → Vendors + Settings(Supervisors / Sub-Cats viewer / Synonyms) | ✅ |
| IMS — Flowers → Mandi Prices (full) | ✅ |
| Studio — app foundation (shell, Studio/Manage nav, live event cards) | ✅ |
| Studio — Manage → **Pricing / Rate Card** editor (`rate_card`, seeded RC_D) | ✅ |
| Cross-app — IMS `studio` prop derived from shared `rate_card` (Sub-Cats viewer + Inventory cats live) | ✅ |
| Edge Functions written: `anthropic`, `lms`, `season` | ✅ (deploy pending) |

\* photo-scan needs the `anthropic` function deployed.

## Remaining work (resume here, in suggested order)
0. ~~Studio → Pricing / Rate Card~~ ✅ DONE. ~~IMS Flowers → Recipes~~ ✅ DONE (Flowers tab fully live; recipe→Studio sync button inert until cross-app write wired). Deferred: floral pricing-mode pills + IMS-driven lock on rate items.
1. **(was 1) IMS Flowers Recipes — DONE.** Next → (`activePanel==="patterns"`, IMS ref 6818–7321). Studio-gated (needs rate-card florals). Helpers: resolveMandiFlower, FlowerPicker, computePatternSizeCost, effectiveMarkup, studioUnitLabel.
3. **IMS keystone slice 4** — Workforce/Labour Tiers (ref 5649–6028), Venue Min (6028–6271), Dihari (DihariTimingsPanel 7906). Needs porting rest of `INIT_SETTINGS` (labourTiers, manpowerMatrix, venueMinLabour, thresholdOutdoor, venues, dihariSchemes/defaultWindowsByPhase, colourCatalogue, etc.). Unblocks Manpower.
4. **IMS keystone slice 5** — Truss & Batta (7410) + Fabric Stock (7726) config panels. Unblocks Planning configs + Truss tab.
5. **IMS Phase 10** — Manpower (ManpowerTab 3058–4400), Truss (TrussPlanningTab 14470 + allocation engine), Production (ProductionTab 12234–13035). Large; Truss needs the Studio-shared allocation engine.
6. **IMS Phase 11 — Events** (EventsTab 15243–16715) — the hub. Needs purchase/blocks/truss/manpower + Claude Vision element-match + contract cross-ref (wire `crossReferenceContracts` into the `lms` sync once `event_orders` is populated).
7. **Studio tabs** — deal builder (zones/elements/pricing/presentation — the bulk of App_latest.jsx), Library (`library` + Cloudinary + AI tagging), Settings (venues/zones/tags/clients/calendar).

## Build pattern (proven)
read reference region → transcribe faithfully to a per-tab file under `src/pages/ims/` (or `src/pages/`) → add any settings defaults/adapters → wire into the shell (`IMS.jsx` / `Studio.jsx`) → `npm run build` → backend smoke test via curl → commit + push.

## Key files
- `src/pages/ims/IMS.jsx` — IMS shell: data load, row-level setters, Realtime, tab routing.
- `src/pages/Studio.jsx` — Studio shell.
- `src/lib/ims/constants.js` — SETTINGS_DEFAULTS + shared constants/seeds.
- `src/lib/inventory/adapter.js` — inventory camel↔snake adapter + diff.
- `src/lib/ims/lms.js` — LMS client (sync trigger, cached read, season, date categories).
- `supabase/functions/{lms,season,anthropic}/` — Edge Function proxies.
- `reference/IMS_App_latest.jsx` (18.8k) + `reference/App_latest.jsx` (Studio, 17.9k) — sources of truth (gitignored).

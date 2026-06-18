# Ambria V2 — Build Status

Faithful rebuild of the two production apps (Studio + IMS) as one Vite + React +
Supabase SPA. **Status: feature-complete** for everything that doesn't require a
backend deploy / secret. Remaining gaps are all gated on Edge Functions + secrets
(see §"Backend ops you must run").

---

## ✅ IMS — 100% complete (all 9 tabs)
Dashboard · Events (deck upload → Claude Vision element-match → inventory match →
block reservations → status lifecycle) · Inventory (realtime) · Calendar (LMS
contracts + season overlay) · Planning (Manpower tier engine · Truss allocation
viewer/override/simulator · Paint · Boxes · Truss&Batta + Fabric Stock config) ·
Supply (Purchase · Production kanban + AI compare) · Flowers (Mandi · Recipes) ·
Finance (P&L · Company P&L · Overheads) · Admin (**Users & Roles** + per-user app
access · Vendors · Settings). Sold events auto-drive `trussAlloc` (truss orchestrator).

## ✅ Studio — feature-complete
- **Deal builder**: EventInfo → Browse → Build → Summary; pricing engine; PDF/PPT
  export; paint/fabric/custom-item/video/zone-upload modals all wired.
- **Deal Check** (Studio→IMS bridge): all 9 tabs (Inventory, Florals, Manpower, Truss,
  Production, Buying, Transport, Status, GYV) + the §7.9 generate/match engine.
  Truss soft-holds written into the `truss_allocations` table (merged by clientId,
  IMS hard events preserved) → IMS promotes on SOLD.
- **Manage**: Library (images + AI tagging + bulk URL add) · Pricing (Rate Card) ·
  Settings (venues / tags / clients / calendar+LMS / palettes / zones).
- **§25 LMS lead lookup** on the event page (cache-backed).

## ✅ Cross-app
Per-user `apps` access (editable in IMS Admin → Users) + header switcher (🎨 Studio ⇄
🛠️ IMS), route-gated. Role-derived defaults work without the optional `apps` column.

## Faithfulness / allowed transforms only
Redis → Supabase (`settings` table + tables + KV shim) · Vercel `/api/*` → Supabase
Edge Functions (`callClaudeStreaming`) · single-file → multi-file · polling → realtime
(IMS) · inline styles preserved verbatim for Studio (pixel fidelity); IMS uses Tailwind.

---

## Backend ops you must run (the only remaining work)

Gated on credentials/deploys only you can do. The code paths are faithful and degrade
gracefully until then.

| Feature (currently degraded) | What unlocks it |
|---|---|
| **All AI** — Inventory photo-scan, Production compare, Events deck-scan, Deal Check photo-match, Library/zone AI tagging | `supabase functions deploy anthropic` + `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` (function already written) |
| **Studio Browse video catalog** + Library Videos subsystem | A `youtube` Edge Function proxying the YouTube Data API (playlist `PLugzG6u3RGd4VBBcIQfWPAVf-1LpSKlEp`) with a `YT_API_KEY` secret. **Not yet written** — needs the YouTube API contract; client Videos UI is placeholdered. |
| **Library Cloudinary browser** (listing existing cloud images) | A signed `cloudinary` Edge Function (Admin API). Photo **uploads already work** client-side (unsigned preset `z3nlj6cx`) — only the browse-existing view is placeholdered. |

Already deployed/working: `lms` (✅), `season` (✅). Optional SQL: migration `003`
(`users.apps text[]`) for explicit per-user grants — role defaults work without it.

After deploying `anthropic`, smoke-test the Deal Check flow end-to-end: open a deal →
Generate (populates cards + writes soft-holds) → confirm the soft truss-hold appears in
IMS → Planning → Truss for that date, and promotes to hard when the EO is marked SOLD.

---

## Project structure (key paths)
- `src/pages/ims/` — IMS shell (`IMS.jsx`) + tabs
- `src/pages/studio/StudioApp.jsx` — Studio shell (state + pricing engine + `ctx`)
- `src/pages/studio/views/` — deal-builder views (EventInfo/Browse/Build/Summary)
- `src/pages/studio/dealcheck/` — Deal Check overlay + `tabs/`
- `src/pages/studio/manage/` — ManageLibrary, ManageSettings
- `src/components/studio/` — leaf modals (ColourPicker/AllocationPicker/CustomItemModal/LazyYT)
- `src/lib/studio/` — pricing, taxonomy, venues, styles, keys, constants
- `src/lib/ims/` — constants, helpers, flowerHelpers, kv, lms, pdf, trussEngine
- `supabase/functions/` — anthropic, lms, season (+ youtube/cloudinary to add)
- `supabase/migrations/` — 001 schema, 002 lms_contracts, 003 user apps

# Venues → stable IDs + IMS ownership: Phased Migration Plan

Living tracking doc. Mirrors the shape of `RATE_CARD_MIGRATION_PLAN.md` (a completed migration of the same kind: move admin ownership from Studio to IMS).

## Status: Phases 1 and 2 done. Studio's Venue Management screen is deleted.

## Context

Studio used to own the in-house/outdoor venue catalogue (`ManageSettings.jsx`'s "Venue Management" screen), persisted as one JSON blob under the settings key `ambria-v13-venues`. Every consumer — Studio's own Build/Deal Check/transport/min-labour code, and IMS's `FixedVenuesEditor.jsx` — matched venues by a bare **name string**, with no stable identity behind it.

**The problem this exists to fix:** IMS's Fixed Venues screen (standing inventory + its per-item discount, per-venue min labour/crew) links to a venue by name. If that venue was renamed, the Fixed Venue entry didn't follow — it kept showing (and matching against) the old name, silently going stale.

**Why not just detect the rename?** From an external observer watching a flat name list, a rename is indistinguishable from "old venue deleted, new venue added" — no reliable signal says two different-looking snapshots are the same physical property. Solving this needs the venue to carry an identity that survives a name change: a stable `id`.

**Decision made:** venues get a stable `id` at the property level (a "property" = a parent group like Exotica/Manaktala/Pushpanjali/Restro — the level Fixed Venues actually operates at). IMS becomes the sole place the ENTIRE venue catalogue — in-house properties, their sub-venues, AND outdoor venues — is added/renamed/deleted, mirroring the Rate Card precedent. Studio's Venue Management screen is retired entirely, not left as a read-only mirror.

---

## Phase 1 ✅ done — Stable IDs + IMS "Venues" editor + Fixed Venues linked by id

- [x] **Data model, additive only.** `migrateVenues()` (`src/lib/ims/venueProperties.js`, shared by both IMS panels) stamps a stable `id` on every `inhouse[]` (sub-venue) row and builds/refreshes a top-level `properties: [{id, name, manager, icon}]` array — one row per distinct `.parent` value — plus a `propertyId` field on every sub-venue row pointing at it. `.parent` itself is untouched; every existing Studio consumer (Build, Deal Check, `allInhouseGroups`, `venueParents`, transport, min-labour, Browse's venue filter…) keeps reading it exactly as before. Runs (idempotently, write-back only if it actually changed something) from both `VenuesEditor.jsx` and `FixedVenuesEditor.jsx`'s own load effects.
- [x] **New IMS panel** — Admin → Settings → 🌆 Venues (`src/pages/ims/VenuesEditor.jsx`). Add/rename/delete a property; add/rename/delete a sub-venue under one. A property rename updates `properties[].name` (id stays constant), cascades `.parent` on its sub-venues, and cascades `.name` on any `settings.fixedVenues[]` entry linked to it by `propertyId` — `fixedVenueFor` (the billing-time matcher) still compares by name string, not id, so the linked entry's own name has to follow the rename too, not just what the screen displays.
- [x] **Fixed Venues** (`FixedVenuesEditor.jsx`) links each configured venue by `propertyId`. One-time backfill: any existing entry without a `propertyId` is matched against `properties[]` by normalized name (`normVenueName` — same normalization `fixedVenueFor` uses) and linked; an unmatched name is left exactly as it was, never hidden or altered. Once linked, the tab's name is read live from `properties[]` by id.

## Phase 2 ✅ done — Ported the rename cascade + full outdoor venue editor

- [x] **Outdoor venues** added to `VenuesEditor.jsx` — same shape (`{name, empanelled}`) Studio always used, no stable-id linking needed (outdoor venues were never Fixed-Venue-eligible). Add / rename / toggle empanelled / delete, with the same empanelled-chips + searchable-list layout Studio's screen had.
- [x] **Rename cascade ported.** Every rename in the new panel (property, sub-venue, or outdoor) now also updates:
  - **video tags** — `video_tags` is a real table with a flat `venue` column; a single `UPDATE ... WHERE venue = old` does it, no need to go through Studio's in-memory tag map at all.
  - **transport tier** — the `RC_SK_TR` settings row (`{venues: [...], ...}`), matched case-insensitively exactly as `transportCalc` does when pricing a quote — read/written directly via Supabase, the same way `ImsTransportPanel.jsx` already does for this row.
  - **library photos** — a real table, `tags.venue`, paged and rewritten the same way Studio's old `renameVenueEverywhere` did it.
  - Past events (`client_ledger`/`event_orders`) are deliberately excluded, same as before — they record where a job actually happened, and rewriting that would falsify history.
- [x] **Studio's "Venue Management" screen deleted entirely** (`ManageSettings.jsx`): the whole `AdminVenues` component (in-house display, outdoor editor, `renameVenueEverywhere`/`renameSummary`, `addOutdoor`/`removeOutdoor`/`updateOutdoor`) is gone, along with its settings-nav tab and the now-dead `newIH`/`editIH`/`newOD`/`editOD`/`adminOdSearch` state usage in that file. Studio no longer has any venue-admin UI — IMS → Admin → Settings → 🌆 Venues is the only one, for the whole catalogue.
- [x] Verified: `npx vite build`, `npm run lint` (0 errors, 38 warnings — baseline, unchanged), `npm run test` (59/59) all clean after every edit.
- [ ] **Not yet done — needs you, not code:** click through the real app once deployed — confirm the 4 in-house properties and their sub-venues, plus the outdoor venue list (27+ venues per your screenshot), all appear correctly in the new panel; confirm every existing Fixed Venue tab still shows its standing items/qty/discounts/crew unchanged; try one rename (property, sub-venue, and outdoor) and confirm Fixed Venues / video tags / transport tier / library photos all pick it up.

## Phase 3 (not started, longer-term, speculative) — Re-point other name-based consumers to ids

- Candidates once Phase 1/2 have run in production for a while: `trVenues` (transport tier table), `venueMinLabour`, `venueDumping` — anywhere a rename still relies on the cascade rather than referencing the property id directly.
- Not committed to — only worth doing if the cascade proves fragile in practice.

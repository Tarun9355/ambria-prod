# Venues → stable IDs + IMS ownership: Phased Migration Plan

Living tracking doc — check items off as they're built. Mirrors the shape of `RATE_CARD_MIGRATION_PLAN.md` (a completed migration of the same kind: move admin ownership from Studio to IMS). Full roadmap kept for context; only **Phase 1** is in scope right now.

## Status: Phase 1 implemented, pending your manual verification in the real app.

## Context

Studio owns the in-house/outdoor venue catalogue today (`ManageSettings.jsx`'s "Venue Management" screen, persisted as one JSON blob under the settings key `ambria-v13-venues`, read via `customInhouse`/`customOutdoor` state). Every consumer — Studio's own Build/Deal Check/transport/min-labour code, and IMS's `FixedVenuesEditor.jsx` — matches venues by a bare **name string**, with no stable identity behind it.

**The problem this exists to fix:** IMS's Fixed Venues screen (standing inventory + its per-item discount, per-venue min labour/crew) links to a venue by name. If that venue is renamed in Studio, the Fixed Venue entry doesn't follow — it just keeps showing (and matching against) the old name, silently going stale, unless someone remembers to go re-pick the new name by hand.

**Why not just detect the rename?** From an external observer (IMS) watching a flat name list, a rename is indistinguishable from "old venue deleted, new venue added" — there's no reliable signal that two different-looking snapshots refer to the same physical property. Reliably solving this requires the venue itself to carry an identity that survives a name change: a stable `id`.

**Related, already-solved-once problem, found while scoping this:** Studio's own venue editor already has `renameVenueEverywhere(oldName, newName)` (`ManageSettings.jsx`), which fires on every in-Studio rename today and cascades the new name into video tags, the transport tier table (`trVenues`), and library photo tags (a real Supabase table) — all matched by name, same class of problem Fixed Venues has. This is proof the "rename cascade" pattern already works in this app; Fixed Venues just isn't one of the things it updates yet, and the mechanism itself is exactly the kind of thing that gets easier and less fragile once venues have real ids instead of only names.

**Decision made:** venues get a stable `id` at the property level (a "property" = a parent group like Exotica/Manaktala/Pushpanjali/Restro — the level Fixed Venues actually operates at, see the "Fixed Venues venue picker" work already shipped ahead of this plan). IMS becomes the sole place venue properties are added/renamed/deleted, mirroring the Rate Card precedent (Studio ends up a read-only consumer). A rename becomes an unambiguous, atomic "same id, new name" edit instead of a guess.

**Explicitly out of scope for Phase 1:** porting `renameVenueEverywhere`'s cross-system cascade (video tags / transport tier / library photos) into the new IMS editor. Phase 1 makes Fixed Venues follow a rename correctly (the actual ask); those three other consumers are Phase 2. Until Phase 2 ships, renaming a property via the new IMS editor updates Fixed Venues live, but does **not** yet update video tags, the transport tier's venue name, or library photo `tags.venue` — those still need the old Studio-side rename flow (or a manual fix) if they matter for a given rename.

---

## Phase 1 — Stable IDs + IMS "Venues" editor + Fixed Venues linked by id

- [x] **Data model, additive only.** `migrateVenues()` (`src/lib/ims/venueProperties.js`, shared by both panels below) stamps a stable `id` on every `inhouse[]` (sub-venue) row and builds/refreshes a top-level `properties: [{id, name, manager, icon}]` array — one row per distinct `.parent` value — plus a `propertyId` field on every sub-venue row pointing at it. `.parent` itself is untouched; every existing Studio consumer keeps reading it exactly as before. Runs (idempotently, write-back only if it actually changed something) from BOTH `VenuesEditor.jsx` and `FixedVenuesEditor.jsx`'s own load effects, so the migration has run the first time either panel is opened, whichever comes first.
- [x] **New IMS panel** — Admin → Settings → 🌆 Venues (`src/pages/ims/VenuesEditor.jsx`, wired into `AdminSettingsTab.jsx`). Add/rename/delete a property; add/rename/delete a sub-venue under one. A property rename updates `properties[].name` (id stays constant), cascades `.parent` on its sub-venues, AND cascades `.name` on any `settings.fixedVenues[]` entry linked to it by `propertyId` — that last part matters because `fixedVenueFor` (the actual billing-time matcher) still compares by name string, not id, so the linked entry's own name has to follow the rename too, not just what the screen displays.
- [x] **Studio's existing "Venue Management" screen** (`ManageSettings.jsx`) — In-house Venues card converted to **read-only** (display only, points at the new IMS panel); Outdoor Venues card untouched (outdoor venues were never Fixed-Venue-eligible, so left fully editable in Studio as before). Now-dead `addInhouse`/`updateInhouse`/`removeInhouse` and their `newIH`/`editIH` state removed. `renameVenueEverywhere`/`renameSummary` deliberately KEPT, unwired, marked as the Phase 2 reference implementation rather than deleted.
- [x] **Fixed Venues** (`FixedVenuesEditor.jsx`) links each configured venue by `propertyId`. One-time backfill effect: any existing entry without a `propertyId` is matched against `properties[]` by normalized name (`normVenueName` — lowercase, strip a leading "Ambria ", trim, same as `fixedVenueFor`'s own matching) and linked; an unmatched name is left exactly as it was (still shown, still fully functional, just not yet tracking renames) rather than hidden or altered. The venue-name `<select>` on each tab now resolves `propertyId` alongside `name` when you explicitly change it, and `addVenue` links a `propertyId` at creation time whenever the picked name matches a known property.
- [x] Verified: `npx vite build`, `npm run lint` (0 errors, 38 warnings — baseline), `npm run test` (59/59) all clean after every edit.
- [ ] **Not yet done — needs you, not code:** click through the real app once deployed — open IMS → Admin → Settings → 🌆 Venues, confirm the 4 existing properties (Manaktala/Exotica/Pushpanjali/Restro) and their sub-venues appear correctly with the migration having run; confirm every existing Fixed Venue tab still shows its standing items/qty/discounts/crew unchanged; rename one property and confirm its linked Fixed Venue tab picks up the new name immediately.

## Phase 2 (not started) — Port the rename cascade

- Move (or re-trigger) `renameVenueEverywhere`'s video-tag / transport-tier / library-photo cascade so it also fires on a rename made through the new IMS editor, not just Studio's (now read-only) screen.
- Decide the mechanism: IMS writing directly to those tables/settings keys itself, vs. Studio's running app reacting to a detected property-name change via its existing realtime subscription and running its own `renameVenueEverywhere`. The latter reuses already-tested logic but only fires while Studio is open; the former duplicates logic into IMS but is instant regardless.

## Phase 3 (not started, longer-term) — Re-point other name-based consumers to ids where it matters

- Candidates once Phase 1/2 are stable and proven: `trVenues` (transport tier table), `venueMinLabour`, `venueDumping` — anywhere else a rename currently requires the `renameVenueEverywhere`-style cascade could instead reference the property id directly and never need one.
- Out of scope until Phase 1/2 prove the id model out — this phase is speculative, not committed to.

# Ambria Studio — Change Log

A running note of what we changed and how, so anyone (including future us) can understand each edit without diffing the whole repo.

**Newest entries at the top.** Each entry: _Date · What · Why · Files · TODO_.

---

## 2026-07-23 (later 8) — Local dev env + test-UI tooling (housekeeping)

### Context
While running/testing the app locally, a few environment/tooling changes were made that weren't code-behaviour changes. Logging them for completeness.

### What we changed
- **`.env.local`** (NEW, gitignored) — created so the Vite client can start; it reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` via `import.meta.env` (`src/lib/supabase.js` throws without them). Values are the PUBLIC client config (same anon key already shipped in the deployed GitHub Pages bundle).
- **`.env.local.example`** — fixed stale prefixes: the client reads `VITE_*`, not `NEXT_PUBLIC_*`. Marked which vars are client vs server-only.
- **`package.json`** — added `@vitest/ui` (devDep) + `"test:ui"` script (`vitest --ui`) so tests can be viewed in a browser. _(Note: `vitest --ui` / watch mode exits in a non-interactive shell; `npm test` is the reliable one-shot run.)_
- **`.gitignore`** — added `html/` (the generated static Vitest HTML report from `vitest run --reporter=html`; a build artifact, not source).

### Not a code change
No app behaviour changed here. Tagging/pipeline logic untouched.

### Verification
- `npm test` → 28 passing. `npm run build` green. App serves locally.

### Inventory data note (for the owner — not a code fix)
During testing, **"STANDING LAMP"** was found to have `price = -1` in the `inventory` table, so it prices as ₹0 in quotes. Fix the rate in **IMS → Inventory** (not a tagger bug).

---

## 2026-07-23 (later 7) — Drop junk element names; keep coffee rule literal

### Context
More live testing. Two findings:
1. The tagger intermittently emits a garbage element named `"T"` (seen at qty 1, then qty 30, ₹0). A 1-char name also risks substring-matching a random catalog item (the substring tier tests the raw name, and "t" is inside almost every item name).
2. The coffee-table rule (Rule 9) rarely fires in practice because the AI usually tags ONE sofa unit with the seater count in its name (`"Maroon 3 Seater Sofa"`, qty 1), not three separate sofas.

### Decisions (owner)
- **Junk names:** YES, filter them.
- **Coffee-table basis:** follow the rule LITERALLY ("1 per 3 sofas" = 3 sofa units) — do NOT invent seat-counting or an any-lounge rule. Owner: _"jo rules mai hai wahi sirf, extra khud se add nahi karna"_ (only what the rules say; don't add anything extra yourself). So the existing backstop is UNCHANGED; it just won't fire unless the AI tags 3+ sofa units.

### What we changed
- **`src/pages/studio/StudioApp.jsx`** (`aiTagImage`, start of the post-processing pipeline, right after `_origName` is stamped):
  - Added a junk-name filter: drop any element whose name has no "real word" (no alphabetic token of length >= 2) BEFORE matching. Kills `"T"`, bare numbers, empty/garbage names; keeps legit names like `"2D MDF Jaali arch"`.
- Coffee-table backstop: **NO CHANGE** (kept literal per Rule 9).

### Verification
- `npm run build` green.
- `"T"` → normalize `"t"` → no word >= 2 chars → dropped. `"2D MDF Jaali arch"` keeps `"mdf"`/`"jaali"`/`"arch"` → kept.

### Still unverified
- Rule 9 auto-add end-to-end: still not observed firing, because no test photo has produced 3+ sofa UNITS since the backstop was added. It fires only when the AI tags that many; nothing more to change per owner.

---

## 2026-07-23 (later 6) — Deterministic coffee-table backstop (House Rule 9)

### Context
Live test of the tagger on a Side Lounge photo (3 sofas). The AI's own reasoning explicitly counted "three ivory sofas" but never added a coffee table — House Rule 9 ("Add 1 x Coffee Table for every 3 sofas") was skipped entirely, not rejected. That's the signature of a deterministic "always add N" rule that prompting alone won't reliably enforce. Owner approved a code backstop, strictly 1-per-3 (the L-shaped 2-sofa case, Rule 10, stays in the prompt because code can't see the seating layout).

### What we changed
- **`src/pages/studio/StudioApp.jsx`** (`aiTagImage` post-processing pipeline). After "new" elements are folded out and before `_matchStats`, added a backstop that:
  - counts sofas in the final element list (sum of qty; sofa detected by the matched item's sub-cat OR the element name containing "sofa"),
  - `needed = floor(sofaCount / 3)`,
  - counts coffee tables already tagged and adds only the SHORTFALL (never doubles an existing one),
  - resolves a real Coffee Table inventory item scoped to the "Coffee Table" sub-category first (so a name match can't grab the "Moroccan pedestal / coffee table" lookalike under Florals), falling back to a name match if that sub-cat isn't taggable,
  - stamps the added element with `_autoAdded` for transparency.
- Sits alongside the existing artificial-flower and generic-name backstops (same "enforce deterministic rules in code, not prompt" pattern).

### Pricing impact (intended)
When 3+ sofas are tagged and no coffee table is present, a priced Coffee Table (Furniture sub-cat, ~₹200-500, `is_kit`) is now added to the quote — exactly what Rule 9 intends.

### Known limits (documented)
- A coffee table already bundled INSIDE a kit (as a sub-item, not a top-level element) isn't seen by the top-up check, so it could over-add in that edge case.
- 1-2 sofas add nothing (by design/owner choice); L-shaped 2-sofa relies on the prompt.

### Verification
- `npm run build` green.
- Confirmed against live inventory that "Coffee Table" sub-cat items and "Sofa" items exist (so the match resolves).
- Behavioural check pending: re-tag the same 3-sofa photo → expect 1 Coffee Table auto-added.

---

## 2026-07-23 (later 5) — Make the tagger actually obey house tagging rules

### Context
Report: "the tagger doesn't read our house tagging rules." Investigated — it was NOT a wiring or data bug:
- The rules ARE saved (settings key `ambria-taxonomy-v2` → `taggingStandards`, ~4.9KB of real rules) and survive load (taxonomy load spreads the whole row; `saveTax` keeps the field).
- `aiTagImage()` is a plain per-render function, so no stale-closure — it always reads the current taxonomy.
- The rules WERE already being put into the prompt.

The real problem was OBEDIENCE, not delivery: the rules sat at position 0 of a ~15KB prompt (far from generation) and weren't in the system prompt, so the model anchored on the generic numbered rules and diluted the team's rules.

### What we changed (prompt-authority engineering — 3 levers)
**`src/pages/studio/StudioApp.jsx`** (`aiTagImage`):
1. **AUTHORITY** — the system prompt now names the HOUSE TAGGING RULES as mandatory and higher-priority than the generic instructions (only when rules exist; empty rules → system prompt unchanged).
2. **RECENCY** — `promptText` order changed from `[houseRules, corrText, kbText, subcatText, prompt]` to `[corrText, kbText, subcatText, prompt, houseRules]` so the house rules are the LAST thing before the image (models weight the most-recent instructions hardest).
3. **SALIENCE** — stronger header block: _"ABSOLUTE PRIORITY … Where any of these conflicts with the generic numbered instructions above, THESE WIN."_

Split `taxonomy.taggingStandards` into `houseRulesRaw` (used in the system prompt) + `houseRules` (the framed block in the message body).

### Caching
Unchanged/safe: house rules are still static per session, still inside the cached prompt prefix (cache breakpoint is still the last static block; the volatile image still comes after it). Editing rules invalidates the cache once, as before.

### Scope
Photo tagger only (`aiTagImage`). Video tagging is a separate prompt/system (spec §10) and was not touched. DB unchanged.

### Verification
- `npm run build` green.
- Behavioural effect (does the model now follow a given rule) can only be confirmed by tagging a real photo — pending the owner's manual test.

---

## 2026-07-23 (later 4) — Unit tests for the extracted pure modules

### Context
The §9 rebuild extracted the tagging core into pure, dependency-free modules precisely so they'd be unit-testable (spec §12.1/§12.2). Added the tests to lock that behaviour in.

### What we changed
- Added Vitest (devDependency) + scripts: `npm test` (run once), `npm run test:watch`.
- **NEW: `src/lib/studio/tagging/matcher.test.js`** (16 tests) — `normalize`; `buildSynonymOf`; the three `bestOf` tiers (exact/substring/overlap); synonym-driven matches; stopword false-match suppression; `STRUCT_KW` / `STRUCTURAL_CATS` guards; the 40/65/90/100 threshold constants.
- **NEW: `src/lib/studio/tagging/applyResult.test.js`** (12 tests) — empty/null result → `gotTags` false & no stamps; taxonomy-key copy (only non-empty arrays, merged onto existing tags); `_aiTagged`/`_aiTaggedAt`/`tagSource` stamping only on success; name replaced only when missing/placeholder (never a human name); dims only when a size field is present.

### Note (documented, not a bug)
Writing the matcher tests surfaced a subtle _pre-existing_ scoring trait (unchanged by us): a catalog name made mostly of stopwords (e.g. "Rose Garland" → colour "rose" is a stopword → just `["garland"]`) gets a denominator of 1, so it can tie/beat a more specific candidate on the overlap tier. Captured here as a tuning candidate for later; the tests were written to isolate tiers cleanly rather than depend on it.

### Verification
- `npm test` → 2 files, 28 tests, all passing.

### Remaining spec work
- None. §9 (A/B/C/D) complete + covered by tests; client build green.

---

## 2026-07-23 (later 3) — §9-D: status vs tag_source — two explicit, independent dimensions

### Context
Spec §9-D / §12.3: the library photo's lifecycle ("untagged → review → verified") and its attribution ("how did it get tagged") were written inconsistently and read as if they were one combined enum, when they are two orthogonal things. The rebuild target: two clearly separate, clearly named concepts, documented as independent from day one.

### What was already in place (from the §9-A/§9-B passes)
- `libraryQueries.js` already defined the two enums and the "these are INDEPENDENT — never collapse them" header comment:
  - `LIB_STATUS = { UNTAGGED, REVIEW, VERIFIED }` (lifecycle, computed)
  - `TAG_SOURCE = { MANUAL, BUILD }` (attribution, stored)
- `computeLibStatus()` reads NONE of `tag_source` (lifecycle only).
- The `tag_source` WRITE inconsistencies §9-D flagged were already fixed earlier: `'nightly'` removed with the batch tagger (§9-A); the single-photo button now stamps `'manual'` via `applyAiTagResult` (§9-B); `'build'` is stamped on zone-upload (`StudioApp.jsx` `handleZoneUpload`).

### What we changed (this pass — the finishing consistency sweep)
The two concepts were explicit in the query layer but the PHOTO UI still compared against bare `"verified"`/`"review"`/`"untagged"` string literals, which is exactly the "looks like an ad-hoc combined field" smell §9-D calls out. Replaced those literals with the documented `LIB_STATUS` constants so the lifecycle dimension is named everywhere it's used.

- **`src/pages/studio/manage/ManageLibrary.jsx`**
  - `photoStatus()` now returns `LIB_STATUS.*` (+ a doc comment noting it's the client-side twin of `computeLibStatus` and reads no `tag_source`).
  - all `libStatus === "untagged"` / `!== "untagged"` gate checks and the grid status-badge rendering (`st === "verified"/"review"`) now use `LIB_STATUS.*`.
- **`src/lib/studio/libraryQueries.js`**
  - internal query/mapping literals (`"verified"`/`"untagged"` in `computeTaggedAtMs`, `libItemToRow`, `fetchRecentLibraryPhotos`, `fetchUntaggedLibraryTargets`, `fetchVerifiedLibraryPhotos`) now use `LIB_STATUS.*` — consistent with the enum defined in that same file.

### Scope note (deliberate)
The Videos tab (`videoStatus` + its status folders) still uses raw `"verified"`/`"review"`/`"untagged"` — that is the SEPARATE video-tagging system (spec §10, own state: `ytVideoTags`/`ytFilterLinked`). Not conflated on purpose. DB column names (`status` / `tag_source`) unchanged; only client-side references now go through the named constants.

### Verification
- `node --check` passed on `libraryQueries.js`, `applyResult.js`, `matcher.js`.
- grep confirms zero remaining bare photo-status literals in the photo path of `ManageLibrary.jsx` (`libStatus`/`photoStatus` comparisons all use `LIB_STATUS`).
- Full vite build PASSED end-to-end: `npm install && npm run build` (vite v8.0.16, 152 modules, clean — no errors).

### Remaining spec work
- None. §9 (A/B/C/D) all done, client build green, and the manual Supabase step was run by the owner: `select cron.unschedule('nightly-batch-tagger');`. The AI-tagging rebuild per `AI_TAGGING_SPEC.md` §9 is complete.

---

## 2026-07-23 (later 2) — §9-C: rename the two confusable correction loggers

### Context
Spec §9-C: two similarly-named loggers fire from the SAME "Save & Verify" click and write to two DIFFERENT tables, so "where are corrections stored?" had two answers and nobody could tell which was which.

### The two loggers (unchanged behaviour, clearer names)
- `photo_corrections` table = "who verified/edited what, when" (the Contributions leaderboard / audit log).
  - RENAMED: `logCorrection` → `logVerificationEvent`
- `tag_corrections` table = per-field AI-vs-human tag diff that is fed back into the tagging prompt (the learning signal).
  - RENAMED: `logTagCorrections` → `logFieldCorrections`

### What we changed
- **`src/lib/studio/tagFeedback.js`**
  - `logTagCorrections` → `logFieldCorrections` (+ sharpened its doc comment to point at the other logger so they can't be confused).
- **`src/pages/studio/StudioApp.jsx`**
  - `logCorrection` useCallback → `logVerificationEvent` (+ doc comment explaining the two-tables distinction); updated the ctx export.
- **`src/pages/studio/manage/ManageLibrary.jsx`**
  - updated import + all call sites (photo verify, 2× video verify, Save & Verify field-diff).
- **`src/pages/studio/views/StudioBuild.jsx`**
  - updated the "Correct & save to master" call site.

### Scope note (deliberate)
Only the LOGGER FUNCTIONS were renamed. The display-state clusters (`corrLog` / `refreshCorrLog`, `tagCorrections` / `refreshTagCorrections`) and the source helpers (`logPhotoCorrection`, `fetchPhotoCorrections`, `fetchRecentCorrections`, `renderCorrectionsText`) were left as-is to keep the blast radius small — they were not the source of the "which logger?" confusion. DB table names (`photo_corrections` / `tag_corrections`) unchanged.

### Verification
- `node --check` passed on `tagFeedback.js`.
- grep confirms zero remaining `logCorrection` / `logTagCorrections`; new names present in all 4 files. Full vite build still not run.

### Remaining spec work
- §9-D: make status vs tag_source explicitly independent (last item).

---

## 2026-07-23 (later) — §9-B: one `applyAiTagResult()` for the "apply result" merge

### Context
Spec §9-B: the "take an `aiTagImage()` result and merge it onto a photo" logic was copy-pasted across multiple tagging buttons and had drifted.

### What we found (7 call sites, grouped)
- **Category A** — full library-row merge (tags + name + elements + dims + meta), GENUINELY duplicated and drifted, 3 copies:
  - `runBulkTag` (StudioApp.jsx) "Tag all untagged"
  - `runTagSelected` (StudioApp.jsx) "Tag selected"
  - single-photo AI Tag button (ManageLibrary.jsx)
  - BUG in the 3rd: it never stamped `tag_source`, so photos re-tagged from the edit modal silently missed the "Manual Tagged" chip.
- **Category B** — element-only one-liners (`setZoneElements(result.elements)`):
  - "Use This Look" grid + fullscreen (StudioModals.jsx)
  - "AI Fill" (StudioBuild.jsx)
  - Not real duplication — one line each; left as-is on purpose.
- **Category C** — zone-upload review draft (`handleZoneUpload` → `zoneUploadReview`, applied by `applyZoneUpload` with `tagSource:"build"`). Structurally different (builds a NEW item w/ defaults, not a merge onto an existing row); left as-is on purpose.

### What we changed
- **NEW: `src/lib/studio/tagging/applyResult.js`** — exports `applyAiTagResult(existing, result, { taxonomy, tagSource })` → `{ patch, gotTags }`. Pure/testable. Builds the changed-fields patch and (only when tags actually landed) stamps `_aiTagged`/`_aiTaggedAt` + `tagSource`. Callers handle failure themselves.
- **`src/pages/studio/StudioApp.jsx`**
  - `runBulkTag` and `runTagSelected` now call `applyAiTagResult` instead of each having their own ~18-line inline merge.
- **`src/pages/studio/manage/ManageLibrary.jsx`**
  - single-photo AI Tag button now calls `applyAiTagResult` → FIXES the missing `tag_source` bug (now stamps `"manual"`).

### Small behaviour changes (intentional consistency fixes)
- The single-photo button now also treats a name of exactly `"Untitled"` as replaceable (the bulk paths already did) and only marks `_aiTagged` when tags/elements actually came back (previously it set `_aiTagged` even on an empty-but-non-null result). Both align it with the bulk paths.

### Verification
- `node --check` passed on `applyResult.js`.
- Confirmed 0 remaining inline `let gotTags = false` merge blocks in `StudioApp.jsx`; all 3 sites go through `applyAiTagResult`.
- Full vite build still not run (node_modules not installed).

### Remaining spec work
- §9-C: rename the two correction loggers (`logCorrection` vs `logTagCorrections`) for clarity.
- §9-D: make status vs tag_source explicitly independent.

---

## 2026-07-23 — Remove the nightly batch tagger + extract the matcher

### Context
Source of truth for the AI photo-tagging system: `AI_TAGGING_SPEC.md`. That spec (§9-A) flagged that the tagging pipeline existed as TWO hand-synced copies in two languages:
- client JS: `src/pages/studio/StudioApp.jsx` → `aiTagImage()`
- server TS: `supabase/functions/batch-tagger/index.ts` (nightly cron)

On inspection the two copies had already DRIFTED (different prompt rules, different JSON schema, client had size-from-name logic the server lacked).

### Decision
We do NOT want the nightly batch tagger at all. Removing it means the client becomes the ONLY tagger, so the "two copies out of sync" problem disappears by deletion instead of by building a shared module.

### What we changed
1. **DELETED the nightly batch tagger** (backed up first to the session scratchpad: `.../scratchpad/nightly-backup/`):
   - `supabase/functions/batch-tagger/` (whole Edge Function)
   - `supabase/functions/_shared/` (cross-language shared dir; not needed once server copy is gone)
   - `RUNBOOK_BATCH_TAGGER.md` (ops runbook for the cron)
   - `supabase/config.toml` (stripped the `[functions.batch-tagger]` verify_jwt block; file kept with an explanatory note)
2. **EXTRACTED the matcher core** into one testable module (spec §12.1). The element-name → inventory matching logic (`bestOf`, the 40/65/90/100 thresholds, `normalize`, `keywords`, synonym dictionary, `STRUCT_KW`) used to be inline inside `aiTagImage`. It now lives in ONE place:
   - **NEW: `src/lib/studio/tagging/matcher.js`** (pure, no React/DOM, unit-testable)
   - `StudioApp.jsx` now imports `{ createMatcher, normalize, STRUCT_KW, STRUCTURAL_CATS as RAW_SCAFFOLD_CATS, MATCH }` from it, and the big inline block in `aiTagImage` was replaced with: `const { bestOf } = createMatcher(imsSynonymDictionary);` (`LOW_CONFIDENCE_BELOW` references became `MATCH.LOW_CONFIDENCE_BELOW`.)
3. **REMOVED all client UI/state tied to the nightly tagger:**
   - `src/pages/studio/StudioApp.jsx`
     - removed state: `batchTaggerPaused`, `batchTaggerMeta`
     - removed the load-time `kvGet(BATCH_TAGGER_PAUSED_SK)` effect line
     - removed the `toggleBatchTaggerPaused()` useCallback
     - removed those 3 names from the ctx props object
     - removed the `BATCH_TAGGER_PAUSED_SK` import
     - removed dead `kb.promptText` persistence (only the edge fn read it)
     - fixed two stale "nightly" code comments
   - `src/pages/studio/manage/ManageSettings.jsx`
     - removed the entire "Library / Tagger" settings sub-view (the Pause/Resume batch-tagger panel + last-run display)
     - removed its nav entry from the VIEWS array
     - removed `taggerLastRun` state + its effect
     - removed imports: `BATCH_TAGGER_LAST_RUN_SK`, `kvGet`
     - removed `batchTagger*` from the ctx destructure
   - `src/pages/studio/manage/ManageLibrary.jsx`
     - removed the "Nightly Tagged" status chip
     - removed "nightly" from the counts default and libStatus handling
     - updated related comments
   - `src/lib/studio/libraryQueries.js`
     - removed the nightly count query + `tag_source:'nightly'` filter branch
     - updated the `fetchLibraryPage()` docstring + comments
   - `src/lib/studio/keys.js`
     - removed `BATCH_TAGGER_PAUSED_SK` and `BATCH_TAGGER_LAST_RUN_SK`
   - `src/pages/ims/IMS.jsx`
     - fixed a comment that referenced the nightly edge function

### What we deliberately left alone (chosen: "cron only, leave data")
- The `batch_tag_log` table (migration 007) — left in place, now unused.
- Existing library rows with `tag_source = 'nightly'` — left as-is; those photos still show up under "Needs review", just without a nightly chip.
- `src/scripts/backfill-library-status.js` — one-time historical script, still references 'nightly' in a log line; harmless, not runtime code.
- Historical docs (`SQL_TO_RUN.md`, `RATE_CARD_MIGRATION_PLAN.md`, `rate-card-removal-impact.md`) still mention batch-tagger — historical.

### Manual step required (must be run by a human in Supabase — we can't)
The pg_cron job still fires every 15 min at the now-deleted function. In the Supabase SQL editor, run:

```sql
select cron.unschedule('nightly-batch-tagger');
```

### Verification
- `node --check` passed on the touched plain-JS files (`matcher.js`, `keys.js`, `libraryQueries.js`).
- Full `vite build` NOT run this session (node_modules not installed). JSX edits were verified by hand. TODO: run `npm install && npm run build` to confirm the client compiles end-to-end.

### Remaining spec work (not done yet — from AI_TAGGING_SPEC.md §12)
- §9-B: consolidate the 6+ near-duplicate "apply the AI result" handlers into one `applyAiResult(target, result)`.
- §9-C: rename the two correction loggers (`logCorrection` vs `logTagCorrections`) so their purposes are obvious.
- §9-D: make status vs tag_source clearly two separate concepts.

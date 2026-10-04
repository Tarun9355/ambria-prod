# The stale-tab save guard — what it is, and how it already broke twice

**Where it lives:** `src/pages/studio/StudioApp.jsx` — `buildSaveBaselineRef` /
`buildConflictWarnedAtRef` (Build's own save path, inside `saveSession`), and its sibling
`dcSaveBaselineRef` / `dcConflictWarnedAtRef` (Deal Check's `dcDraft` autosave). Same mechanism,
same reasoning, two copies.

## What problem it solves

`client_ledger` / `studio_sessions` are shared, multi-tab, multi-device data. Two different browser
tabs can have the same deal open at once — two PCs, or one person who never closed an old tab. Every
save (debounced, periodic, manual, pagehide) used to just upsert whatever this tab currently holds,
with no check against what the SERVER actually has right now. Whichever tab's save lands LAST wins,
even if its content is older/smaller than what's already there. Confirmed real incidents:

- A ₹4,50,865 build was saved, then a different (older) tab's autosave landed a ₹2,61,861 build on
  top of it minutes later.
- Tarun saved a deal down to ~₹14.73L on one PC; 62 seconds later his OWN other tab — still holding
  the pre-edit ~₹16L state — silently reverted it, no warning, because the original guard only
  blocked a DIFFERENT user's overwrite, not your own stale tab on another device.

## The fix, in one sentence

Each tab remembers what `sessions[0]` was the last time IT loaded or saved this client
(`buildSaveBaselineRef`). Before writing, compare that baseline against the live `sessions[0]`
(read fresh, right before the write). If the live one has moved past the baseline, THIS tab's copy
is stale — skip the write and tell the user, instead of silently overwriting something newer.

## Pitfalls already hit while building/fixing this — check these before touching it again

1. **The baseline must come from the "door" the tab walked through — there are TWO doors, and
   both must set it.** `loadClientSession` (a fresh Load) sets it. `resumeSavedSession` (Browse's
   "Resume"/"Continue build" — used far more often than a fresh Load) did NOT, for a while — a tab
   that only ever arrives via Resume kept a `null` baseline for its whole life, and the guard's own
   first check (`!!(baseline && ...)`) reads `null` as "nothing to compare against", silently
   disabling the protection. **If you add a third way to start editing a client, it needs this too.**

2. **The baseline must be the client's ACTUAL CURRENT `sessions[0]` — never the specific session a
   user chose to look at.** `resumeSavedSession` can deliberately load an OLDER session (rolling back
   to a past build is the whole point of offering Resume on history entries). The first fix attempt
   baselined on `session` (the one being resumed) instead of the real current `sessions[0]` — which
   made EVERY subsequent save look like a conflict, because the live remote (the actual newest
   session) is always "newer" than a deliberately-older baseline. A ₹14L rollback build sat on screen
   correctly, and then could never be saved — not even once — until this was caught and fixed.
   **Read the baseline from `clientLedgerRef.current.find(c => c.id === activeClientId)?.sessions?.[0]`
   (or equivalent), never from whatever session object happens to be in hand.**

3. **A same-user exemption defeats the whole point.** The guard originally required
   `remoteSavedBy !== me` to fire — i.e. it only ever protected against a DIFFERENT person's save.
   One person routinely has two tabs/devices open on the same deal (see the Tarun incident above).
   Drop that exemption: a well-behaved single tab's own baseline tracks its own last write (advanced
   right after every successful save), so this never blocks normal single-tab use — it only fires
   when SOME OTHER tab, whoever is in it, has moved the deal forward since this one last checked in.

4. **The warning needs to be readable, not a toast.** The conflict message is a full sentence
   explaining what happened AND what to do about it ("reload before continuing") — genuinely
   important, not a fire-and-forget confirmation. It was first wired through `showMsg` (the generic
   2-second auto-dismissing toast used for "✓ Session saved" etc.) — a message that long and that
   important deserves the EXISTING persistent `setSaveError` banner (top-right, red, stays until the
   user clicks Dismiss — already used for actual save failures) instead of a flash they have no real
   chance to finish reading. **Any new conflict/error message in this area should go through
   `setSaveError`, not `showMsg`, unless it's genuinely a quick confirmation.**

5. **The write itself must go through the ONE shared save function.** There is exactly one place
   that writes a build to `studio_sessions` for a save: `saveSession`. A "hard save" / "force save" /
   any new save trigger must call that same function (so it inherits the guard, the "has real data"
   check, and the rolling-draft dedup) — never a parallel `supabase.from("studio_sessions").upsert(...)`
   written fresh, which would silently skip all of the above and reopen exactly this class of bug.

## Before you change anything here

- Trace BOTH `loadClientSession` and `resumeSavedSession` for the change you're making — a fix
  applied to only one of the two "doors into a build" is not actually fixed (pitfall #1).
- Ask explicitly: "if a user deliberately resumes an OLDER session, does the baseline still end up
  as the ACTUAL current remote state, or as whatever they just opened?" If you can't answer that
  confidently, re-read pitfall #2 before shipping.
- If you're tempted to exempt some case from the conflict check (e.g. "but it's the same person"),
  that exemption is very likely reintroducing pitfall #3. Multi-device, multi-tab use by one person
  is the normal case this guard exists for, not an edge case to carve out.
- Recovery when this (or anything like it) still slips through: nothing is ever deleted —
  `studio_sessions` keeps up to 10 historical saves per client (`SESSION_KEEP`), so the "lost" build
  is still a row away. See any past conversation recovering a dropped function or a reverted total
  for the exact SQL pattern (read the history, identify the right `session_id`, re-surface it as the
  current one) — never guess, always read the actual rows back before writing a fix.

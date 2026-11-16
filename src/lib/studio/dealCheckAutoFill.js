// Decides whether Deal Check's auto-fill generate fires on this render, and whether it may
// interrupt the user with the hard out-of-stock gate modal / its own toasts.
//
// Background: Deal Check's reconcile-and-match pipeline (runDealCheckGenerate, StudioApp.jsx) runs
// two ways — the user opening Deal Check for real (dcFullPageOpen), or an invisible background
// "headless" instance woken by an edit/markSold/Apply/the IMS-settings auto-sync (dcHeadless, mounted
// off-screen at -20000px). Both ways share the SAME auto-fill effect and the SAME shared modal/toast
// state (there is only one oosGateModal, one toast), so a non-silent run started by the invisible
// instance popped a fully visible modal with nothing on screen to explain it — stacking over whatever
// the salesperson was doing (owner report, 2026-11-16: fixing one out-of-stock item opened a swap
// picker, and moments later a SECOND copy of the gate popped over it from exactly this path).
//
// `fired`: null | "headless" | "full" — which mode this dcRun session has already auto-filled in.
// A session fires once per mode, same as the original `dcAutoFilledRef` boolean did per session, but
// tracking the MODE (not just "has it fired") lets a real open that happens while a headless wake's
// one-shot is already spent still get its own, non-silent run — a real open must never go unanswered
// just because the background already ran once.
export function autoFillDecision({ dcRun, full, loading, hasClient, ready = true, fired }) {
  if (!dcRun) return { fire: false, nextFired: null };
  if (loading || !hasClient || !ready) return { fire: false, nextFired: fired ?? null };
  const mode = full ? "full" : "headless";
  // "full" already fired covers a later headless render (a real open never needs a second, quieter
  // run of the same session) — but a HEADLESS fire does NOT cover a later full open; that transition
  // must still fire its own run, non-silently, so it reaches `mode === "full"` below.
  if (fired === "full" || fired === mode) return { fire: false, nextFired: fired };
  return { fire: true, nextFired: mode, silent: !full };
}

// Phase 2 — one sync request per booked-deal edit, instead of the two independent calls
// autoSaveBuild used to make (a direct silent generate, AND a headless wake whose own auto-fill was
// a second, redundant generate of the same edit). "wake" when nothing is running: the newly-silent
// auto-fill (autoFillDecision, since the owner report fix above) IS the one generate, and the
// overlay it mounts pushes Dept Ops itself. "direct" when Deal Check is already open (its own visible
// reconcile covers it) OR a headless instance is already mounted — its own auto-fill either already
// ran this session or is still loading, so only a direct call actually reconciles THIS edit now.
export function bookedSyncAction({ full, headless }) {
  return (!full && !headless) ? "wake" : "direct";
}

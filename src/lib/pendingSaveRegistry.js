// A tiny bridge so App.jsx's update banner — rendered OUTSIDE any route's component tree, since
// it has to survive whichever page you're on — can ask whichever app is currently mounted
// (Studio, today; IMS has no in-progress client state to lose) to flush its unsaved work before
// reloading to the new build. Without this, clicking "Update now" called window.location.reload()
// immediately: Studio's own autosave IS wired to pagehide, but a reload can cancel an in-flight
// network write before it lands, so a build mid-edit was routinely lost the moment someone hit
// Update instead of just leaving the tab alone. Threading a real prop/ctx here isn't possible —
// the banner sits above the router, not inside it — so a small registry is the plain fix.
let flushFn = null;

// Called by whichever page holds unsaved state, once it mounts. `fn` should return a promise that
// resolves once a save it kicks off has actually reached the server (not just been scheduled).
export function registerFlushBeforeReload(fn) {
  flushFn = fn;
}

export function unregisterFlushBeforeReload(fn) {
  if (flushFn === fn) flushFn = null;
}

// Best-effort: a save that errors or hangs must never block the update the user asked for, so
// callers should race this against their own timeout rather than await it unconditionally forever.
export async function flushBeforeReload() {
  if (!flushFn) return;
  try {
    await flushFn();
  } catch {
    /* saving is best-effort here — proceed to reload regardless */
  }
}

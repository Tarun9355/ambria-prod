// ═══ Mobile back-gesture trap ═══
// This is a single-page app with no real page-to-page history of its own — one HashRouter route per
// app (/studio, /ims), everything else (tabs, modals, Deal Check's overlay) is in-memory React state,
// never a browser history entry. So a session's very first back gesture (or Android hardware back
// button) had nothing of the app's own to pop into, and fell straight through to whatever was open
// BEFORE the app, closing it outright (owner report 2026-11-23: "in mobile view the back gesture
// closes the app"). Keeps one spare history entry pushed at all times so a back gesture always has
// something harmless to consume instead — the standard "history guard" pattern used by most installed
// mobile web apps. Mounted once, only once a user is actually logged into the app (never on /login,
// where a visitor may genuinely want ordinary back behavior).
//
// Traps EVERY back gesture while mounted, not just ones with a modal open — this app has no real
// route-to-route back navigation for a user to lose (Studio/IMS redirects are auth-driven, never a
// back-button target), so there is nothing of value behind the guard entry to protect. A future pass
// could pop the topmost open modal/overlay on each gesture instead of just re-arming the guard; this
// first pass only stops the app from exiting, which is the reported problem.
export function armBackGestureTrap() {
  if (typeof window === "undefined" || typeof window.history?.pushState !== "function") return () => {};
  // Never inside a hidden same-origin iframe (AutoPlanningSync.jsx's headless studio-sweep shards,
  // DeptPdfButton.jsx's PDF-run frame) — a pushState in there lands on the TOP-level tab's own
  // history, so the user's next real back gesture pops the frame's dead entry instead of the page
  // (regression review, 2026-11-23).
  if (window.top !== window.self) return () => {};
  const GUARD = "__ambria_back_guard__";
  const push = () => { try { window.history.pushState({ [GUARD]: true }, ""); } catch {} };
  push();
  const onPopState = () => { push(); };
  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}

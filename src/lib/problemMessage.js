// ═══ Load / save problems in plain words (SaveHealthBanner) ═══
// Owner ask 2026-11-28: the banner showed the backend's own text ("Failed to load (JWT expired) — admin config ... read-only
// until ...", twelve lines of it). It now leads with one plain message - what went wrong and what to do - and keeps the
// technical lines behind "Details". The raw error is still recorded (saveHealth.js); this only decides how it is shown.

const RULES = [
  ["offline", /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|timed? ?out|timeout|aborted|offline|fetch failed/i],
  ["login", /jwt|token|expired|not authenticated|unauthori[sz]ed|\b401\b|\b403\b|permission denied|row-level security|session/i],
  ["server", /\b5\d\d\b|server error|service unavailable|bad gateway|too many requests|\b429\b|rate limit|overloaded/i],
];

/** "offline" | "login" | "server" | "other" for one raw error message. `online` = navigator.onLine when known. */
export function problemKind(message, online = true) {
  if (online === false) return "offline";
  const s = String(message || "");
  for (const [kind, re] of RULES) if (re.test(s)) return kind;
  return "other";
}

// The one kind the banner leads with: offline beats login beats server beats other (the first is usually the cause of the rest).
const RANK = { offline: 0, login: 1, server: 2, other: 3 };
export function mainKind(problems, online = true) {
  let best = "other";
  (problems || []).forEach((p) => { const k = problemKind(p?.error, online); if (RANK[k] < RANK[best]) best = k; });
  return best;
}

const LOAD_TEXT = {
  offline: { title: "Your internet dropped while the page was loading", hint: "Check the connection, then press Reload.", action: "reload" },
  login: { title: "Your login has expired", hint: "Log in again to keep working.", action: "login" },
  server: { title: "The server is busy right now", hint: "Wait a minute, then press Reload.", action: "reload" },
  other: { title: "Some data didn't load", hint: "Press Reload to try again.", action: "reload" },
};
const SAVE_TEXT = {
  offline: { title: "Not saved: your internet dropped", hint: "Your change is kept here. Press Retry when you are back online.", action: "retry" },
  login: { title: "Not saved: your login has expired", hint: "Log in again, then make the change once more.", action: "login" },
  server: { title: "Not saved: the server is busy", hint: "Your change is kept here. Press Retry in a minute.", action: "retry" },
  other: { title: "A change couldn't be saved", hint: "Press Retry. If it keeps failing, reload the page.", action: "retry" },
};

/** { kind, title, hint, action } for the banner's load ("blocked") or save ("failed") box. */
export function problemSummary(problems, type = "load", online = true) {
  const kind = mainKind(problems, online);
  return { kind, ...(type === "save" ? SAVE_TEXT : LOAD_TEXT)[kind] };
}

/** A detail line without the backend's wording: "Failed to load (JWT expired) — the item list ..." -> "the item list ...". */
export function problemDetail(message) {
  let s = String(message || "").trim();
  s = s.replace(/^failed to load\s*(\([^)]*\))?\s*[—-]?\s*/i, "");
  s = s.replace(/^save failed:?\s*/i, "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

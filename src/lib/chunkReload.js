import { flushBeforeReload } from "./pendingSaveRegistry";

// A tab keeps running the build it was opened on. When a new build is deployed the old hashed files
// (IMS-Bg3h-3tZ.js …) are removed, so the next screen that tab opens for the first time fails with
// "Failed to fetch dynamically imported module" — a red error screen though nothing is wrong with the
// data or the code. The cure is simply to load the new build, so that is done here automatically.

export const isChunkLoadError = (err) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Loading chunk .* failed|Unable to preload CSS/i
    .test(String(err?.message || err || ""));

const KEY = "ambria-chunk-reload-at";
const COOLDOWN_MS = 60000; // a second failure inside this window is a real problem, not a stale tab

// Reloads onto the newest build, once. Returns false (and does nothing) if it already did in the last
// minute, so a genuinely missing file can never become a reload loop.
// Same reload as the "Update now" banner: pending edits are flushed first (capped at 4 s), and the
// URL gets a fresh ?v= so the browser cannot satisfy the reload from its cached index.html.
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < COOLDOWN_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { return false; }
  Promise.race([flushBeforeReload(), new Promise((r) => setTimeout(r, 4000))]).finally(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("v", Date.now().toString(36));
      window.location.replace(url.toString());
    } catch { window.location.reload(); }
  });
  return true;
}

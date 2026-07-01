import { useEffect, useState } from "react";

// URL of the entry bundle that is CURRENTLY running (hashed at build time). Captured once at
// module load. Every deploy changes this hash, so we can detect a new build by checking whether
// the freshly-fetched index.html still references our file.
const CURRENT_BUNDLE = String(import.meta.url).split("/").pop() || "";

const POLL_MS = 3 * 60 * 1000; // check every 3 minutes while the tab is in use

/**
 * Detects when a newer build has been deployed to GitHub Pages so the user can be nudged to
 * reload — instead of us asking the whole team to hard-refresh after every deploy.
 *
 * How: fetch index.html with `cache: "no-store"` (bypasses the browser + CDN cache). If it no
 * longer references the bundle filename we booted from, a new build is live → return true.
 * Fails silent when offline. Runs on an interval + whenever the tab regains focus.
 */
export function useVersionCheck() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    // Can't identify our own bundle (e.g. dev server) → nothing to compare against.
    if (!CURRENT_BUNDLE || !CURRENT_BUNDLE.endsWith(".js")) return;
    let stopped = false;

    async function check() {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        // Still referenced → we're current. Absent → a new deploy replaced the hash.
        if (!html.includes(CURRENT_BUNDLE)) {
          stopped = true;
          setUpdateReady(true);
        }
      } catch {
        /* offline / transient — ignore, try again next tick */
      }
    }

    const id = setInterval(check, POLL_MS);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    check(); // initial check on load

    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return updateReady;
}

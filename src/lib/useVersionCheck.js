import { useEffect, useState } from "react";

// Filename of the entry bundle in a page's HTML — e.g. "index-Y2QwZxPh.js". Every deploy rehashes
// it, so comparing the one this tab BOOTED from against the one the server is serving NOW is what
// detects a new build.
//
// Read out of the document rather than from `import.meta.url`, which is what this did before.
// import.meta.url is the URL of THIS MODULE, and the two only coincide while the whole app is one
// chunk. The build already warns that the bundle is over 500 kB and suggests code splitting; the
// day anyone acts on that, this module lands in a chunk index.html does not name as its entry, the
// comparison can never match, and the banner is permanently on for everyone. Reading the entry
// script from the HTML compares like with like whatever the chunking.
function entryBundleOf(doc) {
  const el = doc.querySelector('script[type="module"][src]');
  const src = el && (el.getAttribute("src") || "");
  return src ? src.split("/").pop() : "";
}
// Captured once at module load, from the live document: this is the build that is running.
const CURRENT_BUNDLE = entryBundleOf(document);

const POLL_MS = 3 * 60 * 1000; // check every 3 minutes while the tab is in use

/**
 * Detects when a newer build has been deployed to GitHub Pages so the user can be nudged to
 * reload — instead of us asking the whole team to hard-refresh after every deploy.
 *
 * How: fetch index.html with `cache: "no-store"` (bypasses the browser + CDN cache) and compare
 * its entry-bundle filename with the one this tab booted from. Different → a new build is live.
 * Fails silent when offline. Runs on an interval + whenever the tab regains focus.
 *
 * Comparing the two filenames (rather than asking "is mine still mentioned") is also what catches
 * the case this is most needed for: GitHub Pages serves index.html with a ten-minute max-age, so
 * a tab can boot from cache onto a build that was replaced before it ever loaded.
 *
 * Never runs on the dev server — see the guard in the effect.
 */
export function useVersionCheck() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    // ── NEVER ON THE DEV SERVER ──
    // There is no deploy to detect when you are the one running the server, and the check cannot
    // work there anyway: Vite serves modules unbundled, so `import.meta.url` is this very file
    // rather than a hashed entry chunk, CURRENT_BUNDLE comes out as "useVersionCheck.js" — which
    // passes the .js guard below — and the dev server's index.html references /src/main.jsx and
    // never that name. The match failed every time, so localhost showed the banner permanently
    // and "Update now" reloaded straight back into it.
    if (import.meta.env.DEV) return;
    // No hashed entry to compare against → nothing this check can tell us. Bails rather than
    // guessing: a detector that cannot identify the current build must stay silent, not assume
    // the worst and nag.
    if (!CURRENT_BUNDLE || !CURRENT_BUNDLE.endsWith(".js")) return;
    let stopped = false;

    async function check() {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        // Parsed, not substring-matched, so this reads the served entry the same way the browser
        // did — and a hash that happens to appear elsewhere in the HTML cannot fool it.
        const served = entryBundleOf(new DOMParser().parseFromString(html, "text/html"));
        if (!served) return;                     // unrecognisable HTML → say nothing
        if (served !== CURRENT_BUNDLE) {         // different build is live → offer the update
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

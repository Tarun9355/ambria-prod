import { useEffect, useRef, useState } from "react";
import { flushBeforeReload } from "../../lib/pendingSaveRegistry";

// ═══ PULL TO REFRESH (phones) ═══
// The browser's own pull-to-refresh is missing exactly where IMS gets used most — a home-screen
// web app on iPhone, in-app browsers — and inconsistent elsewhere. This is one gesture that works
// the same everywhere: at the very top of the page, drag down past THRESHOLD and let go → any
// pending save is flushed (same 4s-capped flushBeforeReload the "Update now" banner uses) and the
// page reloads. The browser's native version is switched off while this is mounted so the two
// never fire together.
//
// It stays out of the way when a pull is really something else: page not at the top, a modal or
// camera open (they lock body scroll), a second finger (pinch), or a touch that starts inside an
// inner scroller that is itself scrolled down (a long list in a sheet scrolls back up first).

const THRESHOLD = 70;   // px of (damped) pull needed to refresh
const MAX_PULL = 110;

// True when the touch should NOT start a refresh: it is inside an overlay (the nav drawer, a sheet,
// a modal, the camera — all position:fixed) or inside an inner scroller that is scrolled down.
function shouldIgnore(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.position === "fixed") return true;
    if (n.scrollTop > 0 && (cs.overflowY === "auto" || cs.overflowY === "scroll")) return true;
  }
  return false;
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "contain";

    const onStart = (e) => {
      startY.current = null;
      if (refreshing || e.touches.length !== 1) return;
      if (window.scrollY > 0 || document.body.style.overflow === "hidden") return;
      if (shouldIgnore(e.target)) return;
      startY.current = e.touches[0].clientY;
    };
    const onMove = (e) => {
      if (startY.current == null) return;
      if (e.touches.length !== 1 || window.scrollY > 0) { startY.current = null; pullRef.current = 0; setPull(0); return; }
      const dy = e.touches[0].clientY - startY.current;
      const p = dy > 0 ? Math.min(MAX_PULL, dy * 0.5) : 0;
      pullRef.current = p;
      setPull(p);
    };
    const onEnd = async () => {
      if (startY.current == null) return;
      startY.current = null;
      const p = pullRef.current;
      pullRef.current = 0;
      if (p < THRESHOLD) { setPull(0); return; }
      setRefreshing(true);
      setPull(THRESHOLD);
      await Promise.race([flushBeforeReload(), new Promise((r) => setTimeout(r, 4000))]);
      window.location.reload();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      html.style.overscrollBehaviorY = prev;
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [refreshing]);

  if (!pull && !refreshing) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div aria-live="polite" className="fixed left-1/2 top-0 z-[9998] pointer-events-none"
      style={{ transform: `translate(-50%, ${Math.round(pull - 36)}px)`, transition: startY.current == null ? "transform .2s ease" : "none" }}>
      <div className="w-9 h-9 rounded-full bg-white shadow-lg ring-1 ring-gray-200 flex items-center justify-center text-indigo-600">
        {refreshing ? (
          <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-label="Refreshing">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-label={ready ? "Release to refresh" : "Pull to refresh"}
            className="transition-transform duration-150" style={{ transform: `rotate(${ready ? 180 : Math.round((pull / THRESHOLD) * 180)}deg)` }}>
            <path d="M12 5v14M6 13l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

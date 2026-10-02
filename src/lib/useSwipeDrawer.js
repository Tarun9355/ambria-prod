import { useEffect, useRef } from "react";

// ─── Swipe to open / close a left-hand nav drawer (phones) ────────────────────
// A quick, mostly-horizontal swipe: left → right opens, right → left closes. It is not tied to
// the screen edge on purpose — iPhone Safari already uses an edge swipe for "Back", so an
// edge-only gesture would keep navigating away instead of opening the menu.
//
// Opening is skipped when the swipe is really something else: a touch inside something that
// scrolls sideways (a wide table, a chip row), on a form field, inside an overlay (modal, camera,
// sheet — all position:fixed), or while a modal has locked page scroll. Closing works anywhere,
// since the drawer itself is the overlay. Only below `maxWidth` (the lg breakpoint, where the
// drawer exists).

const MIN_DX = 60;        // px of horizontal travel
const MAX_MS = 700;       // a swipe, not a slow drag

function blocksOpen(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    const cs = getComputedStyle(n);
    if (cs.position === "fixed") return true;
    if (n.scrollWidth > n.clientWidth + 1 && (cs.overflowX === "auto" || cs.overflowX === "scroll")) return true;
  }
  return false;
}

export function useSwipeDrawer({ open, onOpen, onClose, maxWidth = 1023 }) {
  const openRef = useRef(open);
  openRef.current = open;
  const cb = useRef({ onOpen, onClose });
  cb.current = { onOpen, onClose };

  useEffect(() => {
    let start = null;
    const onStart = (e) => {
      start = null;
      if (window.innerWidth > maxWidth || e.touches.length !== 1) return;
      if (!openRef.current && (document.body.style.overflow === "hidden" || blocksOpen(e.target))) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    };
    const onEnd = (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y, ms = Date.now() - start.at;
      start = null;
      if (ms > MAX_MS || Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0 && !openRef.current) cb.current.onOpen();
      else if (dx < 0 && openRef.current) cb.current.onClose();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [maxWidth]);
}

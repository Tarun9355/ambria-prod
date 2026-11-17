import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fitUrl } from "../../lib/studio/thumb.js";

// A function's venue layout (floor plan), full screen over everything: Build's Layout chip opens it to check the upload,
// Deal Check's Layout button to read it. One per function on a multi-function deal, each under its function's name.
// layouts: [{ key, label, url }]. actions: optional extra buttons under each layout (Build's Replace / Remove).
export default function LayoutViewer({ layouts = [], onClose, actions = null }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Drawn on document.body, not where it is used: inside Deal Check (a transformed, stacked overlay) a fixed layer is placed and
  // clipped by that overlay, and the layout showed cut off under its header. On the body it covers the whole screen.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Layout" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(16,14,30,0.82)", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", padding: "56px 16px 24px" }}>
      <button type="button" onClick={onClose} aria-label="Close layout"
        style={{ position: "fixed", top: 14, right: 16, width: 36, height: 36, borderRadius: 18, border: "1px solid rgba(255,255,255,0.35)", background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" }}>×</button>
      {layouts.map((l) => (
        <div key={l.key} onClick={(e) => e.stopPropagation()} style={{ width: "min(1100px, 100%)", marginBottom: 22 }}>
          {l.label && <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{l.label}</div>}
          <a href={l.url} target="_blank" rel="noreferrer" title="Open the full-size image in a new tab" style={{ display: "block" }}>
            <img src={fitUrl(l.url, 1100)} alt={l.label ? `Layout — ${l.label}` : "Layout"} decoding="async"
              style={{ display: "block", width: "100%", maxHeight: "78vh", objectFit: "contain", background: "#fff", borderRadius: 10 }}
              onError={(e) => { if (e.currentTarget.src !== l.url) e.currentTarget.src = l.url; }} />
          </a>
          {actions && <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>{actions(l)}</div>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// Deal Check's "Layout" button (owner ask 2026-11-17): the venue layout(s) uploaded in Build, one per function that has one,
// opened full screen. Nothing when no function has a layout.
export function LayoutButton({ layouts = [], border = "rgba(26,26,46,0.15)" }) {
  const [open, setOpen] = useState(false);
  if (!layouts.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={layouts.length > 1 ? `The venue layouts of ${layouts.length} functions` : "The venue layout uploaded in Build"}
        style={{ height: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${border}`, background: "transparent", color: "#1A1A2E", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
        📐 {layouts.length > 1 ? `Layouts (${layouts.length})` : "Layout"}
      </button>
      {open && <LayoutViewer layouts={layouts} onClose={() => setOpen(false)} />}
    </>
  );
}

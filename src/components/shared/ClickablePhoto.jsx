import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { thumbUrl, fitUrl } from "../../lib/studio/thumb.js";

// The big photo for a card's thumbnail: a screen-sized copy (photos are stored at camera resolution,
// 2–4 MB), with a "Loading…" note until it arrives and a fall-back to the original if the resized
// copy cannot be made.
const bigSrc = (src) => fitUrl(src, 700, 75);

function BigPhoto({ src, alt, style }) {
  const [ready, setReady] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minWidth: ready ? 0 : 220, minHeight: ready ? 0 : 160 }}>
      {!ready && <span style={{ position: "absolute", color: "rgba(255,255,255,0.7)", fontSize: 13 }}>Loading photo…</span>}
      <img src={bigSrc(src)} alt={alt} onLoad={() => setReady(true)}
        onError={(e) => { if (e.currentTarget.src !== src) e.currentTarget.src = src; else setReady(true); }}
        style={{ ...style, opacity: ready ? 1 : 0, transition: "opacity .2s" }} />
    </div>
  );
}

// A "replace this photo" button for the viewer: picks a file, hands it to action.onFile(file) (which does
// the upload and saves the new URL itself), then closes the viewer — the photo on screen is the old one.
function ReplaceButton({ action, onDone }) {
  const [busy, setBusy] = useState(false);
  return (
    <label style={{ display: "block", marginTop: 14, textAlign: "center", padding: "9px 12px", borderRadius: 8, background: busy ? "#9ca3af" : "#4f46e5", color: "#fff", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
      {busy ? "Uploading…" : (action.label || "Replace photo")}
      <input type="file" accept="image/*" style={{ display: "none" }} disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        setBusy(true);
        try { await action.onFile(file); onDone(); } finally { setBusy(false); e.target.value = ""; }
      }} />
    </label>
  );
}

// Full-screen photo with the item's details beside it. items: [{ src, name, details: [[label, value], …], action?: { label, onFile },
// pick?: { label, onClick, disabled?, note?, keepOpen? } }] — `pick` is a plain button under the details (e.g. "Add to Stage"); it
// runs onClick and closes the viewer, unless keepOpen (a toggle the person may press on several photos in a row).
// ‹ › / arrow keys step through the set; Escape or a click outside closes it — and only it (the picker
// underneath stays open).
export function PhotoLightbox({ items, start = 0, onClose }) {
  const [idx, setIdx] = useState(start);
  const n = items.length;
  const cur = items[idx] || {};
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
      else if (n > 1 && e.key === "ArrowRight") { e.preventDefault(); setIdx((i) => (i + 1) % n); }
      else if (n > 1 && e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => (i + n - 1) % n); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [n, onClose]);
  useEffect(() => {
    if (n < 2) return;
    [1, n - 1].forEach((d) => { const it = items[(idx + d) % n]; if (it?.src) new Image().src = bigSrc(it.src); });
  }, [idx, n, items]);
  const navBtn = (side) => ({
    position: "absolute", [side]: 12, top: "50%", transform: "translateY(-50%)", width: 46, height: 46, borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.25)", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 24, lineHeight: 1,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none",
  });
  const hasDetails = cur.details?.length > 0 || !!cur.action || !!cur.pick;
  return createPortal(
    <div className="ui-overlay-in" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}>
      <span onClick={onClose} style={{ position: "absolute", top: 16, right: 20, fontSize: 30, lineHeight: 1, color: "#fff", cursor: "pointer", fontWeight: 300 }}>×</span>
      {n > 1 && <span title="Previous (←)" onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + n - 1) % n); }} style={navBtn("left")}>{"‹"}</span>}
      {n > 1 && <span title="Next (→)" onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % n); }} style={navBtn("right")}>{"›"}</span>}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "stretch", gap: 16, maxWidth: "94vw", maxHeight: "86vh", overflowY: "auto", cursor: "default" }}>
        <BigPhoto key={cur.src} src={cur.src} alt={cur.name || ""}
          style={{ maxWidth: hasDetails ? "min(62vw,100%)" : "88vw", maxHeight: "84vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }} />
        {hasDetails && (
          <div style={{ width: 270, flexShrink: 0, alignSelf: "center", background: "rgba(255,255,255,0.97)", color: "#1a1a2e", borderRadius: 10, padding: "16px 18px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, lineHeight: 1.25 }}>{cur.name}</div>
            {(cur.details || []).map(([label, value]) => (
              <div key={label} style={{ marginBottom: 9 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a8aa0" }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35 }}>{value}</div>
              </div>
            ))}
            {cur.action && <ReplaceButton action={cur.action} onDone={onClose} />}
            {cur.pick && (
              <>
                <button type="button" disabled={!!cur.pick.disabled} onClick={() => { cur.pick.onClick(); if (!cur.pick.keepOpen) onClose(); }}
                  style={{ display: "block", width: "100%", marginTop: 14, padding: "10px 12px", borderRadius: 8, border: "none", background: cur.pick.disabled ? "#9ca3af" : "#7C3AED", color: "#fff", fontSize: 13, fontWeight: 700, cursor: cur.pick.disabled ? "not-allowed" : "pointer" }}>
                  {cur.pick.label}
                </button>
                {cur.pick.note && <div style={{ marginTop: 8, fontSize: 11.5, color: "#8a8aa0", textAlign: "center" }}>{cur.pick.note}</div>}
              </>
            )}
          </div>
        )}
      </div>
      {n > 1 && <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.75)", fontSize: 13 }}>{idx + 1} / {n}</div>}
    </div>,
    document.body
  );
}

// A thumbnail that opens its full photo, with details, on click. Clicking it never reaches the card
// it sits in (so it does not also pick / select the item).
// `set` (optional): [{ src, name, details }] — the photos of every card in the list this thumbnail belongs to;
// the viewer then opens on this card's (startIndex) and ‹ › walk to the neighbouring cards' photos, each with
// its own details. Without it, ‹ › walk this item's own extra photos (if it has any).
export default function ClickablePhoto({ src, photos, thumbSize = 120, alt = "", style, className, name, details, action, set: listSet, startIndex = 0, children }) {
  const [open, setOpen] = useState(false);
  const own = [...new Set([src, ...(photos || [])].filter(Boolean))];
  const hasList = Array.isArray(listSet) && listSet.length > 0;
  return (
    <>
      <img src={thumbUrl(src, thumbSize)} alt={alt} decoding="async" title="Click to see the full photo"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }} className={className} style={{ ...style, cursor: "zoom-in" }} />
      {open && <PhotoLightbox items={hasList ? listSet : own.map((s) => ({ src: s, name, details, action }))} start={hasList ? Math.max(0, startIndex) : 0} onClose={() => setOpen(false)} />}
      {children}
    </>
  );
}

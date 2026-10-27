import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { withSetupSlot } from "../../lib/studio/dihariWindows.js";
import { fmt } from "../../lib/format";
import { mpDayWise, mpBaseDay, mpEffDay, mpEffWindows, mpLineCost, mpDayCost, mpDayDihari, aggregateEventManpower, isLiveEventOrder, phone10, walkKitUnits } from "../../lib/ims/helpers";
import { uploadAudioToStorage } from "../../lib/storage";
import { DEPTS as SHARED_DEPTS, catToDept as sharedCatToDept, userDepartments } from "../../lib/ims/deptClassify";
import { TabsMenu, useConfirm } from "../../components/ui";
import { IconPrinter } from "../../components/icons";
import { hasIMSPerm } from "../../lib/ims/constants";
import { fetchOpsExpenses } from "../../lib/ims/opsExpenses";
import { ZONE_META, trussBaseArea, CARPET_OFF } from "../../lib/studio/taxonomy";
import { prefsOf, floorSqftOf } from "../../lib/studio/carpetPrefs";
import { carpetFloorsOf, planCarpets, carpetKey, carpetStockFor, validDecision } from "../../lib/ims/carpetPlan";
import CarpetPickerModal from "./CarpetPickerModal.jsx";
import ElementChoicePlan from "./ElementChoicePlan.jsx";
import { planElements, elementStockFor, elementKey } from "../../lib/ims/elementPlan";
import { loadOnDate } from "../../lib/ims/loadByDate";
import { elementChoices } from "../../lib/studio/elementPrefs";
import { orderZoneKeys } from "../../lib/ims/zoneOrder";
import { calcZoneTrussPreview, calcZoneFabric, dcFabricMultOf } from "../../lib/studio/pricing";
import { ZONE_DEF_SK, RC_SK_TR } from "../../lib/studio/keys";
import { LOGO_ASSET, LOGO_BOX } from "../../lib/studio/brand.js";
import { thumbUrl, fitUrl } from "../../lib/studio/thumb.js";
import { matchFlowerPattern, resolveSizeKey, sizeClassToPatternKey, resolveMandiFlower } from "../../lib/ims/flowerHelpers";
import { swatchHexFor } from "../../lib/studio/colours";
import PlanningSyncButton from "./PlanningSyncButton.jsx";
import FabricBlock from "./FabricBlock.jsx";
import { buildFabricGroups } from "../../lib/ims/fabricGroups";
import { buildEventSwap, swappedRecipeFlower } from "../../lib/ims/mandiSwap";

// ── THE OFFICIAL LOGO, READY FOR THE PDF ──
// ambria-logo.png is a WHITE wordmark with a gold dot and gold "DESIGN & DECOR", on a transparent
// canvas mostly made of padding. Returns two data URLs, both cropped to the mark (LOGO_BOX):
//   light — as supplied, for the cover photo;
//   dark  — the white strokes recoloured near-black, gold untouched, for cream pages where a
//           white mark would vanish.
// Data URLs, so html2canvas draws them with no CORS round-trip. Resolves nulls on any failure and
// the report falls back to the text wordmark.
const loadPdfLogos = () => new Promise((resolve) => {
  if (!LOGO_ASSET) { resolve({ light: null, dark: null }); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const W = 1000, H = Math.round(W * LOGO_BOX.ch / LOGO_BOX.cw);
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, LOGO_BOX.x, LOGO_BOX.y, LOGO_BOX.cw, LOGO_BOX.ch, 0, 0, W, H);
      const light = c.toDataURL("image/png");
      const px = ctx.getImageData(0, 0, W, H);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        // White / near-white (and its anti-aliased greys) → ink. Gold has a low blue channel, so
        // it never passes this test and keeps its colour.
        if (d[i + 3] > 0 && d[i] > 170 && d[i + 1] > 170 && d[i + 2] > 170) { d[i] = 26; d[i + 1] = 26; d[i + 2] = 26; }
      }
      ctx.putImageData(px, 0, 0);
      resolve({ light, dark: c.toDataURL("image/png") });
    } catch { resolve({ light: null, dark: null }); }
  };
  img.onerror = () => resolve({ light: null, dark: null });
  img.src = LOGO_ASSET;
});
// ── THE ZONE PAGE'S DOT TILE, AS A PNG ──
// The faint gold dot grid behind each zone page was an SVG data URL. Older WebKit (iOS 14 and
// below, still on the crew's older phones) taints a canvas the moment an SVG image is drawn into
// it, so html2canvas could draw the page but toDataURL then threw "The operation is insecure" —
// for every zone page, photos or not, since the dots are on all of them. A PNG tile drawn here
// looks the same and never taints. Drawn at 2x and shown at 18px so it stays crisp at the export's
// 1.5x scale. Falls back to the SVG if a canvas is unavailable.
const DOT_TILE_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Ccircle cx='3' cy='3' r='1.1' fill='%23B8935A' fill-opacity='.32'/%3E%3C/svg%3E";
let dotTileOnce = null;
const dotTileUrl = () => {
  if (dotTileOnce) return dotTileOnce;
  try {
    const c = document.createElement("canvas"); c.width = 36; c.height = 36;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(184,147,90,0.32)";
    ctx.beginPath(); ctx.arc(6, 6, 2.2, 0, Math.PI * 2); ctx.fill();
    dotTileOnce = c.toDataURL("image/png");
  } catch { dotTileOnce = DOT_TILE_SVG; }
  return dotTileOnce;
};
// The logo never changes between exports, so it is cropped and recoloured once per session —
// it used to be redone on every Download / View deck press.
let pdfLogosOnce = null;
const loadPdfLogosOnce = () => (pdfLogosOnce ||= loadPdfLogos());

// ── jsPDF + html2canvas, FETCHED ONCE AND KEPT ──
// They are split into their own chunk, fetched on first use. A deploy replaces every hashed file on
// GitHub Pages, so a tab opened before it asks for a chunk name that no longer exists — "Failed to
// fetch dynamically imported module", and the export fell through to the HTML download. The tab
// warms this on mount (see the effect in the component), and a module once loaded is held by the
// browser for the life of the page, so a later deploy can no longer break the buttons. A failed
// fetch is not cached, so the next press tries again.
let pdfLibsOnce = null;
const loadPdfLibs = () => (pdfLibsOnce ||= Promise.all([import("jspdf"), import("html2canvas")]).catch((e) => { pdfLibsOnce = null; throw e; }));
// Chrome / Firefox / Safari each word the missing-chunk failure differently.
const isStaleChunk = (e) => /dynamically imported module|Importing a module script failed/i.test(String(e?.message || e));
const reloadForUpdate = () => { alert("Ambria was just updated. The page will reload — press the button again once it has."); window.location.reload(); };

// ── WHY EXPORTED TEXT SAT LOW, AND THE FIX ──
// html2canvas 1.4.1 draws each run of text at `bounds.top + baseline`, where the baseline comes
// from its FontMetrics — measured in the GLOBAL `document` (this app page), not in the report's
// iframe where the webfonts actually live, then rounded to whole px and padded by a hard-coded
// +2. So every line of text in the PDF landed 1–3px below where the browser draws it on a test
// machine, and ~5px on the owner's (it depends on which fonts the app page has and on zoom).
// That is why the pills, card badges and Qty/Size rows kept looking off-centre in the file while
// looking right on screen, and why CSS nudges never held: the error is not a constant.
// The cure is to correct it where it happens: while an export runs, fillText on html2canvas's own
// (detached) canvases is shifted by the exact difference between the baseline html2canvas
// computed — recomputed here the same way it does — and the true one measured in the report doc.
// Measured across 90–150% zoom this puts every text within ~1px of the on-screen layout.
// Returns the restore function; it MUST be called when the export ends.
const H2C_TINY_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const fixH2cTextBaseline = (reportDoc) => {
  const proto = window.CanvasRenderingContext2D?.prototype;
  if (!proto || !reportDoc?.body) return () => {};
  const orig = proto.fillText;
  const cache = new Map();
  // Baseline from the top of the text's box: as html2canvas measures it (its own recipe, in its
  // own document, integer offsets and all), and as the report's document really lays it out.
  const measure = (d, font, family, size, exact) => {
    const box = d.createElement("div"), img = d.createElement("img"), span = d.createElement("span");
    box.style.visibility = "hidden"; box.style.margin = "0"; box.style.padding = "0"; box.style.whiteSpace = "nowrap";
    img.src = H2C_TINY_IMG; img.width = 1; img.height = 1; img.style.margin = "0"; img.style.padding = "0"; img.style.verticalAlign = "baseline";
    span.style.margin = "0"; span.style.padding = "0";
    if (exact) { box.style.position = "absolute"; box.style.left = "-9999px"; box.style.top = "0"; box.style.font = font; span.style.font = font; }
    else { box.style.fontFamily = family; box.style.fontSize = size; span.style.fontFamily = family; span.style.fontSize = size; }
    span.appendChild(d.createTextNode("Hidden Text"));
    box.appendChild(span); box.appendChild(img);
    d.body.appendChild(box);
    const b = exact ? img.getBoundingClientRect().bottom - span.getBoundingClientRect().top : img.offsetTop - span.offsetTop + 2;
    d.body.removeChild(box);
    return b;
  };
  const shift = (font) => {
    if (cache.has(font)) return cache.get(font);
    let dy = 0;
    try {
      const m = /(\d*\.?\d+)px\s+(.+)$/.exec(font);
      if (m) {
        const drawn = measure(document, font, m[2], m[1] + "px", false);
        const truth = measure(reportDoc, font, m[2], m[1] + "px", true);
        // A wild value means a measurement went wrong — draw it as html2canvas would rather than move text far.
        if (Number.isFinite(drawn) && Number.isFinite(truth) && Math.abs(truth - drawn) < 12) dy = truth - drawn;
      }
    } catch { dy = 0; }
    cache.set(font, dy);
    return dy;
  };
  // Only html2canvas's canvases: they are never attached to the page, so a chart or anything else
  // drawing text on a visible canvas meanwhile is left alone.
  proto.fillText = function (text, x, y, ...rest) {
    const dy = this.textBaseline === "alphabetic" && this.canvas && !this.canvas.isConnected ? shift(this.font) : 0;
    return orig.call(this, text, x, y + dy, ...rest);
  };
  return () => { proto.fillText = orig; };
};
import { kvGet } from "../../lib/ims/kv";

// ── THE SUMMARY TILE ROW ──
// auto-FIT, not auto-fill. The difference only shows when there are fewer tiles than columns
// that would fit: auto-fill keeps the empty tracks and they take up space, so five tiles in a
// six-column row left a tile-sized hole on the right; auto-fit collapses the empty ones and the
// real tiles stretch to fill the width.
// This was auto-fill on purpose once, to keep the tiles column-aligned with the income CARDS
// above them. Those cards became a single readout panel, so there is no second grid left to
// line up with and the trade no longer buys anything.
// Two fixed columns on a phone, auto-fit from sm up.
//
// It cannot be one rule: auto-fit picks the column count from a MINIMUM width, and the minimum
// that yields two columns at 390px (~150px) yields six on a 1200px desktop — far too many for
// tiles this size. So the phone count is stated outright and auto-fit takes over only where it
// gives a sensible answer. Written as classes rather than the inline style this replaces because
// an inline style has no breakpoints.
const GRID = "grid gap-3 sm:gap-4 items-stretch grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(212px,1fr))]";
// ── GLASS SURFACE ──
// The Planning page lays soft colour fields behind itself (PlanningTab); these top-level cards
// frost over them: translucent white, a strong backdrop blur with a little extra saturation so
// the colour reads through as a tint rather than as grey, and a white hairline for the pane's
// edge. Only the page-level cards take it — content inside a card stays on solid white so text
// and inputs keep full contrast.
// PAINTED, not sampled: no backdrop-filter. A live backdrop blur on in-flow cards made Safari
// (Mac and iPhone) re-sample it on every scroll frame, and the tiles' hover lift made it drop out
// and snap back — the flicker. A translucent white over the page's soft colour glow keeps the glass
// look (the tint still shows through) without asking the browser to blur anything.
const GLASS = "bg-white/75 ring-1 ring-white/80";

/* ── THE CARD'S ICONS ──
   Drawn, not emoji, and only for the event header card the design system specifies. Emoji were
   fine as block markers — each block needs to be told apart at a glance and an emoji does that
   in one character — but they cannot take a colour or a stroke weight, and this card's icons
   have to go blue when their tag is active and grey when it is not. Each inherits currentColor
   and sits on a 16px box, so the caller sets both by setting text colour and nothing else.
   Kept at module scope: they close over nothing, so redefining them on every render of a
   2700-line component would allocate three functions per keystroke for no reason. */
/* A glyph for a crew line, matched on the type NAME rather than an id, because crew types are
   free text a salesperson types in Studio — "Labours", "Labour", "Helpers" all arrive. Matching
   on a substring means a new wording still lands on the right picture, and anything unrecognised
   falls back to a generic person rather than to a wrong one. */
function crewIcon(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("superv") || t.includes("manager") || t.includes("incharge")) return "🧑‍💼";
  if (t.includes("driver")) return "🚚";
  if (t.includes("carpenter") || t.includes("tech") || t.includes("electric")) return "🔧";
  if (t.includes("labour") || t.includes("labor") || t.includes("helper") || t.includes("crew")) return "👷";
  return "👤";
}

/* One figure under its own column label, for the inventory rows. Fixed widths from sm up, so a
   kit's components line up under the kit's own qty / rate / total — the components sum to the kit
   line, and that comparison is most of the reason the contents can be opened at all. Below sm the
   three share the row equally instead, because fixed columns plus a name do not fit 390px. */
// The label repeats on every single card below sm (phone width, where cards stack and there's no
// shared row for a header to sit above) but is hidden from sm up, where the inventory-blocked list
// now has ONE sticky header row instead — repeating it on every card there was the exact "confusing"
// the header replaces.
const StatCell = ({ label, w, children }) => (
  <div className={"flex-1 sm:flex-none text-right " + w}>
    <div className="sm:hidden text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 leading-none">{label}</div>
    <div className="mt-1 sm:mt-0">{children}</div>
  </div>
);
const STAT_W = { qty: "sm:w-16", rentalQty: "sm:w-20", rate: "sm:w-20", total: "sm:w-24" };

/* Page with a down-arrow: a document you take away, which is what the export produces. Not a
   printer glyph — the print dialog is how it is saved, not what it is for. */
const IconDownload = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9.2 1.8H4.4a1.4 1.4 0 0 0-1.4 1.4v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.6L9.2 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 2v3.4h3.6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 7.6v4m0 0L6.4 10M8 11.6 9.6 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* An eye: look at the report, not take it away — the download icon beside it is the take-away. */
const IconEye = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.6 8S4 3.6 8 3.6 14.4 8 14.4 8 12 12.4 8 12.4 1.6 8 1.6 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const IconBell = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6c0 2.7-1 3.6-1 3.6h9.2s-1-.9-1-3.6A3.6 3.6 0 0 0 8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M6.7 11.6a1.4 1.4 0 0 0 2.6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const IconClipboard = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2.75" y="3.25" width="10.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2.75 6.25h10.5M5.75 2v2.5M10.25 2v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const IconTruck = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.75 4.5h7v6.25h-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M8.75 7h2.6l2.9 2.2v1.55h-5.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <circle cx="4.75" cy="11.75" r="1.25" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11.25" cy="11.75" r="1.25" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

// One glyph per income head, keyed on the label the rows are built with (see `rows` in the
// readout). Keyed on the label rather than an index so reordering the heads — or a department
// that only has some of them — cannot silently shift every icon by one. Anything unmapped falls
// back to a dot, which is a neutral placeholder rather than a wrong picture.
const HEAD_ICON = {
  "Inventory rental": "📦",
  "Truss": "🏗️",
  "Fabric / draping": "🧵",
  "Real flowers (mandi)": "🌷",
  "Artificial flowers": "🌸",
  "Manpower": "👥",
  "Production": "🏭",
  "Buying": "🛒",
  "Transport": "🚚",
};

// "2h ago" for the activity log. Relative reads faster than a date when the question is
// "did this change since I last looked" — which is the only question this log answers. It stops
// being useful past a week, so beyond that it falls back to the actual date, and the exact
// timestamp is always kept on the element's title so nothing is lost to the shorthand.
function relTime(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return "just now";          // clock skew between the writer's machine and this one
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// Small in-browser voice-note recorder → uploads to Cloudinary, hands the URL back via onSave.
// Used on-site so the ops manager can attach a spoken note to a transferred/repair item; the receiving
// site hears it before the item arrives (e.g. "front leg is loose — fix before use").
function VoiceRecorder({ value, onSave, compact = false, label = "voice note" }) {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mrRef = useRef(null), chunksRef = useRef([]), streamRef = useRef(null);
  const start = async () => {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("no mic"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        (streamRef.current?.getTracks() || []).forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setBusy(true);
        try { const url = await uploadAudioToStorage(blob); onSave(url); } catch { setErr("upload failed"); }
        setBusy(false);
      };
      mr.start(); mrRef.current = mr; setRec(true);
    } catch { setErr("mic blocked"); }
  };
  const stop = () => { try { mrRef.current?.stop(); } catch {} setRec(false); };
  // Elapsed time while recording, so the button says how long you have been talking rather than
  // just pulsing.
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!rec) return undefined;
    setSecs(0);
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  // ── A LABELLED BUTTON, DRAWN ICONS ──
  // Was a 🎤 emoji in a blue-outlined pill with no text in compact mode: the emoji renders
  // differently on every platform and, unlabelled, nothing said what it did. Now one 28px button
  // with a stroked icon and a word, in the same neutral style as the other secondary buttons, with
  // a distinct look per state — idle, recording (red, with a timer), saving, saved.
  const base = "h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors";
  const Mic = (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  if (busy) return (
    <span className={base + " text-gray-500 bg-gray-50"}>
      <span aria-hidden="true" className="w-3 h-3 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
      Saving…
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5">
      {value && !rec && !compact && <audio src={value} controls className="h-7 max-w-[130px]" />}
      {rec ? (
        <button type="button" onClick={stop} className={base + " bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100"} aria-label={`Stop recording ${label}`}>
          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
          <span className="tabular-nums">{clock}</span>
          <span className="text-red-400">·</span> Stop
        </button>
      ) : value ? (
        <button type="button" onClick={start} className={base + " bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"} title={`Re-record ${label}`}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8.5l3.25 3.25L13 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Note added
        </button>
      ) : (
        <button type="button" onClick={start} className={base + " bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900"} title={`Record ${label}`}>
          {Mic}
          Voice note
        </button>
      )}
      {/* Said in words, with the fix on hover: "mic blocked" alone left people guessing. */}
      {err && (
        <span className="text-[10px] font-medium text-red-600"
          title={err === "mic blocked" ? "Allow microphone access for this site in the browser settings. Phones only allow it on https:// pages." : undefined}>
          {err === "mic blocked" ? "Mic not allowed" : err === "no mic" ? "No mic on this device" : "Upload failed"}
        </span>
      )}
    </span>
  );
}

// ═══ DEPARTMENT OPERATIONS (Planning → Dept Ops) ═══
// Per-department backend for department heads: see their department's requirements + income for any
// event (blocked inventory with photos, manpower), override the manpower plan, and log ACTUALS
// (real mandi cost + on-site expenses) so projected cost converts to exact cost (reflected to Studio).
const DEPTS = SHARED_DEPTS;
const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
// Primary manpower types per department (for the editable crew plan).
const DEPT_MP = {
  Floral: ["Flowerists", "Labours"],
  Structure: ["Carpenters", "Labours"],
  Tenting: ["Painters", "Truss Labour", "Fabric Bangali", "Labours"],
  Fabric: ["Labours"],
  Lighting: ["Electricians", "Labours"],
  Transport: ["Drivers"],
  Furniture: ["Labours"],
};

// Suggested essential tools per department — one-tap to add to the reusable template.
const DEFAULT_TOOLS = {
  Floral: ["Ladder", "Tripal", "Buckets", "Oasis", "Scissors", "Binding wire", "Cutter"],
  Fabric: ["Nails", "Hammer", "Stapler + pins", "Safety pins", "Needle & thread", "Scissors"],
  Tenting: ["Ropes", "Hammer", "Spanner set", "Cable ties", "Tripal"],
  Structure: ["Drill machine", "Screws", "Spanner set", "Nuts & bolts", "Spirit level"],
  Lighting: ["Extension boards", "Cable ties", "Line tester", "Insulation tape", "Bulbs spare"],
  Transport: ["Ropes", "Tarpaulin", "Trolley", "Straps"],
  Furniture: ["Trolley", "Covers", "Cleaning cloth", "Cushion spares"],
};

// ── PAINT AND PRINT, AS THE BUILD ASKED FOR THEM ──
// Neither survives Deal Check's department snapshot: a held row is only "Wooden Arch x6", and the
// print row only "🖨 Print / signage" with a count of jobs. The build itself (functionsDetail) still
// carries both — each element's paintAllocation (or the legacy single paintOverride) and each
// zone's prints — so the inventory list and the PDF read them from there.
// Paint is the same rule Studio's normalizePaintAllocation uses: a colour equal to the item's own
// base colour (Ivory when unset) is no repaint. It is keyed by inventory id and by name, matched
// to a held row the same way invFnQty matches quantities.
const paintText = (m) => (m ? [...m].map(([c, q]) => `${c} ×${q}`).join(", ") : "");
const elPaint = (el, inv) => {
  const base = String(inv?.baseColour || "Ivory");
  const allocs = Array.isArray(el?.paintAllocation) && el.paintAllocation.length
    ? el.paintAllocation.map(a => ({ qty: Number(a?.qty) || 0, colour: String(a?.colour || "") }))
    : el?.paintOverride ? [{ qty: Number(el?.qty) || 0, colour: String(el.paintOverride) }] : [];
  return allocs.filter(a => a.qty > 0 && a.colour && a.colour !== base);
};
const addPaint = (m, allocs) => { allocs.forEach(a => m.set(a.colour, (m.get(a.colour) || 0) + a.qty)); return m; };
function buildFinish(fnList, inventory, printMaterials) {
  const invMap = new Map((inventory || []).map(i => [String(i.id), i]));
  const paintById = new Map(), paintByName = new Map(), prints = [];
  const add = (m, k, allocs) => { if (k && allocs.length) m.set(k, addPaint(m.get(k) || new Map(), allocs)); };
  const fns = (fnList || []).filter(Boolean);
  fns.forEach((fd, fi) => {
    const on = (zk) => !(fd.enabledEls && fd.enabledEls[zk] === false);
    Object.entries(fd.elements || {}).forEach(([zk, els]) => {
      if (!on(zk)) return;
      (Array.isArray(els) ? els : []).forEach(el => {
        const id = el?.invId || el?.imsId;
        const inv = id ? invMap.get(String(id)) : null;
        const allocs = elPaint(el, inv);
        if (id) add(paintById, String(id), allocs);
        add(paintByName, String(el?.name || inv?.name || "").trim().toLowerCase(), allocs);
      });
    });
    Object.entries(fd.zones || {}).forEach(([zk, z]) => {
      if (!on(zk)) return;
      (Array.isArray(z?.prints) ? z.prints : []).forEach(p => {
        const w = Number(p?.areaW) || 0, d = Number(p?.areaD) || 0;
        if (!(w > 0 && d > 0)) return; // an untouched blank row
        const m = (Array.isArray(printMaterials) ? printMaterials : []).find(x => x && x.id === p.material);
        // Build's print row can name the inventory item it goes on and carry a reference image of
        // the artwork — the "which" and the "what" of the job.
        const onInv = p.invId ? invMap.get(String(p.invId)) : null;
        const ref = String(p.refImageUrl || "").trim();
        prints.push({
          on: onInv?.name || "",
          ref: /^https?:\/\//i.test(ref) ? ref : "",
          material: m?.name || String(p.material || "Print"),
          size: `${w} x ${d} ft`,
          qty: Math.max(1, Math.round(Number(p.qty) || 1)),
          zone: fd.zoneNames?.[zk] || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          fn: fns.length > 1 ? [fd.type || `Function ${fi + 1}`, fd.date].filter(Boolean).join(" · ") : "",
        });
      });
    });
  });
  const paintFor = (row) => paintText((row?.invId && paintById.get(String(row.invId))) || paintByName.get(String(row?.name || "").trim().toLowerCase()));
  const printLine = (p) => `${p.material} · ${p.size}${p.qty > 1 ? ` ×${p.qty}` : ""}${p.on ? ` on ${p.on}` : ""} — ${p.zone}${p.fn ? ` (${p.fn})` : ""}`;
  return { paintFor, prints, printLine };
}

// ── Deal Check's "Department Income" table, in IMS ──
// Same layout as the modal in Deal Check (a chip per department with its total, then the chosen department's
// lines and its share of the project), read from the snapshot Deal Check pushed to this event. Under it, how
// the blocked-inventory list for that department adds up.
const INCOME_LINES = [["📦 Inventory rental", "rental"], ["🌸 Floral (mandi)", "florals"], ["🏗️ Truss", "truss"], ["🧵 Fabric / draping", "fabric"], ["👷 Manpower", "manpower"], ["🏭 Production", "production"], ["🛒 Buying", "buying"], ["🚚 Transport", "transport"]];
function invCalcSummary(rows) {
  const t = { full: 0, dateAdj: 0, disc: 0, short: 0, other: 0, total: 0, dms: new Set(), hasCalc: false };
  rows.forEach(r => {
    const tot = Number(r.total) || 0;
    t.total += tot;
    if (r.calc) { t.hasCalc = true; t.full += r.calc.full; t.dateAdj += r.calc.dateAdj; t.disc += r.calc.disc; t.short += r.calc.short; (r.calc.dms || []).forEach(d => t.dms.add(d)); }
    else t.other += tot;
  });
  return t;
}
// ── Deal Check's Florals tab, in IMS (Floral department only) ──
// Read from `floralDetail`, the per-function figures Deal Check pushes with the department snapshot (see
// calcFnFloralDetail in StudioApp). Same sections as the tab: header, mandi list (with how each flower's quantity
// builds up), artificial bunches, direct-from-inventory pieces, elements not costed as florals, per-element table.
function FloralDetailView({ detail }) {
  const keys = Object.keys(detail || {});
  const [fk, setFk] = useState(keys[0]);
  const [open, setOpen] = useState({});
  const f = detail?.[fk] || detail?.[keys[0]];
  if (!f) return null;
  const rupee = (n) => "₹" + Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-IN");
  const realPct = f.total > 0 ? Math.round((f.real / f.total) * 100) : 0;
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const A = f.art || {};
  const side = (label, tone, x) => {
    const disc = x.bunchesFull > x.bunches + 0.05;
    return (
      <div className={"rounded-md px-2.5 py-2 " + (tone === "pink" ? "bg-pink-50" : "bg-emerald-50")}>
        <div className={"text-[12px] font-semibold mb-1 " + (tone === "pink" ? "text-pink-600" : "text-emerald-600")}>{label}</div>
        <div className="text-[13px] text-[#1A1A2E] tabular-nums">
          {disc && <span className="line-through opacity-40 mr-1.5">{x.bunchesFull.toFixed(1)} bunches</span>}
          <span className={disc ? "text-emerald-600 font-bold" : ""}>{x.bunches.toFixed(1)} bunches</span> = {x.kg} kg
        </div>
        <div className="text-[11px] text-[#1A1A2E] mt-0.5">× ₹{x.rate}/kg = {disc && <span className="line-through opacity-40 mr-1">{rupee(x.costFull)}</span>}<span className={"font-semibold " + (tone === "pink" ? "text-pink-600" : "text-emerald-600")}>{rupee(x.cost)}</span></div>
      </div>
    );
  };
  const card = "rounded-xl border bg-white px-4 py-3.5";
  const head = "text-[13px] font-bold tracking-[0.04em] uppercase";
  return (
    <div className="mt-4 space-y-3.5">
      <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-pink-600">🌸 Deal Check · Florals tab</div>
      {keys.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {keys.map(k => (
            <button key={k} onClick={() => setFk(k)}
              className={"px-3 py-1.5 rounded-lg text-[12.5px] border " + (k === fk ? "border-pink-400 bg-pink-50 font-semibold text-pink-700" : "border-gray-200 text-gray-600 hover:bg-gray-50")}>
              {detail[k].fnType || `Function ${Number(k) + 1}`} · {detail[k].fnDate || "—"}
            </button>
          ))}
        </div>
      )}
      <div className={card + " border-pink-200"}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-[#1A1A2E]">{f.fnType || "Function"} · {f.fnDate || "—"}</div>
            <div className="flex items-baseline gap-3.5 flex-wrap mt-0.5">
              <span className="text-sm font-semibold text-[#1A1A2E]">Total Floral</span>
              <span className="text-[24px] font-bold text-[#1A1A2E] tabular-nums">{rupee(f.total)}</span>
              <span className="text-[12.5px] font-semibold text-emerald-600 inline-flex items-center gap-1.5"><span className="w-[7px] h-[7px] rounded-full bg-emerald-500 inline-block" />Real {rupee(f.real)}</span>
              <span className="text-[12.5px] font-semibold text-pink-600 inline-flex items-center gap-1.5"><span className="w-[7px] h-[7px] rounded-full bg-pink-500 inline-block" />Artificial {rupee(f.artificial)}</span>
            </div>
          </div>
          <div className="shrink-0 text-[12px] font-semibold text-[#1A1A2E] px-3.5 py-1.5 rounded-full border border-pink-200 whitespace-nowrap">{realPct}% real / {100 - realPct}% artificial overall</div>
        </div>
      </div>
      {f.note && (
        <div className={card + " border-purple-200"}>
          <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-purple-600 mb-1.5">📝 Floral preference for {f.fnType || "this function"}</div>
          <div className="text-[13px] text-[#1A1A2E] whitespace-pre-line">{f.note}</div>
        </div>
      )}
      <div className={card + " border-emerald-200"}>
        <div className="flex items-center justify-between mb-2">
          <span className={head + " text-emerald-600"}>🌹 Real flower mandi list ({f.mandi.length} flower{f.mandi.length === 1 ? "" : "s"})</span>
          <span className="text-sm font-bold text-emerald-600 tabular-nums">{rupee(f.real)}</span>
        </div>
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-[11.5px]">
            <th className="text-left font-semibold py-1.5">Flower</th><th className="text-right font-semibold py-1.5">Qty</th><th className="text-right font-semibold py-1.5">Rate</th><th className="text-right font-semibold py-1.5">Total</th>
          </tr></thead>
          <tbody>
            {f.mandi.map((m, i) => {
              const disc = m.buyQtyFull != null && m.buyQtyFull > m.buyQty;
              const k = "m" + i;
              return (
                <Fragment key={i}>
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5 text-[#1A1A2E]">
                      <button onClick={() => toggle(k)} className="inline-flex items-center gap-1.5 text-left hover:text-blue-700" title="How this quantity builds up">
                        <span className="text-emerald-500">●</span>{m.name}{m.colour && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">{m.colour}</span>}
                        <span aria-hidden="true" className={"text-gray-400 text-[10px] transition-transform " + (open[k] ? "rotate-90" : "")}>▸</span>
                      </button>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[#1A1A2E]" title={`Exact need ${m.need} ${m.unit}, rounded up to whole ${m.unit}s for purchase`}>
                      {disc && <span className="line-through opacity-40 mr-1.5">{m.buyQtyFull}</span>}
                      <span className={disc ? "text-emerald-600 font-bold" : ""}>{m.buyQty} {m.unit}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-[#1A1A2E]">{rupee(m.rate)}/{m.unit}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold text-[#1A1A2E]">{rupee(m.cost)}</td>
                  </tr>
                  {open[k] && (
                    <tr className="bg-slate-50"><td colSpan={4} className="px-3 py-2">
                      <div className="text-[11.5px] text-gray-500 mb-1">Exact need {m.need} {m.unit}{m.needFull != null && m.needFull > m.need ? ` (before reuse credit ${m.needFull})` : ""} → bought as {m.buyQty} whole {m.unit}{m.buyQty === 1 ? "" : "s"}</div>
                      {m.contributors.map((c, ci) => (
                        <div key={ci} className="flex justify-between gap-3 text-[12px] py-0.5">
                          <span className="text-[#1A1A2E]">{c.el}{c.zone && c.zone !== "—" ? <span className="text-gray-400"> · {c.zone}</span> : null}{c.size && c.size !== "—" ? <span className="text-gray-400"> · {c.size}</span> : null}</span>
                          <span className="tabular-nums text-gray-600">×{c.elQty} × {c.per} = <b className="text-[#1A1A2E]">{c.qty} {m.unit}</b></span>
                        </div>
                      ))}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={3} className="text-right font-semibold py-2 text-[#1A1A2E]">Real Total</td><td className="text-right font-bold text-emerald-600 py-2 tabular-nums">{rupee(f.real)}</td></tr></tfoot>
        </table>
      </div>
      <div className={card + " border-pink-200"}>
        <div className={head + " text-pink-600 mb-2"}>🌺 Artificial bunches</div>
        <div className="grid grid-cols-2 gap-3.5">
          {side("🌹 Flower bunches", "pink", A.flower || { bunches: 0, bunchesFull: 0, kg: 0, rate: 0, cost: 0, costFull: 0 })}
          {side("🌿 Green bunches", "green", A.green || { bunches: 0, bunchesFull: 0, kg: 0, rate: 0, cost: 0, costFull: 0 })}
        </div>
        {(A.mapped || []).length > 0 && (
          <div className="mt-2.5 rounded-md px-2.5 py-2 bg-blue-50 border border-blue-100">
            <div className="text-[12px] font-semibold text-blue-600 mb-1">🔗 Mapped substitutes</div>
            {A.mapped.map((m, i) => (
              <div key={i} className="flex justify-between text-[12px] py-0.5 text-[#1A1A2E]"><span>{m.realFlowerName} → {m.mappedName || "no item mapped"} × {m.qty} {m.unit}</span><span className="text-blue-600 font-semibold tabular-nums">{rupee(m.cost)}</span></div>
            ))}
          </div>
        )}
        <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-gray-200">
          <span className="text-[13px] font-medium text-[#1A1A2E]">Total Artificial</span>
          <span className="text-[15px] font-bold text-pink-600 tabular-nums">{rupee(A.total ?? f.artificial)}</span>
        </div>
      </div>
      {(f.direct || []).length > 0 && (
        <div className={card + " border-blue-200"}>
          <div className={head + " text-blue-600 mb-2"}>📦 Direct from inventory</div>
          {f.direct.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-[#1A1A2E] py-0.5">
              <span className="font-semibold">{r.name}</span><span className="opacity-70 tabular-nums">× {r.qty} {r.unit}</span>{r.rate > 0 && <span className="opacity-70 text-[11.5px]">@ {rupee(r.rate)}</span>}
              <span className="ml-auto text-blue-600 font-semibold tabular-nums">{rupee(r.cost)}</span>
            </div>
          ))}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
            <span className="text-[13px] font-medium text-[#1A1A2E]">Total from inventory</span>
            <span className="text-[15px] font-bold text-blue-600 tabular-nums">{rupee(f.direct.reduce((a, r) => a + r.cost, 0))}</span>
          </div>
          <div className="text-[11px] text-[#1A1A2E] opacity-65 mt-1.5 italic">Included in Total Artificial above — manufactured pieces charged in full, so the real/artificial blend does not scale them.</div>
        </div>
      )}
      {(f.uncosted || []).length > 0 && (
        <div className={card + " border-amber-300"}>
          <div className="text-[13px] font-bold text-amber-600 mb-1.5">⚠ {f.uncosted.length} element{f.uncosted.length === 1 ? "" : "s"} not costed as florals</div>
          {f.uncosted.map((u, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-[#1A1A2E] py-0.5">
              <span className="font-semibold">{u.name}</span><span className="opacity-70">{u.zone} · ×{u.qty}</span><span className="ml-auto text-amber-600">{u.reason}</span>
            </div>
          ))}
          <div className="text-[12px] text-[#1A1A2E] mt-1.5 italic">Add these to the Rate Card under “florals” to price them from a flower recipe. Until then they bill as rental.</div>
        </div>
      )}
      <div className={card + " border-gray-200"}>
        <div className="flex items-center justify-between mb-2">
          <span className={head + " text-[#1A1A2E]"}>📋 Per-element breakdown ({f.elements.length} element{f.elements.length === 1 ? "" : "s"})</span>
          <span className="text-sm font-bold text-[#1A1A2E] tabular-nums">{rupee(f.total)}</span>
        </div>
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-gray-200 text-gray-500 text-[11.5px]">
            <th className="text-left font-semibold py-1.5">Element</th><th className="text-right font-semibold py-1.5">Qty</th><th className="text-right font-semibold py-1.5">Real %</th><th className="text-right font-semibold py-1.5">Real ₹</th><th className="text-right font-semibold py-1.5">Artif ₹</th><th className="text-right font-semibold py-1.5">Total</th>
          </tr></thead>
          <tbody>
            {f.elements.map((e, i) => (
              <tr key={i} className="border-b border-gray-100 align-top">
                <td className="py-1.5 text-[#1A1A2E]"><div className="font-medium">{e.name}</div><div className="text-[11px] text-gray-400">{e.zones.join(", ")}</div></td>
                <td className="py-1.5 text-right tabular-nums">{e.qty}</td>
                <td className="py-1.5 text-right tabular-nums">{Math.round(e.realPct)}%</td>
                <td className="py-1.5 text-right tabular-nums text-emerald-600">{rupee(e.real)}{e.invCost > 0 && <div className="text-[10px] text-blue-500">incl. {rupee(e.invCost)} inventory</div>}</td>
                <td className="py-1.5 text-right tabular-nums text-pink-600">{rupee(e.art)}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-[#1A1A2E]">{rupee(e.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeptIncomeModal({ eo, depts, startDept, onClose }) {
  const d = startDept; // only the department this panel is for
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const inc = eo?.deptIncome || {};
  const cur = inc[d] || {};
  const grandAll = depts.reduce((s, x) => s + (Number(inc[x]?.total) || 0), 0);
  const lines = INCOME_LINES.map(([label, k]) => [label, Number(cur[k]) || 0]).filter(([, v]) => v > 0);
  const rows = Array.isArray(eo?.deptInventory?.[d]) ? eo.deptInventory[d] : [];
  const cs = invCalcSummary(rows);
  const dm = [...cs.dms];
  const calcLines = [
    ...(cs.hasCalc ? [["Base rent of the units we own", cs.full, "rate × quantity"]] : []),
    ...(cs.dateAdj !== 0 ? [[cs.dateAdj < 0 ? "Date category discount" : "Date category markup", cs.dateAdj, dm.length === 1 ? `×${dm[0]}` : "per function's date"]] : []),
    ...(cs.disc !== 0 ? [["Repeat / standing / reuse discount", cs.disc, "only the biggest one applies"]] : []),
    ...(cs.short > 0 ? [["Short stock, at production cost", cs.short, "units we have to make or buy"]] : []),
    ...(cs.other > 0 ? [["Truss, fabric, platform, print & other lines", cs.other, "quantity × rate"]] : []),
  ];
  const rupee = (n) => "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
  return (
    <div className="ui-overlay-in fixed inset-0 z-[9100] flex items-center justify-center p-5" style={{ background: "rgba(10,10,20,0.85)" }} onClick={onClose}>
      <div className={"ui-pop-in bg-white rounded-2xl border border-gray-200 w-full max-h-[88vh] flex flex-col overflow-hidden " + (d === "Floral" ? "max-w-[900px]" : "max-w-[560px]")} onClick={e => e.stopPropagation()}>
        <div className="px-[18px] py-3.5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-[14.5px] font-bold text-[#1A1A2E] tracking-wide">🏦 Department Income</div>
            <div className="text-[12px] text-[#1A1A2E] uppercase tracking-[0.08em] mt-0.5">What {d} is earning off this deal</div>
          </div>
          <button onClick={onClose} className="px-2.5 py-1.5 rounded-md border border-gray-200 text-[#1A1A2E] text-sm leading-none hover:bg-gray-50">✕</button>
        </div>
        <div className="px-[18px] py-3.5 overflow-y-auto">
          <div className="rounded-[10px] border border-gray-200 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-50 text-[13.5px] font-bold text-[#1A1A2E] flex justify-between">
              <span>{DEPT_ICON[d]} {d} — Department Income</span><span className="tabular-nums">{rupee(Number(cur.total) || 0)}</span>
            </div>
            {lines.length === 0
              ? <div className="p-4 text-center text-[13px] text-[#1A1A2E]">No income for this department in the current deal.</div>
              : lines.map(([label, v], i) => (
                <div key={i} className="flex justify-between px-3.5 py-[9px] border-t border-gray-100 text-[13.5px]">
                  <span className="text-[#1A1A2E]">{label}</span><span className="text-[#1A1A2E] font-semibold tabular-nums">{rupee(v)}</span>
                </div>
              ))}
            <div className="flex justify-between px-3.5 py-2.5 border-t border-gray-200 text-[13px] text-[#1A1A2E]">
              <span>Share of project</span><span className="font-bold text-blue-600">{grandAll > 0 ? Math.round(((Number(cur.total) || 0) / grandAll) * 100) : 0}%</span>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="rounded-[10px] border border-gray-200 overflow-hidden mt-3.5">
              <div className="px-3.5 py-2.5 bg-slate-50 text-[13.5px] font-bold text-[#1A1A2E] flex justify-between">
                <span>📦 {d} — blocked inventory, how it adds up</span><span className="tabular-nums">{rupee(cs.total)}</span>
              </div>
              {calcLines.map(([label, v, hint], i) => (
                <div key={i} className="flex justify-between gap-3 px-3.5 py-[9px] border-t border-gray-100 text-[13.5px]">
                  <span className="text-[#1A1A2E]">{label}{hint ? <span className="text-gray-400 text-[12px]"> · {hint}</span> : null}</span>
                  <span className={"font-semibold tabular-nums " + (v < 0 ? "text-emerald-700" : "text-[#1A1A2E]")}>{v < 0 ? "−" : (i > 0 ? "+" : "")}{rupee(v)}</span>
                </div>
              ))}
              {!cs.hasCalc && <div className="px-3.5 py-2 border-t border-gray-100 text-[12px] text-gray-400">This event was synced before the step-by-step breakdown existed — sync it to see base rent, date factor and discounts separately.</div>}
            </div>
          )}
          {d === "Floral" && (eo?.floralDetail
            ? <FloralDetailView detail={eo.floralDetail} />
            : <div className="mt-3.5 rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] text-gray-500 flex items-center gap-3 flex-wrap">
              <span className="flex-1 min-w-[200px]">Deal Check's Florals tab (mandi list, artificial bunches, per-element breakdown) is not saved for this event yet. It is pulled in by running Deal Check for this one event.</span>
              <PlanningSyncButton eventOrders={[eo]} onlyOrder={eo} force label="🔄 Load Deal Check details" />
            </div>)}
          <div className="text-[12px] text-[#1A1A2E] mt-2.5 leading-normal">General labour & supervisors are split across departments by each one's direct-income share. Truss steel → Tenting · masking/drape fabric → Fabric · platform & carpet → Tenting · genset → Lighting · everything else → by its category.</div>
        </div>
      </div>
    </div>
  );
}

export default function DepartmentOpsTab({ pickerSlot = null, eventOrders, setEventOrders, inventory, setInventory, blocks, settings, setSettings, trussInv, setTrussInv, authUser, amendRequests, focusEventId, focusSearch, focusLeadEntry, onFocusHandled, onGoToCalendar, autoPdfFor, onAutoPdfDone }) {
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);
  // A labour usage row belongs to the department Deal Check charged it to (ur.dept — the item's own
  // category); a plan synced before that was recorded falls back to its sub-category.
  const usageDept = (ur) => ur?.dept || catToDept(ur?.sub);
  const dihari = settings?.dihariSchemes || {};
  const [confirm, confirmDialog] = useConfirm();
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const canManpower = hasIMSPerm(authUser, "events_manpower");
  // This user's allowed departments — an explicit grant (user.departments, set in Admin -> Users &
  // Roles) if present, else the same role-name inference this screen always used (e.g. "Dept Head
  // - Tenting" -> Tenting). null = unrestricted (sees every department), same as before this
  // existed for Admin/Sales/any role that doesn't name one.
  const myDepts = useMemo(() => userDepartments(authUser), [authUser]);
  const roleDept = myDepts && myDepts.length === 1 ? myDepts[0] : null; // the common single-dept case — locks the picker to a badge, same as before
  const deptOptions = isAdmin || !myDepts ? DEPTS : DEPTS.filter((d) => myDepts.includes(d));

  const [dept, setDept] = useState(roleDept || deptOptions[0] || "Floral");
  // ── EXPORTING A DEPARTMENT THAT IS NOT THE ONE ON SCREEN ──
  // The report is built from ~25 memos keyed on `dept`, so there is no pure "build the book for
  // department X" to call: the only thing that produces X's numbers is a render with dept === X.
  // The combined export therefore switches department, waits for React to commit, and then reads
  // the builder back out of a ref. Calling buildReportHtml directly would run the closure from
  // the render that started the export — i.e. the OLD department's data under the new heading.
  const deptRef = useRef(dept);
  deptRef.current = dept;
  const buildReportRef = useRef(null);
  const [exportNote, setExportNote] = useState("");
  const [search, setSearch] = useState("");
  const [leadEntry, setLeadEntry] = useState(null); // LMS entry no of the lead we arrived from
  // Month shown by the event picker below. Starts on the current month and is nudged, once, to a
  // month that actually has events — see the effect further down.
  const _now = new Date();
  const [pickMonth, setPickMonth] = useState({ y: _now.getFullYear(), m: _now.getMonth() });
  // Which date the phone layout has open. Desktop shows every day's events in the grid at once
  // and never needs this; on a phone the grid is dates only, so one has to be chosen to list.
  const [pickDay, setPickDay] = useState(null);
  const [selId, setSelId] = useState(null);
  // True only while the PDF started from Deal Check is being built: that book shows all three carpets sales picked for a
  // floor; the PDF made here in Planning shows just the one Planning decided (the three only until it is decided).
  const pdfAllCarpetsRef = useRef(false);
  const carpetGateOpenRef = useRef(false); // the "Carpet not selected" message is on screen
  const [carpetMore, setCarpetMore] = useState(null); // key of the carpet floor whose carpet picker (modal) is open
  const [zoomImg, setZoomImg] = useState(null); // click-to-enlarge lightbox (ops needs a clear big photo)
  const [opsView, setOpsView] = useState("planning"); // "planning" | "onsite" — split on-site (receiving/dismantle) into its own view
  // The mini calendar that used to sit in this rail is gone — the IMS Calendar tab is the one
  // calendar, and clicking an event there lands here with that event already selected. Its
  // date-filter state went with it; the search box still narrows the list.
  const [mandiQuery, setMandiQuery] = useState(""); // autocomplete text for adding a mandi flower
  const [artHowOpen, setArtHowOpen] = useState(false); // expand the artificial-flower "how derived" box
  const [newTool, setNewTool] = useState(""); // text for adding an essential tool to the template
  // The activity log opens from the bell in the event header. It is a notification, not a
  // section of the page: a permanent panel meant an event with two edits pushed everything
  // below it down to say so, on every visit. Closed by default, and the bell only appears when
  // there is something to show.
  const [logOpen, setLogOpen] = useState(false);
  // ── THE CONTENT BLOCKS LIVE IN A MODAL ──
  // The page is a grid of summary tiles; opening one puts that block's full body in a dialog.
  // Six stacked blocks, several of them long tables, meant the figure you wanted was always a
  // scroll away from the figure you wanted to compare it to. `modal` holds the key of the block
  // currently showing, or null for the tile grid.
  //
  // The blocks themselves are NOT moved or re-parented to do this: they stay exactly where they
  // are in the tree, inside one container that is either hidden or promoted to a dialog, and
  // each block hides itself unless it is the open one. That keeps every block's JSX untouched —
  // no fragments to mis-close around bodies hundreds of lines long — and leaves their inputs
  // mounted, so a half-typed truck number survives opening and closing the dialog.
  const [modal, setModal] = useState(null);
  // ── "ADD A SITE" MENU ──
  // A real popover, not a <select>. The option list of a native select is drawn by the OS, so
  // none of it can be styled — the dates and day-offsets could only ever be crammed into one
  // line of plain text per row. position:fixed with measured coordinates because this card sets
  // overflow-hidden, which would clip an absolutely-positioned menu. Same approach FlowerPicker
  // in components/ui already uses for the same reason.
  const [siteMenu, setSiteMenu] = useState(false);
  const siteBtnRef = useRef(null);
  const [siteMenuPos, setSiteMenuPos] = useState({ top: 0, left: 0, width: 0 });
  useEffect(() => {
    if (!siteMenu) return undefined;
    const place = () => {
      const r = siteBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      // Held inside the viewport. Anchored at the button's left edge at 280px, the menu ran off
      // the right of a phone screen whenever the button sat past the middle — cutting off the
      // same-day / ±days badge, which is the part you pick a site by.
      const gap = 12;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(Math.max(r.width, 280), vw - gap * 2);
      const left = Math.max(gap, Math.min(r.left, vw - width - gap));
      setSiteMenuPos({ top: r.bottom + 6, left, width });
    };
    place();
    const onDown = (e) => { if (!siteBtnRef.current?.parentElement?.contains(e.target)) setSiteMenu(false); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setSiteMenu(false); } };
    // mousedown, not click: a click listener fires after the option's own handler has already
    // re-rendered the list, so the menu closed before the pick registered.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [siteMenu]);
  // Tracked in JS, not just CSS, because two behaviours can't be expressed in a class: locking
  // the page behind the sheet, and swallowing a backdrop tap. 639px is the pixel below Tailwind's
  // `sm`, so this flips on exactly the same line the classes below do.
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const modalCls = (k) => (modal === k ? "" : " hidden");
  // ── TRUSS PLAN ── (the Truss tab of Deal Check, for the people who build it)
  // Every truss row of every function on the event: Customer demand vs Physical footprint, the
  // pillars / beams / batta it takes and its fabric (Liza / curtains / masking) with the colours
  // Deal Check allocated. Worked out here from the event's own zone layout and IMS's truss
  // inventory (same calcZoneTrussPreview / calcZoneFabric Deal Check uses), so it is always the
  // current plan, not a snapshot.
  // Read on first use, not here: `sel` (the open event) is declared further down this component.
  let trussPlanCache = null;
  const trussPlanOf = () => {
    if (trussPlanCache) return trussPlanCache;
    const out = [];
    trussPlanCache = out;
    const fnsT = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
    if (!trussInv) return out;
    fnsT.forEach((fn, fi) => {
      const en = fn?.enabledEls || {}, zones = fn?.zones || {};
      Object.keys(zones).forEach(zk => {
        const zc = zones[zk]; if (!en[zk] || !zc) return;
        [zc, ...(Array.isArray(zc.extraTrussRows) ? zc.extraTrussRows : [])].forEach((row, ri) => {
          if (!row || !((trussBaseArea(row).area || 0) > 0) || row.trussQty === 0) return;
          let pv = null; try { pv = calcZoneTrussPreview(row, trussInv); } catch { pv = null; }
          if (!pv || !pv.topology) return;
          let fab = null; try { fab = calcZoneFabric(row, trussInv, row.drapeDensity || "moderate"); } catch { fab = null; }
          const zLabel = (fn?.zoneNames?.[zk]) || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          out.push({ key: `${fi}|${zk}|${ri}`, fn, fi, zk, ri, row, pv, fab, zLabel: ri > 0 ? `${zLabel} (truss #${ri + 1})` : zLabel });
        });
      });
    });
    return out;
  };
  // ── CARPET PLAN ── sales ranks up to three stock carpets per floor (Build / Deal Check); here the Tenting head sees each
  // floor's three with what is actually free on the event date and decides which one is laid. The decision is IMS-owned
  // (deptOps.Tenting.carpetChoice), so every Studio sync leaves it alone. Read on first use, like the truss plan (`sel` is below).
  let carpetPlanCache = null;
  const carpetPlanOf = () => {
    if (carpetPlanCache) return carpetPlanCache;
    const floors = carpetFloorsOf(sel?.functionsDetail, (fn, zk) => fn?.zoneNames?.[zk] || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const itemsById = {};
    (inventory || []).forEach(i => { if (i?.id != null) itemsById[i.id] = i; });
    carpetPlanCache = planCarpets({ floors, itemsById, blocks, eventId: sel?.id, choice: sel?.deptOps?.Tenting?.carpetChoice || {}, eventOrders });
    return carpetPlanCache;
  };
  // ── OVERLAY / CUSHION COVER CHOICES ── the same idea for the Fabric head: sales names up to four designs for an overlay or a cushion
  // cover; Planning decides the one design used for the whole quantity (deptOps.Fabric.itemChoice, IMS-owned).
  const zoneLabelFor = (fn, zk) => fn?.zoneNames?.[zk] || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  let elementPlanCache = null;
  const elementPlanOf = () => {
    if (elementPlanCache) return elementPlanCache;
    const itemsById = {};
    (inventory || []).forEach(i => { if (i?.id != null) itemsById[i.id] = i; });
    elementPlanCache = planElements({ functionsDetail: sel?.functionsDetail, zoneLabelOf: zoneLabelFor, itemsById, blocks, eventId: sel?.id, choice: sel?.deptOps?.Fabric?.itemChoice || {} });
    return elementPlanCache;
  };
  // ── THE PANEL: inline from sm up, a bottom sheet on a phone ──
  // Opening in place works on the desktop grid because the tiles sit four to a row and stay in
  // view beside the panel. On a 390px column the tiles are stacked one per row, so "inline under
  // the tiles" puts the panel a screen and a half below the tap — it reads as nothing having
  // happened. Same DOM either way; only these three class strings differ, so a block never has to
  // be moved or re-parented to change which form it takes.
  // Blurred as well as dimmed on a phone: with only a tint, the tiles and figures behind the
  // sheet stayed sharp enough to read and competed with it. sm:backdrop-blur-none because from
  // sm this same element is the plain inline wrapper, where a blur would frost the page itself.
  const PANEL_WRAP = "fixed inset-0 z-50 flex items-end bg-gray-900/30 backdrop-blur-md sm:static sm:z-auto sm:block sm:bg-transparent sm:backdrop-blur-none";
  // On a phone the close button floats just above the sheet, on the dimmed backdrop, instead of
  // taking a row inside it — that row was ~40px of empty sheet above the content. So the card is
  // `relative` and not overflow-hidden below sm (the button sits outside its box); the body
  // takes the rounded top and clips its own scroll instead. From sm the bar is back inside.
  // The sheet is a translucent pane over the already-blurred backdrop. It carries no
  // backdrop-filter of its own on purpose: a backdrop-filter makes an element the containing
  // block for position:fixed descendants, and the "Add a site" menu inside it is fixed-positioned
  // from viewport coordinates — it would open offset by the sheet's own position.
  // No sm:overflow-hidden. It used to clip to the rounded corners there, but PANEL_BODY's own
  // sm:p-4 padding already keeps every child inset from this edge — nothing was actually bleeding
  // past the corners for it to clip. Keeping it was the reason the inventory list's own sticky
  // column header (further down, its own overflow-hidden already dropped for the same reason)
  // still never stuck to the page scroll: this ancestor became its own scroll container for
  // sticky-positioning purposes, trapping the header inside a box that never itself scrolls.
  const PANEL_CARD = "relative w-full max-h-[85vh] flex flex-col rounded-t-2xl bg-white/85 ring-1 ring-white/70 sm:bg-gray-50 sm:ring-gray-200 sm:max-h-none sm:block sm:rounded-2xl";
  const PANEL_BODY = "flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-t-2xl p-3 space-y-3 sm:rounded-none sm:flex-none sm:overflow-visible sm:p-4";
  // Tapping the dimmed area closes, the way every sheet on the platform does. Guarded on the
  // phone breakpoint: from sm up this same element is the plain inline wrapper, and a click that
  // lands on it rather than on a child would otherwise shut the panel for no visible reason.
  const onPanelBackdrop = (e) => { if (isPhone && e.target === e.currentTarget) setModal(null); };
  // Escape closes, and the page behind stops scrolling while the dialog is up — without the
  // lock, a flick inside a short dialog scrolls the page underneath it instead.
  useEffect(() => {
    if (!modal && !logOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setModal(null); setLogOpen(false); } };
    window.addEventListener("keydown", onKey);
    // From sm up an open block is part of the page, so freezing the scroll would trap you in it —
    // you could not reach the tiles above or anything below. On a phone the same block is a sheet
    // over the page, and without the lock a flick inside a short one scrolls the page underneath
    // instead of the sheet. The activity log is a dialog at every width, so it always locks.
    const prev = document.body.style.overflow;
    if (logOpen || (modal && isPhone)) document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [modal, logOpen, isPhone]);
  // Switching event or department while the log is open would leave the dialog showing another
  // context's entries — close it, since its contents are scoped to both.
  useEffect(() => { setLogOpen(false); }, [selId, dept]);
  // Which manpower rows have their derivation expanded. Open by default (owner ask) — a row is only
  // collapsed once someone closes it, so a missing key reads as open.
  const [mpOpen, setMpOpen] = useState({});
  // "Whole event" panel in the Manpower plan header — every department's crew for this booking.
  const [mpEventOpen, setMpEventOpen] = useState(false);
  // Manpower plan scope: "all", or the index of one function in sel.functionsDetail.
  const [mpFn, setMpFn] = useState("all");
  // Inventory blocked scope, the same way: "all", or one function's index.
  const [invFn, setInvFn] = useState("all");
  // Whole-event crew row whose "how" modal is open (its crew type), or null.
  const [mpHowType, setMpHowType] = useState(null);
  // Fabric colour swatch shown large ({name, hex}), or null.
  const [swatchView, setSwatchView] = useState(null);
  // 🔁 Mandi swap on the Floral real-shopping list — { i, q, toName, qty, price, note } while open.
  const [mandiSwap, setMandiSwap] = useState(null);
  // Which kits have their components showing. Collapsed by default: a kit's own line already
  // carries the qty, the rate and the total that matter, and six components under each of four
  // kits buried the ordinary items between them.
  const [kitOpen, setKitOpen] = useState({});
  // Set while the PDF is being built. The first export also downloads the jsPDF chunk, so there
  // is a real pause — without a busy state the button looks broken and gets pressed again.
  // false | "download" | "view" — which button started it, so only THAT one spins. Viewing used to
  // spin the download buttons too, which read as the PDF being downloaded again.
  const [exporting, setExporting] = useState(false);
  const [dcModalOpen, setDcModalOpen] = useState(false); // Deal Check's Department Income table, opened from the Inventory panel
  const [dlMenuOpen, setDlMenuOpen] = useState(false); // phone: the download icon's "this department / all departments" menu
  // Set while the Actuals PDF is being written (the first one also loads the jsPDF chunk).
  const [actualsPdfBusy, setActualsPdfBusy] = useState(false);
  const [laboursHow, setLaboursHow] = useState({});
  const [trussFabEdit, setTrussFabEdit] = useState(null); // "zoneKey|part" whose fabric colours are being edited in the Truss plan // "type|date" → the carry-over breakdown is open
  const [challanPdfBusy, setChallanPdfBusy] = useState(null); // id of the truck whose challan PDF is being made
  // Fetch the PDF libraries a few seconds after the tab opens, while the page's own files are
  // still the deployed ones — see loadPdfLibs.
  useEffect(() => { const t = setTimeout(() => { loadPdfLibs().catch(() => {}); }, 3000); return () => clearTimeout(t); }, []);
  // "View deck": the very PDF the download button saves, shown on screen instead of saved. Built
  // fresh on every click from the event as it stands, so it is always the latest.
  const [deckView, setDeckView] = useState(null); // null | {url, name} — url is a blob: URL
  const [mpDayHow, setMpDayHow] = useState({}); // which per-day rows have their "how" derivation expanded
  const [routeDraft, setRouteDraft] = useState({}); // dismantle routing draft per item: {qty, type, toEventId}
  const [manTruck, setManTruck] = useState({}); // confirm-time truck details per destination group: {[groupKey]:{vehicle,driver,phone}}
  const [manSel, setManSel] = useState({}); // which items load on THIS truck (transfer groups): {[groupKey::itemKey]:false} (default selected)
  const [manCond, setManCond] = useState({}); // on-site condition per manifest item: {[groupKey::itemKey]:{repair,broken}}
  const [manNote, setManNote] = useState({}); // on-site voice note per manifest item: {[groupKey::itemKey]:url}
  const [manOpen, setManOpen] = useState({}); // Loading-manifest destination groups: collapsed by default
  const [manIssue, setManIssue] = useState({}); // manifest items whose Repair / Broken / note fields are opened: {[groupKey::itemKey]:true}
  const [osMp, setOsMp] = useState({}); // on-site crew rows expanded to the per-day / per-shift editor
  const [showFleet, setShowFleet] = useState(false); // toggle the own-fleet manager
  const [newVeh, setNewVeh] = useState({ vehicle: "", driver: "", phone: "" }); // new fleet entry
  const mandiCatalogue = useMemo(() => (Array.isArray(settings?.mandiCatalogue) ? settings.mandiCatalogue : []), [settings]);
  const flowerPatterns = useMemo(() => (Array.isArray(settings?.flowerPatterns) ? settings.flowerPatterns : []), [settings]);

  const eventDate = (eo) => eo?.functionsDetail?.[0]?.date || eo?.date || eo?.eventDate || "";
  const today = new Date().toISOString().slice(0, 10);
  // A "live" event for ops = confirmed/finalised. Excludes pending (not yet auto-confirmed), cancelled,
  // and review — so cancelled/dead deals never clutter the list or the transfer pickers.
  const isLiveEvent = isLiveEventOrder;

  // All events (date-tagged) — drives the list.
  const allEvents = useMemo(() => (eventOrders || []).map(eo => ({ eo, date: eventDate(eo) })), [eventOrders]);

  // Event list — search-filtered, sorted by date (upcoming first).
  const events = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allEvents
      // Ops plans only for SOLD/finalised events — hide pending, cancelled and review deals.
      .filter(({ eo }) => isLiveEvent(eo))
      .filter(({ eo }) => !q || (eo.clientName || "").toLowerCase().includes(q) || (eo.functionsDetail?.[0]?.venue || eo.venue || "").toLowerCase().includes(q))
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  }, [allEvents, search]);

  // Open the picker on a month that actually has events — nearest upcoming, else the most recent
  // past one. Sold events cluster in a few months; landing on "today" usually meant an empty grid
  // and two clicks of ‹ before anything appeared. Once only, so paging around is never undone.
  const pickInitRef = useRef(false);
  useEffect(() => {
    if (pickInitRef.current || events.length === 0) return;
    pickInitRef.current = true;
    const dated = events.map(e => e.date).filter(Boolean).sort();
    const target = dated.find(d => d >= today) || dated[dated.length - 1];
    if (target) { const dt = new Date(target + "T00:00:00"); setPickMonth({ y: dt.getFullYear(), m: dt.getMonth() }); }
  }, [events, today]);

  // Events for the visible month, bucketed by date — the picker grid reads this.
  const pickByDate = useMemo(() => {
    const out = {};
    // An event sits on EVERY one of its function dates, not just the first: a wedding with a
    // mehendi a month earlier is work on both days, and filing it under the first date alone hid it
    // from the month the other function falls in.
    events.forEach(({ eo, date }) => {
      const dates = [...new Set([...(eo.functionsDetail || []).map(f => String(f?.date || "").slice(0, 10)), date].filter(Boolean))];
      dates.forEach(d => {
        const [y, m] = d.split("-").map(Number);
        if (y !== pickMonth.y || m !== pickMonth.m + 1) return;
        (out[d] = out[d] || []).push(eo);
      });
    });
    return out;
  }, [events, pickMonth]);

  // Arriving from the Calendar tab: it hands over the event_order id that was clicked and this
  // selects it. Cleared straight after via onFocusHandled, so the hand-off is a one-shot — left
  // set, it would re-select that event every time this tab re-rendered and quietly undo the
  // user's next pick from the list.
  // A lead with no Studio deal behind it arrives with focusSearch instead: no event to select,
  // so the client name goes into the search box and the filtered list answers the question —
  // either the deal is there under a different spelling, or it is not sold yet.
  useEffect(() => {
    if (!focusEventId && !focusSearch) return;
    // Always resync the search term, including to "". Left alone, a name carried over from a
    // previous unmatched lead would still be filtering `events` — which now only feeds the
    // nearby-events count and the empty states, so the staleness would be invisible but wrong.
    setSearch(focusSearch || "");
    // Kept locally because onFocusHandled clears the incoming props on the same tick, and the
    // "Build this deal in Studio" button below needs the LMS entry number at render time.
    setLeadEntry(focusLeadEntry || null);
    if (focusEventId && (eventOrders || []).some(e => e.id === focusEventId)) setSelId(focusEventId);
    else if (focusSearch) setSelId(null);
    onFocusHandled?.();
  }, [focusEventId, focusSearch, focusLeadEntry, eventOrders, onFocusHandled]);

  const sel = (eventOrders || []).find(e => e.id === selId);
  // A PDF open for one event must not carry over when the picker moves to another.
  useEffect(() => { setDeckView(null); }, [selId]);
  useEffect(() => { setMpFn("all"); setMpHowType(null); setInvFn("all"); }, [selId]);
  // The last PDF View deck built, keyed by department + the event's full data. Opening it again
  // with nothing changed reuses it instantly instead of rebuilding; any edit to the event changes
  // the key, so what opens is still always the latest. Its blob: URL is freed when replaced.
  const deckCacheRef = useRef(null); // {key, url, name}
  useEffect(() => () => { if (deckCacheRef.current) URL.revokeObjectURL(deckCacheRef.current.url); }, []);
  // Which departments actually have something to report on this event — the same gate the
  // report itself uses (hasDeptSnapshot / blockedItemsGrouped both key off deptInventory[dept]).
  // A combined book skips an empty department rather than printing a cover with nothing behind it.
  const deptsWithWork = useMemo(() =>
    deptOptions.filter(d => Array.isArray(sel?.deptInventory?.[d]) && sel.deptInventory[d].length > 0),
    [deptOptions, sel]);
  const selDateStr = sel ? eventDate(sel) : "";
  // Lifted out of the activity-log block so the bell in the event header can show the count
  // without recomputing it — one query, two readers, and they cannot disagree about how many
  // changes there are.
  const recentChanges = useMemo(() => (amendRequests || [])
    .filter(r => r.eventOrderId === sel?.id && r.department === dept && r.status === "logged")
    .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
    .slice(0, 8), [amendRequests, sel, dept]);

  // ── Department income snapshot (pushed from Deal Check → matches Studio exactly) ──
  const deptIncome = (sel?.deptIncome && sel.deptIncome[dept]) || null;
  const deptInvSnap = (sel?.deptInventory && Array.isArray(sel.deptInventory[dept])) ? sel.deptInventory[dept] : null;

  // ── Swap detection: a request row that both adds and removes an item in the same batch is a
  // straight swap (a Deal Check pick replacing another, logged by reconcileSoldInventoryBlocks in
  // one go) — tag the newly-added item SWAPPED so ops sees at a glance this isn't extra inventory,
  // it's a substitution. Most recent qualifying row wins per item name; when a batch bundles more
  // than one removal the "from" is shown as a count rather than guessing which item paired with which.
  const swapInfo = useMemo(() => {
    const map = new Map();
    const rows = (amendRequests || [])
      .filter(r => r.eventOrderId === sel?.id && r.department === dept && r.status === "logged")
      .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    for (const r of rows) {
      const items = r.items || [];
      const added = items.filter(it => it.change === "added");
      const removed = items.filter(it => it.change === "removed");
      if (!added.length || !removed.length) continue;
      const fromLabel = removed.length === 1 ? removed[0].name : `${removed.length} items`;
      for (const a of added) {
        if (!map.has(a.name)) map.set(a.name, { swappedFrom: fromLabel, at: r.requestedAt });
      }
    }
    return map;
  }, [amendRequests, sel, dept]);

  // ── Blocked inventory: prefer the Deal Check snapshot; fall back to IMS blocks if not synced ──
  // GROUPED view (kit as one line + its components) — used for the inventory/income display.
  const blockedItemsGrouped = useMemo(() => {
    if (!sel) return [];
    if (deptInvSnap && deptInvSnap.length) {
      // fromKit carried through from the snapshot: Deal Check splits a kit's parts across
      // departments by each part's own category, so a row can be a component of a kit owned by
      // another department. It is the only record of that parent, and the PDF needs it to avoid
      // reporting a bolted-on part as a loose item.
      const rows = deptInvSnap.map((x, i) => ({ id: x.name + i, invId: x.imsId || null, name: x.name, photo: x.photo || "", qty: x.qty || 0, rentalQty: x.rentalQty != null ? x.rentalQty : (x.qty || 0), byFn: x.byFn || null, calc: x.calc || null, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "", isKit: !!x.isKit, fromKit: x.fromKit || null, components: Array.isArray(x.components) ? x.components : null, recipeParts: Array.isArray(x.recipeParts) ? x.recipeParts : null, shortQty: x.shortQty || 0, shortCost: x.shortCost || 0, outOfStock: !!x.outOfStock, prodOrBuy: x.prodOrBuy || null, isSwapped: swapInfo.has(x.name), swappedFrom: swapInfo.get(x.name)?.swappedFrom || null, qtyUnit: x.qtyUnit || "", parts: Array.isArray(x.parts) ? x.parts : null }));
      // Short items first (need chasing/ordering), then Production/Buying (not real stock — worth
      // knowing apart from what's actually reserved), then everything else — the order requested
      // for this list. Stable within each group: Array.prototype.sort is stable, so ties keep the
      // snapshot's own order (whichever function/zone order dcCostRollup built them in).
      const rank = (it) => (it.shortQty > 0 ? 0 : it.prodOrBuy ? 1 : 2);
      return rows.sort((a, b) => rank(a) - rank(b));
    }
    const out = [];
    Object.entries(blocks || {}).forEach(([itemId, arr]) => {
      const qty = (arr || []).filter(b => b.eventId === sel.id).reduce((s, b) => s + (Number(b.qty) || 0), 0);
      if (qty <= 0) return;
      const item = (inventory || []).find(i => String(i.id) === String(itemId));
      if (!item) return;
      const d = catToDept(item.cat || item.category);
      if (d !== dept) return;
      const unit = Number(item.price ?? item.rentalCost) || 0;
      out.push({ id: itemId, invId: itemId, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, unit, total: unit * qty, sub: item.subCat || item.subcategory || "" });
    });
    return out.sort((a, b) => b.total - a.total);
  }, [sel, blocks, inventory, dept, swapInfo]);
  // FLAT view — kits expanded into the kit shell + each component as its own physical row. Used by
  // Loading & dispatch, Receiving and Dismantle (the ops manager loads/moves each real item).
  const blockedItems = useMemo(() => {
    const out = [];
    blockedItemsGrouped.forEach(it => {
      if (it.isKit && Array.isArray(it.components) && it.components.length) {
        const partsSum = it.components.reduce((s, c) => s + (Number(c.total) || 0), 0);
        out.push({ ...it, isKit: false, components: null, total: Math.max(0, (Number(it.total) || 0) - partsSum) }); // kit shell (its own base value)
        it.components.forEach((cp, ci) => out.push({ id: it.id + "__c" + ci, invId: cp.imsId || null, name: cp.name, photo: cp.photo || "", qty: Number(cp.qty) || 0, unit: cp.unit || 0, total: Number(cp.total) || 0, sub: cp.sub || "", kitOf: it.name }));
      } else out.push(it);
    });
    return out;
  }, [blockedItemsGrouped]);
  const rentalIncome = blockedItemsGrouped.reduce((s, x) => s + x.total, 0);

  // ── Department-saved data on the event order ──
  const deptData = (sel?.deptOps && sel.deptOps[dept]) || {};
  const deptTypes = DEPT_MP[dept] || ["Labours"];
  // Prefer the reconciling per-dept manpower detail from Deal Check (sums EXACTLY to the income card:
  // mapped crew in full + this dept's share of general labour/supervisors). Each row carries the
  // system count/rate/cost + basis (all multipliers) so the head sees how it was derived and edits it.
  // A snapshot exists once Studio has pushed Deal Check. When it has, THIS dept's manpower is
  // exactly manpowerDetail[dept] — even if empty (a dept with no crew share, e.g. Furniture with no
  // income, must show 0 to match its income card, NOT the global plan). Only with no snapshot at all
  // do we fall back to the global plan / defaults.
  const mpFns = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
  const SHIFT_START_HOUR = { brunch: 11, morning: 9, lunch: 12, sundowner: 16, evening: 18, dinner: 20, night: 20, latenight: 22, "late night": 22 };
  const slotHours = (label) => {
    const m = [...String(label || "").matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)].map(x => (Number(x[1]) % 12) + (x[3].toUpperCase() === "PM" ? 12 : 0) + (Number(x[2]) || 0) / 60);
    return m.length ? { start: m[0], end: m.length > 1 ? m[1] : null } : null;
  };
  // Flowerists rows for ONE function, worked out here from its own zone lists — the same walk Deal
  // Check's traceOf("Flowerists") does (enabled zones, qty > 0, kits walked into their parts, a
  // florals item matched to its recipe by patternId or sub-category, medium size, grouped by name +
  // units-per-flowerist). Lets a day show every function's column even when the order was synced
  // before Deal Check started sending trace.byFn.
  const invByIdMp = useMemo(() => new Map((inventory || []).map(i => [i.id, i])), [inventory]);
  const flowerTraceForFn = (fn) => {
    const agg = {};
    const add = (rc, el, qty) => {
      if (String(rc.cat || "").toLowerCase() !== "florals") return;
      let pat = el.patternId ? flowerPatterns.find(p => p.id === el.patternId) : null;
      if (!pat) pat = matchFlowerPattern({ subcategory: rc.sub, name: rc.name }, flowerPatterns);
      if (!pat) return;
      const c = (pat.sizes || {}).medium;
      const upf = Number(c?.unitsPerFlowerist || 0);
      if (upf > 0) { const k = (rc.name || "flower") + "|" + upf; if (!agg[k]) agg[k] = { sub: rc.name || "flower", batch: upf, count: 0 }; agg[k].count += qty; }
    };
    const en = fn?.enabledEls || {}, ze = fn?.elements || {};
    Object.keys(en).forEach(zk => { if (!en[zk]) return; (ze[zk] || []).forEach(el => {
      const qty = el?.qty || 0; if (qty <= 0) return;
      const inv = el.invId ? invByIdMp.get(el.invId) : null;
      if (inv) {
        if (Array.isArray(inv.subItems) && inv.subItems.length > 0) walkKitUnits(inv, qty, inventory || [], el.kitOverrides, (node, nodeQty) => add({ name: node.name, cat: node.cat || node.category || "", sub: node.subCat || node.subcategory || "" }, el, nodeQty));
        else add({ name: inv.name, cat: inv.cat || inv.category || "", sub: inv.subCat || inv.subcategory || "" }, el, qty);
        return;
      }
      if (el.patternId) add({ name: el.name || "", cat: "florals", sub: "" }, el, qty);
    }); });
    const rows = Object.values(agg).map(r => ({ ...r, need: r.count / r.batch }));
    return { fn: fn?.type || "Function", shift: fn?.shift || "", rows, result: Math.ceil(rows.reduce((s, r) => s + r.need, 0)) };
  };
  // ── DIHARI SLOTS IN THE ORDER THE CREW WORKS THEM ──
  // A day's shift slots are shown starting from the slot just before that day's first function
  // and then round the clock: a 9 AM Mata Ki Chowki puts 2 AM–8 AM first, then 9 AM–6 PM, then
  // 6 PM–2 AM. Slots carry only a label ("9 AM – 6 PM"), so their hours are read from it; the
  // function's start comes from its shift. Display order only — the saved ids are untouched.
  const firstFnHour = (date) => {
    const hrs = mpFns.filter(f => String(f?.date || "").slice(0, 10) === date)
      .map(f => SHIFT_START_HOUR[String(f?.shift || "").trim().toLowerCase()]).filter(h => h != null);
    return hrs.length ? Math.min(...hrs) : 9;
  };
  const orderWinIds = (ids, winDefs, date) => {
    if (!Array.isArray(ids) || ids.length < 2) return ids;
    const hrsOf = (id) => slotHours((winDefs || []).find(w => w.id === id)?.label);
    const fnHour = firstFnHour(date);
    // The anchor: the slot that ends latest at or before the function starts (a slot running past
    // midnight never ends "before" a same-day start). No such slot → plain clock order from midnight.
    let anchor = 0, best = -1;
    ids.forEach(id => { const h = hrsOf(id); if (h && h.end != null && h.end > h.start && h.end <= fnHour && h.end > best) { best = h.end; anchor = h.start; } });
    const key = (id) => { const h = hrsOf(id); return h ? (h.start - anchor + 24) % 24 : 99; };
    return [...ids].sort((a, b) => key(a) - key(b));
  };
  // ── EACH DIHARI SLOT'S DEFAULT CREW, FROM THE FUNCTIONS IT SERVES ──
  // On an event day the crew of every function up to lunch is summed into the early slot
  // (2 AM – 8 AM, set up before a morning/lunch start); every function after lunch — or with no
  // shift set — into the day slot (9 AM – 6 PM); and a night function also into the night slot
  // (6 PM – 2 AM, the event and its strike). Slots are told apart by the hours in their labels.
  // These fill schedule day .winCount, which the cost/dihari helpers and the shift inputs already
  // read; a per-shift count set in Deal Check (.winCount) or by the head (mpWinCount) still wins.
  const slotRoleIds = (ids, winDefs) => {
    let pre = null, day = null, night = null;
    ids.forEach(id => {
      const h = slotHours((winDefs || []).find(w => w.id === id)?.label); if (!h) return;
      const wraps = h.end != null && h.end <= h.start;
      if (!wraps && h.end != null && h.start < 9 && h.end <= 9) pre = pre ?? id;
      else if (!wraps && h.start <= 12 && (h.end == null || h.end > 12)) day = day ?? id;
      else if (h.start >= 17) night = night ?? id;
    });
    return { pre, day, night };
  };
  const fnCrewForDay = (s, d) => {
    const t = d?.trace;
    if (!t || d.phase !== "event") return null;
    const fnsToday = mpFns.filter(f => String(f?.date || "").slice(0, 10) === d.date);
    // Labours (shared): each function's crew for THIS department is its own items' summed need,
    // rounded up once — the same "share per function" the day's table shows — so the morning
    // shift carries the morning function's labour and the night shift the night function's, the
    // way every other crew type's shifts already work. Before, every shift took the day's whole
    // share (3 / 3 / 3 when Haldi needed 1 and the Wedding 2). Supervisors (and a Labours day synced
    // before per-function traces existed) keep the day's crew in every shift.
    if (s.shared) {
      if (t.kind !== "labours" || !Array.isArray(t.byFn) || !t.byFn.length) return null;
      return t.byFn.map(c => {
        const rows = Array.isArray(c?.trace?.usageRows) ? c.trace.usageRows.filter(ur => usageDept(ur) === dept) : [];
        const need = Math.round(rows.reduce((acc, ur) => acc + (Number(ur.need) || 0), 0) * 100) / 100;
        return { shift: c.shift || fnsToday.find(f => f?.type === c.fn)?.shift || "", crew: Math.ceil(need) };
      });
    }
    if (Array.isArray(t.byFn) && t.byFn.length) return t.byFn.map(c => ({ shift: c.shift || fnsToday.find(f => f?.type === c.fn)?.shift || "", crew: Number(c.result) || 0 }));
    if (t.kind === "tier2" && t.perRow && fnsToday.length) return fnsToday.map(f => ({ shift: f?.shift || "", crew: flowerTraceForFn(f).result }));
    return null;
  };
  const slotDefaults = (s, d) => {
    const fnc = fnCrewForDay(s, d); if (!fnc || !fnc.length) return null;
    const winDefs = (dihari[s.type] && Array.isArray(dihari[s.type].windows)) ? dihari[s.type].windows : [];
    const ov = deptData.mpWin && deptData.mpWin[s.type];
    const ids = ov && ov[d.date] != null ? ov[d.date] : d.windowIds;
    if (!Array.isArray(ids) || !ids.length) return null;
    const { pre, day, night } = slotRoleIds(ids, winDefs);
    // A slot with no hours in its label ("Full day") — or a day with just one slot — takes every
    // function: it falls back to the first slot in working order.
    const first = ids.length === 1 ? ids[0] : (orderWinIds(ids, winDefs, d.date) || ids)[0];
    const out = {};
    const addTo = (id, n) => { if (id) out[id] = (out[id] || 0) + n; };
    fnc.forEach(({ shift, crew }) => {
      const h = SHIFT_START_HOUR[String(shift || "").trim().toLowerCase()];
      if (h != null && h <= 12) addTo(pre || day || first, crew); else addTo(day || pre || first, crew);
      if (h != null && h >= 18 && night && night !== (day || pre || first)) addTo(night, crew);
    });
    return Object.keys(out).length ? out : null;
  };
  const hasMpSnapshot = !!(sel?.manpowerDetail && typeof sel.manpowerDetail === "object" && Object.keys(sel.manpowerDetail).length);
  const mpDetailRaw = (sel?.manpowerDetail && Array.isArray(sel.manpowerDetail[dept])) ? sel.manpowerDetail[dept] : (hasMpSnapshot ? [] : null);
  // autoSlots[type][date][slotId] — the function-driven default, kept so a head's own count can be
  // checked against the default it was typed over (mpWinCount filtering below).
  const autoSlots = {};
  const mpDetail = Array.isArray(mpDetailRaw) ? mpDetailRaw.map(r => !Array.isArray(r?.schedule) ? r : ({
    ...r, schedule: r.schedule.map(d0 => {
      // An order synced before Deal Check added the setup shift (withSetupSlot) still carries the
      // bare phase defaults for an event day — give it the same setup shift here. Only when the day
      // still holds exactly those defaults, so a day Deal Check's ops set by hand is left alone.
      let d = d0;
      if (d0?.phase === "event" && Array.isArray(d0.windowIds)) {
        const defs = (settings?.defaultWindowsByPhase?.[r.type] || {}).event || [];
        const same = defs.length === d0.windowIds.length && defs.every(id => d0.windowIds.includes(id));
        if (same) {
          const ids = withSetupSlot(d0.windowIds, dihari[r.type]?.windows, mpFns.filter(f => String(f?.date || "").slice(0, 10) === d0.date));
          if (ids.length !== d0.windowIds.length) d = { ...d0, windowIds: ids, windows: ids.length };
        }
      }
      const def = slotDefaults(r, d); if (!def) return d;
      (autoSlots[r.type] = autoSlots[r.type] || {})[d.date] = def;
      return { ...d, winCount: { ...(d.winCount || {}), ...def } };
    }),
  })) : mpDetailRaw;
  const sysPlan = (Array.isArray(sel?.manpowerPlan) ? sel.manpowerPlan : []).filter(p => deptTypes.includes(p.type));
  // days = the multi-day total cost ÷ (peak crew × day rate) — so the derivation math actually adds up.
  const dayCount = (count, rate, cost) => (count > 0 && rate > 0 && cost > 0) ? Math.max(1, Math.round(cost / (count * rate))) : 1;
  // Head edits are stored as per-type OVERRIDES (count/rate only) + any extra crew types they added —
  // so the SYSTEM figures (sysCount / trace / basis / schedule) are ALWAYS taken fresh from the snapshot
  // and never freeze. Only the head's actual changes are kept.
  const migrateOv = () => {
    if (!Array.isArray(deptData.mp)) return {};
    const byT = {}; (mpDetail || []).forEach(s => { byT[s.type] = s; });
    const ov = {};
    deptData.mp.forEach(r => { const s = byT[r.type]; if (!s) return; const o = {}; if (r.count !== "" && r.count != null && Number(r.count) !== Number(s.count ?? 0)) o.count = r.count; if (Number(r.rate) !== Number(s.rate ?? 0)) o.rate = r.rate; if (Object.keys(o).length) ov[r.type] = o; });
    return ov;
  };
  const mpOverrides = (deptData.mpOverrides && typeof deptData.mpOverrides === "object") ? deptData.mpOverrides : migrateOv();
  const snapTypes = new Set((mpDetail || []).map(s => s.type));
  const mpExtra = Array.isArray(deptData.mpExtra) ? deptData.mpExtra : (Array.isArray(deptData.mp) ? deptData.mp.filter(r => !snapTypes.has(r.type)) : []);
  const mpRows = hasMpSnapshot
    ? [
        ...(mpDetail || []).map(s => { const ov = mpOverrides[s.type] || {}; return { type: s.type, count: ov.count != null ? ov.count : (s.count ?? ""), rate: ov.rate != null ? ov.rate : (s.rate || 0), basis: s.basis || "", shared: !!s.shared, sysCount: s.count, sysRate: s.rate || 0, sysCost: s.cost || 0, days: dayCount(Number(s.count) || 0, Number(s.rate) || 0, Number(s.cost) || 0), trace: s.trace || null, splitInfo: s.splitInfo || null, schedule: s.schedule || null }; }),
        // _extraIdx — this row's own position in deptData.mpExtra, carried through so removeMp can
        // delete exactly this one even when two added rows share the same type (e.g. "+ Add crew
        // type" clicked twice by accident both default to "Labours" — matching by type alone would
        // have deleted both at once instead of just the one the head actually meant to remove).
        ...mpExtra.map((r, ei) => ({ r, ei })).filter(({ r }) => !snapTypes.has(r.type)).map(({ r, ei }) => ({ type: r.type, count: r.count ?? "", rate: r.rate || 0, basis: "added crew", shared: false, sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true, _addedExtra: true, _extraIdx: ei })),
      ]
    : (sysPlan.length ? sysPlan.map(p => ({ type: p.type, count: p.count, rate: p.rate || Number(dihari[p.type]?.rate) || 0, basis: p.basis || "", sysCount: p.count, sysRate: p.rate || 0, sysCost: (p.count || 0) * (p.rate || 0), days: 1, _extra: true }))
      : deptTypes.map(t => ({ type: t, count: "", rate: Number(dihari[t]?.rate) || 0, basis: "", sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true })));
  const expenses = Array.isArray(deptData.expenses) ? deptData.expenses : [];
  // Real on-site expenses logged in the separate Ambria Ops app, pulled in read-only alongside the
  // manually-typed rows above — see lib/ims/opsExpenses.js for the join (both apps independently
  // store the same raw LMS entry number). Silently empty for a deal never synced from an LMS lead,
  // or while Ops hasn't deployed its own endpoint yet — this is a nice-to-have, never a blocker.
  const [opsExpenses, setOpsExpenses] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const contractNo = sel?.lmsLeadId;
    if (!contractNo) { setOpsExpenses([]); return; }
    fetchOpsExpenses(contractNo, dept).then((rows) => { if (!cancelled) setOpsExpenses(rows); });
    return () => { cancelled = true; };
  }, [sel?.id, sel?.lmsLeadId, dept]);
  const opsExpenseTotal = opsExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const realMandi = deptData.realMandi || "";
  // Manual discount the department head grants the salesperson on this deal — a goodwill/incentive
  // figure the head types in directly, unrelated to Deal Check's own venue/repeat pricing discounts
  // and not derived from anything else on this page.
  const discount = deptData.discount ?? "";

  const saveDept = (patch) => {
    if (!sel) return;
    setEventOrders(prev => prev.map(e => {
      if (e.id !== sel.id) return e;
      const ops = { ...(e.deptOps || {}) };
      ops[dept] = { ...(ops[dept] || {}), ...patch, updatedAt: Date.now(), updatedBy: authUser?.name || "—" };
      return { ...e, deptOps: ops };
    }));
  };

  // Day-wise crew overrides: deptData.mpDay = { [type]: { [date]: count } }. Any crew with a working
  // schedule can be tuned per day (Day 1 = 4, Day 2 = 6); cost = Sum(dayCount x shifts x rate).
  // SHARED crew (Labours / Supervisors) carry a GLOBAL schedule + a split share of the event total —
  // so this dept's per-day crew defaults to globalCount × share, and is editable just like mapped crew.
  // Day-wise editing delegates to the shared reconciliation helpers (lib/ims/helpers) so the IMS view
  // and Studio's P&L compute identical numbers. Thin wrappers bind this component's mpDay/mpOverrides.
  const mpDay = (deptData.mpDay && typeof deptData.mpDay === "object") ? deptData.mpDay : {};
  // Per-day dihari-timing overrides: deptData.mpWin = { [type]: { [date]: [windowId, …] } }. The dept
  // head can toggle which shifts each crew works on a given day; cost = crew × shifts × rate.
  const mpWin = (deptData.mpWin && typeof deptData.mpWin === "object") ? deptData.mpWin : {};
  // Per-shift crew counts (ops on-site): deptData.mpWinCount = { [type]: { [date]: { [windowId]: count } } }.
  // Lets a single day hold different crew per shift (e.g. 3 in the day, 1 in the evening).
  // The function-driven slot default always wins: a head's per-shift count only stands while the
  // default it was typed over (mpWinBasis, saved with it) is still the current one. Once the
  // functions change the sum — or for a count saved before mpWinBasis existed — it is ignored.
  const mpWinCountRaw = (deptData.mpWinCount && typeof deptData.mpWinCount === "object") ? deptData.mpWinCount : {};
  const mpWinBasis = (deptData.mpWinBasis && typeof deptData.mpWinBasis === "object") ? deptData.mpWinBasis : {};
  const mpWinCount = Object.fromEntries(Object.entries(mpWinCountRaw).map(([type, byDate]) => [type, Object.fromEntries(Object.entries(byDate || {}).map(([date, byWin]) => {
    const auto = autoSlots[type] && autoSlots[type][date];
    if (!auto) return [date, byWin];
    const basis = (mpWinBasis[type] && mpWinBasis[type][date]) || {};
    return [date, Object.fromEntries(Object.entries(byWin || {}).filter(([id]) => auto[id] == null || basis[id] === auto[id]))];
  }))]));
  const dayWise = mpDayWise;
  const effDay = (r, d) => mpEffDay(r, d, mpDay);
  const showDay = (r, d) => Math.round(effDay(r, d));
  const dayOv = (r, d) => { const ov = mpDay[r.type]; return !!(ov && ov[d.date] != null && Number(ov[d.date]) !== Math.round(mpBaseDay(r, d))); };
  const effWinIds = (r, d) => { const ov = mpWin[r.type]; return ov && ov[d.date] != null ? ov[d.date] : (Array.isArray(d.windowIds) ? d.windowIds : []); };
  const effWin = (r, d) => mpEffWindows(r, d, mpWin);
  const setMpDay = (type, date, val) => { if (!canManpower) return; saveDept({ mpDay: { ...mpDay, [type]: { ...(mpDay[type] || {}), [date]: val } } }); };
  const setMpAllDays = (type, schedule, val) => { const m = { ...(mpDay[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = val; }); saveDept({ mpDay: { ...mpDay, [type]: m } }); };
  const toggleWin = (type, date, winId, curIds) => { const next = curIds.includes(winId) ? curIds.filter(x => x !== winId) : [...curIds, winId]; saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: next } } }); };
  // ↺ on a day: drop every hand edit for that crew type on that date — chosen shifts, per-shift
  // counts (and the defaults they were typed over), and the day's crew — so the day goes back to the
  // system plan (Deal Check's schedule plus the setup-shift rule).
  const dayHasEdits = (type, date) => [mpWin, mpWinCountRaw, mpDay].some(m => m[type] && m[type][date] != null);
  const resetMpDay = (type, date) => {
    if (!canManpower) return;
    const drop = (m) => { if (!m[type] || m[type][date] == null) return m; const t = { ...m[type] }; delete t[date]; return { ...m, [type]: t }; };
    saveDept({ mpWin: drop(mpWin), mpWinCount: drop(mpWinCountRaw), mpWinBasis: drop(mpWinBasis), mpDay: drop(mpDay) });
  };
  const setWinAllDays = (type, schedule, ids) => { const m = { ...(mpWin[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = ids; }); saveDept({ mpWin: { ...mpWin, [type]: m } }); };
  // Set the crew for ONE shift on ONE day (per-shift split). Ensures that window is marked worked.
  // A cleared box (val "") drops the head's own count for that shift, so it falls back to the
  // slot's default (Deal Check's per-shift count, else the functions it serves — slotDefaults).
  const setShiftCount = (type, date, winId, val, curIds) => { const n = Math.max(0, Number(val) || 0); const t = { ...(mpWinCount[type] || {}) }; t[date] = { ...(t[date] || {}), [winId]: n }; if (val === "") delete t[date][winId]; const auto = autoSlots[type] && autoSlots[type][date] && autoSlots[type][date][winId]; const b = { ...(mpWinBasis[type] || {}) }; b[date] = { ...(b[date] || {}) }; if (auto != null && val !== "") b[date][winId] = auto; else delete b[date][winId]; const patch = { mpWinCount: { ...mpWinCount, [type]: t }, mpWinBasis: { ...mpWinBasis, [type]: b } }; if (Array.isArray(curIds) && !curIds.includes(winId)) patch.mpWin = { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: [...curIds, winId] } }; saveDept(patch); };
  const effShift = (r, d, winId) => { const wc = mpWinCount[r.type] && mpWinCount[r.type][d.date]; if (wc && wc[winId] != null) return Number(wc[winId]); const sc = d && d.winCount; if (sc && sc[winId] != null) return Number(sc[winId]); return Math.round(effDay(r, d)); }; // head override → Deal Check per-shift (schedule.winCount) → day count
  // Add another dihari (shift) to a day — the next unused scheme window, else a synthetic slot — so ops
  // can split a single day into e.g. 2 crew in the day shift + 1 in the evening (each shift billed).
  const addDihari = (r, date, curIds) => { const wins = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : []; const unused = wins.find(w => !curIds.includes(w.id)); const id = unused ? unused.id : ("x" + Date.now()); const t = { ...(mpWinCount[r.type] || {}) }; t[date] = { ...(t[date] || {}), [id]: 1 }; saveDept({ mpWin: { ...mpWin, [r.type]: { ...(mpWin[r.type] || {}), [date]: [...curIds, id] } }, mpWinCount: { ...mpWinCount, [r.type]: t } }); };
  // Every delete on this page asks first (the shared confirm dialog) — a × in a row is easy to hit, on a phone most of all.
  const askDelete = async (title, body) => confirm({ title, body });
  const removeDihari = async (type, date, slotId, curIds) => { if (!(await askDelete("Remove this crew slot?", `Removes one ${type} slot on ${date}.`))) return; const t = { ...(mpWinCount[type] || {}) }; if (t[date]) { const dd = { ...t[date] }; delete dd[slotId]; t[date] = dd; } saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: curIds.filter(x => x !== slotId) } }, mpWinCount: { ...mpWinCount, [type]: t } }); };
  // A row scoped to one function (_scoped) costs only the days it kept — the split-allocation
  // shortcut in mpLineCost would hand back the whole booking's figure.
  const lineCost = (r) => r._scoped
    ? Math.round(r.schedule.reduce((s, d) => s + mpDayCost(r, d, mpDay, mpWin, mpWinCount, Number(r.rate) || 0), 0))
    : mpLineCost(r, mpDay, mpOverrides, mpWin, mpWinCount);
  const mpCost = mpRows.reduce((s, r) => s + lineCost(r), 0);
  // ── "THE CREW PLAN CHANGED" ALERT ──
  // What Studio pushed for this department (crew, cost, each day's count/shifts/share) boiled down to
  // a signature. The head's own edits are not in it (they live in deptOps), so only a change coming
  // from the deal itself — an item added or removed, a rate, a multiplier — moves it. Opening the
  // Manpower plan records the signature as seen (deptOps.mpSeen); until then the tile stays red.
  const mpSnapCost = Array.isArray(mpDetailRaw) ? Math.round(mpDetailRaw.reduce((a, r) => a + (Number(r?.cost) || 0), 0)) : 0;
  const mpSnapSig = Array.isArray(mpDetailRaw)
    ? JSON.stringify(mpDetailRaw.map(r => [r?.type, Math.round(Number(r?.cost) || 0), r?.count ?? null, (Array.isArray(r?.schedule) ? r.schedule : []).map(d => [d?.date, d?.count, d?.windows ?? (Array.isArray(d?.windowIds) ? d.windowIds.length : null), d?.share != null ? Math.round(Number(d.share) * 100) : null])]))
    : "";
  // This department's items as Studio last pushed them (name -> qty) — what "added / changed / removed"
  // is measured against, so the Manpower plan can point at the exact item that moved the crew.
  const mpItemsNow = {};
  (Array.isArray(deptInvSnap) ? deptInvSnap : []).forEach(x => { const k = String(x?.name || "").trim(); if (k) mpItemsNow[k] = (mpItemsNow[k] || 0) + (Number(x?.qty) || 0); });
  const mpSeen = deptData.mpSeen && typeof deptData.mpSeen === "object" ? deptData.mpSeen : null;
  const mpChanged = !!mpSeen?.sig && hasMpSnapshot && mpSeen.sig !== mpSnapSig;
  // What it was and what it is now, kept for the panel while it is open (the baseline moves on open).
  const [mpNote, setMpNote] = useState(null);
  useEffect(() => {
    if (modal !== "mp") { setMpNote(null); return; }
    if (!sel || !hasMpSnapshot) return;
    if (mpChanged) {
      const before = mpSeen.items && typeof mpSeen.items === "object" ? mpSeen.items : null;
      const byName = {}; const removed = [];
      if (before) {
        Object.entries(mpItemsNow).forEach(([name, qty]) => {
          if (before[name] == null) byName[name] = { kind: "new", to: qty };
          else if (before[name] !== qty) byName[name] = { kind: "qty", from: before[name], to: qty };
        });
        Object.entries(before).forEach(([name, qty]) => { if (mpItemsNow[name] == null) removed.push({ name, qty }); });
      }
      setMpNote({ from: Number(mpSeen.cost) || 0, to: mpSnapCost, byName, removed, itemsKnown: !!before });
    }
    // Only mpSeen is written — not saveDept, which also stamps "updated by" on the department's
    // sheet: looking at a plan is not an edit of it.
    if (!mpSeen?.sig || mpSeen.sig !== mpSnapSig) {
      const seen = { sig: mpSnapSig, cost: mpSnapCost, items: mpItemsNow, at: Date.now() };
      setEventOrders(prev => prev.map(e => e.id !== sel.id ? e : ({ ...e, deptOps: { ...(e.deptOps || {}), [dept]: { ...((e.deptOps || {})[dept] || {}), mpSeen: seen } } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, sel?.id, dept, mpSnapSig]);
  // ── ONE FUNCTION'S CREW ──
  // The same day rule as Deal Check's Manpower tab: a function owns its own event day, the
  // dismantle day right after it, and — if it is the first function — the −1 setup day. Gap days
  // belong to no single function, so they show under All functions only. Crew lines with no
  // day-wise schedule cannot be split by day, so they stay under All functions too.
  const mpFnDate = (f) => String(f?.date || "").slice(0, 10);
  const mpFirstDate = mpFns.map(mpFnDate).filter(Boolean).sort()[0] || "";
  const mpNextDay = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const mpScoped = mpFn !== "all" && !!mpFnDate(mpFns[mpFn]);
  // All functions + one chip per function — one row shared by every panel that can be scoped to a
  // function (Manpower plan, Inventory blocked). Only on a booking with more than one function.
  const fnChipRow = (value, setValue) => mpFns.length > 1 && (
    <div className="m-2.5 mb-0 flex flex-wrap gap-1.5">
      {[["all", "All functions"], ...mpFns.map((f, fi) => [fi, [f?.type || `Function ${fi + 1}`, mpFnDate(f)].filter(Boolean).join(" · ")])].map(([k, label]) => (
        <button key={k} onClick={() => setValue(k)} aria-pressed={value === k}
          className={"rounded-lg px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap cursor-pointer transition-colors " + (value === k ? "bg-blue-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-blue-50 hover:text-blue-700")}>{label}</button>
      ))}
    </div>
  );
  // ── ONE FUNCTION'S INVENTORY ──
  // Deal Check sends the department's inventory summed across the whole booking, so the rows carry
  // no function. Each function's own zone lists (functionsDetail[].elements) say how many of an
  // item that function uses — by inventory id, else by name, the same match the PDF's zone pages
  // make. Scoped, a row shows that function's qty and its share of the line total (a kit's total
  // carries its components, so it is scaled rather than recomputed as rate × qty). Rows no
  // function's zones name — production, fabric and the like — stay under All functions.
  const invScoped = invFn !== "all" && !!mpFns[invFn];
  // How many of each item one function's zone lists use — by inventory id and by name (kit components walked into).
  const qtyMapsOfFn = (fd) => {
    const byId = new Map(), byName = new Map();
    Object.entries(fd?.elements || {}).forEach(([zk, els]) => {
      if (fd.enabledEls && fd.enabledEls[zk] === false) return;
      (Array.isArray(els) ? els : []).forEach(el => {
        const q = Number(el?.qty) || 1;
        const id = el?.invId || el?.imsId;
        const topItem = id ? (inventory || []).find(i => String(i.id) === String(id)) : null;
        if (topItem) {
          // Walk kit components too — a kit component (e.g. a side table bundled into a couch-set
          // kit) is its own line in blockedItemsGrouped, filed under its own department, but was
          // only ever indexed here by the OUTER kit element's own id/name. A component-only item
          // never matched any individual function this way and silently only ever showed under
          // "All functions" — looking like it came from nowhere.
          walkKitUnits(topItem, q, inventory, el.kitOverrides, (node, nodeQty) => {
            byId.set(String(node.id), (byId.get(String(node.id)) || 0) + nodeQty);
            const nnm = String(node.name || "").trim().toLowerCase();
            if (nnm) byName.set(nnm, (byName.get(nnm) || 0) + nodeQty);
          });
        } else {
          if (id) byId.set(String(id), (byId.get(String(id)) || 0) + q);
          const nm = String(el?.name || "").trim().toLowerCase();
          if (nm) byName.set(nm, (byName.get(nm) || 0) + q);
        }
      });
    });
    return { byId, byName };
  };
  const invFnQty = useMemo(() => qtyMapsOfFn(invScoped ? mpFns[invFn] : null), [sel, invFn, inventory]);
  // ── ONE COLUMN PER EVENT DATE ──
  // A booking whose functions fall on different dates (the same guest on the 19th and the 20th) is loaded on different days, so the whole-event
  // list must not run them together. From two dates up, All functions gets a column per date saying how many of each item are LOADED that day.
  // Pieces already standing at the venue from the day before are reused, not loaded again: 8 sofas needed on the 19th and 12 on the 20th load 8,
  // then 4 - so the columns add up to the most ever needed at once (lib/ims/loadByDate.js). That holds for the same venue on consecutive days;
  // after a day with no event there the pieces have gone back and the next date loads in full. Functions on one date at one venue share the
  // pieces (the largest need counts); different venues are separate. The rule is run here, in DATE order from the functions' current dates, on
  // what each function NEEDS: Deal Check's per-function record where it has one (byFn[function].rentalQty - the raw need, not the units it
  // happened to bring in, which depend on the order the functions were entered in), else the function's zone lists. Production and buying lines
  // have no per-function need. Whatever cannot be tied to a date - kit parts, truss, platform, carpet, print, production lines, a function with
  // no date - shows in an "Other" column (only when some row has any) instead of disappearing.
  const dateCols = useMemo(() => {
    const dates = new Set();
    // per venue: its dates in order, each with an entry per function held there that day
    const chains = new Map();
    mpFns.forEach((fd, fi) => {
      const d = String(fd?.date || "").slice(0, 10);
      if (!d) return;
      dates.add(d);
      const vk = String(fd?.venue || "").trim().toLowerCase() || `fn:${fi}`; // a function with no venue recorded stands alone
      if (!chains.has(vk)) chains.set(vk, new Map());
      const days = chains.get(vk);
      if (!days.has(d)) days.set(d, []);
      days.get(d).push({ key: String(fd?.fnIdx ?? fi), maps: qtyMapsOfFn(fd) });
    });
    if (dates.size < 2) return [];
    const venueChains = [...chains.values()].map(days => [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, maps]) => ({ date, maps })));
    const entries = venueChains.flat().flatMap(day => day.maps); // every dated function, once
    return [...dates].sort().map(date => {
      let label = date;
      try { label = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch { /* keep the ISO date */ }
      const names = mpFns.filter(f => String(f?.date || "").slice(0, 10) === date).map((f, k) => f?.type || `Function ${k + 1}`).join(", ");
      return { date, label, names, venueChains, entries };
    });
  }, [sel, inventory]);
  // How many of this row each function needs, by function key. Deal Check's per-function figure (byFn[function].rentalQty) is the base; the function's
  // zone lists also count the parts of its kits (a Crystal Vedi carries 12 WARM LED), which Deal Check files under the row with no function of its
  // own. Those extra parts are added to the function that has them, but never beyond what Deal Check says the row holds that byFn does not
  // (rentalQty minus the sum of byFn) - the zone lists can run ahead of what was billed (kit parts edited in Deal Check, skipped cards), and the
  // total must not. A row with no byFn is read from the zone lists alone; production/buying lines have no per-function need.
  const allFnMaps = useMemo(() => mpFns.map((fd, fi) => ({ key: String(fd?.fnIdx ?? fi), maps: qtyMapsOfFn(fd) })), [sel, inventory]);
  const needsCache = useMemo(() => new WeakMap(), [allFnMaps]);
  // scales whole numbers down so they add up to exactly `target` (largest remainders get the leftover units)
  const scaleInts = (list, target) => {
    const sum = list.reduce((a, x) => a + x.n, 0);
    if (!(sum > target) || sum <= 0) return list.map(x => ({ ...x }));
    const raw = list.map(x => ({ ...x, exact: (x.n * target) / sum }));
    const out = raw.map(x => ({ ...x, n: Math.floor(x.exact) }));
    let left = target - out.reduce((a, x) => a + x.n, 0);
    [...out].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact))).forEach(x => { if (left > 0 && x.exact - Math.floor(x.exact) > 0) { x.n += 1; left -= 1; } });
    return out;
  };
  const rowNeeds = (it) => {
    if (needsCache.has(it)) return needsCache.get(it);
    const zoneOf = (m) => (it.prodOrBuy ? 0 : ((it.invId && m.maps.byId.get(String(it.invId))) || m.maps.byName.get(String(it.name || "").trim().toLowerCase()) || 0));
    const out = new Map();
    if (it.byFn) {
      const baseOf = (k) => Number(it.byFn[k]?.rentalQty ?? it.byFn[k]?.qty) || 0;
      const baseAll = Object.keys(it.byFn).reduce((sum, k) => sum + baseOf(k), 0);
      const unattributed = Math.max(0, (Number(it.rentalQty ?? it.qty) || 0) - baseAll);
      const extras = scaleInts(allFnMaps.map(m => ({ key: m.key, n: Math.max(0, zoneOf(m) - baseOf(m.key)) })), unattributed);
      allFnMaps.forEach(m => out.set(m.key, baseOf(m.key) + (extras.find(e => e.key === m.key)?.n || 0)));
    } else {
      // no per-function record: the zone lists, scaled down if they add up to more than the line holds (they can run ahead of what was billed)
      const cap = Number(it.rentalQty ?? it.qty) || 0;
      scaleInts(allFnMaps.map(m => ({ key: m.key, n: zoneOf(m) })), cap).forEach(z => out.set(z.key, z.n));
    }
    needsCache.set(it, out);
    return out;
  };
  const needOfFn = (it) => { const needs = rowNeeds(it); return (m) => needs.get(m.key) || 0; };
  const qtyOnDate = (col, it) => loadOnDate(col.venueChains, col.date, needOfFn(it));
  // The part of a row no function claims (truss, platform, carpet, print, or a line the zone lists do not mention): what is billed less what the
  // functions need. Pieces a date does not load because they are already standing from the day before are NOT "other" - they are reuse - so this
  // is read from the needs, not from the loads.
  const otherQty = (it) => {
    if (!dateCols.length) return 0;
    const need = needOfFn(it);
    const dated = dateCols[0].entries.reduce((sum, m) => sum + need(m), 0);
    return Math.max(0, (Number(it.rentalQty ?? it.qty) || 0) - dated);
  };
  // With date columns, the Rental qty column also shows when the dates' loads and Other do not add up to the billed quantity (the difference is
  // pieces already standing from the day before), so the columns never look like they lost a quantity.
  const rentalDiffers = (it) => Number(it.rentalQty ?? it.qty) !== (Number(it.qty) || 0)
    || (dateCols.length > 0 && !invScoped && dateCols.reduce((sum, c) => sum + qtyOnDate(c, it), 0) + otherQty(it) !== (Number(it.rentalQty ?? it.qty) || 0));
  const invShown = invScoped
    ? blockedItemsGrouped.map(it => {
        const q = rowNeeds(it).get(String(mpFns[invFn]?.fnIdx ?? invFn)) || 0;
        if (!q) return null;
        // byFn[invFn] (Deal Check's own per-function record, dealcheck/DealCheckOverlay.jsx's cost
        // rollup) is this function's REAL billed total — read it directly rather than estimating a
        // share. The old qty÷mergedQty proportional estimate only gives the right answer when every
        // function in a reuse group bills the same per-unit rate; a function reusing a sibling's
        // already-standing units at a Repeat discount does NOT, so two functions needing the
        // identical qty both computed a 100% share and both showed the FULL merged total as if it
        // were theirs alone. Falls back to the old estimate for rows with no byFn (truss/fabric/
        // platform/print/custom items never claim cross-function reuse, so the estimate is exact
        // for them) or an event synced before this field existed.
        const fnRow = it.byFn && it.byFn[invFn];
        // The count above reads the function's zone lists, which include the parts of its kits (a Crystal Vedi's 12 WARM LED); Deal Check files those
        // under the row with no function of their own, so byFn's total does not hold them. Priced here at the rate of the part of the line byFn does not
        // cover, so qty × rate agrees with the total (181 × ₹75, not 181 shown against the money for 169).
        let kitPartsValue = 0;
        if (it.byFn) {
          const fnRental = fnRow ? (Number(fnRow.rentalQty ?? fnRow.qty) || 0) : 0;
          const extraQty = Math.max(0, q - fnRental);
          if (extraQty > 0) {
            const rows = Object.values(it.byFn);
            const unQty = (Number(it.rentalQty ?? it.qty) || 0) - rows.reduce((sum, r) => sum + (Number(r.rentalQty ?? r.qty) || 0), 0);
            const unTotal = (Number(it.total) || 0) - rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
            const rate = unQty > 0 && unTotal > 0 ? unTotal / unQty : (fnRental > 0 ? (Number(fnRow.total) || 0) / fnRental : (Number(it.total) || 0) / Math.max(1, Number(it.rentalQty ?? it.qty) || 1));
            kitPartsValue = extraQty * rate;
          }
        }
        const total = it.byFn ? Math.round((Number(fnRow?.total) || 0) + kitPartsValue) : Math.round((Number(it.total) || 0) * ((Number(it.qty) || 0) > 0 ? q / Number(it.qty) : 1));
        // What this function LOADS: its need less the pieces already standing at the venue from the day before (the date columns' rule). Functions of one
        // date at one venue share the pieces, so the one with the largest need carries that day's load and the others load nothing new.
        let load = q;
        const fnKey = String(mpFns[invFn]?.fnIdx ?? invFn);
        const fnDate = String(mpFns[invFn]?.date || "").slice(0, 10);
        const dcol = dateCols.find(c => c.date === fnDate);
        if (dcol) {
          const chain = dcol.venueChains.find(days => days.some(d => d.date === fnDate && d.maps.some(m => m.key === fnKey)));
          if (chain) {
            const needs = rowNeeds(it);
            const day = chain.find(d => d.date === fnDate);
            const top = day.maps.reduce((best, m) => ((needs.get(m.key) || 0) > (needs.get(best.key) || 0) ? m : best), day.maps[0]);
            load = top.key === fnKey ? Math.min(q, loadOnDate([chain], fnDate, needOfFn(it))) : 0;
          }
        }
        return { ...it, src: it, qty: load, rentalQty: q, total, shortQty: Math.min(Number(it.shortQty) || 0, q), calc: fnRow ? (fnRow.calc || null) : null };
      }).filter(Boolean)
    : blockedItemsGrouped;
  const invWholeOnly = invScoped ? blockedItemsGrouped.length - invShown.length : 0;
  const showDates = !invScoped && dateCols.length > 0;
  const anyOther = showDates && invShown.some(it => otherQty(it) > 0);
  const dateSpacers = showDates ? dateCols.length + (anyOther ? 1 : 0) - 1 : 0; // keeps the expanded sub-rows' qty/rate/total under their headers
  // Paint colours and print jobs for the rows on screen — scoped to one function when the list is.
  const invFinish = useMemo(
    () => buildFinish(invScoped ? [sel?.functionsDetail?.[invFn]] : sel?.functionsDetail, inventory, settings?.printMaterials),
    [sel, invScoped, invFn, inventory, settings?.printMaterials]);
  const invShownTotal = invShown.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const inMpFn = (d) => {
    const fd = mpFnDate(mpFns[mpFn]);
    // afterDate (not a re-derived "day after" via mpNextDay) — a back-to-back booking's dismantle
    // entry has no real calendar date of its own (StudioApp/DealCheckOverlay key it
    // `${date}:btwdismantle`), so matching by date alone would never find it. A snapshot saved
    // before this field existed has no afterDate at all, so it falls back to the old derivation —
    // same date math mpNextDay already did, just inline — rather than never matching anything.
    if (d.phase === "dismantle") return d.afterDate ? d.afterDate === fd : d.date === mpNextDay(fd);
    if (d.phase === "minusOne") return fd === mpFirstDate;
    return (d.phase || "event") === "event" && d.date === fd;
  };
  // _i is the row's place in mpRows — the index setMp and the open/closed state are keyed by.
  // Supervisors sorts last — ops IS the supervisor, so its card is just a name + the amount
  // charged (no per-day explanation makes sense for it); it reads better at the bottom of the
  // list than mixed in among crew types that actually have a day-wise plan to show.
  const mpShown = (mpScoped
    ? mpRows.map((r, i) => ({ ...r, _i: i })).filter(r => dayWise(r)).map(r => ({ ...r, schedule: r.schedule.filter(inMpFn), _scoped: true })).filter(r => r.schedule.length)
    : mpRows.map((r, i) => ({ ...r, _i: i }))
  ).sort((a, b) => (a.type === "Supervisors" ? 1 : 0) - (b.type === "Supervisors" ? 1 : 0));
  const mpWholeOnly = mpScoped ? mpRows.filter(r => !dayWise(r)).length : 0;
  const mpShownCost = mpScoped ? mpShown.reduce((s, r) => s + lineCost(r), 0) : mpCost;
  const mpPlannedCost = mpRows.reduce((s, r) => s + (Number(r.sysCost) || 0), 0); // system baseline (before edits)
  // ── Event-wide Labours total. Ops runs the whole event, so he sets the TOTAL labour headcount and the
  // system re-splits it across every department by their existing usage share (scale each dept's per-day
  // labour by newTotal/currentTotal). Writes each dept's mpDay → flows via the normal reconciliation. ──
  // ── WHOLE-EVENT MANPOWER ── every department's crew on this booking, with each department's own
  // edits applied (the same mpLineCost each dept's panel uses), so the totals here are the sum of
  // what every dept head sees. Shared crew (Labours, Supervisors) carry ONE event-wide headcount per
  // day in their schedule (day.count, before the per-dept share), so their headcount is read from
  // there rather than added up across departments — adding it would count the same people 7 times.
  // A schedule day's short name: the date, or the setup / dismantle / gap day it stands for.
  const phaseLbl = (d) => d.phase === "minusOne" ? "−1 setup" : d.phase === "dismantle" ? "+1 dismantle" : d.phase === "gap" ? "gap" : (d.date || "event");
  // Moved to lib/ims/helpers.js (aggregateEventManpower) so Deal Check's Manpower tab can show the
  // same ops-reconciled numbers — see its own comment for why.
  const eventManpower = () => aggregateEventManpower(sel?.manpowerDetail, sel?.deptOps);
  const labDetailFor = (d) => { const rows = sel?.manpowerDetail?.[d]; return Array.isArray(rows) ? rows.find(r => r.type === "Labours") : null; };
  const labEffPerDay = (d, day) => { const md = sel?.deptOps?.[d]?.mpDay?.Labours || {}; if (md[day.date] != null) return Number(md[day.date]) || 0; return day.share != null ? (Number(day.count) || 0) * Number(day.share) : (Number(day.count) || 0); };
  const labShiftsFor = (d, day) => { const mw = sel?.deptOps?.[d]?.mpWin?.Labours; const ids = mw && mw[day.date] != null ? mw[day.date] : (Array.isArray(day.windowIds) ? day.windowIds : null); return ids ? ids.length : (Number(day.windows) || 0); };
  const labDihariFor = (d) => { const lab = labDetailFor(d); if (!lab || !Array.isArray(lab.schedule)) return 0; return lab.schedule.reduce((s, day) => s + labEffPerDay(d, day) * labShiftsFor(d, day), 0); };
  const eventLabourDihari = Math.round(DEPTS.reduce((s, d) => s + labDihariFor(d), 0));
  const anyLabours = DEPTS.some(d => labDetailFor(d));
  const setEventLabourTotal = (val) => {
    const target = Math.max(0, Number(val) || 0);
    const cur = DEPTS.reduce((s, d) => s + labDihariFor(d), 0);
    if (cur <= 0 || !sel) return;
    const ratio = target / cur;
    setEventOrders(prev => prev.map(e => {
      if (e.id !== sel.id) return e;
      const ops = { ...(e.deptOps || {}) };
      DEPTS.forEach(d => {
        const lab = labDetailFor(d); if (!lab || !Array.isArray(lab.schedule)) return;
        const od = { ...(ops[d] || {}) }; const md = { ...(od.mpDay || {}) }; const labDay = { ...(md.Labours || {}) };
        lab.schedule.forEach(day => { labDay[day.date] = Math.max(0, Math.round(labEffPerDay(d, day) * ratio)); });
        md.Labours = labDay; od.mpDay = md; od.updatedAt = Date.now(); od.updatedBy = authUser?.name || "—";
        ops[d] = od;
      });
      return { ...e, deptOps: ops };
    }));
  };
  const mpEdited = Object.keys(mpOverrides).length > 0 || Object.keys(mpDay).length > 0 || Object.keys(mpWin).length > 0 || Object.keys(mpWinCount).length > 0 || (Array.isArray(mpExtra) && mpExtra.length > 0);
  // Manual rows + whatever's synced from Ops — shown as two separate lists below so a head can see
  // which is which, not silently merged into one anonymous total.
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0) + opsExpenseTotal;
  const realMandiNum = Number(realMandi) || 0;

  const setMp = (i, key, val) => {
    const row = mpRows[i]; if (!row) return;
    if (row._extra) {
      const base = Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra;
      // Added-crew rows (removeMp's own kind) are matched by their own stored index — two rows of
      // the same type (e.g. "Labours" added twice by accident) are otherwise indistinguishable by
      // type alone, and editing one would silently land on whichever came first in the array.
      const idx = row._addedExtra ? row._extraIdx : base.findIndex(r => r.type === row.type);
      const next = base.slice();
      if (idx >= 0 && idx < next.length) next[idx] = { ...next[idx], [key]: val }; else next.push({ type: row.type, count: row.count, rate: row.rate, [key]: val });
      saveDept({ mpExtra: next });
    } else {
      saveDept({ mpOverrides: { ...mpOverrides, [row.type]: { ...(mpOverrides[row.type] || {}), [key]: val } } });
    }
  };
  const addMp = () => saveDept({ mpExtra: [...(Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra), { type: "Labours", count: "", rate: Number(dihari["Labours"]?.rate) || 0 }] });
  // Undo a "+ Add crew type" click (e.g. an accidental double-click that left two identical rows) —
  // by the row's own index in mpExtra, not its type, so one of several same-type extras can be
  // removed without taking the others with it.
  const removeMp = async (row) => {
    if (!row._addedExtra) return;
    if (!(await askDelete(`Remove "${row.type || row.name || "this crew line"}"?`, "Removes this crew line from the manpower plan."))) return;
    const base = Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra;
    saveDept({ mpExtra: base.filter((_, i) => i !== row._extraIdx) });
  };
  // On-site actual crew: set the real head-count held (applies to every scheduled day for day-wise crew,
  // else a straight count override) → flows to the P&L + Studio via the same mpDay/mpOverrides fields.
  const setActualCrew = (r, i, val) => { const n = Math.max(0, Number(val) || 0); if (mpDayWise(r) && Array.isArray(r.schedule) && r.schedule.length) { const m = { ...(mpDay[r.type] || {}) }; r.schedule.forEach(d => { m[d.date] = n; }); const wc = { ...mpWinCount }; delete wc[r.type]; saveDept({ mpDay: { ...mpDay, [r.type]: m }, mpWinCount: wc }); } else setMp(i, "count", n); };
  const resetMpLine = (r) => { const nd = { ...mpDay }; delete nd[r.type]; const nw = { ...mpWin }; delete nw[r.type]; const no = { ...mpOverrides }; delete no[r.type]; const wc = { ...mpWinCount }; delete wc[r.type]; saveDept({ mpDay: nd, mpWin: nw, mpOverrides: no, mpWinCount: wc }); };
  const addExpense = () => saveDept({ expenses: [...expenses, { label: "", amount: "" }] });
  const setExpense = (i, key, val) => { const next = expenses.map((e, j) => j === i ? { ...e, [key]: val } : e); saveDept({ expenses: next }); };
  const delExpense = async (i) => {
    const ex = expenses[i];
    if (!(await askDelete(`Delete this expense${ex?.name || ex?.label || ex?.desc ? ` (${ex.name || ex.label || ex.desc})` : ""}?`, "It will no longer count towards the actual spend."))) return;
    saveDept({ expenses: expenses.filter((_, j) => j !== i) });
  };

  // ── Floral: editable real-mandi shopping list (projected vs actual, side-by-side) ──
  const fp = sel?.floralPlan || {};
  const fpFlowers = Array.isArray(fp.flowers) ? fp.flowers : [];
  const artificialProj = fpFlowers.filter(f => f.artificial).reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const seedMandi = fpFlowers.filter(f => !f.artificial && (Number(f.qty) || 0) > 0)
    .map(f => {
      // colorVariant — the salesperson's colour pick in Deal Check (ranked preference or the
      // legacy single pick), carried through calcFnFloralSourcingCost's own breakdown
      // (StudioApp.jsx) so the purchase manager sees WHICH colour to actually buy, not just a
      // bare flower name.
      // price: f.rate IS the real mandi rate this flower costed at (qty already whole-unit —
      // f.cost = qty × rate at the source). Older snapshots captured before `rate` existed have
      // no such field, so those fall back to the previous cost÷qty approximation rather than
      // showing no price at all — only ever a stand-in for a snapshot nobody has regenerated since.
      const price = (typeof f.rate === "number" && f.rate > 0) ? f.rate : (f.qty ? Math.round(((Number(f.cost) || 0) / f.qty) * 100) / 100 : 0);
      const row = { name: f.name, unit: f.unit || "", projQty: Number(f.qty) || 0, projCost: Number(f.cost) || 0, qty: Number(f.qty) || 0, price, colorVariant: f.colorVariant || null, colorPrefs: f.colorPrefs || null };
      return row;
    });
  // Once shopping has started, mandiLines (the logged qty/price/swap data) is the source of truth
  // for everything EXCEPT colour — re-merging colorVariant/colorPrefs fresh from seedMandi (i.e.
  // from whatever floralPlan currently says) on every render means a colour picked in Deal Check
  // AFTER shopping began still reaches the purchase manager, instead of being frozen out until
  // someone remembers to click "↺ Reset to system plan" (which would also wipe the logged qty/price
  // nobody wants touched). Matched by name; a row with no live match (e.g. a swap replacement) is
  // left exactly as it was.
  const seedColourByName = {};
  seedMandi.forEach(r => { if (!seedColourByName[r.name]) seedColourByName[r.name] = { colorVariant: r.colorVariant, colorPrefs: r.colorPrefs }; });
  const mandiRows = Array.isArray(deptData.mandiLines)
    ? deptData.mandiLines.map(r => seedColourByName[r.name] ? { ...r, ...seedColourByName[r.name] } : r)
    : seedMandi;
  // Real shopping hasn't been logged until someone actually edits a row — until then, mandiRows is
  // just seedMandi (the plan's own quantities/prices mirrored in as a starting point), so the "Real
  // shopping" numbers can look fully filled in even though nobody has been to the mandi yet.
  const mandiShopped = Array.isArray(deptData.mandiLines);
  const mandiActualReal = mandiRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const mandiActualTotal = mandiActualReal + artificialProj; // artificial carried over (not re-shopped at mandi)
  const projMandiReal = mandiRows.reduce((s, r) => s + (Number(r.projCost) || 0), 0);
  // Persist the list AND the headline actual (realMandi) so Studio's P&L reflection picks it up.
  const saveMandi = (next) => saveDept({ mandiLines: next, realMandi: next.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0) + artificialProj });
  const setMandi = (i, key, val) => saveMandi(mandiRows.map((r, j) => j === i ? { ...r, [key]: val } : r));
  // Deleting a swap's replacement row undoes the swap on its original too, so the original is not
  // left at qty 0 still claiming it was swapped.
  const delMandi = async (i) => {
    const row = mandiRows[i]; if (!row) return;
    if (!(await confirm({ title: `Remove "${row.name}" from this shopping list?`, body: "This only removes it from this event's real-shopping list — the Mandi Prices catalogue itself is untouched." }))) return;
    saveMandi(mandiRows.filter((_, j) => j !== i).map(r => (row.swapFor && r.name === row.swapFor && r.swappedTo) ? { ...r, swappedTo: undefined, swapNote: undefined, qty: Number(r.projQty) || 0 } : r));
  };
  // ── 🔁 SWAP: NOT IN THE MANDI TODAY ──
  // The shopper puts 0 against a flower (or taps 🔁) and records what was bought instead. The
  // original row stays, at qty 0, marked swappedTo; the replacement is its own row right under it,
  // marked swapFor — so the total, realMandi and Studio's P&L carry the money with no extra rule,
  // and the Floral setup book for this event shows the replacement in each arrangement.
  const openMandiSwap = (i) => {
    const r = mandiRows[i];
    if (!r || r.swapFor) return;
    const cur = mandiRows.find(x => x.swapFor === r.name);
    setMandiSwap({ i, q: "", toName: cur?.name || "", qty: String(cur ? cur.qty : (Number(r.projQty) || "")), price: String(cur ? cur.price : ""), note: r.swapNote || "" });
  };
  const saveMandiSwap = ({ i, toName, qty, price, note }) => {
    const orig = mandiRows[i];
    const to = mandiCatalogue.find(c => c.name === toName);
    if (!orig || !to) return;
    const rest = mandiRows.filter(x => x.swapFor !== orig.name);
    const at = rest.indexOf(orig);
    const next = rest.map((x, j) => j === at ? { ...x, qty: 0, swappedTo: to.name, swapNote: note.trim() } : x);
    next.splice(at + 1, 0, { name: to.name, unit: to.unit || "", projQty: 0, projCost: 0, qty: Number(qty) || 0, price: Number(price) || 0, swapFor: orig.name, swapNote: note.trim() });
    saveMandi(next);
    setMandiSwap(null);
  };
  const removeMandiSwap = async (i) => {
    const orig = mandiRows[i];
    if (!orig) return;
    if (!(await askDelete("Remove this swap?", `${orig.name} goes back to the original shopping-list line.`))) return;
    saveMandi(mandiRows.filter(x => x.swapFor !== orig.name).map(x => x === orig ? { ...x, swappedTo: undefined, swapNote: undefined, qty: Number(x.projQty) || 0 } : x));
    setMandiSwap(null);
  };
  // 🖨️ This event's mandi shopping sheet — the same new-tab print the truck challan uses. What to
  // buy (the real-shopping list as it stands, swaps included) with blank columns for what was
  // actually bought and paid, so the sheet comes back from the mandi filled in.
  const printMandiList = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = (v) => { const n = Number(v) || 0; return String(Math.round(n * 100) / 100); };
    // Each flower with its photo, so the shopper can match it at the stall: the colour picked in
    // Deal Check first, else the catalogue's own photo (or its first variant's).
    const photoOf = (r) => {
      if (r.colorVariant?.photoUrl) return r.colorVariant.photoUrl;
      const c = mandiCatalogue.find(x => String(x.name || "").trim().toLowerCase() === String(r.name || "").trim().toLowerCase());
      return c?.photoUrl || (c?.colorVariants || []).find(v => v.photoUrl)?.photoUrl || "";
    };
    const rows = mandiRows.map((r, i) => {
      const sub = [
        r.colorVariant?.label ? `🎨 ${esc(r.colorVariant.label)}` : "",
        Array.isArray(r.colorPrefs) && r.colorPrefs.length > 1 ? `if not at the mandi: ${esc(r.colorPrefs.slice(1).map(p => p.label).join(", "))}` : "",
        r.swappedTo ? `🔁 Not in the mandi — swapped with ${esc(r.swappedTo)}${r.swapNote ? " · " + esc(r.swapNote) : ""}` : "",
        r.swapFor ? `🔁 Bought instead of ${esc(r.swapFor)}${r.swapNote ? " · " + esc(r.swapNote) : ""}` : "",
      ].filter(Boolean).map(s => `<div class="s${s.startsWith("🔁") ? " sw" : ""}">${s}</div>`).join("");
      const line = (Number(r.qty) || 0) * (Number(r.price) || 0);
      const ph = photoOf(r);
      return `<tr${r.swappedTo ? ' class="off"' : ""}><td class="c">${i + 1}</td><td class="c">${ph ? `<img src="${esc(ph)}">` : ""}</td><td><b>${esc(r.name)}</b>${sub}</td>`
        + `<td class="r">${Number(r.projQty) > 0 ? `${num(r.projQty)} ${esc(r.unit)}` : "extra"}</td>`
        + `<td class="r"><b>${num(r.qty)}</b> ${esc(r.unit)}</td><td class="r">₹${num(r.price)}</td><td class="r">₹${num(line)}</td>`
        + `<td class="blank"></td><td class="blank"></td></tr>`;
    }).join("");
    w.document.write(`<html><head><title>Mandi List — ${esc(sel?.clientName || "Event")}</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top}th{background:#f5f5f5;text-align:left}td.c{text-align:center}td.r,th.r{text-align:right;white-space:nowrap}td.blank{min-width:70px}img{width:44px;height:44px;object-fit:cover;border-radius:5px;display:block;margin:auto}tr.off img{opacity:.45}.s{color:#777;font-size:10.5px;margin-top:2px}.sw{color:#B45309;font-weight:bold}tr.off td{color:#999}tr.off b{text-decoration:line-through}tr{break-inside:avoid}tfoot td{font-weight:bold;background:#ECFDF5}@media print{button{display:none}body{padding:0}@page{size:A4;margin:10mm}}</style></head><body>
      <h2>🌸 Ambria — Mandi Shopping List</h2>
      <p>Event: ${esc(sel?.clientName || "-")} &nbsp;|&nbsp; ${esc(selDateStr || "-")} &nbsp;|&nbsp; ${esc(sel?.functionsDetail?.[0]?.venue || sel?.venue || "-")}</p>
      <table><tr><th class="c">#</th><th class="c">Photo</th><th>Flower</th><th class="r">Planned</th><th class="r">To buy</th><th class="r">₹/unit</th><th class="r">Total</th><th>Bought qty</th><th>Paid ₹/unit</th></tr>${rows || '<tr><td colspan="9" style="text-align:center;color:#999">No flowers on the list</td></tr>'}
      <tfoot><tr><td colspan="6">Total (real flowers)</td><td class="r">₹${num(mandiActualReal)}</td><td></td><td></td></tr></tfoot></table>
      <br><p>Bought by: _______________ &nbsp;&nbsp; Checked by: _______________</p>
      <p>Date: ____________ &nbsp;&nbsp; Time: ____________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  };
  const addMandi = (cat) => { saveMandi([...mandiRows, { name: cat.name, unit: cat.unit || "", projQty: 0, projCost: 0, qty: 1, price: Number(cat.currentPrice) || 0 }]); setMandiQuery(""); };
  // Reset the real shopping list back to the system's original mandi plan (from Deal Check).
  const resetMandi = () => saveMandi(seedMandi.map(r => ({ ...r })));
  const mandiSuggest = useMemo(() => {
    const q = mandiQuery.toLowerCase().trim();
    if (!q) return [];
    return mandiCatalogue.filter(f => (f.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [mandiQuery, mandiCatalogue]);

  // ── Reusable essentials / tools template (per department) + per-event loading state ──
  const toolkitAll = (settings?.deptToolkits && typeof settings.deptToolkits === "object") ? settings.deptToolkits : {};
  const deptTools = Array.isArray(toolkitAll[dept]) ? toolkitAll[dept] : [];
  const saveTools = (next) => setSettings && setSettings(s => ({ ...s, deptToolkits: { ...(s.deptToolkits || {}), [dept]: next } }));
  const addTool = (name) => { const n = String(name || "").trim(); if (!n || deptTools.some(t => (t.name || "").toLowerCase() === n.toLowerCase())) return; saveTools([...deptTools, { name: n, qty: 1 }]); setNewTool(""); };
  const setTool = (i, key, val) => saveTools(deptTools.map((t, j) => j === i ? { ...t, [key]: val } : t));
  const delTool = async (i) => {
    if (!(await askDelete(`Remove "${deptTools[i]?.name || "this tool"}"?`, "It will be taken off this event's tools list."))) return;
    saveTools(deptTools.filter((_, j) => j !== i));
  };

  const loaded = (deptData.loaded && typeof deptData.loaded === "object") ? deptData.loaded : {};
  const toggleLoaded = (key) => saveDept({ loaded: { ...loaded, [key]: !loaded[key] } });
  const loadKeys = [...blockedItems.map(it => "inv:" + it.id), ...deptTools.map(t => "tool:" + t.name)];
  const totalLoadItems = loadKeys.length;
  const loadedCount = loadKeys.filter(k => loaded[k]).length;
  const dispatch = deptData.dispatch || { vehicle: "", driver: "", phone: "" };
  const setDispatch = (key, val) => saveDept({ dispatch: { ...dispatch, [key]: val } });
  // ── Multi-truck dispatch — inventory goes out across several trucks, each with its own challan ──
  const TRUCK_STATUS = ["loading", "dispatched", "at-site", "returned"];

  // ── ONE SET OF TRUCKS FOR THE WHOLE EVENT ──
  // The same truck usually carries several departments' loads, so trucks belong to the event
  // (eo.trucks), not to a department. Each department fills only its own slice of a truck
  // (truck.loads[dept] = { itemKey: qty }) and sees the others' as read-only, which also keeps two
  // heads loading the same truck from writing over each other's lines.
  //
  // How full a truck is comes from Planning → 🚚 Truck: how many of a sub-category fit one truck
  // (truckCap, "ambria-transport-v3" — the blob IMS settings state leaves out, so it is read here).
  // 50 pots to a truck and 10 loaded is 20% of it. Capacities set by area or weight (truss, platform,
  // carpet in sqft, liza in kg) cannot be divided into a piece count, so those items take Deal
  // Check's own truck share for their load (transportPlan), spread over the pieces that make it up.
  // An item with neither is shown as "no capacity set" and left out of the %, rather than counted as
  // taking no room — a truck must never look emptier than it is.
  const [truckCap, setTruckCap] = useState([]);
  useEffect(() => {
    let on = true;
    kvGet(RC_SK_TR).then(v => {
      let o = v;
      for (let i = 0; i < 2 && typeof o === "string"; i++) { try { o = JSON.parse(o); } catch { break; } }
      if (on && Array.isArray(o?.truckCap)) setTruckCap(o.truckCap);
    }).catch(() => {});
    return () => { on = false; };
  }, []);
  const capBySub = useMemo(() => {
    const m = new Map();
    truckCap.forEach(t => { if (t?.item && Number(t.perTruck) > 0) m.set(String(t.item).trim().toLowerCase(), t); });
    return m;
  }, [truckCap]);
  const PIECE_UNITS = ["pc", "bundle", "bunch"];
  // Which of Deal Check's transport loads an item belongs to. Its own sub-category for inventory;
  // the structural and fabric rows Deal Check pushes carry made-up subs ("truss structure",
  // "kg · zone"), so those are mapped to the load names the truck settings use.
  const planLabelOf = (it) => {
    const sb = String(it.sub || "").trim().toLowerCase(), nm = String(it.name || "").toLowerCase();
    if (sb.startsWith("truss")) return "truss";
    if (sb.startsWith("platform")) return "platform";
    if (sb.includes("carpet") || nm.includes("carpet")) return "carpet";
    if (nm.includes("liza")) return "liza";
    if (nm.includes("masking")) return "masking";
    if (nm.includes("curtain")) return "curtains";
    return sb;
  };
  // A department's flat item list, with the same ids its own Inventory list uses (kit shell + parts).
  const flatDeptItems = (d) => {
    if (d === dept) return blockedItems;
    const out = [];
    (Array.isArray(sel?.deptInventory?.[d]) ? sel.deptInventory[d] : []).forEach((x, i) => {
      const base = { id: x.name + i, invId: x.imsId || null, name: x.name, qty: Number(x.qty) || 0, sub: x.sub || "" };
      out.push(base);
      if (x.isKit && Array.isArray(x.components)) x.components.forEach((cp, ci) => out.push({ id: base.id + "__c" + ci, invId: cp.imsId || null, name: cp.name, qty: Number(cp.qty) || 0, sub: cp.sub || "", kitOf: x.name }));
    });
    return out;
  };
  // What a truck load is keyed by. The list ids above are positions in Deal Check's snapshot and move
  // when it is re-synced, so a load saved on the event is keyed by the inventory id (or the name).
  const truckKey = (it) => it.invId ? "inv:" + it.invId + (it.kitOf ? "@" + String(it.kitOf).toLowerCase() : "") : "nm:" + String(it.name || "").trim().toLowerCase();
  // Per department: itemKey → { perUnit (share of one truck per piece), perTruck, basis } or null.
  const truckShares = useMemo(() => {
    const out = {};
    DEPTS.forEach(d => {
      const items = flatDeptItems(d);
      const planByLabel = new Map();
      (sel?.transportPlan?.byDept?.[d]?.rows || []).forEach(r => { if (r?.buffer) return; const k = String(r.label || "").trim().toLowerCase(); planByLabel.set(k, (planByLabel.get(k) || 0) + (Number(r.trucks) || 0)); });
      const labelQty = new Map();
      items.forEach(it => { const l = planLabelOf(it); labelQty.set(l, (labelQty.get(l) || 0) + (Number(it.qty) || 0)); });
      const m = new Map();
      items.forEach(it => {
        const cap = capBySub.get(String(it.sub || "").trim().toLowerCase());
        if (cap && PIECE_UNITS.includes(String(cap.unit || "pc").toLowerCase())) { m.set(truckKey(it), { perUnit: 1 / Number(cap.perTruck), perTruck: Number(cap.perTruck), basis: "capacity" }); return; }
        const l = planLabelOf(it), pt = planByLabel.get(l) || 0, lq = labelQty.get(l) || 0;
        m.set(truckKey(it), pt > 0 && lq > 0 ? { perUnit: pt / lq, perTruck: lq / pt, basis: "deal check" } : null);
      });
      out[d] = m;
    });
    return out;
  }, [sel, blockedItems, capBySub, dept]);
  // Trucks saved before they were shared lived in each department's own deptOps; until the event has
  // a list of its own, they are read from there (every department's) and become the list on the
  // first change, loads re-keyed from list positions to inventory ids.
  const eventTruckList = Array.isArray(sel?.trucks) ? sel.trucks : Object.entries(sel?.deptOps || {}).flatMap(([d, od]) =>
    (Array.isArray(od?.trucks) ? od.trucks : []).map(t => {
      const items = flatDeptItems(d), ld = {};
      Object.entries(t.items || {}).forEach(([k, q]) => { const it = items.find(x => "inv:" + x.id === k); if (it && Number(q) > 0) ld[truckKey(it)] = Number(q); });
      return { id: t.id, vehicle: t.vehicle || "", driver: t.driver || "", phone: t.phone || "", status: t.status || "loading", loads: { [d]: ld } };
    }));
  const saveEventTrucks = (fn) => {
    if (!sel) return;
    const next = fn(eventTruckList);
    setEventOrders(prev => prev.map(e => e.id === sel.id ? { ...e, trucks: next } : e));
  };
  // This department's view of the shared trucks, in the shape the rest of the tab already reads —
  // items keyed "inv:"+listId — so the challans, the PDF and Receiving carry on unchanged.
  const keyByListId = new Map(blockedItems.map(it => ["inv:" + it.id, truckKey(it)]));
  // `extras` is the overload: pieces put on a truck BEYOND what the item needs (spares), kept apart
  // from the normal load (truck.extra[dept], same keys) so "10 of 10" stays true and the extra shows
  // as its own "+2 extra". It still takes room, so it counts toward how full the truck is; the
  // truck's capacity itself is never changed by it.
  const trucks = eventTruckList.map(t => {
    const mine = t.loads?.[dept] || {}, mineX = t.extra?.[dept] || {}, items = {}, extras = {};
    blockedItems.forEach(it => {
      const q = mine[truckKey(it)]; if (Number(q) > 0) items["inv:" + it.id] = q;
      const x = mineX[truckKey(it)]; if (Number(x) > 0) extras["inv:" + it.id] = x;
    });
    return { ...t, items, extras };
  });
  // One truck open at a time: opening another closes the last, so the next truck's header is on
  // screen at once instead of below a screen of the previous truck's items.
  const [openTruck, setOpenTruck] = useState(null);
  const truckRefs = useRef({});
  const toggleTruck = (id) => {
    const next = openTruck === id ? null : id;
    setOpenTruck(next);
    if (next) setTimeout(() => truckRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  };
  const addTruck = () => {
    const id = "trk_" + Date.now();
    saveEventTrucks(list => [...list, { id, vehicle: "", driver: "", phone: "", status: "loading", loads: {} }]);
    setOpenTruck(id);
  };
  const setTruck = (id, patch) => saveEventTrucks(list => list.map(t => t.id === id ? { ...t, ...patch } : t));
  const setTruckItem = (id, key, qty) => {
    const k = keyByListId.get(key);
    if (!k) return;
    saveEventTrucks(list => list.map(t => t.id === id ? { ...t, loads: { ...(t.loads || {}), [dept]: { ...((t.loads || {})[dept] || {}), [k]: qty } } } : t));
  };
  const setTruckExtra = (id, key, qty) => {
    const k = keyByListId.get(key);
    if (!k) return;
    saveEventTrucks(list => list.map(t => t.id === id ? { ...t, extra: { ...(t.extra || {}), [dept]: { ...((t.extra || {})[dept] || {}), [k]: qty } } } : t));
  };
  const delTruck = (id) => saveEventTrucks(list => list.filter(t => t.id !== id));
  const truckLoadedQty = (key) => trucks.reduce((s, t) => s + (Number(t.items?.[key]) || 0), 0); // total loaded across all trucks
  const truckExtraQty = (key) => trucks.reduce((s, t) => s + (Number(t.extras?.[key]) || 0), 0); // overload across all trucks
  const TRUCK_STATUS_LABEL = { loading: "Loading", dispatched: "Dispatched", "at-site": "At site", returned: "Returned" };
  const TRUCK_STATUS_CLS = { loading: "bg-blue-50 text-blue-700 ring-blue-200", dispatched: "bg-amber-50 text-amber-700 ring-amber-200", "at-site": "bg-emerald-50 text-emerald-700 ring-emerald-200", returned: "bg-gray-100 text-gray-600 ring-gray-200" };
  // How full each truck is: every department's loads, each piece counted at its share of a truck.
  const truckOcc = (t) => {
    let used = 0, unknown = 0;
    const byDept = [];
    const depts = [...new Set([...Object.keys(t.loads || {}), ...Object.keys(t.extra || {})])];
    depts.forEach(d => {
      const ld = {};
      [t.loads?.[d] || {}, t.extra?.[d] || {}].forEach(src => Object.entries(src).forEach(([k, q]) => { ld[k] = (ld[k] || 0) + (Number(q) || 0); }));
      let du = 0;
      Object.entries(ld).forEach(([k, q]) => {
        const qn = Number(q) || 0;
        if (qn <= 0) return;
        const sh = truckShares[d]?.get(k);
        if (sh) du += qn * sh.perUnit; else unknown += 1;
      });
      if (du > 0) byDept.push({ dept: d, used: du });
      used += du;
    });
    return { used, byDept, unknown };
  };
  const truckOccs = Object.fromEntries(eventTruckList.map(t => [t.id, truckOcc(t)]));
  const fullTrucks = eventTruckList.filter(t => truckOccs[t.id].used >= 0.999).length;
  const DEPT_BAR = { Furniture: "bg-amber-500", Floral: "bg-pink-500", Structure: "bg-slate-500", Tenting: "bg-emerald-500", Transport: "bg-orange-500", Lighting: "bg-yellow-400", Fabric: "bg-violet-500" };
  const printTruckChallan = (truck, n) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = blockedItems.filter(it => (Number(truck.items?.["inv:" + it.id]) || 0) > 0 || (Number(truck.extras?.["inv:" + it.id]) || 0) > 0)
      .map(it => { const x = Number(truck.extras?.["inv:" + it.id]) || 0; return `<tr><td>${it.name}</td><td>${it.sub || "—"}</td><td style="text-align:center">${Number(truck.items?.["inv:" + it.id]) || 0} of ${it.qty}${x ? ` + ${x} extra` : ""}</td></tr>`; }).join("");
    const toolRows = deptTools.map(t => `<tr><td>🛠️ ${t.name}</td><td>essential / tool</td><td style="text-align:center">${t.qty || 1}</td></tr>`).join("");
    w.document.write(`<html><head><title>Challan — ${dept} — Truck ${n}</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f3f4f6;text-align:left}h2{color:#4f46e5;margin-bottom:2px}h4{margin:14px 0 0}@media print{button{display:none}}</style></head><body>
      <h2>${DEPT_ICON[dept]} Ambria — ${dept} Challan · Truck ${n}</h2>
      <p>Event: ${sel?.clientName || "-"} &nbsp;|&nbsp; ${selDateStr || "-"} &nbsp;|&nbsp; ${sel?.functionsDetail?.[0]?.venue || sel?.venue || "-"}</p>
      <p>Vehicle: ${truck.vehicle || "______"} &nbsp;|&nbsp; Driver: ${truck.driver || "______"} &nbsp;|&nbsp; Phone: ${truck.phone || "______"}</p>
      <h4>Inventory on this truck</h4>
      <table><tr><th>Item</th><th>Type</th><th>Qty</th></tr>${rows || '<tr><td colspan="3" style="text-align:center;color:#999">No items assigned to this truck</td></tr>'}</table>
      ${toolRows ? `<h4>Essentials / tools</h4><table><tr><th>Item</th><th>Type</th><th>Qty</th></tr>${toolRows}</table>` : ""}
      <br><p>Dispatched by: _______________ &nbsp;&nbsp; Received by: _______________</p>
      <p>Date: ____________ &nbsp;&nbsp; Time: ____________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  };
  // The same challan as a downloaded PDF, for when no printer is at hand — it can be shared on
  // WhatsApp or printed later. Plain jsPDF text like the Actuals PDF; its built-in font has no
  // emoji, so the icons from the printed version are left out.
  const downloadTruckChallanPdf = async (truck, n) => {
    if (!sel || challanPdfBusy) return;
    setChallanPdfBusy(truck.id);
    try {
      const [{ jsPDF }] = await loadPdfLibs();
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 40;
      const cx = { name: M + 6, type: M + 300, qty: W - M - 6 };
      let y = M;
      const room = (h) => { if (y + h > H - M) { pdf.addPage(); y = M; } };
      const row = (cells, { bold = false, fill = null, h = 20 } = {}) => {
        room(h);
        if (fill) { pdf.setFillColor(...fill); pdf.rect(M, y - 13, W - M * 2, h, "F"); }
        pdf.setDrawColor(221); pdf.line(M, y - 13 + h, W - M, y - 13 + h);
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        cells.forEach(([t, x, align]) => pdf.text(String(t ?? ""), x, y, { align: align || "left", maxWidth: align === "right" ? undefined : 280 }));
        y += h;
      };
      const header = () => row([["Item", cx.name], ["Type", cx.type], ["Qty", cx.qty, "right"]], { bold: true, fill: [243, 244, 246] });
      // The Ambria Design & Decor mark at the head of the challan — the dark version (black wordmark,
      // gold "DESIGN & DECOR"), since the page is white. Sized off the crop's own proportions; a
      // logo that fails to load just leaves the title where it was.
      const logos = await loadPdfLogosOnce();
      if (logos.dark) {
        const lh = 34, lw = lh * LOGO_BOX.cw / LOGO_BOX.ch;
        pdf.addImage(logos.dark, "PNG", M, y - 6, lw, lh);
        y += lh + 18;
      }
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.setTextColor(79, 70, 229);
      pdf.text(`Ambria - ${dept} Challan - Truck ${n}`, M, y); y += 22;
      pdf.setTextColor(17); pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
      pdf.text(`Event: ${sel.clientName || "-"}  |  ${selDateStr || "-"}  |  ${sel.functionsDetail?.[0]?.venue || sel.venue || "-"}`, M, y); y += 16;
      pdf.text(`Vehicle: ${truck.vehicle || "______"}  |  Driver: ${truck.driver || "______"}  |  Phone: ${truck.phone || "______"}`, M, y); y += 26;
      pdf.setFontSize(9.5);
      pdf.setFont("helvetica", "bold"); pdf.text("Inventory on this truck", M, y); y += 16;
      header();
      const items = blockedItems.filter(it => (Number(truck.items?.["inv:" + it.id]) || 0) > 0 || (Number(truck.extras?.["inv:" + it.id]) || 0) > 0);
      if (items.length) items.forEach(it => { const x = Number(truck.extras?.["inv:" + it.id]) || 0; row([[it.name, cx.name], [it.sub || "-", cx.type], [`${Number(truck.items?.["inv:" + it.id]) || 0} of ${it.qty}${x ? ` + ${x} extra` : ""}`, cx.qty, "right"]]); });
      else row([["No items assigned to this truck", cx.name]]);
      if (deptTools.length) {
        y += 12; room(36);
        pdf.setFont("helvetica", "bold"); pdf.text("Essentials / tools", M, y); y += 16;
        header();
        deptTools.forEach(t => row([[t.name, cx.name], ["essential / tool", cx.type], [t.qty || 1, cx.qty, "right"]]));
      }
      y += 30; room(40);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
      pdf.text("Dispatched by: _______________      Received by: _______________", M, y); y += 20;
      pdf.text("Date: ____________      Time: ____________", M, y);
      pdf.setFontSize(8); pdf.setTextColor(120);
      pdf.text(`Generated ${new Date().toLocaleString("en-IN")} - ${authUser?.name || "-"}`, M, H - 20);
      const safe = (t) => String(t || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
      pdf.save(`Challan - ${safe(dept)} - Truck ${n} - ${safe(sel.clientName || "Event")} - ${safe(selDateStr || "no date")}.pdf`);
    } catch (err) {
      if (isStaleChunk(err)) { reloadForUpdate(); return; }
      alert(`Could not make the challan PDF.\n\n${err?.message || err}`);
    } finally {
      setChallanPdfBusy(null);
    }
  };
  // Own fleet — vehicle + regular driver + phone, saved once in settings; one tap fills all three.
  const fleet = Array.isArray(settings?.fleet) ? settings.fleet : [];
  // All trucks in play for THIS event — own fleet + any truck ANY department already entered (dispatch
  // trucks, dismantle movements, saved dispatch). A vendor truck typed by one dept becomes a one-tap
  // chip for every other dept, since the same truck often carries several departments' items together.
  const eventTrucks = useMemo(() => {
    const map = new Map();
    const add = (v, dr, ph) => { const vehicle = String(v || "").trim(), driver = String(dr || "").trim(), phone = String(ph || "").trim(); if (!vehicle && !driver && !phone) return; const key = (vehicle + "|" + driver + "|" + phone).toLowerCase(); if (!map.has(key)) map.set(key, { id: "et_" + map.size, vehicle, driver, phone }); };
    (Array.isArray(settings?.fleet) ? settings.fleet : []).forEach(f => add(f.vehicle, f.driver, f.phone));
    if (sel) Object.values(sel.deptOps || {}).forEach(od => {
      (Array.isArray(od?.trucks) ? od.trucks : []).forEach(t => add(t.vehicle, t.driver, t.phone));
      (Array.isArray(sel?.trucks) ? sel.trucks : []).forEach(t => add(t.vehicle, t.driver, t.phone));
      (Array.isArray(od?.movements) ? od.movements : []).forEach(m => add(m.vehicle, m.driver, m.phone));
      if (od?.dispatch) add(od.dispatch.vehicle, od.dispatch.driver, od.dispatch.phone);
    });
    return [...map.values()];
  }, [settings, sel]);
  const saveFleet = (next) => setSettings && setSettings(s => ({ ...s, fleet: next }));
  const pickFleet = (f) => saveDept({ dispatch: { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" } });
  const addFleet = () => { const v = (newVeh.vehicle || "").trim(); if (!v) return; saveFleet([...fleet, { id: "veh_" + Date.now(), vehicle: v, driver: (newVeh.driver || "").trim(), phone: (newVeh.phone || "").trim() }]); setNewVeh({ vehicle: "", driver: "", phone: "" }); };
  const delFleet = async (id) => {
    const f = fleet.find(x => x.id === id);
    if (!(await askDelete(`Remove ${f?.vehicle || "this vehicle"}?`, "It will be taken off this event's fleet."))) return;
    saveFleet(fleet.filter(x => x.id !== id));
  };

  // Actual spend logged by the head → exact P&L (mandi list + on-site expenses). Manpower is
  // tracked in its own Manpower plan card (mpCost, above) — folding it in here too double-counted
  // the same crew cost under two headings, so it's deliberately left out of Actuals.
  const mandiSpend = dept === "Floral" ? mandiActualTotal : 0;
  const actualCost = mandiSpend + expenseTotal;
  const hasActuals = mandiSpend > 0 || expenseTotal > 0;

  // ── ACTUALS AS A PDF ──
  // The shopping list and on-site expenses exactly as this card shows them, for the accounts file.
  // Plain jsPDF text, not the html2canvas route the department book takes: this is a table of
  // figures, so it writes instantly and stays selectable. jsPDF's built-in font has no ₹ glyph,
  // so amounts are written "Rs".
  const downloadActualsPdf = async () => {
    if (!sel || actualsPdfBusy) return;
    setActualsPdfBusy(true);
    try {
      const [{ jsPDF }] = await loadPdfLibs();
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 40;
      const rs = (n) => "Rs " + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN");
      let y = M;
      const room = (h) => { if (y + h > H - M) { pdf.addPage(); y = M; } };
      // One table row: cells are [text, x, align]; bold for headers and totals.
      const row = (cells, { bold = false, fill = null, h = 18 } = {}) => {
        room(h);
        if (fill) { pdf.setFillColor(...fill); pdf.rect(M, y - 12, W - M * 2, h, "F"); }
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        cells.forEach(([t, x, align]) => pdf.text(String(t ?? ""), x, y, { align: align || "left", maxWidth: align === "right" ? undefined : 200 }));
        y += h;
      };
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(16);
      pdf.text(`Actuals - ${dept}`, M, y); y += 20;
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
      pdf.text([sel.clientName || "Event", selDateStr || "", sel.functionsDetail?.[0]?.venue || sel.venue || ""].filter(Boolean).join("  |  "), M, y); y += 24;
      pdf.setFontSize(9.5);
      if (dept === "Floral") {
        const artTot = fp.artificial ? fp.artificial.total : artificialProj;
        row([["Floral cost to source", M + 6], [rs(mandiActualTotal), W - M - 6, "right"]], { bold: true, fill: [236, 253, 245] });
        row([["Real flowers (mandi)", M + 6], [rs(mandiActualReal), W - M - 6, "right"]]);
        row([["Artificial flowers", M + 6], [rs(artTot), W - M - 6, "right"]]);
        if (fp.season && fp.season.mult && fp.season.mult !== 1) row([[`${fp.season.label} date - mandi flower prices x${fp.season.mult}`, M + 6]]);
        y += 10;
        const cx = { name: M + 6, plan: M + 230, proj: M + 320, qty: M + 375, rate: M + 440, tot: W - M - 6 };
        row([["Flower", cx.name], ["Planned", cx.plan, "right"], ["Projected", cx.proj, "right"], ["Qty", cx.qty, "right"], ["Rs/unit", cx.rate, "right"], ["Total", cx.tot, "right"]], { bold: true, fill: [209, 250, 229] });
        mandiRows.forEach(r => {
          const line = (Number(r.qty) || 0) * (Number(r.price) || 0);
          row([[r.swapFor ? `${r.name} (bought for ${r.swapFor})` : r.swappedTo ? `${r.name} (not in mandi -> ${r.swappedTo})` : r.name, cx.name], [r.projQty > 0 ? `${r.projQty} ${r.unit || ""}`.trim() : "", cx.plan, "right"], [r.projCost > 0 ? rs(r.projCost) : "extra", cx.proj, "right"], [Number(r.qty) || 0, cx.qty, "right"], [Number(r.price) || 0, cx.rate, "right"], [rs(line), cx.tot, "right"]]);
        });
        if (fp.artificial || artificialProj > 0) row([["Artificial flowers / greens (not mandi-shopped)", cx.name], [rs(artTot), cx.proj, "right"], [rs(artTot), cx.tot, "right"]]);
        row([["Total", cx.name], [rs(Number(fp.projected) || 0), cx.proj, "right"], [rs(mandiActualTotal), cx.tot, "right"]], { bold: true, fill: [236, 253, 245] });
        y += 14;
      }
      if (expenses.length) {
        row([["On-site expenses", M + 6], ["Amount", W - M - 6, "right"]], { bold: true, fill: [243, 244, 246] });
        expenses.forEach(ex => row([[ex.label || "-", M + 6], [rs(ex.amount), W - M - 6, "right"]]));
        row([["Expenses total", M + 6], [rs(expenseTotal), W - M - 6, "right"]], { bold: true });
        y += 14;
      }
      row([["Actual spend logged", M + 6], [rs(actualCost), W - M - 6, "right"]], { bold: true, fill: [229, 231, 235], h: 22 });
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(120);
      pdf.text(`Generated ${new Date().toLocaleString("en-IN")} - ${authUser?.name || "-"}`, M, H - 20);
      const safe = (t) => String(t || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
      pdf.save(`Actuals - ${safe(dept)} - ${safe(sel.clientName || "Event")} - ${safe(selDateStr || "no date")}.pdf`);
    } catch (err) {
      if (isStaleChunk(err)) { reloadForUpdate(); return; }
      alert(`Could not make the Actuals PDF.\n\n${err?.message || err}`);
    } finally {
      setActualsPdfBusy(false);
    }
  };

  // ── THE DEPARTMENT'S INCOME, BROKEN INTO HEADS ──
  // Read by the on-screen readout AND by the PDF export. It lives here rather than inside the
  // panel's render because two copies of this arithmetic would eventually disagree, and the one
  // thing worse than a missing breakdown is two breakdowns of the same department that differ.
  const income = useMemo(() => {
    if (!deptIncome) return { shown: [], shownSum: 0, gap: 0, liveTotal: 0, pct: () => 0 };
    // fp (floralPlan) is a whole-EVENT floral sourcing plan, not scoped per department — only
    // show its real/artificial split under the Floral dept itself.
    const artTotal = (dept === "Floral" && fp.artificial) ? Math.round(fp.artificial.total) : 0;
    const realFloral = dept === "Floral" ? Math.max(0, Math.round((deptIncome.florals || 0) - artTotal)) : 0;
    const liveManpower = Math.round(mpCost);   // edited crew plan (not the stale snapshot)
    const liveTotal = Math.round((deptIncome.total || 0) - (deptIncome.manpower || 0) + liveManpower);
    // Fixed order, so a head does not move the moment another one appears or drops to zero —
    // the position of a figure is how you find it again on the next event.
    const rows = [
      { label: "Inventory rental", value: deptIncome.rental },
      { label: "Truss", value: deptIncome.truss },
      { label: "Fabric / draping", value: deptIncome.fabric },
      { label: "Real flowers (mandi)", value: realFloral },
      { label: "Artificial flowers", value: artTotal },
      { label: "Manpower", value: liveManpower },
      { label: "Production", value: deptIncome.production },
      { label: "Buying", value: deptIncome.buying },
      { label: "Transport", value: deptIncome.transport },
    ];
    // ── SHARE OF THE DEPARTMENT'S OWN INCOME ──
    // The percentages are taken against the SUM OF THE HEADS SHOWN, not against liveTotal.
    // liveTotal is deptIncome.total with the stale manpower swapped for the live edited crew, so
    // it can carry heads this list does not — and a column of percentages that silently fails to
    // reach 100 is worse than no percentages. Computed this way they always total 100, and `gap`
    // states it outright if the two figures disagree rather than leaving the reader to notice.
    const shown = rows.filter(r => r.value > 0).map(r => ({ ...r, value: Math.round(r.value) }));
    const shownSum = shown.reduce((s, r) => s + r.value, 0);
    return {
      shown,
      shownSum,
      gap: liveTotal - shownSum,
      liveTotal,
      pct: (v) => (shownSum > 0 ? Math.round((v / shownSum) * 100) : 0),
    };
  }, [deptIncome, dept, fp, mpCost]);

  const printChallan = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = [
      ...blockedItems.map(it => `<tr><td>${loaded["inv:" + it.id] ? "☑" : "☐"}</td><td>${it.name}</td><td>${it.sub || "—"}</td><td style="text-align:center">${it.qty}</td></tr>`),
      ...deptTools.map(t => `<tr><td>${loaded["tool:" + t.name] ? "☑" : "☐"}</td><td>🛠️ ${t.name}</td><td>essential / tool</td><td style="text-align:center">${t.qty || 1}</td></tr>`),
    ].join("");
    w.document.write(`<html><head><title>Challan — ${dept}</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f3f4f6;text-align:left}h2{color:#4f46e5;margin-bottom:2px}@media print{button{display:none}}</style></head><body>
      <h2>${DEPT_ICON[dept]} Ambria — ${dept} Loading Challan</h2>
      <p>Event: ${sel?.clientName || "-"} &nbsp;|&nbsp; ${selDateStr || "-"} &nbsp;|&nbsp; ${sel?.functionsDetail?.[0]?.venue || sel?.venue || "-"}</p>
      <p>Vehicle: ${dispatch.vehicle || "______"} &nbsp;|&nbsp; Driver: ${dispatch.driver || "______"} &nbsp;|&nbsp; Phone: ${dispatch.phone || "______"}</p>
      <table><tr><th>✓</th><th>Item</th><th>Type</th><th>Qty</th></tr>${rows || '<tr><td colspan="4" style="text-align:center;color:#999">Nothing to load</td></tr>'}</table>
      <br><p>Dispatched by: _______________ &nbsp;&nbsp; Received by: _______________</p>
      <p>Date: ____________ &nbsp;&nbsp; Time: ____________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  };

  // ── Dismantle routing: after teardown, each item's at-site qty splits into return / transfer-to-Site-2 / damaged ──
  const movements = Array.isArray(deptData.movements) ? deptData.movements : [];
  const movedQty = (itemKey, type) => movements.filter(m => m.itemKey === itemKey && (!type || m.type === type)).reduce((s, m) => s + (Number(m.qty) || 0), 0);
  const adjustInventory = (invId, delta) => {
    if (!invId || !setInventory) return;
    setInventory(prev => prev.map(r => String(r.id) === String(invId) ? { ...r, qty: Math.max(0, (Number(r.qty) || 0) + delta), qtyOwned: Math.max(0, (Number(r.qtyOwned ?? r.qty) || 0) + delta) } : r));
  };
  const addMovement = (it, type, qty, extra = {}) => {
    const q = Number(qty) || 0; if (q <= 0) return;
    const mv = { id: "mv_" + Date.now() + "_" + Math.floor(Math.random() * 1000), itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, type, qty: q, at: Date.now(), by: authUser?.name || "—", ...extra };
    saveDept({ movements: [...movements, mv] });
    if (type === "damage") adjustInventory(it.invId, -q); // broken units leave owned stock immediately
  };
  const delMovement = async (id) => {
    const mv = movements.find(m => m.id === id);
    if (!(await askDelete(`Remove ${mv?.name ? `the ${mv.name} movement` : "this movement"}?`, mv?.type === "damage" ? "The damaged quantity is added back to inventory." : "It will be removed from the movement log."))) return;
    saveDept({ movements: movements.filter(m => m.id !== id) });
    if (mv && mv.type === "damage") adjustInventory(mv.invId, +(Number(mv.qty) || 0)); // undo the decrement
  };
  const setDraft = (key, patch) => setRouteDraft(d => ({ ...d, [key]: { type: "return", ...(d[key] || {}), ...patch } }));
  const logRoute = (it) => {
    const key = "inv:" + it.id; const d = routeDraft[key] || {};
    const q = Number(d.qty !== undefined && d.qty !== "" ? d.qty : unroutedQty(it)) || 0; if (q <= 0) return;
    const type = d.type || "return";
    let extra = {};
    if (type === "transfer") { const ev = (eventOrders || []).find(e => e.id === d.toEventId); if (!ev) return; extra = { toEventId: ev.id, toEventName: ev.clientName || "Event", vehicle: d.vehicle || "", driver: d.driver || "", phone: d.phone || "" }; }
    addMovement(it, type, q, extra);
    setDraft(key, { qty: "" });
  };
  // Fast dismantle: route the FULL remaining qty of an item in one tap (no typing).
  const unroutedQty = (it) => { const k = "inv:" + it.id; return Math.max(0, it.qty - (movedQty(k, "return") + movedQty(k, "transfer") + movedQty(k, "damage") + movedQty(k, "repair"))); };
  const routeRemaining = (it, type, extra = {}) => { const q = unroutedQty(it); if (q > 0) addMovement(it, type, q, extra); };
  const routeAllToWarehouse = () => { const rest = blockedItems.filter(it => unroutedQty(it) > 0); if (!rest.length) return; saveDept({ movements: [...movements, ...rest.map(it => ({ id: "mv_" + Date.now() + "_" + Math.floor(Math.random() * 100000), itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, type: "return", qty: unroutedQty(it), at: Date.now(), by: authUser?.name || "—" }))] }); };
  // ── DISMANTLE PLAN IN PLANNING ──
  // Back on (owner ask, 2026-10-02) as its own tile: the department head pre-sets where each item
  // goes after the event, and On-site → "Dismantle & routing" confirms or changes it against what is
  // actually standing at the venue at teardown. Set false to hide the Planning copy again.
  const SHOW_DISMANTLE_IN_PLANNING = true;
  // Dept-head dismantle PLAN (set in Planning; ops confirms on-site). Per item = an ARRAY of splits
  // so one item can go to several places: { [itemKey]: [{qty, type, toEventId, toEventName}, …] }.
  const dismantlePlan = (deptData.dismantlePlan && typeof deptData.dismantlePlan === "object") ? deptData.dismantlePlan : {};
  const ROUTE_LABEL = { return: "🏬 Warehouse", transfer: "↪️ Reuse/Transfer", repair: "🔧 Repair", damage: "❌ Broken" };
  const ROUTE_SHORT = { return: "🏬 Wh", transfer: "↪️", repair: "🔧", damage: "❌" };
  // Split rows for an item (back-compat: legacy single-object plan → one full-qty row; none → default warehouse).
  const planFor = (it) => { const raw = dismantlePlan["inv:" + it.id]; if (Array.isArray(raw) && raw.length) return raw; if (raw && raw.type) return [{ qty: Number(it.qty) || 0, type: raw.type, toEventId: raw.toEventId, toEventName: raw.toEventName }]; return [{ qty: Number(it.qty) || 0, type: "return" }]; };
  const setPlanRows = (key, rows) => saveDept({ dismantlePlan: { ...dismantlePlan, [key]: rows } });
  // ── Matrix dismantle plan: dept head picks destination sites; every item gets a Production House
  // column (auto-remainder) + one column per site. Typing a site qty reduces production house. Stored
  // in the SAME {return/transfer} plan shape so planFor / destGroups / on-site confirm all still work. ──
  const savedSites = Array.isArray(deptData.dismantleSites) ? deptData.dismantleSites : [];
  const dismantleSites = (() => {
    const out = savedSites.map(s => ({ ...s }));
    Object.values(dismantlePlan).forEach(rows => (Array.isArray(rows) ? rows : []).forEach(r => { if (r.type === "transfer" && r.toEventId && !out.some(s => s.id === r.toEventId)) { const ev = (eventOrders || []).find(e => e.id === r.toEventId); out.push({ id: r.toEventId, name: ev?.clientName || r.toEventName || "Event", date: ev ? eventDate(ev) : "" }); } }));
    return out;
  })();
  const planSiteQty = (it, eventId) => { const raw = dismantlePlan["inv:" + it.id]; if (!Array.isArray(raw)) return 0; const r = raw.find(x => x.type === "transfer" && x.toEventId === eventId); return r ? (Number(r.qty) || 0) : 0; };
  const planProdQty = (it) => Math.max(0, (Number(it.qty) || 0) - dismantleSites.reduce((s, st) => s + planSiteQty(it, st.id), 0));
  const buildSitePlan = (it, siteMap, sites) => { const rows = []; sites.forEach(st => { const q = Number(siteMap[st.id]) || 0; if (q > 0) rows.push({ type: "transfer", toEventId: st.id, toEventName: st.name, qty: q }); }); const rem = Math.max(0, (Number(it.qty) || 0) - rows.reduce((a, r) => a + r.qty, 0)); if (rem > 0) rows.unshift({ type: "return", qty: rem }); return rows.length ? rows : [{ type: "return", qty: 0 }]; };
  const setSiteQty = (it, eventId, val) => { const key = "inv:" + it.id; const cur = {}; dismantleSites.forEach(st => { cur[st.id] = planSiteQty(it, st.id); }); const other = dismantleSites.reduce((a, st) => a + (st.id === eventId ? 0 : (Number(cur[st.id]) || 0)), 0); const cap = Math.max(0, (Number(it.qty) || 0) - other); cur[eventId] = Math.min(cap, Math.max(0, Number(val) || 0)); setPlanRows(key, buildSitePlan(it, cur, dismantleSites)); };
  const addDismantleSite = (eventId) => { if (!eventId || dismantleSites.some(s => s.id === eventId)) return; const ev = (eventOrders || []).find(e => e.id === eventId); saveDept({ dismantleSites: [...dismantleSites, { id: eventId, name: ev?.clientName || "Event", date: ev ? eventDate(ev) : "" }] }); };
  const removeDismantleSite = (eventId) => { const next = dismantleSites.filter(s => s.id !== eventId); const nextPlan = { ...dismantlePlan }; blockedItems.forEach(it => { const cur = {}; next.forEach(st => { cur[st.id] = planSiteQty(it, st.id); }); nextPlan["inv:" + it.id] = buildSitePlan(it, cur, next); }); saveDept({ dismantleSites: next, dismantlePlan: nextPlan }); };
  // Build movement objects from the plan splits, each capped to the item's remaining (so re-confirm is safe).
  const buildPlannedMovements = (items) => {
    const now = Date.now(); const out = []; let seq = 0;
    items.forEach(it => {
      let remaining = unroutedQty(it);
      planFor(it).forEach(row => {
        let q = Math.min(Number(row.qty) || 0, remaining); if (q <= 0) return;
        let extra = {};
        if (row.type === "transfer") { if (!row.toEventId) return; const ev = (eventOrders || []).find(e => e.id === row.toEventId); extra = { toEventId: row.toEventId, toEventName: ev?.clientName || row.toEventName || "Event" }; }
        remaining -= q;
        out.push({ id: "mv_" + now + "_" + (seq++), itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, type: row.type || "return", qty: q, at: now, by: authUser?.name || "—", ...extra });
      });
    });
    return out;
  };
  const logMovements = (rows) => { if (!rows.length) return; saveDept({ movements: [...movements, ...rows] }); rows.filter(m => m.type === "damage").forEach(m => adjustInventory(m.invId, -m.qty)); };
  const confirmItemPlanned = (it) => logMovements(buildPlannedMovements([it]));
  const confirmAllPlanned = () => logMovements(buildPlannedMovements(blockedItems));
  // Destination-grouped manifest: everything going to each place (warehouse / repair / broken / each
  // transfer site) as its own list with item qtys — so ops loads per destination, not per item.
  const destGroups = useMemo(() => {
    const groups = {};
    blockedItems.forEach(it => {
      let left = unroutedQty(it); if (left <= 0) return;
      planFor(it).forEach(row => {
        let q = Math.min(Number(row.qty) || 0, left); if (q <= 0) return; left -= q;
        const key = row.type === "transfer" ? "transfer:" + (row.toEventId || "?") : row.type;
        const ev = row.type === "transfer" ? (eventOrders || []).find(e => e.id === row.toEventId) : null;
        const label = row.type === "transfer" ? `↪️ ${ev?.clientName || row.toEventName || "Event"}${ev ? " · " + (eventDate(ev) || "") : ""}` : ROUTE_LABEL[row.type];
        if (!groups[key]) groups[key] = { key, label, type: row.type, toEventId: row.toEventId, items: [] };
        groups[key].items.push({ it, qty: q });
      });
    });
    // Warehouse first, then repair/broken, then transfer sites.
    const order = { return: 0, repair: 1, damage: 2 };
    return Object.values(groups).sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));
  }, [blockedItems, dismantlePlan, movements, eventOrders]);
  // Confirm-time helpers: the ops manager loads the truck, records ONE set of truck details for the
  // whole list, optionally selects a subset (rest goes on another truck), and marks anything broken /
  // needing repair — those deduct from the qty reaching the destination.
  const gKey = (gk, it) => gk + "::inv:" + it.id;
  const isSel = (ck) => manSel[ck] !== false; // default selected
  const toggleManSel = (ck) => setManSel(m => ({ ...m, [ck]: m[ck] === false }));
  const setTruckField = (gk, key, val) => setManTruck(m => ({ ...m, [gk]: { ...(m[gk] || {}), [key]: val } }));
  const pickTruckFleet = (gk, f) => setManTruck(m => ({ ...m, [gk]: { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" } }));
  const condOf = (ck) => manCond[ck] || {};
  // repair + broken can never exceed the item's available qty on this list — typing one caps the other.
  const setManCondVal = (ck, key, val, cap) => setManCond(m => { const cur = { ...(m[ck] || {}) }; const other = key === "repair" ? (Number(cur.broken) || 0) : (Number(cur.repair) || 0); cur[key] = Math.min(Math.max(0, Number(val) || 0), Math.max(0, cap - other)); return { ...m, [ck]: cur }; });
  const confirmGroup = (group) => {
    const gk = group.key; const isTransfer = group.type === "transfer";
    const truck = manTruck[gk] || {};
    let ev = null;
    if (isTransfer) { if (!group.toEventId) return; ev = (eventOrders || []).find(e => e.id === group.toEventId); }
    const now = Date.now(); let seq = 0; const out = [];
    group.items.forEach(({ it, qty }) => {
      const ck = gKey(gk, it);
      if (isTransfer && !isSel(ck)) return; // left for the next truck
      const cap = Math.min(qty, unroutedQty(it)); if (cap <= 0) return;
      const c = condOf(ck);
      const rep = Math.min(Number(c.repair) || 0, cap);
      const brk = Math.min(Number(c.broken) || 0, cap - rep);
      const dest = Math.max(0, cap - rep - brk);
      const note = manNote[ck];
      const base = { itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, at: now, by: authUser?.name || "—", ...(note ? { voiceNote: note } : {}) };
      if (dest > 0) out.push({ id: "mv_" + now + "_" + (seq++), ...base, type: group.type, qty: dest, ...(isTransfer ? { toEventId: group.toEventId, toEventName: ev?.clientName || "Event", vehicle: truck.vehicle || "", driver: truck.driver || "", phone: truck.phone || "" } : {}) });
      if (rep > 0) out.push({ id: "mv_" + now + "_" + (seq++), ...base, type: "repair", qty: rep });
      if (brk > 0) out.push({ id: "mv_" + now + "_" + (seq++), ...base, type: "damage", qty: brk });
    });
    logMovements(out);
    // Reset this group's transient inputs (confirmed items leave the list; remaining default back to selected).
    setManSel(m => { const n = { ...m }; group.items.forEach(({ it }) => delete n[gKey(gk, it)]); return n; });
    setManCond(m => { const n = { ...m }; group.items.forEach(({ it }) => delete n[gKey(gk, it)]); return n; });
    setManNote(m => { const n = { ...m }; group.items.forEach(({ it }) => delete n[gKey(gk, it)]); return n; });
    setManTruck(m => { const n = { ...m }; delete n[gk]; return n; });
  };
  // Sold events sorted by date-proximity to this event (for the transfer picker — nearby dates first).
  // Where an event is held: its own venue, else the distinct venues of its functions (shown beside the date when choosing a transfer site)
  const venueOfEvent = (e) => {
    if (!e) return "";
    const own = String(e.venue || "").trim();
    if (own) return own;
    return [...new Set((Array.isArray(e.functionsDetail) ? e.functionsDetail : []).map(f => String(f?.venue || "").trim()).filter(Boolean))].join(", ");
  };
  const nearbyTransferEvents = useMemo(() => {
    const base = selDateStr ? new Date(selDateStr + "T00:00:00").getTime() : 0;
    return (eventOrders || []).filter(e => e.id !== selId && isLiveEvent(e))
      .map(e => { const d = eventDate(e); const off = (d && base) ? Math.round((new Date(d + "T00:00:00").getTime() - base) / 864e5) : 999; return { e, d, off }; })
      .sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
  }, [eventOrders, selId, selDateStr]);
  // Incoming transfers — items other events routed to THIS event for same-day reuse.
  const incomingTransfers = useMemo(() => {
    if (!sel) return [];
    const out = [];
    (eventOrders || []).forEach(eo => {
      if (eo.id === sel.id) return;
      Object.entries(eo.deptOps || {}).forEach(([dp, od]) => {
        (Array.isArray(od?.movements) ? od.movements : []).forEach(m => { if (m.type === "transfer" && m.toEventId === sel.id) out.push({ ...m, fromEvent: eo.clientName || "Event", fromDept: dp }); });
      });
    });
    return out;
  }, [eventOrders, sel]);
  // Group incoming reuse by item (match the receiving event's blocked item by inventory id, else name).
  const itemKeyFor = (invId, name) => invId ? "id:" + invId : "nm:" + String(name || "").toLowerCase().trim();
  const incomingByItem = useMemo(() => {
    const map = {};
    incomingTransfers.forEach(m => {
      const key = itemKeyFor(m.invId, m.name);
      if (!map[key]) map[key] = { name: m.name, total: 0, sources: [] };
      map[key].total += Number(m.qty) || 0;
      map[key].sources.push({ from: m.fromEvent, dept: m.fromDept, qty: Number(m.qty) || 0, vehicle: m.vehicle || "", driver: m.driver || "", phone: m.phone || "", voiceNote: m.voiceNote || "" });
    });
    return map;
  }, [incomingTransfers]);
  // Ops-manager receiving view: reconcile each item's requirement against its sources — own dispatch
  // trucks (from the production house / warehouse) + same-day reuse arriving from other sites — each
  // with vehicle + driver, and a shortfall flag.
  const sourceRows = useMemo(() => {
    if (incomingTransfers.length === 0 && trucks.length === 0) return [];
    const rows = [], used = new Set();
    blockedItems.forEach(it => {
      const key = itemKeyFor(it.invId, it.name); used.add(key);
      const inc = incomingByItem[key]; const reused = inc?.total || 0;
      const whTrucks = trucks.map((t, ti) => ({ id: t.id, n: ti + 1, vehicle: t.vehicle, driver: t.driver, phone: t.phone || "", qty: Number(t.items?.["inv:" + it.id]) || 0 })).filter(x => x.qty > 0);
      const whQty = whTrucks.reduce((s, x) => s + x.qty, 0);
      const totalIn = whQty + reused;
      if (it.qty > 0 || totalIn > 0) rows.push({ name: it.name, photo: it.photo || "", required: it.qty, reused, whTrucks, whQty, totalIn, shortfall: Math.max(0, it.qty - totalIn), over: Math.max(0, totalIn - it.qty), sources: inc?.sources || [] });
    });
    Object.entries(incomingByItem).forEach(([key, inc]) => { if (!used.has(key)) rows.push({ name: inc.name, required: 0, reused: inc.total, whTrucks: [], whQty: 0, totalIn: inc.total, shortfall: 0, over: inc.total, sources: inc.sources }); });
    return rows;
  }, [blockedItems, incomingByItem, incomingTransfers, trucks]);

  // ── Fabric (dept = Fabric): total available (Old + New) vs required, with date-wise shortfall ──
  const FABRIC_TYPES = [
    { key: "liza", label: "Liza Fabric", stockKey: "lizaStock", qtyField: "stockKg", unit: "kg", emoji: "🧣" },
    { key: "masking", label: "Wall Masking", stockKey: "maskingStock", qtyField: "stockPieces", unit: "pcs", emoji: "🧱" },
    { key: "curtain", label: "Velvet Curtains", stockKey: "curtainStock", qtyField: "stockPieces", unit: "pcs", emoji: "🎀" },
  ];
  const fabricAvail = useMemo(() => {
    const out = {};
    FABRIC_TYPES.forEach(ft => {
      const m = {};
      (Array.isArray(trussInv?.[ft.stockKey]) ? trussInv[ft.stockKey] : []).forEach(r => {
        const c = r.colour || "(unassigned)";
        if (!m[c]) m[c] = { old: 0, new: 0 };
        m[c].old += Number(r[ft.qtyField]) || 0;
        m[c].new += Number(r[`${ft.qtyField}New`]) || 0;
      });
      out[ft.key] = m;
    });
    return out;
  }, [trussInv]);
  // The colour a fabric's name stands for — the same lookup Planning → Fabric Stock draws its
  // swatches with: the stock row's own hex if set, else the colour catalogue, else a known name.
  const fabricHex = (stockKey, colour) => swatchHexFor(colour, settings?.colourCatalogue, (Array.isArray(trussInv?.[stockKey]) ? trussInv[stockKey] : []).find(r => r.colour === colour)?.hex);
  // A small colour square that opens the colour large. Its fill is the fabric's own colour, which
  // only exists at runtime, so it is an inline style rather than a class. "(unassigned)" has none.
  const Swatch = ({ name, hex }) => (!name || name === "(unassigned)") ? null : (
    <button type="button" onClick={() => setSwatchView({ name, hex })} title={`${name} — tap to see it larger`}
      className="shrink-0 inline-block w-3.5 h-3.5 rounded ring-1 ring-black/15 align-middle cursor-pointer hover:scale-125 transition-transform"
      style={{ background: hex }} />
  );
  // Same-day contention: fabric the SAME stock is committed to on OTHER events on the same date —
  // so each event is checked against the remainder after the others (the same Liza can't be in two
  // places on the same day).
  const sameDayReserved = (date, exclId, ftKey, colour) => {
    if (!date) return 0;
    let s = 0;
    (eventOrders || []).forEach(eo => {
      if (eo.id === exclId || eventDate(eo) !== date || !eo.fabricPlan) return;
      (Array.isArray(eo.fabricPlan[ftKey]) ? eo.fabricPlan[ftKey] : []).forEach(r => { if ((r.colour || "") === colour) s += Number(r.qty) || 0; });
    });
    return s;
  };
  // Requirement vs available for the SELECTED event (net of same-day commitments elsewhere).
  // Owner ask (2026-10-15): required is now tier-tagged too (r.qtyOld/r.qtyNew, from the salesperson's
  // own Build Old/New toggle) — compared tier-for-tier, not just combined. Plenty of New stock sitting
  // idle doesn't help an Old-stock requirement, and vice versa; same-day contention is split by tier
  // for the same reason (an Old reservation elsewhere can't eat into what THIS event needs in New).
  const fabricReqRows = (dept === "Fabric" && sel?.fabricPlan) ? FABRIC_TYPES.map(ft => {
    const req = Array.isArray(sel.fabricPlan[ft.key]) ? sel.fabricPlan[ft.key] : [];
    const rows = req.map(r => {
      const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 };
      const stock = av.old + av.new;
      const otherDay = sameDayReserved(selDateStr, sel.id, ft.key, r.colour);
      const reqOld = Number(r.qtyOld) || 0, reqNew = Number(r.qtyNew) || 0;
      const avail = Math.max(0, stock - otherDay);
      const shortOld = Math.max(0, reqOld - av.old);
      const shortNew = Math.max(0, reqNew - av.new);
      return { colour: r.colour, hex: fabricHex(ft.stockKey, r.colour), required: r.qty, qtyOld: reqOld, qtyNew: reqNew, old: av.old, new: av.new, stock, otherDay, avail, short: Math.max(0, r.qty - avail), shortOld, shortNew };
    });
    return { ...ft, rows };
  }).filter(f => f.rows.length) : [];
  // ── THE FABRIC LINES, FOLDED TO THREE FABRICS ──
  // The blocked-inventory list carried one photo-less row per (zone × fabric × tier). For the Fabric department
  // they are replaced by one block: Liza / Velvet / Wall Masking with the allocated colour's photo, the total, and
  // a zone-by-zone breakdown (see lib/ims/fabricGroups.js). Zones come from the event's own layout, scoped to the
  // chosen function; the money still comes from the priced lines.
  const fabricGroupInfo = useMemo(() => {
    if (dept !== "Fabric") return { groups: [], groupedLineIds: new Set() };
    const fnsF = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
    const entries = trussPlanOf().map((e) => ({
      fi: e.fi, zk: e.zk, zLabel: e.zLabel, fnLabel: e.fn?.type || `Function ${e.fi + 1}`,
      photo: e.fn?.elSelectedPhoto?.[e.zk]?.src || "", fab: e.fab, row: e.row,
    }));
    // Money comes from the whole event's priced lines (they name a zone, not a function) and is split by quantity;
    // only then is the chosen function's share shown.
    return buildFabricGroups({ entries, lines: blockedItemsGrouped, fabricPlan: sel?.fabricPlan, stock: trussInv, multiFn: fnsF.length > 1, onlyFi: invScoped ? invFn : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept, sel, trussInv, blockedItemsGrouped, invScoped, invFn]);
  // All upcoming events scanned for fabric shortfalls (same-day contention included) → order-ahead heads-up.
  const upcomingFabricShort = useMemo(() => {
    if (dept !== "Fabric") return [];
    const out = [];
    (eventOrders || []).forEach(eo => {
      const d = eventDate(eo); if (!d || d < today || !eo.fabricPlan) return;
      FABRIC_TYPES.forEach(ft => {
        (Array.isArray(eo.fabricPlan[ft.key]) ? eo.fabricPlan[ft.key] : []).forEach(r => {
          const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 };
          const otherDay = sameDayReserved(d, eo.id, ft.key, r.colour);
          const short = (Number(r.qty) || 0) - Math.max(0, (av.old + av.new) - otherDay);
          if (short > 0) out.push({ event: eo.clientName || "Event", date: d, fabric: ft.label, colour: r.colour, hex: fabricHex(ft.stockKey, r.colour), short, unit: ft.unit, contended: otherDay > 0 });
          // Tier-specific: combined supply covers it, but the New-tier portion this event actually
          // needs (picked explicitly in Build) can't be met from New stock alone — Old stock sitting
          // idle doesn't help a New requirement, so this would otherwise look fine and quietly surprise
          // whoever's pulling stock on the day.
          else if (short <= 0) {
            const reqNew = Number(r.qtyNew) || 0;
            const shortNew = reqNew - Math.max(0, av.new - otherDay);
            if (reqNew > 0 && shortNew > 0) out.push({ event: eo.clientName || "Event", date: d, fabric: ft.label, colour: r.colour, hex: fabricHex(ft.stockKey, r.colour), short: shortNew, unit: ft.unit, contended: otherDay > 0, newTierOnly: true });
          }
        });
      });
    });
    return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [dept, eventOrders, fabricAvail, today, settings, trussInv]);

  // A plain name→value breakdown table — Truss Labour's pillar count and Fabric Bangali's sqft are
  // each a straight SUM per contributing element/zone (no per-row batch/need division the way
  // Flowerists/Electricians get), so this is the tier2 table's layout without those two columns.
  const renderMpNameValueRows = (rows, valueLabel, decimals) => (
    <div className="mt-1 bg-white border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] gap-x-2">
        <div className="contents">
          <span className="px-2 py-1 bg-gray-100 text-[12px] uppercase tracking-wide text-gray-500 font-semibold">Item / Zone</span>
          <span className="px-2 py-1 bg-gray-100 text-[12px] uppercase tracking-wide text-gray-500 font-semibold text-right whitespace-nowrap">{valueLabel}</span>
        </div>
        {rows.map((rr, ri) => (
          <div className="contents" key={ri}>
            <div className="min-w-0 overflow-hidden px-2 py-0.5">
              <div className="flex items-baseline gap-1.5 text-[13px] text-gray-700">
                <span className="truncate" title={rr.sub}>{rr.sub}</span>
                <span aria-hidden="true" className="flex-1 min-w-2 border-b border-dotted border-gray-300 mb-[3px]" />
              </div>
              {/* Shape/size/masking for a truss-derived row — a dept head asked to see what the
                  zone's truss actually looks like, not just its name. */}
              {rr.meta && <div className="text-[11px] text-gray-400 truncate">{rr.meta}</div>}
            </div>
            <span className="px-2 py-0.5 text-[13px] text-gray-700 font-semibold text-right whitespace-nowrap">{decimals ? Number(rr.value).toFixed(decimals) : rr.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
  // Derivation box for a crew type — same pattern as Deal Check's "HOW … DERIVED".
  // Grid tracks for the per-function trace table: a name column + one per function (static class
  // names so Tailwind generates them; 6 covers any realistic day).
  const FN_GRID = {
    1: "grid-cols-[minmax(160px,max-content)_repeat(1,minmax(120px,1fr))]",
    2: "grid-cols-[minmax(160px,max-content)_repeat(2,minmax(120px,1fr))]",
    3: "grid-cols-[minmax(160px,max-content)_repeat(3,minmax(120px,1fr))]",
    4: "grid-cols-[minmax(160px,max-content)_repeat(4,minmax(120px,1fr))]",
    5: "grid-cols-[minmax(160px,max-content)_repeat(5,minmax(120px,1fr))]",
    6: "grid-cols-[minmax(160px,max-content)_repeat(6,minmax(120px,1fr))]",
  };
  // Function columns in the order they happen, each header carrying its time. Only the shift is
  // stored (Morning / Lunch / …), so the time shown is that shift's usual start. A function with no
  // shift stays right after the function before it in the booking's own order.
  const orderFnCols = (rawCols, day) => {
    const dayFns = !day ? [] : day.phase === "event" ? mpFns.filter(f => String(f?.date || "").slice(0, 10) === day.date) : day.phase === "minusOne" ? mpFns : [];
    const fnRec = (c) => (day ? dayFns : mpFns).find(f => (f?.type || "") === c.fn) || null;
    const shiftOf = (c) => String(c.shift || fnRec(c)?.shift || "").trim();
    const hourOf = (c) => SHIFT_START_HOUR[shiftOf(c).toLowerCase()];
    let lastHour = -1;
    const cols = rawCols
      .map((c, i) => { const h = hourOf(c); const at = h != null ? h : lastHour + 0.01 * (i + 1); if (h != null) lastHour = h; return { ...c, _at: at }; })
      .sort((a, b) => a._at - b._at);
    const timeLabel = (c) => { const sh = shiftOf(c); const h = hourOf(c); if (!sh) return "time not set"; if (h == null) return sh; const hr = Math.floor(h), mm = Math.round((h - hr) * 60); return `${sh} · ${hr % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${hr < 12 ? "AM" : "PM"}`; };
    return { cols, timeLabel, shiftOf };
  };
  // A non-tier2 trace (pillars, sqft range, Fabric Bangali zones, Labours, fixed) as label → value
  // rows, so every crew type can sit in the same one-column-per-function table.
  const traceRowsOf = (tr) => {
    if (!tr) return [];
    if (tr.kind === "pillars") return (tr.rows || []).map(r => ({ label: r.sub, value: `${r.count} pillar${r.count === 1 ? "" : "s"}` }));
    if (tr.kind === "range") return (tr.rows || []).map(r => ({ label: r.sub, value: `${Number(r.sqft || 0).toFixed(0)} ${tr.unit || ""}`.trim() }));
    if (tr.kind === "fabricBangali") return (tr.zones || []).map(z => ({ label: z.zone, value: [z.topLabour > 0 ? `canopy ${z.topLabour}` : "", z.rft > 0 ? `wrap ${z.rft} ft` : ""].filter(Boolean).join(" · ") || "—" }));
    if (tr.kind === "labours") return [
      // Venue minimum is a flat booking-wide floor, not owned by any one department's items, so
      // every department sees it. Each heavy row IS owned by whichever department its own
      // sub-category routes to (catToDept("Sofa") -> Furniture) — filtered to the department
      // currently open, so Lighting/Tenting/etc. don't see Furniture's "Sofa" row (or vice
      // versa) just because Labours is one shared crew pool for the whole event.
      ...(tr.venueMin > 0 ? [{ label: "Venue minimum", value: `${tr.venueMin}` }] : []),
      ...(tr.heavyRows || []).filter(hr => catToDept(hr.sub) === dept).map(hr => ({ label: `${hr.sub}`, value: `×${hr.count} → +${hr.extra}` })),
      // Per-ITEM fractional usage (e.g. "Roman Fibre Pot Small" at 10 ÷ 40 = 0.25) — the items
      // behind the pooled usage floor, which heavyRows above never shows (that's an independent
      // per-sub-category floor; anything under its own perCount rounds to 0 there even though it
      // still feeds this pooled total). Same department filter as heavyRows.
      ...(tr.usageRows || []).filter(ur => usageDept(ur) === dept).map(ur => ({ label: ur.name, value: `${ur.qty} ÷ ${ur.per} = ${ur.need.toFixed(2)}` })),
    ];
    if (tr.kind === "ratio") return [{ label: tr.numLabel || "Count", value: `${tr.num}` }];
    if (tr.kind === "fixed") return [{ label: tr.note || "Fixed", value: `${tr.result}` }];
    return [];
  };
  // Labours is the one SHARED crew type — a function's real "Crew per function" (c.result) is
  // the whole pool, everyone's items combined, same number regardless of which department tab is
  // open. For a department's OWN view, that reads as "my dedicated crew of 3" when it isn't —
  // this is this department's own fractional slice of that function's pooled usage (its own
  // usageRows, same filter/formula as the item rows above it and the day-level "X's share"
  // sentence), ceiled once. NOT additive across departments — summing every department's own
  // ceiled number for one function can exceed the real shared total, because ceiling several
  // small fractions separately can only ever round UP more than ceiling their sum once.
  // Summed to the hundredth before the ceiling: 0.25 + 0.30 + … that is exactly 2.00 on paper comes
  // out as 2.0000000000000004 in floating point, and Math.ceil turned that into 3.
  const deptNeedForFn = (c) => {
    const rows = Array.isArray(c?.trace?.usageRows) ? c.trace.usageRows.filter(ur => usageDept(ur) === dept) : [];
    return Math.round(rows.reduce((s, ur) => s + (Number(ur.need) || 0), 0) * 100) / 100;
  };
  // A Labours day whose order carries no per-function trace (synced before Deal Check sent
  // trace.byFn, or nothing per function to show): the same facts the old prose box gave — whole-event
  // need, venue minimum, this department's own items, the carry-over and this department's share —
  // laid out in the same table style as the Flowerists day, one row each.
  const renderLaboursDayTable = (r, d, hasShare) => {
    const t = d.trace || {};
    const fnsToday = mpFns.filter(f => String(f?.date || "").slice(0, 10) === d.date);
    const head = fnsToday.length ? fnsToday.map(f => f?.type || "Function").join(" + ") : d.phase === "dismantle" ? "Dismantle" : d.phase === "minusOne" ? "−1 setup" : (d.drivenBy || "Today");
    // "how?" on the carry-over row: every event day up to this one, what it needed and the crew it
    // kept — crew only ever grows, so this day's crew is the largest need on any day before it.
    const howKey = `${r.type}|${d.date}`;
    const evDays = (Array.isArray(r.schedule) ? r.schedule : []).filter(x => (x.phase || "event") === "event" && x.date <= d.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const peakDay = evDays.find(x => Number(x.trace?.result) === Number(d.count)) || evDays.find(x => Number(x.count) === Number(d.count));
    const phaseRow = d.phase === "dismantle" ? "🧹 Dismantle day — crew carried from the event"
      : d.phase === "minusOne" ? "⏮️ −1 setup — full crew staged early (peak of all functions)"
      : "⏸️ Gap day — crew carried from the previous day";
    const rows = d.trace ? [
      { label: `${r.type} needed (whole event, all departments)`, value: t.result ?? 0 },
      ...traceRowsOf(t).map(x => ({ label: x.label, value: x.value })),
    ] : [{ label: phaseRow, value: d.count }];
    rows.push(
      ...(d.trace && Number(t.result) > 0 && Number(t.result) < Number(d.count) ? [{ label: "Crew kept today (carried over from a busier day)", value: d.count, warn: true, how: true }] : []),
      ...(hasShare ? [{ label: `${dept}'s share (${Math.round((Number(d.share) || 0) * 100)}% of today's heavy décor)`, value: `${(Number(d.share) * Number(d.count) || 0).toFixed(2)}` }] : []),
    );
    return (
      <div className="mb-1.5 bg-white border rounded-lg overflow-x-auto">
        <div className={"grid " + FN_GRID[1]}>
          <div className="contents">
            <span className="px-2 pr-6 py-1 bg-gray-100 text-[13px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap">{r.type}</span>
            <span className="px-2 py-1 bg-gray-100 text-center border-l border-gray-200 whitespace-nowrap"><span className="block text-[13px] uppercase tracking-wide text-gray-500 font-semibold">{head}</span></span>
          </div>
          {rows.map((row, ri) => (
            <div className="contents" key={ri}>
              <div className={"flex items-baseline gap-1.5 min-w-0 overflow-hidden px-2 py-1 text-[13px] text-gray-700 border-t border-gray-200" + (ri % 2 ? " bg-gray-50" : "")}>
                <span className="truncate" title={row.label}>{row.label}</span>
                {row.how && <button type="button" onClick={() => setLaboursHow(p => ({ ...p, [howKey]: !p[howKey] }))} className="shrink-0 text-[12px] font-semibold text-blue-600 hover:underline">{laboursHow[howKey] ? "hide" : "how?"}</button>}
                <span aria-hidden="true" className="flex-1 min-w-2 border-b border-dotted border-gray-300 mb-[3px]" />
              </div>
              <span className={"px-2 py-1 text-[13px] text-center border-l border-t border-gray-200 whitespace-nowrap font-semibold " + (ri % 2 ? "bg-gray-50 " : "") + (row.warn ? "text-amber-600" : "text-gray-800")}>{row.value}</span>
            </div>
          ))}
          <div className="contents">
            <span className="px-2 py-1 bg-gray-50 text-[13px] text-gray-600">{hasShare ? `${dept}'s crew today` : "Crew today"}</span>
            <span className="px-2 py-1 bg-gray-50 text-[13px] text-center border-l border-gray-100 text-gray-900 font-semibold whitespace-nowrap">{hasShare ? Math.round(effDay(r, d)) : d.count}</span>
          </div>
        </div>
        {laboursHow[howKey] && evDays.length > 0 && (
          <div className="border-t px-2 py-1.5 text-[13px] text-gray-700">
            <div className="text-[12.5px] text-gray-500 mb-1">Crew never drops mid-event, only grows — each day keeps the biggest need so far:</div>
            <div className="grid grid-cols-[max-content_max-content_max-content] gap-x-6 gap-y-0.5">
              <span className="text-[12px] uppercase tracking-wide text-gray-400 font-semibold">Day</span>
              <span className="text-[12px] uppercase tracking-wide text-gray-400 font-semibold text-center">Needed that day</span>
              <span className="text-[12px] uppercase tracking-wide text-gray-400 font-semibold text-center">Crew kept</span>
              {evDays.map(x => (
                <Fragment key={x.date}>
                  <span className={x === peakDay ? "font-semibold text-gray-900" : ""}>{x.date}{mpFns.filter(f => String(f?.date || "").slice(0, 10) === x.date).map(f => f?.type).filter(Boolean).length ? ` · ${mpFns.filter(f => String(f?.date || "").slice(0, 10) === x.date).map(f => f?.type).filter(Boolean).join(" + ")}` : ""}</span>
                  <span className={"text-center " + (x === peakDay ? "font-semibold text-gray-900" : "")}>{x.trace?.result ?? "—"}</span>
                  <span className="text-center font-semibold">{x.count}</span>
                </Fragment>
              ))}
            </div>
            {peakDay && <div className="mt-1 text-[12.5px] text-amber-600">{d.count} comes from {peakDay.date} — the busiest day so far — and is carried to {d.date}.</div>}
          </div>
        )}
      </div>
    );
  };
  const renderMpTrace = (t, drivenBy, day, crewType = "") => {
    if (!t) return null;
    // Any other crew type with per-function traces from Deal Check: same table, its own rows.
    if (t.kind !== "tier2" && Array.isArray(t.byFn) && t.byFn.length) {
      const { cols, timeLabel, shiftOf } = orderFnCols(t.byFn, day);
      const labHowKey = `fn|${crewType}|${day?.date || ""}`;
      const labels = [];
      cols.forEach(c => traceRowsOf(c.trace).forEach(r => { if (!labels.includes(r.label)) labels.push(r.label); }));
      return (
        <div className="mb-1.5 bg-white border rounded-lg overflow-x-auto">
          <div className={"grid " + (FN_GRID[cols.length] || FN_GRID[6])}>
            <div className="contents">
              <span className="px-2 pr-6 py-1 bg-gray-100 text-[13px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap">Item / Zone</span>
              {cols.map((c, ci) => <span key={ci} className="px-2 py-1 bg-gray-100 text-center border-l border-gray-200 whitespace-nowrap"><span className="block text-[13px] uppercase tracking-wide text-gray-500 font-semibold">{c.fn}</span><span className={"block text-[12px] font-semibold normal-case " + (shiftOf(c) ? "text-blue-700" : "text-amber-600")}>{timeLabel(c)}</span></span>)}
            </div>
            {labels.map((lb, ri) => (
              <div className="contents" key={ri}>
                <div className={"flex items-baseline gap-1.5 min-w-0 overflow-hidden px-2 py-1 text-[13px] text-gray-700 border-t border-gray-200" + (ri % 2 ? " bg-gray-50" : "")}>
                  {(() => {
                    // The item that was added / changed since the plan was last opened shows in red.
                    const mk = mpNote?.byName?.[String(lb).trim()];
                    return (<>
                      <span className={"truncate " + (mk ? "text-red-600 font-semibold" : "")} title={lb}>{lb}</span>
                      {mk && <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-bold uppercase text-red-600">{mk.kind === "new" ? "new" : `qty ${mk.from}→${mk.to}`}</span>}
                    </>);
                  })()}
                  <span aria-hidden="true" className="flex-1 min-w-2 border-b border-dotted border-gray-300 mb-[3px]" />
                </div>
                {cols.map((c, ci) => { const r = traceRowsOf(c.trace).find(x => x.label === lb); return (
                  <span key={ci} className={"px-2 py-1 text-[13px] text-center border-l border-t border-gray-200 whitespace-nowrap" + (ri % 2 ? " bg-gray-50" : "")}>{r ? <b className="text-gray-800">{r.value}</b> : <span className="text-gray-300">—</span>}</span>
                ); })}
              </div>
            ))}
            <div className="contents">
              <span className="px-2 py-1 bg-gray-50 text-[13px] text-gray-600 flex items-center gap-1.5" title={t.kind === "labours" ? `${dept}'s own slice of each function's shared crew — the plain sum of its rows, not a dedicated headcount` : undefined}>
                {t.kind === "labours" ? `${dept}'s share per function` : "Crew per function"}
                <button type="button" onClick={() => setLaboursHow(p => ({ ...p, [labHowKey]: !p[labHowKey] }))} className="text-[12px] font-semibold text-blue-600 hover:underline">{laboursHow[labHowKey] ? "hide" : "how?"}</button>
              </span>
              {cols.map((c, ci) => <span key={ci} className="px-2 py-1 bg-gray-50 text-[13px] text-center border-l border-gray-100 text-gray-900 font-semibold whitespace-nowrap">{t.kind === "labours" ? deptNeedForFn(c).toFixed(2) : c.result}</span>)}
            </div>
          </div>
          {t.kind !== "labours" && laboursHow[labHowKey] && (
            <div className="border-t px-2 py-1.5 text-[13px] text-gray-700 space-y-1">
              <div className="text-[12.5px] text-gray-500">Each function's crew comes from the rows above (Deal Check's rule for this crew type). The day keeps the busiest function's crew, since the same people cover every function that day.</div>
              {cols.map((c, ci) => <div key={ci}><b className="text-gray-900">{c.fn}</b> ({timeLabel(c)}): <b>{c.result}</b></div>)}
              <div>Today = busiest function = <b className="text-gray-900">{Math.max(0, ...cols.map(c => Number(c.result) || 0))}</b></div>
            </div>
          )}
          {t.kind === "labours" && laboursHow[labHowKey] && (
            <div className="border-t px-2 py-1.5 text-[13px] text-gray-700 space-y-1.5">
              <div className="text-[12.5px] text-gray-500">How each row reads: <b className="text-gray-700">12 ÷ 40 = 0.30</b> — 12 of the item, one labourer handles 40, so it needs 0.30 of a labourer. <b className="text-gray-700">×46 → +1</b> — 46 of a heavy item add 1 extra labourer to the whole event's crew.</div>
              {cols.map((c, ci) => {
                const need = deptNeedForFn(c);
                const heavy = (c.trace?.heavyRows || []).filter(hr => catToDept(hr.sub) === dept);
                return (
                  <div key={ci}>
                    <b className="text-gray-900">{c.fn}</b>: {dept}'s items add up to <b className="text-gray-900">{need.toFixed(2)}</b> labourer{need === 1 ? "" : "s"}.
                    {heavy.length > 0 && <> Heavy items ({heavy.map(hr => `${hr.sub} ×${hr.count} → +${hr.extra}`).join(", ")}) add to the whole event's crew, not to this share.</>}
                    {" "}The whole event needs <b>{c.result}</b> for {c.fn} (all departments).
                    {(() => {
                      // How the situation multiplier applied to that whole-event crew, and what it did.
                      const sit = c.trace?.situational;
                      if (!sit) return null;
                      const over = (sit.parts || []).filter(p => Number(p.mult) > 1);
                      if (!(sit.mult > 1)) return <div className="text-gray-500">⚡ Situation multiplier: none applies{(sit.parts || []).length ? ` (${(sit.parts || []).map(p => p.label).join(", ")} — all ×1)` : ""}, so the crew stays {sit.after}.</div>;
                      return <div className="text-amber-700">⚡ Situation multiplier ×{Number(sit.mult).toFixed(2).replace(/\.?0+$/, "")} ({sit.winner}{over.length > 1 ? `, the biggest of ${over.map(p => `${p.label} ×${p.mult}`).join(" / ")} — they do not stack` : ""}{sit.capped ? `, capped at ×${sit.cap}` : ""}): crew {sit.before} × {Number(sit.mult).toFixed(2).replace(/\.?0+$/, "")} = {(sit.before * sit.mult).toFixed(2).replace(/\.?0+$/, "")} → rounded up to <b>{sit.after}</b>.</div>;
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    // One column per function behind this day (Deal Check's trace.byFn), each cell that function's
    // own count ÷ batch = need for the row. A trace synced before byFn existed carries only the
    // busiest function's rows, shown as that one function's column.
    if (t.kind === "tier2" && Array.isArray(t.rows) && t.rows.length > 0) {
      // No byFn from Deal Check yet: a Flowerists day (perRow) is rebuilt here per function.
      const dayFns = !day ? [] : day.phase === "event" ? mpFns.filter(f => String(f?.date || "").slice(0, 10) === day.date) : day.phase === "minusOne" ? mpFns : [];
      const localByFn = (!Array.isArray(t.byFn) && t.perRow && dayFns.length > 1) ? dayFns.map(flowerTraceForFn) : null;
      const rawCols = Array.isArray(t.byFn) && t.byFn.length ? t.byFn : localByFn || [{ fn: drivenBy || "Function", rows: t.rows, result: t.result }];
      const { cols, timeLabel, shiftOf } = orderFnCols(rawCols, day);
      const t2HowKey = `t2|${crewType}|${day?.date || ""}`;
      const names = [];
      cols.forEach(c => (c.rows || []).forEach(r => { if (!names.includes(r.sub)) names.push(r.sub); }));
      const cellOf = (c, sub) => (c.rows || []).filter(r => r.sub === sub);
      return (
        <div className="mb-1.5 bg-white border rounded-lg overflow-x-auto">
          {/* One shared grid for header + rows (display:contents), so every column lines up. */}
          <div className={"grid " + (FN_GRID[cols.length] || FN_GRID[6])}>
            <div className="contents">
              <span className="px-2 pr-6 py-1 bg-gray-100 text-[13px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap">{t.perRow ? "Recipe / item" : "Sub-category"}</span>
              {cols.map((c, ci) => <span key={ci} className="px-2 py-1 bg-gray-100 text-center border-l border-gray-200 whitespace-nowrap"><span className="block text-[13px] uppercase tracking-wide text-gray-500 font-semibold">{c.fn}</span><span className={"block text-[12px] font-semibold normal-case " + (shiftOf(c) ? "text-blue-700" : "text-amber-600")}>{timeLabel(c)}</span></span>)}
            </div>
            {names.map((sub, ri) => (
              <div className="contents" key={ri}>
                <div className={"flex items-baseline gap-1.5 min-w-0 overflow-hidden px-2 py-1 text-[13px] text-gray-700 border-t border-gray-200" + (ri % 2 ? " bg-gray-50" : "")}>
                  <span className="truncate" title={sub}>{sub}</span>
                  <span aria-hidden="true" className="flex-1 min-w-2 border-b border-dotted border-gray-300 mb-[3px]" />
                </div>
                {cols.map((c, ci) => {
                  const rs = cellOf(c, sub);
                  return (
                    <span key={ci} className={"px-2 py-1 text-[13px] text-center border-l border-t border-gray-200 whitespace-nowrap" + (ri % 2 ? " bg-gray-50" : "")}>
                      {rs.length ? rs.map((r, k) => (
                        <span key={k} className={k ? "block" : ""}>
                          <b className="text-gray-800">{r.count}</b>
                          <span className="text-gray-400"> ÷{r.batch} = </span>
                          <b className="text-gray-900">{(Number(r.need) || 0).toFixed(2)}</b>
                        </span>
                      )) : <span className="text-gray-300">—</span>}
                    </span>
                  );
                })}
              </div>
            ))}
            <div className="contents">
              <span className="px-2 py-1 bg-gray-50 text-[13px] text-gray-600 flex items-center gap-1.5">Crew per function
                <button type="button" onClick={() => setLaboursHow(p => ({ ...p, [t2HowKey]: !p[t2HowKey] }))} className="text-[12px] font-semibold text-blue-600 hover:underline">{laboursHow[t2HowKey] ? "hide" : "how?"}</button>
              </span>
              {/* Plain sum of the rows above (owner ask) — the rounding up to whole people is shown below. */}
              {cols.map((c, ci) => <span key={ci} className="px-2 py-1 bg-gray-50 text-[13px] text-center border-l border-gray-100 text-gray-900 font-semibold whitespace-nowrap tabular-nums">{((c.rows || []).reduce((acc, r) => acc + Math.round((Number(r.need) || 0) * 100), 0) / 100).toFixed(2)}</span>)}
            </div>
          </div>
          {/* Deal Check ceils ONCE over a function's summed need (traceOf / calcPpl), never each row —
              the old "Σ each ⌈need⌉" label described a rule nothing used. */}
          <div className="px-2 py-1 bg-gray-50 border-t text-[13px] text-right text-gray-600">
            {cols.length > 1 ? <>Today = busiest function = <b className="text-gray-900">{t.result}</b></> : <>⌈ Σ {(Number(t.need) || 0).toFixed(2)} ⌉{t.min > 0 ? <> · at least {t.min}</> : null} = <b className="text-gray-900">{t.result}</b></>}
          </div>
          {laboursHow[t2HowKey] && (
            <div className="border-t px-2 py-1.5 text-[13px] text-gray-700 space-y-1">
              <div className="text-[12.5px] text-gray-500">How each row reads: <b className="text-gray-700">34 ÷45 = 0.76</b> — 34 of the item, one person handles 45, so it needs 0.76 of a person. A function's rows are added up and rounded up once.</div>
              {cols.map((c, ci) => {
                const sum = Math.round((c.rows || []).reduce((acc, r) => acc + (Number(r.need) || 0), 0) * 100) / 100;
                return <div key={ci}><b className="text-gray-900">{c.fn}</b> ({timeLabel(c)}): rows add up to <b>{sum.toFixed(2)}</b> → rounded up = <b>{Math.ceil(sum)}</b>{t.min > 0 && Math.ceil(sum) < t.min ? <> → at least {t.min}</> : null}{Number(c.result) !== Math.max(Math.ceil(sum), t.min || 0) ? <> → <b>{c.result}</b> (date / venue factors)</> : null} = <b className="text-gray-900">{c.result}</b> crew</div>;
              })}
              {cols.length > 1 && <div>Today = busiest function = <b className="text-gray-900">{t.result}</b> — the same people cover every function that day.</div>}
            </div>
          )}
        </div>
      );
    }
    // A tier2 type (Carpenters, Painters, etc.) with NO matching items today still often shows crew
    // assigned — a configured minimum (e.g. "always keep at least 1 on-site whenever this booking has
    // this role at all") floors it above zero even with nothing to point to. Previously this whole box
    // just didn't render at all when rows was empty, so the crew count above sat there with no
    // explanation — looked like the system had assigned staff for no reason.
    if (t.kind === "tier2" && (!Array.isArray(t.rows) || t.rows.length === 0)) return (
      <div className="mb-1.5 text-[13px] text-gray-500">
        No matching items today{t.min > 0 ? <> — but at least <b className="text-gray-900">{t.min}</b> kept on-site whenever this role is needed anywhere in the booking.</> : "."}
      </div>
    );
    if (t.kind === "pillars") return (
      <div className="mb-1.5">
        {/* "→ range →" was the internal name for "more pillars means more hands, in steps" — a
            lookup table of thresholds, not a concept a dept head needs named. Just state the pillar
            count and the crew it calls for. */}
        <div className="text-[13px] text-gray-600">🏗️ <b className="text-gray-900">{t.total}</b> pillar{t.total === 1 ? "" : "s"} to put up → <b className="text-gray-900">{t.result}</b> Truss Labour needed</div>
        {Array.isArray(t.rows) && t.rows.length > 0 && renderMpNameValueRows(t.rows.map(r => ({ sub: r.sub, value: r.count, meta: r.shape ? [r.shape, r.dims, r.masking].filter(Boolean).join(" · ") : null })), "Pillars")}
      </div>
    );
    if (t.kind === "ratio") return <div className="mb-1.5 text-[13px] text-gray-600">📐 {t.num} {t.numLabel} ÷ {t.denomLabel} = <b>{t.result}</b></div>;
    if (t.kind === "range") return (
      <div className="mb-1.5">
        <div className="text-[13px] text-gray-600">📐 {t.value} {t.unit} → range → <b>{t.result}</b></div>
        {Array.isArray(t.rows) && t.rows.length > 0 && renderMpNameValueRows(t.rows.map(r => ({ sub: r.sub, value: r.sqft })), t.unit || "Qty", 2)}
      </div>
    );
    // Fabric Bangali crew is driven by each zone's own tent/truss structure — a big canopy top needs
    // its own crew, and every wall-masking + the fabric wrap around every pillar/beam (batta) adds
    // running feet that a team of workers covers together. Plain zone-by-zone list instead of the
    // config-type jargon ("full_box"/"half_box"/"u_only") the underlying calc uses — a head just
    // needs "this zone needs a canopy team" and "this many feet of wrap", not which truss shape.
    if (t.kind === "fabricBangali") return (
      <div className="mb-1.5">
        <div className="text-[13px] text-gray-600">🧵 <b className="text-gray-900">{t.result}</b> Fabric Bangali worker{t.result === 1 ? "" : "s"} needed this day</div>
        {Array.isArray(t.zones) && t.zones.length > 0 && (
          <div className="mt-1 bg-white border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-2">
              <div className="contents">
                <span className="px-2 py-1 bg-gray-100 text-[12px] uppercase tracking-wide text-gray-500 font-semibold">Zone</span>
                <span className="px-2 py-1 bg-gray-100 text-[12px] uppercase tracking-wide text-gray-500 font-semibold text-right whitespace-nowrap">Canopy team</span>
                <span className="px-2 py-1 bg-gray-100 text-[12px] uppercase tracking-wide text-gray-500 font-semibold text-right whitespace-nowrap">Wrap</span>
              </div>
              {t.zones.map((z, zi) => (
                <div className="contents" key={zi}>
                  <div className="min-w-0 overflow-hidden px-2 py-0.5">
                    <div className="flex items-baseline gap-1.5 text-[13px] text-gray-700">
                      <span className="truncate" title={z.zone}>{z.zone}</span>
                      <span aria-hidden="true" className="flex-1 min-w-2 border-b border-dotted border-gray-300 mb-[3px]" />
                    </div>
                    {/* The truss's own shape/size, and whether it's masked — same info a dept head
                        asked to see for Truss Labour's rows, needed here too since the same zone
                        structure drives this crew count. */}
                    {z.shape && <div className="text-[11px] text-gray-400 truncate">{[z.shape, z.dims, z.masking].filter(Boolean).join(" · ")}</div>}
                  </div>
                  <span className="px-2 py-0.5 text-[13px] text-gray-700 text-right whitespace-nowrap">{z.topLabour > 0 ? `${z.topLabour}` : "—"}</span>
                  <span className="px-2 py-0.5 text-[13px] text-gray-700 text-right whitespace-nowrap">{z.rft > 0 ? `${z.rft} ft` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* The zone table above shows WHERE the canopy/wrap work is; this line is the actual sum
            that gets you to the headline number — without it, "canopy team 3" and "108 ft → 2
            workers" just sit there as two unconnected facts instead of visibly adding to the 5
            at the top. */}
        <div className="mt-1 text-[12.5px] text-gray-500">
          {t.topTotal > 0 && <>{t.topTotal} for the canopy{t.rftLabour > 0 ? " + " : ""}</>}
          {t.rftLabour > 0 && <>{t.rftLabour} to wrap {t.rftTotal} ft of fabric ({t.rftPerWorker} ft per worker)</>}
          {(t.topTotal > 0 || t.rftLabour > 0) && <> = <b className="text-gray-700">{t.result}</b> total</>}
        </div>
      </div>
    );
    // Plain-language, dept-head-facing version — no formulas (base/situational multiplier/floor
    // comparisons). Those numbers are real but meaningless to someone who isn't reading the code;
    // all a head needs is "this many people, because of these items". "Labours" is always the
    // SHARED, event-wide crew (never one department's own) — said explicitly, because the number
    // here otherwise reads like it's this department's own headcount, and the "X of Y" share line
    // right below it (outside this box) is the only place that actually says whose slice is whose.
    // Without "across today's whole event" spelled out, a department whose own share happened to
    // round to the same number as the total (small booking, high share) had no way to tell the two
    // apart at a glance.
    if (t.kind === "labours") {
      // Each heavy row belongs to whichever department its own sub-category routes to
      // (catToDept("Sofa") -> Furniture) — filtered to the department currently open, so this
      // box only ever shows items that are actually this department's own. `t.result` itself
      // stays the whole event's shared headcount (unfiltered) — that number is genuinely shared,
      // only the "which items drove the heavy add-on" list is department-specific.
      const deptHeavyRows = Array.isArray(t.heavyRows) ? t.heavyRows.filter(hr => catToDept(hr.sub) === dept) : [];
      // Every ITEM (not just sub-category) behind the pooled usage floor — e.g. 10 "Roman Fibre
      // Pot Small" at 1-per-40 is 0.25 labour, which never shows up in deptHeavyRows above at all
      // (that's an independent per-sub-category floor; anything under its OWN perCount silently
      // rounds to 0 there) even though it's exactly what this pooled floor sums before ceiling
      // once. Same department filter, by name instead of by sub-category.
      const deptUsageRows = Array.isArray(t.usageRows) ? t.usageRows.filter(ur => usageDept(ur) === dept) : [];
      return (
      <div className="mb-1.5">
        <div className="rounded-lg bg-amber-50/70 ring-1 ring-amber-200/70 px-2.5 py-1.5 text-[13.5px] text-gray-700">
          <span aria-hidden="true" className="text-amber-500 mr-1">⚡</span>
          <b className="text-amber-700">{t.result} labourer{t.result === 1 ? "" : "s"}</b> needed across today's whole event (shared by every department)
        </div>
        {deptHeavyRows.length > 0 && (
          <div className="mt-1">
            <div className="text-[12.5px] text-gray-500">Extra hands needed for {dept}'s own items:</div>
            <div className="mt-0.5 bg-white border rounded-lg overflow-hidden divide-y divide-gray-100">
              {deptHeavyRows.map((hr, hi) => (
                <div key={hi} className="flex items-center justify-between px-2 py-1 text-[13px] text-gray-700">
                  <span className="truncate">{hr.sub} <span className="text-gray-400">× {hr.count}</span></span>
                  <span className="font-semibold shrink-0">+{hr.extra}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {t.venueMin > 0 && <div className="mt-1 text-[12.5px] text-gray-500">+ {t.venueMin} minimum crew this venue always requires</div>}
        {/* Every item (not just sub-category) behind the pooled usage floor — shown whenever this
            department has any, whether or not that pooled floor ended up being the binding reason
            for today's count (usageFloor set <=> it was; otherwise this is still real, informative
            usage that just didn't happen to be the larger of the two candidate numbers). Used to be
            a single vague sentence with no itemization at all. */}
        {deptUsageRows.length > 0 && (
          <div className="mt-1">
            <div className="text-[12.5px] text-gray-500">{t.usageFloor != null ? "Rounded up to cover today's overall décor workload — " : ""}{dept}'s own item usage:</div>
            <div className="mt-0.5 bg-white border rounded-lg overflow-hidden divide-y divide-gray-100">
              {deptUsageRows.map((ur, ui) => (
                <div key={ui} className="flex items-center justify-between px-2 py-1 text-[13px] text-gray-700">
                  <span className="truncate">{ur.name}</span>
                  <span className="font-semibold shrink-0 tabular-nums">{ur.qty} ÷ {ur.per} = {ur.need.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      );
    }
    if (t.kind === "fixed") return <div className="mb-1.5 text-[13px] text-gray-600">📐 {t.note} = <b>{t.result}</b>{" "}(before split)</div>;
    return null;
  };
  // Day-wise plan (which days × crew × which dihari shift windows) — mirrors Deal Check's day/timing
  // breakdown, but editable here: the dept head can change crew per day AND toggle each day's shifts.
  const renderMpSchedule = (r) => {
    const sch = r && r.schedule;
    if (!Array.isArray(sch) || !sch.length) return null;
    const editable = dayWise(r);
    const winDefs = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : [];
    const totalDihari = sch.reduce((s, d) => s + mpDayDihari(r, d, mpDay, mpWin, mpWinCount), 0);
    // ONE line per day: [how] [day] [per-shift crew …] ··· [crew × shifts]. It was two lines a day —
    // the day and its crew on top, the shifts on their own row underneath — which doubled the height
    // and left most of both rows empty. The long cumulative-max rule moved into the ⓘ tooltip.
    const phaseCls = (d) => d.phase === "dismantle" ? "bg-violet-50 text-violet-700" : d.phase === "minusOne" ? "bg-amber-50 text-amber-700" : d.phase === "gap" ? "bg-gray-100 text-gray-500" : "bg-blue-50 text-blue-800";
    return (
      <div className="mt-2 bg-white rounded-xl ring-1 ring-gray-200 text-[13.5px] text-gray-600 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50/80 border-b border-gray-100">
          <span className="text-[14px] font-semibold text-gray-900">📅 Day-wise plan</span>
          <span className="text-[12.5px] text-gray-400 truncate">crew × dihari shifts{editable ? " · editable" : ""}</span>
          <span className="shrink-0 cursor-help text-[12.5px] text-blue-500" title={"Cumulative-max rule: crew only scales UP across the booking — each day holds the max of its own need and any busier earlier day (it never drops mid-event). Open a day's \"how\" to see its own requirement; edit any day if you disagree."}>ⓘ rule</span>
          <span className="ml-auto shrink-0 flex items-center gap-1.5">
            <span className="rounded-md bg-white ring-1 ring-gray-200 px-2 py-0.5 font-semibold text-gray-800">{Math.round(totalDihari)} dihari</span>
            <span className="rounded-md bg-gray-900 px-2 py-0.5 font-bold text-white tabular-nums">{fmt(lineCost(r))}</span>
          </span>
        </div>
        <div className="divide-y divide-gray-100">
        {sch.map((d, i) => {
          const ov = editable && dayOv(r, d);
          const ids = orderWinIds(effWinIds(r, d), winDefs, d.date);
          const shifts = effWin(r, d);
          const dayKey = `${r.type}|${d.date}`;
          const howOpen = !!mpDayHow[dayKey];
          const hasShare = r.shared && d.share != null;
          // Table layout for a shared-crew day: a Labours day with no per-function trace, or a
          // dismantle / gap / −1 setup day (no trace of its own) that still carries a share.
          const useLabTable = (d.trace?.kind === "labours" && !(Array.isArray(d.trace.byFn) && d.trace.byFn.length)) || (!d.trace && hasShare);
          // A head setting different crew PER SHIFT (mpWinCount, the "+ dihari" inputs above) means
          // there is no longer one single day-level crew count the "crew × shifts" caption below can
          // multiply out to — each shift already carries its own number. winOverridden gates both
          // that caption and the share hint, which are otherwise still accurate for the common case
          // (uniform crew across every shift that day).
          const winOverridden = !!(mpWinCount[r.type] && mpWinCount[r.type][d.date] && Object.keys(mpWinCount[r.type][d.date]).length);
          const dayDihariReal = mpDayDihari(r, d, mpDay, mpWin, mpWinCount);
          // The crew figure is rounded for display (you can't book "0.6 of a person"), but the day's
          // TOTAL dihari is summed from the unrounded fractional share so the line's cost stays
          // reconciled to the rupee. This hint surfaces that fraction so "1 crew × 2" and "1 crew × 1"
          // don't look like they should add to 3 when the real total is 2. Suppressed once the head
          // has typed an explicit override (ov), or set per-shift crew directly (winOverridden) —
          // either way raw and shown already match, or the day-level share no longer applies at all.
          const rawShare = (hasShare && !winOverridden) ? effDay(r, d) : null;
          const shareHint = rawShare != null && Math.abs(rawShare - showDay(r, d)) >= 0.05 ? rawShare.toFixed(2) : null;
          const hasWin = winDefs.length > 0 && (Array.isArray(d.windowIds) || (mpWin[r.type] && mpWin[r.type][d.date] != null));
          return (
            <div key={i} className="px-3 py-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setMpDayHow(o => ({ ...o, [dayKey]: !o[dayKey] }))} title="How this day's crew was calculated"
                  className={"shrink-0 w-6 h-6 rounded text-[11.5px] leading-none flex items-center justify-center transition-colors " + (howOpen ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600")}>{howOpen ? "▾" : "▸"}</button>
                <span className={"shrink-0 w-32 rounded-md px-2 py-0.5 text-[13px] font-semibold text-center " + phaseCls(d)}>{phaseLbl(d)}</span>
                {/* Per-dihari (per-shift) crew — a head can hold different crew per shift (e.g. 6 day,
                    3 evening). Same mpWinCount data + cost model as the on-site editor → synced. */}
                {hasWin && editable && (
                  <span className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {ids.map((id, si) => { const wd = winDefs.find(w => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`; return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-gray-50 ring-1 ring-gray-200 pl-1.5 pr-0.5 py-0.5">
                        <span className="text-[12.5px] text-gray-500 whitespace-nowrap">{lbl}</span>
                        <input type="number" min="0" value={effShift(r, d, id)} onChange={e => setShiftCount(r.type, d.date, id, e.target.value, ids)} className="w-11 rounded bg-white ring-1 ring-gray-200 px-1 py-0 text-[13.5px] font-semibold text-center text-gray-900" />
                        {ids.length > 1 && <button onClick={() => removeDihari(r.type, d.date, id, ids)} className="w-4 h-4 rounded text-gray-300 hover:text-red-500 text-[13.5px] leading-none" title="remove this dihari">×</button>}
                      </span>
                    ); })}
                    <button onClick={() => addDihari(r, d.date, ids)} className="text-[12.5px] font-semibold text-blue-600 hover:bg-blue-50 rounded-md px-1.5 py-0.5" title="Add another dihari (shift) this day">+ dihari</button>
                    {dayHasEdits(r.type, d.date) && <button onClick={() => resetMpDay(r.type, d.date)} disabled={!canManpower} className="text-[12.5px] font-semibold text-amber-600 hover:bg-amber-50 rounded-md px-1.5 py-0.5 disabled:opacity-50" title="Undo this day's hand edits (shifts, per-shift crew, day crew) and go back to the system plan">↺ reset</button>}
                  </span>
                )}
                {hasWin && !editable && (
                  <span className="flex flex-wrap gap-1">
                    {orderWinIds(winDefs.map(w => w.id), winDefs, d.date).map(id => winDefs.find(w => w.id === id)).map(w => { const on = ids.includes(w.id); return <span key={w.id} className={"px-1.5 py-0.5 rounded-full border text-[12.5px] " + (on ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-gray-100 text-gray-300")}>{on ? "✓ " : ""}{w.label}{on ? ` ${effShift(r, d, w.id)}` : ""}</span>; })}
                  </span>
                )}
                <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[13px] text-gray-500">
                  {shareHint && <span className="text-[12px] text-gray-400" title="This day's exact fractional crew share, before rounding for display — the total is summed from this, not from the rounded number.">{shareHint} share ·</span>}
                  {editable
                    ? <input type="number" min="0" value={showDay(r, d)} onChange={e => setMpDay(r.type, d.date, e.target.value)} disabled={!canManpower}
                        title={canManpower ? "Crew this day" : "Requires \"Manage Manpower\""}
                        className={"w-12 rounded-md ring-1 px-1 py-0.5 text-[14px] font-semibold text-center text-gray-900 " + (ov ? "ring-amber-400 bg-amber-50" : "ring-gray-200 bg-white") + (canManpower ? "" : " opacity-50 cursor-not-allowed")} />
                    : <b className="text-[14px] text-gray-900">{d.count}</b>}
                  {winOverridden
                    ? <span className="whitespace-nowrap" title="Per-shift crew counts differ this day, so the total is the sum of each shift's own count, not crew × shifts.">= <b className="text-gray-800">{Math.round(dayDihariReal)}</b> dihari</span>
                    : <span className="whitespace-nowrap">crew × <b className="text-gray-800">{shifts}</b></span>}
                </span>
              </div>
              {howOpen && useLabTable && (
                <div className="mt-1.5 ml-7 bg-slate-50 ring-1 ring-slate-200 rounded-lg p-2">
                  {renderLaboursDayTable(r, d, hasShare)}
                </div>
              )}
              {howOpen && !useLabTable && (
                <div className="mt-1.5 ml-7 bg-slate-50 ring-1 ring-slate-200 rounded-lg p-2">
                  {d.trace ? renderMpTrace(d.trace, d.drivenBy, d, r.type)
                    : <div className="text-[13px] text-gray-500">{d.phase === "minusOne" ? "⏮️ −1 setup — full crew staged early (peak of all functions)." : d.phase === "dismantle" ? "🧹 dismantle day — crew carried from the event." : "⏸️ gap day — crew carried from the previous day."}</div>}
                  {d.trace && Number(d.trace.result) > 0 && Number(d.trace.result) < Number(d.count) && (
                    <div className="text-[13px] text-amber-600 mt-1">🔼 Today only needs {d.trace.result}, but crew is kept at {d.count} — carried over from a busier earlier day (crew never drops mid-event, only grows).</div>
                  )}
                  {hasShare && (
                    <div className="mt-1 text-[13px] text-gray-600">
                      <b>{dept}</b>'s share today: <b className="text-gray-900">{Math.round(effDay(r, d))}</b> of the {d.count} {r.type.toLowerCase()} ({Math.round((Number(d.share) || 0) * 100)}% of today's heavy décor belongs to {dept})
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
    );
  };

  // ── DEPARTMENT REPORT → PDF ──
  // Everything this tab knows about ONE department on ONE event, in one printable page: the
  // money, the blocked inventory, the crew, what was actually spent, the trucks, the dismantle
  // routing, and (for Fabric) the requirement against stock. Scoped exactly like the page it is
  // exported from — `dept` and `sel` are what the whole tab is filtered by — so the button needs
  // no arguments and there is no way to export a department you are not looking at.
  //
  // Printed via the browser rather than a PDF library: this is a client-only SPA on GitHub Pages
  // with no server to render on, and a bundled generator would add hundreds of kilobytes to
  // every page load for a button used occasionally. "Save as PDF" is in the print dialog of every
  // browser the team uses, and the same approach already prints the loading challans above.
  // opts.combined: ONE book for the whole event — every zone page carries every department's
  // items (each tagged with its department), instead of one book per department back to back.
  // Department-only sections (loading, transport, dismantle, fabric, kits, production lists) are
  // left out of it: they describe one department's stock and would mislead in a combined book.
  // Admin → Zone Types order (the keys of the zone definitions), read when the export starts; the Build
  // page lists zones in it unless the salesperson dragged them into their own order.
  const zoneAdminOrderRef = useRef(null);
  const buildReportHtml = (zoneLabels = {}, logos = {}, opts = {}) => {
    const combined = !!opts.combined;
    const bookTitle = combined ? "All departments" : dept;
    // Anything that reaches the page goes through this first. The values are client names,
    // venues, crew types and item names typed by staff in Studio — an apostrophe or a stray
    // "<" in one of them would otherwise break the markup or inject into it.
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const money = (v) => esc(fmt(Math.round(Number(v) || 0)));
    // data-block marks a unit the paginator will try to keep on one page. Sections are the
    // natural unit: a heading stranded at the foot of a page with its table overleaf is the
    // single thing that makes a generated report look generated.
    // S / M / B spelled out: a lone "S" on a card is a letter, "Small" is an instruction.
    const SMB_LABEL = { S: "Small", M: "Medium", B: "Big" };
    let sectionNo = 0;
    const sect = (title, body) => {
      if (!body) return "";
      sectionNo += 1;
      return `<section data-block><div class="sh"><span class="sn">${String(sectionNo).padStart(2, "0")}</span><h3>${esc(title)}</h3><i></i></div>${body}</section>`;
    };
    /* ── A HEADING IS ALIGNED BY ITS OWN COLUMN, NOT BY ITS POSITION ──
       This right-aligned every heading after the first, on the assumption that only column one
       holds words and the rest hold figures. Half the tables in this book break that assumption
       — the truck list (vehicle, driver, phone, status), tenting by zone, dismantle routing —
       so their headings sat hard right above left-aligned data, a column's width apart from the
       values they name. That is what "nothing lines up" looks like.
       The first body row is the authority: a column whose cell is marked numeric gets a numeric
       heading, everything else gets a plain one. Any table added later inherits it for free,
       which is the point — the old rule was a guess that no new table could know it had to meet. */
    const table = (heads, rows, widths) => {
      if (!rows.length) return "";
      const cells = rows[0].match(/<td\b[^>]*>/g) || [];
      const numeric = (i) => /class="[^"]*\bn\b[^"]*"/.test(cells[i] || "");
      return `<table><colgroup>${widths.map(w => `<col style="width:${w}">`).join("")}</colgroup><thead><tr>${heads.map((h, i) => `<th${numeric(i) ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
    };

    const venue = sel?.functionsDetail?.[0]?.venue || sel?.venue || "—";

    /* Money. `income` is the same memo the readout on screen uses, so the report and the page
       cannot disagree about what the department earns. */
    const headRows = income.shown.map(r =>
      `<tr><td>${esc(r.label)}</td><td class="n">${money(r.value)}</td><td class="n">${income.pct(r.value)}%</td></tr>`);
    // Each head also gets a drawn share bar. On screen these were dropped as noise, but a page
    // that cannot be scrolled or hovered has nothing else to make a column of percentages
    // comparable at a glance, and here the bars sit in their own narrow column rather than
    // running the width of the sheet.
    const headRowsBar = income.shown.map(r =>
      `<tr><td>${esc(r.label)}</td><td class="n">${money(r.value)}</td><td class="bar"><i style="width:${Math.max(income.pct(r.value), 2)}%"></i></td><td class="n pct">${income.pct(r.value)}%</td></tr>`);
    // The same four figures the panel shows, in the same order: income, the discount the head
    // sets by hand, what was actually spent, and the net those three produce. Net is recomputed
    // here from the same expression the card uses rather than read off the DOM, and an unlogged
    // cost counts as zero in it — exactly as on screen, so the sheet cannot quote a different
    // bottom line from the page it was exported from.
    const discountNum = Number(discount) || 0;
    const netAmount = income.liveTotal - discountNum - (hasActuals ? actualCost : 0);
    const moneyBlock = `
      <div class="cards">
        <div class="card hi"><div class="k">Total income</div><div class="v">${money(income.liveTotal)}</div><div class="s">What ${esc(dept)} earns · synced from Deal Check</div></div>
        <div class="card"><div class="k">Sales discount</div><div class="v ${discountNum ? "" : "muted"}">${discountNum ? money(discountNum) : "—"}</div><div class="s">Manual — set by the ${esc(dept)} head</div></div>
        <div class="card"><div class="k">Actual cost logged</div><div class="v ${hasActuals ? "" : "muted"}">${hasActuals ? money(actualCost) : "—"}</div><div class="s">${hasActuals ? "What you actually spent" : "Not logged yet"}</div></div>
        <div class="card ${netAmount < 0 ? "neg" : "pos"}"><div class="k">Net</div><div class="v">${money(netAmount)}</div><div class="s">Income − discount − actual cost${hasActuals ? "" : " (cost not logged yet)"}</div></div>
      </div>
      ${table(["Head", "Amount", "", "Share"], headRowsBar, ["46%", "22%", "22%", "10%"])}
      ${income.gap !== 0 && income.shown.length ? `<p class="note">Heads above sum to ${money(income.shownSum)} — ${money(Math.abs(income.gap))} ${income.gap > 0 ? "less than" : "more than"} the department total. The total carries the live crew plan; a head may not be broken out here.</p>` : ""}`;

    /* Inventory, with each kit's components indented beneath it — the components sum to the kit
       line, which is the one comparison this section exists to support. */
    const finish = buildFinish(sel?.functionsDetail, inventory, settings?.printMaterials);
    const invRows = [];
    blockedItemsGrouped.forEach(it => {
      const flags = [it.isKit ? "KIT" : "", it.shortQty > 0 ? (it.outOfStock ? "OUT OF STOCK" : `SHORT x${it.shortQty}`) : "", it.prodOrBuy ? it.prodOrBuy.toUpperCase() : "", it.isSwapped ? "SWAPPED" : ""].filter(Boolean).join(" · ");
      const paint = finish.paintFor(it);
      const extra = paint ? `<div class="sub">Paint: ${esc(paint)}</div>` : "";
      invRows.push(`<tr><td>${esc(it.name)}${flags ? ` <span class="tag">${esc(flags)}</span>` : ""}<div class="sub">${esc(it.sub || "—")}</div>${extra}</td><td class="n">${esc(it.qty)}</td><td class="n">${money(it.unit)}</td><td class="n b">${money(it.total)}</td></tr>`);
      (it.isKit && Array.isArray(it.components) ? it.components : []).forEach(cp => {
        invRows.push(`<tr class="kit"><td>&#8627; ${esc(cp.name)}</td><td class="n">${esc(cp.qty)}</td><td class="n">${money(cp.unit)}</td><td class="n">${money(cp.total)}</td></tr>`);
      });
    });

    const crewRows = mpRows.map(r => {
      const count = dayWise(r)
        ? (Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : 0) + " dihari"
        : esc(r.count);
      return `<tr><td>${esc(r.type)}${r.shared ? ' <span class="tag">SHARED</span>' : ""}</td><td class="n">${count}</td><td class="n">${money(r.rate)}</td><td class="n b">${money(lineCost(r))}</td></tr>`;
    });
    if (crewRows.length) crewRows.push(`<tr class="tot"><td>Total</td><td class="n"></td><td class="n"></td><td class="n b">${money(mpCost)}</td></tr>`);

    const spendRows = [
      ...(dept === "Floral" && mandiSpend > 0 ? [`<tr><td>Mandi shopping (real flowers)</td><td class="n b">${money(mandiSpend)}</td></tr>`] : []),
      ...expenses.map(e => `<tr><td>${esc(e.label || e.note || "Expense")}</td><td class="n b">${money(e.amount)}</td></tr>`),
    ];
    if (spendRows.length) spendRows.push(`<tr class="tot"><td>Total logged</td><td class="n b">${money(actualCost)}</td></tr>`);

    const truckRows = trucks.map((t, i) =>
      `<tr><td>Truck ${i + 1}</td><td>${esc(t.vehicle || "—")}</td><td>${esc(t.driver || "—")}</td><td>${esc(t.phone || "—")}</td><td>${esc(t.status || "—")}</td></tr>`);

    /* ── WHAT IS ACTUALLY GOING ON THE TRUCKS ──
       The truck table used to carry a "Load" column reading "7 items", which is a number nobody
       can load from: it says how many distinct lines a truck was ticked against, not what they
       are or how many of each. The list below is the thing the loading screen shows and the
       thing a loader needs — every physical item by name with its full quantity.
       Built from the FLAT list (blockedItems), so a kit appears as its shell plus each part as
       its own line, exactly as it is carried, rather than as one row saying "console".
       Ordering is left alone: it is the loading screen's own order, and two lists that disagree
       about sequence are worse than one that is not sorted the way you would choose. */
    const loadUnits = blockedItems.reduce((a, it) => a + (Number(it.qty) || 0), 0);
    // Deal Check's print row is only a count of jobs — each job is spelt out under it, and a
    // painted item carries its colours, so neither is loaded blind.
    // An overlay / cushion cover whose 1st choice is held but Planning decided another design (or arranged it separately): the held line still
    // names the 1st choice, so say what the crew uses instead.
    const decidedInstead = new Map();
    if (!pdfAllCarpetsRef.current) elementPlanOf().rows.forEach(r => {
      if (!r.other && (!r.decidedId || r.decidedId === r.prefs[0]?.id)) return;
      const nm = r.other ? "arranged separately" : ([...r.options, r.manual].filter(Boolean).find(o => o.id === r.decidedId) || {}).name || "another design";
      const k = String(r.prefs[0]?.id);
      decidedInstead.set(k, [...(decidedInstead.get(k) || []), `${nm} × ${r.qty}`]);
    });
    const loadRows = blockedItems.map(it => {
      const paint = finish.paintFor(it);
      const sub = (it.kitOf ? `<div class="sub">part of ${esc(it.kitOf)}</div>` : "")
        + (it.invId && decidedInstead.has(String(it.invId)) ? `<div class="sub">Planning chose instead: ${esc(decidedInstead.get(String(it.invId)).join(", "))}</div>` : "")
        + (paint ? `<div class="sub">Paint: ${esc(paint)}</div>` : "")
        + (it.sub === "print" ? finish.prints.map(p => `<div class="sub">${esc(finish.printLine(p))}</div>`).join("") : "");
      return `<tr><td>${esc(it.name)}${sub}</td><td class="n b">${esc(it.qty)}</td></tr>`;
    });

    const moveRows = movements.map(m =>
      `<tr><td>${esc(m.name)}</td><td>${esc(m.type === "transfer" ? `Transfer → ${m.toEventName || "site"}` : m.type === "damage" ? "Damaged" : "Back to production house")}</td><td class="n">${esc(m.qty)}</td><td>${esc(m.by || "—")}</td></tr>`);

    const fabRows = dept === "Fabric" ? fabricReqRows.flatMap(ft => ft.rows.map(r =>
      `<tr><td>${esc(ft.label)} · ${r.colour && r.colour !== "(unassigned)" ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;border:1px solid rgba(0,0,0,.18);background:${esc(r.hex)};margin-right:5px;vertical-align:middle"></span>` : ""}${esc(r.colour)}</td><td class="n">${esc(r.required)} ${esc(ft.unit)}</td><td class="n">${esc(r.avail)} ${esc(ft.unit)}</td><td class="n ${r.short > 0 ? "bad" : "ok"}">${r.short > 0 ? `short ${esc(r.short)} ${esc(ft.unit)}` : "ok"}</td></tr>`)) : [];

    /* ── ZONE LAYOUT PAGES ──
       One page per zone of the event: the zone's reference photo in the middle band, and this
       department's items that go into that zone as cards above and below it, each with an arrow
       to the photo. A card carries the item's own photo, qty, dimensions and the zone it goes in.
       Built from the event order's functionsDetail — each function's zone element lists
       (`elements[zoneKey]`), zone photos (`elSelectedPhoto`) and zone dims — with each element
       resolved to its inventory item (by invId / imsId, else by name) for the photo and dims.
       An element whose inventory item belongs to another department is skipped. Items this
       department holds that no zone lists land on a final page of their own, so the PDF never
       drops something that is going to the event.
       Arrows point at the photo's edge, not at a spot inside it: nothing records where in the
       photo an item stands. */
    const invById = new Map((inventory || []).map(i => [String(i.id), i]));
    const invByName = new Map((inventory || []).map(i => [String(i.name || "").trim().toLowerCase(), i]));
    // Every department's items — not just whichever single `dept` happened to be selected before
    // Export was clicked (exportPdf's combined pass never changes it). Needed for the combined book
    // so a kit whose OWN shell line lives on a DIFFERENT department's sheet than the zone it sits
    // in (e.g. a "Floral" zone item whose kit-shell is filed under Furniture) is still found —
    // owner-reported: kits were still missing from the all-departments book after Recipe/Transport
    // were fixed to span every department.
    const allDeptItems = () => {
      const out = [];
      DEPTS.forEach(d => {
        const snap = Array.isArray(sel?.deptInventory?.[d]) ? sel.deptInventory[d] : null;
        if (snap && snap.length) {
          snap.forEach((x, i) => out.push({ id: `${d}:${x.name}:${i}`, invId: x.imsId || null, name: x.name, photo: x.photo || "", qty: x.qty || 0, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "", isKit: !!x.isKit, fromKit: x.fromKit || null, components: Array.isArray(x.components) ? x.components : null, recipeParts: Array.isArray(x.recipeParts) ? x.recipeParts : null }));
          return;
        }
        Object.entries(blocks || {}).forEach(([itemId, arr]) => {
          const qty = (arr || []).filter(b => b.eventId === sel.id).reduce((s, b) => s + (Number(b.qty) || 0), 0);
          if (qty <= 0) return;
          const item = (inventory || []).find(i => String(i.id) === String(itemId));
          if (!item || catToDept(item.cat || item.category) !== d) return;
          const unit = Number(item.price ?? item.rentalCost) || 0;
          out.push({ id: `${itemId}:${d}`, invId: itemId, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, unit, total: unit * qty, sub: item.subCat || item.subcategory || "" });
        });
      });
      return out;
    };
    const kitSourceItems = combined ? allDeptItems() : blockedItemsGrouped;
    // heldByInv/heldByName used to always read blockedItemsGrouped (single-dept-scoped) even in
    // combined mode — the zone-card merge loop below does gate "mine" on `combined`, but it still
    // reads `held` unconditionally for the item's kit/photo/dims/recipe fields, so a kit filed on
    // another department's sheet silently looked un-kitted (held undefined -> kit: 0) instead of
    // missing just its own card. Rebased on kitSourceItems, which is already all-departments-aware.
    const heldByInv = new Map(kitSourceItems.filter(b => b.invId).map(b => [String(b.invId), b]));
    const heldByName = new Map(kitSourceItems.map(b => [String(b.name || "").trim().toLowerCase(), b]));
    // ── WHERE A KIT'S PARTS HIDE ──
    // Deal Check splits a kit across departments by each PART's own category, so Floral ends up
    // holding a terracotta element bolted to a coffee table that Furniture owns. The zone lists
    // only ever name the kit and carry no components at all, so such a part is unreachable by
    // name — `fromKit` is the only record of the parent, and this index the only way back to it.
    const partsByKit = new Map();
    kitSourceItems.forEach(b => {
      const p = String(b.fromKit || "").trim().toLowerCase();
      if (!p) return;
      if (!partsByKit.has(p)) partsByKit.set(p, []);
      partsByKit.get(p).push(b);
    });
    const hasDeptSnapshot = Array.isArray(sel?.deptInventory?.[dept]) && sel.deptInventory[dept].length > 0;
    const invDims = (inv) => {
      if (!inv) return "";
      if (inv.size) return String(inv.size);
      const d = inv.dims_LxWxH;
      const parts = d ? [d.l, d.w, d.h].filter(v => Number(v) > 0) : [];
      return parts.length ? parts.join(" × ") + (d.unit ? " " + d.unit : "") : "";
    };
    const invPhoto = (inv, held) => (Array.isArray(inv?.photoUrls) && inv.photoUrls[0]) || inv?.img || held?.photo || "";
    // Admin-edited zone names first (Studio's zone settings, fetched at export time), then the
    // built-in defaults, then the key itself tidied up.
    // A custom zone's key is a generated id ("cz_1789…") — its name only reaches IMS through
    // fn.zoneNames (Studio's sync). Without it the title printed as "Cz 1789216840977".
    const zoneName = (zk, fn) => (fn?.zoneNames?.[zk]) || zoneLabels[zk] || ZONE_META[zk]?.label || String(zk).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const zoneDimsText = (d) => {
      if (!d) return "";
      const parts = [["L", d.L], ["W", d.W], ["H", d.H]].filter(([, v]) => Number(v) > 0);
      return parts.length ? parts.map(([k, v]) => `${k} ${v}`).join(" × ") + " ft" : "";
    };

    // The image goes INSIDE the element's one style attribute. An element that already has a
    // style (the zone photo carries its position) must not get a second style="" — browsers keep
    // only the first, which is how the zone photo came out blank while the cards' photos showed.
    // Photos go into the book at print size, not camera size. They are stored at full resolution
    // (a zone photo ran 1.2 MB); Supabase resizes on the fly, and 1400px is still sharper than an A4
    // page at 2x needs. Full-size images were most of what Safari ran out of memory on.
    // Photos fetched at the size they are drawn, not one size for all. fitUrl doubles the size it is
    // given, so the old flat 700 meant every photo arrived 1400px — a 224px card included — and on
    // a low-end phone decoding and scaling those dozens of large photos was most of the wait.
    // Cards: 180 → 360px (a card is 224px, drawn at ≤1.5x). Zone photo and cover: 560 → 1120px.
    // ── A FRESH URL FOR EVERY EXPORT (Safari) ── "The operation is insecure": Safari hands the report
    // the copy of a photo it already cached for the page, fetched WITHOUT CORS, even though the
    // report asks for it with CORS — the canvas the photo is drawn into is then "tainted" and its
    // pixels cannot be read, so the section drops out of the PDF. A query mark unique to this
    // export makes the URL one Safari has never seen, so it fetches it fresh, with CORS.
    const pdfBust = "pdfx=" + Date.now().toString(36);
    const pdfImg = (url, size = 560) => {
      const u = fitUrl(url, size, 82);
      return (typeof u === "string" && u && !u.startsWith("data:")) ? u + (u.includes("?") ? "&" : "?") + pdfBust : u;
    };
    const bgCss = (url, size) => url ? `background-image:url('${esc(pdfImg(url, size))}');` : "";
    const bgData = (url, size) => url ? `data-bg="${esc(pdfImg(url, size))}"` : "";
    const bg = (url, size) => url ? `style="${bgCss(url, size)}" ${bgData(url, size)}` : "";

    const zonePages = [];
    // ── THIS EVENT'S MANDI SWAPS ──
    // The Floral real-shopping list records a flower the mandi did not have (swappedTo) and its
    // replacement row (swapFor, the qty actually bought). Every arrangement using that flower is
    // made with the replacement instead, scaled by bought ÷ planned so the piece gets its share.
    // Keyed by the shopping-list name — the mandi flower name the recipe resolves to.
    const floralLines = Array.isArray(sel?.deptOps?.Floral?.mandiLines) ? sel.deptOps.Floral.mandiLines : [];
    const eventSwap = buildEventSwap(floralLines);
    const placed = new Set();
    const fns = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
    // ── WHAT STANDS IN THE ZONE: truss, platform, carpet ──
    // Shown on each zone's own page, in the Tenting and the Structure books (owner ask) — the
    // classifier files truss/platform/carpet under Tenting, but the Structure crew builds on that
    // frame and floor too. It used to be a separate table at the back of the book; the crew reads
    // a zone page, so that is where it belongs.
    const showStruct = combined || dept === "Tenting" || dept === "Structure";
    // Which department an item belongs to, for the combined book: Deal Check's per-department
    // snapshot first (it is what each department actually holds), then the category classifier.
    const deptByInvId = new Map();
    if (combined) Object.entries(sel?.deptInventory || {}).forEach(([d, rows]) => (Array.isArray(rows) ? rows : []).forEach(r => { const id = r?.imsId || r?.invId; if (id && !deptByInvId.has(String(id))) deptByInvId.set(String(id), d); }));
    const carpetName = (id) => {
      if (!id) return "";
      const m = (Array.isArray(settings?.carpetMaterials) ? settings.carpetMaterials : []).find(x => x && x.id === id);
      return m?.name || String(id);
    };
    const trussTypeLbl = (t) => t === "box" ? "Box" : t === "singleU" ? "Single U" : (t ? String(t) : "");
    // "1ft-3ft" is a flat rate band, not one fixed height — hft (zc.plHft, Build's own "Exact ht"
    // picker) is the salesperson's actual stand height within that band, shown in parens so ops
    // knows exactly what to build rather than just "somewhere between 1 and 3 feet".
    const platLbl = (h, hft) => h === "4in" ? '4"' : h === "1ft" ? `Raised ${Number(hft) > 0 ? hft : 1}ft` : (h ? String(h) : "");
    const ftArea = (d) => [d?.L, d?.W].every(v => Number(v) > 0) ? `${d.L} x ${d.W} ft` : "";
    const printName = (id) => {
      if (!id) return "";
      const m = (Array.isArray(settings?.printMaterials) ? settings.printMaterials : []).find(x => x && x.id === id);
      return m?.name || String(id);
    };
    // Print jobs (Flex, Vinyl, Sunboard…) — Build's zoneConfig[zk].prints. They belong to the
    // Structure department (owner ask): Deal Check already files every print's cost and its held
    // row under Structure, and that crew gets them printed and put up. Printing them in every other
    // department's book as well told each crew a job was theirs that was not. The combined book
    // still shows them. A row with no size is an untouched blank.
    const printsHere = combined || dept === "Structure";
    // ── A PRINT JOB IS A CARD ON ITS OWN ZONE'S PAGE ──
    // It used to be a one-line chip in the structure strip ("Print Vinyl 9 x 3 ft"), which left
    // out what the crew needs to get it made and put up. Now each job is a card beside the zone's
    // items, pointing at the photo like they do: material, size, total area, how many, the item it
    // goes on (Build's "Link to an inventory item") and the artwork (its reference image, when the
    // row carries a real URL).
    const printCardsOf = (z) => {
      if (!printsHere) return [];
      return (Array.isArray(z?.prints) ? z.prints : []).filter(p => p && Number(p.areaW) > 0 && Number(p.areaD) > 0).map(p => {
        const w = Number(p.areaW), d = Number(p.areaD), q = Math.max(1, Math.round(Number(p.qty) || 1));
        const on = p.invId ? invById.get(String(p.invId)) : null;
        const ref = String(p.refImageUrl || "").trim();
        const area = Math.round(w * d * q * 100) / 100;
        return {
          name: "🖨 Print · " + (printName(p.material) || "—"), qty: q, unit: "pc",
          photo: /^https?:\/\//i.test(ref) ? ref : "", dims: `${w} x ${d} ft`, kit: 0, recipe: [],
          deptTag: combined ? "Structure" : "",
          extra: [["Area", `${area} sqft${q > 1 ? " total" : ""}`], ...(on ? [["On", on.name]] : [])],
        };
      });
    };
    const carpetDecided = (sel?.deptOps?.Tenting && sel.deptOps.Tenting.carpetChoice) || {};
    // ── THE CARPET THAT GOES DOWN, WITH ITS PHOTO ──
    // A card on the zone's own page (like a print job): the carpet the Tenting head decided in Planning, or — until it is decided —
    // the three sales ranked, 1st to 3rd, each with its photo, so the crew can see which carpet is meant. One per carpet floor.
    const carpetCardsOf = (z, fi, zk, fn) => {
      if (!showStruct || !z) return [];
      const out = [];
      [z, ...(Array.isArray(z.extraPlatformRows) ? z.extraPlatformRows : [])].forEach((row, ri) => {
        if (!row || row.cpT === CARPET_OFF) return;
        const prefs = prefsOf(row);
        const fd = row.floorDims || {};
        const area = Math.round(floorSqftOf(row));
        if (!(area > 0)) return; // a floor with no size has no carpet to lay
        // the decision counts only while it still belongs to this function (same date and type)
        const dec = validDecision(carpetDecided[carpetKey(fi, zk, ri)], { date: fn?.date, fnLabel: fn?.type || fn?.name });
        const qtyTxt = Math.max(1, Math.round(Number(row.plQty) || 1)) > 1 ? ` × ${Math.max(1, Math.round(Number(row.plQty) || 1))}` : "";
        const floorTxt = `${Number(fd.L) || Number(fd.S) || 0} x ${Number(fd.W) || Number(fd.S) || 0} ft${qtyTxt}`;
        if (dec?.other && !pdfAllCarpetsRef.current) {
          // none of the stock carpets could be used: the carpet is bought or hired outside stock
          out.push({ name: "Carpet arranged separately", qty: area, unit: "sqft", photo: "", dims: "", kit: 0, recipe: [], deptTag: combined ? "Tenting" : "",
            extra: [["Carpet", "To use" + (ri === 0 ? "" : ` (floor ${ri + 1})`)], ["Source", "Bought / hired outside stock"], ["Floor", floorTxt]] });
          return;
        }
        if (!prefs.length) return;
        // Deal Check's PDF lists all three sales picked; Planning's lists the decided one (all three until one is decided).
        const chosen = dec && !pdfAllCarpetsRef.current ? (prefs.find(p => p.id === dec.id) || (dec.manual ? { id: dec.id, name: dec.name } : null)) : null;
        const byHand = !!chosen && !prefs.some(p => p.id === chosen.id);
        const lbl = ri === 0 ? "" : ` (floor ${ri + 1})`;
        const RANK = ["1st", "2nd", "3rd", "4th"];
        (chosen ? [{ p: chosen, role: (byHand ? "To use (Planning's pick)" : "To use") + lbl }] : prefs.map((p, i) => ({ p, role: `${RANK[i] || i + 1 + "th"} choice${lbl}` }))).forEach(({ p, role }) => {
          const inv = invById.get(String(p.id));
          out.push({
            name: inv?.name || p.name || "Carpet", qty: area, unit: "sqft", photo: invPhoto(inv, null), dims: invDims(inv), kit: 0, recipe: [],
            deptTag: combined ? "Tenting" : "",
            extra: [["Carpet", role], ["Floor", floorTxt]],
          });
        });
      });
      return out;
    };
    const zoneStructOf = (z) => {
      if (!z) return [];
      if (!showStruct) return [];
      const floor = ftArea(z.floorDims);
      const extraTr = Array.isArray(z.extraTrussRows) ? z.extraTrussRows : [];
      const extraPl = Array.isArray(z.extraPlatformRows) ? z.extraPlatformRows : [];
      const out = [];
      // A truss only exists once it has a size — the same rule pricing uses (trussBaseArea; 0 sqft
      // bills ₹0). A zone keeps its truss TYPE (and a Truss Qty) after the dims are cleared, which
      // printed "Truss Single U" / "Truss x4" on zones that have no truss in Build. Extra rows count
      // only when they have a size too.
      const sizedExtra = extraTr.filter(r => (trussBaseArea(r || {}).area || 0) > 0 && r?.trussQty !== 0);
      const hasTruss = (trussBaseArea(z).area || 0) > 0 && z.trussQty !== 0;
      const truss = hasTruss ? [trussTypeLbl(z.trT), Number(z.trussQty) > 1 ? `x${z.trussQty}` : "", z.trussMaterial ? String(z.trussMaterial) : ""].filter(Boolean).join(" ") : "";
      if (truss) out.push({ k: "Truss", v: truss + (sizedExtra.length ? ` +${sizedExtra.length} more` : "") });
      else if (sizedExtra.length) out.push({ k: "Truss", v: `${sizedExtra.length} truss${sizedExtra.length === 1 ? "" : "es"}` });
      const plats = [
        z.plH ? [platLbl(z.plH, z.plHft), floor].filter(Boolean).join(" · ") : "",
        ...extraPl.map(r => [platLbl(r?.plH, r?.plHft), ftArea(r?.floorDims)].filter(Boolean).join(" · ")),
      ].filter(Boolean);
      if (plats.length) out.push({ k: "Platform", v: plats.join("; ") });
      if (z.cpT) out.push({ k: "Carpet", v: [carpetName(z.cpT), floor].filter(Boolean).join(" · ") });
      // Masking hangs on a truss — with no sized truss there is nothing to mask (and nothing billed).
      if (z.mkOn && (hasTruss || sizedExtra.length)) out.push({ k: "Masking", v: "Yes" });
      if (!z.plH && !z.cpT && floor) out.push({ k: "Floor", v: floor });
      return out;
    };
    fns.forEach((fn, fi) => {
      const els = fn?.elements || {};
      // ── EVERY ZONE OF THE EVENT, NOT ONLY THE ONES THIS DEPARTMENT FILLS ──
      // A zone is described in three places and none of them is complete on its own: the element
      // lists, the zone config (dims, truss) and the chosen reference photos — a zone can easily
      // have a photo picked and no elements yet. Walking only the element lists dropped those,
      // and dropped every zone whose elements all belong to OTHER departments, which on a Floral
      // book is most of the bar, the food stalls and the centrepieces. The crew sets up alongside
      // everyone else, so those zones belong in the book too — as the reference photo, at least.
      const zoneKeysFound = [...new Set([...Object.keys(els), ...Object.keys(fn?.zones || {}), ...Object.keys(fn?.elSelectedPhoto || {})])];
      // ── THE ORDER THE BUILD PAGE SHOWS ──
      // Same rule as Studio's Build / Summary: a hand-dragged order (zoneOrder) first, in the sequence it
      // was dragged; then Admin → Zone Types' order; then the deal's own custom zones in the order they
      // were added; anything unknown last, in the order found. (Before this the zones came out in
      // whatever order their keys happened to be stored in.)
      const zoneKeys = orderZoneKeys(zoneKeysFound, {
        adminOrder: zoneAdminOrderRef.current || Object.keys(ZONE_META),
        customKeys: Object.keys(fn?.zoneNames || {}),
        dragged: Array.isArray(fn?.zoneOrder) ? fn.zoneOrder : [],
      });
      zoneKeys.forEach(zk => {
        if (fn.enabledEls && fn.enabledEls[zk] === false) return;
        const merged = new Map();
        (Array.isArray(els[zk]) ? els[zk] : []).forEach((el, ei) => {
          const id = el?.invId || el?.imsId;
          const nm = String(el?.name || "").trim().toLowerCase();
          const inv = (id && invById.get(String(id))) || invByName.get(nm) || null;
          const invNm = String(inv?.name || "").trim().toLowerCase();
          const held = (inv && heldByInv.get(String(inv.id))) || (invNm && heldByName.get(invNm)) || heldByName.get(nm) || null;
          // ── WHICH DEPARTMENT AN ITEM IS ON ──
          // Deal Check's own split is the authority: an item is this department's if this
          // department's Deal Check snapshot holds it. The inventory category is only a fallback
          // for an event never run through Deal Check — the two disagree often enough (Wooden
          // Console is Floral in Deal Check but categorised as Furniture) that the category alone
          // put items on the wrong department's PDF and left Floral's empty.
          // Flower arrangements (patterns) are not inventory at all; they go on the Floral sheet.
          const isPattern = !inv && !!el?.patternId;
          // ── A KIT'S PARTS ARE PLACED WHERE THE KIT IS ──
          // When this department holds parts of the kit named here, they belong on THIS zone's
          // page: they are bolted to something already standing in it. Reporting them as "not in
          // a zone" was worse than useless — it sent someone hunting for a loose item already on
          // the truck inside something else — but merely hiding them (what this did until now)
          // dropped them out of the book altogether, which is worse again.
          // Combined book: a kit is shown as the kit itself, never broken into one department's parts.
          const kitParts = (!combined && nm) ? (partsByKit.get(nm) || []) : [];
          const mine = combined ? true
            : held ? true
            : kitParts.length ? true
            : isPattern ? dept === "Floral"
            : hasDeptSnapshot ? false
            : inv ? catToDept(inv.category || inv.cat) === dept : false;
          if (!mine) return;
          const kitLabel = String(inv?.name || el?.name || "").trim() || "kit";
          kitParts.forEach(p => {
            if (placed.has(p.id)) return; // one physical part, on the first zone that claims it
            placed.add(p.id);
            const pInv = (p.invId && invById.get(String(p.invId))) || invByName.get(String(p.name || "").trim().toLowerCase()) || null;
            merged.set("p:" + p.id, { name: p.name, qty: Number(p.qty) || 0, unit: String(pInv?.unit || p?.unit || "").trim(), photo: invPhoto(pInv, p), dims: invDims(pInv), source: "Inside " + kitLabel });
          });
          // Only the parts are ours — the kit shell itself sits on another department's sheet.
          if (!held && kitParts.length) return;
          if (held) placed.add(held.id);
          // ── OVERLAYS AND CUSHION COVERS WITH CHOICES ──
          // Planning decides one of sales' designs (or arranges the pieces outside stock). The card shows that design — its own photo and
          // size — and until it is decided the choices are listed under the 1st. Deal Check's PDF (pdfAllCarpetsRef) lists what sales asked for.
          const prow = elementPlanOf().rows.find(r => r.fi === (fn?.fnIdx ?? fi) && r.zk === zk && r.ei === ei) || null;
          let invU = inv, arranged = false, choiceExtra = null, decName = "";
          if (prow) {
            const names = prow.options.map((o, i) => `${i + 1} ${String(o.name || "").length > 16 ? String(o.name).slice(0, 15) + "…" : o.name}`).join(" · ");
            if (prow.other) { arranged = true; choiceExtra = [["Source", "Bought / hired / made outside stock"]]; }
            else if (prow.decidedId) {
              const di = invById.get(String(prow.decidedId));
              if (di) invU = di; else { invU = null; decName = ([...prow.options, prow.manual].filter(Boolean).find(o => o.id === prow.decidedId) || {}).name || ""; }
              choiceExtra = [["Design", "Chosen in Planning"]];
            } else choiceExtra = [["Choices", names + " (not decided)"]];
          }
          // Deal Check's PDF lists what sales asked for: every design, 1st to 4th, each as its own card with its photo (like the carpets).
          if (prow && pdfAllCarpetsRef.current) {
            const RANKS = ["1st", "2nd", "3rd", "4th"];
            prow.options.forEach((o, i) => {
              const ci = invById.get(String(o.id));
              merged.set(`c:${el?.pid || ei}:${i}`, { name: ci?.name || o.name || "Design", qty: Number(el?.qty) || 1, unit: String(el?.unit || ci?.unit || "").trim(),
                deptTag: combined ? (deptByInvId.get(String(o.id)) || catToDept(ci?.category || ci?.cat)) : "", photo: invPhoto(ci, null), dims: invDims(ci), size: "", kit: 0, recipe: [],
                extra: [["Choice", `${RANKS[i] || i + 1 + "th"} choice`]] });
            });
            return;
          }
          // ── S / M / B ──
          // Florals (and some lighting) are quoted at a size, not just a count: the same
          // arrangement is a different build at Small than at Big, and `el.size` is where the
          // salesperson's choice lives. It is only ever set where it applies — 118 of 693 live
          // zone elements carry one, always S, M or B — so an item without one simply has none.
          // It joins the merge key because two sizes of one item are two different things to
          // make: merged on name alone they collapsed into a single card with the quantities
          // added, which is the one thing a crew must not read.
          // An UNSET size is not "no size": Studio's Build row highlights B for a floral recipe
          // (and M for anything else with sizes) without ever writing it, so `size` stays ""
          // while the salesperson sees B selected — and Deal Check prices it at B too, via
          // `normalizeSizeClass(el.size || "B")`. Printing nothing there contradicted both the
          // screen and the quote. A recipe element therefore falls back to the same B the price
          // was built on; anything else is left blank, because without the rate card IMS cannot
          // tell an unsized item from an unset one, and a wrong size is worse than none.
          const rawSize = String(el?.size || "").trim().toUpperCase();
          const elSize = SMB_LABEL[rawSize] || (!rawSize && el?.patternId ? SMB_LABEL.B : "");
          const key = (arranged ? "o:" + (el?.pid || ei) : invU ? "i:" + invU.id : "n:" + (decName || nm)) + (elSize ? "|" + elSize : "");
          const prev = merged.get(key);
          const qty = Number(el?.qty) || 1;
          // Paint the build asked for on this item, carried on its own card so the item's
          // department paints it — summed across the zone's rows of the same item.
          const paint = elPaint(el, inv);
          if (prev) { prev.qty += qty; addPaint(prev.paint, paint); return; }
          // The unit the qty is counted in (kg, ft, nos…). "75" alone does not say whether it is 75
          // pieces or 75 kg of petals. The element's own unit first — it is what the quote priced —
          // then the inventory item's, then the held row's.
          // A flower recipe with no unit stored falls back to "pc" — the same default Studio gives a
          // recipe element when it is added (recipeOnlyPatterns in StudioApp.jsx).
          const unit = String(el?.unit || inv?.unit || held?.unit || (isPattern ? "pc" : "")).trim();
          const deptTag = !combined ? "" : isPattern ? "Floral" : invU ? (deptByInvId.get(String(invU.id)) || catToDept(invU.category || invU.cat)) : "";
          // ── WHAT GOES INTO A FLORAL ARRANGEMENT ──
          // A "Flower Reet" is a recipe of several flowers; the crew needs those, not just the
          // count. Recipe found the way Studio prices it — the element's own patternId, else the
          // inventory item's sub-category (matchFlowerPattern) — at the same size, B when unset.
          // Kept PER UNIT; the card multiplies by the zone's summed qty. The full recipe amount,
          // not the real/artificial split: that is how much goes into the piece.
          const pat = (el?.patternId && flowerPatterns.find(fp => fp?.id === el.patternId)) || (inv && matchFlowerPattern(inv, flowerPatterns)) || null;
          const sizeData = pat?.sizes?.[resolveSizeKey(pat.sizes, sizeClassToPatternKey(rawSize || "B"))];
          const recipe = (sizeData?.flowers || []).map(fl => {
            if (fl?.invItemId) { const ing = invById.get(String(fl.invItemId)); return ing ? { name: ing.name, qty: Number(fl.qty) || 0, unit: ing.unit || "" } : null; }
            const mf = resolveMandiFlower(fl?.flowerId, mandiCatalogue)?.parent;
            if (!mf) return null;
            const baseQty = Number(fl.qty) || 0;
            // This event's own mandi swap, made on the Floral shopping list (eventSwap above): the
            // piece is made with the replacement, in its units. Only the replacement is named — the crew makes the piece with
            // what was bought; the flower it stands in for is on the Mandi list, not here.
            const swapped = swappedRecipeFlower(eventSwap, mf.name, baseQty);
            if (swapped) return swapped;
            return { name: mf.name, qty: baseQty, unit: mf.unit || "" };
          }).filter(f => f && f.qty > 0);
          merged.set(key, { name: arranged ? `${el?.name || inv?.name || "Item"} — arranged separately` : (invU?.name || decName || el?.name || held?.name || "Item"), qty, unit, deptTag, photo: arranged ? "" : invPhoto(invU, invU === inv ? held : null), dims: arranged ? "" : invDims(invU), extra: choiceExtra || undefined, size: elSize, kit: held?.isKit ? (Array.isArray(held.components) ? held.components.length : 0) + (Array.isArray(held.recipeParts) ? held.recipeParts.length : 0) : 0, recipe, paint: addPaint(new Map(), paint) });
        });
        const items = [...merged.values()];
        const zPhoto = fn.elSelectedPhoto?.[zk]?.src || "";
        const zDims = zoneDimsText(fn.dims?.[zk] || fn.zones?.[zk]?.dims);
        // ── WHOSE DIMENSIONS ARE THESE? ──
        // The chip used to say "Zone", which names where the figures apply, not what they
        // measure. A zone's L x W x H is the span of the STRUCTURE standing in it: across every
        // event on record, all 44 zones carrying dimensions also carry a truss type, and the
        // floor is held separately in floorDims. So the chip names the truss, falling back to
        // the platform and then to the zone itself for a shape that has neither.
        // The short word is deliberate: this chip is nowrap and shares the header with a 38px
        // zone title, and "Single U Truss" there costs enough width to wrap the title onto a
        // second line. The truss TYPE is spelled out in the structure strip under the zone header.
        const zCfg = fn?.zones?.[zk] || {};
        const zDimsOf = (zCfg.trT || Number(zCfg.trussQty) > 0) ? "Truss"
          : Number(zCfg.plH) > 0 ? "Platform"
          : "Zone";
        // The only zone still worth skipping is one with nothing to put on the page at all: none
        // of our items, no reference photo and no dimensions. That page would be a heading.
        const zStruct = zoneStructOf(zCfg);
        // First, not last: a zone with more than six items splits across pages, and a print
        // appended at the end landed on the zone's second page, away from the one the crew opens.
        items.unshift(...printCardsOf(zCfg), ...carpetCardsOf(zCfg, fn?.fnIdx ?? fi, zk, fn));
        if (!items.length && !zPhoto && !zDims && !zStruct.length) return;
        zonePages.push({
          zk,
          fi,
          fnType: fn.type || `Function ${fi + 1}`,
          fnDate: fn.date || "",
          title: zoneName(zk, fn),
          fnLabel: [fn.type || (fns.length > 1 ? `Function ${fi + 1}` : ""), fn.date].filter(Boolean).join(" · "),
          photo: zPhoto,
          zoneDims: zDims,
          dimsOf: zDimsOf,
          struct: zStruct,
          items,
        });
      });
    });
    // A kit's parts are marked placed by the zone loop above, on the page of the zone their
    // parent stands in. An earlier version instead matched part -> parent by name down here and
    // dropped the match from the loose list; since the parent kit belongs to another department
    // it never appeared on a zone page either, so the part vanished from the book entirely.
    /* ── TENTING, BROKEN DOWN BY ZONE ──
       Tenting's held rows are whole-event totals with no zone on them at all — the Deal Check
       rollup adds every zone's truss together and keeps only "Truss pillar 12ft x6", so there is
       nothing in the item list to attribute. A tenting crew cannot work from that: six pillars
       are useless until you know which structure they belong to.
       The zone CONFIG does survive the sync, though, and it is the part that matters here —
       each zone's span, truss type and material, extra rows, floor area and masking. So this
       table is built from the zones rather than from the items: what to build, zone by zone,
       with the item list left as the loading total it actually is. */
    /* ── THE TRUCKS THIS DEPARTMENT FILLS ──
       Deal Check sizes a booking's transport by filling trucks sub-category by sub-category
       ("Chandelier: 40 pcs, 30 to a truck"), and its Transport tab groups those rows by
       department on screen. That grouping was never written down, so the only transport figure
       reaching IMS was the whole truck cost filed to the Transport department — every other
       book showed transport as zero. transportPlan carries the same grouping, classified the
       same way, so a department can now state its own share: what it sends and how much of a
       truck that fills. Buffer trucks are a booking-wide allowance rather than anyone's load,
       so they stay in their own group and out of this table.
       Absent on any order last synced before this shipped — the section simply does not print
       until Deal Check pushes the department breakdown again. */
    const trPlan = sel?.transportPlan || null;
    const trMine = trPlan?.byDept?.[dept] || null;
    // Transport stays a per-department-only section — not in the combined book (owner call).
    const trRows = (trMine?.rows || []).map(r =>
      `<tr><td><b>${esc(r.label)}</b>${(fns || []).length > 1 && r.fn ? `<div class="sub">${esc(r.fn)}</div>` : ""}</td><td class="n">${esc(r.qty)}${r.unit ? " " + esc(r.unit) : ""}</td><td class="n">${Number(r.perTruck) > 0 ? esc(r.perTruck) + (r.unit ? " " + esc(r.unit) : "") + " per truck" : "—"}</td><td class="n b">${Number(r.flat) > 0 ? "₹" + esc(Math.round(r.flat).toLocaleString("en-IN")) + " flat" : esc(r.trucks)}</td></tr>`);
    const trNote = !trMine ? "" : `${esc(dept)} fills ${trMine.trucks} of the ${trPlan.totalTrucks} truck${trPlan.totalTrucks === 1 ? "" : "s"} this event needs${trPlan.tierLabel ? ` · ${esc(trPlan.tierLabel)}` : ""}. A truck is counted by capacity, so a part-truck share is normal — the loads travel together.`;

    // Deal Check's one "🖨 Print / signage" row says only how many jobs there are; it is replaced
    // below by one card per job, read from the build.
    const unplaced = blockedItemsGrouped.filter(b => !placed.has(b.id) && b.sub !== "print").map(b => {
      const inv = (b.invId && invById.get(String(b.invId))) || invByName.get(String(b.name || "").trim().toLowerCase()) || null;
      const kitOf = String(b.fromKit || "").trim();
      return { name: b.name, qty: Number(b.qty) || 0, photo: invPhoto(inv, b), dims: invDims(inv), prodOrBuy: b.prodOrBuy || null, kit: b.isKit ? (Array.isArray(b.components) ? b.components.length : 0) + (Array.isArray(b.recipeParts) ? b.recipeParts.length : 0) : 0, source: b.prodOrBuy === "buying" ? "Buying" : b.prodOrBuy === "production" ? "Production" : kitOf ? "Inside " + kitOf : "" };
    });
    // ── TWO PAGES, AND WHY THEY STAY TWO ──
    // Briefly merged into one "From production" page, which was wrong: on pratik test's 29 Aug
    // event the Floral department holds ten items, eight of which the zone lists claim. The two
    // that are left — "Muradabad Metal Prop " and "S shape Iron Btr Frame " — carry no prodOrBuy
    // at all, so calling their page "From production" told the crew to collect from a production
    // house that was never making them.
    // Not in a zone is a DIFFERENT fact from made by production, and only Deal Check knows the
    // second one. An item landing in the second bucket usually means the Studio build placed it
    // after the last Deal Check sync, so the right response is to go look at the build — which is
    // what the page now says, instead of the silent "Other items" that started all this.
    const prodItems = unplaced.filter(it => it.prodOrBuy === "production");
    // Print jobs are not here: each is a card on its own zone's page (printCardsOf).
    const buyItems = unplaced.filter(it => it.prodOrBuy === "buying");
    const looseItems = unplaced.filter(it => it.prodOrBuy !== "production" && it.prodOrBuy !== "buying");
    // ── DATE THE ZONE PLAN, DO NOT JUST ASSERT THE ITEM IS LOOSE ──
    // An item lands here for one of two reasons that look identical on the page: it really is an
    // extra nobody put in a zone, or IMS's copy of the zone lists is simply older than the held
    // list. Until 2026-09-25 the zone lists were written only at Sold while deptInventory was
    // refreshed on every sync, so the second reason was routine — and any order last synced
    // before that date still carries the stale lists. Printing the sync date lets whoever reads
    // the book tell the two apart instead of trusting a claim the data cannot actually support.
    const syncedOn = sel?.deptSyncedAt
      ? new Date(sel.deptSyncedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "";
    const looseNote = syncedOn
      ? `Held for this event, but no zone lists these. The zone plan here was last synced from Deal Check on ${syncedOn} — re-sync if they belong in a zone.`
      : "Held for this event, but no zone lists these — re-sync Deal Check if they belong in a zone.";

    // Geometry, in the sheet's 706px content width. Cards sit four to a row: top row, the photo
    // band, bottom row. Each card's arrow drops straight onto the photo edge below / above it.
    // A4's usable area is ~1.46× taller than it is wide, so at this 706px column a full page is
    // ~1020px. The stage is sized to fill it: the photo takes whatever height the card rows leave,
    // so a zone with four items gets a large photo instead of a small one and half a blank page.
    // HEAD_PX covers the section's own padding plus the header card (eyebrow, title, ornament,
    // date) and the gap under it — so header + card rows + photo add up to exactly one page.
    const CARD_W = 224, COL_GAP = 17, ROW_H = 300, ARROW = 40, PAGE_PX = 1020, HEAD_PX = 186;
    const colX = (i, n) => { const span = n * CARD_W + (n - 1) * COL_GAP; return (706 - span) / 2 + i * (CARD_W + COL_GAP); };
    // No photo → no empty "No photo" box, just the details (owner ask). The card then sizes to its
    // text (np); nb makes room at the top for the size/kit tags the photo used to sit under.
    const npCls = (it) => it.photo ? "" : (it.size || it.kit ? " np nb" : " np");
    // A recipe card used to list its own flowers inline, up to 5 lines — "Flower Trail" (7+
    // flowers) always ran out of room and showed a bare "+3 more" with nowhere to actually see
    // them. Every recipe's FULL ingredient list now lives on its own dedicated page (recipePages
    // below); the card just points there, one line, regardless of how many flowers are in it.
    // The flowers themselves get a card of their own next to the item (flowerCard below, slotted in
    // by withFlowerCards) — names only, so the crew sees what goes in without turning the page;
    // quantities stay on the recipe page.
    const flowerRows = () => "";
    const FL_MAX = 8;
    const flowerCard = (it) => {
      const names = (it.recipe || []).map(f => String(f.name || "").trim()).filter(Boolean);
      const shown = names.length > FL_MAX ? names.slice(0, FL_MAX - 1) : names;
      return `<div class="zc-b">
        <div class="zc-n">🌸 Flowers<div class="zc-fs">${esc(it.name)}</div></div>
        ${shown.map(n => `<div class="zc-r f"><span>• ${esc(n)}</span><b></b></div>`).join("")}
        ${names.length > shown.length ? `<div class="zc-r f"><span>+${names.length - shown.length} more</span><b></b></div>` : ""}
        <div class="zc-r f"><span>📖 Qty: Mandi &amp; Kits page</span><b></b></div>
      </div>`;
    };
    // Each recipe item followed by its flower card, for laying out a zone page's card slots.
    const withFlowerCards = (items) => items.flatMap(it => (it.recipe || []).length ? [it, { flowerCard: true, name: it.name, recipe: it.recipe }] : [it]);
    // The paint line takes its 20px out of the photo.
    const flLines = (it) => (it.paint?.size ? 1 : 0) + (it.extra || []).length;
    const card = (it, zone, num) => `
      ${it.photo ? `<div class="zc-ph" style="${bgCss(it.photo, 180)}${flLines(it) ? `height:${168 - flLines(it) * 20}px` : ""}" ${bgData(it.photo, 180)}></div>` : ""}
      ${num ? `<div class="zc-no">${num}</div>` : ""}
      ${it.kit ? `<div class="zc-kt">KIT · ${esc(it.kit)}</div>` : ""}
      ${it.size ? `<div class="zc-sz">${esc(it.size)}</div>` : ""}
      <div class="zc-b">
        <div class="zc-n">${esc(it.name)}</div>
        <div class="zc-r"><span>Qty</span><b>${esc(it.qty)}${it.unit ? ` <span style="font-weight:500;font-size:.85em;opacity:.7">${esc(it.unit)}</span>` : ""}</b></div>
        <div class="zc-r"><span>Size</span><b>${esc(it.dims || "—")}</b></div>
        ${it.source ? `<div class="zc-r"><span>From</span><b>${esc(it.source)}</b></div>` : it.deptTag ? `<div class="zc-r"><span>Dept</span><b>${esc(it.deptTag)}</b></div>` : ""}
        ${it.paint?.size ? `<div class="zc-r"><span>Paint</span><b>${esc(paintText(it.paint))}</b></div>` : ""}
        ${(it.extra || []).map(([k, v]) => `<div class="zc-r"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
        ${flowerRows(it)}
      </div>`;
    // The header's count. The truss / platform / carpet / masking in the strip are Tenting's own
    // work (the classifier files them there), so in the Tenting and combined books they count —
    // a zone with only those printed "No Tenting items" right above four of them. In the
    // Structure book the strip is reference (Tenting's frame they build on), so it isn't counted.
    const zoneCountText = (pg) => {
      const n = pg.items.length + (combined || dept === "Tenting" ? (pg.struct || []).length : 0);
      return n ? `${n} item${n === 1 ? "" : "s"}` : (combined ? "No items" : `No ${esc(dept)} items`);
    };
    const zoneSection = (pg, chunk, part, parts, zoneNo, offset) => {
      // A zone this department has nothing in still gets its page — the reference photo, run the
      // full height of the sheet, so the crew can see the setup they are working alongside.
      // Without this the geometry below would reserve a 340px card row and print a blank band.
      const bare = !chunk.length;
      const top = chunk.slice(0, 3), bot = chunk.slice(3, 6);
      const rows = bot.length ? 2 : 1;
      // The structure strip under the header takes its height out of the photo, so the page still
      // adds up to exactly one sheet.
      const headPx = HEAD_PX + ((pg.struct || []).length ? 44 : 0);
      const PHOTO_H = bare ? PAGE_PX - headPx : Math.max(260, PAGE_PX - headPx - rows * (ROW_H + ARROW));
      const photoTop = bare ? 0 : ROW_H + ARROW;
      const botTop = photoTop + PHOTO_H + ARROW;
      const stageH = bare ? PHOTO_H : bot.length ? botTop + ROW_H : photoTop + PHOTO_H;
      // No item numbers (removed by request) — each card's arrow alone ties it to the photo.
      // A top-row card without a photo is shorter, so it is pinned by its BOTTOM to keep sitting on its arrow.
      const cards = [
        ...top.map((it, i) => { const x = colX(i, top.length); return `<div class="zc${npCls(it)}" style="left:${x}px;${it.photo ? "top:0" : `bottom:${stageH - ROW_H}px`}">${it.flowerCard ? flowerCard(it) : card(it, pg.title)}</div>
          <div class="za down" style="left:${x + CARD_W / 2 - 1}px;top:${ROW_H}px;height:${ARROW}px"></div>`; }),
        ...bot.map((it, i) => { const x = colX(i, bot.length); return `<div class="zc${npCls(it)}" style="left:${x}px;top:${botTop}px">${it.flowerCard ? flowerCard(it) : card(it, pg.title)}</div>
          <div class="za up" style="left:${x + CARD_W / 2 - 1}px;top:${photoTop + PHOTO_H}px;height:${ARROW}px"></div>`; }),
      ].join("");
      return `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
        <div class="zh">
          <div><div class="zk"><b>Zone ${String(zoneNo).padStart(2, "0")}</b>${parts > 1 ? ` · Part ${part} of ${parts}` : ""}</div><h2>${esc(pg.title)}</h2>
            <div class="orn l"><i></i><b></b><i></i></div>
            <div class="zm">${esc(pg.fnLabel || selDateStr || "")}</div></div>
          <div class="zt">${pg.zoneDims ? `<span><i class="zl">${esc(pg.dimsOf)}</i>${esc(pg.zoneDims)}</span>` : ""}<span>${zoneCountText(pg)}</span></div>
        </div>
        ${(pg.struct || []).length ? `<div class="zst">${pg.struct.map(c => `<span><i class="zl">${esc(c.k)}</i>${esc(c.v)}</span>`).join("")}</div>` : ""}
        <div class="zs" style="height:${stageH}px">
          <div class="zphoto" style="top:${photoTop}px;height:${PHOTO_H}px;${bgCss(pg.photo)}" ${bgData(pg.photo)}>${pg.photo ? "" : "<span>No zone photo</span>"}</div>
          ${cards}
        </div>
      </section>`;
    };
    const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
    // A plain grid page (no zone photo) for a list of items — used for production items and for
    // anything not placed in a zone.
    const listPages = (items, eyebrow, title, note) => items.length ? chunks(items, 9).map((c, i, all) => `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
        <div class="zh"><div><div class="zk"><b>${esc(eyebrow)}</b>${all.length > 1 ? ` · Part ${i + 1} of ${all.length}` : ""}</div><h2>${esc(title)}</h2>
          <div class="orn l"><i></i><b></b><i></i></div>
          <div class="zm">${esc(note)}</div></div>
          <div class="zt"><span>${items.length} item${items.length === 1 ? "" : "s"}</span></div></div>
        <div class="zg">${c.map(it => `<div class="zc st${npCls(it)}">${card(it, "")}</div>`).join("")}</div>
      </section>`) : [];
    /* ── WHAT IS INSIDE EVERY KIT ──
       A kit travels as ONE line everywhere else in this book: one card on its zone page, one row
       in the inventory table. That is right for costing and useless for loading — Floral is
       almost entirely kits (a console runs 4-7 parts), so on a typical event fifteen to twenty
       real props — the pots, candles, lamps and glass the crew actually carries — were named
       nowhere a crew member would look. This page names each one, with a box to tick, so a kit
       can be checked off part by part before it leaves the godown.
       Two sources: kits this department holds outright (their `components`), and kits owned by
       another department that this one holds parts of (`partsByKit`). */
    // ── WHERE EACH KIT STANDS ──
    // Built from every function's zone lists rather than from this department's own items: a kit
    // whose shell belongs to another department still has to be found and built, and its zone is
    // only ever named there. A kit used in two zones lists both.
    // How far in it goes is not recorded anywhere — the zone is as precise as the data gets, so
    // the page says the zone and leaves the spot to the reference photo on that zone's page.
    const zonesByName = new Map();
    // How many of each the zone lists call for — the only count there is for a kit another
    // department holds, since this department's sheet carries just its parts.
    const zoneQtyByName = new Map();
    (fns || []).forEach(fn => Object.entries(fn?.elements || {}).forEach(([zk, list]) => {
      if (fn.enabledEls && fn.enabledEls[zk] === false) return;
      (Array.isArray(list) ? list : []).forEach(el => {
        const n = String(el?.name || "").trim().toLowerCase();
        if (!n) return;
        if (!zonesByName.has(n)) zonesByName.set(n, new Set());
        zonesByName.get(n).add(zoneName(zk, fn));
        zoneQtyByName.set(n, (zoneQtyByName.get(n) || 0) + (Number(el?.qty) || 1));
      });
    }));
    const zonesFor = (nm) => [...(zonesByName.get(String(nm || "").trim().toLowerCase()) || [])];
    const zoneQtyFor = (nm) => zoneQtyByName.get(String(nm || "").trim().toLowerCase()) || 0;

    const kitBlocks = [];
    kitSourceItems.forEach(it => {
      const hasRecipeParts = Array.isArray(it.recipeParts) && it.recipeParts.length > 0;
      if (it.isKit && ((Array.isArray(it.components) && it.components.length) || hasRecipeParts)) {
        const kInv = (it.invId && invById.get(String(it.invId))) || invByName.get(String(it.name || "").trim().toLowerCase()) || null;
        // The held quantity is the kit's own count; the parts under it are already totals for all of them.
        // Each part carries its own photo (its inventory item's, else the one Deal Check sent) so the
        // kit's parts list shows what each piece looks like, not just its name.
        kitBlocks.push({ name: it.name, ours: true, qty: Number(it.qty) || zoneQtyFor(it.name), photo: invPhoto(kInv, it), zones: zonesFor(it.name), parts: [...(Array.isArray(it.components) ? it.components : []).map(c => ({ name: c.name, qty: c.qty, photo: invPhoto(c.imsId ? invById.get(String(c.imsId)) : null, c) })),
          // The flower recipes inside the kit (not inventory, so not components): name and quantity, in the recipe's own unit.
          ...(hasRecipeParts ? it.recipeParts : []).map(r => ({ name: r.name, qty: r.qty, unit: r.uom || "", photo: r.photo || "" }))] });
      }
    });
    [...partsByKit.values()].forEach(parts => {
      const label = String(parts[0]?.fromKit || "").trim();
      if (!label || kitBlocks.some(k => String(k.name).trim().toLowerCase() === label.toLowerCase())) return;
      kitBlocks.push({ name: label, ours: false, qty: zoneQtyFor(label), photo: invPhoto(invByName.get(label.toLowerCase()) || null, null), zones: zonesFor(label), parts: parts.map(p => ({ name: p.name, qty: p.qty, photo: invPhoto(p.invId ? invById.get(String(p.invId)) : null, p) })) });
    });
    // kitBlocks (name → full parts list, "ours"/zones) now only feeds zoneDetailPages' lookup
    // below (kitBlocksByName) — it no longer builds a standalone "What is inside each kit" page of
    // its own; that content now prints on each kit's own zone's page instead.

    // ── RECIPE AND KIT DETAILS, ON THEIR OWN ZONE'S PAGES ──
    // Both used to live on one global reference page at the end of the book — easier to build, but
    // it separated a zone's own recipe/kit detail from the zone itself (owner ask: keep them
    // together, one details page right after that zone's own cards, not a single combined page for
    // the whole book). kitBlocksByName still needs the full parts list kitBlocks already computed
    // (by name — a zone-card item only ever carries a component COUNT, not the parts themselves).
    const kitBlocksByName = new Map(kitBlocks.map(k => [String(k.name || "").trim().toLowerCase(), k]));
    const detailCols = (parts) => (parts.length >= 4 ? 2 : 1);
    const detailLongNames = (parts, cols) => { const per = cols === 2 ? 44 : 100; return parts.filter(p => String(p.name || "").trim().length > per).length; };
    const detailH = (parts) => { const cols = detailCols(parts); return 68 + (Math.ceil(parts.length / cols) + Math.ceil(detailLongNames(parts, cols) / cols)) * 24 + 14; };
    const detailCard = (icon, name, qty, unit, parts) => { const cols = detailCols(parts); return `<div class="kb">
      <div class="kb-h">
        <div class="kb-t"><div class="kb-nm">${icon} ${esc(name)}</div></div>
        ${qty ? `<div class="kb-z kb-q"><div class="kb-zk">Qty</div><div class="kb-zv">${esc(qty)}${unit ? " " + esc(unit) : ""}</div></div>` : ""}
      </div>
      <ul class="kb-l${cols === 1 ? " one" : ""}">${parts.map(p => `<li><i class="kb-x"></i>${p.photo ? `<i class="kb-p" style="${bgCss(p.photo, 40)}" ${bgData(p.photo, 40)}></i>` : ""}<span>${esc(p.name)}</span><i class="kb-d"></i><b>${esc(p.qty)}${p.unit ? ` ${esc(p.unit)}` : ""}</b></li>`).join("")}</ul>
    </div>`; };
    // One page (or more, if a zone's own recipes+kits don't fit one sheet) per zone, built right
    // after that zone's card pages in the loop below — never bundled with any OTHER zone's.
    const zoneDetailPages = (pg) => {
      const blocks = [];
      (pg.items || []).forEach(it => {
        if (Array.isArray(it.recipe) && it.recipe.length) {
          const parts = it.recipe.map(f => ({ name: f.name, qty: Math.round((Number(f.qty) || 0) * (Number(it.qty) || 0) * 100) / 100, unit: f.unit }));
          blocks.push({ h: detailH(parts), html: detailCard("🌸", it.name, it.qty, it.unit, parts) });
        }
        if (it.kit > 0) {
          const kb = kitBlocksByName.get(String(it.name || "").trim().toLowerCase());
          if (kb) blocks.push({ h: detailH(kb.parts), html: detailCard("📦", it.name, kb.qty, "", kb.parts) });
        }
      });
      if (!blocks.length) return [];
      const dChunks = [];
      blocks.forEach(b => {
        const last = dChunks[dChunks.length - 1];
        if (!last || last.h + b.h > PAGE_PX - HEAD_PX) dChunks.push({ h: b.h, list: [b] });
        else { last.h += b.h; last.list.push(b); }
      });
      return dChunks.map((pgk, i, all) => `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
          <div class="zh"><div><div class="zk"><b>Mandi &amp; Kits</b>${all.length > 1 ? ` · Part ${i + 1} of ${all.length}` : ""}</div><h2>${esc(pg.title)}</h2>
            <div class="orn l"><i></i><b></b><i></i></div>
            <div class="zm">${pg.fnLabel ? esc(pg.fnLabel) + " — " : ""}Full flower list for each recipe and full parts list for each kit in this zone</div></div></div>
          ${pgk.list.map(b => b.html).join("")}
        </section>`);
    };

    // ── A BREAK PAGE BETWEEN FUNCTIONS ──
    // On a multi-function event this book used to run straight from one function's last zone into
    // the next function's first with nothing marking the seam — easy to miss where "Haldi" ends and
    // "Wedding" begins. One plain divider page per function, inserted the first time its zones
    // start, names which function the pages after it belong to.
    const fnDivider = (no, type, date) => `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
        <div class="zh" style="text-align:center;padding:${Math.max(40, Math.round((PAGE_PX - 170) / 2))}px 14px 10px">
          <div class="zk">Function ${no}</div>
          <h2 style="font-size:52px">${esc(type || `Function ${no}`)}</h2>
          <div class="orn l" style="justify-content:center"><i></i><b></b><i></i></div>
          ${date ? `<div class="zm">${esc(date)}</div>` : ""}
        </div>
      </section>`;
    const multiFn = (fns || []).length > 1;
    const zonePageHtml = [];
    let lastFi = null;
    zonePages.forEach((pg, zi) => {
      if (multiFn && pg.fi !== lastFi) {
        lastFi = pg.fi;
        zonePageHtml.push(fnDivider(pg.fi + 1, pg.fnType, pg.fnDate));
      }
      const cs = pg.items.length ? chunks(withFlowerCards(pg.items), 6) : [[]];
      cs.forEach((c, i) => zonePageHtml.push(zoneSection(pg, c, i + 1, cs.length, zi + 1, i * 6)));
      // Right after THIS zone's own card page(s) — a zone's recipe/kit detail never shares a page
      // with another zone's, and never lands in a single combined reference page at the book's end.
      zonePageHtml.push(...zoneDetailPages(pg));
    });
    const zoneHtml = [
      ...zonePageHtml,
      ...(combined ? [] : [
      ...listPages(prodItems, "Production", "From production", "Made by the production team for this event"),
      ...listPages(buyItems, "Buying", "To buy", "Bought in for this event — not from our own stock"),
      ...listPages(looseItems, "Not in a zone", "Also on site", looseNote),
      ]),
    ].join("");

    // The cover's backdrop: this event's Stage photo when it has one (the setup the book is
    // really about), otherwise the first zone that has a photo.
    const coverPhoto = (zonePages.find(p => /stage/i.test(p.zk) && p.photo) || zonePages.find(p => p.photo) || {}).photo || "";
    // The event's sessions (its functions) for the cover: what, when, and the details that shape
    // a setup — shift, headcount and, when it differs from the event's main venue, where.
    const niceDate = (ds) => {
      if (!ds) return "Date to be set";
      const d = new Date(ds + "T00:00:00");
      return isNaN(d) ? String(ds) : d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    };
    // `skipped` on a function is the LIST of Deal Check lines skipped in it, not a flag — an empty
    // array is truthy, so filtering on it dropped every session and the cover showed none.
    const sessions = fns.filter(Boolean).map((f, i) => ({
      type: f.type || `Session ${i + 1}`,
      date: niceDate(f.date),
      // Short form for the card's DATE cell ("Sat, 29 Aug 2026") — the long one does not fit a column.
      dateShort: (() => { if (!f.date) return "To be set"; const d = new Date(f.date + "T00:00:00"); return isNaN(d) ? String(f.date) : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); })(),
      shift: f.shift ? String(f.shift) : "",
      pax: Number(f.pax) > 0 ? String(f.pax) : "",
      place: f.venue && f.venue !== venue ? f.venue : "",
    }));
    // One colour per kind of function, so a three-function book reads at a glance. Anything not
    // listed takes the next colour in the rotation.
    const SES_TONES = { wedding: "wine", reception: "navy", cocktail: "navy", sangeet: "plum", mehendi: "sage", mehndi: "sage", haldi: "amber", engagement: "rose", ring: "rose", birthday: "amber" };
    const TONE_ROT = ["wine", "sage", "navy", "amber", "plum", "rose"];
    const sesTone = (t, i) => SES_TONES[Object.keys(SES_TONES).find(k => String(t).toLowerCase().includes(k))] || TONE_ROT[i % TONE_ROT.length];
    // Gold line — diamond — gold line: the one ornament, reused on the cover and on every zone page.
    const ornament = `<div class="orn"><i></i><b></b><i></i></div>`;

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(bookTitle)} — ${esc(sel?.clientName || "Event")} — Ambria</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap">
<style>
  /* ── A PAGE, NOT A WEB PAGE ──
     The first version had no width at all, so the browser laid it out across the whole window:
     on a 1920px screen the Item column and the Qty column ended up a foot apart and the sheet
     read as a spreadsheet dump. Everything here is sized to ONE A4 sheet — 794px is A4's
     210mm at 96dpi — and centred, so what you see is what the PDF is. */
  *{box-sizing:border-box}
  html,body{margin:0;background:#EEF1F6}
  body{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111827;font-size:11px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .sheet{width:794px;margin:0 auto;background:#F4F1EA;padding:38px 44px 30px}

  /* Header: a rule of colour, the department as the headline, the event beneath it, and the
     facts that identify this sheet as labelled pairs — a report is found again by its
     identifiers, so they are the one thing that must never be a run-on sentence. */
  /* Generous line-heights and bottom padding throughout the header: html2canvas draws text a few
     px below where the browser lays it out, and with tight boxes the bottoms of the fact values
     ("2026-09-29", "Aura") were sliced off at the block's edge. */
  /* ── AMBRIA HOUSE STYLE ──
     The same palette as Studio: deep navy, warm ivory, and gold as the one accent. Titles in
     Playfair Display, bold and upright, the serif the app's own zone views use — everything else in
     Inter. Gold is kept to rules, labels and markers so it reads as a detail, not a colour. */
  /* The cover is one full page (1020px ≈ A4's usable height at this width): brand at the top,
     the title block in the upper-middle, the facts and the contents anchored to the foot. As a
     short band it left two thirds of page one empty. */
  /* ── THE COVER: FULL BLEED ──
     A whole A4 page (794 × 1123px) edge to edge — the exporter draws it with no margin. The
     event's own Stage photo (else its first zone photo) fills the page under a warm dark shade,
     and a cream card floats on it holding the title, the facts and the contents. So every
     event's book opens on its own decor rather than a generic panel. */
  .cover{position:relative;width:794px;height:1123px;margin:-38px -44px 0;background:#2A2419 center/cover no-repeat;line-height:1.6;overflow:hidden}
  .cv-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(24,18,10,.45) 0%,rgba(24,18,10,.25) 45%,rgba(24,18,10,.6) 100%)}
  /* The card is laid out on one centre line: logo, kind, title, client, ornament, facts, the
     sessions, the contents. Gold corner brackets frame it like an invitation. */
  .cv-card{position:absolute;left:40px;right:40px;top:80px;bottom:92px;background:#F4F1EA;border-radius:30px;padding:44px 40px 34px;box-shadow:0 30px 60px -20px rgba(0,0,0,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .cv-corner{position:absolute;width:34px;height:34px;border-color:#B8935A;border-style:solid;border-width:0}
  .cv-corner.tl{top:18px;left:18px;border-top-width:1.5px;border-left-width:1.5px;border-top-left-radius:12px}
  .cv-corner.tr{top:18px;right:18px;border-top-width:1.5px;border-right-width:1.5px;border-top-right-radius:12px}
  .cv-corner.bl{bottom:18px;left:18px;border-bottom-width:1.5px;border-left-width:1.5px;border-bottom-left-radius:12px}
  .cv-corner.br{bottom:18px;right:18px;border-bottom-width:1.5px;border-right-width:1.5px;border-bottom-right-radius:12px}
  .cv-mark{font-size:14px;font-weight:700;letter-spacing:.3em;color:#A8844A}
  /* The official mark (cropped to its own ink, so its height IS the wordmark's height). Dark
     version on the cream card, the white original on the cover photo. */
  .cv-logo{display:block;height:50px;width:auto}
  .cv-logo-l{display:block;height:30px;width:auto}
  .ft-logo{display:block;height:26px;width:auto;margin:0 auto}
  .cv-kind{margin-top:22px;font-size:10.5px;line-height:1.7;font-weight:700;letter-spacing:.34em;text-transform:uppercase;color:#8A8272}
  .cv-title{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:76px;line-height:1.15;letter-spacing:-.01em;color:#1A1A1A;margin-top:18px}
  /* ── THE COVER'S NAMES ARE SET IN THE SANS, DELIBERATELY ──
     html2canvas paints Playfair on this card with no advance on the space glyph, so "pratik
     test" came out "pratiktest". It is specific to the cover: the same face sets item names and
     kit names elsewhere in the book and those are fine. Ruled out as causes: windowWidth,
     centring, flex layout, the font weight, the Google Fonts weight set, non-breaking spaces,
     white-space:pre, per-word spans with margins, and flex gap — none restore the space. A
     word-spacing compensation fixed two-word names and still lost gaps in four-word ones.
     Inter renders correctly on this same card at every length, so the two lines that carry real
     multi-word names use it. The department title above stays in the serif: it is always a
     single word, so it cannot hit this. */
  .cv-for{font-family:"Inter",-apple-system,"Segoe UI",Arial,sans-serif;font-weight:600;font-size:27px;line-height:1.45;letter-spacing:-.01em;color:#8B6F42;margin-top:6px}
  /* The ornament: gold hairline, a small gold diamond, gold hairline. */
  .orn{display:flex;align-items:center;justify-content:center;gap:10px;margin:26px 0}
  .orn i{display:block;width:90px;height:1px;background:#C9A96E}
  .orn b{display:block;width:8px;height:8px;background:#C9A96E;transform:rotate(45deg)}
  .cv-facts{display:flex;justify-content:center;gap:0}
  .cv-facts > div{padding:0 34px;border-left:1px solid #DDD6C6}
  .cv-facts > div:first-child{border-left:0}
  .cv-facts .k{font-size:11px;line-height:1.7;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#8A8272;margin-bottom:6px}
  .cv-facts .v{font-size:19px;line-height:1.5;font-weight:700;color:#1A1A1A}
  .cv-sec{font-size:11px;line-height:1.7;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#A8844A;margin:34px 0 12px}
  /* One card per session, each in its own colour (wine, navy, sage, amber, plum, rose): a tinted
     face, a border and offset shadow in the deep shade, the type in the serif, the full date,
     then the shift and headcount as chips. */
  /* Larger and quieter: the type as the headline, a hairline in the card's own colour, then the
     facts as labelled columns (DATE | SHIFT | GUESTS) instead of a filled pill — which also cured
     the pill's clipped text. Every text box carries line-height 1.7+ and bottom padding, because
     html2canvas draws text a few px low and a tight box slices the letters. */
  .cv-sessions{display:flex;flex-wrap:wrap;justify-content:center;gap:22px;width:100%}
  .cv-ses{flex:0 1 400px;border-radius:24px;padding:26px 28px 24px;border:1.5px solid var(--d);box-shadow:5px 5px 0 var(--d);background:var(--l)}
  .cv-ses .sk{font-size:11px;line-height:1.8;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--d);opacity:.8}
  .cv-ses .st{font-family:"Inter",-apple-system,"Segoe UI",Arial,sans-serif;font-weight:700;font-size:37px;line-height:1.3;letter-spacing:-.02em;color:var(--d);padding-bottom:2px}
  .cv-ses .sl{height:1px;background:var(--d);opacity:.28;margin:16px 6px 18px}
  .cv-ses .sg{display:flex;justify-content:center}
  .cv-ses .sf{padding:0 20px 2px;border-left:1px solid rgba(26,26,26,.14)}
  .cv-ses .sf:first-child{border-left:0}
  .cv-ses .sf .k{font-size:10.5px;line-height:1.8;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#7A7468}
  .cv-ses .sf .v{font-size:19px;line-height:1.7;font-weight:700;color:#1A1A1A;white-space:nowrap;text-transform:capitalize;padding-bottom:2px}
  .cv-sessions.many .cv-ses{flex:0 1 300px;padding:18px 20px 16px;border-radius:20px}
  .cv-sessions.many .cv-ses .sk{font-size:9.5px}
  .cv-sessions.many .cv-ses .st{font-size:28px}
  .cv-sessions.many .cv-ses .sl{margin:11px 6px 12px}
  .cv-sessions.many .cv-ses .sf{padding:0 13px 2px}
  .cv-sessions.many .cv-ses .sf .k{font-size:9px}
  .cv-sessions.many .cv-ses .sf .v{font-size:15px;white-space:normal}
  /* The fields must be allowed to wrap here, or the card cannot shrink at all: a flex item
     never goes below its min-content width, and a nowrap Date+Shift+Guests row is ~406px of
     min-content. That pinned every card to one per row and the extra rows fell off the cover.
     Wrapping lets the card reach its 300px basis, so two fit on a row. */
  .cv-sessions.many .cv-ses .sg{flex-wrap:wrap;row-gap:6px}
  /* Five or more sessions need three to a row, not two, or the third row falls off the cover.
     A wedding week (haldi, mehendi, sangeet, wedding, reception) hits this exactly. */
  .cv-sessions.dense .cv-ses{flex:0 1 196px;padding:11px 14px 10px;border-radius:16px;box-shadow:3px 3px 0 var(--d)}
  .cv-sessions.dense .cv-ses .sk{font-size:8.5px;letter-spacing:.2em}
  .cv-sessions.dense .cv-ses .st{font-size:20px;line-height:1.2}
  .cv-sessions.dense .cv-ses .sl{margin:6px 4px 7px}
  .cv-sessions.dense .cv-ses .sf{padding:0 9px 2px}
  .cv-sessions.dense .cv-ses .sf .k{font-size:8px;letter-spacing:.14em}
  .cv-sessions.dense .cv-ses .sf .v{font-size:13px}
  .cv-sessions.dense{gap:14px}
  .cv-ses .sm{font-size:12.5px;line-height:1.8;color:#6F6A5E;margin-top:8px;padding-bottom:2px}
  .t-wine{--d:#7A2E3B;--l:#F6E3E5}
  .t-navy{--d:#23345C;--l:#E3E9F5}
  .t-sage{--d:#3F6150;--l:#E2EEE5}
  .t-amber{--d:#9A6412;--l:#FBEFD2}
  .t-plum{--d:#5B3470;--l:#EFE4F4}
  .t-rose{--d:#A2445E;--l:#F9E4EA}
  /* Colour on the card itself: a jewel-tone ribbon across the top, a warmer ivory face, and the
     client's name in wine. */
  .cv-card{overflow:hidden;background:linear-gradient(180deg,#FCF8F0 0%,#F3EADB 100%)}
  .cv-ribbon{position:absolute;left:0;right:0;top:0;height:9px;background:linear-gradient(90deg,#7A2E3B 0%,#B8935A 30%,#3F6150 55%,#23345C 80%,#5B3470 100%)}
  .cv-for{color:#7A2E3B}
  .cv-facts .v{color:#23345C}
  .cv-bottom{position:absolute;left:62px;right:62px;bottom:36px;display:flex;align-items:center;justify-content:space-between;font-size:10px;line-height:1.7;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(244,241,234,.8)}

  /* Section head: a number, the name, and a rule that runs out to the margin. The number is
     what lets someone on a phone call say "look at section 3" instead of "scroll down a bit". */
  section{margin-bottom:20px}
  .sh{display:flex;align-items:center;gap:9px;margin-bottom:9px}
  .sh .sn{font-size:9.5px;line-height:1.7;font-weight:600;color:#A8844A;border:1px solid rgba(201,169,110,.5);border-radius:3px;padding:1px 5px;letter-spacing:.06em}
  /* No nowrap: a heading longer than the rule was written for used to be cut off rather than
     wrap. Nothing that holds words clips — see the html2canvas note further down. */
  .sh h3{font-family:"Playfair Display",Georgia,serif;font-size:17.5px;line-height:1.4;font-weight:700;color:#15152B;margin:0}
  .sh i{flex:1;height:1px;background:rgba(201,169,110,.4)}

  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th,td{padding:6px 9px;text-align:left;vertical-align:middle;word-wrap:break-word}
  th{font-size:9.5px;line-height:1.7;font-weight:600;text-transform:uppercase;letter-spacing:.18em;color:#A8844A;border-bottom:1px solid rgba(201,169,110,.45);padding-bottom:5px}
  /* top, not middle: a row whose name carries a sub-line ("part of Wooden Coffee Table") had its
     quantity floating half a line below the name it belongs to. */
  td{border-bottom:1px solid #F3EEE4;font-size:11.5px;line-height:1.75;vertical-align:top}
  tbody tr:last-child td{border-bottom:0}
  .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .b{font-weight:700;color:#0F172A}
  .sub{color:#94A3B8;font-size:10.5px;margin-top:1.5px}
  .kit td{color:#475569;font-size:10.5px;background:#F8FAFF;border-bottom:1px solid #EEF2FF}
  .kit td:first-child{padding-left:26px;color:#64748B}
  .tot td{background:#F8FAFC;font-weight:700;border-top:1.5px solid #CBD5E1;border-bottom:0;color:#0F172A}
  .tag{display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:9px;font-weight:700;padding:1.5px 4px;border-radius:2.5px;vertical-align:middle;letter-spacing:.04em;margin-left:3px}
  /* The share bar gets its own narrow column so it stays a measure instead of becoming a rule
     across the sheet, which is what made it read as a divider on screen. */
  /* The cells are top-aligned so a figure sits level with a name that carries a sub-line
     (see td above). A 4px bar has no text to sit level with, though, and top alignment left it
     floating above the amount it measures — so this one column centres on its row instead. */
  .bar{padding-right:4px;vertical-align:middle}
  .bar i{display:block;height:4px;border-radius:2px;background:#2563EB;min-width:2px}
  td.bar{position:relative;background:linear-gradient(#EEF2F7,#EEF2F7) 9px center/calc(100% - 18px) 4px no-repeat}
  .pct{font-size:10px;color:#64748B;font-weight:600}

  /* Four cards across 706px is ~166px each — the figure drops to 17px so a seven-digit amount
     still fits on one line, since a wrapped "₹1,40,240" is worse than a smaller one. */
  .cards{display:flex;gap:8px;margin-bottom:13px}
  .card{flex:1;min-width:0;border:1px solid #E8ECF2;border-radius:9px;padding:10px 11px}
  .card.hi{background:#2563EB;border-color:#2563EB;color:#fff}
  .card.pos{background:#ECFDF5;border-color:#A7F3D0;color:#065F46}
  .card.neg{background:#FEF2F2;border-color:#FECACA;color:#991B1B}
  .card .k{font-size:9px;text-transform:uppercase;letter-spacing:.09em;font-weight:700;opacity:.72}
  .card .v{font-size:17px;font-weight:700;margin:5px 0 3px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap}
  .card .v.muted{color:#CBD5E1}
  .card .s{font-size:9.5px;opacity:.72;line-height:1.5}
  .meta{color:#94A3B8;font-size:10.5px;margin:7px 0 0}
  .note{background:#FFFBEB;border-left:3px solid #F59E0B;color:#92400E;padding:7px 10px;border-radius:0 5px 5px 0;font-size:10px;margin:9px 0 0}
  .empty{color:#94A3B8;font-style:italic;font-size:10.5px;margin:2px 0 0}
  .ok{color:#059669;font-weight:600}
  .bad{color:#DC2626;font-weight:700}
  footer{margin-top:28px;padding-top:14px;padding-bottom:8px;line-height:1.8;border-top:1px solid rgba(201,169,110,.45);text-align:center}
  .ft-mark{font-size:11px;font-weight:600;letter-spacing:.38em;color:#A8844A}
  .ft-meta{font-size:10px;color:#A39A89;margin-top:2px}

  /* ── ZONE LAYOUT PAGES ──
     Absolutely positioned inside a fixed 706px stage, so the arrows land exactly on the card
     centres. Photos are background images with background-size, not <img object-fit>: html2canvas
     does not honour object-fit and would stretch them. */
  /* html2canvas draws text a few px lower than the browser lays it out, so anything with a
     tight line-height or overflow:hidden loses the bottom of its letters. Everything here gets a
     generous line-height and nothing that holds text clips. */
  /* Zone page head: a gold eyebrow with the zone number, the name in the house serif, the
     function and date under it; size and count as gold-outlined tags on the right. */
  .zh{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:6px;margin-bottom:26px}
  .zk{font-size:10px;line-height:1.7;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6B6B6B}
  .zk b{font-weight:700}
  .zh h2{font-family:"Playfair Display",Georgia,serif;font-size:38px;line-height:1.3;margin:0 0 2px;color:#1A1A1A;font-weight:700;letter-spacing:-.01em}
  .zm{font-size:12.5px;line-height:1.7;color:#6B6B6B}
  /* Pills centre their text by line-height against a fixed height — the pattern .zc-no above
     has always used — rather than by padding around a font-dependent line box. Padding alone
     centres on screen and then sits low in the export, because html2canvas draws text a few px
     lower than the browser lays it out (see the note above). align-items keeps two chips of
     different content on one centre line instead of stretching the shorter one. */
  /* The negative margin lines the chips' text up with the function/date line beside them: the
     head bottom-aligns its two sides, which put the 28px chips' centres ~4.5px above the 21px
     date line's. */
  .zt{display:flex;align-items:center;gap:6px;flex-shrink:0;margin-bottom:-4.5px}
  .zt span{box-sizing:border-box;height:28px;line-height:28px;padding:0 14px;font-size:11.5px;font-weight:700;color:#1A1A1A;background:#E6E1D5;border-radius:20px;white-space:nowrap}
  /* Says WHAT is being measured. On its own "L 52 × W 14 × H 12 ft" could be the zone, the
     structure or a single prop; it is the zone's own span. */
  .zst{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
  .zst span{box-sizing:border-box;height:30px;line-height:30px;padding:0 12px;font-size:12px;font-weight:700;color:#1A1A1A;background:#EFE9DC;border:1px solid #DDD4C2;border-radius:8px;white-space:nowrap}
  .zst .zl{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A7263;margin-right:7px}
  .zt .zl{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A7263;margin-right:7px}
  .zs{position:relative;width:706px}
  /* The zone photo is mounted like a print: a white mat and a gold hairline, lifted off the
     page by a soft shadow. */
  /* contain, not cover (owner ask): the whole zone photo is shown, scaled down to fit, never cropped — a
     landscape stage shot was losing its sides and a portrait one its top and bottom. */
  .zphoto{position:absolute;left:0;width:700px;border-radius:16px;background:#EDE8DC center/contain no-repeat;border:1.5px solid #1A1A1A;box-shadow:5px 6px 0 #1A1A1A;display:flex;align-items:center;justify-content:center}
  .zphoto span,.zc-ph span{font-size:13px;line-height:1.7;color:#A39A89;font-family:"Inter",Arial,sans-serif}
  .zc{position:absolute;width:224px;height:300px;border:1.5px solid #1A1A1A;border-radius:16px;background:#FFFDF8;box-shadow:4px 4px 0 #1A1A1A}
  .zc.st{position:relative;height:auto;min-height:300px}
  .zc.np{height:auto;min-height:0}
  .zc.nb{padding-top:34px}
  .zc-ph{height:168px;margin:7px 7px 0;border-radius:11px;background:#fff center/contain no-repeat;border:1px solid #E6E1D5;display:flex;align-items:center;justify-content:center}
  /* The item number: a gold disc on the card's photo corner, matched by the pin on the photo. */
  .zc-no{position:absolute;top:13px;left:13px;width:22px;height:22px;border-radius:50%;background:#1A1A1A;color:#F4F1EA;font-size:11px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 0 0 2px #FFFDF8}
  .zc-b{padding:9px 11px 8px}
  .zc-n{font-family:"Playfair Display",Georgia,serif;font-size:13.5px;font-weight:700;color:#1A1A1A;line-height:1.4;min-height:36px;margin-bottom:5px}
  .zc-r{display:flex;justify-content:space-between;align-items:baseline;gap:8px;line-height:1.8;border-top:1px solid #EDE8DC}
  .zc-r span{color:#6B6B6B;text-transform:uppercase;letter-spacing:.1em;font-size:9.5px;font-weight:700;flex-shrink:0}
  .zc-r b{color:#1A1A1A;font-size:11px;font-weight:700;text-align:right}
  /* Flower lines: names read as names, not as the uppercase field labels above them. */
  .zc-fs{font-family:"Inter",Arial,sans-serif;font-size:10px;font-weight:600;color:#8A8270;margin-top:1px}
  .zc-r.f span{text-transform:none;letter-spacing:0;font-size:10.5px;font-weight:600;flex-shrink:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* The arrow: a gold shaft with a drawn head at the photo end and a dot at the card end. */
  .za{position:absolute;width:1.5px;background:#1A1A1A}
  .za::after{content:"";position:absolute;left:-4px;border-left:4.75px solid transparent;border-right:4.75px solid transparent}
  .za.down::after{bottom:-1px;border-top:7px solid #1A1A1A}
  .za.up::after{top:-1px;border-bottom:7px solid #1A1A1A}
  .za::before{content:"";position:absolute;left:-2.5px;width:6.5px;height:6.5px;border-radius:50%;background:#1A1A1A}
  .za.down::before{top:-3px}
  .za.up::before{bottom:-3px}
  .zpin{position:absolute;width:22px;height:22px;border-radius:50%;background:#1A1A1A;color:#F4F1EA;font-size:11px;font-weight:700;line-height:22px;text-align:center;box-shadow:0 0 0 2px rgba(255,253,248,.9),0 3px 8px rgba(0,0,0,.35)}
  .zg{display:grid;grid-template-columns:repeat(3,224px);gap:17px;justify-content:center}
  /* ── THE TWO CORNER BADGES MUST BE ONE BOX ──
     They sit at the same top on the same card, so any difference in their metrics reads as a
     misalignment. The size badge is outlined and the kit badge was not, which made it 3px taller
     (1.5px of border top and bottom) and dropped its text half a pixel lower. The kit badge now
     carries the same border in its own fill colour — invisible, but the same box.
     Both also declare a line-height: without one the glyph box came from the font's defaults, and
     since html2canvas draws text a few px lower than the browser (see the note above), the word
     sat on the bottom border in the export while looking fine on screen. */
  /* Centred as a flex box rather than by a line box: line-height centring depends on the
     font's own metrics, and html2canvas draws text a few px lower than it lays out, which
     pushed the word off centre in the export while looking right on screen. */
  .zc-kt,.zc-sz{position:absolute;top:13px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:21px;line-height:1;padding:0 9px;border-radius:11px;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border:1.5px solid transparent;box-shadow:0 0 0 2px #FFFDF8;font-family:"Inter",Arial,sans-serif;white-space:nowrap}
  .zc-kt{right:13px;background:#1A1A1A;color:#F4F1EA;border-color:#1A1A1A}
  .zc-sz{left:13px;background:#FFFDF8;color:#1A1A1A;border-color:#1A1A1A}
  /* A kit block reads as a small card with a titled band, the way the zone cards do: the kit's
     own photo, a serial, the name, and a count chip. The parts below use dotted leaders rather
     than a rule per row — a rule under a single-part kit read as an underline on the heading. */
  .kb{border:1.5px solid #1A1A1A;border-radius:14px;background:#FFFDF8;box-shadow:3px 3px 0 #1A1A1A;margin-top:14px;overflow:hidden}
  .kb-h{display:flex;align-items:center;gap:13px;padding:10px 13px;background:#F4F1EA;border-bottom:1.5px solid #1A1A1A;min-height:64px}
  .kb-ph{width:64px;height:64px;border-radius:10px;border:1px solid #D9D2C2;background:#fff center/cover no-repeat;flex-shrink:0}
  .kb-t{flex:1;min-width:0}
  .kb-no{font-family:"Inter",Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8A7F68;line-height:1.45}
  /* No ellipsis here, and a generous line-height — see the html2canvas note above. This name was
     briefly clipped to one nowrap line at line-height 1.25, which Chrome spilled harmlessly and
     the export cut in half along the band's border. A long kit name takes a second line instead
     and the band grows with it. */
  .kb-nm{font-family:"Playfair Display",Georgia,serif;font-size:14.5px;font-weight:700;color:#1A1A1A;line-height:1.5;margin-top:1px}
  .kb-z{flex-shrink:0;max-width:46%;text-align:right}
  .kb-zk{font-family:"Inter",Arial,sans-serif;font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9A8F76;line-height:1.5}
  .kb-zv{font-family:"Inter",Arial,sans-serif;font-size:12px;font-weight:700;color:#1A1A1A;line-height:1.4}
  .kb-zv.none{font-weight:600;color:#A39A89}
  /* The kit count sits beside the zone, split from it by a hairline, so "2" is not read as part of the zone name. */
  .kb-q{padding-right:13px;border-right:1px solid #D9D2C2}
  .kb-w{font-family:"Inter",Arial,sans-serif;font-size:10.5px;color:#8A7F68;padding:8px 13px 0}
  .kb-l{display:grid;grid-template-columns:1fr 1fr;gap:0 26px;list-style:none;margin:0;padding:8px 13px 11px}
  .kb-l.one{grid-template-columns:1fr}
  .kb-l li{display:flex;align-items:baseline;gap:8px;line-height:2;font-size:11.5px;color:#1A1A1A}
  .kb-l li span{flex-shrink:1;min-width:0}
  .kb-l li b{flex-shrink:0;font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums}
  .kb-d{flex:1 1 auto;min-width:12px;border-bottom:1px dotted #C7BFAC;transform:translateY(-3px)}
  .kb-x{width:11px;height:11px;border:1.5px solid #1A1A1A;border-radius:3px;flex-shrink:0;background:#fff;align-self:center}
  /* A kit part's photo — row-height, so a parts list with photos lays out exactly as one without. */
  .kb-p{width:22px;height:22px;border-radius:5px;flex-shrink:0;background:#fff center/cover no-repeat;border:1px solid #E6E1D5;align-self:center}
  /* ── THE PAGE PATTERN ──
     A faint gold dot grid behind each zone page, and gold corner brackets echoing the cover's.
     The dots are an SVG tile rather than a CSS radial-gradient: html2canvas draws gradients once,
     stretched, but repeats an image tile faithfully. Photos and cards sit over it opaque, so it
     only shows in the margins and gaps. */
  .zp{position:relative;padding:14px 0 6px;background-image:url("${dotTileUrl()}");background-size:18px 18px;background-repeat:repeat}
  .zp .pc{position:absolute;width:26px;height:26px;border-color:#B8935A;border-style:solid;border-width:0}
  .zp .pc.tl{top:0;left:0;border-top-width:1.5px;border-left-width:1.5px;border-top-left-radius:9px}
  .zp .pc.tr{top:0;right:0;border-top-width:1.5px;border-right-width:1.5px;border-top-right-radius:9px}
  .zh{position:relative;background:#F4F1EA;border-radius:14px;padding:6px 14px 10px}
  /* Clear space above the ornament: the 38px title's descenders and html2canvas's low text offset
     put the line through the bottom of the letters at a 6px gap. */
  .orn.l{justify-content:flex-start;margin:14px 0 8px}
  .orn.l i{width:46px}

  /* The button is screen furniture. It is hidden from print, and the exporter removes it from
     the DOM outright before rendering, so it can never appear in the file either way. */
  .noprint{position:fixed;top:16px;right:16px;background:#2563EB;color:#fff;border:0;border-radius:9px;padding:10px 18px;font:600 13px/1 inherit;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,.35)}
  @media print{
    @page{size:A4;margin:0}
    html,body{background:#fff}
    .noprint{display:none!important}
    .sheet{width:auto;padding:14mm 14mm 10mm}
    section{break-inside:avoid}
    .zp{break-before:page}
    tr{break-inside:avoid}
  }
</style></head><body>
<button class="noprint" onclick="window.print()">Save as PDF</button>
<div class="sheet" id="sheet">
<header class="cover" data-block data-cover style="${bgCss(coverPhoto)}" ${bgData(coverPhoto)}>
  <div class="cv-shade"></div>
  <div class="cv-card">
    <div class="cv-ribbon"></div>
    <div class="cv-corner tl"></div><div class="cv-corner tr"></div><div class="cv-corner bl"></div><div class="cv-corner br"></div>
    ${logos.dark ? `<img class="cv-logo" src="${logos.dark}" alt="Ambria — Design &amp; Decor">` : `<div class="cv-mark">AMBRIA</div>`}
    <div class="cv-kind">Setup book</div>
    <div class="cv-title">${esc(bookTitle)}</div>
    <div class="cv-for">${esc(sel?.clientName || "Event")}</div>
    ${ornament}
    <div class="cv-facts">
      <div><div class="k">Venue</div><div class="v">${esc(venue)}</div></div>
      <div><div class="k">Prepared by</div><div class="v">${esc(deptData.updatedBy || authUser?.name || "—")}</div></div>
    </div>
    ${sessions.length ? `<div class="cv-sec">${sessions.length === 1 ? "The event" : `${sessions.length} sessions`}</div>
    <div class="cv-sessions${sessions.length > 4 ? " many dense" : sessions.length > 2 ? " many" : ""}">${sessions.map((s, i) => `<div class="cv-ses t-${sesTone(s.type, i)}">
      <div class="sk">Event type</div>
      <div class="st">${esc(s.type)}</div>
      <div class="sl"></div>
      <div class="sg">
        <div class="sf"><div class="k">Date</div><div class="v">${esc(s.dateShort)}</div></div>
        ${s.shift ? `<div class="sf"><div class="k">Shift</div><div class="v">${esc(s.shift)}</div></div>` : ""}
        ${s.pax ? `<div class="sf"><div class="k">Guests</div><div class="v">${esc(s.pax)}</div></div>` : ""}
      </div>
      ${s.place ? `<div class="sm">${esc(s.place)}</div>` : ""}
    </div>`).join("")}</div>` : ""}
  </div>
  <div class="cv-bottom"><span>${esc(bookTitle)} / ${esc((selDateStr || "").slice(0, 4) || new Date().getFullYear())}</span>${logos.light ? `<img class="cv-logo-l" src="${logos.light}" alt="Ambria — Design &amp; Decor">` : `<span>Ambria · Design &amp; Decor</span>`}</div>
</header>
${/* Money, the priced inventory table, the crew plan and logged spend are left out: this sheet
     goes to the people setting up the event, who need what goes where, not what it costs. The
     zone layout pages below carry every item, with photo, qty and size. */ ""}
${zoneHtml}
${combined ? "" : (truckRows.length || loadRows.length) ? sect("Loading & dispatch",
  (truckRows.length ? table(["#", "Vehicle", "Driver", "Phone", "Status"], truckRows, ["12%", "26%", "24%", "20%", "18%"]) : "")
  + (loadRows.length ? `<p class="meta">Everything going to site — ${blockedItems.length} item${blockedItems.length === 1 ? "" : "s"}, ${loadUnits} piece${loadUnits === 1 ? "" : "s"} in total.</p>`
    + table(["Item", "Qty"], loadRows, ["80%", "20%"]) : "")) : ""}
${!combined && trRows.length ? sect("Transport", table(["Load", "Quantity", "Fits per truck", "Trucks"], trRows, ["46%", "20%", "22%", "12%"]) + `<p class="note">${trNote}</p>`) : ""}
${!combined && moveRows.length ? sect("Dismantle routing", table(["Item", "Goes to", "Qty", "Logged by"], moveRows, ["38%", "32%", "12%", "18%"])) : ""}
${!combined && fabRows.length ? sect("Fabric required vs available", table(["Fabric · colour", "Required", "Available", "Status"], fabRows, ["40%", "20%", "20%", "20%"])) : ""}
<footer data-block>
  ${logos.dark ? `<img class="ft-logo" src="${logos.dark}" alt="Ambria — Design &amp; Decor">` : `<div class="ft-mark">AMBRIA · DESIGN &amp; DECOR</div>`}
  <div class="ft-meta">Generated ${esc(new Date().toLocaleString("en-IN"))} · ${esc(authUser?.name || "—")}</div>
</footer>
</div>
</body></html>`;
    return html;
  };
  // Reassigned on every render, unconditionally — not in a useEffect, which would only run
  // AFTER paint, one tick too late for the export loop below, which calls settleDept and reads
  // this ref back in the same frame it resolves.
  buildReportRef.current = buildReportHtml;

  // ── THE DOWNLOAD ──
  // Renders the report offscreen, turns it into an A4 PDF and saves it, with no print dialog in
  // the way. jsPDF and html2canvas are pulled in with a DYNAMIC import so Vite splits them into
  // their own chunk: nobody who never presses this button pays for them, which is what kept a
  // PDF library off the table when this was a print-window export.
  //
  // Paginated block by block rather than as one tall image sliced every 841pt. Slicing a single
  // strip cuts through whatever happens to sit on the boundary — a table row bisected, a heading
  // with its table on the next page. Each `data-block` is measured first and moved to a fresh
  // page if it does not fit, so breaks land between sections. A block taller than a page (a long
  // inventory table) still has to be cut, but it is the only thing that ever is.
  // Wait for a department switch to actually land. deptRef is assigned during render, so it
  // flips only once React has committed and every memo has recomputed.
  const settleDept = (d) => new Promise((resolve) => {
    if (deptRef.current === d) { resolve(); return; }
    setDept(d);
    let tries = 0;
    const tick = () => {
      if (deptRef.current === d || ++tries > 600) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // { view: true } shows the finished PDF in the viewer below instead of saving it.
  const exportPdf = async (depts, { view = false, cacheKey = "", gate = true } = {}) => {
    if (exporting) return;
    const multi = depts.length > 1;
    // ── NO PDF UNTIL EVERY CARPET FLOOR AND EVERY OVERLAY / CUSHION COVER WITH CHOICES HAS ITS DESIGN ──
    // Carpet is Tenting's work, and overlays and cushion covers are Fabric's. The book that carries a decision (Tenting's, Fabric's, and the
    // all-departments book) tells the crew which design goes where: an unmade decision has nothing to print, so those PDFs are refused until
    // it is made. Every other department's PDF is not held up. What is missing is named so it can be fixed in the plan.
    // The PDF started from Deal Check (it lists what sales asked for) and the viewer refreshing itself are not held up by this.
    const needCarpets = multi || depts.includes("Tenting");
    const needItems = multi || depts.includes("Fabric");
    if (gate && !pdfAllCarpetsRef.current && (needCarpets || needItems)) {
      // Something whose function date has already passed has nothing left to plan, so history can always be downloaded.
      const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
      const open = (r) => r.status !== "decided" && !(r.date && r.date < today);
      const carpetLeft = needCarpets ? carpetPlanOf().rows.filter(open) : [];
      const itemsLeft = needItems ? elementPlanOf().rows.filter(open) : [];
      if (carpetLeft.length || itemsLeft.length) {
        if (carpetGateOpenRef.current) return false; // the message is already up (a double click)
        carpetGateOpenRef.current = true;
        const when = (d) => { try { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""; } catch { return d || ""; } };
        const listOf = (rows, label, tail) => {
          const lines = rows.slice(0, 8).map(r => `• ${label(r)}${[r.fnLabel, when(r.date)].filter(Boolean).length ? " — " + [r.fnLabel, when(r.date)].filter(Boolean).join(" · ") : ""}${tail(r)}`);
          if (rows.length > 8) lines.push(`…and ${rows.length - 8} more`);
          return lines.join("\n");
        };
        const carpetLines = listOf(carpetLeft, r => r.zoneName, r => (r.status === "none" ? " (sales picked no carpet)" : ""));
        const itemLines = listOf(itemsLeft, r => `${r.zoneName} · ${r.name}`, r => (r.status === "short" ? " (none of the choices covers it)" : ""));
        // The site's own dialog (not the browser's alert): says what is missing and takes them straight to the plan.
        // Someone who cannot open that department is told who to ask, not sent to a panel they cannot reach.
        const canCarpet = dept === "Tenting" || deptOptions.includes("Tenting");
        const canItems = dept === "Fabric" || deptOptions.includes("Fabric");
        const goCarpet = carpetLeft.length > 0 && canCarpet;
        const goItems = !goCarpet && itemsLeft.length > 0 && canItems;
        const carpetHow = canCarpet ? "Pick a carpet for each in Tenting → Carpet plan (if no stock carpet can be used, choose \"Arrange separately\")" : "Ask the Tenting head to choose them in Planning → Tenting → Carpet plan";
        const itemHow = canItems ? "Pick a design for each in Fabric → Fabric plan (if none in stock can be used, choose \"Arrange separately\")" : "Ask the Fabric head to choose them in Planning → Fabric → Fabric plan";
        let title, body;
        if (carpetLeft.length && itemsLeft.length) {
          title = "Choices not made";
          body = `The PDF was not made. These still need deciding:\n\nCarpet:\n${carpetLines}\n\nOverlays / cushion covers:\n${itemLines}\n\n${carpetHow}; ${itemHow.charAt(0).toLowerCase() + itemHow.slice(1)}. Then download again.`;
        } else if (carpetLeft.length) {
          title = "Carpet not selected";
          body = `The PDF was not made. Choose the carpet for ${carpetLeft.length === 1 ? "this floor" : "these floors"} first:\n\n${carpetLines}\n\n${carpetHow}, then download again.`;
        } else {
          title = "Overlay / cushion cover not chosen";
          body = `The PDF was not made. Choose the design for ${itemsLeft.length === 1 ? "this element" : "these elements"} first:\n\n${itemLines}\n\n${itemHow}, then download again.`;
        }
        try {
          const go = await confirm({ title, body, confirmLabel: goCarpet ? "Open Carpet plan" : goItems ? "Open Fabric plan" : "OK", danger: false });
          if (go && goCarpet) { if (dept !== "Tenting") setDept("Tenting"); setOpsView("planning"); setModal("carpet"); }
          else if (go && goItems) { if (dept !== "Fabric") setDept("Fabric"); setOpsView("planning"); setModal("fabreq"); }
        } finally { carpetGateOpenRef.current = false; }
        return false;
      }
    }
    const startedOn = dept;
    zoneAdminOrderRef.current = null; // read again below (a failed read leaves the built-in order)
    let ok = false; // true once a PDF was produced (the caller of a hidden run reports it)
    setExporting(view ? "view" : "download");
    // Zone names as the admin set them in Studio (e.g. "Centre Lounge"), not the raw keys. A
    // failed read just falls back to the built-in names.
    const zoneLabels = {};
    try {
      let v = await kvGet(ZONE_DEF_SK);
      for (let i = 0; i < 2 && typeof v === "string"; i++) { try { v = JSON.parse(v); } catch { break; } }
      Object.entries(v?.meta || {}).forEach(([k, m]) => { if (m?.label) zoneLabels[k] = m.label; });
      if (v?.meta && typeof v.meta === "object") zoneAdminOrderRef.current = Object.keys(v.meta);
    } catch { /* built-in names it is */ }
    const logos = await loadPdfLogosOnce();
    let frame = null;
    let restoreFillText = null;
    try {
      const [{ jsPDF }, h2c] = await loadPdfLibs();
      const html2canvas = h2c.default;

      const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
      // Every page is painted the sheet's cream edge to edge, so the margins around each block are
      // not a white frame around a cream page.
      const paintPage = () => { pdf.setFillColor(244, 241, 234); pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), "F"); };
      const newPage = () => { pdf.addPage(); paintPage(); };
      paintPage();
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const MARGIN = 28;                       // pt of white around the content on every page
      const usableW = pageW - MARGIN * 2;
      const usableH = pageH - MARGIN * 2;
      const skipped = [];
      let photoless = 0; // sections drawn without their photos because the browser refused them
      let blocksSeen = 0;
      const coverPages = new Set(); // physical page numbers a cover was drawn on — see below

      // ── ONE PASS PER DEPARTMENT, ALL INTO THE SAME FILE ──
      // Each pass builds that department's book in its own iframe and appends its pages. A second
      // and later department starts on a fresh page, with `first` reset so its cover still draws
      // full bleed onto that page rather than adding another.
      // "All departments" is ONE combined, zone-wise book (owner ask) — not seven books back to
      // back — so it is a single pass with every department's items on each zone page.
      const passes = multi ? ["__combined__"] : depts;
      for (let di = 0; di < passes.length; di++) {
        if (multi) setExportNote("All departments — combined");
        const html = (buildReportRef.current || buildReportHtml)(zoneLabels, logos, { combined: multi });
        if (di > 0) { newPage(); }
        frame = document.createElement("iframe");

      // An iframe, not a div in this page: the report's CSS is written for a bare document, and
      // dropped into the app it would inherit Tailwind's reset and its oklch() colours — which
      // html2canvas cannot parse and silently renders as black.
      // Offscreen via position, NOT display:none or visibility:hidden — an element with no
      // layout box has nothing to rasterise, and the canvas would come back empty.
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1200px;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      doc.open(); doc.write(html); doc.close();
      // The button exists for the fallback path only; it must not be rasterised into the file.
      doc.querySelector(".noprint")?.remove();
      // Let the iframe lay out and its webfont settle before measuring anything.
      await new Promise(r => setTimeout(r, 120));
      // The house serif comes from Google Fonts. fonts.ready alone is not enough: it resolves as
      // soon as nothing is *pending*, which is true before the stylesheet has even arrived. So wait
      // for the stylesheet, then ask for both faces explicitly (3s cap each — a blocked font just
      // falls back to Georgia / the system sans rather than stalling the export).
      const capped = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
      const fontLink = doc.querySelector('link[rel="stylesheet"][href*="fonts.googleapis"]');
      if (fontLink && !fontLink.sheet) await capped(new Promise(r => { fontLink.onload = r; fontLink.onerror = r; }), 3000);
      if (doc.fonts?.load) {
        try {
          await capped(Promise.all([
            doc.fonts.load('700 38px "Playfair Display"'),
            doc.fonts.load('600 16px "Playfair Display"'),
            doc.fonts.load('400 11px "Inter"'),
            doc.fonts.load('600 11px "Inter"'),
          ]), 3000);
        } catch { /* fallback stack is fine */ }
      }
      if (doc.fonts?.ready) { try { await doc.fonts.ready; } catch { /* font API absent — the fallback stack is fine */ } }


      // The zone pages are mostly photos, set as CSS backgrounds — which nothing waits for. Load
      // each one first (CORS-enabled, as html2canvas's useCORS will request it), so the capture
      // does not run while they are still blank. A slow or broken image gives up after 8s and
      // the card simply renders without it rather than stalling the whole export.
      const bgUrls = [...new Set([...doc.querySelectorAll("[data-bg]")].map(n => n.getAttribute("data-bg")).filter(Boolean))];
      await Promise.all(bgUrls.map(src => new Promise(res => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        const done = () => res();
        im.onload = done; im.onerror = done;
        setTimeout(done, 8000);
        im.src = src;
      })));

      const sheet = doc.getElementById("sheet");
      frame.style.height = Math.max(1200, sheet.scrollHeight + 80) + "px";
      await new Promise(r => setTimeout(r, 60));
      // Fonts are settled by now, so the true baselines measured in the report doc are final.
      restoreFillText = fixH2cTextBaseline(doc);

      const blocks = [...sheet.querySelectorAll("[data-block], section")];
      const blockSet = new Set(blocks);
      blocksSeen += blocks.length;
      let y = MARGIN;
      let first = true;
      // Set after a zone layout: the NEXT content block starts a fresh page. It is a flag rather
      // than pushing y to the page bottom, because the footer is allowed to stay on the layout's
      // page — forcing it over is what left a page holding nothing but the footer line.
      let afterOwnPage = false;
      let hasCover = false;
      // ── LOW-END DEVICES ── a phone with ≤4 cores or ≤4 GB reports itself through these, and gets a
      // smaller capture (~120 dpi on A4, still clear to read) — the per-page draw and JPEG encode
      // shrink with the square of the scale. Browsers that report neither are treated as capable.
      const lowEnd = (Number(navigator.hardwareConcurrency) || 8) <= 4 || (Number(navigator.deviceMemory) || 8) <= 4;
      const SCALES = lowEnd ? [1.15, 1] : [1.5, 1.25];
      let prevEl = null;
      for (const el of blocks) {
        // ── EACH CAPTURE COPIES ONE PAGE ── html2canvas clones the document for every block; the
        // blocks after this one were already left out (ignoreElements below), but every page
        // already drawn was still copied each time — page 19 dragged the 18 before it along. A
        // drawn block is now hidden: it has no layout, so this block's position is still read
        // correctly, and the hidden ones are left out of the clone as well.
        if (prevEl && !prevEl.contains(el)) prevEl.style.display = "none";
        prevEl = el;
        // A zone layout is a page of its own: always start it on a fresh page, and send the next
        // table to the next one, so a table never shares a sheet with a layout.
        const ownPage = el.hasAttribute("data-page");
        const isFooter = el.tagName === "FOOTER";
        if (!first && y > MARGIN && (ownPage || (afterOwnPage && !isFooter))) { newPage(); y = MARGIN; }
        afterOwnPage = false;
        // ── ONE BAD BLOCK MUST NOT LOSE THE WHOLE REPORT ──
        // html2canvas can fail on a single element for reasons that have nothing to do with the
        // other twenty — a photo that taints the canvas, a CSS value its 1.4 parser does not
        // understand, a block too tall for the browser's canvas limit. Unguarded, any one of
        // those threw out of the loop and the entire export failed, which is what a user sees as
        // "could not generate the PDF" even though nineteen pages were fine. Skipped blocks are
        // counted and reported at the end instead.
        // ── SAFARI'S CANVAS MEMORY ──
        // Safari caps the TOTAL memory all live canvases may hold, and every block here is a
        // full-width canvas at 2x (a zone page is ~14 MB). Nothing released them, so on a book of
        // twenty-odd pages Safari ran out partway and every block after that failed — "16 sections
        // could not be drawn", with every photo perfectly loadable. Each canvas is now emptied the
        // moment its JPEG is taken (width/height 0 is what makes Safari hand the memory back), and
        // a block that still fails is retried at a lower scale before it is given up on.
        const freeCanvas = (c) => { try { if (c) { c.width = 0; c.height = 0; } } catch { /* already gone */ } };
        let img = null, canvas = null, lastErr = null;
        // ── SPEED ──
        // html2canvas clones the WHOLE document for every call, photos and all, so a 19-page
        // book was cloned 19 times over. ignoreElements leaves the blocks AFTER this one out of
        // the clone. Only the ones after: html2canvas crops at this block's position in the real
        // page, so dropping a block above it would shift it up and capture the wrong strip.
        // Scale 1.5, not 2: ~160 dpi on A4, sharp on screen and in print, and just over half the
        // pixels to draw and encode per page.
        const ignoreElements = (n) => blockSet.has(n) && !n.contains(el) && !el.contains(n) && (n.style.display === "none" || !!(el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
        // Each scale in turn, then — as a last resort — the section again WITHOUT its photos: a
        // section missing its photo is still the crew's list of what goes where; a section missing
        // altogether is not. Photos are stripped in html2canvas's own copy (onclone), never here.
        const tries = [...SCALES.map(sc => ({ scale: sc, strip: false })), { scale: SCALES[SCALES.length - 1], strip: true }];
        for (let ti = 0; ti < tries.length; ti++) {
          const { scale, strip } = tries[ti];
          const onclone = strip ? (cdoc) => {
            cdoc.querySelectorAll("[data-bg]").forEach(n => { n.style.backgroundImage = "none"; });
            // Every other CSS background image too (the page pattern, anything added later): any
            // image the browser refuses to read back must not survive into the last-resort try.
            const st = cdoc.createElement("style"); st.textContent = "*{background-image:none!important}";
            (cdoc.head || cdoc.documentElement).appendChild(st);
            cdoc.querySelectorAll("img").forEach(im => { if (!String(im.getAttribute("src") || "").startsWith("data:")) im.style.visibility = "hidden"; });
          } : undefined;
          try {
            canvas = await html2canvas(el, { scale, backgroundColor: "#F4F1EA", logging: false, useCORS: true, windowWidth: 794, ignoreElements, onclone });
          } catch (blockErr) { lastErr = blockErr; canvas = null; await new Promise(r => setTimeout(r, 80)); continue; }
          // Nothing drawn (an element with no height) must not cost a page either.
          if (!canvas.width || canvas.height < 4) break;
          try {
            img = canvas.toDataURL("image/jpeg", 0.85);
            if (strip) photoless += 1;
            break;
          } catch (taintErr) {
            // A tainted canvas: a photo served without CORS headers was drawn into it, and the
            // browser refuses to let its pixels be read back. A lower scale will not change that,
            // so it goes straight to the photo-less try.
            lastErr = taintErr; freeCanvas(canvas); canvas = null;
            if (!strip) ti = tries.length - 2;
          }
        }
        if (!img) {
          if (canvas) { freeCanvas(canvas); continue; }   // drew, but empty — not a failure
          console.error("PDF: skipped a block that failed to render", el.className || el.tagName, lastErr);
          skipped.push({ what: el.className || el.tagName, why: String(lastErr?.message || lastErr || "unknown") });
          continue;
        }
        const h = (canvas.height * usableW) / canvas.width;   // scaled to the content column
        freeCanvas(canvas); canvas = null;                    // the JPEG is all we need from here
        if (el.hasAttribute("data-cover")) {
          // Full bleed: the cover is drawn across the whole page, no margin, and whatever follows
          // starts on page two.
          if (!first) newPage();
          pdf.addImage(img, "JPEG", 0, 0, pageW, pageH);
          coverPages.add(pdf.internal.getNumberOfPages());
          y = pageH; afterOwnPage = true; first = false; hasCover = true;
          continue;
        }
        // With a cover, the footer's only job (saying whose book this is) is already done by it —
        // never let the footer be the sole thing on an extra page.
        if (isFooter && hasCover && y + h > pageH - MARGIN) continue;
        if (ownPage && h > usableH) {
          // A zone layout is one page by design. If it comes out a little taller than the page,
          // shrink it to fit rather than slicing it: slicing is what left a page holding nothing
          // but the overflow strip of dot pattern.
          const k = usableH / h, w = usableW * k;
          pdf.addImage(img, "JPEG", MARGIN + (usableW - w) / 2, MARGIN, w, usableH);
          y = pageH; afterOwnPage = true; first = false;
          continue;
        }
        if (isFooter && y + h <= pageH - MARGIN) {
          // The footer closes the last page, sitting on its bottom margin wherever the content
          // above it ended, instead of starting a page of its own.
          pdf.addImage(img, "JPEG", MARGIN, pageH - MARGIN - h, usableW, h);
          y = pageH;
        } else if (h <= usableH) {
          // Fits whole. Start a new page if it will not fit in what is left of this one.
          if (!first && y + h > pageH - MARGIN) { newPage(); y = MARGIN; }
          pdf.addImage(img, "JPEG", MARGIN, y, usableW, h);
          y += h + 10;
        } else {
          // Taller than a whole page — the only case we cut. Walk it down page by page.
          // ── CUT BETWEEN ROWS, NOT THROUGH THEM ──
          // Each page used to take exactly one page-height of the image, wherever that fell, so a
          // table row straddling the line was sliced in half — its top on one page, the rest on
          // the next with the letters' tops shaved off. The bottom of every row, paragraph and
          // heading is measured in the laid-out block (scaled to PDF units) and each page ends
          // at the last of those that fits.
          const box = el.getBoundingClientRect();
          const k = usableW / (box.width || 1);
          const breaks = [...el.querySelectorAll("tr, p, .sh")]
            .map(n => (n.getBoundingClientRect().bottom - box.top) * k)
            .sort((a, b) => a - b);
          if (!first && y > MARGIN) { newPage(); }
          let drawn = 0;
          while (drawn < h - 1) {
            if (drawn > 0) newPage();
            let end = drawn + usableH;
            // A cut leaving less than a fifth of the page used means one giant row — slice that instead.
            if (end < h - 1) { const cut = breaks.filter(b => b > drawn + usableH * 0.2 && b <= end).pop(); if (cut) end = cut; }
            pdf.addImage(img, "JPEG", MARGIN, MARGIN - drawn, usableW, h);
            // Mask whatever of the image spills past this page's cut and into the top margin.
            pdf.setFillColor(244, 241, 234);
            pdf.rect(0, MARGIN + (end - drawn), pageW, pageH, "F");
            pdf.rect(0, 0, pageW, MARGIN, "F");
            drawn = end;
          }
          y = pageH;   // force the next block onto a fresh page
        }
        if (ownPage) afterOwnPage = true;
        first = false;
      }
        // This department is drawn; release its iframe before building the next one, so a
        // seven-department export holds one document at a time rather than seven.
        restoreFillText?.(); restoreFillText = null;
        frame.remove(); frame = null;
      }

      // Every single block failed — there is no report, only blank pages. Hand this to the
      // fallback rather than saving an empty file that looks like success.
      if (skipped.length && skipped.length === blocksSeen) throw new Error(`every section failed to render (${skipped.length})`);

      // Page numbers, added once the total is known. A cover carries no number — it would sit
      // on the photo — so each page in coverPages is skipped rather than assuming it is page one:
      // a combined book has one cover per department, not only at the front.
      const total = pdf.internal.getNumberOfPages();
      for (let p = 1; p <= total; p++) {
        if (coverPages.has(p)) continue;
        pdf.setPage(p);
        pdf.setFontSize(8);
        pdf.setTextColor(122, 116, 104);
        pdf.text(`${String(p).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, pageW - MARGIN, pageH - 12, { align: "right" });
      }

      // Filename is what the file is called in someone's Downloads folder a month later, so it
      // carries all three identifiers. Slashes and colons are illegal in filenames on Windows.
      const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
      const fileName = `${safe(multi ? "All departments" : depts[0])} - ${safe(sel?.clientName || "Event")} - ${safe(selDateStr || "no date")}.pdf`;
      // A download is the newest build, so the next View deck must not reopen an older one.
      if (!view && deckCacheRef.current) { URL.revokeObjectURL(deckCacheRef.current.url); deckCacheRef.current = null; }
      if (view) {
        const url = URL.createObjectURL(pdf.output("blob"));
        if (deckCacheRef.current) URL.revokeObjectURL(deckCacheRef.current.url);
        deckCacheRef.current = { key: cacheKey, url, name: fileName };
        setDeckView({ url, name: fileName });
      }
      else pdf.save(fileName);
      ok = true;
      // Said out loud, because a report quietly missing a page is worse than one that failed
      // outright — you would only find out when the crew on site needed the page that is gone.
      if (skipped.length) {
        // Name the actual error — "usually a photo" sent people chasing photos that were fine.
        const why = [...new Set(skipped.map(s => s.why))].slice(0, 2).join(" · ");
        alert(`The PDF ${view ? "is ready" : "saved"}, but ${skipped.length} section${skipped.length === 1 ? "" : "s"} could not be drawn and ${skipped.length === 1 ? "is" : "are"} missing from it.${photoless ? `\n\n${photoless} other section${photoless === 1 ? " is" : "s are"} in it without ${photoless === 1 ? "its" : "their"} photos.` : ""}\n\nReason: ${why}\n\nTry again in Chrome if this keeps happening.`);
      } else if (photoless) {
        alert(`The PDF ${view ? "is ready" : "saved"}. ${photoless} section${photoless === 1 ? " is" : "s are"} in it without ${photoless === 1 ? "its photo" : "their photos"} — this browser would not let them be drawn. Every item and quantity is there.\n\nFor the photos too, download it in Chrome.`);
      }
    } catch (err) {
      // The app was redeployed under this tab: a reload fixes it, the HTML fallback would not.
      if (isStaleChunk(err)) { reloadForUpdate(); return; }
      // ── THE FALLBACK IS A FILE, NOT A POP-UP ──
      // This used to call window.open here. It could never work: by the time we reach this
      // catch we are many awaits past the click, so the browser no longer counts it as
      // user-initiated and blocks it every time — the "pop-up fallback was blocked" message was
      // not a browser setting to change, it was this bug. Opening the window up front instead
      // would flash an empty tab on every successful export.
      // A Blob download needs no pop-up and leaves something usable: the report as an .html
      // file, which opens in any browser and prints to PDF from there.
      console.error("PDF export failed, falling back to an HTML download:", err);
      // In a combined export this falls back to whichever department the failure landed on, not
      // the whole book — rebuilding every remaining department's HTML here would risk a second
      // failure in the same code path that just failed. The filename says so, so a partial
      // download is never mistaken for the complete set.
      try {
        const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
        const blob = new Blob([buildReportHtml(zoneLabels, logos)], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safe(multi ? `${dept} (partial — combined export failed)` : dept)} - ${safe(sel?.clientName || "Event")} - ${safe(selDateStr || "no date")}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoked on a timer, not immediately: Chrome cancels an in-flight download if the
        // object URL disappears in the same tick as the click.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        alert(`The PDF could not be generated, so the report downloaded as an HTML file instead — open it and print to PDF.\n\nReason: ${err?.message || err}`);
      } catch (fallbackErr) {
        console.error("PDF: the HTML fallback failed too", fallbackErr);
        alert(`Could not produce the report.\n\n${err?.message || err}`);
      }
    } finally {
      restoreFillText?.();
      frame?.remove();
      setExportNote("");
      // Put the tab back where the user left it — the switching above is a mechanism, not a
      // navigation they asked for.
      if (multi) setDept(startedOn);
      setExporting(false);
    }
    return ok;
  };

  // Declared after exportPdf on purpose: a const referenced above its own declaration is a
  // TDZ error the build does not catch.
  const exportDeptPdf = (depts) => exportPdf(Array.isArray(depts) && depts.length ? depts : [dept]);

  // Started from Studio's Deal Check ("All departments PDF"): IMS runs hidden in a frame, selects that event
  // and builds the combined book exactly as the Download PDF button does, then tells Deal Check how it went.
  // A few seconds' wait first lets the event's inventory, settings and blocks finish arriving, so the book
  // is not drawn from a half-loaded page. Alerts (a skipped section…) are passed on instead of popping up
  // in a frame nobody can see.
  const autoPdfStartedRef = useRef(false);
  useEffect(() => {
    if (!autoPdfFor || autoPdfStartedRef.current || selId !== autoPdfFor || !sel) return undefined;
    const t = setTimeout(async () => {
      if (autoPdfStartedRef.current) return;
      autoPdfStartedRef.current = true;
      const tell = (phase, extra = {}) => { try { window.parent?.postMessage({ type: "ambria-dept-pdf", phase, ...extra }, window.location.origin); } catch { /* not framed */ } };
      const notes = [];
      const realAlert = window.alert;
      window.alert = (m) => { notes.push(String(m).split("\n")[0]); };
      let ok = false;
      try {
        if (!deptsWithWork.length) { tell("error", { reason: "No department plan on this event yet — sync it from Deal Check first" }); return; }
        pdfAllCarpetsRef.current = true;
        ok = await exportPdf(deptsWithWork);
      } finally { window.alert = realAlert; pdfAllCarpetsRef.current = false; }
      tell(ok ? "done" : "error", { notes });
      onAutoPdfDone?.();
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPdfFor, selId, sel, deptsWithWork]);
  // What the department PDF is built from. The item photos come from inventory, not the event, so a
  // photo added since must count too; floral cards also read the recipes and the mandi list.
  const deckKeyNow = () => {
    try { return dept + "|" + JSON.stringify(sel) + "|" + JSON.stringify(inventory) + "|" + JSON.stringify(flowerPatterns) + "|" + JSON.stringify(mandiCatalogue); } catch { return ""; /* unkeyable — just rebuild */ }
  };
  // ── AN OPEN PDF FOLLOWS THE EVENT ──
  // Studio now pushes a booked deal's edits to this event on its own, and the row arrives here over
  // realtime. With the viewer open on the old PDF, it is rebuilt from the new data and swapped in,
  // a moment after the changes stop arriving so a burst of updates is one rebuild.
  const deckKey = deckView ? deckKeyNow() : "";
  useEffect(() => {
    if (!deckView || !deckKey || exporting || deckCacheRef.current?.key === deckKey) return;
    const t = setTimeout(() => exportPdf([dept], { view: true, cacheKey: deckKey, gate: false }), 1500);
    return () => clearTimeout(t);
  }, [deckKey, !!deckView, exporting]);
  const viewDeptPdf = () => {
    const key = deckKeyNow();
    const c = deckCacheRef.current;
    if (key && c && c.key === key) { setDeckView({ url: c.url, name: c.name }); return; }
    exportPdf([dept], { view: true, cacheKey: key });
  };

  // ── VIEW CONTROLS: nearby count, activity bell, Planning / On-site ──
  // ONE home: the right-hand end of the event header. They had been split across two — the
  // income panel's figure row in Planning, a row of their own above the tiles in On-site — so
  // the same two controls moved every time you flipped the view, and in On-site they sat on a
  // strip that existed only to hold them. The header renders in both views, sits outside the
  // planning-only block (so On-site keeps its way back to Planning), travels with the event
  // these controls scope, and had an empty right half since the toggle last moved out of it.
  // Split in two so a phone can place them apart: the bell and PDF icons ride the title row's
  // top-right corner, and the Planning / On-site switch gets a full-width row of its own. Wrapped
  // together as one group they broke onto a second line in no particular order, which is most
  // of what made the header read as cluttered. From sm they sit side by side again.
  const actionIcons = sel ? (
  <div className="flex items-center gap-1.5 shrink-0">
    {/* ── ACTIVITY BEHIND A BELL ──
        The log was a permanent panel between the header and the content, so an
        event with two edits pushed the whole page down to say so — every time, even
        on the hundredth visit. It is a notification, not a section: it belongs on a
        count you can ignore. The bell only renders when there IS something, so an
        untouched event shows nothing at all rather than an empty panel. */}
    {recentChanges.length > 0 && (
      <button onClick={() => setLogOpen(true)}
        className="group relative shrink-0 w-7 h-7 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-600 flex items-center justify-center transition-colors">
        <IconBell s={13} />
        {/* -top/-right so the badge overhangs the button instead of shrinking the
            glyph to make room for it. */}
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-red-500 text-white text-[9px] font-bold leading-[14px] text-center tabular-nums ring-2 ring-white">{recentChanges.length}</span>
        <span className="sr-only">Activity log — {recentChanges.length} recent changes</span>
        {/* A drawn tooltip rather than the native `title`: title waits about a
            second before appearing, which is long enough that people click the
            unlabelled bell to find out what it is instead of waiting.
            Drops BELOW the bell — above would put it behind the sticky page header.
            right-0 so it grows leftward and cannot push the header wider.
            pointer-events-none so it never intercepts the click it is describing. */}
        <span role="tooltip" className="pointer-events-none absolute top-full right-0 mt-2 z-20 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          Activity log
        </span>
      </button>
    )}
    {/* ── EXPORT THIS DEPARTMENT ──
        Sits with the bell rather than inside a panel, because the report covers ALL of the
        panels — money, inventory, crew, spend, trucks, dismantle — so it cannot belong to any
        one of them. Here it is also scoped the way the page is: whatever department and event
        the header names is exactly what the PDF contains.
        Icon-only, like the bell: spelled out it was the widest thing in a row that already has
        two tags to fit on a 390px screen. The tooltip and the sr-only label carry the meaning. */}
    {/* ── PHONE: ALL DEPARTMENTS TOO ──
        The "Download PDF" button for the whole event sits in the department row, which on a phone is
        a dropdown with no room for it — so on a phone the icon opens a two-choice menu instead (when
        the event has more than one department): this department, or every department in one file. */}
    {deptsWithWork.length > 1 && (
      <div className="sm:hidden relative shrink-0">
        <button onClick={() => setDlMenuOpen(o => !o)} disabled={!!exporting} aria-haspopup="menu" aria-expanded={dlMenuOpen}
          className="relative w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 disabled:opacity-60 flex items-center justify-center transition-colors">
          {exporting === "download"
            ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
            : <IconDownload />}
          <span className="sr-only">Download PDF</span>
        </button>
        {dlMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setDlMenuOpen(false)} />
            <div role="menu" className="absolute right-0 top-full mt-2 z-40 w-56 rounded-xl bg-white border border-gray-200 shadow-[0_14px_32px_-10px_rgba(15,23,42,0.35)] p-1">
              <button role="menuitem" onClick={() => { setDlMenuOpen(false); exportDeptPdf(); }}
                className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100">
                {DEPT_ICON[dept]} {dept} only
              </button>
              <button role="menuitem" onClick={() => { setDlMenuOpen(false); exportDeptPdf(deptsWithWork); }}
                className="w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-semibold text-blue-700 hover:bg-blue-50 active:bg-blue-100">
                📚 All {deptsWithWork.length} departments
                <span className="block text-[11px] font-normal text-gray-400">One PDF, every department</span>
              </button>
            </div>
          </>
        )}
      </div>
    )}
    <button onClick={() => exportDeptPdf()} disabled={!!exporting}
      className={(deptsWithWork.length > 1 ? "hidden sm:flex " : "flex ") + "group relative shrink-0 w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 disabled:opacity-60 items-center justify-center transition-colors"}>
      {exporting === "download"
        ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
        : <IconDownload />}
      <span className="sr-only">{exporting === "download" ? "Building the PDF…" : "Download this department as PDF"}</span>
      <span role="tooltip" className="pointer-events-none absolute top-full right-0 mt-2 z-20 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {exporting === "download" ? "Building the PDF…" : `Download ${dept} as PDF`}
      </span>
    </button>
    {/* ── VIEW DECK ──
        The same report the download button saves, opened on screen instead — on a tablet a
        downloaded file is hard to find again. Spelled out rather than icon-only like its
        neighbours: an eye alone does not say what it opens. Shares the download's busy state,
        since both run the one export (only the one you pressed spins). */}
    <button onClick={viewDeptPdf} disabled={!!exporting}
      className="shrink-0 h-7 px-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-900 text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-default disabled:opacity-60 transition-colors">
      {exporting === "view"
        ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
        : <IconEye />}
      View deck
    </button>
  </div>
  ) : null;
  const viewSwitch = sel ? (
  /* Sized to their labels at every width. As two full-width halves on a phone they were the
     largest controls on the card — bigger than the title they sit under. */
  <div className="flex items-center gap-1.5">
    {/* It briefly lived on the department row above — which does render in both views,
        but that row scrolls off the top the moment you start reading, and the switch
        was gone exactly when you wanted it. */}
    {/* ── STATUS TAGS, NOT A SEGMENTED TRACK ──
        Two standalone tags per the design system: the one you are on is filled soft blue with
        blue-700 text, the other is plain. The grey track they used to share made this read as a
        setting with an on and an off position; as two tags it reads as two places, which is
        what it is.
        Only the ACTIVE tag is outlined. Giving both a ring drew four boxes into one small
        corner — the bell's, two rings and the card's own edge — which is what made this corner
        read as clutter rather than as three controls. Unringed, the inactive tag is just a
        label until you want it, and the one that is outlined is the one that means something.
        28px tall, matching the bell. */}
    {[["planning", "Department Head", IconClipboard], ["onsite", "Site Supervisor", IconTruck]].map(([k, label, Icon]) => {
      const on = opsView === k;
      return (
        <button key={k} onClick={() => setOpsView(k)} aria-pressed={on}
          /* cursor-pointer is explicit: Tailwind v4 dropped the pointer cursor from buttons, so
             without it these gave no sign of being clickable even with a hover colour. The
             inactive tag previews the active one on hover (a soft blue wash and a blue icon),
             so the hover says where the click will take you; the active one only deepens a
             step, since clicking it does nothing new. */
          className={"group shrink-0 h-7 inline-flex items-center justify-center gap-1.5 px-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors "
            + (on
              ? "bg-blue-100 text-blue-700 ring-1 ring-blue-200 hover:bg-blue-200/70 shadow-[0_4px_10px_-4px_rgba(37,99,235,0.45)]"
              : "bg-white/70 shadow-[0_1px_3px_rgba(15,23,42,0.1),0_4px_10px_-6px_rgba(15,23,42,0.25)] text-gray-500 hover:bg-blue-50 hover:text-blue-700 hover:ring-1 hover:ring-blue-100")}>
          <span className={"transition-colors " + (on ? "text-blue-600" : "text-gray-400 group-hover:text-blue-500")}><Icon s={13} /></span>
          {label}
        </button>
      );
    })}
  </div>
  ) : null;

  return (
    /* ── STACKS BELOW xl ──
       Two columns only once there is room for both: the rail is a fixed 288px, so at 768px it
       took 40% of the viewport and on a phone it left the detail column ~90px wide, which is
       not a narrow layout but a broken one. Below xl the rail becomes a full-width block above
       the detail — same panel, same controls, just stacked.
       xl and not lg because the IMS shell's own nav rail takes 208px: at a 1024px viewport the
       content box is ~768px, and splitting that would hand 288px to the picker and ~460px to
       the thing you came to read. */
    /* ── ONE MEASURE FOR THE WHOLE TAB ──
       The single width cap for this page, and the only one — the department bar, the cards and
       the tiles all end on the same right edge because they all sit inside it. It used to be
       1484px, which was the arithmetic of the old two-column layout (288px event rail + 16px
       gap + a 1180px detail column). That rail is gone, so the sum meant nothing and the page
       simply stopped short of the space it had.
       Still capped rather than full-width: the IMS shell is left-aligned and unbounded, and past
       ~1600px the wide tables turn into strips with their content pinned to both far edges. */
    /* font-body on the whole tab, not just the event header card: with it on one card only,
       everything else fell back to the system font, so the page mixed two sans faces. */
    <div className="font-body antialiased space-y-4 xl:max-w-[1600px]">
      {/* ── DEPARTMENT PICKER ──
          Was a <select> buried at the top of the left rail. A dropdown hides its options until
          you open it, so the one thing that scopes this entire page — every figure, every tile,
          every dialog below it — gave no indication of what else it could be showing. Laid out
          flat, the whole set is readable and switching is one click instead of two.
          It sits above the columns rather than inside the rail because it scopes BOTH of them.
          The permission rule is carried over exactly: a user with a single department still gets
          a static badge, because there is nothing for them to switch to. */}
      {/* One row: the department picker on the left, the Planning / On-site switch on the right.
          The switch lives HERE rather than in the income panel, because that panel only renders
          in Planning view — putting the switch inside it would leave On-site with no way back.
          This row renders in both. */}
      {/* With a slot from PlanningTab, the phone picker is portalled into the section picker's
          row (see pickerSlot below) and this row is desktop-only; hidden rather than left empty,
          or its space-y gap would still open a blank band above the event. Without a slot it
          falls back to the old pulled-up placement. */}
      {pickerSlot && createPortal(
        <div className="sm:hidden">
          {roleDept && !isAdmin
            ? <span className="inline-flex px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-[13px] font-semibold whitespace-nowrap">{DEPT_ICON[roleDept]} {roleDept}</span>
            : <TabsMenu tabs={deptOptions.map(d => ({ id: d, label: `${DEPT_ICON[d]} ${d}` }))} active={dept} onChange={setDept} tone="accent" />}
        </div>,
        pickerSlot
      )}
      <div className={(pickerSlot ? "hidden sm:flex" : "flex") + " items-center justify-between gap-3 flex-wrap"}>
      {/* w-fit so the bar ends where the last department does. As a block element it stretched
          the full measure, leaving most of it empty white — a panel the width of the page reads
          as a section header rather than as the control it is.
          max-w-full keeps it inside the page on narrow screens, where the inner overflow-x
          takes over and the chips scroll instead. */}
      {/* The white card is sm-and-up only. On a phone this is one small dropdown, and the section
          dropdown directly above it has no card — a bare control next to a carded one reads as
          two unrelated things. Stripped here, the two stack as a matching pair. */}
      {/* ── PHONE: SHARE THE SECTION PICKER'S LINE ──
          The section dropdown is rendered by PlanningTab and this one by DepartmentOpsTab, so
          they are block siblings in a space-y-4 stack and cannot be put in one flex row without
          lifting `dept` state out of this component. Instead this row is pulled up onto that
          line: -48px = the control's own 32px height (py-2 ×2 + a 16px line) plus the 16px
          space-y-4 gap. The offset is safe because BOTH controls are now the same TabsMenu, so
          their heights cannot diverge — and ml-auto keeps this one on the right, clear of it.
          56 rather than the bare 48: this sits inside a `flex items-center` row that adds a few
          pixels of its own above the control, which the raw height calculation does not see. */}
      <div className="w-fit max-w-full ml-auto -mt-14 sm:mt-0 sm:ml-0 sm:bg-white sm:rounded-xl sm:shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] sm:px-3 sm:py-2">
        {/* Scrolls sideways rather than wrapping to a second row: eight departments at a phone
            width would otherwise turn a one-line control into a four-line block. Bar hidden, as
            everywhere else on this page. */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {/* The eyebrow earns its place beside a row of chips, where the row needs naming. Beside
              a dropdown that already reads "🛋 Furniture" it is just a second label for the same
              thing, so it drops out on phone. */}
          <span className="hidden sm:inline shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 pr-1.5">Department</span>
          {/* ── PHONE: THE SAME MENU THE SUB-TABS USE ──
              Eight chips on one scrolling line showed three, and the other five gave no sign
              they existed — a horizontal scroller with no visible edge reads as the whole list.
              The menu shows all eight at once and reuses TabsMenu, so the department picker and
              the section picker behave identically instead of being two different controls that
              happen to look alike. */}
          {!(roleDept && !isAdmin) && (
            <div className="sm:hidden">
              <TabsMenu tabs={deptOptions.map(d => ({ id: d, label: `${DEPT_ICON[d]} ${d}` }))} active={dept} onChange={setDept} tone="accent" />
            </div>
          )}
          {roleDept && !isAdmin ? (
            <span className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold whitespace-nowrap">{DEPT_ICON[roleDept]} {roleDept}</span>
          ) : deptOptions.map(d => {
            const on = dept === d;
            return (
              <button key={d} onClick={() => setDept(d)} aria-current={on ? "true" : undefined}
                className={"hidden sm:inline-flex shrink-0 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-150 " +
                  (on
                    ? "bg-blue-50 text-blue-700 font-semibold shadow-[0_1px_2px_rgba(37,99,235,0.14),0_4px_10px_-4px_rgba(37,99,235,0.3)]"
                    : "text-gray-600 font-medium hover:text-gray-900 hover:bg-gray-50 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_-6px_rgba(16,24,40,0.2)]")}>
                {DEPT_ICON[d]} {d}
              </button>
            );
          })}
          {/* ── ONE BOOK FOR THE WHOLE EVENT ──
              Sits after the last department because that is what it is: not another department,
              but every one of them in a single file, in the order of the row it follows.
              Only the departments that actually have something on this event are included — a
              seven-book file where four books are empty is worse than four books.
              Hidden until an event is picked, since there is nothing to export before that. */}
          {sel && deptsWithWork.length > 1 && (
            <button onClick={() => exportDeptPdf(deptsWithWork)} disabled={!!exporting}
              title={exporting === "download" ? "Building the PDF…" : `One PDF with all ${deptsWithWork.length} departments on this event`}
              className="hidden sm:inline-flex shrink-0 items-center gap-1.5 ml-1 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap border border-gray-200 bg-white text-gray-700 hover:text-gray-900 hover:bg-gray-50 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_-6px_rgba(16,24,40,0.2)] disabled:opacity-60 disabled:hover:translate-y-0 transition-all duration-150">
              {exporting === "download"
                ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
                : <IconDownload />}
              <span>{exporting === "download" && exportNote ? exportNote : "Download PDF"}</span>
            </button>
          )}
          {/* Only while an event's planning is older than an IMS setting / inventory change. */}
          <PlanningSyncButton eventOrders={eventOrders} onlyOrder={sel} />
        </div>
      </div>
      </div>

      {/* ── Department detail for the selected event ──
          The event-list rail that used to sit to the left of this is gone: the Calendar tab is
          now the one place an event is chosen, and it hands the choice over. This page shows
          whatever it was given.
          ── A MEASURE, NOT A CAP ──
          The IMS shell is full-width and left-aligned, which removed the dead margin — but it
          also let this column grow to ~2200px on a wide monitor. At that width every card
          became a strip with its content pinned to the two far edges: the event header read as
          empty in the middle, and the inventory table's ITEM column took half the row before
          DETAILS even started. max-w caps the READING width while min-w-0 keeps it
          left-aligned, so the gap does not come back — the space simply sits to the right of
          the content instead of inside it. */}
      {/* No cap of its own any more. 1180px was this column's share back when a 288px event rail
          sat to its left; with the rail gone it just left a dead strip down the right-hand side.
          The wrapper above still sets the reading measure, so the content fills that and stops. */}
      <div className="w-full min-w-0">
        {!sel ? (
          /* ── WHY THIS LEAD HAS NO PLANNING ──
             Landing here from an LMS lead in the Calendar tab, the search finds nothing and the
             detail pane sat on "Select an event", which reads as "pick one from the list" when
             the list is empty. The honest answer is that ops plans Studio deals, and this lead
             is not one yet — so say that, and say what to do about it. */
          search.trim() && events.length === 0 ? (
            <div className="max-w-md mx-auto text-center py-16 px-4">
              <div aria-hidden="true" className="text-3xl">📭</div>
              <div className="mt-3 text-sm font-semibold text-gray-800">“{search.trim()}” is not a Studio deal yet</div>
              <div className="mt-2 text-xs text-gray-500 leading-relaxed">
                This looks like an LMS lead. Ops plans from Studio deals only — build the event in
                Studio and mark it sold, and it will appear in this list on its own. Nothing needs
                to be created here.
              </div>
              {/* A filled button, not a text link. It is the only action on an otherwise dead
                  end, so it has to read as the way out — blue text on white was competing
                  with the body copy above it and losing.
                  The link carries the client name and, when we know it, the LMS entry number.
                  Studio sets those into its client-name field, which is what already drives its
                  LMS lead search, then loads the named contract through its own "Load →" path —
                  so the Event Info form opens filled in, not blank. */}
              <a href={`${import.meta.env.BASE_URL}#/studio?client=${encodeURIComponent(search.trim())}${leadEntry ? `&lmsRef=${encodeURIComponent(leadEntry)}` : ""}`}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(37,99,235,0.3),0_6px_16px_-6px_rgba(37,99,235,0.6)] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(37,99,235,0.3),0_12px_24px_-8px_rgba(37,99,235,0.65)] transition-all duration-150">
                <span aria-hidden="true">🎨</span>
                Build this deal in Studio
                <span aria-hidden="true">→</span>
              </a>
            </div>
          ) : (
            /* ── PICK AN EVENT, RIGHT HERE ──
               A month grid of the events this page can actually plan, so choosing one no longer
               means a round trip to the Calendar tab. Deliberately NOT the Calendar tab's grid:
               that one lists every LMS lead, and most of those have no Studio deal behind them —
               they would be un-clickable rows on a page whose whole job is planning a sold deal.
               This shows only what `events` already holds: live, sold event_orders. */
            (() => {
              const { y, m } = pickMonth;
              const first = new Date(y, m, 1);
              const startDow = first.getDay();
              const dim = new Date(y, m + 1, 0).getDate();
              const pad = (n) => String(n).padStart(2, "0");
              // Changing month clears the open day — its date belongs to the month you just left,
              // so the list underneath would keep showing events that are no longer on the grid.
              const prev = () => { setPickDay(null); setPickMonth(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }); };
              const next = () => { setPickDay(null); setPickMonth(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }); };
              const cells = [];
              for (let i = 0; i < startDow; i++) cells.push(null);
              for (let d = 1; d <= dim; d++) cells.push(d);
              while (cells.length % 7 !== 0) cells.push(null);   // close the last week
              const monthTotal = Object.values(pickByDate).reduce((s, a) => s + a.length, 0);
              // The phone grid shows the real dates either side of the month instead of blanks,
              // greyed out. A blank corner reads as a rendering fault; "27 28 29 30" reads as
              // the week continuing, which is what a calendar is supposed to show.
              const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
              const mCells = [];
              for (let i = startDow; i > 0; i--) { const dt = new Date(y, m, 1 - i); mCells.push({ d: dt.getDate(), ds: iso(dt), out: true }); }
              for (let d = 1; d <= dim; d++) mCells.push({ d, ds: `${y}-${pad(m + 1)}-${pad(d)}`, out: false });
              for (let i = 1; mCells.length % 7 !== 0; i++) { const dt = new Date(y, m + 1, i); mCells.push({ d: dt.getDate(), ds: iso(dt), out: true }); }
              const dayLabel = pickDay ? new Date(pickDay + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "";
              return (
                <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden">
                  <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Pick an event to plan</div>
                      <h3 className="mt-0.5 text-base font-bold text-gray-900 tracking-tight">{first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
                      <div className="text-[11px] text-gray-500 mt-0.5">{monthTotal} sold event{monthTotal === 1 ? "" : "s"} this month · {DEPT_ICON[dept]} {dept}</div>
                    </div>
                    {/* Today as a pill, the arrows as circles — the arrows are a pair doing one
                        job and the pill is a separate one, so they should not look alike. Drawn
                        chevrons rather than ‹ › glyphs, which sit off-centre in most faces. */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => { setPickDay(null); setPickMonth({ y: _now.getFullYear(), m: _now.getMonth() }); }}
                        className="px-3 h-9 rounded-full text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition">Today</button>
                      <button onClick={prev} title="Previous month" aria-label="Previous month"
                        className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 transition">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3.5 L5 7 L9 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      <button onClick={next} title="Next month" aria-label="Next month"
                        className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 transition">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  </div>
                  {/* ── PHONE LAYOUT ──
                      Seven columns of 84px cells with a name chip inside each is a desktop shape;
                      at phone width a column is ~45px, so the chips truncate to two characters
                      and the month becomes unreadable. Below sm the grid collapses to dates only
                      — a dot marks a day that has events — and tapping a date lists that day's
                      events underneath at full width, where the names actually fit. */}
                  <div className="sm:hidden">
                    <div className="grid grid-cols-7 px-2">
                      {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                        <div key={i} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 py-2">{d}</div>
                      ))}
                    </div>
                    {/* Every date is a filled tile, not a bare number on white. It gives each day
                        a real edge to aim at on a touch screen, and it is what separates the
                        month from the days either side of it without needing a rule. */}
                    <div className="grid grid-cols-7 px-2 pb-3 gap-1">
                      {mCells.map(({ d, ds, out }) => {
                        const evs = out ? [] : (pickByDate[ds] || []);
                        const isToday = ds === today;
                        const on = pickDay === ds;
                        return (
                          <button key={ds} onClick={() => !out && evs.length && setPickDay(on ? null : ds)}
                            disabled={out || !evs.length}
                            aria-label={`${ds}${evs.length ? ` — ${evs.length} event(s)` : ""}`}
                            className={"h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors "
                              + (on ? "bg-blue-600"
                                : out ? "bg-transparent"
                                : evs.length ? "bg-blue-50 active:bg-blue-100"
                                : "bg-gray-50")}>
                            <span className={"text-[13px] tabular-nums leading-none "
                              + (on ? "text-white font-bold"
                                : out ? "text-gray-300 font-normal"
                                : evs.length ? "text-blue-800 font-bold"
                                : isToday ? "text-blue-600 font-bold" : "text-gray-600 font-medium")}>{d}</span>
                            {/* A dot only where there is something — the tile tint already says
                                it too, but the dot survives at a glance when the row is scanned
                                rather than read. */}
                            <span className={"w-1.5 h-1.5 rounded-full " + (on ? "bg-white" : evs.length ? "bg-blue-500" : "bg-transparent")} />
                          </button>
                        );
                      })}
                    </div>
                    {(() => {
                      const dayEvs = pickDay ? (pickByDate[pickDay] || []) : [];
                      if (!pickDay) return <div className="px-4 pb-5 pt-1 text-center text-xs text-gray-400">Tap a highlighted date to see its events.</div>;
                      return (
                        <div className="px-3 pb-4 pt-1">
                          {/* Heading and count on one line, the count as a small pill so it reads
                              as a tally rather than a second, fainter heading. */}
                          <div className="flex items-center justify-between gap-2 px-1 pb-3">
                            <span className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">Events on {dayLabel}</span>
                            <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums">{dayEvs.length} event{dayEvs.length === 1 ? "" : "s"}</span>
                          </div>
                          <div className="space-y-2.5">
                            {dayEvs.map(eo => (
                              <button key={eo.id} onClick={() => setSelId(eo.id)}
                                className="w-full text-left rounded-xl bg-gray-50 ring-1 ring-gray-100 hover:bg-blue-50 hover:ring-blue-100 active:bg-blue-100 px-4 py-3.5 flex items-center gap-3.5 cursor-pointer transition-colors">
                                <span aria-hidden="true" className="shrink-0 w-2 h-2 rounded-full bg-blue-500 ring-4 ring-blue-100" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[15px] font-semibold text-gray-900 leading-snug truncate">{eo.clientName || "Event"}</span>
                                  {/* Venue and shift, because that is what an event_order actually
                                      carries — there are no start/end times on one to show. */}
                                  <span className="mt-0.5 block text-xs text-gray-500 truncate">
                                    {eo.functionsDetail?.[0]?.venue || eo.venue || "—"}
                                    {eo.functionsDetail?.[0]?.shift ? ` · ${eo.functionsDetail[0].shift}` : ""}
                                  </span>
                                  {/* Own line, not tacked onto venue/shift above — that span already
                                      truncates, and venue+shift alone was often long enough to push
                                      "booked by {name}" past the ellipsis before it ever rendered. */}
                                  {eo.salesperson && <span className="block text-xs text-gray-400 truncate">Booked by {eo.salesperson}</span>}
                                </span>
                                <span aria-hidden="true" className="shrink-0 text-gray-400">
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="hidden sm:grid grid-cols-7">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                      <div key={d} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 py-2.5">{d}</div>
                    ))}
                  </div>
                  <div className="hidden sm:grid grid-cols-7 gap-px bg-gray-100">
                    {cells.map((d, i) => {
                      if (!d) return <div key={"e" + i} className="min-h-[84px] bg-gray-50/70" />;
                      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
                      const evs = pickByDate[ds] || [];
                      const isToday = ds === today;
                      return (
                        <div key={d} className={"min-h-[84px] p-1.5 bg-white " + (isToday ? "bg-blue-50/60" : "")}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={"tabular-nums leading-none " + (isToday ? "bg-blue-600 text-white text-[11px] font-bold rounded-full w-[20px] h-[20px] flex items-center justify-center" : "text-[12px] font-semibold text-gray-600")}>{d}</span>
                          </div>
                          <div className="space-y-1">
                            {/* Each event is its own button — clicking a DAY would be ambiguous on
                                a date carrying two events, and this page can only show one. */}
                            {evs.map(eo => (
                              <button key={eo.id} onClick={() => setSelId(eo.id)} title={`Plan ${eo.clientName || "Event"}${eo.salesperson ? ` · booked by ${eo.salesperson}` : ""}`}
                                className="w-full text-left text-[11px] font-medium leading-tight pl-2 pr-1.5 py-1 rounded-md truncate border-l-[3px] border-blue-500 bg-blue-50/80 text-blue-900 hover:bg-blue-100 transition-colors">
                                {eo.clientName || "Event"}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {monthTotal === 0 && (
                    <div className="px-4 py-3 text-center text-[11px] text-gray-400">
                      No sold events this month — page to another month{onGoToCalendar ? ", or open the Calendar to see every LMS lead" : ""}.
                      {onGoToCalendar && <button onClick={onGoToCalendar} className="ml-1 font-semibold text-blue-600 hover:text-blue-800">Open Calendar →</button>}
                    </div>
                  )}
                </div>
              );
            })()
          )
        ) : (
          <div className="space-y-4">
            {/* ── EVENT HEADER ──
                The department emoji moves out of the title text into a tile. Inline, it was
                set at heading size and competed with the words; in a tile it becomes the mark
                you find the department BY and the title reads as one phrase.
                The Planning / On-site switch moves up here from below the Recent-changes
                panel. It decides what the whole right-hand column shows, so it belongs beside
                the thing it scopes rather than buried between two content cards. Same two
                buttons and the same setOpsView — relocated, not added to. */}
            {/* Full width, like every other card in this column — it is the event's header, so it
                spans what it heads. Only the height came down: the icon tile, the chevron and the
                type each dropped a step (see below), which is what made the bar thinner without
                changing what it holds.
                justify-between gives the bell and the Planning / On-site switch the far right of
                this row — see `viewControls` for why they belong here and nowhere else. */}
            {/* ── CARD CONTAINER (design system §7) ──
                rounded-2xl on a soft, wide shadow rather than the tight hairline the other cards
                use. This is the one card on the page that names what everything below it is
                about, so it is allowed to sit a little further off the ground than they do.
                font-body puts Inter on the card's running text; the title takes Playfair from
                font-display below. Scoped to this card and not to `body`, because Studio has its
                own typography and is not part of this system. */}
            {/* ── TWO ROWS ON A PHONE ──
                Row one is the event: back, title block, and the bell / PDF icons in its corner.
                Row two, under a hairline, is the Planning / On-site switch at full width. From sm
                it is one row again with every control at the right end. */}
            <div className={"font-body rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] px-3 py-2.5 " + GLASS + " sm:flex sm:items-center sm:justify-between sm:gap-2"}>
              <div className="flex items-start sm:items-center gap-2.5 sm:gap-2 min-w-0">
                {/* ── THE WAY BACK ──
                    Picking an event on the calendar replaces it with this header, and there was
                    no route back — the calendar only renders while nothing is selected, so the
                    only escape was reloading the tab.
                    It clears `search` as well as the selection: arriving from an unmatched LMS
                    lead leaves a client name in there, and with it still set the empty-list
                    branch would show "not a Studio deal yet" instead of the calendar. */}
                <button onClick={() => { setSelId(null); setSearch(""); }}
                  title="Back to the calendar" aria-label="Back to the calendar"
                  className="group shrink-0 w-8 h-8 rounded-lg bg-white ring-1 ring-gray-200 hover:ring-gray-300 hover:bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors">
                  <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path d="M9.5 3.5 L5 7.5 L9.5 11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {/* The system draws this as a photo of the item. There is no image on a
                    department — it is a category, not a product — so the tile keeps the
                    department's emoji and takes the system's shape and soft-blue ground
                    instead. Blue rather than grey also separates it from the back button
                    beside it, which is now white: two grey squares side by side read as a
                    pair of buttons, and only one of them is one. */}
                {/* Hidden on a phone: the title already names the department, and at that width
                    a second square beside the back button read as two buttons. */}
                <span aria-hidden="true" className="hidden sm:flex shrink-0 w-8 h-8 rounded-lg bg-blue-100 items-center justify-center text-[15px] leading-none">{DEPT_ICON[dept]}</span>
                <div className="min-w-0 flex-1">
                  {/* ── TEXT ELEMENTS (design system §8) ──
                      Playfair SemiBold for the title, Inter Regular for the line under it — the
                      system's one typographic rule, serif for what names the thing and sans for
                      what describes it.
                      The spec sets H2 at 22 and body at 16, drawn at desktop width. Both are held
                      a step down on a phone — 16 and 12. At the spec's sizes this card was the
                      tallest thing above the fold on a 390px screen and its two rows ran into
                      each other, which is the whole reason it read as big and clustered. Playfair
                      also carries more weight per pixel than the sans it replaced, so 16px here
                      is not smaller than the 15px plain title it started as. Full spec sizes
                      from sm up, where there is room for them. */}
                  {/* Inter, not Playfair. The serif was the only one on the page, set beside an
                      Inter card and system-font content, so the header read as a third typeface
                      rather than as a title. One face at a heavier weight and slightly tighter
                      tracking does the same job. */}
                  {/* Fabric shortfalls sit beside the name rather than as a tile among the panels: it is a
                      warning about OTHER upcoming events, not a part of this one, and up here it is the
                      first thing seen. Opens the same panel the tile did. */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0 text-[16px] sm:text-[20px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight sm:leading-snug truncate">{dept} — {sel.clientName || "Event"}</div>
                    {dept === "Fabric" && upcomingFabricShort.length > 0 && (
                      <button type="button" onClick={() => setModal(m => m === "fabshort" ? null : "fabshort")} aria-pressed={modal === "fabshort"}
                        title={modal === "fabshort" ? "Close the fabric shortfalls" : "Upcoming events short on fabric — order ahead"}
                        className={"shrink-0 inline-flex items-center gap-1 whitespace-nowrap rounded-full ring-1 text-[11px] sm:text-[12px] font-semibold px-2.5 py-0.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 " + (modal === "fabshort" ? "bg-red-600 ring-red-600 text-white hover:bg-red-700" : "bg-red-50 ring-red-200 text-red-700 hover:bg-red-100")}>
                        <span aria-hidden="true">⚠</span>Fabric shortfalls · {upcomingFabricShort.length}
                      </button>
                    )}
                  </div>
                  {/* Wraps to a second line on a phone rather than truncating. Three facts are
                      joined here — date, venue, who touched it last — and a single line at 390px
                      always cut the third one mid-name, which is the one piece you would be
                      reading it for. Capped at two lines so a long venue cannot push the card
                      taller than the tiles it sits above; from sm there is room for one line and
                      it truncates as before. */}
                  <div className="text-[12px] sm:text-sm text-gray-500 leading-snug line-clamp-2 sm:truncate">{selDateStr || "no date"} · {sel.functionsDetail?.[0]?.venue || sel.venue || "—"}{sel.salesperson ? ` · booked by ${sel.salesperson}` : ""}{deptData.updatedBy ? ` · last edited by ${deptData.updatedBy}` : ""}</div>
                  {/* Deal value — read-only mirror of Studio's negotiated amount (client_ledger),
                      written whenever Deal Check syncs. It stays frozen once booked by owner decision;
                      "pending" is the live build's drift since booking, shown here so ops sees the same
                      number Studio does, but only Studio can fold it into the deal value (Apply button
                      on the Summary hero) — this view has no action for it. */}
                  {sel.dealValue && (
                    <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-gray-500">Deal value <span className="font-semibold text-gray-900 tabular-nums">₹{Number(sel.dealValue.amount || 0).toLocaleString("en-IN")}</span></span>
                      {!!sel.dealValue.pending && (
                        <span className={"font-bold px-1.5 py-0.5 rounded text-[11px] " + (sel.dealValue.pending > 0 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                          {sel.dealValue.pending > 0 ? "+" : ""}₹{Number(sel.dealValue.pending).toLocaleString("en-IN")} pending (not yet applied in Studio)
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="sm:hidden">{actionIcons}</div>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-2 sm:mt-0 sm:pt-0 sm:border-0 sm:shrink-0">
                <div className="hidden sm:block">{actionIcons}</div>
                {viewSwitch}
              </div>
            </div>

            {/* Recent changes — a salesperson can now add/remove/change items on a sold deal at any
                time, no approval needed (owner decision, replaces the old last-minute amendment gate).
                This is purely informational: what changed, who changed it, when — read-only, no
                action required. Written by StudioApp.jsx's reconcileSoldInventoryBlocks whenever this
                event's + this department's reserved items actually change. */}
            {(() => {
              const shown = recentChanges;
              if (!logOpen || !shown.length) return null;
              return (
                /* ── A SHEET THAT FITS ITS CONTENT ──
                   On a phone this was a full-screen white page, so one entry sat at the top of
                   an empty screen. Now it is a bottom sheet like the Planning / On-site panels:
                   as tall as the log, up to 85% of the screen, then it scrolls. */
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
                  <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-md" onClick={() => setLogOpen(false)} />
                  <div role="dialog" aria-modal="true" aria-label="Activity log"
                    className="relative w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[80vh]">
                  {/* Grab handle: the platform's mark for "this is a sheet, swipe or tap out". */}
                  <div aria-hidden="true" className="sm:hidden pt-2 flex justify-center"><span className="w-9 h-1 rounded-full bg-gray-200" /></div>
                  <div className="shrink-0 px-4 pt-3 pb-3 flex items-center gap-3 border-b border-gray-100">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-gray-900">Activity log</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 tabular-nums">{shown.length}</span>
                      </div>
                      {/* One short line. The old subtitle restated the department and client the
                          page header already names, and "Read-only" is evident: there is nothing
                          here to edit. */}
                      <div className="mt-0.5 text-xs text-gray-500">Changes made in Studio</div>
                    </div>
                    <button onClick={() => setLogOpen(false)} aria-label="Close"
                      className="group shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    {/* A drawn cross, not the ✕ character. The glyph is a font fallback away
                       from rendering at the wrong weight or off-centre, and it cannot be given
                       a real stroke width. Grey at rest, red on hover: a permanently red X reads
                       as a warning on a panel you are only reading. */}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  {/* A timeline, not a paragraph list. Each entry is one edit at one time, and a
                      dot with a connecting rule says that at a glance — the previous version ran
                      the author, the change and the timestamp together as prose, so telling two
                      entries apart meant reading both in full. */}
                  <div className="divide-y divide-gray-100">
                    {shown.map(r => {
                      /* ── THE VERB IS SAID ONCE, NOT PER ITEM ──
                         This was one run-on sentence that repeated the verb for every item:
                         "added X ×1, added Y ×2, added Z ×16, added W ×8". Four items meant four
                         "added"s and the names buried between them. Grouping by the change means
                         the verb is stated once and the items sit under it as chips, so what
                         happened is one word and what it happened to is a scannable list. The
                         three verbs get their own colour and their own mark — added, removed and
                         qty-changed are genuinely different events. */
                      const VERB = {
                        added: { label: "Added", mark: "+", tile: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", qty: "text-emerald-700" },
                        removed: { label: "Removed", mark: "−", tile: "bg-rose-50 text-rose-700 ring-1 ring-rose-200", qty: "text-rose-700" },
                        qty_changed: { label: "Quantity changed", mark: "±", tile: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", qty: "text-amber-700" },
                      };
                      const groups = {};
                      (r.items || []).forEach(it => {
                        const k = it.change === "removed" ? "removed" : it.change === "qty_changed" ? "qty_changed" : "added";
                        (groups[k] = groups[k] || []).push(it);
                      });
                      const keys = ["added", "qty_changed", "removed"].filter(k => groups[k]);
                      // The tile takes the verb of the entry's largest group. An entry that mixes
                      // verbs still lists each one below; the tile is a glance-level mark, and a
                      // mixed entry has no single true colour — so it takes the dominant one
                      // rather than inventing a fourth "mixed" state.
                      const lead = keys.slice().sort((a, b) => groups[b].length - groups[a].length)[0] || "added";
                      const count = (r.items || []).length;
                      const stamp = r.requestedAt ? new Date(r.requestedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
                      return (
                        <div key={r.id} className="flex gap-3 py-3.5">
                          <span aria-hidden="true" className={"shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold leading-none " + VERB[lead].tile}>{VERB[lead].mark}</span>
                          <div className="min-w-0 flex-1">
                            {/* What happened on the first line; who and when under it. Squeezed
                                onto one line, the author read as part of the headline. */}
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-[13px] font-semibold text-gray-900">
                                {keys.length === 1 ? `${VERB[lead].label} ${count} item${count === 1 ? "" : "s"}` : `${count} item${count === 1 ? "" : "s"} changed`}
                              </span>
                              {/* Exact time stays on the title — the shorthand is for scanning,
                                  not a replacement for the record. */}
                              <span className="shrink-0 text-[11px] text-gray-400 whitespace-nowrap tabular-nums" title={stamp}>{relTime(r.requestedAt)}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-gray-500">by {r.requestedBy || "—"}</div>
                            {/* ── A LIST, NOT CHIPS ──
                                Outlined green chips wrapped into a ragged block with the quantity
                                buried at the end of each name. One row per item — name left, qty
                                right-aligned in a column — scans like the inventory it is. */}
                            {keys.map(k => (
                              <div key={k} className="mt-2.5">
                                {keys.length > 1 && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">{VERB[k].label}</div>}
                                <div className="rounded-lg bg-gray-50 divide-y divide-gray-100">
                                  {groups[k].map((it, ii) => (
                                    <div key={ii} className="flex items-center justify-between gap-3 px-3 py-2">
                                      <span className="min-w-0 truncate text-xs text-gray-700" title={it.name}>{it.name}</span>
                                      {it.qty ? <span className={"shrink-0 text-xs font-semibold tabular-nums " + VERB[k].qty}>×{it.qty}</span> : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                  </div>
                </div>
              );
            })()}

            {/* Sub-view switch (Planning / On-site) now lives in the event header above — it
                scopes the entire column, so it sits with the event rather than between cards. */}

            {opsView === "planning" && (<>

            {/* Department income (from Deal Check snapshot — matches Studio). Floral is split into real
                (mandi) vs artificial; Manpower uses the LIVE edited plan so crew edits move the total. */}
            {deptIncome ? (() => {
              // The maths moved to the `income` memo so the PDF export and this panel cannot
              // drift: a head added here but not there would put two different breakdowns of the
              // same department in front of the same person.
              const { liveTotal } = income;
              return (
              <div className="space-y-3">
                {/* ── A READOUT, NOT CARDS ──
                    These figures open nothing. As a row of cards they were indistinguishable
                    from the tiles below — same size, same elevation, same rounded box — so the
                    page showed two identical rows and only one of them answered a click. A card
                    is a promise of interactivity; spending it on read-only numbers makes the
                    real targets harder to find.
                    So: one surface. The total sits on the left behind a blue rule, the heads
                    that make it up are stat columns beside it. Nothing here can be mistaken for
                    something to press. */}
                <div className={"rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden " + GLASS}>
                  {/* The total is its own tier. Sharing a line with the heads made it just the
                      leftmost of four numbers; on its own row at twice their size it reads as
                      the figure the others add up to. */}
                  {/* ── EARNED vs SPENT, AS TWO CARDS ──
                      One shape for both, so the pair reads as a comparison rather than a headline
                      with a footnote. Same padding, same type scale, same ground — only the
                      figures differ. Equal min-widths keep them the same size whatever the two
                      numbers are, so neither looks more important because it has more digits.
                      ("Projected income" was a third card here and is gone: it was
                      deptIncome.total exactly as synced, while Total income is that same figure
                      with the snapshot crew swapped for the live crew plan. They differed only by
                      however much the crew had been edited since the sync — on an untouched deal,
                      by nothing but rounding.) */}
                  {/* A 2×2 grid below sm. With four cards on one flex row at min-w-0, a 390px
                      screen gave each about 70px, which clipped the figures and stacked the
                      captions a word per line. Two-up keeps earned beside spent and the figures
                      whole. From sm it is the flex row again, where the 210px minimum is what
                      keeps them equally sized whatever the numbers are. */}
                  <div className="px-3 sm:px-4 py-3 grid grid-cols-2 gap-2.5 sm:flex sm:items-stretch sm:gap-3 sm:flex-wrap">
                    {/* The earned figure is filled, not another grey box. It is the number the
                        whole panel is about and everything below is it taken apart, so it carries
                        the page's one block of colour. Its partner stays grey: two filled cards
                        would be a pair of headlines with nothing to compare them against. */}
                    <div className="rounded-xl bg-blue-600 px-3 sm:px-4 py-3.5 flex-1 min-w-0 sm:min-w-[210px] shadow-[0_2px_4px_rgba(37,99,235,0.25),0_14px_28px_-8px_rgba(37,99,235,0.6)]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-blue-200">Total income</div>
                      <div className="mt-2 text-[22px] leading-none font-semibold text-white tabular-nums tracking-tight">{fmt(liveTotal)}</div>
                      <div className="mt-2 text-[11px] text-blue-100">From Deal Check</div>
                    </div>
                    {/* Not synced from anywhere, unlike its neighbours — a plain manual figure the
                        department head types in themselves. Amber, not grey/blue, so it never looks
                        like another system-derived readout. */}
                    <div className="rounded-xl bg-amber-50 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.3)] px-3 sm:px-4 py-3.5 flex-1 min-w-0 sm:min-w-[210px] ring-1 ring-amber-200">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-600">Sales discount</div>
                      <div className="mt-2 flex items-center gap-1">
                        <span className="text-[22px] leading-none font-semibold text-amber-900">₹</span>
                        <input type="number" min="0" value={discount}
                          onChange={e => saveDept({ discount: e.target.value === "" ? "" : Math.max(0, Number(e.target.value) || 0) })}
                          placeholder="0" className="w-full bg-transparent text-[22px] leading-none font-semibold text-amber-900 tabular-nums tracking-tight outline-none" />
                      </div>
                      <div className="mt-2 text-[11px] text-amber-700">Set by {dept} head</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 shadow-[0_8px_20px_-10px_rgba(15,23,42,0.3)] px-3 sm:px-4 py-3.5 flex-1 min-w-0 sm:min-w-[210px] ring-1 ring-gray-200">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">Actual cost</div>
                      {/* Grey dash until something is logged. A ₹0 here would read as "spent
                          nothing", which is a different claim from "not recorded yet". */}
                      <div className={"mt-2 text-[22px] leading-none font-semibold tabular-nums tracking-tight " + (hasActuals ? "text-gray-900" : "text-gray-300")}>{hasActuals ? fmt(actualCost) : "—"}</div>
                      <div className="mt-2 text-[11px] text-gray-500">{hasActuals ? "Actually spent" : "Not logged yet"}</div>
                    </div>
                    {/* Net = income − discount − actual cost. The bottom line the first three cards
                        add up to, so it gets its own colour rather than sharing grey/amber with a
                        component it's actually the result of. Actual cost counts as 0 here until
                        logged (Not logged yet ≠ spent nothing, but a net figure has to start somewhere). */}
                    {(() => {
                      const netAmount = liveTotal - (Number(discount) || 0) - (hasActuals ? actualCost : 0);
                      const neg = netAmount < 0;
                      return (
                        <div className={"rounded-xl shadow-[0_8px_20px_-10px_rgba(15,23,42,0.3)] px-3 sm:px-4 py-3.5 flex-1 min-w-0 sm:min-w-[210px] ring-1 " + (neg ? "bg-red-50 ring-red-200" : "bg-emerald-50 ring-emerald-200")}>
                          <div className={"text-[10px] font-semibold uppercase tracking-[0.06em] " + (neg ? "text-red-600" : "text-emerald-600")}>Net</div>
                          <div className={"mt-2 text-[22px] leading-none font-semibold tabular-nums tracking-tight " + (neg ? "text-red-900" : "text-emerald-900")}>{fmt(netAmount)}</div>
                          <div className={"mt-2 text-[11px] " + (neg ? "text-red-700" : "text-emerald-700")}>Income − discount − cost</div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* The "What makes up this total" strip of income heads is gone by request —
                      the four cards above are the whole readout now. */}
                </div>
              </div>
              );
            })() : (
              <div className="bg-amber-50 rounded-lg px-4 py-3 text-xs text-amber-800">No Deal Check breakdown synced yet for this event. In Studio → Deal Check → <b>Dept Income</b>, click <b>📤 Sync to IMS Dept Ops</b> to push the numbers here.</div>
            )}

            {/* ── THE TILE GRID ──
                One tile per content block, four to a row. Each carries the one figure you open
                the block for, so the common case — "what is the manpower cost" — is answered
                without opening anything at all. */}
            {(() => {
              const n = (v, s) => `${v} ${s}${v === 1 ? "" : "s"}`;
              const tiles = [
                dept === "Fabric" && elementPlanOf().rows.length > 0 && (() => {
                  // "Fabric plan": the overlay / cushion cover choices to decide
                  const rows = elementPlanOf().rows;
                  const decided = rows.filter(r => r.status === "decided").length;
                  const bad = rows.filter(r => r.status === "short").length;
                  return { k: "fabreq", icon: "🧵", title: "Fabric plan", sub: bad ? <span className="text-red-600 font-semibold">{bad} need{bad === 1 ? "s" : ""} attention · {decided} of {rows.length} decided</span> : `${decided} of ${rows.length} decided`, ...(bad ? { tone: "bg-red-50", alert: true } : {}) };
                })(),
                { k: "inv", icon: "📦", title: "Inventory blocked", sub: n(blockedItemsGrouped.length, "item") + " held", value: fmt(rentalIncome) },
                dept === "Tenting" && carpetPlanOf().rows.length > 0 && (() => {
                  const rows = carpetPlanOf().rows;
                  const decided = rows.filter(r => r.status === "decided").length;
                  const bad = rows.filter(r => r.status === "short" || r.status === "none").length;
                  return { k: "carpet", icon: "🟥", title: "Carpet plan", sub: bad ? <span className="text-red-600 font-semibold">{bad} floor{bad === 1 ? "" : "s"} need{bad === 1 ? "s" : ""} attention · {decided} of {rows.length} decided</span> : `${decided} of ${rows.length} floor${rows.length === 1 ? "" : "s"} decided`, ...(bad ? { tone: "bg-red-50", alert: true } : {}) };
                })(),
                dept === "Tenting" && trussPlanOf().length > 0 && { k: "truss", icon: "🏗️", title: "Truss plan", sub: n(trussPlanOf().length, "truss") + " · pillars, beams, fabric" },
                { k: "mp", icon: "👷", title: "Manpower plan", sub: mpChanged ? <span className="text-red-600 font-semibold">⚠ Changed since you last looked · {fmt(Number(mpSeen.cost) || 0)} → {fmt(mpSnapCost)}</span> : mpRows.length ? n(mpRows.length, "crew line") : "no crew assigned", value: fmt(mpCost), ...(mpChanged ? { tone: "bg-red-50", alert: true } : {}) },
                { k: "actuals", icon: "🧾", title: "Actuals", sub: hasActuals ? "real spend logged" : "nothing logged yet", value: hasActuals ? fmt(actualCost) : null },
                { k: "truck", icon: "🚚", title: "Truck planning", sub: trucks.length ? n(trucks.length, "truck") + (fullTrucks ? ` · ${fullTrucks} full` : "") : "no trucks yet" },
                SHOW_DISMANTLE_IN_PLANNING && blockedItems.length > 0 && { k: "dism", icon: "🔁", title: "Dismantle plan", sub: "where each item goes after" },
              ].filter(Boolean);
              return (
                <div className={GRID}>
                  {tiles.map(t => (
                    /* No drawn outline. Separation comes from the slate-100 page ground under a
                       white fill, plus a two-layer shadow — a tight 1px one that reads as the
                       card's edge and a wide soft one that lifts it off the ground. The tinted
                       tiles (red for a shortfall, sky for receiving) separate by fill alone. */
                    <button key={t.k} onClick={() => setModal(t.k)}
                      /* Clicking the open tile again closes it — with the block inline, the tile
                         is a toggle, not a launcher. The open one is ringed so you can tell at a
                         glance which of the five the panel below belongs to. */
                      onClickCapture={e => { if (modal === t.k) { e.stopPropagation(); setModal(null); } }}
                      className={"group text-left rounded-xl p-3 sm:p-3.5 h-full flex flex-col transition-[transform,box-shadow] duration-150 shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(15,23,42,0.1),0_22px_40px_-12px_rgba(15,23,42,0.45)] " + (modal === t.k ? "ring-2 ring-blue-500 " + (t.tone || "bg-white/90") : (t.tone || GLASS))}>
                      {/* Icon above the title on a phone, beside it from sm. Two to a row a tile
                          is ~170px; with a 36px icon beside it the title had ~110px and
                          "Inventory blocked" broke over two lines. Stacked, the title gets the
                          tile's full width and every tile reads top-down the same way: mark,
                          name, detail, figure. */}
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
                        <span aria-hidden="true" className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base leading-none " + (t.alert ? "bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)]" : "bg-gray-100")}>{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 leading-snug">{t.title}</div>
                          <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{t.sub}</div>
                        </div>
                        {/* gray-300 put this at ~1.5:1 on white — present in the markup, absent
                            on screen. gray-500 is 4.8:1, and it darkens on hover so the chevron
                            confirms the whole tile is the target, not just the corner it sits in.
                            Hidden below sm: at a 170px column it cost real width the title needed,
                            and on a touch screen there is no hover state for it to explain. */}
                        <span aria-hidden="true" className="hidden sm:block shrink-0 text-gray-500 group-hover:text-gray-900 text-base font-semibold leading-none transition-colors">›</span>
                      </div>
                      {/* Only tiles that HAVE a headline figure reserve room for one — an empty
                          line on the others would read as a number that failed to load. */}
                      {t.value && <div className="mt-auto pt-3 text-[17px] leading-none font-semibold text-gray-900 tabular-nums tracking-tight">{t.value}</div>}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── THE BODIES ──
                Every block below stays exactly where it was written. This wrapper is `hidden`
                until a tile is picked, at which point it becomes the dialog and the one block
                whose key matches un-hides itself (see modalCls). */}
            {/* ── OPENS IN PLACE, UNDER THE TILES ──
                Not a dialog any more. A block is its tile's own detail, so it belongs directly
                beneath the row you clicked rather than over the top of the page — the tiles, the
                income cards and the event header all stay in view while you read it.
                Same mechanic as before: every block still lives here and hides itself unless it
                is the open one (modalCls), so nothing had to be moved or re-parented. */}
            <div onClick={onPanelBackdrop} className={modal ? PANEL_WRAP : "hidden"}>
              <div className={PANEL_CARD}>
                {/* NOT sticky from sm up. It was, back when this panel was a dialog with its own
                    scroll — but inline the page scrolls instead, so a sticky bar just hovers over
                    the block underneath and covered the first block's subtitle permanently.
                    Nothing is lost by letting it scroll away: the tile above toggles the panel
                    shut, and Escape still closes it. On a phone it is pinned by the flex column
                    instead — the body scrolls under it — so the close button is always reachable
                    without scrolling a sheet back to the top. */}
                <div className="absolute -top-12 right-3 sm:static sm:shrink-0 sm:px-2 sm:pt-2 sm:pb-1 sm:flex sm:items-center sm:justify-end">
                  <button onClick={() => setModal(null)} aria-label="Close"
                    className="group shrink-0 w-10 h-10 rounded-full bg-white shadow-lg text-gray-600 sm:w-8 sm:h-8 sm:rounded-lg sm:bg-transparent sm:shadow-none sm:text-gray-400 flex items-center justify-center hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    {/* A drawn cross, not the ✕ character. The glyph is a font fallback away
                       from rendering at the wrong weight or off-centre, and it cannot be given
                       a real stroke width. Grey at rest, red on hover: a permanently red X reads
                       as a warning on a panel you are only reading. */}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className={PANEL_BODY}>

            {/* Fabric: stock vs requirement + shortfall (Fabric dept only) */}
            {dept === "Fabric" && (
              <div className="space-y-3">
                {/* Prior heads-up: any upcoming event short on fabric */}
                {upcomingFabricShort.length > 0 && (
                  <div className={"bg-red-50 rounded-xl overflow-hidden" + modalCls("fabshort")}>
                    <div className="px-4 py-2.5 bg-red-100/70 text-sm font-bold text-red-800">⚠️ {upcomingFabricShort.length} upcoming fabric shortfall{upcomingFabricShort.length > 1 ? "s" : ""} — order ahead</div>
                    <div className="">
                      {upcomingFabricShort.map((s, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs">
                          <span className="text-red-800 inline-flex items-center gap-1.5"><b>{s.fabric}</b> · <Swatch name={s.colour} hex={s.hex} />{s.colour}</span>
                          <span className="text-red-700">{s.newTierOnly ? <>short <b>{s.short} {s.unit}</b> of <b>New</b> stock specifically</> : <>short <b>{s.short} {s.unit}</b></>} for {s.event} on <b>{s.date}</b>{s.contended ? " (shared with another same-day event)" : ""}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-1.5 text-[10px] text-red-500">Total available counts Old + New stock. Update live quantities in Planning → Fabric Stock after each washing cycle.</div>
                  </div>
                )}
              </div>
            )}

            {/* Blocked inventory */}
            {/* No overflow-hidden here (unlike its sibling cards) — every child below is inset with
                its own margin/padding and never touches this card's edges, so the rounded corners
                were never actually at risk of a square-cornered child bleeding past them. Dropping it
                is what lets the column header's `sticky` below attach to the PAGE's real scroll
                instead of being trapped inside this card's own box (overflow-hidden makes an element
                its own scroll container for sticky-positioning purposes, which is exactly what broke
                the first attempt at pinning it). */}
            <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)]" + modalCls("inv")}>
              {/* Summary strip. Tinted blue rather than grey and the figure set in a white pill:
                  with the rows below now white cards on a light ground, a grey header read as
                  one more row instead of as the thing they add up to. */}
              {/* No flex-wrap. It was wrapping on a phone — title on one line, the figure dropped
                  onto a second — which doubled the strip's height for a caption and a number that
                  both fit once the title is allowed to truncate. min-w-0 on the text block is what
                  lets it truncate rather than push the figure off the row. */}
              <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-blue-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-sm leading-none">📦</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">Inventory blocked for {dept}</div>
                    <div className="text-[10px] text-gray-500 truncate">{invShown.length} item{invShown.length === 1 ? "" : "s"} held for {invScoped ? "this function" : "this event"}</div>
                  </div>
                </div>
                <div className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[15px] font-bold text-gray-900 tabular-nums whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,0.06)]">{fmt(invScoped ? invShownTotal : rentalIncome)}</div>
              </div>
              {fnChipRow(invFn, setInvFn)}
              {/* The same Department Income table Deal Check shows, opened here — this department's lines, a
                  chip for each other department, and how the blocked-inventory list adds up. */}
              {invShown.length > 0 && (
                <div className="mx-2.5 mt-2">
                  <button onClick={() => setDcModalOpen(true)}
                    className="text-[12px] font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1.5">
                    🏦 Deal Check breakdown — {dept}
                  </button>
                </div>
              )}
              {invWholeOnly > 0 && (
                <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-gray-50 text-[11px] text-gray-500">{invWholeOnly} item{invWholeOnly === 1 ? " is" : "s are"} not in any of this function's zones (production, fabric and the like) — see All functions.</div>
              )}
              {/* Print jobs, read from the build's zone layout (pushed to IMS on every Build save),
                  so they show without Deal Check — which only ever sends a count of them. */}
              {dept === "Structure" && invFinish.prints.length > 0 && (
                <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-sky-50 ring-1 ring-sky-100">
                  <div className="text-[12px] font-semibold text-sky-900">🖨 Print jobs · {invFinish.prints.length}</div>
                  {invFinish.prints.map((p, pi) => (
                    <div key={pi} className="text-xs text-sky-800 mt-1 flex items-center gap-2">
                      {p.ref && <img src={thumbUrl(p.ref, 32)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(p.ref)} className="w-8 h-8 rounded object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} />}
                      <span>{invFinish.printLine(p)}</span>
                    </div>
                  ))}
                </div>
              )}
              {blockedItemsGrouped.length > 0 && invShown.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">None of this department's inventory is in this function's zones.</div>
              ) : blockedItemsGrouped.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No inventory blocked for this department on this event.</div>
              ) : (
                /* ── ONE CARD PER ITEM, NOT A TABLE ──
                   This was a five-column table with a header row, which meant two different
                   layouts to maintain: a real table from sm up and a grid that faked one below,
                   with the whole display chain (table → tbody → tr → td) switching at the
                   breakpoint. One card per row is a single layout that works at every width, and
                   it drops the 640px minimum that used to put a money table in a horizontal
                   scroller on a phone.
                   Below sm, cards still stack with nothing to align a shared header against, so
                   each one keeps its own per-figure label (StatCell's own, sm:hidden). From sm up
                   the figures now line up as real columns, so repeating QTY/RATE/TOTAL on every
                   single card was exactly the clutter a shared header exists to avoid — one sticky
                   header row instead, labeling the column once no matter how far down the list
                   you've scrolled. */
                (() => {
                  const anyRentalQty = invShown.some(rentalDiffers);
                  const qtyHeaderLabel = anyRentalQty ? "To load" : "Qty";
                  return (
                /* Two earlier attempts at pinning this: a plain `sticky` while the card still had
                   overflow-hidden (never attached to the real scroll — overflow-hidden makes an
                   element its own scroll container for sticky purposes, so it just rode along with
                   the card), then a bounded independently-scrollable region with its own sticky header
                   (fought the surrounding layout — overlapping row content, clipped numbers). The
                   card's own overflow-hidden is gone now (see its own comment, above), so a plain
                   `sticky top-0` here finally has the real page scroll to attach to. Solid background
                   (not translucent) this time — a see-through header over scrolling rows was part of
                   what made the previous attempt look broken. */
                <div className="p-2.5 space-y-2">
                  {fabricGroupInfo.groups.length > 0 && <FabricBlock groups={fabricGroupInfo.groups} fmt={fmt} onZoom={setZoomImg} fnDates={mpFns.map(f => String(f?.date || "").slice(0, 10))} />}
                  {invShown.some(it => !fabricGroupInfo.groupedLineIds.has(it.id)) && <div className="hidden sm:flex items-center gap-x-3 px-2.5 sticky top-0 z-10 bg-white rounded-lg ring-1 ring-gray-100 py-1.5 -mt-0.5 mb-1">
                    <span className="flex-1 min-w-0" />
                    <div className="w-full sm:w-auto flex items-start gap-0 sm:pl-1">
                      {showDates && dateCols.map(c => <div key={c.date} title={c.names} className={"text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 " + STAT_W.qty}>{c.label}</div>)}
                      {anyOther && <div title="Not tied to one date: kit parts, truss, platform, carpet, print, production and buying lines, or a function with no date" className={"text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 " + STAT_W.qty}>Other</div>}
                      {!showDates && <div className={"text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 " + STAT_W.qty}>{qtyHeaderLabel}</div>}
                      {anyRentalQty && <div className={"text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 " + STAT_W.rentalQty}>Rental qty</div>}
                      <div className={"text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 " + STAT_W.rate}>Rate</div>
                      <div className={"text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 " + STAT_W.total}>Total</div>
                    </div>
                  </div>}
                  {invShown.filter(it => !fabricGroupInfo.groupedLineIds.has(it.id)).map(it => {
                    // ── TWO DIFFERENT QUANTITIES, ON PURPOSE ──
                    // `qty` ("To load") is the true physical peak: the most this item is ever
                    // needed on-site at once, net of cross-function reuse (two back-to-back
                    // functions needing 1 then 2 of the same sofa load 2, not 3 — the second
                    // function's crew finds 1 already standing from the first). `rentalQty` is
                    // the raw per-function need summed with NO such netting — it's what the item
                    // was actually billed against across the whole booking (1 + 2 = 3 "uses"),
                    // because a reused unit's SECOND use still often bills (at a Repeat/
                    // date-category discount) even though no new physical unit went out. The two
                    // only ever show as separate columns in the All-functions view; scoped to one
                    // function there is no reuse to net, so they're identical and only one shows.
                    // `rate` is the blended average actually realized — total ÷ rentalQty — since
                    // a Repeat-discounted reuse and a fresh unit can bill at different rates within
                    // the same merged line.
                    const rentalQty = Number(it.rentalQty ?? it.qty) || 0;
                    const showRentalQty = rentalDiffers(it);
                    const avgRate = rentalQty > 0 ? Math.round((Number(it.total) || 0) / rentalQty) : (Number(it.unit) || 0);
                    // ── WHY THE TOTAL IS NOT ALWAYS RATE × QTY ──
                    // On rows pushed from Deal Check, `unit` and `total` are independent fields:
                    // unit is the base rental, total is the line rental — and for a KIT that
                    // total also carries its components (see the snapshot branch of
                    // blockedItemsGrouped). Only the IMS fallback path computes total = unit ×
                    // qty. Naming the two as columns therefore displays arithmetic that visibly
                    // fails on kit lines, so a row where they disagree says why instead of
                    // looking like a calculation bug. Compared against rentalQty (the billing
                    // basis) × the base `unit` rate — not qty (the to-load basis) and not the
                    // blended avgRate, both of which intentionally diverge from a plain unit×qty
                    // whenever reuse or a kit's components apply, which isn't the "rate × qty ≠
                    // total" case this badge exists to explain.
                    const derived = Math.round((Number(it.unit) || 0) * rentalQty);
                    const mismatch = derived !== Math.round(Number(it.total) || 0);
                    return (
                    <div key={it.id} className="rounded-xl bg-white ring-1 ring-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] overflow-hidden">
                      {/* flex-wrap, so the figures drop to their own full-width line on a phone
                          and sit inline beside the name from sm up — one rule instead of two
                          layouts. */}
                      <div className="p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {it.photo ? <img src={thumbUrl(it.photo, 48)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(it.photo)} className="w-12 h-12 rounded-lg object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg shrink-0">📦</div>}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">{it.name}</div>
                              {/* Every status badge the flat-list version carried, kept as a
                                  wrapping row under the name instead of trailing off the end of
                                  it — in a fixed-width ITEM column four inline badges pushed the
                                  name out of sight, which is the opposite of what they are for. */}
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {/* ── THE KIT BADGE IS THE TOGGLE ──
                                    The components are the one thing on this row that can be
                                    opened, and the badge is already the thing that says there
                                    are any — so it opens them rather than a separate control
                                    competing with it. It carries the count, so you can tell
                                    what you are unfolding before you unfold it.
                                    A kit with no components stays a plain label: a control that
                                    reveals nothing is worse than no control. */}
                                {it.isKit && ((it.components || []).length > 0 ? (
                                  <button onClick={() => setKitOpen(o => ({ ...o, [it.id]: !o[it.id] }))}
                                    aria-expanded={!!kitOpen[it.id]}
                                    title={kitOpen[it.id] ? "Hide the kit's contents" : "Show what is inside this kit"}
                                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold hover:bg-blue-200 transition-colors">
                                    KIT · {it.components.length}
                                    <span aria-hidden="true" className={"transition-transform duration-150 " + (kitOpen[it.id] ? "rotate-180" : "")}>
                                      <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </span>
                                  </button>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">KIT</span>
                                ))}
                                {it.shortQty > 0 && (it.outOfStock
                                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">OUT OF STOCK</span>
                                  : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">SHORT ×{it.shortQty}</span>)}
                                {it.prodOrBuy && <span className={"text-[10px] px-1.5 py-0.5 rounded font-bold " + (it.prodOrBuy === "buying" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700")}>{it.prodOrBuy === "buying" ? "🛒 BUYING" : "🏭 PRODUCTION"}</span>}
                                {it.isSwapped && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold">🔁 SWAPPED</span>}
                                <button onClick={() => setKitOpen(o => ({ ...o, ["calc:" + it.id]: !o["calc:" + it.id] }))} aria-expanded={!!kitOpen["calc:" + it.id]}
                                  title="How this line's total was worked out"
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200 transition-colors">💡 How</button>
                                {/* Where a merged line's qty comes from (e.g. carpet sqft per zone floor). */}
                                {Array.isArray(it.parts) && it.parts.length > 0 && (
                                  <button onClick={() => setKitOpen(o => ({ ...o, ["how:" + it.id]: !o["how:" + it.id] }))} aria-expanded={!!kitOpen["how:" + it.id]}
                                    className="text-[11px] font-semibold text-blue-600 hover:underline">{kitOpen["how:" + it.id] ? "hide" : "how?"}</button>
                                )}
                              </div>
                              {/* Sub-category and the explanations that go with it. They used to
                                  be their own DETAILS column; on a card they belong under the
                                  name they describe. */}
                              <div className="text-xs text-gray-500 mt-0.5">
                                <div className="truncate" title={it.sub || ""}>{it.sub || "—"}</div>
                                {it.shortQty > 0 && (it.outOfStock
                                  ? <div className="text-red-600 mt-0.5">{it.shortQty} out of stock — can't be made in production, pick an alternative in Build</div>
                                  : <div className="text-amber-600 mt-0.5">{it.shortQty} short of stock — priced at cost, chase or produce</div>)}
                                {it.isSwapped && <div className="text-sky-600 mt-0.5">swapped in for {it.swappedFrom}</div>}
                                {/* One function's view shows what it NEEDS on site (181 on the 20th). Pieces already standing from the day before are not
                                    loaded again, so say how many of them are already there when the date column holds fewer (137 to load). */}
                                {invScoped && it.src && it.qty < it.rentalQty && (() => {
                                  const dl = (() => { try { return new Date(String(mpFns[invFn]?.date || "").slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch { return ""; } })();
                                  return <div className="text-blue-600 mt-0.5">{it.qty > 0
                                    ? `${it.rentalQty - it.qty} already at the venue from the day before — ${it.qty} to load${dl ? " on " + dl : ""}`
                                    : "Nothing new to load: these pieces are already at the venue (standing from the day before, or shared with the largest function that day)"}</div>;
                                })()}
                                {invFinish.paintFor(it) && <div className="text-pink-700 mt-0.5">🎨 Paint: {invFinish.paintFor(it)}</div>}
                              </div>
                            </div>
                          </div>
                          {/* Divided from the name and from each other, so three right-aligned
                              figures read as three columns rather than one run of digits. */}
                          <div className="w-full sm:w-auto flex items-start gap-0 divide-x divide-gray-100 sm:border-l sm:border-gray-100 sm:pl-1">
                            {/* one column per event date (see dateCols): what loads on that day */}
                            {showDates && dateCols.map(c => { const q = qtyOnDate(c, it); return (
                              <StatCell key={c.date} label={c.label} w={STAT_W.qty}>
                                {q > 0
                                  ? <span className="text-sm font-semibold text-gray-700 tabular-nums" title={`Loaded on ${c.label} (${c.names}) — what is not already standing at the venue from the day before`}>×{q}{it.qtyUnit ? <span className="ml-0.5 text-xs font-normal text-gray-400">{it.qtyUnit}</span> : null}</span>
                                  : <span className="text-sm text-gray-300 tabular-nums" title={`Nothing new to load on ${c.label}`}>—</span>}
                              </StatCell>
                            ); })}
                            {anyOther && (() => { const o = otherQty(it); return (
                              <StatCell label="Other" w={STAT_W.qty}>
                                {o > 0
                                  ? <span className="text-sm font-semibold text-gray-700 tabular-nums" title="Not tied to one date (kit parts, truss, platform, carpet, print, production or buying lines, or a function with no date)">×{o}{it.qtyUnit ? <span className="ml-0.5 text-xs font-normal text-gray-400">{it.qtyUnit}</span> : null}</span>
                                  : <span className="text-sm text-gray-300 tabular-nums">—</span>}
                              </StatCell>
                            ); })()}
                            {/* with a column per date the single To load figure is left out: each date says what loads on it */}
                            {!showDates && (<StatCell label={showRentalQty ? "To load" : "Qty"} w={STAT_W.qty}>
                              <span className="text-sm font-semibold text-gray-700 tabular-nums">×{it.qty}{it.qtyUnit ? <span className="ml-0.5 text-xs font-normal text-gray-400">{it.qtyUnit}</span> : null}</span>
                            </StatCell>)}
                            {/* Reserved whenever ANY row in this list needs it (anyRentalQty), not just
                                this one (showRentalQty) — so every row's Rate/Total lands under the
                                same header column instead of shifting left on rows with nothing to
                                net, which is what a per-row-only column would do under a shared header. */}
                            {anyRentalQty && (
                              <StatCell label="Rental qty" w={STAT_W.rentalQty}>
                                {showRentalQty
                                  ? <span className="text-sm text-gray-600 tabular-nums" title="Raw qty billed per function, summed with no cross-function reuse credit — this is the billing basis the averaged rate is derived from.">×{rentalQty}</span>
                                  : <span className="text-sm text-gray-300 tabular-nums" title="Same as qty — nothing to net for this item.">—</span>}
                              </StatCell>
                            )}
                            <StatCell label="Rate" w={STAT_W.rate}>
                              <span className="text-sm text-gray-600 tabular-nums" title={showRentalQty ? "Averaged across functions — a reused unit's repeat-discounted rate blends with a fresh unit's full rate." : undefined}>{fmt(avgRate)}{it.qtyUnit ? <span className="text-xs text-gray-400">/{it.qtyUnit}</span> : null}</span>
                            </StatCell>
                            <StatCell label="Total" w={STAT_W.total}>
                              <div className="text-sm font-bold text-gray-900 tabular-nums">{fmt(it.total)}</div>
                              {mismatch && <div className="text-[10px] text-gray-400 tabular-nums mt-0.5" title={`Rate × qty is ${fmt(derived)}. This line is ${fmt(it.total)}${it.isKit ? " because a kit's total includes the components listed below." : "."}`}>{it.isKit ? "incl. kit" : `≠ ${fmt(derived)}`}</div>}
                            </StatCell>
                          </div>
                      </div>
                      {/* Kit contents — each sub-element loaded separately, with its own rental
                          (customised per-deal by the salesperson). Their totals sum to the kit
                          total above, which is why the three figures reuse the kit row's own
                          column widths: the sum only reads as a sum if it lines up under it.
                          Tinted and inset, so an opened kit is visibly part of its card rather
                          than a run of new items after it. */}
                      {kitOpen["calc:" + it.id] && (() => {
                        const c = it.calc;
                        const dm = c ? (c.dms || []) : [];
                        const lines = c ? [
                          ["Base rent of the units we own", c.full, `${fmt(it.unit)} × ${Math.max(0, rentalQty - (Number(it.shortQty) || 0))}`],
                          ...(c.dateAdj !== 0 ? [[c.dateAdj < 0 ? "Date category discount" : "Date category markup", c.dateAdj, dm.length === 1 ? `×${dm[0]}` : ""]] : []),
                          ...(c.disc !== 0 ? [["Repeat / standing / reuse discount", c.disc, "only the biggest applies"]] : []),
                          ...(c.short > 0 ? [[`Short ×${it.shortQty || ""}, at production cost`, c.short, it.outOfStock ? "cannot be made — pick another item in Build" : "to be made or bought"]] : []),
                        ] : [
                          ["Rate × quantity", derived, `${fmt(it.unit)} × ${rentalQty}`],
                          ...(mismatch ? [["Kit parts, discounts and other adjustments", Math.round(Number(it.total) || 0) - derived, "worked out by Deal Check"]] : []),
                        ];
                        return (
                          <div className="ui-reveal-in bg-slate-50 px-3 py-1.5 divide-y divide-slate-100">
                            {lines.map(([label, val, hint], i) => (
                              <div key={i} className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
                                <span className="text-gray-600">{label}{hint ? <span className="text-gray-400"> · {hint}</span> : null}</span>
                                <span className={"tabular-nums font-medium " + (val < 0 ? "text-emerald-700" : "text-gray-800")}>{val < 0 ? "−" : (i > 0 ? "+" : "")}{fmt(Math.abs(val))}</span>
                              </div>
                            ))}
                            <div className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
                              <span className="font-semibold text-gray-900">Line total{!c ? <span className="text-gray-400 font-normal"> · synced before the breakdown existed — sync this event to see every step</span> : null}</span>
                              <span className="tabular-nums font-bold text-gray-900">{fmt(it.total)}</span>
                            </div>
                          </div>
                        );
                      })()}
                      {Array.isArray(it.parts) && it.parts.length > 0 && kitOpen["how:" + it.id] && (
                        <div className="ui-reveal-in bg-slate-50 px-2.5 py-1.5 space-y-1 text-xs">
                          {it.parts.map((pt, pi) => (
                            <div key={"p" + pi} className="flex items-center gap-2">
                              <span aria-hidden="true" className="text-gray-300 shrink-0">└</span>
                              <span className="text-gray-700 truncate flex-1 min-w-0">{pt.zone}{pt.fn ? <span className="text-gray-400"> · {pt.fn}</span> : null}{pt.dims ? <span className="text-gray-400"> · {pt.dims} ft</span> : null}</span>
                              {Array.from({ length: dateSpacers }, (_, si) => <span key={"sp" + si} className={"hidden sm:block shrink-0 " + STAT_W.qty} />)}
                              <span className={"shrink-0 font-medium text-gray-500 text-right tabular-nums " + STAT_W.qty}>{pt.qty}{it.qtyUnit ? " " + it.qtyUnit : ""}</span>
                              <span className={"shrink-0 text-gray-500 text-right tabular-nums " + STAT_W.rate}>× {fmt(pt.rate)}</span>
                              <span className={"shrink-0 font-semibold text-gray-700 text-right tabular-nums " + STAT_W.total}>{fmt(pt.total)}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-2 border-t border-gray-200 pt-1">
                            <span className="flex-1 text-gray-600 font-semibold">Total</span>
                            {Array.from({ length: dateSpacers }, (_, si) => <span key={"sp" + si} className={"hidden sm:block shrink-0 " + STAT_W.qty} />)}
                            <span className={"shrink-0 font-semibold text-gray-700 text-right tabular-nums " + STAT_W.qty}>{it.parts.reduce((a, pt) => a + (Number(pt.qty) || 0), 0)}{it.qtyUnit ? " " + it.qtyUnit : ""}</span>
                            <span className={"shrink-0 " + STAT_W.rate} />
                            <span className={"shrink-0 font-bold text-gray-900 text-right tabular-nums " + STAT_W.total}>{fmt(it.parts.reduce((a, pt) => a + (Number(pt.total) || 0), 0))}</span>
                          </div>
                        </div>
                      )}
                      {it.isKit && kitOpen[it.id] && it.components && it.components.length > 0 && (
                        <div className="ui-reveal-in bg-blue-50/50 px-2.5 py-1.5 space-y-1">
                          {it.components.map((cp, ci) => (
                            <div key={"c" + ci} className="flex items-center gap-2">
                              <span aria-hidden="true" className="text-blue-300 shrink-0 text-xs">└</span>
                              {cp.photo ? <img src={thumbUrl(cp.photo, 24)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(cp.photo)} className="w-6 h-6 rounded object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-[10px] shrink-0">🌸</div>}
                              <span className="text-xs text-gray-700 truncate flex-1 min-w-0" title={cp.sub || ""}>{cp.name}</span>
                              {Array.from({ length: dateSpacers }, (_, si) => <span key={"sp" + si} className={"hidden sm:block shrink-0 " + STAT_W.qty} />)}
                              <span className={"shrink-0 text-xs font-medium text-gray-500 text-right tabular-nums " + STAT_W.qty}>×{cp.qty}</span>
                              <span className={"shrink-0 text-xs text-gray-500 text-right tabular-nums " + STAT_W.rate}>{fmt(cp.unit)}</span>
                              <span className={"shrink-0 text-xs font-semibold text-gray-700 text-right tabular-nums " + STAT_W.total}>{fmt(cp.total)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
                  );
                })()
              )}
            </div>

            {/* Manpower plan (editable / override) */}
            <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("mp")}>
              {mpNote && (
                <div className="m-2.5 mb-0 px-3 py-2 rounded-xl bg-red-50 text-[12.5px] text-red-700 font-medium">
                  ⚠ The crew plan changed since you last opened it — the deal was edited in Studio (an item added or removed, a rate or a multiplier): {fmt(mpNote.from)} → {fmt(mpNote.to)}. It is marked as seen now.
                  {mpNote.itemsKnown && (() => {
                    const ch = Object.entries(mpNote.byName || {});
                    if (!ch.length && !(mpNote.removed || []).length) return null;
                    return (
                      <div className="mt-1 font-normal text-red-700">
                        {ch.map(([name, v]) => <span key={name} className="inline-block mr-2"><b>{name}</b> {v.kind === "new" ? `added ×${v.to}` : `qty ${v.from} → ${v.to}`}</span>)}
                        {(mpNote.removed || []).map(r => <span key={r.name} className="inline-block mr-2 line-through">{r.name} ×{r.qty} removed</span>)}
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* Same compact tinted strip the Inventory panel uses, deliberately. The reference
                  for this panel draws a taller header with the figure on its own line below the
                  caption — but that is the shape that was just trimmed off Inventory for being
                  too tall, and two panels opened from the same row of tiles should not disagree
                  about what their own header looks like. */}
              <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-blue-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-sm leading-none">👷</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">Manpower plan</div>
                    <div className="text-[10px] text-gray-500 truncate">From Studio; edit any field, it saves. Sum matches the income card.</div>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {hasMpSnapshot && <button onClick={() => setMpEventOpen(o => !o)} aria-expanded={mpEventOpen}
                    title="Every department's crew on this booking — labours, supervisors and the rest"
                    className={"rounded-lg px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap transition-colors " + (mpEventOpen ? "bg-blue-600 text-white" : "bg-white text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100")}>👥 Whole event</button>}
                  <div className="rounded-lg bg-white px-2.5 py-1 text-[15px] font-bold text-gray-900 tabular-nums whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,0.06)]">{fmt(mpShownCost)}</div>
                </div>
              </div>
              {/* All functions + one chip per function, as Deal Check's Manpower tab scopes it.
                  Only on a booking with more than one function — with one, the two are the same. */}
              {fnChipRow(mpFn, setMpFn)}
              {mpEventOpen && hasMpSnapshot && (() => {
                const ev = eventManpower();
                const lab = ev.types.find(t => t.type === "Labours");
                const tile = (label, value, sub) => <div className="rounded-xl bg-white ring-1 ring-gray-200 px-3 py-2 min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{label}</div>
                  <div className="text-[18px] font-bold text-gray-900 tabular-nums leading-tight">{value}</div>
                  {sub && <div className="text-[11.5px] text-gray-500 truncate">{sub}</div>}
                </div>;
                return (
                  <div className="m-2.5 mb-0 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 space-y-3 text-[13px] text-gray-700">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-gray-900">👥 Whole event manpower</span>
                      <span className="text-[11.5px] text-gray-400">all departments · with each dept's edits</span>
                      <button onClick={() => setMpEventOpen(false)} className="ml-auto text-gray-400 hover:text-gray-700 text-[16px] leading-none" title="Close">×</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {tile("Labours", lab ? `${lab.peak} peak` : "—", lab ? `${Math.round(lab.dihari)} dihari across the event` : "no labour on this booking")}
                      {tile("Total dihari", Math.round(ev.totalDihari), "every crew type")}
                      {tile("Manpower cost", fmt(ev.total), `${ev.depts.length} department${ev.depts.length === 1 ? "" : "s"}`)}
                    </div>
                    {ev.labDays.length > 0 && (
                      <div>
                        <div className="text-[11.5px] font-semibold text-gray-500 mb-1.5">Labours on site, by day</div>
                        <div className="flex flex-wrap gap-1.5">
                          {ev.labDays.map((d, i) => <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-gray-200 px-2.5 py-1"><span className="text-gray-500">{d.label}</span><b className="text-gray-900 tabular-nums">{d.count}</b></span>)}
                        </div>
                      </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-1.5 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-400 font-semibold"><span>Crew</span><span className="w-14 text-right">Peak</span><span className="w-14 text-right">Dihari</span><span className="w-20 text-right">Cost</span><span className="w-10" /></div>
                        {ev.types.map(t => <div key={t.type} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-1.5 border-t border-gray-100 items-center">
                          <span className="truncate font-medium text-gray-900">{crewIcon(t.type)} {t.type}{t.shared && <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold align-middle">SHARED</span>}</span>
                          <span className="w-14 text-right tabular-nums">{t.peak}</span>
                          <span className="w-14 text-right tabular-nums">{Math.round(t.dihari)}</span>
                          <span className="w-20 text-right tabular-nums font-semibold text-gray-900">{fmt(t.cost)}</span>
                          <button onClick={() => setMpHowType(t.type)} title={`How ${t.type} adds up`}
                            className="w-10 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold cursor-pointer">how</button>
                        </div>)}
                      </div>
                      <div className="rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-1.5 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-400 font-semibold"><span>Department</span><span className="w-16 text-right">Labour dih.</span><span className="w-14 text-right">Dihari</span><span className="w-20 text-right">Cost</span></div>
                        {ev.depts.map(d => <div key={d.dept} className={"grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-1.5 border-t border-gray-100 items-center " + (d.dept === dept ? "bg-blue-50/60" : "")}>
                          <span className="truncate font-medium text-gray-900">{d.dept}{d.dept === dept && <span className="ml-1.5 text-[10px] text-blue-600 font-bold">THIS</span>}</span>
                          <span className="w-16 text-right tabular-nums">{d.labDihari ? (Math.round(d.labDihari * 10) / 10) : "—"}</span>
                          <span className="w-14 text-right tabular-nums">{Math.round(d.dihari * 10) / 10}</span>
                          <span className="w-20 text-right tabular-nums font-semibold text-gray-900">{fmt(d.cost)}</span>
                        </div>)}
                      </div>
                    </div>
                    {/* ── HOW A CREW ROW ADDS UP ──
                        Every department's share of this crew type, with each department's own edits,
                        plus how the count was derived and the days it works. Read-only: edits stay in
                        each department's own Manpower plan. */}
                    {(() => {
                      const t = mpHowType && ev.types.find(x => x.type === mpHowType);
                      if (!t) return null;
                      const src = t.rows.find(x => x.trace) || t.rows[0];
                      // Shared crew is ONE event-wide team: its days come from the schedule's own
                      // headcount, not from any one department's share of it.
                      const days = t.shared
                        ? (Array.isArray(src?.schedule) ? src.schedule.map(day => ({ label: phaseLbl(day), crew: Number(day.count) || 0, shifts: Array.isArray(day.windowIds) ? day.windowIds.length : (Number(day.windows) || 0) })) : [])
                        : null;
                      return createPortal(
                        <div onClick={() => setMpHowType(null)} className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4">
                          <div onClick={e => e.stopPropagation()} className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-2xl p-4 space-y-3 text-[13px] text-gray-700">
                            <div className="flex items-center gap-2">
                              <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-sm leading-none">{crewIcon(t.type)}</span>
                              <span className="text-[15px] font-semibold text-gray-900">How {t.type} adds up</span>
                              {t.shared && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">SHARED</span>}
                              <button onClick={() => setMpHowType(null)} className="ml-auto text-gray-400 hover:text-gray-700 text-[18px] leading-none cursor-pointer" title="Close">×</button>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {tile("Peak", t.peak, t.shared ? "one team, whole event" : "summed across departments")}
                              {tile("Dihari", Math.round(t.dihari), "crew × shifts, all days")}
                              {tile("Cost", fmt(t.cost), `${t.rows.length} department${t.rows.length === 1 ? "" : "s"}`)}
                            </div>
                            {t.shared && <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-2.5 py-2 text-[12px] text-gray-600">One event-wide team, split across departments by their usage or income share. Each department's figure below is its share, with its own edits.</div>}
                            {src?.trace && (
                              <div>
                                <div className="text-[11.5px] font-semibold text-gray-500 mb-1.5">How the count was worked out</div>
                                {renderMpTrace(src.trace)}
                              </div>
                            )}
                            {days && days.length > 0 && (
                              <div>
                                <div className="text-[11.5px] font-semibold text-gray-500 mb-1.5">On site, by day</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {days.map((d, i) => <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-gray-200 px-2.5 py-1" title="Crew × shift count is a rough guide — when a day's shifts carry different crew, the dihari figure is the real total."><span className="text-gray-500">{d.label}</span><b className="text-gray-900 tabular-nums">{d.crew}</b><span className="text-gray-400">× {d.shifts} shift{d.shifts === 1 ? "" : "s"} = {d.dihari} dihari</span></span>)}
                                </div>
                              </div>
                            )}
                            <div className="rounded-xl ring-1 ring-gray-200 overflow-hidden">
                              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-1.5 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-400 font-semibold"><span>Department</span><span className="w-14 text-right">Dihari</span><span className="w-16 text-right">₹/day</span><span className="w-20 text-right">Cost</span></div>
                              {t.rows.map(x => (
                                <div key={x.dept} className={"px-3 py-1.5 border-t border-gray-100 " + (x.dept === dept ? "bg-blue-50/60" : "")}>
                                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
                                    <span className="truncate font-medium text-gray-900">{x.dept}{x.dept === dept && <span className="ml-1.5 text-[10px] text-blue-600 font-bold">THIS</span>}</span>
                                    <span className="w-14 text-right tabular-nums">{Math.round(x.dihari * 10) / 10}</span>
                                    <span className="w-16 text-right tabular-nums">{fmt(x.rate)}</span>
                                    <span className="w-20 text-right tabular-nums font-semibold text-gray-900">{fmt(x.cost)}</span>
                                  </div>
                                  {!t.shared && x.days.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1 text-[11.5px] text-gray-500">
                                      {x.days.map((d, i) => <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5">{d.label} · {d.crew} × {d.shifts}</span>)}
                                    </div>
                                  )}
                                </div>
                              ))}
                              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-1.5 border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                                <span>Total</span>
                                <span className="w-14 text-right tabular-nums">{Math.round(t.dihari)}</span>
                                <span className="w-16" />
                                <span className="w-20 text-right tabular-nums">{fmt(t.cost)}</span>
                              </div>
                            </div>
                          </div>
                        </div>,
                        document.body
                      );
                    })()}
                  </div>
                );
              })()}
              {/* The booking note as its own tinted card with a marker, not a grey 10px line
                  wedged under the header. It explains how every figure below is arrived at, so
                  it is the thing to read before the rows — at 10px grey on grey it read as a
                  caption on the header and was skipped. */}
              {sel.mpPhases && (
                <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-gray-50 flex items-start gap-2 text-[11px] text-gray-600 leading-relaxed">
                  <span aria-hidden="true" className="shrink-0 text-sm leading-none mt-px">📅</span>
                  <span>Crew booked across: {sel.mpPhases.minusOne ? "−1 setup day · " : ""}{sel.mpPhases.eventDays || 0} event day{(sel.mpPhases.eventDays || 0) > 1 ? "s" : ""}{sel.mpPhases.gapDays ? ` · ${sel.mpPhases.gapDays} gap day(s)` : ""}{sel.mpPhases.dismantle ? " · +1 dismantle day" : ""}. Each crew line = peak count × ₹/day × its working days (open a row to see the math).</span>
                </div>
              )}
              {mpRows.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-gray-400">No crew assigned to {dept} for this event — matches the ₹0 income card. Add a crew type below if you need one.</div>
              )}
              {/* Usually a stale plan: the function's date was changed after Studio last synced Deal
                  Check, so the schedule has no day on it. Say which dates the plan does cover. */}
              {mpScoped && mpRows.length > 0 && mpShown.length === 0 && (() => {
                const planned = [...new Set(mpRows.flatMap(r => Array.isArray(r.schedule) ? r.schedule.filter(d => (d.phase || "event") === "event").map(d => d.date) : []))].filter(Boolean).sort();
                return (
                  <div className="px-4 py-5 text-center text-xs text-gray-400">
                    No crew on {mpFnDate(mpFns[mpFn])} for {dept}.
                    {planned.length > 0 && !planned.includes(mpFnDate(mpFns[mpFn])) && <> Studio's manpower plan was made for {planned.join(", ")} — re-sync Deal Check in Studio to bring it up to date.</>}
                  </div>
                );
              })()}
              {mpWholeOnly > 0 && (
                <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-gray-50 text-[11px] text-gray-500">{mpWholeOnly} crew line{mpWholeOnly === 1 ? " is" : "s are"} booked for the whole event, not by day — see All functions.</div>
              )}
              <div className="p-2.5 space-y-2">
                {mpShown.map((r) => {
                  const i = r._i;
                  const overridden = r.sysCount != null && Number(r.count) !== Number(r.sysCount);
                  const open = mpOpen[i] !== false;
                  return (
                    /* ── ONE CARD PER CREW TYPE ──
                       These rows were a single wrapping flex line with the derivation toggle as
                       a small "▸ how" pill at its head. With two inputs, a label, a badge and a
                       total on one line, a phone wrapped it into an unpredictable shape — and the
                       toggle, which is the most useful control here, looked like the least
                       important thing on the row.
                       As a card it is two deliberate lines: who, and how many, on top; what they
                       cost, below. The toggle becomes the chevron tile that opens the card. */
                    <div key={i} className="rounded-xl bg-white ring-1 ring-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        {/* Supervisors has nothing to expand into — ops IS the supervisor, so there's
                            no per-day plan behind the number, just the name and what it costs. */}
                        {r.type !== "Supervisors" && (
                          <button onClick={() => setMpOpen(o => ({ ...o, [i]: o[i] === false }))}
                            aria-expanded={open}
                            className="shrink-0 w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors"
                            title={open ? "Hide how this crew number was calculated" : "How this crew number was calculated"}>
                            <span aria-hidden="true" className={"transition-transform duration-150 " + (open ? "rotate-180" : "")}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </span>
                          </button>
                        )}
                        <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-sm leading-none">{crewIcon(r.type)}</span>
                        <span className="flex-1 min-w-0 text-sm font-semibold text-gray-900 truncate">{r.type}{r.shared && <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold align-middle">SHARED</span>}</span>
                        {/* Only a row added via "+ Add crew type" can be removed — Studio's own
                            planned crew types aren't something a dept head can delete, only tune. */}
                        {r._addedExtra && (
                          <button onClick={() => removeMp(r)} title="Remove this crew type" className="shrink-0 text-gray-300 hover:text-red-500 text-base leading-none px-1">×</button>
                        )}
                        {/* Day-wise rows (Labours/Flowerists/...): the rate sits right here, on the
                            same line as the crew type, instead of a second row dangling below with
                            nothing to its left — it reads as "this type, at this rate" in one glance.
                            Supervisors drop it entirely (ops IS the supervisor — see the "no separate
                            line for him" branch elsewhere in this file — a dept head tuning this rate
                            never meant anything real). */}
                        {r.type === "Supervisors" ? (
                          <div className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-900 tabular-nums">{fmt(lineCost(r))}</div>
                        ) : r.shared && !dayWise(r) ? (
                          <span className="shrink-0 text-[10px] text-gray-400">split allocation</span>
                        ) : dayWise(r) ? (
                          <div className="shrink-0 flex items-center gap-1.5"><span className="text-[11px] text-gray-400">₹/day</span><input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-20 rounded-lg px-2 py-1.5 text-sm text-center font-semibold ring-1 ring-gray-200 bg-white" /></div>
                        ) : (
                          <div className="shrink-0 flex items-center gap-1.5"><span className="text-[11px] text-gray-400">qty</span><input type="number" min="0" value={r.count} onChange={e => setMp(i, "count", e.target.value)} className={"w-16 rounded-lg px-2 py-1.5 text-sm text-center font-semibold ring-1 " + (overridden ? "ring-amber-400 bg-amber-50 font-bold" : "ring-gray-200 bg-white")} /></div>
                        )}
                      </div>
                      {/* Second line: the rate that is editable, and the line total it produces.
                          The total sits in a filled pill rather than as loose text so the one
                          figure you cannot type into does not look like another input. Day-wise rows
                          no longer land here — their rate moved up next to the crew type name above. */}
                      {!dayWise(r) && !(r.shared && !dayWise(r)) && r.type !== "Supervisors" && (
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 text-[11px] text-gray-400">₹/day</span>
                          <input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-24 rounded-lg ring-1 ring-gray-200 bg-white px-2 py-1.5 text-sm text-center font-semibold" />
                          <div className="ml-auto shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-900 tabular-nums">{fmt(lineCost(r))}</div>
                        </div>
                      )}
                      {r.shared && !dayWise(r) && (
                        <div className="flex items-center">
                          <div className="ml-auto shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-900 tabular-nums">{fmt(lineCost(r))}</div>
                        </div>
                      )}
                      {open && r.type !== "Supervisors" && (
                        <div className="text-[13.5px] text-gray-600 leading-relaxed bg-slate-50 rounded-xl ring-1 ring-slate-100 p-2.5">
                          {r.shared ? (
                            <>
                              {renderMpSchedule(r)}
                              {Number(lineCost(r)) !== (Number(r.sysCost) || 0) && (
                                <div className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[13.5px] text-amber-800">✏️ You tuned this dept's crew/rate per day → line now <b>{fmt(lineCost(r))}</b> (system split was {fmt(Number(r.sysCost) || 0)}).</div>
                              )}
                            </>
                          ) : (<>
                            {renderMpSchedule(r)}
                            {r.basis && !r.trace && <span className="text-gray-600">📐 {r.basis}<br /></span>}
                            {r.sysCount != null && r.sysCount !== "" && (() => {
                              // Cost is DIHARI-based (crew × shifts per day + dismantle), not crew×days — show it that
                              // way so the math reconciles with the day-wise total (e.g. 33 dihari × ₹1,500 = ₹49,500)
                              // instead of the misleading "N crew × days" which doesn't multiply to the shown total.
                              const sysDihari = Number(r.sysRate) > 0 ? Math.round((Number(r.sysCost) || 0) / Number(r.sysRate)) : (Number(r.sysCount) || 0);
                              const ovrDihari = Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : (Number(r.count) || 0);
                              return (
                              <span className={overridden ? "text-amber-600 font-semibold" : "text-gray-500"}>
                                Studio plan: {sysDihari} dihari × {fmt(r.sysRate || 0)} = {fmt(r.sysCost || 0)}
                                {overridden && <> → you set <b>{ovrDihari} dihari × {fmt(r.rate || 0)} = {fmt(lineCost(r))}</b></>}
                              </span>
                              );
                            })()}
                          </>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* A dashed full-width slot rather than a small text link. It sits at the end of a
                  column of filled cards, so drawing it as the outline of the card it would add
                  says what it does without a word of explanation — and gives it a target the
                  width of the rows it joins instead of the width of three words. */}
              <div className="px-2.5 pb-2.5">
                <button onClick={addMp} className="w-full rounded-xl border-2 border-dashed border-blue-200 hover:border-blue-300 hover:bg-blue-50/50 text-blue-600 text-[13px] font-semibold py-2.5 flex items-center justify-center gap-1.5 transition-colors">
                  <span aria-hidden="true" className="text-base leading-none">+</span> Add crew type
                </button>
              </div>
            </div>

            {/* Actuals → exact cost */}
            {/* White card with the shared header shape, like every other block. The all-green
                card with a green "— …" aside made this one look like a success message. */}
            <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("actuals")}>
              <div className="px-3 sm:px-4 py-3 bg-gray-50 flex items-center gap-3">
                <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🧾</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-gray-900">Actuals</div>
                  <div className="text-xs text-gray-500">What was actually bought/spent — fill in after shopping, not while planning</div>
                </div>
                {/* 🖨️ The Floral mandi shopping list, printed with each flower's photo — the sheet the
                    shopper takes to the mandi (printMandiList). Same tile as the download beside it. */}
                {dept === "Floral" && mandiRows.length > 0 && (
                  <button onClick={printMandiList} title="Print the mandi shopping list (with photos)"
                    className="shrink-0 w-7 h-7 rounded-lg bg-white hover:bg-gray-200 text-gray-500 hover:text-gray-900 ring-1 ring-gray-200 flex items-center justify-center cursor-pointer transition-colors">
                    <IconPrinter size={14} />
                    <span className="sr-only">Print the mandi shopping list</span>
                  </button>
                )}
                {/* Same icon tile as the department book's download, so it reads as the same action. */}
                <button onClick={downloadActualsPdf} disabled={actualsPdfBusy} title="Download Actuals as PDF"
                  className="shrink-0 w-7 h-7 rounded-lg bg-white hover:bg-gray-200 text-gray-500 hover:text-gray-900 ring-1 ring-gray-200 disabled:opacity-60 flex items-center justify-center cursor-pointer transition-colors">
                  {actualsPdfBusy
                    ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
                    : <IconDownload />}
                  <span className="sr-only">Download Actuals as PDF</span>
                </button>
                <div className="shrink-0 text-right">
                  <div className={"text-[15px] font-semibold tabular-nums " + (hasActuals ? "text-gray-900" : "text-gray-300")}>{hasActuals ? fmt(actualCost) : "—"}</div>
                  <div className="text-[10px] text-gray-400">{hasActuals ? "logged" : "nothing yet"}</div>
                </div>
              </div>
              <div className="px-3 sm:px-4 py-3 space-y-2">
                {dept === "Floral" && (() => {
                  // Real-only — the table below lists real mandi flowers alone (artificial is its own
                  // line in the "Floral cost to source" card above), so its own Total row must sum to
                  // what's actually shown in it, not silently fold the artificial amount back in
                  // (owner-reported: the real-shopping Total read ₹47,997 — the combined floral cost —
                  // when every row on screen summed to the real-only ₹36,308).
                  const projectedTotal = mandiRows.reduce((s, r) => s + (Number(r.projCost) || 0), 0);
                  const variance = mandiActualReal - projectedTotal;
                  return (
                    <div className="space-y-2">
                      {/* The Flower Palette picked in Build per function (fn.fnFlowerPalette) — synced
                          into functionsDetail. This is what each flower's own colour (shown further
                          below, per-mandi-row) is actually being matched/defaulted against. */}
                      {mpFns.some(f => f.flowerPalette) && (
                        <div className="px-3 py-1.5 rounded-lg text-[10px] text-indigo-800 bg-indigo-50 border border-indigo-100 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span className="font-semibold text-indigo-900">🎨 Flower Palette:</span>
                          {mpFns.filter(f => f.flowerPalette).map((f, i) => (
                            <span key={i}><b>{f.type || `Function ${i + 1}`}</b>: {f.flowerPalette}</span>
                          ))}
                        </div>
                      )}
                      {/* Ops view — FLORAL COST (what ops spends to source flowers). Client billing is
                          intentionally NOT shown here — ops only needs the real mandi + artificial spend
                          and how each is derived. */}
                      {!mandiShopped && (mandiRows.length > 0 || fpFlowers.length > 0) && (
                        <div className="px-3 py-1.5 rounded-lg text-[10px] text-blue-700 bg-blue-50 border border-blue-100">
                          ℹ️ Nobody's gone shopping yet — the numbers below are just the plan shown as a starting point. Edit a row once the real mandi purchase happens; until then there's nothing you need to fill in here.
                        </div>
                      )}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden text-xs">
                        <div className="px-3 py-2 bg-emerald-50 font-semibold text-emerald-900 flex justify-between"><span>🌸 Floral cost to source</span><span>{fmt(mandiActualTotal)}</span></div>
                        <div className="">
                          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-600">🌿 Real flowers (mandi) <span className="text-[10px] text-gray-400">— see shopping list below</span></span><span className="font-medium text-gray-800">{fmt(mandiActualReal)}</span></div>
                          <div>
                            <div className="flex justify-between px-3 py-1.5 items-center">
                              <span className="text-gray-600 flex items-center gap-1.5">🌸 Artificial flowers {fp.artificial && <button onClick={() => setArtHowOpen(o => !o)} className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1 leading-tight" title="How the artificial cost is derived">{artHowOpen ? "▾" : "▸"} how</button>}</span>
                              <span className="font-medium text-gray-800">{fmt(fp.artificial ? fp.artificial.total : artificialProj)}</span>
                            </div>
                            {fp.artificial && artHowOpen && (
                              <div className="px-3 pb-2">
                                <div className="bg-gray-50 border rounded-lg p-2 text-[10px] text-gray-600 space-y-1">
                                  {fp.artificial.flowerBunches > 0 && <div>🌸 Flowers: <b>{fp.artificial.flowerBunches}</b> bunches ÷ {fp.artificial.flowerBPK}/kg = <b>{fp.artificial.flowerKg} kg</b> × {fmt(fp.artificial.flowerRate)}/kg = <b className="text-gray-900">{fmt(fp.artificial.flowerCost)}</b></div>}
                                  {fp.artificial.greenBunches > 0 && <div>🌿 Greens: <b>{fp.artificial.greenBunches}</b> bunches ÷ {fp.artificial.greenBPK}/kg = <b>{fp.artificial.greenKg} kg</b> × {fmt(fp.artificial.greenRate)}/kg = <b className="text-gray-900">{fmt(fp.artificial.greenCost)}</b></div>}
                                  {fp.artificial.flowerBunches <= 0 && fp.artificial.greenBunches <= 0 && <div className="text-gray-400 italic">No artificial bunches captured — set "Art Bunches/Unit" on flowers in the Mandi tab.</div>}
                                  <div className="pt-1 text-right">Total artificial = <b className="text-gray-900">{fmt(fp.artificial.total)}</b></div>
                                </div>
                                {/* The salesperson's own Color Split (Deal Check's Florals tab) — WHICH
                                    specific artificial-bunch colour(s) to pull, not just a bare bunch
                                    count. Without this, the figures above said "47 bunches" with no
                                    way to tell Maroon from White; now it's the exact IMS items to pick. */}
                                {Array.isArray(fp.artificial.colorSplit) && fp.artificial.colorSplit.length > 0 && (
                                  <div className="mt-1.5 bg-gray-50 border rounded-lg p-2 text-[10px] text-gray-600">
                                    <div className="font-semibold text-gray-700 mb-1">🎨 Pull these specific bunches</div>
                                    {fp.artificial.colorSplit.map(c => (
                                      <div key={c.imsId} className="flex justify-between py-0.5"><span>{c.name || "Artificial bunch"}</span><b className="text-gray-900">{c.qty}</b></div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {fp.season && fp.season.mult && fp.season.mult !== 1 && <div className="px-3 py-1.5 rounded-lg text-[10px] text-emerald-700 bg-emerald-100/50 border border-emerald-100">📅 {fp.season.label} date — mandi flower prices ×{fp.season.mult} (e.g. a ₹1000 flower bills at ₹{Math.round(1000 * fp.season.mult)})</div>}
                      {/* Projected vs real mandi — side by side, editable real shopping list */}
                      {/* Projected and Real are two fixed columns (w-28 + w-[264px]) and Real holds
                          qty × ₹/unit × total × delete — ~210px of content that cannot compress
                          (every child below is shrink-0), which left the flower name about 30px
                          on a phone. The comparison only works if the two columns stay aligned,
                          so this scrolls sideways rather than reflows. w-[264px] (240 + the 🔁 swap button) is NOT cosmetic — it's
                          the actual sum of the children's widths; a narrower column here forces
                          the (shrink-0) inputs to overflow past their own box, bleeding left into
                          the Projected column, which is the overlap bug this was fixed for. */}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-x-auto">
                        <div className="min-w-[544px]">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-100/60 text-[10px] font-semibold text-emerald-900 uppercase tracking-wide items-center">
                          <span className="flex items-center gap-2">🌸 Flower
                            {seedMandi.length > 0 && <button onClick={resetMandi} title="Undo your edits — restore the system's original mandi plan from Deal Check" className="normal-case text-[10px] font-semibold text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 hover:bg-emerald-200/60">↺ Reset to system plan</button>}
                          </span>
                          <span className="text-right w-28">Projected (plan)</span>
                          <span className="text-right w-[264px]">Real shopping</span>
                        </div>
                        {/* Column labels for the two editable fields */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 pt-1 text-[10px] text-emerald-700/70 uppercase tracking-wide">
                          <span></span><span className="w-28"></span>
                          <span className="flex items-center justify-end gap-1 w-[264px]"><span className="shrink-0 w-12 text-center">qty</span><span className="shrink-0 text-transparent">×</span><span className="shrink-0 w-16 text-center">₹/unit</span><span className="shrink-0 w-16 text-right">total</span><span className="shrink-0 w-5"></span><span className="shrink-0 w-3"></span></span>
                        </div>
                        <div className="px-3 py-1 bg-emerald-50/40 text-[10px] text-emerald-700/80">Real shopping = <b>qty × ₹/unit</b>. Projected = planned units from the recipe × mandi price{fp.season && fp.season.mult && fp.season.mult !== 1 ? ` × ${fp.season.mult} season` : ""}.</div>
                        {mandiRows.length === 0 && fpFlowers.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-gray-400 text-center">No mandi plan captured. Add flowers below, or run Deal Check before marking Sold to auto-capture it.</div>
                        ) : (
                          <div className="">
                            {mandiRows.map((r, i) => {
                              const lineActual = (Number(r.qty) || 0) * (Number(r.price) || 0);
                              const lineVar = lineActual - (Number(r.projCost) || 0);
                              return (
                                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 items-center">
                                  <div className="min-w-0">
                                    {/* Dotted leader (same pattern as the manpower "how" tables) filling
                                        whatever's left of the name to the numbers. ONE flex row holding
                                        the photo, name and the dotted span directly — the previous
                                        version nested the dotted span inside an extra flex-1 wrapper div,
                                        which left it filling only THAT wrapper's shrink-to-fit width
                                        instead of the full row, so the line stopped well short of the
                                        numbers instead of reaching them. */}
                                    <div className="flex items-center gap-2 min-w-0">
                                      {r.colorVariant?.photoUrl && <img src={thumbUrl(r.colorVariant.photoUrl, 28)} loading="lazy" decoding="async" alt={r.colorVariant.label || ""} onClick={() => setZoomImg(r.colorVariant.photoUrl)} className="w-7 h-7 rounded object-cover border border-gray-200 shrink-0 cursor-zoom-in" title={r.colorVariant.label || ""} />}
                                      <span className="text-xs font-medium text-gray-800 truncate">{r.name}{r.colorVariant?.label && <span className="ml-1.5 font-normal text-[10px] text-purple-600">🎨 {r.colorVariant.label}</span>}</span>
                                      <span aria-hidden="true" className="flex-1 min-w-2 border-b border-dotted border-gray-300 mb-[3px]" />
                                    </div>
                                    {Array.isArray(r.colorPrefs) && r.colorPrefs.length > 1 && (
                                      <div className="text-[10px] text-gray-400">if not at the mandi: {r.colorPrefs.slice(1).map(p => p.label).join(", ")}</div>
                                    )}
                                    {r.swappedTo && <div className="text-[10px] font-semibold text-amber-700">🔁 Not in the mandi — swapped with {r.swappedTo}{r.swapNote ? ` · ${r.swapNote}` : ""}</div>}
                                    {r.swapFor && <div className="text-[10px] font-semibold text-amber-700">🔁 Bought instead of {r.swapFor}{r.swapNote ? ` · ${r.swapNote}` : ""}</div>}
                                    {r.projQty > 0 && <div className="text-[10px] text-gray-400">{r.projQty} {r.unit} planned</div>}
                                  </div>
                                  <div className="text-right w-28 text-xs text-gray-400">{r.projCost > 0 ? fmt(r.projCost) : <span className="text-amber-500">extra</span>}</div>
                                  <div className="flex items-center justify-end gap-1 w-[264px]">
                                    {/* 0 against a planned flower = not in the mandi → ask what was bought
                                        instead. On blur, not on change: clearing the box to type a new
                                        number passes through empty and must not pop a dialog. */}
                                    <input type="number" min="0" value={r.qty} onChange={e => setMandi(i, "qty", e.target.value)}
                                      onBlur={e => { if ((Number(e.target.value) || 0) === 0 && Number(r.projQty) > 0 && !r.swappedTo && !r.swapFor) openMandiSwap(i); }}
                                      className="shrink-0 w-12 border rounded px-1.5 py-1 text-xs text-center" title="qty" />
                                    <span className="shrink-0 text-[10px] text-gray-300">×</span>
                                    <input type="number" min="0" value={r.price} onChange={e => setMandi(i, "price", e.target.value)} className="shrink-0 w-16 border rounded px-1.5 py-1 text-xs text-center" title="₹/unit" />
                                    <span className={"shrink-0 w-16 text-right text-xs font-semibold " + (lineVar > 0 ? "text-red-500" : lineVar < 0 ? "text-emerald-600" : "text-gray-700")}>{fmt(lineActual)}</span>
                                    {r.swapFor ? <span className="shrink-0 w-5" /> : (
                                      <button onClick={() => openMandiSwap(i)} title={r.swappedTo ? `Swapped with ${r.swappedTo} — click to change or remove` : "Not available in the mandi? Swap it with another flower"}
                                        className={"shrink-0 w-5 text-xs rounded " + (r.swappedTo ? "bg-amber-100 text-amber-700" : "text-gray-300 hover:text-amber-600")}>🔁</button>
                                    )}
                                    <button onClick={() => delMandi(i)} className="shrink-0 text-red-300 hover:text-red-500 text-xs">×</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* Artificial flowers/greens is NOT shown again here — it's already its own
                            line in the "Floral cost to source" summary card above. This real-shopping
                            list is scoped to real mandi purchases only, and so is its own Total row
                            (mandiActualReal) — it must match the sum of the rows actually on screen. */}
                        {/* Totals row */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-50 items-center">
                          <span className="text-xs font-bold text-emerald-900">Total</span>
                          <span className="text-right w-28 text-xs font-semibold text-gray-500">{fmt(projectedTotal)}</span>
                          <span className="text-right w-[264px] text-sm font-bold text-emerald-800 pr-6">{fmt(mandiActualReal)}</span>
                        </div>
                        </div>
                      </div>
                      {/* Add a flower with autocomplete from the Mandi Prices tab */}
                      <div className="relative">
                        <input value={mandiQuery} onChange={e => setMandiQuery(e.target.value)} placeholder="➕ Add flower — type e.g. 'mu' for Muraya (from Mandi Prices)" className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm" />
                        {mandiSuggest.length > 0 && (
                          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                            {mandiSuggest.map(f => (
                              <button key={f.id} onClick={() => addMandi(f)} className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-emerald-50 text-left">
                                <span className="font-medium text-gray-800">{f.name} <span className="text-[10px] text-gray-400">{f.flowerCat} · {f.unit}</span></span>
                                <span className="text-xs font-semibold text-emerald-700">{fmt(f.currentPrice)}/{f.unit}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {mandiQuery.trim() && mandiSuggest.length === 0 && <div className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg px-3 py-2 text-xs text-gray-400">No match in Mandi Prices. <button onClick={() => addMandi({ name: mandiQuery.trim(), unit: "bundle", currentPrice: 0 })} className="text-emerald-600 font-medium">Add "{mandiQuery.trim()}" anyway</button></div>}
                      </div>
                      {mandiActualReal > 0 && projectedTotal > 0 && (
                        <div className={"text-xs font-semibold " + (variance > 0 ? "text-red-600" : "text-emerald-700")}>
                          {variance > 0 ? "▲ Over" : variance < 0 ? "▼ Under" : "On"} plan by {fmt(Math.abs(variance))} — salesperson's P&L uses the real {fmt(mandiActualTotal)}.
                        </div>
                      )}
                    </div>
                  );
                })()}
                {opsExpenses.length > 0 && (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500 pt-1">Synced from Ops</div>
                    {opsExpenses.map((ex, i) => (
                      <div key={"ops" + i} className="flex items-center gap-2 bg-blue-50/60 rounded-lg px-3 h-9">
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={ex.label}>{ex.label || "Expense"}</span>
                        <span className="shrink-0 text-xs text-gray-400">{ex.date || ""}{ex.loggedBy ? ` · ${ex.loggedBy}` : ""}</span>
                        <span className="shrink-0 w-24 text-right text-sm font-semibold tabular-nums text-gray-800">{fmt(Number(ex.amount) || 0)}</span>
                      </div>
                    ))}
                  </>
                )}
                {expenses.length > 0 && (
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500 pt-1">On-site expenses (manual)</div>
                )}
                {expenses.map((ex, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={ex.label} onChange={e => setExpense(i, "label", e.target.value)} placeholder="What was it for?" className="min-w-0 flex-1 h-9 rounded-lg bg-white ring-1 ring-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <input type="number" min="0" value={ex.amount} onChange={e => setExpense(i, "amount", e.target.value)} placeholder="₹ 0" className="shrink-0 w-24 h-9 rounded-lg bg-white ring-1 ring-gray-200 px-3 text-sm text-right font-semibold tabular-nums placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={() => delExpense(i)} aria-label="Remove expense" title="Remove"
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                ))}
                {/* A real button, full width, rather than a line of green link text: it is the
                    one action on the card when nothing has been logged yet. */}
                <button onClick={addExpense} className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors">
                  <span aria-hidden="true" className="text-sm leading-none">+</span> Add on-site expense
                </button>
              </div>
            </div>

            {/* Loading / dispatch — cross-check inventory + essentials while loading the truck.
                Opens under the Truck planning tile; the dismantle plan has its own tile. */}
            <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("truck")}>
              {/* Same header shape as the other blocks: icon tile, title, primary action at the
                  right end, a one-line caption under it with the secondary action beside it. */}
              <div className="px-3 sm:px-4 py-3 bg-gray-50">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🚚</span>
                  <div className="min-w-0 flex-1 text-[15px] font-semibold text-gray-900">Loading &amp; dispatch</div>
                  <button onClick={addTruck} className="shrink-0 h-8 inline-flex items-center gap-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-lg transition-colors">
                    <span aria-hidden="true" className="text-sm leading-none">+</span> Add truck
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-500">Trucks are shared by every department on this event. Each prints its own challan.</span>
                  <button onClick={() => setShowFleet(v => !v)} aria-expanded={showFleet}
                    className={"shrink-0 text-xs font-semibold transition-colors " + (showFleet ? "text-gray-900" : "text-blue-600 hover:text-blue-800")}>
                    {showFleet ? "Done" : "Manage fleet"}
                  </button>
                </div>
              </div>
              {showFleet && (
                <div className="px-3 sm:px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-2.5">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">Own fleet</div>
                    <div className="mt-0.5 text-[11px] text-gray-400">Shared across departments.</div>
                  </div>
                  {fleet.length > 0 && (
                    <div className="rounded-lg bg-white ring-1 ring-gray-200 divide-y divide-gray-100">
                      {fleet.map(f => (
                        <div key={f.id} className="flex items-center gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-gray-800 truncate">{f.vehicle}</div>
                            <div className="text-[11px] text-gray-500 truncate">{f.driver || "—"}{f.phone ? ` · ${f.phone}` : ""}</div>
                          </div>
                          <button onClick={() => delFleet(f.id)} aria-label={`Remove ${f.vehicle}`} title="Remove"
                            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    <input value={newVeh.vehicle} onChange={e => setNewVeh(v => ({ ...v, vehicle: e.target.value }))} placeholder="Vehicle no." className="h-9 rounded-lg bg-white ring-1 ring-gray-200 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <input value={newVeh.driver} onChange={e => setNewVeh(v => ({ ...v, driver: e.target.value }))} placeholder="Driver name" className="h-9 rounded-lg bg-white ring-1 ring-gray-200 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <input value={newVeh.phone} onChange={e => setNewVeh(v => ({ ...v, phone: phone10(e.target.value) }))} inputMode="numeric" maxLength={10} placeholder="Phone (10 digits)" className="h-9 rounded-lg bg-white ring-1 ring-gray-200 px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    <button onClick={addFleet} className="h-9 bg-gray-900 hover:bg-black text-white px-3 rounded-lg text-xs font-semibold transition-colors">Add vehicle</button>
                  </div>
                </div>
              )}
              {/* Trucks */}
              {trucks.length === 0 ? (
                /* An empty state that says what to do, not a sentence floating in white space. */
                <div className="px-4 py-7 flex flex-col items-center text-center">
                  <span aria-hidden="true" className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg leading-none">🚛</span>
                  <div className="mt-2.5 text-sm font-semibold text-gray-800">No trucks yet</div>
                  <div className="mt-0.5 text-xs text-gray-500">Add a truck to start loading.</div>
                </div>
              ) : (
                <div className="px-3 sm:px-4 py-3 space-y-3">
                  {trucks.map((t, ti) => (
                    /* Each truck is its own card. Stacked in bare padding they ran into each
                       other, and nothing marked where one truck's items stopped. */
                    <div key={t.id} ref={el => { truckRefs.current[t.id] = el; }} className={"rounded-xl ring-1 p-3 space-y-2.5 scroll-mt-4 " + (openTruck === t.id ? "ring-blue-200" : "ring-gray-200")}>
                      {/* ── THE HEADER IS THE TRUCK, OPEN OR SHUT ──
                          Everything needed to tell trucks apart without opening one: number, plate,
                          driver, phone, status and how full it is. Tapping it opens this truck and
                          closes whichever was open. */}
                      <div className="flex items-start justify-between gap-2">
                        {(() => {
                          const oc = truckOccs[t.id] || { used: 0 };
                          const pct = Math.round(oc.used * 100), over = oc.used > 1.005, full = oc.used >= 0.999;
                          const st = t.status || "loading";
                          return (
                            <button type="button" onClick={() => toggleTruck(t.id)} aria-expanded={openTruck === t.id} className="min-w-0 flex-1 text-left cursor-pointer">
                              <div className="flex items-center gap-2 min-w-0">
                                <span aria-hidden="true" className={"shrink-0 text-gray-400 transition-transform duration-150 " + (openTruck === t.id ? "rotate-90" : "")}>
                                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3.5 L8.5 7 L5 10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </span>
                                <span className="text-sm font-semibold text-gray-900 shrink-0">Truck {ti + 1}</span>
                                <span className="min-w-0 truncate text-[12px] text-gray-500">{[t.vehicle, t.driver].filter(Boolean).join(" · ") || "no vehicle yet"}</span>
                                <span className={"shrink-0 ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ring-1 " + (TRUCK_STATUS_CLS[st] || TRUCK_STATUS_CLS.loading)}>{TRUCK_STATUS_LABEL[st] || st}</span>
                              </div>
                              <div className="mt-1.5 pl-5 flex items-center gap-2">
                                {t.phone ? <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">📞 {t.phone}</span> : null}
                                <div className={"min-w-0 flex-1 h-1.5 rounded-full overflow-hidden flex " + (over ? "bg-red-100" : "bg-gray-100")}>
                                  {(oc.byDept || []).map(b => <div key={b.dept} className={DEPT_BAR[b.dept] || "bg-gray-400"} style={{ width: `${Math.min(100, b.used * 100)}%` }} />)}
                                </div>
                                <span className={"shrink-0 text-[11px] font-bold tabular-nums " + (over || full ? "text-red-600" : pct >= 80 ? "text-amber-600" : "text-gray-700")}>{over ? `Over ${pct}%` : full ? "Full" : `${pct}% full`}</span>
                              </div>
                            </button>
                          );
                        })()}
                        {/* Removing a truck removes it for every department, so it is held back while
                            another department still has items on it. */}
                        <button onClick={() => delTruck(t.id)} disabled={Object.entries(t.loads || {}).some(([d, ld]) => d !== dept && Object.values(ld || {}).some(q => Number(q) > 0))}
                          aria-label={`Remove truck ${ti + 1}`} title={Object.entries(t.loads || {}).some(([d, ld]) => d !== dept && Object.values(ld || {}).some(q => Number(q) > 0)) ? "Another department has items on this truck" : "Remove truck"}
                          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-300 transition-colors">
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
                        </button>
                      </div>
                      {openTruck === t.id && (<>
                      {/* ── WHO FILLS IT ── the bar itself is in the header above; opened, the truck adds
                          each department's share of it and what to do when it is full. */}
                      {(() => {
                        const oc = truckOccs[t.id] || { used: 0, byDept: [], unknown: 0 };
                        const pct = Math.round(oc.used * 100);
                        const over = oc.used > 1.005, full = oc.used >= 0.999;
                        if (!oc.byDept.length && !oc.unknown) return null;
                        return (
                          <div>
                            {(over || full) && <div className="text-[11px] font-bold text-red-600">{over ? `Over by ${pct - 100}% — move items to another truck` : "Full — no space left"}</div>}
                            {oc.byDept.length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                                {oc.byDept.map(b => <span key={b.dept} className={"inline-flex items-center gap-1 " + (b.dept === dept ? "font-semibold text-gray-800" : "")}><span className={"w-2 h-2 rounded-sm " + (DEPT_BAR[b.dept] || "bg-gray-400")} />{b.dept} {Math.round(b.used * 100)}%</span>)}
                              </div>
                            )}
                            {oc.unknown > 0 && <div className="mt-0.5 text-[10px] text-gray-400">{oc.unknown} item{oc.unknown === 1 ? " has" : "s have"} no truck capacity set — not counted. Set it in Planning → 🚚 Truck.</div>}
                          </div>
                        );
                      })()}
                      <div className="flex items-center gap-2 flex-wrap">
                        <select value={t.status || "loading"} onChange={e => setTruck(t.id, { status: e.target.value })} className="h-8 rounded-lg bg-white ring-1 ring-gray-200 px-2 text-xs font-medium capitalize focus:outline-none focus:ring-2 focus:ring-blue-400">{TRUCK_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                        {t.phone && <a href={"tel:" + t.phone} className="h-8 inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-lg px-2.5 hover:bg-emerald-100" title={"Call " + (t.driver || "driver") + " · " + t.phone}>Call {t.phone}</a>}
                        <button onClick={() => downloadTruckChallanPdf(t, ti + 1)} disabled={!!challanPdfBusy} className="h-8 ml-auto text-xs font-semibold bg-white ring-1 ring-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60 px-3 rounded-lg transition-colors">{challanPdfBusy === t.id ? "Making PDF…" : "Download PDF"}</button>
                        <button onClick={() => printTruckChallan(t, ti + 1)} className="h-8 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-lg transition-colors">Print challan</button>
                      </div>
                      {/* Labelled, so the chips read as "pick one of these" rather than as tags
                          already applied to the truck. Vehicle and driver stacked in the chip,
                          not joined by a dot, so the plate number leads. */}
                      {eventTrucks.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Pick from fleet</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {eventTrucks.map(f => { const on = t.vehicle === f.vehicle && t.driver === f.driver; return (
                              <button key={f.id} onClick={() => setTruck(t.id, { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" })} aria-pressed={on}
                                className={"text-left px-2.5 py-1.5 rounded-lg ring-1 transition-colors " + (on ? "bg-blue-50 ring-blue-300" : "bg-white ring-gray-200 hover:bg-gray-50")}>
                                <span className={"block text-[11px] font-semibold tabular-nums " + (on ? "text-blue-700" : "text-gray-800")}>{f.vehicle || f.driver}</span>
                                {f.vehicle && f.driver && <span className={"block text-[10px] capitalize " + (on ? "text-blue-600" : "text-gray-500")}>{String(f.driver).toLowerCase()}</span>}
                              </button>
                            ); })}
                          </div>
                        </div>
                      )}
                      {/* Two to a row on a phone, phone number full width under them — three
                          full-width fields stacked made each truck a screen tall before its items. */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[["Vehicle no.", "vehicle"], ["Driver", "driver"], ["Phone", "phone"]].map(([l, k]) => (
                          <div key={k} className={k === "phone" ? "col-span-2 sm:col-span-1" : ""}><label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">{l}</label><input value={t[k] || ""} onChange={e => setTruck(t.id, { [k]: e.target.value })} placeholder={k === "vehicle" ? "outside vehicle?" : ""} className="mt-1 w-full h-9 rounded-lg bg-white ring-1 ring-gray-200 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" /></div>
                        ))}
                      </div>
                      {blockedItems.length > 0 ? (
                        /* One line per item: name over its loaded status, the "on this truck" box
                           at the right. As a flex-wrap row the status and the box broke onto
                           lines of their own at any width under ~500px. */
                        <div className="rounded-lg bg-gray-50 divide-y divide-gray-100">
                          {blockedItems.map(it => { const k = "inv:" + it.id; const onThis = Number(t.items?.[k]) || 0; const totalLoaded = truckLoadedQty(k); const extraHere = Number(t.extras?.[k]) || 0; const extraAll = truckExtraQty(k); const maxHere = Math.max(onThis, (Number(it.qty) || 0) - (totalLoaded - onThis)); const matchCls = totalLoaded === it.qty ? "text-emerald-600" : totalLoaded > it.qty ? "text-red-600" : totalLoaded > 0 ? "text-amber-600" : "text-gray-400"; return (
                            <div key={k} className="flex items-center gap-2.5 px-2.5 py-2">
                              {it.photo ? <img src={thumbUrl(it.photo, 32)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded-lg object-cover cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs shrink-0">📦</div>}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-gray-800 leading-snug line-clamp-2" title={it.name}>{it.name}</div>
                                <div className={"mt-0.5 text-[11px] font-semibold tabular-nums " + matchCls}>{totalLoaded} of {it.qty} loaded{totalLoaded > it.qty ? " · too many" : totalLoaded === it.qty ? " ✓" : ""}{extraAll > 0 && <span className="text-amber-600"> · +{extraAll} extra</span>}</div>
                                {/* This item's share of the truck, and how many more of it the space left takes. */}
                                {(() => {
                                  const sh = truckShares[dept]?.get(truckKey(it));
                                  if (!sh) return <div className="text-[10px] text-gray-400">no truck capacity set</div>;
                                  const left = Math.max(0, 1 - (truckOccs[t.id]?.used || 0));
                                  return <div className="text-[10px] text-gray-500 tabular-nums">{onThis > 0 ? `${Math.round(onThis * sh.perUnit * 100)}% of this truck · ` : ""}{left > 0 ? `fits ~${Math.floor(left / sh.perUnit + 1e-9)} more` : "no space left"} · ~{Math.round(sh.perTruck)} per truck</div>;
                                })()}
                              </div>
                              {/* Normal load, capped at what the item still needs across all trucks. Once it is
                                  fully loaded, the amber box takes any extra (overload) on this truck. */}
                              <input type="number" min="0" max={maxHere} value={onThis || ""} onChange={e => setTruckItem(t.id, k, e.target.value === "" ? "" : Math.min(maxHere, Math.max(0, Number(e.target.value) || 0)))} placeholder="0" aria-label={`${it.name} on this truck`} title={`On this truck (up to ${maxHere})`}
                                className="shrink-0 w-14 h-8 rounded-lg bg-white ring-1 ring-gray-200 px-2 text-sm text-center font-semibold tabular-nums placeholder:font-normal placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                              {(totalLoaded >= (Number(it.qty) || 0) || extraHere > 0) && (
                                <label className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-700" title="Extra pieces on this truck beyond what the item needs (overload)">
                                  +
                                  <input type="number" min="0" value={extraHere || ""} onChange={e => setTruckExtra(t.id, k, e.target.value === "" ? "" : Math.max(0, Number(e.target.value) || 0))} placeholder="extra" aria-label={`${it.name} extra on this truck`}
                                    className="w-14 h-8 rounded-lg bg-amber-50 ring-1 ring-amber-300 px-1.5 text-sm text-center font-semibold tabular-nums text-amber-800 placeholder:font-normal placeholder:text-[10px] placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                                </label>
                              )}
                            </div>
                          ); })}
                        </div>
                      ) : <div className="text-xs text-gray-400">No inventory blocked for this department.</div>}
                      </>)}
                    </div>
                  ))}
                </div>
              )}
              {/* Essentials / tools */}
              {/* ── ESSENTIALS ──
                  An eyebrow and a short caption, like every other section marker, on the card's
                  own white. The amber wash, amber text, amber input and amber button made a
                  checklist look like a warning. */}
              <div className="px-3 sm:px-4 py-3 border-t border-gray-100 space-y-2.5">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">Essentials</div>
                  <div className="mt-0.5 text-[11px] text-gray-400">Carried, not blocked. Saved for every {dept} event.</div>
                </div>
                {deptTools.length > 0 && (
                  <div className="rounded-lg ring-1 ring-gray-200 divide-y divide-gray-100">
                    {deptTools.map((t, i) => {
                      const k = "tool:" + t.name; const on = !!loaded[k];
                      return (
                        <label key={i} className="flex items-center gap-3 px-3 py-2 cursor-pointer">
                          <input type="checkbox" checked={on} onChange={() => toggleLoaded(k)} className="w-4 h-4 accent-blue-600 shrink-0" />
                          <span className={"min-w-0 flex-1 truncate text-[13px] " + (on ? "line-through text-gray-400" : "text-gray-800")}>{t.name}</span>
                          <input type="number" min="1" value={t.qty || 1} onChange={e => setTool(i, "qty", e.target.value)} aria-label={`${t.name} quantity`} title="Quantity"
                            className="shrink-0 w-12 h-7 rounded-md bg-gray-50 ring-1 ring-gray-200 px-1.5 text-xs text-center font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          <button type="button" onClick={() => delTool(i)} aria-label={`Remove ${t.name}`} title="Remove"
                            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
                          </button>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input value={newTool} onChange={e => setNewTool(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addTool(newTool); }} placeholder="Add an item, e.g. ladder"
                    className="min-w-0 flex-1 h-9 rounded-lg bg-white ring-1 ring-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  <button onClick={() => addTool(newTool)} className="shrink-0 h-9 text-xs font-semibold bg-gray-900 hover:bg-black text-white px-4 rounded-lg transition-colors">Add</button>
                </div>
                {(DEFAULT_TOOLS[dept] || []).filter(s => !deptTools.some(t => (t.name || "").toLowerCase() === s.toLowerCase())).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(DEFAULT_TOOLS[dept] || []).filter(s => !deptTools.some(t => (t.name || "").toLowerCase() === s.toLowerCase())).map(s => (
                      <button key={s} onClick={() => addTool(s)} className="text-xs font-medium px-2.5 py-1 rounded-lg bg-gray-50 ring-1 ring-gray-200 text-gray-600 hover:bg-white hover:text-gray-900 transition-colors">+ {s}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Dismantle plan — the department head's pre-set; opens under its own tile. On-site's
                "Dismantle & routing" confirms it at teardown. See SHOW_DISMANTLE_IN_PLANNING. */}
            {dept === "Tenting" && carpetPlanOf().rows.length > 0 && (() => {
              const plan = carpetPlanOf();
              const choiceAll = deptData.carpetChoice || {};
              // A decision remembers the date and function it was made for, so it can never land on another floor if functions are later
              // removed or renumbered in Studio (carpetPlan.validDecision).
              const decide = (r, o, manual) => saveDept({ carpetChoice: { ...choiceAll, [r.key]: { id: o.id, name: o.name, ...(manual ? { manual: true } : {}), date: r.date, fnType: r.fnLabel, by: authUser?.name || "—", at: Date.now() } } });
              // None of the stock carpets can be used (every one short, or the floor is bigger than anything owned): the carpet is arranged outside stock.
              const decideOther = (r) => saveDept({ carpetChoice: { ...choiceAll, [r.key]: { other: true, name: "Arranged separately", date: r.date, fnType: r.fnLabel, by: authUser?.name || "—", at: Date.now() } } });
              const undecide = (key) => { const n2 = { ...choiceAll }; delete n2[key]; saveDept({ carpetChoice: n2 }); };
              // ── ONE CARPET, EVERY FLOOR THAT OFFERS IT ── the same carpet is often sales' pick on several
              // floors. Floors not yet decided whose own choices include it (and where it is not short)
              // take it in one go; a floor already decided is never overwritten. Each floor is checked on
              // its own figures, so the over-commit warning above still flags floors that together need
              // more of it on one date than is free.
              const sameCarpetRows = (o) => plan.rows.filter(x => x.status !== "decided" && x.options.some(p => p.id === o.id && !(p.known && !p.enough)));
              const decideAll = (o) => {
                const next = { ...choiceAll };
                sameCarpetRows(o).forEach(x => { next[x.key] = { id: o.id, name: o.name, date: x.date, fnType: x.fnLabel, by: authUser?.name || "—", at: Date.now() }; });
                saveDept({ carpetChoice: next });
              };
              const dayLbl = (d) => { try { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "the event date"; } catch { return d || "the event date"; } };
              const overNames = Object.keys(plan.over).map(id => ({ id, ...plan.over[id], name: plan.rows.flatMap(r => r.options).find(o => o.id === id)?.name || id }));
              const RANK = ["1st", "2nd", "3rd", "4th"];
              return (
              <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("carpet")}>
                <div className="px-3 sm:px-4 py-3 bg-gray-50 flex items-center gap-3">
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🟥</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-gray-900">Carpet plan</div>
                    <div className="text-xs text-gray-500">Sales picked up to four carpets for each floor. Check what is free on the day and choose the one that goes down.</div>
                  </div>
                </div>
                <div className="p-3 sm:p-4 space-y-3">
                  {overNames.length > 0 && (
                    <div className="rounded-lg bg-red-50 ring-1 ring-red-100 px-3 py-2 text-xs text-red-700">
                      ⚠ {overNames.map(o => `${o.name}: floors need ${Math.round(o.committed)} sqft together${o.date ? ` on ${dayLbl(o.date)}` : ""}, only ${Math.round(o.free)} free`).join(" · ")}
                    </div>
                  )}
                  {plan.rows.map(r => {
                    const dec = [...r.options, r.manual].filter(Boolean).find(o => o.id === r.decidedId);
                    const chip = r.status === "decided" ? { t: r.other ? "✓ Decided: arranged separately (not from stock)" : `✓ Decided: ${dec?.name || ""}${r.manual ? " (picked in Planning)" : ""}`, c: "bg-emerald-50 text-emerald-700 ring-emerald-100" }
                      : r.status === "short" ? { t: "None of the choices covers this floor", c: "bg-red-50 text-red-700 ring-red-100" }
                      : r.status === "none" ? { t: "Sales has not picked a carpet", c: "bg-amber-50 text-amber-700 ring-amber-100" }
                      : { t: "Not decided yet", c: "bg-amber-50 text-amber-700 ring-amber-100" };
                    return (
                      <div key={r.key} className="rounded-xl ring-1 ring-gray-200 p-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900">{r.zoneName}</span>
                          <span className="text-[11px] text-gray-500">{[r.fnLabel, r.date && dayLbl(r.date)].filter(Boolean).join(" · ")}</span>
                          <span className="text-[11px] text-gray-500 tabular-nums">· {r.dims} = {Math.round(r.area)} sqft</span>
                          <span className={"ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 " + chip.c}>{chip.t}</span>
                        </div>
                        {r.options.length === 0 ? (
                          <div className="mt-2 text-xs text-gray-500">Nothing to choose from yet — ask sales to pick up to four carpets in Build (Platform → Carpet).</div>
                        ) : (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {r.options.map(o => {
                              const on = o.id === r.decidedId;
                              const ph = o.item ? (o.item.img || (Array.isArray(o.item.photoUrls) && o.item.photoUrls[0]) || "") : "";
                              return (
                                <div key={o.id} className={"rounded-lg p-2 flex flex-col gap-2 ring-1 " + (on ? "ring-emerald-400 bg-emerald-50/60" : "ring-gray-200 bg-white")}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="shrink-0 w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center" title={RANK[o.rank] + " choice"}>{o.rank + 1}</span>
                                    {ph ? <img src={thumbUrl(ph, 96)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(ph)} className="w-12 h-12 rounded-md object-cover border border-gray-200 cursor-zoom-in shrink-0" /> : <span className="w-12 h-12 rounded-md bg-gray-100 shrink-0" />}
                                    <div className="min-w-0">
                                      <div className="text-[13px] font-semibold text-gray-900 truncate" title={o.name}>{o.name}</div>
                                      <div className={"text-[11px] tabular-nums " + (!o.known ? "text-gray-500" : o.enough ? "text-emerald-700" : "text-red-600")}>
                                        {!o.known ? "Stock not known" : o.enough ? `✓ ${Math.round(o.free)} sqft free · covers it` : `${Math.round(o.free)} sqft free · short ${Math.round(o.short)}`}
                                      </div>
                                      {o.reuse && <div className="text-[10.5px] font-semibold text-orange-600" title="Already laid at this venue on this date for another event — it stays down, so it can be reused here">⇄ In use here: {[...(o.reuse.siblings || []), ...(o.reuse.who || [])].join(", ")}{o.reuse.qty > 0 ? ` · ${Math.round(o.reuse.qty)} sqft laid` : ""} — reusable</div>}
                                      {!on && r.suggestedId === o.id && !r.decidedId && <div className="text-[10.5px] font-semibold text-sky-700">Suggested</div>}
                                    </div>
                                  </div>
                                  {on
                                    ? <button type="button" onClick={() => undecide(r.key)} className="text-[12px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer" title="Chosen — tap to undo">✓ Using this · undo</button>
                                    : <button type="button" disabled={o.known && !o.enough} onClick={() => decide(r, o)}
                                        title={o.known && !o.enough ? `Short on this date — only ${Math.round(o.free)} sqft free (+${Math.round(o.reuse?.qty || 0)} laid here), the floor needs ${Math.round(r.area)}` : undefined}
                                        className={"text-[12px] font-semibold rounded-md px-2 py-1 ring-1 " + (o.known && !o.enough ? "ring-gray-200 text-gray-400 cursor-not-allowed" : "ring-gray-300 text-gray-800 hover:bg-gray-50 cursor-pointer")}>Use this</button>}
                                  {!on && !(o.known && !o.enough) && (() => { const n = sameCarpetRows(o).length; return n > 1 ? (
                                    <button type="button" onClick={() => decideAll(o)} title={`Use ${o.name} on every floor that has it as a choice and is not decided yet`}
                                      className="text-[12px] font-semibold rounded-md px-2 py-1 bg-gray-100 text-gray-800 hover:bg-gray-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1">Use on all {n} floors</button>
                                  ) : null; })()}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* ── NONE OF SALES' CHOICES AVAILABLE? ── Planning can pick any carpet in stock by hand, in the same availability
                            picker Build uses (free sqft for this floor's date; short ones cannot be picked). */}
                        {(() => {
                          const anyCovers = r.options.some(o => o.enough);
                          const mph = r.manual && r.manual.item ? (r.manual.item.img || (Array.isArray(r.manual.item.photoUrls) && r.manual.item.photoUrls[0]) || "") : "";
                          return (
                            <div className="mt-3 pt-2.5 border-t border-gray-100">
                              {r.other && (
                                <div className="mb-2 rounded-lg p-2 flex items-center gap-2 ring-1 ring-emerald-400 bg-emerald-50/60">
                                  <span className="w-12 h-12 rounded-md bg-gray-100 shrink-0 flex items-center justify-center text-lg" aria-hidden="true">🛒</span>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-semibold text-gray-900">Arranged separately</div>
                                    <div className="text-[11px] text-emerald-700">The carpet for this floor is bought or hired outside stock.</div>
                                  </div>
                                  <button type="button" onClick={() => undecide(r.key)} className="shrink-0 text-[12px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer" title="Chosen — tap to undo">✓ Using this · undo</button>
                                </div>
                              )}
                              {r.manual && (
                                <div className="mb-2 rounded-lg p-2 flex items-center gap-2 ring-1 ring-emerald-400 bg-emerald-50/60">
                                  {mph ? <img src={thumbUrl(mph, 96)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(mph)} className="w-12 h-12 rounded-md object-cover border border-gray-200 cursor-zoom-in shrink-0" /> : <span className="w-12 h-12 rounded-md bg-gray-100 shrink-0" />}
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[13px] font-semibold text-gray-900 truncate" title={r.manual.name}>{r.manual.name}</div>
                                    <div className={"text-[11px] tabular-nums " + (r.manual.enough ? "text-emerald-700" : "text-red-600")}>{r.manual.known ? `${Math.round(r.manual.free)} sqft free` : "Stock not known"} · picked in Planning, not one of sales' choices</div>
                                  </div>
                                  <button type="button" onClick={() => undecide(r.key)} className="shrink-0 text-[12px] font-semibold rounded-md px-2 py-1 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer" title="Chosen — tap to undo">✓ Using this · undo</button>
                                </div>
                              )}
                              <button type="button" onClick={() => setCarpetMore(r.key)}
                                className={"text-[12px] font-semibold rounded-md px-2.5 py-1 ring-1 cursor-pointer " + (!anyCovers && !r.manual ? "ring-red-300 text-red-700 bg-red-50 hover:bg-red-100" : "ring-gray-300 text-gray-700 hover:bg-gray-50")}>
                                {!anyCovers && !r.manual && r.options.length ? "None of these is available — choose another carpet…" : r.manual ? "Choose a different carpet…" : "Choose another carpet…"}
                              </button>
                              {!r.other && (
                                <button type="button" onClick={() => decideOther(r)} title="No stock carpet can be used for this floor — the carpet is bought or hired outside stock"
                                  className="ml-2 text-[12px] font-semibold rounded-md px-2.5 py-1 ring-1 ring-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer">Arrange separately (not from stock)</button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                  {carpetMore && (() => {
                    const r = plan.rows.find(x => x.key === carpetMore);
                    if (!r) return null;
                    // every carpet in stock with this floor's date free sqft; sales' own choices carry their rank
                    const all = carpetStockFor(r, inventory, blocks, sel?.id, eventOrders, plan.rows, sel?.deptOps?.Tenting?.carpetChoice || {}).map(o => ({ ...o, rank: r.options.find(x => x.id === o.id)?.rank ?? null }));
                    return (
                      <CarpetPickerModal floor={r} options={all} selectedId={r.decidedId} dateLabel={dayLbl(r.date)}
                        onClose={() => setCarpetMore(null)}
                        onSave={(o) => { decide(r, o, o.rank === null); setCarpetMore(null); }} />
                    );
                  })()}
                </div>
              </div>
              );
            })()}
            {dept === "Fabric" && elementPlanOf().rows.length > 0 && (() => {
              const choiceAll = deptData.itemChoice || {};
              // A decision remembers the date and function it was made for, so it can never land on another element if functions are later
              // removed or renumbered in Studio (carpetPlan.validDecision).
              const put = (r, entry) => saveDept({ itemChoice: { ...choiceAll, [r.key]: { ...entry, date: r.date, fnType: r.fnLabel, by: authUser?.name || "—", at: Date.now() } } });
              return (
                <ElementChoicePlan className={modalCls("fabreq")} plan={elementPlanOf()} onZoom={setZoomImg}
                  stockOf={(r) => elementStockFor(r, inventory, blocks, sel?.id, sel?.functionsDetail, elementPlanOf().rows, choiceAll)}
                  onDecide={(r, o, byHand) => put(r, { id: o.id, name: o.name, ...(byHand ? { manual: true } : {}) })}
                  // The same design on every undecided row that offers it (and is not short there) — the
                  // overlay / cushion version of the Carpet plan's "Use on all N floors".
                  onDecideAll={(o) => {
                    const next = { ...choiceAll };
                    elementPlanOf().rows.filter(x => x.status !== "decided" && x.options.some(p => p.id === o.id && !(p.known && !p.enough)))
                      .forEach(x => { next[x.key] = { id: o.id, name: o.name, date: x.date, fnType: x.fnLabel, by: authUser?.name || "—", at: Date.now() }; });
                    saveDept({ itemChoice: next });
                  }}
                  onOther={(r) => put(r, { other: true, name: "Arranged separately" })}
                  onUndo={(key) => { const n2 = { ...choiceAll }; delete n2[key]; saveDept({ itemChoice: n2 }); }} />
              );
            })()}
            {dept === "Tenting" && trussPlanOf().length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("truss")}>
                <div className="px-3 sm:px-4 py-3 bg-gray-50 flex items-center gap-3">
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🏗️</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold text-gray-900">Truss plan</div>
                    <div className="text-xs text-gray-500">Every truss on this event — what to build, and the fabric it takes.</div>
                  </div>
                </div>
                <div className="p-3 sm:p-4 space-y-3">
                  {(() => {
                    const fnCount = new Set(trussPlanOf().map(z => z.fi)).size;
                    // Pillars / beams as editable groups: "N × L ft" rows (same grouping Deal Check shows).
                    const groupsOf = (arr, get) => Object.entries((arr || []).reduce((m, x) => { const len = Math.round((get(x) || 0) * 100) / 100; m[len] = (m[len] || 0) + 1; return m; }, {})).sort((a, b) => Number(b[0]) - Number(a[0])).map(([len, c]) => ({ len: Number(len), n: c }));
                    const cfgLabel = (c) => c === "u_only" ? "U Truss" : c === "half_box" ? "Half Box" : c === "full_box" ? "Full Box" : "—";
                    const numCls = "text-[13px] text-center rounded-md ring-1 ring-gray-200 bg-white px-1 py-0.5 tabular-nums font-semibold text-gray-900";
                    const tileBox = (label, children) => (
                      <div className="flex-1 min-w-[180px] rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
                        {children}
                      </div>
                    );
                    const allocChips = (allocs, unit) => (Array.isArray(allocs) && allocs.length) ? allocs.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[12px]"><b className="text-gray-800">{a.colour}</b><span className="text-gray-500">×{a.qty}{unit}</span></span>) : <span className="text-[12px] text-gray-400">not allocated in Deal Check</span>;
                    return trussPlanOf().map(z => {
                      const { pv, row, fab } = z; const topo = pv.topology, costs = pv.costs || {}, batta = pv.batta;
                      const dL = parseFloat(row.dims?.L) || 0, dW = parseFloat(row.dims?.W) || 0, dH = parseFloat(row.dims?.H) || 0;
                      const phyL = topo.physicalL ? Math.round(topo.physicalL * 100) / 100 : 0, phyW = topo.physicalW ? Math.round(topo.physicalW * 100) / 100 : 0;
                      const fabRows = fab ? [
                        fab.maskingPieces > 0 && { ic: "🧱", label: "Wall Masking", needN: fab.maskingPieces, allocs: row.maskingAllocation, unit: "pc", part: "masking", stockKey: "maskingStock", qtyField: "stockPieces" },
                        fab.lizaKg > 0 && { ic: "🧣", label: "Liza", needN: fab.lizaKg, note: fab.lizaModel === "wrap+ceiling" ? `wrap ${fab.lizaWrapKg}kg + ceiling ${fab.lizaCeilingKg}kg` : "wrap only", allocs: row.lizaAllocation, unit: "kg", part: "liza", stockKey: "lizaStock", qtyField: "stockKg" },
                        fab.curtainPieces > 0 && { ic: "🎀", label: "Velvet Curtains", needN: fab.curtainPieces, allocs: row.curtainAllocation, unit: "pc", part: "curtain", stockKey: "curtainStock", qtyField: "stockPieces" },
                      ].filter(Boolean).map(f => {
                        // The dept head's own colour pick (deptOps.trussFabric, IMS-owned, kept across
                        // every sync) wins over Deal Check's allocation.
                        const ek = `${z.key}|${f.part}`;
                        const own = deptData.trussFabric && Array.isArray(deptData.trussFabric[ek]) ? deptData.trussFabric[ek] : null;
                        return { ...f, ek, need: `${f.needN}${f.unit}`, allocs: own || f.allocs, own: !!own };
                      }) : [];
                      // ── THE DEPARTMENT'S OWN EDITS ── deptOps.trussPlan[key]: demand / footprint sizes,
                      // pillar + beam groups, batta. IMS-owned, so every Studio sync leaves them alone;
                      // anything not edited keeps showing Deal Check's own figure.
                      const ed = (deptData.trussPlan && deptData.trussPlan[z.key]) || null;
                      const saveEd = (patch) => saveDept({ trussPlan: { ...(deptData.trussPlan || {}), [z.key]: { ...(ed || {}), ...patch } } });
                      const resetEd = () => { const n2 = { ...(deptData.trussPlan || {}) }; delete n2[z.key]; saveDept({ trussPlan: n2 }); };
                      const openForm = pv.config === "u_only" || pv.config === "half_box";
                      const demandBase = openForm ? { W: pv.spanFt || Math.max(dL, dW), H: dH } : { W: dW, D: dL, H: dH };
                      const physBase = pv.config === "u_only" ? { W: phyL, H: dH } : { W: phyW, D: phyL, H: dH };
                      const pillarGroups = Array.isArray(ed?.pillars) ? ed.pillars : groupsOf(topo.pillars, x => x.H);
                      const beamGroups = Array.isArray(ed?.beams) ? ed.beams : groupsOf(topo.beams, x => x.lengthFt);
                      const rftOfG = (gs) => Math.round(gs.reduce((a, g) => a + (Number(g.len) || 0) * (Number(g.n) || 0), 0) * 100) / 100;
                      const countOfG = (gs) => gs.reduce((a, g) => a + (Number(g.n) || 0), 0);
                      const pillarRft = Array.isArray(ed?.pillars) ? rftOfG(pillarGroups) : (costs.pillarRft || 0);
                      const beamRft = Array.isArray(ed?.beams) ? rftOfG(beamGroups) : (costs.beamRft || 0);
                      const nPillars = Array.isArray(ed?.pillars) ? countOfG(pillarGroups) : topo.pillars.length;
                      const nBeams = Array.isArray(ed?.beams) ? countOfG(beamGroups) : topo.beams.length;
                      const bRft = ed?.batta?.rft ?? batta?.rftRequired ?? 0;
                      const bBuf = ed?.batta?.buf ?? batta?.bufferPct ?? 10;
                      const bTotal = ed?.batta ? Math.round((Number(bRft) || 0) * (1 + (Number(bBuf) || 0) / 100)) : (batta?.rftWithBuffer ?? 0);
                      const dimsTile = (label, key, base) => {
                        const v = { ...base, ...(ed?.[key] || {}) };
                        const set = (f, val) => saveEd({ [key]: { ...(ed?.[key] || {}), [f]: val } });
                        const inp = (f) => <input type="number" min="0" step="0.5" value={v[f] ?? ""} onChange={e => set(f, e.target.value === "" ? "" : Number(e.target.value))} className={numCls + " w-14"} />;
                        return tileBox(label, (
                          <div className="mt-1 flex items-center gap-1 flex-wrap text-[12.5px] text-gray-500">
                            {inp("W")}<span>W ×</span>{base.D !== undefined && <>{inp("D")}<span>D ×</span></>}{inp("H")}<span>H ft</span>
                          </div>
                        ));
                      };
                      const groupTile = (label, field, groups, rft) => {
                        const setG = (i, patch) => saveEd({ [field]: groups.map((g, j) => j === i ? { ...g, ...patch } : g) });
                        return tileBox(label, (
                          <div className="mt-1 space-y-1">
                            {groups.map((g, i) => (
                              <div key={i} className="flex items-center gap-1 text-[12.5px] text-gray-500">
                                <input type="number" min="0" step="1" value={g.n ?? ""} onChange={e => setG(i, { n: e.target.value === "" ? "" : Number(e.target.value) })} className={numCls + " w-12"} />
                                <span>×</span>
                                <input type="number" min="0" step="0.5" value={g.len ?? ""} onChange={e => setG(i, { len: e.target.value === "" ? "" : Number(e.target.value) })} className={numCls + " w-14"} />
                                <span>ft</span>
                                <button onClick={async () => { if (await askDelete("Remove this row?")) saveEd({ [field]: groups.filter((_, j) => j !== i) }); }} className="text-gray-300 hover:text-red-500 text-sm leading-none" title="Remove this row">×</button>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 text-[12px]">
                              <button onClick={() => saveEd({ [field]: [...groups, { n: 1, len: groups[0]?.len || 10 }] })} className="font-semibold text-blue-600 hover:underline">+ add</button>
                              <span className="font-semibold text-gray-900 tabular-nums">= {rft} RFT</span>
                            </div>
                          </div>
                        ));
                      };
                      const battaTile = () => {
                        const setB = (patch) => saveEd({ batta: { rft: bRft, buf: bBuf, ...(ed?.batta || {}), ...patch } });
                        return tileBox(`🎗️ Batta (+${bBuf}% buffer)`, (
                          <div className="mt-1 flex items-center gap-1 flex-wrap text-[12.5px] text-gray-500">
                            <input type="number" min="0" step="1" value={bRft ?? ""} onChange={e => setB({ rft: e.target.value === "" ? "" : Number(e.target.value) })} className={numCls + " w-16"} />
                            <span>RFT +</span>
                            <input type="number" min="0" step="1" value={bBuf ?? ""} onChange={e => setB({ buf: e.target.value === "" ? "" : Number(e.target.value) })} className={numCls + " w-12"} />
                            <span>% =</span><span className="font-semibold text-gray-900 tabular-nums">{bTotal} RFT</span>
                          </div>
                        ));
                      };
                      return (
                        <div key={z.key} className="rounded-xl border border-gray-200 border-l-4 border-l-amber-400 p-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[15px] font-bold text-gray-900">{z.zLabel}</span>
                            <span className="text-[11px] font-bold uppercase tracking-wide rounded px-2 py-0.5 bg-amber-50 text-amber-700">{cfgLabel(pv.config)}</span>
                            {fnCount > 1 && <span className="text-[12px] text-gray-500">{z.fn?.type || `Function ${z.fi + 1}`}{z.fn?.date ? ` · ${z.fn.date}` : ""}</span>}
                            <span className="text-[12px] text-gray-500">{row.trussMaterial ? String(row.trussMaterial) : "iron"} · {row.useNewFabric ? "New" : "Old"} fabric{row.noFabric ? " · no fabric" : ""}</span>
                          </div>
                          <div className="text-[12.5px] text-gray-600 mt-1 flex items-center gap-2 flex-wrap">
                            <span>Method {topo.method} · {nPillars} pillar{nPillars === 1 ? "" : "s"} · {nBeams} beam segment{nBeams === 1 ? "" : "s"} · {topo.totals?.totalJoints || 0} joint{(topo.totals?.totalJoints || 0) === 1 ? "" : "s"} expected</span>
                            {ed && <span className="text-[10.5px] text-indigo-600 font-semibold">· set here</span>}
                            {ed && <button onClick={resetEd} className="text-[11.5px] font-semibold text-gray-500 hover:text-gray-800">↺ back to Deal Check plan</button>}
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {dimsTile("Customer demand", "demand", demandBase)}
                            {dimsTile("Physical footprint", "physical", physBase)}
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {groupTile(`🏛️ Pillars (${nPillars})`, "pillars", pillarGroups, pillarRft)}
                            {groupTile(`🔗 Beams (${nBeams})`, "beams", beamGroups, beamRft)}
                            {(batta || ed?.batta) && battaTile()}
                          </div>
                          {fabRows.length > 0 && (
                            <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-2">
                              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">🧵 Fabric allocation</div>
                              <div className="flex flex-wrap gap-2">
                                {fabRows.map(f => (
                                  <div key={f.label} className="flex-1 min-w-[240px] rounded-lg bg-white border border-gray-200 border-l-2 border-l-emerald-400 px-2.5 py-2">
                                    <div className="flex items-start gap-2">
                                      <div className="text-[13px] flex-1 min-w-0"><span className="mr-1">{f.ic}</span><b className="text-gray-900">{f.label}</b> <span className="text-gray-500">· {f.need} needed</span>{f.note && <span className="text-[11px] italic text-gray-400"> ({f.note})</span>}{dcFabricMultOf(row, f.part) !== 1 && <span className="text-[11px] font-semibold text-indigo-600"> ×{dcFabricMultOf(row, f.part)}</span>}</div>
                                      <button onClick={() => setTrussFabEdit(trussFabEdit === f.ek ? null : f.ek)} className="shrink-0 text-[11.5px] font-semibold rounded-md px-2 py-0.5 ring-1 ring-gray-200 bg-gray-50 hover:bg-white">🎨 {trussFabEdit === f.ek ? "Done" : "Edit"}</button>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1 items-center">{allocChips(f.allocs, f.unit)}{f.own && <span className="text-[10.5px] text-indigo-600 font-semibold">· set here</span>}</div>
                                    {trussFabEdit === f.ek && (() => {
                                      // The department's own pick: a colour from IMS fabric stock, a qty per colour.
                                      const stock = Array.isArray(trussInv?.[f.stockKey]) ? trussInv[f.stockKey] : [];
                                      const cur = Array.isArray(f.allocs) && f.allocs.length ? f.allocs : [{ colour: "", qty: Math.ceil(f.needN) }];
                                      const save = (next) => saveDept({ trussFabric: { ...(deptData.trussFabric || {}), [f.ek]: next } });
                                      const setAt = (i, patch) => save(cur.map((a, j) => j === i ? { ...a, ...patch } : a));
                                      const sum = cur.reduce((a, x) => a + (Number(x.qty) || 0), 0);
                                      const resetOwn = () => { const n2 = { ...(deptData.trussFabric || {}) }; delete n2[f.ek]; saveDept({ trussFabric: n2 }); };
                                      return (
                                        <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                                          {cur.map((a, i) => (
                                            <div key={i} className="flex items-center gap-1.5">
                                              <select value={a.colour || ""} onChange={e => setAt(i, { colour: e.target.value })} className="flex-1 min-w-0 text-[12px] rounded-md ring-1 ring-gray-200 px-1.5 py-1 bg-white">
                                                <option value="">Pick colour…</option>
                                                {stock.map(st => <option key={st.colour} value={st.colour}>{st.colour} · {Number(st[f.qtyField]) || 0}{f.unit} in stock</option>)}
                                              </select>
                                              <input type="number" min="0" step="0.1" value={a.qty ?? ""} onChange={e => setAt(i, { qty: e.target.value === "" ? 0 : Number(e.target.value) })} className="w-16 text-[12px] text-center rounded-md ring-1 ring-gray-200 px-1 py-1" />
                                              <span className="text-[11px] text-gray-400">{f.unit}</span>
                                              {cur.length > 1 && <button onClick={async () => { if (await askDelete("Remove this colour?")) save(cur.filter((_, j) => j !== i)); }} className="text-gray-300 hover:text-red-500 text-sm" title="Remove this colour">×</button>}
                                            </div>
                                          ))}
                                          <div className="flex items-center gap-2 text-[11.5px]">
                                            <button onClick={() => save([...cur, { colour: "", qty: 0 }])} className="font-semibold text-blue-600 hover:underline">+ colour</button>
                                            <span className={sum < f.needN ? "text-amber-600" : "text-gray-500"}>{Math.round(sum * 100) / 100} of {f.need}</span>
                                            {f.own && <button onClick={resetOwn} className="ml-auto font-semibold text-gray-500 hover:text-gray-800">↺ back to Deal Check pick</button>}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {pv.source === "default-on-forget" && <div className="mt-2 text-[12px] text-amber-700">ℹ️ Truss type not picked — defaulted to Half Box</div>}
                          {(pv.warnings || []).filter(w => !/cost preview|not picked/i.test(w)).map((w, i) => <div key={i} className="mt-1 text-[12px] text-red-600">⚠️ {w}</div>)}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {SHOW_DISMANTLE_IN_PLANNING && blockedItems.length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("dism")}>
                <div className="px-3 sm:px-4 py-3 bg-gray-50">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🔁</span>
                    <div className="min-w-0 flex-1 text-[15px] font-semibold text-gray-900">Dismantle plan</div>
                  </div>
                  <div className="mt-1.5 text-xs text-gray-500 leading-relaxed">Split items across sites; the rest go to production house.</div>
                </div>
                {/* ── SITE CHOOSER ──
                    Each site named here becomes a column in the matrix below, which is the thing
                    the old "Transfer sites:" sentence never said. The label is now an uppercase
                    eyebrow like every other section marker on the page, and the count sits with
                    it so the row states what it has done rather than just what it is.
                    The sky wash is gone: it tinted a strip across a white card for no reason
                    other than that the sites are sky-coloured elsewhere. */}
                <div className="px-3 sm:px-4 pt-0 pb-3 sm:py-2.5 bg-gray-50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500 shrink-0">
                      Transfer sites
                      {dismantleSites.length > 0 && <span className="ml-1.5 text-gray-400 tabular-nums">{dismantleSites.length}</span>}
                    </span>
                    {dismantleSites.map(s => (
                      /* The × is a real target now, not a 10px glyph tucked against the text —
                         and it only turns red on hover, so a destructive control is not shouting
                         from a row you are only reading. */
                      <span key={s.id} className="group inline-flex items-center gap-1.5 text-xs font-semibold bg-white ring-1 ring-sky-200 text-sky-800 rounded-lg pl-2.5 pr-1 py-1">
                        {/* Drawn arrow: the ↪️ emoji renders as a blue tile on iOS and Windows. */}
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-sky-500 shrink-0">
                          <path d="M3 4v3.5A2.5 2.5 0 0 0 5.5 10H13M10 7l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="truncate max-w-[220px]">{s.name}</span>
                        {s.date && <span className="font-normal text-sky-500 tabular-nums">{s.date}</span>}
                        {(() => { const v = venueOfEvent((eventOrders || []).find(x => x.id === s.id)); return v ? <span className="font-normal text-sky-500 truncate max-w-[160px]">· {v}</span> : null; })()}
                        <button onClick={() => removeDismantleSite(s.id)} title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`}
                          className="ml-0.5 w-5 h-5 rounded-md flex items-center justify-center text-sky-300 hover:text-red-600 hover:bg-red-50 transition">×</button>
                      </span>
                    ))}
                    {(() => {
                      const opts = nearbyTransferEvents.filter(({ e }) => !dismantleSites.some(s => s.id === e.id));
                      return (
                        <div className="relative">
                          <button ref={siteBtnRef} type="button" onClick={() => setSiteMenu(o => !o)}
                            aria-haspopup="listbox" aria-expanded={siteMenu}
                            className={"inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 px-3 py-1.5 text-xs font-semibold transition " + (siteMenu ? "ring-blue-400 text-blue-700" : "ring-gray-200 hover:ring-gray-300 text-gray-700")}>
                            <span aria-hidden="true" className="text-gray-400">＋</span>
                            Add a site
                            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={"text-gray-400 transition-transform " + (siteMenu ? "rotate-180" : "")}>
                              <path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          {siteMenu && (
                            <div role="listbox" style={{ position: "fixed", top: siteMenuPos.top, left: siteMenuPos.left, width: siteMenuPos.width, zIndex: 60 }}
                              className="rounded-xl bg-white shadow-[0_4px_12px_rgba(16,24,40,0.1),0_16px_40px_-12px_rgba(16,24,40,0.3)] ring-1 ring-gray-200 overflow-hidden">
                              <div className="px-3 py-2 bg-gray-50 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                                Send items to another event
                              </div>
                              <div className="max-h-64 overflow-y-auto">
                                {opts.length === 0 && (
                                  <div className="px-3 py-4 text-center text-xs text-gray-400">No other sold events nearby.</div>
                                )}
                                {opts.map(({ e, d, off }) => (
                                  <button key={e.id} type="button" role="option" aria-selected="false"
                                    onClick={() => { addDismantleSite(e.id); setSiteMenu(false); }}
                                    className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-blue-50 transition-colors">
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-[13px] font-semibold text-gray-900 truncate">{e.clientName || "Event"}</span>
                                      <span className="block text-[11px] text-gray-500 tabular-nums truncate">{d || "no date"}{venueOfEvent(e) ? <span className="font-sans"> · {venueOfEvent(e)}</span> : null}</span>
                                    </span>
                                    {/* Same-day is called out because it is the tight one — the
                                        truck has to reach the next site the same evening. The
                                        rest just say how far off, with the sign kept. */}
                                    <span className={"shrink-0 text-[10px] font-bold px-2 py-1 rounded-md tabular-nums whitespace-nowrap " + (off === 0 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500")}>
                                      {off === 0 ? "same day" : off > 0 ? `+${off}d` : `${off}d`}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  {/* Its own line, not trailing off the end of the row — at the end it wrapped
                      under the controls and read as a caption for the dropdown. */}
                  {dismantleSites.length === 0 && (
                    <div className="mt-1.5 text-[10px] text-gray-400">
                      None yet, so everything returns to the production house. Add a site to send items straight there instead.
                    </div>
                  )}
                </div>
                {/* ── ONE CARD PER ITEM, FOUR TO A ROW ──
                    Was a phone card list plus a desktop table (a column per site). One card grid
                    for every width instead — 1 / 2 / 4 across — with the photo big enough to tell
                    two "vedi chair" lines apart, zooming in place on hover (tap/click still opens
                    it full size). Under it: Production house (auto — whatever the sites leave) and
                    one number per transfer site. A fully routed item (nothing left for production
                    house) recedes so the ones still needing a number stand out. */}
                <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {blockedItems.map(it => {
                    const prod = planProdQty(it);
                    const done = prod === 0;
                    return (
                      <div key={it.id} className={"rounded-xl bg-white ring-1 ring-gray-200 overflow-hidden flex flex-col transition hover:shadow-lg hover:ring-gray-300 " + (done ? "opacity-70" : "")}>
                        <div className="group relative h-40 bg-gray-100 overflow-hidden">
                          {it.photo
                            ? <img src={fitUrl(it.photo, 300)} alt="" loading="lazy" onClick={() => setZoomImg(it.photo)} title="Click to open full size"
                                className="w-full h-full object-cover cursor-zoom-in transition-transform duration-300 ease-out group-hover:scale-150"
                                onError={e => { e.target.style.display = "none"; }} />
                            : <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300">📦</div>}
                          <span className="absolute top-2 right-2 rounded-md bg-black/60 text-white text-[11px] font-semibold px-1.5 py-0.5 tabular-nums">×{it.qty}</span>
                        </div>
                        <div className="p-3 flex-1 flex flex-col gap-2">
                          <div className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-2" title={it.name}>{it.name}</div>
                          <div className="mt-auto rounded-lg bg-gray-50 divide-y divide-gray-100">
                            <div className="flex items-center gap-2 px-2.5 py-1.5">
                              <span className="min-w-0 flex-1 text-xs text-gray-600 truncate">🏭 Production house <span className="text-gray-400">· auto</span></span>
                              <span className={"shrink-0 inline-flex items-center justify-center w-12 h-7 rounded-lg text-sm font-bold tabular-nums " + (done ? "bg-gray-100 text-gray-300" : "bg-blue-50 text-blue-700")}
                                title="Auto — whatever is left after the sites">{prod}</span>
                            </div>
                            {dismantleSites.map(s => (
                              <label key={s.id} className="flex items-center gap-2 px-2.5 py-1.5">
                                <span className="min-w-0 flex-1 text-xs text-gray-600 truncate" title={s.date ? `${s.name} · ${s.date}` : s.name}>↪ {s.name}</span>
                                <input type="number" min="0" max={it.qty} value={planSiteQty(it, s.id) || ""} onChange={e => setSiteQty(it, s.id, e.target.value)} placeholder="0"
                                  className="shrink-0 w-12 h-7 rounded-lg bg-white ring-1 ring-gray-200 px-1.5 text-sm text-center tabular-nums font-semibold text-gray-800 placeholder:font-normal placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 transition" />
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
                </div>
              </div>
            </div>
            </>)}

            {opsView === "onsite" && (<>
            {/* The department chip row that used to sit here is gone. It switched department,
                which is exactly what the Department picker in the left rail already does, under
                the same permission rules — roleDept locks the rail to a badge only when the user
                has ONE department, i.e. only when there is nothing to switch to. So no user
                loses the ability to change department by this removal. */}
            {/* Same tile grid as Planning — the on-site view has three blocks of its own and the
                shortfall count, which is the thing an ops manager checks first, rides on its
                tile so it is answered before anything is opened. */}
            {(() => {
              const short = sourceRows.filter(r => r.shortfall > 0).length;
              const n = (v, s) => `${v} ${s}${v === 1 ? "" : "s"}`;
              const tiles = [
                sourceRows.length > 0 && { k: "rcv", icon: "📥", title: "Receiving", sub: short > 0 ? `⚠️ ${n(short, "item")} short` : "✓ all sourced", tone: short > 0 ? "bg-red-50" : "bg-sky-50", alert: short > 0 },
                { k: "route", icon: "🔁", title: "Dismantle & routing", sub: blockedItems.length ? n(blockedItems.filter(it => unroutedQty(it) > 0).length, "item") + " left to route" : "nothing to route" },
                mpRows.length > 0 && { k: "oscrew", icon: "👷", title: "On-site crew", sub: mpEdited ? "actual logged" : "as planned", value: fmt(mpCost) },
              ].filter(Boolean);
              return (
                <div className={GRID}>
                  {tiles.map(t => (
                    /* No drawn outline. Separation comes from the slate-100 page ground under a
                       white fill, plus a two-layer shadow — a tight 1px one that reads as the
                       card's edge and a wide soft one that lifts it off the ground. The tinted
                       tiles (red for a shortfall, sky for receiving) separate by fill alone. */
                    <button key={t.k} onClick={() => setModal(t.k)}
                      /* Clicking the open tile again closes it — with the block inline, the tile
                         is a toggle, not a launcher. The open one is ringed so you can tell at a
                         glance which of the five the panel below belongs to. */
                      onClickCapture={e => { if (modal === t.k) { e.stopPropagation(); setModal(null); } }}
                      className={"group text-left rounded-xl p-3.5 h-full flex flex-col transition-[transform,box-shadow] duration-150 shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(15,23,42,0.1),0_22px_40px_-12px_rgba(15,23,42,0.45)] " + (modal === t.k ? "ring-2 ring-blue-500 " + (t.tone || "bg-white/90") : (t.tone || GLASS))}>
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
                        <span aria-hidden="true" className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base leading-none " + (t.alert ? "bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)]" : "bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)]")}>{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 leading-snug">{t.title}</div>
                          <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{t.sub}</div>
                        </div>
                        {/* gray-300 put this at ~1.5:1 on white — present in the markup, absent
                            on screen. gray-500 is 4.8:1, and it darkens on hover so the chevron
                            confirms the whole tile is the target, not just the corner it sits in. */}
                        <span aria-hidden="true" className="hidden sm:block shrink-0 text-gray-500 group-hover:text-gray-900 text-base font-semibold leading-none transition-colors">›</span>
                      </div>
                      {t.value && <div className="mt-auto pt-3 text-[17px] leading-none font-semibold text-gray-900 tabular-nums tracking-tight">{t.value}</div>}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── OPENS IN PLACE, UNDER THE TILES ──
                Not a dialog any more. A block is its tile's own detail, so it belongs directly
                beneath the row you clicked rather than over the top of the page — the tiles, the
                income cards and the event header all stay in view while you read it.
                Same mechanic as before: every block still lives here and hides itself unless it
                is the open one (modalCls), so nothing had to be moved or re-parented. */}
            <div onClick={onPanelBackdrop} className={modal ? PANEL_WRAP : "hidden"}>
              <div className={PANEL_CARD}>
                {/* NOT sticky — see the Planning panel above: inline, a sticky bar just hovers
                    over the block beneath it and hides its subtitle. */}
                <div className="absolute -top-12 right-3 sm:static sm:shrink-0 sm:px-2 sm:pt-2 sm:pb-1 sm:flex sm:items-center sm:justify-end">
                  <button onClick={() => setModal(null)} aria-label="Close"
                    className="group shrink-0 w-10 h-10 rounded-full bg-white shadow-lg text-gray-600 sm:w-8 sm:h-8 sm:rounded-lg sm:bg-transparent sm:shadow-none sm:text-gray-400 flex items-center justify-center hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    {/* A drawn cross, not the ✕ character. The glyph is a font fallback away
                       from rendering at the wrong weight or off-centre, and it cannot be given
                       a real stroke width. Grey at rest, red on hover: a permanently red X reads
                       as a warning on a panel you are only reading. */}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className={PANEL_BODY}>

            {/* Receiving — ops manager sees every item's sources (which truck + driver, from where) + shortfall */}
            {sourceRows.length > 0 && (
              <div className={"bg-sky-50 rounded-xl overflow-hidden" + modalCls("rcv")}>
                <div className="px-4 py-2.5 bg-sky-100/70 text-sm font-bold text-sky-800 flex items-center justify-between flex-wrap gap-2">
                  <span>📥 Receiving — sources per item <span className="text-xs font-normal text-sky-600">— who&apos;s bringing what, on which truck</span></span>
                  {(() => { const sc = sourceRows.filter(r => r.shortfall > 0).length; return <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (sc > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>{sc > 0 ? `⚠️ ${sc} short` : "✓ all sourced"}</span>; })()}
                </div>
                {sourceRows.some(r => r.shortfall > 0) && (
                  <div className="px-4 py-2 bg-red-50 text-xs text-red-700 font-semibold">⚠️ Shortfall on {sourceRows.filter(r => r.shortfall > 0).length} item(s) — not enough assigned from any source. Check with the dept head / production house.</div>
                )}
                <div>
                  {sourceRows.map((r, i) => (
                    <div key={i} className="px-4 py-2">
                      <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 text-xs">
                        <span className="text-sky-900 font-semibold flex items-center gap-2 min-w-0">
                          {r.photo ? <img src={thumbUrl(r.photo, 32)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(r.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-sky-100 flex items-center justify-center text-sky-300 text-xs">📦</div>}
                          {r.name}
                        </span>
                        <span className={r.shortfall > 0 ? "text-red-600 font-bold" : "text-sky-800"}>
                          {r.required > 0 ? <>need <b>{r.required}</b> · arriving <b>{r.totalIn}</b></> : <>arriving <b>{r.totalIn}</b></>}
                          {r.shortfall > 0 && <span> · short {r.shortfall}</span>}
                          {r.over > 0 && <span className="text-amber-600"> · +{r.over} extra</span>}
                          {r.required > 0 && r.shortfall === 0 && <span className="text-emerald-600"> ✓</span>}
                        </span>
                      </div>
                      <div className="text-[10px] text-sky-600 mt-1 pl-1 space-y-0.5">
                        {r.whTrucks.map((t, j) => <div key={"w" + j} className="flex items-center gap-1.5 flex-wrap"><span>🚛 {t.qty}× from production house · Truck {t.n}{t.vehicle ? ` (${t.vehicle}${t.driver ? " · " + t.driver : ""})` : t.driver ? ` (${t.driver})` : ""}</span>{t.phone
                          ? <a href={"tel:" + t.phone} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 hover:bg-emerald-100" title={"Call " + (t.driver || "driver") + " · " + t.phone}>📞 Call {t.driver || ""}</a>
                          : <input defaultValue="" onClick={e => e.stopPropagation()} onBlur={e => { const v = e.target.value.trim(); if (v && t.id) setTruck(t.id, { phone: v }); }} placeholder="📞 add driver phone" className="border border-sky-300 rounded-full px-2 py-0.5 text-[10px] w-32" title="Enter the driver's phone to enable Call" />
                        }</div>)}
                        {r.sources.map((s, j) => <div key={"r" + j} className="flex items-center gap-1.5 text-sky-700 flex-wrap"><span>↪️ {s.qty}× reused from {s.from} ({s.dept}){s.vehicle || s.driver ? ` · ${s.vehicle || ""}${s.vehicle && s.driver ? " · " : ""}${s.driver || ""}` : ""}</span>{s.phone && <a href={"tel:" + s.phone} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 hover:bg-emerald-100" title={"Call " + (s.driver || "driver") + " · " + s.phone}>📞 Call {s.driver || ""}</a>}{s.voiceNote && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700"><span title="voice note from the sending site — listen before it arrives">🎤 note:</span><audio src={s.voiceNote} controls className="h-6 max-w-[150px]" /></span>}</div>)}
                        {r.whTrucks.length === 0 && r.sources.length === 0 && <div className="text-gray-400">No truck assigned yet.</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dismantle & return routing */}
            <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("route")}>
              {/* Same header shape as the Planning dismantle block: title row with Reset at its
                  right end, the description under it, then the bulk actions on their own row.
                  All three buttons on one unwrapping row ran off a phone screen, and the
                  description trailing the title as a "— …" aside wrapped into it. */}
              <div className="px-3 sm:px-4 py-3 bg-gray-50 space-y-2">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">🔁</span>
                  <div className="min-w-0 flex-1 text-[15px] font-semibold text-gray-900">Dismantle &amp; return routing</div>
                </div>
                <div className="text-xs text-gray-500 leading-relaxed">Confirm the dept head&apos;s plan, or send everything left to the warehouse.</div>
                {blockedItems.some(it => unroutedQty(it) > 0) && (
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    <button onClick={confirmAllPlanned} className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 sm:py-1.5 rounded-lg whitespace-nowrap">✓ Confirm all as planned</button>
                    <button onClick={routeAllToWarehouse} className="text-xs font-bold bg-gray-800 hover:bg-gray-900 text-white px-3 py-2 sm:py-1.5 rounded-lg whitespace-nowrap">🏬 All → warehouse</button>
                  </div>
                )}
              </div>
              {/* Loading manifest — grouped by destination (the dept head's plan). Each list = one place. */}
              {destGroups.length > 0 && (
                <div className="px-3 sm:px-4 py-3 space-y-2">
                  {/* An eyebrow like the other section markers, with the how-to as a caption
                      under it — as one run-on line it read as a paragraph, not a heading. */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">Loading manifest</div>
                    <div className="mt-0.5 text-[11px] text-gray-400">By destination. Add truck details, mark anything broken or for repair, then confirm.</div>
                  </div>
                  {destGroups.map(g => {
                    const isTransfer = g.type === "transfer";
                    const truck = manTruck[g.key] || {};
                    const hasTruck = !!(truck.vehicle || truck.driver || truck.phone);
                    const selRows = g.items.filter(({ it }) => !isTransfer || isSel(gKey(g.key, it)));
                    const canConfirm = selRows.length > 0 && (!isTransfer || hasTruck);
                    const open = !!manOpen[g.key];
                    return (
                    /* ring-gray-200, not a bare `border`: under Tailwind v4 an uncoloured border
                       takes currentColor, which drew this box in near-black. */
                    <div key={g.key} className="bg-white rounded-xl ring-1 ring-gray-200 overflow-hidden">
                      <div className="px-3 py-2.5 flex items-center gap-2">
                        {/* Name over counts, not one run: the name at 14px and the counts at 10px
                            on a shared baseline read as a heading with a stray footnote. */}
                        <button onClick={() => setManOpen(o => ({ ...o, [g.key]: !o[g.key] }))} aria-expanded={open}
                          className="min-w-0 flex-1 flex items-center gap-2 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                          {/* A drawn chevron, not "▶": iOS and Windows render that character as
                              a blue emoji button. */}
                          <svg width="12" height="12" viewBox="0 0 15 15" fill="none" aria-hidden="true"
                            className={"shrink-0 text-gray-400 transition-transform " + (open ? "rotate-90" : "")}>
                            <path d="M5.5 3.5 L10 7.5 L5.5 11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-gray-900 truncate">{g.label}</span>
                            <span className="block text-[11px] text-gray-500 tabular-nums">
                              {g.items.reduce((s, x) => s + x.qty, 0)} pc · {g.items.length} item{g.items.length > 1 ? "s" : ""}
                              {isTransfer && hasTruck ? <span className="text-emerald-600"> · 🚛 {truck.vehicle || truck.driver || "truck set"}</span> : null}
                            </span>
                          </span>
                        </button>
                        {/* Issues reported in this group, so a collapsed card still says it
                            is not a clean return. */}
                        {(() => {
                          const n = g.items.filter(({ it }) => { const c = condOf(gKey(g.key, it)); return (Number(c.repair) || 0) + (Number(c.broken) || 0) > 0; }).length;
                          return n > 0 ? <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-700 tabular-nums">{n} issue{n > 1 ? "s" : ""}</span> : null;
                        })()}
                      </div>
                      {open && (<>
                      {/* Truck details — only for transfers to another site (production house needs none) */}
                      {isTransfer && (
                        <div className="px-3 py-2 bg-sky-50/60 space-y-1.5">
                          <div className="text-[10px] text-sky-700 font-semibold">🚛 Which truck is carrying this to {g.label.replace("↪️ ", "")}? — shown to the receiving site</div>
                          {eventTrucks.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {eventTrucks.map(f => { const on = truck.vehicle === f.vehicle && truck.driver === f.driver; return (
                                <button key={f.id} onClick={() => pickTruckFleet(g.key, f)} className={"text-[11px] px-2 py-1 rounded-lg border " + (on ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-blue-50")}>🚛 {f.vehicle || f.driver}{f.vehicle && f.driver ? ` · ${f.driver}` : ""}</button>
                              ); })}
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            <input value={truck.vehicle || ""} onChange={e => setTruckField(g.key, "vehicle", e.target.value)} placeholder="Vehicle no." className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
                            <input value={truck.driver || ""} onChange={e => setTruckField(g.key, "driver", e.target.value)} placeholder="Driver" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
                            <input value={truck.phone || ""} onChange={e => setTruckField(g.key, "phone", phone10(e.target.value))} inputMode="numeric" maxLength={10} placeholder="Phone (10 digits)" className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
                          </div>
                          {g.items.length > 1 && <div className="text-[10px] text-gray-400">Tick only what fits on this truck — untick the rest and confirm them on a second truck.</div>}
                        </div>
                      )}
                      <div className="">
                        {g.items.map(({ it, qty }, i) => {
                          const ck = gKey(g.key, it); const c = condOf(ck);
                          const rep = Number(c.repair) || 0, brk = Number(c.broken) || 0;
                          const dest = Math.max(0, qty - rep - brk);
                          const sel = isSel(ck);
                          // Open when asked for, and kept open while it holds anything — closing
                          // a row with a broken count in it would hide the one line that matters.
                          const hasIssue = rep + brk > 0 || !!manNote[ck];
                          const issueOpen = !!manIssue[ck] || hasIssue;
                          return (
                          /* ── ONE LINE PER ITEM, ISSUES ON DEMAND ──
                             Most items come back fine, so a row is just the item and how many are
                             going. Repair / Broken / voice note open under it only for the one
                             that has a problem, via "Report issue" — the old row showed all three
                             on every item, which made a clean return of ten items a wall of
                             empty inputs. */
                          <div key={i} className={"px-3 py-2.5 border-t border-gray-100 " + (isTransfer && !sel ? "opacity-40" : "")}>
                            <div className="flex items-center gap-2.5">
                              {isTransfer && <input type="checkbox" checked={sel} onChange={() => toggleManSel(ck)} className="w-4 h-4 shrink-0" title="load this item on this truck" />}
                              {it.photo ? <img src={thumbUrl(it.photo, 36)} loading="lazy" decoding="async" alt="" onClick={() => setZoomImg(it.photo)} className="shrink-0 w-9 h-9 rounded-lg object-cover cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="shrink-0 w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-gray-800 leading-snug line-clamp-2" title={it.name}>{it.name}</div>
                                <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums" title="going to this destination">
                                  <span className={"font-bold " + (dest > 0 ? "text-gray-900" : "text-gray-300")}>{dest}</span> of {qty} going
                                  {rep > 0 && <span className="ml-1.5 font-semibold text-amber-700">· {rep} repair</span>}
                                  {brk > 0 && <span className="ml-1.5 font-semibold text-red-600">· {brk} broken</span>}
                                </div>
                              </div>
                              {!hasIssue && (
                                <button type="button" onClick={() => setManIssue(s => ({ ...s, [ck]: !s[ck] }))} aria-expanded={issueOpen}
                                  className={"shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors " + (issueOpen ? "bg-gray-100 text-gray-700" : "text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-800")}>
                                  {issueOpen ? "Done" : "Report issue"}
                                </button>
                              )}
                            </div>
                            {issueOpen && (
                              /* A panel of its own under the row, not inline pieces. Wrapping in a
                                 flex row, the two fields and the voice button broke onto lines of
                                 different lengths at different indents. Here the two counts are an
                                 equal pair with labels above, and the note sits on its own line. */
                              <div className="mt-2.5 rounded-lg bg-gray-50 p-2.5 space-y-2.5">
                                <div className="grid grid-cols-2 gap-2.5">
                                  <label className="block" title="needs repair (kept in stock)">
                                    <span className="block mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-700">Repair</span>
                                    <input type="number" min="0" max={qty} value={c.repair ?? ""} onChange={e => setManCondVal(ck, "repair", e.target.value, qty)} placeholder="0"
                                      className="w-full h-8 rounded-lg bg-white ring-1 ring-amber-200 px-2 text-sm text-center font-semibold tabular-nums text-amber-900 placeholder:font-normal placeholder:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                                  </label>
                                  <label className="block" title="broken — written off, removed from stock">
                                    <span className="block mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-red-600">Broken</span>
                                    <input type="number" min="0" max={qty} value={c.broken ?? ""} onChange={e => setManCondVal(ck, "broken", e.target.value, qty)} placeholder="0"
                                      className="w-full h-8 rounded-lg bg-white ring-1 ring-red-200 px-2 text-sm text-center font-semibold tabular-nums text-red-900 placeholder:font-normal placeholder:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400" />
                                  </label>
                                </div>
                                <VoiceRecorder compact value={manNote[ck]} onSave={url => setManNote(m => ({ ...m, [ck]: url }))} label="note for site" />
                              </div>
                            )}
                          </div>
                        ); })}
                      </div>
                      </>)}
                      {/* At the foot of the card: look over the items, then confirm. Above them
                          it asked for the confirmation before you had seen what you confirmed. */}
                      <div className="px-3 pb-3 pt-2">
                        <button onClick={() => confirmGroup(g)} disabled={!canConfirm} className="w-full text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg whitespace-nowrap">{isTransfer ? `✓ Loaded on this truck${selRows.length < g.items.length ? ` (${selRows.length})` : ""}` : "✓ Confirm — back to production house"}</button>
                      </div>
                    </div>
                  ); })}
                </div>
              )}
              {movements.some(m => m.type === "repair") && (
                <div className="px-4 py-2 bg-amber-50 text-xs text-amber-800">
                  🔧 <b>Repairs needed</b> (kept in stock — fix before next use): {movements.filter(m => m.type === "repair").map((m, i) => <span key={m.id}>{i > 0 ? ", " : ""}{m.qty}× {m.name}</span>)}
                </div>
              )}
              {blockedItems.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-gray-400">No inventory to route for this department.</div>
              )}
              {blockedItems.length > 0 && destGroups.length === 0 && (
                <div className="px-4 py-4 text-center text-xs text-emerald-600 font-semibold">✓ Everything routed — see the movement log below.</div>
              )}
              {/* Movement log for this event */}
              {movements.length > 0 && (
                <div className="px-3 sm:px-4 pt-3 pb-2 border-t border-gray-100">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">Movement log</div>
                  {/* One row per movement: what happened as a small coloured tag, the item and
                      qty as the line you read, who logged it underneath. The old row put all of
                      it in one run with a red × on every line, which made a log of routine
                      returns look like a list of errors. */}
                  <div className="mt-1">
                    {movements.slice().reverse().map(m => {
                      const tag = m.type === "damage" ? { t: "Broken", c: "bg-red-50 text-red-700" }
                        : m.type === "repair" ? { t: "Repair", c: "bg-amber-50 text-amber-700" }
                        : m.type === "transfer" ? { t: "Reused", c: "bg-sky-50 text-sky-700" }
                        : { t: "Returned", c: "bg-gray-100 text-gray-600" };
                      const note = m.type === "damage" && m.invId ? `stock −${m.qty}` : m.type === "repair" ? "kept in stock" : m.type === "transfer" ? `→ ${m.toEventName || "event"}` : "";
                      return (
                        <div key={m.id} className="flex items-center gap-2.5 py-2">
                          <span className={"shrink-0 w-[4.5rem] text-center text-[10px] font-bold px-1.5 py-1 rounded-md " + tag.c}>{tag.t}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-gray-800 truncate" title={m.name}>
                              <span className="font-semibold tabular-nums">{m.qty}×</span> {m.name}
                            </div>
                            <div className="text-[10px] text-gray-400 truncate">{m.by}{note ? ` · ${note}` : ""}</div>
                          </div>
                          {m.voiceNote && <audio src={m.voiceNote} controls className="h-6 max-w-[110px] shrink-0" title="voice note" />}
                          <button onClick={() => delMovement(m.id)} aria-label={`Remove ${m.name} movement`} title="Remove"
                            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                              <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* On-site crew — actual held. Ops logs the real crew kept on site (count + shifts); this
                writes the same mpDay/mpWin/mpOverrides the plan uses, so it becomes the exact manpower
                cost in this event's P&L and reflects back to the salesperson in Studio. */}
            {mpRows.length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_2px_4px_rgba(15,23,42,0.08),0_14px_32px_-10px_rgba(15,23,42,0.35)] overflow-hidden" + modalCls("oscrew")}>
                {/* Same header shape as the dismantle blocks: icon tile, title, the figure at the
                    right end, description under. The old one ran the description on as a
                    "— …" aside to the title and the total wrapped onto a line by itself. */}
                <div className="px-3 sm:px-4 py-3 bg-gray-50">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_4px_10px_-4px_rgba(15,23,42,0.22)] flex items-center justify-center text-base leading-none">👷</span>
                    <div className="min-w-0 flex-1 text-[15px] font-semibold text-gray-900">On-site crew</div>
                    <div className="shrink-0 text-right">
                      <div className="text-[15px] font-bold text-gray-900 tabular-nums leading-tight">{fmt(mpCost)}</div>
                      <div className={"text-[10px] font-semibold " + (mpEdited ? "text-amber-600" : "text-gray-400")}>{mpEdited ? "actual held" : "as planned"}</div>
                    </div>
                  </div>                </div>
                <div>
                  {mpRows.map((r, i) => {
                    if (r.type === "Supervisors") return null; // ops IS the supervisor — no separate line for him
                    const daywise = mpDayWise(r);
                    const sched = Array.isArray(r.schedule) ? r.schedule : [];
                    const winDefs = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : [];
                    const planCost = Number(r.sysCost) || 0;
                    const actCost = Number(lineCost(r));
                    const edited = actCost !== planCost;
                    const readOnly = r.shared && !daywise; // shared crew with no schedule = fixed split, can't tune
                    const expanded = !!osMp[i];
                    const rate = Number(r.rate) || 0;
                    // Show the SAME metric the dept head's Manpower plan shows: dihari for day-wise crew
                    // (auto = cost ÷ rate), plain qty for mapped crew — so by default both screens match.
                    const actDihari = rate > 0 ? Math.round(actCost / rate) : 0;
                    const planDihari = rate > 0 ? Math.round(planCost / rate) : 0;
                    const planPeak = Number(r.sysCount) || 0;
                    return (
                      /* ── ONE CREW LINE ──
                         Name and cost on the first line, the plan it is measured against under
                         the name, then the controls on a row of their own. In one flex-wrap row
                         the cost, the dihari box and the shift toggle broke wherever the width
                         ran out, so the cost ended up alone mid-card with no label. */
                      <div key={i} className="px-3 sm:px-4 py-3 border-t border-gray-100 first:border-t-0">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-gray-900">{r.type}</span>
                              {r.shared && <span className="text-[10px] font-semibold uppercase tracking-[0.06em] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Shared</span>}
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                              {readOnly ? "Split allocation" : daywise
                                ? <>Planned {planDihari} dihari · {fmt(planCost)}</>
                                : <>Planned {planPeak} · {fmt(planCost)}</>}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className={"text-sm font-bold tabular-nums " + (edited ? "text-amber-700" : "text-gray-900")}>{fmt(actCost)}</div>
                            {edited && <div className="text-[10px] font-semibold text-amber-600">edited</div>}
                          </div>
                        </div>
                        {!readOnly && (
                          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                            {daywise ? (
                              <span className={"h-8 inline-flex items-center gap-2 rounded-lg px-2.5 " + (edited ? "bg-amber-50 ring-1 ring-amber-200" : "bg-gray-50 ring-1 ring-gray-200")}
                                title="Total dihari held (crew × shifts across all days) — matches the plan until you edit it by day/shift">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Dihari</span>
                                <span className={"text-sm font-bold tabular-nums " + (edited ? "text-amber-700" : "text-gray-800")}>{actDihari}</span>
                              </span>
                            ) : (
                              <label className="h-8 inline-flex items-center gap-2 rounded-lg px-2.5 bg-gray-50 ring-1 ring-gray-200">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">People</span>
                                <input type="number" min="0" value={Number(r.count) || 0} onChange={e => setActualCrew(r, i, e.target.value)}
                                  className={"w-12 bg-transparent text-sm text-center font-bold tabular-nums focus:outline-none " + ((Number(r.count) || 0) !== planPeak ? "text-amber-700" : "text-gray-800")} />
                              </label>
                            )}
                            {daywise && sched.length > 0 && (
                              <button onClick={() => setOsMp(o => ({ ...o, [i]: !o[i] }))} aria-expanded={expanded}
                                className={"h-8 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors " + (expanded ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 hover:text-gray-900")}
                                title="Adjust crew per day and per shift (e.g. drop the evening, or keep 1 in evening)">
                                <svg width="11" height="11" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={"transition-transform " + (expanded ? "rotate-90" : "")}>
                                  <path d="M5.5 3.5 L10 7.5 L5.5 11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                By day / shift
                              </button>
                            )}
                            {edited && (
                              <button onClick={() => resetMpLine(r)} className="h-8 inline-flex items-center rounded-lg px-2.5 text-[11px] font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors" title="Revert to the dept head's planned crew">
                                ↺ Back to plan
                              </button>
                            )}
                          </div>
                        )}
                        {/* The event-wide labour figure, laid out as a field: what it is and what
                            it does on the left, the number on the right. As one wrapped line the
                            input sat between the label and a sentence that read as its unit. */}
                        {r.type === "Labours" && anyLabours && (
                          <div className="mt-2.5 rounded-lg bg-blue-50/70 ring-1 ring-blue-100 px-3 py-2.5 flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-blue-800">All-department labour</div>
                              <div className="mt-0.5 text-[11px] text-blue-600/80 leading-snug">Total dihari for the whole event. Split across departments by usage.</div>
                            </div>
                            <input type="number" min="0" value={eventLabourDihari} onChange={e => setEventLabourTotal(e.target.value)}
                              className="shrink-0 w-16 h-8 rounded-lg bg-white ring-1 ring-blue-200 px-2 text-sm text-center font-bold tabular-nums text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                          </div>
                        )}
                        {expanded && daywise && sched.length > 0 && (
                          <div className="mt-2.5 bg-gray-50 ring-1 ring-gray-200 rounded-lg p-2.5 space-y-1">
                            <div className="text-[10px] text-gray-400">Set the crew per day & per dihari (shift). Add a dihari to split a day — e.g. 2 in the day shift + 1 in the evening; each shift is billed. Set 0 or remove to drop one.</div>
                            {sched.map((d, di) => {
                              const ids = orderWinIds(effWinIds(r, d) || [], winDefs, d.date);
                              const dayCost = mpDayCost(r, d, mpDay, mpWin, mpWinCount, rate);
                              const hasSlots = winDefs.length > 0 || ids.length > 0;
                              return (
                                <div key={di} className="flex items-start gap-2 flex-wrap text-[11px] py-1.5">
                                  <span className="w-24 text-gray-600 font-medium pt-1">{phaseLbl(d)}</span>
                                  {hasSlots ? (
                                    <div className="flex items-center gap-1.5 flex-wrap flex-1">
                                      {ids.map((id, si) => { const wd = winDefs.find(w => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`; return (
                                        <span key={id} className="inline-flex items-center gap-1 ring-1 ring-gray-200 rounded-lg px-1.5 py-0.5 bg-white">
                                          <span className="text-gray-400">{lbl}</span>
                                          <input type="number" min="0" value={effShift(r, d, id)} onChange={e => setShiftCount(r.type, d.date, id, e.target.value, ids)} className="w-11 border border-gray-200 rounded px-1 py-0.5 text-center" />
                                          {ids.length > 1 && <button onClick={() => removeDihari(r.type, d.date, id, ids)} className="text-red-300 hover:text-red-500" title="remove this dihari">×</button>}
                                        </span>
                                      ); })}
                                      <button onClick={() => addDihari(r, d.date, ids)} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full px-2 py-0.5" title="Add another dihari (shift) for this day">+ dihari</button>
                                    </div>
                                  ) : (
                                    <label className="flex items-center gap-1 flex-1"><span className="text-gray-400">crew</span><input type="number" min="0" value={Math.round(effDay(r, d))} onChange={e => setMpDay(r.type, d.date, e.target.value)} className="w-12 border border-gray-200 rounded px-1 py-0.5 text-center" /></label>
                                  )}
                                  <span className="text-gray-400 pt-1">= {fmt(Math.round(dayCost))}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Planned against actual as two figures side by side, the difference as a tag
                    under the actual — not one sentence each at the two ends of a line. */}
                <div className="px-3 sm:px-4 py-3 bg-gray-50 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Planned</div>
                    <div className="mt-0.5 text-sm font-semibold text-gray-700 tabular-nums">{fmt(mpPlannedCost)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">Actual held</div>
                    <div className="mt-0.5 text-sm font-bold text-gray-900 tabular-nums">{fmt(mpCost)}</div>
                    {mpCost !== mpPlannedCost && (
                      <span className={"mt-1 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums " + (mpCost < mpPlannedCost ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                        {mpCost < mpPlannedCost ? "Saved " : "Over by "}{fmt(Math.abs(mpCost - mpPlannedCost))}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
                </div>
              </div>
            </div>
            </>)}

          </div>
        )}
      </div>
      {/* Deck viewer — full screen, with a clear way back out (tablets have no browser chrome). */}
      {deckView && createPortal(
        <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-gray-900 text-white">
            <button onClick={() => setDeckView(null)}
              className="h-9 pl-2 pr-3.5 rounded-full border border-white/25 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1 text-[14px] font-semibold cursor-pointer">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
            <div className="flex-1 min-w-0 truncate text-[14px] font-semibold">{deckView.name.replace(/\.pdf$/, "")}</div>
            {/* The rebuild above, while it runs — the PDF below is the previous one until it lands. */}
            {exporting === "view" && <span className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-white/70"><span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Updating…</span>}
            <a href={deckView.url} download={deckView.name}
              className="h-9 px-3.5 rounded-full bg-white text-gray-900 hover:bg-gray-100 inline-flex items-center gap-1.5 text-[13px] font-semibold">
              <IconDownload /> Download
            </a>
          </div>
          <iframe title="Deck" src={deckView.url} className="flex-1 w-full border-0 bg-white" />
        </div>,
        document.body
      )}
      {/* A fabric colour, large — a 14px square is enough to tell colours apart, not to match a bolt against. */}
      {/* 🔁 Mandi swap — what was bought instead of a flower the mandi did not have (saveMandiSwap). */}
      {mandiSwap && mandiRows[mandiSwap.i] && createPortal((() => {
        const orig = mandiRows[mandiSwap.i];
        const origCat = mandiCatalogue.find(c => c.name === orig.name);
        const family = (f) => ((f?.flowerType || (f?.isGreen ? "green" : "flower")) === "green" ? "green" : "flower");
        const q = mandiSwap.q.trim().toLowerCase();
        // Greens for a green, flowers for a flower — the rule Deal Check's own swap uses.
        const cands = mandiCatalogue.filter(c => c.name !== orig.name && (!origCat || family(c) === family(origCat))
          && (!q || String(c.name || "").toLowerCase().includes(q) || String(c.flowerCat || "").toLowerCase().includes(q)));
        const to = mandiCatalogue.find(c => c.name === mandiSwap.toName) || null;
        const ok = !!to && Number(mandiSwap.qty) > 0;
        const total = (Number(mandiSwap.qty) || 0) * (Number(mandiSwap.price) || 0);
        const set = (patch) => setMandiSwap(m => ({ ...m, ...patch }));
        return (
          <div onClick={() => setMandiSwap(null)} className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
            <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl w-[min(720px,100%)] max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900">🔁 Swap "{orig.name}" — not available in the mandi</p>
                  <p className="text-xs text-gray-500 mt-0.5">Which flower was bought instead? It goes on this event's shopping list and into its Floral setup book.{Number(orig.projQty) > 0 ? ` Planned: ${orig.projQty} ${orig.unit}.` : ""}</p>
                </div>
                <button onClick={() => setMandiSwap(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
              </div>
              <div className="p-4 border-b space-y-3">
                <input autoFocus value={mandiSwap.q} onChange={e => set({ q: e.target.value })} placeholder={`Search ${origCat && family(origCat) === "green" ? "greens" : "flowers"}…`} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center text-sm">
                  <label className="text-xs font-semibold text-gray-600">Bought</label>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
                    <input type="number" min="0" step="0.1" value={mandiSwap.qty} onChange={e => set({ qty: e.target.value })} className="w-20 border rounded px-2 py-1 text-sm text-center" />
                    <span>{to?.unit || "units"} ×</span>
                    <span>₹</span>
                    <input type="number" min="0" value={mandiSwap.price} onChange={e => set({ price: e.target.value })} className="w-24 border rounded px-2 py-1 text-sm text-center" />
                    <span>/{to?.unit || "unit"}</span>
                    {total > 0 && <span className="font-semibold text-gray-900">= {fmt(total)}</span>}
                  </div>
                  <label className="text-xs font-semibold text-gray-600">Note</label>
                  <input value={mandiSwap.note} onChange={e => set({ note: e.target.value })} placeholder="Reason / details (optional) — e.g. out of season, price too high" className="w-full border rounded-lg px-3 py-1.5 text-sm" />
                </div>
              </div>
              <div className="p-4 overflow-y-auto min-h-0 grid grid-cols-2 md:grid-cols-3 gap-3 content-start auto-rows-max">
                {cands.length === 0 ? <div className="col-span-full text-center text-gray-400 text-sm py-8 italic">No matching flowers in the mandi catalogue.</div>
                  : cands.map(c => {
                    const photo = c.photoUrl || (c.colorVariants || []).find(v => v.photoUrl)?.photoUrl || "";
                    const isCur = c.name === mandiSwap.toName;
                    return (
                      <div key={c.id || c.name} onClick={() => set({ toName: c.name, price: isCur ? mandiSwap.price : String(Number(c.currentPrice) || "") })}
                        className={"cursor-pointer rounded-xl overflow-hidden border-2 " + (isCur ? "border-amber-500" : "border-gray-200 hover:border-amber-300")}>
                        {photo ? <img src={fitUrl(photo, 320)} loading="lazy" decoding="async" alt="" className="w-full aspect-[4/3] object-cover bg-gray-50" /> : <div className="w-full aspect-[4/3] bg-gray-100 flex items-center justify-center text-2xl text-gray-300">🌸</div>}
                        <div className="px-2 py-1.5">
                          <div className="text-xs font-semibold text-gray-800 truncate">{c.name}</div>
                          <div className="text-[10px] text-gray-400 truncate">{c.flowerCat || ""} · ₹{Number(c.currentPrice) || 0}/{c.unit}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="px-5 py-3 border-t flex items-center justify-between gap-2">
                {orig.swappedTo ? <button onClick={() => removeMandiSwap(mandiSwap.i)} className="text-xs text-red-500 hover:text-red-700">✕ Remove swap ({orig.name} was available)</button> : <span />}
                <div className="flex gap-2">
                  <button onClick={() => setMandiSwap(null)} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600">Cancel</button>
                  <button onClick={() => saveMandiSwap(mandiSwap)} disabled={!ok} className={"px-4 py-1.5 rounded-lg text-sm font-semibold text-white " + (ok ? "bg-amber-600 hover:bg-amber-700" : "bg-gray-300 cursor-not-allowed")}>🔁 Save swap</button>
                </div>
              </div>
            </div>
          </div>
        );
      })(), document.body)}
      {swatchView && createPortal(
        <div onClick={() => setSwatchView(null)} className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-6 cursor-zoom-out">
          <div onClick={e => e.stopPropagation()} className="rounded-2xl bg-white shadow-2xl p-4 w-72 space-y-3">
            <div className="w-full h-56 rounded-xl ring-1 ring-black/10" style={{ background: swatchView.hex }} />
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-gray-900 truncate">{swatchView.name}</div>
                <div className="text-xs text-gray-400 uppercase tabular-nums">{swatchView.hex}</div>
              </div>
              <button onClick={() => setSwatchView(null)} className="shrink-0 text-gray-400 hover:text-gray-700 text-[18px] leading-none cursor-pointer" title="Close">×</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Click-to-enlarge lightbox — ops can view any item/kit photo big & clear */}
      {zoomImg && (
        <div onClick={() => setZoomImg(null)} className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out">
          <img src={fitUrl(zoomImg, 700, 75)} loading="lazy" decoding="async" alt="" className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
      {confirmDialog}
      {dcModalOpen && sel && <DeptIncomeModal eo={sel} depts={deptOptions} startDept={dept} onClose={() => setDcModalOpen(false)} />}
    </div>
  );
}

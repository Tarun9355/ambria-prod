// ═══════════════════════════════════════════════════════════════
// STUDIO SUMMARY VIEW — faithful transcription of AmbriStudioInner's
// `StudioSummary` render closure (reference App_latest.jsx ~10626–10841).
//
// Also ports the two export helpers the cost-sheet preview relies on —
// `exportPDF` (~10270–10372) and `exportPPT` (~10374–10624) — verbatim as
// local functions, since the StudioApp `ctx` literal does NOT expose them.
// `exportPPT` keeps its runtime CDN script-injection of PptxGenJS
// (window.PptxGenJS) exactly as in the reference.
//
// Inline styles preserved verbatim (NOT converted to Tailwind).
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from "react";
import { IconSparkle } from "../../../components/icons.jsx";
import { getCat, carpetPricingFor } from "../../../lib/studio/taxonomy";
import { makeDeleteClient } from "../../../lib/studio/clientDelete";
import { swatchHexFor } from "../../../lib/studio/colours";
import { canvaConnectionStatus, canvaCreateImport, canvaPollImport } from "../../../lib/canva";
import { gammaCreateGeneration, gammaPollGeneration } from "../../../lib/gamma";
import { deckImageUrl } from "../../../lib/studio/thumb";

// ═══ COUNT-UP ═══ Rolls the grand total from wherever it currently sits to the new figure, so a
// re-price reads as movement instead of a silent swap. Interrupting mid-roll resumes from the
// displayed value (fromRef tracks every frame), and reduced-motion snaps straight to the target.
function useCountUp(target, ms = 900) {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === target) { fromRef.current = target; setVal(target); return; }
    let raf = 0, start = null;
    const tick = (t) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / ms);
      const v = from + (target - from) * (1 - Math.pow(1 - p, 3)); // easeOutCubic
      fromRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

// ═══ CARD FIREWORKS ═══ Three small bursts looping inside the Total Estimate panel, staggered so
// only one is ever in the air. Centres and angles are fixed at module scope rather than randomised
// per render — random inline styles would change on every re-render and restart particles mid-flight.
// Distinct from the full-screen markSold fireworks; these are ambient and never fire particles
// outside the card (the panel clips them with overflow:hidden).
const TE_BURSTS = [
  { cx: 17, cy: 32, col: "#C9A96E", delay: 1.1, n: 14, dist: 46 },
  { cx: 83, cy: 64, col: "#A78BFA", delay: 3.5, n: 12, dist: 40 },
  { cx: 51, cy: 22, col: "#F5E0B7", delay: 5.9, n: 16, dist: 54 },
];
const TE_FW_PARTICLES = TE_BURSTS.flatMap((b, bi) =>
  Array.from({ length: b.n }, (_, p) => {
    const ang = (p / b.n) * Math.PI * 2 + bi * 0.4;   // offset each burst so the spokes don't line up
    const d = b.dist * (0.72 + ((p * 37) % 11) / 22); // deterministic spread, cheap hash instead of random
    return {
      key: `${bi}-${p}`, col: b.col, delay: b.delay,
      dx: `${(Math.cos(ang) * d).toFixed(1)}px`,
      dy: `${(Math.sin(ang) * d).toFixed(1)}px`,
      cx: b.cx, cy: b.cy,
    };
  })
);

// Own component, not a hook call in StudioSummary — the roll ticks every frame, and StudioSummary
// re-renders the whole cost breakdown (collectAllFunctionData et al) each time it does. Keeping the
// state down here means only this one line repaints.
function AnimatedTotal({ value, fmt }) {
  return <>{fmt(Math.round(useCountUp(value || 0)))}</>;
}

export default function StudioSummary({ ctx }) {
  const [txOpen, setTxOpen] = useState({}); // per-function transport detail expand (collapsed by default)
  // "🎨 Canva" button state — idle | building | uploading | processing | ready | error
  const [canvaState, setCanvaState] = useState("idle");
  const [canvaEditUrl, setCanvaEditUrl] = useState("");
  const [canvaError, setCanvaError] = useState("");
  const {
    // theme / chrome
    S, isDark, accent, border, textS, textP, accentBg, accentText, fmt,
    // client / venue meta
    venue, clientName, fn, clientDate, allVenueData, activeClient, meetingNumber,
    // admin-only client delete (same helper the Client Tracker uses)
    isAdmin, clientLedger, saveClientLedger, eventOrders, activeClientId, askConfirm,
    // events / cost sheet
    eventGrandTotal, collectAllFunctionData, calcFunctionBreakdown,
    buildCombinedCostSheetData, csData, setCsData, saveSession, showMsg,
    // summary accordion state
    expandedSummaryFnIdx, setExpandedSummaryFnIdx,
    // pricing helpers
    getElPriceForFn, transportCalc,
    // Print material rates (IMS Admin → Settings → 🖨️ Print Materials) — for the carpet label below
    imsPrintMaterials, imsCarpetMaterials,
    // Inventory (per-item photos for the MOODBOARD/zone-visual slides' reference grid) + colour/
    // palette catalogues (moodboard swatches, resolved from each function's picked palette name)
    imsInventory, imsColourCatalogue, imsPaletteCatalogue,
    // build canvas / source
    sourceEvent, dcCustomItems, elNotes, fnBuilds, activeFnIdx, zoneLabelsD,
    // sold flow
    showSoldConfetti, markSold,
    // step + reset chain
    setStep, setEnabledEls, setElTiers, setCustomMode, setItemQty, setItemGrades,
    setSelectedMoods, setSelectedPalettes, setVenue, setFn, setClientName,
    setClientDate, setClientPhone, setActiveClientId, setClientSearch, setSavedInsps,
    setFilterCat, setFilterFn, setFilterSpace, setFilterVenue, setElSelectedPhoto,
    setElInspo, setSourceEvent, setSourceVideo, setBrowseVenues, setVenueGroup,
    userVenueScope, setOutsideSub, setShowMoreOutside, setElNotes, setElGallery,
    setZoneConfig, setActiveZones, setShowCosts, setZoneElements, setCustomTripRate,
    setVenueCustom, setCustomGensets, setCustomZones, setNewCzName, setClientBrideGroom,
    setClientShift, setClientPax, setClientVenueOther, setExtraFunctions,
    setExpandedFnIdx, setActiveFnIdx, setFnBuilds, setFloralOverrides, setClientPalette,
  } = ctx;
  // Full reset back to a blank deal. Named so both "Start New" and the admin delete can use it —
  // after deleting the client you are viewing, its summary has to go with it.
  const startNew = () => {setStep(0);setEnabledEls({});setElTiers({});setCustomMode({});setItemQty({});setItemGrades({});setSelectedMoods([]);setSelectedPalettes([]);setVenue("");setFn("");setClientName("");setClientDate("");setClientPhone("");setActiveClientId(null);setClientSearch("");setSavedInsps([]);setFilterCat([]);setFilterFn([]);setFilterSpace([]);setFilterVenue("All");setElSelectedPhoto({});setElInspo({});setSourceEvent(null);setSourceVideo(null);setBrowseVenues([]);setVenueGroup(userVenueScope==="all"?"all":userVenueScope);setOutsideSub("all");setShowMoreOutside(false);setElNotes({});setElGallery(null);setZoneConfig({});setActiveZones([]);setShowCosts(false);setZoneElements({});setCustomTripRate(0);setVenueCustom(false);setCustomGensets(null);setCustomZones([]);setNewCzName("");setClientBrideGroom("");setClientShift("");setClientPax("");setClientVenueOther("");setExtraFunctions([]);setExpandedFnIdx(0);setActiveFnIdx(0);setFnBuilds({});setFloralOverrides({note:"",rows:[]});setClientPalette("Custom");};
  const deleteClient = makeDeleteClient({
    clientLedger, saveClientLedger, eventOrders, activeClientId, setActiveClientId, askConfirm, showMsg,
    onDeleted: () => startNew(),
  });

  const exportPDF = (combined) => {
    if (!combined) combined = buildCombinedCostSheetData();
    const f = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
    const fmtDate = (iso) => {
      if (!iso) return "—";
      try { return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; }
    };
    const fnLine = (fnObj) => {
      const parts = [fnObj.fnType || "Function", fmtDate(fnObj.fnDate), fnObj.fnVenue || "—"];
      if (fnObj.fnShift) parts.push(fnObj.fnShift);
      return parts.filter(Boolean).join(" · ");
    };
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const fnCount = combined.functions.length;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ambria Cost Sheet${combined.clientName ? " - " + combined.clientName : ""}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Outfit','Plus Jakarta Sans',system-ui,-apple-system,sans-serif;color:#1a1a2e;background:#fff;padding:0;font-size:11px;line-height:1.5}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #C9A96E;padding-bottom:16px;margin-bottom:20px}
.logo{display:flex;align-items:center;gap:12px}
.logo-icon{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#C9A96E,#8B7355);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff}
.logo-text h1{font-size:22px;color:#1a1a2e;margin-bottom:2px;letter-spacing:1px}
.logo-text p{font-size:10px;color:#8B7355;text-transform:uppercase;letter-spacing:2px}
.client-bar{background:#F9F7F3;border-radius:10px;padding:14px 18px;margin-bottom:16px;border:1px solid #E8E0D4}
.client-bar .client-name{font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:8px}
.fn-line{font-size:11px;color:#8B7355;padding:2px 0}
.total-hero{background:linear-gradient(135deg,#1a1a2e,#2d1b69);border-radius:12px;padding:20px 28px;color:#fff;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.total-hero .amt{font-size:32px;font-weight:700;color:#C9A96E}
.total-hero .label{font-size:12px;color:#a5b4fc;text-transform:uppercase;letter-spacing:1px}
.fn-section{margin-bottom:28px;page-break-inside:avoid}
.fn-section-head{background:linear-gradient(135deg,#1a1a2e,#2d1b69);border-radius:10px;padding:12px 18px;color:#fff;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.fn-section-head .fn-meta-label{font-size:9px;color:#a5b4fc;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px}
.fn-section-head .fn-meta-line{font-size:13px;font-weight:700;color:#C9A96E}
.fn-section-head .fn-meta-pax{font-size:10px;color:#a5b4fc;margin-top:2px}
.fn-section-head .fn-amt-label{font-size:9px;color:#a5b4fc;text-transform:uppercase}
.fn-section-head .fn-amt{font-size:18px;font-weight:700;color:#C9A96E}
.fn-empty{background:#FDFCFA;border:1px dashed #E8E0D4;border-radius:10px;padding:20px;text-align:center;color:#8B7355;font-style:italic}
.zone{margin-bottom:12px;border:1px solid #E8E0D4;border-radius:10px;overflow:hidden}
.zone-head{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#F9F7F3;border-bottom:1px solid #E8E0D4}
.zone-head h3{font-size:13px;font-weight:600;color:#1a1a2e}
.zone-head .zone-total{font-size:14px;font-weight:700;color:#8B7355}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:6px 12px;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#8B7355;background:#FDFCFA;border-bottom:1px solid #E8E0D4}
th:last-child,td:last-child{text-align:right}
th:nth-child(3),td:nth-child(3),th:nth-child(4),td:nth-child(4){text-align:center}
td{padding:5px 12px;font-size:11px;border-bottom:1px solid #F3EDE4}
tr:last-child td{border-bottom:none}
.struct-row td{color:#6B7280;font-style:italic;background:#FDFCFA}
.subtotal-row{background:#F9F7F3;border-top:2px solid #E8E0D4}
.subtotal-row td{font-weight:700;font-size:12px;color:#1a1a2e;padding:8px 12px}
.note-row{background:#FFFDF7}
.note-row td{font-size:10px;color:#8B7355;padding:6px 12px;font-style:italic}
.transport{margin-bottom:12px;border:1px solid #E8E0D4;border-radius:10px;overflow:hidden}
.transport-head{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#F0F4FF;border-bottom:1px solid #E8E0D4}
.transport-head h3{font-size:13px;font-weight:600;color:#1a1a2e}
.transport-head .tr-total{font-size:14px;font-weight:700;color:#4F46E5}
.tr-row{display:flex;justify-content:space-between;padding:4px 16px;font-size:11px}
.tr-label{color:#6B7280}.tr-val{font-weight:600}
.fn-total-bar{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#F9F7F3;border:1px solid #E8E0D4;border-radius:10px;margin-top:8px}
.fn-total-bar .fn-tot-label{font-size:12px;font-weight:700;color:#1a1a2e}
.fn-total-bar .fn-tot-amt{font-size:16px;font-weight:700;color:#8B7355}
.summary-table{margin-bottom:20px;border:1px solid #E8E0D4;border-radius:10px;overflow:hidden}
.summary-table th{background:#8B7355;color:#fff;padding:8px 12px;font-size:10px}
.summary-table td{padding:7px 12px;font-size:11px}
.grand{background:linear-gradient(135deg,#1a1a2e,#2d1b69);border-radius:12px;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;margin-top:20px}
.grand .g-label{font-size:16px;font-weight:700;color:#fff}
.grand .g-amt{font-size:28px;font-weight:700;color:#C9A96E}
.footer{text-align:center;margin-top:24px;padding-top:16px;border-top:2px solid #E8E0D4;font-size:9px;color:#8B7355}
.footer strong{color:#1a1a2e}
@media print{body{padding:0}.page{padding:20px 24px}@page{size:A4;margin:12mm}.fn-section{page-break-inside:avoid}}
</style></head><body><div class="page">
<div class="header"><div class="logo"><div class="logo-icon">A</div><div class="logo-text"><h1>AMBRIA</h1><p>Decorations &amp; Events</p></div></div><div style="text-align:right;font-size:10px;color:#8B7355"><div style="font-size:12px;font-weight:600;color:#1a1a2e">Cost Estimate</div><div>${today}</div><div>Ref: AMB-${Date.now().toString(36).toUpperCase().slice(-6)}</div></div></div>
<div class="client-bar"><div class="client-name">${combined.clientName || "—"}</div>${combined.functions.map(fnObj => `<div class="fn-line">${fnLine(fnObj)}${fnObj.fnPax ? ` · ${fnObj.fnPax} pax` : ""}</div>`).join("")}</div>
<div class="total-hero"><div><div class="label">Event Grand Total</div><div class="amt">${f(combined.eventGrandTotal)}</div></div><div style="text-align:right"><div style="font-size:12px;color:#a5b4fc">${fnCount} function${fnCount !== 1 ? "s" : ""}</div></div></div>
${combined.functions.map((fnObj, fi) => `
<div class="fn-section">
<div class="fn-section-head"><div><div class="fn-meta-label">Function ${fi + 1} of ${fnCount}</div><div class="fn-meta-line">${fnLine(fnObj)}</div>${fnObj.fnPax ? `<div class="fn-meta-pax">${fnObj.fnPax} pax</div>` : ""}</div><div style="text-align:right"><div class="fn-amt-label">Total</div><div class="fn-amt">${fnObj.isEmpty ? "—" : f(fnObj.grand)}</div></div></div>
${fnObj.isEmpty ? `<div class="fn-empty">Design pending — zones for this function have not been built yet.</div>` : `
${fnObj.zones.map(z => `<div class="zone"><div class="zone-head"><h3>${z.label}</h3><div class="zone-total">${f(z.zoneTotal)}</div></div>
${z.photo ? `<div style="padding:8px 12px;background:#FAFAF7;border-bottom:1px solid #E8E0D4"><img src="${z.photo}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;display:block" onerror="this.style.display='none'"/>${z.photoName ? `<div style="font-size:9px;color:#8B7355;margin-top:4px;text-align:center">Reference: ${z.photoName}</div>` : ""}</div>` : ""}
<table><tr><th>Item</th><th>Size</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
${z.structItems.map(si => `<tr class="struct-row"><td>${si.name}</td><td>—</td><td>—</td><td>—</td><td>${f(si.total)}</td></tr>`).join("")}
${z.items.map(it => `<tr><td>${it.name}</td><td>${it.size || "—"}</td><td>${it.qty}</td><td>${f(it.rate)}/${it.unit}</td><td>${f(it.total)}</td></tr>`).join("")}
<tr class="subtotal-row"><td colspan="4">${z.label} Subtotal</td><td>${f(z.zoneTotal)}</td></tr>
${z.note ? `<tr class="note-row"><td colspan="5">📝 ${z.note}</td></tr>` : ""}
</table></div>`).join("")}
${fnObj.transport ? `<div class="transport"><div class="transport-head"><h3>🚛 Transport &amp; Power</h3><div class="tr-total">${f(fnObj.transport.total)}</div></div><div style="padding:8px 0">
${(fnObj.transport.breakdown || []).map(bd => `<div class="tr-row"><div class="tr-label">${bd.label} — ${bd.trucks} truck${bd.trucks !== 1 ? "s" : ""}</div><div class="tr-val">${f((bd.trucks || 0) * (fnObj.transport.tripRate || 0) * 2)}</div></div>`).join("")}
<div class="tr-row"><div class="tr-label">Genset (${fnObj.transport.gensets} units × ${f(fnObj.transport.gensetRate)})</div><div class="tr-val">${f(fnObj.transport.gensetCost)}</div></div>
</div></div>` : ""}
<div class="fn-total-bar"><div class="fn-tot-label">${fnObj.fnType || "Function"} Total</div><div class="fn-tot-amt">${f(fnObj.grand)}</div></div>
`}
</div>
`).join("")}
<div class="summary-table"><table><tr><th>Function</th><th style="text-align:left">Date · Venue</th><th style="text-align:right">Decor</th><th style="text-align:right">Transport</th><th style="text-align:right">Grand</th></tr>
${combined.functions.map(fnObj => `<tr><td style="font-weight:600">${fnObj.fnType || "—"}</td><td style="text-align:left;color:#6B7280">${fmtDate(fnObj.fnDate)} · ${fnObj.fnVenue || "—"}</td><td style="text-align:right">${fnObj.isEmpty ? "—" : f(fnObj.decorTotal)}</td><td style="text-align:right;color:#4F46E5">${fnObj.isEmpty ? "—" : f(fnObj.transportTotal)}</td><td style="text-align:right;font-weight:700">${fnObj.isEmpty ? "—" : f(fnObj.grand)}</td></tr>`).join("")}
</table></div>
<div class="grand"><div class="g-label">Event Grand Total</div><div class="g-amt">${f(combined.eventGrandTotal)}</div></div>
<div class="footer"><strong>Ambria Decorations</strong> · Pushpanjali, Bijwasan, New Delhi · thefusiondecor.com<br>This is an estimate. Final pricing may vary based on customization and availability.</div>
</div></body></html>`;
    return html;
  };

  // Builds the full PptxGenJS deck and returns it UNWRITTEN (no writeFile/download) — shared by the
  // "📊 PPT" download button and the "🎨 Canva" flow below, which uploads the same bytes instead of
  // saving them locally. Throws on failure; callers decide their own error message.
  const buildPptx = async (combined) => {
    if (!combined) combined = buildCombinedCostSheetData();
    try {
      // Dynamically load pptxgenjs
      if (!window.PptxGenJS) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js";
          s.onload = resolve;
          s.onerror = () => {
            const s2 = document.createElement("script");
            s2.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
            s2.onload = resolve;
            s2.onerror = () => reject(new Error("PPT library unavailable — will work after Vercel deployment"));
            document.head.appendChild(s2);
          };
          document.head.appendChild(s);
        });
      }
      const pptx = new window.PptxGenJS();
      pptx.author = "Ambria Decorations";
      pptx.title = `Cost Estimate${combined.clientName ? " - " + combined.clientName : ""}`;
      // Every slide below is coordinate-authored for a 10x7.5in canvas (content routinely reaches
      // y:6.4-6.9in — footers, total bands, zone photos). LAYOUT_16x9 is 10x5.63in, so on that layout
      // all of that was being silently clipped off the bottom of every slide. LAYOUT_4x3 matches the
      // canvas the coordinates were actually written for.
      pptx.layout = "LAYOUT_4x3";

      const gold = "C9A96E";
      const dark = "1A1A2E";
      const gray = "6B7280";
      const f = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
      const fmtDate = (iso) => {
        if (!iso) return "—";
        try { return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; }
      };
      const fnLine = (fnObj) => {
        const parts = [fnObj.fnType || "Function", fmtDate(fnObj.fnDate), fnObj.fnVenue || "—"];
        if (fnObj.fnShift) parts.push(fnObj.fnShift);
        return parts.filter(Boolean).join(" · ");
      };

      // ═══ SLIDE 1 — COVER (stacked function lines) ═══
      let slide = pptx.addSlide();
      slide.background = { fill: dark };
      slide.addText("AMBRIA", { x: 0.8, y: 0.9, w: 8.4, fontSize: 48, fontFace: "Arial", color: gold, bold: true, align: "center" });
      slide.addText("DECORATIONS & EVENTS", { x: 0.8, y: 1.7, w: 8.4, fontSize: 14, fontFace: "Arial", color: "A5B4FC", align: "center", charSpacing: 6 });
      slide.addShape(pptx.shapes.LINE, { x: 3.0, y: 2.2, w: 4.0, h: 0, line: { color: gold, width: 2 } });
      slide.addText("COST ESTIMATE", { x: 0.8, y: 2.5, w: 8.4, fontSize: 18, fontFace: "Arial", color: "FFFFFF", align: "center", charSpacing: 4 });
      slide.addText(`${combined.clientName || "—"}`, { x: 0.8, y: 3.2, w: 8.4, fontSize: 22, fontFace: "Arial", color: gold, align: "center", bold: true });
      // Stacked function lines (vertically centered block based on count)
      const fnCount = combined.functions.length;
      const lineStartY = 4.0;
      combined.functions.forEach((fnObj, i) => {
        slide.addText(fnLine(fnObj), { x: 0.8, y: lineStartY + i * 0.32, w: 8.4, fontSize: 12, fontFace: "Arial", color: "E5E7EB", align: "center" });
      });
      slide.addText("Pushpanjali, Bijwasan, New Delhi", { x: 0.8, y: 6.7, w: 8.4, fontSize: 9, fontFace: "Arial", color: "505060", align: "center" });

      // Looks up an inventory item's own photo by name (best-effort — items only carry a name/qty/
      // rate in this cost-sheet data, not their inventory id, so this is a name match same as
      // buildZonesForFn's own paint-cost lookup). Used by the per-zone visual slide's item grid.
      const itemPhotoFor = (name) => {
        const inv = (imsInventory || []).find(i => (i.name || "").toLowerCase() === String(name || "").toLowerCase());
        return inv?.img || (Array.isArray(inv?.photoUrls) && inv.photoUrls[0]) || null;
      };

      // ═══ Per-function blocks ═══
      combined.functions.forEach(fnObj => {
        if (fnObj.isEmpty) {
          // Empty function placeholder — single slide, nothing to show a moodboard/zone-visual for.
          slide = pptx.addSlide();
          slide.background = { fill: "FFFFFF" };
          slide.addText(fnLine(fnObj).toUpperCase(), { x: 0.6, y: 0.35, w: 8.8, fontSize: 18, fontFace: "Arial", color: dark, bold: true });
          slide.addShape(pptx.shapes.LINE, { x: 0.6, y: 0.85, w: 2.0, h: 0, line: { color: gold, width: 2 } });
          slide.addText("Design pending", { x: 0.6, y: 3.0, w: 8.8, fontSize: 22, fontFace: "Arial", color: gray, align: "center", italic: true });
          slide.addText("Zones for this function have not been built yet.", { x: 0.6, y: 3.6, w: 8.8, fontSize: 11, fontFace: "Arial", color: "A0A0B0", align: "center" });
          return; // skip moodboard/overview/zone/transport slides for empty fn
        }

        // ═══ MOODBOARD slide — palette swatches + a collage of this function's zone photos,
        // mirrors the sample deck's opening page. Falls back to a neutral palette when the
        // function has no palette picked, so the slide is never blank. ═══
        const paletteObj = (imsPaletteCatalogue || []).find(p => p.name === fnObj.palette);
        const anchorNames = paletteObj?.anchorColours?.length ? paletteObj.anchorColours : ["Ivory", "Blush Pink", "Sage Green", "Gold"];
        const swatchHexes = anchorNames.slice(0, 6).map((n) => swatchHexFor(n, imsColourCatalogue).replace("#", ""));
        const moodPhotos = fnObj.zones.map((z) => z.photo).filter(Boolean).slice(0, 3);
        slide = pptx.addSlide();
        slide.background = { fill: "FFFFFF" };
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 0.5, w: 3.4, h: 0.8, fill: { color: "F7DCD0" }, rectRadius: 0.15, line: { type: "none" } });
        slide.addText("MOODBOARD", { x: 0.6, y: 0.5, w: 3.4, h: 0.8, fontSize: 24, fontFace: "Arial", color: dark, bold: true, align: "center", valign: "middle" });
        slide.addText(fnLine(fnObj), { x: 0.6, y: 1.4, w: 3.4, fontSize: 11, fontFace: "Arial", color: gray });
        slide.addText("Color Palette", { x: 0.6, y: 5.0, w: 3.4, fontSize: 16, fontFace: "Arial", color: "D9694F", italic: true });
        swatchHexes.forEach((hex, i) => {
          slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.6 + i * 0.56, y: 5.45, w: 0.5, h: 1.3, fill: { color: hex }, rectRadius: 0.22, line: { type: "none" } });
        });
        // Landscape-shaped boxes — event photos are almost always wide shots, so the collage is
        // stacked strips/tiles rather than tall narrow columns (a tall column cover-crops a landscape
        // photo down to a thin vertical sliver of its center, which read as badly cropped).
        if (moodPhotos.length > 0) {
          const positions = moodPhotos.length === 1
            ? [{ x: 4.3, y: 1.8, w: 5.0, h: 3.5 }]
            : moodPhotos.length === 2
            ? [{ x: 4.3, y: 0.5, w: 5.0, h: 2.9 }, { x: 4.3, y: 3.55, w: 5.0, h: 2.9 }]
            : [{ x: 4.3, y: 0.5, w: 5.0, h: 3.3 }, { x: 4.3, y: 3.95, w: 2.42, h: 2.35 }, { x: 6.88, y: 3.95, w: 2.42, h: 2.35 }];
          moodPhotos.forEach((photo, i) => {
            const pos = positions[i]; if (!pos) return;
            try { const imgOpts = { ...pos, sizing: { type: "cover", w: pos.w, h: pos.h } }; if (photo.startsWith("data:")) imgOpts.data = photo; else imgOpts.path = photo; slide.addImage(imgOpts); } catch {}
          });
        }

        // ═══ Per-zone visual slides — hero photo + a labeled grid of that zone's own item photos.
        // Closest automatable match to the sample's annotated zone pages: we can't reproduce
        // hand-drawn arrows pointing at a specific spot in the photo (no data says where in the
        // image the truss vs. the drape is), so items are called out as a labeled reference grid
        // instead, same pattern as the sample's own "Wooden Partition / Carved Console Table" grids. ═══
        fnObj.zones.forEach((z) => {
          if (!z.photo) return;
          slide = pptx.addSlide();
          slide.background = { fill: "FFFFFF" };
          slide.addText(z.label.toUpperCase(), { x: 0.6, y: 0.3, w: 8.8, fontSize: 20, fontFace: "Arial", color: dark, bold: true });
          slide.addShape(pptx.shapes.LINE, { x: 0.6, y: 0.78, w: 2.0, h: 0, line: { color: gold, width: 2 } });
          try {
            const imgOpts = { x: 0.6, y: 1.0, w: 5.3, h: 5.9, sizing: { type: "cover", w: 5.3, h: 5.9 } };
            if (z.photo.startsWith("data:")) imgOpts.data = z.photo; else imgOpts.path = z.photo;
            slide.addImage(imgOpts);
          } catch {}
          const withPhoto = z.items.map((it) => ({ name: it.name, img: itemPhotoFor(it.name) })).filter((it) => it.img).slice(0, 4);
          const gx = 6.2, gw = 2.8, cellH = 1.7, gap = 0.15;
          withPhoto.forEach((it, i) => {
            const y = 1.0 + i * (cellH + gap);
            const imgH = cellH * 0.72;
            try {
              const imgOpts = { x: gx, y, w: gw, h: imgH, sizing: { type: "cover", w: gw, h: imgH } };
              if (it.img.startsWith("data:")) imgOpts.data = it.img; else imgOpts.path = it.img;
              slide.addImage(imgOpts);
            } catch {}
            slide.addText(it.name, { x: gx, y: y + cellH * 0.72 + 0.03, w: gw, fontSize: 9, color: gray, align: "center" });
          });
        });

        // ── Section header slide — a full-bleed photo title card when a zone photo exists (this used
        // to be title + gold line + a total band floating over a mostly-blank white slide, which read
        // as an empty/unfinished page since the Overview slide right after already shows the same
        // total). A hero photo behind the function name is the standard decor-deck divider pattern. ──
        slide = pptx.addSlide();
        const dividerPhoto = moodPhotos[0] || null;
        if (dividerPhoto) {
          slide.background = { fill: dark };
          try {
            const imgOpts = { x: 0, y: 0, w: 10, h: 7.5, sizing: { type: "cover", w: 10, h: 7.5 } };
            if (dividerPhoto.startsWith("data:")) imgOpts.data = dividerPhoto; else imgOpts.path = dividerPhoto;
            slide.addImage(imgOpts);
          } catch {}
          slide.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 7.5, fill: { color: dark, transparency: 42 }, line: { type: "none" } });
          slide.addText(fnLine(fnObj).toUpperCase(), { x: 0.8, y: 3.2, w: 8.4, fontSize: 26, fontFace: "Arial", color: "FFFFFF", bold: true, align: "center" });
          slide.addShape(pptx.shapes.LINE, { x: 4.0, y: 3.95, w: 2.0, h: 0, line: { color: gold, width: 2 } });
        } else {
          slide.background = { fill: "FFFFFF" };
          slide.addText(fnLine(fnObj).toUpperCase(), { x: 0.6, y: 3.2, w: 8.8, fontSize: 22, fontFace: "Arial", color: dark, bold: true, align: "center" });
          slide.addShape(pptx.shapes.LINE, { x: 4.0, y: 3.85, w: 2.0, h: 0, line: { color: gold, width: 2 } });
        }
        // Function-level grand total band at bottom
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 6.4, w: 8.8, h: 0.7, fill: { color: dark }, rectRadius: 0.1 });
        slide.addText([{ text: "Function Total  ", options: { fontSize: 12, color: "A5B4FC" } }, { text: f(fnObj.grand), options: { fontSize: 18, color: gold, bold: true } }], { x: 0.8, y: 6.45, w: 8.4, h: 0.6, align: "center", valign: "middle" });

        // ── Function overview slide ──
        slide = pptx.addSlide();
        slide.background = { fill: "FFFFFF" };
        slide.addText("OVERVIEW — " + (fnObj.fnType || "Function").toUpperCase(), { x: 0.6, y: 0.3, w: 8.8, fontSize: 18, fontFace: "Arial", color: dark, bold: true });
        slide.addShape(pptx.shapes.LINE, { x: 0.6, y: 0.75, w: 2.0, h: 0, line: { color: gold, width: 2 } });
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 1.0, w: 8.8, h: 1.0, fill: { color: dark }, rectRadius: 0.12 });
        slide.addText([{ text: "Function Total  ", options: { fontSize: 13, color: "A5B4FC" } }, { text: f(fnObj.grand), options: { fontSize: 24, color: gold, bold: true } }], { x: 0.8, y: 1.1, w: 8.4, h: 0.8, align: "center", valign: "middle" });
        const ovRows = [
          [{ text: "Zone", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 10 } },
           { text: "Items", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 10, align: "center" } },
           { text: "Structure", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 10, align: "right" } },
           { text: "Decor Items", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 10, align: "right" } },
           { text: "Zone Total", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 10, align: "right" } }]
        ];
        fnObj.zones.forEach(z => {
          ovRows.push([
            { text: z.label, options: { fontSize: 10, color: dark } },
            { text: String(z.items.length), options: { fontSize: 10, align: "center", color: gray } },
            { text: f(z.structTotal), options: { fontSize: 10, align: "right", color: gray } },
            { text: f(z.itemTotal), options: { fontSize: 10, align: "right", color: dark } },
            { text: f(z.zoneTotal), options: { fontSize: 10, align: "right", color: dark, bold: true } }
          ]);
        });
        if (fnObj.transport) {
          ovRows.push([
            { text: "Transport & Power", options: { fontSize: 10, color: "4F46E5", bold: true } },
            { text: (fnObj.transport.trucks || 0) + " trucks", options: { fontSize: 10, align: "center", color: gray } },
            { text: "", options: {} }, { text: "", options: {} },
            { text: f(fnObj.transport.total || 0), options: { fontSize: 10, align: "right", color: "4F46E5", bold: true } }
          ]);
        }
        slide.addTable(ovRows, { x: 0.6, y: 2.3, w: 8.8, fontSize: 10, border: { type: "solid", pt: 0.5, color: "E8E0D4" }, rowH: 0.35, colW: [2.5, 1.0, 1.6, 1.8, 1.9] });

        // ── Per-zone detail slides ──
        fnObj.zones.forEach(z => {
          if (z.items.length === 0 && z.structItems.length === 0) return;
          slide = pptx.addSlide();
          slide.background = { fill: "FFFFFF" };
          slide.addText(`${z.label}`, { x: 0.6, y: 0.3, w: 5.5, fontSize: 18, fontFace: "Arial", color: dark, bold: true });
          slide.addText(f(z.zoneTotal), { x: 7.0, y: 0.3, w: 2.4, fontSize: 18, fontFace: "Arial", color: "8B7355", bold: true, align: "right" });
          slide.addText(fnObj.fnType || "", { x: 0.6, y: 0.62, w: 5.5, fontSize: 9, fontFace: "Arial", color: gray });
          slide.addShape(pptx.shapes.LINE, { x: 0.6, y: 0.82, w: 2.0, h: 0, line: { color: gold, width: 2 } });
          if (z.photo) {
            try {
              const imgOpts = { x: 6.2, y: 0.25, w: 3.0, h: 1.8, sizing: { type: "cover", w: 3.0, h: 1.8 } };
              if (z.photo.startsWith("data:")) imgOpts.data = z.photo; else imgOpts.path = z.photo;
              slide.addImage(imgOpts);
              if (z.photoName) slide.addText(z.photoName, { x: 6.2, y: 2.1, w: 3.0, fontSize: 7, color: "A0A0B0", align: "center" });
            } catch {}
          }
          const tblY = z.photo ? 2.4 : 1.0;
          const rows = [
            [{ text: "Item", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 9 } },
             { text: "Size", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 9, align: "center" } },
             { text: "Qty", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 9, align: "center" } },
             { text: "Rate", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 9, align: "right" } },
             { text: "Amount", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 9, align: "right" } }]
          ];
          z.structItems.forEach(si => {
            rows.push([
              { text: si.name, options: { fontSize: 9, color: gray, italic: true } },
              { text: "—", options: { fontSize: 9, align: "center", color: "B0B0B0" } },
              { text: "—", options: { fontSize: 9, align: "center", color: "B0B0B0" } },
              { text: "—", options: { fontSize: 9, align: "right", color: "B0B0B0" } },
              { text: f(si.total), options: { fontSize: 9, align: "right", color: gray } }
            ]);
          });
          z.items.forEach(it => {
            rows.push([
              { text: it.name, options: { fontSize: 9, color: dark } },
              { text: it.size || "—", options: { fontSize: 9, align: "center", color: gray } },
              { text: String(it.qty), options: { fontSize: 9, align: "center", color: dark } },
              { text: f(it.rate) + "/" + it.unit, options: { fontSize: 9, align: "right", color: gray } },
              { text: f(it.total), options: { fontSize: 9, align: "right", color: dark, bold: true } }
            ]);
          });
          rows.push([
            { text: z.label + " Subtotal", options: { fontSize: 10, color: dark, bold: true, fill: { color: "F9F7F3" } } },
            { text: "", options: { fill: { color: "F9F7F3" } } },
            { text: "", options: { fill: { color: "F9F7F3" } } },
            { text: "", options: { fill: { color: "F9F7F3" } } },
            { text: f(z.zoneTotal), options: { fontSize: 10, align: "right", color: "8B7355", bold: true, fill: { color: "F9F7F3" } } }
          ]);
          slide.addTable(rows, { x: 0.6, y: tblY, w: 8.8, fontSize: 9, border: { type: "solid", pt: 0.5, color: "E8E0D4" }, rowH: 0.3, colW: [3.2, 1.0, 0.8, 1.6, 2.2], autoPage: true });
          if (z.note) {
            const noteY = Math.min(tblY + (rows.length * 0.3) + 0.2, 6.5);
            slide.addText("📝 " + z.note, { x: 0.6, y: noteY, w: 8.8, fontSize: 9, fontFace: "Arial", color: "8B7355", italic: true });
          }
        });

        // ── Transport slide for this function ──
        if (fnObj.transport) {
          slide = pptx.addSlide();
          slide.background = { fill: "FFFFFF" };
          slide.addText("TRANSPORT & POWER — " + (fnObj.fnType || "Function").toUpperCase(), { x: 0.6, y: 0.3, w: 8.8, fontSize: 16, fontFace: "Arial", color: dark, bold: true });
          slide.addShape(pptx.shapes.LINE, { x: 0.6, y: 0.72, w: 2.0, h: 0, line: { color: gold, width: 2 } });
          const trRows = [
            [{ text: "Item", options: { bold: true, color: "FFFFFF", fill: { color: "4F46E5" }, fontSize: 9 } },
             { text: "Details", options: { bold: true, color: "FFFFFF", fill: { color: "4F46E5" }, fontSize: 9 } },
             { text: "Amount", options: { bold: true, color: "FFFFFF", fill: { color: "4F46E5" }, fontSize: 9, align: "right" } }]
          ];
          (fnObj.transport.breakdown || []).forEach(bd => {
            trRows.push([
              { text: bd.label, options: { fontSize: 9, color: dark } },
              { text: (bd.trucks || 0) + " truck" + ((bd.trucks || 0) !== 1 ? "s" : "") + " × " + f(fnObj.transport.tripRate) + " × 2", options: { fontSize: 9, color: gray } },
              { text: f((bd.trucks || 0) * (fnObj.transport.tripRate || 0) * 2), options: { fontSize: 9, align: "right", color: dark } }
            ]);
          });
          trRows.push([
            { text: "Genset", options: { fontSize: 9, color: dark } },
            { text: (fnObj.transport.gensets || 0) + " units × " + f(fnObj.transport.gensetRate || 0), options: { fontSize: 9, color: gray } },
            { text: f(fnObj.transport.gensetCost || 0), options: { fontSize: 9, align: "right", color: dark } }
          ]);
          trRows.push([
            { text: "Transport Total", options: { fontSize: 10, color: "4F46E5", bold: true, fill: { color: "EEF2FF" } } },
            { text: "", options: { fill: { color: "EEF2FF" } } },
            { text: f(fnObj.transport.total || 0), options: { fontSize: 10, align: "right", color: "4F46E5", bold: true, fill: { color: "EEF2FF" } } }
          ]);
          slide.addTable(trRows, { x: 0.6, y: 1.0, w: 8.8, fontSize: 9, border: { type: "solid", pt: 0.5, color: "E8E0D4" }, rowH: 0.35, colW: [2.5, 4.0, 2.3] });
        }
      });

      // ═══ FINAL SLIDE — comparison + event grand total ═══
      slide = pptx.addSlide();
      slide.background = { fill: "FFFFFF" };
      slide.addText("EVENT SUMMARY", { x: 0.6, y: 0.3, w: 8.8, fontSize: 20, fontFace: "Arial", color: dark, bold: true });
      slide.addShape(pptx.shapes.LINE, { x: 0.6, y: 0.78, w: 2.0, h: 0, line: { color: gold, width: 2 } });
      const sumRows = [
        [{ text: "Function", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 11 } },
         { text: "Date · Venue", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 11 } },
         { text: "Decor", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 11, align: "right" } },
         { text: "Transport", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 11, align: "right" } },
         { text: "Grand", options: { bold: true, color: "FFFFFF", fill: { color: "8B7355" }, fontSize: 11, align: "right" } }]
      ];
      combined.functions.forEach(fnObj => {
        sumRows.push([
          { text: fnObj.fnType || "—", options: { fontSize: 10, color: dark, bold: true } },
          { text: `${fmtDate(fnObj.fnDate)} · ${fnObj.fnVenue || "—"}`, options: { fontSize: 10, color: gray } },
          { text: fnObj.isEmpty ? "—" : f(fnObj.decorTotal), options: { fontSize: 10, align: "right", color: dark } },
          { text: fnObj.isEmpty ? "—" : f(fnObj.transportTotal), options: { fontSize: 10, align: "right", color: "4F46E5" } },
          { text: fnObj.isEmpty ? "—" : f(fnObj.grand), options: { fontSize: 10, align: "right", color: dark, bold: true } }
        ]);
      });
      slide.addTable(sumRows, { x: 0.6, y: 1.1, w: 8.8, fontSize: 10, border: { type: "solid", pt: 0.5, color: "E8E0D4" }, rowH: 0.36, colW: [1.6, 3.2, 1.4, 1.3, 1.3] });

      // Event grand total band
      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 4.7, w: 8.8, h: 1.2, fill: { color: dark }, rectRadius: 0.15 });
      slide.addText([{ text: "EVENT GRAND TOTAL  ", options: { fontSize: 16, color: "FFFFFF" } }, { text: f(combined.eventGrandTotal), options: { fontSize: 32, color: gold, bold: true } }], { x: 0.8, y: 4.8, w: 8.4, h: 1.0, align: "center", valign: "middle" });
      slide.addText("Ambria Decorations · Pushpanjali, Bijwasan, New Delhi · thefusiondecor.com", { x: 0.6, y: 6.6, w: 8.8, fontSize: 8, color: "A0A0B0", align: "center" });
      slide.addText("This is an estimate. Final pricing may vary based on customization and availability.", { x: 0.6, y: 6.9, w: 8.8, fontSize: 7, color: "C0C0C0", align: "center" });

      return { pptx, combined };
    } catch (err) {
      console.error("PPT build error:", err);
      throw err;
    }
  };

  const exportPPT = async (combined) => {
    showMsg("Generating PPT...", "blue");
    try {
      const { pptx, combined: c } = await buildPptx(combined);
      const fileName = `Ambria_Estimate${c.clientName ? "_" + c.clientName.replace(/\s+/g, "_") : ""}_${new Date().toISOString().slice(0, 10)}`;
      pptx.writeFile({ fileName });
      showMsg("✓ PPT downloaded!", "green");
    } catch (err) {
      console.error("PPT export error:", err);
      showMsg("PPT export failed — " + (err.message || "try again after deployment"), "red");
    }
  };

  // Turns the same cost-sheet data buildPptx uses into a markdown outline for Gamma's Generate API.
  // Sections are separated by "\n---\n" (Gamma's own card-break syntax with cardSplit:
  // "inputTextBreaks" — one break = one extra card), and zone photos are dropped in as bare
  // Cloudinary URLs (Gamma fetches/re-hosts them; imageOptions.source:"noImages" on the edge-function
  // side means it uses ONLY these, no AI-generated filler). textMode:"preserve" keeps our numbers and
  // wording exact — Gamma is designing the layout, not rewriting the content.
  const buildGammaOutline = (combined) => {
    const f = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
    const fmtDate = (iso) => {
      if (!iso) return "—";
      try { return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; }
    };
    const fnLine = (fnObj) => {
      const parts = [fnObj.fnType || "Function", fmtDate(fnObj.fnDate), fnObj.fnVenue || "—"];
      if (fnObj.fnShift) parts.push(fnObj.fnShift);
      return parts.filter(Boolean).join(" · ");
    };
    // Looks up an inventory item's own photo by name — same name match buildPptx's itemPhotoFor
    // uses, since the cost-sheet data only carries a name/qty/rate, not the inventory id.
    const itemPhotoFor = (name) => {
      const inv = (imsInventory || []).find((i) => (i.name || "").toLowerCase() === String(name || "").toLowerCase());
      return inv?.img || (Array.isArray(inv?.photoUrls) && inv.photoUrls[0]) || null;
    };
    const sections = [];

    const fnLines = combined.functions.map(fnLine).join("\n");
    sections.push(`# Ambria Decorations — Cost Estimate\n\n**${combined.clientName || "Client"}**\n\n${fnLines}\n\nPushpanjali, Bijwasan, New Delhi`);

    combined.functions.forEach((fnObj) => {
      if (fnObj.isEmpty) {
        sections.push(`# ${fnLine(fnObj)}\n\nDesign pending — zones for this function have not been built yet.`);
        return;
      }
      // Every photo goes to Gamma at ONE aspect ratio (see deckImageUrl). Handing it the raw uploads
      // meant portrait and landscape phone shots on the same card, which Gamma can only place inset
      // with white margins — the deck ended up looking like a contact sheet.
      const zonePhotos = fnObj.zones.map((z) => z.photo).filter((p) => p && !p.startsWith("data:")).slice(0, 4).map((p) => deckImageUrl(p));
      sections.push([`# ${fnLine(fnObj)} — Moodboard`, fnObj.palette ? `Color palette: ${fnObj.palette}` : "", ...zonePhotos].filter(Boolean).join("\n\n"));

      // One highlight card per zone that has a photo — the zone's hero shot plus its own decor
      // items' photos (so the deck shows the actual pieces going into that zone, not just a table row).
      fnObj.zones.forEach((z) => {
        if (!z.photo || z.photo.startsWith("data:")) return;
        const withPhoto = z.items.map((it) => ({ name: it.name, img: itemPhotoFor(it.name) })).filter((it) => it.img && !it.img.startsWith("data:")).slice(0, 4);
        // 4:3, not square. Item shots are wide — a rug, a run of fabric — and a square centre-crop cut
        // them down to an unreadable patch of texture. Still one fixed ratio across every item, so the
        // strip under the hero stays a row of equal tiles.
        const itemLines = withPhoto.map((it) => `${it.name}\n${deckImageUrl(it.img, 1200, 900)}`).join("\n\n");
        sections.push([`# ${fnLine(fnObj)} — ${z.label}`, deckImageUrl(z.photo), itemLines].filter(Boolean).join("\n\n"));
      });

      const rows = fnObj.zones.map((z) => `| ${z.label} | ${z.items.length} | ${f(z.structTotal)} | ${f(z.itemTotal)} | ${f(z.zoneTotal)} |`).join("\n");
      const tbl = `| Zone | Items | Structure | Decor Items | Zone Total |\n|---|---|---|---|---|\n${rows}`;
      const transportLine = fnObj.transport ? `\n\nTransport & Power: ${f(fnObj.transport.total || 0)} (${fnObj.transport.trucks || 0} trucks)` : "";
      sections.push(`# ${fnLine(fnObj)} — Cost Breakdown\n\n${tbl}${transportLine}\n\n**Function Total: ${f(fnObj.grand)}**`);
    });

    const sumRows = combined.functions.map((fnObj) => `| ${fnObj.fnType || "—"} | ${fmtDate(fnObj.fnDate)} · ${fnObj.fnVenue || "—"} | ${fnObj.isEmpty ? "—" : f(fnObj.decorTotal)} | ${fnObj.isEmpty ? "—" : f(fnObj.transportTotal)} | ${fnObj.isEmpty ? "—" : f(fnObj.grand)} |`).join("\n");
    sections.push(`# Event Summary\n\n| Function | Date · Venue | Decor | Transport | Grand |\n|---|---|---|---|---|\n${sumRows}\n\n**EVENT GRAND TOTAL: ${f(combined.eventGrandTotal)}**\n\nAmbria Decorations · Pushpanjali, Bijwasan, New Delhi · thefusiondecor.com\n\n_This is an estimate. Final pricing may vary based on customization and availability._`);

    return sections.join("\n---\n");
  };

  // "🎨 Canva" — the cost-sheet content goes to Gamma first so its AI actually designs the deck
  // (rather than our own hand-coded PptxGenJS layout), then the pptx Gamma exports is uploaded to
  // Canva as a Design Import job, same as before, so the salesperson still gets back an editable
  // Canva draft. Everything polls client-side (each poll is one fast GET via an edge function)
  // rather than blocking one long edge-function call, since both steps can take a while and edge
  // functions have a short execution ceiling.
  const sendToCanva = async (combined) => {
    setCanvaState("designing"); setCanvaEditUrl(""); setCanvaError("");
    try {
      const connected = await canvaConnectionStatus();
      if (!connected) {
        setCanvaState("error");
        setCanvaError('Canva isn\'t connected — ask an admin to connect it in IMS → Admin → Settings.');
        return;
      }
      const outline = buildGammaOutline(combined);
      const title = `${combined.clientName || "Ambria"} Cost Estimate`;
      const generationId = await gammaCreateGeneration(outline, title);
      let base64 = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const res = await gammaPollGeneration(generationId);
        if (res.status === "completed") { base64 = res.base64; break; }
        if (res.status === "failed") { setCanvaState("error"); setCanvaError(res.error || "Gamma design failed"); return; }
      }
      if (!base64) { setCanvaState("error"); setCanvaError("Timed out waiting for Gamma to finish designing — try again"); return; }
      setCanvaState("uploading");
      const jobId = await canvaCreateImport(base64, title);
      setCanvaState("processing");
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const res = await canvaPollImport(jobId);
        if (res.status === "success") { setCanvaEditUrl(res.editUrl); setCanvaState("ready"); return; }
        if (res.status === "failed") { setCanvaState("error"); setCanvaError(res.error || "Canva import failed"); return; }
      }
      setCanvaState("error"); setCanvaError("Timed out waiting for Canva — try again");
    } catch (err) {
      console.error("Canva send error:", err);
      setCanvaState("error");
      setCanvaError(err.message || "Deck generation failed");
    }
  };

  const vb=venue&&allVenueData[venue]?allVenueData[venue].base:0;
  return(<>
    <div style={S.main}>
      <style>{`
/* ═══ ESTIMATE HEADER ═══ Staggered entrance. Every animated part starts hidden with fill-mode
   forwards, so prefers-reduced-motion must restore the END state, not just cancel the animation —
   cancelling alone would leave the whole header invisible. */
@keyframes shPop{0%{opacity:0;transform:scale(.72)}62%{transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
@keyframes shRise{0%{opacity:0;transform:translateY(11px)}100%{opacity:1;transform:none}}
/* Ripple keeps its original 2.1s travel but now sits in a 3.6s cycle — the tail 42% is rest, so it
   loops forever as a slow pulse rather than a continuous strobe. */
@keyframes shHalo{0%{opacity:.45;transform:scale(.86)}58%,100%{opacity:0;transform:scale(1.55)}}
@keyframes shRule{0%{width:0;opacity:0}100%{width:56px;opacity:1}}
.sh-badge{opacity:0;animation:shPop .62s cubic-bezier(.34,1.4,.5,1) .05s forwards}
.sh-halo{animation:shHalo 3.6s ease-out .55s infinite}
.sh-1{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .18s forwards}
.sh-2{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .26s forwards}
.sh-3{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .34s forwards}
.sh-4{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .42s forwards}
.sh-rule{width:0;opacity:0;animation:shRule .5s cubic-bezier(.22,.61,.36,1) .5s forwards}
/* ═══ PREVIEW BUTTON ═══ Sits in the Total Estimate card's top-right corner. The glow is a
   breathing box-shadow on the button plus a soft blurred halo behind it (.sh-pv-glow), so the
   pulse reads on the dark gradient without the button itself changing size. */
@keyframes pvPulse{
  0%,100%{box-shadow:0 0 0 1px rgba(201,169,110,.55),0 0 10px rgba(201,169,110,.35),0 0 22px rgba(201,169,110,.18)}
  50%{box-shadow:0 0 0 1px rgba(201,169,110,.9),0 0 18px rgba(201,169,110,.65),0 0 40px rgba(201,169,110,.4)}
}
@keyframes pvHalo{0%,100%{opacity:.35;transform:scale(1)}50%{opacity:.7;transform:scale(1.09)}}
.sh-pv{position:relative;background:linear-gradient(135deg,#D9B87C,#B08D4F);color:#1A1206;animation:pvPulse 2.4s ease-in-out infinite;transition:background .18s,filter .18s,transform .18s}
.sh-pv:hover{background:linear-gradient(135deg,#E8CFA0,#C9A96E);filter:brightness(1.06);transform:translateY(-1.5px)}
.sh-pv:active{transform:translateY(0);filter:brightness(.96)}
.sh-pv-glow{position:absolute;inset:-6px;border-radius:12px;background:radial-gradient(closest-side,rgba(201,169,110,.5),transparent 72%);filter:blur(7px);pointer-events:none;animation:pvHalo 2.4s ease-in-out infinite}
/* ═══ SOLD BUTTON ═══ Only the enabled button carries this class, so the hover never fires on the
   greyed-out state. Green + shadow live here rather than inline so :hover can actually override. */
.sh-sold{background:linear-gradient(135deg,#10B981,#059669);box-shadow:0 4px 20px rgba(16,185,129,.35);transition:background .18s,box-shadow .18s,transform .18s}
.sh-sold:hover{background:linear-gradient(135deg,#34D399,#10B981);box-shadow:0 6px 26px rgba(16,185,129,.55);transform:translateY(-1.5px)}
.sh-sold:active{transform:translateY(0);box-shadow:0 3px 14px rgba(16,185,129,.4)}
/* ═══ TOTAL ESTIMATE CARD ═══ Entrance is staggered to land just after the header's .5s rule, so
   the page resolves top-down. Two drifting aurora blobs and a slow sheen give the panel some life
   once it's settled; both are decorative siblings behind a positioned content wrapper. */
@keyframes teRise{0%{opacity:0;transform:translateY(16px) scale(.985)}100%{opacity:1;transform:none}}
@keyframes tePop{0%{opacity:0;transform:scale(.8)}64%{transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@keyframes teAurora{0%,100%{transform:translate(-6%,-8%) scale(1);opacity:.45}50%{transform:translate(9%,7%) scale(1.18);opacity:.8}}
@keyframes teAurora2{0%,100%{transform:translate(5%,6%) scale(1.12);opacity:.5}50%{transform:translate(-7%,-6%) scale(1);opacity:.28}}
/* One sweep every 7s — the travel is squeezed into the first ~18% so the rest of the cycle is rest. */
@keyframes teSheen{0%{transform:translateX(-150%) skewX(-18deg);opacity:0}
  3%{opacity:.55}14%{opacity:.55}
  18%,100%{transform:translateX(330%) skewX(-18deg);opacity:0}}
.sh-te{opacity:0;animation:teRise .62s cubic-bezier(.22,.61,.36,1) .5s forwards}
.sh-te-aurora{position:absolute;left:4%;top:-34%;width:56%;height:168%;border-radius:50%;pointer-events:none;
  background:radial-gradient(closest-side,rgba(124,58,237,.5),transparent 70%);filter:blur(40px);animation:teAurora 9s ease-in-out infinite}
.sh-te-aurora2{position:absolute;right:2%;top:-24%;width:46%;height:150%;border-radius:50%;pointer-events:none;
  background:radial-gradient(closest-side,rgba(201,169,110,.34),transparent 70%);filter:blur(44px);animation:teAurora2 11s ease-in-out infinite}
.sh-te-sheen{position:absolute;top:0;bottom:0;left:0;width:34%;pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);animation:teSheen 7s ease-in-out 1.3s infinite}
/* Fireworks: 8s cycle, but the burst itself only occupies the first ~16% — the rest is dead air so
   the three staggered bursts read as occasional sparkle, not a constant shower. */
@keyframes teFw{
  0%{transform:translate(0,0) scale(1);opacity:0}
  2%{opacity:1}
  10%{opacity:.85}
  16%,100%{transform:translate(var(--dx),calc(var(--dy) + 16px)) scale(.2);opacity:0}}
.sh-te-fw{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.sh-te-fw span{position:absolute;width:3.5px;height:3.5px;border-radius:50%;opacity:0;animation:teFw 8s ease-out infinite}
.sh-te-lbl{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .64s forwards}
.sh-te-amt{opacity:0;animation:shRise .55s cubic-bezier(.22,.61,.36,1) .72s forwards;text-shadow:0 2px 18px rgba(201,169,110,.28)}
.sh-te-pill{opacity:0;animation:tePop .5s cubic-bezier(.34,1.4,.5,1) .84s forwards}
.sh-te-cta{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .94s forwards}
/* ═══ FOOTER NAV (Adjust / Start New) ═══ These keep S.btn(false) for their resting look, so the
   hover has to out-specify an inline style — hence !important on the two properties it changes. */
.sh-nav{transition:background .18s,color .18s,transform .18s,box-shadow .18s}
.sh-nav:hover{background:${isDark?"rgba(201,169,110,0.16)":"#EFE8DA"} !important;color:${accentText} !important;
  transform:translateY(-1.5px);box-shadow:0 4px 14px ${isDark?"rgba(0,0,0,0.4)":"rgba(201,169,110,0.28)"}}
.sh-nav:active{transform:translateY(0) scale(.985)}
.sh-nav:focus-visible{outline:2px solid ${accent};outline-offset:2px}
@media (prefers-reduced-motion: reduce){
  .sh-badge,.sh-1,.sh-2,.sh-3,.sh-4{animation:none;opacity:1;transform:none}
  .sh-rule{animation:none;opacity:1;width:56px}
  .sh-halo{animation:none;opacity:0}
  .sh-pv{animation:none;box-shadow:0 0 0 1px rgba(201,169,110,.7)}
  .sh-pv-glow{animation:none;opacity:.4}
  .sh-te,.sh-te-lbl,.sh-te-amt,.sh-te-pill,.sh-te-cta{animation:none;opacity:1;transform:none}
  .sh-te-aurora,.sh-te-aurora2{animation:none;opacity:.45}
  .sh-te-sheen,.sh-te-fw{animation:none;opacity:0}
  .sh-te-fw span{animation:none;opacity:0}
  .sh-nav:hover,.sh-nav:active{transform:none}
}
      `}</style>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div className="sh-badge" style={{position:"relative",width:60,height:60,margin:"0 auto 14px",borderRadius:"50%",
          display:"flex",alignItems:"center",justifyContent:"center",color:accent,
          background:isDark?"rgba(201,169,110,0.12)":"rgba(201,169,110,0.13)",border:`1px solid ${accent}55`,
          boxShadow:isDark?"0 10px 26px -14px rgba(0,0,0,0.7)":"0 10px 26px -14px rgba(201,169,110,0.55)"}}>
          <IconSparkle size={26}/>
          <span className="sh-halo" style={{position:"absolute",inset:-7,borderRadius:"50%",border:`1px solid ${accent}`,opacity:0,pointerEvents:"none"}}/>
        </div>
        <div className="sh-1" style={{fontSize:30,fontWeight:700,letterSpacing:-0.6,lineHeight:1.15}}>Decor Estimate</div>
        {clientName&&<div className="sh-2" style={{fontSize:16,color:accentText,fontWeight:600,marginTop:3}}>{clientName}</div>}
        <div className="sh-3" style={{fontSize:13.5,color:textS,marginTop:3}}>{venue} {"·"} {fn}{clientDate&&` · ${new Date(clientDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`}</div>
        {activeClient&&<div className="sh-4" style={{marginTop:9}}><span style={{fontSize:10,padding:"3px 12px",borderRadius:8,background:accentBg,color:accentText,fontWeight:600}}>Meeting #{meetingNumber} with {activeClient.name}</span></div>}
        <div className="sh-rule" style={{height:2,borderRadius:2,margin:"16px auto 0",background:`linear-gradient(90deg,transparent,${accent},transparent)`}}/>
      </div>
      {/* Big Deal Check button removed 05 May 2026 — discreet ⚙ cog in header (line ~9993) is the canonical entry point per spec §7.9.2 */}
      {/* ═══ FIREWORKS ═══ Seven bursts across the screen, each throwing particles out radially
          with a little gravity droop. Everything finishes inside the 4s markSold keeps the flag on. */}
      {showSoldConfetti&&<div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
        {Array.from({length:7}).map((_,b)=>{
          const cx=10+Math.random()*80, cy=14+Math.random()*46;          // burst centre, in %
          const col=["#C9A96E","#10B981","#F59E0B","#EC4899","#8B5CF6","#3B82F6","#EF4444"][b%7];
          const delay=b*0.26+Math.random()*0.18;                        // staggered, not simultaneous
          return Array.from({length:24}).map((__,p)=>{
            const ang=(p/24)*Math.PI*2+Math.random()*0.2;
            const dist=80+Math.random()*80;
            return <span key={b+"-"+p} className="fw-p" style={{position:"absolute",left:`${cx}%`,top:`${cy}%`,
              width:5,height:5,borderRadius:"50%",background:col,boxShadow:`0 0 8px ${col}`,opacity:0,
              "--dx":`${Math.cos(ang)*dist}px`,"--dy":`${Math.sin(ang)*dist}px`,
              animation:`fwBurst 1.3s cubic-bezier(.15,.6,.3,1) ${delay}s forwards`}}/>;
          });
        })}
        <style>{`@keyframes fwBurst{
          0%{transform:translate(0,0) scale(1);opacity:1}
          60%{opacity:1}
          100%{transform:translate(var(--dx),calc(var(--dy) + 30px)) scale(.3);opacity:0}}
          @media (prefers-reduced-motion: reduce){.fw-p{animation:none !important;opacity:0}}`}</style>
      </div>}
      <div className="sh-te" style={{position:"relative",overflow:"hidden",background:"linear-gradient(135deg,#0F0F1A,#2d1b69)",borderRadius:18,padding:"20px 26px",color:"#fff",textAlign:"center",marginBottom:22}}>
        {/* Decorative layers — absolutely positioned, so the content below needs its own positioned
            wrapper to paint above them. */}
        <span className="sh-te-aurora"/>
        <span className="sh-te-aurora2"/>
        <div className="sh-te-fw" aria-hidden="true">
          {TE_FW_PARTICLES.map(p=><span key={p.key} style={{left:`${p.cx}%`,top:`${p.cy}%`,background:p.col,boxShadow:`0 0 7px ${p.col}`,animationDelay:`${p.delay}s`,"--dx":p.dx,"--dy":p.dy}}/>)}
        </div>
        <span className="sh-te-sheen"/>
        {/* Preview — opens the full cost-sheet overlay (csData). Only gate is having at least one
            function to show; the sheet itself is editable and exports to PDF/PPT/Canva. */}
        <button className="sh-pv" onClick={()=>setCsData(buildCombinedCostSheetData())} title="Preview the full cost sheet"
          style={{position:"absolute",top:13,right:13,padding:"5px 12px",borderRadius:8,border:"none",cursor:"pointer",
            fontSize:11,fontWeight:700,letterSpacing:.3,
            display:"inline-flex",alignItems:"center",gap:6,zIndex:2}}>
          <span className="sh-pv-glow"/>
          <span style={{position:"relative"}}>{"👁"} Preview</span>
        </button>
        <div style={{position:"relative",zIndex:1}}>
        <div className="sh-te-lbl" style={{fontSize:11.5,color:"#a5b4fc",textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Total Estimate</div>
        <div className="sh-te-amt" style={{fontSize:33,fontWeight:700,marginBottom:7}}><AnimatedTotal value={eventGrandTotal} fmt={fmt}/></div>
        <div className="sh-te-pill" style={{display:"inline-block",padding:"4px 15px",borderRadius:12,fontSize:12.5,fontWeight:600,background:getCat(eventGrandTotal).bg,color:getCat(eventGrandTotal).color}}>{getCat(eventGrandTotal).label}</div>
        {/* SOLD lives with the number it confirms. Same handler, same gate — a small button here
            rather than a full-width bar above the panel. */}
        <div className="sh-te-cta" style={{marginTop:12}}>
        {activeClient?.status==="booked"
          ? /* Inline-flex, not a block — it shrinks to its text and the card's textAlign:center
               keeps it centred, instead of stretching a near-empty bar the full panel width. */
            <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:9,background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.3)"}}><span style={{fontSize:11.5}}>{"✅"}</span><span style={{fontSize:11.5,fontWeight:600,color:"#10B981"}}>Booked{activeClient.bookedAt&&` on ${new Date(activeClient.bookedAt).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`}</span>{activeClient.bookedBy&&<span style={{fontSize:10,color:"#a5b4fc"}}>by {activeClient.bookedBy}</span>}</div>
          : (()=>{const canSold=clientName.trim()&&clientDate&&venue;const missing=[];if(!clientName.trim())missing.push("name");if(!clientDate)missing.push("date");if(!venue)missing.push("venue");return <>
          {/* Enabled state gets its green + shadow from .sh-sold so the :hover rule can override
              them — an inline background would always win over the stylesheet. */}
          <button onClick={markSold} disabled={!canSold} className={canSold?"sh-sold":""} style={{padding:"7px 18px",borderRadius:9,border:"none",cursor:canSold?"pointer":"not-allowed",fontSize:11.5,fontWeight:700,background:canSold?undefined:"#333",color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:canSold?undefined:"none",opacity:canSold?1:0.5}}>{"🎉"} SOLD — Confirm Booking</button>
          {!canSold&&<div style={{fontSize:10,color:textS,textAlign:"center",marginTop:6}}>Requires: {missing.join(", ")}</div>}
          </>;})()}
        </div>
        {(() => {
          const allFns = collectAllFunctionData();
          return allFns.length > 1 ? <div className="sh-te-cta" style={{fontSize:11,color:"#a5b4fc",marginTop:10}}>{allFns.length} functions · {allFns.map(f => f.fnType || "—").join(" + ")}</div> : null;
        })()}
        </div>
      </div>
      {sourceEvent&&<div style={{...S.card,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}><div style={{fontSize:11,color:textS}}>Design based on:</div><div style={{fontSize:13,fontWeight:600}}>{sourceEvent.name}</div><span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:accentBg,color:accentText}}>{sourceEvent.venue}</span>{sourceEvent.venue!==venue&&<><span style={{fontSize:11,color:textS}}>{"→"}</span><span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:transportCalc.isNew?"rgba(245,158,11,0.15)":"rgba(99,102,241,0.15)",color:transportCalc.isNew?"#F59E0B":"#818cf8"}}>{"📍"} Function at {venue}</span></>}</div>}

      {/* ═══ MULTI-FUNCTION SUMMARY — ACCORDION PER FUNCTION ═══ */}
      {(() => {
        const allFns = collectAllFunctionData();
        // Sort chronologically by date
        const sortedFns = [...allFns].sort((a, b) => {
          const da = a.fnDate || "9999-12-31";
          const db = b.fnDate || "9999-12-31";
          return da.localeCompare(db);
        });
        const fnEmoji = (type) => {
          const t = (type || "").toLowerCase();
          if (t.includes("haldi")) return "🌅";
          if (t.includes("mehendi") || t.includes("mehandi")) return "🎨";
          if (t.includes("sangeet")) return "🎵";
          if (t.includes("wedding")) return "💒";
          if (t.includes("reception")) return "🥂";
          if (t.includes("engagement") || t.includes("sagai")) return "💍";
          return "📅";
        };
        const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"}) : "No date";
        return sortedFns.map((fnData) => {
          const breakdown = calcFunctionBreakdown(fnData);
          const fnGrand = breakdown.grand;
          const isExpanded = expandedSummaryFnIdx === fnData.fnIdx;
          return (
            <div key={fnData.fnIdx} style={{...S.card, marginBottom:14, overflow:"hidden"}}>
              {/* Accordion header */}
              <div onClick={() => setExpandedSummaryFnIdx(isExpanded ? -1 : fnData.fnIdx)}
                   style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",cursor:"pointer",background:isExpanded?(isDark?"rgba(201,169,110,0.08)":"rgba(201,169,110,0.06)"):(isDark?"rgba(255,255,255,0.02)":"#FAFAF7"),borderBottom:isExpanded?`1px solid ${border}`:"none",transition:"background 0.2s"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",flex:1,minWidth:0}}>
                  <span style={{fontSize:22}}>{fnEmoji(fnData.fnType)}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:textP}}>{fnData.fnType || "Function"}{fnData.fnDate && <span style={{fontWeight:400,color:textS,marginLeft:8}}>· {fmtDate(fnData.fnDate)}</span>}{fnData.fnShift && <span style={{fontWeight:400,color:textS,marginLeft:6}}>· {fnData.fnShift}</span>}</div>
                    <div style={{fontSize:11,color:textS,marginTop:2,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      {fnData.fnVenue && <span>📍 {fnData.fnVenue}</span>}
                      {fnData.fnPax && <span>👥 {fnData.fnPax} pax</span>}
                      <span>{breakdown.zones.filter(z => z.tot > 0).length} zone{breakdown.zones.filter(z => z.tot > 0).length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                  <div style={{fontSize:18,fontWeight:700,color:accentText}}>{fmt(fnGrand)}</div>
                  <span style={{fontSize:14,color:textS,transition:"transform 0.2s",transform:isExpanded?"rotate(180deg)":"rotate(0deg)",display:"inline-block"}}>▼</span>
                </div>
              </div>
              {/* Accordion body — zones + transport + grand total for this function */}
              {isExpanded && (
                <div>
                  {/* Zones */}
                  {breakdown.zones.length === 0 ? (
                    <div style={{padding:"20px 24px",textAlign:"center",fontSize:13,color:textS}}>No zones configured yet for this function. Switch to Build to add zones & elements.</div>
                  ) : (
                    <>
                      {breakdown.zones.map(eb => (
                        <div key={eb.k} style={{borderBottom:`1px solid ${border}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",padding:"14px 20px",background:isDark?"rgba(201,169,110,0.03)":"#FAFAF7"}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <span style={{fontSize:18}}>{eb.icon}</span>
                              <div>
                                <div style={{fontSize:14,fontWeight:600}}>{eb.label}</div>
                                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                  <span style={{fontSize:10,color:textS}}>{eb.itemCount} items</span>
                                  {eb.zc && <span style={{fontSize:9,color:textS}}>{["L","W","H"].map(d=>`${eb.zc.dims?.[d]||0}ft`).join("×")}</span>}
                                  {eb.selPh && <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"#ECFDF5",color:"#059669"}}>📷 {eb.selPh.eventName}</span>}
                                </div>
                              </div>
                            </div>
                            <div style={{fontSize:16,fontWeight:700,color:accentText}}>{fmt(eb.tot)}</div>
                          </div>
                          {(eb.zl.total>0||eb.useElementCard) && (
                            <div style={{padding:"0 20px 8px 48px"}}>
                              {eb.zl.truss>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🔩 Truss ({eb.zc?.trT==="box"?"Box ₹50":"U ₹30"}/sqft)</span><span style={{fontWeight:600}}>{fmt(eb.zl.truss)}</span></div>}
                              {eb.zl.masking>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🧱 {eb.zc?.mkT} masking ({eb.zc?.mkS} side{eb.zc?.mkS>1?"s":""})</span><span style={{fontWeight:600}}>{fmt(eb.zl.masking)}</span></div>}
                              {eb.zl.platform>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🏗️ Platform ({eb.zc?.plH})</span><span style={{fontWeight:600}}>{fmt(eb.zl.platform)}</span></div>}
                              {eb.zl.carpet>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🟫 Carpet ({carpetPricingFor(eb.zc?.cpT, imsCarpetMaterials).label})</span><span style={{fontWeight:600}}>{fmt(eb.zl.carpet)}</span></div>}
                              {eb.zl.arches>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🏛️ Arches ({eb.zc?.archT?.toUpperCase()} ×{eb.zc?.archQty})</span><span style={{fontWeight:600}}>{fmt(eb.zl.arches)}</span></div>}
                              {eb.zl.pillars>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🏛️ Pillars (×{eb.zc?.pillarQty})</span><span style={{fontWeight:600}}>{fmt(eb.zl.pillars)}</span></div>}
                              {eb.zl.glass>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>💎 Glass ({eb.zc?.glassT?.toUpperCase()} ×{eb.zc?.glassQty})</span><span style={{fontWeight:600}}>{fmt(eb.zl.glass)}</span></div>}
                              <div style={{borderTop:`1px solid ${border}`,marginTop:4,paddingTop:4}}>
                                {eb.useElementCard ? (eb.elems || []).map((el2, ei) => {
                                  const priceInfo = getElPriceForFn(el2, eb.zc, typeof fnData.floralRatio === "number" ? fnData.floralRatio : 70);
                                  const lt = priceInfo.lineCost;
                                  return lt > 0 ? <div key={ei} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>{el2.name} {el2.size ? `(${el2.size})` : ""} ×{el2.qty}</span><span style={{fontWeight:600}}>{fmt(lt)}</span></div> : null;
                                }) : <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}><span style={{color:textS}}>🪑 Items ({eb.itemCount})</span><span style={{fontWeight:600}}>{fmt(eb.ic)}</span></div>}
                                {/* §26.13 — Production/Buying custom items in this zone */}
                                {dcCustomItems.filter(ci => ci.fnIdx === fnData.fnIdx && ci.zoneKey === eb.k).map(ci => {
                                  const isP = ci.type === "production";
                                  const ciColor = isP ? "#A855F7" : "#F59E0B";
                                  const unitCost = ci.manualPrice || ci.refPrice || 0;
                                  return (
                                    <div key={ci.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12,alignItems:"center"}}>
                                      <span style={{color:ciColor,display:"flex",alignItems:"center",gap:4}}>
                                        {isP?"🏭":"🛒"} {ci.subCat} ×{ci.qty}
                                        <span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:`${ciColor}15`,color:ciColor,fontWeight:700}}>{isP?"PROD":"BUY"}</span>
                                      </span>
                                      <span style={{fontWeight:600,color:ciColor}}>{fmt(unitCost * (Number(ci.qty)||1))}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <div style={{display:"flex",justifyContent:"space-between",padding:"14px 20px",background:accentBg}}>
                        <div style={{fontSize:14,fontWeight:700,color:accentText}}>Decor Subtotal</div>
                        <div style={{fontSize:16,fontWeight:700,color:accentText}}>{fmt(breakdown.decorTotal)}</div>
                      </div>
                    </>
                  )}
                  {/* Transport for this function */}
                  {breakdown.transport && breakdown.transport.total > 0 && (
                    <div style={{borderTop:`1px solid ${border}`}}>
                      <div onClick={()=>setTxOpen(p=>({...p,[fnData.fnIdx]:!p[fnData.fnIdx]}))} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 20px",background:isDark?"rgba(201,169,110,0.03)":"#FAFAF7",cursor:"pointer"}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:11,color:textS,transition:"transform 0.15s",display:"inline-block",transform:txOpen[fnData.fnIdx]?"rotate(0)":"rotate(-90deg)"}}>▼</span>
                          <span style={{fontSize:18}}>🚛</span>
                          <div>
                            <div style={{fontSize:14,fontWeight:600}}>Transport <span style={{fontSize:10,fontWeight:400,color:textS}}>· tap to {txOpen[fnData.fnIdx]?"hide":"see"} details</span></div>
                            <div style={{display:"flex",gap:6,alignItems:"center"}}>
                              <span style={{fontSize:10,padding:"1px 8px",borderRadius:4,background:breakdown.transport.isNew?"rgba(245,158,11,0.15)":"rgba(99,102,241,0.15)",color:breakdown.transport.isNew?"#F59E0B":"#818cf8"}}>{breakdown.transport.isNew?"New venue":breakdown.transport.tierLabel}</span>
                              <span style={{fontSize:10,color:textS}}>{fnData.fnVenue}</span>
                            </div>
                          </div>
                        </div>
                        <div style={{fontSize:15,fontWeight:700,color:accentText}}>{fmt(breakdown.transport.total)}</div>
                      </div>
                      {txOpen[fnData.fnIdx] && (
                      <div style={{padding:"6px 20px 12px 48px"}}>
                        {breakdown.transport.breakdown.map((bd, bi) => (
                          <div key={bi} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}>
                            <span style={{color:textS}}>{bd.isFloral?"🌸":bd.isBuffer?"🛡️":"🚚"} {bd.label} {bd.isFloral?`(${fmt(bd.qty)} ÷ ${fmt(bd.perTruck)})`:bd.isBuffer?`(${bd.tierLabel})`:bd.qty>0?`(${bd.qty} ÷ ${bd.perTruck}/${bd.unit})`:""}</span>
                            <span style={{fontWeight:600}}>{bd.trucks} truck{bd.trucks!==1?"s":""}</span>
                          </div>
                        ))}
                        <div style={{borderTop:`0.5px solid ${border}`,marginTop:6,paddingTop:8,fontSize:12}}>
                          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:textS}}>⚡ Genset × {breakdown.transport.gensets}</span><span>{fmt(breakdown.transport.gensetCost)}</span></div>
                          <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span style={{color:textS}}>🚛 Trucks × {breakdown.transport.trucks} × 2 trips @ {fmt(breakdown.transport.tripRate)}</span><span>{fmt(breakdown.transport.truckTotal)}</span></div>
                        </div>
                      </div>
                      )}
                    </div>
                  )}
                  {/* Function grand total */}
                  <div style={{display:"flex",justifyContent:"space-between",padding:"16px 20px",background:"linear-gradient(135deg,#0F0F1A,#2d1b69)"}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{fnData.fnType || "Function"} Total</div>
                    <div style={{fontSize:18,fontWeight:700,color:"#C9A96E"}}>{fmt(fnGrand)}</div>
                  </div>
                </div>
              )}
            </div>
          );
        });
      })()}
      {/* ═══ END MULTI-FUNCTION SUMMARY ═══ */}
      {(() => {
        // Aggregate notes across all functions (elNotes may differ per function snapshot)
        const allFns = collectAllFunctionData();
        const allNotes = [];
        allFns.forEach(fnData => {
          const fnNotes = fnData.fnIdx === activeFnIdx ? elNotes : (fnBuilds[fnData.fnIdx]?.elNotes || {});
          Object.entries(fnNotes || {}).forEach(([zk, note]) => {
            if (note && note.trim()) {
              const zm = zoneLabelsD[zk] || (fnData.customZones || []).find(cz => cz.id === zk) || { label: zk, icon: "📦" };
              allNotes.push({ fnType: fnData.fnType, zk, label: zm.label, icon: zm.icon, note });
            }
          });
        });
        return allNotes.length > 0 ? (
          <div style={{...S.card, marginTop:16, padding:20}}>
            <div style={{fontSize:14,fontWeight:600,color:accentText,marginBottom:12}}>📝 All Client Notes</div>
            {allNotes.map((n, i) => (
              <div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
                <span style={{fontSize:14}}>{n.icon}</span>
                <div>
                  <div style={{fontSize:12,fontWeight:600}}>{n.fnType ? `${n.fnType} · ${n.label}` : n.label}</div>
                  <div style={{fontSize:11,color:textS,lineHeight:1.5}}>{n.note}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null;
      })()}
      <div style={{display:"flex",justifyContent:"space-between",marginTop:32}}>
        <button className="sh-nav" onClick={()=>setStep(2)} style={S.btn(false)}>{"←"} Adjust</button>
        {/* Admin only, and deliberately a quiet text link rather than a third button: it sits a
            few pixels from "Start New" and must not read as an equal peer of it. Deletes the client
            whose summary this is, then resets to a blank deal — the confirm spells out the damage. */}
        {isAdmin && activeClient?.id && (
          <button onClick={()=>deleteClient(activeClient)} title={`Delete ${activeClient.name} and all its sessions`}
            style={{alignSelf:"center",background:"none",border:"none",cursor:"pointer",color:"#E11D48",
              fontSize:11,fontWeight:600,textDecoration:"underline",textUnderlineOffset:3,padding:"4px 8px"}}>
            {"🗑"} Delete this client
          </button>
        )}
        <button onClick={startNew} className="sh-nav" style={S.btn(false)}>Start New</button>
      </div>
    </div>

    {csData&&(()=>{
      const csUpdateQty=(fnIdx,zi,ii,newQty)=>{
        const d=JSON.parse(JSON.stringify(csData));
        const fnObj=d.functions[fnIdx];
        if(!fnObj||!fnObj.zones[zi])return;
        const item=fnObj.zones[zi].items[ii];
        if(!item)return;
        item.qty=Math.max(0,newQty);
        item.total=item.qty*item.rate;
        fnObj.zones[zi].itemTotal=fnObj.zones[zi].items.reduce((s,i)=>s+i.total,0);
        fnObj.zones[zi].zoneTotal=fnObj.zones[zi].structTotal+fnObj.zones[zi].itemTotal;
        fnObj.decorTotal=fnObj.zones.reduce((s,z)=>s+z.zoneTotal,0);
        fnObj.grand=fnObj.decorTotal+(fnObj.transportTotal||0);
        d.eventGrandTotal=d.functions.reduce((s,f)=>s+(f.grand||0),0);
        setCsData(d);
      };
      const csExportPDF=()=>{const html=exportPDF(csData);const w=window.open("","_blank");if(w){w.document.write(html);w.document.close();setTimeout(()=>w.print(),800);}else{showMsg("Open in deployed app for PDF export","blue");}};
      const csExportPPT=()=>exportPPT(csData);
      const fmtDate=(iso)=>{if(!iso)return"—";try{return new Date(iso+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}catch{return iso;}};
      const fnLine=(fnObj)=>{const parts=[fnObj.fnType||"Function",fmtDate(fnObj.fnDate),fnObj.fnVenue||"—"];if(fnObj.fnShift)parts.push(fnObj.fnShift);return parts.filter(Boolean).join(" · ");};
      const fnCount=csData.functions.length;
      return(
      <div style={{position:"fixed",inset:0,background:isDark?"#0A0A14":"#F5F3EE",zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:"#1a1a2e",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#C9A96E,#8B7355)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff"}}>A</div>
            <div><div style={{fontSize:14,fontWeight:700,color:"#C9A96E"}}>Cost Sheet</div><div style={{fontSize:11,color:"#a5b4fc"}}>{csData.clientName||"Client"} · {fnCount} function{fnCount!==1?"s":""}</div></div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{textAlign:"right",marginRight:12}}><div style={{fontSize:10,color:"#a5b4fc",textTransform:"uppercase"}}>Event Grand Total</div><div style={{fontSize:22,fontWeight:700,color:"#C9A96E"}}>{fmt(csData.eventGrandTotal)}</div></div>
            <button onClick={csExportPDF} style={{padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:"#E11D48",color:"#fff"}}>{"📄"} PDF</button>
            <button onClick={csExportPPT} style={{padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:"#0EA5E9",color:"#fff"}}>{"📊"} PPT</button>
            {(() => {
              const busy = canvaState === "designing" || canvaState === "uploading" || canvaState === "processing";
              const busyLabel = canvaState === "designing" ? "Designing…" : canvaState === "uploading" ? "Uploading…" : "Finalizing…";
              if (canvaState === "ready") return <button onClick={() => window.open(canvaEditUrl, "_blank")} style={{padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:"#7C3AED",color:"#fff"}}>{"↗"} Open in Canva</button>;
              return <button disabled={busy} onClick={()=>sendToCanva(csData)} title={canvaState==="error"?canvaError:"Design this deck with Gamma's AI, then send it to Canva as an editable draft"} style={{padding:"8px 16px",borderRadius:8,border:"none",cursor:busy?"default":"pointer",fontSize:12,fontWeight:600,background:canvaState==="error"?"#EF4444":"#7C3AED",color:"#fff",opacity:busy?0.7:1}}>{busy?`⏳ ${busyLabel}`:canvaState==="error"?"⚠ Retry":"🎨 Canva"}</button>;
            })()}
            <button onClick={()=>setCsData(null)} style={{padding:"8px 14px",borderRadius:8,border:"1px solid rgba(255,255,255,0.2)",background:"transparent",color:"#fff",cursor:"pointer",fontSize:12}}>{"✕"}</button>
          </div>
        </div>
        {canvaState==="error"&&canvaError&&<div style={{padding:"6px 20px",background:"rgba(239,68,68,0.15)",color:"#FCA5A5",fontSize:11,flexShrink:0}}>{canvaError}</div>}
        {/* Scrollable body */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 24px",maxWidth:960,margin:"0 auto",width:"100%"}}>
          {/* Stacked function lines (mirrors PPT cover) */}
          <div style={{textAlign:"center",marginBottom:20}}>
            {csData.functions.map((fnObj,fi)=>(
              <div key={fi} style={{fontSize:12,color:textS,marginBottom:3}}>{fnLine(fnObj)}</div>
            ))}
          </div>
          {/* Per-function blocks */}
          {csData.functions.map((fnObj,fi)=>(
            <div key={fi} style={{background:isDark?"#12121F":"#fff",borderRadius:14,border:`1px solid ${border}`,marginBottom:20,overflow:"hidden"}}>
              {/* Function header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 20px",background:"linear-gradient(135deg,#1a1a2e,#2d1b69)",color:"#fff"}}>
                <div>
                  <div style={{fontSize:11,color:"#a5b4fc",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Function {fi+1} of {fnCount}</div>
                  <div style={{fontSize:16,fontWeight:700,color:"#C9A96E"}}>{fnLine(fnObj)}</div>
                  {fnObj.fnPax&&<div style={{fontSize:11,color:"#a5b4fc",marginTop:2}}>{fnObj.fnPax} pax</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:"#a5b4fc",textTransform:"uppercase"}}>Function Total</div>
                  <div style={{fontSize:20,fontWeight:700,color:"#C9A96E"}}>{fnObj.isEmpty?"—":fmt(fnObj.grand)}</div>
                </div>
              </div>
              {/* Empty function placeholder */}
              {fnObj.isEmpty?(
                <div style={{padding:"32px 20px",textAlign:"center",color:textS}}>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Design pending</div>
                  <div style={{fontSize:11}}>Zones for this function have not been built yet — it will appear in the PPT as a placeholder slide.</div>
                </div>
              ):(
                <>
                  {/* Zone sections */}
                  {fnObj.zones.map((z,zi)=>(
                    <div key={z.k} style={{borderTop:`1px solid ${border}`}}>
                      {/* Zone header */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 18px",background:isDark?"rgba(201,169,110,0.04)":"#F9F7F3"}}>
                        <div><div style={{fontSize:14,fontWeight:700}}>{z.icon} {z.label}</div>{z.dimLabel&&<div style={{fontSize:11,color:textS,marginTop:2}}>{"📐"} {z.dimLabel}</div>}</div>
                        <div style={{fontSize:16,fontWeight:700,color:accentText}}>{fmt(z.zoneTotal)}</div>
                      </div>
                      {/* Zone photo */}
                      {z.photo&&<div style={{padding:12,background:isDark?"rgba(0,0,0,0.2)":"#FAFAF7"}}>
                        <img src={z.photo} alt={z.photoName} style={{width:"100%",maxHeight:160,objectFit:"cover",borderRadius:10,display:"block"}} onError={e=>{e.target.style.display="none"}}/>
                        {z.photoName&&<div style={{fontSize:10,color:textS,marginTop:6,textAlign:"center"}}>Reference: {z.photoName}</div>}
                      </div>}
                      {/* Structure items (not editable) */}
                      {z.structItems.length>0&&<div style={{padding:"8px 18px",borderTop:`1px solid ${border}`}}>
                        {z.structItems.map((si,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12,color:textS,fontStyle:"italic"}}><span>{si.name}</span><span style={{fontWeight:600}}>{fmt(si.total)}</span></div>)}
                      </div>}
                      {/* Editable items table */}
                      {z.items.length>0&&<div style={{padding:"0 18px 12px",borderTop:`1px solid ${border}`}}>
                        <div style={{display:"grid",gridTemplateColumns:"2.5fr 0.8fr 1fr 1.2fr 1.5fr",gap:0,padding:"8px 0 4px",borderBottom:`1px solid ${border}`,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,color:textS,fontWeight:600}}>
                          <div>Item</div><div style={{textAlign:"center"}}>Size</div><div style={{textAlign:"center"}}>Qty</div><div style={{textAlign:"right"}}>Rate</div><div style={{textAlign:"right"}}>Amount</div>
                        </div>
                        {z.items.map((it,ii)=>(
                          <div key={ii} style={{display:"grid",gridTemplateColumns:"2.5fr 0.8fr 1fr 1.2fr 1.5fr",gap:0,padding:"6px 0",borderBottom:`1px solid ${isDark?"rgba(255,255,255,0.04)":"#F3EDE4"}`,alignItems:"center",fontSize:12}}>
                            <div style={{fontWeight:500}}>{it.name}</div>
                            <div style={{textAlign:"center",color:textS}}>{it.size||"—"}</div>
                            <div style={{textAlign:"center"}}><input type="number" min="0" value={it.qty} onChange={e=>csUpdateQty(fi,zi,ii,parseInt(e.target.value)||0)} style={{width:48,padding:"4px 6px",borderRadius:6,border:`1px solid ${accentText}40`,background:isDark?"#0A0A14":"#FFFDF7",color:isDark?"#fff":"#1a1a2e",fontSize:13,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit"}}/></div>
                            <div style={{textAlign:"right",color:textS,fontSize:11}}>{fmt(it.rate)}/{it.unit}</div>
                            <div style={{textAlign:"right",fontWeight:600,color:it.qty>0?accentText:textS}}>{fmt(it.total)}</div>
                          </div>
                        ))}
                        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0 4px",borderTop:`2px solid ${border}`,marginTop:4}}>
                          <div style={{fontSize:13,fontWeight:700}}>{z.label} Subtotal</div>
                          <div style={{fontSize:15,fontWeight:700,color:accentText}}>{fmt(z.zoneTotal)}</div>
                        </div>
                      </div>}
                      {/* Note */}
                      {z.note&&<div style={{padding:"0 18px 12px"}}><div style={{background:isDark?"rgba(201,169,110,0.06)":"#FFFDF7",borderRadius:8,padding:"8px 12px",fontSize:11,color:accentText}}>{"📝"} {z.note}</div></div>}
                    </div>
                  ))}
                  {/* Per-function transport (read-only). One line, total only — the truck-by-truck
                      breakdown is internal working, and it read badly here anyway ("Carpet —
                      0.0426666666666 trucks"). The full split still lives in Build and Deal Check. */}
                  {fnObj.transport&&(
                    <div style={{borderTop:`1px solid ${border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 18px",background:isDark?"rgba(99,102,241,0.04)":"#F0F4FF"}}>
                        <div style={{fontSize:14,fontWeight:700}}>{"🚛"} Transport & Power</div>
                        <div style={{fontSize:16,fontWeight:700,color:"#4F46E5"}}>{fmt(fnObj.transport.total)}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {/* Event grand total */}
          <div style={{background:"linear-gradient(135deg,#1a1a2e,#2d1b69)",borderRadius:14,padding:"20px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div style={{fontSize:18,fontWeight:700,color:"#fff"}}>Event Grand Total</div>
            <div style={{fontSize:28,fontWeight:700,color:"#C9A96E"}}>{fmt(csData.eventGrandTotal)}</div>
          </div>
          <div style={{textAlign:"center",fontSize:10,color:textS,padding:"8px 0 20px"}}>Edit quantities above — totals update live across all functions. Then export as PDF or PPT.</div>
        </div>
      </div>);
    })()}
  </>);
}

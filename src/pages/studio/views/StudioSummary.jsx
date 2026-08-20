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
import { useState, useEffect, useRef, Fragment } from "react";
import { IconSparkle, IconExcelMark, IconCanvaMark, IconEye, IconRepeat } from "../../../components/icons.jsx";
import { LOGO_ASSET, logoCrop } from "../../../lib/studio/brand.js";
import { getCat, carpetPricingFor } from "../../../lib/studio/taxonomy";
import { makeDeleteClient } from "../../../lib/studio/clientDelete";
import { swatchHexFor, nearestColourName } from "../../../lib/studio/colours";
import { paletteFromPhotos } from "../../../lib/studio/photoPalette";
import { canvaConnectionStatus, canvaCreateImport, canvaPollImport, canvaExportPdfUrl } from "../../../lib/canva";
import { deckImageUrl, isInventoryPhoto } from "../../../lib/studio/thumb";
import { detailShots } from "../../../lib/studio/detailShots";
import { gammaCreateGeneration, gammaPollGeneration } from "../../../lib/gamma";
import { WASH_BANDS, GRAIN_URL } from "../../../lib/studio/pageWash";

// The photograph behind the Total Estimate card. Same glob-not-import reasoning as the panel images
// on the other steps: no file, no layer, and the build still runs — the card simply keeps the plain
// gradient it has always had. Drop one at src/assets/ambria-estimate.jpg to turn it on.
const ESTIMATE_BG = Object.values(
  import.meta.glob("../../../assets/ambria-estimate.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" })
)[0] || null;
import { supabase } from "../../../lib/supabase";
import { callClaudeStreaming } from "../../../lib/ai";

// ═══ AMBRIA'S OWN SLIDE BACKGROUNDS (optional, one per event type) ═══
// Drop an image at src/assets/<event>-bg.(png|jpg|webp) — wedding-bg.jpg, birthday-bg.jpg — and a
// deck for that kind of event is drawn on it, in place of the generated texture. Adding a new one
// is a file, not a code change: the name before "-bg" IS the event type it answers to.
//
// import.meta.glob, not a plain import: a direct import of a file that is not there fails the BUILD,
// which would mean nobody can deploy until the asset exists. A glob resolves to {} instead, so the
// deck simply keeps its generated ground until the file appears.
const BG_ASSETS = import.meta.glob("../../../assets/*-bg.{png,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" });
const BG_BY_EVENT = Object.fromEntries(
  Object.entries(BG_ASSETS).map(([path, url]) => [(path.match(/([^/]+)-bg\.\w+$/) || [, ""])[1].toLowerCase(), url])
);

// ═══ DECK WATERMARK, AND THE COST SHEET'S OWN HEADER ═══
// The Ambria mark: sat quietly in the corner of every design-deck slide, and now also the lockup on
// the cost sheet's toolbar. One asset from lib/studio/brand.js rather than a second glob here — this
// file had its own copy, and the crop numbers the toolbar needs were in a third place again.
// Same glob-not-import reasoning as before: no file, no watermark, deck still builds.

// The artwork can't be dropped onto a slide as-is, for two reasons:
//   1. Its wordmark is WHITE (it's the variant drawn for a dark ground) and every design-deck slide
//      is warm ivory — it would be invisible.
//   2. It's a 4258x2838 canvas whose mark occupies only the middle ~60% x ~27%; the rest is
//      transparent. Placed by its box it would sit nowhere near where the box says it is.
// So: trim to the real ink, recolour it, and fade it, once. source-in is what does the work —
// it keeps the existing alpha and replaces the colour, so the fill's own alpha multiplies through
// and recolour + fade happen in a single pass. Same-origin asset, so the canvas is never tainted.
let watermarkCache = null;
const deckWatermark = (hex, alpha) => {
  if (!LOGO_ASSET) return Promise.resolve(null);
  if (watermarkCache) return watermarkCache;
  watermarkCache = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        // Alpha bounding box. Threshold at 8 rather than 0 so PNG anti-aliasing fringe doesn't
        // report as content and defeat the trim.
        const d = ctx.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 8) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return resolve(null);                 // fully transparent file
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const o = document.createElement("canvas");
        o.width = cw; o.height = ch;
        const octx = o.getContext("2d");
        octx.drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        octx.globalCompositeOperation = "source-in";
        octx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        octx.fillRect(0, 0, cw, ch);
        resolve({ data: o.toDataURL("image/png"), aspect: cw / ch });
      } catch { resolve(null); }                          // a watermark is never worth failing a deck over
    };
    img.onerror = () => resolve(null);
    img.src = LOGO_ASSET;
  });
  return watermarkCache;
};

// Functions that only ever happen INSIDE a wedding. The deck cannot ask what kind of event it is —
// there is no such field, only a list of function types, and the admin can add any type they like
// (Birthday is not in the built-in taxonomy). So the rituals are what get named, and a deal holding
// any of them is a wedding however its other functions are labelled.
const WEDDING_FUNCTIONS = new Set([
  "wedding", "reception", "sangeet", "cocktail", "haldi", "mehendi", "mehndi",
  "baraat", "phera", "pheras", "varmala", "roka", "tilak",
]);

/**
 * What kind of event this deck is for, as a display word: "Wedding", "Birthday", "Corporate".
 *
 * Any wedding ritual in the list means the whole deal is a wedding — a wedding's functions are named
 * Reception and Sangeet, never "Wedding", so matching on the word alone would miss nearly all of
 * them. Otherwise the first function names the event, which is what makes a standalone Birthday or
 * Anniversary come out under its own name without anyone configuring anything.
 */
function eventKindOf(content) {
  const names = (content?.functions || []).map((f) => String(f.name || "").trim()).filter(Boolean);
  if (names.some((n) => WEDDING_FUNCTIONS.has(n.toLowerCase()))) return "Wedding";
  return names[0] || "Wedding";
}

/** The artwork this deck is drawn on: src/assets/<kind>-bg.jpg, falling back to the wedding sheet. */
function customBgFor(kind) {
  return BG_BY_EVENT[String(kind || "").toLowerCase()] || BG_BY_EVENT.wedding || null;
}

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
// Five bursts, not three, and closer together — the cycle below is 8s and with three there was a
// long stretch of nothing between them. Still staggered so no two are ever in the air at once, and
// still spread across the card so it reads as occasional sparkle rather than a shower.
const TE_BURSTS = [
  { cx: 17, cy: 32, col: "#C9A96E", delay: 0.9, n: 16, dist: 52 },
  { cx: 83, cy: 64, col: "#A78BFA", delay: 2.4, n: 14, dist: 46 },
  { cx: 51, cy: 22, col: "#F5E0B7", delay: 3.9, n: 18, dist: 60 },
  { cx: 30, cy: 74, col: "#E8CF9A", delay: 5.3, n: 13, dist: 44 },
  { cx: 69, cy: 30, col: "#C4B5FD", delay: 6.7, n: 15, dist: 50 },
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
  // The full zone/item cost breakdown used to render open by default (expandedSummaryFnIdx starts
  // at 0) — every zone, every element, every price, right under the hero total. That's the same
  // detail "👁 Preview" already surfaces in its own overlay, just permanently on the page too, which
  // read as clutter for a screen whose main job is the headline number and the SOLD button. Hidden
  // by default behind one discreet toggle; expandedSummaryFnIdx still remembers which function was
  // open underneath, so reopening this doesn't reset that.
  const [showSummaryDetails, setShowSummaryDetails] = useState(false);
  // ═══ WHICH ENGINE DESIGNS THE DECK ═══
  // The built-in one. Flip to true and Gamma takes over instead; both paths are kept because the
  // choice has already gone back and forth twice, and neither is wrong in the abstract:
  //
  //   Gamma      designs each deck fresh and varies the composition in ways worth having. But its
  //              API offers one lever — themeId — plus prose it interprets, so background, fonts,
  //              type weight and spacing are all requests rather than instructions. A day of asking
  //              for a title beside the photograph rather than under it did not reliably get one.
  //   Built-in   places every element at fixed coordinates: exact background, fonts, weight,
  //              margins. Identical on every run and ready in seconds instead of minutes — and it
  //              only ever produces what it has been told to, so variety has to be coded.
  //
  // Everything except the rendering is shared: the same content, the same photo grading, the same
  // detail crops. Switching engines changes how it is drawn, never what it says.
  const USE_GAMMA = false;

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
    // step + reset. The 48 individual setters that used to be listed here existed only to feed the
    // inline startNew(); that reset is now startNewDeal on ctx, so they came off with it.
    setStep, setActiveClientId, startNewDeal,
  } = ctx;

  // ═══ THE DECK THIS DEAL ALREADY HAS ═══
  // canvaEditUrl lived in component state alone, so the link died on a reload, on closing the
  // preview, or on switching deal and back — and the button dropped to "Canva", offering to build a
  // second deck when one already existed. Remembered against the CLIENT, so it follows the deal
  // rather than the tab, and so opening someone else's deal never shows this one's link.
  const canvaKey = (id) => `ambria-canva-deck-${id || "none"}`;
  // deckThumb is gone with the "Design deck ready" strip that was the only thing reading it. Its two
  // writers went with it — one restoring a remembered deck, one recording a fresh one. rememberDeck
  // still PERSISTS the thumbnail URL, so nothing about the stored shape changed and a card that wants
  // a cover again has the data waiting.
  // Stored as JSON now that the cover thumbnail is kept beside the link. Decks remembered before
  // this was a JSON blob are a bare URL string, and are still read — a salesperson mid-deal should
  // not lose the link they already have because the shape of the record changed under them.
  // Canva's own id for the design. Kept because the export endpoint wants it and the edit URL is
  // not a reliable place to find it — see canvaDesignId in lib/canva.js.
  const [canvaDeckId, setCanvaDeckId] = useState("");
  // ── "THE DECK IS MADE" HAS TO SURVIVE THE MOMENT IT HAPPENS ──
  // Making a deck takes long enough that nobody watches the button while it runs, so the toolbar
  // quietly gaining two new buttons is a change that lands while you are looking elsewhere. The glow
  // is that news, held until it is acted on rather than shown for a second and lost.
  // Set only when a deck is FRESHLY made, never when one is restored from a previous visit — a deck
  // you already have does not need chasing, and glowing on every page load would train the eye to
  // ignore it. Cleared the moment View deck is pressed, which is the whole point of it.
  const [deckGlow, setDeckGlow] = useState(false);
  const rememberDeck = (url, thumb, designId) => {
    try {
      if (activeClientId && url) localStorage.setItem(canvaKey(activeClientId), JSON.stringify({ url, thumb: thumb || "", designId: designId || "" }));
    } catch { /* private mode */ }
  };
  const readDeck = (id) => {
    let raw = "";
    try { raw = localStorage.getItem(canvaKey(id)) || ""; } catch { /* private mode */ }
    if (!raw) return { url: "", thumb: "", pdf: "", pdfAt: 0, designId: "" };
    if (raw[0] !== "{") return { url: raw, thumb: "", pdf: "", pdfAt: 0, designId: "" };
    try { const o = JSON.parse(raw); return { url: o.url || "", thumb: o.thumb || "", pdf: o.pdf || "", pdfAt: o.pdfAt || 0, designId: o.designId || "" }; }
    catch { return { url: "", thumb: "", pdf: "", pdfAt: 0, designId: "" }; }
  };
  // The exported PDF, kept beside the deck link so opening the viewer a second time is instant.
  // Merged into the existing record rather than written over it — the link and the cover are what
  // the deck actually IS; the export is a cached view of it.
  const rememberDeckPdf = (pdf) => {
    try {
      if (!activeClientId || !pdf) return;
      const cur = readDeck(activeClientId);
      localStorage.setItem(canvaKey(activeClientId), JSON.stringify({ ...cur, pdf, pdfAt: Date.now() }));
    } catch { /* private mode */ }
  };
  // Canva's export URLs are signed and time-limited, so the cache is deliberately short. This is
  // not about surviving days — it is about the second, third and fourth time someone opens the
  // deck in one meeting not costing a 30-to-60 second re-export each time.
  const PDF_CACHE_MS = 15 * 60 * 1000;
  const forgetDeck = () => {
    try { if (activeClientId) localStorage.removeItem(canvaKey(activeClientId)); } catch { /* private mode */ }
  };

  // ═══ THE DECK, SHOWN AND HANDED OVER AS A PDF ═══
  // Canva holds the live version once the deck is imported — anything the salesperson retouches
  // there is in Canva and nowhere else — so the preview is an EXPORT of that design rather than a
  // second rendering of the local build, which would quietly show the client the pre-edit deck.
  //
  // Not fetched on open: an export is a render job Canva bills time for, and the cost sheet is
  // opened constantly for the figures alone. It runs when someone asks to see the deck, and the one
  // export then serves both the preview and the download.
  const [deckPdf, setDeckPdf] = useState({ state: "idle", url: "", error: "" });
  useEffect(() => { setDeckPdf({ state: "idle", url: "", error: "" }); }, [canvaEditUrl]);
  const showDeckPdf = async () => {
    if (deckPdf.state === "loading") return;
    // Cleared here rather than in the button's onClick, so it stops on the ACTION and not merely on a
    // click — the early return above means a click during a load is not an action, and the glow has
    // to survive that or it would be dismissed by an impatient second press.
    setDeckGlow(false);
    // A still-fresh export opens straight away. Without this, viewing the deck twice in a meeting
    // means waiting out Canva's export twice, which is what made this feel like an export button
    // rather than a viewer.
    const cached = readDeck(activeClientId);
    if (cached.pdf && cached.pdfAt && Date.now() - cached.pdfAt < PDF_CACHE_MS) {
      setDeckPdf({ state: "ready", url: cached.pdf, error: "" });
      return;
    }
    setDeckPdf({ state: "loading", url: "", error: "" });
    try {
      const url = await canvaExportPdfUrl(canvaEditUrl, { designId: canvaDeckId || cached.designId });
      rememberDeckPdf(url);
      setDeckPdf({ state: "ready", url, error: "" });
    } catch (e) {
      setDeckPdf({ state: "error", url: "", error: e.message || "Could not export the deck" });
    }
  };
  // Full-screen for showing a client, via the browser's own Fullscreen API rather than a CSS
  // overlay — this panel is already fixed-position, and stacking a second fixed layer inside it
  // fights the scroll container. Ref'd on the wrapper so the toolbar goes full-screen with the
  // page, keeping Download and Close reachable.
  // Which zone cards are open on the cost sheet. Keyed by function index + zone key, because zone
  // keys repeat across functions — a wedding and its reception both have a Vedi / Mandap, and
  // keying on the zone alone opened both at once.
  const [csOpenZones, setCsOpenZones] = useState({});
  const toggleZoneCard = (key) => setCsOpenZones((o) => ({ ...o, [key]: !o[key] }));
  // The cost sheet is a fixed, full-screen panel, but the Studio page underneath stayed scrollable
  // — so the window showed TWO scrollbars, and a wheel that missed the panel scrolled the wrong
  // thing. Locked while it is open, and the previous value is restored rather than assumed to be
  // "visible", so this can't quietly override a lock something else set.
  useEffect(() => {
    if (!csData) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [csData]);
  const deckViewRef = useRef(null);
  // Tracked as state, not read off document at render time: leaving full screen with Esc is a
  // browser action React never hears about, so the frame would keep its full-screen height after
  // the page had already come back.
  const [deckFull, setDeckFull] = useState(false);
  useEffect(() => {
    const onFs = () => setDeckFull(document.fullscreenElement === deckViewRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleDeckFullscreen = () => {
    const el = deckViewRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen?.();
    } catch { /* older browser — the inline viewer still works */ }
  };
  useEffect(() => {
    // Only ever fills IN a remembered link — it must not clear a deck being generated right now.
    if (canvaState !== "idle") return;
    const saved = readDeck(activeClientId);
    if (saved.url) { setCanvaEditUrl(saved.url); setCanvaDeckId(saved.designId || ""); setCanvaState("ready"); }
  }, [activeClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full reset back to a blank deal. The 40-setter body moved to StudioApp as startNewDeal, because
  // the Client Tracker's delete needs the same reset and could not reach a function declared here —
  // it cleared only activeClientId, and the auto-save then re-created the client it had just
  // deleted. One copy on ctx, both call sites use it.
  const startNew = startNewDeal;
  const deleteClient = makeDeleteClient({
    clientLedger, saveClientLedger, eventOrders, activeClientId, setActiveClientId, startNewDeal, askConfirm, showMsg,
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

  // "📊 Excel" — a real cost sheet a client/vendor can open in Excel: one tab per function, every
  // zone's decor items AND structure (truss/masking/platform/carpet/arches/pillars/glass — the same
  // structItems the PPT/PDF already show) broken out line by line, plus transport & genset, plus a
  // final Event Summary tab. Replaces the old "📊 PPT" button in the Cost Sheet preview header.
  const exportExcel = async (combined) => {
    if (!combined) combined = buildCombinedCostSheetData();
    showMsg("Generating Excel...", "blue");
    try {
      if (!window.ExcelJS) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
          s.onload = resolve;
          s.onerror = () => {
            const s2 = document.createElement("script");
            s2.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
            s2.onload = resolve;
            s2.onerror = () => reject(new Error("Excel library unavailable — try again after deployment"));
            document.head.appendChild(s2);
          };
          document.head.appendChild(s);
        });
      }

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

      const gold = "FFC9A96E", dark = "FF1A1A2E", tan = "FF8B7355", subtle = "FFF9F7F3", white = "FFFFFFFF";
      const workbook = new window.ExcelJS.Workbook();
      workbook.creator = "Ambria Decorations";
      workbook.created = new Date(0); // Date.now()/new Date() with no args is unavailable in this
                                       // environment's tooling elsewhere in the session — epoch is fine,
                                       // ExcelJS just needs SOME Date object for the metadata field.
      const COLS = [
        { header: "Item", key: "item", width: 34 },
        { header: "Size", key: "size", width: 12 },
        { header: "Qty", key: "qty", width: 8 },
        { header: "Rate", key: "rate", width: 14 },
        { header: "Unit", key: "unit", width: 10 },
        { header: "Amount", key: "amount", width: 14 },
      ];
      const money = { numFmt: '"₹"#,##0' };
      const usedSheetNames = new Set();
      const sheetNameFor = (fnObj, i) => {
        // Excel sheet names: max 31 chars, no  : \ / ? * [ ] , and must be unique.
        let base = `${i + 1}. ${fnObj.fnType || "Function"}`.replace(/[:\\/?*[\]]/g, "").slice(0, 31);
        let name = base, n = 2;
        while (usedSheetNames.has(name)) { name = `${base.slice(0, 28)} (${n})`; n++; }
        usedSheetNames.add(name);
        return name;
      };

      // Section header row — spans every column, dark fill, bold light text (mirrors the PPT's own
      // section-header bands so the two exports read as the same document).
      const addSectionRow = (ws, text, opts = {}) => {
        const row = ws.addRow([text]);
        ws.mergeCells(row.number, 1, row.number, COLS.length);
        row.getCell(1).font = { bold: true, color: { argb: opts.color || white }, size: opts.size || 11 };
        row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill || dark } };
        row.height = opts.height || 20;
        return row;
      };
      const addTableHeaderRow = (ws) => {
        const row = ws.addRow(COLS.map(c => c.header));
        row.eachCell(c => {
          c.font = { bold: true, color: { argb: white }, size: 10 };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tan } };
          c.alignment = { horizontal: c.value === "Item" ? "left" : "right" };
        });
        return row;
      };
      const addItemRow = (ws, cells, opts = {}) => {
        const row = ws.addRow(cells);
        if (opts.italic) row.eachCell(c => { c.font = { ...(c.font || {}), italic: true }; });
        if (opts.bold) row.eachCell(c => { c.font = { ...(c.font || {}), bold: true }; });
        if (opts.fill) row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } }; });
        row.getCell(6).numFmt = money.numFmt;
        row.getCell(3).alignment = { horizontal: "center" };
        row.getCell(4).alignment = { horizontal: "right" };
        row.getCell(6).alignment = { horizontal: "right" };
        return row;
      };

      combined.functions.forEach((fnObj, i) => {
        const ws = workbook.addWorksheet(sheetNameFor(fnObj, i));
        ws.columns = COLS;
        addSectionRow(ws, `AMBRIA DECORATIONS — ${(combined.clientName || "Client").toUpperCase()}`, { fill: dark, color: gold, size: 13, height: 24 });
        addSectionRow(ws, fnLine(fnObj).toUpperCase(), { fill: "FF2A2A42", color: white });
        ws.addRow([]);

        if (fnObj.isEmpty) {
          ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, COLS.length);
          const row = ws.getRow(ws.rowCount);
          row.getCell(1).value = "Design pending — zones for this function have not been built yet.";
          row.getCell(1).font = { italic: true, color: { argb: "FF808080" } };
          return;
        }

        fnObj.zones.forEach(z => {
          addSectionRow(ws, `${z.label}${z.dimLabel ? "  (" + z.dimLabel + ")" : ""}   —   ${f(z.zoneTotal)}`, { fill: "FFEFE9DD", color: "FF1A1A2E" });
          addTableHeaderRow(ws);
          z.structItems.forEach(si => addItemRow(ws, [si.name, si.size || "—", si.qty ?? "—", si.rate ?? "—", si.unit || "—", si.total], { italic: true }));
          z.items.forEach(it => addItemRow(ws, [it.name, it.size || "—", it.qty, it.rate, it.unit, it.total]));
          addItemRow(ws, [`${z.label} Subtotal`, "", "", "", "", z.zoneTotal], { bold: true, fill: subtle });
          if (z.note) {
            const row = ws.addRow([`📝 ${z.note}`]);
            ws.mergeCells(row.number, 1, row.number, COLS.length);
            row.getCell(1).font = { italic: true, color: { argb: tan } };
          }
          ws.addRow([]);
        });

        if (fnObj.transport) {
          addSectionRow(ws, "TRANSPORT & POWER", { fill: "FF312E81", color: "FFA5B4FC" });
          const row = ws.addRow(["Item", "Details", "", "", "", "Amount"]);
          row.eachCell((c, idx) => { if ([1, 2, 6].includes(idx)) { c.font = { bold: true, color: { argb: white } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } }; c.alignment = { horizontal: idx === 6 ? "right" : "left" }; } });
          // One row for the whole truck count, not one per sub-category — the per-sub-category
          // breakdown (fnObj.transport.breakdown) is a fractional-truck WORKING figure (e.g. a
          // sub-category using 0.00005 of a truck), never individually billed; only the CEILED
          // total (trucks) × trip rate is actually charged (see transportCalc/truckTotal).
          // Listing every sub-category here read as line-item billing for numbers nobody pays.
          const trucks = fnObj.transport.trucks || 0;
          const truckRow = ws.addRow(["Trucks", `${trucks} truck${trucks !== 1 ? "s" : ""} × ${f(fnObj.transport.tripRate)} × 2`, "", "", "", fnObj.transport.truckTotal || 0]);
          truckRow.getCell(6).numFmt = money.numFmt; truckRow.getCell(6).alignment = { horizontal: "right" };
          const gRow = ws.addRow(["Genset", `${fnObj.transport.gensets || 0} units × ${f(fnObj.transport.gensetRate || 0)}`, "", "", "", fnObj.transport.gensetCost || 0]);
          gRow.getCell(6).numFmt = money.numFmt; gRow.getCell(6).alignment = { horizontal: "right" };
          const tRow = ws.addRow(["Transport Total", "", "", "", "", fnObj.transport.total || 0]);
          tRow.eachCell(c => { c.font = { bold: true, color: { argb: "FF4F46E5" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } }; });
          tRow.getCell(6).numFmt = money.numFmt; tRow.getCell(6).alignment = { horizontal: "right" };
          ws.addRow([]);
        }

        addSectionRow(ws, `FUNCTION TOTAL   —   ${f(fnObj.grand)}`, { fill: dark, color: gold, size: 12, height: 22 });
      });

      // ═══ EVENT SUMMARY tab ═══
      const sw = workbook.addWorksheet("Event Summary");
      sw.columns = [
        { header: "Function", key: "fn", width: 20 },
        { header: "Date · Venue", key: "dv", width: 30 },
        { header: "Decor", key: "decor", width: 14 },
        { header: "Transport", key: "transport", width: 14 },
        { header: "Grand", key: "grand", width: 14 },
      ];
      const swRow1 = sw.addRow(["EVENT SUMMARY", "", "", "", ""]);
      sw.mergeCells(1, 1, 1, 5);
      swRow1.getCell(1).font = { bold: true, size: 13, color: { argb: white } };
      swRow1.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark } };
      swRow1.height = 22;
      const swHead = sw.addRow(["Function", "Date · Venue", "Decor", "Transport", "Grand"]);
      swHead.eachCell(c => { c.font = { bold: true, color: { argb: white } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tan } }; });
      combined.functions.forEach(fnObj => {
        const row = sw.addRow([
          fnObj.fnType || "—", `${fmtDate(fnObj.fnDate)} · ${fnObj.fnVenue || "—"}`,
          fnObj.isEmpty ? 0 : (fnObj.decorTotal || 0), fnObj.isEmpty ? 0 : (fnObj.transportTotal || 0), fnObj.isEmpty ? 0 : (fnObj.grand || 0),
        ]);
        [3, 4, 5].forEach(ci => { row.getCell(ci).numFmt = money.numFmt; row.getCell(ci).alignment = { horizontal: "right" }; });
      });
      const gtRow = sw.addRow(["EVENT GRAND TOTAL", "", "", "", combined.eventGrandTotal || 0]);
      sw.mergeCells(gtRow.number, 1, gtRow.number, 4);
      gtRow.getCell(1).font = { bold: true, size: 12, color: { argb: white } };
      gtRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark } };
      gtRow.getCell(5).font = { bold: true, size: 13, color: { argb: gold } };
      gtRow.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark } };
      gtRow.getCell(5).numFmt = money.numFmt;
      gtRow.getCell(5).alignment = { horizontal: "right" };

      // File name: guest name + the earliest function's date + venue — functions are already
      // date-sorted by buildCombinedCostSheetData, so [0] is the earliest.
      const first = combined.functions[0] || {};
      const safe = (s) => String(s || "").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const fileName = ["Ambria_CostSheet", safe(combined.clientName), safe(first.fnDate), safe(first.fnVenue)].filter(Boolean).join("_") + ".xlsx";

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      showMsg("✓ Excel downloaded!", "green");
    } catch (err) {
      console.error("Excel export error:", err);
      showMsg("Excel export failed — " + (err.message || "try again"), "red");
    }
  };

  // Builds the markdown outline Gamma designs from. Sections are separated by "\n---\n" (Gamma's card
  // break, with cardSplit: "inputTextBreaks"), and photos are dropped in as bare URLs for Gamma to
  // fetch and re-host.
  //
  // ═══ THIS IS A DESIGN PRESENTATION, NOT A COST SHEET ═══
  // The client's own words: "why is the costing included? We don't need any costing in this décor
  // design presentation." So no rates, no totals, no transport figures, no summary table — none of it
  // reaches this deck. The cost sheet still exists untouched as the PDF/PPTX export next to it; the
  // two documents simply have different jobs and different audiences.
  //
  // The structure follows Ambria's own reference decks (Gurmon, Raffles, Exotica): cover, an opening
  // line, then per function a divider, a moodboard mixing zones, the palette, an element card per
  // zone carrying callouts, an "Options" card of alternate angles, and a flower story — closing on a
  // thank-you. Also the client's ask: "do not use any external inventory pictures". Warehouse product
  // shots are gone; every image here is a reference photograph of real work.

  const buildDeckContent = async (combined) => {
    const fmtDate = (iso) => {
      if (!iso) return "—";
      try { return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; }
    };
    const fnLine = (fnObj) => {
      const parts = [fnObj.fnType || "Function", fmtDate(fnObj.fnDate), fnObj.fnVenue || "—"];
      if (fnObj.fnShift) parts.push(fnObj.fnShift);
      return parts.filter(Boolean).join(" · ");
    };
    // ═══ AMBRIA'S OWN PHOTOGRAPHY, MATCHED TO THE FUNCTION ═══
    // A card we hand no photo to gets dressed in Gamma's stock theme artwork — a black-and-gold
    // polygon pattern that says nothing about a Reception at Poolside. The library already tags every
    // photo with tags.eventType ("Reception", "Sangeet", "Wedding"…), so a card can carry a real
    // Ambria shot of that same kind of function instead.
    //
    // Same venue ranks first: the client recognises the room they have actually booked. Night/day is
    // the tie-break after that, because a daylight haldi shot behind an evening reception reads wrong
    // even when the event type matches.
    const fnPhotoCache = new Map();
    const libraryPhotosForFunction = async (fnType, venue, shift, limit = 3) => {
      const type = String(fnType || "").trim();
      if (!type) return [];
      const key = `${type}|${venue}|${shift}|${limit}`;
      if (fnPhotoCache.has(key)) return fnPhotoCache.get(key);
      let out = [];
      try {
        // JSON.stringify, not a bare array. postgrest-js turns an array argument into a Postgres array
        // literal (cs.{Reception}), which a jsonb column rejects outright with "invalid input syntax
        // for type json". A string is passed through as-is, giving the cs.["Reception"] this needs.
        const { data, error } = await supabase
          .from("library").select("url,tags").contains("tags->eventType", JSON.stringify([type])).limit(60);
        if (!error && data?.length) {
          const v = String(venue || "").trim().toLowerCase();
          const wantNight = /night|evening/i.test(String(shift || ""));
          const rank = (r) => {
            const t = r.tags || {};
            const venueHit = String(t.venue || "").trim().toLowerCase() === v && v ? 2 : 0;
            const times = Array.isArray(t.timeSetting) ? t.timeSetting.join(" ") : String(t.timeSetting || "");
            const timeHit = wantNight === /night/i.test(times) ? 1 : 0;
            return venueHit + timeHit;
          };
          out = [...data].sort((a, b) => rank(b) - rank(a))
            .map((r) => r.url).filter((u) => u && !String(u).startsWith("data:") && !isInventoryPhoto(u)).slice(0, limit);
        }
      } catch { /* a deck without a matched photo is still a deck — never block the export */ }
      fnPhotoCache.set(key, out);
      return out;
    };

    // ═══ READ THE REFERENCE IMAGES ═══
    // "Detailed callouts highlighting the key design elements visible within each reference image" and
    // "a flower story that complements the selected references". Both have to come from what is
    // actually IN the photograph, so the photographs are what gets sent — one batched vision call for
    // the whole deck rather than one per card, which would multiply an already slow export.
    //
    // Everything here is best-effort. A failed or slow vision call must degrade to the designer's own
    // zone note, never block the deck: a presentation without callouts still beats no presentation.
    const readReferences = async (shots, paletteName) => {
      const empty = { callouts: {}, flowerStory: "", score: {} };
      if (!shots.length) return empty;
      try {
        const blocks = [];
        shots.forEach((s) => {
          blocks.push({ type: "text", text: `IMAGE ${s.id} — ${s.label}` });
          blocks.push({ type: "image", source: { type: "url", url: s.url } });
        });
        blocks.push({ type: "text", text:
          `You are a senior décor designer at Ambria writing a client presentation.\n\n` +
          `For EACH image above, look at what is actually there and write 3 short callouts naming the ` +
          `key design elements you can see — the structure, the florals, the fabric, the lighting, the ` +
          `props. Name what is visible; never invent an element that is not in the frame. Each callout ` +
          `is a fragment of at most 6 words, title case, no trailing full stop. For example ` +
          `"Cascading orchid canopy", "Brushed gold frame", "Warm uplighting through drapes".\n\n` +
          `Then write a FLOWER STORY: 2 or 3 sentences on the floral language running through these ` +
          `references${paletteName ? `, sitting with the "${paletteName}" palette` : ""} — the varieties ` +
          `visible, how they carry across the zones, the mood they build. Warm and confident, written ` +
          `for the client, not a list.\n\n` +
          // Which photographs are worth putting in front of a client. The library holds work of very
          // uneven quality — phone snaps, half-lit rooms, and a number carrying ANOTHER studio's
          // watermark — and the deck was taking them in whatever order the zones happened to be in.
          // One bad photograph on the cover undoes the whole document, so the same pass that reads
          // them also grades them, and the best ones get the positions that matter.
          `Finally, SCORE each image 1-5 on how well it would sell this work to a client — ` +
          `composition, lighting, how finished the décor looks, and whether the frame is clean. ` +
          `Score 1 if it carries a visible watermark or logo belonging to another company, is badly ` +
          `lit or blurred, or shows an unfinished setup with crew, boxes or cabling in frame. ` +
          `Score 5 only for a photograph you would put on the cover.\n\n` +
          `Reply with ONLY this JSON, no prose around it:\n` +
          `{"callouts":{"<image id>":["...","...","..."]},"flowerStory":"...","score":{"<image id>":4}}` });

        const raw = await callClaudeStreaming({ contentBlocks: blocks, maxTokens: 1800 });
        // The model is asked for bare JSON, but a stray ```json fence costs nothing to survive.
        const m = String(raw || "").match(/\{[\s\S]*\}/);
        if (!m) return empty;
        const parsed = JSON.parse(m[0]);
        return { callouts: parsed.callouts || {}, flowerStory: String(parsed.flowerStory || ""), score: parsed.score || {} };
      } catch { return empty; }
    };

    // ── Every reference photo in the deck, gathered FIRST ──
    // The vision pass is one call for the whole deck, so the shots have to be known before any card is
    // written. Ids are stable strings the model echoes back in its JSON.
    const shots = [];
    const zonesByFn = new Map();
    for (const fnObj of combined.functions) {
      const list = (fnObj.zones || []).filter((z) => z.photo && !String(z.photo).startsWith("data:") && !isInventoryPhoto(z.photo));
      zonesByFn.set(fnObj, list);
      list.forEach((z, i) => shots.push({ id: `${fnObj.fnIdx ?? combined.functions.indexOf(fnObj)}-${i}`, label: `${fnObj.fnType || "Function"} · ${z.label}`, url: deckImageUrl(z.photo, 1200, 900), zone: z, fnObj }));
    }
    const paletteName = combined.functions.map((x) => x.palette).find(Boolean) || "";
    const read = await readReferences(shots.slice(0, 12), paletteName);

    // ── BEST PHOTOGRAPH FIRST ──
    // The deck used to take zone photos in whatever order the zones were built, so the cover was
    // decided by which zone someone happened to configure first. The vision pass grades every
    // reference (see readReferences), and those grades now decide the positions that carry the
    // deck: the cover, each function's divider, and the mood boards. Ungraded photos sit at 3, a
    // neutral middle, so a failed vision call changes the order but never empties the deck.
    const scoreOf = (photoUrl) => {
      const shot = shots.find((x) => x.zone?.photo === photoUrl);
      const raw = shot ? Number(read.score?.[shot.id]) : NaN;
      return Number.isFinite(raw) ? raw : 3;
    };
    const bestFirst = (urls) => [...urls].sort((a, b) => scoreOf(b) - scoreOf(a));

    // shots[].url is the pre-sized copy the vision call was given; the RAW photo is what the deck
    // needs, so it can be cropped to whichever box it lands in.
    const rankedAll = bestFirst(shots.map((x) => x.zone.photo));
    const [fallbackPic] = rankedAll.length ? [rankedAll[0]]
      : (await libraryPhotosForFunction(combined.functions[0]?.fnType, combined.functions[0]?.fnVenue, combined.functions[0]?.fnShift, 1));

    const fns = [];
    for (const fnObj of combined.functions) {
      const zones = zonesByFn.get(fnObj) || [];
      const rankedFn = bestFirst(zones.map((z) => z.photo));
      const [libPic] = rankedFn.length ? [rankedFn[0]]
        : await libraryPhotosForFunction(fnObj.fnType, fnObj.fnVenue, fnObj.fnShift, 1);

      // Mood board: one photo per zone, across DIFFERENT zones, topped up from the library when the
      // build is thin — three photos is the minimum that reads as a board rather than a snapshot.
      //
      // ZONE ORDER, not score order. These photos were ranked best-first, while the caption beneath
      // listed the zone labels in the order the zones were built — so the labels described the wrong
      // pictures. Order is the zones' own order wherever order is VISIBLE; the grading still decides
      // the single picks where order does not exist (the cover, the function's hero).
      const boardZones = zones.slice(0, 3);
      const board = boardZones.map((z) => z.photo);
      const boardLabels = boardZones.map((z) => z.label).filter(Boolean);
      if (board.length < 3) {
        const extra = await libraryPhotosForFunction(fnObj.fnType, fnObj.fnVenue, fnObj.fnShift, 3 - board.length);
        extra.forEach((u) => { if (!board.includes(u)) board.push(u); });
      }

      // Palette. Two things were wrong here and both showed on the card.
      //
      // swatchHexFor's signature is (name, colourCatalogue, override) — called with the name alone it
      // never sees the catalogue and falls through to its "#cccccc" sentinel. That is why the card
      // read "Navy Blue" over a grey slab. buildPptx has always passed the catalogue; this now does
      // the same.
      //
      // And a palette is not its NAME split on punctuation. "Navy Blue" is one palette whose anchor
      // colours live in imsPaletteCatalogue — splitting the label gave one entry, so the card showed a
      // single colour stretched across the slide. The anchors are what the designer actually chose.
      const paletteObj = (imsPaletteCatalogue || []).find((p) => p.name === fnObj.palette);
      const anchorNames = paletteObj?.anchorColours?.length ? paletteObj.anchorColours
        : String(fnObj.palette || "").split(/[,&/]+/).map((s) => s.trim()).filter(Boolean);
      // "#cccccc" IS the not-found sentinel, so anything landing on it is dropped rather than shown
      // as a grey block captioned with a colour it isn't.
      let palette = anchorNames.slice(0, 6)
        .map((n) => ({ name: n, hex: String(swatchHexFor(n, imsColourCatalogue) || "").replace("#", "").trim().toLowerCase() }))
        .filter((c) => /^[0-9a-f]{6}$/.test(c.hex) && c.hex !== "cccccc");

      // Nothing usable? Read the colours off the photographs instead of dropping the slide.
      //
      // The palette field defaults to the literal string "Custom", which matches no catalogue entry
      // and no colour name, so it filtered down to nothing — and since the slide needs two swatches,
      // every deck where nobody picked a palette went out with no colour story at all. Which was
      // most of them.
      //
      // Sampled colours are also the truer slide: they are the colours of the décor being proposed,
      // rather than a dropdown value chosen once and never revisited.
      if (palette.length < 2) {
        const sampled = await paletteFromPhotos([...board, ...zones.map((z) => z.photo)], 5);
        if (sampled.length >= 2) {
          palette = sampled.map((hex) => ({ name: nearestColourName(hex, imsColourCatalogue) || "", hex }));
        }
      }

      const zoneCards = [];
      for (const z of zones) {
        const shot = shots.find((s) => s.zone === z);
        const ai = (shot && read.callouts[shot.id]) || [];
        const callouts = (Array.isArray(ai) ? ai : []).map((c) => String(c).trim()).filter(Boolean).slice(0, 3);
        // Two or three close details cut out of THIS zone's own photograph and hosted, to sit beside
        // it — see detailShots. Not other photographs of the same element: those were the Options
        // cards, and a detail of the very picture beside it reads as a designer's study rather than
        // as more stock. Best-effort: an empty list just leaves the card as the photograph alone.
        // Two, as line drawings: they sit in the empty half of the zone card, where a second
        // photograph would compete with the first. A sketch of the same décor reads as the
        // designer's hand beside the photograph rather than as more evidence.
        const details = await detailShots(z.photo, 2, "sketch");
        zoneCards.push({ label: z.label, photo: z.photo, callouts, note: String(z.note || "").trim(), details });
      }

      fns.push({
        name: String(fnObj.fnType || "Function"),
        // The references lead a function with the VENUE set large ("Gurmon Hotel") and the function
        // itself as the italic line beneath it, so both are carried separately.
        venueLine: String(fnObj.fnVenue || fnObj.fnType || "Function"),
        dateLine: [String(fnObj.fnType || ""), fmtDate(fnObj.fnDate), fnObj.fnShift].filter(Boolean).join("  ·  "),
        hero: libPic || fallbackPic || "",
        board, boardLabels, palette, zones: zoneCards,
        // "Custom" is the field's DEFAULT, not a choice — titling the slide with it puts a piece of
        // form plumbing in front of the client. Blank falls through to "Colour Story".
        paletteName: /^custom$/i.test(String(fnObj.palette || "").trim()) ? "" : String(fnObj.palette || ""),
      });
    }

    return {
      clientName: combined.clientName || "",
      cover: fallbackPic || "",
      functions: fns,
      flowerStory: read.flowerStory || "",
    };
  };


  // ═══ THE OUTLINE GAMMA DESIGNS FROM ═══
  // The same `content` the built-in deck uses — photos, callouts read off the references, palette,
  // flower story — rendered as Gamma's markdown instead of placed on slides. Sections are separated
  // by "\n---\n", which is its card break under cardSplit:"inputTextBreaks", and photos go in as bare
  // URLs for it to fetch. Sized on the way out: Gamma lays out whatever shape it is handed, and raw
  // camera uploads in mixed orientations are what made the earlier decks look like a contact sheet.
  const buildGammaOutline = (content) => {
    // 2200 wide at quality 92. Gamma FETCHES these by URL and re-hosts them, so a larger render
    // costs nothing at the Canva end — unlike the built-in deck, where the bytes travel inside the
    // file. 1600 at q85 went visibly soft whenever Gamma scaled a photo up to fill a card.
    const img = (u, w = 2200, h = 1238) => (u ? deckImageUrl(u, w, h, 92) : "");
    const S = [];

    const kind = eventKindOf(content);

    S.push([`# ${content.clientName || "Your"} ${kind}`, "DECOR PRESENTATION", "Ambria Design & Decor",
      img(content.cover), content.functions.map((f) => [f.name, f.dateLine].filter(Boolean).join(" · ")).join("\n")]
      .filter(Boolean).join("\n\n"));

    S.push(`# Design Your ${kind}\n\nEvery ${kind.toLowerCase()} is a unique chapter, and we are here to make sure the decor comes out exactly as you imagined it.\n\nAmbria Design & Decor`);

    for (const f of content.functions) {
      S.push([`# ${String(f.venueLine || f.name).toUpperCase()}`, img(f.hero), f.dateLine].filter(Boolean).join("\n\n"));

      if (f.board.length) {
        S.push([`# ${f.name} — Mood Board`, ...f.board.map((u) => img(u)),
          (f.boardLabels || []).join("  ·  ")].filter(Boolean).join("\n\n"));
      }

      if (f.palette.length >= 2) {
        S.push([`# The Palette`, f.paletteName || "",
          f.palette.map((c) => `${c.name} — #${c.hex}`).join("\n\n"),
          `The colour story running through every zone of the ${f.name}.`].filter(Boolean).join("\n\n"));
      }

      for (const z of f.zones) {
        // The whole photograph first, then its details — Gamma is told to keep source order, so the
        // hero leads and the details follow it into the column beside. The callouts are the point of
        // this card: they are what was read off this photograph.
        const lines = (z.callouts || []).filter(Boolean).slice(0, 3).join("\n\n");
        const detail = (z.details || []).slice(0, 3).map((u) => img(u, 900, 1200)).join("\n\n");
        S.push([`# ${z.label}`, img(z.photo), detail, lines, z.note].filter(Boolean).join("\n\n"));
      }
    }

    if (content.flowerStory) {
      S.push([`# The Flower Story`, img(content.functions[0]?.board?.[0] || content.cover), content.flowerStory]
        .filter(Boolean).join("\n\n"));
    }

    S.push("# Thank You\n\nWe would love to bring this design to life for you.\n\nAmbria Design & Decor\n\nPushpanjali, Bijwasan, New Delhi · thefusiondecor.com");
    return S.join("\n---\n");
  };

  // ═══ THE BUILT-IN DECK — kept, not deleted (see USE_GAMMA) ═══
  // Places every element at fixed coordinates with the PptxGenJS already loaded for the cost sheet.
  // Ambria's reference decks are photographs placed as cards on a dark ground with deep space around
  // them, and this reproduces that exactly; it is the fallback if Gamma's output is not wanted again.
  const SLIDE_W = 13.333, SLIDE_H = 7.5;                 // 16:9 at 96dpi — see defineLayout below
  // ═══ TYPE ═══
  // A .pptx stores font NAMES, not fonts — whatever opens it substitutes anything it does not have.
  // This deck's destination is Canva, and Canva carries both of these, so that is what they are
  // chosen against. Georgia and Trebuchet were the safe pair; safe is not the same as good.
  //
  // Playfair Display: a high-contrast display serif, thick-to-thin, the register the reference decks
  // are set in. Montserrat: a geometric sans that holds up at 10pt in letter-spaced caps, which is
  // what the small labels are.
  //
  // The fallbacks matter for anyone opening the file in PowerPoint rather than Canva. PptxGenJS takes
  // one name per run, so the fallback is stated here rather than in a CSS-style stack: Georgia and
  // Trebuchet remain the substitutes a Windows machine will land on by itself.
  //
  // DISPLAY carries the headings — Cinzel Decorative, a Roman-inscription face with flourished caps.
  // It is a display font in the strict sense: right for six words on a cover, wrong for a paragraph,
  // which is why the supporting lines stay in Playfair rather than following the headings across.
  // Canva has it; PowerPoint on a bare Windows machine does not and will substitute.
  const SERIF = "Playfair Display", SANS = "Montserrat", DISPLAY = "Cinzel Decorative";

  // ═══ TWO GROUNDS, ALTERNATING ═══
  // Every card on one near-black ground made the deck oppressive by the third page — the photographs
  // had nothing to sit against and the whole thing read as a single dark block. The chapter cards
  // (cover, function opening, flower story, close) stay dark, and the working cards (mood board,
  // palette, elements, options) sit on a warm ivory. The alternation is what gives a deck rhythm.
  //
  // INK is warm rather than pure black (a hint of brown in it), which stops the dark cards looking
  // like switched-off screens next to the ivory.
  // Warm stone and warm sand, both a long way from black — the ground is a TEXTURE built on these
  // (see makeGround), not a flat fill.
  const INK = "2A2320", IVORY = "EFE7DA";
  const GOLD = "D2AC47";                                 // on the dark ground
  const GOLD_DK = "9C7A22";                              // on ivory, where D2AC47 is too pale to read
  const CREAM = "F5EFE6", BODY_DK = "3A342E", MUTE_D = "8C8C86", MUTE_L = "7A736A";

  const buildDesignDeck = async (content) => {
    // Decided once: it picks both the artwork and the words on the cover, and the two disagreeing
    // would be worse than either being wrong — pink balloons under "DESIGN YOUR WEDDING".
    const kind = eventKindOf(content);
    if (!window.PptxGenJS) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js";
        s.onload = resolve;
        s.onerror = () => {
          const s2 = document.createElement("script");
          s2.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
          s2.onload = resolve;
          s2.onerror = () => reject(new Error("Presentation library unavailable — try again"));
          document.head.appendChild(s2);
        };
        document.head.appendChild(s);
      });
    }
    const pptx = new window.PptxGenJS();
    // NOT the built-in "LAYOUT_16x9" — that one is 10 x 5.625 INCHES, while every coordinate below is
    // written against 13.333 x 7.5 (16:9 at 96dpi, what PowerPoint and Canva actually use). Setting
    // the built-in put every element at 133% of the slide, so photographs ran off the right and bottom
    // edges of almost every page and the palette became one giant slab. The layout is declared here so
    // the numbers below mean what they say.
    pptx.defineLayout({ name: "AMBRIA_16x9", width: SLIDE_W, height: SLIDE_H });
    pptx.layout = "AMBRIA_16x9";
    // ═══ THE GROUND IS A TEXTURE, NOT A FILL ═══
    // A flat colour behind everything is what made the deck read as a slab. This paints the ground on
    // a canvas instead: the base tone, a few very soft mottled washes so the light moves across the
    // card the way it does on paper or stone, and a fine grain over the top. Then a vignette, barely
    // there, so the edges settle and the middle lifts.
    //
    // Deliberately restrained — at 6% opacity per wash and ±4 levels of grain this reads as "not
    // flat" rather than as a pattern. Anything stronger competes with the photographs, which are the
    // point of the deck.
    //
    // Generated once per deck and reused on every slide of that ground, as a JPEG: a full-bleed PNG
    // per slide is what killed the Canva import with HTTP 546.
    const makeGround = (hex, light) => {
      try {
        const W = 1400, H = 788;                       // 16:9, plenty for a projected slide
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d");
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, W, H);

        // Soft mottling — a handful of wide, very faint blooms, lighter and darker than the base.
        const blooms = [[0.18, 0.22, 0.55], [0.78, 0.30, 0.48], [0.42, 0.80, 0.60], [0.90, 0.86, 0.40], [0.06, 0.72, 0.42]];
        blooms.forEach(([bx, by, br], i) => {
          const up = i % 2 === 0;
          const d = light ? (up ? 16 : -12) : (up ? 14 : -10);
          const grad = ctx.createRadialGradient(bx * W, by * H, 0, bx * W, by * H, br * W);
          grad.addColorStop(0, `rgba(${r + d},${g + d},${b + d},0.06)`);
          grad.addColorStop(1, `rgba(${r + d},${g + d},${b + d},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        });

        // Grain. Per-pixel on the ImageData rather than thousands of tiny fills — same look, and it
        // does not stall the export.
        // ═══ JALI ═══
        // The lattice screen Ambria builds arches and entry props out of — it is in half the
        // reference photographs, so as a ground motif it belongs to this studio rather than being
        // decoration borrowed from a template.
        //
        // Drawn large and faint: an ogee grid struck as two sets of 45° lines with a small diamond at
        // each crossing. At 5% gold it is something you notice on the second look, which is the most
        // a background may ask for when photographs are the subject.
        const GOLD_RGB = light ? "150,120,52" : "210,172,71";
        const step = 108;
        ctx.save();
        ctx.strokeStyle = `rgba(${GOLD_RGB},${light ? 0.055 : 0.05})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let x = -H; x < W + H; x += step) {
          ctx.moveTo(x, 0); ctx.lineTo(x + H, H);          // "/" run
          ctx.moveTo(x, H); ctx.lineTo(x + H, 0);          // "\" run
        }
        ctx.stroke();
        // A diamond at every crossing, which is what makes it read as jali rather than as graph paper.
        ctx.fillStyle = `rgba(${GOLD_RGB},${light ? 0.07 : 0.06})`;
        const d = 7;
        for (let gy = 0; gy <= H + step; gy += step) {
          for (let gx = -step; gx <= W + step; gx += step) {
            const ox = ((gy / step) % 2) * (step / 2);     // offset alternate rows onto the crossings
            ctx.beginPath();
            ctx.moveTo(gx + ox, gy - d); ctx.lineTo(gx + ox + d, gy);
            ctx.lineTo(gx + ox, gy + d); ctx.lineTo(gx + ox - d, gy);
            ctx.closePath(); ctx.fill();
          }
        }
        ctx.restore();

        const img = ctx.getImageData(0, 0, W, H);
        const px = img.data;
        for (let i = 0; i < px.length; i += 4) {
          const n = (Math.random() * 9 | 0) - 4;
          px[i] += n; px[i + 1] += n; px[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);

        const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.78);
        vig.addColorStop(0, "rgba(0,0,0,0)");
        vig.addColorStop(1, light ? "rgba(120,100,74,0.10)" : "rgba(0,0,0,0.22)");
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);

        return cv.toDataURL("image/jpeg", 0.82);
      } catch { return null; }                          // no canvas — fall back to the flat colour
    };
    // Ambria's artwork wins over the generated texture when it exists. Fetched once and inlined,
    // because PptxGenJS needs the bytes rather than a URL for a slide background, and the same data
    // is shared by every slide rather than embedded per card.
    const customGround = await (async () => {
      const bgUrl = customBgFor(kind);
      if (!bgUrl) return null;
      try {
        const resp = await fetch(bgUrl);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result || "") || null);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      } catch { return null; }
    })();
    // The artwork carries its own bracket corners, so ours would double up and read as a mistake.
    // Our gold brackets and frame, drawn UNLESS the artwork already carries a border of its own —
    // two frames read as a mistake. Which artwork does is a property of the image, not something
    // that can be worked out from it, so the ones that come framed are named here. A plain texture
    // (the wedding toile) still gets the frame, or the slides lose their edge entirely.
    const FRAMED_BACKGROUNDS = new Set(["birthday"]);
    const ornament = !customGround || !FRAMED_BACKGROUNDS.has(String(kind).toLowerCase());

    const groundDark = makeGround(INK, false);
    const groundLight = makeGround(IVORY, true);

    // One background for both masters when the artwork is supplied: it is a single designed sheet, and
    // alternating it with anything else would break the thing that makes a deck feel bound.
    pptx.defineSlideMaster({ title: "AMBRIA_DARK", background: customGround ? { data: customGround } : groundDark ? { data: groundDark } : { color: INK } });
    pptx.defineSlideMaster({ title: "AMBRIA_LIGHT", background: customGround ? { data: customGround } : groundLight ? { data: groundLight } : { color: IVORY } });

    // Slides carry their own palette so nothing has to remember which ground it is on. `t` is the one
    // that changes per slide; every colour below reads from it.
    const DARK = { head: CREAM, body: CREAM, accent: GOLD, mute: MUTE_D, shadow: "000000", shadowOpacity: 0.75 };
    const LIGHT = { head: BODY_DK, body: BODY_DK, accent: GOLD_DK, mute: MUTE_L, shadow: "6B5F52", shadowOpacity: 0.62 };
    // EVERY slide is light. The deck alternated dark chapter cards against light working ones for
    // rhythm, but the dark ones are gone: on the warm sand ground the photographs carry the contrast
    // by themselves, and a deck that never goes dark prints and projects more predictably.
    //
    // The dark master and palette stay defined — the alternation is a two-line change to bring back,
    // and it has already been asked for once in each direction.
    // Prepared once, before any slide exists, because newSlide() is synchronous and every slide
    // needs it. GOLD_DK, not GOLD — the pale gold reads on the dark ground and vanishes on ivory,
    // which is the only ground this deck actually uses. 0.42 alpha: present on a second look,
    // never competing with the photographs.
    const watermark = await deckWatermark(GOLD_DK, 0.42);
    // Bottom-right, in the margin. Checked against every placement in this deck — nothing else
    // reaches past x:11.4 / y:6.3, so it sits in genuinely empty space on every slide rather than
    // over a photograph. Width is fixed and the height follows the trimmed artwork's own aspect,
    // so the mark can never be stretched.
    const WM_W = 1.15;
    const stampWatermark = (slide) => {
      if (!watermark) return;
      const h = WM_W / watermark.aspect;
      slide.addImage({ data: watermark.data, x: SLIDE_W - WM_W - 0.5, y: SLIDE_H - h - 0.42, w: WM_W, h });
    };

    let t = LIGHT;
    const newSlide = () => {
      t = LIGHT;
      const slide = pptx.addSlide({ masterName: "AMBRIA_LIGHT" });
      stampWatermark(slide);
      return slide;
    };

    // A photograph is a CARD on the ground, never a full-bleed background — the thing that makes the
    // reference decks read the way they do: space, a few photographs placed in it, gold serif naming
    // them. Filling the slide edge to edge produces something much louder and quite unlike them.
    //
    // The crop is asked for at the EXACT proportions of the box, then placed 1:1. Cropping to 16:9 up
    // front and letting PptxGenJS "cover" it into a taller box cropped twice, which enlarged the photo
    // and cut its subject away — the zoomed look. Supabase renders it once, at the right shape.
    //
    // The lift is a shape sitting directly behind the photograph, carrying the shadow. PptxGenJS
    // renders shadows reliably on SHAPES; putting one on an image is far less dependable across
    // PowerPoint, Keynote and Canva's importer. A plate behind it works everywhere, and doubles as a
    // hairline edge where the photograph meets the ground.
    const PX = 150;                                        // render pixels per inch — sharp when projected
    // Keyed by URL *and* box, because the same photograph appears in boxes of different shapes (the
    // mood board plate is wide, the flower-story plate is tall). A single entry per URL would hand
    // PptxGenJS a data URI of the wrong aspect and it would stretch it to fit.
    const rounded = new Map();
    const rkey = (url, w, h, g) => url + "|" + w.toFixed(2) + "x" + h.toFixed(2) + "|" + g;
    const card = (slide, url, x, y, w, h) => {
      if (!url || isInventoryPhoto(url)) return false;      // see isInventoryPhoto — the client's rule, enforced
      try {
        // A MOUNT, not just a backing plate: it sits proud of the photograph on all four sides, so
        // the white edge and its gold stroke read as a mat around the image the way a framed print
        // does. The plate used to be exactly the image's size, which meant the stroke was hidden
        // underneath it and only the shadow showed.
        //
        // roundRect, not rect: the mount's corners have to follow the photograph's, or a square
        // shadow shows through the rounded corner as four dark triangles.
        const MAT = 0.075;
        slide.addShape(pptx.ShapeType.roundRect, {
          x: x - MAT, y: y - MAT, w: w + MAT * 2, h: h + MAT * 2, rectRadius: 0.12,
          fill: { color: "FFFFFF" },
          line: { color: t.accent, width: 1.25, transparency: 35 },
          // Heavier than it was: a deeper, softer drop so the photographs sit above the ground rather
          // than on it. Dropped straight down (angle 90) so every plate on a card agrees.
          shadow: { type: "outer", color: t.shadow, opacity: t.shadowOpacity, blur: 26, offset: 10, angle: 90 },
        });
        const src = rounded.get(rkey(url, w, h, IVORY)) || deckImageUrl(url, Math.round(w * PX), Math.round(h * PX));
        slide.addImage(src.startsWith("data:") ? { data: src, x, y, w, h } : { path: src, x, y, w, h });
        return true;
      } catch { return false; }
    };
    // The gold italic serif that labels each photograph in the references.
    const label = (slide, text, x, y, w, size = 13) =>
      slide.addText(text, { x, y, w, h: 0.34, fontFace: SERIF, fontSize: size, color: t.accent, italic: true });
    const rule = (slide, x, y, w) =>
      slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.02, fill: { color: t.accent } });

    // ═══ DECORATIVE MARKS ═══
    // Small gold detailing, used sparingly. The references carry almost none, so this stays to a
    // diamond marking a title, corner brackets framing a chapter card, and a numeral in the corner.
    const diamond = (slide, x, y, size = 0.11) =>
      slide.addShape(pptx.ShapeType.diamond, { x, y, w: size, h: size, fill: { color: t.accent } });

    // Brackets rather than a full border: a complete frame boxes the card in and fights the
    // photograph, while four corners suggest one and leave the space open.
    const corners = (slide, inset = 0.42, len = 0.62) => {
      const w = 0.014, c = t.accent, x0 = inset, y0 = inset;
      const x1 = SLIDE_W - inset, y1 = SLIDE_H - inset;
      const seg = (x, y, ww, hh) => slide.addShape(pptx.ShapeType.rect, { x, y, w: ww, h: hh, fill: { color: c } });
      seg(x0, y0, len, w); seg(x0, y0, w, len);                          // top-left
      seg(x1 - len, y1 - w, len, w); seg(x1 - w, y1 - len, w, len);      // bottom-right
    };

    // A hairline rectangle just inside the card edge. On its own it would box the card in, which is
    // why the corners exist — together they read as a plate: the frame holds the space, the corners
    // weight two of its four sides. Gold at this width is a line, not a border.
    const frame = (slide, inset = 0.30) =>
      slide.addShape(pptx.ShapeType.rect, {
        x: inset, y: inset, w: SLIDE_W - inset * 2, h: SLIDE_H - inset * 2,
        fill: { type: "none" }, line: { color: t.accent, width: 0.5, transparency: 55 },
      });

    // Three diamonds on a rule — the divider the reference decks use between a title and what follows.
    // Small enough to be an ornament rather than an element in its own right.
    const flourish = (slide, cx, y) => {
      const s = 0.075, gap = 0.16, armW = 0.5;
      slide.addShape(pptx.ShapeType.rect, { x: cx - gap - armW - 0.06, y: y + s / 2 - 0.005, w: armW, h: 0.01, fill: { color: t.accent } });
      slide.addShape(pptx.ShapeType.rect, { x: cx + gap + 0.06, y: y + s / 2 - 0.005, w: armW, h: 0.01, fill: { color: t.accent } });
      [-gap, 0, gap].forEach((dx) =>
        slide.addShape(pptx.ShapeType.diamond, { x: cx + dx - s / 2, y, w: s, h: s, fill: { color: t.accent } }));
    };

    let pageNo = 0;
    const folio = (slide) => {
      pageNo += 1;
      slide.addText(String(pageNo).padStart(2, "0"), {
        x: SLIDE_W - 1.05, y: SLIDE_H - 0.68, w: 0.5, h: 0.3,
        fontFace: SANS, fontSize: 9, color: t.mute, align: "right", charSpacing: 1,
      });
    };

    const M = 0.85;                    // the margin every card and title block sits on
    const CONTENT_W = SLIDE_W - M * 2;

    // ═══ ROUNDED CORNERS ═══
    // PowerPoint has no border-radius for a picture, and PptxGenJS's `rounding` option crops to a
    // full CIRCLE, not a rounded rectangle. So the corners are cut into the pixels: the photograph is
    // drawn onto a canvas through a rounded-rect clip and handed to the deck as a data URI.
    //
    // This works because Supabase Storage answers with Access-Control-Allow-Origin: *, so the canvas
    // is not tainted and toDataURL is allowed. PNG, because JPEG cannot carry the transparent corners
    // and would fill them white — which on the dark cards would show as four bright notches.
    //
    // Every photograph is rounded ONCE, up front, keyed by URL, so a photo used on two cards is not
    // fetched and redrawn twice.
    // JPEG on the slide's own ground colour — NOT a transparent PNG.
    //
    // PNG was the obvious way to carry rounded corners, and it is what killed the export: a PNG of a
    // photograph runs to several megabytes where the JPEG is a couple of hundred kilobytes, so a deck
    // of a dozen plates grew large enough that the canva Edge Function was killed decoding it and
    // returned HTTP 546, Supabase's resource-limit status.
    //
    // The transparency was never actually needed. Each photograph sits on a known ground, so painting
    // the corners in that exact colour is indistinguishable from cutting them out — and it lets the
    // canvas be flattened to JPEG. The ground travels with the job for that reason.
    const roundCorners = (url, wIn, hIn, ground) => new Promise((resolve) => {
      const px = { w: Math.round(wIn * PX), h: Math.round(hIn * PX) };
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const cv = document.createElement("canvas");
          cv.width = px.w; cv.height = px.h;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#" + (ground || INK);
          ctx.fillRect(0, 0, px.w, px.h);
          const r = Math.round(Math.min(px.w, px.h) * 0.045);
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.lineTo(px.w - r, 0); ctx.quadraticCurveTo(px.w, 0, px.w, r);
          ctx.lineTo(px.w, px.h - r); ctx.quadraticCurveTo(px.w, px.h, px.w - r, px.h);
          ctx.lineTo(r, px.h); ctx.quadraticCurveTo(0, px.h, 0, px.h - r);
          ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, 0, 0, px.w, px.h);
          resolve(cv.toDataURL("image/jpeg", 0.82));
        } catch { resolve(null); }                              // tainted or out of memory — use the URL
      };
      img.onerror = () => resolve(null);
      img.src = deckImageUrl(url, px.w, px.h);
    });

    // The box a photograph lands in decides its crop, so rounding has to know the size in advance.
    // Anything not listed here still renders, just with square corners.
    const prepare = async (jobs) => {
      const seen = new Set();
      const work = jobs.filter((j) => j.url && !seen.has(rkey(j.url, j.w, j.h, j.ground)) && seen.add(rkey(j.url, j.w, j.h, j.ground)));
      const done = await Promise.all(work.map((j) => roundCorners(j.url, j.w, j.h, j.ground).catch(() => null)));
      work.forEach((j, i) => { if (done[i]) rounded.set(rkey(j.url, j.w, j.h, j.ground), done[i]); });
    };

    // ── Box geometry, named once ──
    // The rounding pass has to cut each photograph to the exact box it will land in, so the sizes
    // live here rather than inline, and both the pass and the slides read the same numbers.
    const BOX = {
      hero: { w: 4.75, h: 3.55 },
      element: { w: SLIDE_W - 6.35 - M, h: (SLIDE_W - 6.35 - M) * 0.68 },
      flower: { w: SLIDE_W - 6.4 - M, h: SLIDE_H - 2.6 },
    };
    const boardBoxes = (n) => {
      const top = 2.15, botH = SLIDE_H - top - 0.9, gut = 0.32;   // room for the mounts (see card)
      const bigW = n > 1 ? CONTENT_W * 0.56 : CONTENT_W;
      const rw = CONTENT_W - bigW - gut, rh = n > 2 ? (botH - gut) / 2 : botH;
      return { top, botH, gut, bigW, rw, rh };
    };
    const optionBoxes = (m) => {
      const gut = 0.34, w = (CONTENT_W - gut * (m - 1)) / m;      // room for the mounts (see card)
      return { gut, w, h: w * 0.67 };
    };

    {
      const jobs = [];
      for (const fn of content.functions) {
        if (fn.hero) jobs.push({ url: fn.hero, ...BOX.hero, ground: IVORY });
        const bb = boardBoxes(Math.min(fn.board.length, 3));
        if (fn.board[0]) jobs.push({ url: fn.board[0], w: bb.bigW, h: bb.botH, ground: IVORY });
        if (fn.board[1]) jobs.push({ url: fn.board[1], w: bb.rw, h: bb.rh, ground: IVORY });
        if (fn.board[2]) jobs.push({ url: fn.board[2], w: bb.rw, h: bb.rh, ground: IVORY });
        for (const z of fn.zones) {
          if (z.photo) jobs.push({ url: z.photo, ...BOX.element, ground: IVORY });
          // Same box the element card gives them, or the rounding misses and the sketches land
          // square-cornered inside a rounded mount.
          const sk = (z.details || []).slice(0, 2);
          if (sk.length) {
            const gap = 0.22, wS = (4.9 - gap * (sk.length - 1)) / sk.length;
            sk.forEach((u) => jobs.push({ url: u, w: wS, h: wS * 0.78, ground: IVORY }));
          }
        }
      }
      const flowerPic = content.functions[0]?.board?.[0] || content.cover;
      if (content.flowerStory && flowerPic) jobs.push({ url: flowerPic, ...BOX.flower, ground: IVORY });
      await prepare(jobs);
    }

    // ── Cover ──
    // A title page and nothing else: no photograph, everything on the centre line. A picture here
    // asks to be read as one of the design references, which is what the pages after this are for —
    // and a cover that shows one zone quietly promises the whole deck is about that zone.
    //
    // What it carries instead is the detail a client checks first: their name, and when and where
    // each function is. Centred at this size that IS the composition, so it needs no ornament to
    // fill space the way the old left-aligned cover did.
    {
      const s = newSlide();
      if (ornament) { corners(s); frame(s); }
      const mid = { x: M, w: SLIDE_W - M * 2, align: "center" };

      s.addText(`DESIGN YOUR ${kind.toUpperCase()}`, { ...mid, y: 1.45, h: 0.35, fontFace: SANS, fontSize: 12, color: t.accent, charSpacing: 6, bold: true });
      // Long names come down a step rather than running into the margins: PptxGenJS does not
      // shrink-to-fit, it simply overflows the box.
      const name = content.clientName || kind;
      s.addText(name, { ...mid, y: 2.05, h: 1.5, fontFace: DISPLAY, fontSize: name.length > 22 ? 44 : name.length > 14 ? 54 : 64, color: t.body, bold: true });

      rule(s, (SLIDE_W - 2.4) / 2, 3.72, 2.4);
      s.addText("Decor Presentation", { ...mid, y: 3.92, h: 0.6, fontFace: SERIF, fontSize: 26, color: t.body, italic: true });

      // One line per function — the type, the date, then the venue, dropped only when the venue was
      // never filled in (venueLine falls back to the function's own name, which would read twice).
      const fnLines = content.functions.map((f) => {
        const venue = f.venueLine && f.venueLine !== f.name ? f.venueLine : "";
        return [f.dateLine || f.name, venue].filter(Boolean).join("  ·  ");
      }).filter(Boolean);
      if (fnLines.length) {
        s.addText(fnLines.join("\n"), {
          ...mid, y: 4.75, h: Math.min(1.5, 0.34 * fnLines.length + 0.1),
          fontFace: SANS, fontSize: fnLines.length > 3 ? 12 : 13.5, color: t.body, lineSpacingMultiple: 1.5,
        });
      }

      s.addText("AMBRIA DESIGN & DECOR", { ...mid, y: SLIDE_H - 0.95, h: 0.35, fontFace: SANS, fontSize: 11, color: t.accent, charSpacing: 3 });
    }

    for (const fn of content.functions) {
      // ── Function opening: title left, one photograph placed low-right ──
      {
        const s = newSlide();
        if (ornament) { corners(s); frame(s); }
        s.addText(fn.name.toUpperCase(), { x: M, y: 1.25, w: 7.5, h: 0.5, fontFace: SANS, fontSize: 13, color: t.accent, charSpacing: 5 });
        s.addText(fn.venueLine || fn.name, { x: M - 0.06, y: 1.85, w: 7.6, h: 1.1, fontFace: DISPLAY, fontSize: 42, color: t.body, bold: true });
        s.addText(fn.dateLine || "", { x: M - 0.02, y: 3.0, w: 7.4, h: 0.9, fontFace: SERIF, fontSize: 22, color: t.accent, italic: true });
        rule(s, M, 4.05, 2.2);
        card(s, fn.hero, SLIDE_W - M - BOX.hero.w, 2.5, BOX.hero.w, BOX.hero.h);
      }

      // ── Mood board: photographs of different zones, placed as a considered set ──
      if (fn.board.length) {
        const s = newSlide();
        diamond(s, M, 0.82); s.addText("MOOD BOARD", { x: M + 0.26, y: 0.75, w: 6, h: 0.35, fontFace: SANS, fontSize: 11, color: t.accent, charSpacing: 5, bold: true });
        s.addText(fn.name, { x: M - 0.05, y: 1.12, w: 8, h: 0.75, fontFace: DISPLAY, fontSize: 30, color: t.body, bold: true });
        // One large plate with a stacked pair beside it — the asymmetry the references use, held to a
        // shared grid so it composes rather than scatters.
        const { top, botH, gut, bigW, rw: rwS, rh: rhS } = boardBoxes(Math.min(fn.board.length, 3));
        card(s, fn.board[0], M, top, bigW, botH);
        if (fn.board[1]) {
          const rx = M + bigW + gut, rw = rwS, rh = rhS;
          card(s, fn.board[1], rx, top, rw, rh);
          if (fn.board[2]) card(s, fn.board[2], rx, top + rh + gut, rw, rh);
        }
        const names = fn.zones.slice(0, 3).map((z) => z.label).filter(Boolean).join("   ·   ");
        if (names) label(s, names, M, SLIDE_H - 0.72, CONTENT_W, 12);
      }

      // ── Palette ──
      // Two colours minimum — one swatch stretched across the slide is not a palette, it is a wall.
      if (fn.palette.length >= 2) {
        const s = newSlide();
        diamond(s, M, 0.82); s.addText("THE PALETTE", { x: M + 0.26, y: 0.75, w: 6, h: 0.35, fontFace: SANS, fontSize: 11, color: t.accent, charSpacing: 5, bold: true });
        s.addText(fn.paletteName || "Colour Story", { x: M - 0.05, y: 1.12, w: 9, h: 0.8, fontFace: SERIF, fontSize: 30, color: t.body, italic: true });
        const n = fn.palette.length, gut = 0.2;
        const w = (CONTENT_W - gut * (n - 1)) / n, h = 2.9;
        fn.palette.forEach((c, i) => {
          const x = M + i * (w + gut);
          s.addShape(pptx.ShapeType.rect, { x, y: 2.5, w, h, fill: { color: c.hex } });
          s.addText(c.name.toUpperCase(), { x, y: 2.5 + h + 0.22, w, h: 0.32, fontFace: SANS, fontSize: 10, color: t.body, charSpacing: 2 });
          s.addText("#" + c.hex, { x, y: 2.5 + h + 0.55, w, h: 0.3, fontFace: SANS, fontSize: 9, color: t.mute });
        });
      }

      // ── Element cards: the photograph placed right, its callouts read down the left ──
      for (const z of fn.zones) {
        const s = newSlide();
        s.addText(z.label, { x: M - 0.05, y: 1.15, w: 5.0, h: 1.0, fontFace: DISPLAY, fontSize: 32, color: t.body, bold: true });
        rule(s, M, 2.25, 1.8);
        const outs = z.callouts.length ? z.callouts : (z.note ? [z.note] : []);
        outs.slice(0, 3).forEach((c, i) => {
          const y = 2.65 + i * 0.72;
          s.addShape(pptx.ShapeType.rect, { x: M, y: y + 0.08, w: 0.16, h: 0.02, fill: { color: t.accent } });
          s.addText(c, { x: M + 0.32, y, w: 4.3, h: 0.6, fontFace: SANS, fontSize: 12.5, color: t.body, lineSpacingMultiple: 1.3 });
        });
        // Landscape, and centred against the text column. A tall box meant a wide venue shot lost its
        // sides to the crop — the room stopped being readable, which is the whole point of the plate.
        card(s, z.photo, 6.35, 1.65, BOX.element.w, BOX.element.h);

        // The sketches fill the empty lower-left, under whatever callouts there are — and that space
        // is empty far too often, because the callouts come from a vision pass that can return
        // nothing. A card carrying a title and a rule and nothing else looks unfinished; two line
        // drawings of the same décor make it read as designed either way.
        const sk = (z.details || []).slice(0, 2);
        if (sk.length) {
          const top = 2.65 + Math.max(outs.length, 1) * 0.72 + 0.25;
          const gap = 0.22, wS = (4.9 - gap * (sk.length - 1)) / sk.length, hS = wS * 0.78;
          // Only if there is genuinely room left under the callouts — three long callouts and two
          // sketches do not both fit, and the sketches are the part that can go.
          if (top + hS < SLIDE_H - 0.7) {
            sk.forEach((u, i) => card(s, u, M + i * (wS + gap), top, wS, hS));
          }
        }

      }
    }

    // ── Flower story: prose left, one photograph right ──
    if (content.flowerStory) {
      const s = newSlide();
      if (ornament) { corners(s); frame(s); }
      s.addText("THE FLOWER STORY", { x: M, y: 1.3, w: 6, h: 0.35, fontFace: SANS, fontSize: 11, color: t.accent, charSpacing: 5, bold: true });
      s.addText("Florals", { x: M - 0.05, y: 1.72, w: 5.4, h: 0.9, fontFace: SERIF, fontSize: 36, color: t.body, italic: true });
      rule(s, M, 2.7, 1.8);
      // shrinkText + a real height: the story ran past the bottom of the slide because the box was
      // sized for a shorter paragraph than the model tends to write.
      s.addText(content.flowerStory, { x: M, y: 3.05, w: 4.9, h: SLIDE_H - 3.05 - 0.7, fontFace: SANS, fontSize: 12, color: t.body, lineSpacingMultiple: 1.35, shrinkText: true, valign: "top" });
      card(s, content.functions[0]?.board?.[0] || content.cover, 6.4, 1.3, BOX.flower.w, BOX.flower.h);
    }

    // ── Close ──
    {
      const s = newSlide();
      // Sat low and left with dead space above and below it. The block is now centred vertically as
      // one unit, so the card reads as composed rather than as text that slid down the page.
      if (ornament) { corners(s); frame(s); }
      // Centred, to close the deck the way the cover opened it — the two are a matched pair, and a
      // left-aligned last page after a centred first one reads as an unfinished thought.
      const mid = { x: M, w: SLIDE_W - M * 2, align: "center" };
      s.addText("Thank You", { ...mid, y: 2.15, h: 1.3, fontFace: DISPLAY, fontSize: 52, color: t.body, bold: true });
      s.addText("We would love to bring this design to life for you.", { ...mid, y: 3.5, h: 0.5, fontFace: SERIF, fontSize: 18, color: t.accent, italic: true });
      rule(s, (SLIDE_W - 2.2) / 2, 4.25, 2.2);
      s.addText("AMBRIA DESIGN & DECOR", { ...mid, y: 4.5, h: 0.4, fontFace: SANS, fontSize: 11, color: t.accent, charSpacing: 3 });
      s.addText("Pushpanjali, Bijwasan, New Delhi  ·  thefusiondecor.com", { ...mid, y: 4.9, h: 0.4, fontFace: SANS, fontSize: 10, color: t.mute });
      // Centred here rather than left, as a full stop for the deck.
      flourish(s, SLIDE_W / 2, 6.15);
    }

    return pptx;
  };

  // "🎨 Canva" — the design deck is laid out here (buildDesignDeck) and uploaded to Canva as a Design
  // Import job, so the salesperson gets back an editable Canva draft.
  //
  // Gamma is no longer in this path. It was given five rounds of progressively explicit art direction
  // and kept returning the same shape — photo inset with dead margins, title beneath it, callouts
  // stacked below — which is simply what its layout engine does. Placing the elements ourselves also
  // removes the two-to-three minute wait its generation took, and makes the deck identical every run.
  // The gamma edge function stays deployed; nothing calls it from here.
  //
  // The Canva import still polls client-side (each poll one fast GET through an edge function) rather
  // than blocking a single long edge-function call, which would hit the execution ceiling.
  const sendToCanva = async (combined) => {
    setCanvaState("designing"); setCanvaEditUrl(""); setCanvaError("");
    try {
      const connected = await canvaConnectionStatus();
      if (!connected) {
        setCanvaState("error");
        setCanvaError('Canva isn\'t connected — ask an admin to connect it in IMS → Admin → Settings.');
        return;
      }
      const content = await buildDeckContent(combined);
      const title = `${combined.clientName || "Ambria"} Design Presentation`;

      let base64 = null;
      if (USE_GAMMA) {
        // Gamma designs it. Two polls' worth of patience is the cost: generation takes minutes, not
        // seconds, and the client waits on this screen while it runs.
        const generationId = await gammaCreateGeneration(buildGammaOutline(content), title);
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 4000));
          const res = await gammaPollGeneration(generationId);
          if (res.status === "completed") { base64 = res.base64; break; }
          if (res.status === "failed") { setCanvaState("error"); setCanvaError(res.error || "Gamma design failed"); return; }
        }
        if (!base64) { setCanvaState("error"); setCanvaError("Timed out waiting for Gamma to finish designing — try again"); return; }
      } else {
        const pptx = await buildDesignDeck(content);
        // base64 straight out of PptxGenJS — the bytes go to Canva's import, never to disk.
        base64 = await pptx.write({ outputType: "base64" });
      }

      // The deck is posted as one JSON body to an Edge Function, which decodes it in memory. Too big
      // and the worker is killed mid-decode and answers HTTP 546 — a bare status that tells the
      // salesperson nothing. Checked here instead, where the cause and the remedy are both known.
      const mb = base64.length / 1.37e6;                       // base64 → rough megabytes
      if (mb > 18) {
        setCanvaState("error");
        setCanvaError(`This deck is ${mb.toFixed(0)} MB — too large for Canva import. Trim the zones with photos, or use the PDF export.`);
        return;
      }
      setCanvaState("uploading");
      const jobId = await canvaCreateImport(base64, title);
      setCanvaState("processing");
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const res = await canvaPollImport(jobId);
        if (res.status === "success") { setCanvaEditUrl(res.editUrl); setCanvaState("ready"); setCanvaDeckId(res.designId || ""); setDeckGlow(true); rememberDeck(res.editUrl, res.thumbnailUrl, res.designId); return; }
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
    <div className="sh-view" style={S.main}>
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
/* ═══ VIEW DECK, ONCE A DECK HAS JUST BEEN MADE ═══
   Built on the Preview button's pulse above rather than a new idea, so the app has ONE way of saying
   "press this". Teal, not gold: gold is Preview's and violet is Canva's, and a third button
   borrowing either would read as the same action twice. Teal is already the deck's colour elsewhere.
   The pulse is on the box-shadow only. Border and text brighten to teal but nothing moves and no
   size changes — this button sits in a row with three others, and a growing button would shove them.
   Removed the instant View deck is pressed (see setDeckGlow in showDeckPdf), because a prompt that
   keeps prompting after you have obeyed it is just noise.
   Reduced motion gets the bright teal ring, held still. The point is "this is new" and that survives
   without the breathing; dropping the animation entirely would take the message with it. */
/* The cost-sheet overlay's own children, above its wash — see the note on the wash markup. */
.cs-overlay > *:not(.sh-wash){position:relative;z-index:1}
/* ── THE WASH OWNS THE GROUND, NOT THE OVERLAY'S OWN BACKGROUND ──
   Worth writing down, because it cost two commits that changed nothing visible. .sh-wash is
   inset:0 and paints an OPAQUE colour of its own, so it covers whatever the element behind it is
   filled with. Darkening the overlay's background had no effect for that reason alone — the value
   was correct and simply never seen. The ground is here.
   Scoped to .cs-overlay so the Summary PAGE keeps its own near-white wash. The same class serves
   both, and the cost sheet is the only one that wants a deep ground: it is the screen that gets
   turned towards a client, and its glass panels need something with tone to sit against. */
/* Light, and low-chroma on purpose. #6F63A8 gave the panes plenty to sit against and turned the whole
   screen blue doing it — on a sheet of rupee figures the ground should be the quietest thing in the
   room. Most of what was wrong was SATURATION rather than lightness: pulling the violet almost out
   and keeping just enough to tint the greys is what lets it read as off-white and still hold an edge
   under the glass. */
.cs-overlay .sh-wash{background:${isDark ? "#0F0F1A" : "#D5D1E0"}}
/* ═══ THE TOOLBAR'S BUTTONS ═══
   Hover has to live in a stylesheet: these are inline-styled buttons, and inline styles have no
   pseudo-classes at all — there is no way to express :hover from the style prop, which is why none of
   them responded to the pointer before.
   Each button hovers towards WHAT IT ALREADY IS rather than to a shared grey: Excel goes cleaner,
   the ghosts pick up a little light, Canva goes one step brighter violet. A single shared hover would
   flatten the hierarchy the row was just given.
   SAFARI: -webkit-tap-highlight-color, because iOS Safari paints its own grey block over any tapped
   button and it lands OUTSIDE the pill's radius, which looks like a rendering fault. transform and
   box-shadow rather than filter, which Safari composites less predictably on small elements. Nothing
   here uses backdrop-filter — the same reason as the panels: the wash behind them animates. */
.cs-tb{-webkit-tap-highlight-color:transparent;
  transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .16s ease}
.cs-tb:hover{transform:translateY(-1px)}
.cs-tb:active{transform:translateY(0)}
.cs-tb:focus-visible{outline:2px solid #A5B4FC;outline-offset:2px}
.cs-tb[disabled]{transform:none}
.cs-tb-excel:hover{background:#fff;border-color:rgba(15,23,42,0.24);
  box-shadow:0 7px 18px -8px rgba(15,23,42,0.45)}
.cs-tb-ghost:hover{background:rgba(255,255,255,0.10);border-color:rgba(255,255,255,0.52)}
.cs-tb-canva:hover{background:#8B5CF6;border-color:#8B5CF6;
  box-shadow:0 8px 20px -8px rgba(124,58,237,0.75)}
.cs-tb-x:hover{background:rgba(255,255,255,0.13);border-color:rgba(255,255,255,0.45)}
@media (prefers-reduced-motion: reduce){
  .cs-tb{transition:background .16s ease,border-color .16s ease}
  .cs-tb:hover,.cs-tb:active{transform:none}
}
/* ── RESPONSIVE: THE LABELS GO, THE ICONS STAY ──
   Five buttons plus the lockup and the guest do not fit a narrow window, and a flex row that cannot
   fit does not wrap by default — it squashes, and the pills turn into slivers with clipped text.
   Dropping the labels first is the cheap win: every button kept its brand mark or its glyph for
   exactly this, and an icon-only pill is still a pill. Below that the row is allowed to wrap so the
   buttons drop under the lockup rather than shrinking further. */
.cs-tb-l{display:inline}
@media (max-width:1000px){
  .cs-tb-l{display:none}
  .cs-tb{padding-left:10px !important;padding-right:10px !important}
}
@media (max-width:620px){
  .cs-tbar{flex-wrap:wrap;row-gap:8px}
  .cs-tbar-brand{flex:1 1 100%}
}
/* ═══ GLASS, PAINTED AND NOT SAMPLED ═══
   The function panels were solid — correct, and the reason the new wash underneath was invisible the
   moment it was added: three opaque cards covering the whole scrollport. Glass is what lets the
   ground stay part of the page instead of a border you glimpse around the edges.
   NO backdrop-filter, deliberately, and this is the one decision here worth keeping. A
   backdrop-filter re-reads and re-blurs whatever sits behind it every frame, and behind these are
   the wash bands, which animate forever (shBand0 and friends, 34s infinite). That combination is
   exactly what made Safari drop the filter on the odd frame and dim the session cards on Browse
   until it was taken out of them. What actually reads as glass is the bright top edge, the diagonal
   sheen and the shadow — all of them paint. So they are painted: same surface, sampled zero times
   per frame, and no browser gets to have an opinion about it.
   Translucent enough for the wash to move behind the figures, opaque enough that a rupee amount is
   never competing with a blurred blob for the same pixels — 0.82 falling to 0.66 across the sheen. */
/* TINTED, NOT WHITE. Plain white over a cream page with violet in it is not glass — it is paper, and
   that is what the first pass looked like. Real glass takes the colour of what is behind it, so the
   falloff carries a violet cast (244,242,255) while the highlight stays near-white. That one
   difference is most of what separates the reference from a white card with a shadow.
   The outer ring is violet rather than grey for the same reason: a neutral shadow under a violet
   wash reads as dirt on the glass. */
.cs-glass{
  background:${isDark
    ? "linear-gradient(148deg,rgba(255,255,255,0.075) 0%,rgba(255,255,255,0.032) 46%,rgba(255,255,255,0.058) 100%)"
    : "linear-gradient(148deg,rgba(255,255,255,0.72) 0%,rgba(244,242,255,0.44) 48%,rgba(249,247,255,0.56) 100%)"};
  border:1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.92)"};
  box-shadow:inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.96)"},
    inset 0 -1px 0 ${isDark ? "rgba(255,255,255,0.05)" : "rgba(124,92,214,0.06)"},
    0 2px 6px ${isDark ? "rgba(0,0,0,0.34)" : "rgba(76,52,140,0.06)"},
    0 22px 50px -24px ${isDark ? "rgba(0,0,0,0.72)" : "rgba(76,52,140,0.24)"}}
/* The zone cards sit ON that glass, so they are a lighter weight of it — a second pane at the same
   strength would cancel the first and the stack would read as one flat slab again. Their border
   stays inline: it carries the open/closed state, which is not this rule's business. */
/* NEARLY CLEAR, BECAUSE IT IS GLASS ON GLASS. This is the trap: a tile at 0.82 white looks
   translucent on its own, but it sits on a pane that is already 0.72 white, and two translucent
   layers COMPOSITE — the pair came to roughly 0.95 and the tile read as a plain white card. Opacity
   here cannot be judged against the wash; it has to be judged against the pane it lies on.
   So the fill is barely there (0.30 falling to 0.12) and the tile is defined by its EDGES instead —
   the bright inset top line and the white border. That is how glass on glass works: you see the
   join, not the sheet. */
.cs-tile{
  background:${isDark
    ? "linear-gradient(148deg,rgba(255,255,255,0.055) 0%,rgba(255,255,255,0.022) 100%)"
    : "linear-gradient(148deg,rgba(255,255,255,0.30) 0%,rgba(246,244,255,0.12) 100%)"};
  box-shadow:inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.75)"},
    0 10px 24px -14px ${isDark ? "rgba(0,0,0,0.6)" : "rgba(76,52,140,0.16)"}}
/* THE PHOTOGRAPH SITS IN THE GLASS, NOT FLUSH WITH IT. Edge-to-edge, the picture WAS the card and
   the glass only showed as a strip under the label — so all that work went to a 40px band. Inset by
   7px with its own radius, the pane frames the photo and the tint reads on all four sides, which is
   what the reference is actually doing. Its own overflow:hidden is what rounds the image; the card
   keeps its radius for the outer edge. */
.cs-tile{padding:7px}
.cs-tile > img,.cs-tile > .cs-tile-ph{border-radius:9px}
/* No hover here. .sm-zcard already owns the lift on these cards — same -2px, and with a
   reduced-motion guard this rule would not have had. A second hover would only fight it over
   box-shadow and win or lose by stylesheet order, which is not a thing to leave to chance. */
/* A HEARTBEAT, NOT A BREATH. An even sine pulse reads as ambient — the eye files it with the other
   slow-moving things on the page and stops reporting it. A heart's rhythm is the opposite: two quick
   thumps and then a REST, and the rest is what does the work, because something that stops and starts
   is something alive asking for attention. Hence the bunched stops (7% and 24%) and the long flat
   tail out to 100%.
   The ripple is a second ring on ::after that leaves the button and fades. The box-shadow alone
   brightens in place, which is easy to miss in peripheral vision; a ring that TRAVELS is not, and it
   is what makes this readable while someone is looking at the cost sheet rather than the toolbar.
   Both run on the same 1.8s clock so the ripple leaves ON the first thump instead of drifting against
   it. inset:-1px and border-radius:inherit so the ring starts exactly on the button's own edge — the
   pill radius comes from the inline style, and inherit is what picks it up without repeating it. */
@keyframes dkBeat{
  0%,100%{box-shadow:0 0 0 1px rgba(94,234,212,.45),0 0 8px rgba(94,234,212,.2)}
  7%{box-shadow:0 0 0 1px rgba(94,234,212,.95),0 0 20px rgba(94,234,212,.7),0 0 42px rgba(94,234,212,.34)}
  15%{box-shadow:0 0 0 1px rgba(94,234,212,.58),0 0 12px rgba(94,234,212,.32)}
  24%{box-shadow:0 0 0 1px rgba(94,234,212,.9),0 0 17px rgba(94,234,212,.6),0 0 34px rgba(94,234,212,.26)}
  38%,100%{box-shadow:0 0 0 1px rgba(94,234,212,.45),0 0 8px rgba(94,234,212,.2)}
}
@keyframes dkRipple{
  0%{opacity:.6;transform:scale(1)}
  70%,100%{opacity:0;transform:scale(1.55)}
}
.sh-deck-glow{position:relative;border-color:rgba(94,234,212,.85) !important;color:#5EEAD4 !important;
  animation:dkBeat 1.8s ease-in-out infinite}
.sh-deck-glow::after{content:"";position:absolute;inset:-1px;border-radius:inherit;
  border:1px solid rgba(94,234,212,.85);pointer-events:none;
  animation:dkRipple 1.8s ease-out infinite}
@media (prefers-reduced-motion: reduce){
  .sh-deck-glow{animation:none;
    box-shadow:0 0 0 1px rgba(94,234,212,.85),0 0 14px rgba(94,234,212,.45)}
  .sh-deck-glow::after{display:none}
}
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
/* Wider travel and a stronger swing than before — the blobs move far enough now that the card's
   light visibly shifts rather than just breathing in place. */
@keyframes teAurora{0%,100%{transform:translate(-11%,-13%) scale(1);opacity:.5}50%{transform:translate(15%,11%) scale(1.3);opacity:.92}}
@keyframes teAurora2{0%,100%{transform:translate(9%,10%) scale(1.2);opacity:.6}50%{transform:translate(-12%,-10%) scale(.96);opacity:.3}}
/* One sweep every 4.5s rather than 7 — still mostly rest, but the pause between passes no longer
   outlasts the time anyone spends looking at the card. */
@keyframes teSheen{0%{transform:translateX(-150%) skewX(-18deg);opacity:0}
  4%{opacity:.7}20%{opacity:.7}
  26%,100%{transform:translateX(330%) skewX(-18deg);opacity:0}}
/* The total gets a slow glow. It is the one number on the page, and a static figure inside a card
   where everything else moves reads as the only dead thing on it. */
@keyframes teAmtGlow{0%,100%{text-shadow:0 2px 18px rgba(201,169,110,.28)}
  50%{text-shadow:0 2px 30px rgba(201,169,110,.62), 0 0 60px rgba(201,169,110,.22)}}
/* ═══ HEADER TYPE ═══
   !important on the family because StudioApp sets font-family on the universal selector with
   !important — without it the serif never lands. */
.sh-hero-face{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif !important;font-style:italic;
  font-size:46px;font-weight:600;letter-spacing:-0.5px;line-height:1.04;margin-top:8px}
.sh-eyebrow{font-size:11px;font-weight:700;letter-spacing:3.2px;text-transform:uppercase;
  color:${accent};line-height:1.4}
@media (max-width:760px){.sh-hero-face{font-size:34px}.sh-te-amt{font-size:36px !important}}
/* ═══ THE BADGE ═══
   A gold ring on a ring, with the fill breathing and the mark turning slowly. It was a flat tinted
   circle with a border; at the top of a page whose card is full of motion that read as the one
   inert thing on screen. */
/* A real CAST shadow, not just a gold glow. The old keyframes were gold-on-gold, which on a cream
   page is a halo and not a shadow — the badge looked printed onto the background rather than sitting
   above it. Two dark layers now: a tight contact shadow that anchors it, and a wide soft one that
   gives it height. The gold only comes in on the breath, as light rather than as the shadow itself.
   The inset highlight is the lit top edge; without it a dark-shadowed circle reads as a hole. */
@keyframes shBadgeBreathe{
  0%,100%{box-shadow:${isDark
    ? "0 5px 12px -4px rgba(0,0,0,.62), 0 18px 42px -12px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.14)"
    : "0 5px 12px -4px rgba(26,26,46,.34), 0 18px 42px -12px rgba(26,26,46,.30), inset 0 1px 0 rgba(255,255,255,.75)"}}
  50%{box-shadow:${isDark
    ? "0 8px 18px -4px rgba(0,0,0,.7), 0 26px 56px -12px rgba(0,0,0,.78), 0 0 28px rgba(201,169,110,.32), inset 0 1px 0 rgba(255,255,255,.18)"
    : "0 8px 18px -4px rgba(26,26,46,.42), 0 26px 56px -12px rgba(26,26,46,.38), 0 0 28px rgba(201,169,110,.42), inset 0 1px 0 rgba(255,255,255,.8)"}}}
@keyframes shBadgeSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
/* BOTH animations in one declaration. .sh-badge already carries its shPop entrance (with opacity:0
   and fill-mode forwards) further up; declaring the animation property again here would replace
   that rule outright and leave the badge stuck invisible. Comma-separated, they compose — shPop
   brings it in once, shBadgeBreathe keeps it alive after. */
.sh-badge{animation:shPop .62s cubic-bezier(.34,1.4,.5,1) .05s forwards,
  shBadgeBreathe 4.2s ease-in-out 1s infinite}
/* The dashed outer ring turns; the sparkle inside it stays upright. */
.sh-badge-ring{position:absolute;inset:-9px;border-radius:50%;pointer-events:none;
  border:1px dashed ${accent}66;animation:shBadgeSpin 26s linear infinite}
.sh-badge-mark{position:relative;display:inline-flex}
.sh-te{opacity:0;animation:teRise .62s cubic-bezier(.22,.61,.36,1) .5s forwards}
/* ── THE PHOTOGRAPH ──
   Right of the card, with the copy on the left. It sits at z-index 0 under a scrim that runs
   left-to-right, not top-to-bottom: the text lives on the left third, and darkening the whole frame
   to make it legible would waste the picture that is the reason for having it.
   Drop a file at src/assets/ambria-estimate.jpg and it appears. Without one the card keeps exactly
   the gradient it has now — the glob resolves to nothing and neither layer renders. */
/* The photograph fills the whole card, because the copy is CENTRED — with the text down the middle
   there is no side to keep clear, so confining the picture to one half would just crop it for no
   reason. The scrim is a radial rather than a linear sweep for the same reason: it darkens hardest
   where the number sits and lets the corners keep their picture. */
.sh-te-img{position:absolute;inset:0;z-index:0;background-size:cover;background-position:center}
/* Lightened from 0.94/0.86 at the centre. At those values the picture was technically there and
   effectively gone — a dark rectangle with a hint of stage in it. This darkens hardest exactly where
   the number sits and lets the corners keep their photograph. */
.sh-te-scrim{position:absolute;inset:0;z-index:2;pointer-events:none;
  background:radial-gradient(115% 95% at 50% 50%,rgba(15,15,26,0.82) 0%,rgba(15,15,26,0.68) 44%,rgba(15,15,26,0.38) 80%,rgba(15,15,26,0.26) 100%)}
.sh-te-body{position:relative;z-index:4;padding:30px 34px}
@media (max-width:760px){.sh-te-body{padding:24px 22px}}
/* ═══ THE PAGE GROUND ═══
   Event Info, Browse and Build are all drawn on this; Summary was the one step still on bare page.
   Fixed rather than absolute — this view scrolls, and an absolute layer would scroll its colour away
   and leave the lower half bare. z-index 0, NOT -1: negative puts it behind S.app's opaque
   background, which then paints straight over it. */
/* ── KEEP THIS LAYER ── A hidden tab has its compositing layers discarded, and coming back rebuilds
   them: here that means re-rasterising 80px-blurred blobs and a blend-mode stack, which shows as a
   flash on fast tab switching. translateZ(0) plus backface-visibility promotes the wash to a layer
   of its own and keeps it there; contain:paint stops its repaints escaping into the page. */
.sh-wash{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
    transform:translateZ(0);backface-visibility:hidden;contain:paint;
  background:${isDark?"#0F0F1A":"#FAF9F6"}}
.sh-wash span{position:absolute;display:block;filter:blur(80px);mix-blend-mode:multiply}
.sh-wash-a{width:760px;height:700px;top:-190px;left:-120px;border-radius:62% 38% 46% 54% / 54% 47% 53% 46%;
  background:radial-gradient(circle,rgba(201,169,110,0.34) 0%,rgba(201,169,110,0) 70%)}
.sh-wash-b{width:640px;height:700px;top:90px;right:-170px;border-radius:41% 59% 66% 34% / 38% 62% 38% 62%;
  background:radial-gradient(circle,rgba(214,158,140,0.30) 0%,rgba(214,158,140,0) 72%)}
.sh-wash-c{width:740px;height:660px;top:520px;left:18%;border-radius:55% 45% 33% 67% / 61% 39% 61% 39%;
  background:radial-gradient(circle,rgba(124,92,214,0.20) 0%,rgba(124,92,214,0) 74%)}
.sh-bands{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:blur(24px)}
.sh-grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:${GRAIN_URL};background-size:220px 220px}
.sh-band{transform-box:view-box;transform-origin:center;will-change:transform}
.sh-band-0{animation:shBand0 34s ease-in-out infinite alternate}
.sh-band-1{animation:shBand1 45s ease-in-out infinite alternate}
.sh-band-2{animation:shBand2 38s ease-in-out infinite alternate}
.sh-band-3{animation:shBand3 53s ease-in-out infinite alternate}
.sh-band-4{animation:shBand4 41s ease-in-out infinite alternate}
@keyframes shBand0{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-72px,18px) scaleY(1.1)}}
@keyframes shBand1{from{transform:translate(0,0) scaleY(1.06)}to{transform:translate(86px,-24px) scaleY(0.94)}}
@keyframes shBand2{from{transform:translate(0,0) scaleY(0.96)}to{transform:translate(-94px,14px) scaleY(1.12)}}
@keyframes shBand3{from{transform:translate(0,0) scaleY(1.08)}to{transform:translate(64px,-30px) scaleY(0.95)}}
@keyframes shBand4{from{transform:translate(0,0) scaleY(1)}to{transform:translate(-78px,22px) scaleY(1.09)}}
/* Every sibling of the wash has to clear it. A positioned layer at z-index 0 paints over the inline
   content of un-positioned blocks, and this page is a stack of plain divs. */
.sh-view > *:not(.sh-wash){position:relative;z-index:1}
@media (prefers-reduced-motion: reduce){.sh-band{animation:none}}
/* ── THE AURORA GOES UNDER THE SCRIM ──
   These are 40px-blurred blobs covering half the card each. Above the photograph they read as the
   photograph being out of focus — the picture looked blurred because two soft clouds were sitting
   on it. At z-index 1 they tint the image from underneath and the scrim tempers them, which is
   what they were for: light in the card, not haze over the picture.
   The sparkle and the sheen stay ABOVE the scrim (z-index 3) — those are small and crisp, so they
   read as motion rather than as fog. */
.sh-te-aurora{position:absolute;left:4%;top:-34%;width:56%;height:168%;border-radius:50%;pointer-events:none;z-index:1;
  background:radial-gradient(closest-side,rgba(124,58,237,.58),transparent 70%);filter:blur(40px);animation:teAurora 6.5s ease-in-out infinite}
.sh-te-aurora2{position:absolute;right:2%;top:-24%;width:46%;height:150%;border-radius:50%;pointer-events:none;z-index:1;
  background:radial-gradient(closest-side,rgba(201,169,110,.42),transparent 70%);filter:blur(44px);animation:teAurora2 8s ease-in-out infinite}
.sh-te-sheen{position:absolute;top:0;bottom:0;left:0;width:34%;pointer-events:none;z-index:3;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);animation:teSheen 4.5s ease-in-out 1.3s infinite}
/* Fireworks: 8s cycle, but the burst itself only occupies the first ~16% — the rest is dead air so
   the three staggered bursts read as occasional sparkle, not a constant shower. */
@keyframes teFw{
  0%{transform:translate(0,0) scale(1);opacity:0}
  2%{opacity:1}
  10%{opacity:.85}
  16%,100%{transform:translate(var(--dx),calc(var(--dy) + 16px)) scale(.2);opacity:0}}
.sh-te-fw{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
.sh-te-fw span{position:absolute;width:3.5px;height:3.5px;border-radius:50%;opacity:0;animation:teFw 8s ease-out infinite}
.sh-te-lbl{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .64s forwards}
/* Two animations: the entrance once, then the glow forever. Comma-separated so the second is not
   waiting on the first to be re-declared. */
/* Tabular figures: AnimatedTotal counts the number up, and with proportional digits a 1 is narrower
   than a 0 — so the whole figure shifts sideways on every frame of the count. */
.sh-te-amt{opacity:0;text-shadow:0 2px 18px rgba(201,169,110,.28);
  font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;
  animation:shRise .55s cubic-bezier(.22,.61,.36,1) .72s forwards, teAmtGlow 3.4s ease-in-out 1.3s infinite}
.sh-te-pill{opacity:0;animation:tePop .5s cubic-bezier(.34,1.4,.5,1) .84s forwards}
.sh-te-cta{opacity:0;animation:shRise .5s cubic-bezier(.22,.61,.36,1) .94s forwards}
/* ═══ FOOTER NAV (Adjust / Start New) ═══ These keep S.btn(false) for their resting look, so the
   hover has to out-specify an inline style — hence !important on the two properties it changes. */
.sh-nav{transition:background .18s,color .18s,transform .18s,box-shadow .18s}
.sh-nav:hover{background:${isDark?"rgba(201,169,110,0.16)":"#EFE8DA"} !important;color:${accentText} !important;
  transform:translateY(-1.5px);box-shadow:0 4px 14px ${isDark?"rgba(0,0,0,0.4)":"rgba(201,169,110,0.28)"}}
.sh-nav:active{transform:translateY(0) scale(.985)}
.sh-nav:focus-visible{outline:2px solid ${accent};outline-offset:2px}
/* ══ TABLET ══
   Summary is a single centred column under S.main's 1200px cap, so it already fits a tablet — the
   trouble is the per-item cost tables. Those are five fr-sized columns (item, qty, rate, unit,
   total): fr shrinks rather than overflows, so nothing breaks, but at 820px each column is ~150px
   and the item names start wrapping to three lines. Tightening the type and gutters keeps them on
   one line, which is what makes the table scannable.
   The deck/PDF export builds its own standalone HTML earlier in this file; nothing here reaches
   it, so an exported deck is untouched by any of this. */
/* Zone card. The lift is what tells you it is pressable — the cards carry no button of their own,
   the whole card is the control. */
.sm-zcard{transition:transform .16s ease, box-shadow .18s ease, border-color .16s ease}
.sm-zcard:hover{transform:translateY(-2px);box-shadow:0 14px 26px -14px rgba(26,26,46,0.45)}
.sm-zcard:active{transform:translateY(0) scale(.99)}
.sm-zcard:focus-visible{outline:2px solid ${accentText};outline-offset:2px}
@media (max-width:840px){
  .sm-costgrid{font-size:11px !important}
  .sm-costgrid > *{padding-left:2px;padding-right:2px}
}
@media (prefers-reduced-motion: reduce){
  .sm-zcard{transition:none}
  .sm-zcard:hover,.sm-zcard:active{transform:none}
}
@media (pointer: coarse){
  .sh-nav{min-height:38px}
}
@media (prefers-reduced-motion: reduce){
  .sh-badge,.sh-1,.sh-2,.sh-3,.sh-4{animation:none;opacity:1;transform:none}
  .sh-rule{animation:none;opacity:1;width:56px}
  .sh-halo{animation:none;opacity:0}
  .sh-badge-ring{animation:none}
  .sh-pv{animation:none;box-shadow:0 0 0 1px rgba(201,169,110,.7)}
  .sh-pv-glow{animation:none;opacity:.4}
  .sh-te,.sh-te-lbl,.sh-te-amt,.sh-te-pill,.sh-te-cta{animation:none;opacity:1;transform:none}
  .sh-te-aurora,.sh-te-aurora2{animation:none;opacity:.45}
  .sh-te-sheen,.sh-te-fw{animation:none;opacity:0}
  .sh-te-fw span{animation:none;opacity:0}
  .sh-nav:hover,.sh-nav:active{transform:none}
}
      `}</style>
      {/* The page's own ground — the same one Event Info, Browse and Build are drawn on, from the
          shared module so the four steps cannot drift apart. Never receives a click. */}
      <div className="sh-wash" aria-hidden="true">
        <span className="sh-wash-a"/><span className="sh-wash-b"/><span className="sh-wash-c"/>
        <svg className="sh-bands" viewBox="0 0 1200 960" preserveAspectRatio="none" focusable="false">
          {WASH_BANDS.map((b,i)=>(
            <path key={i} className={"sh-band sh-band-" + i} d={b.d} fill="none" stroke={b.c}
              strokeOpacity={b.o} strokeWidth={b.w} strokeLinecap="round"/>
          ))}
        </svg>
        <i className="sh-grain"/>
      </div>
      <div style={{textAlign:"center",marginBottom:28}}>
        <div className="sh-badge" style={{position:"relative",width:64,height:64,margin:"0 auto 16px",borderRadius:"50%",
          display:"flex",alignItems:"center",justifyContent:"center",color:accent,
          background:isDark
            ? "radial-gradient(circle at 34% 28%, rgba(201,169,110,0.26), rgba(201,169,110,0.06) 68%)"
            : "radial-gradient(circle at 34% 28%, rgba(255,255,255,0.9), rgba(201,169,110,0.16) 70%)",
          border:`1px solid ${accent}66`,
          boxShadow:isDark?"0 10px 26px -14px rgba(0,0,0,0.7)":"0 10px 26px -14px rgba(201,169,110,0.55)"}}>
          {/* A slow dashed ring outside the fill. It turns; the sparkle does not, so the mark stays
              upright and legible while the badge still reads as alive. */}
          <span className="sh-badge-ring" aria-hidden="true"/>
          <span className="sh-badge-mark"><IconSparkle size={27}/></span>
          <span className="sh-halo" style={{position:"absolute",inset:-7,borderRadius:"50%",border:`1px solid ${accent}`,opacity:0,pointerEvents:"none"}}/>
        </div>
        {/* ── THE HIERARCHY IS INVERTED ──
            "Decor Estimate" is what the page IS — the same on every estimate anyone ever opens — so
            it drops to a tracked eyebrow. The client's name is what makes THIS one different, so it
            takes the display serif at the size the title used to have. The venue line sits between
            them: bigger than a caption, smaller than the name it belongs to.
            Same face as Event Info, Browse and Build, so all four steps are set in one voice. */}
        <div className="sh-1 sh-eyebrow">Decor Estimate</div>
        {clientName&&<div className="sh-2 sh-hero-face">{clientName}</div>}
        {/* Not textS. That is #8b8fa3 — the filter kit measured it at ~3.1:1 on this page, below AA,
            and it showed: the line naming the venue and the date read as a caption you skip. */}
        <div className="sh-3" style={{fontSize:16.5,color:isDark?"rgba(255,255,255,0.80)":"#3F4557",
          fontWeight:600,marginTop:9,letterSpacing:0.2}}>{venue} {"·"} {fn}{clientDate&&` · ${new Date(clientDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`}</div>
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
      {/* Centred copy, as it was — the photograph sits behind the whole card rather than beside the
          text. Padding lives on .sh-te-body so the picture can reach the card's own edges. */}
      <div className="sh-te" style={{position:"relative",overflow:"hidden",background:"linear-gradient(135deg,#0F0F1A,#2d1b69)",borderRadius:18,padding:0,color:"#fff",textAlign:"center",marginBottom:22}}>
        {ESTIMATE_BG && <div className="sh-te-img" style={{backgroundImage:`url(${ESTIMATE_BG})`}} aria-hidden="true"/>}
        {ESTIMATE_BG && <div className="sh-te-scrim" aria-hidden="true"/>}
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
            /* zIndex 5, ABOVE .sh-te-body's 4. Both were 4, and on a tie the later element in the
               DOM wins — .sh-te-body is a full-width block that comes after this button, so it
               painted straight over it and swallowed every click. The button looked fine and did
               nothing. */
            display:"inline-flex",alignItems:"center",gap:6,zIndex:5}}>
          <span className="sh-pv-glow"/>
          <span style={{position:"relative"}}>{"👁"} Preview</span>
        </button>
        <div className="sh-te-body">
        {/* Gold, not indigo, and tracked wide. It is a label on the number below it — at 11.5px with
            1px of tracking it was competing with the figure instead of introducing it. */}
        <div className="sh-te-lbl" style={{fontSize:10.5,color:"#E8CF9A",textTransform:"uppercase",letterSpacing:3.4,fontWeight:700,marginBottom:9}}>Total Estimate</div>
        {/* The figure stays in the SANS. It was briefly set in the display serif to match the header,
            and that was wrong for a number: Cormorant ships old-style figures, so 6,90,091 came out
            with digits sitting at different heights and descenders hanging below the line — elegant
            in a sentence, and wrong for the one figure a client reads off the screen.
            The size from that attempt is worth keeping. */}
        <div className="sh-te-amt" style={{fontSize:46,fontWeight:700,letterSpacing:-1,marginBottom:11}}><AnimatedTotal value={eventGrandTotal} fmt={fmt}/></div>
        <div className="sh-te-pill" style={{display:"inline-block",padding:"5px 17px",borderRadius:999,fontSize:10.5,fontWeight:700,letterSpacing:1.6,textTransform:"uppercase",background:getCat(eventGrandTotal).bg,color:getCat(eventGrandTotal).color}}>{getCat(eventGrandTotal).label}</div>
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
          <button onClick={markSold} disabled={!canSold} className={canSold?"sh-sold":""} style={{padding:"10px 22px",borderRadius:10,border:"none",cursor:canSold?"pointer":"not-allowed",fontSize:11.5,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",background:canSold?undefined:"#333",color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:canSold?undefined:"none",opacity:canSold?1:0.5}}>{"🎉"} Sold — Confirm Booking</button>
          {!canSold&&<div style={{fontSize:10,color:textS,textAlign:"center",marginTop:6}}>Requires: {missing.join(", ")}</div>}
          </>;})()}
        </div>
        {(() => {
          const allFns = collectAllFunctionData();
          return allFns.length > 1 ? <div className="sh-te-cta" style={{fontSize:11,color:"#a5b4fc",marginTop:10}}>{allFns.length} functions · {allFns.map(f => f.fnType || "—").join(" + ")}</div> : null;
        })()}
        </div>
      </div>
      {/* Discreet gate for everything below — the full "Design based on" line, and the whole
          per-function zone/item breakdown. See the showSummaryDetails declaration above for why. */}
      <div style={{display:"flex",justifyContent:"center",marginBottom:showSummaryDetails?14:22}}>
        <span onClick={()=>setShowSummaryDetails(v=>!v)} style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,fontWeight:600,color:textS,padding:"4px 12px",borderRadius:20,border:`1px solid ${border}`,userSelect:"none"}}>
          <span style={{display:"inline-flex",transition:"transform 0.15s",transform:showSummaryDetails?"rotate(180deg)":"none"}}>▾</span>
          {showSummaryDetails?"Hide":"Show"} cost breakdown
        </span>
      </div>
      {showSummaryDetails&&<>
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
                                  {/* The chip says a reference photo IS chosen. Its name was the storage
                                      filename, which told nobody anything. */}
                                  {eb.selPh && <span title="Reference photo selected for this zone" style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"#ECFDF5",color:"#059669"}}>📷 Photo</span>}
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
                                  const priceInfo = getElPriceForFn(el2, eb.zc, typeof fnData.floralRatio === "number" ? fnData.floralRatio : 70, false, fnData.fnVenue);
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
      </>}
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
      // The cost-sheet PDF button is gone from the toolbar. exportPDF() below still builds the sheet
      // and is deliberately kept: Excel covers the same figures for anyone who needs a file, and
      // putting the button back is one line if printing the sheet turns out to be missed.
      const csExportPPT=()=>exportPPT(csData);
      const csExportExcel=()=>exportExcel(csData);
      const fmtDate=(iso)=>{if(!iso)return"—";try{return new Date(iso+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}catch{return iso;}};
      const fnLine=(fnObj)=>{const parts=[fnObj.fnType||"Function",fmtDate(fnObj.fnDate),fnObj.fnVenue||"—"];if(fnObj.fnShift)parts.push(fnObj.fnShift);return parts.filter(Boolean).join(" · ");};
      const fnCount=csData.functions.length;
      // ── GLASS NEEDS SOMETHING TO BE GLASS AGAINST ──
      // The ground was the app's cream, #F5F3EE, and that is why the panes would not show: a pale
      // sheet over a pale ground is the same pale, whatever its opacity says. Nothing was wrong with
      // the glass — there was nothing behind it to see.
      // Deeper and violet-tinted, so the panes read as panes and the wash's blobs (which multiply)
      // have some tone to darken. Only the BASE moved; the wash layers, the bands and the grain are
      // untouched, so this is still the same ground every other screen has, turned down a few stops.
      // Light mode only — dark mode is already dark enough for the panes to read against.
      // This value is a FALLBACK and nothing more — .sh-wash covers it with an opaque fill of its own.
      // The colour that actually shows is set on .cs-overlay .sh-wash in the stylesheet; see the note
      // there. Left as the plain page colour so that if the wash ever fails to render, what shows
      // through is the app's own ground rather than a violet nobody chose.
      // The ground can go dark safely because it is only visible in the GUTTERS — between the panels
      // and around them. Every figure and every table sits on glass, so darkening it buys contrast for
      // the panes without touching the contrast of anything anyone has to read.
      return(
      <div className="cs-overlay" style={{position:"fixed",inset:0,background:isDark?"#0A0A14":"#F5F3EE",zIndex:200,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* THE SAME GROUND AS EVERY OTHER SCREEN. This overlay was a flat fill — correct colour,
            nothing else — so opening the cost sheet dropped out of the app's world and into a plain
            document. The wash is the app's ground: the same drifting blobs, the same ripple bands,
            the same paper grain, from the same lib every other view imports. Reusing the .sh-wash
            classes already in this file rather than a second copy tuned by eye, because a wash that
            is ALMOST the other pages' is worse than a flat fill — it reads as a bug.
            Lifted by the .cs-overlay rule in the stylesheet rather than inline on each child: the
            wash is a positioned layer at z-index 0, and a STATIC sibling paints below that level
            however late it comes in the DOM — so the error strips and the deck's iframe would have
            gone under the grain. One rule catches every child, including the conditional ones, which
            is the same thing .sh-view does for the page itself. */}
        <div className="sh-wash" aria-hidden="true">
          <span className="sh-wash-a"/><span className="sh-wash-b"/><span className="sh-wash-c"/>
          <svg className="sh-bands" viewBox="0 0 1200 960" preserveAspectRatio="none" focusable="false">
            {WASH_BANDS.map((b,i)=>(
              <path key={i} className={"sh-band sh-band-" + i} d={b.d} fill="none" stroke={b.c}
                strokeOpacity={b.o} strokeWidth={b.w} strokeLinecap="round"/>
            ))}
          </svg>
          <i className="sh-grain"/>
        </div>
        {/* Header */}
        <div className="cs-tbar" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"12px 20px",background:"#1a1a2e",flexShrink:0}}>
          <div className="cs-tbar-brand" style={{display:"flex",alignItems:"center",gap:14,minWidth:0}}>
            {/* THE REAL WORDMARK, NOT A LETTERMARK. The gold "A" tile was a stand-in for exactly this
                file, and this bar is the one a client sees over someone's shoulder — the mark is
                white and gold on transparent, which is what a navy toolbar wants. Cropped to its own
                ink via logoCrop, so 20px means 20px of visible wordmark and not 20px of mostly
                transparent canvas. Falls back to the tile if the asset is missing, which is the whole
                reason the asset is globbed rather than imported. */}
            {LOGO_ASSET ? (() => { const L = logoCrop(27); return (
              <div style={L.box}><img src={LOGO_ASSET} alt="Ambria" style={L.img}/></div>
            ); })() : (
              <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#C9A96E,#8B7355)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff"}}>A</div>
            )}
            {/* A hairline, not a gap. Identity on the left of it, THIS DEAL on the right — the same
                separation the main header makes between the brand and the navigation, so the two bars
                are read the same way. */}
            <span aria-hidden="true" style={{width:1,alignSelf:"stretch",margin:"2px 4px",background:"rgba(255,255,255,0.18)",flexShrink:0}}/>
            {/* The guest, and what is being priced for them. The name leads because on this screen it
                is the answer to "whose sheet is this" — "Cost Sheet" was the loudest thing here and it
                is the one fact nobody needs, given they just pressed Preview to get here. */}
            <div style={{minWidth:0}}>
              <div style={{fontSize:14,fontWeight:700,color:"#C9A96E",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{csData.clientName||"Client"}</div>
              <div style={{fontSize:11,color:"#a5b4fc",whiteSpace:"nowrap"}}>Cost sheet · {fnCount} function{fnCount!==1?"s":""}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {/* The grand total used to sit here, pinned above everything. It is still on the sheet
                itself (and in the PDF, Excel and PPT exports) — off the toolbar it is no longer
                the first thing on screen while a deck is open in front of a client. */}
            {/* Excel light, Canva filled — the two are not the same kind of action and should not
                look it. Excel hands over a FILE you keep; Canva hands you off to another product.
                So Excel is the quiet one on white, and the violet is spent on the button that
                actually takes you somewhere. Both carry their own brand mark instead of the emoji
                they used to: a chart glyph and an arrow said "some export, somewhere", while the
                marks say which product before the label is read.
                Radius 999 rather than 8: these two now read as a pair of pills sitting apart from
                the square buttons beside them, which is what they are. */}
            <button onClick={csExportExcel} className="cs-tb cs-tb-excel" title="Download the cost sheet as an Excel workbook" style={{padding:"7px 15px",borderRadius:999,border:"1px solid rgba(15,23,42,0.14)",cursor:"pointer",fontSize:12,fontWeight:600,background:"#fff",color:"#1F2937",display:"inline-flex",alignItems:"center",gap:7,lineHeight:1}}><IconExcelMark size={15}/><span className="cs-tb-l">Excel</span></button>
            {(() => {
              const busy = canvaState === "designing" || canvaState === "uploading" || canvaState === "processing";
              const busyLabel = canvaState === "designing" ? "Designing…" : canvaState === "uploading" ? "Uploading…" : "Finalizing…";
              // Once a deck is made, "Open in Canva" USED TO BE the only button — so the link to the
              // first deck was all anyone could reach, and a second one could not be made without
              // reloading the page. Worse, that link outlived whatever changed since: a new theme,
              // an edited build, different photos. Both actions are offered now, and Make again is
              // deliberately plain so the link stays the obvious one.
              if (canvaState === "ready") return (
                <>
                  {/* ── ONE FILL IN THE ROW ──
                      Four buttons all shouting was the problem: Excel blue, View deck teal, Canva
                      violet, Make again ghosted. Four colours is no hierarchy at all — the eye has
                      nowhere to land. Only ONE thing here leaves the app, and that is Canva, so
                      Canva keeps the fill. View deck and Make again both act INSIDE this overlay, so
                      they are ghosts on the dark bar: present, pressable, and quiet. Excel stays
                      white because it is the other kind of thing entirely — a file you take away.
                      All four are pills now, so the row reads as one set. */}
                  <button onClick={showDeckPdf} disabled={deckPdf.state==="loading"}
                    className={"cs-tb cs-tb-ghost" + (deckGlow?" sh-deck-glow":"")}
                    title={deckGlow?"Your design deck is ready — open it":"Show the design deck as it stands in Canva, and hand it over as a PDF"}
                    style={{padding:"7px 15px",borderRadius:999,border:"1px solid rgba(255,255,255,0.28)",cursor:deckPdf.state==="loading"?"default":"pointer",fontSize:12,fontWeight:600,background:"transparent",color:"#fff",opacity:deckPdf.state==="loading"?0.7:1,display:"inline-flex",alignItems:"center",gap:7,lineHeight:1}}>{deckPdf.state==="loading"?"⏳ Opening…":<><IconEye size={14}/><span className="cs-tb-l">View deck</span></>}</button>
                  <button onClick={() => window.open(canvaEditUrl, "_blank")} className="cs-tb cs-tb-canva" title="Open this deck in Canva to edit it" style={{padding:"7px 15px",borderRadius:999,border:"1px solid #7C3AED",cursor:"pointer",fontSize:12,fontWeight:600,background:"#7C3AED",color:"#fff",display:"inline-flex",alignItems:"center",gap:7,lineHeight:1}}><IconCanvaMark size={15}/><span className="cs-tb-l">Canva</span></button>
                  <button onClick={() => { setCanvaState("idle"); setCanvaEditUrl(""); setCanvaError(""); forgetDeck(); }}
                    title="Design a fresh deck — the current link stays open in Canva either way"
                    className="cs-tb cs-tb-ghost"
                    style={{padding:"7px 15px",borderRadius:999,border:"1px solid rgba(255,255,255,0.28)",background:"transparent",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,display:"inline-flex",alignItems:"center",gap:7,lineHeight:1}}><IconRepeat size={14}/><span className="cs-tb-l">Make again</span></button>
                </>
              );
              // The same pill as the "Open in Canva" one above, because this is the button that sits
              // next to Excel for most of a deal's life — the deck only exists after someone makes
              // it. Styling only that later state would mean the pair the toolbar is built around
              // appears late and looks accidental before then.
              // The mark is dropped while busy or after a failure: both of those are about THIS app's
              // progress, not about Canva, and a brand mark beside "Finalizing…" or "Retry" reads as
              // if the other product were the thing reporting.
              return <button disabled={busy} onClick={()=>sendToCanva(csData)} className={"cs-tb" + (canvaState==="error"?"":" cs-tb-canva")} title={canvaState==="error"?canvaError:"Design this deck with Gamma's AI, then send it to Canva as an editable draft"} style={{padding:"7px 15px",borderRadius:999,border:`1px solid ${canvaState==="error"?"#EF4444":"#7C3AED"}`,cursor:busy?"default":"pointer",fontSize:12,fontWeight:600,background:canvaState==="error"?"#EF4444":"#7C3AED",color:"#fff",opacity:busy?0.7:1,display:"inline-flex",alignItems:"center",gap:7,lineHeight:1}}>{busy?`⏳ ${busyLabel}`:canvaState==="error"?"⚠ Retry":<><IconCanvaMark size={15}/><span className="cs-tb-l">Canva</span></>}</button>;
            })()}
            {/* A round button for the round set. Fixed square rather than padded text, so the glyph
                actually sits in the middle of the circle. */}
            <button onClick={()=>setCsData(null)} className="cs-tb cs-tb-x" title="Close the cost sheet" style={{width:30,height:30,padding:0,borderRadius:999,border:"1px solid rgba(255,255,255,0.2)",background:"transparent",color:"#fff",cursor:"pointer",fontSize:12,display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,flexShrink:0}}>{"✕"}</button>
          </div>
        </div>
        {canvaState==="error"&&canvaError&&<div style={{padding:"6px 20px",background:"rgba(239,68,68,0.15)",color:"#FCA5A5",fontSize:11,flexShrink:0}}>{canvaError}</div>}
        {deckPdf.state==="error"&&<div style={{padding:"6px 20px",background:"rgba(239,68,68,0.15)",color:"#FCA5A5",fontSize:11,flexShrink:0}}>{deckPdf.error}</div>}
        {/* ── The design deck, in the browser's own PDF viewer ──
            An <iframe> rather than a strip of page images: the viewer that comes with the browser
            already pages, zooms and prints, and the export is a single PDF anyway. Sits above the
            cost sheet instead of replacing it, so the deck and its figures stay one screen apart. */}
        {deckPdf.state==="ready"&&deckPdf.url&&(
          // flex:1 with minHeight:0, not a fixed height: the deck takes the whole panel while it is
          // open. minHeight:0 is the part that matters — a flex child defaults to min-height:auto,
          // which floors it at its content and would push the panel taller than the screen instead
          // of letting the frame shrink into what is left below the toolbars.
          <div ref={deckViewRef} style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",borderBottom:"1px solid rgba(255,255,255,0.12)",background:"#111827"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 20px"}}>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:"#a5b4fc"}}>Design deck</span>
              <button onClick={toggleDeckFullscreen} title={deckFull?"Back to the page":"Full screen — for showing a client"}
                style={{marginLeft:"auto",padding:"5px 12px",borderRadius:7,border:"1px solid rgba(255,255,255,0.2)",background:"transparent",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600}}>{deckFull?"⤢ Exit full screen":"⛶ Full screen"}</button>
              {/* A plain link, not a fetch-then-save: the export URL is signed and cross-origin, so
                  reading it into a blob is at the mercy of Canva's CORS headers, while letting the
                  browser follow the link is not. */}
              <a href={deckPdf.url} target="_blank" rel="noreferrer" download
                style={{padding:"5px 12px",borderRadius:7,background:"#E11D48",color:"#fff",fontSize:11,fontWeight:600,textDecoration:"none"}}>{"⬇"} Download PDF</a>
              <button onClick={()=>setDeckPdf({state:"idle",url:"",error:""})}
                style={{padding:"5px 10px",borderRadius:7,border:"1px solid rgba(255,255,255,0.2)",background:"transparent",color:"#fff",cursor:"pointer",fontSize:11}}>{"✕"}</button>
            </div>
            {/* Fills whatever the toolbars leave, rather than a fixed height. This is the deck being
                READ, often with a client looking at it, so it gets the page. */}
            <iframe title="Design deck" src={deckPdf.url}
              style={{flex:1,minHeight:0,width:"100%",border:"none",background:"#1f2937"}} />
          </div>
        )}
        {/* The "Design deck ready" strip is gone. It existed to announce a deck the toolbar had no
            room to mention, but the toolbar now says it plainly: View deck and Canva only appear
            once a deck exists, so their presence IS the announcement. The strip was left explaining
            a button sitting a few pixels above it, and eating a band of the cost sheet to do it. */}
        {/* Scrollable body — hidden, not unmounted, while the deck is open: the deck takes the whole
            panel, and unmounting this would throw away the reader's scroll position in a long cost
            sheet every time they glanced at the slides. */}
        {/* Full width. The 960px cap made sense when this was a column of item tables — a cost sheet
            is read like a document. It is a photo grid now, and capping it left deep empty gutters
            while squeezing the cards into three columns on a screen with room for six. */}
        <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"20px 28px",width:"100%",display:deckPdf.state==="ready"?"none":"block"}}>
          {/* The stacked function lines that sat here are gone — each function's own header already
              carries its type, date, venue and shift, so this was the same information twice, once
              before you reached anything. */}
          {/* Per-function blocks */}
          {csData.functions.map((fnObj,fi)=>(
            <div key={fi} className="cs-glass" style={{borderRadius:14,marginBottom:20,overflow:"hidden"}}>
              {/* Function header */}
              {/* Translucent, so the header belongs to the pane instead of being a solid lid on top
                  of it — in the reference the band and the glass are one surface and the wash keeps
                  moving behind both. Still dark enough to carry the gold figure and the pale caps:
                  0.88 at its lightest, which is well past the contrast the text needs. */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 20px",background:"linear-gradient(135deg,rgba(26,26,46,0.94),rgba(45,27,105,0.88))",color:"#fff"}}>
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
                // textS is the theme's SECONDARY grey, and it was chosen when this sat on white. On the
                // tinted glass it has almost nothing to push against — a mid grey on a violet-grey
                // pane is the same value twice. Violet ink instead: same hue family as the ground, far
                // enough down it to read. The heading takes the darker of the two because it is the
                // line someone scanning the sheet needs to catch.
                <div style={{padding:"32px 20px",textAlign:"center"}}>
                  <div style={{fontSize:14,fontWeight:700,marginBottom:6,color:isDark?"#CFC9E8":"#332A56"}}>Design pending</div>
                  <div style={{fontSize:11,color:isDark?"#A9A1C9":"#554A7D"}}>Zones for this function have not been built yet — it will appear in the PPT as a placeholder slide.</div>
                </div>
              ):(
                <>
                  {/* ═══ ZONES AS CARDS ═══
                      The photograph is what this page is for — it is the same image the deck is
                      built from — so it leads, and the pricing detail waits behind a tap. It used
                      to be the other way round: a thin header, then the photo, then two tables per
                      zone, which meant scrolling past a full cost breakdown to see the next photo.
                      Cost is not on the card face on purpose. This screen gets turned toward a
                      client, and a wall of zone totals is not what you want facing them. */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:14,padding:"14px 18px"}}>
                  {fnObj.zones.map((z,zi)=>{
                    const zKey=`${fi}-${z.k}`, zOpen=!!csOpenZones[zKey];
                    return (
                    <Fragment key={z.k}>
                      {/* The closed border is white, not the theme's grey rule. With the fill this
                          close to clear the border IS the tile, and a grey line over a violet wash
                          reads as a smudge rather than an edge. Open still takes the gold, because
                          that is state and state should win. */}
                      <div onClick={()=>toggleZoneCard(zKey)} className="sm-zcard cs-tile" role="button" tabIndex={0}
                        onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggleZoneCard(zKey);}}}
                        title={zOpen?"Hide the costing":"Show the costing"}
                        style={{cursor:"pointer",borderRadius:12,overflow:"hidden",border:`1px solid ${zOpen?accentText:(isDark?"rgba(255,255,255,0.14)":"rgba(255,255,255,0.9)")}`}}>
                        {z.photo
                          ? <img src={z.photo} alt={z.label} style={{width:"100%",aspectRatio:"4 / 3",objectFit:"cover",display:"block",background:isDark?"#0A0A14":"#F3EFE9"}} onError={e=>{e.target.style.display="none"}}/>
                          : <div className="cs-tile-ph" style={{width:"100%",aspectRatio:"4 / 3",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,background:isDark?"#0A0A14":"#F3EFE9",color:textS}}>{z.icon||"📦"}</div>}
                        {/* Tighter now that the card itself carries 7px — the two paddings used to
                            stack into a band of empty glass under every photograph. */}
                        <div style={{padding:"8px 4px 2px",display:"flex",alignItems:"center",gap:7}}>
                          <div style={{fontSize:13,fontWeight:700,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{z.icon} {z.label}</div>
                          <span style={{marginLeft:"auto",fontSize:10,color:textS,flexShrink:0}}>{zOpen?"▲":"▼"}</span>
                        </div>
                      </div>
                      {/* Full width, so the item table keeps the room it needs. Grid auto-placement
                          drops it onto the row under the card it belongs to. */}
                      {zOpen&&<div style={{gridColumn:"1/-1",borderRadius:12,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#FBFAF7",overflow:"hidden"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 18px",background:isDark?"rgba(201,169,110,0.04)":"#F9F7F3"}}>
                        <div><div style={{fontSize:14,fontWeight:700}}>{z.icon} {z.label}</div>{z.dimLabel&&<div style={{fontSize:11,color:textS,marginTop:2}}>{"📐"} {z.dimLabel}</div>}</div>
                        <div style={{fontSize:16,fontWeight:700,color:accentText}}>{fmt(z.zoneTotal)}</div>
                      </div>
                      {z.photoName&&<div style={{fontSize:10,color:textS,padding:"6px 18px 0"}}>Reference: {z.photoName}</div>}
                      {/* Structure items (not editable) */}
                      {z.structItems.length>0&&<div style={{padding:"8px 18px",borderTop:`1px solid ${border}`}}>
                        {z.structItems.map((si,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12,color:textS,fontStyle:"italic"}}><span>{si.name}</span><span style={{fontWeight:600}}>{fmt(si.total)}</span></div>)}
                      </div>}
                      {/* Editable items table */}
                      {z.items.length>0&&<div style={{padding:"0 18px 12px",borderTop:`1px solid ${border}`}}>
                        <div className="sm-costgrid" style={{display:"grid",gridTemplateColumns:"2.5fr 0.8fr 1fr 1.2fr 1.5fr",gap:0,padding:"8px 0 4px",borderBottom:`1px solid ${border}`,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,color:textS,fontWeight:600}}>
                          <div>Item</div><div style={{textAlign:"center"}}>Size</div><div style={{textAlign:"center"}}>Qty</div><div style={{textAlign:"right"}}>Rate</div><div style={{textAlign:"right"}}>Amount</div>
                        </div>
                        {z.items.map((it,ii)=>(
                          <div key={ii} className="sm-costgrid" style={{display:"grid",gridTemplateColumns:"2.5fr 0.8fr 1fr 1.2fr 1.5fr",gap:0,padding:"6px 0",borderBottom:`1px solid ${isDark?"rgba(255,255,255,0.04)":"#F3EDE4"}`,alignItems:"center",fontSize:12}}>
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
                      </div>}
                    </Fragment>
                    );
                  })}
                  </div>
                  {/* The Transport & Power line is off this screen. It is still CHARGED — it is part
                      of the function total above and of every export — it is simply not itemised
                      here any more. The full truck-by-truck split lives in Build and Deal Check. */}
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

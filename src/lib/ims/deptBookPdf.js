// ═══ Rendering the department production book to a PDF ═══
// Ported out of DepartmentOpsTab.jsx's own `exportPdf` closure, minus the two things that stay
// caller-side: the "carpet/fabric choice not made" gate (it needs to confirm() a dialog and, for
// a dept head, navigate to the panel that makes the decision — neither of which this module should
// know about) and the "View deck" result cache (a dept-head-only convenience, not needed for a
// first-cut Site Supervisor download). Everything else — the offscreen iframe per department pass,
// font loading, the block-by-block paginator, the HTML fallback on failure — is unchanged.
import { ZONE_DEF_SK } from "../studio/keys";
import { LOGO_ASSET, LOGO_BOX } from "../studio/brand.js";
import { HI_FONT_FAMILIES } from "./pdfI18n";
import { kvGet } from "./kv";
import { loadHindiNames, ensureHindiNames } from "./hindiNames";

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
// The logo never changes between exports, so it is cropped and recoloured once per session.
let pdfLogosOnce = null;
export const loadPdfLogosOnce = () => (pdfLogosOnce ||= loadPdfLogos());

// ── jsPDF + html2canvas, FETCHED ONCE AND KEPT ──
// They are split into their own chunk, fetched on first use. A deploy replaces every hashed file on
// GitHub Pages, so a tab opened before it asks for a chunk name that no longer exists — "Failed to
// fetch dynamically imported module", and the export fell through to the HTML download. A module
// once loaded is held by the browser for the life of the page, so a later deploy can no longer
// break the buttons. A failed fetch is not cached, so the next press tries again.
let pdfLibsOnce = null;
export const loadPdfLibs = () => (pdfLibsOnce ||= Promise.all([import("jspdf"), import("html2canvas")]).catch((e) => { pdfLibsOnce = null; throw e; }));
// Chrome / Firefox / Safari each word the missing-chunk failure differently.
export const isStaleChunk = (e) => /dynamically imported module|Importing a module script failed/i.test(String(e?.message || e));
export const reloadForUpdate = () => { alert("Ambria was just updated. The page will reload — press the button again once it has."); window.location.reload(); };

// ── WHY EXPORTED TEXT SAT LOW, AND THE FIX ──
// html2canvas 1.4.1 draws each run of text at `bounds.top + baseline`, where the baseline comes
// from its FontMetrics — measured in the GLOBAL `document` (the app page), not in the report's
// iframe where the webfonts actually live, then rounded to whole px and padded by a hard-coded
// +2. So every line of text in the PDF landed 1–3px below where the browser draws it on a test
// machine, and ~5px on the owner's (it depends on which fonts the app page has and on zoom).
// The cure is to correct it where it happens: while an export runs, fillText on html2canvas's own
// (detached) canvases is shifted by the exact difference between the baseline html2canvas
// computed — recomputed here the same way it does — and the true one measured in the report doc.
// Returns the restore function; it MUST be called when the export ends.
const H2C_TINY_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
export const fixH2cTextBaseline = (reportDoc) => {
  const proto = window.CanvasRenderingContext2D?.prototype;
  if (!proto || !reportDoc?.body) return () => {};
  const orig = proto.fillText;
  const cache = new Map();
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
        if (Number.isFinite(drawn) && Number.isFinite(truth) && Math.abs(truth - drawn) < 12) dy = truth - drawn;
      }
    } catch { dy = 0; }
    cache.set(font, dy);
    return dy;
  };
  proto.fillText = function (text, x, y, ...rest) {
    const dy = this.textBaseline === "alphabetic" && this.canvas && !this.canvas.isConnected ? shift(this.font) : 0;
    return orig.call(this, text, x, y + dy, ...rest);
  };
  return () => { proto.fillText = orig; };
};

// ── THE DOWNLOAD ──
// Renders the report offscreen, turns it into an A4 PDF and saves it (or, with `view: true`,
// returns a blob URL instead of saving). `buildHtml(zoneLabels, zoneAdminOrder, logos, opts)` is
// the caller's own thin wrapper around `buildDeptBookHtml` — this function supplies the first two
// arguments (fetched here, same as before) and the `opts` each pass needs; the caller supplies
// everything else (`sel`, `inventory`, department-scoped data, ...) already closed over.
// Never throws: a failure falls back to an HTML download of the same content, same as before.
export async function renderDeptBook({ buildHtml, lang, multi, dept, depts, sel, selDateStr, view = false, onNote }) {
  // Zone names as the admin set them in Studio (e.g. "Centre Lounge"), not the raw keys. A failed
  // read just falls back to the built-in names (and to null → ZONE_META's own keys for the order).
  const zoneLabels = {};
  let zoneAdminOrder = null;
  try {
    let v = await kvGet(ZONE_DEF_SK);
    for (let i = 0; i < 2 && typeof v === "string"; i++) { try { v = JSON.parse(v); } catch { break; } }
    Object.entries(v?.meta || {}).forEach(([k, m]) => { if (m?.label) zoneLabels[k] = m.label; });
    if (v?.meta && typeof v.meta === "object") zoneAdminOrder = Object.keys(v.meta);
  } catch { /* built-in names it is */ }
  const logos = await loadPdfLogosOnce();
  // The Hindi book prints data names in Devanagari (lib/ims/hindiNames): the known ones, read once per export. Never throws.
  const hiNames = lang === "hi" ? await loadHindiNames() : null;
  let frame = null;
  let restoreFillText = null;
  let ok = false;
  const skipped = [];
  let photoless = 0;
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
    const MARGIN = 28;
    const usableW = pageW - MARGIN * 2;
    const usableH = pageH - MARGIN * 2;
    let blocksSeen = 0;
    const coverPages = new Set();

    // ── ONE PASS PER DEPARTMENT, ALL INTO THE SAME FILE ──
    // "All departments" is ONE combined, zone-wise book (owner ask) — not several books back to
    // back — so it is a single pass with every department's items on each zone page.
    const passes = multi ? ["__combined__"] : depts;
    for (let di = 0; di < passes.length; di++) {
      if (multi) onNote?.("All departments — combined");
      // Hindi: a first build only to note the names not in Devanagari yet, which are asked for (~20s cap, cached for
      // every later book), then the real build. A name that could not be done prints in English.
      if (hiNames) {
        const miss = new Set();
        buildHtml(zoneLabels, zoneAdminOrder, logos, { combined: multi, lang, names: hiNames, collect: miss });
        if (miss.size) {
          onNote?.("Hindi names…");
          try { await ensureHindiNames([...miss], hiNames); } catch { /* the names stay English */ }
          onNote?.(multi ? "All departments — combined" : "");
        }
      }
      const html = buildHtml(zoneLabels, zoneAdminOrder, logos, { combined: multi, lang, names: hiNames });
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
            ...(lang === "hi" ? [
              doc.fonts.load('400 11px "Noto Sans Devanagari"', "कि"),
              doc.fonts.load('600 11px "Noto Sans Devanagari"', "कि"),
              doc.fonts.load('700 11px "Noto Sans Devanagari"', "कि"),
              doc.fonts.load('600 16px "Noto Serif Devanagari"', "कि"),
              doc.fonts.load('700 38px "Noto Serif Devanagari"', "कि"),
            ] : []),
          ]), 3000);
        } catch { /* fallback stack is fine */ }
      }
      if (doc.fonts?.ready) { try { await doc.fonts.ready; } catch { /* font API absent — the fallback stack is fine */ } }
      // ── THE DEVANAGARI FACES IN THIS PAGE TOO ── html2canvas draws onto a canvas of THIS document, each word at
      // the spot the report laid it out. With the Noto faces loaded only in the report's iframe, the canvas drew
      // Hindi in a wider system face, every word ran over the space after it and the spacing vanished. The house
      // fonts already load here through the app's own CSS; these are added once.
      if (lang === "hi") {
        if (!document.querySelector('link[data-pdf-hi-fonts]')) {
          const l = document.createElement("link");
          l.rel = "stylesheet";
          l.href = "https://fonts.googleapis.com/css2?display=swap" + HI_FONT_FAMILIES;
          l.setAttribute("data-pdf-hi-fonts", "");
          document.head.appendChild(l);
          await capped(new Promise(r => { l.onload = r; l.onerror = r; }), 3000);
        }
        if (document.fonts?.load) {
          try {
            await capped(Promise.all(["400 11px", "600 11px", "700 11px"].map(w => document.fonts.load(`${w} "Noto Sans Devanagari"`, "कि"))
              .concat(["600 16px", "700 38px"].map(w => document.fonts.load(`${w} "Noto Serif Devanagari"`, "कि")))), 3000);
          } catch { /* the system Devanagari face is the fallback */ }
        }
      }

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
        // already drawn was still copied each time. A drawn block is now hidden: it has no
        // layout, so this block's position is still read correctly, and the hidden ones are left
        // out of the clone as well.
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
        // those threw out of the loop and the entire export failed. Skipped blocks are counted
        // and reported at the end instead.
        // ── SAFARI'S CANVAS MEMORY ──
        // Safari caps the TOTAL memory all live canvases may hold, and every block here is a
        // full-width canvas at 2x (a zone page is ~14 MB). Each canvas is now emptied the moment
        // its JPEG is taken (width/height 0 is what makes Safari hand the memory back), and a
        // block that still fails is retried at a lower scale before it is given up on.
        const freeCanvas = (c) => { try { if (c) { c.width = 0; c.height = 0; } } catch { /* already gone */ } };
        let img = null, canvas = null, lastErr = null;
        // ── SPEED ──
        // html2canvas clones the WHOLE document for every call, photos and all. ignoreElements
        // leaves the blocks AFTER this one out of the clone — only the ones after: html2canvas
        // crops at this block's position in the real page, so dropping a block above it would
        // shift it up and capture the wrong strip.
        const ignoreElements = (n) => blockSet.has(n) && !n.contains(el) && !el.contains(n) && (n.style.display === "none" || !!(el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
        // Each scale in turn, then — as a last resort — the section again WITHOUT its photos: a
        // section missing its photo is still the crew's list of what goes where; a section missing
        // altogether is not. Photos are stripped in html2canvas's own copy (onclone), never here.
        const tries = [...SCALES.map(sc => ({ scale: sc, strip: false })), { scale: SCALES[SCALES.length - 1], strip: true }];
        for (let ti = 0; ti < tries.length; ti++) {
          const { scale, strip } = tries[ti];
          const onclone = strip ? (cdoc) => {
            cdoc.querySelectorAll("[data-bg]").forEach(n => { n.style.backgroundImage = "none"; });
            const st = cdoc.createElement("style"); st.textContent = "*{background-image:none!important}";
            (cdoc.head || cdoc.documentElement).appendChild(st);
            cdoc.querySelectorAll("img").forEach(im => { if (!String(im.getAttribute("src") || "").startsWith("data:")) im.style.visibility = "hidden"; });
          } : undefined;
          try {
            canvas = await html2canvas(el, { scale, backgroundColor: "#F4F1EA", logging: false, useCORS: true, windowWidth: 794, ignoreElements, onclone });
          } catch (blockErr) { lastErr = blockErr; canvas = null; await new Promise(r => setTimeout(r, 80)); continue; }
          if (!canvas.width || canvas.height < 4) break;
          try {
            img = canvas.toDataURL("image/jpeg", 0.85);
            if (strip) photoless += 1;
            break;
          } catch (taintErr) {
            lastErr = taintErr; freeCanvas(canvas); canvas = null;
            if (!strip) ti = tries.length - 2;
          }
        }
        if (!img) {
          if (canvas) { freeCanvas(canvas); continue; }
          console.error("PDF: skipped a block that failed to render", el.className || el.tagName, lastErr);
          skipped.push({ what: el.className || el.tagName, why: String(lastErr?.message || lastErr || "unknown") });
          continue;
        }
        const h = (canvas.height * usableW) / canvas.width;
        freeCanvas(canvas); canvas = null;
        if (el.hasAttribute("data-cover")) {
          if (!first) newPage();
          pdf.addImage(img, "JPEG", 0, 0, pageW, pageH);
          coverPages.add(pdf.internal.getNumberOfPages());
          y = pageH; afterOwnPage = true; first = false; hasCover = true;
          continue;
        }
        if (isFooter && hasCover && y + h > pageH - MARGIN) continue;
        if (ownPage && h > usableH) {
          const k = usableH / h, w = usableW * k;
          pdf.addImage(img, "JPEG", MARGIN + (usableW - w) / 2, MARGIN, w, usableH);
          y = pageH; afterOwnPage = true; first = false;
          continue;
        }
        if (isFooter && y + h <= pageH - MARGIN) {
          pdf.addImage(img, "JPEG", MARGIN, pageH - MARGIN - h, usableW, h);
          y = pageH;
        } else if (h <= usableH) {
          if (!first && y + h > pageH - MARGIN) { newPage(); y = MARGIN; }
          pdf.addImage(img, "JPEG", MARGIN, y, usableW, h);
          y += h + 10;
        } else {
          // Taller than a whole page — the only case we cut. Walk it down page by page, cutting
          // between rows rather than through them.
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
            if (end < h - 1) { const cut = breaks.filter(b => b > drawn + usableH * 0.2 && b <= end).pop(); if (cut) end = cut; }
            pdf.addImage(img, "JPEG", MARGIN, MARGIN - drawn, usableW, h);
            pdf.setFillColor(244, 241, 234);
            pdf.rect(0, MARGIN + (end - drawn), pageW, pageH, "F");
            pdf.rect(0, 0, pageW, MARGIN, "F");
            drawn = end;
          }
          y = pageH;
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

    // Page numbers, added once the total is known. A cover carries no number — it would sit on
    // the photo — so each page in coverPages is skipped rather than assuming it is page one: a
    // combined book has one cover per department, not only at the front.
    const total = pdf.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      if (coverPages.has(p)) continue;
      pdf.setPage(p);
      pdf.setFontSize(8);
      pdf.setTextColor(122, 116, 104);
      pdf.text(`${String(p).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, pageW - MARGIN, pageH - 12, { align: "right" });
    }

    // Filename carries all three identifiers — what it is called in someone's Downloads folder a
    // month later. Slashes and colons are illegal in filenames on Windows.
    const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
    const fileName = `${safe(multi ? "All departments" : depts[0])} - ${safe(sel?.clientName || "Event")} - ${safe(selDateStr || "no date")}${lang === "hi" ? " (Hindi)" : ""}.pdf`;
    let url = null;
    if (view) { url = URL.createObjectURL(pdf.output("blob")); }
    else pdf.save(fileName);
    ok = true;
    // Said out loud, because a report quietly missing a page is worse than one that failed
    // outright — you would only find out when the crew on site needed the page that is gone.
    if (skipped.length) {
      const why = [...new Set(skipped.map(s => s.why))].slice(0, 2).join(" · ");
      alert(`The PDF ${view ? "is ready" : "saved"}, but ${skipped.length} section${skipped.length === 1 ? "" : "s"} could not be drawn and ${skipped.length === 1 ? "is" : "are"} missing from it.${photoless ? `\n\n${photoless} other section${photoless === 1 ? " is" : "s are"} in it without ${photoless === 1 ? "its" : "their"} photos.` : ""}\n\nReason: ${why}\n\nTry again in Chrome if this keeps happening.`);
    } else if (photoless) {
      alert(`The PDF ${view ? "is ready" : "saved"}. ${photoless} section${photoless === 1 ? " is" : "s are"} in it without ${photoless === 1 ? "its photo" : "their photos"} — this browser would not let them be drawn. Every item and quantity is there.\n\nFor the photos too, download it in Chrome.`);
    }
    return { ok, url, name: fileName };
  } catch (err) {
    // The app was redeployed under this tab: a reload fixes it, the HTML fallback would not.
    if (isStaleChunk(err)) { reloadForUpdate(); return { ok: false }; }
    // ── THE FALLBACK IS A FILE, NOT A POP-UP ──
    // By the time we reach this catch we are many awaits past the click, so the browser no
    // longer counts it as user-initiated and blocks a window.open every time. A Blob download
    // needs no pop-up and leaves something usable: the report as an .html file, which opens in
    // any browser and prints to PDF from there.
    console.error("PDF export failed, falling back to an HTML download:", err);
    // Rebuilds the SAME book the PDF pass was attempting (combined or single-department,
    // whichever `multi` already was) rather than a different, narrower one — a second failure in
    // the same code path that just failed is handled the same way, by the outer catch below. The
    // filename says "partial" so it's never mistaken for a normal, successful export.
    try {
      const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
      const htmlDoc = buildHtml(zoneLabels, zoneAdminOrder, logos, { combined: multi, lang, names: hiNames });
      const blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const label = multi ? "All departments" : dept;
      a.download = `${safe(`${label} (partial — export failed)`)} - ${safe(sel?.clientName || "Event")} - ${safe(selDateStr || "no date")}${lang === "hi" ? " (Hindi)" : ""}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a timer, not immediately: Chrome cancels an in-flight download if the object
      // URL disappears in the same tick as the click.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      alert(`The PDF could not be generated, so the report downloaded as an HTML file instead — open it and print to PDF.\n\nReason: ${err?.message || err}`);
    } catch (fallbackErr) {
      console.error("PDF: the HTML fallback failed too", fallbackErr);
      alert(`Could not produce the report.\n\n${err?.message || err}`);
    }
    return { ok: false };
  } finally {
    restoreFillText?.();
    frame?.remove();
    onNote?.("");
  }
}

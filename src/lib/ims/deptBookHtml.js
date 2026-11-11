// ═══ The department production book's HTML content ═══
// Ported out of DepartmentOpsTab.jsx's own `buildReportHtml` closure so a second caller (the Site
// Supervisor page's "Download PDF (all departments)" button) can build the exact same combined
// book without re-deriving this ~1700-line template a second time. DepartmentOpsTab.jsx itself now
// calls `buildDeptBookHtml` too, instead of keeping a second copy.
//
// Every former free variable this closure read from DepartmentOpsTab.jsx's component scope is now
// a field on the `ctx` object passed in — see `buildDeptBookHtml`'s own destructure for the exact
// list. The dead money/inventory/crew/spend block (`moneyBlock`/`invRows`/`crewRows`/`spendRows` —
// built but never put into the printed template) was dropped during this move, along with the
// `income`/`discount`/`hasActuals`/`actualCost`/`mandiSpend`/`expenses`/`mpRows`/`mpCost`/
// `dayWise`/`lineCost` inputs it alone needed.
import { fmt } from "../format";
import { walkKitUnits, flowerPaletteHexFor } from "./helpers";
import { DEPTS } from "./deptClassify";
import { venueWithParent, standingQty, fixedVenueFor } from "./fixedVenues";
import { ZONE_META, trussBaseArea, CARPET_OFF, carpetPricingFor, carpetTakesStockPick } from "../studio/taxonomy";
import { prefsOf, floorSqftOf } from "../studio/carpetPrefs";
import { carpetKey, carpetStockFor, validDecision, carpetNotesForRows, carpetPrefNotesForRows } from "./carpetPlan";
import { elementStockFor, elementKey, choiceNotesForRows, preferenceNotesForRows } from "./elementPlan";
import { loadOnDate } from "./loadByDate";
import { elementChoices } from "../studio/elementPrefs";
import { orderZoneKeys } from "./zoneOrder";
import { calcZoneFabric, dcFabricMultOf, repeatCatFor, trussInvForMaterial, parseFlowerPalette, parseFabricPalette } from "../studio/pricing";
import { resolveBeamSegment, resolvePillarHeight } from "./trussEngine";
import { fitUrl } from "../studio/thumb.js";
import { matchFlowerPattern, resolveSizeKey, sizeClassToPatternKey, resolveMandiFlower } from "./flowerHelpers";
import { swatchHexFor } from "../studio/colours";
import { buildFabricGroups } from "./fabricGroups";
import { mandiHow } from "./floralHow";
import { buildEventSwap, swappedRecipeFlower } from "./mandiSwap";
import { realLineTaker } from "./floralBook";
import { pdfT, pdfUnit, pdfDate, pdfDateTime, hindiReportHtml, HI_FONT_FAMILIES } from "./pdfI18n";
import { nameKey, normName, needsHindi } from "./hindiNames";
import { toHindi } from "./hindiTranslit";
import { splitCrewByDept } from "./crewSplit";
import { gensetsForFn, totalKva } from "./gensetPlan";

// ── THE ZONE PAGE'S DOT TILE, AS A PNG ──
// The faint gold dot grid behind each zone page was an SVG data URL. Older WebKit (iOS 14 and
// below, still on the crew's older phones) taints a canvas the moment an SVG image is drawn into
// it, so html2canvas could draw the page but toDataURL then threw "The operation is insecure" —
// for every zone page, photos or not, since the dots are on all of them. A PNG tile drawn here
// looks the same and never taints. Drawn at 2x and shown at 18px so it stays crisp at the export's
// 1.5x scale. Falls back to the SVG if a canvas is unavailable.
const DOT_TILE_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Ccircle cx='3' cy='3' r='1.1' fill='%23B8935A' fill-opacity='.32'/%3E%3C/svg%3E";
let dotTileOnce = null;
export const dotTileUrl = () => {
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

// ── Paint / print, as the build asked for them ──
// Neither survives Deal Check's department snapshot: a held row is only "Wooden Arch x6", and the
// print row only "🖨 Print / signage" with a count of jobs. The build itself (functionsDetail) still
// carries both — each element's paintAllocation (or the legacy single paintOverride) and each
// zone's prints — so the inventory list and the PDF read them from there.
// Paint is the same rule Studio's normalizePaintAllocation uses: a colour equal to the item's own
// base colour (Ivory when unset) is no repaint. It is keyed by inventory id and by name, matched
// to a held row the same way invFnQty matches quantities.
export const paintText = (m) => (m ? [...m].map(([c, q]) => `${c} ×${q}`).join(", ") : "");
export const elPaint = (el, inv) => {
  const base = String(inv?.baseColour || "Ivory");
  const allocs = Array.isArray(el?.paintAllocation) && el.paintAllocation.length
    ? el.paintAllocation.map(a => ({ qty: Number(a?.qty) || 0, colour: String(a?.colour || "") }))
    : el?.paintOverride ? [{ qty: Number(el?.qty) || 0, colour: String(el.paintOverride) }] : [];
  return allocs.filter(a => a.qty > 0 && a.colour && a.colour !== base);
};
export const addPaint = (m, allocs) => { allocs.forEach(a => m.set(a.colour, (m.get(a.colour) || 0) + a.qty)); return m; };
export function buildFinish(fnList, inventory, printMaterials) {
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

// Builds the production book's HTML — called once per export: one pass with `combined: true` for
// the "All departments" book (dept-agnostic — see the module comment up top), or once per
// department for a single-department book. Ported verbatim out of DepartmentOpsTab.jsx's own
// `buildReportHtml` closure; every former free variable is now read off `ctx` instead, so this
// function has no dependency on which department tab happens to be open in that component.
export function buildDeptBookHtml(ctx, zoneLabels = {}, logos = {}, opts = {}) {
  const {
    dept, sel, inventory, blocks, settings, trussInv, catToDept, authUser,
    flowerPatterns, mandiCatalogue, floralModeBySub, fvSettings, trVenues,
    blockedItemsGrouped = [], blockedItems = [], trucks = [], movements = [], fabricReqRows = [],
    trussPlanOf, fabricEntriesOf, fabricPalettesOf, carpetPlanOf, elementPlanOf, zoneLabelFor,
    zoneAdminOrder, dealCheckMode, preparedBy,
  } = ctx;
  // Mirrors DepartmentOpsTab.jsx's own `venueOf`/`eventDate` — kept local rather than added to ctx
  // since both are one-line derivations of `sel`/`settings` already in scope.
  const venueOf = (eo) => venueWithParent(settings, eo?.functionsDetail?.[0]?.venue || eo?.venue || "");
  const selDateStr = sel ? (sel?.functionsDetail?.[0]?.date || sel?.date || sel?.eventDate || "") : "";
    const combined = !!opts.combined;
    // The book's language (Planning's EN | हिं toggle). Every word the book prints goes through t(); data does not.
    const lang = opts.lang === "hi" ? "hi" : "en";
    const t = pdfT(lang);
    // hn(): a DATA name (item, zone, colour, flower, client, venue…) in the Hindi book is printed in Devanagari as the
    // crew says it (lib/ims/hindiNames - opts.names, key → Hindi). A name not known yet prints as it is and is noted in
    // opts.collect, so the export can ask for it and build again; meanwhile it is spelled offline (lib/ims/hindiTranslit), so the
    // book is Hindi even when the AI cannot answer. English: the name exactly as given.
    const nameMap = opts.names instanceof Map ? opts.names : null;
    const nameMiss = opts.collect instanceof Set ? opts.collect : null;
    const hn = (s) => {
      if (lang !== "hi" || s == null || s === "" || !needsHindi(s)) return s;
      const hi = nameMap && nameMap.get(nameKey(s));
      if (hi) return hi;
      if (nameMiss) nameMiss.add(normName(s));
      return toHindi(s);
    };
    // A size ("5 × 12 inches") with its unit word in Hindi - not a name, so not asked of the AI.
    const hd = (d) => lang === "hi" ? toHindi(d) : d;
    // A unit after a quantity ("1.5 bundle") in the book's language - lib/ims/pdfI18n's fixed list, a unit not in it as given.
    const hu = (u) => pdfUnit(lang, u);
    // A paint line ("Gold ×2, Silver ×1") with each colour through hn().
    const paintHn = (txt) => lang !== "hi" ? txt : String(txt || "").split(", ").map(part => part.replace(/^(.*) ×(\S+)$/, (m, c, q) => `${hn(c)} ×${q}`)).join(", ");
    const bookTitle = combined ? t("All departments") : t(dept);
    // Anything that reaches the page goes through this first. The values are client names,
    // venues, crew types and item names typed by staff in Studio — an apostrophe or a stray
    // "<" in one of them would otherwise break the markup or inject into it.
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const money = (v) => esc(fmt(Math.round(Number(v) || 0)));
    // data-block marks a unit the paginator will try to keep on one page. Sections are the
    // natural unit: a heading stranded at the foot of a page with its table overleaf is the
    // single thing that makes a generated report look generated.
    // S / M / B spelled out: a lone "S" on a card is a letter, "Small" is an instruction.
    const SMB_LABEL = { S: t("Small"), M: t("Medium"), B: t("Big") };
    // "1st choice" … for a ranked preference (carpets, overlay / cushion cover designs).
    const CHOICE_LBL = [t("1st choice"), t("2nd choice"), t("3rd choice"), t("4th choice")];
    const choiceLbl = (i) => CHOICE_LBL[i] || t("{n}th choice", { n: i + 1 });
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

    const venue = venueOf(sel) || "—";

    /* Inventory, with each kit's components indented beneath it — the components sum to the kit
       line, which is the one comparison this section exists to support. */
    const finish = buildFinish(sel?.functionsDetail, inventory, settings?.printMaterials);
    // finish.printLine with its one English word ("on") through t(); the English book keeps finish's own line.
    const printLineT = (p) => lang !== "hi" ? finish.printLine(p)
      : `${hn(p.material)} · ${p.size}${p.qty > 1 ? ` ×${p.qty}` : ""}${p.on ? ` ${t("on {item}", { item: hn(p.on) })}` : ""} — ${hn(p.zone)}${p.fn ? ` (${hn(p.fn)})` : ""}`;

    const truckRows = trucks.map((tk, i) =>
      `<tr><td>${t("Truck {n}", { n: i + 1 })}</td><td>${esc(tk.vehicle || "—")}</td><td>${esc(tk.driver || "—")}</td><td>${esc(tk.phone || "—")}</td><td>${esc(tk.status || "—")}</td></tr>`);

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
    if (!dealCheckMode) elementPlanOf().rows.forEach(r => {
      if (!r.other && (!r.decidedId || r.decidedId === r.prefs[0]?.id)) return;
      const nm = r.other ? t("arranged separately") : ([...r.options, r.manual].filter(Boolean).find(o => o.id === r.decidedId) || {}).name || t("another design");
      const k = String(r.prefs[0]?.id);
      decidedInstead.set(k, [...(decidedInstead.get(k) || []), `${hn(nm)} × ${r.qty}`]);
    });
    const loadRows = blockedItems.map(it => {
      const paint = finish.paintFor(it);
      const sub = (it.kitOf ? `<div class="sub">${t("part of {kit}", { kit: esc(hn(it.kitOf)) })}</div>` : "")
        + (it.invId && decidedInstead.has(String(it.invId)) ? `<div class="sub">${t("Planning chose instead: {list}", { list: esc(decidedInstead.get(String(it.invId)).join(", ")) })}</div>` : "")
        + (paint ? `<div class="sub">${t("Paint: {paint}", { paint: esc(paintHn(paint)) })}</div>` : "")
        + (it.sub === "print" ? finish.prints.map(p => `<div class="sub">${esc(printLineT(p))}</div>`).join("") : "");
      return `<tr><td>${esc(hn(it.name))}${sub}</td><td class="n b">${esc(it.qty)}</td></tr>`;
    });

    const moveRows = movements.map(m =>
      `<tr><td>${esc(hn(m.name))}</td><td>${esc(m.type === "transfer" ? t("Transfer → {to}", { to: hn(m.toEventName) || t("site") }) : m.type === "damage" ? t("Damaged") : t("Back to production house"))}</td><td class="n">${esc(m.qty)}</td><td>${esc(m.by || "—")}</td></tr>`);

    const fabRows = dept === "Fabric" ? fabricReqRows.flatMap(ft => ft.rows.map(r =>
      `<tr><td>${esc(t(ft.label))} · ${r.colour && r.colour !== "(unassigned)" ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;border:1px solid rgba(0,0,0,.18);background:${esc(r.hex)};margin-right:5px;vertical-align:middle"></span>` : ""}${esc(r.colour === "(unassigned)" ? t("(unassigned)") : hn(r.colour))}</td><td class="n">${esc(r.required)} ${esc(hu(ft.unit))}</td><td class="n">${esc(r.avail)} ${esc(hu(ft.unit))}</td><td class="n ${r.short > 0 ? "bad" : "ok"}">${r.short > 0 ? t("short {n}", { n: `${esc(r.short)} ${esc(hu(ft.unit))}` }) : t("ok")}</td></tr>`)) : [];

    // ── ARTIFICIAL FLOWERS & GREENS ── the bunches the Floral book sends out, worked to kilos the way Deal Check does it (bunches ÷ bunches per kg),
    // and the specific colours to pull. Per function when the event has more than one (floralDetail), then the whole event. No rupees: this book is for the crew.
    // Floral book only: the all-departments book carries no flower sections (owner ask) - its Mandi & Kits pages list kits only.
    const artPlan = !combined && dept === "Floral" ? sel?.floralPlan?.artificial : null;
    // Artificial flowers and greens go out in whole bunches - 10.4 is 11 to pull (owner ask 2026-10-31). Only these two are
    // rounded; the mandi flowers in a recipe keep their decimals. Rounded to 2 places first so a float like 10.000000001 stays 10.
    const artBunches = (n) => Math.ceil(Math.round((Number(n) || 0) * 100) / 100);
    const artRows = [], artColourRows = [];
    if (artPlan && ((Number(artPlan.flowerBunches) || 0) > 0 || (Number(artPlan.greenBunches) || 0) > 0)) {
      const artRow = (label, bunches, bpk, kg) => `<tr><td>${esc(label)}</td><td class="n">${esc(bunches)}</td><td class="n">${esc(bpk)}</td><td class="n">${esc(kg)} kg</td></tr>`;
      const fd = sel?.floralDetail && typeof sel.floralDetail === "object" ? sel.floralDetail : {};
      const fdKeys = Object.keys(fd).sort((a, b) => Number(a) - Number(b));
      // Whole bunches: a function's total adds up each arrangement's own bunches, each rounded up (artBunches) - the same
      // figures the zone pages print under each arrangement, so the two cannot disagree. A function synced before artZones
      // existed keeps Deal Check's own total, rounded up.
      const fnBunches = (f, kind) => Array.isArray(f?.artZones) && f.artZones.length
        ? f.artZones.reduce((t, a) => t + artBunches(a[kind]), 0)
        : artBunches(f?.art?.[kind]?.bunches);
      const kgOf = (b, bpk) => (Number(bpk) > 0 ? Math.round(b / bpk * 100) / 100 : 0);
      const fnRows = fdKeys.map(k => ({ k, f: fd[k] || {}, fl: fnBunches(fd[k], "flower"), gr: fnBunches(fd[k], "green") }));
      const multi = fnRows.filter(r => r.fl > 0 || r.gr > 0).length > 1;
      if (multi) fnRows.forEach(({ k, f, fl, gr }) => {
        const tag = [hn(f.fnType) || t("Function {n}", { n: Number(k) + 1 }), f.fnDate].filter(Boolean).join(" · ");
        if (fl > 0) artRows.push(artRow(`${tag} — ${t("Flower bunches")}`, fl, `${artPlan.flowerBPK} / kg`, kgOf(fl, artPlan.flowerBPK)));
        if (gr > 0) artRows.push(artRow(`${tag} — ${t("Green bunches")}`, gr, `${artPlan.greenBPK} / kg`, kgOf(gr, artPlan.greenBPK)));
      });
      const allFl = fnRows.length ? fnRows.reduce((s, r) => s + r.fl, 0) : artBunches(artPlan.flowerBunches);
      const allGr = fnRows.length ? fnRows.reduce((s, r) => s + r.gr, 0) : artBunches(artPlan.greenBunches);
      if (allFl > 0) artRows.push(artRow(multi ? `${t("All functions")} — ${t("Flower bunches")}` : t("Flower bunches"), allFl, `${artPlan.flowerBPK} / kg`, kgOf(allFl, artPlan.flowerBPK)));
      if (allGr > 0) artRows.push(artRow(multi ? `${t("All functions")} — ${t("Green bunches")}` : t("Green bunches"), allGr, `${artPlan.greenBPK} / kg`, kgOf(allGr, artPlan.greenBPK)));
      (Array.isArray(artPlan.colorSplit) ? artPlan.colorSplit : []).forEach(c => artColourRows.push(`<tr><td>${esc(hn(c.name) || t("Artificial bunch"))}</td><td class="n">${esc(c.qty)}</td></tr>`));
    }

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
    // The truss chip prints the PHYSICAL footprint (owner ask 2026-11-03), never the customer-demand size: the same figure as
    // Planning's "Physical footprint" tile (topology.physicalL / physicalW; a single-U has no depth), with the Tenting head's
    // own edit of it (deptOps.Tenting.trussPlan[key].physical) winning. A zone with no worked-out truss keeps its saved size.
    const physDimsByZone = new Map();
    try {
      const tentingPlanP = sel?.deptOps?.Tenting?.trussPlan || {};
      trussPlanOf().forEach(z => {
        if (z.ri !== 0 || physDimsByZone.has(`${z.fi}|${z.zk}`)) return;
        const topo = z.pv?.topology || {};
        const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
        const H = parseFloat(z.row?.dims?.H) || 0;
        const base = z.pv?.config === "u_only" ? { W: r2(topo.physicalL), H } : { W: r2(topo.physicalW), D: r2(topo.physicalL), H };
        const v = { ...base, ...((tentingPlanP[z.key] || {}).physical || {}) };
        const parts = [["W", v.W], ["D", v.D], ["H", v.H]].filter(([, x]) => Number(x) > 0);
        if (Number(v.W) > 0 && parts.length) physDimsByZone.set(`${z.fi}|${z.zk}`, parts.map(([k, x]) => `${k} ${x}`).join(" × ") + " ft");
      });
    } catch { /* the saved size it is */ }
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
    const trussTypeLbl = (tt) => tt === "box" ? t("Box") : tt === "singleU" ? t("Single U") : (tt ? String(tt) : "");
    // "1ft-3ft" is a flat rate band, not one fixed height — hft (zc.plHft, Build's own "Exact ht"
    // picker) is the salesperson's actual stand height within that band, shown in parens so ops
    // knows exactly what to build rather than just "somewhere between 1 and 3 feet".
    const platLbl = (h, hft) => h === "4in" ? '4"' : h === "1ft" ? t("Raised {n}ft", { n: Number(hft) > 0 ? hft : 1 }) : (h ? String(h) : "");
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
          name: "🖨 " + t("Print") + " · " + (printName(p.material) || "—"), shown: "🖨 " + t("Print") + " · " + (hn(printName(p.material)) || "—"), qty: q, unit: "pc",
          photo: /^https?:\/\//i.test(ref) ? ref : "", dims: `${w} x ${d} ft`, kit: 0, recipe: [],
          deptTag: combined ? "Structure" : "",
          extra: [[t("Area"), `${area} sqft${q > 1 ? " " + t("total") : ""}`], ...(on ? [[t("On"), hn(on.name)]] : [])],
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
        if (dec?.other && !dealCheckMode) {
          // none of the stock carpets could be used: the carpet is bought or hired outside stock
          out.push({ name: t("Carpet arranged separately"), qty: area, unit: "sqft", photo: "", dims: "", kit: 0, recipe: [], deptTag: combined ? "Tenting" : "", _role: t("To use"), _floor: floorTxt,
            extra: [[t("Carpet"), t("To use") + (ri === 0 ? "" : " " + t("(floor {n})", { n: ri + 1 }))], [t("Source"), t("Bought / hired outside stock")], [t("Floor"), floorTxt]] });
          return;
        }
        // No stock carpets ranked (Flex / New / Acrylic, which take no stock pick, or an Old floor nobody ranked): still a card
        // with the material and its sqft - the floor's carpet was missing from the zone page and the book while Deal Check showed it.
        // A carpet Planning picked by hand for such a floor still wins (the chosen path below).
        if (!prefs.length && !(dec?.manual && dec.id && !dealCheckMode)) {
          if (!row.cpT) return;
          out.push({ name: carpetPricingFor(row.cpT, settings?.carpetMaterials).label || carpetName(row.cpT) || t("Carpet"), qty: area, unit: "sqft", photo: row.cpPhoto || "", dims: "", kit: 0, recipe: [],
            deptTag: combined ? "Tenting" : "", _role: t("To lay"), _floor: floorTxt, extra: [[t("Carpet"), t("To lay") + (ri === 0 ? "" : " " + t("(floor {n})", { n: ri + 1 }))], [t("Floor"), floorTxt]] });
          return;
        }
        // Planning's decided carpet once there is one; otherwise sales' 1st choice ONLY - the 2nd/3rd preferences printed as
        // cards of their own read as three carpets to lay (owner ask 2026-10-31). Deal Check's PDF prints the 1st choice too.
        const chosen = dec && !dealCheckMode ? (prefs.find(p => p.id === dec.id) || (dec.manual ? { id: dec.id, name: dec.name } : null)) : null;
        const byHand = !!chosen && !prefs.some(p => p.id === chosen.id);
        const lbl = ri === 0 ? "" : " " + t("(floor {n})", { n: ri + 1 });
        (chosen ? [{ p: chosen, base: byHand ? t("To use (Planning's pick)") : t("To use") }] : prefs.slice(0, 1).map((p, i) => ({ p, base: choiceLbl(i) }))).forEach(({ p, base }) => {
          const role = base + lbl;
          const inv = invById.get(String(p.id));
          out.push({
            name: inv?.name || p.name || t("Carpet"), qty: area, unit: "sqft", photo: invPhoto(inv, null), dims: invDims(inv), kit: 0, recipe: [],
            deptTag: combined ? "Tenting" : "", _role: base, _floor: floorTxt, _key: "inv:" + p.id,
            extra: [[t("Carpet"), role], [t("Floor"), floorTxt]],
          });
        });
      });
      // The same carpet on two floors of the zone (a stage and its side platform, say) is one card, not two (owner ask 2026-11-03):
      // its sqft added up, every floor's size listed, the role said once. A different carpet keeps its own card.
      const merged = [];
      out.forEach(c => {
        const key = c._key || "name:" + c.name;
        const m = merged.find(x => (x._key || "name:" + x.name) === key);
        if (!m) { merged.push({ ...c, _roles: [c._role], _floors: [c._floor] }); return; }
        m.qty += c.qty;
        if (!m._roles.includes(c._role)) m._roles.push(c._role);
        m._floors.push(c._floor);
      });
      return merged.map(({ _role, _floor, _key, _roles, _floors, ...c }) => _floors.length < 2 ? c : ({ // eslint-disable-line no-unused-vars
        ...c,
        extra: (c.extra || []).map(([k, v]) => k === t("Carpet") ? [k, _roles.join(" · ")] : k === t("Floor") ? [k, _floors.join(" + ")] : [k, v]),
      }));
    };
    const zoneStructOf = (z, fi, zk, fn) => {
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
      const truss = hasTruss ? [trussTypeLbl(z.trT), Number(z.trussQty) > 1 ? `x${z.trussQty}` : "", z.trussMaterial ? hn(String(z.trussMaterial)) : ""].filter(Boolean).join(" ") : "";
      if (truss) out.push({ k: t("Truss"), v: truss + (sizedExtra.length ? " " + t("+{n} more", { n: sizedExtra.length }) : "") });
      else if (sizedExtra.length) out.push({ k: t("Truss"), v: t("{n} truss|{n} trusses", { n: sizedExtra.length }) });
      const plats = [
        z.plH ? [platLbl(z.plH, z.plHft), floor].filter(Boolean).join(" · ") : "",
        ...extraPl.map(r => [platLbl(r?.plH, r?.plHft), ftArea(r?.floorDims)].filter(Boolean).join(" · ")),
      ].filter(Boolean);
      if (plats.length) out.push({ k: t("Platform"), v: plats.join("; ") });
      // "— None —" is stored as the CARPET_OFF sentinel: no carpet, so no Carpet chip (it printed "Carpet __off__")
      // Only a carpet that is actually chosen (owner ask 2026-11-03): Build defaults every floor to Carpet Old, so a floor nobody
      // picked a carpet for printed "Carpet Old". A stock carpet (Old) shows once sales picked one in Build or Planning decided
      // one; a New / Flex carpet (not picked from stock) shows when that material is set.
      const hasCarpet = (() => {
        if (!z.cpT || z.cpT === CARPET_OFF) return false;
        if (!carpetTakesStockPick(carpetPricingFor(z.cpT, settings?.carpetMaterials).label)) return true;
        if (prefsOf(z).length > 0) return true;
        return fi != null && !!validDecision(carpetDecided[carpetKey(fi, zk, 0)], { date: fn?.date, fnLabel: fn?.type || fn?.name });
      })();
      if (hasCarpet) out.push({ k: t("Carpet"), v: [hn(carpetName(z.cpT)), floor].filter(Boolean).join(" · ") });
      // No "Masking Yes" chip (owner ask 2026-11-03): the wall masking prints with its colour and pieces in the fabric row.
      if (!z.plH && !hasCarpet && floor) out.push({ k: t("Floor"), v: floor });
      return out;
    };
    // ── THE FABRIC COLOURS ── Liza / Velvet curtain / Wall masking colour of each zone, under the truss size (owner ask 2026-11-01): the
    // colours the Fabric block works out (lib/ims/fabricGroups - Deal Check's allocation, live from Build's Fabric Palette), in the
    // books that put up the truss and its fabric.
    // A fabric colour on the page: its photo from the fabric stock where it has one (owner ask 2026-11-03), else a dot of its colour.
    const colourMark = (name, hex, photo) => photo
      ? `<i class="fph" style="${bgCss(photo, 60)}" ${bgData(photo, 60)}></i>`
      : `<i style="background:${esc(swatchHexFor(name, settings?.colourCatalogue, hex))}"></i>`;
    const fabricByZone = new Map(); // "fi|zk" -> [{ k, html }]
    // The drape density the zone's fabric is worked out at (owner ask 2026-11-03) - each sized truss row's own setting from
    // Build (copied from its photo's library tag), Moderate when unset, the same default the fabric quantities use. Leads the
    // fabric row, so it only shows where there is fabric; two trusses at different densities list both.
    const DRAPE_LBL = { minimum: "Minimum", moderate: "Moderate", dense: "Dense" };
    const withDrape = (fabric, z) => {
      if (!fabric.length || !z) return fabric;
      const rows = [z, ...(Array.isArray(z.extraTrussRows) ? z.extraTrussRows : [])].filter(r => r && (trussBaseArea(r).area || 0) > 0 && r.trussQty !== 0 && !r.noFabric);
      const dens = [...new Set(rows.map(r => String(r.drapeDensity || "moderate").toLowerCase()))].filter(d => DRAPE_LBL[d]);
      return dens.length ? [{ k: t("Drape"), html: esc(dens.map(d => t(DRAPE_LBL[d])).join(" / ")) }, ...fabric] : fabric;
    };
    if (showStruct || dept === "Fabric") {
      try {
        buildFabricGroups({ entries: fabricEntriesOf(), lines: [], fabricPlan: sel?.fabricPlan, stock: trussInv, fnPalettes: fabricPalettesOf() }).groups.forEach(g => {
          g.zones.forEach(z => {
            if (z.fi == null) return;
            const cols = (z.colours || []).filter(c => c.colour && c.colour !== "(unassigned)");
            // Each colour with its quantity, as Planning's Fabric block shows it (owner ask 2026-11-02: one colour used to print with no
            // quantity, so the crew could not tell how much Liza / Velvet the zone takes); no colour picked yet: the zone's own quantity.
            const qtyTxt = (q) => Number(q) > 0 ? ` ${esc(q)} ${esc(hu(g.unit))}` : "";
            const html = cols.length
              ? cols.map(c => `<b class="fpc">${colourMark(c.colour, c.hex, c.photo)}${esc(hn(c.colour))}${qtyTxt(c.qty)}</b>`).join("") + (z.standing ? `<b class="fpc">♻ ${t("Repeat")}</b>` : "")
              : esc(t("Colour not picked")) + (Number(z.qty) > 0 ? ` · <b>${qtyTxt(z.qty).trim()}</b>` : "");
            const key = `${z.fi}|${z.zoneKey}`;
            fabricByZone.set(key, [...(fabricByZone.get(key) || []), { k: t(g.label), html }]);
          });
        });
      } catch { /* the zone pages print without the colours */ }
    }
    // ── REPEAT / FIXED ON AN ITEM ── (owner ask 2026-11-01, like the fabric's ♻ Repeat) the crew sees which items need no fresh
    // pull: ♻ Repeat (the item's own Repeat, else its zone's Elements chip - the rule Studio prices by), ♻ Reused from an EARLIER
    // function of the deal at the same venue the same or the day before (the earlier one is not tagged - it is the one that brings
    // them), and 📌 Fixed when the item is standing stock at this venue.
    const DAY = 24 * 60 * 60 * 1000;
    const normV = (v) => String(v || "").trim().toLowerCase();
    const usedIdsOf = (f) => { const ids = new Set(); const en = f?.enabledEls || {};
      Object.entries(f?.elements || {}).forEach(([zk, list]) => { if (en[zk] === false || !Array.isArray(list)) return; list.forEach(e => { const id = e?.invId || e?.imsId; if (id) ids.add(String(id)); }); });
      return ids; };
    const reuseSourceOf = (fi) => {
      const f = fns[fi]; const d = Date.parse(f?.date || ""); if (!Number.isFinite(d) || !f?.venue) return null;
      const src = fns.map((g, j) => ({ g, j })).filter(({ g, j }) => {
        if (j === fi || normV(g?.venue) !== normV(f.venue)) return false;
        const dd = Math.round((d - Date.parse(g?.date || "")) / DAY);
        return dd === 1 || (dd === 0 && j < fi);
      });
      if (!src.length) return null;
      const ids = new Set(); src.forEach(({ g }) => usedIdsOf(g).forEach(id => ids.add(id)));
      return { ids, label: src.map(({ g }) => g?.type || g?.name || "").filter(Boolean).join(" + ") };
    };
    const itemStatusOf = (fn, reuseSrc, zk, el, inv) => { // eslint-disable-line no-unused-vars
      const out = [];
      // Only a Repeat set by hand on the item in Build (owner ask 2026-11-03) - not the zone's Elements chip nor the automatic
      // reuse from an earlier function, which marked most of a booking "Repeat" without anyone choosing it.
      if (el?.repeatOverride === true) out.push("♻ " + t("Repeat"));
      const standing = inv ? standingQty(fvSettings, fn?.venue, inv.id) : 0;
      // short enough for one line of the card's value column (the long form wrapped and ran out of the card)
      if (standing > 0) out.push("📌 " + t("Fixed · {n} standing", { n: standing }));
      return out.join(" · ");
    };
    // ── TRUSS BREAKDOWN TABLE (pillars/beams/batta by size), on each truss zone's own page ──
    // Owner ask (2026-11-02): the chip above only says "L 12 × W 26 × H 12 ft" — the crew still has
    // to go find the on-screen Truss plan (trussPlanOf, above) to know what to actually cut. This
    // prints that same breakdown directly on the page the crew is holding.
    // Real resolved stock pieces (resolveBeamSegment/resolvePillarHeight), not the ideal pre-stock
    // length — same reasoning as DCTrussTab.jsx's own Pillars/Beams tiles and the on-screen Truss
    // plan card just above (realGroupsOf) — and the SAME dept-head edits that card lets Tenting
    // make. Read from sel.deptOps.Tenting.trussPlan explicitly, not the generic `deptData` (which
    // is whatever department's book is CURRENTLY being built — a combined book cycles through every
    // department in turn, see opts.combined's own comment) — this plan is always Tenting's own, the
    // same reasoning carpetPlanOf's carpetChoice read above already follows.
    // Tenting's own book only (owner ask), not Structure's, even though the structure strip above
    // shows in both.
    const showTrussTable = combined || dept === "Tenting";
    const trussTableByZone = new Map(); // "fi|zk" -> [{ label, pillars, beams, battaRft }]
    if (showTrussTable && trussInv) {
      const tentingPlan = sel?.deptOps?.Tenting?.trussPlan || {};
      trussPlanOf().forEach(z => {
        const { row, pv, fi, zk, ri, key } = z;
        if (!pv?.topology) return;
        const ed = tentingPlan[key] || null;
        const matInv = trussInvForMaterial(trussInv, row.trussMaterial);
        // A pillar / beam the stock sizes cannot make (a 6 or 9 ft pillar when only 10 and 12 ft are held - owner report 2026-11-03)
        // came back with no pieces and simply vanished, so the card read as if the truss needed none. It is listed at the length it
        // needs, marked missing, so the crew knows to arrange it.
        const realGroupsOf = (arr, resolver, idealOf) => {
          const m = {}, miss = {};
          (arr || []).forEach(x => {
            const pcs = resolver(x, matInv).pieces || [];
            if (!pcs.length && idealOf) { const L = Number(idealOf(x)) || 0; if (L > 0) miss[L] = (miss[L] || 0) + 1; return; }
            pcs.forEach(pc => { m[pc.size] = (m[pc.size] || 0) + pc.qty; });
          });
          return [
            ...Object.entries(m).sort((a, b) => Number(b[0]) - Number(a[0])).map(([len, n]) => ({ len: Number(len), n })),
            ...Object.entries(miss).sort((a, b) => Number(b[0]) - Number(a[0])).map(([len, n]) => ({ len: Number(len), n, missing: true })),
          ];
        };
        const pillars = Array.isArray(ed?.pillars) ? ed.pillars : realGroupsOf(pv.topology.pillars, (p, inv) => resolvePillarHeight(p.H, inv), p => p.H);
        const beams = Array.isArray(ed?.beams) ? ed.beams : realGroupsOf(pv.topology.beams, (b, inv) => resolveBeamSegment(b.lengthFt, inv), b => b.lengthFt);
        const bRft = ed?.batta?.rft ?? pv.batta?.rftRequired ?? 0;
        const bBuf = ed?.batta?.buf ?? pv.batta?.bufferPct ?? 10;
        const battaRft = ed?.batta ? Math.round((Number(bRft) || 0) * (1 + (Number(bBuf) || 0) / 100)) : (pv.batta?.rftWithBuffer ?? 0);
        if (!pillars.length && !beams.length && !(battaRft > 0)) return;
        const zkey = `${fi}|${zk}`;
        if (!trussTableByZone.has(zkey)) trussTableByZone.set(zkey, []);
        trussTableByZone.get(zkey).push({ label: ri > 0 ? t("Truss #{n}", { n: ri + 1 }) : "", pillars, beams, battaRft, battaBuf: Number(bBuf) || 0, material: row.trussMaterial || "" });
      });
    }
    fns.forEach((fn, fi) => {
      const els = fn?.elements || {};
      const reuseSrc = reuseSourceOf(fi);
      // ── EVERY ZONE OF THE EVENT, NOT ONLY THE ONES THIS DEPARTMENT FILLS ──
      // A zone is described in three places and none of them is complete on its own: the element
      // lists, the zone config (dims, truss) and the chosen reference photos — a zone can easily
      // have a photo picked and no elements yet. Walking only the element lists dropped those,
      // and dropped every zone whose elements all belong to OTHER departments, which on a Floral
      // book is most of the bar, the food stalls and the centrepieces. The crew sets up alongside
      // everyone else, so those zones belong in the book too — as the reference photo, at least.
      const zoneKeysFound = [...new Set([...Object.keys(els), ...Object.keys(fn?.zones || {}), ...Object.keys(fn?.elSelectedPhoto || {}), ...Object.keys(fn?.notes || {})])]; // a zone with only a note still gets its page, so the note prints
      // ── THE ORDER THE BUILD PAGE SHOWS ──
      // Same rule as Studio's Build / Summary: a hand-dragged order (zoneOrder) first, in the sequence it
      // was dragged; then Admin → Zone Types' order; then the deal's own custom zones in the order they
      // were added; anything unknown last, in the order found. (Before this the zones came out in
      // whatever order their keys happened to be stored in.)
      const zoneKeys = orderZoneKeys(zoneKeysFound, {
        adminOrder: zoneAdminOrder || Object.keys(ZONE_META),
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
          const kitLabel = hn(String(inv?.name || el?.name || "").trim()) || t("kit");
          kitParts.forEach(p => {
            if (placed.has(p.id)) return; // one physical part, on the first zone that claims it
            placed.add(p.id);
            let pInv = (p.invId && invById.get(String(p.invId))) || invByName.get(String(p.name || "").trim().toLowerCase()) || null;
            // a part that named designs of its own (cushion cover / overlay): the design Planning decided is the one that goes out
            let partName = p.name;
            const prt = elementPlanOf().rows.find(r => r.fi === (fn?.fnIdx ?? fi) && r.zk === zk && r.ei === ei && r.part !== undefined && String(r.prefs[0]?.id) === String(p.invId));
            if (prt && prt.decidedId && String(prt.decidedId) !== String(p.invId)) {
              const di = invById.get(String(prt.decidedId));
              if (di) { pInv = di; partName = di.name; }
              else partName = ([...prt.options, prt.manual].filter(Boolean).find(o => o.id === prt.decidedId) || {}).name || partName;
            }
            merged.set("p:" + p.id, { name: partName, qty: Number(p.qty) || 0, unit: String(pInv?.unit || p?.unit || "").trim(), photo: invPhoto(pInv, p), dims: invDims(pInv), source: t("Inside {kit}", { kit: kitLabel }) });
          });
          // Only the parts are ours — the kit shell itself sits on another department's sheet.
          if (!held && kitParts.length) return;
          if (held) placed.add(held.id);
          // ── OVERLAYS AND CUSHION COVERS WITH CHOICES ──
          // Planning decides one of sales' designs (or arranges the pieces outside stock). The card shows that design — its own photo and
          // size — and until it is decided, the 1st choice. Deal Check's PDF (pdfAllCarpetsRef) prints the 1st choice as its own card.
          const prow = elementPlanOf().rows.find(r => r.fi === (fn?.fnIdx ?? fi) && r.zk === zk && r.ei === ei && r.part === undefined) || null;
          let invU = inv, arranged = false, choiceExtra = null, decName = "";
          if (prow) {
            if (prow.other) { arranged = true; choiceExtra = [[t("Source"), t("Bought / hired / made outside stock")]]; }
            else if (prow.decidedId) {
              const di = invById.get(String(prow.decidedId));
              if (di) invU = di; else { invU = null; decName = ([...prow.options, prow.manual].filter(Boolean).find(o => o.id === prow.decidedId) || {}).name || ""; }
              choiceExtra = [[t("Design"), t("Chosen in Planning")]];
            } else choiceExtra = [[t("Choice"), t("1st choice (not decided)")]];
          }
          // Deal Check's PDF lists what sales asked for: every design, 1st to 3rd, each as its own card with its photo (like the carpets).
          if (prow && dealCheckMode) {
            // 1st choice only (owner ask 2026-10-31) - same as the carpets.
            prow.options.slice(0, 1).forEach((o, i) => {
              const ci = invById.get(String(o.id));
              merged.set(`c:${el?.pid || ei}:${i}`, { name: ci?.name || o.name || t("Design"), qty: Number(el?.qty) || 1, unit: String(el?.unit || ci?.unit || "").trim(),
                deptTag: combined ? (deptByInvId.get(String(o.id)) || catToDept(ci?.category || ci?.cat)) : "", photo: invPhoto(ci, null), dims: invDims(ci), size: "", kit: 0, recipe: [],
                extra: [[t("Choice"), choiceLbl(i)]] });
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
          let elSize = SMB_LABEL[rawSize] || (!rawSize && el?.patternId ? SMB_LABEL.B : "");
          // ── REAL OR ARTIFICIAL ── a flower piece says which it is made as, worked out the way Studio prices it
          // (getElPriceFromPattern): the element's own % first, else its sub-category's floral mode (IMS Rate Card),
          // else the function's floral slider (floralRatio = the artificial share, 70 when never set).
          const pat = (el?.patternId && flowerPatterns.find(fp => fp?.id === el.patternId)) || (inv && matchFlowerPattern(inv, flowerPatterns)) || null;
          let floralMix = "";
          let realPct = null; // the real share, 0-100 - what the piece's mandi flowers are bought for (the rest goes as artificial bunches)
          if (pat) {
            const subMode = floralModeBySub.get(String(pat.sub ?? "").trim().replace(/\s+/g, " ").toLowerCase());
            const fnArt = typeof fn?.floralRatio === "number" ? fn.floralRatio : 70;
            const real = (typeof el?.realPct === "number" && el.realPct >= 0 && el.realPct <= 100) ? Math.round(el.realPct)
              : subMode === "real" ? 100 : subMode === "artificial" ? 0 : Math.max(0, Math.min(100, Math.round(100 - fnArt)));
            floralMix = real >= 100 ? t("Real") : real <= 0 ? t("Artificial") : t("Artificial {art}% · Real {real}%", { art: 100 - real, real });
            realPct = real;
            // A flower piece with no size set is priced Big (Studio's el.size || "B"), so it reads Big here too - the flowers
            // under it are for that size (owner ask 2026-11-03: S / M / B wherever a flower piece is in the book).
            if (!elSize && pat.mode === "smb") elSize = SMB_LABEL.B; // only a recipe that comes in sizes; a flat one has none
          }
          const key = (arranged ? "o:" + (el?.pid || ei) : invU ? "i:" + invU.id : "n:" + (decName || nm)) + (elSize ? "|" + elSize : "") + (floralMix ? "|" + floralMix : "");
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
          // Kept PER UNIT; the card multiplies by the zone's summed qty and by the piece's real share - the
          // artificial share goes out as artificial bunches (listed in the same block), so the full recipe
          // amount here counted it twice and disagreed with Deal Check (2.5 bundles printed where Deal Check
          // and the mandi list say 0.75 at 30% real).
          // The recipe size Deal Check works the flowers at (lib/studio/floralCost): an inventory-item element at its size, B when
          // unset; a recipe-only element at its size only for an S/M/B recipe, M when unset - any other recipe at medium.
          const dcSize = (el?.invId && invById.get(String(el.invId))) ? sizeClassToPatternKey(rawSize || "B")
            : pat?.mode === "smb" ? sizeClassToPatternKey(rawSize || "M") : "medium";
          const sizeData = pat?.sizes?.[resolveSizeKey(pat.sizes, dcSize)];
          const recipe = (sizeData?.flowers || []).map(fl => {
            if (fl?.invItemId) { const ing = invById.get(String(fl.invItemId)); return ing ? { name: ing.name, qty: Number(fl.qty) || 0, unit: ing.unit || "", full: true } : null; }
            const mf = resolveMandiFlower(fl?.flowerId, mandiCatalogue)?.parent;
            if (!mf) return null;
            const baseQty = Number(fl.qty) || 0;
            // This event's own mandi swap, made on the Floral shopping list (eventSwap above): the
            // piece is made with the replacement, in its units. Only the replacement is named — the crew makes the piece with
            // what was bought; the flower it stands in for is on the Mandi list, not here.
            const swapped = swappedRecipeFlower(eventSwap, mf.name, baseQty);
            // full: an inventory ingredient, or a mandi flower that is real-only, goes in at its whole amount whatever the mix - as Deal Check counts it
            const full = mf.flowerType === "real_only";
            if (swapped) return { ...swapped, full };
            return { name: mf.name, qty: baseQty, unit: mf.unit || "", full };
          }).filter(f => f && f.qty > 0);
          // ── THE KIT'S PARTS AS BUILD HAS THEM NOW ──
          // The parts list below the zone came only from Deal Check's snapshot (deptInventory), so a part added to the kit in
          // Build after that never reached the book until Deal Check was opened again (owner ask 2026-10-31). The element's own
          // part list (kitOverrides - an edited kit - else the kit's master list) rides with the layout on every Build save,
          // so it is read here, per kit; zoneDetailPages adds whatever part the snapshot does not have yet.
          const kitInv = invU && Array.isArray(invU.subItems) && invU.subItems.length ? invU : null;
          // A flower part of the kit (a recipe add-on, or a pot whose sub-category has a recipe that comes in sizes) says its size,
          // as Build's kit list sets it: the part's own S / M / B, else the element's, else Big - the size Studio prices it at.
          const kitPartSize = (pt, si) => {
            if (!pt || !(pt.mode === "smb" || Object.keys(pt.sizes || {}).length > 1)) return "";
            const z = String(si?.size || el?.size || "B").trim().toUpperCase()[0];
            return SMB_LABEL[z === "S" ? "S" : z === "M" ? "M" : "B"];
          };
          const liveKit = !kitInv ? [] : (Array.isArray(el?.kitOverrides) ? el.kitOverrides : kitInv.subItems).map(si => {
            if (si?.patternId) {
              const pt = flowerPatterns.find(fp => fp?.id === si.patternId);
              return pt ? { name: pt.name || t("Flower recipe"), per: Number(si.qty) || 0, unit: pt.unit || "", dept: "Floral", size: kitPartSize(pt, si) } : null;
            }
            const ci = invById.get(String(si?.itemId));
            if (!ci) return null;
            return { name: ci.name, per: Number(si.qty) || 0, unit: String(ci.unit || "").trim(), photo: invPhoto(ci, null),
              dept: heldByInv.has(String(ci.id)) ? dept : catToDept(ci.category || ci.cat), size: kitPartSize(matchFlowerPattern(ci, flowerPatterns), si) };
          }).filter(x => x && x.per > 0);
          const statusTxt = arranged ? "" : itemStatusOf(fn, reuseSrc, zk, el, invU || inv);
          // a recipe with no inventory item shows the picture of its size, as Build does (photo below)
          // a flower recipe with no inventory item is named as the recipe is named now - renamed in IMS, it reads the new name
          // here even in a deal not saved since (2026-11-11)
          const recipeName = !invU && el?.patternId ? String((flowerPatterns || []).find(p => p.id === el.patternId)?.name || "").trim() : "";
          merged.set(key, { name: arranged ? `${el?.name || inv?.name || t("Item")} — ${t("arranged separately")}` : (invU?.name || decName || recipeName || el?.name || held?.name || t("Item")),
            ...(arranged ? { shown: `${hn(el?.name || inv?.name) || t("Item")} — ${t("arranged separately")}` } : {}), qty, unit, deptTag, photo: arranged ? "" : (invPhoto(invU, invU === inv ? held : null) || (!invU && sizeData?.img) || ""), dims: arranged ? "" : invDims(invU), extra: (choiceExtra || floralMix || statusTxt) ? [...(choiceExtra || []), ...(floralMix ? [[t("Flowers"), floralMix]] : []), ...(statusTxt ? [[t("Status"), statusTxt]] : [])] : undefined, mix: floralMix, realPct, size: elSize, kit: held?.isKit ? (Array.isArray(held.components) ? held.components.length : 0) + (Array.isArray(held.recipeParts) ? held.recipeParts.length : 0) : liveKit.length, liveKit, recipe, paint: addPaint(new Map(), paint) });
        });
        // ── CUSTOM CEILING ── not a zone element: it sits on the zone's truss rows (customCeilingItemId + its count
        // customCeilingQty, else one per truss), which reach IMS with the layout on every Build save. A card of its own on
        // the zone's page, in the book of the department that pulls it (owner ask 2026-10-31) - it used to appear nowhere.
        const zoneRows = [fn?.zones?.[zk], ...((fn?.zones?.[zk]?.extraTrussRows) || [])].filter(Boolean);
        zoneRows.forEach((row, ri) => {
          if (!row.customCeilingItemId) return;
          const ci = invById.get(String(row.customCeilingItemId));
          if (!ci) return;
          const held = heldByInv.get(String(ci.id)) || null;
          if (!(combined || held || catToDept(ci.category || ci.cat) === dept)) return;
          if (held) placed.add(held.id);
          const cq = Number(row.customCeilingQty) > 0 ? Number(row.customCeilingQty) : Math.max(1, Number(row.trussQty) || 1);
          const key = "ceil:" + ci.id;
          const prev = merged.get(key);
          if (prev) { prev.qty += cq; return; }
          merged.set(key, { name: ci.name, qty: cq, unit: String(ci.unit || "").trim(), photo: invPhoto(ci, held), dims: invDims(ci), size: "", kit: 0, recipe: [],
            deptTag: combined ? (deptByInvId.get(String(ci.id)) || catToDept(ci.category || ci.cat)) : "",
            extra: [[t("Ceiling"), t("Custom ceiling") + (zoneRows.length > 1 ? " " + t("(truss {n})", { n: ri + 1 }) : "")]] });
        });
        const items = [...merged.values()];
        const zPhoto = fn.elSelectedPhoto?.[zk]?.src || "";
        const zDims = physDimsByZone.get(`${fi}|${zk}`) || zoneDimsText(fn.dims?.[zk] || fn.zones?.[zk]?.dims);
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
        // Owner ask (2026-11-07): the crew needs to know the truss MATERIAL at a glance here too —
        // iron/pole/aluminium pillars and beams aren't interchangeable stock. hn() (not a new t()
        // dictionary key) is the same way the structure strip's own "Single U pole" already names a
        // truss's material (see z.trussMaterial a little above) — reusing it here keeps every
        // Hindi-translated material word in exactly one place instead of a second copy to keep in sync.
        const zTrussMat = zCfg.trussMaterial ? hn(String(zCfg.trussMaterial)) : "";
        const zDimsOf = (zCfg.trT || Number(zCfg.trussQty) > 0) ? (zTrussMat ? `${zTrussMat} ${t("Truss")}` : t("Truss"))
          : Number(zCfg.plH) > 0 ? t("Platform")
          : t("Zone");
        // The only zone still worth skipping is one with nothing to put on the page at all: none
        // of our items, no reference photo and no dimensions. That page would be a heading.
        const zStruct = zoneStructOf(zCfg, fi, zk, fn);
        // ── THE FLOWER PALETTE ── what Build set for this function's flowers ("Maroon:60, White:40"), on every zone page of the
        // Floral book only (not the all-departments book — owner ask), each colour as a dot with its share — the colours the florists are building in.
        // ── THE FLORAL MIX ── Build's floral slider for this function: floralRatio is the ARTIFICIAL share, real is the rest
        // (the function's default; a single element can still be set to its own %).
        if (!combined && dept === "Floral" && typeof fn?.floralRatio === "number") {
          const art = Math.max(0, Math.min(100, Math.round(fn.floralRatio)));
          zStruct.push({ k: t("Floral mix"), v: t("Real {real}% · Artificial {art}%", { real: 100 - art, art }) });
        }
        if (!combined && dept === "Floral" && fn?.flowerPalette) {
          const cols = parseFlowerPalette(fn.flowerPalette);
          if (cols.length) zStruct.push({ k: t("Flower palette"), html: cols.map(c => `<b class="fpc"><i style="background:${esc(flowerPaletteHexFor(c.name))}"></i>${esc(hn(c.name))} ${esc(c.pct)}%</b>`).join("") });
        }
        // First, not last: a zone with more than six items splits across pages, and a print
        // appended at the end landed on the zone's second page, away from the one the crew opens.
        items.unshift(...printCardsOf(zCfg), ...carpetCardsOf(zCfg, fn?.fnIdx ?? fi, zk, fn));
        if (!items.length && !zPhoto && !zDims && !zStruct.length) return;
        zonePages.push({
          zk,
          fi,
          fnIdx: fn?.fnIdx ?? fi,
          fnType: fn.type || t("Function {n}", { n: fi + 1 }),
          fnDate: fn.date || "",
          title: zoneName(zk, fn),
          fnLabel: [hn(fn.type) || (fns.length > 1 ? t("Function {n}", { n: fi + 1 }) : ""), fn.date].filter(Boolean).join(" · "),
          photo: zPhoto,
          zoneDims: zDims,
          dimsOf: zDimsOf,
          struct: zStruct,
          fabric: withDrape(fabricByZone.get(`${fi}|${zk}`) || [], fn?.zones?.[zk]),
          trussTable: trussTableByZone.get(`${fi}|${zk}`) || [],
          note: String(fn?.notes?.[zk] || "").trim(),
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
      `<tr><td><b>${esc(hn(r.label))}</b>${(fns || []).length > 1 && r.fn ? `<div class="sub">${esc(hn(r.fn))}</div>` : ""}</td><td class="n">${esc(r.qty)}${r.unit ? " " + esc(hu(r.unit)) : ""}</td><td class="n">${Number(r.perTruck) > 0 ? t("{n} per truck", { n: esc(r.perTruck) + (r.unit ? " " + esc(hu(r.unit)) : "") }) : "—"}</td><td class="n b">${Number(r.flat) > 0 ? t("{amount} flat", { amount: "₹" + esc(Math.round(r.flat).toLocaleString("en-IN")) }) : esc(r.trucks)}</td></tr>`);
    const trNote = !trMine ? "" : t("{dept} fills {trucks} of the {n} truck this event needs|{dept} fills {trucks} of the {n} trucks this event needs", { dept: esc(t(dept)), trucks: trMine.trucks, n: trPlan.totalTrucks })
      + `${trPlan.tierLabel ? ` · ${esc(trPlan.tierLabel)}` : ""}. ${t("A truck is counted by capacity, so a part-truck share is normal — the loads travel together.")}`;

    // Deal Check's one "🖨 Print / signage" row says only how many jobs there are; it is replaced
    // below by one card per job, read from the build.
    const unplaced = blockedItemsGrouped.filter(b => !placed.has(b.id) && b.sub !== "print").map(b => {
      const inv = (b.invId && invById.get(String(b.invId))) || invByName.get(String(b.name || "").trim().toLowerCase()) || null;
      const kitOf = String(b.fromKit || "").trim();
      return { name: b.name, qty: Number(b.qty) || 0, photo: invPhoto(inv, b), dims: invDims(inv), prodOrBuy: b.prodOrBuy || null, kit: b.isKit ? (Array.isArray(b.components) ? b.components.length : 0) + (Array.isArray(b.recipeParts) ? b.recipeParts.length : 0) : 0, source: b.prodOrBuy === "buying" ? t("Buying") : b.prodOrBuy === "production" ? t("Production") : kitOf ? t("Inside {kit}", { kit: hn(kitOf) }) : "" };
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
      ? pdfDate(lang, new Date(sel.deptSyncedAt), { day: "numeric", month: "short", year: "numeric" })
      : "";
    const looseNote = syncedOn
      ? t("Held for this event, but no zone lists these. The zone plan here was last synced from Deal Check on {date} — re-sync if they belong in a zone.", { date: syncedOn })
      : t("Held for this event, but no zone lists these — re-sync Deal Check if they belong in a zone.");

    // Geometry, in the sheet's 706px content width. Cards sit four to a row: top row, the photo
    // band, bottom row. Each card's arrow drops straight onto the photo edge below / above it.
    // A4's usable area is ~1.46× taller than it is wide, so at this 706px column a full page is
    // ~1020px. The stage is sized to fill it: the photo takes whatever height the card rows leave,
    // so a zone with four items gets a large photo instead of a small one and half a blank page.
    // HEAD_PX covers the section's own padding plus the header card (eyebrow, title, ornament,
    // date) and the gap under it — so header + card rows + photo add up to exactly one page.
    const CARD_W = 224, COL_GAP = 17, ROW_H = 300, ARROW = 40, PAGE_PX = 1020, HEAD_PX = 186;
    // A zone that runs over more than one page names itself on its FIRST page only (header: "Zone 03 · Part 1 of 3", the name, the date, the counts); the later
    // pages of the same zone have no header, just a little clear space under the corner brackets, and the photo takes the height the header gave up.
    const CONT_GAP = 34, CONT_HEAD_PX = 20 + CONT_GAP;
    const colX = (i, n) => { const span = n * CARD_W + (n - 1) * COL_GAP; return (706 - span) / 2 + i * (CARD_W + COL_GAP); };
    // No photo → no empty "No photo" box, just the details (owner ask). The card then sizes to its
    // text (np); nb makes room at the top for the size/kit tags the photo used to sit under.
    const npCls = (it) => it.photo ? "" : (it.size || it.kit ? " np nb" : " np");
    // A recipe card used to list its own flowers inline, up to 5 lines — "Flower Trail" (7+
    // flowers) always ran out of room and showed a bare "+3 more" with nowhere to actually see
    // them. Every recipe's FULL ingredient list now lives on its own dedicated page (recipePages
    // below); the card just points there, one line, regardless of how many flowers are in it.
    // A separate "🌸 Flowers" card (names only) used to sit next to each recipe item — the same
    // flowers the zone's Mandi & Kits page lists right after, with quantities. Nothing in the book
    // prints twice (owner ask), so the zone page shows the item only.
    const flowerRows = () => "";
    // The paint line takes its 20px out of the photo.
    // So does every line of the name past the two the card is laid out for: a long name ("Round Metal Ring Arch on
    // Stand - Large (approx 5ft diameter)") wrapped to three, pushed the last row out past the card's fixed 300px,
    // and the arrow below drew straight through it. Wrapped word by word at ~26 characters, the width of a line of
    // the 13.5px name in the 202px the card gives it.
    const nameLines = (name) => {
      let lines = 1, len = 0;
      for (const w of String(name || "").split(/\s+/).filter(Boolean)) {
        if (len && len + 1 + w.length > 26) { lines++; len = w.length; } else len += (len ? 1 : 0) + w.length;
      }
      return lines;
    };
    // An extra row's value (Status "♻ Repeat · 📌 Fixed · 200 standing", a choice) can wrap in the ~140px right of its label -
    // each line it wraps to is counted too, or its second line ran out past the card (owner report 2026-11-11).
    const valueLines = (v) => Math.max(1, Math.ceil([...String(v ?? "")].length / 24)); // ~24 characters of 11px bold a line; an emoji is one
    const flLines = (it) => (it.paint?.size ? 1 : 0) + (it.extra || []).reduce((n, [, v]) => n + valueLines(v), 0) + Math.max(0, nameLines(it.name) - 2);
    const card = (it, zone, num) => `
      ${it.photo ? `<div class="zc-ph" style="${bgCss(it.photo, 180)}${flLines(it) ? `height:${168 - flLines(it) * 20}px` : ""}" ${bgData(it.photo, 180)}></div>` : ""}
      ${num ? `<div class="zc-no">${num}</div>` : ""}
      ${it.kit ? `<div class="zc-kt">${t("KIT · {n}", { n: esc(it.kit) })}</div>` : ""}
      ${it.size ? `<div class="zc-sz">${esc(it.size)}</div>` : ""}
      <div class="zc-b">
        <div class="zc-n">${esc(it.shown != null ? it.shown : hn(it.name))}</div>
        <div class="zc-r"><span>${t("Qty")}</span><b>${esc(it.qty)}${it.unit ? ` <span style="font-weight:500;font-size:.85em;opacity:.7">${esc(hu(it.unit))}</span>` : ""}</b></div>
        <div class="zc-r"><span>${t("Size")}</span><b>${esc(hd(it.dims) || "—")}</b></div>
        ${it.source ? `<div class="zc-r"><span>${t("From")}</span><b>${esc(it.source)}</b></div>` : it.deptTag ? `<div class="zc-r"><span>${t("Dept")}</span><b>${esc(t(it.deptTag))}</b></div>` : ""}
        ${it.paint?.size ? `<div class="zc-r"><span>${t("Paint")}</span><b>${esc(paintHn(paintText(it.paint)))}</b></div>` : ""}
        ${(it.extra || []).map(([k, v]) => `<div class="zc-r"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
        ${flowerRows(it)}
      </div>`;
    // The header's count. The truss / platform / carpet / masking in the strip are Tenting's own
    // work (the classifier files them there), so in the Tenting and combined books they count —
    // a zone with only those printed "No Tenting items" right above four of them. In the
    // Structure book the strip is reference (Tenting's frame they build on), so it isn't counted.
    const zoneCountText = (pg) => {
      const n = pg.items.length + (combined || dept === "Tenting" ? (pg.struct || []).length : 0);
      // No item count on the page (owner ask 2026-11-03) - only the note that this department has nothing in the zone.
      return n ? "" : (combined ? t("No items") : t("No {dept} items", { dept: esc(t(dept)) }));
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
      const cont = part > 1; // a later page of a zone that is already named
      // The strip (structure, floral mix, palette) prints on the zone's first page only — nothing repeats (owner ask).
      const strip = !cont && (pg.struct || []).length > 0;
      // the fabric colours get a row of their own under it, so the truss strip never wraps past the height set aside for it
      const fabStrip = !cont && (pg.fabric || []).length > 0;
      // The truss breakdown (owner ask 2026-11-03), as Planning's Truss plan shows it: one card per truss of the zone, its Pillars,
      // Beams and Batta side by side, under the truss and fabric strips, on the zone's first page. Pillar / beam cards
      // list one size a line; every card of a truss is as tall as its longest list. The height comes out of the photo like
      // the fabric row, so the page still adds up to one sheet.
      const trussRows = !cont ? (pg.trussTable || []) : [];
      const TK_LINE = 19, TK_BASE = 52, TK_LABEL = 20, TK_GAP = 10;
      const trussBlockPx = (tt) => (tt.label ? TK_LABEL : 0) + TK_BASE + Math.max(tt.battaRft > 0 && tt.battaBuf > 0 ? 2 : 1, tt.pillars.length, tt.beams.length) * TK_LINE;
      const trussPx = trussRows.length ? trussRows.reduce((h, tt) => h + trussBlockPx(tt) + TK_GAP, 0) + 2 : 0;
      // Build's note for the zone (owner ask 2026-11-03), on its first page under the strips: up to 8 lines of about 95
      // characters, its height out of the photo like the strips above, so the page still fits one sheet.
      const NOTE_LINE = 18, NOTE_MAX_LINES = 8;
      const noteText = !cont ? (pg.note || "") : "";
      const noteLines = noteText ? Math.min(NOTE_MAX_LINES, noteText.split(/\r?\n/).reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0)) : 0;
      const notePx = noteLines ? 30 + noteLines * NOTE_LINE : 0;
      const noteBox = noteLines ? `<div class="znote" style="max-height:${notePx - 12}px"><b>📝 ${t("Note")}</b><span>${esc(noteText)}</span></div>` : "";
      const headPx = (cont ? CONT_HEAD_PX : HEAD_PX) + (strip ? 44 : 0) + (fabStrip ? 44 : 0) + trussPx + notePx;
      // the fabric row comes out of the photo's floor too, so it never makes a page taller than it was without it
      const PHOTO_H = bare ? PAGE_PX - headPx : Math.max(Math.max(160, 260 - (fabStrip ? 44 : 0) - trussPx - notePx), PAGE_PX - headPx - rows * (ROW_H + ARROW));
      const pieces = (groups) => groups.reduce((a, g) => a + (Number(g.n) || 0), 0);
      const sizeLines = (groups) => groups.map(g => `<div class="ztk-l${g.missing ? " ztk-miss" : ""}"><b>${esc(g.n)}</b><span>× ${esc(g.len)} ft${g.missing ? ` ⚠ ${t("not in stock")}` : ""}</span></div>`).join("");
      const tkCard = (icon, title, count, body) => `<div class="ztk-c"><div class="ztk-h"><span>${icon} ${title}</span>${count != null ? `<b>${esc(count)}</b>` : ""}</div>${body}</div>`;
      // Owner ask (2026-11-07): Pillars/Beams are material-specific stock (iron/pole/aluminium
      // aren't interchangeable), so the crew needs the material named on the card, not just "Pillars"/
      // "Beams". hn() (not a new t() dictionary key) is the same material-translation path the
      // structure strip and the zone header's own truss-dims chip (zDimsOf, above) already use, so
      // there's exactly one place a material word's Hindi text lives, not three. Batta stays
      // unprefixed — there's no separate iron/pole/aluminium batta pool to tell apart on this card
      // (unlike pillars/beams, it's one RFT figure either way).
      const tkMatOf = (tt) => (tt.material ? hn(String(tt.material)) : "");
      const trussCard = trussRows.map(tt => `<div class="ztk-w">
          ${tt.label ? `<div class="ztk-t">${esc(tt.label)}</div>` : ""}
          <div class="ztk" style="height:${trussBlockPx(tt) - (tt.label ? TK_LABEL : 0)}px">
            ${tt.pillars.length ? tkCard("🏛️", tkMatOf(tt) ? `${esc(tkMatOf(tt))} ${t("Pillars")}` : t("Pillars"), pieces(tt.pillars), sizeLines(tt.pillars)) : ""}
            ${tt.beams.length ? tkCard("🔗", tkMatOf(tt) ? `${esc(tkMatOf(tt))} ${t("Beams")}` : t("Beams"), pieces(tt.beams), sizeLines(tt.beams)) : ""}
            ${tt.battaRft > 0 ? tkCard("🎗️", t("Batta"), null, `<div class="ztk-l ztk-big"><b>${esc(tt.battaRft)}</b><span>RFT</span></div>${tt.battaBuf > 0 ? `<div class="ztk-s">${t("incl. {pct}% buffer", { pct: esc(tt.battaBuf) })}</div>` : ""}`) : ""}
          </div>
        </div>`).join("");
      const photoTop = bare ? 0 : ROW_H + ARROW;
      const botTop = photoTop + PHOTO_H + ARROW;
      const stageH = bare ? PHOTO_H : bot.length ? botTop + ROW_H : photoTop + PHOTO_H;
      // No item numbers (removed by request) — each card's arrow alone ties it to the photo.
      // A top-row card without a photo is shorter, so it is pinned by its BOTTOM to keep sitting on its arrow.
      const cards = [
        ...top.map((it, i) => { const x = colX(i, top.length); return `<div class="zc${npCls(it)}" style="left:${x}px;${it.photo ? "top:0" : `bottom:${stageH - ROW_H}px`}">${card(it, pg.title)}</div>
          <div class="za down" style="left:${x + CARD_W / 2 - 1}px;top:${ROW_H}px;height:${ARROW}px"></div>`; }),
        ...bot.map((it, i) => { const x = colX(i, bot.length); return `<div class="zc${npCls(it)}" style="left:${x}px;top:${botTop}px">${card(it, pg.title)}</div>
          <div class="za up" style="left:${x + CARD_W / 2 - 1}px;top:${photoTop + PHOTO_H}px;height:${ARROW}px"></div>`; }),
      ].join("");
      return `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
        ${cont ? `<div style="height:${CONT_GAP}px"></div>` : `<div class="zh">
          <div><div class="zk"><b>${t("Zone {n}", { n: String(zoneNo).padStart(2, "0") })}</b>${parts > 1 ? ` · ${t("Part {part} of {parts}", { part, parts })}` : ""}</div><h2>${esc(hn(pg.title))}</h2>
            <div class="orn l"><i></i><b></b><i></i></div>
            <div class="zm">${esc(pg.fnLabel || selDateStr || "")}</div></div>
          <div class="zt">${pg.zoneDims ? `<span><i class="zl">${esc(pg.dimsOf)}</i>${esc(pg.zoneDims)}</span>` : ""}${zoneCountText(pg) ? `<span>${zoneCountText(pg)}</span>` : ""}</div>
        </div>`}
        ${strip ? `<div class="zst">${pg.struct.map(c => `<span><i class="zl">${esc(c.k)}</i>${c.html != null ? c.html : esc(c.v)}</span>`).join("")}</div>` : ""}
        ${fabStrip ? `<div class="zst">${pg.fabric.map(c => `<span><i class="zl">${esc(c.k)}</i>${c.html}</span>`).join("")}</div>` : ""}
        ${trussCard}
        ${noteBox}
        <div class="zs" style="height:${stageH}px">
          <div class="zphoto" style="top:${photoTop}px;height:${PHOTO_H}px;${bgCss(pg.photo)}" ${bgData(pg.photo)}>${pg.photo ? "" : `<span>${t("No zone photo")}</span>`}</div>
          ${cards}
        </div>
      </section>`;
    };
    const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
    // A plain grid page (no zone photo) for a list of items — used for production items and for
    // anything not placed in a zone.
    const listPages = (items, eyebrow, title, note) => items.length ? chunks(items, 9).map((c, i, all) => `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
        <div class="zh"><div><div class="zk"><b>${esc(eyebrow)}</b>${all.length > 1 ? ` · ${t("Part {part} of {parts}", { part: i + 1, parts: all.length })}` : ""}</div><h2>${esc(title)}</h2>
          <div class="orn l"><i></i><b></b><i></i></div>
          <div class="zm">${esc(note)}</div></div>
</div>
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
    const detailLongNames = (parts, cols) => { const per = cols === 2 ? 44 : 100; return parts.filter(p => String(p.name || "").trim().length + (p.tag ? p.tag.length + 1 : 0) + (p.size ? p.size.length + 1 : 0) > per).length; };
    const detailH = (parts) => { const cols = detailCols(parts); return 68 + (Math.ceil(parts.length / cols) + Math.ceil(detailLongNames(parts, cols) / cols)) * 24 + 14; };
    // mix: a flower piece's real / artificial make-up (zone card's "Flowers" line) - in the header, and as a tag on every
    // flower line so whoever pulls a flower knows whether it is the real one or the artificial one (owner ask).
    // size: an arrangement's Small / Medium / Big (owner ask 2026-11-03) - the recipe under it is for that size, so it is said beside
    // the flowers and the qty instead of only on the zone page's card.
    const detailCard = (icon, name, qty, unit, parts, mix, size) => { const cols = detailCols(parts); return `<div class="kb">
      <div class="kb-h">
        <div class="kb-t"><div class="kb-nm">${icon} ${esc(hn(name))}</div></div>
        ${size ? `<div class="kb-z kb-q"><div class="kb-zk">${t("Size")}</div><div class="kb-zv">${esc(size)}</div></div>` : ""}
        ${mix ? `<div class="kb-z kb-q"><div class="kb-zk">${t("Flowers")}</div><div class="kb-zv">${esc(mix)}</div></div>` : ""}
        ${qty ? `<div class="kb-z kb-q"><div class="kb-zk">${t("Qty")}</div><div class="kb-zv">${esc(qty)}${unit ? " " + esc(hu(unit)) : ""}</div></div>` : ""}
      </div>
      <ul class="kb-l${cols === 1 ? " one" : ""}">${parts.map(p => `<li><i class="kb-x"></i>${p.photo ? `<i class="kb-p" style="${bgCss(p.photo, 40)}" ${bgData(p.photo, 40)}></i>` : ""}<span>${esc(hn(p.name))}${p.size ? ` <em class="kb-tg">${esc(p.size)}</em>` : ""}${p.tag ? ` <em class="kb-tg">${esc(p.tag)}</em>` : ""}</span><i class="kb-d"></i><b>${esc(p.qty)}${p.unit ? ` ${esc(hu(p.unit))}` : ""}</b></li>`).join("")}</ul>
    </div>`; };
    // One page (or more, if a zone's own recipes+kits don't fit one sheet) per zone, built right
    // after that zone's card pages in the loop below — never bundled with any OTHER zone's.
    // Every zone card holding this kit, in book order, with its count.
    const kitHolders = (key) => zonePages.flatMap(zp => (zp.items || []).filter(x => x.kit > 0 && String(x.name || "").trim().toLowerCase() === key).map(x => ({ it: x, q: Number(x.qty) || 0 })));
    // Splits a whole-piece total across zones by their kit counts, in whole pieces that still add up to the total
    // (largest remainder): 2 cushion covers over 2 + 1 consoles → 1 and 1, not 1.33 and 0.67.
    const wholeShares = (total, qs) => {
      const sum = qs.reduce((s, q) => s + q, 0);
      const raw = qs.map(q => total * q / sum), out = raw.map(Math.floor);
      let left = total - out.reduce((s, v) => s + v, 0);
      raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
      return out;
    };
    const zoneDetailPages = (pg) => {
      const blocks = [];
      // ── ARTIFICIAL BUNCHES UNDER THEIR OWN ARRANGEMENT ──
      // A zone's artificial flowers and greens used to print as a block of their own ("Ulta Pulta Pot — flowers 10.8
      // bunches"), apart from the arrangement they go into. They now sit in that arrangement's own block, in whole bunches
      // (owner ask 2026-10-31). Matched by name; an arrangement with no recipe of its own gets a block for them.
      const zArt = artPlan ? (sel?.floralDetail?.[pg.fnIdx]?.artZones || []).filter(a => a.zone === pg.zk) : [];
      const artKey = (n) => String(n || "").trim().toLowerCase();
      const artLeft = new Map();
      zArt.forEach(a => { const k = artKey(a.el); artLeft.set(k, [...(artLeft.get(k) || []), a]); });
      const artLines = (list) => {
        const fl = list.reduce((t, a) => t + artBunches(a.flower), 0), gr = list.reduce((t, a) => t + artBunches(a.green), 0);
        return [...(fl > 0 ? [{ name: t("Artificial flowers"), qty: fl, unit: t("bunches") }] : []), ...(gr > 0 ? [{ name: t("Artificial greens"), qty: gr, unit: t("bunches") }] : [])];
      };
      const takeArt = (name) => { const k = artKey(name), list = artLeft.get(k) || []; artLeft.delete(k); return artLines(list); };
      // ── REAL FLOWERS AS DEAL CHECK HAS THEM ──
      // Deal Check's own real flower lines per element row (floralDetail[fn].realZones, snapshot v12): the real share, real-only
      // flowers at full, the reuse credit taken off, the recipe's inventory ingredients - so a line here is the number Deal Check
      // shows. This event's mandi swaps (made in IMS) are applied on top, as before. Matched by name, like the bunches above; an
      // element the snapshot does not know yet (added since Deal Check last ran) falls back to its recipe worked out here.
      const realTaker = realLineTaker(sel?.floralDetail?.[pg.fnIdx]?.realZones, pg.zk, eventSwap);
      (pg.items || []).forEach(it => {
        const art = !combined && it.mix ? takeArt(it.name) : [];
        const snapReal = !combined && it.mix && realTaker.has(it.name) ? realTaker.take(it.name) : null;
        if (!combined && ((Array.isArray(it.recipe) && it.recipe.length) || art.length || (snapReal && snapReal.length))) {
          // The flower lines are the REAL flowers - the amount Deal Check and the mandi list have (the whole recipe used to print,
          // 2.5 where Deal Check said 0.75 at 30% real). Without a snapshot line: the recipe times the piece's real share, real-only
          // flowers and inventory ingredients at full. The artificial share follows as the bunches; the header still says the mix.
          const tag = !it.mix ? "" : t("Real");
          const realShare = typeof it.realPct === "number" ? it.realPct / 100 : 1;
          const realParts = snapReal
            ? snapReal.map(f => ({ ...f, tag }))
            : (it.recipe || []).map(f => ({ name: f.name, qty: Math.round((Number(f.qty) || 0) * (Number(it.qty) || 0) * (f.full ? 1 : realShare) * 100) / 100, unit: f.unit, tag }));
          const parts = [...realParts.filter(f => f.qty > 0), ...art];
          if (parts.length) blocks.push({ h: detailH(parts), html: detailCard("🌸", it.name, it.qty, it.unit, parts, it.mix, it.size) });
        }
        if (it.kit > 0) {
          const key = String(it.name || "").trim().toLowerCase();
          const kb = kitBlocksByName.get(key);
          // kb holds the whole EVENT's kits (its parts are totals for all of them) — the zone's page needs this zone's own
          // count and its share of the parts (Stage with 2 consoles printed "Qty 3" and 3 kits' parts when Mehendi had the 3rd).
          // Pieces split in whole numbers when the zones account for every kit; a part in a unit (flowers) splits exactly.
          const zq = Number(it.qty) || 0, tq = Number(kb?.qty) || 0;
          const holders = kitHolders(key), at = holders.findIndex(h => h.it === it);
          const whole = at >= 0 && holders.reduce((s, h) => s + h.q, 0) === tq;
          const share = (p) => {
            const t = Number(p.qty) || 0;
            if (whole && !p.unit && Number.isInteger(t)) return wholeShares(t, holders.map(h => h.q))[at];
            return Math.round(t * zq / tq * 100) / 100;
          };
          const parts = !kb ? [] : zq > 0 && tq > 0 && zq !== tq ? kb.parts.map(p => ({ ...p, qty: share(p) })).filter(p => p.qty > 0) : [...kb.parts];
          // A part added to the kit in Build since Deal Check last ran (it.liveKit): listed too, at this zone's count. Only this
          // department's own parts in a single-department book, like the snapshot's; every part in the combined one.
          const partKey = (n) => String(n || "").trim().toLowerCase();
          const have = new Set(parts.map(p => partKey(p.name)));
          (it.liveKit || []).forEach(p => {
            if (have.has(partKey(p.name)) || (!combined && p.dept !== dept)) return;
            have.add(partKey(p.name));
            parts.push({ name: p.name, qty: Math.round(p.per * (zq || 1) * 100) / 100, unit: p.unit, photo: p.photo || "" });
          });
          // each flower part's S / M / B, from the kit as Build has it (Deal Check's snapshot lines carry no size)
          const sizeOf = new Map((it.liveKit || []).filter(p => p.size).map(p => [partKey(p.name), p.size]));
          // (a copy - the snapshot's part objects are shared by every zone holding this kit)
          parts.forEach((p, i) => { if (!p.size && sizeOf.has(partKey(p.name))) parts[i] = { ...p, size: sizeOf.get(partKey(p.name)) }; });
          if (parts.length) blocks.push({ h: detailH(parts), html: detailCard("📦", it.name, zq > 0 && tq > 0 ? zq : (kb?.qty || zq), "", parts) });
        }
      });
      // An arrangement whose name matched no card on this page (renamed since, or on another department's sheet) still gets
      // its bunches - as a block under its own name, never as a loose "Artificial flowers & greens" list.
      artLeft.forEach(list => {
        const parts = artLines(list);
        const q = list.reduce((t, a) => t + (Number(a.qty) || 0), 0);
        if (parts.length) blocks.push({ h: detailH(parts), html: detailCard("🌸", list[0].el || t("Arrangement"), q || "", "", parts, t("Artificial")) });
      });
      // The truss cut list (pillars / beams / batta) is on the zone's own page now, under the truss strip (trussCard) - not repeated here.
      if (!blocks.length) return [];
      const dChunks = [];
      blocks.forEach(b => {
        const last = dChunks[dChunks.length - 1];
        if (!last || last.h + b.h > PAGE_PX - CONT_HEAD_PX) dChunks.push({ h: b.h, list: [b] });
        else { last.h += b.h; last.list.push(b); }
      });
      // No header: these pages follow their own zone's page, which already names the zone, function and date —
      // like a zone's later pages, just clear space under the corner brackets (owner ask: nothing repeats).
      return dChunks.map(pgk => `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
          <div style="height:${CONT_GAP}px"></div>
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
          <div class="zk">${t("Function {n}", { n: no })}</div>
          <h2 style="font-size:52px">${esc(hn(type) || t("Function {n}", { n: no }))}</h2>
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
      const cs = pg.items.length ? chunks(pg.items, 6) : [[]];
      cs.forEach((c, i) => zonePageHtml.push(zoneSection(pg, c, i + 1, cs.length, zi + 1, i * 6)));
      // Right after THIS zone's own card page(s) — a zone's recipe/kit detail never shares a page
      // with another zone's, and never lands in a single combined reference page at the book's end.
      zonePageHtml.push(...zoneDetailPages(pg));
    });
    // ── WHAT IS ALREADY STANDING AT THE VENUE ── (owner ask 2026-11-02) right after the cover: the event venue's Fixed Venue stock
    // for this department (every department's in the combined book) - already there, not to be loaded. One page per Fixed Venue the
    // event's functions use; from Settings → Fixed Venues (fvSettings).
    // ── POWER / GENSET ── (owner ask 2026-11-03) the Lighting book opens with the gensets: every function's 125 kVA and
    // 62.5 kVA units and the total, right after the cover. Each function's own plan from Studio (functionsDetail[].gensets),
    // else its venue's standard count. Lighting's book and the all-departments book.
    const gensetPage = (() => {
      if (!(combined || dept === "Lighting")) return "";
      const list = (fns.length ? fns : [{ type: sel?.eventType || "", date: selDateStr, venue: sel?.venue }]).map((fn, fi) => ({ fn, fi, g: gensetsForFn(fn, trVenues) })).filter(r => r.g);
      if (!list.length) return "";
      const unit = (n, kva) => n > 0 ? `<div class="gs-u"><b>${esc(n)}</b><span>× ${kva} kVA</span></div>` : "";
      const cardOf = ({ fn, fi, g }) => {
        const name = [hn(fn?.type) || (list.length > 1 ? t("Function {n}", { n: fi + 1 }) : ""), fn?.date].filter(Boolean).join(" · ");
        const none = !(g.kva125 > 0) && !(g.kva62 > 0);
        return `<div class="gs-c">
          <div class="gs-h"><span>⚡ ${esc(name || t("The event"))}</span>${fn?.venue ? `<i>${esc(hn(fn.venue))}</i>` : ""}</div>
          ${none ? `<div class="gs-none">${t("No genset")}</div>` : `${unit(g.kva125, "125")}${unit(g.kva62, "62.5")}<div class="gs-t">${t("Total {n} kVA", { n: esc(totalKva(g)) })}</div>`}
        </div>`;
      };
      // Six cards a page (three rows of two) - a long multi-function booking continues on the next page.
      const pages = chunks(list, 6);
      return pages.map((c, i) => `<section data-block data-page class="zp"><div class="pc tl"></div><div class="pc tr"></div>
        <div class="zh"><div><div class="zk"><b>${t("Power")}</b>${pages.length > 1 ? ` · ${t("Part {part} of {parts}", { part: i + 1, parts: pages.length })}` : ""}</div><h2>${t("Genset")}</h2>
          <div class="orn l"><i></i><b></b><i></i></div>
          <div class="zm">${t("Gensets for this event")}</div></div></div>
        <div class="gs-g">${c.map(cardOf).join("")}</div>
      </section>`).join("");
    })();
    // Not in the master (all-departments) book (owner ask 2026-11-11) - a department's own book still lists its standing stock.
    const fixedVenuePages = combined ? "" : (() => {
      const names = [...new Set((fns.length ? fns.map(f => f?.venue) : [sel?.venue]).filter(Boolean))];
      const seen = new Set();
      return names.flatMap(vn => {
        const fv = fixedVenueFor(fvSettings, vn);
        if (!fv || seen.has(fv.name)) return [];
        seen.add(fv.name);
        const items = (fv.items || []).map(it => {
          const inv = invById.get(String(it?.invId));
          const qty = (Number(it?.qty) || 0) + (Number(it?.fullQty) || 0);
          if (!inv || !(qty > 0)) return null;
          const d = catToDept(inv.category || inv.cat);
          if (!combined && d !== dept) return null;
          return { name: inv.name, qty, unit: String(inv.unit || "").trim(), photo: invPhoto(inv, null), dims: invDims(inv), deptTag: combined ? d : "", kit: 0, recipe: [] };
        }).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return listPages(items, t("Fixed at venue"), hn(fv.name), t("Already standing here - not to be loaded"));
      }).join("");
    })();
    const zoneHtml = [
      ...zonePageHtml,
      ...(combined ? [] : [
      ...listPages(prodItems, t("Production"), t("From production"), t("Made by the production team for this event")),
      ...listPages(buyItems, t("Buying"), t("To buy"), t("Bought in for this event — not from our own stock")),
      ...listPages(looseItems, t("Not in a zone"), t("Also on site"), looseNote),
      ]),
    ].join("");

    // The cover's backdrop: this event's Stage photo when it has one (the setup the book is
    // really about), otherwise the first zone that has a photo.
    const coverPhoto = (zonePages.find(p => /stage/i.test(p.zk) && p.photo) || zonePages.find(p => p.photo) || {}).photo || "";
    // The event's sessions (its functions) for the cover: what, when, and the details that shape
    // a setup — shift, headcount and, when it differs from the event's main venue, where.
    const niceDate = (ds) => {
      if (!ds) return t("Date to be set");
      const d = new Date(ds + "T00:00:00");
      return isNaN(d) ? String(ds) : pdfDate(lang, d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    };
    // `skipped` on a function is the LIST of Deal Check lines skipped in it, not a flag — an empty
    // array is truthy, so filtering on it dropped every session and the cover showed none.
    const sessions = fns.filter(Boolean).map((f, i) => ({
      type: f.type || t("Session {n}", { n: i + 1 }),
      date: niceDate(f.date),
      // Short form for the card's DATE cell ("Sat, 29 Aug 2026") — the long one does not fit a column.
      dateShort: (() => { if (!f.date) return t("To be set"); const d = new Date(f.date + "T00:00:00"); return isNaN(d) ? String(f.date) : pdfDate(lang, d, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); })(),
      shift: f.shift ? String(f.shift) : "",
      pax: Number(f.pax) > 0 ? String(f.pax) : "",
      place: f.venue && f.venue !== venue ? f.venue : "",
      // The function's palettes as Build set them (owner ask 2026-11-03: on the cover) - fabric colours and the flower mix.
      fabric: parseFabricPalette(f.fabricPalette).map(c => c.name),
      flowers: parseFlowerPalette(f.flowerPalette),
    }));
    const anyPalette = sessions.some(s => s.fabric.length || s.flowers.length);
    const palDot = (hex) => `<i style="background:${esc(hex)}"></i>`;
    const sessionPalettes = (s) => (s.fabric.length || s.flowers.length) ? `<div class="spal">
        ${s.fabric.length ? `<div class="sp"><span class="k">${t("Fabric")}</span>${s.fabric.map(c => `<b>${palDot(swatchHexFor(c, settings?.colourCatalogue))}${esc(hn(c))}</b>`).join("")}</div>` : ""}
        ${s.flowers.length ? `<div class="sp"><span class="k">${t("Flowers")}</span>${s.flowers.map(c => `<b>${palDot(flowerPaletteHexFor(c.name))}${esc(hn(c.name))} ${esc(c.pct)}%</b>`).join("")}</div>` : ""}
      </div>` : "";
    // One colour per kind of function, so a three-function book reads at a glance. Anything not
    // listed takes the next colour in the rotation.
    const SES_TONES = { wedding: "wine", reception: "navy", cocktail: "navy", sangeet: "plum", mehendi: "sage", mehndi: "sage", haldi: "amber", engagement: "rose", ring: "rose", birthday: "amber" };
    const TONE_ROT = ["wine", "sage", "navy", "amber", "plum", "rose"];
    const sesTone = (t, i) => SES_TONES[Object.keys(SES_TONES).find(k => String(t).toLowerCase().includes(k))] || TONE_ROT[i % TONE_ROT.length];
    // Gold line — diamond — gold line: the one ornament, reused on the cover and on every zone page.
    const ornament = `<div class="orn"><i></i><b></b><i></i></div>`;

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(bookTitle)} — ${esc(hn(sel?.clientName) || t("Event"))} — Ambria</title>
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
  /* A title longer than a department name ("All departments") is set smaller: at 76px it filled the card and its descenders
     ran into the client line below, which html2canvas draws a few px low anyway. */
  .cv-title.long{font-size:56px;line-height:1.2}
  .cv-title.long + .cv-for{margin-top:12px}
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
  /* padding inside the 300px, so two sit side by side on the 634px card (with it outside, two came to ~708px and stacked) */
  .cv-sessions.many:not(.dense) .cv-ses{box-sizing:border-box}
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
  .cv-ses .spal{margin-top:12px;display:flex;flex-direction:column;align-items:center;gap:5px}
  .cv-ses .sp{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:3px 10px;font-size:12.5px;line-height:1.5;color:#1A1A1A}
  .cv-ses .sp .k{font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7A7468;margin-right:2px}
  .cv-ses .sp b{display:inline-flex;align-items:center;gap:4px;font-weight:600;white-space:nowrap}
  .cv-ses .sp i{display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.18)}
  .cv-sessions.dense .cv-ses .spal{margin-top:7px;gap:3px}
  .cv-sessions.dense .cv-ses .sp{font-size:10.5px;gap:2px 7px}
  .cv-sessions.dense .cv-ses .sp .k{font-size:8px;letter-spacing:.12em}
  .cv-sessions.dense .cv-ses .sp i{width:8px;height:8px}
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
  .ztk-w{margin:0 0 10px}
  .znote{box-sizing:border-box;margin:0 0 12px;padding:8px 14px;border:1px solid #F1D99A;border-radius:10px;background:#FFF9E8;font-size:12.5px;line-height:18px;color:#5A3E0A;white-space:pre-wrap;overflow:hidden}
  .znote b{display:inline;margin-right:8px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#9A6B1F}
  .ztk-t{height:20px;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A7263}
  .ztk{display:flex;box-sizing:border-box;border:1px solid #DDD4C2;border-radius:12px;background:#FBF8F1;overflow:hidden}
  .ztk-c{flex:1;min-width:0;box-sizing:border-box;padding:10px 16px;overflow:hidden}
  .ztk-c + .ztk-c{border-left:1px solid #E7DFCF}
  .ztk-h{display:flex;align-items:center;justify-content:space-between;height:22px;margin-bottom:6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7A7263}
  .ztk-h b{font-size:12px;letter-spacing:0;color:#1A1A1A}
  .ztk-l{display:flex;align-items:baseline;gap:6px;height:19px;font-size:13px;color:#1A1A1A;white-space:nowrap}
  .ztk-l b{font-weight:700;min-width:18px}
  .ztk-l span{font-weight:500;color:#4A453C}
  .ztk-big{font-size:15px}
  .ztk-l.ztk-miss b,.ztk-l.ztk-miss span{color:#B42318}
  .ztk-s{font-size:10.5px;color:#7A7263;margin-top:2px}
  .zst span{box-sizing:border-box;height:30px;line-height:30px;padding:0 12px;font-size:12px;font-weight:700;color:#1A1A1A;background:#EFE9DC;border:1px solid #DDD4C2;border-radius:8px;white-space:nowrap}
  .zst .zl{font-style:normal;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A7263;margin-right:7px}
  /* Flower palette colours: a dot in the colour, then its name and share. */
  .zst .fpc{font-weight:700;margin-right:10px}
  .zst .fpc:last-child{margin-right:0}
  .zst .fpc i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px;border:1px solid rgba(0,0,0,.18)}
  .zst .fpc i.fph{width:20px;height:20px;border-radius:5px;border:1px solid rgba(0,0,0,.15);background-size:cover;background-position:center;vertical-align:-6px;margin-right:6px}
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
  .gs-g{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
  .gs-c{box-sizing:border-box;padding:18px 20px;border:1px solid #DDD4C2;border-radius:14px;background:#FBF8F1}
  .gs-h{display:flex;flex-direction:column;gap:3px;margin-bottom:14px;font-size:14px;font-weight:700;color:#1A1A1A}
  .gs-h i{font-style:normal;font-size:11.5px;font-weight:600;color:#7A7263}
  .gs-u{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
  .gs-u b{font-size:30px;font-weight:800;color:#1A1A1A;line-height:1.1}
  .gs-u span{font-size:16px;font-weight:600;color:#4A453C}
  .gs-t{margin-top:10px;padding-top:10px;border-top:1px solid #E7DFCF;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7A7263}
  .gs-none{font-size:15px;font-weight:700;color:#7A7263}
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
  .kb-tg{font-style:normal;font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9A8F76;margin-left:3px}
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
<button class="noprint" onclick="window.print()">${t("Save as PDF")}</button>
<div class="sheet" id="sheet">
<header class="cover" data-block data-cover style="${bgCss(coverPhoto)}" ${bgData(coverPhoto)}>
  <div class="cv-shade"></div>
  <div class="cv-card">
    <div class="cv-ribbon"></div>
    <div class="cv-corner tl"></div><div class="cv-corner tr"></div><div class="cv-corner bl"></div><div class="cv-corner br"></div>
    ${logos.dark ? `<img class="cv-logo" src="${logos.dark}" alt="Ambria — Design &amp; Decor">` : `<div class="cv-mark">AMBRIA</div>`}
    <div class="cv-kind">${t("Setup book")}</div>
    <div class="cv-title${String(bookTitle || "").length > 11 ? " long" : ""}">${esc(bookTitle)}</div>
    <div class="cv-for">${esc(hn(sel?.clientName) || t("Event"))}</div>
    ${ornament}
    <div class="cv-facts">
      <div><div class="k">${t("Venue")}</div><div class="v">${esc(hn(venue))}</div></div>
      <div><div class="k">${t("Prepared by")}</div><div class="v">${esc(hn(preparedBy || authUser?.name) || "—")}</div></div>
    </div>
    ${sessions.length ? `<div class="cv-sec">${sessions.length === 1 ? t("The event") : t("{n} sessions", { n: sessions.length })}</div>
    <div class="cv-sessions${sessions.length > 4 || (anyPalette && sessions.length > 2) ? " many dense" : (sessions.length > 2 || (anyPalette && sessions.length === 2)) ? " many" : ""}">${sessions.map((s, i) => `<div class="cv-ses t-${sesTone(s.type, i)}">
      <div class="sk">${t("Event type")}</div>
      <div class="st">${esc(hn(s.type))}</div>
      <div class="sl"></div>
      <div class="sg">
        <div class="sf"><div class="k">${t("Date")}</div><div class="v">${esc(s.dateShort)}</div></div>
        ${s.shift ? `<div class="sf"><div class="k">${t("Shift")}</div><div class="v">${esc(hn(s.shift))}</div></div>` : ""}
        ${s.pax ? `<div class="sf"><div class="k">${t("Guests")}</div><div class="v">${esc(s.pax)}</div></div>` : ""}
      </div>
      ${sessionPalettes(s)}
      ${s.place ? `<div class="sm">${esc(hn(s.place))}</div>` : ""}
    </div>`).join("")}</div>` : ""}
  </div>
  <div class="cv-bottom"><span>${esc(bookTitle)} / ${esc((selDateStr || "").slice(0, 4) || new Date().getFullYear())}</span>${logos.light ? `<img class="cv-logo-l" src="${logos.light}" alt="Ambria — Design &amp; Decor">` : `<span>Ambria · Design &amp; Decor</span>`}</div>
</header>
${/* Money, the priced inventory table, the crew plan and logged spend are left out: this sheet
     goes to the people setting up the event, who need what goes where, not what it costs. The
     zone layout pages below carry every item, with photo, qty and size. */ ""}
${gensetPage}
${fixedVenuePages}
${zoneHtml}
${combined ? "" : (truckRows.length || loadRows.length) ? sect(t("Loading & dispatch"),
  (truckRows.length ? table(["#", t("Vehicle"), t("Driver"), t("Phone"), t("Status")], truckRows, ["12%", "26%", "24%", "20%", "18%"]) : "")
  + (loadRows.length ? `<p class="meta">${t("Everything going to site — {items}, {pieces} in total.", { items: t("{n} item|{n} items", { n: blockedItems.length }), pieces: t("{n} piece|{n} pieces", { n: loadUnits }) })}</p>`
    + table([t("Item"), t("Qty")], loadRows, ["80%", "20%"]) : "")) : ""}
${artRows.length ? sect(t("Artificial flowers & greens"), table([t("Item"), t("Bunches"), t("Bunches per kg"), t("Weight")], artRows, ["46%", "16%", "20%", "18%"])
  + (artColourRows.length ? `<p class="meta">${t("Pull these specific bunches")}</p>` + table([t("Colour"), t("Bunches")], artColourRows, ["80%", "20%"]) : "")) : ""}
${!combined && trRows.length ? sect(t("Transport"), table([t("Load"), t("Quantity"), t("Fits per truck"), t("Trucks")], trRows, ["46%", "20%", "22%", "12%"]) + `<p class="note">${trNote}</p>`) : ""}
${!combined && moveRows.length ? sect(t("Dismantle routing"), table([t("Item"), t("Goes to"), t("Qty"), t("Logged by")], moveRows, ["38%", "32%", "12%", "18%"])) : ""}
${!combined && fabRows.length ? sect(t("Fabric required vs available"), table([t("Fabric · colour"), t("Required"), t("Available"), t("Status")], fabRows, ["40%", "20%", "20%", "20%"])) : ""}
<footer data-block>
  ${logos.dark ? `<img class="ft-logo" src="${logos.dark}" alt="Ambria — Design &amp; Decor">` : `<div class="ft-mark">AMBRIA · DESIGN &amp; DECOR</div>`}
  <div class="ft-meta">${t("Generated {date} · {name}", { date: esc(pdfDateTime(lang, new Date())), name: esc(hn(authUser?.name) || "—") })}</div>
</footer>
</div>
</body></html>`;
    // The Hindi book: Devanagari fonts in every stack, lang="hi", no letter-spacing / uppercase (lib/ims/pdfI18n). English is returned as built.
    return lang === "hi" ? hindiReportHtml(html) : html;
}

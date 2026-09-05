// ═══════════════════════════════════════════════════════════════
// DEAL CHECK FULL-PAGE OVERLAY — structural shell (Studio slice).
// VERBATIM port of the reference overlay frame, tab nav, shared cost
// rollup, sidebar, bottom strip, and the GYV + Inventory Status tab
// bodies. The 7 large sub-tabs (inventory / truss / florals / manpower /
// production / buying / transport) are placeholders pending later slices.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import DCFloralsTab from "./tabs/DCFloralsTab.jsx";
import DCManpowerTab from "./tabs/DCManpowerTab.jsx";
import DCTrussTab from "./tabs/DCTrussTab.jsx";
// Shared Deal Check surfaces/inks — the same source DCManpowerTab draws from, so the
// two tabs cannot drift the way this file's own `IV` object and Manpower's private
// block already had. NUM is deliberately not imported: this file declares an
// identical one at line 43 and importing it would be a redeclare.
import { CARD_SHADOW, CARD_BG, CARD_BORDER, HAIRLINE, TILE_BG, TILE_BORDER, CHIP_BG, INK, INK_2, INK_3, GOLD, GOLD_SOFT, BAD, BAD_SOFT, GOOD, GOOD_SOFT, DC_CSS, deptAccent } from "../../../lib/studio/dcTokens";
import { thumbUrl } from "../../../lib/studio/thumb";
import { matchFlowerPattern } from "../../../lib/ims/flowerHelpers";
import { DEPTS as OPS_DEPTS, catToDept as sharedCatToDept } from "../../../lib/ims/deptClassify";
import ItemHoverThumb from "../../../components/shared/ItemHoverThumb.jsx";
import { WASH_BANDS, GRAIN_URL } from "../../../lib/studio/pageWash";

// ══ THE PAGE'S GROUND ══
// A glob, not an import, for the same reason every other background in this app uses one: if the file
// is not there the glob resolves to {}, DC_BG is null, and the CSS wash below carries the page as it
// did before. An import of a missing asset fails the whole build instead.
// Drop the artwork in as src/assets/ambria-dealcheck-bg.(jpg|png|webp|jpeg) and it takes over on the
// next reload — nothing else has to change.
const DC_BG = Object.values(
  import.meta.glob("../../../assets/ambria-dealcheck-bg.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" })
)[0] || null;
// The zone-row action marks, taken from Build so one action does not have two pictures.
import { IconFactory, IconCart, IconPlatform, IconCheck, IconAlert, IconChevron, IconBox } from "../../../components/icons.jsx";

// ═══ SURFACES ═══
// Deal Check sits on a wedding-artwork ground, so a translucent fill reads as a different colour on
// every event type and washes the figures out — the same finding that drove Florals and the Truss
// tab onto opaque cards. Three depths only: white card → grey tile → chip, all opaque hex.
// ── HOVER TO ENLARGE A THUMBNAIL ──
// The same control the Build screen gives every element thumbnail, brought to Deal
// Check: the thumbnails here run 22–54px, which is enough to tell two items apart
// only if you already know what you are looking for.
//
// Two things are load-bearing and easy to get wrong:
//  · The popup is portaled to <body>. Cards lift on :hover via a CSS transform, and
//    a transformed ancestor makes position:fixed resolve against THAT ancestor
//    instead of the viewport — the popup would be placed by coordinates that no
//    longer mean what they measured. Escaping the subtree is the fix.
//  · It flips above the thumbnail when there is no room below, so a card near the
//    bottom of the page does not open a preview off-screen.
// pointerEvents:none so the preview can never sit between the cursor and the thing
// being hovered, which would make it flicker.
function HoverZoom({ src, children }) {
  const [pos, setPos] = useState(null);
  if (!src) return children;
  const POP = 164;
  return (
    <span
      style={{ display: "inline-flex", flexShrink: 0, cursor: "zoom-in" }}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const openUp = window.innerHeight - r.bottom < POP + 8 && r.top > POP + 8;
        setPos({
          top: openUp ? undefined : r.bottom + 4,
          bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
          left: Math.min(r.left, window.innerWidth - 168),
        });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <div style={{position:"fixed",top:pos.top,bottom:pos.bottom,left:pos.left,zIndex:10000,width:160,height:160,borderRadius:10,overflow:"hidden",border:"2px solid #FFFFFF",boxShadow:"0 10px 30px rgba(36,30,53,0.34)",pointerEvents:"none",background:"#FFFFFF"}}>
          <img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />
        </div>,
        document.body
      )}
    </span>
  );
}

const IV = {
  card: "#FFFFFF", border: "#E4E6EA", tile: "#F5F6F8", chip: "#EBEDF2",
  shadow: "0 1px 2px rgba(26,26,46,0.06), 0 4px 12px rgba(26,26,46,0.06)",
  // Three ink levels. Everything here had been flattened to one #1A1A2E, so a unit label carried the
  // same weight as the rupee figure beside it. Both greys clear 4.5:1 on white.
  ink: "#1A1A2E", ink2: "#5A6076", ink3: "#7C8296",
  gold: "#8A6A32", green: "#059669", amber: "#B45309", red: "#DC2626",
};
// Money and counts are read down a column and compared, so they need fixed-width digits.
const NUM = { fontVariantNumeric: "tabular-nums" };
import { heavyExtraLabour, eventTimingMultFor } from "../../../lib/ims/constants";
import { deptMpReconciled, itemImsSubcat, lookupBySubcat, itemDimsText } from "../../../lib/ims/helpers";
import { rentalSplit, availableAtVenue, isStandingAt, fixedVenueFor, standingReductionBySubcat, standingPillarCount } from "../../../lib/ims/fixedVenues";
import { calcZoneFabric, autoFillFabricAllocation, resolveTrussConfig } from "../../../lib/studio/pricing";
import { carpetPricingFor, CARPET_OFF } from "../../../lib/studio/taxonomy";
import { qtyUsedElsewhereInDealCheck } from "../../../lib/studio/dealAvailability";
import { isHiddenSubcat, oosCostPctFor } from "../../../lib/rateCard";

// Commission override box (one per venue, Commission tab below) — its OWN local draft state, not
// a slice of DealCheckOverlay's. That component recomputes dcCostRollup (florals, manpower
// schedules, department splits — genuinely heavy) fresh on every render, so a draft keyed into
// its state re-ran all of that on every keystroke, which is what read as the field "glitching"
// while typing. Isolating the draft here means a keystroke only re-renders this one input; the
// parent only re-renders (and only then recomputes the rollup) once, on blur/Enter commit.
function CommissionOverrideInput({ defaultAmt, overrideVal, border, onCommit }) {
  const [draft, setDraft] = useState(overrideVal != null ? String(overrideVal) : "");
  // Follow an external change (switching venues shows the same input slot with different props,
  // or another tab/device committed a new override) — but never while this box has an in-progress
  // edit of its own, or a value arriving mid-type would stomp on what's being typed.
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(overrideVal != null ? String(overrideVal) : "");
  }, [overrideVal]);
  const commit = () => {
    editingRef.current = false;
    const raw = draft.trim();
    if (raw === "") { onCommit(null); return; }
    const n = Number(raw);
    onCommit(isFinite(n) ? n : null);
  };
  return (
    <input
      type="number"
      value={draft}
      placeholder={String(Math.round(defaultAmt))}
      onFocus={() => { editingRef.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
      style={{ width: 110, padding: "5px 8px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 13, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
    />
  );
}

export default function DealCheckOverlay({ ctx }) {
  // ── THE APP'S NAVBAR STAYS ON SCREEN ──
  // This overlay was inset:0 at z-index 9000, so it covered the header — and with it the step nav, the
  // Studio/IMS switcher and the way out of the deal. Deal Check is a STEP of the Summary, not a
  // separate application, and the reference has the bar sitting above it.
  // Measured rather than assumed, and observed with a ResizeObserver, because the header's height is
  // not a constant: it wraps to a second row on a narrow window and grows again when the function row
  // appears. A hardcoded offset is right until the bar changes shape and then leaves a gap or hides
  // a row. Same approach Browse and Build already use for the same measurement.
  const [navH, setNavH] = useState(0);
  useEffect(() => {
    const el = document.querySelector(".sa-header");
    if (!el) return undefined;
    const read = () => setNavH(el.getBoundingClientRect().height || 0);
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [dcDept, setDcDept] = useState("Furniture"); // active Department-Income sub-tab
  const deptSyncRef = useRef(""); // dedupe auto-push of the dept snapshot to IMS
  const [dcKitAddSearch, setDcKitAddSearch] = useState({}); // per-kit-card "add component" search text, keyed by editKey
  const {
    // chrome / theme
    border, textS, textP, accent, fmt,
    // client + auth
    clientLedger, activeClientId, clientName, clientDate, authUser,
    // deal check state
    dcActiveTab, setDcActiveTab, dcGenerating, dcGenStatus,
    dcCards, dcInventoryCache, dcCarpetPick, setDcCarpetPick, dcCarpetSearch, setDcCarpetSearch,
    dcKitEdits, setDcKitEdits, dcManualItems, setDcManualItems, dcManualSearch, setDcManualSearch,
    dcCollapsedZones, setDcCollapsedZones, setDcBrowseAllOpen, dcBrowseAllOpen, setDcCustomModal,
    dcCustomItems, setDcCustomItems, elSelectedPhoto, dcDedupOverrides, setDcDedupOverrides,
    // photoKnowledge / saveKnowledgeEntry / dcKnowledgeKey were destructured here for the
    // "Set as correct match for this photo" control. That control is gone, and nothing else in
    // this file read them — re-add all three if the teach action comes back.
    dcDesiredMargin, setDcDesiredMargin, dcSavingDraft, setDcSavingDraft, closeDealCheck,
    dcSaveBaselineRef, dcConflictWarnedAtRef,
    dcZoneState, dcMpOverrides, dcMpWinCount, dcMpIncludeMinusOne, dcMpIncludeDismantle,
    setDcResolved, setDcCards, setDcZoneState, setDcPhotoOverrides, setDcSkipped, setDcProductionAccepted,
    dealCheckData, imsPaletteCatalogue, softHolds, imsPrintMaterials, imsCarpetMaterials,
    // build / fn state
    activeFnIdx: activeFnIdxCommitted, fnPending, switchActiveFn, dcShowAllFns, setDcShowAllFns, dcCollapsedFnBlocks, setDcCollapsedFnBlocks,
    // pricing helpers
    collectAllFunctionData, calcFnFloralSourcingCost, calcFunctionBreakdown, calcFunctionCost,
    // Shared availability picker — the same one Build's IconBox control opens.
    openAvailModal,
    calcZoneTrussPreview, calcZoneFabricCost, calcZoneCarpet, buildPlatformPlan, imsField,
    libItems, rcItems, rcSubcatFactors, normalizePaintAllocation, ensureLibItemsByUrl,
    // deal check inventory-tab module helpers
    isZoneDirty, parseCardKey, PLATFORM_FATTA_CODE, PLATFORM_STAND_CODE,
    // orchestration + persistence
    getStudioAvailable, getActiveSoftHold,
    // misc
    showMsg, saveClientLedger, manpowerPlanForBooking, persistDeptSnapshot, dcEoActuals, refreshDcEoActuals,
  } = ctx;

  // Effective per-unit rental for a card's item — the ONE answer to "what does this cost", used by
  // every rental path below so they cannot disagree.
  //
  // A kit is always priced LIVE: kit base + Σ(component rentals), taking the edited components when
  // the salesperson has customised them and the master list otherwise. It used to fall back to the
  // item's stored `price` whenever the kit was untouched, on the assumption that price already
  // equalled base + parts. IMS does set it that way on save, but nothing rewrites it when a
  // component's rental later changes — 31 of 74 kits had drifted, by up to ₹700 a unit in both
  // directions. Recomputing means changing a component's rental in IMS re-prices every kit at once.
  // ── WHICH FUNCTION THIS OVERLAY IS SHOWING ── (BUG-11)
  // Clicking a function card in the sidebar did nothing on a multi-function deal. switchActiveFn
  // fires correctly, but it commits setActiveFnIdx inside a useTransition — a low-priority,
  // interruptible update. Build's pill nav has always read `fnPending ?? activeFnIdx` so the pill
  // lights up on the click itself; this overlay was never handed `fnPending`, so its sidebar
  // highlight AND its panels hung entirely on the deferred value landing. Deal Check is ~2,900
  // lines that recompute full cost rollups every render, and the 1.5s debounced plus 15s periodic
  // autosaves keep interrupting while it is open — so the transition can be restarted repeatedly
  // and the commit the overlay was waiting on may never arrive.
  //
  // Reading the pending index is SAFE for the data too, not just the highlight, because of how
  // collectAllFunctionData resolves a function: `idx === activeFnIdx` takes the LIVE build state,
  // anything else takes `fnBuilds[idx]`. Mid-switch the committed index is still the old function,
  // so the clicked one is served from fnBuilds — which already holds its build, because it was the
  // non-active function a moment ago. The figures therefore do not change when the transition
  // finally lands: restoreBuildState restores that same snapshot.
  //
  // Shadowing the name rather than patching each read: there are seven, all display/selection, and
  // one missed would leave the sidebar and the panel disagreeing about which function is open.
  const activeFnIdx = fnPending ?? activeFnIdxCommitted;

  const effKitRental = (item, fnIdx, cardKey) => {
    if (!item || !Array.isArray(item.subItems) || !item.subItems.length) return imsField.rentalCost(item);
    const edited = dcKitEdits?.[fnIdx]?.[cardKey];
    const parts = Array.isArray(edited) ? edited : item.subItems;
    return (Number(item.kitBase) || 0) + parts.reduce((s, cp) => {
      const ci = dcInventoryCache.find(x => x.id === (cp.itemId ?? cp.id));
      // An explicit 0 means the component was removed; a missing qty on a master row means one.
      const q = cp.qty == null ? 1 : (Number(cp.qty) || 0);
      return s + (ci ? imsField.rentalCost(ci) : 0) * q;
    }, 0);
  };

  // Repeat-billed rental for ONE line — the single formula every rental display below uses, so
  // they can't drift the way three separate copies of a flat "Repeat = subcat %, applied to the
  // whole qty" formula used to (bottom-bar rollup, sidebar per-fn chip, Inventory tab zone pill).
  //
  // rentalSplit (lib/ims/fixedVenues.js) was built to do exactly this — net an item's REAL
  // standing qty at THIS specific venue, at that item's own IMS-configured discount (edited in
  // IMS → Admin → Fixed Venues) — but had zero callers anywhere in the app until now; the old
  // formula ignored which venue, which item, and how many units were actually standing, applying
  // one global sub-category % to every unit of a Repeat zone regardless.
  //
  // Standing qty here at this venue for this item → those units at its own discount (or the
  // sub-category default, if the item has no override — same fallback the IMS screen itself now
  // shows), anything beyond that qty at full rate. If the item isn't registered standing at this
  // venue at all — including a Repeat zone at a venue that isn't a configured Fixed Venue —
  // Repeat still applies (a reused setup can happen anywhere), just without a venue-specific cap:
  // the whole line at the sub-category default, same as before Fixed Venues data was read here.
  const repeatAdjustedRental = (isRepeatZone, venueName, item, qty, baseRental) => {
    const full = qty * baseRental;
    if (!isRepeatZone || !item) return full;
    // fixedVenueSubcatDiscount rides along here too — standingDiscountPct falls back to it when
    // a standing item has no per-item override of its own, so that fallback needs it on the
    // same object rentalSplit passes through, not just the two keys fixedVenueFor itself reads.
    const fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {}, fixedVenueSubcatDiscount: dealCheckData?.fixedVenueSubcatDiscount || {} };
    const { standingUnits, freshUnits, discountPct } = rentalSplit(fvCfg, venueName, item.id, qty, dcInventoryCache);
    if (standingUnits > 0) return standingUnits * baseRental * (1 - discountPct / 100) + freshUnits * baseRental;
    const key = String(imsField.subcategory(item) || "").toLowerCase().trim();
    const sc = key ? Number((dealCheckData?.fixedVenueSubcatDiscount || {})[key]) : NaN;
    const pct = Number.isFinite(sc) && sc > 0 ? sc : 0;
    return full * (1 - pct / 100);
  };

  // Live soft-blocking: how much of an inventory item is left for THIS deal, netting out both
  // other events' commitments (getStudioAvailable, per fnDate) and whatever sibling
  // functions/zones/cards of this same deal have already used (qtyUsedElsewhereInDealCheck).
  // exclude = { fnIdx, zoneKey? } for whole-zone exclusion, or { fnIdx, cardKey } / { fnIdx, manualId }
  // to exclude just one row. Returns null when nothing else in the deal touches this item (no badge).
  const dcRemainingForItem = (imsId, fnIdx, exclude, fnDate) => {
    const it = (dcInventoryCache || []).find(i => i.id === imsId);
    if (!it || !collectAllFunctionData) return null;
    const fns = collectAllFunctionData();
    const targetDate = fnDate || fns[fnIdx]?.fnDate || clientDate;
    const usedElsewhere = qtyUsedElsewhereInDealCheck(imsId, fns, dcCards, dcManualItems, dcKitEdits, dcInventoryCache, { fnIdx, ...exclude }, targetDate);
    if (usedElsewhere <= 0) return null;
    const fnBlocks = (dealCheckData?.blocksByDate || {})[targetDate] || {};
    const otherEventsAvail = getStudioAvailable(it, fnBlocks);
    return Math.max(0, otherEventsAvail - usedElsewhere);
  };

  // Pull the latest dept-head actuals (IMS) whenever Deal Check opens for this client.
  // The overlay is position:fixed over the whole viewport and scrolls its own body, but the Build
  // page underneath was never frozen — so the browser kept showing ITS scrollbar too, and you got
  // two side by side, the outer one dragging content you cannot even see. Freeze the page while the
  // overlay is mounted and restore exactly what was there before (not a hardcoded "visible", which
  // would clobber any lock another overlay had set).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => { refreshDcEoActuals && refreshDcEoActuals(); }, [activeClientId]);

  // Truss/masking calcs across every function look up a zone's selected photo by URL to read its
  // drapeDensity tag (libItems.find(l => l.url === photoUrl), in DCTrussTab and the rollup below).
  // `libItems` is a lazy cache now — prefetch every function's selected-photo URLs once per client
  // so those lookups aren't silently missing a photo that just hasn't been touched this session.
  useEffect(() => {
    if (!ensureLibItemsByUrl || !collectAllFunctionData) return;
    const fns = collectAllFunctionData();
    const urls = [...new Set(fns.flatMap(f => Object.values(f.elSelectedPhoto || {}))
      .map(p => (typeof p === "string" ? p : p?.src)).filter(Boolean))];
    if (urls.length) ensureLibItemsByUrl(urls);
  }, [activeClientId, collectAllFunctionData, ensureLibItemsByUrl]);

  if (!(authUser && true)) return null;

  return (() => {
        const cli = clientLedger.find(c => c.id === activeClientId);
        const isSold = cli?.status === "booked";
        // The 2-run counter came out with the Generate button — nothing starts a run from this
        // screen any more, so there is no allowance left to display. dcRunCounter is still written
        // by runDealCheckGenerate in StudioApp; only this read of it is gone.
        // Tab definitions — only Inventory/Florals/Transport are functional in Deploy 1
        const TABS = [
          { id: "inventory", label: "Inventory",        icon: "📦", live: true  },
          { id: "truss",     label: "Truss",            icon: "🏗️", live: true  },
          { id: "florals",   label: "Florals",          icon: "🌸", live: true  },
          { id: "manpower",  label: "Manpower",         icon: "👷", live: true  },
          { id: "production",label: "Production",       icon: "🏭", live: true  },
          { id: "buying",    label: "Buying",           icon: "🛒", live: true  },
          { id: "transport", label: "Transport",        icon: "🚚", live: true  },
          { id: "power",     label: "Power",            icon: "⚡", live: true  },
          { id: "status",    label: "Inventory Status", icon: "📊", live: true  },
          { id: "gyv",       label: "GYV & Buffer",     icon: "💰", live: true  },
          { id: "commission",label: "Commission",       icon: "🤝", live: true  },
          // Dept Income removed from the tab strip. Its body below is left in place and still
          // renders if dcActiveTab is somehow "depts" — the department split is also pushed to
          // IMS Dept Ops from persistDeptSnapshot, which does not depend on this tab.
        ];
        const activeTabDef = TABS.find(t => t.id === dcActiveTab) || TABS[0];

        // ═══ Shared cost rollup — single computation used by GYV tab + bottom strip (§26.19) ═══
        const dcCostRollup = (() => {
          const fns = collectAllFunctionData ? collectAllFunctionData() : [];
          let rental = 0, florals = 0, transport = 0, manpower = 0, truss = 0, genset = 0;
          // Unavailable-shortfall pricing: a matched card's qty beyond what's actually free in
          // stock for the event date bills at item.cost × this sub-category's cost% instead of
          // the rental rate (rate_card_categories.cost_percent, IMS-owned). Default 100 (full
          // production cost) when a sub-category has no row yet.
          const costPctByKey = {};
          (rcSubcatFactors || []).forEach((r) => { if (r && r.id) costPctByKey[r.id] = Number(r.cost_percent); });
          const costPctFor = (subcat) => {
            const key = String(subcat || "").trim().toLowerCase();
            const v = key ? costPctByKey[key] : undefined;
            return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 100;
          };
          // ═══ §Department income (7 depts) — every rupee tagged to a department ═══
          const DEPTS = OPS_DEPTS;
          const dept = {}; DEPTS.forEach(d => { dept[d] = { rental: 0, florals: 0, truss: 0, fabric: 0, transport: 0, manpower: 0, production: 0, buying: 0, total: 0 }; });
          const deptInv = {}; DEPTS.forEach(d => { deptInv[d] = []; }); // per-dept blocked-inventory detail (name/photo/qty/unit/total)
          const mpByType = {}; // manpower cost per labour type (distributed to depts at the end)
          let mpRateByType = {}; // rate per type (for editable, reconciling crew rows in Dept Ops)
          const deptMp = {}; DEPTS.forEach(d => { deptMp[d] = {}; }); // per-dept, per-type manpower cost (sums to dept.manpower)
          let dcMpPhases = null; // {minusOne, eventDays, gapDays, dismantle} — the day phases crew is booked across
          const mpSchedule = {}; // type → [{date, phase, count, windows}] — the working-dihari schedule per crew
          const mpSharedTotals = {}; // type → global cost (for shared crew split explanation)
          const deptDirectMap = {}; // dept → direct income (drives the shared split %)
          // Usage-based Labour: 1 labour per N of each sub-category (labourTiers.Labours.subCatBatches),
          // each sub-category's labour charged to ITS department. Populated in the manpower block below.
          const labourUsageByDept = {}; DEPTS.forEach(d => { labourUsageByDept[d] = 0; });
          let labourUsageTotal = 0, labourUsageMode = false;
          // Per-DAY usage split: each day's Labour cost is routed to departments by THAT day's element
          // usage. labourDeptCost = Σ-over-days(dayCost × dayFrac[dept]); labourShareByDayDept exposes
          // the per-day fraction so Dept Ops can show each day's bifurcation + this dept's share.
          const labourDeptCost = {}; DEPTS.forEach(d => { labourDeptCost[d] = 0; });
          const labourShareByDayDept = {};
          const addD = (d, key, amt) => { if (!d || !dept[d] || !amt || !(amt > 0)) return; dept[d][key] += amt; };
          // Category (rate-card OR inventory) → department. First the admin-editable map
          // (Settings → Departments); else keyword matching. Sub-cat already implies its category.
          const catDeptCfg = dealCheckData?.categoryDepartments || {};
          const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);
          // Fixed-venue "Repeat" rental — see repeatAdjustedRental above for the actual formula
          // (venue-specific standing qty + that item's own IMS discount, falling back to the
          // sub-category default at any other venue). This just says WHICH zones are Repeat.
          const zoneIsRepeat = (fn, ck) => { const zk = String(ck || "").split("::")[1]; return !!(zk && fn.zoneConfig?.[zk]?.repeat); };
          fns.forEach((fn, fi) => {
            const cards = dcCards[fi] || {};
            // Same blocksByDate resolution the Inventory Status tab already uses (line ~1690) —
            // one lookup per function, reused for every card's availability check below.
            const fnBlocks = (dealCheckData?.blocksByDate || {})[fn.fnDate || clientDate] || {};
            Object.entries(cards).forEach(([ck, c]) => {
              // Split fulfilment: the card's qty is spread across several simple items ({imsId,qty}) — each
              // bills + reserves as its own line (repeat discount per its own sub-category). Overrides the single item.
              const splitArr = Array.isArray(c.split) ? c.split.filter(s => s && s.imsId && (Number(s.qty) || 0) > 0) : [];
              if (splitArr.length) {
                const _rep = zoneIsRepeat(fn, ck);
                splitArr.forEach(s => {
                  const it = dcInventoryCache.find(x => x.id === s.imsId); if (!it) return;
                  const q = Number(s.qty) || 0; const br = imsField.rentalCost(it);
                  const line = repeatAdjustedRental(_rep, fn.fnVenue, it, q, br);
                  rental += line;
                  const dd = catToDept(imsField.category(it));
                  addD(dd, "rental", line);
                  if (line > 0 && deptInv[dd]) deptInv[dd].push({ name: it.name, photo: imsField.photos(it)[0] || "", qty: q, unit: br, total: Math.round(line), sub: imsField.subcategory(it) || "", imsId: it.id });
                });
                return;
              }
              if (!c.imsId) return;
              const item = dcInventoryCache.find(x => x.id === c.imsId);
              if (!item) return;
              // Fixed-venue rental discount: standing units (already installed here) bill at a
              // discount; fresh units / other venues / swapped designs bill full rate-card.
              // Kit pricing lives in effKitRental — this used to carry its own copy of that logic,
              // which is how the charge and the kit breakdown line came to disagree on screen.
              const baseR = effKitRental(item, fi, ck);
              const qty = c.qty || 1;
              const _rep = zoneIsRepeat(fn, ck);
              // Unavailable-shortfall pricing: qty beyond what's actually free in stock for this
              // function's date bills at item.cost × sub-category cost%, not the rental rate.
              // Kits are excluded — their base+components pricing model doesn't map onto a simple
              // per-unit reused/fresh split (same reasoning calcZoneCarpet already uses for carpet).
              const isKit = Array.isArray(item.subItems) && item.subItems.length > 0;
              let lineRental;
              if (isKit) {
                lineRental = repeatAdjustedRental(_rep, fn.fnVenue, item, qty, baseR);
              } else {
                const available = getStudioAvailable(item, fnBlocks);
                const ownedQty = Math.min(qty, available);
                const shortQty = Math.max(0, qty - available);
                const ownedRental = repeatAdjustedRental(_rep, fn.fnVenue, item, ownedQty, baseR);
                const shortCost = shortQty * (Number(item.cost) || 0) * (oosCostPctFor(item, costPctFor) / 100);
                lineRental = ownedRental + shortCost;
              }
              rental += lineRental;
              const dD = catToDept(imsField.category(item) || c.cat);
              addD(dD, "rental", lineRental);
              if (lineRental > 0 && deptInv[dD]) {
                // Kit composite → also carry its component items (customised per-deal via dcKitEdits,
                // else the master subItems) so Dept Ops can list each sub-element with its own rental.
                let components;
                if (Array.isArray(item.subItems) && item.subItems.length > 0) {
                  const edited = dcKitEdits[fi]?.[ck];
                  const comps = Array.isArray(edited) ? edited : item.subItems.map(s => ({ itemId: s.itemId, qty: Number(s.qty) || 1 }));
                  components = comps.map(cp => {
                    const ci = dcInventoryCache.find(x => x.id === cp.itemId);
                    if (!ci) return null;
                    const cq = (Number(cp.qty) || 1) * qty;   // component qty × number of kits
                    const cr = imsField.rentalCost(ci);
                    return { name: ci.name, imsId: ci.id, qty: cq, unit: cr, total: Math.round(cr * cq), sub: imsField.subcategory(ci) || "", photo: imsField.photos(ci)[0] || "" };
                  }).filter(Boolean);
                }
                deptInv[dD].push({ name: item.name || c.name || "Item", photo: imsField.photos(item)[0] || "", qty, unit: baseR, total: Math.round(lineRental), sub: imsField.subcategory(item) || "", imsId: c.imsId, ...(components && components.length ? { isKit: true, components } : {}) });
              }
            });
            // Manually-added inventory blocks (dcManualItems) — the salesperson added these directly in
            // Deal Check; they must reserve + show in Dept Ops just like matched cards (they were being
            // dropped from the snapshot entirely, so Dept Ops never saw them).
            (dcManualItems || []).filter(mi => mi.fnIdx === fi).forEach(mi => {
              const item = dcInventoryCache.find(x => x.id === mi.imsId);
              if (!item) return;
              const q = Number(mi.qty) || 1;
              // A manually added item can be a kit too — price it the same way as a matched card.
              const baseR = effKitRental(item, fi, null);
              const _rep = mi.zoneKey ? !!(fn.zoneConfig?.[mi.zoneKey]?.repeat) : false;
              const lineRental = repeatAdjustedRental(_rep, fn.fnVenue, item, q, baseR);
              rental += lineRental;
              const dD = catToDept(imsField.category(item));
              addD(dD, "rental", lineRental);
              if (deptInv[dD]) deptInv[dD].push({ name: item.name || "Item", photo: imsField.photos(item)[0] || "", qty: q, unit: baseR, total: Math.round(lineRental), sub: imsField.subcategory(item) || "", imsId: mi.imsId });
            });
            try { const fl = calcFnFloralSourcingCost(fn).grandTotal; florals += fl; addD("Floral", "florals", fl); } catch {}
            try { const bd = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; if (bd && bd.transportTotal) { transport += bd.transportTotal; addD("Transport", "transport", bd.transportTotal); genset += Number(bd.transport?.gensetCost) || 0; } if (bd && bd.gensetTotal) { addD("Lighting", "rental", bd.gensetTotal); if (deptInv["Lighting"]) deptInv["Lighting"].push({ name: "Genset / power", photo: "", qty: 1, unit: 0, total: Math.round(bd.gensetTotal), sub: "genset" }); } } catch {}
            try {
              const tInv = dealCheckData?.trussInv;
              if (tInv) {
                const zc = fn.zoneConfig || {};
                const en = fn.enabledEls || {};
                const fnPalette = fn.fnPalette || "Custom";
                const pObj = (imsPaletteCatalogue||[]).find(p => p.name === fnPalette);
                const anchors = pObj?.anchorColours || [];
                Object.keys(zc).forEach(zk => {
                  if (!en[zk] || !zc[zk]) return;
                  const photoUrl = (fn.elSelectedPhoto || {})[zk];
                  let density = "moderate";
                  if (photoUrl) { const li = libItems.find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                  // A zone can carry more than one truss structure (row 0 = the zone's own scalar
                  // fields, plus any zc[zk].extraTrussRows added via "+ Add Truss") — sum cost per row.
                  [zc[zk], ...(zc[zk].extraTrussRows || [])].forEach(row => {
                    const pv = calcZoneTrussPreview(row, tInv);
                    if (pv?.costs?.actual) { truss += pv.costs.actual; addD("Tenting", "truss", pv.costs.actual); } // truss steel → Tenting
                    // Truss requirement → loadable line items grouped BY SIZE (e.g. "Truss pillar 15ft").
                    // Pushed per-zone here; the size-keyed names merge across all zones below.
                    if (pv?.topology && deptInv["Tenting"]) {
                      const pmap = {}, bmap = {};
                      (pv.topology.pillars || []).forEach(p => { const ft = Math.round(Number(p.H) || 0); if (ft > 0) pmap[ft] = (pmap[ft] || 0) + 1; });
                      (pv.topology.beams || []).forEach(b => { const ft = Math.round(Number(b.lengthFt) || 0); if (ft > 0) bmap[ft] = (bmap[ft] || 0) + 1; });
                      Object.entries(pmap).forEach(([ft, n]) => deptInv["Tenting"].push({ name: `Truss pillar ${ft}ft`, photo: "", qty: n, unit: 0, total: 0, sub: "truss structure" }));
                      Object.entries(bmap).forEach(([ft, n]) => deptInv["Tenting"].push({ name: `Truss beam ${ft}ft`, photo: "", qty: n, unit: 0, total: 0, sub: "truss structure" }));
                    }
                    const fabCost = calcZoneFabricCost(row, tInv, anchors, density);
                    truss += fabCost; addD("Fabric", "fabric", fabCost); // truss/masking fabric → Fabric
                  });
                });
              }
            } catch {}
          });
          // Platform + carpet → rental
          try {
            const pp = buildPlatformPlan(fns, dealCheckData);
            if (pp) {
              const fattaR = pp.fattaItem ? imsField.rentalCost(pp.fattaItem) : 0;
              const standR = pp.standItem ? imsField.rentalCost(pp.standItem) : 0;
              Object.values(pp.perZone || {}).forEach(z => { const pc = (z.fattas || 0) * fattaR + (z.stands || 0) * standR; rental += pc; addD("Tenting", "rental", pc); if (pc > 0 && deptInv["Tenting"]) deptInv["Tenting"].push({ name: "Platform (fatta + stand)", photo: "", qty: (z.fattas || 0) + (z.stands || 0), unit: 0, total: Math.round(pc), sub: `${z.fattas || 0} fatta · ${z.stands || 0} stand` }); }); // platform → Tenting
            }
          } catch {}
          try {
            const carpetMarkup = dealCheckData?.carpetFreshMarkup ?? 40;
            fns.forEach((fn, fi) => {
              const zc = fn.zoneConfig || {};
              const en = fn.enabledEls || {};
              const picks = dcCarpetPick[fi] || {};
              Object.keys(zc).forEach(zk => {
                if (!en[zk] || !zc[zk] || zc[zk].cpT === CARPET_OFF) return;
                // ═══ CARPET COST — priced from the BUILD's carpet material, not the IMS pick ═══
                // The zone already carries a carpet material (zc.cpT, e.g. "Carpet Old · ₹5/sqft")
                // and Build charges area × that rate. Deal Check used to ignore it and cost from
                // whichever IMS carpet was picked, at that item's own rental — ₹400/sqft against
                // Build's ₹5. On a 384 sqft floor that is ₹1,920 quoted against ₹16,800+ costed, so
                // margin collapsed on any zone with carpet.
                // Worse, with NO pick it returned early and carpet cost nothing at all.
                // The IMS pick still matters — it says WHICH carpet ops should pull, and drives the
                // stock/availability checks — but the money now comes from the same place the quote
                // does, so the two agree.
                const zcz = zc[zk];
                const fd = zcz.floorDims || zcz.dims || {};
                const area = (Number(fd.L) || Number(fd.S) || 0) * (Number(fd.W) || Number(fd.S) || 0);
                const cRate = carpetPricingFor(zcz.cpT, imsCarpetMaterials).rate || 0;
                const cc = area > 0 ? area * cRate : 0;
                const pickedId = picks[zk];
                const carpetItem = pickedId ? dcInventoryCache.find(x => x.id === pickedId) : null;
                if (cc > 0) {
                  rental += cc;
                  addD("Tenting", "rental", cc);
                  if (deptInv["Tenting"]) deptInv["Tenting"].push({
                    name: carpetItem?.name || carpetPricingFor(zcz.cpT, imsCarpetMaterials).label || "Carpet",
                    photo: carpetItem ? imsField.photos(carpetItem)[0] || "" : "",
                    qty: 1, unit: 0, total: Math.round(cc),
                    sub: carpetItem ? imsField.subcategory(carpetItem) || "carpet" : "carpet",
                    imsId: carpetItem?.id,
                  });
                }
              });
            });
          } catch {}
          // Print jobs (zc[zk].prints — Flex/Vinyl/Sunboard etc, StudioBuild.jsx's Print tile). Own
          // try block, no tInv gating (unlike the truss block above) since print pricing doesn't
          // depend on truss inventory. Build's Live Estimate, Summary, and every export all read
          // calcStructCost's own .print (via structRates.printMaterials) — but dcCostRollup computes
          // its own cost engine from scratch rather than calling calcStructCost, so it never priced
          // print at all: clientRevenue (quote, via calcFunctionCost → calcStructCost) charged for
          // it, while `base`/`grand` (cost, margin) silently treated it as free. Folded into the same
          // `truss` bucket the masking/fabric cost above already shares, for the same reason.
          try {
            const printMats = imsPrintMaterials || [];
            fns.forEach((fn) => {
              const zc = fn.zoneConfig || {};
              const en = fn.enabledEls || {};
              Object.keys(zc).forEach(zk => {
                if (!en[zk] || !zc[zk]) return;
                const pc = (zc[zk].prints || []).reduce((sum, p) => {
                  const m = printMats.find(x => x.id === p.material);
                  const s = (Number(p.areaW) || 0) * (Number(p.areaD) || 0);
                  const q = Math.max(1, Math.round(Number(p.qty) || 1));
                  return sum + s * (m?.ratePerSqft || 0) * q;
                }, 0);
                if (pc > 0) {
                  truss += pc;
                  addD("Structure", "truss", pc);
                  if (deptInv["Structure"]) deptInv["Structure"].push({ name: "🖨 Print / signage", photo: "", qty: (zc[zk].prints || []).length, unit: 0, total: Math.round(pc), sub: "print" });
                }
              });
            });
          } catch {}
          // Merge duplicate inventory lines (same item across zones) into ONE line with summed qty +
          // total — Dept Ops shows combined totals, not zone-wise rows.
          DEPTS.forEach(dn => {
            const seen = {}, merged = [];
            (deptInv[dn] || []).forEach(it => {
              const key = (it.name || "") + "|" + (it.sub || "") + "|" + (it.imsId || "");
              if (seen[key]) {
                seen[key].qty += (it.qty || 0); seen[key].total += (it.total || 0);
                if (Array.isArray(it.components)) { // merge kit sub-elements too (same kit across zones)
                  const base = seen[key].components || (seen[key].components = []);
                  it.components.forEach(cp => {
                    const ck2 = (cp.name || "") + "|" + (cp.imsId || "");
                    const ex = base.find(b => ((b.name || "") + "|" + (b.imsId || "")) === ck2);
                    if (ex) { ex.qty += (cp.qty || 0); ex.total += (cp.total || 0); } else base.push({ ...cp });
                  });
                }
              }
              else { seen[key] = { ...it, components: Array.isArray(it.components) ? it.components.map(c => ({ ...c })) : undefined }; merged.push(seen[key]); }
            });
            deptInv[dn] = merged;
          });
          // Manpower — full booking-level day-wise computation (mirrors Manpower tab)
          try {
            const dihariSchemes = dealCheckData?.dihariSchemes || {};
            const defaultWindowsByPhase = dealCheckData?.defaultWindowsByPhase || {};
            const labourTiers = dealCheckData?.labourTiers || {};
            const venueMinLabour = dealCheckData?.venueMinLabour || {};
            const defaultMinLabour = dealCheckData?.defaultMinLabour || 4;
            const eventTypeMultipliers = dealCheckData?.eventTypeMultipliers || { outdoor_budgeted:1.0 };
            const eventTimingMultipliers = dealCheckData?.eventTimingMultipliers || {};
            const sayaMultiplier = dealCheckData?.sayaMultiplier || 1.3;
            const heavyElementRanges = dealCheckData?.heavyElementRanges || [];
            const fabricBangaliRanges = dealCheckData?.fabricBangaliRanges || [];
            const trussLabourRanges = dealCheckData?.trussLabourRanges || [];
            const flowerPatternsMP = dealCheckData?.flowerPatterns || [];
            const electricianProdMP = dealCheckData?.electricianProductivity || {};
            const seasonMapMP = dealCheckData?.seasonMap || {};
            const labourTypes = Object.keys(dihariSchemes);
            if (labourTypes.length && fns.length) {
              // Rate per type MUST match the Manpower tab exactly (else the bottom bar diverges from the tab):
              // fixed Manpower-Contractor vendors matched by labourType (storedRate), else the house rate.
              const vendorsMP = (dealCheckData?.vendors || []).filter(v => v && v.active && v.type === "Manpower Contractor" && v.isFixed && v.labourType && Number(v?.storedRate?.amount) > 0);
              const rateByType = {};
              labourTypes.forEach(t => { const matches = vendorsMP.filter(v => v.labourType === t); rateByType[t] = matches.length > 0 ? Math.round(matches.reduce((s, v) => s + Number(v.storedRate.amount || 0), 0) / matches.length) : Number(dihariSchemes[t]?.rate || 0); });
              mpRateByType = rateByType;
              // MUST match DCManpowerTab.jsx's shiftToTiming/sizeFromMode exactly (else the bottom
              // bar and the tab derive different sizeKeys off the same element and disagree on
              // recipe unitsPerFlowerist/unitsPerElectrician). The previous copies here diverged:
              // shiftToTiming returned morning/evening/day instead of brunch/lunch/sundowner/dinner,
              // and sizeFromMode returned the raw lowercase size string instead of small/big/medium
              // for an "smb" item — so `sizes["b"]` missed and silently fell back to `sizes.medium`.
              const shiftToTiming = (shift) => {
                const s = String(shift||"").toLowerCase();
                if (s.includes("morning") || s.includes("brunch")) return "brunch";
                if (s.includes("lunch")) return "lunch";
                if (s.includes("sundowner")) return "sundowner";
                if (s.includes("night")) return "dinner";
                return "dinner";
              };
              const sizeFromMode = (inhouseMode, elSize) => {
                if (inhouseMode === "smb") {
                  const s = (elSize || "M").toUpperCase();
                  if (s === "S") return "small";
                  if (s === "B") return "big";
                  return "medium";
                }
                return "medium";
              };
              // Same resolution as DCManpowerTab.jsx's walkFnElements (MUST match — this bottom-bar
              // Manpower figure and the tab's own numbers are supposed to agree, and didn't: an
              // exact-only rate-card name match dropped anything IMS-inventory-sourced (el.invId —
              // the normal path for anything added via "+ Add element" today) or recipe-only
              // (el.patternId), silently undercounting crew for most of a real build. This copy was
              // ALSO missing the tab's loose florals-name fallback (dropping elements the tab counts)
              // and used a looser qty gate (`el.qty || el.count || 1`, defaulting missing/zero qty to
              // 1) instead of the tab's `el.qty || 0` + skip — both directions of drift.
              const walkFn = (fn, cb) => {
                const en = fn.enabledEls || {};
                const ze = fn.zoneElements || {};
                Object.keys(en).forEach(zk => { if (!en[zk]) return; (ze[zk]||[]).forEach(el => {
                  // An element's identity for manpower purposes comes ONLY from live IMS — el.invId
                  // (Inventory) or el.patternId (a pure flower-recipe element). No Rate-Card name-
                  // match fallback: Rate Card's own `.sub` is a separate, older vocabulary that
                  // doesn't track IMS's live Sub-Categories master.
                  let rc = null;
                  if (el.invId) {
                    const invItem = (dcInventoryCache || []).find(i => i.id === el.invId);
                    if (invItem) rc = { name: invItem.name, cat: invItem.cat || invItem.category || "", sub: invItem.subCat || invItem.subcategory || "" };
                  }
                  if (!rc && el.patternId) rc = { name: el.name || "", cat: "florals", sub: "" };
                  if (!rc) return;
                  const qty = el.qty || 0;
                  if (qty <= 0) return;
                  cb({ rc, el, qty, zk });
                }); });
              };
              // "Repeat" model (ANY venue): a repeat zone reuses an existing setup → no build labour, so we
              // drop repeat zones from the computation. Then, ONLY at configured fixed venues, FLOOR each crew
              // type at the venue's fixed crew (max(fixedCrew[type], computed-over-fresh-zones)). Non-fixed
              // venues have no configured floor → just the computed crew over the fresh (non-repeat) zones.
              const fvCfgMP = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
              const freshFnMP = (fn) => {
                const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
                const repeatZk = Object.keys(zc).filter(zk => en[zk] && zc[zk]?.repeat);
                if (!repeatZk.length) return fn;
                const nen = { ...en }; repeatZk.forEach(zk => { nen[zk] = false; });
                return { ...fn, enabledEls: nen };
              };
              const fixedCrewFloor = (fv, type) => { const c = fv.fixedCrew || {}; if (c[type] != null && c[type] !== "") return Number(c[type]) || 0; if (type === "Labours") return Number(fv.minLabour) || 0; return 0; };
              const calcPpl = (fn, type) => {
                if (type === "Flowerists") {
                  // Flowerists are fungible across ALL arrangements → sum every element's fractional need
                  // (qty ÷ units-per-flowerist) and ceil ONCE. MUST match DCManpowerTab.calcPeopleFlowerists
                  // (and its "how" trace). Ceiling per-recipe (or per-element) over-counted vs the tab — each
                  // distinct recipe with a <1 need rounded up to a whole flowerist → bottom bar ≠ tab.
                  let total = 0;
                  walkFn(fn, ({rc, el, qty}) => {
                    if (String(rc.cat||"").toLowerCase() !== "florals") return;
                    // The element's own recipe first — what Build actually priced it with. Beyond
                    // that, matchFlowerPattern (flowerHelpers.js) is the SAME sub-category-first
                    // matcher Build's own pricing already uses — a recipe is created PER SUB-CATEGORY
                    // and applies to every differently-named product filed under it, not to one
                    // product whose name happens to match. This used to be a hand-rolled
                    // exact-name-then-substring lookup against the item's OWN name, which could only
                    // ever find a pattern coincidentally named identically to the physical prop —
                    // every sub-category-linked recipe (the normal case) silently dropped out of this
                    // count. Matches DCManpowerTab.calcPeopleFlowerists.
                    let pattern = el.patternId ? flowerPatternsMP.find(p => p.id === el.patternId) : null;
                    if (!pattern) pattern = matchFlowerPattern({ subcategory: rc.sub, name: rc.name }, flowerPatternsMP);
                    if (!pattern) return;
                    const sz = pattern.sizes || {};
                    const sk = sizeFromMode(rc.inhouseMode, el.size);
                    let c = sz[sk] || sz.medium; if (!c && sk === "big" && sz.large) c = sz.large;
                    const upf = Number(c?.unitsPerFlowerist || 0); if (upf > 0) total += qty/upf;
                  });
                  return Math.ceil(total);
                }
                if (type === "Electricians") {
                  // Sum fractional need across ALL lighting elements, ceil ONCE (fungible) — matches
                  // DCManpowerTab.calcPeopleElectricians; per-element ceiling over-counted vs the tab.
                  let total = 0; walkFn(fn, ({rc, el, qty}) => {
                    if (String(rc.cat||"").toLowerCase() !== "lighting") return;
                    const pr = electricianProdMP[rc.sub||""]; if (!pr) return;
                    const sk = sizeFromMode(rc.inhouseMode, el.size);
                    const upe = Number(pr.sizes?.[sk]) || Number(pr.sizes?.medium) || 0;
                    if (upe > 0) total += qty / upe;
                  }); return Math.ceil(total);
                }
                // MUST match DCManpowerTab.calcPeopleTier3Labours exactly (else bar ≠ tab). Tab calls
                // this for "Labours" unconditionally AND for any other type an admin has configured
                // as tier:3 in IMS Settings (labourTiers[type].tier === 3) — see the fallback below,
                // which this copy was missing entirely (a non-Labours tier-3 type counted in the tab
                // and read 0 here).
                const calcTier3 = (fn) => {
                  const venueName = fn.fnVenue || "";
                  const fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                  // No internal venue floor — the fixed-venue floor is applied uniformly for ALL types in
                  // peopleByFn (max(fixedCrew, computed)). Here we only compute the usage/heavy build need.
                  const vm = 0;
                  const dl = (dealCheckData?.venueDumping || {})[venueName] || "nearby";
                  const dm = ({nearby:1.0, medium:1.1, far:1.2})[dl] || 1.0;
                  const em = eventTypeMultipliers["outdoor_budgeted"] || 1;
                  const base = Math.ceil(vm * em);
                  let sm = 1.0;
                  if (!dcMpIncludeMinusOne) { const c = [dm]; const ss = seasonMapMP[fn.fnDate||""]; if (ss === "kings") c.push(sayaMultiplier); c.push(eventTimingMultFor(eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0)); sm = Math.max(...c, 1.0); }
                  const adj = Math.ceil(base * sm);
                  const sc = {}; walkFn(fn, ({rc, qty}) => { const _s = itemImsSubcat(rc); sc[_s] = (sc[_s]||0) + qty; });
                  // Net fixed-venue standing stock before heavy-element labour (fixed venues have installed pieces).
                  const reduction = standingReductionBySubcat(fvCfg, venueName, (dcCards || {})[fns.indexOf(fn)], dealCheckData?.inventory || []);
                  let he = 0; heavyElementRanges.forEach(her => { const count = Math.max(0, (lookupBySubcat(sc, her.subCat)||0) - (lookupBySubcat(reduction, her.subCat)||0)); he += heavyExtraLabour(her, count); });
                  // Usage-based labour (Σ qty÷per-unit) with the venue-min (adj+he) as a floor.
                  return labourUsageMode ? Math.max(adj + he, Math.ceil(labourUsageTotal)) : (adj + he);
                };
                if (type === "Labours") return calcTier3(fn);
                if (type === "Fabric Bangali") {
                  // MUST match DCManpowerTab.calcPeopleFabricBangali — per-zone RFT from truss dims (not element L×W).
                  let total = 0; const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
                  const engBackDepth = Number(dealCheckData?.trussInv?.settings?.defaultBackDepthFt) || 4;
                  const fabricRftPerWorker = Number(dealCheckData?.fabricRftPerWorker) || 100;
                  Object.keys(zc).forEach(zk => {
                    if (!en[zk] || !zc[zk]) return; const z = zc[zk]; if (!z.mkOn) return;
                    const cfg = resolveTrussConfig(z); if (!cfg || !cfg.config) return; const config = cfg.config;
                    const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0; const dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
                    const mw = z.mkWalls || {}; const sideDepth = Number(z.trussBackDepth) || engBackDepth;
                    let zoneTop = 0, zoneRft = 0;
                    if (config === "full_box") { const topSqft = dL * dW; if (topSqft > 0 && fabricBangaliRanges.length > 0) { for (const r of fabricBangaliRanges) { if (topSqft <= r.upTo) { zoneTop = r.labour || 0; break; } } } if (mw.back && dW > 0) zoneRft += dW; if (mw.left && dL > 0) zoneRft += dL; if (mw.right && dL > 0) zoneRft += dL; }
                    else if (config === "half_box") { const spanL = cfg.spanFt || dL || dW; if (mw.back && spanL > 0) zoneRft += spanL; if (mw.left && sideDepth > 0) zoneRft += sideDepth; if (mw.right && sideDepth > 0) zoneRft += sideDepth; }
                    else if (config === "u_only") { const spanL = cfg.spanFt || dL || dW; if (mw.back && spanL > 0) zoneRft += spanL; }
                    total += zoneTop + (zoneRft > 0 ? Math.ceil(zoneRft / fabricRftPerWorker) : 0);
                  });
                  return total;
                }
                if (type === "Truss Labour") {
                  // MUST match DCManpowerTab.calcPeopleTrussLabour — zone-topology pillarCount minus the venue's standing pillars.
                  let pillars = 0; const tInv = dealCheckData?.trussInv;
                  if (tInv) { const zc = fn.zoneConfig||{}, en = fn.enabledEls||{}; Object.keys(zc).forEach(zk => { if (!en[zk]||!zc[zk]) return; try { const pv = calcZoneTrussPreview(zc[zk], tInv); if (pv?.topology?.pillarCount) pillars += pv.topology.pillarCount; } catch {} }); }
                  pillars = Math.max(0, pillars - standingPillarCount({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || ""));
                  if (pillars <= 0 || trussLabourRanges.length === 0) return 0;
                  for (const r of trussLabourRanges) { if (pillars <= r.upTo) return r.labour || 0; }
                  return trussLabourRanges[trussLabourRanges.length-1]?.labour || 0;
                }
                const cfg = labourTiers[type];
                if (cfg && cfg.tier === 2) {
                  const batches = cfg.subCatBatches || {}; const sc = {};
                  walkFn(fn, ({rc, qty}) => { const _s = itemImsSubcat(rc); if (lookupBySubcat(batches, _s) != null) sc[_s] = (sc[_s]||0) + qty; });
                  let need = 0; Object.entries(sc).forEach(([k,v]) => { need += v / (lookupBySubcat(batches, k) || 3); }); // ⌈Σ(count÷batch)⌉ — matches the Deal Check derivation
                  return Math.max(cfg.minimum || 1, Math.ceil(need));
                }
                if (cfg && cfg.tier === 3) return calcTier3(fn);
                if (type === "Supervisors") return 1;
                return 0;
              };
              // Per-function calculation trace (the "how" for each day) — mirrors manpowerPlanForBooking's
              // trace shapes so Dept Ops' renderMpTrace can show each day's own bifurcation table.
              const traceOf = (fn, type) => {
                if (type === "Flowerists") {
                  const agg = {}; walkFn(fn, ({ rc, el, qty }) => {
                    if (String(rc.cat || "").toLowerCase() !== "florals") return;
                    // Same patternId-first / matchFlowerPattern resolution as calcPpl above — this
                    // "how" trace must explain the same number, not a differently-resolved one.
                    let pattern = el.patternId ? flowerPatternsMP.find(p => p.id === el.patternId) : null;
                    if (!pattern) pattern = matchFlowerPattern({ subcategory: rc.sub, name: rc.name }, flowerPatternsMP);
                    if (!pattern) return; const sz = pattern.sizes || {}; const sk = sizeFromMode(rc.inhouseMode, el.size);
                    let c = sz[sk] || sz.medium; if (!c && sk === "big" && sz.large) c = sz.large;
                    const upf = Number(c?.unitsPerFlowerist || 0); if (upf > 0) { const k = (rc.name || "flower") + "|" + upf; if (!agg[k]) agg[k] = { sub: rc.name || "flower", batch: upf, count: 0 }; agg[k].count += qty; }
                  });
                  const rows = Object.values(agg).map(r => ({ ...r, need: r.count / r.batch })); const t = Math.ceil(rows.reduce((s, r) => s + r.need, 0)); // ceil ONCE over the total (matches calcPpl + the tab)
                  return rows.length ? { kind: "tier2", perRow: true, rows, need: rows.reduce((s, r) => s + r.need, 0), min: 0, result: t, countLabel: "arrangements", batchLabel: "÷per flowerist" } : null;
                }
                if (type === "Electricians") {
                  let frac = 0, n = 0; walkFn(fn, ({ rc, el, qty }) => { if (String(rc.cat || "").toLowerCase() !== "lighting") return; const pr = electricianProdMP[rc.sub || ""]; if (!pr) return; const sk = sizeFromMode(rc.inhouseMode, el.size); const upe = Number(pr.sizes?.[sk]) || Number(pr.sizes?.medium) || 0; if (upe > 0) { frac += qty / upe; n += qty; } }); const t = Math.ceil(frac); // ceil ONCE (matches calcPpl + the tab)
                  return t > 0 ? { kind: "ratio", num: n, numLabel: "lighting units", denomLabel: "productivity per electrician", result: t } : null;
                }
                if (type === "Labours") {
                  const venueName = fn.fnVenue || "";
                  const fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                  const fv = fixedVenueFor(fvCfg, venueName);
                  const vm = fv ? (fv.minLabour ?? defaultMinLabour) : 0; // min only for fixed venues
                  const em = eventTypeMultipliers["outdoor_budgeted"] || 1; const base = Math.ceil(vm * em);
                  let sm = 1.0;
                  if (!dcMpIncludeMinusOne) { const c = [({ nearby: 1.0, medium: 1.1, far: 1.2 })[(dealCheckData?.venueDumping || {})[venueName] || "nearby"] || 1.0]; const ss = seasonMapMP[fn.fnDate || ""]; if (ss === "kings") c.push(sayaMultiplier); c.push(eventTimingMultFor(eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0)); sm = Math.max(...c, 1.0); }
                  const adj = Math.ceil(base * sm); const sc = {}; walkFn(fn, ({ rc, qty }) => { const _s = itemImsSubcat(rc); sc[_s] = (sc[_s] || 0) + qty; });
                  const reduction = standingReductionBySubcat(fvCfg, venueName, (dcCards || {})[fns.indexOf(fn)], dealCheckData?.inventory || []);
                  let he = 0; heavyElementRanges.forEach(her => { const count = Math.max(0, (lookupBySubcat(sc, her.subCat) || 0) - (lookupBySubcat(reduction, her.subCat) || 0)); he += heavyExtraLabour(her, count); });
                  return { kind: "labours", venueMin: vm, mult: sm, heavy: he, result: adj + he };
                }
                if (type === "Fabric Bangali") {
                  let sq = 0; walkFn(fn, ({ rc, el }) => { const s = String(rc.sub || "").toLowerCase(); if (s.includes("wall masking") || s.includes("fabric") || s.includes("draping")) { const L = Number(el.L || el.l || rc.defaultDims?.L || 0); const W = Number(el.W || el.w || el.H || el.h || rc.defaultDims?.W || 0); if (L > 0 && W > 0) sq += L * W; } });
                  if (sq <= 0 || !fabricBangaliRanges.length) return null;
                  let lab = fabricBangaliRanges[fabricBangaliRanges.length - 1]?.labour || 0; for (const r of fabricBangaliRanges) { if (sq <= r.upTo) { lab = r.labour || 0; break; } }
                  return { kind: "range", value: Math.round(sq), unit: "sqft", result: lab };
                }
                if (type === "Truss Labour") {
                  let recipeP = 0; walkFn(fn, ({ rc, qty }) => { const s = String(rc.sub || "").toLowerCase(); if (s.includes("pillar") || s.includes("column") || s.includes("truss")) recipeP += qty; });
                  let zoneP = 0; try { const tInv = dealCheckData?.trussInv; if (tInv) { const zc = fn.zoneConfig || {}, en = fn.enabledEls || {}; Object.keys(zc).forEach(zk => { if (!en[zk] || !zc[zk]) return; const pv = calcZoneTrussPreview(zc[zk], tInv); zoneP += (pv?.topology?.pillars || []).length; }); } } catch {}
                  const p = recipeP + zoneP; if (p <= 0 || !trussLabourRanges.length) return null;
                  let lab = trussLabourRanges[trussLabourRanges.length - 1]?.labour || 0; for (const r of trussLabourRanges) { if (p <= r.upTo) { lab = r.labour || 0; break; } }
                  return { kind: "pillars", recipeP, zoneP, total: p, result: lab };
                }
                const cfg = labourTiers[type];
                if (cfg && cfg.tier === 2) {
                  const batches = cfg.subCatBatches || {}; const sc = {};
                  walkFn(fn, ({ rc, qty }) => { const _s = itemImsSubcat(rc); if (lookupBySubcat(batches, _s) != null) sc[_s] = (sc[_s] || 0) + qty; });
                  const rows = Object.entries(sc).map(([k, v]) => ({ sub: k, count: v, batch: lookupBySubcat(batches, k) || 3, need: v / (lookupBySubcat(batches, k) || 3) }));
                  const need = rows.reduce((s, r) => s + r.need, 0); const count = Math.max(cfg.minimum || 1, Math.ceil(need));
                  return { kind: "tier2", rows, need, min: cfg.minimum || 1, result: count };
                }
                if (type === "Supervisors") return { kind: "fixed", note: "1 supervisor per booking", result: 1 };
                return null;
              };
              // Usage-based labour split, computed PER FUNCTION (drives the per-day split): for each fn,
              // 1 labour per N units of each sub-category, charged to that sub's department (catToDept).
              // Department usage-split uses the SAME "Heavy Element Add-ons" ratios (subCat → 1 labour
              // per perCount) that drive the Labours headcount — one source of truth; no separate
              // subCatBatches config needed. Each sub-category's labour is routed to its dept via catToDept.
              const _labBatches = {}; (heavyElementRanges || []).forEach(her => { if (her && her.subCat && Number(her.perCount) > 0) _labBatches[her.subCat] = Number(her.perCount); });
              labourUsageMode = Object.keys(_labBatches).length > 0;
              const labourUsageByFn = {};
              fns.forEach((fn, fi) => {
                const byDept = {}; let total = 0;
                if (labourUsageMode) walkFn(freshFnMP(fn), ({ rc, qty }) => { const b = lookupBySubcat(_labBatches, itemImsSubcat(rc)); if (!b) return; const need = (Number(qty) || 0) / b; if (need <= 0) return; const dp = catToDept(rc.cat); byDept[dp] = (byDept[dp] || 0) + need; total += need; });
                labourUsageByFn[fi] = { byDept, total };
                Object.entries(byDept).forEach(([dp, n]) => { labourUsageByDept[dp] = (labourUsageByDept[dp] || 0) + n; });
                labourUsageTotal += total;
              });
              const fnDates = fns.map(f => f.fnDate).filter(Boolean).sort();
              if (fnDates.length) {
                const addDays = (iso, n) => { const d = new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
                const earliest = fnDates[0]; const latest = fnDates[fnDates.length-1];
                const dayList = [];
                if (dcMpIncludeMinusOne) dayList.push({date:addDays(earliest,-1),phase:"minusOne",fns:[]});
                let cur = earliest;
                while (cur <= latest) { const fd = fns.filter(f => f.fnDate === cur); dayList.push({date:cur,phase:fd.length?"event":"gap",fns:fd}); cur = addDays(cur,1); }
                if (dcMpIncludeDismantle) dayList.push({date:addDays(latest,1),phase:"dismantle",fns:[]});
                dcMpPhases = { minusOne: dayList.some(d=>d.phase==="minusOne"), eventDays: dayList.filter(d=>d.phase==="event").length, gapDays: dayList.filter(d=>d.phase==="gap").length, dismantle: dayList.some(d=>d.phase==="dismantle") };
                const peopleByFn = {}; labourTypes.forEach(t => { peopleByFn[t] = {}; fns.forEach((fn, fi) => { const fv = fixedVenueFor(fvCfgMP, fn.fnVenue || ""); const computed = calcPpl(freshFnMP(fn), t) || 0; peopleByFn[t][fi] = fv ? Math.max(fixedCrewFloor(fv, t), computed) : computed; }); });
                // Default labour split fraction (used for leading / no-element days) = aggregate usage share.
                const _aggFrac = {}; if (labourUsageMode && labourUsageTotal > 0) DEPTS.forEach(dp => { _aggFrac[dp] = (labourUsageByDept[dp] || 0) / labourUsageTotal; });
                let _lastFrac = Object.keys(_aggFrac).length ? _aggFrac : null;
                let running = {}; labourTypes.forEach(t => { running[t] = 0; });
                dayList.forEach(d => {
                  if (d.phase === "minusOne") { labourTypes.forEach(t => { let mx = 0; fns.forEach((fn, fi) => { if ((peopleByFn[t][fi]||0) > mx) mx = peopleByFn[t][fi]; }); running[t] = Math.max(running[t], mx); }); }
                  else if (d.phase === "event") { labourTypes.forEach(t => { let need = 0; d.fns.forEach(fn => { const fi = fns.indexOf(fn); if ((peopleByFn[t][fi]||0) > need) need = peopleByFn[t][fi]; }); running[t] = Math.max(running[t], need); }); }
                  // Dismantle day: reduce each type by its dismantlingPct (MUST mirror the Manpower tab, else
                  // the bottom-bar rollup carries full crew here and over-counts vs the tab). No pct → carry full.
                  else if (d.phase === "dismantle") { labourTypes.forEach(t => { const pct = (labourTiers[t] || {}).dismantlingPct; if (typeof pct === "number") running[t] = pct > 0 ? Math.ceil(running[t] * pct / 100) : 0; }); }
                  // This day's labour usage fractions: event day = sum of its functions; else carry forward.
                  let dayFrac = _lastFrac;
                  if (labourUsageMode && labourUsageTotal > 0 && d.phase === "event") {
                    const byDept = {}; let total = 0;
                    d.fns.forEach(fn => { const u = labourUsageByFn[fns.indexOf(fn)]; if (!u) return; Object.entries(u.byDept).forEach(([dp, n]) => { byDept[dp] = (byDept[dp] || 0) + n; }); total += u.total; });
                    if (total > 0) { dayFrac = {}; DEPTS.forEach(dp => { dayFrac[dp] = (byDept[dp] || 0) / total; }); _lastFrac = dayFrac; }
                  }
                  if (dayFrac) labourShareByDayDept[d.date] = dayFrac;
                  labourTypes.forEach(t => {
                    const ppl = running[t] || 0; if (ppl <= 0) return;
                    const wins = dcMpOverrides[`${d.date}|${t}`] || (defaultWindowsByPhase[t]||{})[d.phase] || [];
                    // Per-shift crew: a worked window uses its own dcMpWinCount ONLY if the ops manager set one,
                    // else the day's crew count. Cost = Σ(perWindowCount) × rate (MUST match the Manpower tab).
                    // Only EXPLICIT per-shift edits go into winCountMap → schedule, so a dept-head day-count edit
                    // in Dept Ops still applies to the untouched shifts (effShift/mpDayCost fall through).
                    const _wc = dcMpWinCount?.[t]?.[d.date] || null;
                    let winCountMap = null, daySlots = 0;
                    wins.forEach(id => {
                      const explicit = _wc && _wc[id] != null && _wc[id] !== "";
                      const c = explicit ? (Number(_wc[id]) || 0) : ppl;
                      daySlots += c;
                      if (explicit) { if (!winCountMap) winCountMap = {}; winCountMap[id] = c; }
                    });
                    const mpCost = daySlots * (rateByType[t] || 0);
                    manpower += mpCost;
                    mpByType[t] = (mpByType[t] || 0) + mpCost;
                    // Per-day labour cost → departments by THIS day's usage fractions.
                    if (t === "Labours" && labourUsageMode && labourUsageTotal > 0 && dayFrac && mpCost > 0) { DEPTS.forEach(dp => { labourDeptCost[dp] += mpCost * (dayFrac[dp] || 0); }); }
                    if (wins.length > 0) {
                      if (!mpSchedule[t]) mpSchedule[t] = [];
                      // Controlling function's trace for this day's "how" (event: busiest fn; -1 setup: peak fn).
                      let trace = null, drivenBy = null;
                      if (d.phase === "event" && d.fns.length) { let bf = d.fns[0], bc = -1; d.fns.forEach(fn => { const c = peopleByFn[t][fns.indexOf(fn)] || 0; if (c > bc) { bc = c; bf = fn; } }); trace = traceOf(bf, t); drivenBy = bf?.fnType || null; }
                      else if (d.phase === "minusOne") { let bf = fns[0], bc = -1; fns.forEach((fn, fi) => { const c = peopleByFn[t][fi] || 0; if (c > bc) { bc = c; bf = fn; } }); trace = traceOf(bf, t); drivenBy = bf?.fnType || null; }
                      // winCount → snapshot so Dept Ops + On-Site inherit the same per-shift crew (they fall
                      // back to schedule.winCount until a head overrides it).
                      mpSchedule[t].push({ date: d.date, phase: d.phase, count: ppl, windows: wins.length, windowIds: wins, winCount: winCountMap, trace, drivenBy });
                    }
                  });
                });
              }
            }
          } catch {}
          const buyTotal = dcCustomItems.filter(c=>c.type==="buying").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
          const produceTotal = dcCustomItems.filter(c=>c.type==="production").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0);
          // Production / Buying → department by the item's category/sub-category
          dcCustomItems.forEach(c => { const amt = (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1); if (amt > 0) addD(catToDept(c.cat || c.subCat), c.type === "buying" ? "buying" : "production", amt); });
          // ── Distribute manpower per type to departments ──
          const MP_DEPT = { "Flowerists": "Floral", "Carpenters": "Structure", "Painters": "Tenting", "Truss Labour": "Tenting", "Fabric Bangali": "Fabric", "Electricians": "Lighting", "Drivers": "Transport" };
          // Direct-income share per dept (rental+florals+truss+fabric+production+buying) — drives the
          // proportional split of general Labours + Supervisors across all departments.
          const directOf = (d) => dept[d].rental + dept[d].florals + dept[d].truss + dept[d].fabric + dept[d].production + dept[d].buying;
          const directTotal = DEPTS.reduce((s, d) => s + directOf(d), 0);
          DEPTS.forEach(d => { deptDirectMap[d] = directOf(d); });
          Object.entries(mpByType).forEach(([t, amt]) => {
            if (!(amt > 0)) return;
            const target = MP_DEPT[t];
            if (target) { addD(target, "manpower", amt); deptMp[target][t] = (deptMp[target][t] || 0) + amt; return; }
            // Labours → split PER DAY by sub-category usage (labourDeptCost, already summed over days)
            // when configured; Supervisors (and any unmapped) → split by direct-income share.
            mpSharedTotals[t] = (mpSharedTotals[t] || 0) + amt;
            if (t === "Labours" && labourUsageMode && labourUsageTotal > 0) {
              DEPTS.forEach(d => { const sh = labourDeptCost[d] || 0; if (sh > 0) { addD(d, "manpower", sh); deptMp[d][t] = (deptMp[d][t] || 0) + sh; } });
            } else if (directTotal > 0) DEPTS.forEach(d => { const sh = amt * (directOf(d) / directTotal); addD(d, "manpower", sh); deptMp[d][t] = (deptMp[d][t] || 0) + sh; });
            else { addD("Structure", "manpower", amt); deptMp["Structure"][t] = (deptMp["Structure"][t] || 0) + amt; }
          });
          DEPTS.forEach(d => { dept[d].total = dept[d].rental + dept[d].florals + dept[d].truss + dept[d].fabric + dept[d].transport + dept[d].manpower + dept[d].production + dept[d].buying; });
          // ── Per-dept manpower detail (the exact crew rows the head edits in IMS Dept Ops). Built here
          // so the actuals delta below reconciles head edits — count/rate overrides AND day-wise labour —
          // via the SAME formula IMS uses (deptMpReconciled). Reused by buildDeptSnapshot. ──
          let dcMpPlan = []; try { dcMpPlan = manpowerPlanForBooking ? manpowerPlanForBooking(fns) : []; } catch {}
          const dcPlanByType = {}; dcMpPlan.forEach(p => { dcPlanByType[p.type] = p; });
          const SHARED = new Set(["Labours", "Supervisors"]);
          const manpowerDetail = {};
          DEPTS.forEach(d => { manpowerDetail[d] = Object.entries(deptMp[d] || {}).filter(([, c]) => c > 0).map(([type, cost]) => {
            const pl = dcPlanByType[type]; const rate = (mpRateByType || {})[type] || pl?.rate || 0; const shared = SHARED.has(type);
            const usageMode = type === "Labours" && labourUsageMode && (labourUsageTotal || 0) > 0;
            const splitInfo = shared ? (usageMode
              ? { total: Math.round(mpSharedTotals[type] || 0), byUsage: true, perDay: true, deptUsage: +(labourUsageByDept[d] || 0).toFixed(2), usageTotal: +(labourUsageTotal || 0).toFixed(2) }
              : { total: Math.round(mpSharedTotals[type] || 0), deptDirect: Math.round(deptDirectMap[d] || 0), directTotal: Math.round(directTotal || 0) }) : null;
            // For usage-mode Labours, stamp each day with THIS dept's per-day share so Dept Ops can show
            // the day-by-day bifurcation (count × share) and reconcile cost = Σ(count × share × shifts × rate).
            const sched = mpSchedule[type] || null;
            const schedule = (usageMode && Array.isArray(sched)) ? sched.map(s => ({ ...s, share: (labourShareByDayDept[s.date] && labourShareByDayDept[s.date][d] != null) ? labourShareByDayDept[s.date][d] : ((labourUsageTotal > 0) ? (labourUsageByDept[d] || 0) / labourUsageTotal : 0) })) : sched;
            return { type, cost: Math.round(cost), count: shared ? null : (pl?.count || 0), rate, basis: pl?.basis || "", shared, trace: pl?.trace || null, splitInfo, schedule };
          }); });
          // ── ACTUALS overlay (entered by dept heads in IMS) → exact cost. Real mandi replaces the
          // projected florals; on-site expenses are added. Margin recomputes on the exact figure. ──
          const aDeptOps = dcEoActuals?.deptOps || {};
          const actualMandi = Number(aDeptOps?.Floral?.realMandi) || 0;
          let actualExpenses = 0;
          Object.values(aDeptOps).forEach(o => { (o?.expenses || []).forEach(e => { actualExpenses += Number(e.amount) || 0; }); });
          // Manpower override: dept heads' edited crew (count/rate + day-wise) → actual manpower delta.
          let mpDelta = 0;
          DEPTS.forEach(d => {
            const dd = aDeptOps?.[d]; if (!dd) return;
            const edited = (dd.mpOverrides && Object.keys(dd.mpOverrides).length) || (Array.isArray(dd.mpExtra) && dd.mpExtra.length) || (dd.mpDay && Object.keys(dd.mpDay).length) || (dd.mpWin && Object.keys(dd.mpWin).length) || (Array.isArray(dd.mp) && dd.mp.length);
            if (!edited) return;
            mpDelta += (deptMpReconciled(manpowerDetail[d], dd) - (dept[d]?.manpower || 0));
          });
          const effManpower = manpower + mpDelta;
          const hasActuals = actualMandi > 0 || actualExpenses > 0 || mpDelta !== 0;
          const effFlorals = actualMandi > 0 ? actualMandi : florals;
          const base = rental + florals + transport + manpower + truss + buyTotal + produceTotal;
          const baseActual = rental + effFlorals + transport + effManpower + truss + buyTotal + produceTotal + actualExpenses;
          const gyvFixed = Math.round((hasActuals ? baseActual : base) * 0.05);
          const bufferCost = Math.round((hasActuals ? baseActual : base) * 0.03);
          const grand = base + Math.round(base * 0.05) + Math.round(base * 0.03);
          const grandActual = baseActual + gyvFixed + bufferCost;
          // The negotiated amount (captured on Summary before/at sale — see StudioSummary.jsx) is
          // what the client is ACTUALLY being booked at. Cost/margin here mean nothing measured
          // against the system's list-price estimate once a deal has been discounted or upsold in
          // negotiation — every margin figure in Deal Check should reflect the real deal.
          let clientRevenue = 0;
          if (Number(cli?.negotiatedAmount) > 0) {
            clientRevenue = Number(cli.negotiatedAmount);
          } else {
            try { fns.forEach(fn => { clientRevenue += calcFunctionCost(fn).grand; }); } catch {}
          }
          const effGrand = hasActuals ? grandActual : grand;
          const profitPct = clientRevenue > 0 ? Math.round(((clientRevenue - effGrand) / clientRevenue) * 100) : 0;
          // ═══ Commission — % of the deal amount set aside per venue (IMS → Admin → Master Data →
          // Venues, one row per in-house property or outdoor venue). A booking spanning more than one
          // venue splits clientRevenue across them by each venue's own share of the system cost
          // (fns.length===1 just gets 100% of it, no proration needed). Salespeople can override the
          // computed amount per venue (cli.commissionOverrides), same pattern as negotiatedAmount.
          const venueCommissionRates = dealCheckData?.venueCommission || {};
          const venueParentsForComm = dealCheckData?.venueParents || {};
          const resolveCommVenue = (vn) => venueParentsForComm[vn] || vn;
          let totalFnGrandForComm = 0;
          const fnGrandByVenue = {};
          fns.forEach(fn => {
            const vKey = resolveCommVenue(fn.fnVenue || "");
            if (!vKey) return;
            let g = 0; try { g = calcFunctionCost(fn).grand; } catch {}
            fnGrandByVenue[vKey] = (fnGrandByVenue[vKey] || 0) + g;
            totalFnGrandForComm += g;
          });
          const commissionOverrides = cli?.commissionOverrides || {};
          let commissionTotal = 0;
          const venueKeys = Object.keys(fnGrandByVenue);
          const commissionByVenue = venueKeys.map(vKey => {
            const share = totalFnGrandForComm > 0 ? fnGrandByVenue[vKey] / totalFnGrandForComm : (venueKeys.length === 1 ? 1 : 0);
            const revenueShare = clientRevenue * share;
            const pct = Number(venueCommissionRates[vKey]) || 0;
            const defaultAmt = Math.round(revenueShare * pct / 100);
            const overrideVal = commissionOverrides[vKey];
            const hasOverride = typeof overrideVal === "number" && isFinite(overrideVal);
            const finalAmt = hasOverride ? overrideVal : defaultAmt;
            commissionTotal += finalAmt;
            return { venue: vKey, revenueShare, pct, defaultAmt, overrideVal: hasOverride ? overrideVal : null, finalAmt };
          });
          return { rental, florals, transport, genset, manpower, truss, buyTotal, produceTotal, base, gyvFixed, bufferCost, grand, clientRevenue, profitPct, fns, dept, DEPTS, deptInv, deptMp, mpRateByType,
            mpPhases: dcMpPhases, mpSchedule, mpSharedTotals, deptDirectMap, directTotal, labourUsageByDept, labourUsageTotal, manpowerDetail, manpowerPlan: dcMpPlan,
            hasActuals, actualMandi, actualExpenses, effFlorals, baseActual, grandActual, projFlorals: florals, effManpower, mpDelta,
            commissionByVenue, commissionTotal };
        })();

        // ── Build + auto-push the department snapshot to IMS whenever Deal Check is open (any tab),
        // so Dept Ops mirrors Studio without anyone navigating to the Dept Income tab. ──
        const dcSeasonMap = dealCheckData?.seasonMap || {};
        const dcMandiMult = dealCheckData?.mandiPriceMultipliers || {};
        const dcBookingDate = (dcCostRollup.fns || []).map(f => f.fnDate).filter(Boolean).sort()[0] || "";
        const dcSeasonKey = dcSeasonMap[dcBookingDate] || "non_saya";
        const dcSeasonInfo = { key: dcSeasonKey, mult: dcMandiMult[dcSeasonKey] || 1, label: (dcSeasonKey === "kings" || dcSeasonKey === "heavy_saya") ? "Saya" : dcSeasonKey === "competition" ? "Competition" : "Non-Saya" };
        const buildDeptSnapshot = () => {
          let floralPlan = { projected: 0, flowers: [] };
          try {
            // Artificial sourcing rates (bunches→kg→₹) — captured so IMS Dept Ops can show the "how".
            const afBPK = Number(dealCheckData?.artificialFlowerBunchesPerKg ?? 16) || 16;
            const agBPK = Number(dealCheckData?.artificialGreenBunchesPerKg ?? 23) || 23;
            const afRate = Number(dealCheckData?.artificialFlowerRatePerKg ?? 50);
            const agRate = Number(dealCheckData?.artificialGreenRatePerKg ?? 40);
            const agg = {}; let artTotal = 0, afBunches = 0, agBunches = 0, incReal = 0, incArt = 0;
            (dcCostRollup.fns || []).forEach(fn => {
              const r = calcFnFloralSourcingCost(fn);
              artTotal += r.totalArtificial || 0;
              afBunches += r.artFlowerBunches || 0; agBunches += r.artGreenBunches || 0;
              incReal += r.income?.real || 0; incArt += r.income?.art || 0;
              (r.breakdown || []).forEach(f => { if (!agg[f.name]) agg[f.name] = { name: f.name, qty: 0, cost: 0, unit: f.unit }; agg[f.name].qty += f.qty; agg[f.name].cost += f.cost; });
            });
            const flowers = Object.values(agg).sort((a, b) => b.cost - a.cost);
            if (artTotal >= 1) flowers.push({ name: "Artificial flowers / greens", qty: 0, cost: Math.round(artTotal), unit: "per kg", artificial: true });
            const flowerKg = afBunches / afBPK, greenKg = agBunches / agBPK;
            // Full artificial derivation (bunches ÷ bunches-per-kg = kg × ₹/kg = cost), flowers + greens.
            const artificial = (afBunches + agBunches) > 0 ? { flowerBunches: Math.round(afBunches), greenBunches: Math.round(agBunches), flowerBPK: afBPK, greenBPK: agBPK, flowerRate: afRate, greenRate: agRate, flowerKg: Math.round(flowerKg * 100) / 100, greenKg: Math.round(greenKg * 100) / 100, flowerCost: Math.round(flowerKg * afRate), greenCost: Math.round(greenKg * agRate), total: Math.round(artTotal) } : null;
            // Billed floral income split (what the client pays at real vs artificial rates).
            const income = { real: Math.round(incReal), artificial: Math.round(incArt), total: Math.round(incReal + incArt) };
            floralPlan = { projected: Math.round(flowers.reduce((s, f) => s + f.cost, 0)), flowers, artificial, income, season: dcSeasonInfo, capturedAt: Date.now() };
          } catch {}
          // Manpower plan + per-dept detail are computed once in dcCostRollup (so the actuals delta and
          // this snapshot stay identical). Reuse them here rather than recomputing.
          const manpowerPlan = dcCostRollup.manpowerPlan || [];
          const manpowerDetail = dcCostRollup.manpowerDetail || {};
          const incomeRounded = {}; Object.entries(dcCostRollup.dept || {}).forEach(([d, v]) => { incomeRounded[d] = {}; Object.entries(v || {}).forEach(([k, n]) => { incomeRounded[d][k] = typeof n === "number" ? Math.round(n) : n; }); });
          // Fabric demand per type + colour (for the Fabric head's stock-vs-requirement / reorder panel).
          let fabricPlan = { liza: [], masking: [], curtain: [] };
          try {
            const tInv = dealCheckData?.trussInv;
            if (tInv) {
              const agg = { liza: {}, masking: {}, curtain: {} };
              (dcCostRollup.fns || []).forEach(fn => {
                const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
                const pObj = (imsPaletteCatalogue || []).find(p => p.name === (fn.fnPalette || "Custom"));
                const anchors = pObj?.anchorColours || [];
                Object.keys(zc).forEach(zk => {
                  if (!en[zk] || !zc[zk]) return;
                  let density = "moderate";
                  const photoUrl = (fn.elSelectedPhoto || {})[zk];
                  if (photoUrl) { const li = (libItems || []).find(l => l.url === photoUrl); if (li?.dims?.drapeDensity) density = li.dims.drapeDensity; }
                  // A zone can carry more than one truss row — each row's own allocation (or auto-fill).
                  [zc[zk], ...(zc[zk].extraTrussRows || [])].forEach(row => {
                    const fab = calcZoneFabric(row, tInv, density);
                    const add = (key, totalQty, stockArr, qtyField, allocField) => {
                      if (!totalQty || totalQty <= 0) return;
                      const existing = row[allocField];
                      const allocs = (Array.isArray(existing) && existing.length > 0) ? existing : autoFillFabricAllocation(Math.ceil(totalQty), anchors, stockArr, qtyField);
                      if (allocs.length) allocs.forEach(a => { const c = a.colour || "(unassigned)"; agg[key][c] = (agg[key][c] || 0) + (Number(a.qty) || 0); });
                      else agg[key]["(unassigned)"] = (agg[key]["(unassigned)"] || 0) + Math.ceil(totalQty);
                    };
                    add("masking", fab.maskingPieces, tInv.maskingStock, "stockPieces", "maskingAllocation");
                    add("liza", fab.lizaKg, tInv.lizaStock, "stockKg", "lizaAllocation");
                    add("curtain", fab.curtainPieces, tInv.curtainStock, "stockPieces", "curtainAllocation");
                  });
                });
              });
              const toRows = (o) => Object.entries(o).map(([colour, qty]) => ({ colour, qty: Math.ceil(qty) })).filter(r => r.qty > 0);
              fabricPlan = { liza: toRows(agg.liza), masking: toRows(agg.masking), curtain: toRows(agg.curtain) };
            }
          } catch {}
          return { income: incomeRounded, inventory: dcCostRollup.deptInv, floralPlan, manpowerPlan, manpowerDetail, season: dcSeasonInfo, fabricPlan, mpPhases: dcCostRollup.mpPhases || null };
        };
        if (isSold && persistDeptSnapshot) {
          const _sig = JSON.stringify((dcCostRollup.DEPTS || []).map(d => Math.round(dcCostRollup.dept?.[d]?.total || 0)));
          if (deptSyncRef.current !== _sig) { deptSyncRef.current = _sig; setTimeout(() => { try { persistDeptSnapshot(buildDeptSnapshot()); } catch {} }, 200); }
        }

        return (
          // The background here is a FALLBACK. .dc-wash covers it with an opaque fill of its own, so
          // the colour that shows is the one on .dc-wash in the stylesheet. Left as the app's own
          // cream so that if the wash ever fails to render, what shows through is the page colour.
          // top starts BELOW the measured navbar, and the z-index drops under the header's own 50 (set in
          // lib/studio/styles.js) so the bar is not merely visible but REACHABLE — Manage, the step nav
          // and the avatar all still take clicks. inset:0 at 9000 gave neither.
          // 45 rather than something small: it still has to cover the Summary page underneath, whose
          // rails sit at 40. Between the page and the header is the whole available room.
          // The modals inside Deal Check keep their 9100/9200 and are meant to: a focused dialog should
          // cover the navbar, which is exactly what those still do.
          <div className="dc-root" style={{position:"fixed",left:0,right:0,bottom:0,top:navH,zIndex:45,background:"#FAF9F6",display:"flex",flexDirection:"column"}}>
            {/* data-img, not a conditional tree: the artwork and the CSS wash are the same LAYER, so
                one attribute switching which of them paints keeps a single element to reason about.
                The blobs, bands and grain stay in the markup and are hidden by CSS when the image is
                present — the artwork already carries its own waves and gold line-work, and laying the
                generated wash over it would only muddy both. */}
            <div className="dc-wash" data-img={DC_BG?"1":"0"} aria-hidden="true"
              style={DC_BG?{backgroundImage:`url(${DC_BG})`}:undefined}>
              <span className="dc-wash-a"/><span className="dc-wash-b"/><span className="dc-wash-c"/>
              <svg className="dc-bands" viewBox="0 0 1200 960" preserveAspectRatio="none" focusable="false">
                {WASH_BANDS.map((b,i)=>(
                  <path key={i} d={b.d} fill="none" stroke={b.c}
                    strokeOpacity={b.o} strokeWidth={b.w} strokeLinecap="round"/>
                ))}
              </svg>
              <i className="dc-grain"/>
            </div>
            {/* Hover layer. Everything here is inline-styled, and inline styles cannot express
                :hover — so the tab strip and the cost chips had no feedback at all and read as
                labels rather than things you can point at. */}
            <style>{`
.dc-tab{transition:background .14s ease,color .14s ease,border-color .14s ease}
/* Navy IS the selected state (see the inline style on the button), so hover must not also be navy —
   two tabs reading as chosen at once is worse than no hover at all. A cold tab warms toward navy
   instead: a pale ink wash with ink text, which says "this is where you are pointing" and still
   leaves the filled tab as the only selected one.
   Was rgba(26,26,46,0.05) — 5% black, invisible over the overlay's artwork. !important because both
   properties are set inline on the button and would otherwise win. */
.dc-tab[data-on="0"]:hover{background:#EAE7F2 !important;color:#221C42 !important;border-color:rgba(34,28,66,0.30) !important}
/* The selected tab deepens a step rather than sitting inert — without this the one tab you cannot
   press is also the only one that ignores the pointer entirely. */
.dc-tab[data-on="1"]:hover{background:#171233 !important}
.dc-chip{transition:background .14s ease,box-shadow .16s ease,transform .12s ease}
.dc-chip:hover{background:rgba(26,26,46,0.09) !important;box-shadow:0 3px 10px -6px rgba(26,26,46,0.5);transform:translateY(-1px)}
/* ── INVENTORY TAB ──
   Shadow rules carry !important: these elements set boxShadow inline, and an inline property beats a
   stylesheet rule without it. Buttons darken by filter instead, so one rule covers every base colour.
   Hover only on what you can act on — a static tile that lights up teaches nothing. */
.dci-card{transition:box-shadow .18s ease,border-color .18s ease}
.dci-card:hover{box-shadow:0 2px 6px rgba(26,26,46,.09),0 10px 26px rgba(26,26,46,.11) !important}
.dci-row{transition:background .14s ease}
.dci-row:hover{background:#FAFBFC !important}
.dci-btn{transition:filter .15s ease,transform .12s ease}
.dci-btn:hover{filter:brightness(.94)}
.dci-btn:active{transform:translateY(1px)}
.dci-thumb{transition:transform .14s ease,box-shadow .14s ease}
.dci-thumb:hover{transform:translateY(-2px);box-shadow:0 6px 14px -6px rgba(26,26,46,.45)}
/* Item cards, two to a row. GRID, not flex-wrap: with flex the last card in an odd row grows to
   fill the width, so a zone with three items showed two normal cards and one stretched to double
   — it read as a different, more important kind of card rather than the leftover of a pair.
   A grid column keeps its width whether or not anything sits beside it. minmax(0,1fr) rather than
   1fr so a long item name can't push a column past its share. */
.dci-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:stretch}
/* Stepping down rather than dropping straight to one: at three columns a card is ~33% of the width,
   so the point where the split editor's dropdown, qty box and "5 avail" stop sharing a line arrives
   sooner. Two columns from 1400px, one from 980px — the same threshold the two-column layout used. */
@media (max-width:1400px){.dci-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:980px){.dci-grid{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion: reduce){
  .dci-card,.dci-row,.dci-btn,.dci-thumb{transition:none}
  .dci-btn:active,.dci-thumb:hover{transform:none}
}
@media (prefers-reduced-motion: reduce){
  .dc-tab,.dc-chip{transition:none}
  .dc-chip:hover{transform:none}
}
/* ═══ THE APP'S GROUND ═══
   Same wash every other screen has, from the same lib. Deal Check was a flat #FAF9F6 fill, which is
   the right colour and nothing else — opening it stepped out of the app and into a plain document.
   The wash paints its OWN opaque colour, so it covers the root's fill: the ground you actually see is
   set here, not on the overlay. (That cost two commits to learn on the cost sheet.)
   translateZ + backface + contain:paint keep it on its own layer and keep its repaints from escaping.
   No mix-blend-mode on the blobs: they drift, and a blended moving element re-composites against its
   backdrop every frame — the thing that was flickering the other pages on Mac. Over a near-white
   ground multiply returns the colour anyway, so there is nothing to miss. */
/* TURNED DOWN, AND WARMED. The base was #F3F1F8 — a violet-grey — under a rose blob at 0.26 and a
   violet one at 0.18, and the three together read as a pink-and-blue wash rather than as the app's
   ground. On the other pages that same wash sits behind photographs and cream cards; here it sits
   behind a table of rupee figures, and a coloured ground competes with the only thing on screen that
   matters.
   Base moved to a warm off-white (near the app's own #FAF9F6, a shade deeper so the glass panes still
   have something to read against), and every blob roughly halved. Enough left that the surface is not
   a flat fill — the panes still catch a difference across their width — without any of it being a
   colour you notice. */
.dc-wash{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  transform:translateZ(0);backface-visibility:hidden;contain:paint;background:#F7F5F1}
.dc-wash span{position:absolute;display:block;filter:blur(80px)}
.dc-wash-a{width:760px;height:700px;top:-190px;left:-120px;
  border-radius:62% 38% 46% 54% / 54% 47% 53% 46%;
  background:radial-gradient(circle,rgba(201,169,110,0.15) 0%,rgba(201,169,110,0) 70%)}
.dc-wash-b{width:640px;height:700px;top:90px;right:-170px;
  border-radius:41% 59% 66% 34% / 38% 62% 38% 62%;
  background:radial-gradient(circle,rgba(214,158,140,0.10) 0%,rgba(214,158,140,0) 72%)}
.dc-wash-c{width:740px;height:660px;top:520px;left:18%;
  border-radius:55% 45% 33% 67% / 61% 39% 61% 39%;
  background:radial-gradient(circle,rgba(124,92,214,0.07) 0%,rgba(124,92,214,0) 74%)}
.dc-bands{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:blur(24px)}
/* ── THE ARTWORK, WHEN THERE IS ONE ──
   cover + center, and NOT background-attachment:fixed. Fixed makes the browser re-composite the image
   against the scroll position on every frame, which is the same per-frame cost that was flickering
   these pages on Mac — and it buys nothing here, because this layer does not scroll. The costing table
   scrolls inside its own pane; the ground stays put either way.
   The generated wash is hidden rather than removed, so pulling the file out restores it untouched. */
.dc-wash[data-img="1"]{background-size:cover;background-position:center;background-repeat:no-repeat}
.dc-wash[data-img="1"] span,
.dc-wash[data-img="1"] .dc-bands,
.dc-wash[data-img="1"] .dc-grain{display:none}
.dc-grain{position:absolute;inset:0;pointer-events:none;opacity:.5;mix-blend-mode:multiply;
  background-image:${GRAIN_URL};background-size:220px 220px}
/* Static, so this blend is composited once — it is the moving ones that cost. */
.dc-root > *:not(.dc-wash){position:relative;z-index:1}
/* ═══ GLASS ═══
   Painted, not sampled — no backdrop-filter, for the reason in the wash note above.
   Translucency is judged against what each pane SITS ON, not against the ground: the zone rows lie on
   the body, which is already glass, so two panes at the same strength would composite to opaque and
   the pair would read as one white slab. The rows are therefore much clearer than the shell. */
/* CHROME KEEPS ITS GLASS. dc-glass is the tab bar, the function sidebar and the bottom total strip
   — furniture that frames the page rather than content read off it. Nothing is measured against
   these, they sit over the artwork by design, and they are single panes with nothing stacked
   inside. Only the CONTENT surfaces below went opaque. */
.dc-glass{background:linear-gradient(148deg,rgba(255,255,255,0.78) 0%,rgba(250,249,255,0.58) 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.9)}
/* No !important: the inline background and border were removed from the row so this rule is the only
   thing painting it. An inline value left behind for a class to override is a contradiction sitting in
   the file waiting to be believed. */
/* ── CONTENT SURFACES ARE OPAQUE ──
   These two were 0.52 and 0.62 white over the artwork, each set clearer than the layer it sat in so
   they could be told apart. That works as an effect and fails as a surface: the ground behind is a
   photograph, so the same card is a different colour on every event type, and stacking them means
   the innermost one reads rupee figures through two washes. Same nesting, now as opaque steps —
   the depth comes from the values differing, not from what shows through. Truss and Florals went
   opaque for this reason; the chrome above deliberately did not. */
.dc-zone{background:#F7F5F2;border:1px solid #E7E2DA;transition:background .16s ease}
.dc-zone:hover{background:#FBFAF8}
/* One step lighter than the zone shell it sits in, so the nesting still reads. */
.dc-item{background:#FFFFFF}
/* ── THE PANEL CURVES BELONG TO THE STEP UNDERNEATH, NOT TO THIS SCREEN ──
   Browse and Build draw the gold edge of their side panel at z-index 51 — above the header's 50, which
   is deliberate: the curve runs the whole height of the window and the bar sits over it. This overlay
   is at 45 so the navbar stays usable, so that gold line came through it as a stray stroke down the
   left. It only started showing because the navbar is reachable now: the step nav is clickable while
   Deal Check is open, so Build or Browse can be the mounted step behind it.
   Hidden rather than re-stacked, because there is nothing to re-stack — a curve belonging to a panel
   nobody can see has no business being drawn. These rules live in THIS stylesheet, which mounts and
   unmounts with the overlay, so the edges come straight back the moment Deal Check closes. */
.sb-rail-edge,.bd-rail-edge{display:none !important}
/* ── ONE FUNCTION SWITCHER ON SCREEN, NOT TWO ──
   The navbar carries a row of function pills, and Deal Check has its own FUNCTIONS column with the
   per-function cost on each card. Both switch the same thing, so two of them is two answers to "which
   function am I on" sitting a few pixels apart — and the sidebar is the one that belongs to this
   screen, because it is the one that shows what each function costs.
   Hidden from the BAR, not from the sidebar. Same mechanism as the rail edges above: the rule lives in
   this stylesheet, which mounts and unmounts with the overlay, so the navbar row is back the moment
   Deal Check closes. Nothing in StudioApp had to learn that Deal Check exists. */
.sa-fnrow{display:none !important}
/* Close reveals its intent on hover rather than wearing it at rest: a permanently red ring in the
   corner of a screen that is fine reads as an error. Quiet until you reach for it. */
/* Chrome and Safari want the pseudo-element; scrollbarWidth on the element covers Firefox. Ten pills
   in a scrolling row with a bar under them looks like a rendering fault, and there is nothing to
   discover by dragging it that the wheel does not already do. */
.dc-x{-webkit-tap-highlight-color:transparent;transition:background .14s ease,border-color .14s ease,color .14s ease}
.dc-x:hover{background:rgba(225,29,72,0.10) !important;border-color:rgba(225,29,72,0.45) !important;color:#E11D48 !important}
/* Save Draft. The gold edge brightens and the shadow deepens — the button itself stays navy, because
   a control that changes colour on hover reads as changing what it will do. */
.dc-save{-webkit-tap-highlight-color:transparent;transition:border-color .16s ease,box-shadow .16s ease,transform .14s ease}
.dc-save:not([disabled]):hover{border-color:rgba(201,169,110,0.7) !important;transform:translateY(-1px);
  box-shadow:0 14px 30px -14px rgba(26,26,46,0.8) !important}
.dc-save:not([disabled]):active{transform:translateY(0)}
@media (prefers-reduced-motion: reduce){.dc-save:hover,.dc-save:active{transform:none}}
/* ═══ TYPOGRAPHY ═══
   FIGURES LINE UP. This is a costing screen — six zone rentals in a column, ten totals along the
   bottom — and proportional digits make a 1 narrower than a 7, so nothing stacks and the eye cannot
   compare two numbers without reading both. tabular-nums is what a price list is set in, and it is
   the difference between a screen of numbers and a screen of figures. Both properties, because
   font-feature-settings is what older Safari honours and font-variant-numeric is the modern one.
   Applied at the root so every tab inherits it — the sub-tabs are separate files and would each have
   had to remember. */
.dc-root{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"lnum" 1;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
/* THE DISPLAY SERIF, AND WHY IT MUST BE A CLASS. StudioApp sets font-family on the UNIVERSAL selector
   with !important, and a stylesheet !important beats a plain inline style — so declaring this font in a
   style prop does nothing at all, silently, which is exactly what happened the first time. It has to
   carry its own !important from a rule (see .bd-hero-face in StudioBuild for the same answer).
   Cormorant because it is the face Browse, Build and the cost sheet set their headings in. A screen
   that introduces a fourth voice is how an app stops reading as one product. */
.dc-title{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif !important;
  font-style:italic;font-weight:600;letter-spacing:-0.3px;line-height:1.04}
/* Labels: small, wide, and quiet. A caption at the same tracking as body text reads as body text set
   small; the extra letter-spacing is what makes it read as a LABEL and lets it drop to 10px without
   turning into noise. */
.dc-cap{font-size:10px;font-weight:700;letter-spacing:1.7px;text-transform:uppercase}
/* Money. Slightly negative tracking because tabular figures are set on a wide advance and a rupee
   total at 18px+ looks loose without it.
   LINING as well as tabular, and both properties spell out both features. This rule used to declare
   font-feature-settings:"tnum" 1 alone, which does not add to the root's declaration — it REPLACES it,
   so the "lnum" set there was switched back off for every figure this class touched. A serif with
   old-style figures as its default then set ₹5,32,725 with the 3, 5 and 7 hanging below the line, which
   is correct for a paragraph and wrong for a total. */
.dc-money{font-variant-numeric:tabular-nums lining-nums;letter-spacing:-0.3px;
  font-feature-settings:"tnum" 1,"lnum" 1}
`}</style>
            {/* TOP BAR */}
            {/* Back to the reference: light ground, close on the left, title ranged left. The navy bar
                with the title centred was a different idea and it is gone — the mockup this is being
                matched to has neither. */}
            {/* gap 0 between the three zones: the title's column width already sets where the tabs
                start, and a flex gap on top of it would push them past the content column's edge by
                however much the gap was. The close keeps its own breathing room from its group's gap. */}
            <div className="dc-glass" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:0,padding:"13px 20px",borderBottom:`1px solid ${border}`}}>
              {/* ── THE TITLE HOLDS A COLUMN, NOT JUST ITS OWN WIDTH ──
                  200px is the 220px sidebar below minus this header's own 20px of left padding, so the
                  title sits over the FUNCTIONS column and the tabs begin exactly where the main
                  content column begins. Hugging the text instead let the strip start at whatever x the
                  client's name happened to end at — which is a different x for every deal, and lined
                  up with nothing.
                  flexShrink:0 so the column holds when the tab row is full and wants the room. */}
              <div style={{display:"flex",alignItems:"center",gap:14,width:200,flexShrink:0,minWidth:0}}>
                {/* ── TWO LINES, TWO JOBS ──
                    Both were sans: 21px bold over 10px caps at 55% ink. That is a heading and a
                    subtitle in the same voice, so the pair read as one grey block and neither carried.
                    The title takes the display serif — it is the name of a screen, not a control — and
                    the client goes GOLD rather than faded ink. Faded ink says "less important";
                    the accent says "different kind of thing", which is what a client's name is next to
                    a screen title. Warmth against the serif's ink, and the eye lands on the name
                    without the title giving up any size.
                    The rule between them is 1px of gold at low alpha — enough to bind the two lines
                    into one lockup, not enough to be seen as a divider. */}
                <div style={{minWidth:0}}>
                  <div className="dc-title" style={{fontSize:28,color:"#1A1A2E"}}>Deal Check</div>
                  <div className="dc-cap" style={{color:accent,marginTop:4,paddingTop:4,letterSpacing:2,borderTop:`1px solid ${accent}33`,display:"inline-block",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>
                    {cli?.name || clientName || "(no client)"}{isSold?" · Booked":""}
                  </div>
                  {/* Passive heads-up for the two-people-same-client case: whoever opens this second
                      sees who last touched it and when, BEFORE they start editing — the only warning
                      this screen gives ahead of time (the conflict check above only fires once an
                      autosave/Save Draft actually collides). */}
                  {cli?.dcDraftSavedBy && cli?.dcDraftSavedAt && (
                    <div style={{fontSize:10.5,color:"#1A1A2E",opacity:0.55,marginTop:3}}>
                      Deal Check last saved by <strong>{cli.dcDraftSavedBy}</strong> · {(() => {
                        const ms = Date.now() - cli.dcDraftSavedAt;
                        const min = Math.floor(ms / 60000);
                        if (min < 1) return "just now";
                        if (min < 60) return `${min}m ago`;
                        const hr = Math.floor(min / 60);
                        if (hr < 24) return `${hr}h ago`;
                        return `${Math.floor(hr / 24)}d ago`;
                      })()}
                    </div>
                  )}
                </div>
              </div>
              {/* ── THE TABS SHARE THE TITLE'S LINE ──
                  They were a row of their own under the header, which cost a second border, a second
                  band of padding and a strip of empty ground between the two — a lot of vertical room
                  spent on nothing, on a screen whose whole job is to fit a costing table.
                  flex:1 with overflowX:auto is what makes it safe: the tabs take the room left between
                  the title and the close, and scroll inside it rather than squashing the title or
                  pushing the close off the edge. minWidth:0 is required for that — without it a flex
                  child refuses to shrink below its content and the overflow never engages.
                  scrollbarWidth:none because a scrollbar under ten pills reads as a broken element;
                  the row scrolls by wheel, trackpad and drag regardless. */}
              {/* gap 7, not 2. At 2 the pills were touching and the row read as one long bar with
                  colour changes in it rather than as ten separate things to press — which is the same
                  complaint the platform control had. The gap is what makes them countable. */}
              {/* ── THE STRIP WRAPS; IT DOES NOT SCROLL ──
                  Eleven tabs do not fit one line at most window widths. This was
                  overflowX:auto with scrollbarWidth:none — so the row DID scroll, but with
                  the scrollbar hidden nothing said so, and the last tab sat cut off
                  mid-word against the close button looking like a rendering fault rather
                  than like content continuing. Wrapping shows every tab at every width;
                  the header grows by one row only when it has to, which is a cheaper
                  price than a navigation item you cannot see. */}
              <div className="dc-tabs" style={{display:"flex",flexWrap:"wrap",gap:6,rowGap:7,flex:"1 1 auto",minWidth:0,alignContent:"flex-start"}}>
                {/* inline-flex with a gap rather than a marginRight on the emoji: the pair centres as
                    one object instead of the glyph hanging off the label's baseline. */}
                {/* OPAQUE, both states. These were `transparent` when cold and `${accent}1F` — 12%
                    gold — when selected, which was fine over a flat panel and is not over the
                    overlay's artwork: the flowers read straight through the row and the pills
                    stopped looking like controls.
                    THE SELECTED TAB IS THE NAVY ONE. A filled dark pill against white ones is the
                    strongest contrast available here, and it is the same ink the app's header and
                    card headings already wear — so "where am I" is answered from across the room
                    rather than by spotting which pill is a slightly warmer cream. */}
                {TABS.map(t => (
                  <button key={t.id} className="dc-tab" data-on={dcActiveTab===t.id?"1":"0"} onClick={()=>setDcActiveTab(t.id)} style={{padding:"7px 11px",borderRadius:999,border:dcActiveTab===t.id?"1px solid #221C42":"1px solid rgba(26,26,46,0.10)",cursor:"pointer",fontSize:13,fontWeight:dcActiveTab===t.id?700:500,background:dcActiveTab===t.id?"#221C42":"#FFFFFF",color:dcActiveTab===t.id?"#F5F1E7":textS,whiteSpace:"nowrap",letterSpacing:0.2,position:"relative",display:"inline-flex",alignItems:"center",gap:6,lineHeight:1,flexShrink:0}}>
                    <span style={{fontSize:14,lineHeight:1}}>{t.icon}</span>{t.label}
                    {!t.live && <span style={{marginLeft:6,fontSize:10,padding:"2px 5px",borderRadius:4,background:"rgba(245,158,11,0.18)",color:"#F59E0B",fontWeight:700,letterSpacing:0.4}}>{t.ship}</span>}
                  </button>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:10,flexShrink:0,paddingLeft:14}}>
                {/* The "Cached · <time>", "↻ Regenerate" and run-counter badges are gone from this
                    header. Generate below is the one control that matters, and it already states
                    what it will do ("4 zones changed…" / "no changes — uses cache") plus the run
                    count on its own line — this row was restating that in three more chips.
                    The live progress text stays: it is the only thing here that is not a repeat. */}
                {dcGenerating && <div style={{fontSize:12,color:accent,fontWeight:600}}>{dcGenStatus || "Working…"}</div>}
                {/* Close, in the corner. On the left it sat where a BACK control sits, and it is not
                    one — it discards the screen. Top-right is where a window's close lives, so it
                    needs no label to be understood.
                    A ring, not a filled box, and red only on HOVER: a permanently red control in the
                    corner of a screen that is fine reads as an error rather than as an exit. */}
                <button onClick={()=>closeDealCheck()} className="dc-x" title="Close Deal Check"
                  style={{width:36,height:36,padding:0,borderRadius:999,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:16,cursor:"pointer",lineHeight:1,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
              </div>
            </div>
            {/* BODY (3-column layout: left sidebar · main content · bottom strip is global) */}
            <div style={{flex:1,display:"flex",overflow:"hidden"}}>
              {/* LEFT SIDEBAR — function tabs + per-fn cost (skeletal in Patch 3, populated in Patch 5) */}
              <div className="dc-glass" style={{width:220,borderRight:`1px solid ${border}`,padding:"14px 12px",overflowY:"auto"}}>
                <div style={{fontSize:11,color:"#1A1A2E",letterSpacing:1.4,textTransform:"uppercase",marginBottom:10,fontWeight:700}}>Functions</div>
                {/* Manpower/Transport/Power are booking-wide rollups — everywhere else (Inventory,
                    Production, Buying) already scopes to whichever function is selected below, so
                    this pill only needs to exist on the three tabs that used to ignore the
                    selection entirely and dump every function's numbers on screen at once. */}
                {["manpower","transport","power"].includes(dcActiveTab) && (
                  <button onClick={()=>setDcShowAllFns(true)} data-on={dcShowAllFns?"1":"0"}
                    style={{width:"100%",textAlign:"left",padding:"9px 12px",borderRadius:10,marginBottom:6,cursor:dcShowAllFns?"default":"pointer",
                      border:dcShowAllFns?"1px solid transparent":`1px solid ${border}`,
                      background:dcShowAllFns?"linear-gradient(150deg,#1F1A33,#2C2350)":"#fff",
                      fontSize:13,fontWeight:700,color:dcShowAllFns?"#fff":"#1A1A2E"}}>
                    🗂️ All functions
                  </button>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {(() => {
                    const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                    if (fns.length === 0) return <div style={{padding:"10px 12px",borderRadius:8,background:"rgba(26, 26, 46,0.03)",border:`1px solid ${border}`,fontSize:13,color:"#1A1A2E",fontStyle:"italic"}}>No functions yet</div>;
                    // Platform (fatta+stand) — computed once for every function's zones, same source
                    // the bottom-bar rollup uses, so this per-fn chip can add its own share below.
                    const platformPlanForSidebar = buildPlatformPlan(fns, dealCheckData);
                    const pfFattaR = platformPlanForSidebar?.fattaItem ? imsField.rentalCost(platformPlanForSidebar.fattaItem) : 0;
                    const pfStandR = platformPlanForSidebar?.standItem ? imsField.rentalCost(platformPlanForSidebar.standItem) : 0;
                    return fns.map((fn, fi) => {
                      // Per-fn decor cost (rental + floral) — spec §7.9.3. Mirrors the logic the
                      // shared cost rollup (dcCostRollup below) applies per zone/card, so this chip
                      // matches the "X rental" totals shown per zone in the Inventory tab — it used
                      // to just sum effKitRental(card.qty), silently dropping manually-added items
                      // (dcManualItems), the fixed-venue Repeat discount, split-fulfilment cards, and
                      // unavailable-shortfall (cost%) pricing that the zone chips already account for.
                      const cards = dcCards[fi] || {};
                      const fnBlocks = (dealCheckData?.blocksByDate || {})[fn.fnDate || clientDate] || {};
                      const zoneIsRepeatFn = (ck) => { const zk = String(ck || "").split("::")[1]; return !!(zk && fn.zoneConfig?.[zk]?.repeat); };
                      const costPctForFn = (subcat) => { const key = String(subcat || "").trim().toLowerCase(); const row = (rcSubcatFactors || []).find(r => r?.id === key); const v = row ? Number(row.cost_percent) : undefined; return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 100; };
                      let fnDecor = 0;
                      Object.entries(cards).forEach(([ck, c]) => {
                        const splitArr = Array.isArray(c.split) ? c.split.filter(s => s && s.imsId && (Number(s.qty) || 0) > 0) : [];
                        if (splitArr.length) {
                          const _rep = zoneIsRepeatFn(ck);
                          splitArr.forEach(s => { const it = dcInventoryCache.find(x => x.id === s.imsId); if (!it) return; const q = Number(s.qty) || 0; const br = imsField.rentalCost(it); fnDecor += repeatAdjustedRental(_rep, fn.fnVenue, it, q, br); });
                          return;
                        }
                        if (!c?.imsId) return;
                        const item = dcInventoryCache.find(x => x.id === c.imsId);
                        if (!item) return;
                        const baseR = effKitRental(item, fi, ck);
                        const qty = c.qty || 1;
                        const _rep = zoneIsRepeatFn(ck);
                        const isKit = Array.isArray(item.subItems) && item.subItems.length > 0;
                        if (isKit) { fnDecor += repeatAdjustedRental(_rep, fn.fnVenue, item, qty, baseR); return; }
                        const available = getStudioAvailable(item, fnBlocks);
                        const ownedQty = Math.min(qty, available);
                        const shortQty = Math.max(0, qty - available);
                        const ownedRental = repeatAdjustedRental(_rep, fn.fnVenue, item, ownedQty, baseR);
                        const shortCost = shortQty * (Number(item.cost) || 0) * (oosCostPctFor(item, costPctForFn) / 100);
                        fnDecor += ownedRental + shortCost;
                      });
                      (dcManualItems || []).filter(mi => mi.fnIdx === fi).forEach(mi => {
                        const item = dcInventoryCache.find(x => x.id === mi.imsId);
                        if (!item) return;
                        const q = Number(mi.qty) || 1;
                        // Same as the rollup above — a manual item may be a kit.
                        const baseR = effKitRental(item, fi, null);
                        const _rep = mi.zoneKey ? !!(fn.zoneConfig?.[mi.zoneKey]?.repeat) : false;
                        fnDecor += repeatAdjustedRental(_rep, fn.fnVenue, item, q, baseR);
                      });
                      // Platform (fatta+stand) + carpet — same math as the bottom-bar rollup (they have
                      // no zone "card" to hang off of, so the sum above never saw them). This used to
                      // leave the sidebar chip running short of the bottom strip by exactly these two
                      // structural costs on any deal with a platform or carpet.
                      Object.entries(platformPlanForSidebar?.perZone || {}).forEach(([k, z]) => { if (Number(k.split("|")[0]) === fi) fnDecor += (z.fattas || 0) * pfFattaR + (z.stands || 0) * pfStandR; });
                      {
                        const zc = fn.zoneConfig || {};
                        const en = fn.enabledEls || {};
                        Object.keys(zc).forEach(zk => {
                          if (!en[zk] || !zc[zk] || zc[zk].cpT === CARPET_OFF) return;
                          const zcz = zc[zk];
                          const fd = zcz.floorDims || zcz.dims || {};
                          const area = (Number(fd.L) || Number(fd.S) || 0) * (Number(fd.W) || Number(fd.S) || 0);
                          const cRate = carpetPricingFor(zcz.cpT, imsCarpetMaterials).rate || 0;
                          if (area > 0 && cRate > 0) fnDecor += area * cRate;
                        });
                      }
                      const isActive = fi === activeFnIdx && !dcShowAllFns;
                      return (
                        // THE SELECTED FUNCTION IS INKED, NOT TINTED. A gold-tinted card next to plain
                        // ones told you which was chosen only if you compared them; the sidebar's whole
                        // job is to answer that at a glance. Dark ground and light type inverts it
                        // outright, and the figure — the one number anyone came to this column for —
                        // goes gold on it, which it could not do while sitting on a gold tint.
                        <button key={fi} onClick={()=>{ setDcShowAllFns(false); switchActiveFn(fi); }} className="dc-fn" data-on={isActive?"1":"0"} style={{padding:"11px 12px",borderRadius:10,border:isActive?"1px solid transparent":`1px solid ${border}`,background:isActive?"linear-gradient(150deg,#1F1A33,#2C2350)":"#fff",cursor:isActive?"default":"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:3,boxShadow:isActive?"0 10px 24px -14px rgba(26,26,46,0.6)":"none"}}>
                          {/* The function's NAME is a name — Wedding, Sangeet, Haldi — so it takes the
                              display serif, the same voice the screen's own title uses. The date under
                              it is a label, so it goes to caps with tracking at a much smaller size.
                              Both were 13/11px bold sans at the same weight, which is why the card read
                              as three stacked data points rather than a name with its details.
                              (These two still carried pure black after the first ink pass: that pass
                              matched only the plain literal form, and these set their colour through a
                              conditional. Swept separately.) */}
                          <div className="dc-title" style={{fontSize:17,color:isActive?"#fff":"#1A1A2E"}}>{fn?.fnType || `Function ${fi+1}`}</div>
                          <div className="dc-cap" style={{fontSize:9.5,color:isActive?"rgba(255,255,255,0.6)":"#1A1A2E",opacity:isActive?1:0.5,letterSpacing:1.3}}>{fn?.fnDate || "—"}{fn?.fnShift?` · ${fn.fnShift}`:""}</div>
                          <div className="dc-money" style={{fontSize:15,fontWeight:700,color:fnDecor>0?(isActive?accent:"#1A1A2E"):(isActive?"rgba(255,255,255,0.5)":textS),marginTop:3}}>{fnDecor>0?`₹${Math.round(fnDecor).toLocaleString("en-IN")}`:"—"}</div>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
              {/* MAIN CONTENT */}
              <div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
                {/* Last-minute changes to a SOLD deal used to require a department-head-approved
                    amendment request here before the item actually reserved (AmendRequestPanel).
                    Owner decision: remove that gate — a salesperson can add/remove/change items on a
                    booked deal exactly like any other deal, no waiting. Inventory now reserves
                    immediately (reconcileSoldInventoryBlocks in StudioApp.jsx); department heads are
                    informed afterward, not gated beforehand — see the "Recent changes" panel in
                    IMS → Planning → Dept Ops instead of this now-removed panel. */}
                {!activeTabDef.live ? (
                  <div style={{padding:"60px 30px",textAlign:"center",color:"#1A1A2E"}}>
                    <div style={{fontSize:42,marginBottom:14}}>{activeTabDef.icon}</div>
                    <div style={{fontSize:17.5,fontWeight:600,color:"#1A1A2E",marginBottom:8}}>{activeTabDef.label}</div>
                    <div style={{fontSize:13.5,marginBottom:4}}>Coming in {activeTabDef.ship}</div>
                    <div style={{fontSize:12,opacity:0.6}}>Spec: §7.9.{activeTabDef.id==="manpower"?"13":activeTabDef.id==="production"?"14":activeTabDef.id==="buying"?"15":"2.A + 7.9.18 + 7.9.19"}</div>
                  </div>
                ) : dcActiveTab === "inventory" ? (() => {
                  // ═══ INVENTORY TAB BODY (Patch 4) — with Generate bar (Patch 6) ═══
                  const fnIdx = activeFnIdx || 0;
                  const cardsByKey = dcCards[fnIdx] || {};
                  const allCardKeys = Object.keys(cardsByKey);
                  const totalCards = allCardKeys.length;
                  const dealCheckInventory = (dealCheckData?.inventory?.length > 0)
                    ? dealCheckData.inventory
                    : (dcInventoryCache || []);
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  const platformPlan = buildPlatformPlan(fns, dealCheckData);
                  const platformFattaR = platformPlan?.fattaItem ? imsField.rentalCost(platformPlan.fattaItem) : 0;
                  const platformStandR = platformPlan?.standItem ? imsField.rentalCost(platformPlan.standItem) : 0;
                  // §7.9.19 — Precompute reuse count per imsId for ♻ chip on cards
                  const reuseFnCount = {};
                  fns.forEach((_, fi) => { const cs = dcCards[fi] || {}; Object.values(cs).forEach(c => { if (c.imsId) { if (!reuseFnCount[c.imsId]) reuseFnCount[c.imsId] = new Set(); reuseFnCount[c.imsId].add(fi); } }); });
                  const fnBlocksForChip = (dealCheckData?.blocksByDate || {})[(fns[fnIdx]||{}).fnDate || clientDate] || {};
                  // Group by zoneKey
                  const byZone = {};
                  for (const k of allCardKeys) {
                    const c = cardsByKey[k]; if (!c) continue;
                    const zk = c.zoneKey || "(unzoned)";
                    if (!byZone[zk]) byZone[zk] = [];
                    byZone[zk].push({ ...c, _cardKey: k });
                  }
                  if (platformPlan) {
                    Object.keys(platformPlan.perZone).forEach(k => {
                      const [pfi, pzk] = k.split("|");
                      if (Number(pfi) === fnIdx && !byZone[pzk]) byZone[pzk] = [];
                    });
                  }
                  const activeFnForFlorals = fns[fnIdx];
                  const recipeSubcatsLC = (dealCheckData?.flowerRecipeSubcats || ["Flower Pattern"]).map(s => String(s||"").toLowerCase());
                  const flowerPatternsForCheck = dealCheckData?.flowerPatterns || [];
                  const findPatternByName = (name) => {
                    if (!name) return null;
                    const target = String(name).toLowerCase().trim();
                    if (!target) return null;
                    let p = flowerPatternsForCheck.find(x => String(x?.name||"").toLowerCase().trim() === target);
                    if (p) return p;
                    p = flowerPatternsForCheck.find(x => {
                      const n = String(x?.name||"").toLowerCase().trim();
                      return n && (n.includes(target) || target.includes(n));
                    });
                    return p || null;
                  };
                  const isRecipeDrivenFloral = (rcItem) => {
                    if (!rcItem) return false;
                    if (String(rcItem.cat||"").toLowerCase() !== "florals") return false;
                    if (recipeSubcatsLC.includes(String(rcItem.sub||"").toLowerCase())) return true;
                    return !!findPatternByName(rcItem.name);
                  };
                  const recipeFloralsByZone = {};
                  if (activeFnForFlorals?.zoneElements && activeFnForFlorals?.enabledEls) {
                    Object.entries(activeFnForFlorals.zoneElements).forEach(([zk, elems]) => {
                      if (!activeFnForFlorals.enabledEls[zk]) return;
                      const collected = [];
                      (elems || []).forEach(el => {
                        const rc = rcItems.find(i => i.name.toLowerCase().trim() === (el.name || "").toLowerCase().trim());
                        if (!isRecipeDrivenFloral(rc)) return;
                        collected.push({ name: el.name, qty: el.qty || 1, sub: rc.sub || "", size: el.size || "", unit: rc.unit || "pc" });
                      });
                      if (collected.length > 0) {
                        recipeFloralsByZone[zk] = collected;
                        if (!byZone[zk]) byZone[zk] = [];
                      }
                    });
                  }
                  const zoneList = Object.keys(byZone);
                  const autoCollapse = totalCards > 30;  // §7.9.2 — auto-collapse when > 30 cards
                  // ═══ Patch 6 — Generate bar computation (event-wide scope · sidebar wired) ═══
                  // `activeFn` lived here to feed the function-context header; that header is gone
                  // (see genBar below) and nothing else read it.
                  let dirtyCount = 0;
                  let totalEnabledZones = 0;
                  fns.forEach((f, fi) => {
                    if (!f?.enabledEls) return;
                    const enabledZoneKeys = Object.keys(f.enabledEls).filter(k => f.enabledEls[k]);
                    for (const zk of enabledZoneKeys) {
                      const zoneElems = f.zoneElements?.[zk] || [];
                      if (zoneElems.length === 0) continue;
                      totalEnabledZones += 1;
                      if (isZoneDirty(dcZoneState, dcCards, fi, zk)) dirtyCount += 1;
                    }
                  });
                  // ── AND NOW THE HEADER IS GONE TOO ──
                  // The Generate button went first, and the run counter with it; the function-context
                  // header was what remained. It carried three facts and owned none of them: the
                  // sidebar prints this function's TYPE at 17px and highlights it while it is active,
                  // prints its DATE and shift directly underneath, and the meta line above the zones
                  // already ends "· FUNCTION 2". The sidebar is a fixed column, so it stays on screen
                  // while this content scrolls — meaning it was the reliable answer even before, and
                  // this bar was the copy that scrolled away.
                  // What is left is the one thing nothing else says: that a generate run is in flight.
                  // So the bar renders only then, instead of standing empty the rest of the time.
                  const genBar = !dcGenerating ? null : (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",borderRadius:9,background:"rgba(201,169,110,0.06)",border:`1px solid ${border}`,marginBottom:14,gap:10,flexWrap:"wrap"}}>
                      <div style={{fontSize:12,color:IV.ink2,fontWeight:600,letterSpacing:0.2}}>
                        Matching this function against IMS inventory…
                      </div>
                      <div style={{fontSize:12,color:accent,fontWeight:700}}>Generating…</div>
                    </div>
                  );
                  if (totalCards === 0) {
                    return (
                      <div>
                        {genBar}
                        <div style={{padding:"40px 30px",textAlign:"center",color:"#1A1A2E"}}>
                          <div style={{fontSize:38,marginBottom:14}}>📦</div>
                          <div style={{fontSize:15.5,fontWeight:600,color:"#1A1A2E",marginBottom:6}}>No inventory matched yet</div>
                          {/* Was "Click Generate above" — that button no longer exists, so pointing
                              at it would send people looking for a control that is not there. */}
                          <div style={{fontSize:13}}>Nothing has been matched to IMS inventory for this function yet.</div>
                        </div>
                      </div>
                    );
                  }
                  // gap 12 → 10 between the cards, but they now carry their own radius and lift, so the
                  // air between them reads. The old rows butted onto each other and the gap was doing
                  // all the separating on its own — which is why they looked like one striped block
                  // rather than a stack of cards.
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {genBar}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                        {/* A caption, set as one. At 13px full-ink it had the same presence as the zone
                            names below it, so the eye stopped here on the way to the actual list. Caps
                            with tracking at 10px reads as a summary line — which is all it is — and the
                            two counts stay full-strength so the numbers are still the part you see. */}
                        <div className="dc-cap" style={{color:"#1A1A2E",opacity:0.5,letterSpacing:1.4}}>
                          {totalCards} card{totalCards===1?"":"s"} · {zoneList.length} zone{zoneList.length===1?"":"s"} · function {fnIdx + 1}
                        </div>
                        {/* Same count, said as a state rather than as a word. "7 dirty" was grey text
                            at the same weight as everything around it — the one line on this header
                            that means SOMETHING NEEDS DOING, and it was the quietest thing there.
                            Red with a warning glyph when there is something, green when there is not.
                            Only the presentation moved; dirtyCount is untouched. */}
                        {dirtyCount>0
                          ? <div style={{fontSize:11,fontWeight:700,letterSpacing:0.6,color:"#E11D48",display:"inline-flex",alignItems:"center",gap:5,padding:"4px 9px",borderRadius:999,background:"rgba(225,29,72,0.10)",border:"1px solid rgba(225,29,72,0.22)"}}><span style={{fontSize:11,lineHeight:1}}>⚠</span>{dirtyCount} {dirtyCount===1?"issue":"issues"}</div>
                          : <div style={{fontSize:11,fontWeight:700,letterSpacing:0.6,color:"#059669",display:"inline-flex",alignItems:"center",gap:5,padding:"4px 9px",borderRadius:999,background:"rgba(16,185,129,0.10)",border:"1px solid rgba(16,185,129,0.22)"}}><span style={{fontSize:11,lineHeight:1}}>✓</span>All clean</div>}
                      </div>
                      {zoneList.map(zk => {
                        const collapseKey = `${fnIdx}|${zk}`;
                        const userOverride = dcCollapsedZones[collapseKey];
                        const collapsed = userOverride === undefined ? autoCollapse : userOverride;
                        // ── PLAIN CARDS FIRST, POPULATED KITS LAST ──
                        // A kit card carries its whole component list and runs several times the
                        // height of a plain two-line one. Grid rows stretch to their tallest cell,
                        // so a kit placed early leaves every short card beside it standing over a
                        // column of dead space. Kits last packs the short cards together and puts
                        // the tall ones where their height costs nothing.
                        // Counts the EFFECTIVE components, not item.subItems: a kit can be edited
                        // per deal (dcKitEdits), so a card can carry a kit in IMS and show an empty
                        // one here. Reading the same source the panel renders from is what makes
                        // "empty" mean the same thing to the sort as it does on screen.
                        // Array.sort is stable in V8, so order within each group is still the order
                        // the generator produced.
                        const zoneCardsRaw = byZone[zk];
                        const kitSize = (c) => {
                          const it = c.imsId ? dcInventoryCache.find(x => x.id === c.imsId) : null;
                          if (!it) return 0;
                          const edited = dcKitEdits[fnIdx]?.[c._cardKey];
                          if (Array.isArray(edited)) return edited.length;
                          return Array.isArray(it.subItems) ? it.subItems.length : 0;
                        };
                        const zoneCards = [...zoneCardsRaw].sort((a, b) => (kitSize(a) > 0 ? 1 : 0) - (kitSize(b) > 0 ? 1 : 0));
                        const matchedCount = zoneCards.filter(c => c.imsId).length;
                        const unmatchedCount = zoneCards.length - matchedCount;
                        // A zone can carry more than one platform row (row 0 = `${fnIdx}|${zk}`, plus
                        // any extraPlatformRows keyed `${fnIdx}|${zk}|${rowIdx}` by buildPlatformPlan).
                        const platformEntriesForZone = Object.entries(platformPlan?.perZone || {})
                          .filter(([k]) => k === `${fnIdx}|${zk}` || k.startsWith(`${fnIdx}|${zk}|`))
                          .map(([k, pi]) => ({ k, pi, rowIdx: k === `${fnIdx}|${zk}` ? 0 : Number(k.split("|")[2]) }))
                          .sort((a, b) => a.rowIdx - b.rowIdx);
                        const hasPlatform = platformEntriesForZone.length > 0;
                        const platformShort = platformEntriesForZone.some(({ pi }) => pi.freeAfterFatta < 0 || (pi.stands > 0 && pi.freeAfterStand < 0));
                        const recipeFlorals = recipeFloralsByZone[zk] || [];
                        const manualItemsInZone = dcManualItems.filter(mi => mi.fnIdx === fnIdx && mi.zoneKey === zk);
                        const totalRowCount = zoneCards.length + platformEntriesForZone.length + recipeFlorals.length + manualItemsInZone.length;
                        const zonePhoto = fns[fnIdx]?.elSelectedPhoto?.[zk]?.src || null;
                        const zonePhotoName = fns[fnIdx]?.elSelectedPhoto?.[zk]?.eventName || "";
                        // Total rental of every matched item in this zone — mirrors the sidebar/bottom-bar
                        // rollup math exactly (split-fulfilment lines, unavailable-shortfall cost%, the
                        // fixed-venue Repeat discount) instead of a naive qty × rate sum, which is why this
                        // pill used to run well under both of those. Also folds in this zone's own share of
                        // platform (fatta/stand) and carpet — real rental cost that already shows as its own
                        // card below but was never added into the "X rental" total above it.
                        const _zoneIsRepeat = (ck) => { const zzk = String(ck || "").split("::")[1]; return !!(zzk && fns[fnIdx]?.zoneConfig?.[zzk]?.repeat); };
                        const _costPctFor = (subcat) => { const key = String(subcat || "").trim().toLowerCase(); const row = (rcSubcatFactors || []).find(r => r?.id === key); const v = row ? Number(row.cost_percent) : undefined; return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 100; };
                        const _fnVenueForRepeat = fns[fnIdx]?.fnVenue;
                        let zoneRentalTotal = 0;
                        zoneCards.forEach(c => {
                          const splitArr = Array.isArray(c.split) ? c.split.filter(s => s && s.imsId && (Number(s.qty) || 0) > 0) : [];
                          if (splitArr.length) {
                            const _rep = _zoneIsRepeat(c._cardKey);
                            splitArr.forEach(s => { const it = dcInventoryCache.find(x => x.id === s.imsId); if (!it) return; const q = Number(s.qty) || 0; const br = imsField.rentalCost(it); zoneRentalTotal += repeatAdjustedRental(_rep, _fnVenueForRepeat, it, q, br); });
                            return;
                          }
                          if (!c.imsId) return;
                          const it = dcInventoryCache.find(x => x.id === c.imsId);
                          if (!it) return;
                          const baseR = effKitRental(it, fnIdx, c._cardKey);
                          const qty = Number(c.qty) || 1;
                          const _rep = _zoneIsRepeat(c._cardKey);
                          const isKit = Array.isArray(it.subItems) && it.subItems.length > 0;
                          if (isKit) { zoneRentalTotal += repeatAdjustedRental(_rep, _fnVenueForRepeat, it, qty, baseR); return; }
                          const available = getStudioAvailable(it, fnBlocksForChip);
                          const ownedQty = Math.min(qty, available);
                          const shortQty = Math.max(0, qty - available);
                          const ownedRental = repeatAdjustedRental(_rep, _fnVenueForRepeat, it, ownedQty, baseR);
                          const shortCost = shortQty * (Number(it.cost) || 0) * (oosCostPctFor(it, _costPctFor) / 100);
                          zoneRentalTotal += ownedRental + shortCost;
                        });
                        manualItemsInZone.forEach(mi => { const it = dcInventoryCache.find(x => x.id === mi.imsId); if (!it) return; const q = Number(mi.qty) || 1; const baseR = effKitRental(it, fnIdx, null); const _rep = mi.zoneKey ? !!(fns[fnIdx]?.zoneConfig?.[mi.zoneKey]?.repeat) : false; zoneRentalTotal += repeatAdjustedRental(_rep, _fnVenueForRepeat, it, q, baseR); });
                        platformEntriesForZone.forEach(({ pi }) => { zoneRentalTotal += (pi.fattas || 0) * platformFattaR + (pi.stands || 0) * platformStandR; });
                        {
                          const zcz = fns[fnIdx]?.zoneConfig?.[zk];
                          if (zcz && zcz.cpT !== CARPET_OFF) {
                            const fd = zcz.floorDims || zcz.dims || {};
                            const area = (Number(fd.L) || Number(fd.S) || 0) * (Number(fd.W) || Number(fd.S) || 0);
                            const cRate = carpetPricingFor(zcz.cpT, imsCarpetMaterials).rate || 0;
                            if (area > 0 && cRate > 0) zoneRentalTotal += area * cRate;
                          }
                        }
                        zoneRentalTotal = Math.round(zoneRentalTotal);
                        // ── A CARD, NOT A BAND ──
                        // These read as flat grey strips: the shadow was almost nothing, the radius was
                        // small against their width, and every row butted onto the next. A card needs
                        // three things and it had none of them — a lift you can see, a radius you can
                        // see, and air between it and its neighbour.
                        // The shadow is still soft, deliberately. These are LIST rows: if each one
                        // floats hard the list reads as a scattered pile instead of an ordered set.
                        // Enough to separate, not enough to detach.
                        return (
                          <div key={zk} className="dc-zone" style={{borderRadius:14,overflow:"hidden",boxShadow:"0 1px 2px rgba(26,26,46,0.05), 0 10px 22px -14px rgba(26,26,46,0.28)"}}>
                            <div onClick={()=>setDcCollapsedZones(p=>({...p,[collapseKey]:!collapsed}))} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"13px 16px",cursor:"pointer",borderBottom:collapsed?"none":`1px solid ${border}`}}>
                              <div style={{display:"flex",alignItems:"center",gap:11,minWidth:0}}>
                                {/* The set's own chevron, rotated, rather than a ▼ glyph — the triangle
                                    was a font character, so it sat at whatever weight and baseline the
                                    system font gave it and never quite matched the row. */}
                                <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:6,flexShrink:0,color:collapsed?textS:"#1A1A2E",background:collapsed?"transparent":"rgba(26,26,46,0.05)",transition:"transform .16s ease,background .16s ease",transform:collapsed?"rotate(-90deg)":"rotate(0)"}}><IconChevron size={13}/></span>
                                {zonePhoto && <img loading="lazy" decoding="async" src={thumbUrl(zonePhoto, 160)} alt={zonePhotoName||zk} onClick={e=>{e.stopPropagation();window.open(zonePhoto,"_blank");}} title={zonePhotoName?`${zonePhotoName} — click to enlarge`:"Zone reference photo — click to enlarge"} style={{width:46,height:34,objectFit:"cover",borderRadius:6,border:`1px solid ${border}`,cursor:"zoom-in",flexShrink:0}} />}
                                {/* Zone names stay in the SANS, deliberately. They are the thing you scan
                                    a list of — five or six of them, read in order, looking for one — and
                                    a text serif slows that down for no gain. Premium here is negative
                                    tracking and a heavier weight at a slightly larger size, which is how
                                    a sans reads as set rather than as default.
                                    "10 cards" drops to a caps micro-label: it qualifies the name, and at
                                    12px full-ink it was competing with it. */}
                                <span style={{fontSize:15.5,fontWeight:700,color:IV.ink,letterSpacing:-0.25,textTransform:"capitalize"}}>{zk}</span>
                                <span className="dc-cap" style={{color:IV.ink3,letterSpacing:1.2}}>{totalRowCount} card{totalRowCount===1?"":"s"}</span>
                                {zoneRentalTotal>0 && <span title="Total rental of all inventory in this zone" style={{fontSize:13,padding:"3px 9px",borderRadius:5,background:"rgba(201,169,110,0.15)",color:accent,fontWeight:700}}>₹{zoneRentalTotal.toLocaleString("en-IN")} rental</span>}
                              </div>
                              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                                {/* ── THE SAME MARKS BUILD USES, FOR THE SAME ACTIONS ──
                                    These were emoji-plus-sign labels — 🏭+ and 🛒+ — while Build draws
                                    the identical two buttons as IconFactory and IconCart in 26px tinted
                                    squares. Two different pictures for one action is the kind of thing
                                    that makes an app feel assembled rather than designed, and the emoji
                                    version could not be size-matched anyway.
                                    Copied down to the colours and the box: #7E22CE on violet, #B45309 on
                                    amber, 26×26, radius 7. If Build's change, these should follow. */}
                                {hasPlatform && <span title={platformShort?"Structural platform — short in stock":"Structural platform (fatta + stand)"} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:3,height:26,padding:"0 8px",borderRadius:7,background:platformShort?"rgba(245,158,11,0.14)":"rgba(16,185,129,0.14)",color:platformShort?"#B45309":"#059669",fontWeight:700,fontSize:11}}><IconPlatform size={13}/>{platformShort?"⚠":"✓"}</span>}
                                {fnIdx === activeFnIdx && <>
                                  <span onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx,zoneKey:zk,type:"production"});}} title="Add Production item" style={{cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,color:"#7E22CE",borderRadius:7,background:"rgba(168,85,247,0.10)"}}><IconFactory size={14}/></span>
                                  <span onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx,zoneKey:zk,type:"buying"});}} title="Add Buying item" style={{cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,color:"#B45309",borderRadius:7,background:"rgba(245,158,11,0.12)"}}><IconCart size={14}/></span>
                                </>}
                                {matchedCount>0 && <span title={`${matchedCount} matched to stock`} style={{display:"inline-flex",alignItems:"center",gap:4,height:26,padding:"0 9px",borderRadius:7,background:"rgba(16,185,129,0.14)",color:"#059669",fontWeight:700,fontSize:11}}><IconCheck size={12}/>{matchedCount}</span>}
                                {unmatchedCount>0 && <span title={`${unmatchedCount} not matched`} style={{display:"inline-flex",alignItems:"center",gap:4,height:26,padding:"0 9px",borderRadius:7,background:"rgba(239,68,68,0.14)",color:"#DC2626",fontWeight:700,fontSize:11}}><IconAlert size={12}/>{unmatchedCount}</span>}
                              </div>
                            </div>
                            {!collapsed && (
                              <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:10}}>
                                {/* Platform composite card(s) (Deploy 2 §7.9 addendum) — one per platform row */}
                                {platformEntriesForZone.map(({ k: piKey, pi, rowIdx }) => {
                                  const sqft = pi.L * pi.W;
                                  const heightLabel = pi.plH === "4in" ? "4 inch raise" : "1ft–3ft";
                                  const fattaShort = pi.freeAfterFatta < 0;
                                  const standShort = pi.stands > 0 && pi.freeAfterStand < 0;
                                  const anyShort = fattaShort || standShort;
                                  // THE INSIDE OF A ZONE, SKINNED LIKE THE OUTSIDE. This card was a
                                  // 4%-green wash with a green hairline, which made every structural item
                                  // look like a success message. The state it needs to signal is stock —
                                  // short or not — and that is already said by the tick or warning on
                                  // each line below, in words. So the card goes glass like everything
                                  // else, and the BORDER carries the state: amber when something is
                                  // short, otherwise a plain edge. (accentBorder is gone with the green
                                  // wash it was picked for; anyShort is read directly below.)
                                  // STRUCTURAL loses its grey slab for a hairline tag: it is a
                                  // classification, not a warning, and at 11px in a filled box it was
                                  // heavier than the item's own name.
                                  return (
                                    <div key={piKey} className="dc-item" style={{padding:"12px 13px",borderRadius:10,border:`1px solid ${anyShort?"rgba(245,158,11,0.45)":"rgba(255,255,255,0.85)"}`,display:"flex",flexDirection:"column",gap:8}}>
                                      <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                                        <span style={{fontSize:13,fontWeight:700,color:IV.ink,letterSpacing:-0.1}}>🏗️ Platform{rowIdx>0?` #${rowIdx+1}`:""} ({heightLabel})</span>
                                        <span className="dc-cap" style={{fontSize:10,padding:"2px 7px",borderRadius:999,border:"1px solid rgba(100,116,139,0.32)",color:"#64748B",letterSpacing:1.1}}>Structural</span>
                                        <span className="dc-money" style={{fontSize:12,color:IV.ink2}}>{pi.L}×{pi.W} = {sqft} sqft</span>
                                      </div>
                                      <div className="dc-cap" style={{color:IV.ink3,letterSpacing:1.3}}>Composite — expands to</div>
                                      <div style={{display:"flex",flexDirection:"column",gap:5,paddingLeft:8}}>
                                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                                          <span style={{color:IV.ink,fontWeight:600,minWidth:140}}>Platform Fatta × {pi.fattas}</span>
                                          {pi.fattaItem ? (
                                            fattaShort ? (
                                              <span style={{color:"#F59E0B",fontWeight:600}}>⚠ {Math.max(0,pi.freeBeforeFatta)} free{pi.priorFatta>0?` (after ${pi.priorFatta} taken by prior zones this date)`:""} · short by {Math.abs(pi.freeAfterFatta)}</span>
                                            ) : (
                                              <span style={{color:"#10B981"}}>✓ {pi.freeBeforeFatta} free{pi.priorFatta>0?` (after ${pi.priorFatta} prior)`:""}, {pi.freeAfterFatta} left after this zone</span>
                                            )
                                          ) : (
                                            <span style={{color:"#EF4444",fontStyle:"italic"}}>⚠ {PLATFORM_FATTA_CODE} not in IMS</span>
                                          )}
                                        </div>
                                        {pi.stands > 0 && (
                                          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                                            <span style={{color:IV.ink,fontWeight:600,minWidth:140}}>Platform Stand × {pi.stands}</span>
                                            {pi.standItem ? (
                                              standShort ? (
                                                <span style={{color:"#F59E0B",fontWeight:600}}>⚠ {Math.max(0,pi.freeBeforeStand)} free{pi.priorStand>0?` (after ${pi.priorStand} taken by prior zones this date)`:""} · short by {Math.abs(pi.freeAfterStand)}</span>
                                              ) : (
                                                <span style={{color:"#10B981"}}>✓ {pi.freeBeforeStand} free{pi.priorStand>0?` (after ${pi.priorStand} prior)`:""}, {pi.freeAfterStand} left after this zone</span>
                                              )
                                            ) : (
                                              <span style={{color:"#EF4444",fontStyle:"italic"}}>⚠ {PLATFORM_STAND_CODE} not in IMS</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                      {(()=>{
                                        const fR = pi.fattaItem ? imsField.rentalCost(pi.fattaItem) : 0;
                                        const sR = pi.standItem ? imsField.rentalCost(pi.standItem) : 0;
                                        const fCost = (pi.fattas||0) * fR;
                                        const sCost = (pi.stands||0) * sR;
                                        const total = fCost + sCost;
                                        if (total <= 0) return <div style={{fontSize:12,color:"#F59E0B",marginTop:6,fontStyle:"italic"}}>⚠ Set rental prices on Platform Fatta/Stand in IMS for cost to appear</div>;
                                        // A COSTING BLOCK, SET AS ONE. Three lines with a rupee figure on
                                        // the right is a small table, and it was set as three sentences:
                                        // proportional digits, so ₹4,800 and ₹1,200 did not line up under
                                        // each other, and the sum did not line up under either. dc-money
                                        // on every figure fixes the column.
                                        // The total stops being green. Green is what the availability ticks
                                        // above mean here — "in stock" — and using it again on a rupee
                                        // figure said the amount was somehow good news. It is the sum, so
                                        // it is ink, and weight is what makes it the sum.
                                        return (
                                          <div style={{marginTop:9,paddingTop:8,borderTop:"1px solid rgba(26,26,46,0.10)",display:"flex",flexDirection:"column",gap:4}}>
                                            <div style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:12,color:IV.ink2}}>
                                              <span>Fatta ₹{fR.toLocaleString("en-IN")} × {pi.fattas}</span>
                                              <span className="dc-money" style={{fontWeight:600}}>₹{fCost.toLocaleString("en-IN")}</span>
                                            </div>
                                            {pi.stands > 0 && sR > 0 && (
                                              <div style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:12,color:IV.ink2}}>
                                                <span>Stand ₹{sR.toLocaleString("en-IN")} × {pi.stands}</span>
                                                <span className="dc-money" style={{fontWeight:600}}>₹{sCost.toLocaleString("en-IN")}</span>
                                              </div>
                                            )}
                                            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline",marginTop:3,paddingTop:5,borderTop:"1px solid rgba(26,26,46,0.07)"}}>
                                              <span className="dc-cap" style={{color:IV.ink2,letterSpacing:1.3}}>Platform rental</span>
                                              <span className="dc-money" style={{fontSize:14,fontWeight:800,color:IV.ink}}>₹{total.toLocaleString("en-IN")}</span>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  );
                                })}
                                {/* §26.18 + §26.19 — Carpet block with visual tile picker */}
                                {(()=>{
                                  const zc = fns[fnIdx]?.zoneConfig?.[zk];
                                  // Unset cpT (nobody has picked a carpet material yet) skips this card
                                  // too, same as the explicit OFF sentinel — otherwise it renders an
                                  // "pick a carpet" prompt for a floor that isn't being charged carpet
                                  // at all (see carpetPricingFor in taxonomy.js).
                                  if (!zc || !zc.cpT || zc.cpT === CARPET_OFF) return null;
                                  const fd = zc.floorDims || zc.dims || {};
                                  const neededSqft = Math.round((Number(fd.L)||0)*(Number(fd.W)||0));
                                  if (neededSqft <= 0) return null;
                                  const carpetOpts = dcInventoryCache.filter(x => String(imsField.subcategory(x)||"").toLowerCase().includes("carpet"));
                                  const pickedId = dcCarpetPick[fnIdx]?.[zk];
                                  const carpetItem = pickedId ? dcInventoryCache.find(x=>x.id===pickedId) : null;
                                  const markup = dealCheckData?.carpetFreshMarkup ?? 40;
                                  const calc = carpetItem ? calcZoneCarpet(zc, carpetItem, markup) : null;
                                  // What the rollup actually charges — area × the zone's carpet
                                  // material rate, the same figure Build shows. Displayed here so the
                                  // card cannot state one number while the total is built on another.
                                  const cPrice = carpetPricingFor(zc.cpT, imsCarpetMaterials);
                                  const chargedCarpet = neededSqft * (cPrice.rate || 0);
                                  const setPick = (id)=> setDcCarpetPick(prev=>({...prev,[fnIdx]:{...(prev[fnIdx]||{}),[zk]: id}}));
                                  const searchKey = `${fnIdx}|${zk}`;
                                  const searchText = dcCarpetSearch[searchKey] || "";
                                  const setSearch = (v)=> setDcCarpetSearch(prev=>({...prev,[searchKey]:v}));
                                  const q = searchText.toLowerCase().trim();
                                  const _fnPal = fns[fnIdx]?.fnPalette || "Custom";
                                  const _pObj = (imsPaletteCatalogue||[]).find(p => p.name === _fnPal);
                                  const _anchors = (_pObj?.anchorColours || []).map(c => c.toLowerCase());
                                  const scoreCarpet = (x) => {
                                    const n = (x.name||"").toLowerCase();
                                    let matches = 0;
                                    for (const a of _anchors) { if (n.includes(a)) matches++; }
                                    return matches;
                                  };
                                  let filtered;
                                  if (q) {
                                    filtered = carpetOpts.filter(x => (x.name||"").toLowerCase().includes(q) || String(imsField.subcategory(x)||"").toLowerCase().includes(q));
                                  } else {
                                    filtered = [...carpetOpts].sort((a,b) => {
                                      const sa = scoreCarpet(a), sb = scoreCarpet(b);
                                      if (sb !== sa) return sb - sa;
                                      return (Number(b.qty)||0) - (Number(a.qty)||0);
                                    });
                                  }
                                  const showAllKey = `${fnIdx}|${zk}|showAll`;
                                  const showAll = dcCarpetSearch[showAllKey] === "1";
                                  const displayLimit = q ? 30 : (showAll ? filtered.length : 10);
                                  const hasMore = !q && filtered.length > 10 && !showAll;
                                  // ── THE PICKER IS ONLY OPEN WHEN THERE IS A CHOICE TO MAKE ──
                                  // This block showed the chosen carpet AND the full search-and-browse
                                  // picker at once, permanently. On a settled deal that is a large
                                  // pink panel with a search box and a grid of thumbnails sitting
                                  // above the item cards, for a decision already made. Once a carpet
                                  // is picked it collapses to one line; "Change" reopens it. With
                                  // nothing picked it opens on its own, because then the picker IS
                                  // the point. Keyed into dcCarpetSearch rather than new state — it
                                  // is already the per-zone carpet UI store and is not persisted.
                                  const openKey = `${fnIdx}|${zk}|open`;
                                  const pickerOpen = !carpetItem || dcCarpetSearch[openKey] === "1";
                                  return (
                                    <div style={{padding:"10px 12px",borderRadius:11,background:CARD_BG,border:`1px solid ${CARD_BORDER}`,display:"flex",flexDirection:"column",gap:8}}>
                                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                                        <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,borderRadius:8,flexShrink:0,fontSize:13,background:"#F6E9E6"}}>🟥</span>
                                        <span style={{fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase"}}>Carpet</span>
                                        <span style={{fontSize:9.5,padding:"2px 7px",borderRadius:999,background:CHIP_BG,color:INK_2,fontWeight:700,letterSpacing:0.4}}>{carpetPricingFor(zc.cpT, imsCarpetMaterials).label.toLowerCase().includes("old")?"REUSED PREF":"FLOOR"}</span>
                                        <span style={{fontSize:11,color:INK_3,...NUM}}>{neededSqft} sqft needed</span>
                                        {/* The charged figure, from the zone's carpet material —
                                            the same basis Build quotes on. The picker chooses
                                            WHICH carpet ops pulls, not what it costs. */}
                                        {chargedCarpet > 0 && (
                                          <span style={{marginLeft:"auto",fontSize:13.5,fontWeight:750,color:INK,letterSpacing:-0.3,...NUM}}>
                                            {fmt(chargedCarpet)}
                                            <span style={{fontWeight:500,fontSize:10,color:INK_3,marginLeft:6}}>
                                              {cPrice.label || "carpet"} · ₹{cPrice.rate}/sqft
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                      {carpetItem && calc ? (
                                        <div style={{display:"flex",gap:9,alignItems:"center",padding:"7px 9px",borderRadius:9,background:TILE_BG,border:`1px solid ${TILE_BORDER}`}}>
                                          {(()=>{const cp=imsField.photos(carpetItem)[0]; return cp ? <HoverZoom src={thumbUrl(cp, 320)}><img loading="lazy" decoding="async" src={thumbUrl(cp, 72)} alt="" style={{width:36,height:36,borderRadius:8,objectFit:"cover",flexShrink:0,border:`1px solid ${CARD_BORDER}`}}/></HoverZoom> : <div style={{width:36,height:36,borderRadius:8,background:CARD_BG,border:`1px solid ${CARD_BORDER}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>🟥</div>;})()}
                                          <div style={{flex:1,minWidth:0}}>
                                            <div style={{fontSize:12.5,fontWeight:650,color:INK,letterSpacing:-0.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{carpetItem.name}</div>
                                            <div style={{fontSize:11,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...NUM}}>
                                              {calc.fresh>0
                                                ? <span style={{color:GOLD,fontWeight:600}}>⚠ {calc.reused} reused + {calc.fresh} fresh sqft · ₹{Math.round(calc.cost).toLocaleString("en-IN")}</span>
                                                : <span style={{color:GOOD}}>✓ {calc.needed} sqft in stock · ₹{Math.round(calc.cost).toLocaleString("en-IN")} rental</span>}
                                            </div>
                                            {calc.rentalRate<=0 && <div style={{color:BAD,fontSize:10.5,marginTop:2,fontStyle:"italic"}}>⚠ No rental rate in IMS (₹0/sqft)</div>}
                                          </div>
                                          <button onClick={()=>setDcCarpetSearch(prev=>({...prev,[openKey]:pickerOpen?"0":"1"}))}
                                            className="dc2-ghost"
                                            style={{flexShrink:0,fontSize:10.5,fontWeight:650,padding:"4px 10px",borderRadius:999,border:`1px solid ${TILE_BORDER}`,background:CARD_BG,color:INK_2,cursor:"pointer",whiteSpace:"nowrap"}}>
                                            {pickerOpen ? "Done" : "Change"}
                                          </button>
                                          <span onClick={()=>setPick(null)} style={{color:BAD,cursor:"pointer",fontSize:15,fontWeight:700,flexShrink:0}} title="Clear">×</span>
                                        </div>
                                      ) : (
                                        <div style={{fontSize:11.5,color:INK_2}}>Pick a carpet below{_anchors.length > 0 ? ` — sorted by ${_fnPal} theme` : ""} · {carpetOpts.length} option{carpetOpts.length===1?"":"s"} in IMS</div>
                                      )}
                                      {pickerOpen && <input value={searchText} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search carpets (colour, type, design)…" style={{fontSize:12,padding:"5px 9px",borderRadius:8,border:`1px solid ${CARD_BORDER}`,background:CARD_BG,color:INK}} />}
                                      {pickerOpen && <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,WebkitOverflowScrolling:"touch",flexWrap:"wrap"}}>
                                        {filtered.length === 0 && <div style={{fontSize:12,color:IV.ink,fontStyle:"italic",padding:"8px 0"}}>No carpets match "{searchText}"</div>}
                                        {filtered.slice(0,displayLimit).map(opt=>{
                                          const optPhoto = imsField.photos(opt)[0];
                                          const isSelected = pickedId === opt.id;
                                          const optRental = imsField.rentalCost(opt);
                                          const optOwned = Number(opt.qty)||0;
                                          const themeScore = scoreCarpet(opt);
                                          return (
                                            <div key={opt.id} onClick={()=>{setPick(opt.id); setSearch("");}} style={{minWidth:84,maxWidth:92,cursor:"pointer",borderRadius:9,overflow:"hidden",border:isSelected?`2px solid #10B981`:themeScore>0?`1.5px solid rgba(201,169,110,0.5)`:`1px solid ${border}`,background:isSelected?"rgba(16,185,129,0.08)":themeScore>0?"rgba(201,169,110,0.06)":"rgba(26, 26, 46,0.025)",flexShrink:0,transition:"border 0.15s",position:"relative"}}>
                                              {themeScore>0&&<div style={{position:"absolute",top:3,right:3,fontSize:10,padding:"1px 5px",borderRadius:4,background:"rgba(201,169,110,0.85)",color:IV.ink,fontWeight:700,zIndex:1}}>🎨 match</div>}
                                              {optPhoto ? <img loading="lazy" decoding="async" src={thumbUrl(optPhoto, 180)} alt="" style={{width:"100%",height:56,objectFit:"cover",display:"block"}}/> : <div style={{width:"100%",height:56,background:"#F4F2EC",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🟥</div>}
                                              <div style={{padding:"5px 6px"}}>
                                                <div style={{fontSize:11,fontWeight:600,color:IV.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{opt.name}</div>
                                                <div style={{fontSize:10,color:IV.ink,marginTop:1}}>{optOwned.toLocaleString("en-IN")} sqft{optRental>0?` · ₹${optRental}/sqft`:""}</div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                        {hasMore && <div onClick={()=>setDcCarpetSearch(prev=>({...prev,[showAllKey]:"1"}))} style={{minWidth:70,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",borderRadius:9,border:`1px dashed ${CARD_BORDER}`,padding:"10px 8px",fontSize:11,color:INK_2,fontWeight:650,flexShrink:0}}>Show all {filtered.length}</div>}
                                      </div>}
                                    </div>
                                  );
                                })()}
                                {/* ── ITEM CARDS RUN TWO-UP ──
                                    Flex-wrap rather than grid, so they stack on a tablet without a
                                    media query and an odd trailing card grows to fill its row instead
                                    of leaving a half-width hole. Matched cards and manual blocks share
                                    the one flow: they are both "an item in this zone", and splitting
                                    them into two grids would put a ragged gap between the groups.
                                    minWidth 430 is the point below which the split editor's dropdown,
                                    qty box and "5 avail" stop fitting on one line. */}
                                <div className="dci-grid">
                                {zoneCards.map(card => {
                                  const item = card.imsId ? dcInventoryCache.find(x => x.id === card.imsId) : null;
                                  const photo = item ? imsField.photos(item)[0] : null;
                                  const rental = item ? effKitRental(item, fnIdx, card._cardKey) : 0;
                                  const dims = item ? imsField.sizeText(item) : "";
                                  const hold = card.imsId ? getActiveSoftHold(softHolds, card.imsId, authUser?.name, Date.now()) : null;
                                  const sourceMeta = {
                                    "name-match": { icon: "📋", color: "#64748B", label: "name match" },
                                    "knowledge":  { icon: "🧠", color: "#22C55E", label: "learned" },
                                    "manual-swap":{ icon: "✋", color: "#7C3AED", label: "swapped" },
                                    "photo":      { icon: "📷", color: "#38BDF8", label: "photo AI" },
                                    "list":       { icon: "📋", color: "#64748B", label: "list AI" },
                                    "floral":     { icon: "🌸", color: "#EC4899", label: "floral" },
                                    "no-match":   { icon: "⚠",  color: "#EF4444", label: "no match" },
                                  }[card.source] || { icon: "·", color:IV.ink, label: "" };
                                  return (
                                    <div key={card._cardKey} className="dci-card" style={{padding:"12px 13px",borderRadius:10,background:IV.card,border:`1px solid ${IV.border}`,boxShadow:IV.shadow,display:"flex",flexWrap:"wrap",gap:11,alignItems:"flex-start"}}>
                                      {photo ? <HoverZoom src={thumbUrl(photo, 320)}><img loading="lazy" decoding="async" src={thumbUrl(photo, 56)} alt="" style={{width:54,height:54,borderRadius:7,objectFit:"cover",flexShrink:0,background:"#FFFFFF"}}/></HoverZoom> : <div style={{width:54,height:54,borderRadius:7,background:"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:IV.ink,flexShrink:0}}>?</div>}
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
                                          <span style={{fontSize:14,fontWeight:700,letterSpacing:-0.1,color:IV.ink}}>{item?.name || card.rcName || "(unnamed)"}</span>
                                          <span title={sourceMeta.label} style={{fontSize:11,padding:"2px 6px",borderRadius:4,background:`${sourceMeta.color}22`,color:sourceMeta.color,fontWeight:700,letterSpacing:0.4}}>{sourceMeta.icon} {sourceMeta.label}</span>
                                          {hold && <span title={`Held by ${hold.salesperson} for ${hold.eventName}`} style={{fontSize:11,padding:"2px 6px",borderRadius:4,background:"rgba(245,158,11,0.20)",color:"#F59E0B",fontWeight:700,letterSpacing:0.4}}>⏳ {hold.salesperson}</span>}
                                          {item && (()=>{ const cq=Number(card.qty)||1; const av=getStudioAvailable(item, fnBlocksForChip); return cq>av ? <span style={{fontSize:11,padding:"2px 6px",borderRadius:4,background:"rgba(239,68,68,0.18)",color:"#EF4444",fontWeight:700,letterSpacing:0.4}}>⚠ {av}</span> : null; })()}
                                          {card.imsId && reuseFnCount[card.imsId]?.size >= 2 && <span style={{fontSize:11,padding:"2px 6px",borderRadius:4,background:"rgba(16,185,129,0.18)",color:"#10B981",fontWeight:700,letterSpacing:0.4}}>♻ {reuseFnCount[card.imsId].size} fns</span>}
                                          <span onClick={()=>setDcCards(prev=>{const fn={...(prev[fnIdx]||{})}; delete fn[card._cardKey]; return {...prev,[fnIdx]:fn};})} title="Remove from Deal Check" style={{marginLeft:"auto",cursor:"pointer",color:"#EF4444",fontSize:15.5,fontWeight:700,padding:"0 4px",lineHeight:1,flexShrink:0,opacity:0.6,transition:"opacity 0.15s"}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0.6}>×</span>
                                        </div>
                                        {card.imsId && item ? (
                                          <div style={{fontSize:12,lineHeight:1.5,color:IV.ink2,marginBottom:7}}>
                                            → <span style={{color:IV.ink,fontWeight:700}}>{item.name || card.imsName}</span>
                                            <span style={{...NUM,marginLeft:8,color:IV.ink,fontWeight:700}}>₹{rental.toLocaleString("en-IN")}{card.qty>1?` × ${card.qty} = ₹${(rental*card.qty).toLocaleString("en-IN")}`:""}</span>
                                            {dims && <span style={{marginLeft:8,color:IV.ink3}}>· {dims}</span>}
                                          </div>
                                        ) : (
                                          <div style={{fontSize:12,color:IV.red,marginBottom:7,fontStyle:"italic"}}>No IMS match — pick from alternatives below or browse subcategory</div>
                                        )}
                                        {/* The "Set as correct match for this photo" link stood here, with its "learned for
                                            this photo" counterpart. Removed on request. Worth recording what went with it: this
                                            was the ONLY place a person could correct the knowledge set. saveKnowledgeEntry still
                                            runs automatically whenever the AI or a name-match resolves a card (StudioApp.jsx), so
                                            the set keeps being written to — there is simply no longer a way to overrule it when it
                                            is wrong, and no indicator that a photo has been learned. If that bites, the natural
                                            home for it now is the availability picker, which is where swapping happens. */}
                                        {/* ── AVAILABILITY CONTROL SITS ABOVE THE KIT ──
                                            It used to render after the kit panel, so on a kit card it
                                            was pushed below six component rows and a search box — a
                                            control about THIS card, parked underneath the card's
                                            contents, in a different place on every card depending on
                                            how many components the kit had. Above the kit it sits at a
                                            fixed spot right under the item line on every card, kit or
                                            not, which is where Build puts it too. */}
                                        {(()=>{
                                          // Always show the card's sub-category options — computed live from current inventory
                                          // so it works even on cached cards (no regenerate needed) and can never be blank when
                                          // the sub-category has items. The card's true sub-category comes from its live matched
                                          // IMS item — never from Rate Card (a separate, older vocabulary that doesn't track
                                          // IMS's live Sub-Categories master).
                                          const cardAlts = Array.isArray(card.alternatives) ? card.alternatives : [];
                                          const inferredSub = item ? imsField.subcategory(item)
                                            : (cardAlts.map(a => dcInventoryCache.find(x => x.id === a.imsId)).find(Boolean) ? imsField.subcategory(cardAlts.map(a => dcInventoryCache.find(x => x.id === a.imsId)).find(Boolean)) : "");
                                          // zoneCardsRaw, not the kit-sorted copy: this is a fallback
                                          // sub-category hint taken from "the zone's first card", and
                                          // reordering for layout must not change which card that is.
                                          const subToUse = inferredSub || (zoneCardsRaw[0]?.subcategory || "");
                                          const allSubItems = subToUse ? dcInventoryCache.filter(x => String(imsField.subcategory(x)||"").toLowerCase().trim() === String(subToUse).toLowerCase().trim()) : [];
                                          const seenIds = new Set();
                                          const mergedAlts = [];
                                          for (const alt of cardAlts) { if (alt && alt.imsId && !seenIds.has(alt.imsId)) { seenIds.add(alt.imsId); mergedAlts.push(alt); } }
                                          for (const itm of allSubItems) { if (!seenIds.has(itm.id)) { seenIds.add(itm.id); mergedAlts.push({imsId: itm.id, name: itm.name}); } }
                                          if (mergedAlts.length === 0) return null;
                                          const subTotal = allSubItems.length;
                                          // ── THE SAME AVAILABILITY CONTROL BUILD HAS ──
                                          // This was a bespoke "N alternatives" toggle opening an inline strip of 82px
                                          // thumbnails. Build already answers this exact question — what else is in this
                                          // sub-category, how much of each is free on this date, which are on someone's
                                          // hold — through openAvailModal, and it answers it better: free counts,
                                          // dimensions, holds and the split option in one list, instead of ten tiles you
                                          // hover one at a time. Same call Build's IconBox control makes, so the two
                                          // screens open the same picker and cannot drift apart.
                                          // onPick is REQUIRED here: without it saveAvailPick writes the choice into
                                          // Build's zoneElements, which is the wrong state for a Deal Check card.
                                          // priceMode is left default so the list prices at RENTAL — Deal Check rents,
                                          // unlike CustomItemModal which asks the same picker for production cost.
                                          const availEl = { invId: card.imsId || null, imsId: card.imsId || null, name: item?.name || card.rcName || "" };
                                          // Icon only. The picker's own header names the sub-category and what it is for, so a
                                          // word here was labelling a control the user is about to see labelled again — and this
                                          // row sits under an item name and a price line that matter more. title + aria-label
                                          // carry the meaning for hover and for a screen reader, which a bare glyph otherwise loses.
                                          // "Browse all N in <sub>" sat beside it and opened a second, weaker list of the same
                                          // sub-category — no free counts, no holds. The picker answers that question properly,
                                          // so the button is gone rather than left as a worse route to the same place.
                                          return (
                                          <div style={{marginTop:7,display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
                                            <button type="button" className="dci-btn"
                                              onClick={()=>openAvailModal?.(zk, 0, availEl, null, (pick)=>{
                                                if (!pick) return;
                                                setDcCards(prev => ({ ...prev, [fnIdx]: { ...(prev[fnIdx] || {}),
                                                  [card._cardKey]: { ...(prev[fnIdx]?.[card._cardKey] || {}), imsId: pick.id, imsName: pick.name || "", source: "manual-swap" } } }));
                                              }, {
                                                // Pratik's Split, now offered here too. The picker cannot read this qty from
                                                // zoneElements — a Deal Check card keeps its own — so it is declared, and the
                                                // allocation is committed to card.split, the same field the card's own
                                                // "✂️ Split ×N across items" editor writes and prices from.
                                                pickHint: (Number(card.qty) || 0) >= 2
                                                  ? "Pick one item to swap this card to — or Split to divide its qty across 2 or more."
                                                  : "Pick an item to swap this card to.",
                                                splitQty: Number(card.qty) || 0,
                                                onSplit: (alloc) => setDcCards(prev => ({ ...prev, [fnIdx]: { ...(prev[fnIdx] || {}),
                                                  [card._cardKey]: { ...(prev[fnIdx]?.[card._cardKey] || {}),
                                                    split: alloc.map(a => ({ imsId: a.imsId, qty: a.qty })),
                                                    source: "manual-swap" } } })),
                                              })}
                                              title={`Check stock availability & pick an item${subToUse ? ` — ${subTotal} in ${subToUse}` : ""}`}
                                              aria-label="Check stock availability and pick an item"
                                              style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:28,height:28,borderRadius:7,
                                                border:`1px solid ${IV.border}`,background:IV.tile,color:IV.ink2,cursor:"pointer",padding:0}}>
                                              <IconBox size={13}/>
                                            </button>
                                          </div>
                                          );
                                        })()}
                                        {/* ═══ Paint Allocation Ops handoff — show salesperson's colour request ═══ */}
                                        {(()=>{
                                          const cardSpec = parseCardKey(card._cardKey);
                                          if (!cardSpec || cardSpec.kind !== "el") return null;
                                          const fnEls = fns[fnIdx]?.zoneElements?.[cardSpec.zoneKey];
                                          const origEl = fnEls ? fnEls.find(e => (e?.name||"").toLowerCase().trim() === (cardSpec.rcName||"").toLowerCase().trim()) || fnEls[cardSpec.idx] : null;
                                          if (!origEl) return null;
                                          const baseCol = item?.baseColour || "Ivory";
                                          const allocs = normalizePaintAllocation(origEl, baseCol);
                                          if (allocs.length === 0) return null;
                                          const allocLabel = allocs.map(a => `${a.colour} ×${a.qty}`).join(", ");
                                          const itemPaintCost = Number(item?.paintCost || 0);
                                          const isNonPaintable = item && itemPaintCost <= 0;
                                          return (
                                            <div style={{marginBottom:5}}>
                                              <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                                                <span style={{fontSize:12,padding:"2px 7px",borderRadius:5,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:700}}>🖌 {allocLabel}</span>
                                                <span style={{fontSize:11,color:"#BE1D62",fontWeight:600}}>salesperson requested</span>
                                              </div>
                                              {isNonPaintable && (
                                                <div style={{marginTop:4,padding:"5px 8px",borderRadius:6,background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)"}}>
                                                  <div style={{fontSize:12,color:"#EF4444",fontWeight:700}}>⚠ This item cannot be repainted</div>
                                                  <div style={{fontSize:11,color:IV.red,lineHeight:1.5,marginTop:2}}>
                                                    {(()=>{
                                                      const sub = item ? (imsField.subcategory(item)||"") : "";
                                                      if (!sub) return "No paintable alternatives found in this subcategory.";
                                                      const paintableAlts = (dcInventoryCache||[]).filter(x =>
                                                        String(imsField.subcategory(x)||"").toLowerCase().trim() === sub.toLowerCase().trim()
                                                        && Number(x.paintCost||0) > 0
                                                        && x.id !== item.id
                                                      );
                                                      if (paintableAlts.length === 0) return "No paintable alternatives found in " + sub + ".";
                                                      return "Try: " + paintableAlts.slice(0,3).map(a => a.name).join(", ") + (paintableAlts.length > 3 ? ` (+${paintableAlts.length-3} more)` : "");
                                                    })()}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {/* ═══ SPLIT across multiple items (8 = 6+2) ═══ */}
                                        {card.imsId && (()=>{
                                          const cQty = Number(card.qty)||1;
                                          const split = Array.isArray(card.split) ? card.split.filter(s=>s&&s.imsId) : [];
                                          const setSplit = (next)=> setDcCards(prev=>({...prev,[fnIdx]:{...(prev[fnIdx]||{}),[card._cardKey]:{...(prev[fnIdx]?.[card._cardKey]||{}),split:(Array.isArray(next)&&next.length)?next:undefined}}}));
                                          // Live IMS sub-category only — never Rate Card (see the sub-category note above).
                                          const subS = item ? imsField.subcategory(item) : "";
                                          const subItems = subS ? dcInventoryCache.filter(x=>String(imsField.subcategory(x)||"").toLowerCase().trim()===String(subS).toLowerCase().trim()) : [];
                                          // ── NO SPLIT YET: NOTHING TO SHOW ──
                                          // This used to be the "✂️ Split ×N across items" link that STARTED a split.
                                          // The availability picker now does that (Pratik's Split, wired through
                                          // opts.splitQty/onSplit), and it does it better: it divides across items you
                                          // pick with their free counts and holds in front of you, rather than seeding a
                                          // one-line editor you then fill in blind. Two entry points to one field would
                                          // also be two places to keep in step.
                                          // The editor BELOW stays: once a split exists it is the only thing that shows
                                          // what the qty was divided into, and the only way to adjust or undo it.
                                          if (!split.length) return null;
                                          const allocated = split.reduce((s,x)=>s+(Number(x.qty)||0),0);
                                          const rem = cQty - allocated;
                                          return (
                                            <div style={{marginTop:6,padding:"8px 10px",borderRadius:8,background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.25)"}}>
                                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                                                <span style={{fontSize:12,fontWeight:700,color:"#34D399"}}>✂️ Split ×{cQty} across items</span>
                                                <span onClick={()=>setSplit(undefined)} style={{fontSize:11,color:IV.ink,cursor:"pointer",textDecoration:"underline"}}>use single item</span>
                                              </div>
                                              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                                {split.map((s,si)=>{
                                                  const it2 = dcInventoryCache.find(x=>x.id===s.imsId);
                                                  const owned = it2?imsField.qtyOwned(it2):0;
                                                  const q = Number(s.qty)||0; const over = q>owned;
                                                  const upd=(patch)=>setSplit(split.map((x,i)=>i===si?{...x,...patch}:x));
                                                  return (
                                                    <div key={si} style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}>
                                                      {(()=>{const p=it2?imsField.photos(it2)[0]:null; return p?<img loading="lazy" decoding="async" src={thumbUrl(p, 24)} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover",flexShrink:0}}/>:<span style={{width:20,height:20,borderRadius:4,background:"rgba(26, 26, 46,0.06)",flexShrink:0,display:"inline-block"}}/>;})()}
                                                      <select value={s.imsId} onChange={e=>upd({imsId:e.target.value})} style={{flex:1,minWidth:0,fontSize:12,padding:"3px 6px",borderRadius:5,border:`1px solid ${border}`,background:"#FFFFFF",color:IV.ink}}>
                                                        {subItems.map(x=><option key={x.id} value={x.id}>{x.name} ({imsField.qtyOwned(x)})</option>)}
                                                        {!subItems.some(x=>x.id===s.imsId) && it2 && <option value={s.imsId}>{it2.name}</option>}
                                                      </select>
                                                      <input type="number" min="0" value={q} onChange={e=>upd({qty:Math.max(0,parseInt(e.target.value)||0)})} style={{width:46,fontSize:13,padding:"3px 4px",borderRadius:5,border:`1px solid ${over?"#EF4444":border}`,background:"transparent",color:over?"#EF4444":"#1A1A2E",textAlign:"center"}}/>
                                                      <span style={{color:over?"#EF4444":"#10B981",fontSize:11,whiteSpace:"nowrap"}}>{owned} avail</span>
                                                      {split.length>1 && <span onClick={()=>setSplit(split.filter((_,i)=>i!==si))} style={{color:"#EF4444",cursor:"pointer",fontSize:14,padding:"0 2px"}}>×</span>}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              <div style={{marginTop:5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                                <span onClick={()=>setDcBrowseAllOpen({fnIdx, cardKey: card._cardKey, subcategory: subS, splitAdd: true, splitQty: Math.max(0, rem)})} style={{fontSize:11,color:accent,fontWeight:600,cursor:"pointer",textDecoration:"underline"}}>+ add item</span>
                                                <span style={{fontSize:11,fontWeight:600,color:rem===0?"#10B981":(rem>0?"#F59E0B":"#EF4444")}}>{rem===0?`✓ allocated ${cQty}`:rem>0?`${rem} unallocated`:`over by ${-rem}`}</span>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      {/* Right-aligned line total (split-aware: sum of split lines, else single item × qty). */}
                                      {card.imsId && (()=>{
                                        const splitArr = Array.isArray(card.split) ? card.split.filter(s=>s&&s.imsId&&(Number(s.qty)||0)>0) : [];
                                        const tot = splitArr.length
                                          ? splitArr.reduce((s,x)=>{ const it3=dcInventoryCache.find(y=>y.id===x.imsId); return s+(it3?imsField.rentalCost(it3):0)*(Number(x.qty)||0); },0)
                                          : (item ? rental * (Number(card.qty) || 1) : 0);
                                        if (tot <= 0) return null;
                                        // alignSelf flex-start, not center: at half width the card grows tall
                                        // when the alternatives strip or the split editor opens, and a centred
                                        // figure drifted into the middle of all that while the item name it
                                        // belongs to stayed at the top.
                                        return (
                                          <div style={{flexShrink:0,alignSelf:"flex-start",textAlign:"right",minWidth:74}}>
                                            <div style={{...NUM,fontSize:15.5,fontWeight:700,color:IV.ink}}>₹{tot.toLocaleString("en-IN")}</div>
                                            <div style={{fontSize:11,color:IV.ink3,marginTop:1,letterSpacing:0.4,textTransform:"uppercase",fontWeight:600}}>rental{splitArr.length?" · split":""}</div>
                                          </div>
                                        );
                                      })()}
                                       {/* ── THE KIT IS A CARD-WIDTH ROW, NOT A TEXT-COLUMN ONE ──
                                           It used to live inside the middle column, which is one of THREE
                                           flex children (thumbnail · text · price). So it began past the
                                           54px thumb and stopped short of the price column — the densest
                                           thing on the card, squeezed into the narrowest part of it, and no
                                           negative margin could fix the right-hand side because the price
                                           column is content-sized and its width is not knowable here.
                                           Moved out to be the card's own last child with flexWrap on the
                                           card and width:100% here, it spans the full card, edge to edge,
                                           with no magic numbers to drift. */}
                                        {/* §7.9.5 — Kit composite: expand to components, per-deal editable */}
                                        {item && Array.isArray(item.subItems) && item.subItems.length > 0 && (()=>{
                                          const editKey = card._cardKey;
                                          const editedSub = dcKitEdits[fnIdx]?.[editKey];
                                          const comps = Array.isArray(editedSub) ? editedSub : item.subItems.map(s=>({itemId:s.itemId, qty:Number(s.qty)||1}));
                                          const isEdited = Array.isArray(editedSub);
                                          const cardQty = Number(card.qty)||1;
                                          const setComps = (next)=> setDcKitEdits(prev=>({...prev,[fnIdx]:{...(prev[fnIdx]||{}),[editKey]: next}}));
                                          const resetKit = ()=> setDcKitEdits(prev=>{ const fnE={...(prev[fnIdx]||{})}; delete fnE[editKey]; return {...prev,[fnIdx]:fnE}; });
                                          const kitBase = Number(item.kitBase) || 0;  // kit's own charge, added on top of parts
                                          const partsTotal = comps.reduce((s,c)=>{ const ci=dcInventoryCache.find(x=>x.id===c.itemId); return s + (ci?imsField.rentalCost(ci):0)*(Number(c.qty)||0); },0);
                                          const kitTotal = kitBase + partsTotal;
                                          return (
                                            /* ── FULL CARD WIDTH, NOT TEXT-COLUMN WIDTH ──
                                                The kit lives inside the card's text column, which starts
                                                past the 54px thumbnail and the card's 11px gap — so it was
                                                inset 65px from the left while being the widest, densest
                                                thing on the card. Six component rows each carrying a name,
                                                a stepper and three figures need every pixel. marginLeft:-65
                                                pulls it back to the card's own content edge (thumb 54 + gap
                                                11); if either of those changes, this number changes with
                                                them. */
                                            <div style={{width:"100%",marginTop:2,padding:"9px 11px",borderRadius:9,background:"rgba(99,102,241,0.05)",border:"1px solid rgba(99,102,241,0.25)"}}>
                                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                                                <span style={{fontSize:12,fontWeight:700,color:"#4338CA",letterSpacing:0.3}}>📦 Kit — blocks these together:{isEdited && <span style={{color:"#F59E0B",marginLeft:5}}>· edited</span>}</span>
                                                {isEdited && <span onClick={resetKit} style={{fontSize:11,color:IV.ink,cursor:"pointer",textDecoration:"underline"}}>reset to default</span>}
                                              </div>
                                              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                                {/* ── RESOLVED COMPONENTS FIRST, BROKEN ONES LAST ──
                                                    A component whose itemId is no longer in IMS renders as
                                                    "⚠ <id> not in IMS" with no photo, no price and no stock —
                                                    a dead row in the middle of a costed list. Sorted to the
                                                    bottom, the kit reads as its real contents first and its
                                                    problems after.
                                                    Note the pairing with the ORIGINAL index: every control in
                                                    this row (the − / + steppers, the swap, the remove) mutates
                                                    comps BY INDEX via `i===ci`. Sorting the array itself would
                                                    leave those indices pointing at whatever now sits in that
                                                    slot, so a stepper would silently edit a different
                                                    component. Only the display order changes; ci is always the
                                                    position in the real array. */}
                                                {comps.map((c,ci)=>({c,ci}))
                                                  .sort((a,b)=>{
                                                    const live = (x)=> dcInventoryCache.find(y=>y.id===x.c.itemId) ? 0 : 1;
                                                    return live(a) - live(b);
                                                  })
                                                  .map(({c,ci})=>{
                                                  const cItem = dcInventoryCache.find(x=>x.id===c.itemId);
                                                  const qtyEach = Number(c.qty)||0;
                                                  const needed = qtyEach * cardQty;
                                                  const owned = cItem ? imsField.qtyOwned(cItem) : 0;
                                                  const short = cItem && needed > owned;
                                                  const unavailable = !cItem || short;
                                                  // Same-subcategory alternatives with enough stock (for a short/missing component → one-tap swap).
                                                  const cSub = cItem ? String(imsField.subcategory(cItem)||"") : "";
                                                  const compAlts = unavailable && cSub ? dcInventoryCache.filter(x => x.id !== c.itemId && String(imsField.subcategory(x)||"").toLowerCase().trim() === cSub.toLowerCase().trim()).sort((a,b)=>imsField.qtyOwned(b)-imsField.qtyOwned(a)) : [];
                                                  const compAltsFit = compAlts.filter(x => imsField.qtyOwned(x) >= needed);
                                                  const swapComp = (id)=> setComps(comps.map((x,i)=>i===ci?{...x,itemId:id}:x));
                                                  return (
                                                    <div key={ci} style={unavailable?{padding:"3px 5px",borderRadius:6,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)"}:null}>
                                                    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}>
                                                      {(() => { const cp = cItem ? imsField.photos(cItem)[0] : null; return cp ? <HoverZoom src={thumbUrl(cp, 320)}><img loading="lazy" decoding="async" src={thumbUrl(cp, 48)} alt="" style={{width:22,height:22,borderRadius:4,objectFit:"cover",flexShrink:0}} /></HoverZoom> : <span style={{width:22,height:22,borderRadius:4,background:"rgba(26, 26, 46,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🌸</span>; })()}
                                                      <span style={{color:cItem?(short?"#EF4444":"#1A1A2E"):"#EF4444",fontWeight:600,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cItem?cItem.name:`⚠ ${c.itemId} not in IMS`}</span>
                                                      <div style={{display:"flex",alignItems:"center",gap:2}} title="per kit">
                                                        <span onClick={()=>setComps(comps.map((x,i)=>i===ci?{...x,qty:Math.max(1,qtyEach-1)}:x))} style={{cursor:"pointer",color:IV.ink,fontSize:15.5,padding:"0 4px",userSelect:"none"}}>−</span>
                                                        <span style={{color:IV.ink,minWidth:20,textAlign:"center"}}>×{qtyEach}</span>
                                                        <span onClick={()=>setComps(comps.map((x,i)=>i===ci?{...x,qty:qtyEach+1}:x))} style={{cursor:"pointer",color:IV.ink,fontSize:15.5,padding:"0 4px",userSelect:"none"}}>+</span>
                                                      </div>
                                                      <span onClick={()=>setComps(comps.filter((_,i)=>i!==ci))} style={{color:"#EF4444",cursor:"pointer",fontSize:15.5,padding:"0 2px",flexShrink:0}} title="Remove component">×</span>
                                                    </div>
                                                    {/* ── THE ARITHMETIC GOES ON ITS OWN LINE ──
                                                        Thumb, name, stepper, "× 8 kits = 8", "₹200 × 8 = ₹1,600" and
                                                        "✓ 23 avail" were six things on ONE nowrap row. That fitted while
                                                        item cards were full width; at three-up the row is ~500px and the
                                                        run overflowed the card. Identity and the control people actually
                                                        press stay on line one; the sums — which are read, not clicked —
                                                        wrap underneath, indented to the name so they read as its detail. */}
                                                    {/* ── FIXED COLUMNS, NOT A FLOWING RUN ──
                                                        These three figures were laid out with a plain gap, so each one
                                                        started wherever the previous ended — and since component names
                                                        and prices differ in width, no two rows in the kit lined up.
                                                        Fixed minWidths make them read as columns down the block: how
                                                        many, what they cost, whether there is stock. Right-aligning the
                                                        availability pins it to the same edge as the ✕ above it. */}
                                                    <div style={{display:"flex",alignItems:"center",gap:8,paddingLeft:28,paddingRight:2,fontSize:11.5,marginTop:2,flexWrap:"wrap"}}>
                                                      <span style={{minWidth:74,color:IV.ink3,whiteSpace:"nowrap",...NUM}}>
                                                        {cardQty>1 ? <>× {cardQty} kits = <b style={{color:IV.ink}}>{needed}</b></> : <>× {needed}</>}
                                                      </span>
                                                      {cItem && (()=>{ const cr=imsField.rentalCost(cItem); return <span style={{...NUM,flex:"1 1 auto",minWidth:108,color:IV.ink3,whiteSpace:"nowrap"}}>₹{cr.toLocaleString("en-IN")} × {needed} = <b style={{color:"#4338CA"}}>₹{(cr*needed).toLocaleString("en-IN")}</b></span>; })()}
                                                      {cItem && (short
                                                        ? <span style={{color:"#EF4444",fontWeight:700,whiteSpace:"nowrap",textAlign:"right",...NUM}}>⚠ need {needed}, only {owned}</span>
                                                        : <span style={{color:"#10B981",whiteSpace:"nowrap",textAlign:"right",...NUM}}>✓ {owned} avail</span>)}
                                                    </div>
                                                    {unavailable && compAlts.length>0 && (
                                                      <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginTop:4,paddingLeft:28}}>
                                                        <span style={{fontSize:11,color:"#EF4444",fontWeight:600,whiteSpace:"nowrap"}}>↔ swap to:</span>
                                                        {(compAltsFit.length?compAltsFit:compAlts).slice(0,5).map(a=>{ const ao=imsField.qtyOwned(a); const fit=ao>=needed; return (
                                                          <span key={a.id} onClick={()=>swapComp(a.id)} title={`${a.name} · ${ao} available · ₹${imsField.rentalCost(a).toLocaleString("en-IN")}`} style={{cursor:"pointer",fontSize:11,padding:"2px 7px",borderRadius:8,border:`1px solid ${fit?"#10B981":border}`,background:fit?"rgba(16,185,129,0.12)":"transparent",color:fit?"#10B981":textS,whiteSpace:"nowrap"}}>{a.name} ({ao})</span>
                                                        ); })}
                                                      </div>
                                                    )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              <div style={{marginTop:5,position:"relative"}}>
                                                <input value={dcKitAddSearch[editKey]||""} onChange={e=>setDcKitAddSearch(prev=>({...prev,[editKey]:e.target.value}))} placeholder="🔍 Search by name or sub-category to add…" style={{width:"100%",fontSize:12,padding:"4px 8px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:IV.ink}} />
                                                {(dcKitAddSearch[editKey]||"").trim() && (()=>{
                                                  const tokens = dcKitAddSearch[editKey].trim().toLowerCase().split(/\s+/).filter(Boolean);
                                                  const matches = dcInventoryCache.filter(x=>x.id!==item.id && !comps.some(c=>c.itemId===x.id) && !isHiddenSubcat(x,rcSubcatFactors) && tokens.every(t=>(x.name+" "+(imsField.subcategory(x)||"")+" "+(x.cat||x.category||"")).toLowerCase().includes(t))).slice(0,40);
                                                  return (
                                                    <div style={{position:"absolute",zIndex:50,top:"100%",left:0,right:0,marginTop:2,background:"#F4F2EC",border:`1px solid ${border}`,borderRadius:8,maxHeight:220,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
                                                      {matches.length===0 && <div style={{padding:"6px 8px",fontSize:12,color:IV.ink}}>No matches</div>}
                                                      {matches.map(x=>{
                                                        const src = imsField.photos(x)[0];
                                                        const remaining = dcRemainingForItem(x.id, fnIdx, { cardKey: editKey });
                                                        const isBlocked = remaining != null && remaining <= 0;
                                                        return (
                                                          <div key={x.id} onClick={()=>{ if(isBlocked) return; setComps(comps.some(c=>c.itemId===x.id)?comps:[...comps,{itemId:x.id,qty:1}]); setDcKitAddSearch(prev=>({...prev,[editKey]:""})); }}
                                                            style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",cursor:isBlocked?"not-allowed":"pointer",borderBottom:`1px solid ${border}`,opacity:isBlocked?0.45:1}}>
                                                            <ItemHoverThumb src={src} size={22} rounded={4} name={x.name} sub={imsField.subcategory(x) ? imsField.subcategory(x)+" › "+(x.cat||x.category||"") : (x.cat||x.category||"")} dims={itemDimsText(x)} border={border} cardBg="#FFFFFF" textP="#1A1A2E" textS={textS} emptyBg="rgba(26, 26, 46,0.06)" />
                                                            <div style={{flex:1,minWidth:0}}>
                                                              <div style={{fontSize:13,color:IV.ink,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                                                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.name}</span>
                                                                {isBlocked && <span style={{fontSize:10,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700,flexShrink:0}}>🚫 fully used in this event</span>}
                                                                {!isBlocked && remaining!=null && <span style={{fontSize:10,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700,flexShrink:0}}>{remaining} left for this event</span>}
                                                              </div>
                                                              <div style={{fontSize:11,color:IV.ink}}>{imsField.subcategory(x) ? imsField.subcategory(x)+" › " : ""}{x.cat||x.category||""}{itemDimsText(x) ? ` · 📐 ${itemDimsText(x)}` : ""}</div>
                                                            </div>
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  );
                                                })()}
                                              </div>
                                              {/* The working was one long sentence sharing a line with the
                                                  total, so in a three-up card it wrapped and stranded "× 8"
                                                  on a line of its own under the money. Total on its own line,
                                                  working underneath it as a caption — same figures, but the
                                                  number the card is about no longer competes with its recipe. */}
                                              <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid rgba(99,102,241,0.2)"}}>
                                                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8}}>
                                                  <span style={{fontSize:10,fontWeight:700,color:IV.ink2,letterSpacing:0.7,textTransform:"uppercase",whiteSpace:"nowrap"}}>Kit rental</span>
                                                  <span style={{fontSize:13.5,color:"#4338CA",fontWeight:750,letterSpacing:-0.3,whiteSpace:"nowrap",...NUM}}>₹{(kitTotal*cardQty).toLocaleString("en-IN")}</span>
                                                </div>
                                                <div style={{fontSize:10.5,color:IV.ink3,marginTop:2,...NUM}}>
                                                  {kitBase>0?`console ₹${kitBase.toLocaleString("en-IN")} + `:""}add-ons ₹{partsTotal.toLocaleString("en-IN")} = ₹{kitTotal.toLocaleString("en-IN")}{cardQty>1?` × ${cardQty}`:""}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                    </div>
                                  );
                                })}
                                {/* ═══ MANUAL BLOCKS — zone-scoped manual inventory adds ═══ */}
                                {manualItemsInZone.map(mi => {
                                  const item = dealCheckInventory.find(i => i.id === mi.imsId);
                                  const photo = item ? imsField.photos(item)[0] : null;
                                  // Same figure the rollup charges, so the row cannot show one price
                                  // while the total is built from another.
                                  const rental = item ? effKitRental(item, activeFnIdx, null) : 0;
                                  const dims = item ? imsField.sizeText(item) : "";
                                  const sub = item ? imsField.subcategory(item) : "";
                                  // Hard cap: you can't block more than is available at this venue.
                                  const _vName = (fns[fnIdx] || {}).fnVenue || "";
                                  const _avail = item ? Math.max(0, Math.min(getStudioAvailable(item, fnBlocksForChip), availableAtVenue({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, _vName, item))) : 0;
                                  return (
                                    <div key={mi.manualId} className="dci-card" style={{padding:"12px 13px",borderRadius:10,boxShadow:IV.shadow,background:IV.card,border:`1px solid rgba(193,154,107,0.30)`,display:"flex",gap:11,alignItems:"flex-start"}}>
                                      {photo ? <HoverZoom src={thumbUrl(photo, 320)}><img loading="lazy" decoding="async" src={thumbUrl(photo, 56)} alt="" style={{width:54,height:54,borderRadius:7,objectFit:"cover",flexShrink:0,background:"#FFFFFF"}}/></HoverZoom> : <div style={{width:54,height:54,borderRadius:7,background:"#FFFFFF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:IV.ink,flexShrink:0}}>?</div>}
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:3}}>
                                          <span style={{fontSize:14,fontWeight:700,letterSpacing:-0.1,color:IV.ink}}>{item?.name || mi.imsId}</span>
                                          <span style={{fontSize:11,padding:"2px 6px",borderRadius:4,background:"rgba(193,154,107,0.22)",color:"#C19A6B",fontWeight:700,letterSpacing:0.4}}>✋ MANUAL</span>
                                          {sub && <span style={{fontSize:11,color:IV.ink}}>· {sub}</span>}
                                        </div>
                                        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,lineHeight:1.5,color:IV.ink2,flexWrap:"wrap"}}>
                                          <span>Qty:</span>
                                          <input type="number" min="1" max={_avail || undefined} value={mi.qty} onChange={e=>{
                                            const raw = Math.max(1, Number(e.target.value)||1);
                                            const v = _avail > 0 ? Math.min(raw, _avail) : raw;
                                            if (raw > v) showMsg && showMsg(`Only ${_avail} available — capped at ${_avail}`, "orange");
                                            setDcManualItems(prev => prev.map(x => x.manualId === mi.manualId ? {...x, qty: v} : x));
                                          }} style={{width:60,padding:"3px 6px",borderRadius:4,border:`1px solid ${mi.qty>=_avail&&_avail>0?"#F59E0B":border}`,background:"rgba(26, 26, 46,0.04)",color:IV.ink,fontSize:13}}/>
                                          <span style={{...NUM,color:IV.ink2}}>of {_avail} avail · ₹{rental.toLocaleString("en-IN")} × {mi.qty} = ₹{(rental*mi.qty).toLocaleString("en-IN")}</span>
                                          {dims && <span style={{color:IV.ink3}}>· {dims}</span>}
                                        </div>
                                        {/* Same-subcategory alternatives + Browse (with per-item availability) — swap a manual block to another item */}
                                        {sub && (()=>{
                                          const mAlts = dcInventoryCache.filter(x => x.id !== mi.imsId && String(imsField.subcategory(x)||"").toLowerCase().trim() === sub.toLowerCase().trim());
                                          if (!mAlts.length) return null;
                                          const _fvC = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                                          const altAvail = (a) => Math.max(0, Math.min(getStudioAvailable(a, fnBlocksForChip), availableAtVenue(_fvC, _vName, a)));
                                          return (
                                            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:6}}>
                                              <span style={{fontSize:11,color:IV.ink,letterSpacing:0.6,textTransform:"uppercase",fontWeight:600}}>Alternatives:</span>
                                              {mAlts.slice(0,5).map(a=>{ const ao=altAvail(a); const ap=imsField.photos(a)[0]; return (
                                                <span key={a.id} onClick={()=>setDcManualItems(prev=>prev.map(x=>x.manualId===mi.manualId?{...x,imsId:a.id}:x))} title={`${a.name} · ${ao} free`} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",padding:"2px 7px 2px 3px",borderRadius:12,border:`1px solid ${border}`,background:"rgba(26, 26, 46,0.03)",fontSize:11}}>
                                                  {ap?<img loading="lazy" decoding="async" src={thumbUrl(ap, 20)} alt="" style={{width:16,height:16,borderRadius:4,objectFit:"cover"}}/>:<span style={{width:16,height:16,borderRadius:4,background:"rgba(26, 26, 46,0.06)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11}}>?</span>}
                                                  <span style={{color:IV.ink,maxWidth:82,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                                                  <span style={{color:ao>0?"#10B981":"#EF4444",fontWeight:800}}>{ao}</span>
                                                </span>
                                              );})}
                                              <button onClick={()=>setDcBrowseAllOpen({fnIdx, manualId: mi.manualId, subcategory: sub})} style={{padding:"3px 8px",borderRadius:6,border:`1px dashed ${border}`,background:"transparent",color:accent,fontSize:11,fontWeight:600,cursor:"pointer",letterSpacing:0.3,whiteSpace:"nowrap"}}>Browse all {mAlts.length+1} in {sub} ↗</button>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      <button onClick={()=>setDcManualItems(prev => prev.filter(x => x.manualId !== mi.manualId))} title="Remove manual block" style={{background:"transparent",border:"none",color:"#EF4444",cursor:"pointer",fontSize:18,padding:"0 4px",lineHeight:1}}>×</button>
                                    </div>
                                  );
                                })}
                                </div>
                                {/* ═══ MANUAL SEARCH INPUT — always visible at zone bottom ═══ */}
                                {(() => {
                                  const searchKey = `${fnIdx}|${zk}`;
                                  const searchText = dcManualSearch[searchKey] || "";
                                  const showResults = searchText.trim().length >= 2;
                                  const lcSearch = searchText.toLowerCase().trim();
                                  const matches = showResults
                                    ? dealCheckInventory.filter(i => {
                                        if (isHiddenSubcat(i, rcSubcatFactors)) return false;
                                        const n = String(i?.name || "").toLowerCase();
                                        const s = String(imsField.subcategory(i) || "").toLowerCase();
                                        return n.includes(lcSearch) || s.includes(lcSearch);
                                      }).slice(0, 10)
                                    : [];
                                  return (
                                    <div style={{marginTop:6,position:"relative"}}>
                                      <input
                                        type="text"
                                        placeholder="🔍 Search inventory to add manually (type 2+ letters)…"
                                        value={searchText}
                                        onChange={e=>setDcManualSearch(prev => ({...prev, [searchKey]: e.target.value}))}
                                        style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1px dashed ${border}`,background:"rgba(193,154,107,0.04)",color:"#1A1A2E",fontSize:13,outline:"none",boxSizing:"border-box"}}
                                      />
                                      {showResults && matches.length === 0 && (
                                        <div style={{marginTop:6,padding:"10px 12px",fontSize:13,color:"#1A1A2E",fontStyle:"italic",textAlign:"center",borderRadius:7,background:"rgba(26, 26, 46,0.02)"}}>No matches in IMS for "{searchText}"</div>
                                      )}
                                      {showResults && matches.length > 0 && (
                                        <div style={{marginTop:6,borderRadius:8,border:`1px solid ${border}`,background:"rgba(15,15,26,0.95)",maxHeight:280,overflowY:"auto"}}>
                                          {matches.map(item => {
                                            const itemPhoto = imsField.photos(item)[0];
                                            const itemSub = imsField.subcategory(item);
                                            const _venueName = (fns[fnIdx] || {}).fnVenue || "";
                                            const _fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                                            const itemQty = availableAtVenue(_fvCfg, _venueName, item); // venue-scoped total (locked stock at other venues excluded)
                                            const itemBlocked = Number(item?.blocked) || 0;
                                            const free = Math.max(0, itemQty - itemBlocked);
                                            const usedElsewhereInDeal = qtyUsedElsewhereInDealCheck(item.id, fns, dcCards, dcManualItems, dcKitEdits, dcInventoryCache, { fnIdx, zoneKey: zk }, (fns[fnIdx]||{}).fnDate || clientDate);
                                            const remaining = Math.max(0, free - usedElsewhereInDeal);
                                            const isBlocked = usedElsewhereInDeal > 0 && remaining <= 0;
                                            const _standing = isStandingAt(_fvCfg, _venueName, item.id);
                                            const _dims = item?.dims_LxWxH || item?.size || item?.dims?.lxwxh || item?.dims?.size || "";
                                            return (
                                              <div key={item.id} onClick={()=>{
                                                if (isBlocked) return;
                                                const newItem = {
                                                  manualId: `m-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
                                                  imsId: item.id,
                                                  qty: 1,
                                                  note: "",
                                                  fnIdx,
                                                  zoneKey: zk,
                                                };
                                                setDcManualItems(prev => [...prev, newItem]);
                                                setDcManualSearch(prev => ({...prev, [searchKey]: ""}));
                                              }} style={{display:"flex",gap:10,padding:"8px 10px",alignItems:"center",cursor:isBlocked?"not-allowed":"pointer",borderBottom:`1px solid rgba(26, 26, 46,0.04)`,opacity:isBlocked?0.45:1}}
                                              onMouseEnter={e=>{ if(!isBlocked) e.currentTarget.style.background="rgba(193,154,107,0.10)"; }}
                                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                                <ItemHoverThumb src={itemPhoto} size={36} rounded={5} name={item.name} sub={itemSub} dims={_dims} border="rgba(26, 26, 46,0.15)" cardBg="#FFFFFF" textP="#1a1a2e" textS={textS} emptyBg="#F4F2EC" placeholder="?" />
                                                <div style={{flex:1,minWidth:0}}>
                                                  <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}{_standing && <span style={{marginLeft:6,fontSize:10,padding:"1px 5px",borderRadius:3,background:"rgba(16,185,129,0.2)",color:"#10B981",fontWeight:700,letterSpacing:0.3}}>🏛️ INSTALLED HERE</span>}{isBlocked && <span style={{marginLeft:6,fontSize:10,padding:"1px 5px",borderRadius:3,background:"rgba(239,68,68,0.2)",color:"#EF4444",fontWeight:700,letterSpacing:0.3}}>🚫 fully used in this event</span>}</div>
                                                  <div style={{fontSize:11,color:"#1A1A2E",marginTop:1}}>{itemSub || "—"}{_dims ? ` · 📐 ${_dims}` : ""} · {free} free of {itemQty}{usedElsewhereInDeal>0 ? ` · ${remaining} left for this event` : ""}</div>
                                                </div>
                                                <span style={{fontSize:12,color:"#C19A6B",fontWeight:700,letterSpacing:0.3}}>+ ADD</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                                {/* §26.13 — Production/Buying custom items in this zone */}
                                {dcCustomItems.filter(ci => ci.fnIdx === fnIdx && ci.zoneKey === zk).map(ci => {
                                  const isP = ci.type === "production";
                                  const ciColor = isP ? "#A855F7" : "#F59E0B";
                                  const ciIcon = isP ? "🏭" : "🛒";
                                  const refItem = ci.refItemId ? (dcInventoryCache || []).find(x => x.id === ci.refItemId) : null;
                                  const refPhoto = refItem ? imsField.photos(refItem)[0] : null;
                                  const ciZonePhoto = elSelectedPhoto[ci.zoneKey]?.src || null;
                                  const photo = ci.photo || ciZonePhoto || refPhoto || null;
                                  const unitCost = ci.manualPrice || ci.refPrice || 0;
                                  return (
                                    <div key={ci.id} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${ciColor}40`,background:`${ciColor}08`,display:"flex",gap:10,alignItems:"center"}}>
                                      {photo ? <img loading="lazy" decoding="async" src={thumbUrl(photo, 56)} alt="" style={{width:44,height:44,borderRadius:6,objectFit:"cover"}} /> : <div style={{width:44,height:44,borderRadius:6,background:`${ciColor}15`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{ciIcon}</div>}
                                      <div style={{flex:1,minWidth:0}}>
                                        <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E"}}>{ciIcon} {ci.subCat} <span style={{fontSize:11,padding:"1px 5px",borderRadius:4,background:`${ciColor}20`,color:ciColor,fontWeight:700,marginLeft:4}}>{isP?"PRODUCTION":"BUYING"}</span></div>
                                        <div style={{fontSize:11,color:"#1A1A2E",marginTop:2}}>× {ci.qty} · {ci.dims.w||"?"}W × {ci.dims.l||"?"}D × {ci.dims.h||"?"}H ft{ci.notes?` · ${ci.notes}`:""}</div>
                                      </div>
                                      <div style={{textAlign:"right"}}>
                                        <div style={{fontSize:13.5,fontWeight:700,color:ciColor}}>₹{Math.round(unitCost * ci.qty).toLocaleString("en-IN")}</div>
                                        <div style={{fontSize:11,color:"#1A1A2E"}}>₹{Math.round(unitCost).toLocaleString("en-IN")} × {ci.qty}</div>
                                      </div>
                                      <button onClick={()=>setDcCustomItems(prev=>prev.filter(x=>x.id!==ci.id))} style={{padding:"4px 6px",borderRadius:4,border:"none",background:"rgba(239,68,68,0.12)",color:"#EF4444",fontSize:12,cursor:"pointer",fontWeight:700}}>✕</button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : dcActiveTab === "florals" ? (
                  <DCFloralsTab ctx={ctx} />
                ) : dcActiveTab === "manpower" ? (
                  <DCManpowerTab ctx={ctx} />
                ) : dcActiveTab === "truss" ? (
                  <DCTrussTab ctx={ctx} />
                ) : dcActiveTab === "transport" ? (() => {
                  // ═══ TRANSPORT TAB BODY ═══
                  // Four levels deep: function → department → sub-category → the actual items
                  // that filled the truck. The old layout expressed all four with indentation and
                  // right-aligned text alone, so three different magnitudes ("0.03 trucks",
                  // "6 pc · 0.03 trucks", "6 pc") stacked into one ragged column jammed against
                  // the page edge. Same data, same maths — the hierarchy is now carried by
                  // surface (card → tile → row) and the figures sit in fixed columns.
                  const allFns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (allFns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:INK_3,fontSize:13}}>No functions configured yet.</div>;
                  // Scoped to the selected function unless "All functions" is on — this used to
                  // always dump every function's trucks on screen no matter which one was selected.
                  const fns = dcShowAllFns ? allFns.map((fn,fi)=>({fn,fi})) : allFns.map((fn,fi)=>({fn,fi})).filter(x=>x.fi===(activeFnIdx||0));
                  const DEPT_TRANSPORT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
                  // Booking-level figures for the summary bar. Computed from the same
                  // calcFunctionBreakdown the cards above are drawn from, so the bar cannot
                  // disagree with the sum of what is on screen.
                  let sumCost = 0, sumTrucks = 0, fnsWithTrucks = 0;
                  const tierSeen = new Set();
                  fns.forEach(({fn}) => {
                    let b = null; try { b = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; } catch { /* ignore */ }
                    const t = b?.transport || null;
                    sumCost += Number(t?.truckTotal) || 0;
                    sumTrucks += Number(t?.trucks) || 0;
                    if ((Number(t?.trucks) || 0) > 0) fnsWithTrucks += 1;
                    if (t?.tierLabel) tierSeen.add(t.tierLabel);
                  });
                  // Fixed-width figure columns. Narrow enough to survive a third-width card,
                  // wide enough that "1.00 trucks" and "0.03 trucks" still land on the same
                  // right edge — which is the whole reason these are columns and not text.
                  const NUMCOL = { minWidth: 72, textAlign: "right", flexShrink: 0, ...NUM };
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{DC_CSS}</style>
                      {fns.map(({fn, fi}) => {
                        let bd = null; try { bd = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; } catch { /* ignore */ }
                        const tr = bd?.transport || null;
                        const truckTotal = Number(tr?.truckTotal) || 0;
                        const trucks = Number(tr?.trucks) || 0;
                        const rows = tr?.breakdown || [];
                        // Group the truck-capacity rows (one per sub-category, e.g. "Chandelier",
                        // "vedi", "Tenting Accessories") by department — the same Floral/Structure/
                        // Furniture/Lighting/... classifier every other dept-facing screen in this
                        // app already uses, so "vedi" lands in the same bucket here as it does in
                        // Dept Ops. The buffer row isn't tied to a real category, so it gets its own
                        // pseudo-group at the end rather than being forced into one.
                        const deptGroupsMap = {};
                        rows.forEach(r => {
                          const dg = r.isBuffer ? "Buffer" : sharedCatToDept(r.label, dealCheckData?.categoryDepartments);
                          (deptGroupsMap[dg] = deptGroupsMap[dg] || []).push(r);
                        });
                        const deptGroups = [...OPS_DEPTS, "Buffer"].filter(d => deptGroupsMap[d]?.length).map(d => ({ dept: d, rows: deptGroupsMap[d] }));
                        // Collapsible so "All functions" doesn't force scrolling past every other
                        // function's truck list to reach the one you actually want — expanded by
                        // default when one function is selected (nothing else to scroll past),
                        // collapsed by default under "All" (fi picks the true absolute index).
                        const blockKey = `transport:${fi}`;
                        const isOpen = dcCollapsedFnBlocks[blockKey] !== undefined ? dcCollapsedFnBlocks[blockKey] : !dcShowAllFns;
                        const toggleOpen = () => setDcCollapsedFnBlocks(prev => ({ ...prev, [blockKey]: !isOpen }));
                        return (
                          <div key={fi} className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                            {/* The same violet a ceremony day wears in the Manpower tab, so a
                                function reads as the same object across both screens. */}
                            <div aria-hidden="true" style={{width:4,flexShrink:0,background:trucks>0?"#6F63A8":"#D8D3E0"}} />
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div onClick={rows.length?toggleOpen:undefined} className={rows.length?"dc2-hd":undefined}
                                style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:(rows.length?isOpen:true)?`1px solid ${HAIRLINE}`:"none",cursor:rows.length?"pointer":"default"}}>
                                <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:"#EBE8F4"}}>🚚</span>
                                <div style={{flex:"1 1 auto",minWidth:0}}>
                                  <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.35,lineHeight:1.2}}>{fn?.fnType || `Function ${fi+1}`}</div>
                                  <div style={{fontSize:11.5,color:INK_3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...NUM}}>
                                    {fn?.fnDate || "—"} · {fn?.fnVenue || "—"}{fn?.fnShift ? ` · ${fn.fnShift}` : ""}
                                  </div>
                                </div>
                                {/* Tier is a property of how this function was priced, not a
                                    number — so it reads as a chip, not as more digits in the
                                    money column it used to be appended to. */}
                                {tr?.tierLabel && (
                                  <span style={{flexShrink:0,fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 9px",borderRadius:999,background:CHIP_BG,color:INK_2,whiteSpace:"nowrap"}}>{tr.tierLabel}</span>
                                )}
                                <div style={{textAlign:"right",flexShrink:0}}>
                                  <div style={{fontSize:17,fontWeight:750,color:truckTotal>0?INK:INK_3,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>
                                    {truckTotal > 0 ? `₹${Math.round(truckTotal).toLocaleString("en-IN")}` : "—"}
                                  </div>
                                  {trucks > 0 && <div style={{fontSize:11,color:INK_3,marginTop:2,...NUM}}>{trucks} truck{trucks===1?"":"s"}</div>}
                                </div>
                                {rows.length > 0 && <span aria-hidden="true" style={{fontSize:11,color:INK_3,flexShrink:0,display:"inline-block",transform:isOpen?"rotate(90deg)":"none",transition:"transform 0.16s ease"}}>▸</span>}
                              </div>
                              {/* ── NOTHING TO TRANSPORT IS NOT NOTHING TO SAY ──
                                  This tab scopes to the function selected in the sidebar, so picking
                                  a ceremony that carries no trucks used to leave a header with a dash
                                  and a blank page under it — indistinguishable from the tab being
                                  broken, which is exactly how it got reported.
                                  Deliberately NOT gated on isOpen: under "All functions" isOpen
                                  defaults to false, and a function with no rows renders no chevron
                                  and no click handler — so it can never be opened. Gating the empty
                                  state behind that collapse is how it stayed invisible in exactly
                                  the case it exists for. There is nothing to collapse anyway. */}
                              {deptGroups.length === 0 && (
                                <div style={{padding:"16px 15px",fontSize:12.5,color:INK_2}}>
                                  <div style={{fontWeight:600,marginBottom:3,color:INK}}>No transport for this function.</div>
                                  <div style={{fontSize:11.5,color:INK_3}}>
                                    Nothing in {fn?.fnType || "this function"} needs a truck yet.
                                    {!dcShowAllFns && <> Use <b>🗂️ All functions</b> in the sidebar to see the whole booking’s trucks.</>}
                                  </div>
                                </div>
                              )}
                              {/* Departments sit four-to-a-row rather than stacked full width.
                                  A dept group is a short list — often one sub-category — so at
                                  full width each one spent a whole screen line on two figures and
                                  left two thirds of the row empty. Three up puts a function's
                                  whole transport plan in one or two lines. */}
                              {isOpen && deptGroups.length > 0 && (
                                <div className="dc2-grid" style={{padding:"12px 15px 14px"}}>
                                  {deptGroups.map(({dept, rows: gRows}) => {
                                    const groupTrucks = gRows.reduce((s, r) => s + (Number(r.trucks) || 0), 0);
                                    const groupKey = `transport:${fi}:dept:${dept}`;
                                    // Open by default — the point of this grouping is to see at a glance
                                    // what each department needs, not to hide it behind another click.
                                    const groupOpen = dcCollapsedFnBlocks[groupKey] !== undefined ? dcCollapsedFnBlocks[groupKey] : true;
                                    const toggleGroup = () => setDcCollapsedFnBlocks(prev => ({ ...prev, [groupKey]: !groupOpen }));
                                    // Six identical ivory tiles are six things you have to READ to
                                    // tell apart. The department's hue goes on the card's left edge
                                    // and its icon square — the same two places a phase colours a
                                    // day card in Manpower — so the set becomes findable by colour.
                                    const da = deptAccent(dept);
                                    return (
                                      <div key={dept} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,overflow:"hidden",display:"flex"}}>
                                        <div aria-hidden="true" style={{width:3,flexShrink:0,background:da.stripe}} />
                                        <div style={{flex:"1 1 auto",minWidth:0}}>
                                        <div onClick={toggleGroup} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 11px",cursor:"pointer"}}>
                                          {/* Tinted rather than white, and a size up: at 26px on a
                                              white square the glyph was the only differentiator and
                                              it was too small to act as one. */}
                                          <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:29,height:29,borderRadius:9,flexShrink:0,fontSize:14,lineHeight:1,background:da.tile}}>
                                            {dept === "Buffer" ? "🧯" : (DEPT_TRANSPORT_ICON[dept] || "📦")}
                                          </span>
                                          <span style={{flex:"1 1 auto",minWidth:0,fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase"}}>{dept}</span>
                                          <span style={{...NUMCOL}}>
                                            <span style={{fontSize:11.5,fontWeight:650,color:INK_2,...NUM}}>{groupTrucks.toFixed(2)}</span>
                                            <span style={{fontSize:9.5,color:INK_3,marginLeft:3}}>truck{groupTrucks===1?"":"s"}</span>
                                          </span>
                                          <span aria-hidden="true" style={{fontSize:10,color:INK_3,flexShrink:0,display:"inline-block",transform:groupOpen?"rotate(90deg)":"none",transition:"transform 0.16s ease"}}>▸</span>
                                        </div>
                                        {groupOpen && (
                                          <div style={{padding:"0 11px 10px",display:"flex",flexDirection:"column",gap:7}}>
                                            {gRows.map((r, ri) => {
                                              // ── THE ITEM BREAKDOWN FOLDS AWAY ──
                                              // Every sub-category listed each zone line that filled it, so a
                                              // department with five sub-categories ran to twenty-odd rows —
                                              // and since grid rows stretch to the tallest card, one long
                                              // department left every short one beside it standing over a
                                              // screen of dead space. The figures people come here for are on
                                              // the sub-category line itself; the zone lines are the audit
                                              // trail behind them. Closed by default, one click away, and the
                                              // row says how many are hidden so nothing is a surprise.
                                              const itemsKey = `transport:${fi}:${dept}:${ri}`;
                                              const nItems = Array.isArray(r.items) ? r.items.length : 0;
                                              const itemsOpen = dcCollapsedFnBlocks[itemsKey] === true;
                                              const toggleItems = () => setDcCollapsedFnBlocks(prev => ({ ...prev, [itemsKey]: !itemsOpen }));
                                              return (
                                              <div key={ri} style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:9,padding:"8px 10px"}}>
                                                {/* ── THE SUB-CATEGORY LINE ──
                                                    Qty and trucks were one run-on string ("6 pc · 0.03
                                                    trucks") right-aligned, so neither figure sat at a
                                                    predictable x and no two rows could be compared.
                                                    Two fixed columns now: what is being moved, then how
                                                    much of a truck it fills. */}
                                                <div onClick={nItems?toggleItems:undefined} style={{display:"flex",alignItems:"baseline",gap:10,cursor:nItems?"pointer":"default"}}>
                                                  <span style={{flex:"1 1 auto",minWidth:0,fontSize:12.5,fontWeight:650,color:INK,letterSpacing:-0.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                                    {r.isBuffer ? `Buffer${r.tierLabel?` — ${r.tierLabel}`:""}` : r.label}
                                                    {nItems > 0 && <span style={{fontSize:9.5,fontWeight:600,color:INK_3,marginLeft:6,whiteSpace:"nowrap"}}>{itemsOpen ? "▾" : `▸ ${nItems}`}</span>}
                                                  </span>
                                                  {!r.isBuffer && <span style={{...NUMCOL}}>
                                                    <span style={{fontSize:11.5,fontWeight:600,color:INK_2,...NUM}}>{r.qty}</span>
                                                    <span style={{fontSize:9.5,color:INK_3,marginLeft:3}}>{r.unit}</span>
                                                  </span>}
                                                  <span style={{...NUMCOL}}>
                                                    <span style={{fontSize:12.5,fontWeight:700,color:INK,letterSpacing:-0.2,...NUM}}>{r.trucks.toFixed(2)}</span>
                                                    <span style={{fontSize:9.5,color:INK_3,marginLeft:3}}>truck{r.trucks===1?"":"s"}</span>
                                                  </span>
                                                </div>
                                                {itemsOpen && nItems > 0 && (
                                                  <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${HAIRLINE}`,display:"flex",flexDirection:"column",gap:3}}>
                                                    {r.items.map((it, ii) => (
                                                      <div key={ii} style={{display:"flex",alignItems:"baseline",gap:10,fontSize:11.5,color:INK_3}}>
                                                        <span style={{flex:"1 1 auto",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                                          {it.zoneKey ? <span style={{color:INK_3,opacity:0.8}}>{it.zoneKey} · </span> : null}{it.name}
                                                        </span>
                                                        {/* Item quantities land in the SAME column as
                                                            the sub-category qty above them, so a row and
                                                            its parts line up instead of stepping in. */}
                                                        <span style={{...NUMCOL}}>
                                                          <span style={{...NUM}}>{Math.round((it.qty || 0) * 100) / 100}</span>
                                                          <span style={{fontSize:9.5,opacity:0.85,marginLeft:3}}>{r.unit}</span>
                                                        </span>
                                                        <span style={{...NUMCOL}} aria-hidden="true" />
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* ── SUMMARY BAR ──
                          The tab had no total of its own: the only booking-wide transport figure
                          lived in the bottom cost bar, mixed in with rental and florals. Four
                          figures rather than one, because a total alone does not say whether it is
                          large for the right reason — ₹8,000 over four functions and ₹8,000 over
                          one are different conversations. */}
                      <div className="dc2-sum">
                        {[
                          { label: dcShowAllFns ? "Functions counted" : "Function", value: fns.length, foot: fnsWithTrucks === fns.length ? "all carry trucks" : `${fnsWithTrucks} with trucks` },
                          { label: "Trucks", value: sumTrucks, foot: "billed across the booking" },
                          { label: "Tier", value: tierSeen.size === 1 ? [...tierSeen][0] : (tierSeen.size === 0 ? "—" : `${tierSeen.size} tiers`), foot: tierSeen.size > 1 ? "varies by function" : "venue rate band" },
                          { label: "Transport total", value: `₹${Math.round(sumCost).toLocaleString("en-IN")}`, foot: sumTrucks > 0 ? `≈ ₹${Math.round(sumCost / sumTrucks).toLocaleString("en-IN")} / truck` : null, tone: GOLD },
                        ].map((s, si) => (
                          <div key={si} className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:11,boxShadow:CARD_SHADOW,padding:"9px 13px",minWidth:0}}>
                            <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.label}</div>
                            <div style={{fontSize:16.5,fontWeight:700,letterSpacing:-0.4,lineHeight:1.15,color:s.tone||INK,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.value}</div>
                            {s.foot ? <div style={{fontSize:10,color:INK_3,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.foot}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })() : dcActiveTab === "power" ? (() => {
                  // ═══ POWER TAB BODY — per-function genset plan, split out of Transport so genset
                  // units/rates/cost have their own home instead of being buried inside one lump sum.
                  // The plan has real structure the old single line hid: two generator sizes, a rate
                  // each, and a venue default that the deal may be overriding. All three were run
                  // together into one sentence — "1 × 125 KVA @ ₹28,000" — which is unreadable as
                  // soon as both sizes are in play, and silently buried the one fact worth noticing,
                  // that someone has departed from what the venue normally needs. ═══
                  const allFns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (allFns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:INK_3,fontSize:13}}>No functions configured yet.</div>;
                  // Scoped to the selected function unless "All functions" is on — see Transport tab above.
                  const fns = dcShowAllFns ? allFns.map((fn,fi)=>({fn,fi})) : allFns.map((fn,fi)=>({fn,fi})).filter(x=>x.fi===(activeFnIdx||0));
                  // Booking-level figures for the summary bar, off the same breakdown the cards use.
                  let sumCost = 0, sumUnits = 0, sumKva = 0, fnsPowered = 0;
                  fns.forEach(({fn}) => {
                    let b = null; try { b = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; } catch { /* ignore */ }
                    const t = b?.transport || null;
                    const a = Number(t?.gensets) || 0, c = Number(t?.genset62) || 0;
                    sumCost += Number(t?.gensetCost) || 0;
                    sumUnits += a + c;
                    sumKva += a * 125 + c * 62;
                    if (a + c > 0) fnsPowered += 1;
                  });
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{DC_CSS}</style>
                      {fns.map(({fn, fi}) => {
                        let bd = null; try { bd = calcFunctionBreakdown ? calcFunctionBreakdown(fn) : null; } catch { /* ignore */ }
                        const tr = bd?.transport || null;
                        const gensetCost = Number(tr?.gensetCost) || 0;
                        const g125 = Number(tr?.gensets) || 0;
                        const g62 = Number(tr?.genset62) || 0;
                        const v125 = Number(tr?.venueGensets) || 0;
                        const v62 = Number(tr?.venueGenset62) || 0;
                        const r125 = Number(tr?.gensetRate) || 0;
                        const r62 = Number(tr?.gensetRate62) || 0;
                        // One entry per generator size actually in the plan. Cost per size was never
                        // shown — only the function's lump sum — so with both sizes running you could
                        // not tell which one the money was going to.
                        const units = [
                          { kva: 125, n: g125, rate: r125, venue: v125 },
                          { kva: 62,  n: g62,  rate: r62,  venue: v62  },
                        ].filter(u => u.n > 0);
                        const totalKva = g125 * 125 + g62 * 62;
                        return (
                          <div key={fi} className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                            {/* Gold for power — and grey when a venue needs no generator, so an
                                unpowered function is visibly a different kind of row. */}
                            <div aria-hidden="true" style={{width:4,flexShrink:0,background:units.length?"#C6A55E":"#DED7CB"}} />
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:`1px solid ${HAIRLINE}`}}>
                                <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:"#F7F1E0"}}>⚡</span>
                                <div style={{flex:"1 1 auto",minWidth:0}}>
                                  <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.35,lineHeight:1.2}}>{fn?.fnType || `Function ${fi+1}`}</div>
                                  <div style={{fontSize:11.5,color:INK_3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...NUM}}>
                                    {fn?.fnDate || "—"} · {fn?.fnVenue || "—"}{fn?.fnShift ? ` · ${fn.fnShift}` : ""}
                                  </div>
                                </div>
                                {/* Total load as a chip. It is the number an electrician asks for and
                                    it was nowhere on this screen — you had to multiply it yourself. */}
                                {totalKva > 0 && (
                                  <span style={{flexShrink:0,fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 9px",borderRadius:999,background:CHIP_BG,color:INK_2,whiteSpace:"nowrap",...NUM}}>{totalKva} KVA total</span>
                                )}
                                <div style={{textAlign:"right",flexShrink:0}}>
                                  <div style={{fontSize:17,fontWeight:750,color:gensetCost>0?INK:INK_3,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>
                                    {gensetCost > 0 ? `₹${Math.round(gensetCost).toLocaleString("en-IN")}` : "—"}
                                  </div>
                                  {units.length > 0 && <div style={{fontSize:11,color:INK_3,marginTop:2,...NUM}}>{g125+g62} genset{(g125+g62)===1?"":"s"}</div>}
                                </div>
                              </div>
                              {units.length === 0 ? (
                                <div style={{padding:"16px 15px",fontSize:12.5,color:INK_2}}>
                                  <div style={{fontWeight:600,marginBottom:3,color:INK}}>No genset needed at this venue.</div>
                                  <div style={{fontSize:11.5,color:INK_3}}>{fn?.fnVenue || "This venue"} supplies its own power, so nothing is billed here.</div>
                                </div>
                              ) : (
                                // auto-fit rather than a fixed column count: there are only ever one
                                // or two sizes, and a lone 125 KVA card stranded in a third of the
                                // row would look like something failed to load.
                                <div style={{padding:"12px 15px 14px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
                                  {units.map(u => {
                                    const cost = u.n * u.rate;
                                    const overridden = u.n !== u.venue;
                                    return (
                                      <div key={u.kva} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,overflow:"hidden",display:"flex"}}>
                                        <div aria-hidden="true" style={{width:3,flexShrink:0,background:u.kva===125?"#C6A55E":"#B9A87E"}} />
                                        <div style={{flex:"1 1 auto",minWidth:0,padding:"10px 12px"}}>
                                          <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                                            <span style={{flex:"1 1 auto",minWidth:0,fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase"}}>{u.kva} KVA</span>
                                            <span style={{flexShrink:0,textAlign:"right"}}>
                                              <span style={{fontSize:13,fontWeight:700,color:INK,letterSpacing:-0.2,...NUM}}>{u.n}</span>
                                              <span style={{fontSize:9.5,color:INK_3,marginLeft:3}}>unit{u.n===1?"":"s"}</span>
                                            </span>
                                          </div>
                                          <div style={{display:"flex",alignItems:"baseline",gap:8,marginTop:7}}>
                                            <span style={{fontSize:17,fontWeight:750,color:INK,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>₹{Math.round(cost).toLocaleString("en-IN")}</span>
                                            <span style={{fontSize:10,color:INK_3,letterSpacing:0.4,textTransform:"uppercase",fontWeight:600,...NUM}}>{u.n} × ₹{u.rate.toLocaleString("en-IN")}</span>
                                          </div>
                                          {/* ── THE ONE THING WORTH INTERRUPTING FOR ──
                                              A count that departs from what the venue normally needs
                                              was a parenthetical in grey inside a longer sentence.
                                              It is the only fact on this card that implies someone
                                              made a decision, so it gets the gold treatment the
                                              "adjusted" badge uses in Manpower — same meaning, same
                                              look. Matching the default says nothing and shows
                                              nothing. */}
                                          {overridden && (
                                            <div title={`This venue normally needs ${u.venue} × ${u.kva} KVA. The deal is carrying ${u.n}.`}
                                              style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:5,fontSize:9.5,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 8px",borderRadius:999,background:GOLD_SOFT,color:GOLD,border:`1px solid ${GOLD}33`,cursor:"help",...NUM}}>
                                              <span aria-hidden="true" style={{width:4,height:4,borderRadius:"50%",background:GOLD,display:"inline-block"}} />
                                              venue default {u.venue}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Booking-level figures. Power had no total of its own — the only genset
                          number lived in the bottom cost bar next to rental and florals. */}
                      <div className="dc2-sum">
                        {[
                          { label: dcShowAllFns ? "Functions counted" : "Function", value: fns.length, foot: fnsPowered === fns.length ? "all need power" : `${fnsPowered} need power` },
                          { label: "Gensets", value: sumUnits, foot: "units across the booking" },
                          { label: "Total load", value: sumKva ? `${sumKva} KVA` : "—", foot: "combined generator capacity" },
                          { label: "Power total", value: `₹${Math.round(sumCost).toLocaleString("en-IN")}`, foot: sumUnits > 0 ? `≈ ₹${Math.round(sumCost / sumUnits).toLocaleString("en-IN")} / unit` : null, tone: GOLD },
                        ].map((s, si) => (
                          <div key={si} className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:11,boxShadow:CARD_SHADOW,padding:"9px 13px",minWidth:0}}>
                            <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.label}</div>
                            <div style={{fontSize:16.5,fontWeight:700,letterSpacing:-0.4,lineHeight:1.15,color:s.tone||INK,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.value}</div>
                            {s.foot ? <div style={{fontSize:10,color:INK_3,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.foot}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })() : (dcActiveTab === "production" || dcActiveTab === "buying") ? (() => {
                  const fnIdx = activeFnIdx || 0;
                  const isP = dcActiveTab === "production";
                  const items = dcCustomItems.filter(c => c.fnIdx === fnIdx && c.type === dcActiveTab);
                  const total = items.reduce((s, c) => s + (c.manualPrice || c.refPrice || 0) * (Number(c.qty) || 1), 0);
                  // Production and Buying are the same shape of thing — a short list of one-off
                  // items added per zone — so they share this branch and differ only by accent.
                  // Warm-palette equivalents of the old #A855F7 / #F59E0B.
                  const ciInk  = isP ? "#6F63A8" : "#C6A55E";
                  const ciTile = isP ? "#EBE8F4" : "#F7F1E0";
                  const fnName = (collectAllFunctionData ? collectAllFunctionData() : [])[fnIdx]?.fnType || `Function ${fnIdx+1}`;
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{DC_CSS}</style>
                      <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                        <div aria-hidden="true" style={{width:4,flexShrink:0,background:items.length?ciInk:"#DED7CB"}} />
                        <div style={{flex:"1 1 auto",minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:`1px solid ${HAIRLINE}`}}>
                            <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:ciTile}}>{isP?"🏭":"🛒"}</span>
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.35,lineHeight:1.2}}>{isP ? "Production items" : "Buying items"}</div>
                              <div style={{fontSize:11.5,color:INK_3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...NUM}}>
                                {fnName} · {items.length} item{items.length===1?"":"s"} · one-offs added from zone headers on Build
                              </div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:17,fontWeight:750,color:total>0?INK:INK_3,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>₹{Math.round(total).toLocaleString("en-IN")}</div>
                              <div style={{fontSize:11,color:INK_3,marginTop:2}}>{isP ? "to produce" : "to buy"}</div>
                            </div>
                          </div>
                          {items.length === 0 ? (
                            <div style={{padding:"16px 15px",fontSize:12.5,color:INK_2}}>
                              <div style={{fontWeight:600,marginBottom:3,color:INK}}>No {isP ? "production" : "buying"} items in {fnName}.</div>
                              <div style={{fontSize:11.5,color:INK_3}}>Add them with the {isP ? "🏭" : "🛒"} icon in a zone header on the Build screen.</div>
                            </div>
                          ) : (
                            <div className="dc2-grid4" style={{padding:"12px 15px 14px"}}>
                              {items.map(ci => {
                                const unitCost = ci.manualPrice || ci.refPrice || 0;
                                const refItem = ci.refItemId ? (dcInventoryCache || []).find(x => x.id === ci.refItemId) : null;
                                const refPhoto = refItem ? imsField.photos(refItem)[0] : null;
                                const zonePhoto = elSelectedPhoto[ci.zoneKey]?.src || null;
                                const photo = ci.photo || zonePhoto || refPhoto || null;
                                const qty = Number(ci.qty) || 1;
                                const dims = ci.dims?.l ? `${ci.dims.w}W × ${ci.dims.l}D × ${ci.dims.h}H ft` : null;
                                return (
                                  <div key={ci.id} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                                    <div style={{display:"flex",gap:10,padding:"11px 12px"}}>
                                      {photo
                                        ? <HoverZoom src={thumbUrl(photo, 320)}><img loading="lazy" decoding="async" src={thumbUrl(photo, 96)} alt="" style={{width:46,height:46,borderRadius:9,objectFit:"cover",flexShrink:0,border:`1px solid ${CARD_BORDER}`}} /></HoverZoom>
                                        : <div style={{width:46,height:46,borderRadius:9,background:ciTile,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{isP?"🏭":"🛒"}</div>}
                                      <div style={{flex:"1 1 auto",minWidth:0}}>
                                        {/* Category is context, the sub-category is the thing — they
                                            used to run together at one weight as "Florals → Flower
                                            Pot Small", so the name you scan for was the tail of a
                                            longer string. */}
                                        {ci.cat && <div style={{fontSize:9.5,fontWeight:700,letterSpacing:0.7,textTransform:"uppercase",color:INK_3,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ci.cat}</div>}
                                        <div title={ci.subCat} style={{fontSize:12.5,fontWeight:650,color:INK,letterSpacing:-0.1,lineHeight:1.25,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ci.subCat}</div>
                                        <div style={{fontSize:10.5,color:INK_3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...NUM}}>
                                          {ci.zoneKey}{dims ? ` · ${dims}` : ""}
                                        </div>
                                      </div>
                                    </div>
                                    {(refItem || ci.notes) && (
                                      <div style={{padding:"0 12px",fontSize:10.5,color:INK_3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={[refItem?`Ref: ${refItem.name}`:null, ci.notes].filter(Boolean).join(" · ")}>
                                        {refItem ? `Ref: ${refItem.name}` : ""}{refItem && ci.notes ? " · " : ""}{ci.notes || ""}
                                      </div>
                                    )}
                                    {/* marginTop:auto pins the money row to the card foot, so it
                                        lands at the same height across a stretched grid row. */}
                                    <div style={{marginTop:"auto",display:"flex",alignItems:"flex-end",gap:8,padding:"10px 12px 11px"}}>
                                      <div style={{flex:"1 1 auto",minWidth:0}}>
                                        <div style={{fontSize:17,fontWeight:750,color:INK,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>₹{Math.round(unitCost * qty).toLocaleString("en-IN")}</div>
                                        <div style={{fontSize:9.5,color:INK_3,marginTop:2,letterSpacing:0.4,textTransform:"uppercase",fontWeight:600,...NUM}}>₹{Math.round(unitCost).toLocaleString("en-IN")} × {qty}</div>
                                      </div>
                                      <button onClick={()=>setDcCustomItems(prev=>prev.filter(x=>x.id!==ci.id))}
                                        title={`Remove ${ci.subCat} from ${isP ? "production" : "buying"}`}
                                        className="dc2-ghost"
                                        style={{flexShrink:0,width:26,height:26,borderRadius:8,border:`1px solid ${TILE_BORDER}`,background:CARD_BG,color:INK_3,fontSize:12,lineHeight:1,cursor:"pointer"}}>✕</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })() : dcActiveTab === "status" ? (() => {
                  // ═══ INVENTORY STATUS TAB — Deploy 3 · §7.9.2.A + §7.9.18 + §7.9.19 ═══
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:"#1A1A2E",fontSize:13}}>No functions configured yet.</div>;
                  const blocksByDate = dealCheckData?.blocksByDate || {};
                  const nowMs = Date.now();

                  // ── §7.9.18 Calendar Conflicts ──
                  // Scan all fns/cards: detect items where needed > available or held by another salesperson
                  const conflicts = [];
                  const conflictSeen = new Set();
                  fns.forEach((fn, fi) => {
                    const fnDate = fn.fnDate || clientDate;
                    const fnBlocks = blocksByDate[fnDate] || {};
                    const cards = dcCards[fi] || {};
                    Object.entries(cards).forEach(([ck, card]) => {
                      if (!card.imsId) return;
                      const item = dcInventoryCache.find(x => x.id === card.imsId);
                      if (!item) return;
                      const cardQty = Number(card.qty) || 1;
                      const available = getStudioAvailable(item, fnBlocks);
                      const hold = getActiveSoftHold(softHolds, card.imsId, authUser?.name, nowMs);
                      const isShort = cardQty > available;
                      const isHeld = !!hold;
                      if (!isShort && !isHeld) return;
                      const dedup = `${card.imsId}::${fnDate}`;
                      if (conflictSeen.has(dedup)) return;
                      conflictSeen.add(dedup);
                      const photo = imsField.photos(item)[0];
                      // fi is carried so a row can be matched against the sidebar selection —
                      // this tab is booking-wide, and without the index there was no way to say
                      // which conflicts belong to the function you are actually looking at.
                      conflicts.push({ imsId: card.imsId, name: item.name || card.imsName, photo, needed: cardQty, available, isShort, hold, isHeld, fnDate, fi, fnLabel: fn.fnType || `Function ${fi+1}`, item });
                    });
                  });

                  // ── §7.9.19 Cross-Function Reuse ──
                  // Find items appearing in 2+ functions (by imsId)
                  const itemFnMap = {};  // { imsId: { name, photo, rental, fns: Set<fnIdx>, totalQty } }
                  fns.forEach((fn, fi) => {
                    const cards = dcCards[fi] || {};
                    Object.values(cards).forEach(card => {
                      if (!card.imsId) return;
                      if (!itemFnMap[card.imsId]) {
                        const item = dcInventoryCache.find(x => x.id === card.imsId);
                        // Aggregated across functions, so the master component list is the right
                        // basis here — no single function's kit edits apply.
                        const rental = item ? effKitRental(item, null, null) : 0;
                        const photo = item ? imsField.photos(item)[0] : null;
                        itemFnMap[card.imsId] = { name: item?.name || card.imsName || "?", photo, rental, fns: new Set(), totalQty: 0, fnLabels: {} };
                      }
                      const m = itemFnMap[card.imsId];
                      m.fns.add(fi);
                      m.totalQty += (Number(card.qty) || 1);
                      m.fnLabels[fi] = fns[fi]?.fnType || `Fn ${fi+1}`;
                    });
                  });
                  const reuseItems = Object.entries(itemFnMap)
                    .filter(([_, m]) => m.fns.size >= 2)
                    .map(([imsId, m]) => {
                      const isSeparate = dcDedupOverrides[imsId] === "separate";
                      const saving = isSeparate ? 0 : m.rental * m.totalQty * (m.fns.size - 1) / m.fns.size;
                      return { imsId, ...m, fnCount: m.fns.size, saving, isSeparate, fnNames: [...m.fns].map(fi => m.fnLabels[fi]).join(", ") };
                    });
                  const totalSaving = reuseItems.reduce((s, r) => s + r.saving, 0);

                  const conflictCount = conflicts.length;
                  const reuseCount = reuseItems.length;
                  // Split, because they are not the same problem. A shortage is yours to solve —
                  // swap the item or cut the qty. A hold belongs to another salesperson and may
                  // simply expire. One combined "conflicts" number hid which kind you had.
                  const shortCount = conflicts.filter(c => c.isShort).length;
                  const heldCount = conflicts.filter(c => c.isHeld).length;

                  // ── WHY SWITCHING FUNCTIONS SEEMED TO DO NOTHING ──
                  // This tab is booking-wide and always has been: a conflict is a clash on a DATE,
                  // and cross-function reuse is by definition a fact about several functions at
                  // once — neither can be scoped to one ceremony. But the sidebar keeps a function
                  // highlighted here (Inventory Status is not in the "All functions" pill list),
                  // so the page looked like it was filtered and simply refusing to update.
                  // Two answers, both needed: say the scope out loud, and mark the rows that DO
                  // belong to the selected function so switching produces visible feedback instead
                  // of apparent deadness. Sorting those rows first is what makes the change
                  // impossible to miss — the list visibly reorders as you move down the sidebar.
                  const activeFi = activeFnIdx || 0;
                  const activeFnName = fns[activeFi]?.fnType || `Function ${activeFi + 1}`;
                  const inActiveFn = (c) => c.fi === activeFi;
                  const sortedConflicts = [...conflicts].sort((a, b) => (inActiveFn(b) ? 1 : 0) - (inActiveFn(a) ? 1 : 0));
                  const sortedReuse = [...reuseItems].sort((a, b) => (b.fns.has(activeFi) ? 1 : 0) - (a.fns.has(activeFi) ? 1 : 0));
                  const activeConflictCount = conflicts.filter(inActiveFn).length;

                  if (conflictCount === 0 && reuseCount === 0) {
                    return (
                      <div style={{display:"flex",justifyContent:"center",padding:"36px 20px"}}>
                        <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,padding:"26px 30px",textAlign:"center",maxWidth:440}}>
                          <style>{DC_CSS}</style>
                          <div aria-hidden="true" style={{width:44,height:44,borderRadius:12,background:GOOD_SOFT,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:20,marginBottom:12}}>✓</div>
                          <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.3}}>Inventory clean</div>
                          <div style={{fontSize:12,color:INK_3,marginTop:5,lineHeight:1.5}}>Every booked item has free stock on its date, and nothing is held by another salesperson. No item repeats across functions, so there is nothing to share.</div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{DC_CSS}</style>

                      {/* ── SCOPE, STATED ──
                          Without this the tab reads as broken: you pick Cocktail, every row still
                          says Wedding, and nothing explains why. */}
                      <div style={{display:"flex",alignItems:"center",gap:9,padding:"9px 13px",borderRadius:11,background:CHIP_BG,border:`1px solid ${CARD_BORDER}`,flexWrap:"wrap"}}>
                        <span aria-hidden="true" style={{fontSize:13}}>🗂️</span>
                        <span style={{fontSize:11.5,color:INK_2}}>
                          <strong style={{color:INK,fontWeight:700}}>Whole booking</strong> — conflicts are date clashes and reuse spans ceremonies, so neither can be filtered to one function.
                        </span>
                        <span style={{marginLeft:"auto",fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 9px",borderRadius:999,background:CARD_BG,border:`1px solid ${CARD_BORDER}`,color:INK_2,whiteSpace:"nowrap"}}>
                          {activeConflictCount > 0 ? `${activeConflictCount} in ${activeFnName}` : `none in ${activeFnName}`}
                        </span>
                      </div>

                      {/* ── SUMMARY BAR, FIRST ──
                          This tab is an exceptions list: everything on it is either a problem or
                          money on the table. It opened straight into rows, so "how bad is it" took
                          counting. Four figures answer that before any row is read — and short vs
                          held matters more than the combined count, because a shortage is yours to
                          solve and a hold belongs to another salesperson. */}
                      <div className="dc2-sum">
                        {[
                          { label: "Conflicts", value: conflictCount, foot: conflictCount ? "need attention" : "none", tone: conflictCount ? BAD : INK },
                          { label: "Short", value: shortCount, foot: "not enough free stock", tone: shortCount ? BAD : INK },
                          { label: "Held elsewhere", value: heldCount, foot: "by another salesperson", tone: heldCount ? GOLD : INK },
                          { label: "Reuse savings", value: `₹${Math.round(totalSaving).toLocaleString("en-IN")}`, foot: reuseCount ? `${reuseCount} item${reuseCount===1?"":"s"} shared` : "nothing shared yet", tone: totalSaving > 0 ? GOOD : INK },
                        ].map((s, si) => (
                          <div key={si} className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:11,boxShadow:CARD_SHADOW,padding:"9px 13px",minWidth:0}}>
                            <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.label}</div>
                            <div style={{fontSize:16.5,fontWeight:700,letterSpacing:-0.4,lineHeight:1.15,color:s.tone,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.value}</div>
                            <div style={{fontSize:10,color:INK_3,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.foot}</div>
                          </div>
                        ))}
                      </div>

                      {/* ── CALENDAR CONFLICTS ── */}
                      {conflictCount > 0 && (
                        <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                          <div aria-hidden="true" style={{width:4,flexShrink:0,background:BAD}} />
                          <div style={{flex:"1 1 auto",minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:`1px solid ${HAIRLINE}`}}>
                              <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:BAD_SOFT}}>⚠</span>
                              <div style={{flex:"1 1 auto",minWidth:0}}>
                                <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.35,lineHeight:1.2}}>Calendar conflicts</div>
                                <div style={{fontSize:11.5,color:INK_3,marginTop:3}}>Booked on a date where the stock is short, or already held by someone else.</div>
                              </div>
                              <span style={{flexShrink:0,fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 9px",borderRadius:999,background:BAD_SOFT,color:BAD,whiteSpace:"nowrap",...NUM}}>{conflictCount} item{conflictCount===1?"":"s"}</span>
                            </div>
                            <div className="dc2-grid" style={{padding:"12px 15px 14px"}}>
                              {sortedConflicts.map((c, ci) => {
                                const mine = inActiveFn(c);
                                return (
                                <div key={ci} className="dc2-row" title={mine?undefined:`Belongs to ${c.fnLabel}, not the function selected in the sidebar.`}
                                  style={{borderRadius:12,background:mine?CARD_BG:TILE_BG,border:`1px solid ${mine?INK_3+"55":TILE_BORDER}`,overflow:"hidden",display:"flex"}}>
                                  <div aria-hidden="true" style={{width:3,flexShrink:0,background:c.isShort?BAD:GOLD}} />
                                  <div style={{flex:"1 1 auto",minWidth:0,padding:"10px 12px",display:"flex",gap:10}}>
                                    {c.photo
                                      ? <HoverZoom src={thumbUrl(c.photo, 320)}><img loading="lazy" decoding="async" src={thumbUrl(c.photo, 88)} alt="" style={{width:44,height:44,borderRadius:9,objectFit:"cover",flexShrink:0,border:`1px solid ${CARD_BORDER}`}}/></HoverZoom>
                                      : <div style={{width:44,height:44,borderRadius:9,background:CARD_BG,border:`1px solid ${CARD_BORDER}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>📦</div>}
                                    <div style={{flex:"1 1 auto",minWidth:0}}>
                                      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                                        <span title={c.name} style={{flex:"1 1 auto",minWidth:0,fontSize:12.5,fontWeight:650,color:INK,letterSpacing:-0.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                                        {/* SHORT and HELD are different problems with different
                                            owners, so they keep different colours rather than being
                                            flattened into one "conflict" badge. */}
                                        <span style={{flexShrink:0,fontSize:9,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 7px",borderRadius:999,whiteSpace:"nowrap",background:c.isShort?BAD_SOFT:GOLD_SOFT,color:c.isShort?BAD:GOLD}}>{c.isShort?"short":"held"}</span>
                                      </div>
                                      {/* The function name is the field that tells you whether a
                                          row is the one you selected, so on a match it takes full
                                          ink and a dot rather than staying in the quiet grey every
                                          other row uses. */}
                                      <div style={{fontSize:11,color:INK_3,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5,...NUM}}>
                                        {mine && <span aria-hidden="true" style={{width:5,height:5,borderRadius:"50%",background:INK,flexShrink:0}} />}
                                        <span style={{color:mine?INK:INK_3,fontWeight:mine?650:400}}>{c.fnLabel}</span>
                                        <span>· {c.fnDate}</span>
                                      </div>
                                      {c.isShort && (
                                        <div style={{marginTop:6,fontSize:11.5,color:INK_2,...NUM}}>
                                          need <strong style={{color:BAD,fontWeight:700}}>{c.needed}</strong>, only <strong style={{color:INK,fontWeight:700}}>{c.available}</strong> free
                                        </div>
                                      )}
                                      {c.isHeld && (
                                        <div style={{marginTop:6,fontSize:11.5,color:INK_2}}>
                                          Held by <strong style={{color:INK,fontWeight:650}}>{c.hold.salesperson}</strong> for {c.hold.eventName}
                                          {c.hold.expiry && <span style={{color:INK_3}}> · expires {new Date(c.hold.expiry).toLocaleString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})}</span>}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── CROSS-FUNCTION REUSE ── */}
                      {reuseCount > 0 && (
                        <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                          <div aria-hidden="true" style={{width:4,flexShrink:0,background:GOOD}} />
                          <div style={{flex:"1 1 auto",minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:`1px solid ${HAIRLINE}`}}>
                              <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:GOOD_SOFT}}>♻️</span>
                              <div style={{flex:"1 1 auto",minWidth:0}}>
                                <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.35,lineHeight:1.2}}>Cross-function reuse</div>
                                <div style={{fontSize:11.5,color:INK_3,marginTop:3}}>The same item is booked in more than one ceremony, so it is only charged once.</div>
                              </div>
                              <div style={{textAlign:"right",flexShrink:0}}>
                                <div style={{fontSize:17,fontWeight:750,color:totalSaving>0?GOOD:INK_3,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>₹{Math.round(totalSaving).toLocaleString("en-IN")}</div>
                                <div style={{fontSize:11,color:INK_3,marginTop:2,...NUM}}>saved · {reuseCount} item{reuseCount===1?"":"s"}</div>
                              </div>
                            </div>
                            <div className="dc2-grid" style={{padding:"12px 15px 14px"}}>
                              {sortedReuse.map((r, ri) => (
                                <div key={ri} className="dc2-row" title={r.fns.has(activeFi)?undefined:`Not used in ${activeFnName}.`}
                                  style={{borderRadius:12,background:r.fns.has(activeFi)?CARD_BG:TILE_BG,border:`1px solid ${r.fns.has(activeFi)?INK_3+"55":TILE_BORDER}`,overflow:"hidden",display:"flex"}}>
                                  <div aria-hidden="true" style={{width:3,flexShrink:0,background:r.isSeparate?GOLD:GOOD}} />
                                  <div style={{flex:"1 1 auto",minWidth:0,padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                                    <div style={{display:"flex",gap:10}}>
                                      {r.photo
                                        ? <HoverZoom src={thumbUrl(r.photo, 320)}><img loading="lazy" decoding="async" src={thumbUrl(r.photo, 88)} alt="" style={{width:44,height:44,borderRadius:9,objectFit:"cover",flexShrink:0,border:`1px solid ${CARD_BORDER}`}}/></HoverZoom>
                                        : <div style={{width:44,height:44,borderRadius:9,background:CARD_BG,border:`1px solid ${CARD_BORDER}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>📦</div>}
                                      <div style={{flex:"1 1 auto",minWidth:0}}>
                                        <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                                          <span title={r.name} style={{flex:"1 1 auto",minWidth:0,fontSize:12.5,fontWeight:650,color:INK,letterSpacing:-0.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                                          <span style={{flexShrink:0,fontSize:11,fontWeight:700,color:INK_2,...NUM}}>×{r.totalQty}</span>
                                        </div>
                                        <div title={r.fnNames} style={{fontSize:11,color:r.fns.has(activeFi)?INK_2:INK_3,fontWeight:r.fns.has(activeFi)?600:400,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5}}>
                                          {r.fns.has(activeFi) && <span aria-hidden="true" style={{width:5,height:5,borderRadius:"50%",background:INK,flexShrink:0}} />}
                                          {r.fnNames}
                                        </div>
                                        {/* The money is the reason this row exists, so it is the
                                            biggest thing on it — it used to be a 12px grey sentence
                                            below two other 12px grey sentences. */}
                                        <div style={{marginTop:6,display:"flex",alignItems:"baseline",gap:7,flexWrap:"wrap"}}>
                                          {r.isSeparate ? (
                                            <span style={{fontSize:11.5,color:GOLD,fontWeight:650}}>Blocked separately — no sharing</span>
                                          ) : (
                                            <>
                                              <span style={{fontSize:16,fontWeight:750,color:GOOD,letterSpacing:-0.35,lineHeight:1.1,...NUM}}>₹{Math.round(r.saving).toLocaleString("en-IN")}</span>
                                              <span style={{fontSize:9.5,color:INK_3,letterSpacing:0.5,textTransform:"uppercase",fontWeight:600,...NUM}}>saved · {r.fnCount} fns</span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <button onClick={()=>setDcDedupOverrides(prev=>({...prev,[r.imsId]: prev[r.imsId]==="separate"?undefined:"separate"}))}
                                      className="dc2-ghost"
                                      title={r.isSeparate ? "Share this item across the functions again and take the saving" : "Block a separate unit per function — no saving, but each function gets its own"}
                                      style={{alignSelf:"flex-start",marginTop:"auto",fontSize:10.5,padding:"4px 10px",borderRadius:999,cursor:"pointer",border:`1px solid ${r.isSeparate?`${GOOD}44`:TILE_BORDER}`,background:r.isSeparate?GOOD_SOFT:"transparent",color:r.isSeparate?GOOD:INK_2,fontWeight:650,letterSpacing:0.3,whiteSpace:"nowrap"}}>
                                      {r.isSeparate?"♻ Share again":"✂ Block separately"}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })() : dcActiveTab === "gyv" ? (() => {
                  // ═══ GYV FIXED & BUFFER COST TAB — reads from shared dcCostRollup ═══
                  const { rental, florals, transport, manpower, truss, buyTotal, produceTotal, base: baseProj, gyvFixed: gyvCost, bufferCost, grand: grandProj, clientRevenue, fns, hasActuals, actualMandi, actualExpenses, effFlorals, baseActual, grandActual, projFlorals, effManpower, mpDelta } = dcCostRollup;
                  const baseCost = hasActuals ? baseActual : baseProj;
                  const grandWithOverheads = hasActuals ? grandActual : grandProj;
                  const fmt = (n) => n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "₹0";
                  const gyvPct = 5;
                  const bufferPct = 3;

                  // Icon split out of the label so it can sit in a tile rather than inline in the
                  // text, and `flag` marks a line that has departed from its projection — an actual
                  // mandi bill, or crew a dept head changed. Those are the only lines on this screen
                  // where a person or a real invoice overrode the system, which is exactly what GOLD
                  // means everywhere else in Deal Check.
                  const rows = [
                    { icon: "📦", label: "Rental",     value: rental },
                    { icon: "🏗️", label: "Truss",      value: truss },
                    { icon: "🌸", label: "Florals",    value: actualMandi > 0 ? actualMandi : florals,
                      flag: actualMandi > 0 ? "actual" : null,
                      note: actualMandi > 0 ? `actual mandi bill · projected ${fmt(projFlorals)}` : null },
                    { icon: "🚚", label: "Transport",  value: transport },
                    { icon: "👷", label: "Manpower",   value: mpDelta ? effManpower : manpower,
                      flag: mpDelta ? "adjusted" : null,
                      note: mpDelta ? `dept heads changed the crew · projected ${fmt(manpower)}` : null },
                    { icon: "🛒", label: "Buying",     value: buyTotal },
                    { icon: "🏭", label: "Production", value: produceTotal },
                    ...(actualExpenses > 0 ? [{ icon: "🧾", label: "On-site expenses", value: actualExpenses, flag: "actual", note: "billed on site" }] : []),
                  ];

                  // ── ONE QUOTE FIGURE, NOT TWO ──
                  // The profitability panel used to recompute this locally while the quote
                  // calculator read dcCostRollup's copy. Both apply the same negotiated-amount
                  // override so they happened to agree, but two copies of the number the whole
                  // screen hangs on is a disagreement waiting to happen the next time one is edited.
                  const quote = Number(cli?.negotiatedAmount) > 0
                    ? Number(cli.negotiatedAmount)
                    : (() => { let s = 0; try { fns.forEach(fn => { s += calcFunctionCost(fn).grand; }); } catch {} return s; })();
                  const netProfit = quote - grandWithOverheads;
                  const profitPct = quote > 0 ? Math.round((netProfit / quote) * 100) : 0;
                  // Health bands: the thresholds were already in the code, only the palette changes.
                  const health = profitPct >= 20
                    ? { ink: GOOD, soft: GOOD_SOFT, label: "Healthy" }
                    : profitPct >= 10
                      ? { ink: GOLD, soft: GOLD_SOFT, label: "Moderate" }
                      : profitPct >= 0
                        ? { ink: BAD, soft: BAD_SOFT, label: "Low" }
                        : { ink: BAD, soft: BAD_SOFT, label: "Loss" };
                  const overheads = gyvCost + bufferCost;

                  // ── COLLAPSE STATE, ONE FACTORY ──
                  // Four sections need the same open/toggle pair, and four hand-rolled copies is
                  // four chances to key one wrong or default one differently. State lives in
                  // dcCollapsedFnBlocks — the same store every other collapsible block in Deal
                  // Check uses — so it persists with the deal rather than resetting on every tab
                  // switch. All default open: each section keeps its own total in its header while
                  // collapsed, so folding one away costs nothing, but nothing here should be hidden
                  // until the reader chooses to hide it.
                  const sect = (key) => {
                    const open = dcCollapsedFnBlocks[key] !== undefined ? dcCollapsedFnBlocks[key] : true;
                    return { open, toggle: () => setDcCollapsedFnBlocks(prev => ({ ...prev, [key]: !open })) };
                  };
                  const sBreak  = sect("gyv:breakdown");
                  const sOver   = sect("gyv:overheads");
                  const sProfit = sect("gyv:profit");
                  const sQuote  = sect("gyv:quote");

                  const SUM_TILE = { background:CARD_BG, border:`1px solid ${CARD_BORDER}`, borderRadius:11, boxShadow:CARD_SHADOW, padding:"9px 13px", minWidth:0 };
                  const EYEBROW = { fontSize:9.5, fontWeight:700, letterSpacing:1, textTransform:"uppercase", color:INK_2, marginBottom:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" };
                  const SECT_HEAD = { display:"flex", alignItems:"center", gap:12, padding:"13px 15px", borderBottom:`1px solid ${HAIRLINE}` };
                  const SECT_TITLE = { fontSize:15.5, fontWeight:700, color:INK, letterSpacing:-0.35, lineHeight:1.2 };
                  const SECT_SUB = { fontSize:11.5, color:INK_3, marginTop:3 };
                  const ICON_TILE = (bg) => ({ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, borderRadius:10, flexShrink:0, fontSize:17, lineHeight:1, background:bg });
                  // Defined AFTER SECT_HEAD, not beside the sect() factory above: headStyle reads
                  // SECT_HEAD, and a const referenced before its declaration line has executed is a
                  // temporal-dead-zone throw. It happened to work up there because it is only ever
                  // called from JSX — i.e. after every const has initialised — but that is a
                  // property of where it is called from, not of the code, and the next caller would
                  // not know that. The chevron sits here too: it is the only affordance saying a
                  // header is clickable, so it is built once rather than retyped per section.
                  const chev = (open) => (
                    <span aria-hidden="true" style={{fontSize:11,color:INK_3,flexShrink:0,display:"inline-block",transform:open?"rotate(90deg)":"none",transition:"transform 0.16s ease"}}>▸</span>
                  );
                  const headStyle = (open) => ({ ...SECT_HEAD, borderBottom: open ? SECT_HEAD.borderBottom : "none" });

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{DC_CSS}</style>

                      {/* ── THE FOUR NUMBERS THIS SCREEN EXISTS FOR ──
                          They were previously the last line of four separate panels, so answering
                          "what is the margin" meant scrolling to the bottom of the page. */}
                      <div className="dc2-sum">
                        {[
                          { label: "Base cost", value: fmt(baseCost), foot: "before GYV and buffer" },
                          { label: `Overheads · ${gyvPct}% + ${bufferPct}%`, value: fmt(overheads), foot: "GYV fixed + buffer" },
                          { label: "Project total", value: fmt(grandWithOverheads), foot: "what the deal costs us" },
                          { label: "Net profit", value: `${netProfit < 0 ? "−" : ""}${fmt(Math.abs(netProfit))}`, foot: `${health.label} · ${profitPct}% margin`, tone: health.ink },
                        ].map((s, si) => (
                          <div key={si} className="dc2-card" style={SUM_TILE}>
                            <div style={EYEBROW}>{s.label}</div>
                            <div style={{fontSize:16.5,fontWeight:700,letterSpacing:-0.4,lineHeight:1.15,color:s.tone||INK,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.value}</div>
                            <div style={{fontSize:10,color:INK_3,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.foot}</div>
                          </div>
                        ))}
                      </div>

                      {/* ── COST BREAKDOWN ──
                          Deliberately NOT a card grid. This is an ordered list of amounts that sum
                          to a total, and a total only reads as a total when its parts sit in one
                          column above it. Cards would scatter eight figures across three columns
                          and break the one relationship that matters here. */}
                      <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                        <div aria-hidden="true" style={{width:4,flexShrink:0,background:"#6F63A8"}} />
                        <div style={{flex:"1 1 auto",minWidth:0}}>
                          {/* Collapsible: the eight cost lines are the longest block on this tab,
                              and once you have read them the figure you keep coming back for is the
                              base cost — which stays in the header while collapsed, so folding it
                              away costs you nothing. Keyed in dcCollapsedFnBlocks like every other
                              collapsible block in Deal Check, so the state persists with the deal
                              rather than resetting on every tab switch. Open by default: this is
                              the section the tab is named after. */}
                          <div onClick={sBreak.toggle} className="dc2-hd" style={headStyle(sBreak.open)}>
                            <span aria-hidden="true" style={ICON_TILE("#EBE8F4")}>💰</span>
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div style={SECT_TITLE}>Project cost breakdown</div>
                              <div style={SECT_SUB}>What the booking costs Ambria, before overheads. {rows.length} line{rows.length===1?"":"s"}.</div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:17,fontWeight:750,color:INK,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>{fmt(baseCost)}</div>
                              <div style={{fontSize:11,color:INK_3,marginTop:2}}>base cost</div>
                            </div>
                            {chev(sBreak.open)}
                          </div>
                          {sBreak.open && <div style={{padding:"10px 15px 12px",display:"flex",flexDirection:"column",gap:2}}>
                            {rows.map((r, i) => (
                              <div key={i} className="dc2-hd" style={{display:"flex",alignItems:"center",gap:10,padding:"7px 8px",borderRadius:9,cursor:"default"}}>
                                <span aria-hidden="true" style={{width:24,height:24,borderRadius:7,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`}}>{r.icon}</span>
                                <div style={{flex:"1 1 auto",minWidth:0}}>
                                  <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                                    <span style={{fontSize:12.5,fontWeight:600,color:INK,letterSpacing:-0.1}}>{r.label}</span>
                                    {r.flag && (
                                      <span title={r.note || undefined} style={{fontSize:9,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"2px 7px",borderRadius:999,background:GOLD_SOFT,color:GOLD,border:`1px solid ${GOLD}33`,whiteSpace:"nowrap",cursor:"help"}}>{r.flag}</span>
                                    )}
                                  </div>
                                  {r.note && <div style={{fontSize:10.5,color:INK_3,marginTop:2,...NUM}}>{r.note}</div>}
                                </div>
                                <span style={{flexShrink:0,fontSize:13,fontWeight:650,color:r.value>0?INK:INK_3,letterSpacing:-0.2,...NUM}}>{fmt(r.value)}</span>
                              </div>
                            ))}
                            <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 8px 3px",marginTop:4,borderTop:`1px solid ${HAIRLINE}`}}>
                              <span style={{flex:"1 1 auto",fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase"}}>Base cost</span>
                              <span style={{fontSize:15,fontWeight:750,color:INK,letterSpacing:-0.35,...NUM}}>{fmt(baseCost)}</span>
                            </div>
                          </div>}
                        </div>
                      </div>

                      {/* ── OVERHEADS ── */}
                      <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                        <div aria-hidden="true" style={{width:4,flexShrink:0,background:"#C6A55E"}} />
                        <div style={{flex:"1 1 auto",minWidth:0}}>
                          <div onClick={sOver.toggle} className="dc2-hd" style={headStyle(sOver.open)}>
                            <span aria-hidden="true" style={ICON_TILE("#F7F1E0")}>🏢</span>
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div style={SECT_TITLE}>GYV fixed &amp; buffer</div>
                              <div style={SECT_SUB}>Both are a percentage of base cost, added on top and carried into the project total in the bottom strip.</div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:17,fontWeight:750,color:INK,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>{fmt(grandWithOverheads)}</div>
                              <div style={{fontSize:11,color:INK_3,marginTop:2}}>project total</div>
                            </div>
                            {chev(sOver.open)}
                          </div>
                          {sOver.open && <div style={{padding:"12px 15px 14px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
                            {[
                              { k: "GYV fixed", pct: gyvPct, v: gyvCost },
                              { k: "Buffer", pct: bufferPct, v: bufferCost },
                            ].map(o => (
                              <div key={o.k} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,padding:"10px 12px"}}>
                                <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                                  <span style={{flex:"1 1 auto",fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase"}}>{o.k}</span>
                                  <span style={{fontSize:10,fontWeight:700,color:INK_3,...NUM}}>{o.pct}%</span>
                                </div>
                                <div style={{fontSize:17,fontWeight:750,color:INK,letterSpacing:-0.45,lineHeight:1.1,marginTop:6,...NUM}}>{fmt(o.v)}</div>
                                <div style={{fontSize:10,color:INK_3,marginTop:3,...NUM}}>{o.pct}% of {fmt(baseCost)}</div>
                              </div>
                            ))}
                          </div>}
                        </div>
                      </div>

                      {/* ── PROFITABILITY ── */}
                      <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                        <div aria-hidden="true" style={{width:4,flexShrink:0,background:health.ink}} />
                        <div style={{flex:"1 1 auto",minWidth:0}}>
                          <div onClick={sProfit.toggle} className="dc2-hd" style={headStyle(sProfit.open)}>
                            <span aria-hidden="true" style={ICON_TILE(health.soft)}>📊</span>
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div style={SECT_TITLE}>Net profitability</div>
                              <div style={SECT_SUB}>What is left after the project total comes out of the client quote.</div>
                            </div>
                            <span style={{flexShrink:0,fontSize:10,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"4px 10px",borderRadius:999,background:health.soft,color:health.ink,whiteSpace:"nowrap",...NUM}}>{health.label} · {profitPct}%</span>
                            {chev(sProfit.open)}
                          </div>
                          {sProfit.open && <div style={{padding:"12px 15px 14px",display:"flex",flexDirection:"column",gap:12}}>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
                              {[
                                { k: "Client quote", sub: Number(cli?.negotiatedAmount) > 0 ? "negotiated" : "from Build screen", v: fmt(quote), tone: INK },
                                { k: "Internal cost", sub: "incl. GYV + buffer", v: fmt(grandWithOverheads), tone: INK },
                                { k: "Net profit", sub: `${profitPct}% margin`, v: `${netProfit < 0 ? "−" : ""}${fmt(Math.abs(netProfit))}`, tone: health.ink },
                              ].map(x => (
                                <div key={x.k} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,padding:"10px 12px"}}>
                                  <div style={{fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase"}}>{x.k}</div>
                                  <div style={{fontSize:17,fontWeight:750,color:x.tone,letterSpacing:-0.45,lineHeight:1.1,marginTop:6,...NUM}}>{x.v}</div>
                                  <div style={{fontSize:10,color:INK_3,marginTop:3}}>{x.sub}</div>
                                </div>
                              ))}
                            </div>
                            {/* The bar is the only thing on this tab that shows margin as a
                                magnitude rather than a number — worth keeping, but it needs to say
                                what full width MEANS, which it never did. */}
                            <div>
                              <div style={{height:7,borderRadius:999,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,overflow:"hidden"}}>
                                <div style={{height:"100%",background:health.ink,width:`${Math.min(100,Math.max(0,profitPct))}%`,transition:"width 0.3s ease"}}/>
                              </div>
                              <div style={{display:"flex",justifyContent:"space-between",gap:10,marginTop:7,fontSize:11,color:INK_3,flexWrap:"wrap",...NUM}}>
                                <span>Most a salesperson can discount before this deal stops making money: <strong style={{color:health.ink,fontWeight:700}}>{Math.max(0, profitPct)}%</strong></span>
                                <span>Bar is margin against a 100% scale</span>
                              </div>
                            </div>
                          </div>}
                        </div>
                      </div>

                      {/* ═══ Smart Quote Calculator — salesperson adjusts margin to get revised quote ═══ */}
                      {(()=>{
                        const internalCost = grandWithOverheads;
                        const origQuote = quote;
                        const origProfitPct = origQuote > 0 ? Math.round(((origQuote - internalCost) / origQuote) * 100) : 0;
                        const desiredPct = dcDesiredMargin !== null ? dcDesiredMargin : origProfitPct;
                        const revisedQuote = desiredPct < 100 ? Math.round(internalCost / (1 - desiredPct / 100)) : internalCost;
                        const discount = origQuote - revisedQuote;
                        const discountPct = origQuote > 0 ? Math.round((discount / origQuote) * 100) : 0;
                        const rev = desiredPct >= 20 ? GOOD : desiredPct >= 10 ? GOLD : BAD;
                        const revSoft = desiredPct >= 20 ? GOOD_SOFT : desiredPct >= 10 ? GOLD_SOFT : BAD_SOFT;
                        const presets = [5, 10, 15, 20, 25, 30];
                        return (
                          <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                            <div aria-hidden="true" style={{width:4,flexShrink:0,background:rev}} />
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div onClick={sQuote.toggle} className="dc2-hd" style={headStyle(sQuote.open)}>
                                <span aria-hidden="true" style={ICON_TILE(revSoft)}>🧮</span>
                                <div style={{flex:"1 1 auto",minWidth:0}}>
                                  <div style={SECT_TITLE}>Smart quote calculator</div>
                                  <div style={SECT_SUB}>Pick the margin you want to hold and see what the client would have to be quoted.</div>
                                </div>
                                {/* The live margin stays visible while collapsed — it is the one
                                    figure this section exists to set, and hiding it would make the
                                    fold lose information rather than merely save space. */}
                                <span style={{flexShrink:0,fontSize:15,fontWeight:750,color:rev,letterSpacing:-0.4,...NUM}}>{desiredPct}%</span>
                                {chev(sQuote.open)}
                              </div>
                              {sQuote.open && <div style={{padding:"12px 15px 14px",display:"flex",flexDirection:"column",gap:12}}>
                                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                                  {presets.map(p => {
                                    const on = desiredPct === p;
                                    return (
                                      <button key={p} onClick={()=>setDcDesiredMargin(p)} className="dc2-ghost"
                                        style={{padding:"5px 12px",borderRadius:999,cursor:"pointer",border:`1px solid ${on?INK:TILE_BORDER}`,background:on?INK:"transparent",color:on?"#FFFFFF":INK_2,fontSize:11.5,fontWeight:on?700:600,...NUM}}>{p}%</button>
                                    );
                                  })}
                                  {dcDesiredMargin !== null && (
                                    <button onClick={()=>setDcDesiredMargin(null)} className="dc2-ghost"
                                      style={{marginLeft:"auto",padding:"5px 11px",borderRadius:999,border:`1px solid ${TILE_BORDER}`,background:"transparent",color:INK_3,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>↺ Back to actual</button>
                                  )}
                                </div>
                                <div style={{display:"flex",alignItems:"center",gap:12}}>
                                  <span style={{fontSize:10.5,fontWeight:700,color:INK_2,letterSpacing:0.8,textTransform:"uppercase",whiteSpace:"nowrap"}}>Margin</span>
                                  <input type="range" min={0} max={Math.min(origProfitPct + 5, 60)} value={desiredPct} onChange={e=>setDcDesiredMargin(Number(e.target.value))} style={{flex:1,accentColor:rev}} />
                                  <span style={{fontSize:19,fontWeight:750,color:rev,minWidth:52,textAlign:"right",letterSpacing:-0.5,...NUM}}>{desiredPct}%</span>
                                </div>
                                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
                                  {[
                                    { k: "Internal cost", sub: "fixed", v: fmt(internalCost), tone: INK },
                                    { k: "Original quote", sub: origProfitPct + "% margin", v: fmt(origQuote), tone: INK },
                                    { k: `Revised at ${desiredPct}%`, sub: discount === 0 ? "same as original" : (discount > 0 ? `−${fmt(Math.abs(discount))} (${Math.abs(discountPct)}%) discount` : `+${fmt(Math.abs(discount))} (${Math.abs(discountPct)}%) increase`), v: fmt(revisedQuote), tone: rev },
                                  ].map(x => (
                                    <div key={x.k} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,padding:"10px 12px"}}>
                                      <div style={{fontSize:10.5,fontWeight:700,color:INK,letterSpacing:0.8,textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{x.k}</div>
                                      <div style={{fontSize:17,fontWeight:750,color:x.tone,letterSpacing:-0.45,lineHeight:1.1,marginTop:6,...NUM}}>{x.v}</div>
                                      <div style={{fontSize:10,color:INK_3,marginTop:3,...NUM}}>{x.sub}</div>
                                    </div>
                                  ))}
                                </div>
                                {desiredPct < 0 ? (
                                  <div style={{padding:"9px 12px",borderRadius:10,background:BAD_SOFT,border:`1px solid ${BAD}33`,fontSize:11.5,color:BAD,fontWeight:650}}>🚨 Loss-making — the quote is below what the deal costs us.</div>
                                ) : desiredPct < 5 ? (
                                  <div style={{padding:"9px 12px",borderRadius:10,background:BAD_SOFT,border:`1px solid ${BAD}33`,fontSize:11.5,color:BAD,fontWeight:650}}>⚠ Very low margin — this may not cover operational risk.</div>
                                ) : null}
                              </div>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })() : dcActiveTab === "commission" ? (() => {
                  // ═══ COMMISSION TAB — % of the deal amount set aside per venue, reads from shared
                  // dcCostRollup. The % itself is IMS master data (Admin → Master Data → Venues);
                  // the amount can be overridden per venue right here. ═══
                  const { commissionByVenue, commissionTotal, clientRevenue } = dcCostRollup;
                  const fmt2 = (n) => (n >= 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "−₹" + Math.round(Math.abs(n)).toLocaleString("en-IN"));
                  const commitOverride = (venue, value) => {
                    const nextOverrides = { ...(cli?.commissionOverrides || {}) };
                    if (value == null) delete nextOverrides[venue]; else nextOverrides[venue] = value;
                    saveClientLedger(clientLedger.map(c => c.id === activeClientId ? { ...c, commissionOverrides: nextOverrides } : c));
                  };
                  // Effective rate across the whole deal. With one venue this equals its own %, but
                  // with several it does not — each venue takes its own cut of its own share, so the
                  // blended rate is the only figure that answers "what is this deal paying out".
                  // It was nowhere on the screen; you had to work it out from the total yourself.
                  const effPct = clientRevenue > 0 ? (commissionTotal / clientRevenue) * 100 : 0;
                  const overriddenCount = commissionByVenue.filter(r => r.overrideVal != null).length;
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      <style>{DC_CSS}</style>

                      <div className="dc2-sum">
                        {[
                          { label: commissionByVenue.length === 1 ? "Venue" : "Venues", value: commissionByVenue.length, foot: overriddenCount ? `${overriddenCount} overridden by hand` : "all at the master rate" },
                          { label: "Deal amount", value: fmt2(clientRevenue), foot: Number(cli?.negotiatedAmount) > 0 ? "negotiated" : "from Build screen" },
                          { label: "Effective rate", value: `${effPct.toFixed(effPct % 1 === 0 ? 0 : 1)}%`, foot: commissionByVenue.length > 1 ? "blended across venues" : "of the deal amount" },
                          { label: "Total commission", value: fmt2(commissionTotal), foot: "set aside for venues", tone: GOLD },
                        ].map((s, si) => (
                          <div key={si} className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:11,boxShadow:CARD_SHADOW,padding:"9px 13px",minWidth:0}}>
                            <div style={{fontSize:9.5,fontWeight:700,letterSpacing:1,textTransform:"uppercase",color:INK_2,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.label}</div>
                            <div style={{fontSize:16.5,fontWeight:700,letterSpacing:-0.4,lineHeight:1.15,color:s.tone||INK,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",...NUM}}>{s.value}</div>
                            <div style={{fontSize:10,color:INK_3,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.foot}</div>
                          </div>
                        ))}
                      </div>

                      <div className="dc2-card" style={{background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:14,boxShadow:CARD_SHADOW,overflow:"hidden",display:"flex"}}>
                        <div aria-hidden="true" style={{width:4,flexShrink:0,background:GOLD}} />
                        <div style={{flex:"1 1 auto",minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",borderBottom:`1px solid ${HAIRLINE}`}}>
                            <span aria-hidden="true" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:36,height:36,borderRadius:10,flexShrink:0,fontSize:17,lineHeight:1,background:GOLD_SOFT}}>🤝</span>
                            <div style={{flex:"1 1 auto",minWidth:0}}>
                              <div style={{fontSize:15.5,fontWeight:700,color:INK,letterSpacing:-0.35,lineHeight:1.2}}>Venue commission</div>
                              <div style={{fontSize:11.5,color:INK_3,marginTop:3}}>
                                The rate is master data — IMS → Admin → Settings → Master Data → Venues. The amount can be overridden per venue here; clear the box to go back to the computed figure.
                              </div>
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:17,fontWeight:750,color:commissionTotal>0?INK:INK_3,letterSpacing:-0.45,lineHeight:1.1,...NUM}}>{fmt2(commissionTotal)}</div>
                              <div style={{fontSize:11,color:INK_3,marginTop:2}}>total</div>
                            </div>
                          </div>

                          {commissionByVenue.length === 0 ? (
                            <div style={{padding:"16px 15px",fontSize:12.5,color:INK_2}}>
                              <div style={{fontWeight:600,marginBottom:3,color:INK}}>No venue set yet.</div>
                              <div style={{fontSize:11.5,color:INK_3}}>Add a venue on a function in Event Info or Build, and its commission will be worked out here.</div>
                            </div>
                          ) : (
                            // auto-fit: most deals have one venue, and a lone card stranded in a
                            // third of the row would read as something failing to load.
                            <div style={{padding:"12px 15px 14px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12}}>
                              {commissionByVenue.map(r => {
                                const overridden = r.overrideVal != null;
                                const amount = overridden ? r.overrideVal : r.defaultAmt;
                                return (
                                  <div key={r.venue} className="dc2-row" style={{borderRadius:12,background:TILE_BG,border:`1px solid ${TILE_BORDER}`,overflow:"hidden",display:"flex"}}>
                                    <div aria-hidden="true" style={{width:3,flexShrink:0,background:overridden?GOLD:"#B9B2C4"}} />
                                    <div style={{flex:"1 1 auto",minWidth:0,padding:"11px 13px"}}>
                                      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                                        <span title={r.venue} style={{flex:"1 1 auto",minWidth:0,fontSize:12.5,fontWeight:650,color:INK,letterSpacing:-0.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.venue}</span>
                                        <span style={{flexShrink:0,fontSize:10,fontWeight:700,letterSpacing:0.5,padding:"2px 8px",borderRadius:999,background:CHIP_BG,color:INK_2,whiteSpace:"nowrap",...NUM}}>{r.pct}%</span>
                                      </div>
                                      <div style={{fontSize:10.5,color:INK_3,marginTop:3,...NUM}}>
                                        {r.pct}% of {fmt2(r.revenueShare)}{commissionByVenue.length > 1 ? " · this venue's share" : ""}
                                      </div>

                                      <div style={{fontSize:19,fontWeight:750,color:INK,letterSpacing:-0.5,lineHeight:1.1,marginTop:9,...NUM}}>{fmt2(amount)}</div>

                                      {/* The input is the only editable thing on this tab, so it
                                          reads as a field — labelled, on the white surface, with the
                                          rupee mark inside it — rather than as a bare box floating
                                          at the end of a sentence. */}
                                      <div style={{marginTop:9}}>
                                        <div style={{fontSize:9.5,fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",color:INK_2,marginBottom:4}}>Override amount</div>
                                        <div style={{display:"flex",alignItems:"center",gap:6,background:CARD_BG,border:`1px solid ${CARD_BORDER}`,borderRadius:9,padding:"5px 9px"}}>
                                          <span style={{fontSize:12,color:INK_3,flexShrink:0}}>₹</span>
                                          <CommissionOverrideInput
                                            defaultAmt={r.defaultAmt}
                                            overrideVal={r.overrideVal}
                                            border={CARD_BORDER}
                                            onCommit={(value) => commitOverride(r.venue, value)}
                                          />
                                        </div>
                                      </div>

                                      {/* Gold, like every other "a person set this by hand" state in
                                          Deal Check. It was an amber parenthetical mid-sentence. */}
                                      {overridden && (
                                        <div title={`System-computed amount is ${fmt2(r.defaultAmt)}. Clear the box to go back to it.`}
                                          style={{marginTop:9,display:"inline-flex",alignItems:"center",gap:5,fontSize:9.5,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",padding:"3px 8px",borderRadius:999,background:GOLD_SOFT,color:GOLD,border:`1px solid ${GOLD}33`,cursor:"help",...NUM}}>
                                          <span aria-hidden="true" style={{width:4,height:4,borderRadius:"50%",background:GOLD,display:"inline-block"}} />
                                          overridden · was {fmt2(r.defaultAmt)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })() : dcActiveTab === "depts" ? (() => {
                  const dd = dcCostRollup.dept || {};
                  const depts = dcCostRollup.DEPTS || [];
                  const deptIcon = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
                  const cur = dd[dcDept] || { rental: 0, florals: 0, truss: 0, fabric: 0, transport: 0, manpower: 0, production: 0, buying: 0, total: 0 };
                  const grandAll = depts.reduce((s, d) => s + (dd[d]?.total || 0), 0);
                  const f2 = (n) => n > 0 ? "₹" + Math.round(n).toLocaleString("en-IN") : "₹0";
                  const lines = [
                    ["📦 Inventory rental", cur.rental], ["🌸 Floral (mandi)", cur.florals], ["🏗️ Truss", cur.truss],
                    ["🧵 Fabric / draping", cur.fabric], ["👷 Manpower", cur.manpower], ["🏭 Production", cur.production],
                    ["🛒 Buying", cur.buying], ["🚚 Transport", cur.transport],
                  ].filter(([, v]) => v > 0);
                  const syncToOps = async () => { await (persistDeptSnapshot && persistDeptSnapshot(buildDeptSnapshot())); showMsg && showMsg("📤 Department breakdown pushed to IMS Dept Ops", "green"); };
                  return (
                    <div style={{ padding: "4px" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <span style={{ fontSize:12, color:"#1A1A2E", alignSelf: "center", marginRight: 8 }}>Auto-syncs to IMS Dept Ops</span><button onClick={syncToOps} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${accent}`, background: `${accent}18`, color: accent, fontSize:13, fontWeight: 700, cursor: "pointer" }}>📤 Sync now</button>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                        {depts.map(d => { const on = dcDept === d; const t = dd[d]?.total || 0; return (
                          <button key={d} onClick={() => setDcDept(d)} style={{ padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${on ? accent : border}`, background: on ? `${accent}18` : "transparent", color: on ? "#1A1A2E" : textS, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, minWidth: 96, alignItems: "flex-start" }}>
                            <span style={{ fontSize:13, fontWeight: on ? 700 : 500 }}>{deptIcon[d] || "🏦"} {d}</span>
                            <span style={{ fontSize:14.5, fontWeight: 800, color: on ? "#1A1A2E" : textP }}>{f2(t)}</span>
                          </button>); })}
                      </div>
                      <div style={{ borderRadius: 10, border: `1px solid ${border}`, overflow: "hidden" }}>
                        <div style={{ padding: "10px 14px", background: "rgba(26, 26, 46,0.02)", fontSize:13.5, fontWeight: 700, color: "#1A1A2E", display: "flex", justifyContent: "space-between" }}>
                          <span>{deptIcon[dcDept]} {dcDept} — Department Income</span><span>{f2(cur.total)}</span>
                        </div>
                        {lines.length === 0
                          ? <div style={{ padding: 16, textAlign: "center", color:"#1A1A2E", fontSize:13 }}>No income for this department in the current deal.</div>
                          : lines.map(([l, v], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", borderTop: `1px solid ${border}22`, fontSize:13.5 }}><span style={{ color:"#1A1A2E" }}>{l}</span><span style={{ color: "#1A1A2E", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{f2(v)}</span></div>)}
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderTop: `1px solid ${border}`, fontSize:13, color:"#1A1A2E" }}><span>Share of project</span><span style={{ fontWeight: 700, color: accent }}>{grandAll > 0 ? Math.round((cur.total / grandAll) * 100) : 0}%</span></div>
                      </div>
                      <div style={{ fontSize:12, color:"#1A1A2E", marginTop: 10, lineHeight: 1.5 }}>General labour & supervisors are split across departments by each one's direct-income share. Truss steel → Tenting · masking/drape fabric → Fabric · platform & carpet → Tenting · genset → Lighting · everything else → by its category.</div>
                    </div>
                  );
                })() : null}
              </div>
            </div>
            {/* BOTTOM STRIP — Project total + 6 sub-cost chips + Save Draft (Patch 5: live numbers wired) */}
            {(() => {
              // ═══ Reads from shared dcCostRollup (§26.19) ═══
              const { rental, transport, genset, truss, buyTotal, produceTotal, base: total, gyvFixed, bufferCost, clientRevenue: stripRevenue, profitPct: stripProfitPct, hasActuals, effFlorals, grandActual, grand: grandProj, mpDelta, effManpower } = dcCostRollup;
              const manpower = mpDelta ? effManpower : dcCostRollup.manpower;       // reflect dept-head crew overrides
              const florals = hasActuals ? effFlorals : dcCostRollup.florals;       // show actual mandi once logged
              const grandWithOverheads = hasActuals ? grandActual : grandProj;
              const stripProfitColor = stripProfitPct >= 20 ? "#10B981" : stripProfitPct >= 10 ? "#F59E0B" : "#EF4444";
              // Until Generate has run there are no matched cards, so every rollup figure is 0 and a
              // department that genuinely costs nothing looked identical to one that was never
              // calculated — both rendered "—". Split the two: "—" means not calculated yet, "₹0"
              // means calculated and empty. Same source of truth the Inventory tab's empty state
              // uses (dcCards), but across ALL functions, since this strip sums all of them.
              const hasGenerated = Object.values(dcCards || {}).some(
                (fnCards) => fnCards && Object.keys(fnCards).length > 0
              );
              const fmt = (n) => n > 0
                ? "₹" + Math.round(n).toLocaleString("en-IN")
                : hasGenerated ? "₹0" : "—";
              const onSaveDraft = async () => {
                if (dcSavingDraft) return;
                setDcSavingDraft(true);
                try {
                  // Same conflict check as the background autosave (StudioApp.jsx's Deal Check
                  // auto-save effect) — a manual Save Draft can clobber a concurrent editor's work
                  // exactly the same way a silent autosave tick can, so it needs the same guard rather
                  // than assuming "the user clicked Save, so overwriting must be fine."
                  const curClient = clientLedger.find(c => c.id === activeClientId);
                  const baseline = dcSaveBaselineRef?.current;
                  const remoteSavedAt = curClient?.dcDraftSavedAt || 0;
                  const remoteSavedBy = curClient?.dcDraftSavedBy || null;
                  const me = authUser?.name || "—";
                  const conflict = !!(baseline && remoteSavedAt > baseline.savedAt && remoteSavedBy && remoteSavedBy !== me);
                  if (conflict) {
                    showMsg(`⚠ ${remoteSavedBy} saved changes to this deal while you were editing — Save Draft was NOT applied to avoid overwriting theirs. Reload Deal Check to see the latest before continuing.`, "red");
                    return;
                  }
                  // Persist dcCards + dcZoneState + manpower overrides onto active client record · saved via existing client ledger flow
                  const nowStamp = Date.now();
                  const ledger = clientLedger.map(c => c.id !== activeClientId ? c : ({ ...c, dcCards: dcCards, dcZoneState: dcZoneState, dcKitEdits: dcKitEdits, dcCarpetPick: dcCarpetPick, dcMpOverrides: dcMpOverrides, dcMpWinCount: dcMpWinCount, dcMpIncludeMinusOne: dcMpIncludeMinusOne, dcMpIncludeDismantle: dcMpIncludeDismantle, dcDraftSavedAt: nowStamp, dcDraftSavedBy: me }));
                  await saveClientLedger(ledger);
                  if (dcSaveBaselineRef) dcSaveBaselineRef.current = { savedAt: nowStamp, savedBy: me };
                  showMsg("✓ Deal Check draft saved", "green");
                } catch (e) { showMsg("⚠ Save failed — try again", "red"); }
                finally { setDcSavingDraft(false); }
              };
              const chips = [
                { id:"rental",   label:"Rental",   icon:"📦", value: fmt(rental),    live: true  },
                { id:"truss",    label:"Truss",    icon:"🏗️", value: fmt(truss),     live: true  },
                { id:"florals",  label:"Florals",  icon:"🌸", value: fmt(florals),   live: true  },
                { id:"transport",label:"Transport",icon:"🚚", value: fmt(Math.max(0, transport - genset)), live: true  },
                { id:"genset",   label:"Genset",   icon:"⚡", value: fmt(genset),    live: true  },
                // "(ADJUSTED)" once a dept head has edited crew in IMS Dept Ops — same flag + label
                // the GYV Fixed & Buffer tab already uses (line ~2188). Without it this chip silently
                // showed the reconciled-actuals figure with no sign it had moved off the Manpower
                // tab's own projected total, which is what the tab itself still shows.
                { id:"manpower", label: mpDelta ? "Manpower (ADJUSTED)" : "Manpower", icon:"👷", value: fmt(manpower), live: true, note: mpDelta ? `dept heads adjusted crew · projected ${fmt(dcCostRollup.manpower)}` : null },
                { id:"buy",      label:"Buy",      icon:"🛒", value: fmt(dcCustomItems.filter(c=>c.type==="buying").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0)),  live: true },
                { id:"produce",  label:"Produce",  icon:"🏭", value: fmt(dcCustomItems.filter(c=>c.type==="production").reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0)), live: true },
                { id:"gyv",      label:"GYV 5%",   icon:"🏢", value: fmt(gyvFixed),  live: true  },
                { id:"buffer",   label:"Buffer 3%",icon:"🛡️", value: fmt(bufferCost),live: true  },
              ];
              return (
                <div className="dc-glass" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 18px",borderTop:`1px solid ${border}`,gap:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                    {/* NOT THE SERIF. I set this in Cormorant because it is the screen's conclusion,
                        and that was the wrong reason to pick a face: Cormorant's default figures are
                        OLD-STYLE, so the total came out with its 3, 5 and 7 sitting below the line —
                        beautiful in a sentence, wobbly in a column of money. Even forced to lining
                        figures, a text serif's numerals are drawn to sit inside prose, not to be
                        read as an amount.
                        The sans is what a price is set in. Size and weight carry the emphasis the
                        serif was being asked for, and dc-money keeps it tabular and lining so it
                        agrees with every other figure on the screen. */}
                    <div><div className="dc-cap" style={{color:"#1A1A2E",opacity:0.62}}>Project total</div><div className="dc-money" style={{fontSize:25,fontWeight:800,color:"#1A1A2E",marginTop:1,lineHeight:1.1}}>{fmt(grandWithOverheads)}</div>{stripRevenue > 0 && <div className="dc-money" style={{fontSize:11,color:stripProfitColor,fontWeight:700,marginTop:2,letterSpacing:0.1}}>Margin {stripProfitPct}% · {fmt(stripRevenue)} quote</div>}</div>
                    <div style={{height:30,width:1,background:border}}/>
                    {chips.map(c => (
                      <div key={c.id} className="dc-chip" title={c.note ? `${c.label} — ${c.value} (${c.note})` : `${c.label} — ${c.value}`} style={{padding:"7px 11px",borderRadius:10,background:"#fff",border:`1px solid ${border}`,fontSize:12,color:"#1A1A2E",minWidth:78,opacity:c.live?1:0.5,boxShadow:"0 1px 2px rgba(26,26,46,0.04)"}}>
                        {/* Flex line rather than the emoji glued straight onto the text. An emoji
                            inside an 11px uppercase caption sets its own line height, so each tile's
                            caption sat at a slightly different height depending on which glyph it
                            drew; giving the glyph its own box and letting flex centre both keeps the
                            row of tiles level. Layout kept from the drawn-icon pass. */}
                        <div style={{fontSize:11,opacity:0.7,letterSpacing:1,textTransform:"uppercase",fontWeight:600,display:"flex",alignItems:"center",gap:5,lineHeight:1}}><span style={{fontSize:11,lineHeight:1}}>{c.icon}</span>{c.label}{!c.live&&<span style={{marginLeft:4,fontSize:9,opacity:0.7}}>D2</span>}</div>
                        {/* dc-money: tabular, so ten tiles of rupees along the bottom bar line up
                            digit-for-digit instead of each one being as wide as its own digits make
                            it. On a row of figures meant to be compared at a glance that is the
                            whole job. */}
                        <div className="dc-money" style={{fontSize:14.5,fontWeight:700,color:"#1A1A2E",marginTop:1}}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Navy with gold type, not gold with navy type. Every tile along this bar is a pale
                      card, so the one CONTROL among them should be the dark object — a gold button on
                      a cream bar was the same value as the gold rental pills up in the rows, and read
                      as another badge rather than the thing you press. */}
                  <button onClick={onSaveDraft} disabled={dcSavingDraft} className="dc-save" style={{padding:"12px 22px",borderRadius:12,border:"1px solid rgba(201,169,110,0.34)",background:dcSavingDraft?"rgba(26,26,46,0.06)":"linear-gradient(135deg,#1F1A33,#2C2350)",color:dcSavingDraft?textS:accent,fontSize:13.5,fontWeight:700,cursor:dcSavingDraft?"default":"pointer",letterSpacing:0.4,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:8,lineHeight:1,boxShadow:dcSavingDraft?"none":"0 10px 24px -14px rgba(26,26,46,0.7)"}}>{dcSavingDraft?"Saving…":<><span style={{fontSize:14,lineHeight:1}}>💾</span>Save Draft</>}</button>
                </div>
              );
            })()}
            {/* ═══ Browse-all-in-subcategory modal (§7.9.4 #5 escape hatch) ═══ */}
            {dcBrowseAllOpen && (() => {
              const { fnIdx, cardKey, subcategory, manualId, splitAdd, splitQty } = dcBrowseAllOpen;
              const items = dcInventoryCache.filter(x => String(imsField.subcategory(x)).toLowerCase().trim() === String(subcategory).toLowerCase().trim());
              const card = dcCards[fnIdx]?.[cardKey];
              // Availability (free on the event date, netted with fixed-venue locks) per item.
              const _mFns = collectAllFunctionData ? collectAllFunctionData() : [];
              const _mBlocks = (dealCheckData?.blocksByDate || {})[(_mFns[fnIdx] || {}).fnDate || clientDate] || {};
              const _mVenue = (_mFns[fnIdx] || {}).fnVenue || "";
              const _mFvC = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
              const _mSplitIds = splitAdd ? (Array.isArray(card?.split) ? card.split.filter(s=>s&&s.imsId).map(s=>s.imsId) : []) : [];
              const _mCurId = manualId ? (dcManualItems.find(x => x.manualId === manualId)?.imsId) : (splitAdd ? null : card?.imsId);
              const _mCurLabel = manualId ? (dcInventoryCache.find(i => i.id === _mCurId)?.name || "item") : (splitAdd ? "the split" : (card?.rcName || "card"));
              return (
                <div onClick={()=>setDcBrowseAllOpen(null)} style={{position:"fixed",inset:0,zIndex:9100,background:"rgba(10,10,20,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
                  <div onClick={e=>e.stopPropagation()} style={{width:"min(820px, 100%)",maxHeight:"82vh",background:"#FFFFFF",borderRadius:14,border:`1px solid ${border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                    <div style={{padding:"14px 18px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div>
                        <div style={{fontSize:14.5,fontWeight:700,color:"#1A1A2E",letterSpacing:0.2}}>Browse {subcategory}</div>
                        <div style={{fontSize:12,color:"#1A1A2E",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{items.length} items · pick one to {splitAdd?"add to":"swap into"} {_mCurLabel}</div>
                      </div>
                      <button onClick={()=>setDcBrowseAllOpen(null)} style={{padding:"6px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:"#1A1A2E",fontSize:14.5,cursor:"pointer",lineHeight:1}}>✕</button>
                    </div>
                    <div style={{padding:"14px 18px",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:10}}>
                      {items.length === 0 ? (
                        <div style={{gridColumn:"1 / -1",padding:30,textAlign:"center",color:"#1A1A2E",fontSize:13,fontStyle:"italic"}}>No items in this subcategory.</div>
                      ) : items.map(it => {
                        const photo = imsField.photos(it)[0];
                        const rental = imsField.rentalCost(it);
                        const dims = imsField.sizeText(it);
                        const hold = getActiveSoftHold(softHolds, it.id, authUser?.name, Date.now());
                        const isCurrent = splitAdd ? _mSplitIds.includes(it.id) : it.id === _mCurId;
                        const _mExclude = manualId ? { manualId } : { cardKey };
                        const _mUsedElsewhere = qtyUsedElsewhereInDealCheck(it.id, _mFns, dcCards, dcManualItems, dcKitEdits, dcInventoryCache, { fnIdx, ..._mExclude }, (_mFns[fnIdx]||{}).fnDate || clientDate);
                        const avail = Math.max(0, Math.min(getStudioAvailable(it, _mBlocks), availableAtVenue(_mFvC, _mVenue, it)) - _mUsedElsewhere);
                        const isBlocked = !isCurrent && avail <= 0;
                        return (
                          <div key={it.id} onClick={()=>{
                            if (isCurrent) { setDcBrowseAllOpen(null); return; }
                            if (isBlocked) return;
                            if (manualId) {
                              setDcManualItems(prev => prev.map(x => x.manualId === manualId ? { ...x, imsId: it.id } : x));
                            } else if (splitAdd) {
                              setDcCards(prev => {
                                const prevCard = prev[fnIdx]?.[cardKey] || {};
                                const prevSplit = Array.isArray(prevCard.split) ? prevCard.split.filter(s=>s&&s.imsId) : [];
                                return { ...prev, [fnIdx]: { ...(prev[fnIdx] || {}), [cardKey]: { ...prevCard, split: [...prevSplit, { imsId: it.id, qty: Math.max(0, splitQty || 0) }] } } };
                              });
                            } else {
                              setDcCards(prev => ({
                                ...prev,
                                [fnIdx]: { ...(prev[fnIdx] || {}), [cardKey]: { ...(prev[fnIdx]?.[cardKey] || {}), imsId: it.id, imsName: it.name, source: "manual-swap" } }
                              }));
                            }
                            setDcBrowseAllOpen(null);
                          }} style={{position:"relative",borderRadius:9,overflow:"hidden",border:isCurrent?`2px solid ${accent}`:`1px solid ${border}`,cursor:isCurrent?"default":isBlocked?"not-allowed":"pointer",background:"rgba(26, 26, 46,0.02)",opacity:hold?0.6:isBlocked?0.45:1}}>
                            {photo ? <img loading="lazy" decoding="async" src={thumbUrl(photo, 56)} alt="" style={{width:"100%",height:110,objectFit:"cover",display:"block",background:"#FAF9F6"}}/> : <div style={{width:"100%",height:110,background:"#FAF9F6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#1A1A2E"}}>?</div>}
                            <div style={{padding:"8px 9px"}}>
                              <div style={{fontSize:13,fontWeight:600,color:"#1A1A2E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                              <div style={{fontSize:12,color:"#1A1A2E",marginTop:2}}>₹{rental.toLocaleString("en-IN")}{dims&&" · "+dims}</div>
                            </div>
                            {/* Free-on-date availability badge (nets out other zones/cards in this same deal too) */}
                            <div title={isBlocked?"🚫 fully used in this event":"Free for this event"} style={{position:"absolute",bottom:38,right:5,fontSize:12,fontWeight:800,minWidth:20,textAlign:"center",background:avail>0?"rgba(16,185,129,0.92)":"rgba(239,68,68,0.92)",borderRadius:6,padding:"2px 6px",color:"#1A1A2E"}}>{avail}</div>
                            {hold && <div style={{position:"absolute",top:5,right:5,fontSize:11,background:"rgba(245,158,11,0.92)",borderRadius:4,padding:"2px 5px",color:"#0F0F1A",fontWeight:700,letterSpacing:0.3}}>⏳ {hold.salesperson}</div>}
                            {isCurrent && <div style={{position:"absolute",top:5,left:5,fontSize:11,background:`${accent}ee`,borderRadius:4,padding:"2px 5px",color:"#0F0F1A",fontWeight:700,letterSpacing:0.3}}>{splitAdd?"✓ in split":"✓ current"}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })();
}

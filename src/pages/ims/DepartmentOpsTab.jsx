import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { fmt } from "../../lib/format";
import { mpDayWise, mpBaseDay, mpEffDay, mpEffWindows, mpLineCost, mpDayCost, isLiveEventOrder } from "../../lib/ims/helpers";
import { uploadAudioToStorage } from "../../lib/storage";
import { DEPTS as SHARED_DEPTS, catToDept as sharedCatToDept, userDepartments } from "../../lib/ims/deptClassify";
import ManpowerFactorPills from "../../components/shared/ManpowerFactorPills.jsx";

// ── ONE COLUMN TRACK FOR EVERY CARD ROW ──
// The income cards and the summary tiles are separate grids that sit one above the other, so
// they have to resolve to the SAME columns or the two rows visibly disagree — which is what
// happened: the income row used auto-FIT (four cards stretched across the full width) and the
// tile row auto-FILL (five columns at a smaller minimum), so no card in the second row lined up
// with anything in the first. auto-fill on both, same minimum: a row with fewer cards leaves a
// gap at the end instead of stretching out of alignment.
const GRID = "grid gap-4 items-stretch";
const GRID_COLS = { gridTemplateColumns: "repeat(auto-fill,minmax(212px,1fr))" };

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
  if (busy) return <span className="text-[10px] text-gray-400 whitespace-nowrap">⏳ saving…</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {value && !rec && !compact && <audio src={value} controls className="h-6 max-w-[130px]" />}
      {rec
        ? <button onClick={stop} className="text-[10px] font-semibold text-white bg-red-600 rounded-full px-2 py-1 animate-pulse whitespace-nowrap">⏹ stop</button>
        : <button onClick={start} className={"text-[10px] font-semibold rounded-full px-2 py-1 border whitespace-nowrap " + (value ? "text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100" : "text-indigo-600 border-indigo-200 hover:bg-indigo-50")} title={value ? "re-record " + label : "record " + label}>🎤 {value ? "✓" : (compact ? "" : label)}</button>}
      {err && <span className="text-[10px] text-red-500">{err}</span>}
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
  Tenting: ["Painters", "Truss Labour", "Labours"],
  Fabric: ["Fabric Bangali", "Labours"],
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

export default function DepartmentOpsTab({ eventOrders, setEventOrders, inventory, setInventory, blocks, settings, setSettings, trussInv, setTrussInv, authUser, amendRequests, focusEventId, focusSearch, focusLeadEntry, onFocusHandled, onGoToCalendar }) {
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);
  const dihari = settings?.dihariSchemes || {};
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  // This user's allowed departments — an explicit grant (user.departments, set in Admin -> Users &
  // Roles) if present, else the same role-name inference this screen always used (e.g. "Dept Head
  // - Tenting" -> Tenting). null = unrestricted (sees every department), same as before this
  // existed for Admin/Sales/any role that doesn't name one.
  const myDepts = useMemo(() => userDepartments(authUser), [authUser]);
  const roleDept = myDepts && myDepts.length === 1 ? myDepts[0] : null; // the common single-dept case — locks the picker to a badge, same as before
  const deptOptions = isAdmin || !myDepts ? DEPTS : DEPTS.filter((d) => myDepts.includes(d));

  const [dept, setDept] = useState(roleDept || deptOptions[0] || "Floral");
  const [search, setSearch] = useState("");
  const [leadEntry, setLeadEntry] = useState(null); // LMS entry no of the lead we arrived from
  const [selId, setSelId] = useState(null);
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
  const modalCls = (k) => (modal === k ? "" : " hidden");
  // Escape closes, and the page behind stops scrolling while the dialog is up — without the
  // lock, a flick inside a short dialog scrolls the page underneath it instead.
  useEffect(() => {
    if (!modal && !logOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setModal(null); setLogOpen(false); } };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [modal, logOpen]);
  // Switching event or department while the log is open would leave the dialog showing another
  // context's entries — close it, since its contents are scoped to both.
  useEffect(() => { setLogOpen(false); }, [selId, dept]);
  const [mpOpen, setMpOpen] = useState({}); // which manpower rows have their derivation expanded
  const [mpDayHow, setMpDayHow] = useState({}); // which per-day rows have their "how" derivation expanded
  const [routeDraft, setRouteDraft] = useState({}); // dismantle routing draft per item: {qty, type, toEventId}
  const [manTruck, setManTruck] = useState({}); // confirm-time truck details per destination group: {[groupKey]:{vehicle,driver,phone}}
  const [manSel, setManSel] = useState({}); // which items load on THIS truck (transfer groups): {[groupKey::itemKey]:false} (default selected)
  const [manCond, setManCond] = useState({}); // on-site condition per manifest item: {[groupKey::itemKey]:{repair,broken}}
  const [manNote, setManNote] = useState({}); // on-site voice note per manifest item: {[groupKey::itemKey]:url}
  const [manOpen, setManOpen] = useState({}); // Loading-manifest destination groups: collapsed by default
  const [osMp, setOsMp] = useState({}); // on-site crew rows expanded to the per-day / per-shift editor
  const [showFleet, setShowFleet] = useState(false); // toggle the own-fleet manager
  const [newVeh, setNewVeh] = useState({ vehicle: "", driver: "", phone: "" }); // new fleet entry
  const mandiCatalogue = useMemo(() => (Array.isArray(settings?.mandiCatalogue) ? settings.mandiCatalogue : []), [settings]);

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
  const selDateStr = sel ? eventDate(sel) : "";
  // Lifted out of the activity-log block so the bell in the event header can show the count
  // without recomputing it — one query, two readers, and they cannot disagree about how many
  // changes there are.
  const recentChanges = useMemo(() => (amendRequests || [])
    .filter(r => r.eventOrderId === sel?.id && r.department === dept && r.status === "logged")
    .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
    .slice(0, 8), [amendRequests, sel, dept]);
  // Nearby events — within 7 days of the selected event.
  const nearby = useMemo(() => {
    if (!selDateStr) return [];
    const t = new Date(selDateStr + "T00:00:00").getTime();
    return events.filter(({ eo, date }) => eo.id !== selId && date && Math.abs(new Date(date + "T00:00:00").getTime() - t) <= 7 * 864e5);
  }, [events, selDateStr, selId]);

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
      const rows = deptInvSnap.map((x, i) => ({ id: x.name + i, invId: x.imsId || null, name: x.name, photo: x.photo || "", qty: x.qty || 0, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "", isKit: !!x.isKit, components: Array.isArray(x.components) ? x.components : null, shortQty: x.shortQty || 0, shortCost: x.shortCost || 0, prodOrBuy: x.prodOrBuy || null, isSwapped: swapInfo.has(x.name), swappedFrom: swapInfo.get(x.name)?.swappedFrom || null }));
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
  const hasMpSnapshot = !!(sel?.manpowerDetail && typeof sel.manpowerDetail === "object" && Object.keys(sel.manpowerDetail).length);
  const mpDetail = (sel?.manpowerDetail && Array.isArray(sel.manpowerDetail[dept])) ? sel.manpowerDetail[dept] : (hasMpSnapshot ? [] : null);
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
        ...mpExtra.filter(r => !snapTypes.has(r.type)).map(r => ({ type: r.type, count: r.count ?? "", rate: r.rate || 0, basis: "added crew", shared: false, sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true })),
      ]
    : (sysPlan.length ? sysPlan.map(p => ({ type: p.type, count: p.count, rate: p.rate || Number(dihari[p.type]?.rate) || 0, basis: p.basis || "", sysCount: p.count, sysRate: p.rate || 0, sysCost: (p.count || 0) * (p.rate || 0), days: 1, _extra: true }))
      : deptTypes.map(t => ({ type: t, count: "", rate: Number(dihari[t]?.rate) || 0, basis: "", sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true })));
  const expenses = Array.isArray(deptData.expenses) ? deptData.expenses : [];
  const realMandi = deptData.realMandi || "";

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
  const mpWinCount = (deptData.mpWinCount && typeof deptData.mpWinCount === "object") ? deptData.mpWinCount : {};
  const dayWise = mpDayWise;
  const effDay = (r, d) => mpEffDay(r, d, mpDay);
  const showDay = (r, d) => Math.round(effDay(r, d));
  const dayOv = (r, d) => { const ov = mpDay[r.type]; return !!(ov && ov[d.date] != null && Number(ov[d.date]) !== Math.round(mpBaseDay(r, d))); };
  const effWinIds = (r, d) => { const ov = mpWin[r.type]; return ov && ov[d.date] != null ? ov[d.date] : (Array.isArray(d.windowIds) ? d.windowIds : []); };
  const effWin = (r, d) => mpEffWindows(r, d, mpWin);
  const setMpDay = (type, date, val) => saveDept({ mpDay: { ...mpDay, [type]: { ...(mpDay[type] || {}), [date]: val } } });
  const setMpAllDays = (type, schedule, val) => { const m = { ...(mpDay[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = val; }); saveDept({ mpDay: { ...mpDay, [type]: m } }); };
  const toggleWin = (type, date, winId, curIds) => { const next = curIds.includes(winId) ? curIds.filter(x => x !== winId) : [...curIds, winId]; saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: next } } }); };
  const setWinAllDays = (type, schedule, ids) => { const m = { ...(mpWin[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = ids; }); saveDept({ mpWin: { ...mpWin, [type]: m } }); };
  // Set the crew for ONE shift on ONE day (per-shift split). Ensures that window is marked worked.
  const setShiftCount = (type, date, winId, val, curIds) => { const n = Math.max(0, Number(val) || 0); const t = { ...(mpWinCount[type] || {}) }; t[date] = { ...(t[date] || {}), [winId]: n }; const patch = { mpWinCount: { ...mpWinCount, [type]: t } }; if (Array.isArray(curIds) && !curIds.includes(winId)) patch.mpWin = { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: [...curIds, winId] } }; saveDept(patch); };
  const effShift = (r, d, winId) => { const wc = mpWinCount[r.type] && mpWinCount[r.type][d.date]; if (wc && wc[winId] != null) return Number(wc[winId]); const sc = d && d.winCount; if (sc && sc[winId] != null) return Number(sc[winId]); return Math.round(effDay(r, d)); }; // head override → Deal Check per-shift (schedule.winCount) → day count
  // Add another dihari (shift) to a day — the next unused scheme window, else a synthetic slot — so ops
  // can split a single day into e.g. 2 crew in the day shift + 1 in the evening (each shift billed).
  const addDihari = (r, date, curIds) => { const wins = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : []; const unused = wins.find(w => !curIds.includes(w.id)); const id = unused ? unused.id : ("x" + Date.now()); const t = { ...(mpWinCount[r.type] || {}) }; t[date] = { ...(t[date] || {}), [id]: 1 }; saveDept({ mpWin: { ...mpWin, [r.type]: { ...(mpWin[r.type] || {}), [date]: [...curIds, id] } }, mpWinCount: { ...mpWinCount, [r.type]: t } }); };
  const removeDihari = (type, date, slotId, curIds) => { const t = { ...(mpWinCount[type] || {}) }; if (t[date]) { const dd = { ...t[date] }; delete dd[slotId]; t[date] = dd; } saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: curIds.filter(x => x !== slotId) } }, mpWinCount: { ...mpWinCount, [type]: t } }); };
  const lineCost = (r) => mpLineCost(r, mpDay, mpOverrides, mpWin, mpWinCount);
  const mpCost = mpRows.reduce((s, r) => s + lineCost(r), 0);
  const mpPlannedCost = mpRows.reduce((s, r) => s + (Number(r.sysCost) || 0), 0); // system baseline (before edits)
  // ── Event-wide Labours total. Ops runs the whole event, so he sets the TOTAL labour headcount and the
  // system re-splits it across every department by their existing usage share (scale each dept's per-day
  // labour by newTotal/currentTotal). Writes each dept's mpDay → flows via the normal reconciliation. ──
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
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const realMandiNum = Number(realMandi) || 0;
  const projectedIncome = Math.round(deptIncome ? (Number(deptIncome.total) || 0) : (rentalIncome + mpCost)); // full dept income from Deal Check, else local

  const setMp = (i, key, val) => {
    const row = mpRows[i]; if (!row) return;
    if (row._extra) {
      const base = Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra;
      const idx = base.findIndex(r => r.type === row.type);
      const next = base.slice();
      if (idx >= 0) next[idx] = { ...next[idx], [key]: val }; else next.push({ type: row.type, count: row.count, rate: row.rate, [key]: val });
      saveDept({ mpExtra: next });
    } else {
      saveDept({ mpOverrides: { ...mpOverrides, [row.type]: { ...(mpOverrides[row.type] || {}), [key]: val } } });
    }
  };
  const addMp = () => saveDept({ mpExtra: [...(Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra), { type: "Labours", count: "", rate: Number(dihari["Labours"]?.rate) || 0 }] });
  // On-site actual crew: set the real head-count held (applies to every scheduled day for day-wise crew,
  // else a straight count override) → flows to the P&L + Studio via the same mpDay/mpOverrides fields.
  const setActualCrew = (r, i, val) => { const n = Math.max(0, Number(val) || 0); if (mpDayWise(r) && Array.isArray(r.schedule) && r.schedule.length) { const m = { ...(mpDay[r.type] || {}) }; r.schedule.forEach(d => { m[d.date] = n; }); const wc = { ...mpWinCount }; delete wc[r.type]; saveDept({ mpDay: { ...mpDay, [r.type]: m }, mpWinCount: wc }); } else setMp(i, "count", n); };
  const resetMpLine = (r) => { const nd = { ...mpDay }; delete nd[r.type]; const nw = { ...mpWin }; delete nw[r.type]; const no = { ...mpOverrides }; delete no[r.type]; const wc = { ...mpWinCount }; delete wc[r.type]; saveDept({ mpDay: nd, mpWin: nw, mpOverrides: no, mpWinCount: wc }); };
  const addExpense = () => saveDept({ expenses: [...expenses, { label: "", amount: "" }] });
  const setExpense = (i, key, val) => { const next = expenses.map((e, j) => j === i ? { ...e, [key]: val } : e); saveDept({ expenses: next }); };
  const delExpense = (i) => saveDept({ expenses: expenses.filter((_, j) => j !== i) });

  // ── Floral: editable real-mandi shopping list (projected vs actual, side-by-side) ──
  const fp = sel?.floralPlan || {};
  const fpFlowers = Array.isArray(fp.flowers) ? fp.flowers : [];
  const artificialProj = fpFlowers.filter(f => f.artificial).reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const seedMandi = fpFlowers.filter(f => !f.artificial && (Number(f.qty) || 0) > 0)
    .map(f => ({ name: f.name, unit: f.unit || "", projQty: Number(f.qty) || 0, projCost: Number(f.cost) || 0, qty: Number(f.qty) || 0, price: f.qty ? Math.round(((Number(f.cost) || 0) / f.qty) * 100) / 100 : 0 }));
  const mandiRows = Array.isArray(deptData.mandiLines) ? deptData.mandiLines : seedMandi;
  const mandiActualReal = mandiRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const mandiActualTotal = mandiActualReal + artificialProj; // artificial carried over (not re-shopped at mandi)
  const projMandiReal = mandiRows.reduce((s, r) => s + (Number(r.projCost) || 0), 0);
  // Persist the list AND the headline actual (realMandi) so Studio's P&L reflection picks it up.
  const saveMandi = (next) => saveDept({ mandiLines: next, realMandi: next.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0) + artificialProj });
  const setMandi = (i, key, val) => saveMandi(mandiRows.map((r, j) => j === i ? { ...r, [key]: val } : r));
  const delMandi = (i) => saveMandi(mandiRows.filter((_, j) => j !== i));
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
  const delTool = (i) => saveTools(deptTools.filter((_, j) => j !== i));

  const loaded = (deptData.loaded && typeof deptData.loaded === "object") ? deptData.loaded : {};
  const toggleLoaded = (key) => saveDept({ loaded: { ...loaded, [key]: !loaded[key] } });
  const loadKeys = [...blockedItems.map(it => "inv:" + it.id), ...deptTools.map(t => "tool:" + t.name)];
  const totalLoadItems = loadKeys.length;
  const loadedCount = loadKeys.filter(k => loaded[k]).length;
  const dispatch = deptData.dispatch || { vehicle: "", driver: "", phone: "" };
  const setDispatch = (key, val) => saveDept({ dispatch: { ...dispatch, [key]: val } });
  // ── Multi-truck dispatch — inventory goes out across several trucks, each with its own challan ──
  const TRUCK_STATUS = ["loading", "dispatched", "at-site", "returned"];
  const trucks = Array.isArray(deptData.trucks) ? deptData.trucks : [];
  const addTruck = () => saveDept({ trucks: [...trucks, { id: "trk_" + Date.now(), vehicle: "", driver: "", phone: "", status: "loading", items: {} }] });
  const setTruck = (id, patch) => saveDept({ trucks: trucks.map(t => t.id === id ? { ...t, ...patch } : t) });
  const setTruckItem = (id, key, qty) => saveDept({ trucks: trucks.map(t => t.id === id ? { ...t, items: { ...(t.items || {}), [key]: qty } } : t) });
  const delTruck = (id) => saveDept({ trucks: trucks.filter(t => t.id !== id) });
  const truckLoadedQty = (key) => trucks.reduce((s, t) => s + (Number(t.items?.[key]) || 0), 0); // total loaded across all trucks
  const printTruckChallan = (truck, n) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = blockedItems.filter(it => (Number(truck.items?.["inv:" + it.id]) || 0) > 0)
      .map(it => `<tr><td>${it.name}</td><td>${it.sub || "—"}</td><td style="text-align:center">${Number(truck.items["inv:" + it.id]) || 0} of ${it.qty}</td></tr>`).join("");
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
      (Array.isArray(od?.movements) ? od.movements : []).forEach(m => add(m.vehicle, m.driver, m.phone));
      if (od?.dispatch) add(od.dispatch.vehicle, od.dispatch.driver, od.dispatch.phone);
    });
    return [...map.values()];
  }, [settings, sel]);
  const saveFleet = (next) => setSettings && setSettings(s => ({ ...s, fleet: next }));
  const pickFleet = (f) => saveDept({ dispatch: { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" } });
  const addFleet = () => { const v = (newVeh.vehicle || "").trim(); if (!v) return; saveFleet([...fleet, { id: "veh_" + Date.now(), vehicle: v, driver: (newVeh.driver || "").trim(), phone: (newVeh.phone || "").trim() }]); setNewVeh({ vehicle: "", driver: "", phone: "" }); };
  const delFleet = (id) => saveFleet(fleet.filter(f => f.id !== id));

  // Actual spend logged by the head → exact P&L (mandi list + on-site expenses + edited crew).
  const mandiSpend = dept === "Floral" ? mandiActualTotal : 0;
  const actualCost = mandiSpend + expenseTotal + mpCost;
  const hasActuals = mandiSpend > 0 || expenseTotal > 0 || mpEdited;

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
  const delMovement = (id) => {
    const mv = movements.find(m => m.id === id);
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
  // TESTING: wipe the dept-head plan + all on-site movements for this dept/event so the split flow can
  // be re-tried without making a new client. Restores stock for any "broken" write-offs first.
  const resetDismantle = () => {
    if (!sel) return;
    if (!window.confirm(`Reset the dismantle plan AND all on-site movements for ${sel.clientName || "this event"} · ${dept}? (for testing)`)) return;
    movements.filter(m => m.type === "damage").forEach(m => adjustInventory(m.invId, +(Number(m.qty) || 0)));
    saveDept({ dismantlePlan: {}, movements: [], dismantleSites: [] });
    setManTruck({}); setManSel({}); setManCond({}); setRouteDraft({});
  };
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
    { key: "liza", label: "Liza Fabric", stockKey: "lizaStock", qtyField: "stockKg", unit: "kg", emoji: "🪡" },
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
  const fabricReqRows = (dept === "Fabric" && sel?.fabricPlan) ? FABRIC_TYPES.map(ft => {
    const req = Array.isArray(sel.fabricPlan[ft.key]) ? sel.fabricPlan[ft.key] : [];
    const rows = req.map(r => {
      const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 };
      const stock = av.old + av.new;
      const otherDay = sameDayReserved(selDateStr, sel.id, ft.key, r.colour);
      const avail = Math.max(0, stock - otherDay);
      return { colour: r.colour, required: r.qty, old: av.old, new: av.new, stock, otherDay, avail, short: Math.max(0, r.qty - avail) };
    });
    return { ...ft, rows };
  }).filter(f => f.rows.length) : [];
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
          if (short > 0) out.push({ event: eo.clientName || "Event", date: d, fabric: ft.label, colour: r.colour, short, unit: ft.unit, contended: otherDay > 0 });
        });
      });
    });
    return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [dept, eventOrders, fabricAvail, today]);

  // Derivation box for a crew type — same pattern as Deal Check's "HOW … DERIVED".
  const renderMpTrace = (t) => {
    if (!t) return null;
    if (t.kind === "tier2" && Array.isArray(t.rows) && t.rows.length > 0) return (
      <div className="mb-1.5 bg-white border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1 bg-gray-100 text-[10px] uppercase tracking-wide text-gray-500 font-semibold"><span>{t.perRow ? "Recipe / item" : "Sub-category"}</span><span className="text-right w-12">{t.countLabel || "Count"}</span><span className="text-right w-12">Batch</span><span className="text-right w-12">Need</span></div>
        {t.rows.map((tr, ti) => (<div key={ti} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-0.5 text-[10px] text-gray-700"><span className="truncate" title={tr.sub}>{tr.sub}</span><span className="text-right w-12">{tr.count}</span><span className="text-right w-12 text-gray-400">÷{tr.batch}</span><span className="text-right w-12 font-semibold">{tr.need.toFixed(2)}</span></div>))}
        <div className="px-2 py-1 bg-gray-50 text-[10px] text-right text-gray-600 border-t">{t.perRow ? <>Σ each ⌈need⌉ = <b className="text-gray-900">{t.result}</b></> : <>Σ {t.need.toFixed(2)} → ⌈ {Math.ceil(t.need)} ⌉ · max(min {t.min}) = <b className="text-gray-900">{t.result}</b></>}</div>
      </div>
    );
    if (t.kind === "pillars") return <div className="mb-1.5 text-[10px] text-gray-600">🏗️ {t.total} pillar(s){t.zoneP ? ` — ${t.zoneP} from truss tool${t.recipeP ? `, ${t.recipeP} from build` : ""}` : ""} → range → <b>{t.result}</b></div>;
    if (t.kind === "ratio") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.num} {t.numLabel} ÷ {t.denomLabel} = <b>{t.result}</b></div>;
    if (t.kind === "range") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.value} {t.unit} → range → <b>{t.result}</b></div>;
    // "labours" is a frozen snapshot captured at booking time (StudioApp.jsx) — it only stores the
    // COMBINED situational multiplier (season/timing maxed together), not the individual dumping/
    // saya/timing factors ManpowerTab.jsx's live Tier-3 breakdown exposes, so the pill display here
    // is necessarily a simpler "what we know" version rather than the full Setup-Access/Dumping-Space
    // breakdown — that granularity isn't in the stored data to show honestly.
    if (t.kind === "labours") return (
      <div className="mb-1.5 space-y-1">
        <ManpowerFactorPills mode="generic" label="Labours" baseQty={t.venueMin}
          qty={t.result}
          sitMult={{ factors: [{ label: "📐 Venue-min situational", mult: t.mult }], cappedMult: t.mult, rawMult: t.mult, capped: false }} />
        {t.heavy > 0 && <div className="text-[10px] text-gray-500 px-1">+ {t.heavy} heavy-element add-on</div>}
      </div>
    );
    if (t.kind === "fixed") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.note} = <b>{t.result}</b>{" "}(before split)</div>;
    return null;
  };
  // Day-wise plan (which days × crew × which dihari shift windows) — mirrors Deal Check's day/timing
  // breakdown, but editable here: the dept head can change crew per day AND toggle each day's shifts.
  const phaseLbl = (d) => d.phase === "minusOne" ? "−1 setup" : d.phase === "dismantle" ? "+1 dismantle" : d.phase === "gap" ? "gap" : (d.date || "event");
  const renderMpSchedule = (r) => {
    const sch = r && r.schedule;
    if (!Array.isArray(sch) || !sch.length) return null;
    const editable = dayWise(r);
    const winDefs = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : [];
    const totalDihari = sch.reduce((s, d) => s + effDay(r, d) * effWin(r, d), 0);
    return (
      <div className="mt-1.5 bg-white border rounded-lg p-2 text-[10px] text-gray-600">
        <div className="font-semibold text-gray-500 mb-0.5">📅 Day-wise plan (crew × dihari shifts){editable ? (r.shared ? " — edit this dept's crew & timings per day" : " — edit crew & timings per day") : ""}</div>
        <div className="text-[10px] text-gray-400 mb-1">🔼 Cumulative-max rule: crew only scales <b>up</b> across the booking — each day holds the max of its own need and any busier earlier day (it never drops mid-event). Open a day's <b>how</b> to see its own requirement; edit any day if you disagree.</div>
        {sch.map((d, i) => {
          const ov = editable && dayOv(r, d);
          const ids = effWinIds(r, d);
          const shifts = effWin(r, d);
          const dayKey = `${r.type}|${d.date}`;
          const howOpen = !!mpDayHow[dayKey];
          const hasShare = r.shared && d.share != null;
          return (
            <div key={i} className="py-1 border-b last:border-b-0">
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5">
                  <button onClick={() => setMpDayHow(o => ({ ...o, [dayKey]: !o[dayKey] }))} className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded px-1 leading-tight" title="How this day's crew was calculated">{howOpen ? "▾" : "▸"} how</button>
                  <span className="font-medium text-gray-700">{phaseLbl(d)}</span>
                </span>
                <span className="flex items-center gap-1">
                  {editable
                    ? <input type="number" min="0" value={showDay(r, d)} onChange={e => setMpDay(r.type, d.date, e.target.value)} className={"w-10 border rounded px-1 py-0.5 text-[10px] text-center " + (ov ? "border-amber-400 bg-amber-50 font-bold" : "")} />
                    : <b>{d.count}</b>}
                  crew × {shifts} shift{shifts === 1 ? "" : "s"}
                </span>
              </div>
              {/* Per-dihari (per-shift) crew — dept head can hold different crew per shift (e.g. 6 in the day
                  shift, 3 in the evening). Same mpWinCount data + cost model as the on-site editor → synced. */}
              {winDefs.length > 0 && editable && (Array.isArray(d.windowIds) || (mpWin[r.type] && mpWin[r.type][d.date] != null)) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-gray-400">per shift:</span>
                  {ids.map((id, si) => { const wd = winDefs.find(w => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`; return (
                    <span key={id} className="inline-flex items-center gap-1 border rounded px-1 py-0.5 bg-white">
                      <span className="text-[10px] text-gray-400">{lbl}</span>
                      <input type="number" min="0" value={effShift(r, d, id)} onChange={e => setShiftCount(r.type, d.date, id, e.target.value, ids)} className="w-9 border rounded px-1 py-0.5 text-[10px] text-center" />
                      {ids.length > 1 && <button onClick={() => removeDihari(r.type, d.date, id, ids)} className="text-red-300 hover:text-red-500 text-[10px]" title="remove this dihari">×</button>}
                    </span>
                  ); })}
                  <button onClick={() => addDihari(r, d.date, ids)} className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-full px-1.5 py-0.5" title="Add another dihari (shift) this day">+ dihari</button>
                </div>
              )}
              {winDefs.length > 0 && !editable && (Array.isArray(d.windowIds) || (mpWin[r.type] && mpWin[r.type][d.date] != null)) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {winDefs.map(w => { const on = ids.includes(w.id); return <span key={w.id} className={"px-1.5 py-0.5 rounded-full border text-[10px] " + (on ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-gray-100 text-gray-300")}>{on ? "✓ " : ""}{w.label}{on ? ` ${effShift(r, d, w.id)}` : ""}</span>; })}
                </div>
              )}
              {howOpen && (
                <div className="mt-1 bg-gray-50 border rounded-lg p-2">
                  {d.trace ? renderMpTrace(d.trace)
                    : <div className="text-[10px] text-gray-500 mb-1">{d.phase === "minusOne" ? "⏮️ −1 setup — full crew staged early (peak of all functions)." : d.phase === "dismantle" ? "🧹 dismantle day — crew carried from the event." : "⏸️ gap day — crew carried from the previous day."}</div>}
                  {d.trace && Number(d.trace.result) > 0 && Number(d.trace.result) < Number(d.count) && (
                    <div className="text-[10px] text-amber-600 mt-1">🔼 Cumulative-max: this day's own need is <b>{d.trace.result}</b>, but crew is held at <b>{d.count}</b> (carried from a busier day — crew only scales up).</div>
                  )}
                  {hasShare && (
                    <div className="text-[10px] text-gray-600 bg-white border rounded p-1.5">
                      Bifurcation: <b>{d.count}</b> total {r.type} this day × <b>{Math.round((Number(d.share) || 0) * 100)}%</b> ({dept}'s usage this day) = <b className="text-gray-900">{(d.count * (Number(d.share) || 0)).toFixed(2)}</b> → {Math.round(effDay(r, d))} crew to {dept}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="mt-1 pt-1 text-right">= <b className="text-gray-800">{Math.round(totalDihari)} dihari</b> · line {fmt(lineCost(r))}</div>
      </div>
    );
  };

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
       1484px is exactly what the two columns below add up to: the 288px rail (xl:w-72) + the
       16px gap (gap-4) + the 1180px cap on the detail column. Without it the department bar
       stretched to the full shell width while everything under it stopped short, so the bar
       overhung the page by however much room the monitor had spare.
       The cap lives here rather than on the bar so the two can never drift apart — change the
       rail width or the reading cap and this number is the one place to update. */
    <div className="space-y-4 xl:max-w-[1484px]">
      {/* ── DEPARTMENT PICKER ──
          Was a <select> buried at the top of the left rail. A dropdown hides its options until
          you open it, so the one thing that scopes this entire page — every figure, every tile,
          every dialog below it — gave no indication of what else it could be showing. Laid out
          flat, the whole set is readable and switching is one click instead of two.
          It sits above the columns rather than inside the rail because it scopes BOTH of them.
          The permission rule is carried over exactly: a user with a single department still gets
          a static badge, because there is nothing for them to switch to. */}
      {/* w-fit so the bar ends where the last department does. As a block element it stretched
          to the full 1484px measure, leaving most of it empty white — a panel the width of the
          page reads as a section header rather than as the control it is.
          max-w-full keeps it inside the page on narrow screens, where the inner overflow-x
          takes over and the chips scroll instead. */}
      <div className="w-fit max-w-full bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] px-3 py-2">
        {/* Scrolls sideways rather than wrapping to a second row: eight departments at a phone
            width would otherwise turn a one-line control into a four-line block. Bar hidden, as
            everywhere else on this page. */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400 pr-1.5">Department</span>
          {roleDept && !isAdmin ? (
            <span className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-semibold whitespace-nowrap">{DEPT_ICON[roleDept]} {roleDept}</span>
          ) : deptOptions.map(d => {
            const on = dept === d;
            return (
              <button key={d} onClick={() => setDept(d)} aria-current={on ? "true" : undefined}
                className={"shrink-0 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-150 " +
                  (on
                    ? "bg-indigo-50 text-indigo-700 font-semibold shadow-[0_1px_2px_rgba(79,70,229,0.14),0_4px_10px_-4px_rgba(79,70,229,0.3)]"
                    : "text-gray-600 font-medium hover:text-gray-900 hover:bg-gray-50 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_-6px_rgba(16,24,40,0.2)]")}>
                {DEPT_ICON[d]} {d}
              </button>
            );
          })}
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
      <div className="w-full min-w-0 xl:max-w-[1180px]">
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
                  end, so it has to read as the way out — indigo text on white was competing
                  with the body copy above it and losing.
                  The link carries the client name and, when we know it, the LMS entry number.
                  Studio sets those into its client-name field, which is what already drives its
                  LMS lead search, then loads the named contract through its own "Load →" path —
                  so the Event Info form opens filled in, not blank. */}
              <a href={`${import.meta.env.BASE_URL}#/studio?client=${encodeURIComponent(search.trim())}${leadEntry ? `&lmsRef=${encodeURIComponent(leadEntry)}` : ""}`}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(79,70,229,0.3),0_6px_16px_-6px_rgba(79,70,229,0.6)] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(79,70,229,0.3),0_12px_24px_-8px_rgba(79,70,229,0.65)] transition-all duration-150">
                <span aria-hidden="true">🎨</span>
                Build this deal in Studio
                <span aria-hidden="true">→</span>
              </a>
            </div>
          ) : (
            /* With the event rail gone, the Calendar is the only place an event is chosen — so
               the empty state has to send you there rather than say "select an event" beside a
               page that no longer has anything to select from. */
            <div className="max-w-md mx-auto text-center py-16 px-4">
              <div aria-hidden="true" className="text-3xl">📅</div>
              <div className="mt-3 text-sm font-semibold text-gray-800">No event picked yet</div>
              <div className="mt-2 text-xs text-gray-500 leading-relaxed">
                Open the Calendar, click a date, then click the event on it — this page will show
                that event&apos;s {DEPT_ICON[dept]} {dept} requirements, income and P&amp;L.
              </div>
              {onGoToCalendar && (
                <button onClick={onGoToCalendar}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(79,70,229,0.3),0_6px_16px_-6px_rgba(79,70,229,0.6)] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(79,70,229,0.3),0_12px_24px_-8px_rgba(79,70,229,0.65)] transition-all duration-150">
                  <span aria-hidden="true">📅</span>
                  Pick an event from the Calendar
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
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
            <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] px-4 py-3 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span aria-hidden="true" className="shrink-0 w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center text-xl leading-none">{DEPT_ICON[dept]}</span>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-gray-900 truncate">{dept} — {sel.clientName || "Event"}</div>
                  <div className="text-xs text-gray-500 truncate">{selDateStr || "no date"} · {sel.functionsDetail?.[0]?.venue || sel.venue || "—"}{deptData.updatedBy ? ` · last edited by ${deptData.updatedBy}` : ""}</div>
                  {/* Deal value — read-only mirror of Studio's negotiated amount (client_ledger),
                      written whenever Deal Check syncs. It stays frozen once booked by owner decision;
                      "pending" is the live build's drift since booking, shown here so ops sees the same
                      number Studio does, but only Studio can fold it into the deal value (Apply button
                      on the Summary hero) — this view has no action for it. */}
                  {sel.dealValue && (
                    <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-700">💰 Deal value: ₹{Number(sel.dealValue.amount || 0).toLocaleString("en-IN")}</span>
                      {!!sel.dealValue.pending && (
                        <span className={"font-bold px-1.5 py-0.5 rounded text-[11px] " + (sel.dealValue.pending > 0 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                          {sel.dealValue.pending > 0 ? "+" : ""}₹{Number(sel.dealValue.pending).toLocaleString("en-IN")} pending (not yet applied in Studio)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {nearby.length > 0 && <div className="text-xs text-gray-500 whitespace-nowrap">📅 {nearby.length} nearby event{nearby.length > 1 ? "s" : ""} (±7 days)</div>}
                {/* ── ACTIVITY BEHIND A BELL ──
                    The log was a permanent panel between the header and the content, so an
                    event with two edits pushed the whole page down to say so — every time, even
                    on the hundredth visit. It is a notification, not a section: it belongs on a
                    count you can ignore. The bell only renders when there IS something, so an
                    untouched event shows nothing at all rather than an empty panel. */}
                {recentChanges.length > 0 && (
                  <button onClick={() => setLogOpen(true)}
                    className="group relative shrink-0 w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-base leading-none transition-colors">
                    <span aria-hidden="true">🔔</span>
                    {/* -top/-right so the badge overhangs the button instead of shrinking the
                        glyph to make room for it. */}
                    <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[17px] text-center tabular-nums">{recentChanges.length}</span>
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
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                  {[["planning", "📋 Planning"], ["onsite", "🚚 On-site"]].map(([k, l]) => (
                    <button key={k} onClick={() => setOpsView(k)} className={"px-4 py-1.5 rounded-lg text-xs font-semibold transition " + (opsView === k ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700")}>{l}</button>
                  ))}
                </div>
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
                <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6">
                  <div className="absolute inset-0 bg-gray-900/50" onClick={() => setLogOpen(false)} />
                  <div role="dialog" aria-modal="true" className="relative w-full sm:max-w-2xl bg-white sm:rounded-2xl shadow-2xl overflow-y-auto max-h-full sm:max-h-[80vh]">
                  <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-2">
                    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center text-base leading-none">🕑</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900">Activity log</div>
                      <div className="text-[11px] text-gray-500">Read-only · written from Studio · {dept} · {sel.clientName || "Event"}</div>
                    </div>
                    <button onClick={() => setLogOpen(false)} aria-label="Close"
                      className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition">✕</button>
                  </div>
                  <div className="px-4 py-3">
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
                        added: { label: "Added", mark: "+", tile: "bg-emerald-100 text-emerald-700", item: "bg-white border-emerald-200 text-emerald-900" },
                        removed: { label: "Removed", mark: "−", tile: "bg-rose-100 text-rose-700", item: "bg-white border-rose-200 text-rose-900" },
                        qty_changed: { label: "Quantity changed", mark: "±", tile: "bg-amber-100 text-amber-700", item: "bg-white border-amber-200 text-amber-900" },
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
                        <div key={r.id} className="flex gap-3 py-2.5 first:pt-1">
                          <span aria-hidden="true" className={"shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold leading-none " + VERB[lead].tile}>{VERB[lead].mark}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-xs font-bold text-gray-900">
                                {keys.length === 1 ? `${VERB[lead].label} ${count} item${count === 1 ? "" : "s"}` : `${count} item${count === 1 ? "" : "s"} changed`}
                                <span className="font-medium text-gray-500"> · {r.requestedBy || "—"}</span>
                              </span>
                              {/* Exact time stays on the title — the shorthand is for scanning,
                                  not a replacement for the record. */}
                              <span className="shrink-0 text-[10px] font-medium text-gray-400 whitespace-nowrap tabular-nums" title={stamp}>{relTime(r.requestedAt)}</span>
                            </div>
                            {keys.map(k => (
                              <div key={k} className="mt-1.5 flex items-start gap-1.5 flex-wrap">
                                {keys.length > 1 && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400 pt-0.5">{VERB[k].label}</span>}
                                {groups[k].map((it, ii) => (
                                  <span key={ii} className={"text-[11px] px-2 py-0.5 rounded border " + VERB[k].item}>
                                    {it.name}{it.qty ? <span className="font-semibold tabular-nums"> ×{it.qty}</span> : null}
                                  </span>
                                ))}
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
              // fp (floralPlan) is a whole-EVENT floral sourcing plan, not scoped per department —
              // only show its real/artificial split under the Floral dept itself.
              const artTotal = (dept === "Floral" && fp.artificial) ? Math.round(fp.artificial.total) : 0;
              const realFloral = dept === "Floral" ? Math.max(0, Math.round((deptIncome.florals || 0) - artTotal)) : 0;
              const liveManpower = Math.round(mpCost);   // edited crew plan (not the stale snapshot)
              const liveTotal = Math.round((deptIncome.total || 0) - (deptIncome.manpower || 0) + liveManpower);
              // Fixed order, so a head does not move the moment another one appears or drops to
              // zero — the position of a figure is how you find it again on the next event.
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
              // The percentages are taken against the SUM OF THE HEADS SHOWN, not against
              // liveTotal. liveTotal is deptIncome.total with the stale manpower swapped for
              // the live edited crew, so it can carry heads this list does not — and a column
              // of percentages that silently fails to reach 100 is worse than no percentages.
              // Computed this way they always total 100, and `gap` below states it outright if
              // the two figures disagree rather than leaving the reader to notice.
              const shown = rows.filter(r => r.value > 0).map(r => ({ ...r, value: Math.round(r.value) }));
              const shownSum = shown.reduce((s, r) => s + r.value, 0);
              const gap = liveTotal - shownSum;
              const pct = (v) => (shownSum > 0 ? Math.round((v / shownSum) * 100) : 0);
              return (
              <div className="space-y-3">
                {/* ── A READOUT, NOT CARDS ──
                    These figures open nothing. As a row of cards they were indistinguishable
                    from the tiles below — same size, same elevation, same rounded box — so the
                    page showed two identical rows and only one of them answered a click. A card
                    is a promise of interactivity; spending it on read-only numbers makes the
                    real targets harder to find.
                    So: one surface. The total sits on the left behind an indigo rule, the heads
                    that make it up are stat columns beside it. Nothing here can be mistaken for
                    something to press. */}
                <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
                  {/* The total is its own tier. Sharing a line with the heads made it just the
                      leftmost of four numbers; on its own row at twice their size it reads as
                      the figure the others add up to. */}
                  <div className="px-4 py-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400">Total income</div>
                    {/* 22px, not 28. It still leads the panel by a clear margin over the 14px
                        head figures — the hierarchy is the RATIO between them, not the absolute
                        size, so shrinking both keeps the reading order and returns the height. */}
                    <div className="mt-1 text-[22px] leading-none font-bold text-gray-900 tabular-nums tracking-tight">{fmt(liveTotal)}</div>
                    {/* The source sits under the figure it describes. Floated to the right of
                        the row it read as an unrelated note in the corner. */}
                    <div className="mt-1 text-[10px] text-gray-500">What {dept} earns on this event · synced from Deal Check</div>
                  </div>
                  {/* Saying it in words. The heads below are not a second set of numbers, they
                      are the one above taken apart — and nothing on the panel said so, which is
                      the whole reason it needed reading twice. */}
                  <div className="px-4 py-1.5 bg-gray-50 border-y border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-500">What makes up this total</span>
                    <span className="text-[9px] font-semibold text-gray-400 tabular-nums">{shown.length} head{shown.length === 1 ? "" : "s"} · {fmt(shownSum)}</span>
                  </div>
                  {/* gap-px over a grey ground, not divide-x: with divide-x the hairline is drawn
                      per element, so a wrapped row gets a stray rule down its leading edge. The
                      grid gap shows the ground through and separates cells correctly however
                      many heads a department has and however they wrap. */}
                  <div className="grid gap-px bg-gray-100" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
                    {shown.map((r, i) => (
                      <div key={i} className="bg-white px-4 py-2.5">
                        {/* No emoji here. On the tiles below they are how you pick a block out
                            at a glance; in a column of figures they are noise — each renders at
                            a different weight and colour, so a row of them reads as clutter
                            rather than as a set. The labels do the work instead.
                            Sentence case, not uppercase: these are names to read, and "Real
                            flowers (mandi)" set in tracked capitals is slower than it looks. */}
                        <div className="text-[11px] font-semibold text-gray-700 truncate" title={r.label}>{r.label}</div>
                        <div className="mt-1 text-[14px] leading-none font-bold text-gray-900 tabular-nums tracking-tight">{fmt(r.value)}</div>
                        {/* "42%" alone begs the question "of what". Two more words answer it. */}
                        <div className="mt-0.5 text-[9px] font-medium text-gray-400 tabular-nums">{pct(r.value)}% of total</div>
                      </div>
                    ))}
                  </div>
                </div>

                {shown.length === 0 && (
                  <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] px-4 py-5 text-center text-xs text-gray-400">No income heads on this department yet.</div>
                )}
                {/* The donut and its legend are gone — every figure they carried (label, share,
                    amount) is already on the cards above, so the ring restated the strip in a
                    second, less precise form. This note is NOT decoration and stays: it is the
                    only place the page says the heads and the department total disagree. */}
                {gap !== 0 && shown.length > 0 && (
                  <div className="bg-amber-50 rounded-xl px-4 py-2.5 text-[11px] text-amber-800">
                    Heads above sum to {fmt(shownSum)} — {fmt(Math.abs(gap))} {gap > 0 ? "less than" : "more than"} the department total. The total carries the live crew plan; a head may not be broken out here.
                  </div>
                )}
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
                dept === "Fabric" && upcomingFabricShort.length > 0 && { k: "fabshort", icon: "⚠️", title: "Fabric shortfalls", sub: n(upcomingFabricShort.length, "upcoming event"), tone: "bg-red-50", alert: true },
                dept === "Fabric" && { k: "fabreq", icon: "🧵", title: "Fabric required", sub: fabricReqRows.length ? n(fabricReqRows.length, "fabric type") : "nothing required" },
                { k: "inv", icon: "📦", title: "Inventory blocked", sub: n(blockedItemsGrouped.length, "item") + " held", value: fmt(rentalIncome) },
                { k: "mp", icon: "👷", title: "Manpower plan", sub: mpRows.length ? n(mpRows.length, "crew line") : "no crew assigned", value: fmt(mpCost) },
                { k: "actuals", icon: "🧾", title: "Actuals", sub: hasActuals ? "real spend logged" : "nothing logged yet", value: hasActuals ? fmt(actualCost) : null },
                { k: "load", icon: "🚚", title: "Loading & dispatch", sub: trucks.length ? n(trucks.length, "truck") : "no trucks yet" },
                blockedItems.length > 0 && { k: "dism", icon: "🔁", title: "Dismantle plan", sub: "where each item goes after" },
              ].filter(Boolean);
              return (
                <div className={GRID} style={GRID_COLS}>
                  {tiles.map(t => (
                    /* No drawn outline. Separation comes from the slate-100 page ground under a
                       white fill, plus a two-layer shadow — a tight 1px one that reads as the
                       card's edge and a wide soft one that lifts it off the ground. The tinted
                       tiles (red for a shortfall, sky for receiving) separate by fill alone. */
                    <button key={t.k} onClick={() => setModal(t.k)}
                      className={"group text-left rounded-xl p-3.5 h-full flex flex-col transition-all duration-150 shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(16,24,40,0.1),0_14px_28px_-10px_rgba(16,24,40,0.28)] " + (t.tone || "bg-white")}>
                      <div className="flex items-start gap-2.5">
                        <span aria-hidden="true" className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base leading-none " + (t.alert ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "bg-gray-100")}>{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 leading-tight">{t.title}</div>
                          <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{t.sub}</div>
                        </div>
                        {/* gray-300 put this at ~1.5:1 on white — present in the markup, absent
                            on screen. gray-500 is 4.8:1, and it darkens on hover so the chevron
                            confirms the whole tile is the target, not just the corner it sits in. */}
                        <span aria-hidden="true" className="shrink-0 text-gray-500 group-hover:text-gray-900 text-base font-semibold leading-none transition-colors">›</span>
                      </div>
                      {/* Only tiles that HAVE a headline figure reserve room for one — an empty
                          line on the others would read as a number that failed to load. */}
                      {t.value && <div className="mt-auto pt-2.5 text-lg font-bold text-gray-900 tabular-nums tracking-tight">{t.value}</div>}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── THE BODIES ──
                Every block below stays exactly where it was written. This wrapper is `hidden`
                until a tile is picked, at which point it becomes the dialog and the one block
                whose key matches un-hides itself (see modalCls). */}
            <div className={modal ? "fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6" : "hidden"}>
              <div className="absolute inset-0 bg-gray-900/50" onClick={() => setModal(null)} />
              <div role="dialog" aria-modal="true" className="relative w-full sm:max-w-5xl bg-gray-50 sm:rounded-2xl shadow-2xl overflow-y-auto max-h-full sm:max-h-[88vh]">
                {/* Sticky, so the way out is reachable from the bottom of a long table. */}
                <div className="sticky top-0 z-10 bg-white border-b px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 text-xs font-semibold text-gray-500 truncate">{DEPT_ICON[dept]} {dept} · {sel.clientName || "Event"}</div>
                  <button onClick={() => setModal(null)} aria-label="Close"
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition">✕</button>
                </div>
                <div className="p-3 sm:p-4 space-y-3">

            {/* Fabric: stock vs requirement + shortfall (Fabric dept only) */}
            {dept === "Fabric" && (
              <div className="space-y-3">
                {/* Prior heads-up: any upcoming event short on fabric */}
                {upcomingFabricShort.length > 0 && (
                  <div className={"bg-red-50 rounded-xl overflow-hidden" + modalCls("fabshort")}>
                    <div className="px-4 py-2.5 bg-red-100/70 text-sm font-bold text-red-800">⚠️ {upcomingFabricShort.length} upcoming fabric shortfall{upcomingFabricShort.length > 1 ? "s" : ""} — order ahead</div>
                    <div className="divide-y divide-red-100">
                      {upcomingFabricShort.map((s, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs">
                          <span className="text-red-800"><b>{s.fabric}</b> · {s.colour}</span>
                          <span className="text-red-700">short <b>{s.short} {s.unit}</b> for {s.event} on <b>{s.date}</b>{s.contended ? " (shared with another same-day event)" : ""}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-1.5 text-[10px] text-red-500">Total available counts Old + New stock. Update live quantities in Planning → Fabric Stock after each washing cycle.</div>
                  </div>
                )}
                {/* This event's requirement vs available */}
                <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("fabreq")}>
                  <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-semibold text-gray-800">🧵 Fabric required vs available <span className="text-xs font-normal text-gray-400">— for this event</span></span>
                    <span className="text-xs text-gray-400">Available = Old + New stock</span>
                  </div>
                  {fabricReqRows.length === 0 ? (
                    <div className="px-4 py-5 text-center text-xs text-gray-400">{sel?.fabricPlan ? "No fabric required for this event." : "No fabric plan synced yet — open Deal Check for this event in Studio."}</div>
                  ) : fabricReqRows.map(ft => (
                    <div key={ft.key} className="border-t first:border-t-0">
                      <div className="px-4 py-1.5 bg-gray-50/60 text-xs font-semibold text-gray-700">{ft.emoji} {ft.label}</div>
                      <div className="divide-y">
                        {ft.rows.map((r, i) => (
                          /* Four fixed columns need ~430px. Below sm the colour takes its own
                             line and need / have / short wrap under it left-aligned — the
                             right-alignment only earns its keep when the rows line up. */
                          <div key={i} className="flex flex-wrap sm:grid sm:grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 sm:gap-2 px-4 py-1.5 text-xs items-center">
                            <span className="w-full sm:w-auto text-gray-800">{r.colour}</span>
                            <span className="text-gray-500 sm:w-24 sm:text-right">need <b>{r.required} {ft.unit}</b></span>
                            <span className="text-gray-500 sm:w-40 sm:text-right">have {r.avail} <span className="text-gray-400">({r.old} old + {r.new} new{r.otherDay > 0 ? ` − ${r.otherDay} same-day` : ""})</span></span>
                            <span className={"sm:w-24 sm:text-right font-bold " + (r.short > 0 ? "text-red-600" : "text-emerald-600")}>{r.short > 0 ? `short ${r.short} ${ft.unit}` : "✓ ok"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocked inventory */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("inv")}>
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] flex items-center justify-center text-base leading-none">📦</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">Inventory blocked for {dept}</div>
                    <div className="text-[11px] text-gray-500">{blockedItemsGrouped.length} item{blockedItemsGrouped.length === 1 ? "" : "s"} held for this event</div>
                  </div>
                </div>
                <div className="text-xl font-bold text-gray-900 tabular-nums whitespace-nowrap">{fmt(rentalIncome)}</div>
              </div>
              {blockedItemsGrouped.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No inventory blocked for this department on this event.</div>
              ) : (
                /* ── A REAL TABLE, WITH A HEADER ROW ──
                   Qty, unit rate and line total used to sit as three unlabelled figures at the
                   end of a flex row, so which was which had to be inferred from magnitude.
                   Named columns at fixed alignment mean they line up down the card and can be
                   compared. overflow-x on the wrapper because item names run long and a table
                   of money is the one thing that must never be silently clipped. */
                <div className="overflow-x-auto">
                {/* min-w or the wrapper's overflow-x never fires: percentage columns just
                    squeeze, and on a phone ITEM / DETAILS collapse to two characters a line
                    while the money columns wrap mid-number. Below ~640px this scrolls
                    sideways instead, which keeps the figures readable and aligned. */}
                <table className="w-full min-w-[640px] text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-white">
                      <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 w-[34%]">Item</th>
                      <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 w-[22%]">Details</th>
                      <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 text-right whitespace-nowrap w-[10%]">Qty</th>
                      <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 text-right whitespace-nowrap w-[16%]">Rate / unit</th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 text-right whitespace-nowrap w-[18%]">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                  {blockedItemsGrouped.map(it => {
                    // ── WHY THE TOTAL IS NOT ALWAYS RATE × QTY ──
                    // On rows pushed from Deal Check, `unit` and `total` are independent fields:
                    // unit is the base rental, total is the line rental — and for a KIT that
                    // total also carries its components (see the snapshot branch of
                    // blockedItemsGrouped). Only the IMS fallback path computes total = unit ×
                    // qty. Naming the two as columns therefore displays arithmetic that visibly
                    // fails on kit lines, so a row where they disagree says why instead of
                    // looking like a calculation bug.
                    const derived = Math.round((Number(it.unit) || 0) * (Number(it.qty) || 0));
                    const mismatch = derived !== Math.round(Number(it.total) || 0);
                    return (
                    <Fragment key={it.id}>
                      <tr className="align-middle hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3 min-w-0">
                            {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-11 h-11 rounded-lg object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg shrink-0">📦</div>}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">{it.name}</div>
                              {/* Every status badge the flat-list version carried, kept as a
                                  wrapping row under the name instead of trailing off the end of
                                  it — in a fixed-width ITEM column four inline badges pushed the
                                  name out of sight, which is the opposite of what they are for. */}
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {it.isKit && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">KIT</span>}
                                {it.shortQty > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">SHORT ×{it.shortQty}</span>}
                                {it.prodOrBuy && <span className={"text-[10px] px-1.5 py-0.5 rounded font-bold " + (it.prodOrBuy === "buying" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700")}>{it.prodOrBuy === "buying" ? "🛒 BUYING" : "🏭 PRODUCTION"}</span>}
                                {it.isSwapped && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold">🔁 SWAPPED</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">
                          <div>{it.sub || "—"}</div>
                          {/* The explanations that rode alongside the sub-category in the flat
                              list. They belong with DETAILS, not with the name. */}
                          {it.shortQty > 0 && <div className="text-amber-600 mt-0.5">{it.shortQty} short of stock — priced at cost, chase or produce</div>}
                          {it.isSwapped && <div className="text-sky-600 mt-0.5">swapped in for {it.swappedFrom}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-sm font-semibold text-gray-700 text-right tabular-nums whitespace-nowrap">×{it.qty}</td>
                        <td className="px-3 py-2.5 text-sm text-gray-600 text-right tabular-nums whitespace-nowrap">{fmt(it.unit)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="text-sm font-bold text-gray-900 tabular-nums">{fmt(it.total)}</div>
                          {mismatch && <div className="text-[10px] text-gray-400 tabular-nums" title={`Rate × qty is ${fmt(derived)}. This line is ${fmt(it.total)}${it.isKit ? " because a kit's total includes the components listed below." : "."}`}>{it.isKit ? "incl. kit contents" : `rate × qty = ${fmt(derived)}`}</div>}
                        </td>
                      </tr>
                      {/* Kit contents — each sub-element loaded separately, with its own rental (customised
                          per-deal by the salesperson). Their totals sum to the kit total above. */}
                      {/* Kit contents keep their own sub-rows, but now inside the table so each
                          component's qty, rate and total sit in the SAME columns as the kit line
                          above them. Previously they were a separate flex list with their own
                          widths, so a component's total and its parent's total did not align —
                          which is the one comparison this block exists to support, since the
                          components sum to the kit line. */}
                      {it.isKit && it.components && it.components.length > 0 && it.components.map((cp, ci) => (
                        <tr key={"c" + ci} className="bg-indigo-50/30 hover:bg-indigo-50/70 transition-colors">
                          <td className="pl-8 pr-4 py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span aria-hidden="true" className="text-indigo-300 shrink-0">└</span>
                              {cp.photo ? <img src={cp.photo} alt="" onClick={() => setZoomImg(cp.photo)} className="w-6 h-6 rounded object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-[10px] shrink-0">🌸</div>}
                              <span className="text-xs text-gray-700 truncate">{cp.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-[11px] text-gray-400">{cp.sub || "—"}</td>
                          <td className="px-3 py-1.5 text-xs font-medium text-gray-500 text-right tabular-nums whitespace-nowrap">×{cp.qty}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 text-right tabular-nums whitespace-nowrap">{fmt(cp.unit)}</td>
                          <td className="px-4 py-1.5 text-xs font-semibold text-gray-700 text-right tabular-nums whitespace-nowrap">{fmt(cp.total)}</td>
                        </tr>
                      ))}
                    </Fragment>
                    );
                  })}
                  </tbody>
                </table>
                </div>
              )}
            </div>

            {/* Manpower plan (editable / override) */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("mp")}>
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] flex items-center justify-center text-base leading-none">👷</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900">Manpower plan</div>
                    <div className="text-[11px] text-gray-500">From Studio; edit any field, it saves. Sum matches the income card.</div>
                  </div>
                </div>
                <div className="text-xl font-bold text-gray-900 tabular-nums whitespace-nowrap">{fmt(mpCost)}</div>
              </div>
              {sel.mpPhases && (
                <div className="px-4 py-1.5 text-[10px] text-gray-500 bg-gray-50/60 border-b">
                  📅 Crew booked across: {sel.mpPhases.minusOne ? "−1 setup day · " : ""}{sel.mpPhases.eventDays || 0} event day{(sel.mpPhases.eventDays || 0) > 1 ? "s" : ""}{sel.mpPhases.gapDays ? ` · ${sel.mpPhases.gapDays} gap day(s)` : ""}{sel.mpPhases.dismantle ? " · +1 dismantle day" : ""}. Each crew line = peak count × ₹/day × its working days (open a row to see the math).
                </div>
              )}
              {mpRows.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-gray-400">No crew assigned to {dept} for this event — matches the ₹0 income card. Add a crew type below if you need one.</div>
              )}
              <div className="divide-y">
                {mpRows.map((r, i) => {
                  const overridden = r.sysCount != null && Number(r.count) !== Number(r.sysCount);
                  const days = Number(r.days) || 1;
                  const open = !!mpOpen[i];
                  return (
                    <div key={i} className="px-4 py-2.5 hover:bg-gray-50/70 transition-colors">
                      {/* how-button + name + qty + ₹/day + line total is ~460px of fixed
                          content. Wrapping lets the two inputs drop to a second line on a
                          phone instead of shrinking below a tappable size. */}
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-2">
                        <button onClick={() => setMpOpen(o => ({ ...o, [i]: !o[i] }))} className="shrink-0 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-1.5 py-0.5" title="How this crew number was calculated">{open ? "▾ hide" : "▸ how"}</button>
                        <span className="flex-1 min-w-[110px] text-sm font-medium text-gray-800">{r.type}{r.shared && <span className="ml-2 text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-semibold">SHARED</span>}</span>
                        {r.shared && !dayWise(r) ? (
                          <span className="text-[10px] text-gray-400 mr-2">split allocation</span>
                        ) : (<>
                          {dayWise(r)
                            ? <div className="flex items-center gap-1"><span className="text-xs text-gray-400" title="Total dihari (crew × shifts, summed across all days). Auto-calculated — edit the crew on any day in the plan below and this updates.">dihari</span><span className="w-16 border border-transparent rounded-lg px-2 py-1.5 text-sm text-center font-semibold bg-gray-100 text-gray-700" title="Auto-calculated from the day-wise plan below">{Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : 0}</span></div>
                            : <div className="flex items-center gap-1"><span className="text-xs text-gray-400">qty</span><input type="number" min="0" value={r.count} onChange={e => setMp(i, "count", e.target.value)} className={"w-16 border rounded-lg px-2 py-1.5 text-sm text-center " + (overridden ? "border-amber-400 bg-amber-50 font-bold" : "")} /></div>}
                          <div className="flex items-center gap-1"><span className="text-xs text-gray-400">₹/day</span><input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-20 border rounded-lg px-2 py-1.5 text-sm text-center" /></div>
                        </>)}
                        <div className="text-sm font-semibold text-gray-700 w-24 text-right ml-auto">{fmt(lineCost(r))}</div>
                      </div>
                      {open && (
                        <div className="text-[10px] text-gray-500 mt-1.5 pl-7 leading-relaxed bg-gray-50 rounded-lg p-2">
                          {r.shared ? (
                            <>
                              <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-semibold mb-1">How {r.type} derived → then split</div>
                              {renderMpTrace(r.trace)}
                              {renderMpSchedule(r)}
                              {r.splitInfo && r.splitInfo.byUsage && r.splitInfo.usageTotal > 0 ? (
                                <div className="mt-1 bg-white border rounded-lg p-2 text-gray-600">
                                  <b>{r.type}</b> split by <b>sub-category usage</b>{r.splitInfo.perDay ? ", computed per day" : ""} — each sub-category's labour goes to its department (1 labour per N units → charged to that sub's dept).<br />
                                  {r.splitInfo.perDay && <span className="text-gray-500">Per-day bifurcation is in the schedule above (open each day's <b>how</b>). Booking average: </span>}
                                  This dept's labour usage <b>{r.splitInfo.deptUsage}</b> ÷ all-dept usage <b>{r.splitInfo.usageTotal}</b> = <b>{Math.round((r.splitInfo.deptUsage / r.splitInfo.usageTotal) * 100)}%</b><br />
                                  → total {r.type} {fmt(r.splitInfo.total)} → <b className="text-gray-900">{fmt(Number(r.sysCost) || 0)}</b> to {dept}
                                </div>
                              ) : r.splitInfo && r.splitInfo.directTotal > 0 ? (
                                <div className="mt-1 bg-white border rounded-lg p-2 text-gray-600">
                                  <b>{r.type}</b> are shared crew, split across all departments by income share:<br />
                                  Total {r.type} on this event: <b>{fmt(r.splitInfo.total)}</b><br />
                                  This dept's direct income {fmt(r.splitInfo.deptDirect)} ÷ all-dept income {fmt(r.splitInfo.directTotal)} = <b>{Math.round((r.splitInfo.deptDirect / r.splitInfo.directTotal) * 100)}%</b><br />
                                  → {fmt(r.splitInfo.total)} × {Math.round((r.splitInfo.deptDirect / r.splitInfo.directTotal) * 100)}% = <b className="text-gray-900">{fmt(Number(r.sysCost) || 0)}</b> to {dept}
                                </div>
                              ) : <div className="text-gray-500">Split across departments. This dept's allocation = <b>{fmt(Number(r.sysCost) || 0)}</b>.</div>}
                              {Number(lineCost(r)) !== (Number(r.sysCost) || 0) && (
                                <div className="mt-1 text-amber-600 font-semibold">✏️ You tuned this dept's crew/rate per day → line now <b>{fmt(lineCost(r))}</b> (system split was {fmt(Number(r.sysCost) || 0)}).</div>
                              )}
                            </>
                          ) : (<>
                            <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-semibold mb-1">How {r.sysCount != null && r.sysCount !== "" ? r.sysCount : (r.count || "")} {r.type} derived</div>
                            {renderMpTrace(r.trace)}
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
              <div className="px-4 py-2"><button onClick={addMp} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Add crew type</button></div>
            </div>

            {/* Actuals → exact cost */}
            <div className={"bg-emerald-50 rounded-xl overflow-hidden" + modalCls("actuals")}>
              <div className="px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold text-emerald-900">🧾 Actuals (real spend) <span className="text-xs font-normal text-emerald-600">— turns projected into exact P&L</span></span>
                {hasActuals && <span className="text-sm font-bold text-emerald-800">{fmt(actualCost)}</span>}
              </div>
              <div className="px-4 pb-3 space-y-2">
                {dept === "Floral" && (() => {
                  const projectedTotal = Number(fp.projected) || 0;
                  const variance = mandiActualTotal - projectedTotal;
                  return (
                    <div className="space-y-2">
                      {/* Ops view — FLORAL COST (what ops spends to source flowers). Client billing is
                          intentionally NOT shown here — ops only needs the real mandi + artificial spend
                          and how each is derived. */}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden text-xs">
                        <div className="px-3 py-2 bg-emerald-50 font-semibold text-emerald-900 flex justify-between"><span>🌸 Floral cost to source</span><span>{fmt(mandiActualTotal)}</span></div>
                        <div className="divide-y">
                          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-600">🌿 Real flowers (mandi) <span className="text-[10px] text-gray-400">— see shopping list below</span></span><span className="font-medium text-gray-800">{fmt(mandiActualReal)}</span></div>
                          <div>
                            <div className="flex justify-between px-3 py-1.5 items-center">
                              <span className="text-gray-600 flex items-center gap-1.5">🌸 Artificial flowers {fp.artificial && <button onClick={() => setArtHowOpen(o => !o)} className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded px-1 leading-tight" title="How the artificial cost is derived">{artHowOpen ? "▾" : "▸"} how</button>}</span>
                              <span className="font-medium text-gray-800">{fmt(fp.artificial ? fp.artificial.total : artificialProj)}</span>
                            </div>
                            {fp.artificial && artHowOpen && (
                              <div className="px-3 pb-2">
                                <div className="bg-gray-50 border rounded-lg p-2 text-[10px] text-gray-600 space-y-1">
                                  {fp.artificial.flowerBunches > 0 && <div>🌸 Flowers: <b>{fp.artificial.flowerBunches}</b> bunches ÷ {fp.artificial.flowerBPK}/kg = <b>{fp.artificial.flowerKg} kg</b> × {fmt(fp.artificial.flowerRate)}/kg = <b className="text-gray-900">{fmt(fp.artificial.flowerCost)}</b></div>}
                                  {fp.artificial.greenBunches > 0 && <div>🌿 Greens: <b>{fp.artificial.greenBunches}</b> bunches ÷ {fp.artificial.greenBPK}/kg = <b>{fp.artificial.greenKg} kg</b> × {fmt(fp.artificial.greenRate)}/kg = <b className="text-gray-900">{fmt(fp.artificial.greenCost)}</b></div>}
                                  {fp.artificial.flowerBunches <= 0 && fp.artificial.greenBunches <= 0 && <div className="text-gray-400 italic">No artificial bunches captured — set "Art Bunches/Unit" on flowers in the Mandi tab.</div>}
                                  <div className="pt-1 border-t text-right">Total artificial = <b className="text-gray-900">{fmt(fp.artificial.total)}</b></div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {fp.season && fp.season.mult && fp.season.mult !== 1 && <div className="px-3 py-1.5 rounded-lg text-[10px] text-emerald-700 bg-emerald-100/50 border border-emerald-100">📅 {fp.season.label} date — mandi flower prices ×{fp.season.mult} (e.g. a ₹1000 flower bills at ₹{Math.round(1000 * fp.season.mult)})</div>}
                      {/* Projected vs real mandi — side by side, editable real shopping list */}
                      {/* Projected and Real are two fixed columns (w-28 + w-44) and Real holds
                          qty × ₹/unit × total × delete — ~330px that cannot compress, which left
                          the flower name about 30px on a phone. The comparison only works if the
                          two columns stay aligned, so this scrolls sideways rather than reflows. */}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-x-auto">
                        <div className="min-w-[430px]">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-100/60 text-[10px] font-semibold text-emerald-900 uppercase tracking-wide items-center">
                          <span className="flex items-center gap-2">🌸 Flower
                            {seedMandi.length > 0 && <button onClick={resetMandi} title="Undo your edits — restore the system's original mandi plan from Deal Check" className="normal-case text-[10px] font-semibold text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 hover:bg-emerald-200/60">↺ Reset to system plan</button>}
                          </span>
                          <span className="text-right w-28">Projected (plan)</span>
                          <span className="text-right w-44">Real shopping</span>
                        </div>
                        {/* Column labels for the two editable fields */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 pt-1 text-[10px] text-emerald-700/70 uppercase tracking-wide">
                          <span></span><span className="w-28"></span>
                          <span className="flex items-center justify-end gap-1 w-44"><span className="w-12 text-center">qty</span><span className="text-transparent">×</span><span className="w-16 text-center">₹/unit</span><span className="w-14 text-right">total</span><span className="w-3"></span></span>
                        </div>
                        <div className="px-3 py-1 bg-emerald-50/40 text-[10px] text-emerald-700/80 border-b border-emerald-50">Real shopping = <b>qty × ₹/unit</b>. Projected = planned units from the recipe × mandi price{fp.season && fp.season.mult && fp.season.mult !== 1 ? ` × ${fp.season.mult} season` : ""}.</div>
                        {mandiRows.length === 0 && fpFlowers.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-gray-400 text-center">No mandi plan captured. Add flowers below, or run Deal Check before marking Sold to auto-capture it.</div>
                        ) : (
                          <div className="divide-y">
                            {mandiRows.map((r, i) => {
                              const lineActual = (Number(r.qty) || 0) * (Number(r.price) || 0);
                              const lineVar = lineActual - (Number(r.projCost) || 0);
                              return (
                                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 items-center">
                                  <div className="min-w-0"><div className="text-xs font-medium text-gray-800 truncate">{r.name}</div>{r.projQty > 0 && <div className="text-[10px] text-gray-400">{r.projQty} {r.unit} planned</div>}</div>
                                  <div className="text-right w-28 text-xs text-gray-400">{r.projCost > 0 ? fmt(r.projCost) : <span className="text-amber-500">extra</span>}</div>
                                  <div className="flex items-center justify-end gap-1 w-44">
                                    <input type="number" min="0" value={r.qty} onChange={e => setMandi(i, "qty", e.target.value)} className="w-12 border rounded px-1.5 py-1 text-xs text-center" title="qty" />
                                    <span className="text-[10px] text-gray-300">×</span>
                                    <input type="number" min="0" value={r.price} onChange={e => setMandi(i, "price", e.target.value)} className="w-16 border rounded px-1.5 py-1 text-xs text-center" title="₹/unit" />
                                    <span className={"text-xs font-semibold w-14 text-right " + (lineVar > 0 ? "text-red-500" : lineVar < 0 ? "text-emerald-600" : "text-gray-700")}>{fmt(lineActual)}</span>
                                    <button onClick={() => delMandi(i)} className="text-red-300 hover:text-red-500 text-xs">×</button>
                                  </div>
                                </div>
                              );
                            })}
                            {(fp.artificial || artificialProj > 0) && (() => {
                              const art = fp.artificial;
                              const artTot = art ? art.total : artificialProj;
                              return (
                                <div className="bg-gray-50/60">
                                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 items-center">
                                    <div className="text-xs text-gray-500 flex items-center gap-1.5 min-w-0">
                                      {art && <button onClick={() => setArtHowOpen(o => !o)} className="shrink-0 text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded px-1 leading-tight" title="How the artificial cost was calculated">{artHowOpen ? "▾" : "▸"} how</button>}
                                      <span className="truncate">Artificial flowers / greens <span className="text-[10px] text-gray-400">(not mandi-shopped)</span></span>
                                    </div>
                                    <div className="text-right w-28 text-xs text-gray-400">{fmt(artTot)}</div>
                                    <div className="text-right w-44 text-xs text-gray-500 pr-6">{fmt(artTot)}</div>
                                  </div>
                                  {art && artHowOpen && (
                                    <div className="px-3 pb-2">
                                      <div className="bg-white border rounded-lg p-2 text-[10px] text-gray-600 space-y-1">
                                        {art.flowerBunches > 0 && <div>🌸 Flowers: <b>{art.flowerBunches}</b> bunches ÷ {art.flowerBPK}/kg = <b>{art.flowerKg} kg</b> × {fmt(art.flowerRate)}/kg = <b className="text-gray-900">{fmt(art.flowerCost)}</b></div>}
                                        {art.greenBunches > 0 && <div>🌿 Greens: <b>{art.greenBunches}</b> bunches ÷ {art.greenBPK}/kg = <b>{art.greenKg} kg</b> × {fmt(art.greenRate)}/kg = <b className="text-gray-900">{fmt(art.greenCost)}</b></div>}
                                        {art.flowerBunches <= 0 && art.greenBunches <= 0 && <div className="text-gray-400 italic">No artificial bunches captured — set "Art Bunches/Unit" on flowers in the Mandi tab.</div>}
                                        <div className="pt-1 border-t text-right">Total artificial = <b className="text-gray-900">{fmt(art.total)}</b></div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {/* Totals row */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-50 border-t border-emerald-100 items-center">
                          <span className="text-xs font-bold text-emerald-900">Total</span>
                          <span className="text-right w-28 text-xs font-semibold text-gray-500">{fmt(projectedTotal)}</span>
                          <span className="text-right w-44 text-sm font-bold text-emerald-800 pr-6">{fmt(mandiActualTotal)}</span>
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
                      {mandiActualTotal > 0 && projectedTotal > 0 && (
                        <div className={"text-xs font-semibold " + (variance > 0 ? "text-red-600" : "text-emerald-700")}>
                          {variance > 0 ? "▲ Over" : variance < 0 ? "▼ Under" : "On"} plan by {fmt(Math.abs(variance))} — salesperson's P&L uses the real {fmt(mandiActualTotal)}.
                        </div>
                      )}
                    </div>
                  );
                })()}
                {expenses.map((ex, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={ex.label} onChange={e => setExpense(i, "label", e.target.value)} placeholder="on-site expense" className="flex-1 border border-emerald-200 rounded-lg px-3 py-2 text-sm" />
                    <input type="number" min="0" value={ex.amount} onChange={e => setExpense(i, "amount", e.target.value)} placeholder="₹" className="w-28 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-right" />
                    <button onClick={() => delExpense(i)} className="text-red-400 hover:text-red-600 text-sm px-1">×</button>
                  </div>
                ))}
                <button onClick={addExpense} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">+ Add on-site expense</button>
              </div>
            </div>

            {/* Loading / dispatch — cross-check inventory + essentials while loading the truck */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("load")}>
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold text-gray-800">🚚 Loading & dispatch <span className="text-xs font-normal text-gray-400">— split inventory across trucks; each prints its own challan</span></span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowFleet(v => !v)} className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium">{showFleet ? "Done" : "⚙️ Manage fleet"}</button>
                  <button onClick={addTruck} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add truck</button>
                </div>
              </div>
              {showFleet && (
                <div className="px-4 py-3 border-b bg-gray-50 space-y-2">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Own fleet (shared across departments)</div>
                  {fleet.map(f => (
                    <div key={f.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 font-medium text-gray-700">🚛 {f.vehicle}</span>
                      <span className="text-gray-500">{f.driver || "—"}</span>
                      <span className="text-gray-400">{f.phone || ""}</span>
                      <button onClick={() => delFleet(f.id)} className="text-red-300 hover:text-red-500">×</button>
                    </div>
                  ))}
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-end">
                    <input value={newVeh.vehicle} onChange={e => setNewVeh(v => ({ ...v, vehicle: e.target.value }))} placeholder="Vehicle no." className="border rounded px-2 py-1.5 text-xs" />
                    <input value={newVeh.driver} onChange={e => setNewVeh(v => ({ ...v, driver: e.target.value }))} placeholder="Driver name" className="border rounded px-2 py-1.5 text-xs" />
                    <input value={newVeh.phone} onChange={e => setNewVeh(v => ({ ...v, phone: e.target.value }))} placeholder="Phone" className="border rounded px-2 py-1.5 text-xs" />
                    <button onClick={addFleet} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-xs font-medium">Add</button>
                  </div>
                </div>
              )}
              {/* Per-item loaded summary across all trucks */}
              {blockedItems.length > 0 && trucks.length > 0 && (
                <div className="px-4 py-2 border-b bg-gray-50/40">
                  <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Loaded across trucks</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {blockedItems.map(it => { const k = "inv:" + it.id; const ld = truckLoadedQty(k); const full = ld >= it.qty; return (
                      <span key={k} className={"text-[11px] " + (full ? "text-emerald-600 font-semibold" : ld > 0 ? "text-amber-600" : "text-gray-400")}>{it.name}: {ld}/{it.qty}</span>
                    ); })}
                  </div>
                </div>
              )}
              {/* Trucks */}
              {trucks.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No trucks yet. Add a truck to load inventory for dispatch across one or more vehicles.</div>
              ) : (
                <div className="divide-y">
                  {trucks.map((t, ti) => (
                    <div key={t.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-semibold text-gray-700">🚛 Truck {ti + 1}{t.driver ? <span className="font-normal text-gray-400"> · {t.driver}</span> : null}</span>
                        <div className="flex items-center gap-2">
                          {t.phone && <a href={"tel:" + t.phone} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 hover:bg-emerald-100" title={"Call " + (t.driver || "driver") + " · " + t.phone}>📞 Call</a>}
                          <select value={t.status || "loading"} onChange={e => setTruck(t.id, { status: e.target.value })} className="border rounded-lg px-2 py-1 text-xs capitalize">{TRUCK_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                          <button onClick={() => printTruckChallan(t, ti + 1)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg font-medium">🖨️ Challan</button>
                          <button onClick={() => delTruck(t.id)} className="text-red-400 hover:text-red-600 text-sm">×</button>
                        </div>
                      </div>
                      {eventTrucks.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {eventTrucks.map(f => { const on = t.vehicle === f.vehicle && t.driver === f.driver; return (
                            <button key={f.id} onClick={() => setTruck(t.id, { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" })} className={"text-[11px] px-2 py-1 rounded-lg border " + (on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-indigo-50")}>🚛 {f.vehicle || f.driver}{f.vehicle && f.driver ? ` · ${f.driver}` : ""}</button>
                          ); })}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[["Vehicle no.", "vehicle"], ["Driver", "driver"], ["Phone", "phone"]].map(([l, k]) => (
                          <div key={k}><label className="text-[10px] text-gray-400">{l}</label><input value={t[k] || ""} onChange={e => setTruck(t.id, { [k]: e.target.value })} placeholder={k === "vehicle" ? "outside vehicle?" : ""} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        ))}
                      </div>
                      {blockedItems.length > 0 ? (
                        <div className="border rounded-lg divide-y">
                          {blockedItems.map(it => { const k = "inv:" + it.id; const onThis = Number(t.items?.[k]) || 0; const totalLoaded = truckLoadedQty(k); const matchCls = totalLoaded === it.qty ? "text-emerald-600" : totalLoaded > it.qty ? "text-red-600" : totalLoaded > 0 ? "text-amber-600" : "text-gray-400"; return (
                            <div key={k} className="flex items-center flex-wrap gap-x-3 gap-y-1.5 px-3 py-1.5">
                              {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs shrink-0">📦</div>}
                              <span className="flex-1 min-w-[120px] text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">need {it.qty}</span></span>
                              <span className={"text-[11px] font-semibold w-28 text-right " + matchCls}>{totalLoaded}/{it.qty} loaded{totalLoaded > it.qty ? " ⚠️" : totalLoaded === it.qty ? " ✓" : ""}</span>
                              <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">this truck</span><input type="number" min="0" value={onThis || ""} onChange={e => setTruckItem(t.id, k, e.target.value)} placeholder="0" className="w-14 border rounded px-2 py-1 text-sm text-center" /></div>
                            </div>
                          ); })}
                        </div>
                      ) : <div className="text-xs text-gray-400">No inventory blocked for this department.</div>}
                    </div>
                  ))}
                </div>
              )}
              {/* Essentials / tools */}
              <div className="bg-amber-50/40 border-t">
                <div className="px-4 py-2 text-xs font-semibold text-amber-800 flex items-center justify-between">
                  <span>🛠️ Essentials / tools <span className="font-normal text-amber-600">— things you carry but don't block (saved for every {dept} event)</span></span>
                </div>
                {deptTools.length > 0 && (
                  <div className="divide-y divide-amber-100">
                    {deptTools.map((t, i) => {
                      const k = "tool:" + t.name; const on = !!loaded[k];
                      return (
                        <div key={i} className="flex items-center gap-3 px-4 py-2">
                          <input type="checkbox" checked={on} onChange={() => toggleLoaded(k)} className="w-4 h-4" />
                          <span className={"flex-1 text-sm " + (on ? "line-through text-gray-400" : "text-gray-800")}>{t.name}</span>
                          <input type="number" min="1" value={t.qty || 1} onChange={e => setTool(i, "qty", e.target.value)} className="w-14 border rounded px-1.5 py-1 text-xs text-center" title="qty" />
                          <button onClick={() => delTool(i)} className="text-red-300 hover:text-red-500 text-xs">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="px-4 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={newTool} onChange={e => setNewTool(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addTool(newTool); }} placeholder="Add an essential (e.g. ladder, nails)…" className="flex-1 border border-amber-200 rounded-lg px-3 py-1.5 text-sm" />
                    <button onClick={() => addTool(newTool)} className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium">Add</button>
                  </div>
                  {(DEFAULT_TOOLS[dept] || []).filter(s => !deptTools.some(t => (t.name || "").toLowerCase() === s.toLowerCase())).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(DEFAULT_TOOLS[dept] || []).filter(s => !deptTools.some(t => (t.name || "").toLowerCase() === s.toLowerCase())).map(s => (
                        <button key={s} onClick={() => addTool(s)} className="text-[11px] px-2 py-1 rounded-full bg-white border border-amber-200 text-amber-700 hover:bg-amber-100">+ {s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Dismantle plan — dept head pre-sets where each item goes; ops just confirms on-site */}
            {blockedItems.length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("dism")}>
                <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] flex items-center justify-center text-base leading-none">🔁</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900">Dismantle plan</div>
                      <div className="text-[11px] text-gray-500">Pick the transfer sites, then type how many of each item goes to each; the rest stay for production house.</div>
                    </div>
                  </div>
                  <button onClick={resetDismantle} className="text-[11px] font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg whitespace-nowrap" title="Testing: clear this plan + all on-site movements so you can re-test splits">↺ Reset (testing)</button>
                </div>
                {/* Site chooser — dept head names the destination sites; each becomes a column below */}
                <div className="px-4 py-2.5 border-b bg-sky-50/40 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-sky-800">Transfer sites:</span>
                  {dismantleSites.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-1 text-[11px] font-medium bg-white border border-sky-200 text-sky-700 rounded-full px-2 py-1">↪️ {s.name}{s.date ? ` · ${s.date}` : ""}<button onClick={() => removeDismantleSite(s.id)} className="text-sky-300 hover:text-red-500 ml-0.5" title="remove this site">×</button></span>
                  ))}
                  <select value="" onChange={e => { addDismantleSite(e.target.value); e.target.value = ""; }} className="border border-sky-300 rounded-lg px-2 py-1 text-xs">
                    <option value="">+ Add a site…</option>
                    {nearbyTransferEvents.filter(({ e }) => !dismantleSites.some(s => s.id === e.id)).map(({ e, d, off }) => <option key={e.id} value={e.id}>{e.clientName || "Event"} · {d || "no date"}{off === 0 ? " (same day)" : off > 0 ? ` (+${off}d)` : ` (${off}d)`}</option>)}
                  </select>
                  {dismantleSites.length === 0 && <span className="text-[10px] text-gray-400">No sites yet — everything goes back to production house. Add a site to route items there.</span>}
                </div>
                {/* Matrix — one row per item, a column for production house (auto) + each site */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                        <th className="text-left font-semibold px-4 py-2">Item</th>
                        <th className="text-center font-semibold px-3 py-2 whitespace-nowrap">🏭 Production House</th>
                        {dismantleSites.map(s => <th key={s.id} className="text-center font-semibold px-3 py-2 whitespace-nowrap" title={s.date}>↪️ {s.name}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {blockedItems.map(it => {
                        const prod = planProdQty(it);
                        return (
                          <tr key={it.id}>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                                <span className="text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">×{it.qty}</span></span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center"><span className={"inline-block min-w-[2.5rem] px-2 py-1 rounded-lg text-sm font-semibold " + (prod > 0 ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-400")} title="auto — the remainder after the sites">{prod}</span></td>
                            {dismantleSites.map(s => (
                              <td key={s.id} className="px-3 py-2 text-center">
                                <input type="number" min="0" max={it.qty} value={planSiteQty(it, s.id) || ""} onChange={e => setSiteQty(it, s.id, e.target.value)} placeholder="0" className="w-14 border rounded px-2 py-1 text-sm text-center" />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
                <div className={GRID} style={GRID_COLS}>
                  {tiles.map(t => (
                    /* No drawn outline. Separation comes from the slate-100 page ground under a
                       white fill, plus a two-layer shadow — a tight 1px one that reads as the
                       card's edge and a wide soft one that lifts it off the ground. The tinted
                       tiles (red for a shortfall, sky for receiving) separate by fill alone. */
                    <button key={t.k} onClick={() => setModal(t.k)}
                      className={"group text-left rounded-xl p-3.5 h-full flex flex-col transition-all duration-150 shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(16,24,40,0.1),0_14px_28px_-10px_rgba(16,24,40,0.28)] " + (t.tone || "bg-white")}>
                      <div className="flex items-start gap-2.5">
                        <span aria-hidden="true" className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base leading-none " + (t.alert ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]")}>{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 leading-tight">{t.title}</div>
                          <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{t.sub}</div>
                        </div>
                        {/* gray-300 put this at ~1.5:1 on white — present in the markup, absent
                            on screen. gray-500 is 4.8:1, and it darkens on hover so the chevron
                            confirms the whole tile is the target, not just the corner it sits in. */}
                        <span aria-hidden="true" className="shrink-0 text-gray-500 group-hover:text-gray-900 text-base font-semibold leading-none transition-colors">›</span>
                      </div>
                      {t.value && <div className="mt-auto pt-2.5 text-lg font-bold text-gray-900 tabular-nums tracking-tight">{t.value}</div>}
                    </button>
                  ))}
                </div>
              );
            })()}

            <div className={modal ? "fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6" : "hidden"}>
              <div className="absolute inset-0 bg-gray-900/50" onClick={() => setModal(null)} />
              <div role="dialog" aria-modal="true" className="relative w-full sm:max-w-5xl bg-gray-50 sm:rounded-2xl shadow-2xl overflow-y-auto max-h-full sm:max-h-[88vh]">
                <div className="sticky top-0 z-10 bg-white border-b px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 text-xs font-semibold text-gray-500 truncate">{DEPT_ICON[dept]} {dept} · {sel.clientName || "Event"}</div>
                  <button onClick={() => setModal(null)} aria-label="Close"
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition">✕</button>
                </div>
                <div className="p-3 sm:p-4 space-y-3">

            {/* Receiving — ops manager sees every item's sources (which truck + driver, from where) + shortfall */}
            {sourceRows.length > 0 && (
              <div className={"bg-sky-50 rounded-xl overflow-hidden" + modalCls("rcv")}>
                <div className="px-4 py-2.5 bg-sky-100/70 text-sm font-bold text-sky-800 flex items-center justify-between flex-wrap gap-2">
                  <span>📥 Receiving — sources per item <span className="text-xs font-normal text-sky-600">— who&apos;s bringing what, on which truck</span></span>
                  {(() => { const sc = sourceRows.filter(r => r.shortfall > 0).length; return <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (sc > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>{sc > 0 ? `⚠️ ${sc} short` : "✓ all sourced"}</span>; })()}
                </div>
                {sourceRows.some(r => r.shortfall > 0) && (
                  <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 font-semibold">⚠️ Shortfall on {sourceRows.filter(r => r.shortfall > 0).length} item(s) — not enough assigned from any source. Check with the dept head / production house.</div>
                )}
                <div className="divide-y divide-sky-100">
                  {sourceRows.map((r, i) => (
                    <div key={i} className="px-4 py-2">
                      <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 text-xs">
                        <span className="text-sky-900 font-semibold flex items-center gap-2 min-w-0">
                          {r.photo ? <img src={r.photo} alt="" onClick={() => setZoomImg(r.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-sky-100 flex items-center justify-center text-sky-300 text-xs">📦</div>}
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
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("route")}>
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">🔁 Dismantle & return routing <span className="text-xs font-normal text-gray-400">— confirm the dept head's plan, or tap a chip to route the full remaining qty</span></span>
                <div className="flex items-center gap-1.5">
                  {blockedItems.some(it => unroutedQty(it) > 0) && (<>
                    <button onClick={confirmAllPlanned} className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap">✓ Confirm all as planned</button>
                    <button onClick={routeAllToWarehouse} className="text-xs font-bold bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg whitespace-nowrap">🏬 All → warehouse</button>
                  </>)}
                  <button onClick={resetDismantle} className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg whitespace-nowrap" title="Testing: clear the plan + all movements so you can re-test">↺ Reset (testing)</button>
                </div>
              </div>
              {/* Loading manifest — grouped by destination (the dept head's plan). Each list = one place. */}
              {destGroups.length > 0 && (
                <div className="px-4 py-3 space-y-2 bg-sky-50/40 border-b">
                  <div className="text-xs font-semibold text-gray-600">📦 Loading manifest — by destination · put the truck details, mark anything broken/repair, then confirm</div>
                  {destGroups.map(g => {
                    const isTransfer = g.type === "transfer";
                    const truck = manTruck[g.key] || {};
                    const hasTruck = !!(truck.vehicle || truck.driver || truck.phone);
                    const selRows = g.items.filter(({ it }) => !isTransfer || isSel(gKey(g.key, it)));
                    const canConfirm = selRows.length > 0 && (!isTransfer || hasTruck);
                    const open = !!manOpen[g.key];
                    return (
                    <div key={g.key} className="bg-white border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                        <button onClick={() => setManOpen(o => ({ ...o, [g.key]: !o[g.key] }))} className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 text-left">
                          <span className="text-gray-400">{open ? "▾" : "▸"}</span>{g.label} <span className="text-[10px] text-gray-400">· {g.items.reduce((s, x) => s + x.qty, 0)} pc · {g.items.length} item{g.items.length > 1 ? "s" : ""}</span>{isTransfer && hasTruck ? <span className="text-[10px] text-emerald-600">· 🚛 {truck.vehicle || truck.driver || "truck set"}</span> : null}
                        </button>
                        <button onClick={() => confirmGroup(g)} disabled={!canConfirm} className="text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded-lg whitespace-nowrap">{isTransfer ? `✓ Loaded on this truck${selRows.length < g.items.length ? ` (${selRows.length})` : ""}` : "✓ Confirm — back to production house"}</button>
                      </div>
                      {open && (<>
                      {/* Truck details — only for transfers to another site (production house needs none) */}
                      {isTransfer && (
                        <div className="px-3 py-2 bg-sky-50/60 border-b space-y-1.5">
                          <div className="text-[10px] text-sky-700 font-semibold">🚛 Which truck is carrying this to {g.label.replace("↪️ ", "")}? — shown to the receiving site</div>
                          {eventTrucks.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {eventTrucks.map(f => { const on = truck.vehicle === f.vehicle && truck.driver === f.driver; return (
                                <button key={f.id} onClick={() => pickTruckFleet(g.key, f)} className={"text-[11px] px-2 py-1 rounded-lg border " + (on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-indigo-50")}>🚛 {f.vehicle || f.driver}{f.vehicle && f.driver ? ` · ${f.driver}` : ""}</button>
                              ); })}
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            <input value={truck.vehicle || ""} onChange={e => setTruckField(g.key, "vehicle", e.target.value)} placeholder="Vehicle no." className="border rounded px-2 py-1 text-xs" />
                            <input value={truck.driver || ""} onChange={e => setTruckField(g.key, "driver", e.target.value)} placeholder="Driver" className="border rounded px-2 py-1 text-xs" />
                            <input value={truck.phone || ""} onChange={e => setTruckField(g.key, "phone", e.target.value)} placeholder="Phone" className="border rounded px-2 py-1 text-xs" />
                          </div>
                          {g.items.length > 1 && <div className="text-[10px] text-gray-400">Tick only what fits on this truck — untick the rest and confirm them on a second truck.</div>}
                        </div>
                      )}
                      <div className="divide-y">
                        {g.items.map(({ it, qty }, i) => {
                          const ck = gKey(g.key, it); const c = condOf(ck);
                          const rep = Number(c.repair) || 0, brk = Number(c.broken) || 0;
                          const dest = Math.max(0, qty - rep - brk);
                          const sel = isSel(ck);
                          return (
                          <div key={i} className={"flex items-center gap-2 px-3 py-1.5 flex-wrap " + (isTransfer && !sel ? "opacity-40" : "")}>
                            {isTransfer && <input type="checkbox" checked={sel} onChange={() => toggleManSel(ck)} className="w-4 h-4" title="load this item on this truck" />}
                            {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-7 h-7 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-[10px]">📦</div>}
                            <span className="flex-1 text-xs text-gray-700 min-w-[80px]">{it.name}</span>
                            <span className={"text-[11px] font-bold w-14 text-right " + (dest > 0 ? "text-gray-900" : "text-gray-300")} title="going to this destination">→ {dest}</span>
                            <label className="flex items-center gap-0.5 text-[10px] text-amber-700" title="needs repair (kept in stock)">🔧<input type="number" min="0" max={qty} value={c.repair ?? ""} onChange={e => setManCondVal(ck, "repair", e.target.value, qty)} placeholder="0" className="w-10 border border-amber-200 rounded px-1 py-0.5 text-center" /></label>
                            <label className="flex items-center gap-0.5 text-[10px] text-red-600" title="broken — written off, removed from stock">❌<input type="number" min="0" max={qty} value={c.broken ?? ""} onChange={e => setManCondVal(ck, "broken", e.target.value, qty)} placeholder="0" className="w-10 border border-red-200 rounded px-1 py-0.5 text-center" /></label>
                            <span className="text-[10px] text-gray-400 w-10 text-right">of {qty}</span>
                            <VoiceRecorder compact value={manNote[ck]} onSave={url => setManNote(m => ({ ...m, [ck]: url }))} label="note for site" />
                          </div>
                        ); })}
                      </div>
                      </>)}
                    </div>
                  ); })}
                </div>
              )}
              {movements.some(m => m.type === "repair") && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
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
                <div className="border-t bg-gray-50/40">
                  <div className="px-4 py-1.5 text-[10px] uppercase text-gray-400 font-semibold">Movement log</div>
                  <div className="divide-y">
                    {movements.slice().reverse().map(m => (
                      <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-1.5 text-xs flex-wrap">
                        <span className={m.type === "damage" ? "text-red-600 font-semibold" : m.type === "repair" ? "text-amber-600 font-semibold" : m.type === "transfer" ? "text-sky-700" : "text-gray-600"}>
                          {m.type === "damage" ? "⚠️ Broken" : m.type === "repair" ? "🔧 Needs repair" : m.type === "transfer" ? `↪️ Reused → ${m.toEventName || "event"}` : "↩️ Returned"} · {m.qty}× {m.name}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-gray-400">{m.voiceNote && <audio src={m.voiceNote} controls className="h-6 max-w-[130px]" title="voice note" />}{m.by}{m.type === "damage" && m.invId ? " · stock −" + m.qty : m.type === "repair" ? " · kept in stock" : ""}<button onClick={() => delMovement(m.id)} className="text-red-300 hover:text-red-500 text-sm">×</button></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* On-site crew — actual held. Ops logs the real crew kept on site (count + shifts); this
                writes the same mpDay/mpWin/mpOverrides the plan uses, so it becomes the exact manpower
                cost in this event's P&L and reflects back to the salesperson in Studio. */}
            {mpRows.length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("oscrew")}>
                <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800">👷 On-site crew — actual held <span className="text-xs font-normal text-gray-400">— log the crew you actually kept; sets the real manpower cost</span></span>
                  <span className="text-sm font-bold text-gray-900">{fmt(mpCost)}{mpEdited && <span className="ml-1 text-[10px] font-semibold text-amber-600">actual</span>}</span>
                </div>
                <div className="divide-y">
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
                      <div key={i} className="px-4 py-2.5 hover:bg-gray-50/70 transition-colors">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="flex-1 text-sm font-medium text-gray-800 min-w-[90px]">{r.type}{r.shared && <span className="ml-2 text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-semibold">SHARED</span>}</span>
                          {readOnly ? <span className="text-[10px] text-gray-400">split allocation · {fmt(actCost)}</span> : daywise ? (<>
                            <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">dihari</span><span className={"w-14 rounded-lg px-2 py-1 text-sm text-center font-semibold " + (edited ? "bg-amber-50 text-amber-700 border border-amber-300" : "bg-gray-100 text-gray-700")} title="Total dihari held (crew × shifts across all days) — matches the plan until you edit below">{actDihari}</span></div>
                            {sched.length > 0 && <button onClick={() => setOsMp(o => ({ ...o, [i]: !o[i] }))} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-1.5 py-1" title="Adjust crew per day and per shift (e.g. drop the evening, or keep 1 in evening)">{expanded ? "▾ by day/shift" : "▸ by day/shift"}</button>}
                            <span className="text-sm font-semibold text-gray-700 w-24 text-right">{fmt(actCost)}</span>
                            {edited && <button onClick={() => resetMpLine(r)} className="text-[10px] text-indigo-500 hover:underline whitespace-nowrap" title="revert to the dept head's planned crew">↺ plan</button>}
                          </>) : (<>
                            <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">people</span><input type="number" min="0" value={Number(r.count) || 0} onChange={e => setActualCrew(r, i, e.target.value)} className={"w-14 border rounded-lg px-2 py-1 text-sm text-center " + ((Number(r.count) || 0) !== planPeak ? "border-amber-400 bg-amber-50 font-bold" : "")} /></div>
                            <span className="text-sm font-semibold text-gray-700 w-24 text-right">{fmt(actCost)}</span>
                            {edited && <button onClick={() => resetMpLine(r)} className="text-[10px] text-indigo-500 hover:underline whitespace-nowrap" title="revert to the dept head's planned crew">↺ plan</button>}
                          </>)}
                        </div>
                        {!readOnly && <div className="text-[10px] text-gray-400 mt-0.5 pl-0.5">{daywise
                          ? <>Planned {planDihari} dihari · {fmt(planCost)}{edited ? <span className="text-amber-600 font-semibold"> → actual {actDihari} dihari = {fmt(actCost)}</span> : ""}</>
                          : <>Planned {planPeak} × {fmt(planCost)}{edited ? <span className="text-amber-600 font-semibold"> → actual {Number(r.count) || 0} = {fmt(actCost)}</span> : ""}</>}</div>}
                        {r.type === "Labours" && anyLabours && (
                          <div className="mt-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1.5 flex items-center gap-2 flex-wrap text-[11px]">
                            <span className="font-semibold text-indigo-700">👥 All-dept labour total</span>
                            <input type="number" min="0" value={eventLabourDihari} onChange={e => setEventLabourTotal(e.target.value)} className="w-16 border border-indigo-300 rounded px-2 py-0.5 text-center font-semibold" />
                            <span className="text-indigo-600">dihari — set the whole event's labour; auto-splits across every department by usage</span>
                          </div>
                        )}
                        {expanded && daywise && sched.length > 0 && (
                          <div className="mt-1.5 bg-gray-50 border rounded-lg p-2 space-y-1">
                            <div className="text-[10px] text-gray-400">Set the crew per day & per dihari (shift). Add a dihari to split a day — e.g. 2 in the day shift + 1 in the evening; each shift is billed. Set 0 or remove to drop one.</div>
                            {sched.map((d, di) => {
                              const ids = effWinIds(r, d) || [];
                              const dayCost = mpDayCost(r, d, mpDay, mpWin, mpWinCount, rate);
                              const hasSlots = winDefs.length > 0 || ids.length > 0;
                              return (
                                <div key={di} className="flex items-start gap-2 flex-wrap text-[11px] border-b last:border-b-0 py-1.5">
                                  <span className="w-24 text-gray-600 font-medium pt-1">{phaseLbl(d)}</span>
                                  {hasSlots ? (
                                    <div className="flex items-center gap-1.5 flex-wrap flex-1">
                                      {ids.map((id, si) => { const wd = winDefs.find(w => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`; return (
                                        <span key={id} className="inline-flex items-center gap-1 border rounded-lg px-1.5 py-0.5 bg-white">
                                          <span className="text-gray-400">{lbl}</span>
                                          <input type="number" min="0" value={effShift(r, d, id)} onChange={e => setShiftCount(r.type, d.date, id, e.target.value, ids)} className="w-11 border rounded px-1 py-0.5 text-center" />
                                          {ids.length > 1 && <button onClick={() => removeDihari(r.type, d.date, id, ids)} className="text-red-300 hover:text-red-500" title="remove this dihari">×</button>}
                                        </span>
                                      ); })}
                                      <button onClick={() => addDihari(r, d.date, ids)} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-full px-2 py-0.5" title="Add another dihari (shift) for this day">+ dihari</button>
                                    </div>
                                  ) : (
                                    <label className="flex items-center gap-1 flex-1"><span className="text-gray-400">crew</span><input type="number" min="0" value={Math.round(effDay(r, d))} onChange={e => setMpDay(r.type, d.date, e.target.value)} className="w-12 border rounded px-1 py-0.5 text-center" /></label>
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
                <div className="px-4 py-2 bg-gray-50 border-t flex items-center justify-between text-xs gap-2 flex-wrap">
                  <span className="text-gray-500">Planned manpower <b className="text-gray-700">{fmt(mpPlannedCost)}</b></span>
                  <span className="text-gray-800 font-semibold">Actual held {fmt(mpCost)} {mpCost !== mpPlannedCost && <span className={mpCost < mpPlannedCost ? "text-emerald-600" : "text-red-600"}>({mpCost < mpPlannedCost ? "▼ saved " : "▲ over "}{fmt(Math.abs(mpCost - mpPlannedCost))})</span>}</span>
                </div>
              </div>
            )}
                </div>
              </div>
            </div>
            </>)}

            {/* ── P&L SUMMARY ──
                Built as the mirror of the income readout at the top of the page: same white
                panel, same two tiers, same type scale. That one opens with what the department
                earns and breaks it into heads; this one closes with what it keeps and breaks it
                into the two figures that produced it. The dark slab it used to be predated the
                light ground and read as a foreign object pasted on the end of the page. */}
            {(() => {
              const margin = projectedIncome - actualCost;
              const good = margin >= 0;
              return (
                <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
                  <div className="px-4 py-3">
                    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400">{hasActuals ? "Exact" : "Projected"} dept margin</div>
                    {/* Colour only once actuals exist. Before that the margin is not a result,
                        it is the income with nothing subtracted yet — painting it green would
                        report a profit nobody has earned. */}
                    <div className={"mt-1 text-[22px] leading-none font-bold tabular-nums tracking-tight " + (hasActuals ? (good ? "text-emerald-600" : "text-red-600") : "text-gray-300")}>
                      {hasActuals ? fmt(margin) : "—"}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">
                      {hasActuals
                        ? "Income minus the real spend logged on this event"
                        : "Log the actual spend above to turn this into a real figure"}
                    </div>
                  </div>
                  <div className="px-4 py-1.5 bg-gray-50 border-y border-gray-100">
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-500">How this is worked out</span>
                  </div>
                  <div className="grid gap-px bg-gray-100" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
                    <div className="bg-white px-4 py-2.5">
                      <div className="text-[11px] font-semibold text-gray-700">Projected income</div>
                      <div className="mt-1 text-[14px] leading-none font-bold text-gray-900 tabular-nums tracking-tight">{fmt(projectedIncome)}</div>
                      <div className="mt-0.5 text-[9px] font-medium text-gray-400">rental + crew</div>
                    </div>
                    <div className="bg-white px-4 py-2.5">
                      <div className="text-[11px] font-semibold text-gray-700">Actual cost logged</div>
                      <div className={"mt-1 text-[14px] leading-none font-bold tabular-nums tracking-tight " + (hasActuals ? "text-gray-900" : "text-gray-300")}>{hasActuals ? fmt(actualCost) : "—"}</div>
                      <div className="mt-0.5 text-[9px] font-medium text-gray-400">{hasActuals ? "what you actually spent" : "not logged yet"}</div>
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-500">
                    Actuals you save here flow to the event&apos;s P&amp;L, visible to the salesperson in Studio.
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
      {/* Click-to-enlarge lightbox — ops can view any item/kit photo big & clear */}
      {zoomImg && (
        <div onClick={() => setZoomImg(null)} className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out">
          <img src={zoomImg} alt="" className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

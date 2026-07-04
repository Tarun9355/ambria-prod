import { useState, useMemo, useEffect, useRef } from "react";
import { fmt } from "../../lib/format";
import { mpDayWise, mpBaseDay, mpEffDay, mpEffWindows, mpLineCost } from "../../lib/ims/helpers";

// ═══ DEPARTMENT OPERATIONS (Planning → Dept Ops) ═══
// Per-department backend for department heads: see their department's requirements + income for any
// event (blocked inventory with photos, manpower), override the manpower plan, and log ACTUALS
// (real mandi cost + on-site expenses) so projected cost converts to exact cost (reflected to Studio).
const DEPTS = ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric"];
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

const kwDept = (cat) => {
  const s = String(cat || "").toLowerCase();
  if (s.includes("floral") || s.includes("flower")) return "Floral";
  if (s.includes("light") || s.includes("chandel") || s.includes("led")) return "Lighting";
  if (s.includes("truss")) return "Tenting";
  if (s.includes("mask") || s.includes("fabric") || s.includes("drap") || s.includes("ceiling") || s.includes("liza") || s.includes("curtain")) return "Fabric";
  if (s.includes("platform") || s.includes("carpet") || s.includes("tent")) return "Tenting";
  if (s.includes("transport") || s.includes("truck")) return "Transport";
  if (s.includes("furnitur") || s.includes("sofa") || s.includes("chair") || s.includes("couch")) return "Furniture";
  return "Structure";
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

export default function DepartmentOpsTab({ eventOrders, setEventOrders, inventory, setInventory, blocks, settings, setSettings, trussInv, setTrussInv, authUser }) {
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => { const k = String(cat || "").toLowerCase().trim(); if (catDeptCfg[k] && DEPTS.includes(catDeptCfg[k])) return catDeptCfg[k]; return kwDept(cat); };
  const dihari = settings?.dihariSchemes || {};
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  // Department-head role → department (role name contains a department, e.g. "Tenting Head").
  const roleDept = useMemo(() => { const r = String(authUser?.role || "").toLowerCase(); return DEPTS.find(d => r.includes(d.toLowerCase())) || null; }, [authUser]);

  const [dept, setDept] = useState(roleDept || "Floral");
  const [search, setSearch] = useState("");
  const [selId, setSelId] = useState(null);
  const [zoomImg, setZoomImg] = useState(null); // click-to-enlarge lightbox (ops needs a clear big photo)
  const [opsView, setOpsView] = useState("planning"); // "planning" | "onsite" — split on-site (receiving/dismantle) into its own view
  const [dateFilter, setDateFilter] = useState(""); // YYYY-MM-DD selected on the calendar (or "")
  const now = new Date();
  const [calRef, setCalRef] = useState({ y: now.getFullYear(), m: now.getMonth() }); // visible calendar month
  const [mandiQuery, setMandiQuery] = useState(""); // autocomplete text for adding a mandi flower
  const [artHowOpen, setArtHowOpen] = useState(false); // expand the artificial-flower "how derived" box
  const [newTool, setNewTool] = useState(""); // text for adding an essential tool to the template
  const [mpOpen, setMpOpen] = useState({}); // which manpower rows have their derivation expanded
  const [mpDayHow, setMpDayHow] = useState({}); // which per-day rows have their "how" derivation expanded
  const [routeDraft, setRouteDraft] = useState({}); // dismantle routing draft per item: {qty, type, toEventId}
  const [showFleet, setShowFleet] = useState(false); // toggle the own-fleet manager
  const [newVeh, setNewVeh] = useState({ vehicle: "", driver: "", phone: "" }); // new fleet entry
  const mandiCatalogue = useMemo(() => (Array.isArray(settings?.mandiCatalogue) ? settings.mandiCatalogue : []), [settings]);

  const eventDate = (eo) => eo?.functionsDetail?.[0]?.date || eo?.date || eo?.eventDate || "";
  const today = new Date().toISOString().slice(0, 10);

  // All events (date-tagged) — drives both the calendar and the list.
  const allEvents = useMemo(() => (eventOrders || []).map(eo => ({ eo, date: eventDate(eo) })), [eventOrders]);
  const eventDatesSet = useMemo(() => new Set(allEvents.map(e => e.date).filter(Boolean)), [allEvents]);

  // Open the calendar on a month that actually has events (nearest upcoming, else latest) so a
  // booked event is never hidden behind the current month.
  const calInitRef = useRef(false);
  useEffect(() => {
    if (calInitRef.current || allEvents.length === 0) return;
    calInitRef.current = true;
    const dated = allEvents.map(e => e.date).filter(Boolean).sort();
    const target = dated.find(d => d >= today) || dated[dated.length - 1];
    if (target) { const dt = new Date(target + "T00:00:00"); setCalRef({ y: dt.getFullYear(), m: dt.getMonth() }); }
  }, [allEvents, today]);

  // Event list — search + optional date filter, sorted by date (upcoming first).
  const events = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allEvents
      // Ops plans only for SOLD/finalised events — hide un-finalised (pending) ones (matches Events tab).
      .filter(({ eo }) => eo.status && eo.status !== "pending")
      .filter(({ eo, date }) => (!q || (eo.clientName || "").toLowerCase().includes(q) || (eo.functionsDetail?.[0]?.venue || eo.venue || "").toLowerCase().includes(q)) && (!dateFilter || date === dateFilter))
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  }, [allEvents, search, dateFilter]);

  const sel = (eventOrders || []).find(e => e.id === selId);
  const selDateStr = sel ? eventDate(sel) : "";
  // Nearby events — within 7 days of the selected event.
  const nearby = useMemo(() => {
    if (!selDateStr) return [];
    const t = new Date(selDateStr + "T00:00:00").getTime();
    return events.filter(({ eo, date }) => eo.id !== selId && date && Math.abs(new Date(date + "T00:00:00").getTime() - t) <= 7 * 864e5);
  }, [events, selDateStr, selId]);

  // ── Department income snapshot (pushed from Deal Check → matches Studio exactly) ──
  const deptIncome = (sel?.deptIncome && sel.deptIncome[dept]) || null;
  const deptInvSnap = (sel?.deptInventory && Array.isArray(sel.deptInventory[dept])) ? sel.deptInventory[dept] : null;

  // ── Blocked inventory: prefer the Deal Check snapshot; fall back to IMS blocks if not synced ──
  const blockedItems = useMemo(() => {
    if (!sel) return [];
    if (deptInvSnap && deptInvSnap.length) return deptInvSnap.map((x, i) => ({ id: x.name + i, invId: x.imsId || null, name: x.name, photo: x.photo || "", qty: x.qty || 0, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "", isKit: !!x.isKit, components: Array.isArray(x.components) ? x.components : null }));
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
  }, [sel, blocks, inventory, dept]);
  const rentalIncome = blockedItems.reduce((s, x) => s + x.total, 0);

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
  const dayWise = mpDayWise;
  const effDay = (r, d) => mpEffDay(r, d, mpDay);
  const showDay = (r, d) => Math.round(effDay(r, d));
  const dayOv = (r, d) => { const ov = mpDay[r.type]; return !!(ov && ov[d.date] != null && Number(ov[d.date]) !== Math.round(mpBaseDay(r, d))); };
  const effWinIds = (r, d) => { const ov = mpWin[r.type]; return ov && ov[d.date] != null ? ov[d.date] : (Array.isArray(d.windowIds) ? d.windowIds : []); };
  const effWin = (r, d) => mpEffWindows(r, d, mpWin);
  const setMpDay = (type, date, val) => saveDept({ mpDay: { ...mpDay, [type]: { ...(mpDay[type] || {}), [date]: val } } });
  const setMpAllDays = (type, schedule, val) => { const m = { ...(mpDay[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = val; }); saveDept({ mpDay: { ...mpDay, [type]: m } }); };
  const toggleWin = (type, date, winId, curIds) => { const next = curIds.includes(winId) ? curIds.filter(x => x !== winId) : [...curIds, winId]; saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: next } } }); };
  const lineCost = (r) => mpLineCost(r, mpDay, mpOverrides, mpWin);
  const mpCost = mpRows.reduce((s, r) => s + lineCost(r), 0);
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
  const saveFleet = (next) => setSettings && setSettings(s => ({ ...s, fleet: next }));
  const pickFleet = (f) => saveDept({ dispatch: { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" } });
  const addFleet = () => { const v = (newVeh.vehicle || "").trim(); if (!v) return; saveFleet([...fleet, { id: "veh_" + Date.now(), vehicle: v, driver: (newVeh.driver || "").trim(), phone: (newVeh.phone || "").trim() }]); setNewVeh({ vehicle: "", driver: "", phone: "" }); };
  const delFleet = (id) => saveFleet(fleet.filter(f => f.id !== id));

  // Actual spend logged by the head → exact P&L (mandi list + on-site expenses + edited crew).
  const mandiSpend = dept === "Floral" ? mandiActualTotal : 0;
  const actualCost = mandiSpend + expenseTotal + mpCost;
  const hasActuals = mandiSpend > 0 || expenseTotal > 0;

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
  // Sold events sorted by date-proximity to this event (for the transfer picker — nearby dates first).
  const nearbyTransferEvents = useMemo(() => {
    const base = selDateStr ? new Date(selDateStr + "T00:00:00").getTime() : 0;
    return (eventOrders || []).filter(e => e.id !== selId && e.status && e.status !== "pending")
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
      map[key].sources.push({ from: m.fromEvent, dept: m.fromDept, qty: Number(m.qty) || 0, vehicle: m.vehicle || "", driver: m.driver || "" });
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
      const whTrucks = trucks.map((t, ti) => ({ n: ti + 1, vehicle: t.vehicle, driver: t.driver, qty: Number(t.items?.["inv:" + it.id]) || 0 })).filter(x => x.qty > 0);
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
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1 bg-gray-100 text-[9px] uppercase tracking-wide text-gray-500 font-semibold"><span>{t.perRow ? "Recipe / item" : "Sub-category"}</span><span className="text-right w-12">{t.countLabel || "Count"}</span><span className="text-right w-12">Batch</span><span className="text-right w-12">Need</span></div>
        {t.rows.map((tr, ti) => (<div key={ti} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-0.5 text-[10px] text-gray-700"><span className="truncate" title={tr.sub}>{tr.sub}</span><span className="text-right w-12">{tr.count}</span><span className="text-right w-12 text-gray-400">÷{tr.batch}</span><span className="text-right w-12 font-semibold">{tr.need.toFixed(2)}</span></div>))}
        <div className="px-2 py-1 bg-gray-50 text-[10px] text-right text-gray-600 border-t">{t.perRow ? <>Σ each ⌈need⌉ = <b className="text-gray-900">{t.result}</b></> : <>Σ {t.need.toFixed(2)} → ⌈ {Math.ceil(t.need)} ⌉ · max(min {t.min}) = <b className="text-gray-900">{t.result}</b></>}</div>
      </div>
    );
    if (t.kind === "pillars") return <div className="mb-1.5 text-[10px] text-gray-600">🏗️ {t.total} pillar(s){t.zoneP ? ` — ${t.zoneP} from truss tool${t.recipeP ? `, ${t.recipeP} from build` : ""}` : ""} → range → <b>{t.result}</b></div>;
    if (t.kind === "ratio") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.num} {t.numLabel} ÷ {t.denomLabel} = <b>{t.result}</b></div>;
    if (t.kind === "range") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.value} {t.unit} → range → <b>{t.result}</b></div>;
    if (t.kind === "labours") return <div className="mb-1.5 text-[10px] text-gray-600">📐 venue min {t.venueMin}{t.mult > 1 ? ` × ${Number(t.mult).toFixed(2)} season/timing` : ""}{t.heavy ? ` + ${t.heavy} heavy-element` : ""} = <b>{t.result}</b> (before split)</div>;
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
        <div className="text-[9px] text-gray-400 mb-1">🔼 Cumulative-max rule: crew only scales <b>up</b> across the booking — each day holds the max of its own need and any busier earlier day (it never drops mid-event). Open a day's <b>how</b> to see its own requirement; edit any day if you disagree.</div>
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
                  <button onClick={() => setMpDayHow(o => ({ ...o, [dayKey]: !o[dayKey] }))} className="text-[9px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded px-1 leading-tight" title="How this day's crew was calculated">{howOpen ? "▾" : "▸"} how</button>
                  <span className="font-medium text-gray-700">{phaseLbl(d)}</span>
                </span>
                <span className="flex items-center gap-1">
                  {editable
                    ? <input type="number" min="0" value={showDay(r, d)} onChange={e => setMpDay(r.type, d.date, e.target.value)} className={"w-10 border rounded px-1 py-0.5 text-[10px] text-center " + (ov ? "border-amber-400 bg-amber-50 font-bold" : "")} />
                    : <b>{d.count}</b>}
                  crew × {shifts} shift{shifts === 1 ? "" : "s"}
                </span>
              </div>
              {winDefs.length > 0 && (Array.isArray(d.windowIds) || (mpWin[r.type] && mpWin[r.type][d.date] != null)) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {winDefs.map(w => {
                    const on = ids.includes(w.id);
                    return editable
                      ? <button key={w.id} onClick={() => toggleWin(r.type, d.date, w.id, ids)} className={"px-1.5 py-0.5 rounded-full border text-[9px] transition-colors " + (on ? "border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold" : "border-gray-200 text-gray-400 hover:border-gray-300")}>{on ? "✓ " : ""}{w.label}</button>
                      : <span key={w.id} className={"px-1.5 py-0.5 rounded-full border text-[9px] " + (on ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-gray-100 text-gray-300")}>{on ? "✓ " : ""}{w.label}</span>;
                  })}
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
    <div className="flex gap-4">
      {/* ── Left: department + event list ── */}
      <div className="w-72 shrink-0 space-y-3">
        <div>
          <label className="text-xs text-gray-500 font-medium">Department</label>
          {roleDept && !isAdmin ? (
            <div className="mt-1 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-semibold">{DEPT_ICON[roleDept]} {roleDept}</div>
          ) : (
            <select value={dept} onChange={e => setDept(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
              {DEPTS.map(d => <option key={d} value={d}>{DEPT_ICON[d]} {d}</option>)}
            </select>
          )}
        </div>
        {/* Mini calendar — booked dates highlighted; click a date to filter */}
        {(() => {
          const { y, m } = calRef;
          const first = new Date(y, m, 1);
          const startDow = first.getDay();
          const daysInMonth = new Date(y, m + 1, 0).getDate();
          const monthLabel = first.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
          const pad = (n) => String(n).padStart(2, "0");
          const prev = () => setCalRef(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 });
          const next = () => setCalRef(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 });
          const cells = [];
          for (let i = 0; i < startDow; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) cells.push(d);
          return (
            <div className="border rounded-lg p-2">
              <div className="flex items-center justify-between mb-1.5">
                <button onClick={prev} className="px-2 text-gray-500 hover:text-gray-800 text-sm">‹</button>
                <span className="text-xs font-semibold text-gray-700">{monthLabel}</span>
                <button onClick={next} className="px-2 text-gray-500 hover:text-gray-800 text-sm">›</button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="text-[9px] text-gray-400 font-semibold">{d}</div>)}
                {cells.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
                  const hasEv = eventDatesSet.has(ds);
                  const isSel = dateFilter === ds;
                  const isToday = ds === today;
                  return (
                    <button key={i} onClick={() => setDateFilter(isSel ? "" : ds)} disabled={!hasEv}
                      className={"text-[11px] rounded h-6 flex items-center justify-center relative " + (isSel ? "bg-indigo-600 text-white font-bold" : hasEv ? "bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100 cursor-pointer" : "text-gray-300 cursor-default") + (isToday && !isSel ? " ring-1 ring-amber-400" : "")}>
                      {d}{hasEv && !isSel && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-indigo-500" />}
                    </button>
                  );
                })}
              </div>
              {dateFilter && <button onClick={() => setDateFilter("")} className="mt-1.5 w-full text-[10px] text-indigo-600 hover:text-indigo-800 font-medium">✕ Showing {dateFilter} — show all</button>}
            </div>
          );
        })()}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search event / venue…" className="w-full border rounded-lg px-3 py-2 text-sm" />
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {events.length === 0 && <div className="text-xs text-gray-400 py-4 text-center">No events.</div>}
          {events.map(({ eo, date }) => {
            const soon = date && date >= today && (new Date(date + "T00:00:00").getTime() - Date.now()) <= 7 * 864e5;
            const on = eo.id === selId;
            return (
              <div key={eo.id} onClick={() => setSelId(eo.id)} className={"px-3 py-2 rounded-lg cursor-pointer border " + (on ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:bg-gray-50")}>
                <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">{eo.clientName || "Event"} {soon && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">SOON</span>}</div>
                <div className="text-xs text-gray-500">{date || "no date"} · {eo.functionsDetail?.[0]?.venue || eo.venue || "—"}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: department detail for selected event ── */}
      <div className="flex-1 min-w-0">
        {!sel ? (
          <div className="text-center text-gray-400 py-20">Select an event to see {DEPT_ICON[dept]} {dept} requirements, income & P&L.</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-lg font-bold text-gray-900">{DEPT_ICON[dept]} {dept} — {sel.clientName || "Event"}</div>
                <div className="text-xs text-gray-500">{selDateStr || "no date"} · {sel.functionsDetail?.[0]?.venue || sel.venue || "—"}{deptData.updatedBy ? ` · last edited by ${deptData.updatedBy}` : ""}</div>
              </div>
              {nearby.length > 0 && <div className="text-xs text-gray-500">📅 {nearby.length} nearby event{nearby.length > 1 ? "s" : ""} (±7 days)</div>}
            </div>

            {/* Sub-view: Planning (dept head) vs On-site (ops manager — receiving & dismantle) */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              {[["planning", "📋 Planning"], ["onsite", "🚚 On-site"]].map(([k, l]) => (
                <button key={k} onClick={() => setOpsView(k)} className={"px-4 py-1.5 rounded-lg text-xs font-semibold transition " + (opsView === k ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700")}>{l}</button>
              ))}
            </div>

            {opsView === "planning" && (<>

            {/* Department income (from Deal Check snapshot — matches Studio). Floral is split into real
                (mandi) vs artificial; Manpower uses the LIVE edited plan so crew edits move the total. */}
            {deptIncome ? (() => {
              const artTotal = fp.artificial ? Math.round(fp.artificial.total) : 0;
              const realFloral = Math.max(0, Math.round((deptIncome.florals || 0) - artTotal));
              const liveManpower = Math.round(mpCost);   // edited crew plan (not the stale snapshot)
              const liveTotal = Math.round((deptIncome.total || 0) - (deptIncome.manpower || 0) + liveManpower);
              const rows = [["📦 Inventory rental", deptIncome.rental], ["🏗️ Truss", deptIncome.truss], ["🧵 Fabric / draping", deptIncome.fabric], ["🌿 Real flowers (mandi)", realFloral], ["🌸 Artificial flowers", artTotal], ["👷 Manpower", liveManpower], ["🏭 Production", deptIncome.production], ["🛒 Buying", deptIncome.buying], ["🚚 Transport", deptIncome.transport]];
              return (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between bg-indigo-100/60">
                  <span className="text-sm font-semibold text-indigo-900">📊 {dept} income (from Deal Check)</span>
                  <span className="text-sm font-bold text-indigo-900">{fmt(liveTotal)}</span>
                </div>
                <div className="divide-y divide-indigo-100">
                  {rows.filter(([, v]) => v > 0).map(([l, v], i) => (
                    <div key={i} className="flex justify-between px-4 py-1.5 text-xs"><span className="text-indigo-800">{l}</span><span className="font-semibold text-indigo-900">{fmt(Math.round(v))}</span></div>
                  ))}
                </div>
              </div>
              );
            })() : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">No Deal Check breakdown synced yet for this event. In Studio → Deal Check → <b>Dept Income</b>, click <b>📤 Sync to IMS Dept Ops</b> to push the numbers here.</div>
            )}

            {/* Fabric: stock vs requirement + shortfall (Fabric dept only) */}
            {dept === "Fabric" && (
              <div className="space-y-3">
                {/* Prior heads-up: any upcoming event short on fabric */}
                {upcomingFabricShort.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
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
                <div className="bg-white border rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between">
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
                          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-4 py-1.5 text-xs items-center">
                            <span className="text-gray-800">{r.colour}</span>
                            <span className="text-gray-500 w-24 text-right">need <b>{r.required} {ft.unit}</b></span>
                            <span className="text-gray-500 w-40 text-right">have {r.avail} <span className="text-gray-400">({r.old} old + {r.new} new{r.otherDay > 0 ? ` − ${r.otherDay} same-day` : ""})</span></span>
                            <span className={"w-24 text-right font-bold " + (r.short > 0 ? "text-red-600" : "text-emerald-600")}>{r.short > 0 ? `short ${r.short} ${ft.unit}` : "✓ ok"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocked inventory */}
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">📦 Inventory blocked for {dept}</span>
                <span className="text-sm font-bold text-gray-900">{fmt(rentalIncome)}</span>
              </div>
              {blockedItems.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No inventory blocked for this department on this event.</div>
              ) : (
                <div className="divide-y">
                  {blockedItems.map(it => (
                    <div key={it.id}>
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-12 h-12 rounded-lg object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg">📦</div>}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{it.name}{it.isKit && <span className="ml-2 align-middle text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">KIT</span>}</div>
                          <div className="text-xs text-gray-500">{it.sub || "—"} · {fmt(it.unit)}/unit</div>
                        </div>
                        <div className="text-sm font-semibold text-gray-700">×{it.qty}</div>
                        <div className="text-sm font-bold text-gray-900 w-20 text-right">{fmt(it.total)}</div>
                      </div>
                      {/* Kit contents — each sub-element loaded separately, with its own rental (customised
                          per-deal by the salesperson). Their totals sum to the kit total above. */}
                      {it.isKit && it.components && it.components.length > 0 && (
                        <div className="pl-8 pr-4 pb-2 pt-0.5 bg-indigo-50/30">
                          <div className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mb-1">↳ Kit contents (load these)</div>
                          <div className="space-y-1">
                            {it.components.map((cp, ci) => (
                              <div key={ci} className="flex items-center gap-2 text-xs">
                                <span className="text-indigo-300">└</span>
                                {cp.photo ? <img src={cp.photo} alt="" onClick={() => setZoomImg(cp.photo)} className="w-6 h-6 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-[10px]">🌸</div>}
                                <span className="flex-1 min-w-0 truncate text-gray-700">{cp.name} <span className="text-gray-400">· {cp.sub || "—"} · {fmt(cp.unit)}/unit</span></span>
                                <span className="font-medium text-gray-500">×{cp.qty}</span>
                                <span className="font-semibold text-gray-700 w-20 text-right">{fmt(cp.total)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Manpower plan (editable / override) */}
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">👷 Manpower plan <span className="text-xs font-normal text-gray-400">— from Studio; edit any field, it saves. Sum matches the income card.</span></span>
                <span className="text-sm font-bold text-gray-900">{fmt(mpCost)}</span>
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
                    <div key={i} className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setMpOpen(o => ({ ...o, [i]: !o[i] }))} className="shrink-0 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-1.5 py-0.5" title="How this crew number was calculated">{open ? "▾ hide" : "▸ how"}</button>
                        <span className="flex-1 text-sm font-medium text-gray-800">{r.type}{r.shared && <span className="ml-2 text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-semibold">SHARED</span>}</span>
                        {r.shared && !dayWise(r) ? (
                          <span className="text-[10px] text-gray-400 mr-2">split allocation</span>
                        ) : (<>
                          {dayWise(r)
                            ? <div className="flex items-center gap-1"><span className="text-xs text-gray-400" title="Total dihari (crew × shifts, summed across all days). Auto-calculated — edit the crew on any day in the plan below and this updates.">dihari</span><span className="w-16 border border-transparent rounded-lg px-2 py-1.5 text-sm text-center font-semibold bg-gray-100 text-gray-700" title="Auto-calculated from the day-wise plan below">{Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : 0}</span></div>
                            : <div className="flex items-center gap-1"><span className="text-xs text-gray-400">qty</span><input type="number" min="0" value={r.count} onChange={e => setMp(i, "count", e.target.value)} className={"w-16 border rounded-lg px-2 py-1.5 text-sm text-center " + (overridden ? "border-amber-400 bg-amber-50 font-bold" : "")} /></div>}
                          <div className="flex items-center gap-1"><span className="text-xs text-gray-400">₹/day</span><input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-20 border rounded-lg px-2 py-1.5 text-sm text-center" /></div>
                        </>)}
                        <div className="text-sm font-semibold text-gray-700 w-24 text-right">{fmt(lineCost(r))}</div>
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
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between">
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
                              <span className="text-gray-600 flex items-center gap-1.5">🌸 Artificial flowers {fp.artificial && <button onClick={() => setArtHowOpen(o => !o)} className="text-[9px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded px-1 leading-tight" title="How the artificial cost is derived">{artHowOpen ? "▾" : "▸"} how</button>}</span>
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
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-100/60 text-[10px] font-semibold text-emerald-900 uppercase tracking-wide items-center">
                          <span className="flex items-center gap-2">🌸 Flower
                            {seedMandi.length > 0 && <button onClick={resetMandi} title="Undo your edits — restore the system's original mandi plan from Deal Check" className="normal-case text-[9px] font-semibold text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 hover:bg-emerald-200/60">↺ Reset to system plan</button>}
                          </span>
                          <span className="text-right w-28">Projected (plan)</span>
                          <span className="text-right w-44">Real shopping</span>
                        </div>
                        {/* Column labels for the two editable fields */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 pt-1 text-[8px] text-emerald-700/70 uppercase tracking-wide">
                          <span></span><span className="w-28"></span>
                          <span className="flex items-center justify-end gap-1 w-44"><span className="w-12 text-center">qty</span><span className="text-transparent">×</span><span className="w-16 text-center">₹/unit</span><span className="w-14 text-right">total</span><span className="w-3"></span></span>
                        </div>
                        <div className="px-3 py-1 bg-emerald-50/40 text-[9px] text-emerald-700/80 border-b border-emerald-50">Real shopping = <b>qty × ₹/unit</b>. Projected = planned units from the recipe × mandi price{fp.season && fp.season.mult && fp.season.mult !== 1 ? ` × ${fp.season.mult} season` : ""}.</div>
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
                                      {art && <button onClick={() => setArtHowOpen(o => !o)} className="shrink-0 text-[9px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 rounded px-1 leading-tight" title="How the artificial cost was calculated">{artHowOpen ? "▾" : "▸"} how</button>}
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
            <div className="bg-white border rounded-xl overflow-hidden">
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
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-end">
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
                        <span className="text-sm font-semibold text-gray-700">🚛 Truck {ti + 1}</span>
                        <div className="flex items-center gap-2">
                          <select value={t.status || "loading"} onChange={e => setTruck(t.id, { status: e.target.value })} className="border rounded-lg px-2 py-1 text-xs capitalize">{TRUCK_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                          <button onClick={() => printTruckChallan(t, ti + 1)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-lg font-medium">🖨️ Challan</button>
                          <button onClick={() => delTruck(t.id)} className="text-red-400 hover:text-red-600 text-sm">×</button>
                        </div>
                      </div>
                      {fleet.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {fleet.map(f => { const on = t.vehicle === f.vehicle && t.driver === f.driver; return (
                            <button key={f.id} onClick={() => setTruck(t.id, { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" })} className={"text-[11px] px-2 py-1 rounded-lg border " + (on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-indigo-50")}>🚛 {f.vehicle}{f.driver ? ` · ${f.driver}` : ""}</button>
                          ); })}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        {[["Vehicle no.", "vehicle"], ["Driver", "driver"], ["Phone", "phone"]].map(([l, k]) => (
                          <div key={k}><label className="text-[10px] text-gray-400">{l}</label><input value={t[k] || ""} onChange={e => setTruck(t.id, { [k]: e.target.value })} placeholder={k === "vehicle" ? "outside vehicle?" : ""} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        ))}
                      </div>
                      {blockedItems.length > 0 ? (
                        <div className="border rounded-lg divide-y">
                          {blockedItems.map(it => { const k = "inv:" + it.id; const onThis = Number(t.items?.[k]) || 0; const totalLoaded = truckLoadedQty(k); const matchCls = totalLoaded === it.qty ? "text-emerald-600" : totalLoaded > it.qty ? "text-red-600" : totalLoaded > 0 ? "text-amber-600" : "text-gray-400"; return (
                            <div key={k} className="flex items-center gap-3 px-3 py-1.5">
                              {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                              <span className="flex-1 text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">need {it.qty}</span></span>
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
              <div className="bg-white border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 text-sm font-semibold text-gray-800">🔁 Dismantle plan <span className="text-xs font-normal text-gray-400">— set where each item goes after teardown; the on-site team just confirms</span></div>
                <div className="divide-y">
                  {blockedItems.map(it => {
                    const k = "inv:" + it.id; const rows = planFor(it);
                    const allocated = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
                    const remaining = (Number(it.qty) || 0) - allocated;
                    const upd = (i, patch) => setPlanRows(k, rows.map((r, j) => j === i ? { ...r, ...patch } : r));
                    const addRow = () => setPlanRows(k, [...rows, { qty: Math.max(1, remaining), type: "return" }]);
                    const delRow = (i) => setPlanRows(k, rows.filter((_, j) => j !== i));
                    return (
                      <div key={k} className="px-4 py-2 space-y-1.5">
                        <div className="flex items-center gap-3">
                          {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                          <span className="flex-1 text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">×{it.qty}</span></span>
                          <span className={"text-[10px] font-medium " + (remaining === 0 ? "text-emerald-600" : remaining > 0 ? "text-amber-600" : "text-red-600")}>{remaining === 0 ? "✓ all allocated" : remaining > 0 ? `${remaining} unallocated` : `over by ${-remaining}`}</span>
                        </div>
                        {rows.map((r, i) => (
                          <div key={i} className="pl-11 flex items-center gap-1.5 flex-wrap">
                            <input type="number" min="0" value={r.qty} onChange={e => upd(i, { qty: e.target.value })} className="w-14 border rounded px-2 py-1 text-xs text-center" title="qty for this destination" />
                            {["return", "transfer", "repair", "damage"].map(t => (
                              <button key={t} onClick={() => upd(i, { type: t })} className={"text-[11px] px-2.5 py-1 rounded-full border font-medium " + (r.type === t ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300 text-gray-600 hover:bg-gray-100")}>{ROUTE_LABEL[t]}</button>
                            ))}
                            {r.type === "transfer" && (
                              <select value={r.toEventId || ""} onChange={e => { const ev = (eventOrders || []).find(x => x.id === e.target.value); upd(i, { toEventId: e.target.value, toEventName: ev?.clientName || "" }); }} className="border rounded px-2 py-1 text-xs max-w-[220px]">
                                <option value="">Pick destination event (nearby first)…</option>
                                {nearbyTransferEvents.map(({ e, d, off }) => <option key={e.id} value={e.id}>{e.clientName || "Event"} · {d || "no date"}{off === 0 ? " (same day)" : off > 0 ? ` (+${off}d)` : ` (${off}d)`}</option>)}
                              </select>
                            )}
                            {rows.length > 1 && <button onClick={() => delRow(i)} className="text-red-300 hover:text-red-500 text-sm" title="remove this split">×</button>}
                          </div>
                        ))}
                        <div className="pl-11"><button onClick={addRow} className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium">+ Split to another place</button></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </>)}

            {opsView === "onsite" && (<>
            {/* Department chips — the on-site ops manager runs the WHOLE function; tap a dept to see
                its receiving + dismantle list (with photos). Only depts that have inventory show. */}
            {(() => {
              const deptsWithItems = DEPTS.filter(d => (sel.deptInventory?.[d]?.length || 0) > 0);
              if (deptsWithItems.length <= 1) return null;
              return (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {deptsWithItems.map(d => (
                    <button key={d} onClick={() => setDept(d)} className={"px-3 py-1.5 rounded-full text-xs font-semibold border transition " + (dept === d ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>{DEPT_ICON[d] || "📦"} {d} <span className={dept === d ? "text-indigo-200" : "text-gray-400"}>{sel.deptInventory[d].length}</span></button>
                  ))}
                </div>
              );
            })()}
            {/* Receiving — ops manager sees every item's sources (which truck + driver, from where) + shortfall */}
            {sourceRows.length > 0 && (
              <div className="bg-sky-50 border border-sky-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-sky-100/70 text-sm font-bold text-sky-800">📥 Receiving — sources per item <span className="text-xs font-normal text-sky-600">— who's bringing what, on which truck</span></div>
                {sourceRows.some(r => r.shortfall > 0) && (
                  <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 font-semibold">⚠️ Shortfall on {sourceRows.filter(r => r.shortfall > 0).length} item(s) — not enough assigned from any source. Check with the dept head / production house.</div>
                )}
                <div className="divide-y divide-sky-100">
                  {sourceRows.map((r, i) => (
                    <div key={i} className="px-4 py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-sky-900 font-semibold flex items-center gap-2">
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
                        {r.whTrucks.map((t, j) => <div key={"w" + j}>🚛 {t.qty}× from production house · Truck {t.n}{t.vehicle ? ` (${t.vehicle}${t.driver ? " · " + t.driver : ""})` : t.driver ? ` (${t.driver})` : ""}</div>)}
                        {r.sources.map((s, j) => <div key={"r" + j} className="text-sky-700">↪️ {s.qty}× reused from {s.from} ({s.dept}){s.vehicle || s.driver ? ` · ${s.vehicle || ""}${s.vehicle && s.driver ? " · " : ""}${s.driver || ""}` : ""}</div>)}
                        {r.whTrucks.length === 0 && r.sources.length === 0 && <div className="text-gray-400">No truck assigned yet.</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dismantle & return routing */}
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">🔁 Dismantle & return routing <span className="text-xs font-normal text-gray-400">— confirm the dept head's plan, or tap a chip to route the full remaining qty</span></span>
                {blockedItems.some(it => unroutedQty(it) > 0) && (
                  <div className="flex gap-1.5">
                    <button onClick={confirmAllPlanned} className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap">✓ Confirm all as planned</button>
                    <button onClick={routeAllToWarehouse} className="text-xs font-bold bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg whitespace-nowrap">🏬 All → warehouse</button>
                  </div>
                )}
              </div>
              {movements.some(m => m.type === "repair") && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
                  🔧 <b>Repairs needed</b> (kept in stock — fix before next use): {movements.filter(m => m.type === "repair").map((m, i) => <span key={m.id}>{i > 0 ? ", " : ""}{m.qty}× {m.name}</span>)}
                </div>
              )}
              {blockedItems.length === 0 ? (
                <div className="px-4 py-5 text-center text-xs text-gray-400">No inventory to route for this department.</div>
              ) : (
                <div className="divide-y">
                  {blockedItems.map(it => {
                    const k = "inv:" + it.id;
                    const ret = movedQty(k, "return"), tr = movedQty(k, "transfer"), dmg = movedQty(k, "damage"), rep = movedQty(k, "repair");
                    const routed = ret + tr + dmg + rep;
                    const unrouted = Math.max(0, it.qty - routed);
                    const d = routeDraft[k] || { type: "return" };
                    return (
                      <div key={k} className="px-4 py-2.5 space-y-1.5">
                        <div className="flex items-center gap-3">
                          {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                          <span className="flex-1 text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">out {it.qty}{it.invId ? "" : " · not stock-linked"}</span></span>
                          <span className="text-[10px] text-gray-400">{unrouted > 0 ? `${unrouted} to route` : "✓ all routed"}</span>
                        </div>
                        {(() => { if (unrouted <= 0) return null; const rows = planFor(it).filter(r => (Number(r.qty) || 0) > 0); if (!rows.length) return null; const summary = rows.map(r => { const ev = r.type === "transfer" ? ((eventOrders || []).find(e => e.id === r.toEventId)?.clientName || r.toEventName || "event") : ""; return `${r.qty} ${ROUTE_SHORT[r.type] || r.type}${r.type === "transfer" ? " " + ev : ""}`; }).join(" · "); return (
                          <div className="pl-11 flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5 font-semibold">📋 Plan: {summary}</span>
                            <button onClick={() => confirmItemPlanned(it)} className="text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-full">✓ Confirm plan</button>
                          </div>
                        ); })()}
                        {(ret > 0 || tr > 0 || dmg > 0 || rep > 0) && (
                          <div className="text-[10px] pl-11 flex gap-3 flex-wrap">
                            {ret > 0 && <span className="text-gray-500">↩️ returned {ret}</span>}
                            {tr > 0 && <span className="text-sky-600">↪️ reused {tr}</span>}
                            {rep > 0 && <span className="text-amber-600 font-semibold">🔧 to repair {rep}</span>}
                            {dmg > 0 && <span className="text-red-600 font-semibold">⚠️ broken {dmg}</span>}
                          </div>
                        )}
                        {unrouted > 0 && (
                          <div className="pl-11 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-gray-400">Route all {unrouted}:</span>
                            <button onClick={() => routeRemaining(it, "return")} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-300 hover:bg-gray-100 font-medium">🏬 Warehouse</button>
                            <button onClick={() => routeRemaining(it, "repair")} className="text-[11px] px-2.5 py-1 rounded-full border border-amber-300 text-amber-700 hover:bg-amber-50 font-medium">🔧 Repair</button>
                            <button onClick={() => routeRemaining(it, "damage")} className="text-[11px] px-2.5 py-1 rounded-full border border-red-300 text-red-700 hover:bg-red-50 font-medium">❌ Broken</button>
                          </div>
                        )}
                        <div className="pl-11 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] text-gray-400">or partial / transfer:</span>
                          <input type="number" min="0" max={unrouted} value={d.qty ?? unrouted} onChange={e => setDraft(k, { qty: e.target.value })} placeholder="qty" className="w-16 border rounded px-2 py-1 text-xs text-center" />
                          <select value={d.type} onChange={e => setDraft(k, { type: e.target.value })} className="border rounded px-2 py-1 text-xs">
                            <option value="return">↩️ Back to warehouse</option>
                            <option value="transfer">↪️ Reuse at another site</option>
                            <option value="repair">🔧 Needs repair (keep in stock)</option>
                            <option value="damage">⚠️ Broken — write off (remove from stock)</option>
                          </select>
                          {d.type === "transfer" && (<>
                            <select value={d.toEventId || ""} onChange={e => setDraft(k, { toEventId: e.target.value })} className="border rounded px-2 py-1 text-xs max-w-[180px]">
                              <option value="">Pick destination event…</option>
                              {(eventOrders || []).filter(e => e.id !== sel.id).map(e => <option key={e.id} value={e.id}>{e.clientName || "Event"} · {eventDate(e) || "no date"}</option>)}
                            </select>
                            {fleet.length > 0 && (
                              <select value={(fleet.find(f => f.vehicle === d.vehicle && f.driver === d.driver) || {}).id || ""} onChange={e => { const f = fleet.find(x => x.id === e.target.value); setDraft(k, { vehicle: f?.vehicle || "", driver: f?.driver || "", phone: f?.phone || "" }); }} className="border rounded px-2 py-1 text-xs max-w-[150px]">
                                <option value="">Truck…</option>
                                {fleet.map(f => <option key={f.id} value={f.id}>🚛 {f.vehicle}{f.driver ? " · " + f.driver : ""}</option>)}
                              </select>
                            )}
                            <input value={d.vehicle || ""} onChange={e => setDraft(k, { vehicle: e.target.value })} placeholder="vehicle" className="w-24 border rounded px-2 py-1 text-xs" />
                            <input value={d.driver || ""} onChange={e => setDraft(k, { driver: e.target.value })} placeholder="driver" className="w-24 border rounded px-2 py-1 text-xs" />
                          </>)}
                          <button onClick={() => logRoute(it)} disabled={!(Number(d.qty) > 0) || (d.type === "transfer" && !d.toEventId)} className="text-xs bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white px-3 py-1 rounded-lg font-medium">Log</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Movement log for this event */}
              {movements.length > 0 && (
                <div className="border-t bg-gray-50/40">
                  <div className="px-4 py-1.5 text-[10px] uppercase text-gray-400 font-semibold">Movement log</div>
                  <div className="divide-y">
                    {movements.slice().reverse().map(m => (
                      <div key={m.id} className="flex items-center justify-between px-4 py-1.5 text-xs">
                        <span className={m.type === "damage" ? "text-red-600 font-semibold" : m.type === "repair" ? "text-amber-600 font-semibold" : m.type === "transfer" ? "text-sky-700" : "text-gray-600"}>
                          {m.type === "damage" ? "⚠️ Broken" : m.type === "repair" ? "🔧 Needs repair" : m.type === "transfer" ? `↪️ Reused → ${m.toEventName || "event"}` : "↩️ Returned"} · {m.qty}× {m.name}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-gray-400">{m.by}{m.type === "damage" && m.invId ? " · stock −" + m.qty : m.type === "repair" ? " · kept in stock" : ""}<button onClick={() => delMovement(m.id)} className="text-red-300 hover:text-red-500 text-sm">×</button></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            </>)}

            {/* P&L summary */}
            <div className="bg-gray-900 text-white rounded-xl p-4 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-gray-300">Projected income (rental + crew)</span><span className="font-semibold">{fmt(projectedIncome)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-300">Actual cost logged</span><span className="font-semibold text-emerald-300">{hasActuals ? fmt(actualCost) : "— not logged yet"}</span></div>
              <div className="flex justify-between text-base font-bold border-t border-white/10 pt-2 mt-1">
                <span>{hasActuals ? "Exact" : "Projected"} dept margin</span>
                <span className={hasActuals ? ((projectedIncome - actualCost) >= 0 ? "text-emerald-400" : "text-red-400") : "text-gray-400"}>{hasActuals ? fmt(projectedIncome - actualCost) : "—"}</span>
              </div>
              <div className="text-[10px] text-gray-400 pt-1">Actuals you save here flow to the event's P&L (visible to the salesperson in Studio).</div>
            </div>
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

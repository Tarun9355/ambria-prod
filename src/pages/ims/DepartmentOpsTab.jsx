import { useState, useMemo, useEffect, useRef } from "react";
import { fmt } from "../../lib/format";

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

export default function DepartmentOpsTab({ eventOrders, setEventOrders, inventory, blocks, settings, setSettings, trussInv, setTrussInv, authUser }) {
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => { const k = String(cat || "").toLowerCase().trim(); if (catDeptCfg[k] && DEPTS.includes(catDeptCfg[k])) return catDeptCfg[k]; return kwDept(cat); };
  const dihari = settings?.dihariSchemes || {};
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  // Department-head role → department (role name contains a department, e.g. "Tenting Head").
  const roleDept = useMemo(() => { const r = String(authUser?.role || "").toLowerCase(); return DEPTS.find(d => r.includes(d.toLowerCase())) || null; }, [authUser]);

  const [dept, setDept] = useState(roleDept || "Floral");
  const [search, setSearch] = useState("");
  const [selId, setSelId] = useState(null);
  const [dateFilter, setDateFilter] = useState(""); // YYYY-MM-DD selected on the calendar (or "")
  const now = new Date();
  const [calRef, setCalRef] = useState({ y: now.getFullYear(), m: now.getMonth() }); // visible calendar month
  const [mandiQuery, setMandiQuery] = useState(""); // autocomplete text for adding a mandi flower
  const [newTool, setNewTool] = useState(""); // text for adding an essential tool to the template
  const [mpOpen, setMpOpen] = useState({}); // which manpower rows have their derivation expanded
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
    if (deptInvSnap && deptInvSnap.length) return deptInvSnap.map((x, i) => ({ id: x.name + i, name: x.name, photo: x.photo || "", qty: x.qty || 0, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "" }));
    const out = [];
    Object.entries(blocks || {}).forEach(([itemId, arr]) => {
      const qty = (arr || []).filter(b => b.eventId === sel.id).reduce((s, b) => s + (Number(b.qty) || 0), 0);
      if (qty <= 0) return;
      const item = (inventory || []).find(i => String(i.id) === String(itemId));
      if (!item) return;
      const d = catToDept(item.cat || item.category);
      if (d !== dept) return;
      const unit = Number(item.price ?? item.rentalCost) || 0;
      out.push({ id: itemId, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, unit, total: unit * qty, sub: item.subCat || item.subcategory || "" });
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
  const mpRows = Array.isArray(deptData.mp) ? deptData.mp
    : (mpDetail ? mpDetail.map(r => ({ type: r.type, count: r.count ?? "", rate: r.rate || 0, basis: r.basis || "", shared: !!r.shared, sysCount: r.count, sysRate: r.rate || 0, sysCost: r.cost || 0, days: dayCount(Number(r.count) || 0, Number(r.rate) || 0, Number(r.cost) || 0) }))
      : (sysPlan.length ? sysPlan.map(p => ({ type: p.type, count: p.count, rate: p.rate || Number(dihari[p.type]?.rate) || 0, basis: p.basis || "", sysCount: p.count, sysRate: p.rate || 0, sysCost: (p.count || 0) * (p.rate || 0), days: 1 }))
        : deptTypes.map(t => ({ type: t, count: "", rate: Number(dihari[t]?.rate) || 0, basis: "", sysCount: null, sysRate: 0, sysCost: 0, days: 1 }))));
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

  // Line cost reconciles to Studio: shared rows = fixed allocation; mapped rows scale by edits.
  const lineCost = (r) => {
    if (r.shared) return Number(r.sysCost) || 0;
    const sc = Number(r.sysCount) || 0, sr = Number(r.sysRate) || 0, scost = Number(r.sysCost) || 0;
    if (sc > 0 && sr > 0 && scost > 0) return Math.round(scost * ((Number(r.count) || 0) / sc) * ((Number(r.rate) || 0) / sr));
    return (Number(r.count) || 0) * (Number(r.rate) || 0);
  };
  const mpCost = mpRows.reduce((s, r) => s + lineCost(r), 0);
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const realMandiNum = Number(realMandi) || 0;
  const projectedIncome = Math.round(deptIncome ? (Number(deptIncome.total) || 0) : (rentalIncome + mpCost)); // full dept income from Deal Check, else local

  const setMp = (i, key, val) => { const next = mpRows.map((r, j) => j === i ? { ...r, [key]: val } : r); saveDept({ mp: next }); };
  const addMp = () => saveDept({ mp: [...mpRows, { type: "Labours", count: "", rate: Number(dihari["Labours"]?.rate) || 0 }] });
  const addExpense = () => saveDept({ expenses: [...expenses, { label: "", amount: "" }] });
  const setExpense = (i, key, val) => { const next = expenses.map((e, j) => j === i ? { ...e, [key]: val } : e); saveDept({ expenses: next }); };
  const delExpense = (i) => saveDept({ expenses: expenses.filter((_, j) => j !== i) });

  // ── Floral: editable real-mandi shopping list (projected vs actual, side-by-side) ──
  const fp = sel?.floralPlan || {};
  const fpFlowers = Array.isArray(fp.flowers) ? fp.flowers : [];
  const artificialProj = fpFlowers.filter(f => f.artificial).reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const seedMandi = fpFlowers.filter(f => !f.artificial && (Number(f.qty) || 0) > 0)
    .map(f => ({ name: f.name, unit: f.unit || "", projQty: Number(f.qty) || 0, projCost: Number(f.cost) || 0, qty: Number(f.qty) || 0, price: f.qty ? Math.round((Number(f.cost) || 0) / f.qty) : 0 }));
  const mandiRows = Array.isArray(deptData.mandiLines) ? deptData.mandiLines : seedMandi;
  const mandiActualReal = mandiRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const mandiActualTotal = mandiActualReal + artificialProj; // artificial carried over (not re-shopped at mandi)
  const projMandiReal = mandiRows.reduce((s, r) => s + (Number(r.projCost) || 0), 0);
  // Persist the list AND the headline actual (realMandi) so Studio's P&L reflection picks it up.
  const saveMandi = (next) => saveDept({ mandiLines: next, realMandi: next.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0) + artificialProj });
  const setMandi = (i, key, val) => saveMandi(mandiRows.map((r, j) => j === i ? { ...r, [key]: val } : r));
  const delMandi = (i) => saveMandi(mandiRows.filter((_, j) => j !== i));
  const addMandi = (cat) => { saveMandi([...mandiRows, { name: cat.name, unit: cat.unit || "", projQty: 0, projCost: 0, qty: 1, price: Number(cat.currentPrice) || 0 }]); setMandiQuery(""); };
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
  // Requirement vs available for the SELECTED event.
  const fabricReqRows = (dept === "Fabric" && sel?.fabricPlan) ? FABRIC_TYPES.map(ft => {
    const req = Array.isArray(sel.fabricPlan[ft.key]) ? sel.fabricPlan[ft.key] : [];
    const rows = req.map(r => { const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 }; const avail = av.old + av.new; return { colour: r.colour, required: r.qty, old: av.old, new: av.new, avail, short: Math.max(0, r.qty - avail) }; });
    return { ...ft, rows };
  }).filter(f => f.rows.length) : [];
  // All upcoming events scanned for fabric shortfalls → prior heads-up for ordering.
  const upcomingFabricShort = useMemo(() => {
    if (dept !== "Fabric") return [];
    const out = [];
    (eventOrders || []).forEach(eo => {
      const d = eventDate(eo); if (!d || d < today || !eo.fabricPlan) return;
      FABRIC_TYPES.forEach(ft => {
        (Array.isArray(eo.fabricPlan[ft.key]) ? eo.fabricPlan[ft.key] : []).forEach(r => {
          const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 };
          const short = (Number(r.qty) || 0) - (av.old + av.new);
          if (short > 0) out.push({ event: eo.clientName || "Event", date: d, fabric: ft.label, colour: r.colour, short, unit: ft.unit });
        });
      });
    });
    return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [dept, eventOrders, fabricAvail, today]);

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

            {/* Department income (from Deal Check snapshot — matches Studio) */}
            {deptIncome ? (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between bg-indigo-100/60">
                  <span className="text-sm font-semibold text-indigo-900">📊 {dept} income (from Deal Check)</span>
                  <span className="text-sm font-bold text-indigo-900">{fmt(Math.round(deptIncome.total || 0))}</span>
                </div>
                <div className="divide-y divide-indigo-100">
                  {[["📦 Inventory rental", deptIncome.rental], ["🏗️ Truss", deptIncome.truss], ["🧵 Fabric / draping", deptIncome.fabric], ["🌸 Floral (mandi)", deptIncome.florals], ["👷 Manpower", deptIncome.manpower], ["🏭 Production", deptIncome.production], ["🛒 Buying", deptIncome.buying], ["🚚 Transport", deptIncome.transport]].filter(([, v]) => v > 0).map(([l, v], i) => (
                    <div key={i} className="flex justify-between px-4 py-1.5 text-xs"><span className="text-indigo-800">{l}</span><span className="font-semibold text-indigo-900">{fmt(Math.round(v))}</span></div>
                  ))}
                </div>
              </div>
            ) : (
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
                          <span className="text-red-700">short <b>{s.short} {s.unit}</b> for {s.event} on <b>{s.date}</b></span>
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
                            <span className="text-gray-500 w-32 text-right">have {r.avail} <span className="text-gray-400">({r.old} old + {r.new} new)</span></span>
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
                    <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                      {it.photo ? <img src={it.photo} alt="" className="w-12 h-12 rounded-lg object-cover border" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg">📦</div>}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{it.name}</div>
                        <div className="text-xs text-gray-500">{it.sub || "—"} · {fmt(it.unit)}/unit</div>
                      </div>
                      <div className="text-sm font-semibold text-gray-700">×{it.qty}</div>
                      <div className="text-sm font-bold text-gray-900 w-20 text-right">{fmt(it.total)}</div>
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
                        <button onClick={() => setMpOpen(o => ({ ...o, [i]: !o[i] }))} className="text-gray-400 hover:text-gray-700 text-xs w-4 shrink-0" title={open ? "Hide how it's calculated" : "Show how it's calculated"}>{open ? "▾" : "▸"}</button>
                        <span className="flex-1 text-sm font-medium text-gray-800">{r.type}{r.shared && <span className="ml-2 text-[9px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-semibold">SHARED</span>}{days > 1 && !r.shared && <span className="ml-2 text-[10px] text-gray-400 font-normal">{days} days</span>}</span>
                        {r.shared ? (
                          <span className="text-[10px] text-gray-400 mr-2">split allocation</span>
                        ) : (<>
                          <div className="flex items-center gap-1"><span className="text-xs text-gray-400">qty</span><input type="number" min="0" value={r.count} onChange={e => setMp(i, "count", e.target.value)} className={"w-16 border rounded-lg px-2 py-1.5 text-sm text-center " + (overridden ? "border-amber-400 bg-amber-50 font-bold" : "")} /></div>
                          <div className="flex items-center gap-1"><span className="text-xs text-gray-400">₹/day</span><input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-20 border rounded-lg px-2 py-1.5 text-sm text-center" /></div>
                        </>)}
                        <div className="text-sm font-semibold text-gray-700 w-24 text-right">{fmt(lineCost(r))}</div>
                      </div>
                      {open && (
                        <div className="text-[10px] text-gray-500 mt-1.5 pl-7 leading-relaxed bg-gray-50 rounded-lg p-2">
                          {r.shared ? (
                            <>This dept's share of general labour / supervisors, split across departments by each dept's income share. Fixed allocation = <b>{fmt(Number(r.sysCost) || 0)}</b>.</>
                          ) : (<>
                            {r.basis && <span className="text-gray-600">📐 {r.basis}<br /></span>}
                            {r.sysCount != null && r.sysCount !== "" && (
                              <span className={overridden ? "text-amber-600 font-semibold" : "text-gray-500"}>
                                Studio plan: {r.sysCount} crew × {fmt(r.sysRate || 0)}/day{days > 1 ? ` × ${days} days` : ""} = {fmt(r.sysCost || 0)}
                                {overridden && <> → you set <b>{r.count || 0} × {fmt(r.rate || 0)}/day{days > 1 ? ` × ${days} days` : ""} = {fmt(lineCost(r))}</b></>}
                              </span>
                            )}
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
                      {fp.season && fp.season.mult && fp.season.mult !== 1 && <div className="px-3 py-1.5 rounded-lg text-[10px] text-emerald-700 bg-emerald-100/50 border border-emerald-100">📅 {fp.season.label} date — mandi flower prices ×{fp.season.mult} (e.g. a ₹1000 flower bills at ₹{Math.round(1000 * fp.season.mult)})</div>}
                      {/* Projected vs real mandi — side by side, editable real shopping list */}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-100/60 text-[10px] font-semibold text-emerald-900 uppercase tracking-wide">
                          <span>🌸 Flower</span><span className="text-right w-28">Projected (plan)</span><span className="text-right w-44">Real shopping</span>
                        </div>
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
                            {artificialProj > 0 && <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 items-center bg-gray-50/60"><div className="text-xs text-gray-500">Artificial flowers / greens <span className="text-[10px] text-gray-400">(not mandi-shopped)</span></div><div className="text-right w-28 text-xs text-gray-400">{fmt(artificialProj)}</div><div className="text-right w-44 text-xs text-gray-500 pr-6">{fmt(artificialProj)}</div></div>}
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
                          {blockedItems.map(it => { const k = "inv:" + it.id; const onThis = Number(t.items?.[k]) || 0; const remaining = Math.max(0, it.qty - (truckLoadedQty(k) - onThis)); return (
                            <div key={k} className="flex items-center gap-3 px-3 py-1.5">
                              {it.photo ? <img src={it.photo} alt="" className="w-8 h-8 rounded object-cover border" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs">📦</div>}
                              <span className="flex-1 text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">({remaining} left of {it.qty})</span></span>
                              <input type="number" min="0" max={it.qty} value={onThis || ""} onChange={e => setTruckItem(t.id, k, e.target.value)} placeholder="0" className="w-16 border rounded px-2 py-1 text-sm text-center" />
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
    </div>
  );
}

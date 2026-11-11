// ═══ Per-department crew (manpower) engine — extracted from DepartmentOpsTab.jsx ═══
// Pure, no React: builds the SAME editable crew rows ("mpRows") and the SAME write patches the
// dept-head Planning screen and the on-site "actual held" panel have always used, so a second
// consumer (the Site Supervisor page, which needs every department's crew on one screen instead
// of one department's at a time) can call this instead of re-deriving the logic a second time.
// Moving a rule here and NOT also updating DepartmentOpsTab.jsx to call it would silently fork
// the two screens' numbers — DepartmentOpsTab.jsx is wired to call these same functions, not a
// copy of them, specifically to rule that out.
import { withSetupSlot } from "../studio/dihariWindows.js";
import { mpDayWise, mpBaseDay, mpEffDay, mpEffWindows, mpLineCost, mpDayCost, mpDayDihari } from "./helpers";
import { matchFlowerPattern } from "./flowerHelpers";
import { walkKitUnits } from "./helpers";
import { poolLabourDept, makeSubcatDept } from "./deptClassify";
import { DEPTS } from "./deptClassify";

// Primary manpower types per department (for the editable crew plan) — every department except
// Floral carries no Labours row of its own any more (owner ask, originally 2026-10-27 for just
// Furniture/Fabric, widened 2026-11-07 to every non-Floral department): one shared crew pool now
// covers all of them, pooling into Structure's row instead (deptClassify.js's poolLabourDept).
export const DEPT_MP = {
  Floral: ["Flowerists", "Labours"],
  Structure: ["Carpenters", "Labours"],
  Tenting: ["Painters", "Truss Labour", "Fabric Bangali"],
  Fabric: [],
  Lighting: ["Electricians"],
  Transport: ["Drivers"],
  Furniture: [],
};

const SHIFT_START_HOUR = { brunch: 11, morning: 9, lunch: 12, sundowner: 16, evening: 18, dinner: 20, night: 20, latenight: 22, "late night": 22 };
const slotHours = (label) => {
  const m = [...String(label || "").matchAll(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi)].map(x => (Number(x[1]) % 12) + (x[3].toUpperCase() === "PM" ? 12 : 0) + (Number(x[2]) || 0) / 60);
  return m.length ? { start: m[0], end: m.length > 1 ? m[1] : null } : null;
};

// ── DIHARI SLOTS IN THE ORDER THE CREW WORKS THEM ──
// A day's shift slots are shown starting from the slot just before that day's first function and
// then round the clock: a 9 AM Mata Ki Chowki puts 2 AM–8 AM first, then 9 AM–6 PM, then 6 PM–2 AM.
const firstFnHour = (mpFns, date) => {
  const hrs = mpFns.filter(f => String(f?.date || "").slice(0, 10) === date)
    .map(f => SHIFT_START_HOUR[String(f?.shift || "").trim().toLowerCase()]).filter(h => h != null);
  return hrs.length ? Math.min(...hrs) : 9;
};
export const orderWinIds = (ids, winDefs, date, mpFns) => {
  if (!Array.isArray(ids) || ids.length < 2) return ids;
  const hrsOf = (id) => slotHours((winDefs || []).find(w => w.id === id)?.label);
  const fnHour = firstFnHour(mpFns, date);
  let anchor = 0, best = -1;
  ids.forEach(id => { const h = hrsOf(id); if (h && h.end != null && h.end > h.start && h.end <= fnHour && h.end > best) { best = h.end; anchor = h.start; } });
  const key = (id) => { const h = hrsOf(id); return h ? (h.start - anchor + 24) % 24 : 99; };
  return [...ids].sort((a, b) => key(a) - key(b));
};

// ── EACH DIHARI SLOT'S DEFAULT CREW, FROM THE FUNCTIONS IT SERVES ──
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

// Flowerists rows for ONE function, worked out from its own zone lists — the same walk Deal
// Check's traceOf("Flowerists") does. Lets a day show every function's column even when the
// order was synced before Deal Check started sending trace.byFn.
export const flowerTraceForFn = (fn, { inventory, invByIdMp, flowerPatterns }) => {
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

// A labour usage row's crew pool, by the rule as it stands now - the item's own department (ownDept, recorded by Deal Check),
// else its sub-category's (makeSubcatDept: map entry / keyword / its category's), pooled - not the pool an older sync recorded
// (ur.dept): a Floral item (Cabinets Console) must never sit in Structure's crew, synced before the rule changed or not.
const usageDept = (ur, subDept) => poolLabourDept(ur?.ownDept || subDept(ur?.sub));

const fnCrewForDay = (s, d, { mpFns, dept, subDept, flowerPatterns, inventory, invByIdMp }) => {
  const t = d?.trace;
  if (!t || d.phase !== "event") return null;
  const fnsToday = mpFns.filter(f => String(f?.date || "").slice(0, 10) === d.date);
  if (s.shared) {
    if (t.kind !== "labours" || !Array.isArray(t.byFn) || !t.byFn.length) return null;
    return t.byFn.map(c => {
      const rows = Array.isArray(c?.trace?.usageRows) ? c.trace.usageRows.filter(ur => usageDept(ur, subDept) === dept) : [];
      const need = Math.round(rows.reduce((acc, ur) => acc + (Number(ur.need) || 0), 0) * 100) / 100;
      return { shift: c.shift || fnsToday.find(f => f?.type === c.fn)?.shift || "", crew: Math.ceil(need) };
    });
  }
  if (Array.isArray(t.byFn) && t.byFn.length) return t.byFn.map(c => ({ shift: c.shift || fnsToday.find(f => f?.type === c.fn)?.shift || "", crew: Number(c.result) || 0 }));
  if (t.kind === "tier2" && t.perRow && fnsToday.length) return fnsToday.map(f => ({ shift: f?.shift || "", crew: flowerTraceForFn(f, { inventory, invByIdMp, flowerPatterns }).result }));
  return null;
};

const slotDefaults = (s, d, ctx) => {
  const { deptData, dihari, mpFns } = ctx;
  const fnc = fnCrewForDay(s, d, ctx); if (!fnc || !fnc.length) return null;
  const winDefs = (dihari[s.type] && Array.isArray(dihari[s.type].windows)) ? dihari[s.type].windows : [];
  const ov = deptData.mpWin && deptData.mpWin[s.type];
  const ids = ov && ov[d.date] != null ? ov[d.date] : d.windowIds;
  if (!Array.isArray(ids) || !ids.length) return null;
  const { pre, day, night } = slotRoleIds(ids, winDefs);
  const first = ids.length === 1 ? ids[0] : (orderWinIds(ids, winDefs, d.date, mpFns) || ids)[0];
  const out = {};
  const addTo = (id, n) => { if (id) out[id] = (out[id] || 0) + n; };
  fnc.forEach(({ shift, crew }) => {
    const h = SHIFT_START_HOUR[String(shift || "").trim().toLowerCase()];
    if (h != null && h <= 12) addTo(pre || day || first, crew); else addTo(day || pre || first, crew);
    if (h != null && h >= 18 && night && night !== (day || pre || first)) addTo(night, crew);
  });
  return Object.keys(out).length ? out : null;
};

// ── THE MAIN BUILD ──
// Builds everything ONE department's crew panel needs: the editable rows (mpRows), the raw edit
// maps (mpDay/mpWin/mpWinCount/mpOverrides/mpExtra), and the reconciled cost. Identical to what
// DepartmentOpsTab.jsx computed inline before this file existed — see its own history for the
// rule-by-rule rationale (function-driven slot defaults, the setup-shift patch, mpWinCount basis
// filtering, etc.), which is not repeated here.
export function buildDeptCrew({ sel, dept, settings, inventory, flowerPatterns, catToDept }) {
  const deptData = (sel?.deptOps && sel.deptOps[dept]) || {};
  const deptTypes = DEPT_MP[dept] || ["Labours"];
  const mpFns = Array.isArray(sel?.functionsDetail) ? sel.functionsDetail : [];
  const dihari = settings?.dihariSchemes || {};
  const invByIdMp = new Map((inventory || []).map(i => [i.id, i]));
  const subDept = makeSubcatDept(inventory, settings?.categoryDepartments && typeof settings.categoryDepartments === "object" ? settings.categoryDepartments : {});
  const fcCtx = { mpFns, dept, catToDept, subDept, flowerPatterns, inventory, invByIdMp, deptData, dihari };

  const hasMpSnapshot = !!(sel?.manpowerDetail && typeof sel.manpowerDetail === "object" && Object.keys(sel.manpowerDetail).length);
  const mpDetailRaw = (sel?.manpowerDetail && Array.isArray(sel.manpowerDetail[dept])) ? sel.manpowerDetail[dept] : (hasMpSnapshot ? [] : null);
  const autoSlots = {};
  const mpDetail = Array.isArray(mpDetailRaw) ? mpDetailRaw.map(r => !Array.isArray(r?.schedule) ? r : ({
    ...r, schedule: r.schedule.map(d0 => {
      let d = d0;
      if (d0?.phase === "event" && Array.isArray(d0.windowIds)) {
        const defs = (settings?.defaultWindowsByPhase?.[r.type] || {}).event || [];
        const same = defs.length === d0.windowIds.length && defs.every(id => d0.windowIds.includes(id));
        if (same) {
          const ids = withSetupSlot(d0.windowIds, dihari[r.type]?.windows, mpFns.filter(f => String(f?.date || "").slice(0, 10) === d0.date));
          if (ids.length !== d0.windowIds.length) d = { ...d0, windowIds: ids, windows: ids.length };
        }
      }
      const def = slotDefaults(r, d, fcCtx); if (!def) return d;
      (autoSlots[r.type] = autoSlots[r.type] || {})[d.date] = def;
      return { ...d, winCount: { ...(d.winCount || {}), ...def } };
    }),
  })) : mpDetailRaw;
  const sysPlan = (Array.isArray(sel?.manpowerPlan) ? sel.manpowerPlan : []).filter(p => deptTypes.includes(p.type));
  const dayCount = (count, rate, cost) => (count > 0 && rate > 0 && cost > 0) ? Math.max(1, Math.round(cost / (count * rate))) : 1;
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
        ...mpExtra.map((r, ei) => ({ r, ei })).filter(({ r }) => !snapTypes.has(r.type)).map(({ r, ei }) => ({ type: r.type, count: r.count ?? "", rate: r.rate || 0, basis: "added crew", shared: false, sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true, _addedExtra: true, _extraIdx: ei })),
      ]
    : (sysPlan.length ? sysPlan.map(p => ({ type: p.type, count: p.count, rate: p.rate || Number(dihari[p.type]?.rate) || 0, basis: p.basis || "", sysCount: p.count, sysRate: p.rate || 0, sysCost: (p.count || 0) * (p.rate || 0), days: 1, _extra: true }))
      : deptTypes.map(t => ({ type: t, count: "", rate: Number(dihari[t]?.rate) || 0, basis: "", sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true })));

  const mpDay = (deptData.mpDay && typeof deptData.mpDay === "object") ? deptData.mpDay : {};
  const mpWin = (deptData.mpWin && typeof deptData.mpWin === "object") ? deptData.mpWin : {};
  const mpWinSplit = (deptData.mpWinSplit && typeof deptData.mpWinSplit === "object") ? deptData.mpWinSplit : {};
  const mpWinCountRaw = (deptData.mpWinCount && typeof deptData.mpWinCount === "object") ? deptData.mpWinCount : {};
  const mpWinBasis = (deptData.mpWinBasis && typeof deptData.mpWinBasis === "object") ? deptData.mpWinBasis : {};
  const mpWinCount = Object.fromEntries(Object.entries(mpWinCountRaw).map(([type, byDate]) => [type, Object.fromEntries(Object.entries(byDate || {}).map(([date, byWin]) => {
    const auto = autoSlots[type] && autoSlots[type][date];
    if (!auto) return [date, byWin];
    const basis = (mpWinBasis[type] && mpWinBasis[type][date]) || {};
    return [date, Object.fromEntries(Object.entries(byWin || {}).filter(([id]) => auto[id] == null || basis[id] === auto[id]))];
  }))]));

  const effDay = (r, d) => mpEffDay(r, d, mpDay);
  const effWinIds = (r, d) => { const ov = mpWin[r.type]; return ov && ov[d.date] != null ? ov[d.date] : (Array.isArray(d.windowIds) ? d.windowIds : []); };
  const effWin = (r, d) => mpEffWindows(r, d, mpWin);
  const effShift = (r, d, winId) => { const wc = mpWinCount[r.type] && mpWinCount[r.type][d.date]; if (wc && wc[winId] != null) return Number(wc[winId]); const sc = d && d.winCount; if (sc && sc[winId] != null) return Number(sc[winId]); return Math.round(effDay(r, d)); };
  // In-house vs vendor split of one shift's headcount. Only the vendor side is ever stored — the
  // in-house side is always (shift total − vendor), so a later edit to the shift's own count (the
  // pill above) can never leave the split summing to something other than the shift's real total;
  // it just silently widens/narrows the in-house share instead of going stale.
  const effSplit = (r, d, winId) => {
    const total = effShift(r, d, winId);
    const s = mpWinSplit[r.type] && mpWinSplit[r.type][d.date] && mpWinSplit[r.type][d.date][winId];
    const vendor = s ? Math.min(total, Math.max(0, Number(s.vendor) || 0)) : 0;
    return { total, vendor, inHouse: total - vendor, vendorName: s?.vendorName || "", vendorId: s?.vendorId || null };
  };
  const lineCost = (r) => r._scoped
    ? Math.round(r.schedule.reduce((s, d) => s + mpDayCost(r, d, mpDay, mpWin, mpWinCount, Number(r.rate) || 0), 0))
    : mpLineCost(r, mpDay, mpOverrides, mpWin, mpWinCount);
  const mpCost = mpRows.reduce((s, r) => s + lineCost(r), 0);
  const mpPlannedCost = mpRows.reduce((s, r) => s + (Number(r.sysCost) || 0), 0);
  const mpEdited = Object.keys(mpOverrides).length > 0 || Object.keys(mpDay).length > 0 || Object.keys(mpWin).length > 0 || Object.keys(mpWinCount).length > 0 || (Array.isArray(mpExtra) && mpExtra.length > 0);

  return {
    dept, deptData, deptTypes, mpFns, dihari, hasMpSnapshot, mpDetail, mpDetailRaw, autoSlots, sysPlan,
    mpOverrides, mpExtra, mpRows, mpDay, mpWin, mpWinCountRaw, mpWinBasis, mpWinCount, mpWinSplit,
    effDay, effWinIds, effWin, effShift, effSplit, lineCost, mpCost, mpPlannedCost, mpEdited,
  };
}

// ── PATCH BUILDERS ──
// Every one of these returns a PATCH object — the same shape DepartmentOpsTab.jsx's `saveDept`
// always merged straight into `event_orders.data.deptOps[dept]` — instead of writing anything
// itself, so callers (DepartmentOpsTab.jsx's own `saveDept`, or the new Site Supervisor page's
// `applyDeptOpsPatch`) stay the only place that actually touches `setEventOrders`.
export function setMpPatch(crew, i, key, val) {
  const row = crew.mpRows[i]; if (!row) return null;
  if (row._extra) {
    const base = Array.isArray(crew.deptData.mpExtra) ? crew.deptData.mpExtra : crew.mpExtra;
    const idx = row._addedExtra ? row._extraIdx : base.findIndex(r => r.type === row.type);
    const next = base.slice();
    if (idx >= 0 && idx < next.length) next[idx] = { ...next[idx], [key]: val }; else next.push({ type: row.type, count: row.count, rate: row.rate, [key]: val });
    return { mpExtra: next };
  }
  return { mpOverrides: { ...crew.mpOverrides, [row.type]: { ...(crew.mpOverrides[row.type] || {}), [key]: val } } };
}
export function addMpPatch(crew) {
  return { mpExtra: [...(Array.isArray(crew.deptData.mpExtra) ? crew.deptData.mpExtra : crew.mpExtra), { type: "Labours", count: "", rate: Number(crew.dihari["Labours"]?.rate) || 0 }] };
}
export function removeMpPatch(crew, row) {
  if (!row._addedExtra) return null;
  const base = Array.isArray(crew.deptData.mpExtra) ? crew.deptData.mpExtra : crew.mpExtra;
  return { mpExtra: base.filter((_, i) => i !== row._extraIdx) };
}
// On-site actual crew: the real head-count held (every scheduled day for day-wise crew, else a
// straight count override) → flows to the P&L + Studio via the same mpDay/mpOverrides fields.
export function actualCrewPatch(crew, r, i, val) {
  const n = Math.max(0, Number(val) || 0);
  if (mpDayWise(r) && Array.isArray(r.schedule) && r.schedule.length) {
    const m = { ...(crew.mpDay[r.type] || {}) };
    r.schedule.forEach(d => { m[d.date] = n; });
    const wc = { ...crew.mpWinCount }; delete wc[r.type];
    return { mpDay: { ...crew.mpDay, [r.type]: m }, mpWinCount: wc };
  }
  return setMpPatch(crew, i, "count", n);
}
export function resetLinePatch(crew, r) {
  const nd = { ...crew.mpDay }; delete nd[r.type];
  const nw = { ...crew.mpWin }; delete nw[r.type];
  const no = { ...crew.mpOverrides }; delete no[r.type];
  const wc = { ...crew.mpWinCount }; delete wc[r.type];
  const ws = { ...crew.mpWinSplit }; delete ws[r.type];
  return { mpDay: nd, mpWin: nw, mpOverrides: no, mpWinCount: wc, mpWinSplit: ws };
}
export function mpDayPatch(crew, type, date, val) {
  return { mpDay: { ...crew.mpDay, [type]: { ...(crew.mpDay[type] || {}), [date]: val } } };
}
export function resetMpDayPatch(crew, type, date) {
  const drop = (m) => { if (!m[type] || m[type][date] == null) return m; const t = { ...m[type] }; delete t[date]; return { ...m, [type]: t }; };
  return { mpWin: drop(crew.mpWin), mpWinCount: drop(crew.mpWinCountRaw), mpWinBasis: drop(crew.mpWinBasis), mpDay: drop(crew.mpDay), mpWinSplit: drop(crew.mpWinSplit) };
}
// Set the crew for ONE shift on ONE day (per-shift split). A cleared box (val "") drops the
// head's own count for that shift, so it falls back to the slot's default.
export function shiftCountPatch(crew, type, date, winId, val, curIds) {
  const n = Math.max(0, Number(val) || 0);
  const t = { ...(crew.mpWinCount[type] || {}) }; t[date] = { ...(t[date] || {}), [winId]: n }; if (val === "") delete t[date][winId];
  const auto = crew.autoSlots[type] && crew.autoSlots[type][date] && crew.autoSlots[type][date][winId];
  const b = { ...(crew.mpWinBasis[type] || {}) }; b[date] = { ...(b[date] || {}) }; if (auto != null && val !== "") b[date][winId] = auto; else delete b[date][winId];
  const patch = { mpWinCount: { ...crew.mpWinCount, [type]: t }, mpWinBasis: { ...crew.mpWinBasis, [type]: b } };
  if (Array.isArray(curIds) && !curIds.includes(winId)) patch.mpWin = { ...crew.mpWin, [type]: { ...(crew.mpWin[type] || {}), [date]: [...curIds, winId] } };
  return patch;
}
// Set ONE shift's in-house/vendor split (owner ask, 2026-11-11: split a dihari's headcount between
// staff and a vendor's own crew). Only `vendor` (+ the vendor identity) is ever stored — see effSplit's
// own comment for why in-house is never a separate stored number. vendor<=0 and no vendor picked
// clears the entry entirely, so an un-split shift carries no split data at all (same "absence means
// default" convention mpWinCount/mpWin already use).
export function shiftSplitPatch(crew, type, date, winId, { vendor, vendorName, vendorId } = {}) {
  const t = { ...(crew.mpWinSplit[type] || {}) };
  t[date] = { ...(t[date] || {}) };
  const v = Math.max(0, Number(vendor) || 0);
  if (v <= 0 && !vendorName && !vendorId) delete t[date][winId];
  else t[date][winId] = { vendor: v, vendorName: vendorName || "", vendorId: vendorId || null };
  return { mpWinSplit: { ...crew.mpWinSplit, [type]: t } };
}
// Add another dihari (shift) to a day — the next unused scheme window, else a synthetic slot.
export function addDihariPatch(crew, r, date, curIds) {
  const wins = (crew.dihari[r.type] && Array.isArray(crew.dihari[r.type].windows)) ? crew.dihari[r.type].windows : [];
  const unused = wins.find(w => !curIds.includes(w.id));
  const id = unused ? unused.id : ("x" + Date.now());
  const t = { ...(crew.mpWinCount[r.type] || {}) }; t[date] = { ...(t[date] || {}), [id]: 1 };
  return { mpWin: { ...crew.mpWin, [r.type]: { ...(crew.mpWin[r.type] || {}), [date]: [...curIds, id] } }, mpWinCount: { ...crew.mpWinCount, [r.type]: t } };
}
export function removeDihariPatch(crew, type, date, slotId, curIds) {
  const t = { ...(crew.mpWinCount[type] || {}) }; if (t[date]) { const dd = { ...t[date] }; delete dd[slotId]; t[date] = dd; }
  const ws = { ...(crew.mpWinSplit[type] || {}) }; if (ws[date]) { const dd = { ...ws[date] }; delete dd[slotId]; ws[date] = dd; }
  return { mpWin: { ...crew.mpWin, [type]: { ...(crew.mpWin[type] || {}), [date]: curIds.filter(x => x !== slotId) } }, mpWinCount: { ...crew.mpWinCount, [type]: t }, mpWinSplit: { ...crew.mpWinSplit, [type]: ws } };
}

// Merge a single department's patch into an event order, exactly as DepartmentOpsTab.jsx's
// `saveDept` always has — the one place that stamps `updatedAt`/`updatedBy`.
export function applyDeptOpsPatch(eo, dept, patch, userName) {
  const ops = { ...(eo.deptOps || {}) };
  ops[dept] = { ...(ops[dept] || {}), ...patch, updatedAt: Date.now(), updatedBy: userName || "—" };
  return { ...eo, deptOps: ops };
}

// Every department's crew on one event, each built the exact same way its own Dept Ops tab would —
// for the Site Supervisor page, which needs every department's crew together instead of one
// department at a time. A department is left out only when `mpRows` comes back genuinely empty
// (no Deal Check snapshot row for it at all); with NO snapshot synced yet at all, buildDeptCrew
// falls back to that department's placeholder crew types (same as the dept-head Planning screen
// shows before Deal Check has ever pushed), so every department can still show up in that state.
export function buildEventCrewByDept({ sel, settings, inventory, flowerPatterns, catToDept }) {
  return DEPTS
    .map((dept) => ({ dept, crew: buildDeptCrew({ sel, dept, settings, inventory, flowerPatterns, catToDept }) }))
    .filter(({ crew }) => crew.mpRows.length > 0);
}

// ── EVENT-WIDE LABOUR TOTAL ── Ops runs the whole event, so he can set the TOTAL labour headcount
// and the system re-splits it across every department that carries a Labours row by its existing
// usage share. Shared across every department that has a Labours line in manpowerDetail (not just
// the pool department), since an event synced before the 2026-11-07 pooling change can still carry
// Labours under more than one department.
const labDetailFor = (sel, d) => { const rows = sel?.manpowerDetail?.[d]; return Array.isArray(rows) ? rows.find(r => r.type === "Labours") : null; };
const labEffPerDay = (sel, d, day) => { const md = sel?.deptOps?.[d]?.mpDay?.Labours || {}; if (md[day.date] != null) return Number(md[day.date]) || 0; return day.share != null ? (Number(day.count) || 0) * Number(day.share) : (Number(day.count) || 0); };
const labShiftsFor = (sel, d, day) => { const mw = sel?.deptOps?.[d]?.mpWin?.Labours; const ids = mw && mw[day.date] != null ? mw[day.date] : (Array.isArray(day.windowIds) ? day.windowIds : null); return ids ? ids.length : (Number(day.windows) || 0); };
const labDihariFor = (sel, d) => { const lab = labDetailFor(sel, d); if (!lab || !Array.isArray(lab.schedule)) return 0; return lab.schedule.reduce((s, day) => s + labEffPerDay(sel, d, day) * labShiftsFor(sel, d, day), 0); };
export function eventLabourInfo(sel) {
  const eventLabourDihari = Math.round(DEPTS.reduce((s, d) => s + labDihariFor(sel, d), 0));
  const anyLabours = DEPTS.some(d => labDetailFor(sel, d));
  return { eventLabourDihari, anyLabours };
}
// Returns the FULL { [dept]: deptOps } map to write (spans every department with a Labours row),
// not a single-department patch — the caller writes `{...eo, deptOps: next}` directly.
export function eventLabourTotalDeptOps(sel, val, userName) {
  const target = Math.max(0, Number(val) || 0);
  const cur = DEPTS.reduce((s, d) => s + labDihariFor(sel, d), 0);
  if (cur <= 0) return null;
  const ratio = target / cur;
  const ops = { ...(sel.deptOps || {}) };
  DEPTS.forEach(d => {
    const lab = labDetailFor(sel, d); if (!lab || !Array.isArray(lab.schedule)) return;
    const od = { ...(ops[d] || {}) }; const md = { ...(od.mpDay || {}) }; const labDay = { ...(md.Labours || {}) };
    lab.schedule.forEach(day => { labDay[day.date] = Math.max(0, Math.round(labEffPerDay(sel, d, day) * ratio)); });
    md.Labours = labDay; od.mpDay = md; od.updatedAt = Date.now(); od.updatedBy = userName || "—";
    ops[d] = od;
  });
  return ops;
}

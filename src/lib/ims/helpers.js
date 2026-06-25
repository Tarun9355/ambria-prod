// Shared IMS helpers (faithful to the reference app).

// Next sequential id like "OH001" from an array of {id} objects.
export function nextId(arr, prefix = "") {
  const nums = arr.map((x) => parseInt((x.id || "0").replace(/\D/g, "")) || 0);
  return prefix + (nums.length ? Math.max(...nums) + 1 : 1).toString().padStart(3, "0");
}

// Total hours across an array of {start,end} time slots (handles past-midnight).
export function hoursFromSlots(slots) {
  return (slots || []).reduce((acc, s) => {
    let [sh, sm] = (s.start || "00:00").split(":").map(Number);
    let [eh, em] = (s.end || "00:00").split(":").map(Number);
    let h = eh * 60 + em - (sh * 60 + sm);
    if (h < 0) h += 24 * 60;
    return acc + h / 60;
  }, 0);
}

// Dihari (daily wage) with overtime multipliers.
export function calcDihari(hours, rate) {
  if (hours <= 8) return rate;
  if (hours <= 12) return rate * 1.5;
  return rate * 2;
}

// ── Department manpower reconciliation (shared by IMS Dept Ops + Studio Deal Check P&L) ──
// Each crew row carries the Studio system figures (sysCount/sysRate/sysCost), an optional working
// schedule, and a split-share (for SHARED crew like Labours/Supervisors). Dept heads edit per-type
// overrides (mpOverrides: {count,rate}) and per-day crew counts (mpDay: {[type]:{[date]:count}}).
// Keeping the cost formula here guarantees IMS and Studio agree to the rupee.

// This dept's fraction of a shared crew type — usage-based for Labours, income-based otherwise.
export function mpShareOf(r) {
  const si = r && r.splitInfo;
  if (!si) return null;
  if (si.byUsage) return si.usageTotal > 0 ? si.deptUsage / si.usageTotal : null;
  return si.directTotal > 0 ? si.deptDirect / si.directTotal : null;
}

// Editable per day when it has a working schedule AND this dept's crew on it is resolvable:
// mapped crew use the schedule count directly; shared crew use (globalCount × this dept's share).
export function mpDayWise(r) {
  return Array.isArray(r.schedule) && r.schedule.length > 0 && (!r.shared || mpShareOf(r) != null);
}

// System (unedited) per-day crew for this dept. Unrounded for shared so the day-sum reconciles
// exactly to the split cost; callers round only for display. Per-day usage-split labour stamps each
// schedule day with its own `share` (this dept's fraction that day); otherwise the constant split share.
export function mpBaseDay(r, d) {
  const c = Number(d.count) || 0;
  if (!r.shared) return c;
  const share = (d && d.share != null) ? Number(d.share) : mpShareOf(r);
  return c * (share || 0);
}

// Effective per-day crew: the head's override for that date, else the system base.
export function mpEffDay(r, d, mpDay) {
  const ov = mpDay && mpDay[r.type];
  return ov && ov[d.date] != null ? (Number(ov[d.date]) || 0) : mpBaseDay(r, d);
}

// Effective shift-windows (dihari) worked on a day = count of the head's per-day window override, else
// the system's scheduled windows. mpWin = { [type]: { [date]: [windowId, …] } }.
export function mpEffWindows(r, d, mpWin) {
  const ov = mpWin && mpWin[r.type];
  const ids = ov && ov[d.date] != null ? ov[d.date] : (Array.isArray(d.windowIds) ? d.windowIds : null);
  return Array.isArray(ids) ? ids.length : (Number(d.windows) || 0);
}

// Reconciled cost for one crew row. SHARED rows stay the fixed split allocation UNTIL the head tunes a
// day, the rate, or the dihari timings, then become Sum(dayCount × shifts × rate); mapped rows scale.
export function mpLineCost(r, mpDay, mpOverrides, mpWin) {
  const dayEdited = !!(mpDay && mpDay[r.type] && Object.keys(mpDay[r.type]).length);
  const rateEdited = !!(mpOverrides && mpOverrides[r.type] && mpOverrides[r.type].rate != null);
  const winEdited = !!(mpWin && mpWin[r.type] && Object.keys(mpWin[r.type]).length);
  if (mpDayWise(r)) {
    if (r.shared && !dayEdited && !rateEdited && !winEdited) return Number(r.sysCost) || 0; // exact split until edited
    const rate = Number(r.rate) || 0;
    return Math.round(r.schedule.reduce((s, d) => s + mpEffDay(r, d, mpDay) * mpEffWindows(r, d, mpWin) * rate, 0));
  }
  if (r.shared) return Number(r.sysCost) || 0;
  const sc = Number(r.sysCount) || 0, sr = Number(r.sysRate) || 0, scost = Number(r.sysCost) || 0;
  if (sc > 0 && sr > 0 && scost > 0) return Math.round(scost * ((Number(r.count) || 0) / sc) * ((Number(r.rate) || 0) / sr));
  return (Number(r.count) || 0) * (Number(r.rate) || 0);
}

// Build a dept's editable crew rows from the Studio snapshot detail (manpowerDetail[dept]) + the
// head's saved edits (deptOps[dept]), then total their reconciled cost. Mirrors IMS Dept Ops exactly
// so Studio's P&L picks up head edits (incl. day-wise labour) instead of the stale legacy `.mp`.
export function deptMpReconciled(detail, deptData) {
  const data = deptData || {};
  const snap = Array.isArray(detail) ? detail : [];
  const snapTypes = new Set(snap.map((s) => s.type));
  const mpDay = (data.mpDay && typeof data.mpDay === "object") ? data.mpDay : {};
  const mpWin = (data.mpWin && typeof data.mpWin === "object") ? data.mpWin : {};
  // Edits live in mpOverrides/mpExtra; older events kept them in a flat `.mp` array — migrate that.
  const migrateOv = () => {
    if (!Array.isArray(data.mp)) return {};
    const byT = {}; snap.forEach((s) => { byT[s.type] = s; });
    const ov = {};
    data.mp.forEach((r) => {
      const s = byT[r.type]; if (!s) return; const o = {};
      if (r.count !== "" && r.count != null && Number(r.count) !== Number(s.count ?? 0)) o.count = r.count;
      if (Number(r.rate) !== Number(s.rate ?? 0)) o.rate = r.rate;
      if (Object.keys(o).length) ov[r.type] = o;
    });
    return ov;
  };
  const mpOverrides = (data.mpOverrides && typeof data.mpOverrides === "object") ? data.mpOverrides : migrateOv();
  const mpExtra = Array.isArray(data.mpExtra) ? data.mpExtra : (Array.isArray(data.mp) ? data.mp.filter((r) => !snapTypes.has(r.type)) : []);
  const rows = [
    ...snap.map((s) => { const ov = mpOverrides[s.type] || {}; return { type: s.type, count: ov.count != null ? ov.count : (s.count ?? ""), rate: ov.rate != null ? ov.rate : (s.rate || 0), shared: !!s.shared, sysCount: s.count, sysRate: s.rate || 0, sysCost: s.cost || 0, splitInfo: s.splitInfo || null, schedule: s.schedule || null }; }),
    ...mpExtra.filter((r) => !snapTypes.has(r.type)).map((r) => ({ type: r.type, count: r.count ?? "", rate: r.rate || 0, shared: false, sysCount: null, sysRate: 0, sysCost: 0, splitInfo: null, schedule: null })),
  ];
  return rows.reduce((s, r) => s + mpLineCost(r, mpDay, mpOverrides, mpWin), 0);
}

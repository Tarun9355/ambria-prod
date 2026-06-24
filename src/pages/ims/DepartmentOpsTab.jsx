import { useState, useMemo } from "react";
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

export default function DepartmentOpsTab({ eventOrders, setEventOrders, inventory, blocks, settings, authUser }) {
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => { const k = String(cat || "").toLowerCase().trim(); if (catDeptCfg[k] && DEPTS.includes(catDeptCfg[k])) return catDeptCfg[k]; return kwDept(cat); };
  const dihari = settings?.dihariSchemes || {};
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  // Department-head role → department (role name contains a department, e.g. "Tenting Head").
  const roleDept = useMemo(() => { const r = String(authUser?.role || "").toLowerCase(); return DEPTS.find(d => r.includes(d.toLowerCase())) || null; }, [authUser]);

  const [dept, setDept] = useState(roleDept || "Floral");
  const [search, setSearch] = useState("");
  const [selId, setSelId] = useState(null);

  const eventDate = (eo) => eo?.functionsDetail?.[0]?.date || eo?.date || eo?.eventDate || "";
  const today = new Date().toISOString().slice(0, 10);

  // Event list — search + sorted by date, upcoming first.
  const events = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (eventOrders || [])
      .filter(eo => !q || (eo.clientName || "").toLowerCase().includes(q) || (eo.functionsDetail?.[0]?.venue || eo.venue || "").toLowerCase().includes(q))
      .map(eo => ({ eo, date: eventDate(eo) }))
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  }, [eventOrders, search]);

  const sel = (eventOrders || []).find(e => e.id === selId);
  const selDateStr = sel ? eventDate(sel) : "";
  // Nearby events — within 7 days of the selected event.
  const nearby = useMemo(() => {
    if (!selDateStr) return [];
    const t = new Date(selDateStr + "T00:00:00").getTime();
    return events.filter(({ eo, date }) => eo.id !== selId && date && Math.abs(new Date(date + "T00:00:00").getTime() - t) <= 7 * 864e5);
  }, [events, selDateStr, selId]);

  // ── Blocked inventory for this event + department ──
  const blockedItems = useMemo(() => {
    if (!sel) return [];
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
  const mpRows = Array.isArray(deptData.mp) ? deptData.mp : (DEPT_MP[dept] || ["Labours"]).map(t => ({ type: t, count: "", rate: Number(dihari[t]?.rate) || 0 }));
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

  const mpCost = mpRows.reduce((s, r) => s + (Number(r.count) || 0) * (Number(r.rate) || 0), 0);
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const realMandiNum = Number(realMandi) || 0;
  const projectedIncome = rentalIncome + mpCost;          // what the dept earns (rental + crew)
  const actualCost = realMandiNum + expenseTotal + mpCost; // real spend logged by the head
  const hasActuals = realMandiNum > 0 || expenseTotal > 0;

  const setMp = (i, key, val) => { const next = mpRows.map((r, j) => j === i ? { ...r, [key]: val } : r); saveDept({ mp: next }); };
  const addMp = () => saveDept({ mp: [...mpRows, { type: "Labours", count: "", rate: Number(dihari["Labours"]?.rate) || 0 }] });
  const addExpense = () => saveDept({ expenses: [...expenses, { label: "", amount: "" }] });
  const setExpense = (i, key, val) => { const next = expenses.map((e, j) => j === i ? { ...e, [key]: val } : e); saveDept({ expenses: next }); };
  const delExpense = (i) => saveDept({ expenses: expenses.filter((_, j) => j !== i) });

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
                <span className="text-sm font-semibold text-gray-800">👷 Manpower plan <span className="text-xs font-normal text-gray-400">— edit counts as you see fit</span></span>
                <span className="text-sm font-bold text-gray-900">{fmt(mpCost)}</span>
              </div>
              <div className="divide-y">
                {mpRows.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <input value={r.type} onChange={e => setMp(i, "type", e.target.value)} className="flex-1 border rounded-lg px-2 py-1.5 text-sm font-medium" />
                    <div className="flex items-center gap-1"><span className="text-xs text-gray-400">qty</span><input type="number" min="0" value={r.count} onChange={e => setMp(i, "count", e.target.value)} className="w-16 border rounded-lg px-2 py-1.5 text-sm text-center" /></div>
                    <div className="flex items-center gap-1"><span className="text-xs text-gray-400">₹/day</span><input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-20 border rounded-lg px-2 py-1.5 text-sm text-center" /></div>
                    <div className="text-sm font-semibold text-gray-700 w-20 text-right">{fmt((Number(r.count) || 0) * (Number(r.rate) || 0))}</div>
                  </div>
                ))}
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
                {dept === "Floral" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-emerald-800 w-40">🌸 Real mandi cost</span>
                    <input type="number" min="0" value={realMandi} onChange={e => saveDept({ realMandi: e.target.value })} placeholder="actual flower spend" className="flex-1 border border-emerald-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                )}
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

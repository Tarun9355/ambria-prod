import { useState } from "react";
import { Badge } from "../../components/ui";
import { fmt } from "../../lib/format";
import { calcDihari, hoursFromSlots } from "../../lib/ims/helpers";
import { getEffectivePricing } from "../../lib/inventory/helpers";

// Faithful copy of the reference IMS PLTab (Finance → Event P&L).
export default function PLTab({ projects, functions, inventory, purchase, settings, setSettings }) {
  const [selProject, setSelProject] = useState(projects[0]?.id || "");

  const proj = projects.find((p) => p.id === selProject);
  const fnList = (proj?.functions || []).map((fid) => functions.find((f) => f.id === fid)).filter(Boolean);
  const bufferPct = (proj?.bufferOverride !== null && proj?.bufferOverride !== undefined) ? proj.bufferOverride : settings.bufferPct;

  function calcFnPL(fn) {
    const rentalRev = (fn.items || []).reduce((sum, item) => {
      const inv = inventory.find((i) => i.id === item.invId);
      if (!inv) return sum;
      const pricing = getEffectivePricing(inv.price || 0, fn.date, settings);
      return sum + pricing.effectivePrice * item.qty;
    }, 0);
    const manpowerCost = (fn.manpower || []).reduce((sum, m) => {
      const h = hoursFromSlots(m.slots); return sum + m.qty * calcDihari(h, m.rate);
    }, 0);
    const transportCost = (fn.transport?.planned || []).reduce((sum, t) => sum + t.qty * t.ratePerTrip, 0);
    const expCost = (fn.expenses || []).reduce((sum, e) => sum + e.amount, 0);
    const purchaseCost = purchase.filter((p) => p.functionAllocation?.functionId === fn.id).reduce((sum, p) => sum + (p.functionAllocation?.amount40pct || 0), 0);
    const breakageProv = (fn.breakage?.provision || []).reduce((sum, b) => sum + b.provisionAmt, 0);
    const totalCost = manpowerCost + transportCost + expCost + purchaseCost + breakageProv;
    const buffer = totalCost * (bufferPct / 100);
    const totalWithBuffer = totalCost + buffer;
    const profit = rentalRev - totalWithBuffer;
    const profitPct = rentalRev > 0 ? (profit / rentalRev) * 100 : 0;
    return { rentalRev, manpowerCost, transportCost, expCost, purchaseCost, breakageProv, totalCost, buffer, totalWithBuffer, profit, profitPct };
  }

  const fnPLs = fnList.map((fn) => ({ fn, pl: calcFnPL(fn) }));
  const projTotals = fnPLs.reduce((acc, { pl }) => ({
    rentalRev: acc.rentalRev + pl.rentalRev,
    totalCost: acc.totalCost + pl.totalWithBuffer,
    profit: acc.profit + pl.profit,
  }), { rentalRev: 0, totalCost: 0, profit: 0 });
  const projProfitPct = projTotals.rentalRev > 0 ? (projTotals.profit / projTotals.rentalRev) * 100 : 0;
  const isHealthy = projProfitPct >= settings.minProfitPct;

  const PLRow = ({ label, value, indent = false, bold = false, color = "" }) => (
    <div className={"flex justify-between py-1.5 " + (indent ? "pl-4" : "") + (bold ? " border-t mt-1 pt-2" : "")}>
      <span className={"text-sm " + (bold ? "font-bold text-gray-900" : "text-gray-600") + (indent ? " text-gray-500" : "")}>{label}</span>
      <span className={"text-sm font-medium " + (color || "text-gray-900") + (bold ? " font-bold" : "")}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs text-gray-500">Project</label>
          <select value={selProject} onChange={(e) => setSelProject(e.target.value)} className="mt-1 border rounded-lg px-3 py-2 text-sm">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {setSettings && <div className="flex gap-3 ml-auto">
          <div><label className="text-xs text-gray-500">Buffer %</label><input type="number" min="0" max="50" value={settings.bufferPct} onChange={(e) => setSettings((s) => ({ ...s, bufferPct: parseFloat(e.target.value) || 0 }))} className="mt-1 border rounded-lg px-2 py-2 text-sm w-16" /></div>
          <div><label className="text-xs text-gray-500">Min Profit %</label><input type="number" min="0" max="100" value={settings.minProfitPct} onChange={(e) => setSettings((s) => ({ ...s, minProfitPct: parseFloat(e.target.value) || 0 }))} className="mt-1 border rounded-lg px-2 py-2 text-sm w-16" /></div>
        </div>}
      </div>

      {proj && <>
        <div className={"rounded-2xl p-5 border-2 " + (isHealthy ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900 text-lg">{proj.name} — Project P&L</h3>
            <span className={"text-sm font-bold px-3 py-1 rounded-full " + (isHealthy ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800")}>
              {isHealthy ? "✅ Healthy" : "⚠️ Below Target"} {projProfitPct.toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[["Revenue", fmt(projTotals.rentalRev), "blue"], ["Total Cost", fmt(projTotals.totalCost), "amber"], ["Profit", fmt(projTotals.profit), isHealthy ? "green" : "red"]].map(([l, v, c]) => (
              <div key={l} className="text-center">
                <p className={`text-xl font-bold text-${c}-700`}>{v}</p>
                <p className="text-xs text-gray-500 mt-1">{l}</p>
              </div>
            ))}
          </div>
          {!isHealthy && <p className="text-sm text-red-700 mt-3 bg-red-100 rounded-lg px-3 py-2">⚠️ Profit {projProfitPct.toFixed(1)}% is below minimum target of {settings.minProfitPct}%. Admin approval required to confirm project.</p>}
          <p className="text-xs text-gray-500 mt-2">Buffer rate applied: {bufferPct}%{proj.bufferOverride !== null && proj.bufferOverride !== undefined ? " (project override)" : ""}</p>
        </div>

        {fnPLs.map(({ fn, pl }) => (
          <div key={fn.id} className="bg-white border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-900">{fn.name}</span>
                <span className="text-sm text-gray-500">{fn.date}</span>
                <Badge color={fn.status === "Confirmed" ? "green" : "amber"}>{fn.status}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className={"text-sm font-bold " + (pl.profitPct >= settings.minProfitPct ? "text-green-600" : "text-red-600")}>
                  {pl.profitPct >= settings.minProfitPct ? "✅" : "⚠️"} {pl.profitPct.toFixed(1)}% profit
                </span>
              </div>
            </div>
            <div className="px-5 py-4">
              <PLRow label="📦 Inventory Rental Revenue" value={fmt(pl.rentalRev)} bold />
              <div className="mt-2 mb-1"><span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Costs</span></div>
              {pl.manpowerCost > 0 && <PLRow label="👷 Manpower Cost" value={"− " + fmt(pl.manpowerCost)} indent color="text-red-600" />}
              {pl.transportCost > 0 && <PLRow label="🚛 Transport Cost (Planned)" value={"− " + fmt(pl.transportCost)} indent color="text-red-600" />}
              {pl.expCost > 0 && <PLRow label="💵 Site Expenses" value={"− " + fmt(pl.expCost)} indent color="text-red-600" />}
              {pl.purchaseCost > 0 && <PLRow label="🛒 Purchase Allocation (40%)" value={"− " + fmt(pl.purchaseCost)} indent color="text-red-600" />}
              {pl.breakageProv > 0 && <PLRow label="🔴 Breakage Provision" value={"− " + fmt(pl.breakageProv)} indent color="text-red-600" />}
              {pl.totalCost > 0 && <PLRow label="Sub-total Cost" value={fmt(pl.totalCost)} indent bold />}
              {bufferPct > 0 && <PLRow label={`📋 Buffer (${bufferPct}%)`} value={"− " + fmt(pl.buffer)} indent color="text-orange-600" />}
              <PLRow label="Total Cost with Buffer" value={fmt(pl.totalWithBuffer)} bold />
              <div className={"mt-3 py-3 border-t flex items-center justify-between rounded-b"}>
                <span className="font-bold text-gray-900">Function Profit / Loss</span>
                <span className={"text-xl font-bold " + (pl.profit >= 0 ? "text-green-700" : "text-red-700")}>{pl.profit >= 0 ? "" : "-"}{fmt(Math.abs(pl.profit))}</span>
              </div>
            </div>
          </div>
        ))}
      </>}
    </div>
  );
}

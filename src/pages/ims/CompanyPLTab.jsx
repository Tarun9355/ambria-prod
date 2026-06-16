import { useState } from "react";
import { fmt } from "../../lib/format";
import { calcDihari, hoursFromSlots } from "../../lib/ims/helpers";
import { OVERHEAD_CATS } from "../../lib/ims/constants";

// Faithful copy of the reference IMS CompanyPLTab (Finance → Company P&L).
export default function CompanyPLTab({ projects, functions, inventory, purchase, overheads, settings }) {
  const [period, setPeriod] = useState("month");
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1);
  const [selYear, setSelYear] = useState(new Date().getFullYear());

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bufferPct = (p) => (p?.bufferOverride != null) ? p.bufferOverride : settings.bufferPct;

  function calcFnPL(fn) {
    const proj = projects.find((p) => p.functions?.includes(fn.id));
    const bp = bufferPct(proj);
    const rev = (fn.items || []).reduce((s, it) => { const inv = inventory.find((i) => i.id === it.invId); return s + (inv?.price || 0) * it.qty; }, 0);
    const manCost = (fn.manpower || []).reduce((s, m) => s + m.qty * calcDihari(hoursFromSlots(m.slots), m.rate), 0);
    const transCost = (fn.transport?.planned || []).reduce((s, t) => s + t.qty * t.ratePerTrip, 0);
    const expCost = (fn.expenses || []).reduce((s, e) => s + e.amount, 0);
    const purCost = (purchase || []).filter((p) => p.functionAllocation?.functionId === fn.id).reduce((s, p) => s + (p.functionAllocation?.amount40pct || 0), 0);
    const brkProv = (fn.breakage?.provision || []).reduce((s, b) => s + b.provisionAmt, 0);
    const totalCost = manCost + transCost + expCost + purCost + brkProv;
    const buffer = totalCost * (bp / 100);
    return { rev, totalCost, buffer, net: rev - totalCost - buffer };
  }

  const activeFns = functions.filter((f) => f.status === "Confirmed");
  const fnPLs = activeFns.map((f) => calcFnPL(f));
  const totalRev = fnPLs.reduce((s, p) => s + p.rev, 0);
  const totalCost = fnPLs.reduce((s, p) => s + p.totalCost + p.buffer, 0);
  const grossProfit = totalRev - totalCost;

  const centralProcurement = (purchase || []).filter((p) => p.status === "Purchased" || p.status === "AddedToInventory").reduce((s, p) => s + (p.centralAllocation?.amount60pct || 0), 0);
  const overheadTotal = overheads.reduce((s, o) => s + o.amount, 0);
  const netProfit = grossProfit - overheadTotal;
  const netPct = totalRev > 0 ? (netProfit / totalRev) * 100 : 0;

  const Row = ({ label, val, bold = false, color = "" }) => (
    <div className={"flex justify-between py-1.5 " + (bold ? "border-t mt-2 pt-2" : "")}>
      <span className={"text-sm " + (bold ? "font-bold text-gray-900" : "text-gray-600")}>{label}</span>
      <span className={"text-sm font-medium " + (color || "text-gray-900") + (bold ? " font-bold" : "")}>{val}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-900 text-lg">📊 Company P&L</h3>
          <span className={"text-sm font-bold px-3 py-1.5 rounded-full " + (netPct >= settings.minProfitPct ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
            {netPct >= settings.minProfitPct ? "✅" : "⚠️"} Net {netPct.toFixed(1)}%
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-5">
          {[["Total Revenue", totalRev, "indigo"], ["Total Costs", totalCost, "amber"], ["Net Profit", netProfit, netProfit >= 0 ? "green" : "red"]].map(([l, v, c]) => (
            <div key={l} className={`bg-${c}-50 border border-${c}-100 rounded-xl p-4 text-center`}>
              <p className={`text-2xl font-bold text-${c}-700`}>{fmt(v)}</p>
              <p className="text-xs text-gray-500 mt-1">{l}</p>
            </div>
          ))}
        </div>

        <div className="space-y-0.5">
          <Row label="📦 Total Project Revenue" val={fmt(totalRev)} bold />
          <Row label="− Project Costs (incl. buffer)" val={"−" + fmt(totalCost)} color="text-red-600" />
          <Row label="− Central Procurement (60% purchases)" val={"−" + fmt(centralProcurement)} color="text-red-600" />
          <Row label="= Gross Profit" val={fmt(grossProfit)} bold />
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-3 mb-1">Fixed Overheads</p>
          {OVERHEAD_CATS.map((cat) => {
            const catTotal = overheads.filter((o) => o.category === cat).reduce((s, o) => s + o.amount, 0);
            return catTotal > 0 ? <Row key={cat} label={`− ${cat}`} val={"−" + fmt(catTotal)} color="text-red-600" /> : null;
          })}
          <Row label="= Net Profit / Loss" val={fmt(netProfit)} bold color={netProfit >= 0 ? "text-green-700" : "text-red-700"} />
        </div>
      </div>
    </div>
  );
}

// Studio → Pricing → Transport & Power editor. Edits the transport config blob
// (RC_SK_TR): venues (trip rate + gensets), truck capacities, genset rate,
// floral-per-truck, and budget buffer tiers. Persists via ctx.saveTR (per-slice).
import { useState } from "react";

export default function TransportEditor({ ctx }) {
  const { trVenues, truckCap, floralPerTruck, gensetRate, bufferTiers, saveTR } = ctx;
  const [open, setOpen] = useState("venues"); // accordion section

  const Section = ({ id, title, count, children }) => (
    <div className="bg-white border rounded-2xl overflow-hidden mb-3">
      <button onClick={() => setOpen((o) => (o === id ? "" : id))} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50">
        <span className="font-bold text-gray-900">{title}{count != null && <span className="text-xs text-gray-400 font-normal ml-2">{count}</span>}</span>
        <span className="text-gray-400">{open === id ? "▴" : "▾"}</span>
      </button>
      {open === id && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  );

  const numI = "w-24 border rounded px-2 py-1 text-sm text-center";
  const txtI = "border rounded px-2 py-1 text-sm";

  // ── Venues ──
  const updV = (id, patch) => saveTR(trVenues.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const addV = () => saveTR([...trVenues, { id: "V" + Date.now().toString(36).slice(-5).toUpperCase(), name: "New Venue", rate: 0, gensets: 1, tier: "outdoor" }]);
  const delV = (id) => { if (!window.confirm("Delete this venue's transport entry?")) return; saveTR(trVenues.filter((v) => v.id !== id)); };

  // ── Truck capacities ──
  const updTC = (id, patch) => saveTR(null, truckCap.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addTC = () => saveTR(null, [...truckCap, { id: "TC" + Date.now().toString(36).slice(-5).toUpperCase(), item: "New item", unit: "pc", perTruck: 0 }]);
  const delTC = (id) => saveTR(null, truckCap.filter((t) => t.id !== id));

  // ── Buffer tiers ──
  const updBT = (id, patch) => saveTR(null, null, undefined, bufferTiers.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const addBT = () => { const last = bufferTiers[bufferTiers.length - 1]; saveTR(null, null, undefined, [...bufferTiers, { id: "BT" + Date.now().toString(36).slice(-5).toUpperCase(), label: "New tier", minBudget: last ? last.maxBudget : 0, maxBudget: (last ? last.maxBudget : 0) + 500000, bufferTrucks: 1 }]); };
  const delBT = (id) => { if (bufferTiers.length <= 1) return; saveTR(null, null, undefined, bufferTiers.filter((b) => b.id !== id)); };

  const fmtINR = (n) => "₹" + (Number(n) || 0).toLocaleString("en-IN");

  return (
    <div>
      <h2 className="text-xl font-bold text-amber-600 mb-4">🚛 Transport & Power</h2>

      <Section id="venues" title="🏛️ Venue Trip Rates & Gensets" count={`${trVenues.length} venues`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400 uppercase"><tr><th className="text-left py-1.5">Venue</th><th className="text-center">Tier</th><th className="text-center">Trip rate ₹</th><th className="text-center">Gensets</th><th></th></tr></thead>
            <tbody>
              {trVenues.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="py-1.5"><input value={v.name || ""} onChange={(e) => updV(v.id, { name: e.target.value })} className={txtI + " w-44"} /></td>
                  <td className="text-center"><select value={v.tier || "outdoor"} onChange={(e) => updV(v.id, { tier: e.target.value })} className="border rounded px-2 py-1 text-xs"><option value="inhouse">In-house</option><option value="outdoor">Outdoor</option><option value="other">Other</option></select></td>
                  <td className="text-center"><input type="number" value={v.rate || 0} onChange={(e) => updV(v.id, { rate: Number(e.target.value) || 0 })} className={numI} /></td>
                  <td className="text-center"><input type="number" value={v.gensets ?? 1} onChange={(e) => updV(v.id, { gensets: Number(e.target.value) || 0 })} className="w-16 border rounded px-2 py-1 text-sm text-center" /></td>
                  <td className="text-center"><button onClick={() => delV(v.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={addV} className="mt-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Venue</button>
      </Section>

      <Section id="trucks" title="📦 Truck Capacities" count={`${truckCap.length} items`}>
        <p className="text-xs text-gray-500 mb-2">How many of each item fit on one truck — drives truck-count estimates.</p>
        <div className="flex flex-wrap gap-2">
          {truckCap.map((t) => (
            <div key={t.id} className="inline-flex items-center gap-1.5 bg-gray-50 border rounded-lg px-2.5 py-1.5">
              <input value={t.item || ""} onChange={(e) => updTC(t.id, { item: e.target.value })} className="w-28 border rounded px-1.5 py-0.5 text-xs font-medium" />
              <span className="text-xs text-gray-400">/ truck:</span>
              <input type="number" value={t.perTruck || 0} onChange={(e) => updTC(t.id, { perTruck: Number(e.target.value) || 0 })} className="w-16 border rounded px-1 py-0.5 text-xs text-center font-bold" />
              <input value={t.unit || ""} onChange={(e) => updTC(t.id, { unit: e.target.value })} placeholder="unit" className="w-12 border rounded px-1 py-0.5 text-xs" />
              <button onClick={() => delTC(t.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
            </div>
          ))}
        </div>
        <button onClick={addTC} className="mt-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Item</button>
      </Section>

      <Section id="power" title="⚡ Power & Florals">
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <div>
            <label className="text-xs text-gray-500 font-medium">Genset rate (₹ each)</label>
            <input type="number" value={gensetRate || 0} onChange={(e) => saveTR(null, null, undefined, null, Number(e.target.value) || 0)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-bold" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Floral value per truck (₹)</label>
            <input type="number" value={floralPerTruck || 0} onChange={(e) => saveTR(null, null, Number(e.target.value) || 0)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-bold" />
            <p className="text-[10px] text-gray-400 mt-0.5">1 floral truck per this much floral cost</p>
          </div>
        </div>
      </Section>

      <Section id="buffer" title="🪣 Budget Buffer Tiers" count={`${bufferTiers.length} tiers`}>
        <p className="text-xs text-gray-500 mb-2">Extra buffer trucks added based on total decor budget.</p>
        <div className="space-y-2">
          {bufferTiers.map((b) => (
            <div key={b.id} className="flex items-center gap-2 bg-gray-50 border rounded-lg px-3 py-2 flex-wrap">
              <input value={b.label || ""} onChange={(e) => updBT(b.id, { label: e.target.value })} className={txtI + " w-32"} />
              <span className="text-xs text-gray-400">from</span>
              <input type="number" value={b.minBudget || 0} onChange={(e) => updBT(b.id, { minBudget: Number(e.target.value) || 0 })} className={numI} title={fmtINR(b.minBudget)} />
              <span className="text-xs text-gray-400">to</span>
              <input type="number" value={b.maxBudget || 0} onChange={(e) => updBT(b.id, { maxBudget: Number(e.target.value) || 0 })} className={numI} title={fmtINR(b.maxBudget)} />
              <span className="text-xs text-gray-400">→ +</span>
              <input type="number" value={b.bufferTrucks || 0} onChange={(e) => updBT(b.id, { bufferTrucks: Number(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center font-bold" />
              <span className="text-xs text-gray-400">trucks</span>
              <button onClick={() => delBT(b.id)} className="text-red-400 hover:text-red-600 text-xs ml-auto">✕</button>
            </div>
          ))}
        </div>
        <button onClick={addBT} className="mt-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Tier</button>
      </Section>
    </div>
  );
}

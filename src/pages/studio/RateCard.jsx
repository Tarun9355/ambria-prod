import { useState, useMemo } from "react";
import { RC_UNITS, RC_CATS_DEFAULT } from "../../lib/studio/constants";

const NUM_FIELDS = ["inhouseFlat", "inhouseS", "inhouseM", "inhouseB", "outS", "outM", "outB", "artificialFlat", "artificialS", "artificialM", "artificialB", "defaultRealPct"];

// Studio → Pricing → Rate Card editor (faithful functional rebuild of AdminRates, in Tailwind).
// Deferred (deal-builder/cross-app coupled): floral pricing-mode pills, IMS-driven lock.
export default function RateCard({ rcItems, setRcItems, rcCats = RC_CATS_DEFAULT }) {
  const [rcCat, setRcCat] = useState(rcCats[0]?.id || "truss");
  const [rcSearch, setRcSearch] = useState("");
  const [rcEditId, setRcEditId] = useState(null);

  const rcUpd = (id, f, v) => {
    const isN = NUM_FIELDS.includes(f);
    setRcItems((prev) => prev.map((i) => (i.id === id ? { ...i, [f]: isN ? Number(v) || 0 : v } : i)));
  };
  const rcDel = (id) => setRcItems((prev) => prev.filter((i) => i.id !== id), [id]);
  const addItem = () => {
    const id = "RC" + Date.now();
    setRcItems((prev) => [...prev, { id, cat: rcCat, sub: "General", name: "New Item", unit: "pc", inhouseMode: "flat", inhouseFlat: 0, outEnabled: false, notes: "" }]);
    setRcEditId(id);
  };

  const rcFiltered = useMemo(() => rcItems.filter((i) => {
    if (i.cat !== rcCat) return false;
    if (rcSearch.trim()) { const q = rcSearch.toLowerCase(); return i.name.toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q); }
    return true;
  }), [rcItems, rcCat, rcSearch]);
  const rcGrouped = useMemo(() => { const g = {}; rcFiltered.forEach((i) => { const k = i.sub || "General"; (g[k] = g[k] || []).push(i); }); return g; }, [rcFiltered]);

  const notRated = (i) => i.unit !== "included" && i.unit !== "multiplier" && (i.inhouseFlat || 0) === 0 && (i.inhouseS || 0) === 0 && (i.inhouseM || 0) === 0 && (i.inhouseB || 0) === 0;

  const RCP = ({ item }) => {
    if (item.unit === "included") return <span className="text-sm font-semibold text-emerald-600">Included</span>;
    if (item.unit === "multiplier") return <span className="text-base font-bold text-indigo-600">×{item.inhouseFlat || 0}</span>;
    if (notRated(item)) return <span className="text-xs font-semibold text-amber-500">⚠ not set</span>;
    const u = RC_UNITS.find((x) => x.id === item.unit)?.l || "";
    if (item.inhouseMode === "smb") {
      const vals = [item.inhouseS, item.inhouseM, item.inhouseB].filter((x) => x > 0);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return <span className="text-sm font-bold text-gray-800">₹{lo === hi ? lo : `${lo}–${hi}`}<span className="text-xs text-gray-400 font-normal">{u}</span></span>;
    }
    return <span className="text-sm font-bold text-gray-800">₹{(item.inhouseFlat || 0).toLocaleString("en-IN")}<span className="text-xs text-gray-400 font-normal">{u}</span></span>;
  };

  const cur = rcCats.find((c) => c.id === rcCat);

  return (
    <div className="flex gap-4">
      {/* Category sidebar */}
      <div className="w-56 flex-shrink-0 space-y-1">
        {rcCats.map((c) => {
          const items = rcItems.filter((i) => i.cat === c.id);
          const nr = items.filter(notRated).length;
          const active = rcCat === c.id;
          return (
            <button key={c.id} onClick={() => { setRcCat(c.id); setRcSearch(""); }}
              className={"w-full text-left px-3 py-2 rounded-xl border transition-all " + (active ? "bg-indigo-50 border-indigo-300" : "bg-white border-gray-200 hover:border-indigo-200")}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2"><span>{c.icon}</span><span className={"text-sm " + (active ? "font-semibold text-indigo-700" : "text-gray-700")}>{c.l}</span></span>
                <span className="flex items-center gap-1.5"><span className="text-xs text-gray-400">{items.length}</span>{nr > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title={`${nr} not rated`} />}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Items */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-lg font-bold" style={{ color: cur?.c }}>{cur?.icon} {cur?.l}</h3>
            <p className="text-xs text-gray-500">{cur?.d}</p>
          </div>
          <input value={rcSearch} onChange={(e) => setRcSearch(e.target.value)} placeholder="🔍 Search..." className="ml-auto border rounded-lg px-3 py-2 text-sm w-44" />
          <button onClick={addItem} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">+ Add Item</button>
        </div>

        {Object.keys(rcGrouped).length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm border border-dashed rounded-xl">{rcSearch ? "No matches" : "No items in this category"}</div>
        )}

        {Object.entries(rcGrouped).map(([sub, items]) => (
          <div key={sub}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-1 h-3 rounded" style={{ background: cur?.c }} />
              <div className="text-sm font-bold" style={{ color: cur?.c }}>{sub}</div>
              <div className="text-xs text-gray-400">({items.length})</div>
            </div>
            {items.map((item) => {
              const isO = rcEditId === item.id;
              return (
                <div key={item.id} className={"bg-white rounded-xl mb-1.5 overflow-hidden border " + (isO ? "border-2 border-indigo-400" : "border-gray-200")}>
                  <div className="flex justify-between items-center px-3.5 py-2.5 cursor-pointer" onClick={() => setRcEditId(isO ? null : item.id)}>
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{item.name}</span>
                      {item.outEnabled && <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 font-bold">+OUT</span>}
                    </span>
                    <span className="flex items-center gap-2.5"><RCP item={item} /><button onClick={(e) => { e.stopPropagation(); rcDel(item.id); }} className="text-red-400 hover:text-red-600 text-xs">🗑️</button></span>
                  </div>
                  {!isO && item.notes && <div className={"px-3.5 pb-1.5 text-[10px] " + (item.notes.includes("⚠") || item.notes.includes("Set") ? "text-amber-600" : "text-gray-400")}>{item.notes}</div>}
                  {isO && (
                    <div className="px-4 py-3.5 border-t bg-gray-50 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div><label className="text-[10px] text-gray-500">Category</label>
                          <select value={item.cat || ""} onChange={(e) => rcUpd(item.id, "cat", e.target.value)} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm">{rcCats.map((c) => <option key={c.id} value={c.id}>{c.l}</option>)}</select></div>
                        <div><label className="text-[10px] text-gray-500">Name</label><input defaultValue={item.name} onBlur={(e) => rcUpd(item.id, "name", e.target.value)} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        <div><label className="text-[10px] text-gray-500">Sub-Category</label><input defaultValue={item.sub || ""} onBlur={(e) => rcUpd(item.id, "sub", e.target.value)} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        <div><label className="text-[10px] text-gray-500">Unit</label>
                          <select value={item.unit} onChange={(e) => rcUpd(item.id, "unit", e.target.value)} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm">{RC_UNITS.map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select></div>
                      </div>
                      {/* Inhouse */}
                      <div className="bg-white rounded-lg p-3 border">
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-xs font-bold text-emerald-700">🏠 Inhouse</div>
                          <div className="flex gap-1">{["flat", "smb"].map((m) => (
                            <button key={m} onClick={() => rcUpd(item.id, "inhouseMode", m)} className={"px-2.5 py-1 rounded text-[10px] font-semibold " + (item.inhouseMode === m ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500")}>{m === "flat" ? "Flat" : "S/M/B"}</button>
                          ))}</div>
                        </div>
                        {item.inhouseMode === "flat"
                          ? <div className="flex items-center gap-1.5"><span className="text-gray-500">₹</span><input type="number" value={item.inhouseFlat || 0} onChange={(e) => rcUpd(item.id, "inhouseFlat", e.target.value)} className="w-36 border rounded-lg px-2 py-1.5 text-base font-bold text-right" /></div>
                          : <div className="grid grid-cols-3 gap-2">{[["Small", "inhouseS"], ["Medium", "inhouseM"], ["Big", "inhouseB"]].map(([l, f]) => (
                              <div key={f}><div className="text-[10px] text-gray-500 text-center font-semibold">{l}</div><input type="number" value={item[f] || 0} onChange={(e) => rcUpd(item.id, f, e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm font-bold text-center" /></div>
                            ))}</div>}
                      </div>
                      {/* Outsource */}
                      <div className={"rounded-lg p-3 border " + (item.outEnabled ? "bg-white border-amber-200" : "bg-gray-100 opacity-60")}>
                        <div className="flex justify-between items-center" style={{ marginBottom: item.outEnabled ? 8 : 0 }}>
                          <div className={"text-xs font-bold " + (item.outEnabled ? "text-amber-600" : "text-gray-500")}>🏭 Outsource</div>
                          <button onClick={() => rcUpd(item.id, "outEnabled", !item.outEnabled)} className={"w-9 h-5 rounded-full relative transition-colors " + (item.outEnabled ? "bg-amber-500" : "bg-gray-300")}>
                            <span className={"absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all " + (item.outEnabled ? "left-[18px]" : "left-0.5")} />
                          </button>
                        </div>
                        {item.outEnabled && <div className="grid grid-cols-3 gap-2">{[["S", "outS"], ["M", "outM"], ["B", "outB"]].map(([l, f]) => (
                          <div key={f}><div className="text-[10px] text-gray-500 text-center font-semibold">{l}</div><input type="number" value={item[f] || 0} onChange={(e) => rcUpd(item.id, f, e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm font-bold text-center" /></div>
                        ))}</div>}
                      </div>
                      <div><label className="text-[10px] text-gray-500">Notes</label><input defaultValue={item.notes || ""} onBlur={(e) => rcUpd(item.id, "notes", e.target.value)} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

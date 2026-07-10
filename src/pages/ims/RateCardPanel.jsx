import { useState } from "react";
import { RC_UNITS } from "../../lib/studio/constants";
import { rcIsSMB, getFloralMode } from "../../lib/rateCard";

// Rate Card → IMS migration Phase 3: item + category admin, moved here from Studio's
// src/pages/studio/RateCard.jsx (which is now read-only — see that file's header comment).
// Writes go through onSaveItems/onSaveCats (IMS.jsx's saveRateCardItems/saveRateCardCats), which
// persist to the same `rate_card` table / `ambria-rccats-v1` settings key Studio already reads via
// its existing realtime subscription — Studio needs no further changes to pick up edits made here.
//
// Deliberate simplification vs. the Studio original: categories commit immediately per-edit
// (matching the Phase 1 Sub-Categories panel's blur/change-commit pattern) instead of a staged
// "Save Categories" button — simpler, and there's no risk of losing typed edits by navigating away
// mid-edit. Tagging-visibility (isSubTagHidden/toggleTagHiddenSub) is intentionally NOT ported here
// — it's a tagging concern, not pricing, and stays Studio-side per the migration plan.

const NUM_FIELDS = ["inhouseFlat", "inhouseS", "inhouseM", "inhouseB", "outS", "outM", "outB", "artificialFlat", "artificialS", "artificialM", "artificialB", "defaultRealPct"];
const NEW_ITEM_DEFAULTS = { sub: "", name: "", unit: "pc", inhouseMode: "flat", inhouseFlat: 0, inhouseS: 0, inhouseM: 0, inhouseB: 0, outEnabled: false, outS: 0, outM: 0, outB: 0, notes: "", artificialFlat: 0, artificialS: 0, artificialM: 0, artificialB: 0, defaultRealPct: 100, floralMode: "ratio" };

const isNotRated = (i) => i.unit !== "included" && i.unit !== "multiplier" && (i.inhouseFlat || 0) === 0 && (i.inhouseS || 0) === 0 && (i.inhouseM || 0) === 0 && (i.inhouseB || 0) === 0;
const rcFmt = (n) => { const v = Number(n) || 0; return v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : `₹${v.toLocaleString("en-IN")}`; };

function PriceBadge({ item }) {
  const nr = isNotRated(item);
  if (item.unit === "included") return <span className="text-sm font-semibold text-emerald-600">Included</span>;
  if (item.unit === "multiplier") return <span className="text-base font-bold text-indigo-600">×{item.inhouseFlat || 0}</span>;
  if (rcIsSMB(item)) return (
    <div className="flex gap-2">
      {[["S", item.inhouseS], ["M", item.inhouseM], ["B", item.inhouseB]].map(([l, v]) => (
        <div key={l} className="text-center">
          <div className="text-[8px] font-bold text-gray-400">{l}</div>
          <div className={"text-xs font-bold " + ((v || 0) === 0 ? "text-amber-500" : "text-gray-800")}>{(v || 0) === 0 ? "⚠️" : rcFmt(v)}</div>
        </div>
      ))}
    </div>
  );
  return <span className={"text-sm font-bold " + (nr ? "text-amber-500" : "text-gray-800")}>{nr ? "⚠️ Set" : rcFmt(item.inhouseFlat)}</span>;
}

export default function RateCardPanel({ rcItems = [], rcCats = [], onSaveItems, onSaveCats }) {
  const [activeCat, setActiveCat] = useState(rcCats[0]?.id || "");
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState("");
  const [editId, setEditId] = useState(null);
  const [catEditMode, setCatEditMode] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [newForm, setNewForm] = useState({ ...NEW_ITEM_DEFAULTS });
  const [editBuffers, setEditBuffers] = useState({}); // `${id}::${field}` -> in-progress text value

  const curCat = rcCats.find((c) => c.id === activeCat) || rcCats[0];

  // ── Item writes ──
  function updateItem(id, field, value) {
    const isNum = NUM_FIELDS.includes(field);
    onSaveItems?.(rcItems.map((i) => (i.id === id ? { ...i, [field]: isNum ? Number(value) || 0 : value } : i)));
  }
  function bufferedValue(id, field, current) { const k = `${id}::${field}`; return editBuffers[k] !== undefined ? editBuffers[k] : current; }
  function setBuffer(id, field, value) { setEditBuffers((prev) => ({ ...prev, [`${id}::${field}`]: value })); }
  function commitBuffer(id, field) {
    const k = `${id}::${field}`;
    const raw = editBuffers[k];
    setEditBuffers((prev) => { const n = { ...prev }; delete n[k]; return n; });
    if (raw === undefined) return;
    updateItem(id, field, raw);
  }
  function deleteItem(id) {
    const it = rcItems.find((i) => i.id === id);
    if (!window.confirm(`Delete "${it?.name || "item"}"? This cannot be undone.`)) return;
    onSaveItems?.(rcItems.filter((i) => i.id !== id), [id]);
  }
  function addItem() {
    const name = (newForm.name || "").trim();
    if (!name) { alert("Item needs a name"); return; }
    const item = { ...newForm, id: "RC" + Date.now().toString(36), cat: activeCat, sub: newForm.sub || "General", name };
    onSaveItems?.([...rcItems, item]);
    setAddMode(false);
    setNewForm({ ...NEW_ITEM_DEFAULTS });
  }

  // ── Category writes (each commits immediately) ──
  function updateCat(idx, field, value) {
    const nc = rcCats.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
    onSaveCats?.(nc);
  }
  function moveCat(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= rcCats.length) return;
    const nc = [...rcCats];
    [nc[idx], nc[j]] = [nc[j], nc[idx]];
    onSaveCats?.(nc);
  }
  function deleteCat(idx) {
    const c = rcCats[idx];
    const n = rcItems.filter((i) => i.cat === c.id).length;
    if (n > 0) { alert(`Cannot delete — ${n} item(s) use this category. Move them first.`); return; }
    if (!window.confirm(`Delete "${c.l}"?`)) return;
    const nc = rcCats.filter((_, i) => i !== idx);
    onSaveCats?.(nc);
    if (activeCat === c.id && nc.length) setActiveCat(nc[0].id);
  }
  function addCat() {
    const newId = "cat_" + Date.now().toString(36).slice(-5);
    onSaveCats?.([...rcCats, { id: newId, l: "New Category", icon: "📦", c: "#9CA3AF", d: "" }]);
  }

  const rcStats = { t: rcItems.length, nr: rcItems.filter(isNotRated).length };
  const filtered = rcItems.filter((i) => {
    if (i.cat !== activeCat) return false;
    if (search.trim()) { const q = search.toLowerCase(); return (i.name || "").toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q); }
    return true;
  });
  const grouped = {};
  filtered.forEach((i) => { const k = i.sub || "General"; (grouped[k] = grouped[k] || []).push(i); });
  const subOptions = Object.keys(grouped).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const activeSub = subFilter && subOptions.includes(subFilter) ? subFilter : "";
  const groupEntries = subOptions.filter((s) => !activeSub || s === activeSub).map((s) => [s, grouped[s]]);
  const subDatalist = [...new Set(rcItems.map((i) => i.sub).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-2xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <p className="font-bold text-gray-900 mb-1">💰 Rate Card</p>
            <p className="text-xs text-gray-500">Item pricing and categories — Studio's Rate Card page is now read-only; edit here instead.</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{rcStats.t} items</span>
            {rcStats.nr > 0 && <span className="text-amber-600 font-semibold">⚠ {rcStats.nr} need rates</span>}
          </div>
        </div>

        <div className="grid grid-cols-[220px_1fr] gap-5">
          {/* Category sidebar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500">Categories</span>
              <button onClick={() => setCatEditMode(!catEditMode)} className={"text-[10px] font-semibold px-2 py-1 rounded-md " + (catEditMode ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600")}>{catEditMode ? "✓ Done" : "✏️ Edit"}</button>
            </div>
            {catEditMode ? (
              <div className="space-y-2">
                {rcCats.map((c, idx) => {
                  const n = rcItems.filter((i) => i.cat === c.id).length;
                  return (
                    <div key={c.id} className="border rounded-lg p-2 bg-gray-50">
                      <div className="flex items-center gap-1 mb-1.5">
                        <input value={c.icon} onChange={(e) => updateCat(idx, "icon", e.target.value)} maxLength={2} className="w-8 text-center border rounded px-1 py-0.5 text-sm" />
                        <input value={c.l} onChange={(e) => updateCat(idx, "l", e.target.value)} className="flex-1 border rounded px-1.5 py-0.5 text-xs font-semibold" />
                      </div>
                      <div className="flex items-center gap-1 mb-1.5">
                        <input type="color" value={c.c || "#C9A96E"} onChange={(e) => updateCat(idx, "c", e.target.value)} className="w-5 h-5 border-none rounded cursor-pointer p-0" />
                        <input value={c.d || ""} onChange={(e) => updateCat(idx, "d", e.target.value)} placeholder="Description…" className="flex-1 border rounded px-1.5 py-0.5 text-[10px]" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1">
                          {idx > 0 && <button onClick={() => moveCat(idx, -1)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200">▲</button>}
                          {idx < rcCats.length - 1 && <button onClick={() => moveCat(idx, 1)} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-200">▼</button>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-gray-400">{n} items</span>
                          <button onClick={() => deleteCat(idx)} className={"text-[9px] px-1 py-0.5 rounded " + (n > 0 ? "text-gray-300" : "text-red-500 hover:bg-red-50")}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button onClick={addCat} className="w-full py-2 rounded-lg border border-dashed border-indigo-300 text-indigo-600 text-xs font-semibold">+ Add Category</button>
              </div>
            ) : (
              <div className="space-y-1">
                {rcCats.map((c) => {
                  const n = rcItems.filter((i) => i.cat === c.id).length;
                  const nr = rcItems.filter((i) => i.cat === c.id && isNotRated(i)).length;
                  return (
                    <div key={c.id} onClick={() => { setActiveCat(c.id); setSearch(""); setSubFilter(""); }}
                      className={"px-3 py-2 rounded-lg cursor-pointer border text-sm flex items-center justify-between " + (activeCat === c.id ? "bg-indigo-50 border-indigo-300" : "bg-white border-gray-200")}>
                      <span className="flex items-center gap-1.5 truncate"><span>{c.icon}</span><span className={activeCat === c.id ? "font-semibold text-indigo-700" : "text-gray-700"}>{c.l}</span></span>
                      <span className="flex items-center gap-1 flex-shrink-0"><span className="text-[10px] text-gray-400">{n}</span>{nr > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="flex gap-2 mb-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
              <button onClick={() => { setNewForm({ ...NEW_ITEM_DEFAULTS }); setAddMode(!addMode); }} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold whitespace-nowrap">+ Add Item</button>
            </div>

            {subOptions.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button onClick={() => setSubFilter("")} className={"text-[11px] font-semibold px-2.5 py-1 rounded-full border " + (!activeSub ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500")}>All ({filtered.length})</button>
                {subOptions.map((s) => (
                  <button key={s} onClick={() => setSubFilter(activeSub === s ? "" : s)} className={"text-[11px] font-semibold px-2.5 py-1 rounded-full border " + (activeSub === s ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500")}>{s} <span className="opacity-60">({grouped[s].length})</span></button>
                ))}
              </div>
            )}

            <datalist id="ims-rc-sub-list">{subDatalist.map((s) => <option key={s} value={s} />)}</datalist>

            {addMode && (
              <div className="bg-gray-50 border-2 border-indigo-200 rounded-xl p-4 mb-3">
                <p className="text-sm font-bold text-indigo-700 mb-3">Add New Item to {curCat?.l}</p>
                <div className="grid grid-cols-3 gap-2 mb-2.5">
                  <div><label className="text-[10px] text-gray-500">Sub-Category *</label><input value={newForm.sub} onChange={(e) => setNewForm((p) => ({ ...p, sub: e.target.value }))} list="ims-rc-sub-list" placeholder="e.g. Sofa" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                  <div><label className="text-[10px] text-gray-500">Item Name *</label><input value={newForm.name} onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. 3-Seater" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                  <div><label className="text-[10px] text-gray-500">Unit</label><select value={newForm.unit} onChange={(e) => setNewForm((p) => ({ ...p, unit: e.target.value }))} className="w-full border rounded-lg px-2 py-1.5 text-sm">{RC_UNITS.map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select></div>
                </div>
                <div className="bg-white border rounded-lg p-3 mb-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-emerald-600">🏠 Inhouse</span>
                    <div className="flex gap-1">{["flat", "smb"].map((m) => <button key={m} onClick={() => setNewForm((p) => ({ ...p, inhouseMode: m }))} className={"text-[10px] font-semibold px-2 py-0.5 rounded " + (newForm.inhouseMode === m ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500")}>{m === "flat" ? "Flat" : "S/M/B"}</button>)}</div>
                  </div>
                  {newForm.inhouseMode === "flat" ? (
                    <div className="flex items-center gap-1.5"><span className="text-gray-400">₹</span><input type="number" value={newForm.inhouseFlat} onChange={(e) => setNewForm((p) => ({ ...p, inhouseFlat: Number(e.target.value) || 0 }))} className="w-32 border rounded-lg px-2 py-1 text-sm font-bold text-right" /></div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">{[["Small", "inhouseS"], ["Medium", "inhouseM"], ["Big", "inhouseB"]].map(([l, f]) => <div key={f}><div className="text-[9px] text-gray-400 text-center mb-0.5">{l}</div><input type="number" value={newForm[f]} onChange={(e) => setNewForm((p) => ({ ...p, [f]: Number(e.target.value) || 0 }))} className="w-full border rounded-lg px-2 py-1 text-sm font-bold text-center" /></div>)}</div>
                  )}
                </div>
                <div><label className="text-[10px] text-gray-500">Notes</label><input value={newForm.notes} onChange={(e) => setNewForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional…" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                <div className="flex gap-2 mt-3 justify-end">
                  <button onClick={() => setAddMode(false)} className="px-3 py-1.5 rounded-lg text-xs text-gray-600 bg-gray-100">Cancel</button>
                  <button onClick={addItem} className="px-3 py-1.5 rounded-lg text-xs text-white bg-indigo-600 font-semibold">✓ Add Item</button>
                </div>
              </div>
            )}

            {groupEntries.map(([sub, itemsInSub]) => (
              <div key={sub} className="mb-3.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-0.5 h-3 rounded" style={{ background: curCat?.c || "#6366F1" }} />
                  <span className="text-xs font-bold" style={{ color: curCat?.c || "#6366F1" }}>{sub}</span>
                  <span className="text-[10px] text-gray-400">({itemsInSub.length})</span>
                </div>
                {itemsInSub.map((item) => {
                  const isOpen = editId === item.id;
                  const isFloral = (item.cat || "").toLowerCase() === "florals";
                  return (
                    <div key={item.id} className={"border rounded-lg mb-1 overflow-hidden " + (isOpen ? "border-indigo-400 border-2" : "border-gray-200")}>
                      <div className="flex items-center justify-between px-3 py-2 cursor-pointer" onClick={() => setEditId(isOpen ? null : item.id)}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">{item.name}</span>
                          {item.outEnabled && <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-bold">+OUT</span>}
                          {item._imsDriven && <span title="Auto-priced from IMS recipe" className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-bold">🔒 IMS-DRIVEN</span>}
                          {isFloral && (() => { const m = getFloralMode(item); return m === "real" ? <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-bold">🎯 100% REAL</span> : m === "artificial" ? <span className="text-[8px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 font-bold">🎯 100% ARTIFICIAL</span> : <span className="text-[8px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-bold">🌐 RATIO-DRIVEN</span>; })()}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <PriceBadge item={item} />
                          <button onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }} className="text-red-400 hover:text-red-600 text-xs px-1">🗑️</button>
                        </div>
                      </div>
                      {!isOpen && item.notes && <div className="px-3 pb-1.5 text-[10px] text-gray-500">{item.notes}</div>}
                      {isOpen && (
                        <div className="px-4 py-3 border-t bg-gray-50">
                          <div className="grid grid-cols-4 gap-2 mb-3">
                            <div><label className="text-[10px] text-gray-500">Category</label><select value={item.cat || ""} onChange={(e) => updateItem(item.id, "cat", e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">{rcCats.map((c) => <option key={c.id} value={c.id}>{c.l}</option>)}</select></div>
                            <div><label className="text-[10px] text-gray-500">Name</label><input value={bufferedValue(item.id, "name", item.name)} onChange={(e) => setBuffer(item.id, "name", e.target.value)} onBlur={() => commitBuffer(item.id, "name")} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                            <div><label className="text-[10px] text-gray-500">Sub-Category</label><input value={bufferedValue(item.id, "sub", item.sub || "")} onChange={(e) => setBuffer(item.id, "sub", e.target.value)} onBlur={() => commitBuffer(item.id, "sub")} list="ims-rc-sub-list" className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                            <div><label className="text-[10px] text-gray-500">Unit</label><select value={item.unit} onChange={(e) => updateItem(item.id, "unit", e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm">{RC_UNITS.map((u) => <option key={u.id} value={u.id}>{u.l}</option>)}</select></div>
                          </div>
                          <div className="mb-3">
                            <label className="text-[10px] text-gray-500">IMS sub-category alias <span className="opacity-60">· optional — Deal Check searches IMS as this sub-category. Blank = use Sub-Category above.</span></label>
                            <input value={bufferedValue(item.id, "imsAlias", item.imsAlias || "")} onChange={(e) => setBuffer(item.id, "imsAlias", e.target.value)} onBlur={() => commitBuffer(item.id, "imsAlias")} list="ims-rc-sub-list" placeholder={item.sub ? `same as "${item.sub}"` : "same as sub-category"} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                          </div>
                          <div className={"rounded-lg p-3 mb-3 bg-white border " + (item._imsDriven ? "border-emerald-300" : "border-gray-200")}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-emerald-600">🏠 Inhouse</span>
                              <div className="flex gap-1">{["flat", "smb"].map((m) => <button key={m} disabled={!!item._imsDriven} onClick={() => !item._imsDriven && updateItem(item.id, "inhouseMode", m)} className={"text-[10px] font-semibold px-2 py-0.5 rounded " + (item.inhouseMode === m ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500") + (item._imsDriven ? " opacity-50 cursor-not-allowed" : "")}>{m === "flat" ? "Flat" : "S/M/B"}</button>)}</div>
                            </div>
                            {item.inhouseMode === "flat" ? (
                              <div className="flex items-center gap-1.5"><span className="text-gray-400">₹</span><input type="number" readOnly={!!item._imsDriven} value={item.inhouseFlat || 0} onChange={(e) => !item._imsDriven && updateItem(item.id, "inhouseFlat", e.target.value)} className={"w-36 border rounded-lg px-2 py-1 text-base font-bold text-right" + (item._imsDriven ? " opacity-70" : "")} /></div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2">{[["Small", "inhouseS"], ["Medium", "inhouseM"], ["Big", "inhouseB"]].map(([l, f]) => <div key={f}><div className="text-[10px] text-gray-500 text-center font-semibold">{l}</div><input type="number" readOnly={!!item._imsDriven} value={item[f] || 0} onChange={(e) => !item._imsDriven && updateItem(item.id, f, e.target.value)} className={"w-full border rounded-lg px-2 py-1 text-sm font-bold text-center" + (item._imsDriven ? " opacity-70" : "")} /></div>)}</div>
                            )}
                          </div>
                          {isFloral && (() => {
                            const mode = getFloralMode(item);
                            const setMode = (m) => { updateItem(item.id, "floralMode", m); if (m === "real") updateItem(item.id, "defaultRealPct", 100); else if (m === "artificial") updateItem(item.id, "defaultRealPct", 0); };
                            const pillCls = (active, color) => "text-[10px] font-bold px-2.5 py-1 rounded whitespace-nowrap " + (active ? color + " text-white" : "bg-gray-100 text-gray-500");
                            return (
                              <div className="bg-white border rounded-lg p-3 mb-3">
                                <p className="text-[11px] font-bold text-pink-600 mb-2">🌸 Pricing mode</p>
                                <div className="flex gap-1.5 flex-wrap mb-2">
                                  <button onClick={() => setMode("ratio")} className={pillCls(mode === "ratio", "bg-gray-400")}>🌐 Global ratio</button>
                                  <button onClick={() => setMode("real")} className={pillCls(mode === "real", "bg-emerald-500")}>🎯 100% Real</button>
                                  <button onClick={() => setMode("artificial")} className={pillCls(mode === "artificial", "bg-pink-500")}>🎯 100% Artificial</button>
                                </div>
                                <p className="text-[10px] text-gray-400 italic">Artificial cost is auto-derived from the IMS recipe (pieces × mix rate × markup) — no manual rate needed.</p>
                              </div>
                            );
                          })()}
                          <div className={"rounded-lg p-3 mb-3 border " + (item.outEnabled ? "bg-white border-amber-200" : "bg-gray-100 border-gray-200 opacity-60")}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={"text-xs font-bold " + (item.outEnabled ? "text-amber-600" : "text-gray-500")}>🏭 Outsource</span>
                              <button onClick={() => updateItem(item.id, "outEnabled", !item.outEnabled)} className={"w-9 h-5 rounded-full relative " + (item.outEnabled ? "bg-amber-500" : "bg-gray-300")}><span className={"w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all " + (item.outEnabled ? "left-4" : "left-0.5")} /></button>
                            </div>
                            {item.outEnabled && <div className="grid grid-cols-3 gap-2">{[["S", "outS"], ["M", "outM"], ["B", "outB"]].map(([l, f]) => <div key={f}><div className="text-[10px] text-gray-500 text-center font-semibold">{l}</div><input type="number" value={item[f] || 0} onChange={(e) => updateItem(item.id, f, e.target.value)} className="w-full border rounded-lg px-2 py-1 text-sm font-bold text-center" /></div>)}</div>}
                          </div>
                          <div><label className="text-[10px] text-gray-500">Notes</label><input value={bufferedValue(item.id, "notes", item.notes || "")} onChange={(e) => setBuffer(item.id, "notes", e.target.value)} onBlur={() => commitBuffer(item.id, "notes")} className="w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {groupEntries.length === 0 && <div className="text-center py-10 text-sm text-gray-400">{search ? "No matches" : "No items in this category"}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

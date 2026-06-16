import { useState } from "react";
import { Tabs, AddInlineItem } from "../../components/ui";
import { compressImageForCloudinary, IMS_CLD_PRESET, IMS_CLD_UPLOAD_URL } from "../../lib/cloudinary";

// AdminSettingsTab — the keystone settings component (Admin → Settings, and via `mode`
// the Flowers mandi/recipes + Planning truss/fabric config sub-tabs).
//
// Built incrementally. LIVE this slice: Supervisors, Sub-Categories (read-only viewer),
// Synonyms. Placeholdered until their slices: Workforce (labour tiers), Venue Min Labour,
// Dihari Timings, and the mode-driven mandi / patterns / truss&batta / fabric stock panels.
function Placeholder({ name, note }) {
  return (
    <div className="text-center text-gray-400 py-16">
      <p className="text-lg mb-1">{name}</p>
      <p className="text-sm">Being rebuilt in a later slice of the Settings keystone{note ? ` (${note})` : ""}.</p>
    </div>
  );
}

export default function AdminSettingsTab({ settings, setSettings, supervisors, setSupervisors, studio, mode }) {
  const studioSubcats = studio?.subcats || [];
  const studioLoading = !!studio?.loading;
  const [synNewWords, setSynNewWords] = useState("");
  // Mandi panel state
  const [sArtSettingsOpen, setSArtSettingsOpen] = useState(false);
  const [sMandiSearch, setSMandiSearch] = useState("");
  const [sMandiCat, setSMandiCat] = useState("All");
  const [sMandiCatManage, setSMandiCatManage] = useState(false);
  const [sMandiCatNew, setSMandiCatNew] = useState("");
  const [sMandiExpanded, setSMandiExpanded] = useState(() => new Set());
  const [sMandiUploading, setSMandiUploading] = useState({});

  const forcedMode = !!mode;
  const [panel, setPanel] = useState(forcedMode ? mode : "supervisors");
  const activePanel = forcedMode ? mode : panel;

  const panels = forcedMode ? [] : [
    { id: "labourtiers", label: "👷 Workforce" },
    { id: "venuemin", label: "🏢 Venue Min Labour" },
    { id: "dihari", label: "💰 Dihari Timings" },
    { id: "supervisors", label: "👷 Supervisors" },
    { id: "subcats", label: "📂 Sub-Categories" },
    { id: "synonyms", label: "🔤 AI Synonyms" },
  ];

  function addSupervisor() {
    const id = "S" + String(supervisors.length + 1).padStart(3, "0");
    setSupervisors([...supervisors, { id, name: "New Supervisor", phone: "", active: true }]);
  }
  function updateSupervisor(id, field, val) { setSupervisors((prev) => prev.map((s) => s.id === id ? { ...s, [field]: val } : s)); }
  function removeSupervisor(id) { setSupervisors((prev) => prev.filter((s) => s.id !== id), [id]); }

  return (
    <div className="space-y-4">
      {!forcedMode && <Tabs tabs={panels} active={panel} onChange={setPanel} />}

      {(activePanel === "labourtiers") && <Placeholder name="👷 Workforce / Labour Tiers" />}
      {(activePanel === "venuemin") && <Placeholder name="🏢 Venue Minimum Labour" />}
      {(activePanel === "dihari") && <Placeholder name="💰 Dihari Timings" />}
      {activePanel === "mandi" && (
        <div className="space-y-5">
          {/* Artificial Flower Colours */}
          <div>
            <div className="bg-white border rounded-xl p-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">🎨 Artificial Flower Colours</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(settings.artificialColours || []).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 bg-pink-50 border border-pink-200 text-pink-700 text-xs px-2 py-1 rounded-full">
                    {c}
                    <button onClick={() => setSettings((s) => ({ ...s, artificialColours: s.artificialColours.filter((x) => x !== c) }))} className="text-pink-400 hover:text-red-500 leading-none">×</button>
                  </span>
                ))}
              </div>
              <AddInlineItem placeholder="Add colour..." onAdd={(v) => setSettings((s) => ({ ...s, artificialColours: [...(s.artificialColours || []), v] }))} />
            </div>
          </div>

          {/* Mandi Price Multipliers */}
          <div className="bg-white border rounded-xl p-4">
            <label className="text-sm font-medium text-gray-700 block mb-1">🌺 Mandi Price Multipliers (by Date Category)</label>
            <p className="text-xs text-gray-500 mb-3">Flower prices fluctuate with wedding season demand. Heavy Saya prices surge, Non-Saya prices drop. Applied to shopping list estimates.</p>
            <div className="flex items-center gap-4">
              {[
                { key: "heavy_saya", label: "🔴 Heavy Saya" },
                { key: "competition", label: "🟡 Competition", locked: true },
                { key: "non_saya", label: "🟢 Non-Saya" },
              ].map((cat) => (
                <div key={cat.key} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-700">{cat.label}</span>
                  {cat.locked
                    ? <span className="w-16 text-center text-xs font-bold text-gray-400 border rounded-lg px-2 py-1.5 bg-gray-50">1.0×</span>
                    : <input type="number" step="0.05" min="0.5" max="2.0"
                        value={(settings.mandiPriceMultipliers || {})[cat.key] || 1}
                        onChange={(e) => setSettings((s) => ({ ...s, mandiPriceMultipliers: { ...s.mandiPriceMultipliers, [cat.key]: parseFloat(e.target.value) || 1 } }))}
                        className="w-16 border rounded-lg px-2 py-1.5 text-xs font-bold text-center" />
                  }
                  <span className="text-xs text-gray-400">×</span>
                </div>
              ))}
            </div>
          </div>

          {/* Artificial Bunch Cost Settings (collapsible) */}
          <div className="bg-pink-50 border border-pink-200 rounded-xl overflow-hidden">
            <button onClick={() => setSArtSettingsOpen((s) => !s)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-pink-100/50">
              <div className="text-left">
                <h4 className="font-semibold text-pink-800">🌺 Artificial Bunch Cost Settings</h4>
                <p className="text-xs text-pink-600 mt-0.5">Used in Studio Deal Check to convert real-flower recipes into artificial bunch costs. Customize all 4 rates here.</p>
              </div>
              <span className="text-pink-700 text-sm">{sArtSettingsOpen ? "▲ Hide" : "▼ Show"}</span>
            </button>
            {sArtSettingsOpen && (
              <div className="px-4 py-3 border-t border-pink-200 bg-white space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="border rounded-lg p-3 bg-pink-50/30">
                    <div className="text-xs font-semibold text-pink-800 mb-2">🌹 Artificial Flowers</div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-gray-600">Rate per kg</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">₹</span>
                          <input type="number" min="0" step="1" value={settings.artificialFlowerRatePerKg ?? 50}
                            onChange={(e) => setSettings((s) => ({ ...s, artificialFlowerRatePerKg: parseFloat(e.target.value) || 0 }))}
                            className="w-20 border rounded px-2 py-1 text-xs text-right font-semibold" />
                          <span className="text-xs text-gray-500">/kg</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-gray-600">Bunches per kg</label>
                        <div className="flex items-center gap-1">
                          <input type="number" min="1" step="1" value={settings.artificialFlowerBunchesPerKg ?? 16}
                            onChange={(e) => setSettings((s) => ({ ...s, artificialFlowerBunchesPerKg: parseFloat(e.target.value) || 1 }))}
                            className="w-20 border rounded px-2 py-1 text-xs text-right font-semibold" />
                          <span className="text-xs text-gray-500">bunches/kg</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-pink-700 italic pt-1">
                        → ₹{((settings.artificialFlowerRatePerKg || 50) / (settings.artificialFlowerBunchesPerKg || 16)).toFixed(2)} per flower bunch
                      </div>
                    </div>
                  </div>
                  <div className="border rounded-lg p-3 bg-green-50/40">
                    <div className="text-xs font-semibold text-green-800 mb-2">🌿 Artificial Greens</div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-gray-600">Rate per kg</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">₹</span>
                          <input type="number" min="0" step="1" value={settings.artificialGreenRatePerKg ?? 40}
                            onChange={(e) => setSettings((s) => ({ ...s, artificialGreenRatePerKg: parseFloat(e.target.value) || 0 }))}
                            className="w-20 border rounded px-2 py-1 text-xs text-right font-semibold" />
                          <span className="text-xs text-gray-500">/kg</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-gray-600">Bunches per kg</label>
                        <div className="flex items-center gap-1">
                          <input type="number" min="1" step="1" value={settings.artificialGreenBunchesPerKg ?? 23}
                            onChange={(e) => setSettings((s) => ({ ...s, artificialGreenBunchesPerKg: parseFloat(e.target.value) || 1 }))}
                            className="w-20 border rounded px-2 py-1 text-xs text-right font-semibold" />
                          <span className="text-xs text-gray-500">bunches/kg</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-green-700 italic pt-1">
                        → ₹{((settings.artificialGreenRatePerKg || 40) / (settings.artificialGreenBunchesPerKg || 23)).toFixed(2)} per green bunch
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 italic bg-gray-50 rounded p-2">
                  💡 Set 🌿 toggle + "bunches/unit" on each flower row below so Studio knows how to convert real-flower recipes into artificial bunches.
                </div>
              </div>
            )}
          </div>

          {/* Mandi catalogue */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-gray-800">🌸 Real Flower Mandi Catalogue</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Update current prices regularly. Previous price always shown for comparison.</p>
                </div>
                <button onClick={() => {
                  const newId = "F" + Date.now();
                  const newVId = "V" + Date.now();
                  setSettings((s) => ({ ...s, mandiCatalogue: [...(s.mandiCatalogue || []), {
                    id: newId, name: "New Flower", flowerCat: "Other", unit: "piece", gattharSize: null,
                    flowerType: "flower", isGreen: false, artificialBunchesPerUnit: null, currentPrice: 0, priceHistory: [],
                    colorVariants: [{ variantId: newVId, name: "New Variant", photoUrl: null, currentPrice: 0, priceHistory: [] }],
                    _tier21Migrated: true,
                  }] }));
                  setSMandiExpanded((prev) => { const s = new Set(prev); s.add(newId); return s; });
                }} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm">+ Add Flower</button>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <input value={sMandiSearch} onChange={(e) => setSMandiSearch(e.target.value)} placeholder="🔍 Search flowers..." className="border rounded-lg px-3 py-1.5 text-sm w-44" />
                <select value={sMandiCat} onChange={(e) => setSMandiCat(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
                  <option value="All">All Categories</option>
                  {[...new Set((settings.mandiCatalogue || []).map((f) => f.flowerCat || "Other"))].sort().map((c) => <option key={c}>{c}</option>)}
                </select>
                <span className="text-xs text-gray-400">
                  {(() => {
                    const all = settings.mandiCatalogue || [];
                    const totalVariants = all.reduce((s, p) => s + (p.colorVariants?.length || 0), 0);
                    const shown = all.filter((p) => {
                      const q = sMandiSearch.toLowerCase();
                      const matchParent = !q || (p.name || "").toLowerCase().includes(q) || (p.flowerCat || "").toLowerCase().includes(q);
                      const matchVariant = !q || (p.colorVariants || []).some((v) => (v.name || "").toLowerCase().includes(q));
                      return (matchParent || matchVariant) && (sMandiCat === "All" || (p.flowerCat || "Other") === sMandiCat);
                    });
                    const shownVariants = shown.reduce((s, p) => s + (p.colorVariants?.length || 0), 0);
                    return `${shown.length} of ${all.length} flowers · ${shownVariants} of ${totalVariants} variants`;
                  })()}
                </span>
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                {["All", ...[...new Set((settings.mandiCatalogue || []).map((f) => f.flowerCat || "Other"))].sort()].map((c) => {
                  const cnt = c === "All" ? (settings.mandiCatalogue || []).length : (settings.mandiCatalogue || []).filter((f) => (f.flowerCat || "Other") === c).length;
                  return <button key={c} onClick={() => setSMandiCat(c)} className={"px-2.5 py-0.5 rounded-full text-xs font-medium transition-all " + (sMandiCat === c ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100")}>{c} ({cnt})</button>;
                })}
                <button onClick={() => setSMandiCatManage((s) => !s)} className={"px-2.5 py-0.5 rounded-full text-xs font-medium transition-all border border-dashed " + (sMandiCatManage ? "bg-indigo-100 text-indigo-700 border-indigo-400" : "bg-white text-gray-500 border-gray-300 hover:border-indigo-400 hover:text-indigo-600")}>
                  {sMandiCatManage ? "✕ Close manage" : "⚙ Manage categories"}
                </button>
              </div>
              {sMandiCatManage && (
                <div className="bg-indigo-50/60 border border-indigo-200 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-medium text-indigo-800">Manage Flower Categories</div>
                  <div className="text-[10px] text-indigo-700/80">Add new categories or remove unused ones. Deleting a category reassigns all its flowers to "Other".</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(settings.flowerCategories || []).map((c) => {
                      const inUse = (settings.mandiCatalogue || []).filter((f) => (f.flowerCat || "Other") === c).length;
                      const isOther = c === "Other";
                      return (
                        <span key={c} className="inline-flex items-center gap-1 bg-white border border-indigo-200 rounded-full px-2.5 py-0.5 text-xs">
                          <span className="text-gray-800">{c}</span>
                          <span className="text-[9px] text-gray-400">({inUse})</span>
                          {!isOther && (
                            <button onClick={() => {
                              if (inUse > 0 && !window.confirm(`"${c}" is used by ${inUse} flower(s). They will be reassigned to "Other". Proceed?`)) return;
                              setSettings((s) => ({ ...s, flowerCategories: (s.flowerCategories || []).filter((x) => x !== c), mandiCatalogue: (s.mandiCatalogue || []).map((f) => (f.flowerCat || "Other") === c ? { ...f, flowerCat: "Other" } : f) }));
                              if (sMandiCat === c) setSMandiCat("All");
                            }} className="text-red-400 hover:text-red-600 leading-none ml-0.5">×</button>
                          )}
                          {isOther && <span className="text-[9px] text-gray-300 ml-0.5" title="The 'Other' category cannot be removed.">🔒</span>}
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex gap-1.5 items-center pt-1">
                    <input value={sMandiCatNew} onChange={(e) => setSMandiCatNew(e.target.value)} placeholder="New category name…"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault();
                        const v = sMandiCatNew.trim(); if (!v) return;
                        if ((settings.flowerCategories || []).some((x) => x.toLowerCase() === v.toLowerCase())) { alert(`"${v}" already exists`); return; }
                        setSettings((s) => ({ ...s, flowerCategories: [...(s.flowerCategories || []), v] }));
                        setSMandiCatNew("");
                      } }}
                      className="flex-1 border border-indigo-300 rounded px-2 py-1 text-xs bg-white" />
                    <button onClick={() => {
                      const v = sMandiCatNew.trim(); if (!v) return;
                      if ((settings.flowerCategories || []).some((x) => x.toLowerCase() === v.toLowerCase())) { alert(`"${v}" already exists`); return; }
                      setSettings((s) => ({ ...s, flowerCategories: [...(s.flowerCategories || []), v] }));
                      setSMandiCatNew("");
                    }} className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700">+ Add</button>
                  </div>
                </div>
              )}
            </div>
            {/* Column header strip */}
            <div className="px-4 py-2 bg-gray-50 border-t border-b border-gray-200 text-[10px] uppercase tracking-wide font-semibold text-gray-500 select-none"
              style={{ display: "grid", gridTemplateColumns: "16px 56px 140px 110px 80px 70px 110px 70px 70px 110px 40px 20px", gap: "8px", alignItems: "center" }}>
              <span>&nbsp;</span>
              <span className="text-center" title="Parent photo. With variants: shows cheapest variant's photo. Without variants: upload directly.">Photo</span>
              <span>Flower Name</span>
              <span>Category</span>
              <span>Unit</span>
              <span className="text-center" title="How many pieces in 1 bundle / gatthar / dozen">Pcs/Unit</span>
              <span className="text-center" title="Flower vs Green vs Real-Only (toggle)">Type</span>
              <span className="text-center" title="Artificial bunches that replace 1 unit of this real flower">Art Bunches/Unit</span>
              <span className="text-center" title="Previous price for trend comparison">Prev Price</span>
              <span className="text-center" title="Current price. Auto = lowest variant when variants exist; editable when no variants.">Current Price ₹</span>
              <span className="text-center" title="Price trend vs previous">Trend</span>
              <span>&nbsp;</span>
            </div>
            <div className="divide-y">
              {(settings.mandiCatalogue || []).filter((p) => {
                const q = sMandiSearch.toLowerCase();
                const matchParent = !q || (p.name || "").toLowerCase().includes(q) || (p.flowerCat || "").toLowerCase().includes(q);
                const matchVariant = !q || (p.colorVariants || []).some((v) => (v.name || "").toLowerCase().includes(q));
                return (matchParent || matchVariant) && (sMandiCat === "All" || (p.flowerCat || "Other") === sMandiCat);
              }).map((p) => {
                const variants = Array.isArray(p.colorVariants) ? p.colorVariants : [];
                const variantCount = variants.length;
                const expanded = sMandiExpanded.has(p.id);
                const type = p.flowerType || (p.isGreen ? "green" : "flower");
                const nextType = type === "flower" ? "green" : type === "green" ? "real_only" : "flower";
                const typeCfg = {
                  flower: { emoji: "🌹", label: "Flower", cls: "bg-pink-100 text-pink-700 border-pink-300", title: "Uses artificial-flower rate when blended" },
                  green: { emoji: "🌿", label: "Green", cls: "bg-green-100 text-green-700 border-green-300", title: "Uses artificial-green rate when blended" },
                  real_only: { emoji: "🔒", label: "Real Only", cls: "bg-amber-100 text-amber-800 border-amber-400", title: "Cannot be replaced — always 100% real regardless of element's blend setting" },
                }[type];
                const recalcParentLowest = (variantList) => {
                  let lo = null;
                  for (const cv of variantList) { const cp = Number(cv.currentPrice) || 0; if (cp > 0 && (lo === null || cp < lo)) lo = cp; }
                  return lo ?? 0;
                };
                return (
                  <div key={p.id} className="bg-white">
                    <div className="px-4 py-3 hover:bg-gray-50 cursor-pointer"
                      style={{ display: "grid", gridTemplateColumns: "16px 56px 140px 110px 80px 70px 110px 70px 70px 110px 40px 20px", gap: "8px", alignItems: "center" }}
                      onClick={() => setSMandiExpanded((prev) => { const s = new Set(prev); if (s.has(p.id)) s.delete(p.id); else s.add(p.id); return s; })}>
                      <span className="text-xs text-gray-400 select-none">{expanded ? "▼" : "▶"}</span>
                      {/* Photo */}
                      {(() => {
                        const hasVariants = variantCount > 0;
                        let cheapestVariant = null;
                        if (hasVariants) {
                          const priced = variants.filter((v) => (Number(v.currentPrice) || 0) > 0);
                          const pool = priced.length ? priced : variants;
                          cheapestVariant = pool.reduce((min, v) => { if (!min) return v; return (Number(v.currentPrice) || 0) < (Number(min.currentPrice) || 0) ? v : min; }, null);
                        }
                        const displayUrl = hasVariants ? (cheapestVariant?.photoUrl || null) : (p.photoUrl || null);
                        const parentUploadKey = `parent:${p.id}`;
                        const parentUploading = !!sMandiUploading[parentUploadKey];
                        if (hasVariants) {
                          return (
                            <div onClick={(e) => e.stopPropagation()} title={cheapestVariant ? `Photo of cheapest variant: ${cheapestVariant.name} (₹${Number(cheapestVariant.currentPrice) || 0}). Expand to manage variant photos.` : "No variant photos yet. Expand to upload."}>
                              {displayUrl ? <img src={displayUrl} alt={cheapestVariant?.name || p.name} className="w-12 h-12 rounded object-cover border" />
                                : <div className="w-12 h-12 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-300 text-xl">🌸</div>}
                            </div>
                          );
                        }
                        return (
                          <label className="block cursor-pointer" onClick={(e) => e.stopPropagation()}>
                            {displayUrl ? <img src={displayUrl} alt={p.name} className="w-12 h-12 rounded object-cover border" title="Click to replace photo" />
                              : <div className="w-12 h-12 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xl hover:border-indigo-400 hover:text-indigo-500" title="Upload parent flower photo">{parentUploading ? "…" : "+"}</div>}
                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0]; if (!file) return;
                              setSMandiUploading((prev) => ({ ...prev, [parentUploadKey]: true }));
                              try {
                                const compressed = await compressImageForCloudinary(file);
                                const fd = new FormData(); fd.append("file", compressed); fd.append("upload_preset", IMS_CLD_PRESET);
                                const res = await fetch(IMS_CLD_UPLOAD_URL, { method: "POST", body: fd });
                                const data = await res.json();
                                if (data.error) throw new Error(data.error.message || "Cloudinary upload failed");
                                const url = data.secure_url;
                                setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, photoUrl: url } : x) }));
                              } catch (err) { alert("Photo upload failed: " + (err?.message || err)); }
                              finally { setSMandiUploading((prev) => { const np = { ...prev }; delete np[parentUploadKey]; return np; }); e.target.value = ""; }
                            }} />
                          </label>
                        );
                      })()}
                      {/* Name */}
                      <input value={p.name} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { const v = e.target.value; setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, name: v } : x) })); }}
                        className="border rounded px-2 py-1 text-sm w-full font-semibold" />
                      {/* Category */}
                      <select value={p.flowerCat || "Other"} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { const v = e.target.value; setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, flowerCat: v } : x) })); }}
                        className="border rounded px-1 py-1 text-xs w-full">
                        {(settings.flowerCategories || ["Other"]).map((c) => <option key={c}>{c}</option>)}
                      </select>
                      {/* Unit */}
                      <select value={p.unit} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { const v = e.target.value; setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, unit: v } : x) })); }}
                        className="border rounded px-2 py-1 text-xs w-full">
                        {["piece", "bundle", "gatthar", "kg", "dozen", "kodi", "pair"].map((u) => <option key={u}>{u}</option>)}
                      </select>
                      {/* Pcs/Unit */}
                      {p.unit !== "piece" ? (
                        <input type="number" min="1" value={p.gattharSize || ""} placeholder={"pcs/" + p.unit} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => { const v = parseInt(e.target.value) || null; setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, gattharSize: v } : x) })); }}
                          className="border rounded px-2 py-1 text-xs text-center w-full" />
                      ) : <span className="text-center text-gray-300">—</span>}
                      {/* Type */}
                      <button onClick={(e) => { e.stopPropagation(); setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, flowerType: nextType, isGreen: nextType === "green" } : x) })); }}
                        title={typeCfg.title} className={"text-xs px-2 py-1 rounded font-medium border w-full " + typeCfg.cls}>
                        {typeCfg.emoji} {typeCfg.label}
                      </button>
                      {/* Art Bunches/Unit */}
                      {type !== "real_only" ? (
                        <input type="number" min="0" step="0.01" value={p.artificialBunchesPerUnit ?? ""} onClick={(e) => e.stopPropagation()} placeholder="art b/u"
                          onChange={(e) => { const v = parseFloat(e.target.value); setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, artificialBunchesPerUnit: isNaN(v) ? null : v } : x) })); }}
                          title={`How many artificial ${type === "green" ? "green" : "flower"} bunches replace 1 ${p.unit} of ${p.name}`}
                          className="border rounded px-2 py-1 text-xs text-center w-full" />
                      ) : <span className="text-center text-gray-300">—</span>}
                      {/* Prev / Current / Trend */}
                      {(() => {
                        const hasVariants = variantCount > 0;
                        const parentPrev = p.priceHistory?.length ? p.priceHistory[p.priceHistory.length - 1].price : null;
                        const parentCurrent = Number(p.currentPrice) || 0;
                        const parentTrend = parentPrev === null ? "—" : parentCurrent > parentPrev ? "↑" : parentCurrent < parentPrev ? "↓" : "→";
                        const parentTrendCls = parentTrend === "↑" ? "text-red-500 font-bold" : parentTrend === "↓" ? "text-green-600 font-bold" : "text-gray-400";
                        return (
                          <>
                            <span className="text-center text-xs text-gray-400" title={hasVariants ? "Expand to see each variant's prev" : "Previous mandi price"}>
                              {hasVariants ? "see ▼" : (parentPrev != null ? `₹${parentPrev}` : "—")}
                            </span>
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <span className="text-gray-500 text-xs">₹</span>
                              <input type="number" min="0" value={parentCurrent} readOnly={hasVariants} disabled={hasVariants}
                                title={hasVariants ? `Auto = lowest variant price (₹${parentCurrent}). Edit individual variants in expand.` : `Direct mandi price for ${p.name} (no variants).`}
                                onChange={(e) => {
                                  if (hasVariants) return;
                                  const nv = parseFloat(e.target.value) || 0;
                                  setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => {
                                    if (x.id !== p.id) return x;
                                    return { ...x, priceHistory: [...(x.priceHistory || []), { price: x.currentPrice || 0, date: new Date().toISOString().split("T")[0] }], currentPrice: nv };
                                  }) }));
                                }}
                                className={"border rounded px-2 py-1 text-xs text-center w-20 font-semibold " + (hasVariants ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "bg-white")} />
                            </div>
                            <span className={"text-center text-base " + (hasVariants ? "text-gray-300" : parentTrendCls)} title={hasVariants ? "Trend shown per variant on expand" : "Price trend vs previous"}>
                              {hasVariants ? "—" : parentTrend}
                            </span>
                          </>
                        );
                      })()}
                      {/* Delete */}
                      <button onClick={(e) => { e.stopPropagation();
                        if (window.confirm(`Delete "${p.name}" and its ${variantCount} variant(s)? Recipes referencing this flower will become uncosted.`))
                          setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.filter((x) => x.id !== p.id) }));
                      }} className="text-red-400 hover:text-red-600 text-base">×</button>
                    </div>
                    {/* Expanded variants */}
                    {expanded && (
                      <div className="px-6 pb-4 bg-gray-50/40">
                        <table className="w-full text-xs">
                          <thead className="text-gray-400">
                            <tr>
                              <th className="px-2 py-1.5 text-left font-medium w-16">📷</th>
                              <th className="px-2 py-1.5 text-left font-medium">Variant Name</th>
                              <th className="px-2 py-1.5 text-center font-medium">Prev</th>
                              <th className="px-2 py-1.5 text-center font-medium">Current ₹</th>
                              <th className="px-2 py-1.5 text-center font-medium">Trend</th>
                              <th className="px-2 py-1.5 w-8"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {variants.map((v) => {
                              const prev = v.priceHistory?.length ? v.priceHistory[v.priceHistory.length - 1].price : null;
                              const trend = prev === null ? "—" : v.currentPrice > prev ? "↑" : v.currentPrice < prev ? "↓" : "→";
                              const trendCls = trend === "↑" ? "text-red-500 font-bold" : trend === "↓" ? "text-green-600 font-bold" : "text-gray-400";
                              const uploadKey = `${p.id}:${v.variantId}`;
                              const uploading = !!sMandiUploading[uploadKey];
                              return (
                                <tr key={v.variantId} className="border-t border-gray-200 bg-white">
                                  <td className="px-2 py-1.5">
                                    <label className="block cursor-pointer">
                                      {v.photoUrl ? <img src={v.photoUrl} alt={v.name} className="w-12 h-12 rounded object-cover border" title="Click to replace" />
                                        : <div className="w-12 h-12 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xl hover:border-indigo-400 hover:text-indigo-500" title="Upload variant photo">{uploading ? "…" : "+"}</div>}
                                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                        const file = e.target.files?.[0]; if (!file) return;
                                        setSMandiUploading((prev) => ({ ...prev, [uploadKey]: true }));
                                        try {
                                          const compressed = await compressImageForCloudinary(file);
                                          const fd = new FormData(); fd.append("file", compressed); fd.append("upload_preset", IMS_CLD_PRESET);
                                          const res = await fetch(IMS_CLD_UPLOAD_URL, { method: "POST", body: fd });
                                          const data = await res.json();
                                          if (data.error) throw new Error(data.error.message || "Cloudinary upload failed");
                                          const url = data.secure_url;
                                          setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, colorVariants: (x.colorVariants || []).map((cv) => cv.variantId === v.variantId ? { ...cv, photoUrl: url } : cv) } : x) }));
                                        } catch (err) { alert("Photo upload failed: " + (err?.message || err)); }
                                        finally { setSMandiUploading((prev) => { const np = { ...prev }; delete np[uploadKey]; return np; }); e.target.value = ""; }
                                      }} />
                                    </label>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <input value={v.name}
                                      onChange={(e) => { const nv = e.target.value; setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, colorVariants: (x.colorVariants || []).map((cv) => cv.variantId === v.variantId ? { ...cv, name: nv } : cv) } : x) })); }}
                                      className="border rounded px-2 py-1 text-xs w-44" />
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-gray-400">{prev != null ? `₹${prev}` : "—"}</td>
                                  <td className="px-2 py-1.5 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                      <span className="text-gray-500">₹</span>
                                      <input type="number" min="0" value={v.currentPrice}
                                        onChange={(e) => { const nv = parseFloat(e.target.value) || 0;
                                          setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => {
                                            if (x.id !== p.id) return x;
                                            const newVariants = (x.colorVariants || []).map((cv) => cv.variantId === v.variantId ? { ...cv, priceHistory: [...(cv.priceHistory || []), { price: cv.currentPrice, date: new Date().toISOString().split("T")[0] }], currentPrice: nv } : cv);
                                            return { ...x, colorVariants: newVariants, currentPrice: recalcParentLowest(newVariants) };
                                          }) }));
                                        }}
                                        className="border rounded px-2 py-1 text-xs text-center w-16 font-semibold" />
                                    </div>
                                  </td>
                                  <td className={"px-2 py-1.5 text-center text-base " + trendCls}>{trend}</td>
                                  <td className="px-2 py-1.5">
                                    <button onClick={() => {
                                      if (variantCount === 1) { alert(`Cannot delete the last variant of "${p.name}". Delete the whole flower instead.`); return; }
                                      if (window.confirm(`Delete variant "${v.name}"?`)) {
                                        setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => {
                                          if (x.id !== p.id) return x;
                                          const newVariants = (x.colorVariants || []).filter((cv) => cv.variantId !== v.variantId);
                                          return { ...x, colorVariants: newVariants, currentPrice: recalcParentLowest(newVariants) };
                                        }) }));
                                      }
                                    }} className="text-red-300 hover:text-red-500">×</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <button onClick={() => {
                          const newVId = "V" + Date.now();
                          setSettings((s) => ({ ...s, mandiCatalogue: s.mandiCatalogue.map((x) => x.id === p.id ? { ...x, colorVariants: [...(x.colorVariants || []), { variantId: newVId, name: p.name + " New", photoUrl: null, currentPrice: 0, priceHistory: [] }] } : x) }));
                        }} className="mt-2 text-xs px-3 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded border border-indigo-200">+ Add Variant</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {(activePanel === "patterns") && <Placeholder name="🌺 Recipes" note="Studio-gated — pattern names come from the Studio Rate Card; builds out once Studio exists" />}
      {(activePanel === "trussbatta") && <Placeholder name="🏗️ Truss & Batta Config" note="Truss slice" />}
      {(activePanel === "fabricstock") && <Placeholder name="🧵 Fabric Stock" note="Fabric slice" />}

      {/* ── Supervisors ── */}
      {activePanel === "supervisors" && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="font-semibold text-gray-800">Supervisor Roster</h4>
            <button onClick={addSupervisor} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm">+ Add Supervisor</button>
          </div>
          {supervisors.map((s) => (
            <div key={s.id} className="flex items-center gap-3 bg-white border rounded-xl px-4 py-3">
              <input value={s.name} onChange={(e) => updateSupervisor(s.id, "name", e.target.value)} className="flex-1 border rounded-lg px-3 py-1.5 text-sm font-medium" />
              <input value={s.phone} onChange={(e) => updateSupervisor(s.id, "phone", e.target.value)} placeholder="Phone" className="w-40 border rounded-lg px-3 py-1.5 text-sm" />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={s.active} onChange={(e) => updateSupervisor(s.id, "active", e.target.checked)} />
                Active
              </label>
              <button onClick={() => removeSupervisor(s.id)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
            </div>
          ))}
          {supervisors.length === 0 && <p className="text-sm text-gray-400 italic text-center py-4">No supervisors yet. Add one above.</p>}
        </div>
      )}

      {/* ── Sub-Categories Viewer (read-only mirror of Studio Rate Card) ── */}
      {activePanel === "subcats" && (
        <div className="space-y-4">
          <div className="bg-white border rounded-2xl p-5">
            <p className="font-bold text-gray-900 mb-1">📂 Inventory Sub-Categories</p>
            <p className="text-xs text-gray-500 mb-4">Read-only mirror of the Studio Rate Card. Used for inventory filtering, Add / Edit dropdowns, AI matching, and labour-tier batches.</p>
            <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex items-start gap-2">
              <span className="text-lg leading-none mt-0.5">🔗</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-indigo-800">Source: Studio Rate Card</p>
                <p className="text-xs text-indigo-700 mt-0.5">
                  Sub-categories are managed in the Studio app's Rate Card. Changes there flow here automatically on next refresh.
                  {studio?.error && <span className="block mt-1 text-amber-700">⚠ {studio.error}</span>}
                </p>
              </div>
            </div>
            {studioLoading && studioSubcats.length === 0 && (
              <div className="text-center py-8 text-sm text-gray-400">Loading sub-categories from Studio…</div>
            )}
            {studioSubcats.length > 0 && (
              <div className="space-y-3">
                {(studio?.catLabels || []).map((catLabel) => {
                  const subs = (studio?.subcatsByCat || {})[catLabel] || [];
                  if (subs.length === 0) return null;
                  return (
                    <div key={catLabel} className="border rounded-xl overflow-hidden">
                      <div className="bg-indigo-50 px-4 py-2 border-b border-indigo-100 flex items-center justify-between">
                        <p className="text-sm font-bold text-indigo-800">{catLabel}</p>
                        <span className="text-xs text-indigo-600">{subs.length}</span>
                      </div>
                      <div className="p-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1">
                        {subs.map((sc) => (
                          <div key={sc} className="flex items-center gap-2 bg-white border rounded-lg px-2.5 py-1.5 text-sm text-gray-700">
                            <span className="text-gray-300 text-xs">▪</span>
                            <span className="flex-1 truncate" title={sc}>{sc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-gray-400 text-right">{studioSubcats.length} sub-categories across {(studio?.catLabels || []).filter((l) => (studio?.subcatsByCat || {})[l]?.length > 0).length} categories</p>
              </div>
            )}
            {!studioLoading && studioSubcats.length === 0 && (
              <div className="text-center py-8 text-sm text-gray-400 border border-dashed rounded-xl">
                No sub-categories returned from Studio. Check Studio Rate Card has items configured.
              </div>
            )}
            <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
              💡 Need a new sub-category? Add the relevant item in the Studio Rate Card. It will appear here automatically.
            </div>
          </div>
        </div>
      )}

      {/* ── Synonym Dictionary ── */}
      {activePanel === "synonyms" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-900 mb-1">🔤 AI Synonym Dictionary</p>
              <p className="text-xs text-gray-500">Words in each group are treated as identical during AI inventory matching. Handles Hindi-English mix, abbreviations, and alternate names.</p>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Add synonym group (comma-separated words)</label>
              <input value={synNewWords} onChange={(e) => setSynNewWords(e.target.value)} placeholder="e.g. Flower, Floral, Phool"
                className="w-full border rounded-lg px-3 py-2 text-sm" onKeyDown={(e) => {
                  if (e.key === "Enter" && synNewWords.trim()) {
                    const words = synNewWords.split(",").map((w) => w.trim()).filter(Boolean);
                    if (words.length < 2) { alert("Need at least 2 words in a synonym group"); return; }
                    const id = "SYN" + Date.now();
                    setSettings((s) => ({ ...s, synonymDictionary: [...(s.synonymDictionary || []), { id, words }] }));
                    setSynNewWords("");
                  }
                }} />
            </div>
            <button onClick={() => {
              const words = synNewWords.split(",").map((w) => w.trim()).filter(Boolean);
              if (words.length < 2) { alert("Need at least 2 words in a synonym group"); return; }
              const id = "SYN" + Date.now();
              setSettings((s) => ({ ...s, synonymDictionary: [...(s.synonymDictionary || []), { id, words }] }));
              setSynNewWords("");
            }} className="bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-lg font-medium whitespace-nowrap">+ Add Group</button>
          </div>
          <div className="space-y-2">
            {(settings.synonymDictionary || []).map((group, gi) => (
              <div key={group.id} className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2 group">
                <span className="text-xs text-gray-400 w-6 flex-shrink-0">#{gi + 1}</span>
                <div className="flex-1 flex flex-wrap gap-1.5">
                  {group.words.map((w, wi) => (
                    <span key={wi} className="inline-flex items-center gap-1 bg-violet-100 text-violet-800 text-xs px-2 py-1 rounded-full">
                      {w}
                      <button onClick={() => {
                        if (group.words.length <= 2) { alert("Synonym group must have at least 2 words. Delete the group instead."); return; }
                        setSettings((s) => ({ ...s, synonymDictionary: s.synonymDictionary.map((g) => g.id === group.id ? { ...g, words: g.words.filter((_, i) => i !== wi) } : g) }));
                      }} className="text-violet-400 hover:text-red-500 text-xs leading-none">×</button>
                    </span>
                  ))}
                  <input placeholder="+ word" className="text-xs border border-dashed border-violet-200 rounded-full px-2 py-1 w-20 focus:w-32 transition-all focus:border-violet-400 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target.value.trim()) {
                        const nw = e.target.value.trim();
                        setSettings((s) => ({ ...s, synonymDictionary: s.synonymDictionary.map((g) => g.id === group.id ? { ...g, words: [...g.words, nw] } : g) }));
                        e.target.value = "";
                      }
                    }} />
                </div>
                <button onClick={() => setSettings((s) => ({ ...s, synonymDictionary: s.synonymDictionary.filter((g) => g.id !== group.id) }))}
                  className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm">🗑</button>
              </div>
            ))}
            {(settings.synonymDictionary || []).length === 0 && <p className="text-sm text-gray-400 italic text-center py-4">No synonym groups yet. Add one above.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

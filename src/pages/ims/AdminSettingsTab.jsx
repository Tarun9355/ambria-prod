import { useState } from "react";
import { Tabs, AddInlineItem, FlowerPicker, Btn } from "../../components/ui";
import { compressImageForCloudinary, IMS_CLD_PRESET, IMS_CLD_UPLOAD_URL } from "../../lib/cloudinary";
import { resolveMandiFlower, computePatternSizeCost, effectiveMarkup, studioUnitLabel } from "../../lib/ims/flowerHelpers";
import { MANPOWER_TYPES, SIT_MULT_DEFAULTS, SIT_MULT_TYPES, DUMPING_LEVELS, EVENT_TIMINGS, eventTimingMultFor } from "../../lib/ims/constants";
import DihariTimingsPanel from "./DihariTimingsPanel.jsx";
import FixedVenuesEditor from "./FixedVenuesEditor.jsx";
import RateCardPanel from "./RateCardPanel.jsx";

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

export default function AdminSettingsTab({ settings, setSettings, supervisors, setSupervisors, studio, mode, syncRecipeRatesToStudio, tier15LastSync, tier15Syncing, trussInv, setTrussInv, inventory = [], rateCardCategories = [], onUpdateSubcatFactor, onUpdateSubcatCostPercent, onAddSubcat, onRenameSubcat, onUpdateSubcatCategory, onSyncSubcatsFromInventory, onDeleteSubcat, rcItems = [], rcCats = [], onSaveRateCardItems, onSaveRateCardCats }) {
  const studioSubcats = studio?.subcats || [];
  const studioLoading = !!studio?.loading;
  const [subcatSearch, setSubcatSearch] = useState("");
  const [subcatFactorEdits, setSubcatFactorEdits] = useState({});
  const [subcatCostPctEdits, setSubcatCostPctEdits] = useState({});
  const [subcatLabelEdits, setSubcatLabelEdits] = useState({});
  const [subcatActiveCat, setSubcatActiveCat] = useState("");
  const [subcatAddOpen, setSubcatAddOpen] = useState(false);
  const [subcatAddVal, setSubcatAddVal] = useState("");
  const [subcatSyncing, setSubcatSyncing] = useState(false);
  // Sub-category pairs that look like the same real-world category under different names on
  // either side of the Studio/IMS split — flagged for manual review, never auto-merged.
  const SUBCAT_NEAR_DUPES = {
    "glass panel 2d": ["3d glass panel"], "3d glass panel": ["glass panel 2d"],
    "3d candle walls": ["candle walls", "candle walls 2d"], "candle walls": ["3d candle walls"], "candle walls 2d": ["3d candle walls"],
    "takhat": ["table takhat"], "table takhat": ["takhat"],
  };
  // All venues (for the Venue Dumping tab) — from the Studio venue catalogue (synced as
  // venueParents) + any legacy venueMinLabour / venueDumping keys.
  const venueParentsObj = (() => { let p = settings?.venueParents; if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = {}; } } return p || {}; })();
  const venueDumpingList = [...new Set([
    ...Object.keys(venueParentsObj),
    ...Object.keys(settings?.venueMinLabour || {}),
    ...Object.keys(settings?.venueDumping || {}),
  ])].sort((a, b) => a.localeCompare(b));
  const [synNewWords, setSynNewWords] = useState("");
  const [newVenueInput, setNewVenueInput] = useState("");
  const addVenueMin = () => {
    const name = newVenueInput.trim();
    if (!name) return;
    setSettings((s) => ({ ...s, venueMinLabour: { ...(s.venueMinLabour || {}), [name]: { min: 4, dumpingLevel: "nearby" } } }));
    setNewVenueInput("");
  };
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
    { id: "venuemin", label: "🏛️ Fixed Venues" },
    { id: "venuedumping", label: "🚛 Venue Dumping" },
    { id: "dihari", label: "💰 Dihari Timings" },
    { id: "supervisors", label: "👷 Supervisors" },
    { id: "ratecard", label: "💰 Rate Card" },
    { id: "subcats", label: "📂 Sub-Categories" },
    { id: "synonyms", label: "🔤 AI Synonyms" },
  ];

  function addSupervisor() {
    const id = "S" + String(supervisors.length + 1).padStart(3, "0");
    setSupervisors([...supervisors, { id, name: "New Supervisor", phone: "", active: true }]);
  }
  function updateSupervisor(id, field, val) { setSupervisors((prev) => prev.map((s) => s.id === id ? { ...s, [field]: val } : s)); }
  function commitSubcatFactor(id) {
    const raw = subcatFactorEdits[id];
    if (raw === undefined) return;
    const val = Math.max(0, parseFloat(raw) || 1.0);
    onUpdateSubcatFactor?.(id, val);
    setSubcatFactorEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }
  function commitSubcatCostPct(id) {
    const raw = subcatCostPctEdits[id];
    if (raw === undefined) return;
    const val = Math.max(0, parseFloat(raw) || 0);
    onUpdateSubcatCostPercent?.(id, val);
    setSubcatCostPctEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }
  function commitSubcatLabel(id, currentLabel) {
    const raw = subcatLabelEdits[id];
    setSubcatLabelEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
    if (raw === undefined) return;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === currentLabel) return;
    onRenameSubcat?.(id, trimmed);
  }
  function addNewSubcat(label, categoryLabel) {
    const trimmed = (label || "").trim();
    if (!trimmed) return;
    if (rateCardCategories.some((r) => r.id === trimmed.toLowerCase())) { alert(`"${trimmed}" already exists.`); return; }
    onAddSubcat?.(trimmed, categoryLabel);
  }
  function deleteSubcatRow(r) {
    const n = inventory.filter((it) => String(it.subCat ?? it.subcategory ?? "").trim().toLowerCase() === r.id).length;
    if (n > 0) { alert(`Cannot delete "${r.label}" — ${n} inventory item(s) still use this sub-category.\n\nMove them to another sub-category first: Inventory tab → 🔀 Move Sub-Category.`); return; }
    if (!window.confirm(`Delete sub-category "${r.label}"? This cannot be undone.`)) return;
    onDeleteSubcat?.(r.id);
  }
  async function syncMissingSubcats(missing) {
    if (!missing?.length || subcatSyncing) return;
    setSubcatSyncing(true);
    try { await onSyncSubcatsFromInventory?.(missing); } finally { setSubcatSyncing(false); }
  }
  function removeSupervisor(id) {
    const sup = supervisors.find((s) => s.id === id);
    if (!window.confirm(`Delete supervisor "${sup?.name || "this supervisor"}"?\n\nThis cannot be undone.`)) return;
    setSupervisors((prev) => prev.filter((s) => s.id !== id), [id]);
  }

  return (
    <div className="space-y-4">
      {!forcedMode && <Tabs tabs={panels} active={panel} onChange={setPanel} />}

      {activePanel === "labourtiers" && (
        <div className="space-y-4">
          <div className="bg-white border rounded-2xl p-5">
            <p className="font-bold text-gray-900 mb-1">👷 Labour Tier Configuration</p>
            <p className="text-xs text-gray-500 mb-4">Assign each manpower type to a planning tier. Tier 2 types have configurable minimum and scaling rules.</p>
            <div className="space-y-2">
              {MANPOWER_TYPES.filter((t) => t !== "Drivers").map((type) => {
                const cfg = (settings.labourTiers || {})[type] || { tier: 1 };
                return (
                  <div key={type} className="bg-gray-50 border rounded-xl p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-gray-800 text-sm w-32">{type}</span>
                      <select value={cfg.tier} onChange={(e) => { const val = e.target.value; const tier = (val === "fixed" || val === "pillar-range" || val === "sqft-range") ? val : parseInt(val); setSettings((s) => ({ ...s, labourTiers: { ...s.labourTiers, [type]: { ...cfg, tier } } })); }} className="border rounded-lg px-2 py-1.5 text-xs bg-white w-44">
                        <option value={1}>⚡ Tier 1 — Element-driven</option>
                        <option value={2}>📊 Tier 2 — Min + Scaling</option>
                        <option value={3}>🏢 Tier 3 — Venue + Event</option>
                        <option value={4}>🤖 Tier 4 — AI + Past Ref</option>
                        <option value="pillar-range">🔩 Pillar-Range (Truss)</option>
                        <option value="sqft-range">📐 SqFt-Range (Fabric)</option>
                        <option value="fixed">📌 Fixed</option>
                      </select>
                      {cfg.tier === 2 && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">Min:</span>
                          <input type="number" min="1" max="20" value={cfg.minimum || 1} onChange={(e) => setSettings((s) => ({ ...s, labourTiers: { ...s.labourTiers, [type]: { ...cfg, minimum: parseInt(e.target.value) || 1 } } }))} className="w-14 border rounded px-2 py-1 text-xs" />
                        </div>
                      )}
                      <div className="flex items-center gap-1 ml-auto">
                        <span className="text-xs text-gray-500">Dismantle:</span>
                        <input type="number" min="0" max="100" value={cfg.dismantlingPct ?? ""} onChange={(e) => setSettings((s) => ({ ...s, labourTiers: { ...s.labourTiers, [type]: { ...cfg, dismantlingPct: parseInt(e.target.value) || 0 } } }))} placeholder="—" className="w-14 border rounded px-2 py-1 text-xs text-center" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    </div>
                    {cfg.tier === 2 && type !== "Labours" && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-500 mb-1.5">Sub-Categories & Batch Size <span className="text-gray-400">(click to add, set how many elements 1 worker handles)</span>:</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {Object.entries(cfg.subCatBatches || {}).map(([sc, batch]) => (
                            <div key={sc} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
                              <span className="text-xs text-indigo-700 font-medium">{sc}</span>
                              <span className="text-xs text-gray-400">→ 1:</span>
                              <input type="number" min="1" max="50" value={batch} onChange={(e) => { const nb = { ...(cfg.subCatBatches || {}), [sc]: parseInt(e.target.value) || 1 }; setSettings((s) => ({ ...s, labourTiers: { ...s.labourTiers, [type]: { ...cfg, subCatBatches: nb } } })); }} className="w-10 border rounded px-1 py-0.5 text-xs text-center" />
                              <button onClick={() => { const nb = { ...(cfg.subCatBatches || {}) }; delete nb[sc]; setSettings((s) => ({ ...s, labourTiers: { ...s.labourTiers, [type]: { ...cfg, subCatBatches: nb } } })); }} className="text-red-400 hover:text-red-600 text-xs ml-0.5">×</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {studioSubcats.filter((sc) => !(cfg.subCatBatches || {})[sc]).map((sc) => (
                            <button key={sc} onClick={() => { const nb = { ...(cfg.subCatBatches || {}), [sc]: 3 }; setSettings((s) => ({ ...s, labourTiers: { ...s.labourTiers, [type]: { ...cfg, subCatBatches: nb } } })); }} className="text-xs px-2 py-0.5 rounded-full border bg-white border-gray-200 text-gray-500 hover:border-indigo-200 hover:text-indigo-600 transition-all">+ {sc}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {type === "Labours" && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <p className="text-xs text-gray-500 mb-1.5">🏗️ Heavy Element Add-ons <span className="text-gray-400">(1 labour per N units of each sub-category — drives the headcount AND routes each sub-category's labour to its department. Summed across elements, rounded up once.)</span>:</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(settings.heavyElementRanges || []).map((her, hi) => {
                            const per = her.perCount ?? 10;
                            const upd = (patch) => { const ranges = [...(settings.heavyElementRanges || [])]; const cur = { ...ranges[hi], ...patch }; delete cur.ranges; delete cur.freeUpTo; ranges[hi] = cur; setSettings((s) => ({ ...s, heavyElementRanges: ranges })); };
                            return (
                              <div key={hi} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
                                <span className="text-xs text-indigo-700 font-medium">{her.subCat || "(pick)"}</span>
                                <span className="text-xs text-gray-400">→ 1:</span>
                                <input type="number" min="1" value={per} onChange={(e) => upd({ perCount: parseInt(e.target.value) || 0 })} className="w-10 border rounded px-1 py-0.5 text-xs text-center" />
                                <button onClick={() => setSettings((s) => ({ ...s, heavyElementRanges: (s.heavyElementRanges || []).filter((_, j) => j !== hi) }))} className="text-red-400 hover:text-red-600 text-xs ml-0.5">×</button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {studioSubcats.filter((sc) => !(settings.heavyElementRanges || []).some((h) => h.subCat === sc)).map((sc) => (
                            <button key={sc} onClick={() => setSettings((s) => ({ ...s, heavyElementRanges: [...(s.heavyElementRanges || []), { subCat: sc, perCount: 10 }] }))} className="text-xs px-2 py-0.5 rounded-full border bg-white border-gray-200 text-gray-500 hover:border-indigo-200 hover:text-indigo-600 transition-all">+ {sc}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Truss Labour — Pillar Range Table (nested under its own row) */}
                    {type === "Truss Labour" && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs text-gray-500">🔩 Pillar Range Table <span className="text-gray-400">(truss labours by total pillar count — set in the Manpower tab)</span></p>
                          <button onClick={() => { const ranges = [...(settings.trussLabourRanges || [])]; const lastUpTo = ranges.length > 0 ? ranges[ranges.length - 1].upTo : 0; ranges.push({ upTo: lastUpTo + 20, labour: (ranges[ranges.length - 1]?.labour || 6) + 2, label: "+20 pillars" }); setSettings((s) => ({ ...s, trussLabourRanges: ranges })); }} className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-2.5 py-1 rounded-lg font-medium">+ Add Range</button>
                        </div>
                        <div className="bg-white rounded-lg border border-teal-200 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-teal-100 text-xs text-teal-700"><tr><th className="px-3 py-2 text-left font-medium">Pillar Range</th><th className="px-3 py-2 text-center font-medium">Up To</th><th className="px-3 py-2 text-center font-medium">Truss Labour</th><th className="px-3 py-2 text-center font-medium w-12"></th></tr></thead>
                            <tbody>
                              {(settings.trussLabourRanges || []).map((r, i) => {
                                const prevMax = i > 0 ? (settings.trussLabourRanges[i - 1].upTo + 1) : 1;
                                return (
                                  <tr key={i} className="border-t border-teal-100">
                                    <td className="px-3 py-2 text-gray-600 text-xs">{prevMax} – {r.upTo > 9000 ? "∞" : r.upTo} pillars</td>
                                    <td className="px-3 py-2 text-center"><input type="number" min={i > 0 ? settings.trussLabourRanges[i - 1].upTo + 1 : 1} value={r.upTo > 9000 ? "" : r.upTo} placeholder="∞" onChange={(e) => { const ranges = [...(settings.trussLabourRanges || [])]; ranges[i] = { ...ranges[i], upTo: parseInt(e.target.value) || 9999 }; setSettings((s) => ({ ...s, trussLabourRanges: ranges })); }} className="w-20 border border-teal-200 rounded px-2 py-1 text-xs text-center" /></td>
                                    <td className="px-3 py-2 text-center"><input type="number" min="1" value={r.labour} onChange={(e) => { const ranges = [...(settings.trussLabourRanges || [])]; ranges[i] = { ...ranges[i], labour: parseInt(e.target.value) || 1 }; setSettings((s) => ({ ...s, trussLabourRanges: ranges })); }} className="w-16 border border-teal-200 rounded px-2 py-1 text-xs text-center font-bold" /></td>
                                    <td className="px-3 py-2 text-center">{(settings.trussLabourRanges || []).length > 1 && (<button onClick={() => { const ranges = (settings.trussLabourRanges || []).filter((_, j) => j !== i); setSettings((s) => ({ ...s, trussLabourRanges: ranges })); }} className="text-red-400 hover:text-red-600 text-xs">✕</button>)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Fabric Bangali — SqFt Range Table + RFT (nested under its own row) */}
                    {type === "Fabric Bangali" && (
                      <div className="mt-2 pt-2 border-t border-gray-200 space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs text-gray-500">📐 Box Truss SqFt Range Table <span className="text-gray-400">(sqft = L × W; height doesn't change fabric labour)</span></p>
                            <button onClick={() => { const ranges = [...(settings.fabricBangaliRanges || [])]; const lastUpTo = ranges.length > 0 ? ranges[ranges.length - 1].upTo : 0; ranges.push({ upTo: lastUpTo + 1000, labour: (ranges[ranges.length - 1]?.labour || 3) + 4, label: "" }); setSettings((s) => ({ ...s, fabricBangaliRanges: ranges })); }} className="text-xs bg-orange-600 hover:bg-orange-700 text-white px-2.5 py-1 rounded-lg font-medium">+ Add Range</button>
                          </div>
                          <div className="bg-white rounded-lg border border-orange-200 overflow-hidden">
                            <table className="w-full text-sm">
                              <thead className="bg-orange-100 text-xs text-orange-700"><tr><th className="px-3 py-2 text-left font-medium">SqFt Range</th><th className="px-3 py-2 text-center font-medium">Up To</th><th className="px-3 py-2 text-center font-medium">Fabric Bangali</th><th className="px-3 py-2 text-left font-medium">Example</th><th className="px-3 py-2 text-center font-medium w-12"></th></tr></thead>
                              <tbody>
                                {(settings.fabricBangaliRanges || []).map((r, i) => {
                                  const prevMax = i > 0 ? (settings.fabricBangaliRanges[i - 1].upTo + 1) : 1;
                                  const side = Math.round(Math.sqrt(r.upTo > 9000 ? 5000 : r.upTo));
                                  return (
                                    <tr key={i} className="border-t border-orange-100">
                                      <td className="px-3 py-2 text-gray-600 text-xs">{prevMax} – {r.upTo > 9000 ? "∞" : r.upTo} sqft</td>
                                      <td className="px-3 py-2 text-center"><input type="number" min={i > 0 ? settings.fabricBangaliRanges[i - 1].upTo + 1 : 1} value={r.upTo > 9000 ? "" : r.upTo} placeholder="∞" onChange={(e) => { const ranges = [...(settings.fabricBangaliRanges || [])]; ranges[i] = { ...ranges[i], upTo: parseInt(e.target.value) || 9999 }; setSettings((s) => ({ ...s, fabricBangaliRanges: ranges })); }} className="w-20 border border-orange-200 rounded px-2 py-1 text-xs text-center" /></td>
                                      <td className="px-3 py-2 text-center"><input type="number" min="1" value={r.labour} onChange={(e) => { const ranges = [...(settings.fabricBangaliRanges || [])]; ranges[i] = { ...ranges[i], labour: parseInt(e.target.value) || 1 }; setSettings((s) => ({ ...s, fabricBangaliRanges: ranges })); }} className="w-16 border border-orange-200 rounded px-2 py-1 text-xs text-center font-bold" /></td>
                                      <td className="px-3 py-2 text-xs text-gray-400 italic">~{side}×{side}ft</td>
                                      <td className="px-3 py-2 text-center">{(settings.fabricBangaliRanges || []).length > 1 && (<button onClick={() => { const ranges = (settings.fabricBangaliRanges || []).filter((_, j) => j !== i); setSettings((s) => ({ ...s, fabricBangaliRanges: ranges })); }} className="text-red-400 hover:text-red-600 text-xs">✕</button>)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-gray-600">📏 Side walls: 1 Fabric Bangali per</span>
                          <input type="number" min="10" max="500" value={settings.fabricRftPerWorker || 100} onChange={(e) => setSettings((s) => ({ ...s, fabricRftPerWorker: parseInt(e.target.value) || 100 }))} className="w-16 border border-orange-300 rounded px-2 py-1 text-xs font-bold text-orange-700 text-center" />
                          <span className="text-gray-600">RFT</span>
                          <span className="text-gray-300 mx-1">|</span>
                          <span className="text-gray-600">Half Box back depth</span>
                          <input type="number" min="1" max="20" value={settings.fabricBackDepthFt || 4} onChange={(e) => setSettings((s) => ({ ...s, fabricBackDepthFt: parseInt(e.target.value) || 4 }))} className="w-14 border border-orange-300 rounded px-2 py-1 text-xs font-bold text-orange-700 text-center" />
                          <span className="text-gray-600">ft</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Carpet Fresh Markup */}
            <div className="mt-4 bg-rose-50 border border-rose-100 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-rose-800">🟥 Carpet Fresh Markup</p>
              <p className="text-xs text-rose-600">When a deal needs more carpet than is owned, the shortfall is bought fresh. Only a % of the fresh purchase price is charged to the event.</p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-700">Charge</span>
                <input type="number" min="0" max="200" value={settings.carpetFreshMarkup ?? 40} onChange={(e) => setSettings((s) => ({ ...s, carpetFreshMarkup: parseFloat(e.target.value) || 0 }))} className="w-20 border border-rose-300 rounded-lg px-3 py-2 text-sm font-bold text-rose-700 text-center" />
                <span className="text-sm text-gray-700">% of fresh carpet purchase price</span>
              </div>
            </div>

            {/* Situational Multipliers */}
            <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-amber-800">⚡ Situational Multipliers</p>
                  <p className="text-xs text-amber-600 mt-0.5">Universal pressure factors applied on top of tier base counts.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Combined Cap:</span>
                  <input type="number" step="0.1" min="1.5" max="2.5" value={settings.situationalMultiplierCap || 1.8} onChange={(e) => setSettings((s) => ({ ...s, situationalMultiplierCap: parseFloat(e.target.value) || 1.8 }))} className="w-16 border border-amber-300 rounded px-2 py-1 text-xs text-center font-bold" />
                  <span className="text-xs text-gray-400">×</span>
                </div>
              </div>
              {[
                { key: "heavySaya", label: "🔴 Heavy Saya", desc: "Date is marked Heavy Saya — competition for workers" },
                { key: "premium", label: "★ Premium Segment", desc: "Outdoor Premium events need higher quality/speed" },
                { key: "dayPrior", label: "📅 Day-Prior Setup", desc: "Extra time available — can REDUCE workers needed" },
                { key: "rush", label: "⚡ Rush / Last-Minute", desc: "Booking within " + ((settings.datePricing || {}).lastMinuteDays || 10) + " days — scramble premium" },
              ].map((factor) => {
                const vals = (settings.situationalMultipliers || {})[factor.key] || SIT_MULT_DEFAULTS[factor.key] || {};
                const defaults = SIT_MULT_DEFAULTS[factor.key] || {};
                return (
                  <div key={factor.key} className="bg-white border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div><span className="text-xs font-bold text-gray-800">{factor.label}</span><span className="text-xs text-gray-400 ml-2">{factor.desc}</span></div>
                      <button onClick={() => setSettings((s) => ({ ...s, situationalMultipliers: { ...s.situationalMultipliers, [factor.key]: { ...defaults } } }))} className="text-xs text-amber-600 hover:text-amber-800">↩ Reset defaults</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {MANPOWER_TYPES.filter((t) => t !== "Drivers" && t !== "Supervisors").map((type) => {
                        const val = vals[type] || defaults[type] || 1.0;
                        const isDefault = val === (defaults[type] || 1.0);
                        const isReduction = val < 1;
                        return (
                          <div key={type} className={"flex items-center gap-1 border rounded-lg px-2 py-1 " + (isReduction ? "bg-green-50 border-green-200" : val > 1 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200")}>
                            <span className="text-xs text-gray-700 w-20 truncate" title={type}>{type}</span>
                            <input type="number" step="0.05" min="0.5" max="2.0" value={val} onChange={(e) => { const v = parseFloat(e.target.value) || 1.0; setSettings((s) => ({ ...s, situationalMultipliers: { ...s.situationalMultipliers, [factor.key]: { ...(s.situationalMultipliers || {})[factor.key], [type]: v } } })); }} className={"w-14 border rounded px-1.5 py-0.5 text-xs text-center font-bold " + (isReduction ? "border-green-300 text-green-700" : val > 1 ? "border-amber-300 text-amber-700" : "border-gray-200 text-gray-500")} />
                            {!isDefault && <span className="text-xs text-amber-500">•</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Event Timing — now PER-TYPE (like Heavy Saya). Earlier events = tighter setup window;
                  each manpower type can carry its own ratio (e.g. Painters tighter than Flowerists at brunch). */}
              <div className="bg-white border border-amber-200 rounded-lg p-3">
                <div className="mb-2"><span className="text-xs font-bold text-gray-800">⏰ Event Timing</span><span className="text-xs text-gray-400 ml-2">Earlier events have a tighter setup window. Each timing carries a per-type ratio, just like Heavy Saya. Dinner & late-night stay at ×1.0.</span></div>
                <div className="space-y-2">
                  {EVENT_TIMINGS.filter((t) => t.id !== "dinner" && t.id !== "latenight").map((t) => (
                    <div key={t.id} className="border border-amber-100 rounded-lg p-2.5 bg-amber-50/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <div><span className="text-xs font-bold text-gray-800">{t.label}</span><span className="text-xs text-gray-400 ml-2">setup window {t.setupWindow}</span></div>
                        <button onClick={() => setSettings((s) => ({ ...s, eventTimingMultipliers: { ...s.eventTimingMultipliers, [t.id]: Object.fromEntries(SIT_MULT_TYPES.map((ty) => [ty, t.mult])) } }))} className="text-xs text-amber-600 hover:text-amber-800">↩ Reset all to ×{t.mult}</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {SIT_MULT_TYPES.map((type) => {
                          const val = eventTimingMultFor(settings.eventTimingMultipliers, t.id, type, t.mult);
                          const isReduction = val < 1;
                          return (
                            <div key={type} className={"flex items-center gap-1 border rounded-lg px-2 py-1 " + (isReduction ? "bg-green-50 border-green-200" : val > 1 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200")}>
                              <span className="text-xs text-gray-700 w-20 truncate" title={type}>{type}</span>
                              <input type="number" step="0.05" min="0.5" max="2.0" value={val} onChange={(e) => {
                                const v = parseFloat(e.target.value) || 1.0;
                                setSettings((s) => {
                                  // Seed the full per-type map from current effective values so editing one type
                                  // never drops the others (legacy single-scalar expands cleanly too).
                                  const cur = Object.fromEntries(SIT_MULT_TYPES.map((ty) => [ty, eventTimingMultFor(s.eventTimingMultipliers, t.id, ty, t.mult)]));
                                  cur[type] = v;
                                  return { ...s, eventTimingMultipliers: { ...s.eventTimingMultipliers, [t.id]: cur } };
                                });
                              }} className={"w-14 border rounded px-1.5 py-0.5 text-xs text-center font-bold " + (isReduction ? "border-green-300 text-green-700" : val > 1 ? "border-amber-300 text-amber-700" : "border-gray-200 text-gray-500")} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {activePanel === "venuemin" && (
        <div className="space-y-4">
          <FixedVenuesEditor settings={settings} setSettings={setSettings} inventory={inventory} trussInv={trussInv} />
        </div>
      )}
      {activePanel === "venuedumping" && (
        <div className="bg-white border rounded-2xl p-5">
          <p className="font-bold text-gray-900 mb-1">🚛 Venue Dumping</p>
          <p className="text-xs text-gray-500 mb-4">Dumping-point distance per venue → labour multiplier. All venues are listed automatically; unset venues default to Nearby (×1.0).</p>
          <div className="space-y-2">
            {venueDumpingList.map((venue) => {
              const level = (settings.venueDumping || {})[venue] || "nearby";
              return (
                <div key={venue} className="flex items-center gap-3 bg-gray-50 border rounded-lg px-3 py-2.5 flex-wrap">
                  <span className="flex-1 text-sm font-medium text-gray-800 min-w-[140px]">{venue}</span>
                  <span className="text-xs text-gray-500">🚛 Dump:</span>
                  <select value={level} onChange={(e) => setSettings((s) => ({ ...s, venueDumping: { ...(s.venueDumping || {}), [venue]: e.target.value } }))} className="border rounded px-2 py-1.5 text-xs bg-white">
                    {DUMPING_LEVELS.map((d) => <option key={d.id} value={d.id}>{d.label} (×{d.mult})</option>)}
                  </select>
                </div>
              );
            })}
            {venueDumpingList.length === 0 && <div className="text-xs text-gray-400 italic">No venues synced yet — open Studio once to populate the venue list.</div>}
          </div>
        </div>
      )}
      {activePanel === "dihari" && <DihariTimingsPanel settings={settings} setSettings={setSettings} />}
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
      {activePanel === "patterns" && (() => {
        const studioFloralsItems = studio?.floralsItems || [];
        const studioFloralsSubcats = studio?.floralsSubcats || [];
        const studioLoadingFlag = !!studio?.loading;
        const recipeSubs = settings.flowerRecipeSubcats || [];
        const activeStudioItems = studioFloralsItems.filter((i) => recipeSubs.includes((i.sub || "").trim()));
        const groupedBySub = {};
        activeStudioItems.forEach((i) => { const sub = (i.sub || "").trim() || "(uncategorized)"; (groupedBySub[sub] = groupedBySub[sub] || []).push(i); });
        const sortedSubs = Object.keys(groupedBySub).sort((a, b) => a.localeCompare(b));
        const legacyPatterns = (settings.flowerPatterns || []).filter((p) => {
          const norm = (p.name || "").toLowerCase().trim();
          return !studioFloralsItems.some((i) => (i.name || "").toLowerCase().trim() === norm);
        });

        const toggleSub = (sub) => {
          setSettings((s) => { const cur = s.flowerRecipeSubcats || []; const next = cur.includes(sub) ? cur.filter((x) => x !== sub) : [...cur, sub]; return { ...s, flowerRecipeSubcats: next.sort((a, b) => a.localeCompare(b)) }; });
        };
        const mutatePattern = (studioItem, mutator) => {
          setSettings((s) => {
            const norm = (x) => (x || "").toLowerCase().trim();
            const targetName = studioItem.name;
            const existing = (s.flowerPatterns || []).find((p) => norm(p.name) === norm(targetName));
            const m = existing?.mode === "smb" ? "smb" : existing?.mode === "flat" ? "flat" : (studioItem.inhouseMode === "smb" ? "smb" : "flat");
            const sizeKeys = m === "smb" ? ["small", "medium", "big"] : ["medium"];
            const emptyTemplate = sizeKeys.reduce((a, k) => ({ ...a, [k]: { flowers: [], totalPieces: 0 } }), {});
            if (existing) return { ...s, flowerPatterns: s.flowerPatterns.map((p) => (p.id === existing.id ? mutator(p) : p)) };
            const fresh = mutator({ id: "FP" + Date.now() + Math.floor(Math.random() * 1000), name: targetName, mode: m, sub: (studioItem.sub || "").trim(), unit: studioItem.unit || "pc", unitBasis: "per piece", sizes: emptyTemplate });
            return { ...s, flowerPatterns: [...(s.flowerPatterns || []), fresh] };
          });
        };
        const renderSizeColumn = (studioItem, sz, sizeLabel, sizeEmoji) => {
          const pat = (settings.flowerPatterns || []).find((p) => (p.name || "").toLowerCase().trim() === (studioItem.name || "").toLowerCase().trim());
          const sizeData = pat?.sizes?.[sz] || { flowers: [], totalPieces: 0 };
          return (
            <div key={sz} className="p-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">{sizeEmoji} {sizeLabel}</p>
              {sizeData.flowers.map((fl, fi) => {
                const flower = resolveMandiFlower(fl.flowerId, settings.mandiCatalogue)?.parent;
                return (
                  <div key={fi} className="flex items-center gap-1.5 mb-1.5">
                    <FlowerPicker value={fl.flowerId} catalogue={settings.mandiCatalogue || []}
                      onChange={(newId) => mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, flowers: sizeData.flowers.map((x, i) => (i === fi ? { ...x, flowerId: newId } : x)) } } }))} />
                    {(() => {
                      const effGS = flower?.unit === "piece" ? 1 : (Number(flower?.gattharSize) || 0);
                      const isVariable = effGS === 0;
                      const setQty = (newStored) => mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, flowers: sizeData.flowers.map((x, i) => (i === fi ? { ...x, qty: newStored } : x)) } } }));
                      const fmtN = (n) => (n > 0 ? (n % 1 === 0 ? n.toString() : n.toFixed(1)) : "");
                      if (!isVariable) {
                        const pieces = (Number(fl.qty) || 0) * effGS;
                        return (
                          <>
                            <input type="number" min="0" step="1" value={fmtN(pieces)} placeholder="pcs"
                              onChange={(e) => { const p = parseFloat(e.target.value) || 0; setQty(effGS > 0 ? p / effGS : 0); }}
                              className="w-14 border rounded px-1 py-1 text-xs text-center" title={`Stored: ${(Number(fl.qty) || 0).toFixed(3)} ${flower?.unit || ""}`} />
                            <span className="text-[10px] text-gray-400 w-10 truncate" title={effGS > 1 ? `${effGS} pcs/${flower?.unit}` : "per-piece flower"}>pcs</span>
                          </>
                        );
                      }
                      const stored = Number(fl.qty) || 0;
                      const patternsPerUnit = stored > 0 ? (1 / stored) : 0;
                      return (
                        <>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">1 {flower?.unit || "unit"} →</span>
                          <input type="number" min="0" step="1" value={fmtN(patternsPerUnit)} placeholder="N"
                            onChange={(e) => { const n = parseFloat(e.target.value) || 0; setQty(n > 0 ? 1 / n : 0); }}
                            className="w-12 border rounded px-1 py-1 text-xs text-center" title={`Stored: ${stored.toFixed(3)} ${flower?.unit || ""}/pattern`} />
                          <span className="text-[10px] text-gray-400">made</span>
                        </>
                      );
                    })()}
                    <button onClick={() => mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, flowers: sizeData.flowers.filter((_, i) => i !== fi) } } }))}
                      className="text-red-400 hover:text-red-600 text-xs leading-none">×</button>
                  </div>
                );
              })}
              <button onClick={() => mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, flowers: [...sizeData.flowers, { flowerId: "", qty: 0 }] } } }))}
                className="text-xs text-indigo-500 hover:text-indigo-700 border border-dashed border-indigo-200 rounded px-2 py-0.5 w-full mt-1">+ flower</button>
              {/* Flowerist productivity — units one flowerist completes per dihari (8-hr shift)
                  for this size. Drives the Manpower Tier-1 flowerist headcount. */}
              <div className="mt-2">
                <label className="text-[10px] text-gray-500" title="Units one flowerist completes per dihari (8-hr shift) for this size. Used by Planning → Manpower (Tier 1) to compute flowerist headcount from the function's flower orders.">👷 1 flowerist / dihari</label>
                <div className="mt-1 flex items-center gap-1">
                  <input type="number" min="0" step="0.1" value={sizeData.unitsPerFlowerist ?? ""}
                    onChange={(e) => { const v = e.target.value === "" ? undefined : (parseFloat(e.target.value) || 0); mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, unitsPerFlowerist: v } } })); }}
                    placeholder="—"
                    className="flex-1 border rounded px-2 py-1 text-xs font-semibold text-blue-700 text-center" />
                  <span className="text-[9px] text-gray-400 w-12 truncate">{studioUnitLabel(studioItem.unit) || "/unit"}</span>
                </div>
              </div>
              {/* Fixed extra cost (e.g. the pot/base/frame) added ON TOP of the flower cost, AFTER markup:
                  studio rate = flower cost × markup + extra. So a "Flower Pot Big" charges pot + flowers. */}
              <div className="mt-2">
                <label className="text-[10px] text-gray-500" title="Fixed extra cost for this size (pot / base / frame), added after markup: studio rate = flower cost × markup + extra.">➕ Extra cost (pot / base)</label>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-[9px] text-gray-400">₹</span>
                  <input type="number" min="0" value={sizeData.extraCost ?? ""} onChange={(e) => { const v = e.target.value === "" ? undefined : (parseFloat(e.target.value) || 0); mutatePattern(studioItem, (p) => ({ ...p, sizes: { ...p.sizes, [sz]: { ...sizeData, extraCost: v } } })); }} placeholder="0" className="flex-1 border rounded px-2 py-1 text-xs font-semibold text-amber-700 text-center" />
                </div>
              </div>
              {(() => {
                const cost = computePatternSizeCost(sizeData, settings.mandiCatalogue);
                if (cost === null) return <div className="mt-2 border-t border-dashed pt-2 text-[10px] text-gray-400 italic text-center">Empty — no cost</div>;
                const pat = (settings.flowerPatterns || []).find((p) => (p.name || "").toLowerCase().trim() === (studioItem.name || "").toLowerCase().trim());
                const markup = effectiveMarkup(pat, settings);
                const extra = Number(sizeData.extraCost) || 0;
                const studioRate = Math.round(cost * markup) + extra;
                const unitLbl = studioUnitLabel(studioItem.unit);
                return (
                  <div className="mt-2 border-t pt-2 space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]"><span className="text-gray-500">💰 Mandi cost</span><span className="font-semibold text-gray-800">₹{cost.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></div>
                    {extra > 0 && <div className="flex items-center justify-between text-[10px]"><span className="text-amber-700">➕ Extra (pot/base)</span><span className="font-semibold text-amber-700">₹{extra.toLocaleString("en-IN")}</span></div>}
                    <div className="flex items-center justify-between text-[10px]"><span className="text-emerald-700">→ Studio rate</span><span className="font-bold text-emerald-700">₹{studioRate.toLocaleString("en-IN")}<span className="text-[9px] text-emerald-600 font-normal ml-0.5">{unitLbl}</span></span></div>
                    <div className="text-[9px] text-gray-400 text-right italic">{markup}× markup{extra > 0 ? " + ₹" + extra : ""}</div>
                  </div>
                );
              })()}
            </div>
          );
        };
        const fmtSyncTime = (ts) => {
          if (!ts) return "never";
          const diff = Date.now() - ts;
          if (diff < 5000) return "just now";
          if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
          if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
          return new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
        };

        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-800">🌺 Flower Pattern Matrix</h4>
              <p className="text-sm text-gray-500 mt-0.5">Pattern names sourced from Studio Rate Card · Florals. Ops edits the recipe (which flowers + how many) below.</p>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-800 font-semibold">🔒 Admin · Studio markup:</span>
                <input type="number" min="1" step="0.1" value={settings.defaultStudioMarkup ?? 3}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 3; setSettings((s) => ({ ...s, defaultStudioMarkup: v })); }}
                  className="w-16 border border-emerald-300 rounded px-2 py-1 text-xs font-bold text-center text-emerald-900" />
                <span className="text-xs text-emerald-700">×</span>
              </div>
              <div className="flex items-center gap-2 border-l border-emerald-200 pl-3">
                <span className="text-xs text-emerald-800 font-semibold">🌸 Artificial mix:</span>
                <span className="text-xs text-emerald-700">₹</span>
                <input type="number" min="0" step="10" value={settings.artificialMixRatePerKg ?? 0}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 0; setSettings((s) => ({ ...s, artificialMixRatePerKg: v })); }}
                  placeholder="0" className="w-20 border border-emerald-300 rounded px-2 py-1 text-xs font-bold text-center text-emerald-900" />
                <span className="text-xs text-emerald-700">/kg</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[10px] text-emerald-600">Last sync: {fmtSyncTime(tier15LastSync)}</span>
                <button onClick={async () => { if (!syncRecipeRatesToStudio) return; const res = await syncRecipeRatesToStudio({ silent: false }); if (res?.error) alert(`Sync failed: ${res.error}`); else alert(`Synced to Studio: ${res?.updated || 0} updated, ${res?.cleared || 0} unlocked.`); }}
                  disabled={!!tier15Syncing} className={"text-xs px-3 py-1.5 rounded-lg font-semibold " + (tier15Syncing ? "bg-gray-300 text-gray-500" : "bg-emerald-600 hover:bg-emerald-700 text-white")}>
                  {tier15Syncing ? "⏳ Syncing…" : "📤 Sync to Studio"}
                </button>
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-indigo-800 mb-2">Recipe-driven sub-categories <span className="font-normal text-indigo-600">— tick the Florals subs whose items use flower recipes for costing</span></p>
              {studioLoadingFlag && studioFloralsSubcats.length === 0 && <p className="text-xs text-gray-400 italic">Loading from Studio…</p>}
              {!studioLoadingFlag && studioFloralsSubcats.length === 0 && <p className="text-xs text-amber-600">No Florals sub-categories found in Studio Rate Card.</p>}
              {studioFloralsSubcats.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {studioFloralsSubcats.map((sub) => {
                    const on = recipeSubs.includes(sub);
                    const count = studioFloralsItems.filter((i) => (i.sub || "").trim() === sub).length;
                    return (
                      <button key={sub} onClick={() => toggleSub(sub)} className={"text-xs px-2.5 py-1 rounded-full border transition-colors " + (on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:border-indigo-400")}>
                        {on ? "✓ " : ""}{sub} <span className={on ? "opacity-80" : "text-gray-400"}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {!studioLoadingFlag && activeStudioItems.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-sm border border-dashed rounded-xl">No patterns yet — tick a sub-category above to source patterns from Studio.</div>
            )}

            {sortedSubs.map((sub) => (
              <div key={sub} className="space-y-2">
                <div className="flex items-center gap-2 mt-2"><h5 className="text-sm font-semibold text-gray-700">🌸 {sub}</h5><span className="text-xs text-gray-400">({groupedBySub[sub].length})</span></div>
                {groupedBySub[sub].map((studioItem) => {
                  const pat = (settings.flowerPatterns || []).find((p) => (p.name || "").toLowerCase().trim() === (studioItem.name || "").toLowerCase().trim());
                  const m = pat?.mode === "smb" ? "smb" : pat?.mode === "flat" ? "flat" : (studioItem.inhouseMode === "smb" ? "smb" : "flat");
                  const hasRecipe = !!pat && Object.values(pat.sizes || {}).some((sd) => (sd?.flowers || []).length > 0);
                  return (
                    <div key={studioItem.id} className="bg-white border rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b flex-wrap">
                        <span className="text-sm font-semibold text-gray-800">{studioItem.name}</span>
                        <div className="flex rounded-full overflow-hidden border border-gray-300">
                          {["flat", "smb"].map((mm) => (
                            <button key={mm} onClick={() => {
                              if (mm === m) return;
                              if (mm === "flat" && (pat?.sizes?.small?.flowers?.length > 0 || pat?.sizes?.big?.flowers?.length > 0)) {
                                if (!window.confirm("Switching to Flat will drop Small & Big recipes (keeps Medium only). Continue?")) return;
                              }
                              mutatePattern(studioItem, (p) => {
                                const np = { ...p, mode: mm };
                                if (mm === "smb") np.sizes = { ...(p.sizes || {}), small: p.sizes?.small || { flowers: [], totalPieces: 0 }, medium: p.sizes?.medium || { flowers: [], totalPieces: 0 }, big: p.sizes?.big || { flowers: [], totalPieces: 0 } };
                                else np.sizes = { medium: p.sizes?.medium || { flowers: [], totalPieces: 0 } };
                                return np;
                              });
                            }} className={"px-3 py-0.5 text-[10px] font-bold tracking-wide transition-colors " + (m === mm ? (mm === "smb" ? "bg-purple-600 text-white" : "bg-emerald-600 text-white") : "bg-white text-gray-500 hover:bg-gray-100")}>{mm === "flat" ? "FLAT" : "S/M/B"}</button>
                          ))}
                        </div>
                        <span title="Unit sourced from Studio Rate Card" className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-mono cursor-help">{studioUnitLabel(studioItem.unit) || "/pc"}</span>
                        <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                          <span className="text-[9px] text-emerald-800 font-semibold">Markup:</span>
                          <input type="number" min="0" step="0.1" value={pat?.studioMarkup ?? ""}
                            onChange={(e) => { const v = e.target.value === "" ? undefined : (parseFloat(e.target.value) || 0); mutatePattern(studioItem, (p) => { const np = { ...p }; if (v === undefined) delete np.studioMarkup; else np.studioMarkup = v; return np; }); }}
                            placeholder={String(settings.defaultStudioMarkup ?? 3)} className="w-12 border border-emerald-300 rounded px-1 py-0.5 text-[11px] font-bold text-center text-emerald-900" />
                          <span className="text-[9px] text-emerald-700">×</span>
                        </div>
                        {!hasRecipe && <span className="ml-auto text-[10px] text-amber-600 italic">Empty recipe</span>}
                        {hasRecipe && <span className="ml-auto flex items-center gap-1.5"><span className="text-[10px] text-green-600">✓ Recipe set</span></span>}
                      </div>
                      {m === "smb" ? (
                        <div className="grid grid-cols-3 divide-x">
                          {renderSizeColumn(studioItem, "small", "Small", "🔹")}
                          {renderSizeColumn(studioItem, "medium", "Medium", "🔷")}
                          {renderSizeColumn(studioItem, "big", "Big", "🔵")}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1">{renderSizeColumn(studioItem, "medium", "Recipe", "🌼")}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {legacyPatterns.length > 0 && (
              <div className="space-y-2">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-amber-800 mb-1">🟡 Needs Review ({legacyPatterns.length})</p>
                  <p className="text-[11px] text-amber-700">These patterns don't match any Studio Florals item. Map each to a Studio twin (recipe transfers), or delete if obsolete.</p>
                </div>
                {legacyPatterns.map((pat) => (
                  <div key={pat.id} className="bg-amber-50/50 border border-amber-200 rounded-xl p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-semibold text-gray-700">{pat._legacyName || pat.name}</span>
                      <span className="text-[10px] text-gray-500">({Object.values(pat.sizes || {}).reduce((a, sd) => a + (sd?.flowers || []).length, 0)} flower lines)</span>
                      <button onClick={() => { if (!window.confirm(`Delete legacy pattern "${pat._legacyName || pat.name}"?`)) return; setSettings((s) => ({ ...s, flowerPatterns: (s.flowerPatterns || []).filter((p) => p.id !== pat.id) })); }} className="ml-auto text-red-400 hover:text-red-600 text-xs">🗑 Discard</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-pink-50 border border-pink-100 rounded-xl p-3 text-xs text-pink-800">
              <p className="font-semibold mb-1">💡 How patterns are used at function planning:</p>
              <p>Flower Head selects patterns + sizes + quantities for a function, then sets the artificial ratio %. System auto-calculates the real flower mandi shopping list at current prices and artificial kg needed. Pattern names match the Studio Rate Card exactly so Deal Check computes correctly.</p>
            </div>
          </div>
        );
      })()}
      {activePanel === "trussbatta" && trussInv && (
        <div className="space-y-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🏗️</span>
              <div className="flex-1">
                <p className="font-bold text-indigo-900">Truss · Batta · Liza Inventory</p>
                <p className="text-xs text-indigo-700 mt-0.5">Skeleton (pillars + beams) wrapped by batta cloth, then covered by Liza fabric. Stock counts seeded per §23.2. Rates start at ₹0 — fill in below.</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-4">
              <div className="bg-white rounded-xl p-3 text-center"><div className="text-2xl font-bold text-indigo-700">{Object.values(trussInv.pillars || {}).reduce((s, p) => s + (p.stock || 0), 0)}</div><div className="text-xs text-gray-500">Pillar pieces</div></div>
              <div className="bg-white rounded-xl p-3 text-center"><div className="text-2xl font-bold text-indigo-700">{Object.values(trussInv.beams || {}).reduce((s, b) => s + (b.stock || 0), 0)}</div><div className="text-xs text-gray-500">Beam pieces</div></div>
              <div className="bg-white rounded-xl p-3 text-center"><div className="text-2xl font-bold text-amber-700">{(trussInv.batta?.stockRft || 0).toLocaleString("en-IN")}</div><div className="text-xs text-gray-500">Batta RFT pool</div></div>
              <div className="bg-white rounded-xl p-3 text-center"><div className="text-2xl font-bold text-rose-700">{(trussInv.liza?.stockKg || 0).toLocaleString("en-IN")}</div><div className="text-xs text-gray-500">Liza kg pool</div></div>
            </div>
          </div>

          {/* Pillars */}
          <div className="bg-white border border-indigo-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div><p className="font-bold text-indigo-800">🏛️ Pillars (load-bearing tops)</p><p className="text-xs text-gray-500">Standard heights 10/12/15 ft. Single piece, 0 joints.</p></div>
              <button onClick={() => { const sz = prompt("New pillar size (ft, e.g. 8 or 18):"); if (!sz) return; const key = String(parseInt(sz) || 0); if (!key || key === "0") { alert("Invalid size"); return; } if (trussInv.pillars?.[key]) { alert("Size already exists"); return; } setTrussInv((ti) => ({ ...ti, pillars: { ...ti.pillars, [key]: { stock: 0, name: `Pillar ${key}ft` } } })); }} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Size</button>
            </div>
            <div className="overflow-hidden border border-indigo-100 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-indigo-50 text-xs text-indigo-700"><tr><th className="px-3 py-2 text-left font-medium">Size</th><th className="px-3 py-2 text-left font-medium">Display name</th><th className="px-3 py-2 text-center font-medium">Stock (pieces)</th><th className="px-3 py-2 text-right font-medium">Total RFT</th><th className="px-3 py-2 text-center font-medium w-12"></th></tr></thead>
                <tbody>
                  {Object.entries(trussInv.pillars || {}).sort(([a], [b]) => parseInt(b) - parseInt(a)).map(([size, p]) => {
                    const totalRft = (parseInt(size) || 0) * (p.stock || 0);
                    return (
                      <tr key={size} className="border-t border-indigo-50">
                        <td className="px-3 py-2 font-bold text-indigo-700">{size} ft</td>
                        <td className="px-3 py-2"><input type="text" value={p.name || ""} onChange={(e) => setTrussInv((ti) => ({ ...ti, pillars: { ...ti.pillars, [size]: { ...p, name: e.target.value } } }))} className="w-full border border-indigo-200 rounded px-2 py-1 text-xs" /></td>
                        <td className="px-3 py-2 text-center"><input type="number" min="0" value={p.stock || 0} onChange={(e) => setTrussInv((ti) => ({ ...ti, pillars: { ...ti.pillars, [size]: { ...p, stock: parseInt(e.target.value) || 0 } } }))} className="w-20 border border-indigo-200 rounded px-2 py-1 text-sm text-center font-bold" /></td>
                        <td className="px-3 py-2 text-right text-gray-500 text-xs">{totalRft.toLocaleString("en-IN")} ft</td>
                        <td className="px-3 py-2 text-center">{Object.keys(trussInv.pillars || {}).length > 1 && (<button onClick={() => { if (!confirm(`Delete ${size}ft pillar?`)) return; setTrussInv((ti) => { const next = { ...ti.pillars }; delete next[size]; return { ...ti, pillars: next }; }); }} className="text-red-400 hover:text-red-600 text-xs">✕</button>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex items-center justify-between">
              <div><p className="text-sm font-bold text-indigo-800">💰 Pillar rental rate</p><p className="text-xs text-indigo-600">Single rate for all pillar sizes (₹/RFT × height).</p></div>
              <div className="flex items-center gap-2"><span className="text-sm text-gray-700">₹</span><input type="number" min="0" value={trussInv.rates?.pillarRftRate || 0} onChange={(e) => setTrussInv((ti) => ({ ...ti, rates: { ...ti.rates, pillarRftRate: parseFloat(e.target.value) || 0 } }))} className="w-24 border border-indigo-300 rounded-lg px-3 py-1.5 text-sm font-bold text-indigo-700 text-center" /><span className="text-sm text-gray-700">/ RFT</span></div>
            </div>
          </div>

          {/* Beams */}
          <div className="bg-white border border-purple-100 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div><p className="font-bold text-purple-800">🔗 Beams (horizontal spans)</p><p className="text-xs text-gray-500">Sizes 2/3/4/5/8/10/12/15 ft.</p></div>
              <button onClick={() => { const sz = prompt("New beam size (ft, e.g. 6 or 20):"); if (!sz) return; const key = String(parseInt(sz) || 0); if (!key || key === "0") { alert("Invalid size"); return; } if (trussInv.beams?.[key]) { alert("Size already exists"); return; } setTrussInv((ti) => ({ ...ti, beams: { ...ti.beams, [key]: { stock: 0, name: `Beam ${key}ft` } } })); }} className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add Size</button>
            </div>
            <div className="overflow-hidden border border-purple-100 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-purple-50 text-xs text-purple-700"><tr><th className="px-3 py-2 text-left font-medium">Size</th><th className="px-3 py-2 text-left font-medium">Display name</th><th className="px-3 py-2 text-center font-medium">Stock (pieces)</th><th className="px-3 py-2 text-right font-medium">Total RFT</th><th className="px-3 py-2 text-center font-medium w-12"></th></tr></thead>
                <tbody>
                  {Object.entries(trussInv.beams || {}).sort(([a], [b]) => parseInt(b) - parseInt(a)).map(([size, b]) => {
                    const totalRft = (parseInt(size) || 0) * (b.stock || 0);
                    const isScarce = (b.stock || 0) < 10;
                    return (
                      <tr key={size} className="border-t border-purple-50">
                        <td className="px-3 py-2 font-bold text-purple-700">{size} ft{isScarce && <span className="ml-1 text-amber-500" title="Low stock">⚠️</span>}</td>
                        <td className="px-3 py-2"><input type="text" value={b.name || ""} onChange={(e) => setTrussInv((ti) => ({ ...ti, beams: { ...ti.beams, [size]: { ...b, name: e.target.value } } }))} className="w-full border border-purple-200 rounded px-2 py-1 text-xs" /></td>
                        <td className="px-3 py-2 text-center"><input type="number" min="0" value={b.stock || 0} onChange={(e) => setTrussInv((ti) => ({ ...ti, beams: { ...ti.beams, [size]: { ...b, stock: parseInt(e.target.value) || 0 } } }))} className="w-20 border border-purple-200 rounded px-2 py-1 text-sm text-center font-bold" /></td>
                        <td className="px-3 py-2 text-right text-gray-500 text-xs">{totalRft.toLocaleString("en-IN")} ft</td>
                        <td className="px-3 py-2 text-center">{Object.keys(trussInv.beams || {}).length > 1 && (<button onClick={() => { if (!confirm(`Delete ${size}ft beam?`)) return; setTrussInv((ti) => { const next = { ...ti.beams }; delete next[size]; return { ...ti, beams: next }; }); }} className="text-red-400 hover:text-red-600 text-xs">✕</button>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 bg-purple-50 border border-purple-100 rounded-xl p-3 flex items-center justify-between">
              <div><p className="text-sm font-bold text-purple-800">💰 Beam rental rate</p><p className="text-xs text-purple-600">Single rate for all beam sizes (₹/RFT × length).</p></div>
              <div className="flex items-center gap-2"><span className="text-sm text-gray-700">₹</span><input type="number" min="0" value={trussInv.rates?.beamRftRate || 0} onChange={(e) => setTrussInv((ti) => ({ ...ti, rates: { ...ti.rates, beamRftRate: parseFloat(e.target.value) || 0 } }))} className="w-24 border border-purple-300 rounded-lg px-3 py-1.5 text-sm font-bold text-purple-700 text-center" /><span className="text-sm text-gray-700">/ RFT</span></div>
            </div>
          </div>

          {/* Batta */}
          <div className="bg-white border border-amber-100 rounded-2xl p-5">
            <div className="mb-3"><p className="font-bold text-amber-800">🧵 Batta (truss wrap)</p><p className="text-xs text-gray-500">Bulk RFT pool — ops cuts to needed length. Wraps every pillar + beam.</p></div>
            <div className="grid md:grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-600 font-medium">Total stock (RFT)</label><input type="number" min="0" value={trussInv.batta?.stockRft || 0} onChange={(e) => setTrussInv((ti) => ({ ...ti, batta: { ...ti.batta, stockRft: parseInt(e.target.value) || 0 } }))} className="mt-1 w-full border border-amber-200 rounded-lg px-3 py-2 text-sm font-bold text-amber-700 text-center" /></div>
              <div><label className="text-xs text-gray-600 font-medium">Rental rate (₹/RFT)</label><input type="number" min="0" value={trussInv.rates?.battaRftRate || 0} onChange={(e) => setTrussInv((ti) => ({ ...ti, rates: { ...ti.rates, battaRftRate: parseFloat(e.target.value) || 0 } }))} className="mt-1 w-full border border-amber-200 rounded-lg px-3 py-2 text-sm font-bold text-amber-700 text-center" /></div>
              <div><label className="text-xs text-gray-600 font-medium">Precautionary buffer (%)</label><input type="number" min="0" max="50" value={trussInv.batta?.bufferPct || 10} onChange={(e) => setTrussInv((ti) => ({ ...ti, batta: { ...ti.batta, bufferPct: parseInt(e.target.value) || 0 } }))} className="mt-1 w-full border border-amber-200 rounded-lg px-3 py-2 text-sm font-bold text-amber-700 text-center" /></div>
            </div>
          </div>

          {/* Engineering settings */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <p className="font-bold text-gray-800 mb-1">⚙️ Engineering settings</p>
            <p className="text-xs text-gray-500 mb-4">Layer 1 topology rules. Change only if engineering practice changes.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div><label className="text-xs text-gray-600 font-medium">Pillar width (ft)</label><input type="number" step="0.05" min="0" value={trussInv.settings?.pillarWidthFt || 0.75} onChange={(e) => setTrussInv((ti) => ({ ...ti, settings: { ...ti.settings, pillarWidthFt: parseFloat(e.target.value) || 0.75 } }))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-bold text-gray-700 text-center" /></div>
              <div><label className="text-xs text-gray-600 font-medium">Max span (ft)</label><input type="number" min="1" value={trussInv.settings?.maxSpanFt || 30} onChange={(e) => setTrussInv((ti) => ({ ...ti, settings: { ...ti.settings, maxSpanFt: parseInt(e.target.value) || 30 } }))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-bold text-gray-700 text-center" /></div>
              <div><label className="text-xs text-gray-600 font-medium">Default back depth (ft)</label><input type="number" min="1" value={trussInv.settings?.defaultBackDepthFt || 4} onChange={(e) => setTrussInv((ti) => ({ ...ti, settings: { ...ti.settings, defaultBackDepthFt: parseInt(e.target.value) || 4 } }))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-bold text-gray-700 text-center" /></div>
              <div><label className="text-xs text-gray-600 font-medium">Default truss type</label>
                <select value={trussInv.settings?.untaggedFallback || "half_box"} onChange={(e) => setTrussInv((ti) => ({ ...ti, settings: { ...ti.settings, untaggedFallback: e.target.value } }))} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-bold text-gray-700">
                  <option value="u_only">🟢 U Truss (cheapest)</option>
                  <option value="half_box">🟡 Half Box (recommended)</option>
                  <option value="full_box">🔴 Full Box (overpriced safety)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
      {activePanel === "fabricstock" && trussInv && (() => {
        const colourCat = (settings.colourCatalogue || []).map((c) => c.name);
        const fabricFreshMarkup = trussInv.fabricFreshMarkup || { liza: 40, masking: 40, curtain: 40 };
        const rates = trussInv.rates || {};
        const updateRates = (key, val) => setTrussInv((ti) => ({ ...ti, rates: { ...(ti.rates || {}), [key]: parseFloat(val) || 0 } }));
        const updateMarkup = (key, val) => setTrussInv((ti) => ({ ...ti, fabricFreshMarkup: { ...(ti.fabricFreshMarkup || {}), [key]: parseFloat(val) || 0 } }));
        const updateStock = (which, idx, key, val) => setTrussInv((ti) => { const next = [...(ti[which] || [])]; next[idx] = { ...next[idx], [key]: (key === "colour" || key === "grade") ? val : (parseFloat(val) || 0) }; return { ...ti, [which]: next }; });
        const addStockRow = (which, qtyField) => setTrussInv((ti) => ({ ...ti, [which]: [...(ti[which] || []), { colour: colourCat[0] || "White", [qtyField]: 0, [`${qtyField}New`]: 0 }] }));
        const removeStockRow = (which, idx) => setTrussInv((ti) => ({ ...ti, [which]: (ti[which] || []).filter((_, j) => j !== idx) }));
        const renderFabric = (title, emoji, themeColor, which, qtyField, qtyLabel, rentalKey, purchaseKey, markupKey, rentalKeyNew) => {
          const stock = Array.isArray(trussInv[which]) ? trussInv[which] : [];
          return (
            <div className={`bg-${themeColor}-50 border border-${themeColor}-200 rounded-2xl p-5 space-y-3`}>
              <div><p className={`font-bold text-${themeColor}-900`}>{emoji} {title}</p><p className={`text-xs text-${themeColor}-700 mt-0.5`}>Per-colour Old + New stock quantities + their two rental rates + fresh purchase price + markup %. Update the live quantities after each washing cycle.</p></div>
              <div className={`bg-white border border-${themeColor}-100 rounded-lg p-3 grid grid-cols-4 gap-3`}>
                <div><label className="text-xs text-gray-600">Old-stock rental (₹/{qtyLabel})</label><input type="number" min="0" step="1" value={rates[rentalKey] || 0} onChange={(e) => updateRates(rentalKey, e.target.value)} className="mt-1 w-full border border-gray-200 rounded px-2 py-1 text-sm font-bold" /><p className="text-[10px] text-gray-400 mt-0.5">Owned OLD fabric — full charge</p></div>
                <div><label className={`text-xs text-${themeColor}-700 font-medium`}>New-stock rental (₹/{qtyLabel})</label><input type="number" min="0" step="1" value={rates[rentalKeyNew] || 0} onChange={(e) => updateRates(rentalKeyNew, e.target.value)} className={`mt-1 w-full border border-${themeColor}-300 rounded px-2 py-1 text-sm font-bold text-${themeColor}-800`} /><p className="text-[10px] text-gray-400 mt-0.5">Owned NEW fabric — premium rate</p></div>
                <div><label className="text-xs text-gray-600">Fresh purchase price (₹/{qtyLabel})</label><input type="number" min="0" step="1" value={rates[purchaseKey] || 0} onChange={(e) => updateRates(purchaseKey, e.target.value)} className="mt-1 w-full border border-gray-200 rounded px-2 py-1 text-sm font-bold" /><p className="text-[10px] text-gray-400 mt-0.5">What Ambria pays to buy new</p></div>
                <div><label className="text-xs text-gray-600">Fresh markup %</label><input type="number" min="0" max="500" step="1" value={fabricFreshMarkup[markupKey] || 0} onChange={(e) => updateMarkup(markupKey, e.target.value)} className={`mt-1 w-full border border-${themeColor}-300 rounded px-2 py-1 text-sm font-bold text-${themeColor}-800 text-center`} /><p className="text-[10px] text-gray-400 mt-0.5">Shortfall qty = purchase × this %</p></div>
              </div>
              <p className={`text-[10px] text-${themeColor}-600`}>Costing uses Old stock first, then New stock, then buys fresh.</p>
              <div className={`bg-white border border-${themeColor}-100 rounded-lg overflow-hidden`}>
                <div className={`flex items-center justify-between px-3 py-2 bg-${themeColor}-100`}>
                  <p className={`text-xs font-bold text-${themeColor}-800`}>Per-colour Stock</p>
                  <button onClick={() => addStockRow(which, qtyField)} className={`text-xs bg-${themeColor}-600 hover:bg-${themeColor}-700 text-white px-2.5 py-1 rounded font-medium`}>+ Add Colour</button>
                </div>
                {stock.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-400 italic text-center">No colours added yet. Tap + Add Colour to start.</div>
                ) : (
                  <table className="w-full text-xs">
                    <datalist id={`${which}-colours`}>{colourCat.map((cn) => <option key={cn} value={cn} />)}</datalist>
                    <thead className="text-gray-500"><tr><th className="px-2 py-1.5 text-left w-12">Swatch</th><th className="px-2 py-1.5 text-left">Colour</th><th className="px-2 py-1.5 text-center">Old ({qtyLabel})</th><th className={`px-2 py-1.5 text-center text-${themeColor}-700`}>New ({qtyLabel})</th><th className="px-2 py-1.5 text-center">Total</th><th className="px-2 py-1.5 w-10"></th></tr></thead>
                    <tbody>
                      {stock.map((row, i) => {
                        const cObj = (settings.colourCatalogue || []).find((c) => c.name === row.colour);
                        const oldQ = Number(row[qtyField]) || 0;
                        const newQ = Number(row[`${qtyField}New`]) || 0;
                        return (
                          <tr key={`${which}-${i}`} className={`border-t border-${themeColor}-50`}>
                            <td className="px-2 py-1.5"><div className="w-5 h-5 rounded border border-gray-300" style={{ background: cObj?.hex || "#ccc" }} /></td>
                            <td className="px-2 py-1.5">
                              <input type="text" value={row.colour || ""} list={`${which}-colours`} placeholder="Type or pick a colour…" onChange={(e) => updateStock(which, i, "colour", e.target.value)} className={`w-full border border-${themeColor}-200 rounded px-2 py-1 text-xs`} />
                            </td>
                            <td className="px-2 py-1.5 text-center"><input type="number" min="0" step="1" value={row[qtyField] || 0} onChange={(e) => updateStock(which, i, qtyField, e.target.value)} className={`w-20 border border-gray-300 rounded px-2 py-1 text-xs font-bold text-center`} title="Old fabric in stock" /></td>
                            <td className="px-2 py-1.5 text-center"><input type="number" min="0" step="1" value={row[`${qtyField}New`] || 0} onChange={(e) => updateStock(which, i, `${qtyField}New`, e.target.value)} className={`w-20 border border-${themeColor}-300 rounded px-2 py-1 text-xs font-bold text-center text-${themeColor}-800`} title="New fabric in stock" /></td>
                            <td className="px-2 py-1.5 text-center text-xs font-bold text-gray-700">{oldQ + newQ}</td>
                            <td className="px-2 py-1.5 text-center"><button onClick={() => removeStockRow(which, i)} className="text-red-400 hover:text-red-600 text-xs">✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        };
        return (
          <div className="space-y-4">
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
              <p className="font-bold text-indigo-900">🧵 Fabric Stock & Pricing</p>
              <p className="text-xs text-indigo-700 mt-1">Three fabrics with per-colour inventory: <strong>Liza fabric</strong> (kg), <strong>Wall masking panels</strong> (pieces), <strong>Velvet curtains</strong> (pieces). Shortfall qty is charged at purchase price × fresh markup %; stocked qty uses full rental price.</p>
            </div>
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-3">
              <p className="font-bold text-rose-900">🧮 Liza kg Conversion Factors</p>
              <p className="text-xs text-rose-700">How much Liza fabric (kg) is needed per RFT of truss wrap, and per sqft of ceiling drape at each density.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white border border-rose-100 rounded-lg p-3">
                  <p className="text-xs font-bold text-rose-800 mb-2">U Truss + Half Box (Frame wrap)</p>
                  <label className="text-xs text-gray-600">kg per RFT (pillars + beams)</label>
                  <input type="number" min="0" step="0.01" value={trussInv.fabricFactors?.kgPerRftWrap ?? 0.3} onChange={(e) => setTrussInv((ti) => ({ ...ti, fabricFactors: { ...(ti.fabricFactors || {}), kgPerRftWrap: parseFloat(e.target.value) || 0 } }))} className="mt-1 w-full border border-rose-200 rounded px-2 py-1 text-sm font-bold" />
                </div>
                <div className="bg-white border border-rose-100 rounded-lg p-3">
                  <p className="text-xs font-bold text-rose-800 mb-2">Full Box (Ceiling drape) — kg per sqft</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[["Minimum", "kgPerSqftMinimum", 0.03], ["Moderate", "kgPerSqftModerate", 0.05], ["Dense", "kgPerSqftDense", 0.08]].map(([l, k, dv]) => (
                      <div key={k}><label className="text-[10px] text-gray-600">{l}</label><input type="number" min="0" step="0.01" value={trussInv.fabricFactors?.[k] ?? dv} onChange={(e) => setTrussInv((ti) => ({ ...ti, fabricFactors: { ...(ti.fabricFactors || {}), [k]: parseFloat(e.target.value) || 0 } }))} className="mt-1 w-full border border-rose-200 rounded px-2 py-1 text-xs font-bold text-center" /></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {renderFabric("Liza Fabric", "🪡", "rose", "lizaStock", "stockKg", "kg", "lizaKgRate", "lizaKgPurchase", "liza", "lizaKgRateNew")}
            {renderFabric("Wall Masking Panels", "🧱", "orange", "maskingStock", "stockPieces", "pcs", "maskingPieceRate", "maskingPiecePurchase", "masking", "maskingPieceRateNew")}
            {renderFabric("Velvet Curtains", "🎀", "purple", "curtainStock", "stockPieces", "pcs", "curtainPieceRate", "curtainPiecePurchase", "curtain", "curtainPieceRateNew")}
          </div>
        );
      })()}

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

      {/* ── Rate Card (IMS-owned — Rate Card → IMS migration Phase 3) ── */}
      {activePanel === "ratecard" && (
        <RateCardPanel rcItems={rcItems} rcCats={rcCats} onSaveItems={onSaveRateCardItems} onSaveCats={onSaveRateCardCats} />
      )}

      {/* ── Sub-Categories & Scaling Factors (IMS-owned — Rate Card → IMS migration Phase 1) ── */}
      {/* Layout mirrors RateCardPanel.jsx: a category sidebar + a single-category main list, so the
          two admin screens feel like one system instead of two different UI languages. */}
      {activePanel === "subcats" && (() => {
        // Legacy fallback grouping — derived from OLD Rate Card items (rcItems/rcCats), kept only
        // for the ~29 "rate_card_only" sub-categories that have no physical inventory row at all
        // (so there's nothing for invSubToCat below to match against). Everything with real
        // inventory presence is now grouped from live inventory data instead (see invSubToCat) —
        // that join was too sparse to be the primary source (most sub-cats have no matching
        // rate-card ITEM with the same sub/imsAlias, so they all fell into "Other").
        const subToCatLabel = {};
        rcItems.forEach((it) => {
          const catLabel = rcCats.find((c) => c.id === it.cat)?.l || it.cat;
          if (!catLabel) return;
          const subKey = String(it.sub || "").trim().toLowerCase();
          const aliasKey = String(it.imsAlias || "").trim().toLowerCase();
          if (subKey) subToCatLabel[subKey] = catLabel;
          if (aliasKey) subToCatLabel[aliasKey] = catLabel;
        });

        // Category/sub-category alias normalization — mirrors InventoryTab.jsx's ALIAS_GROUPS /
        // canonicalLabel exactly (kept as a local copy rather than a shared import to avoid
        // touching that already-working file), so a raw inventory `cat` value like "Flower" or
        // "Cloths" collapses onto the same canonical label ("Florals"/"Fabric") the Inventory tab's
        // own category chips show — otherwise this panel would grow near-duplicate category groups.
        const CAT_ALIAS_GROUPS = [
          { test: (low, raw) => /^(flowers?|florals?)$/.test(low), find: /floral|flower/i, fallback: "Florals" },
          { test: (low, raw) => /^(cloths?|fabrics?|kapda|kapra)$/.test(low) || /कपड़ा|कपडा/.test(raw), find: /fabric|cloth|कपड़ा/i, fallback: "Fabric" },
        ];
        const studioCatLabels = studio?.catLabels || [];
        const normInvCat = (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          const low = raw.toLowerCase();
          for (const g of CAT_ALIAS_GROUPS) {
            if (g.test(low, raw)) return studioCatLabels.find((l) => g.find.test(l)) || g.fallback;
          }
          let hit = studioCatLabels.find((l) => l.toLowerCase() === low);
          if (hit) return hit;
          const sing = (x) => x.replace(/s$/, "");
          hit = studioCatLabels.find((l) => sing(l.toLowerCase()) === sing(low));
          if (hit) return hit;
          return raw;
        };

        // Live inventory → sub-category-key → top-level-category map. This is the PRIMARY grouping
        // source (matches exactly what the Inventory tab's own category chips show).
        const invSubToCat = {};
        inventory.forEach((it) => {
          const rawSub = it.subCat ?? it.subcategory;
          if (!rawSub) return;
          const subKey = String(rawSub).trim().toLowerCase();
          if (!subKey || invSubToCat[subKey]) return;
          const rawCat = it.cat ?? it.category;
          invSubToCat[subKey] = rawCat ? normInvCat(rawCat) : "Other";
        });

        const groupLabelFor = (r) => r.category_label || invSubToCat[r.id] || subToCatLabel[r.id] || "Other";
        const invCount = rateCardCategories.filter((r) => r.source === "inventory").length;
        const rcOnlyCount = rateCardCategories.filter((r) => r.source === "rate_card_only").length;
        const groups = {};
        rateCardCategories.forEach((r) => { const label = groupLabelFor(r); (groups[label] = groups[label] || []).push(r); });
        Object.values(groups).forEach((rows) => rows.sort((a, b) => a.label.localeCompare(b.label)));

        // Inventory sub-categories that don't have a rate_card_categories row yet at all — "reflect
        // all cats/sub-cats from inventory here" means these need to be visible even before anyone
        // has set a factor for them.
        const existingIds = new Set(rateCardCategories.map((r) => r.id));
        const missingByKey = {};
        inventory.forEach((it) => {
          const rawSub = it.subCat ?? it.subcategory;
          if (!rawSub) return;
          const subKey = String(rawSub).trim().toLowerCase();
          if (!subKey || existingIds.has(subKey) || missingByKey[subKey]) return;
          missingByKey[subKey] = { id: subKey, label: String(rawSub).trim(), cat: invSubToCat[subKey] || "Other" };
        });
        const missingSubcats = Object.values(missingByKey);

        // Sidebar category order: live inventory categories first (in the order Inventory's own
        // chips would show them), then any legacy Rate Card categories with no inventory presence,
        // then "Other" last.
        const catOrder = [...new Set([...studioCatLabels, ...Object.values(invSubToCat), ...rcCats.map((c) => c.l)])];
        const sidebarCats = [...catOrder, "Other"].filter((c, i, arr) => arr.indexOf(c) === i);
        const allCatLabels = sidebarCats; // move-to dropdown target list — same universe as the sidebar

        const curCat = sidebarCats.includes(subcatActiveCat) ? subcatActiveCat : (sidebarCats[0] || "Other");
        const searchQ = subcatSearch.trim().toLowerCase();
        const matchesSearch = (label) => !searchQ || label.toLowerCase().includes(searchQ);
        const rowsForCat = (groups[curCat] || []).filter((r) => matchesSearch(r.label));
        const missingForCat = missingSubcats.filter((m) => m.cat === curCat && matchesSearch(m.label));

        const renderRow = (r) => {
          const dupes = SUBCAT_NEAR_DUPES[r.id] || [];
          const editVal = subcatFactorEdits[r.id];
          const costPctEditVal = subcatCostPctEdits[r.id];
          const labelEditVal = subcatLabelEdits[r.id];
          return (
            <div key={r.id} className="flex items-center gap-3 bg-white px-4 py-2.5">
              <span className={"text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 " + (r.source === "inventory" ? "bg-emerald-100 text-emerald-700" : r.source === "manual" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700")}>
                {r.source === "inventory" ? "📦 stock" : r.source === "manual" ? "✏️ manual" : "🏷️ rate-card only"}
              </span>
              <input value={labelEditVal !== undefined ? labelEditVal : r.label}
                onChange={(e) => setSubcatLabelEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                onBlur={() => commitSubcatLabel(r.id, r.label)}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                className="flex-1 min-w-0 text-sm text-gray-800 border border-transparent hover:border-gray-200 focus:border-indigo-300 rounded-lg px-2 py-1 -mx-2" />
              {dupes.length > 0 && (
                <span className="text-amber-500 text-xs flex-shrink-0" title={`May be the same category as: ${dupes.join(", ")} — review before setting factors`}>⚠ possible dup</span>
              )}
              <select value={groupLabelFor(r)}
                onChange={(e) => onUpdateSubcatCategory?.(r.id, e.target.value)}
                title="Move to another top-level category"
                className="flex-shrink-0 max-w-[130px] border rounded-lg px-1.5 py-1 text-xs text-gray-600 bg-white">
                {allCatLabels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="flex items-center gap-1.5 flex-shrink-0" title="Scaling factor — multiplies every item's rental rate in this sub-category">
                <input type="number" step="0.05" min="0"
                  value={editVal !== undefined ? editVal : r.scaling_factor}
                  onChange={(e) => setSubcatFactorEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  onBlur={() => commitSubcatFactor(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  className="w-20 border rounded-lg px-2 py-1 text-sm font-bold text-center" />
                <span className="text-xs text-gray-400">×</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0" title="Cost% — Deal Check bills a shortfall (qty beyond what's free in stock) at item cost × this %, instead of the rental rate">
                <input type="number" step="5" min="0"
                  value={costPctEditVal !== undefined ? costPctEditVal : (r.cost_percent ?? 100)}
                  onChange={(e) => setSubcatCostPctEdits((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  onBlur={() => commitSubcatCostPct(r.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  className="w-16 border rounded-lg px-2 py-1 text-sm font-bold text-center" />
                <span className="text-xs text-gray-400">% cost</span>
              </div>
              <button onClick={() => deleteSubcatRow(r)} title="Delete sub-category"
                className="text-red-400 hover:text-red-600 text-xs px-1 flex-shrink-0">🗑️</button>
            </div>
          );
        };

        const renderMissingRow = (m) => (
          <div key={"missing::" + m.id} className="flex items-center gap-3 bg-amber-50/50 px-4 py-2.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 bg-amber-100 text-amber-700">📦 not configured</span>
            <span className="flex-1 min-w-0 text-sm text-gray-600 truncate">{m.label}</span>
            <button onClick={() => syncMissingSubcats([m])}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded-lg border border-indigo-200 flex-shrink-0">+ Add</button>
          </div>
        );

        return (
          <div className="space-y-4">
            <div className="bg-white border rounded-2xl p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                <div>
                  <p className="font-bold text-gray-900 mb-1">📂 Sub-Categories & Scaling Factors</p>
                  <p className="text-xs text-gray-500">IMS is now the source of truth for sub-category pricing. Each sub-category's scaling factor multiplies the base rate of every item inside it. Cost% prices a Deal Check shortfall (not enough free stock for the date) at item cost × this % instead of the rental rate.</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                  <span>{invCount} from inventory · {rcOnlyCount} rate-card-only · {rateCardCategories.length} total</span>
                  {missingSubcats.length > 0 && (
                    <button disabled={subcatSyncing} onClick={() => syncMissingSubcats(missingSubcats)}
                      title="Create a row here for every inventory sub-category that doesn't have one yet"
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 whitespace-nowrap">
                      {subcatSyncing ? "Syncing…" : `🔄 Sync ${missingSubcats.length} from Inventory`}
                    </button>
                  )}
                </div>
              </div>

              {rateCardCategories.length === 0 && missingSubcats.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-400 border border-dashed rounded-xl">
                  No sub-categories loaded yet. Run the Phase 1 migration (012_rate_card_subcategory_scaling.sql) if this is a fresh environment.
                </div>
              ) : (
                <div className="grid grid-cols-[220px_1fr] gap-5">
                  {/* Category sidebar */}
                  <div>
                    <span className="text-xs font-bold text-gray-500 mb-2 block">Categories</span>
                    <div className="space-y-1">
                      {sidebarCats.map((label) => {
                        const color = rcCats.find((c) => c.l === label)?.c || "#9CA3AF";
                        const n = groups[label]?.length || 0;
                        const missingN = missingSubcats.filter((m) => m.cat === label).length;
                        return (
                          <div key={label} onClick={() => setSubcatActiveCat(label)}
                            className={"px-3 py-2 rounded-lg cursor-pointer border text-sm flex items-center justify-between " + (curCat === label ? "bg-indigo-50 border-indigo-300" : "bg-white border-gray-200")}>
                            <span className="flex items-center gap-1.5 truncate">
                              <span className="w-1.5 h-3.5 rounded flex-shrink-0" style={{ background: color }} />
                              <span className={"truncate " + (curCat === label ? "font-semibold text-indigo-700" : "text-gray-700")}>{label}</span>
                            </span>
                            <span className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[10px] text-gray-400">{n}</span>
                              {missingN > 0 && <span title={`${missingN} inventory sub-categor${missingN === 1 ? "y" : "ies"} not yet configured`} className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sub-categories in the selected category */}
                  <div>
                    <div className="flex gap-2 mb-3">
                      <input value={subcatSearch} onChange={(e) => setSubcatSearch(e.target.value)}
                        placeholder="Search sub-categories…" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                      <button onClick={() => { setSubcatAddOpen(!subcatAddOpen); setSubcatAddVal(""); }}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold whitespace-nowrap">+ Add Sub-Category</button>
                    </div>

                    {subcatAddOpen && (
                      <div className="flex items-center gap-2 mb-3">
                        <input autoFocus value={subcatAddVal} onChange={(e) => setSubcatAddVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { addNewSubcat(subcatAddVal, curCat); setSubcatAddVal(""); setSubcatAddOpen(false); }
                            if (e.key === "Escape") { setSubcatAddVal(""); setSubcatAddOpen(false); }
                          }}
                          placeholder={`New sub-category in ${curCat}…`} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                        <button onClick={() => { addNewSubcat(subcatAddVal, curCat); setSubcatAddVal(""); setSubcatAddOpen(false); }}
                          className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold whitespace-nowrap">Add</button>
                        <button onClick={() => { setSubcatAddVal(""); setSubcatAddOpen(false); }}
                          className="px-3 py-2 rounded-lg bg-gray-100 text-xs whitespace-nowrap">Cancel</button>
                      </div>
                    )}

                    <div className="border rounded-xl overflow-hidden divide-y">
                      {rowsForCat.map(renderRow)}
                      {missingForCat.map(renderMissingRow)}
                      {rowsForCat.length === 0 && missingForCat.length === 0 && (
                        <div className="text-center py-10 text-sm text-gray-400">{subcatSearch ? "No matches" : "No sub-categories in this category yet"}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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

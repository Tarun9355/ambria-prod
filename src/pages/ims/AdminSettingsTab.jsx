import { useState } from "react";
import { Tabs } from "../../components/ui";

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
      {(activePanel === "mandi") && <Placeholder name="🌸 Mandi Prices" note="Flowers slice" />}
      {(activePanel === "patterns") && <Placeholder name="🌺 Recipes" note="Flowers slice" />}
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

import { useState } from "react";

// Faithful copy of the reference IMS DihariTimingsPanel (Admin → Settings → Dihari Timings).
export default function DihariTimingsPanel({ settings, setSettings }) {
  const schemes = settings.dihariSchemes || {};
  const defaults = settings.defaultWindowsByPhase || {};
  const types = Object.keys(schemes);

  const [newTypeName, setNewTypeName] = useState("");
  const [winDraft, setWinDraft] = useState({});
  const [confirmRemove, setConfirmRemove] = useState("");

  const PHASES = [
    { id: "minusOne", label: "-1 Day (Early Setup)", emoji: "⏮️" },
    { id: "event", label: "Function Day", emoji: "🎉" },
    { id: "dismantle", label: "Dismantle Day", emoji: "🧹" },
  ];

  const updScheme = (type, mutator) => {
    setSettings((s) => {
      const cur = s.dihariSchemes || {};
      const ex = cur[type] || { rate: 500, windows: [] };
      return { ...s, dihariSchemes: { ...cur, [type]: mutator({ ...ex, windows: [...(ex.windows || [])] }) } };
    });
  };
  const updDefault = (type, phase, windowIds) => {
    setSettings((s) => {
      const cur = s.defaultWindowsByPhase || {};
      const ex = cur[type] || { minusOne: [], event: [], dismantle: [] };
      return { ...s, defaultWindowsByPhase: { ...cur, [type]: { ...ex, [phase]: windowIds } } };
    });
  };
  const togglePhaseWindow = (type, phase, winId) => {
    const cur = (defaults[type] || {})[phase] || [];
    updDefault(type, phase, cur.includes(winId) ? cur.filter((x) => x !== winId) : [...cur, winId]);
  };
  const addLabourType = () => {
    const clean = (newTypeName || "").trim();
    if (!clean) return;
    if (schemes[clean]) { setNewTypeName(""); return; }
    setSettings((s) => ({
      ...s,
      dihariSchemes: { ...(s.dihariSchemes || {}), [clean]: { rate: 500, windows: [{ id: "m", label: "9 AM – 5 PM" }] } },
      defaultWindowsByPhase: { ...(s.defaultWindowsByPhase || {}), [clean]: { minusOne: [], event: ["m"], dismantle: [] } },
    }));
    setNewTypeName("");
  };
  const removeLabourType = (type) => {
    setSettings((s) => {
      const cs = { ...(s.dihariSchemes || {}) }; delete cs[type];
      const cd = { ...(s.defaultWindowsByPhase || {}) }; delete cd[type];
      return { ...s, dihariSchemes: cs, defaultWindowsByPhase: cd };
    });
    setConfirmRemove("");
  };
  const addWindowForType = (type) => {
    const label = (winDraft[type] || "").trim();
    if (!label) return;
    const id = "w" + Date.now().toString(36).slice(-5);
    updScheme(type, (x) => ({ ...x, windows: [...x.windows, { id, label }] }));
    setWinDraft((prev) => ({ ...prev, [type]: "" }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-gray-800">💰 Dihari Timings</h4>
        <p className="text-sm text-gray-500 mt-0.5">Define dihari windows + rate for each labour type. Pre-tick which windows apply per phase. Studio Deal Check uses these for booking-level day-wise manpower forecast.</p>
      </div>

      <div className="flex gap-2 items-end bg-indigo-50 border border-indigo-200 rounded-xl p-3">
        <div className="flex-1">
          <label className="text-xs text-indigo-700 font-medium">+ Add labour type</label>
          <input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addLabourType(); }}
            placeholder="e.g. Tent House Worker" className="w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white" />
        </div>
        <button onClick={addLabourType} disabled={!newTypeName.trim()} className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm px-4 py-2 rounded-lg font-medium whitespace-nowrap">+ Add</button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        <p className="font-semibold mb-1">📖 How this works</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li><b>Rate</b> — ₹ paid per dihari (one time-window block) per person.</li>
          <li><b>Windows</b> — each touched window = 1 dihari. e.g. work 9 AM – 2 AM crossing 3 Fabric Bangali windows = 3 dihari.</li>
          <li><b>Default ticks</b> — pre-tick when salesperson opens a booking. Still untickable per day in Studio Deal Check.</li>
        </ol>
      </div>

      {types.length === 0 && <div className="text-center py-10 text-gray-400 text-sm border border-dashed rounded-xl">No labour types yet. Add one above.</div>}

      {types.map((type) => {
        const sc = schemes[type] || { rate: 500, windows: [] };
        const d = defaults[type] || { minusOne: [], event: [], dismantle: [] };
        const wins = sc.windows || [];
        const pendingRemove = confirmRemove === type;
        return (
          <div key={type} className="bg-white border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border-b flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-bold text-gray-800">👷 {type}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">₹</span>
                  <input type="number" min="0" step="50" value={sc.rate} onChange={(e) => updScheme(type, (x) => ({ ...x, rate: parseInt(e.target.value) || 0 }))} className="w-24 border rounded px-2 py-1 text-sm font-bold text-indigo-700 text-center" />
                  <span className="text-xs text-gray-500">/ dihari</span>
                </div>
              </div>
              {pendingRemove ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-medium">Remove this type?</span>
                  <button onClick={() => removeLabourType(type)} className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded font-medium">Yes, remove</button>
                  <button onClick={() => setConfirmRemove("")} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded font-medium">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmRemove(type)} className="text-gray-300 hover:text-red-500 text-sm">🗑 Remove</button>
              )}
            </div>

            <div className="px-4 py-3 border-b">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">⏰ Dihari Windows</p>
              <div className="flex flex-wrap gap-2 items-center">
                {wins.map((w, wi) => (
                  <div key={w.id} className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1">
                    <input value={w.label} onChange={(e) => updScheme(type, (x) => { const ws = [...x.windows]; ws[wi] = { ...ws[wi], label: e.target.value }; return { ...x, windows: ws }; })}
                      className="text-xs bg-transparent border-none outline-none w-28 font-medium text-indigo-800" />
                    <button onClick={() => {
                      if (wins.length <= 1) return;
                      updScheme(type, (x) => ({ ...x, windows: x.windows.filter((_, i) => i !== wi) }));
                      PHASES.forEach((p) => { const cur = (defaults[type] || {})[p.id] || []; if (cur.includes(w.id)) updDefault(type, p.id, cur.filter((z) => z !== w.id)); });
                    }} className="text-indigo-400 hover:text-red-500 text-xs leading-none">×</button>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <input value={winDraft[type] || ""} onChange={(e) => setWinDraft((prev) => ({ ...prev, [type]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") addWindowForType(type); }}
                    placeholder="+ Window label (Enter)" className="text-xs border border-dashed border-indigo-300 rounded-lg px-2 py-1 w-40 focus:w-48 transition-all focus:border-indigo-400 outline-none placeholder-indigo-300" />
                  {(winDraft[type] || "").trim() && <button onClick={() => addWindowForType(type)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded font-bold">✓</button>}
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">✅ Default Windows Per Phase</p>
              <p className="text-[10px] text-gray-400 mb-2">Pre-ticked when salesperson opens a booking. Still untickable per day.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {PHASES.map((ph) => (
                  <div key={ph.id} className="border border-gray-200 bg-gray-50 rounded-lg p-2">
                    <p className="text-xs font-bold text-gray-700 mb-1">{ph.emoji} {ph.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {wins.map((w) => {
                        const on = (d[ph.id] || []).includes(w.id);
                        return (
                          <button key={w.id} onClick={() => togglePhaseWindow(type, ph.id, w.id)}
                            className={"text-[10px] px-2 py-0.5 rounded-full border font-medium " + (on ? "bg-indigo-600 border-indigo-700 text-white" : "bg-white border-gray-200 text-gray-400")}>
                            {on ? "✓ " : ""}{w.label}
                          </button>
                        );
                      })}
                      {wins.length === 0 && <span className="text-[10px] text-gray-300 italic">No windows defined</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-xs text-green-800">
        <p className="font-semibold mb-1">💡 Studio integration</p>
        <p>Studio Deal Check fetches this on booking open. For each type, Studio computes people count per ceremony, takes cumulative MAX across days, multiplies by ticked windows × rate. Salesperson can untick any window for any day to model gaps.</p>
      </div>
    </div>
  );
}

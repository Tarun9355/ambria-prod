import { useState, useEffect, useMemo } from "react";
import {
  allocatePlatformForDate, applyPlatformOverridesToEvents, expireStaleSimulations, isDeptHead,
  simulatePlatformImpact, platformStockSqft, PLATFORM_MATERIALS,
} from "../../lib/ims/platformEngine";
import { fetchAll, supabase } from "../../lib/supabase";
import { Modal } from "../../components/ui";

const MAT_LABEL = { iron: "⛓️ Iron", pole: "🪵 Pole", aluminium: "⚙️ Aluminium" };

// Platform's own planning dashboard, mirroring TrussPlanningTab.jsx's shape (date nav, stock
// bars, shortage alerts, events list, what-if simulator, cascade history) but simplified to match
// how platform is actually booked — one sqft pool per material instead of per-size piece counts,
// no topology/joints to show (see platformEngine.js's own header comment for why). Billing is
// untouched by anything here, same relationship Truss's dashboard already has to its own billing.
export default function PlatformPlanningTab({ platformAlloc, setPlatformAlloc, trussInv, authUser }) {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [overrides, setOverrides] = useState({});
  const [simulations, setSimulations] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [customizeTarget, setCustomizeTarget] = useState(null); // {eoId, clientName, totalPlatformSqftByMaterial}
  const [showSimDialog, setShowSimDialog] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const canEdit = isDeptHead(authUser);

  useEffect(() => {
    const loadOverrides = async () => { try { const rows = await fetchAll("platform_overrides"); if (Array.isArray(rows)) setOverrides(Object.fromEntries(rows.map(r => [r.id, r.data || {}]))); } catch {} };
    const loadSims = async () => { try { const rows = await fetchAll("platform_simulations"); if (Array.isArray(rows)) { const obj = Object.fromEntries(rows.map(r => [r.id, r.data || {}])); setSimulations(expireStaleSimulations(obj, Date.now()) || obj); } } catch {} };
    const loadAudit = async () => { try { const { data } = await supabase.from("platform_audit").select("data").order("id", { ascending: false }).limit(50); if (Array.isArray(data)) setAuditLog(data.map(r => r.data).filter(Boolean)); } catch {} };
    loadOverrides(); loadSims(); loadAudit();
    const chO = supabase.channel("realtime:platform_overrides").on("postgres_changes", { event: "*", schema: "public", table: "platform_overrides" }, loadOverrides).subscribe();
    const chS = supabase.channel("realtime:platform_simulations").on("postgres_changes", { event: "*", schema: "public", table: "platform_simulations" }, loadSims).subscribe();
    return () => { try { supabase.removeChannel(chO); supabase.removeChannel(chS); } catch {} };
  }, []);

  const dateEntry = platformAlloc?.[selectedDate] || null;
  const dateEvents = useMemo(() => {
    const raw = Array.isArray(dateEntry?.events) ? dateEntry.events : [];
    return applyPlatformOverridesToEvents(raw, overrides);
  }, [dateEntry, overrides]);
  const stockSummary = dateEntry?.stockSummary || null;

  const shiftDay = (delta) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const dateSimulations = useMemo(() => Object.values(simulations).filter(s => s.date === selectedDate), [simulations, selectedDate]);

  // Stock pressure bars — one per material, not per size (no piece sizes to speak of for platform).
  const stockBars = useMemo(() => {
    if (!trussInv) return [];
    return PLATFORM_MATERIALS.map(mat => {
      const total = Math.round(platformStockSqft(trussInv, mat) * 100) / 100;
      const used = Math.round((stockSummary?.demand?.[mat] || 0) * 100) / 100;
      const available = Math.max(0, Math.round((total - used) * 100) / 100);
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      const color = pct >= 100 ? "red" : pct >= 85 ? "amber" : pct >= 50 ? "yellow" : "green";
      return { mat, total, used, available, pct, color };
    });
  }, [trussInv, stockSummary]);

  const shortageEvents = useMemo(() => dateEvents.filter(ev => ev.shortageBorne), [dateEvents]);

  const saveOverrides = async (newOverrides) => {
    const prev = overrides;
    setOverrides(newOverrides);
    try {
      for (const [k, val] of Object.entries(newOverrides)) if (JSON.stringify(prev[k]) !== JSON.stringify(val)) await supabase.from("platform_overrides").upsert({ id: k, data: val }, { onConflict: "id" });
      for (const k of Object.keys(prev)) if (!(k in newOverrides)) await supabase.from("platform_overrides").delete().eq("id", k);
    } catch {}
  };
  const saveSimulations = async (newSims) => {
    const prev = simulations;
    setSimulations(newSims);
    try {
      for (const [k, val] of Object.entries(newSims)) if (JSON.stringify(prev[k]) !== JSON.stringify(val)) await supabase.from("platform_simulations").upsert({ id: k, data: val }, { onConflict: "id" });
      for (const k of Object.keys(prev)) if (!(k in newSims)) await supabase.from("platform_simulations").delete().eq("id", k);
    } catch {}
  };

  // Override keyed by eoId (not eoId:zoneKey like truss) — platform demand is already a single
  // per-event sqft-by-material number, not a per-zone topology, so there's nothing finer to target.
  const applyOverride = async (eoId, sqftByMaterial, reason) => {
    const next = { ...overrides, [eoId]: { totalPlatformSqftByMaterial: sqftByMaterial, reason, overrideBy: authUser?.name || "—", overrideAt: Date.now() } };
    await saveOverrides(next);
    try {
      const rec = { ts: Date.now(), date: selectedDate, event: "override-applied", eoId, by: authUser?.name || "—", reason };
      await supabase.from("platform_audit").insert({ data: rec });
      setAuditLog(prev => [rec, ...prev].slice(0, 50));
    } catch {}
    if (dateEntry && trussInv) setPlatformAlloc(allocatePlatformForDate(platformAlloc, selectedDate, dateEntry.events, trussInv, `override-by-${authUser?.name || "—"}`));
    setCustomizeTarget(null);
  };

  const removeOverride = async (eoId) => {
    if (!canEdit) return;
    if (!confirm("Remove this override? The date will re-cascade with the auto-allocator.")) return;
    const next = { ...overrides };
    delete next[eoId];
    await saveOverrides(next);
    try {
      const rec = { ts: Date.now(), date: selectedDate, event: "override-removed", eoId, by: authUser?.name || "—" };
      await supabase.from("platform_audit").insert({ data: rec });
      setAuditLog(prev => [rec, ...prev].slice(0, 50));
    } catch {}
    if (dateEntry && trussInv) setPlatformAlloc(allocatePlatformForDate(platformAlloc, selectedDate, dateEntry.events, trussInv, `override-removed-by-${authUser?.name || "—"}`));
  };

  const saveSimulation = async (sim) => {
    const simId = sim.id || `sim-${Date.now().toString(36)}`;
    const next = { ...simulations, [simId]: { ...sim, id: simId, expiresAt: Date.now() + 48 * 60 * 60 * 1000 } };
    await saveSimulations(next);
    setShowSimDialog(false);
  };
  const discardSimulation = async (simId) => {
    const next = { ...simulations };
    delete next[simId];
    await saveSimulations(next);
  };

  const fmtTs = (ts) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
  };
  const fmtSqftByMat = (bySqft) => PLATFORM_MATERIALS
    .filter(m => (bySqft || {})[m] > 0)
    .map(m => `${MAT_LABEL[m].replace(/^\S+\s/, "")}: ${bySqft[m]} sqft`)
    .join(" · ") || "—";

  return (
    <div className="space-y-5">
      {/* 1. HEADER */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🛏️ Platform Planning Dashboard</h2>
            <p className="text-xs text-gray-500 mt-1">{canEdit ? "Department head access · override + simulator enabled" : "Read-only view · override gated to dept heads"}</p>
          </div>
          <div className="text-xs text-gray-500 text-right">
            Last cascade: {dateEntry?.lastCascadeAt ? fmtTs(dateEntry.lastCascadeAt) : "—"}
            {dateEntry?.lastCascadeBy ? ` · ${dateEntry.lastCascadeBy}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => shiftDay(-1)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">◀ Prev</button>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium" />
          <button onClick={() => shiftDay(1)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">Next ▶</button>
          <button onClick={() => setSelectedDate(today)} className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg text-sm">Today</button>
          <div className="ml-auto text-sm text-gray-700">
            <strong>{dateEvents.length}</strong> event{dateEvents.length === 1 ? "" : "s"} ·{" "}
            <strong>{dateSimulations.length}</strong> draft{dateSimulations.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* 2. STOCK STATUS BAR — per material */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📊 Stock Availability — {selectedDate}</h3>
        {!trussInv ? (
          <p className="text-sm text-amber-700">Truss inventory not loaded. Visit Settings → Platform Config.</p>
        ) : (
          <div className="space-y-2">
            {stockBars.map(bar => (
              <div key={bar.mat} className="flex items-center gap-2 text-xs">
                <span className="w-24 text-gray-700 font-medium">{MAT_LABEL[bar.mat]}</span>
                <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                  <div className={`h-full ${bar.color === "red" ? "bg-red-500" : bar.color === "amber" ? "bg-amber-500" : bar.color === "yellow" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: bar.pct + "%" }}></div>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-800">{bar.used} / {bar.total} sqft ({bar.pct}%)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. SHORTAGE ALERTS */}
      {shortageEvents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">⚠️ Shortage Alerts · {shortageEvents.length} event{shortageEvents.length === 1 ? "" : "s"}</h3>
          <div className="space-y-2">
            {shortageEvents.map(ev => (
              <div key={ev.eoId} className="bg-white rounded-lg p-3 border border-red-200 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{ev.clientName || "—"} ({ev.state})</p>
                  <p className="text-xs text-gray-600 mt-1">{fmtSqftByMat(ev.totalPlatformSqftByMaterial)}</p>
                </div>
                <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Rental required</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. EVENTS LIST */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📋 Events on {selectedDate}</h3>
        {dateEvents.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No events with a platform on this date. Click "+ New Simulation" below to test stock availability for a hypothetical event.</p>
        ) : (
          <div className="space-y-2">
            {dateEvents.map(ev => {
              const stateColor = ev.state === "hard" ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800";
              const stateLabel = ev.state === "hard" ? "🔒 SOLD" : "🕒 SOFT";
              return (
                <div key={ev.eoId} className={`rounded-lg border p-3 ${ev.shortageBorne ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-gray-900">
                        {ev.clientName || "—"}
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${stateColor}`}>{stateLabel}</span>
                        {ev.hasOverride && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800">📝 OVERRIDE</span>}
                        {ev.shortageBorne && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-200 text-red-900">⚠ SHORTAGE</span>}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">{fmtSqftByMat(ev.totalPlatformSqftByMaterial)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">by {ev.heldBy || "—"}</p>
                      {ev.override?.reason && <p className="text-xs italic text-purple-700 mt-1">Override reason: "{ev.override.reason}" — by {ev.override.overrideBy}</p>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => canEdit && setCustomizeTarget({ eoId: ev.eoId, clientName: ev.clientName, totalPlatformSqftByMaterial: ev.totalPlatformSqftByMaterial })}
                        disabled={!canEdit}
                        className={`text-xs px-3 py-1 rounded ${canEdit ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
                        title={canEdit ? "Customize this event's platform sqft" : "Dept head only"}
                      >
                        📝 Customize
                      </button>
                      {ev.hasOverride && canEdit && (
                        <button onClick={() => removeOverride(ev.eoId)} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">Reset</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. SIMULATOR */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">🧪 What-If Simulator</h3>
          <button
            onClick={() => canEdit && setShowSimDialog(true)}
            disabled={!canEdit}
            className={`text-sm px-4 py-2 rounded-lg font-semibold ${canEdit ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
            title={canEdit ? "Create a new simulation" : "Dept head only"}
          >
            + New Simulation
          </button>
        </div>
        {dateSimulations.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No active drafts on this date. Simulations expire after 48 hours.</p>
        ) : (
          <div className="space-y-2">
            {dateSimulations.map(sim => {
              const computed = sim.computed || simulatePlatformImpact(sim, dateEntry, dateSimulations.filter(s => s.id !== sim.id), trussInv);
              const statusColor = computed?.status === "red" ? "bg-red-100 text-red-800" : computed?.status === "yellow" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";
              const statusEmoji = computed?.status === "red" ? "🔴" : computed?.status === "yellow" ? "🟡" : "🟢";
              return (
                <div key={sim.id} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900">✏️ {sim.label} <span className="text-xs text-gray-500">({sim.mode})</span></p>
                      <p className="text-xs text-gray-600 mt-0.5">{fmtSqftByMat(computed?.demand)}</p>
                      <p className="text-xs text-gray-500 mt-1">By {sim.createdBy || "—"} · Expires {fmtTs(sim.expiresAt)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-1 rounded ${statusColor}`}>{statusEmoji} {computed?.reason || "—"}</span>
                      <span className="text-xs text-gray-600">{computed?.pressure || 0}% stock</span>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="mt-2">
                      <button onClick={() => discardSimulation(sim.id)} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">Discard</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. CASCADE HISTORY */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <button onClick={() => setHistoryExpanded(s => !s)} className="w-full text-left flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">📜 Cascade History · {auditLog.length} entr{auditLog.length === 1 ? "y" : "ies"} (last 50)</h3>
          <span className="text-xs">{historyExpanded ? "▼" : "▶"}</span>
        </button>
        {historyExpanded && (
          <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
            {auditLog.length === 0 ? <p className="text-xs text-gray-500 italic">No audit entries yet.</p> : auditLog.map((entry, idx) => (
              <div key={idx} className="text-xs flex items-start gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
                <span className="text-gray-500 w-32 flex-shrink-0">{fmtTs(entry.ts)}</span>
                <span className="text-gray-700 flex-1">
                  <strong>{entry.event}</strong>
                  {entry.date && entry.date !== "ALL" ? ` · ${entry.date}` : ""}
                  {entry.by ? ` · by ${entry.by}` : ""}
                  {entry.eventCount ? ` · ${entry.eventCount} events` : ""}
                  {entry.reason ? ` · "${entry.reason}"` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CUSTOMIZE DIALOG */}
      {customizeTarget && (
        <CustomizeDialog
          target={customizeTarget}
          onClose={() => setCustomizeTarget(null)}
          onSave={(sqftByMaterial, reason) => applyOverride(customizeTarget.eoId, sqftByMaterial, reason)}
        />
      )}

      {/* NEW SIMULATION DIALOG */}
      {showSimDialog && (
        <NewSimulationDialog
          selectedDate={selectedDate}
          trussInv={trussInv}
          dateEntry={dateEntry}
          dateSimulations={dateSimulations}
          authUser={authUser}
          onClose={() => setShowSimDialog(false)}
          onSave={saveSimulation}
        />
      )}
    </div>
  );
}

// ─── Customize Dialog (override modal) — per-material sqft, not a truss config ─────────────────
function CustomizeDialog({ target, onClose, onSave }) {
  const [sqft, setSqft] = useState(() => {
    const base = {};
    PLATFORM_MATERIALS.forEach(m => { base[m] = target.totalPlatformSqftByMaterial?.[m] || 0; });
    return base;
  });
  const [reason, setReason] = useState("");

  const handleSave = () => {
    if (!reason.trim()) { alert("Please provide a reason for this override."); return; }
    const cleaned = {};
    PLATFORM_MATERIALS.forEach(m => { if (Number(sqft[m]) > 0) cleaned[m] = Number(sqft[m]); });
    onSave(cleaned, reason.trim());
  };

  return (
    <Modal open={true} onClose={onClose} title="📝 Customize Platform Sqft" wide>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-xs">
          <p className="text-gray-700"><strong>Event:</strong> {target.clientName || target.eoId}</p>
          <p className="text-gray-700"><strong>Current (auto-computed):</strong> {PLATFORM_MATERIALS.filter(m => target.totalPlatformSqftByMaterial?.[m] > 0).map(m => `${m}: ${target.totalPlatformSqftByMaterial[m]} sqft`).join(", ") || "—"}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PLATFORM_MATERIALS.map(m => (
            <div key={m}>
              <label className="text-xs font-medium text-gray-700 block mb-1">{MAT_LABEL[m]} sqft</label>
              <input type="number" min="0" value={sqft[m]} onChange={e => setSqft(s => ({ ...s, [m]: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          ))}
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Reason (required) <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Ops improvised an extra deck on site beyond what Build recorded" rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"></textarea>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <strong>⚠️ Cascade impact:</strong> Saving this override will trigger a pool re-allocation for this date. Other events may be re-shuffled.
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">Save Override</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── New Simulation Dialog (what-if modal) — material + sqft rows, not L/W/H/config zones ──────
function NewSimulationDialog({ selectedDate, trussInv, dateEntry, dateSimulations, authUser, onClose, onSave }) {
  const [label, setLabel] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [mode, setMode] = useState("compound");
  const [rows, setRows] = useState([{ material: "iron", sqft: "" }]);
  const [previewResult, setPreviewResult] = useState(null);

  const addRow = () => setRows(s => [...s, { material: "iron", sqft: "" }]);
  const removeRow = (idx) => setRows(s => s.filter((_, i) => i !== idx));
  const updateRow = (idx, field, val) => setRows(s => s.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const handlePreview = () => {
    if (!label.trim()) { alert("Please provide a label."); return; }
    const validRows = rows.filter(r => Number(r.sqft) > 0);
    if (validRows.length === 0) { alert("At least one row with a sqft amount is required."); return; }
    const tempSim = {
      date: selectedDate,
      label: label.trim(),
      salesperson: salesperson.trim() || authUser?.name || "—",
      createdBy: authUser?.name || "—",
      mode,
      zones: validRows.map(r => ({ material: r.material, sqft: Number(r.sqft) || 0 })),
    };
    const result = simulatePlatformImpact(tempSim, dateEntry, dateSimulations, trussInv);
    setPreviewResult({ sim: tempSim, computed: result });
  };

  const handleSave = () => {
    if (!previewResult) { alert("Please preview first."); return; }
    onSave({ ...previewResult.sim, computed: previewResult.computed });
  };

  const result = previewResult?.computed;
  const statusColor = result?.status === "red" ? "bg-red-100 text-red-800 border-red-300" : result?.status === "yellow" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-green-100 text-green-800 border-green-300";

  return (
    <Modal open={true} onClose={onClose} title="🧪 New Platform Simulation" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Label *</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Sharma Wedding · Ashi" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Salesperson</label>
            <input value={salesperson} onChange={e => setSalesperson(e.target.value)} placeholder="Ashi" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Mode</label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "compound"} onChange={() => setMode("compound")} /> Compound (stack on other drafts)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "independent"} onChange={() => setMode("independent")} /> Independent (alternative scenarios)</label>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-700">Platform sqft needed</label>
            <button onClick={addRow} className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded">+ Add Row</button>
          </div>
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 grid grid-cols-12 gap-2 items-center">
                <select value={r.material} onChange={e => updateRow(idx, "material", e.target.value)} className="col-span-5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                  {PLATFORM_MATERIALS.map(m => <option key={m} value={m}>{MAT_LABEL[m]}</option>)}
                </select>
                <input type="number" min="0" value={r.sqft} onChange={e => updateRow(idx, "sqft", e.target.value)} placeholder="Sqft" className="col-span-5 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                {rows.length > 1 && <button onClick={() => removeRow(idx)} className="col-span-2 text-red-600 hover:text-red-800 text-xs">×</button>}
              </div>
            ))}
          </div>
        </div>

        <button onClick={handlePreview} className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">🔍 Check Availability</button>

        {result && (
          <div className={`border rounded-lg p-4 ${statusColor}`}>
            <p className="font-semibold mb-2">{result.status === "red" ? "🔴" : result.status === "yellow" ? "🟡" : "🟢"} {result.reason}</p>
            <div className="text-xs space-y-1">
              <p>Sqft needed: {PLATFORM_MATERIALS.filter(m => result.demand?.[m] > 0).map(m => `${result.demand[m]} ${m}`).join(", ") || "—"}</p>
              <p className="font-semibold mt-2">Stock pressure: {result.pressure || 0}%</p>
            </div>
            {Object.keys(result.overflow || {}).length > 0 && (
              <div className="mt-2 pt-2 border-t border-red-300 text-xs">
                <strong>Overflow:</strong> {Object.entries(result.overflow).map(([m, sqft]) => `${sqft} sqft ${m}`).join(", ")} needed via rental
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={!previewResult} className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold ${previewResult ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}>Save Draft (48hr)</button>
        </div>
      </div>
    </Modal>
  );
}

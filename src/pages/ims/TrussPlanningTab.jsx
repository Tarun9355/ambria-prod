import { useState, useEffect, useMemo } from "react";
import { allocateForDate, applyOverridesToEvents, expireStaleSimulations, isDeptHead, buildEventAllocation, simulateImpact, TRUSS_AUDIT_SK, TRUSS_OVERRIDES_SK, TRUSS_SIMULATIONS_SK } from "../../lib/ims/trussEngine";
import { kvGet, reliableSave } from "../../lib/ims/kv";
import { Modal } from "../../components/ui";

export default function TrussPlanningTab({ trussAlloc, setTrussAlloc, trussInv, eventOrders, authUser }){
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [overrides, setOverrides] = useState({});
  const [simulations, setSimulations] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [expandedEvents, setExpandedEvents] = useState({});
  const [customizeTarget, setCustomizeTarget] = useState(null);  // {eoId, zoneKey, truss}
  const [showSimDialog, setShowSimDialog] = useState(false);
  const [showSimResult, setShowSimResult] = useState(null);  // simulation result preview
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const canEdit = isDeptHead(authUser);

  // Load overrides + simulations + audit log on mount
  useEffect(() => {
    (async () => {
      try {
        const v = await kvGet(TRUSS_OVERRIDES_SK);
        let parsed = v;
        for (let i = 0; i < 2; i++) { if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} } }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setOverrides(parsed);
      } catch {}
      try {
        const v = await kvGet(TRUSS_SIMULATIONS_SK);
        let parsed = v;
        for (let i = 0; i < 2; i++) { if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} } }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Auto-prune expired
          const cleaned = expireStaleSimulations(parsed, Date.now()) || parsed;
          setSimulations(cleaned);
        }
      } catch {}
      try {
        const v = await kvGet(TRUSS_AUDIT_SK);
        let parsed = v;
        for (let i = 0; i < 2; i++) { if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch {} } }
        if (Array.isArray(parsed)) setAuditLog(parsed.slice(-50).reverse()); // newest first
      } catch {}
    })();
  }, []);

  // Date entry & events
  const dateEntry = trussAlloc?.[selectedDate] || null;
  const dateEvents = useMemo(() => {
    const raw = Array.isArray(dateEntry?.events) ? dateEntry.events : [];
    return applyOverridesToEvents(raw, overrides);
  }, [dateEntry, overrides]);
  const stockSummary = dateEntry?.stockSummary || null;

  // Date navigation
  const shiftDay = (delta) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  // Active simulations for this date
  const dateSimulations = useMemo(() => {
    return Object.values(simulations).filter(s => s.date === selectedDate);
  }, [simulations, selectedDate]);

  // Stock pressure visual (per-size color bars)
  const stockBars = useMemo(() => {
    if (!trussInv) return { pillars: [], beams: [] };
    const buildBars = (kind) => {
      const items = trussInv[kind] || {};
      const used = (kind === "pillars") ? (stockSummary?.demandPillars || {}) : (stockSummary?.demandBeams || {});
      const soft = (kind === "pillars") ? (stockSummary?.softPillars || {}) : (stockSummary?.softBeams || {});
      const hard = (kind === "pillars") ? (stockSummary?.hardPillars || {}) : (stockSummary?.hardBeams || {});
      return Object.entries(items).map(([sz, item]) => {
        const total = Number(item?.stock) || 0;
        const usedQty = Number(used[sz]) || 0;
        const softQty = Number(soft[sz]) || 0;
        const hardQty = Number(hard[sz]) || 0;
        const available = Math.max(0, total - usedQty);
        const pct = total > 0 ? Math.round((usedQty / total) * 100) : 0;
        const color = pct >= 100 ? "red" : pct >= 85 ? "amber" : pct >= 50 ? "yellow" : "green";
        return { size: sz, total, usedQty, softQty, hardQty, available, pct, color };
      }).sort((a, b) => Number(b.size) - Number(a.size));
    };
    return { pillars: buildBars("pillars"), beams: buildBars("beams") };
  }, [trussInv, stockSummary]);

  // Shortage events
  const shortageEvents = useMemo(() => dateEvents.filter(ev => ev.shortageBorne || ev.selfShortage), [dateEvents]);

  // Save handlers (writes to Redis + state)
  const saveOverrides = async (newOverrides) => {
    setOverrides(newOverrides);
    try { await reliableSave(TRUSS_OVERRIDES_SK, JSON.stringify(newOverrides), "Truss Overrides"); } catch {}
  };
  const saveSimulations = async (newSims) => {
    setSimulations(newSims);
    try { await reliableSave(TRUSS_SIMULATIONS_SK, JSON.stringify(newSims), "Truss Simulations"); } catch {}
  };

  const applyOverride = async (eoId, zoneKey, ovrData) => {
    const key = `${eoId}:${zoneKey}`;
    const next = { ...overrides, [key]: { ...ovrData, overrideBy: authUser?.name || "—", overrideAt: Date.now(), locked: true } };
    await saveOverrides(next);
    // Append audit log
    try {
      const existing = await kvGet(TRUSS_AUDIT_SK);
      const arr = existing ? (JSON.parse(existing) || []) : [];
      arr.push({ ts: Date.now(), date: selectedDate, event: "override-applied", eoId, zoneKey, by: authUser?.name || "—", reason: ovrData.reason || "" });
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      await reliableSave(TRUSS_AUDIT_SK, JSON.stringify(trimmed), "Truss audit (override)");
      setAuditLog(trimmed.slice(-50).reverse());
    } catch {}
    // Trigger Layer 4 re-cascade for this date — locked entries preserved automatically
    if (dateEntry && trussInv) {
      const recomputed = allocateForDate(trussAlloc, selectedDate, dateEntry.events, trussInv, `override-by-${authUser?.name || "—"}`);
      setTrussAlloc(recomputed);
    }
    setCustomizeTarget(null);
  };

  const removeOverride = async (key) => {
    if (!canEdit) return;
    if (!confirm("Remove this override? The truss will re-cascade with the auto-allocator.")) return;
    const next = { ...overrides };
    delete next[key];
    await saveOverrides(next);
    try {
      const existing = await kvGet(TRUSS_AUDIT_SK);
      const arr = existing ? (JSON.parse(existing) || []) : [];
      arr.push({ ts: Date.now(), date: selectedDate, event: "override-removed", key, by: authUser?.name || "—" });
      const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
      await reliableSave(TRUSS_AUDIT_SK, JSON.stringify(trimmed), "Truss audit (override removed)");
      setAuditLog(trimmed.slice(-50).reverse());
    } catch {}
    if (dateEntry && trussInv) {
      const recomputed = allocateForDate(trussAlloc, selectedDate, dateEntry.events, trussInv, `override-removed-by-${authUser?.name || "—"}`);
      setTrussAlloc(recomputed);
    }
  };

  const saveSimulation = async (sim) => {
    const simId = sim.id || `sim-${Date.now().toString(36)}`;
    const next = { ...simulations, [simId]: { ...sim, id: simId, expiresAt: Date.now() + 48 * 60 * 60 * 1000 } };
    await saveSimulations(next);
    setShowSimResult(null);
    setShowSimDialog(false);
  };

  const discardSimulation = async (simId) => {
    const next = { ...simulations };
    delete next[simId];
    await saveSimulations(next);
  };

  const convertSimToDeal = async (sim) => {
    if (!canEdit) return;
    if (!trussInv) return;
    if (!confirm(`Convert "${sim.label}" to a soft-hold reservation? This will appear in Studio Deal Check too.`)) return;
    // Create a soft-hold event in trussAlloc with this client (sim becomes a real reservation)
    const syntheticFns = [{
      fnIdx: 0,
      date: sim.date,
      zones: {},
      enabledEls: {},
    }];
    (sim.zones || []).forEach((z, idx) => {
      const zoneKey = `sim-converted-${idx}`;
      syntheticFns[0].zones[zoneKey] = { dims: { L: z.L, W: z.W, H: z.H }, trussType: z.config };
      syntheticFns[0].enabledEls[zoneKey] = true;
    });
    const evEntry = buildEventAllocation({
      eoId: `sim-deal-${sim.id}`,
      clientId: `sim-deal-${sim.id}`,
      clientName: sim.label || "Converted Simulation",
      fnIdx: 0,
      state: "soft",
      expiry: Date.now() + 24 * 60 * 60 * 1000,
      heldBy: authUser?.name || sim.createdBy || "Dept Head",
      createdAt: Date.now(),
    }, syntheticFns, trussInv);
    if (!evEntry.trusses || evEntry.trusses.length === 0) { alert("Conversion failed: no valid trusses"); return; }
    let nextAlloc = { ...trussAlloc };
    const dateE = nextAlloc[sim.date] || { events: [] };
    const existingEvents = Array.isArray(dateE.events) ? [...dateE.events] : [];
    existingEvents.push(evEntry);
    nextAlloc[sim.date] = { ...dateE, events: existingEvents };
    nextAlloc = allocateForDate(nextAlloc, sim.date, existingEvents, trussInv, `sim-conversion-by-${authUser?.name || "—"}`);
    setTrussAlloc(nextAlloc);
    // Remove from drafts
    await discardSimulation(sim.id);
    alert("Converted to soft-hold reservation. Visible in Studio Deal Check.");
  };

  // Fmt helpers
  const fmtRs = (n) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
  const fmtTs = (ts) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div className="space-y-5">
      {/* ───────────── 1. HEADER ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              🏗️ Truss Planning Dashboard
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {canEdit ? "Department head access · override + simulator enabled" : "Read-only view · override gated to dept heads"}
            </p>
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

      {/* ───────────── 2. STOCK STATUS BAR ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📊 Stock Availability — {selectedDate}</h3>
        {!trussInv ? (
          <p className="text-sm text-amber-700">Truss inventory not loaded. Visit Settings → Truss & Batta.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">PILLARS</p>
              <div className="space-y-1.5">
                {stockBars.pillars.map(bar => (
                  <div key={"p-"+bar.size} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-gray-700 font-medium">{bar.size}ft</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                      <div className={`h-full ${bar.color === "red" ? "bg-red-500" : bar.color === "amber" ? "bg-amber-500" : bar.color === "yellow" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: bar.pct + "%" }}></div>
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-800">{bar.usedQty} / {bar.total} ({bar.pct}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">BEAMS</p>
              <div className="space-y-1.5">
                {stockBars.beams.map(bar => (
                  <div key={"b-"+bar.size} className="flex items-center gap-2 text-xs">
                    <span className="w-12 text-gray-700 font-medium">{bar.size}ft</span>
                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                      <div className={`h-full ${bar.color === "red" ? "bg-red-500" : bar.color === "amber" ? "bg-amber-500" : bar.color === "yellow" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: bar.pct + "%" }}></div>
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-800">{bar.usedQty} / {bar.total} ({bar.pct}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ───────────── 3. SHORTAGE ALERTS ───────────── */}
      {shortageEvents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">⚠️ Shortage Alerts · {shortageEvents.length} event{shortageEvents.length === 1 ? "" : "s"}</h3>
          <div className="space-y-2">
            {shortageEvents.map(ev => (
              <div key={ev.eoId} className="bg-white rounded-lg p-3 border border-red-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{ev.clientName || "—"} ({ev.state})</p>
                    <p className="text-xs text-gray-600 mt-1">{ev.shortageNotes?.join(" · ") || "Pool shortage attributed (last-added)"}</p>
                  </div>
                  <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Rental required</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───────────── 4. FUNCTIONS LIST ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📋 Events on {selectedDate}</h3>
        {dateEvents.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No events on this date. Click "+ New Simulation" below to test stock availability for a hypothetical event.</p>
        ) : (
          <div className="space-y-2">
            {dateEvents.map(ev => {
              const isOpen = !!expandedEvents[ev.eoId];
              const stateColor = ev.state === "hard" ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800";
              const stateLabel = ev.state === "hard" ? "🔒 SOLD" : "🕒 SOFT";
              const totalP = Object.values(ev.totalPillarsUsed || {}).reduce((s, n) => s + n, 0);
              const totalB = Object.values(ev.totalBeamsUsed || {}).reduce((s, n) => s + n, 0);
              return (
                <div key={ev.eoId} className={`rounded-lg border ${ev.shortageBorne ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}>
                  <button onClick={() => setExpandedEvents(s => ({ ...s, [ev.eoId]: !s[ev.eoId] }))} className="w-full p-3 text-left hover:bg-gray-50 flex items-center gap-3">
                    <span className="text-xs">{isOpen ? "▼" : "▶"}</span>
                    <span className="flex-1">
                      <span className="font-semibold text-sm text-gray-900">{ev.clientName || "—"}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${stateColor}`}>{stateLabel}</span>
                      {ev.hasOverride && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-800">📝 OVERRIDE</span>}
                      {ev.shortageBorne && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-200 text-red-900">⚠ SHORTAGE</span>}
                    </span>
                    <span className="text-xs text-gray-600">{ev.trusses?.length || 0} truss · {totalP}P+{totalB}B</span>
                    <span className="text-xs text-gray-500">by {ev.heldBy || "—"}</span>
                  </button>
                  {isOpen && (
                    <div className="p-3 border-t border-gray-200 space-y-2">
                      {(ev.trusses || []).map((t, ti) => {
                        const key = `${ev.eoId}:${t.zoneKey}`;
                        const isLocked = !!t.locked;
                        const tPillars = Object.entries(t.allocation?.totals?.pillarsUsed || {}).map(([s,q]) => `${q}× ${s}ft`).join(", ");
                        const tBeams = Object.entries(t.allocation?.totals?.beamsUsed || {}).map(([s,q]) => `${q}× ${s}ft`).join(", ");
                        // §2.5.1 corollary (28 May 2026) — show requirement (L×W×H + back depth + source)
                        // so dept head sees what salesperson committed alongside the derived pieces.
                        // For legacy trussAlloc entries (pre-28 May) missing `requirement`, derive
                        // from eventOrders[ev.eoId].functionsDetail[t.fnIdx].zones[t.zoneKey] on the fly.
                        let req = t.requirement;
                        if (!req && Array.isArray(eventOrders)) {
                          const legacyEo = eventOrders.find(e => e.id === ev.eoId);
                          if (legacyEo) {
                            const fnsDetail = Array.isArray(legacyEo.functionsDetail) ? legacyEo.functionsDetail : null;
                            const fnIdx = typeof t.fnIdx === "number" ? t.fnIdx : 0;
                            const fnDet = fnsDetail ? (fnsDetail.find(f => (typeof f.fnIdx === "number" ? f.fnIdx : 0) === fnIdx) || fnsDetail[0]) : null;
                            const legacyZones = fnDet?.zones || legacyEo.zones || {};
                            const zc = legacyZones[t.zoneKey];
                            if (zc) {
                              const L = parseFloat(zc.dims?.L) || 0;
                              const W = parseFloat(zc.dims?.W) || 0;
                              const H = parseFloat(zc.dims?.H) || 0;
                              // Mirror resolveTrussConfig logic for source inference
                              const isFilled = (v) => (typeof v === "number" ? v > 0 : (v != null && String(v).trim() !== "" && parseFloat(v) > 0));
                              const hasL = isFilled(zc.dims?.L), hasW = isFilled(zc.dims?.W), hasH = isFilled(zc.dims?.H);
                              let source = "unknown";
                              if (hasH && hasL && hasW) source = "auto-3dim";
                              else if (zc.trussType === "u_only" || zc.trussType === "half_box") source = "sales-pick";
                              else if (hasH && (hasL || hasW)) source = "default-on-forget";
                              const spanFt = hasL ? L : W;
                              const backDepth = parseFloat(zc.trussBackDepth) || 4;
                              req = { L, W, H, spanFt, backDepth, source };
                            }
                          }
                        }
                        let reqLine = null;
                        if (req) {
                          // §23 Phase 5 (28 May 2026 — Tarun lock) — compute ACTUAL physical width
                          // from the allocation, not the entered span. Format: "63ft → 62.25ft actual".
                          // For full_box: show L → L_actual × W → W_actual.
                          // For half_box / u_only: show span → span_actual.
                          const pillarWidth = 0.75; // physical per pillar (matches buildTopology)
                          // Sum allocated beam length on the L (front) axis from allocation.beamSegments
                          const beamSegs = t.allocation?.beamSegments || [];
                          const segLenSum = (filterFn) => beamSegs.filter(filterFn).reduce((s, b) => {
                            // beam pieces array: sum of size*qty
                            const len = (b.pieces || []).reduce((p, pc) => p + (pc.size * pc.qty), 0);
                            return s + len;
                          }, 0);
                          // Total pillar count for span direction (front axis)
                          const totalPillarCount = Object.values(t.allocation?.totals?.pillarsUsed || {}).reduce((s, q) => s + q, 0);
                          // Estimate front-axis pillar count: total minus back corners (for half_box only)
                          let frontPillars = totalPillarCount;
                          if (t.trussConfig === "half_box") frontPillars = Math.max(2, totalPillarCount - 2);
                          else if (t.trussConfig === "full_box") frontPillars = Math.ceil(totalPillarCount / 2); // rough estimate when L/W split unknown
                          // Compute physical L = front beam sum + frontPillars × 0.75
                          let frontBeamLen = 0;
                          if (t.trussConfig === "full_box") {
                            frontBeamLen = segLenSum(b => String(b.side || "").startsWith("front"));
                          } else {
                            frontBeamLen = segLenSum(b => String(b.side || "").startsWith("front") || b.side === "top" || String(b.side || "").startsWith("top"));
                          }
                          const physicalL = frontBeamLen + frontPillars * pillarWidth;
                          // For full_box: also compute physical W
                          let physicalW = 0;
                          if (t.trussConfig === "full_box") {
                            const sideBeamLen = segLenSum(b => String(b.side || "").startsWith("left"));
                            // W-axis pillars: 2 left-corners shared with L + W-mid count
                            // Quick estimate: pillarsUsed across all sizes ÷ axes (rough; not perfect but ok for display)
                            const wAxisPillars = Math.max(2, totalPillarCount - frontPillars - (frontPillars - 2)); // back row has same pillar count as front but no mid (for half_box doesn't apply)
                            // Simpler: count distinct W beams (1 per gap) + 2 corners
                            const wSegmentCount = beamSegs.filter(b => String(b.side || "").startsWith("left")).length;
                            const wPillarCount = wSegmentCount + 1; // gaps + 1 = pillars on that axis
                            physicalW = sideBeamLen + wPillarCount * pillarWidth;
                          }

                          const parts = [];
                          // Format: entered → actual
                          if (t.trussConfig === "full_box") {
                            if (req.L > 0) {
                              const pL = physicalL.toFixed(2).replace(/\.?0+$/, "");
                              parts.push(`${req.L}ft L → ${pL}ft actual`);
                            }
                            if (req.W > 0) {
                              const pW = physicalW.toFixed(2).replace(/\.?0+$/, "");
                              parts.push(`${req.W}ft W → ${pW}ft actual`);
                            }
                            if (req.H > 0) parts.push(`${req.H}ft H`);
                          } else {
                            if (req.spanFt > 0) {
                              const pL = physicalL.toFixed(2).replace(/\.?0+$/, "");
                              parts.push(`${req.spanFt}ft span → ${pL}ft actual`);
                            }
                            if (req.H > 0) parts.push(`${req.H}ft H`);
                          }
                          // Back depth only meaningful for half_box / full_box
                          if (t.trussConfig !== "u_only" && req.backDepth > 0) {
                            parts.push(`back: ${req.backDepth}ft`);
                          }
                          // Pillar breakdown
                          let pillarLabel = "";
                          if (t.trussConfig === "u_only") {
                            const mid = Math.max(0, totalPillarCount - 2);
                            pillarLabel = mid > 0 ? `${totalPillarCount} pillars (${mid} mid)` : `${totalPillarCount} pillars`;
                          } else if (t.trussConfig === "half_box") {
                            const mid = Math.max(0, totalPillarCount - 4);
                            pillarLabel = mid > 0 ? `${totalPillarCount} pillars (${mid} mid)` : `${totalPillarCount} pillars`;
                          } else if (t.trussConfig === "full_box") {
                            const mid = Math.max(0, totalPillarCount - 4);
                            pillarLabel = mid > 0 ? `${totalPillarCount} pillars (${mid} mid)` : `${totalPillarCount} pillars`;
                          } else {
                            pillarLabel = `${totalPillarCount} pillars`;
                          }
                          // Source
                          const sourceLabel = req.source === "sales-pick" ? "salesperson picked"
                                            : req.source === "auto-3dim" ? "auto (all 3 dims)"
                                            : req.source === "default-on-forget" ? "⚠ default (no pick)"
                                            : req.source === "unknown" ? "source unknown (legacy)"
                                            : req.source;
                          const sourceClass = req.source === "default-on-forget" ? "text-amber-700 font-medium"
                                            : req.source === "unknown" ? "text-gray-400 italic"
                                            : "text-gray-500";
                          reqLine = (
                            <p className="text-xs text-gray-700 mt-1">
                              <strong className="text-gray-600">Requirement:</strong> {parts.join(" · ")}
                              {" · "}
                              <span className="text-gray-600">{pillarLabel}</span>
                              {" · "}
                              <span className={sourceClass}>{sourceLabel}</span>
                            </p>
                          );
                        }
                        return (
                          <div key={ti} className={`rounded p-3 border ${isLocked ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-gray-50"}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  Zone: <strong>{t.zoneKey}</strong> · <span className="text-xs text-gray-600">{t.trussConfig}</span>
                                  {isLocked && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-purple-200 text-purple-900">🔒 LOCKED</span>}
                                </p>
                                {reqLine}
                                <p className="text-xs text-gray-600 mt-1">Pillars: {tPillars || "—"} · Beams: {tBeams || "—"}</p>
                                <p className="text-xs text-gray-600">Joints: {t.allocation?.totals?.totalJoints || 0}</p>
                                {t.override?.reason && <p className="text-xs italic text-purple-700 mt-1">Override reason: "{t.override.reason}" — by {t.override.overrideBy}</p>}
                              </div>
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => canEdit && setCustomizeTarget({ eoId: ev.eoId, zoneKey: t.zoneKey, truss: t })}
                                  disabled={!canEdit}
                                  className={`text-xs px-3 py-1 rounded ${canEdit ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}
                                  title={canEdit ? "Customize this truss" : "Dept head only"}
                                >
                                  📝 Customize
                                </button>
                                {isLocked && canEdit && (
                                  <button onClick={() => removeOverride(key)} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────── 5. SIMULATOR ───────────── */}
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
              const computed = sim.computed || simulateImpact(sim, dateEntry, dateSimulations.filter(s => s.id !== sim.id), trussInv);
              const statusColor = computed?.status === "red" ? "bg-red-100 text-red-800" : computed?.status === "yellow" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";
              const statusEmoji = computed?.status === "red" ? "🔴" : computed?.status === "yellow" ? "🟡" : "🟢";
              return (
                <div key={sim.id} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900">✏️ {sim.label} <span className="text-xs text-gray-500">({sim.mode})</span></p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {(sim.zones || []).map(z => `${z.name || "zone"}: ${z.config} ${z.L||"—"}×${z.W||"—"}×${z.H||"—"}`).join(" · ")}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        By {sim.createdBy || "—"} · Expires {fmtTs(sim.expiresAt)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-1 rounded ${statusColor}`}>{statusEmoji} {computed?.reason || "—"}</span>
                      <span className="text-xs text-gray-600">{fmtRs(computed?.cost)} · {computed?.pressure}% stock</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {canEdit && (
                      <button onClick={() => convertSimToDeal(sim)} className="text-xs px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white">
                        ➜ Convert to Soft Hold
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={() => discardSimulation(sim.id)} className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">
                        Discard
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ───────────── 6. CASCADE HISTORY ───────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <button onClick={() => setHistoryExpanded(s => !s)} className="w-full text-left flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">📜 Cascade History · {auditLog.length} entr{auditLog.length === 1 ? "y" : "ies"} (last 50)</h3>
          <span className="text-xs">{historyExpanded ? "▼" : "▶"}</span>
        </button>
        {historyExpanded && (
          <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
            {auditLog.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No audit entries yet.</p>
            ) : (
              auditLog.map((entry, idx) => (
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
              ))
            )}
          </div>
        )}
      </div>

      {/* ───────────── CUSTOMIZE DIALOG ───────────── */}
      {customizeTarget && (
        <CustomizeDialog
          target={customizeTarget}
          onClose={() => setCustomizeTarget(null)}
          onSave={(ovrData) => applyOverride(customizeTarget.eoId, customizeTarget.zoneKey, ovrData)}
          trussInv={trussInv}
        />
      )}

      {/* ───────────── NEW SIMULATION DIALOG ───────────── */}
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

// ─── Phase 4 — Customize Dialog (override modal) ────────────────────────────
function CustomizeDialog({ target, onClose, onSave, trussInv }){
  const t = target.truss;
  const [config, setConfig] = useState(t.trussConfig || "half_box");
  const [backDepth, setBackDepth] = useState(t.allocation?.totals?.physicalW || 4);
  const [reason, setReason] = useState("");

  const handleSave = () => {
    if (!reason.trim()) { alert("Please provide a reason for this override."); return; }
    onSave({
      customConfig: config,
      customBackDepth: Number(backDepth) || 4,
      reason: reason.trim(),
    });
  };

  return (
    <Modal open={true} onClose={onClose} title="📝 Customize Truss" wide>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-xs">
          <p className="text-gray-700"><strong>Event:</strong> {target.eoId}</p>
          <p className="text-gray-700"><strong>Zone:</strong> {target.zoneKey}</p>
          <p className="text-gray-700"><strong>Current config:</strong> {t.trussConfig}</p>
          <p className="text-gray-700"><strong>Current totals:</strong> {Object.values(t.allocation?.totals?.pillarsUsed || {}).reduce((s,n)=>s+n,0)} pillars + {Object.values(t.allocation?.totals?.beamsUsed || {}).reduce((s,n)=>s+n,0)} beams</p>
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Force Configuration</label>
          <select value={config} onChange={e => setConfig(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="u_only">🟢 U Truss</option>
            <option value="half_box">🟡 Half Box Truss</option>
            <option value="full_box">🔴 Full Box</option>
          </select>
        </div>
        {config === "half_box" && (
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Back Depth: {backDepth} ft</label>
            <input type="range" min="3" max="6" step="0.5" value={backDepth} onChange={e => setBackDepth(e.target.value)} className="w-full" />
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Reason (required) <span className="text-red-500">*</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Standalone setup, no plywood support; client wants exposed beams" rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"></textarea>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          <strong>⚠️ Cascade impact:</strong> Saving this override will trigger a pool re-allocation for this date. Other events may be re-shuffled. Locked entries (already overridden) are preserved.
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">Save Override</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Phase 4 — New Simulation Dialog (what-if modal) ────────────────────────
function NewSimulationDialog({ selectedDate, trussInv, dateEntry, dateSimulations, authUser, onClose, onSave }){
  const [label, setLabel] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [mode, setMode] = useState("compound");
  const [zones, setZones] = useState([{ name: "Stage", config: "full_box", L: "", W: "", H: "" }]);
  const [previewResult, setPreviewResult] = useState(null);

  const addZone = () => setZones(s => [...s, { name: `Zone ${s.length + 1}`, config: "u_only", L: "", W: "", H: "" }]);
  const removeZone = (idx) => setZones(s => s.filter((_, i) => i !== idx));
  const updateZone = (idx, field, val) => setZones(s => s.map((z, i) => i === idx ? { ...z, [field]: val } : z));

  const handlePreview = () => {
    if (!label.trim()) { alert("Please provide a label."); return; }
    const validZones = zones.filter(z => z.H && (z.L || z.W));
    if (validZones.length === 0) { alert("At least one zone with H + L/W is required."); return; }
    const tempSim = {
      date: selectedDate,
      label: label.trim(),
      salesperson: salesperson.trim() || authUser?.name || "—",
      createdBy: authUser?.name || "—",
      mode,
      zones: validZones.map(z => ({
        name: z.name,
        config: z.config,
        L: Number(z.L) || 0,
        W: Number(z.W) || 0,
        H: Number(z.H) || 0,
      })),
    };
    const result = simulateImpact(tempSim, dateEntry, dateSimulations, trussInv);
    setPreviewResult({ sim: tempSim, computed: result });
  };

  const handleSave = () => {
    if (!previewResult) { alert("Please preview first."); return; }
    onSave({ ...previewResult.sim, computed: previewResult.computed });
  };

  const result = previewResult?.computed;
  const statusColor = result?.status === "red" ? "bg-red-100 text-red-800 border-red-300" : result?.status === "yellow" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-green-100 text-green-800 border-green-300";

  return (
    <Modal open={true} onClose={onClose} title="🧪 New Simulation" wide>
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
            <label className="text-xs font-medium text-gray-700">Zones</label>
            <button onClick={addZone} className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded">+ Add Zone</button>
          </div>
          <div className="space-y-2">
            {zones.map((z, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 grid grid-cols-12 gap-2 items-center">
                <input value={z.name} onChange={e => updateZone(idx, "name", e.target.value)} placeholder="Name" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <select value={z.config} onChange={e => updateZone(idx, "config", e.target.value)} className="col-span-3 px-2 py-1.5 border border-gray-300 rounded text-xs">
                  <option value="u_only">U Truss</option>
                  <option value="half_box">Half Box</option>
                  <option value="full_box">Full Box</option>
                </select>
                <input type="number" value={z.L} onChange={e => updateZone(idx, "L", e.target.value)} placeholder="L" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <input type="number" value={z.W} onChange={e => updateZone(idx, "W", e.target.value)} placeholder="W" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <input type="number" value={z.H} onChange={e => updateZone(idx, "H", e.target.value)} placeholder="H" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                {zones.length > 1 && <button onClick={() => removeZone(idx)} className="col-span-1 text-red-600 hover:text-red-800 text-xs">×</button>}
              </div>
            ))}
          </div>
        </div>

        <button onClick={handlePreview} className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
          🔍 Check Availability
        </button>

        {result && (
          <div className={`border rounded-lg p-4 ${statusColor}`}>
            <p className="font-semibold mb-2">{result.status === "red" ? "🔴" : result.status === "yellow" ? "🟡" : "🟢"} {result.reason}</p>
            <div className="text-xs space-y-1">
              <p>Pillars needed: {Object.entries(result.pieces?.pillars || {}).map(([s, q]) => `${q}× ${s}ft`).join(", ") || "—"}</p>
              <p>Beams needed: {Object.entries(result.pieces?.beams || {}).map(([s, q]) => `${q}× ${s}ft`).join(", ") || "—"}</p>
              <p>Joints: {result.totalJoints || 0} · Pillar RFT: {result.pillarRft || 0} · Beam RFT: {result.beamRft || 0}</p>
              <p className="font-semibold mt-2">Cost estimate: ₹{Math.round(result.cost || 0).toLocaleString("en-IN")} · Stock pressure: {result.pressure || 0}%</p>
            </div>
            {Object.keys(result.overflow?.pillars || {}).length > 0 || Object.keys(result.overflow?.beams || {}).length > 0 ? (
              <div className="mt-2 pt-2 border-t border-red-300 text-xs">
                <strong>Overflow:</strong> {[...Object.entries(result.overflow.pillars || {}).map(([s,q]) => `${q}× ${s}ft pillar`), ...Object.entries(result.overflow.beams || {}).map(([s,q]) => `${q}× ${s}ft beam`)].join(", ")} needed via rental
              </div>
            ) : null}
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

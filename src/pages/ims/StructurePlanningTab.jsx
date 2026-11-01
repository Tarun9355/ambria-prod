import { useState, useEffect, useMemo } from "react";
import {
  allocateForDate, applyOverridesToEvents, expireStaleSimulations, isDeptHead, simulateImpact,
} from "../../lib/ims/trussEngine";
import { allocatePlatformForDate, applyPlatformOverridesToEvents, platformStockSqft, PLATFORM_MATERIALS, simulatePlatformImpact } from "../../lib/ims/platformEngine";
import { allocateBattaForDate, applyBattaOverridesToEvents, battaStockRft, BATTA_MATERIALS, simulateBattaImpact } from "../../lib/ims/battaEngine";
import { fetchAll, supabase } from "../../lib/supabase";
import { Modal } from "../../components/ui";

const MAT_LABEL = { iron: "⛓️ Iron", pole: "🪵 Pole", aluminium: "⚙️ Aluminium" };

// One combined Planning view for truss + platform + batta, replacing the 3 separate tabs (owner
// ask, 2026-11-01: "group these 3 truss, platform and batta in 1" — they're always checked for the
// same date against the same event anyway, see scanTrussStockShortage's pre-sale gate in
// StudioApp.jsx). One date picker drives all three pools; the events list merges each event's
// truss/platform/batta need into one row instead of three separate lists to cross-reference.
// Per-domain overrides/simulator stay as their own small dialogs (the underlying math genuinely is
// three different models — pieces+joints vs. two flat pools — collapsing those into one form would
// hide more than it'd simplify), opened from the one shared events list instead of three tabs.
export default function StructurePlanningTab({ trussAlloc, setTrussAlloc, platformAlloc, setPlatformAlloc, battaAlloc, setBattaAlloc, trussInv, eventOrders, authUser }) {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [overrides, setOverrides] = useState({ truss: {}, platform: {}, batta: {} });
  const [simulations, setSimulations] = useState({ truss: {}, platform: {}, batta: {} });
  const [auditLog, setAuditLog] = useState({ truss: [], platform: [], batta: [] });
  const [expandedEvents, setExpandedEvents] = useState({});
  const [simDialog, setSimDialog] = useState(null); // "truss" | "platform" | "batta"
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const canEdit = isDeptHead(authUser);

  // Three domains, same shape each — loaded/subscribed identically, just against different tables.
  const DOMAINS = useMemo(() => ([
    { key: "truss", overridesTable: "truss_overrides", simsTable: "truss_simulations", auditTable: "truss_audit" },
    { key: "platform", overridesTable: "platform_overrides", simsTable: "platform_simulations", auditTable: "platform_audit" },
    { key: "batta", overridesTable: "batta_overrides", simsTable: "batta_simulations", auditTable: "batta_audit" },
  ]), []);

  useEffect(() => {
    const channels = [];
    DOMAINS.forEach(({ key, overridesTable, simsTable, auditTable }) => {
      const loadOverrides = async () => { try { const rows = await fetchAll(overridesTable); if (Array.isArray(rows)) setOverrides((p) => ({ ...p, [key]: Object.fromEntries(rows.map(r => [r.id, r.data || {}])) })); } catch {} };
      const loadSims = async () => { try { const rows = await fetchAll(simsTable); if (Array.isArray(rows)) { const obj = Object.fromEntries(rows.map(r => [r.id, r.data || {}])); setSimulations((p) => ({ ...p, [key]: expireStaleSimulations(obj, Date.now()) || obj })); } } catch {} };
      const loadAudit = async () => { try { const { data } = await supabase.from(auditTable).select("data").order("id", { ascending: false }).limit(50); if (Array.isArray(data)) setAuditLog((p) => ({ ...p, [key]: data.map(r => r.data).filter(Boolean) })); } catch {} };
      loadOverrides(); loadSims(); loadAudit();
      channels.push(supabase.channel(`realtime:${overridesTable}`).on("postgres_changes", { event: "*", schema: "public", table: overridesTable }, loadOverrides).subscribe());
      channels.push(supabase.channel(`realtime:${simsTable}`).on("postgres_changes", { event: "*", schema: "public", table: simsTable }, loadSims).subscribe());
    });
    return () => { channels.forEach((ch) => { try { supabase.removeChannel(ch); } catch {} }); };
  }, [DOMAINS]);

  const allocByDomain = { truss: trussAlloc, platform: platformAlloc, batta: battaAlloc };
  const setAllocByDomain = { truss: setTrussAlloc, platform: setPlatformAlloc, batta: setBattaAlloc };
  const allocateFnByDomain = { truss: allocateForDate, platform: allocatePlatformForDate, batta: allocateBattaForDate };
  const applyOverridesFnByDomain = { truss: applyOverridesToEvents, platform: applyPlatformOverridesToEvents, batta: applyBattaOverridesToEvents };

  const dateEntryByDomain = { truss: trussAlloc?.[selectedDate] || null, platform: platformAlloc?.[selectedDate] || null, batta: battaAlloc?.[selectedDate] || null };
  const dateEventsByDomain = useMemo(() => ({
    truss: applyOverridesToEvents(Array.isArray(dateEntryByDomain.truss?.events) ? dateEntryByDomain.truss.events : [], overrides.truss),
    platform: applyPlatformOverridesToEvents(Array.isArray(dateEntryByDomain.platform?.events) ? dateEntryByDomain.platform.events : [], overrides.platform),
    batta: applyBattaOverridesToEvents(Array.isArray(dateEntryByDomain.batta?.events) ? dateEntryByDomain.batta.events : [], overrides.batta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dateEntryByDomain.truss, dateEntryByDomain.platform, dateEntryByDomain.batta, overrides]);

  const shiftDay = (delta) => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  // Merge every event id seen across all three domains into one combined row per event.
  const mergedEvents = useMemo(() => {
    const byEoId = {};
    (["truss", "platform", "batta"]).forEach((dom) => {
      dateEventsByDomain[dom].forEach((ev) => {
        if (!byEoId[ev.eoId]) byEoId[ev.eoId] = { eoId: ev.eoId, clientName: ev.clientName, state: ev.state, heldBy: ev.heldBy };
        byEoId[ev.eoId][dom] = ev;
      });
    });
    return Object.values(byEoId).sort((a, b) => (a.clientName || "").localeCompare(b.clientName || ""));
  }, [dateEventsByDomain]);

  const shortageCount = mergedEvents.filter((ev) => ev.truss?.shortageBorne || ev.platform?.shortageBorne || ev.batta?.shortageBorne).length;

  const trussStockBars = useMemo(() => {
    if (!trussInv) return { pillars: [], beams: [] };
    const sm = dateEntryByDomain.truss?.stockSummary;
    const build = (kind) => Object.entries(trussInv[kind] || {}).map(([sz, item]) => {
      const total = Number(item?.stock) || 0;
      const used = Number((kind === "pillars" ? sm?.demandPillars : sm?.demandBeams)?.[sz]) || 0;
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      return { size: sz, total, used, pct, color: pct >= 100 ? "red" : pct >= 85 ? "amber" : pct >= 50 ? "yellow" : "green" };
    }).sort((a, b) => Number(b.size) - Number(a.size));
    return { pillars: build("pillars"), beams: build("beams") };
  }, [trussInv, dateEntryByDomain.truss]);

  const platformStockBars = useMemo(() => {
    if (!trussInv) return [];
    const sm = dateEntryByDomain.platform?.stockSummary;
    return PLATFORM_MATERIALS.map((mat) => {
      const total = Math.round(platformStockSqft(trussInv, mat) * 100) / 100;
      const used = Math.round((sm?.demand?.[mat] || 0) * 100) / 100;
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      return { mat, total, used, pct, color: pct >= 100 ? "red" : pct >= 85 ? "amber" : pct >= 50 ? "yellow" : "green" };
    });
  }, [trussInv, dateEntryByDomain.platform]);

  const battaStockBars = useMemo(() => {
    if (!trussInv) return [];
    const sm = dateEntryByDomain.batta?.stockSummary;
    return BATTA_MATERIALS.map((mat) => {
      const total = Math.round(battaStockRft(trussInv, mat) * 100) / 100;
      const used = Math.round((sm?.demand?.[mat] || 0) * 100) / 100;
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      return { mat, total, used, pct, color: pct >= 100 ? "red" : pct >= 85 ? "amber" : pct >= 50 ? "yellow" : "green" };
    });
  }, [trussInv, dateEntryByDomain.batta]);

  const saveOverrides = async (domain, newOverrides) => {
    const table = DOMAINS.find((d) => d.key === domain).overridesTable;
    const prev = overrides[domain];
    setOverrides((p) => ({ ...p, [domain]: newOverrides }));
    try {
      for (const [k, val] of Object.entries(newOverrides)) if (JSON.stringify(prev[k]) !== JSON.stringify(val)) await supabase.from(table).upsert({ id: k, data: val }, { onConflict: "id" });
      for (const k of Object.keys(prev)) if (!(k in newOverrides)) await supabase.from(table).delete().eq("id", k);
    } catch {}
  };
  const saveSimulations = async (domain, newSims) => {
    const table = DOMAINS.find((d) => d.key === domain).simsTable;
    const prev = simulations[domain];
    setSimulations((p) => ({ ...p, [domain]: newSims }));
    try {
      for (const [k, val] of Object.entries(newSims)) if (JSON.stringify(prev[k]) !== JSON.stringify(val)) await supabase.from(table).upsert({ id: k, data: val }, { onConflict: "id" });
      for (const k of Object.keys(prev)) if (!(k in newSims)) await supabase.from(table).delete().eq("id", k);
    } catch {}
  };
  const removeOverride = async (domain, key) => {
    if (!canEdit) return;
    if (!confirm("Remove this override? This date will re-cascade with the auto-allocator.")) return;
    const next = { ...overrides[domain] };
    delete next[key];
    await saveOverrides(domain, next);
    const table = DOMAINS.find((d) => d.key === domain).auditTable;
    try {
      const rec = { ts: Date.now(), date: selectedDate, event: "override-removed", key, by: authUser?.name || "—" };
      await supabase.from(table).insert({ data: rec });
      setAuditLog((p) => ({ ...p, [domain]: [rec, ...p[domain]].slice(0, 50) }));
    } catch {}
    const dateEntry = dateEntryByDomain[domain];
    if (dateEntry && trussInv) setAllocByDomain[domain](allocateFnByDomain[domain](allocByDomain[domain], selectedDate, dateEntry.events, trussInv, `override-removed-by-${authUser?.name || "—"}`));
  };
  const discardSimulation = async (domain, simId) => {
    const next = { ...simulations[domain] };
    delete next[simId];
    await saveSimulations(domain, next);
  };
  const saveSimulation = async (domain, sim) => {
    const simId = sim.id || `sim-${Date.now().toString(36)}`;
    const next = { ...simulations[domain], [simId]: { ...sim, id: simId, expiresAt: Date.now() + 48 * 60 * 60 * 1000 } };
    await saveSimulations(domain, next);
    setSimDialog(null);
  };

  const fmtTs = (ts) => (ts ? new Date(ts).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—");

  const StockBarRow = ({ label, total, used, pct, color }) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-gray-700 font-medium shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
        <div className={`h-full ${color === "red" ? "bg-red-500" : color === "amber" ? "bg-amber-500" : color === "yellow" ? "bg-yellow-400" : "bg-green-500"}`} style={{ width: pct + "%" }}></div>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-800">{used} / {total} ({pct}%)</span>
      </div>
    </div>
  );

  const combinedAuditLog = useMemo(() => {
    const all = [
      ...auditLog.truss.map((e) => ({ ...e, domain: "🏗️" })),
      ...auditLog.platform.map((e) => ({ ...e, domain: "🛏️" })),
      ...auditLog.batta.map((e) => ({ ...e, domain: "🧵" })),
    ];
    return all.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 50);
  }, [auditLog]);

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-wrap items-center gap-3 justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">🏗️🛏️🧵 Structure Planning — Truss · Platform · Batta</h2>
            <p className="text-xs text-gray-500 mt-1">{canEdit ? "Department head access · override + simulator enabled" : "Read-only view · override gated to dept heads"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => shiftDay(-1)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">◀ Prev</button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium" />
          <button onClick={() => shiftDay(1)} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">Next ▶</button>
          <button onClick={() => setSelectedDate(today)} className="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg text-sm">Today</button>
          <div className="ml-auto text-sm text-gray-700"><strong>{mergedEvents.length}</strong> event{mergedEvents.length === 1 ? "" : "s"} on this date</div>
        </div>
      </div>

      {/* STOCK AVAILABILITY — all three, one card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📊 Stock Availability — {selectedDate}</h3>
        {!trussInv ? <p className="text-sm text-amber-700">Truss inventory not loaded.</p> : (
          <div className="grid md:grid-cols-3 gap-5">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">🏗️ TRUSS</p>
              <div className="space-y-1.5">
                {trussStockBars.pillars.map((b) => <StockBarRow key={"p" + b.size} label={b.size + "ft pillar"} {...b} />)}
                {trussStockBars.beams.map((b) => <StockBarRow key={"b" + b.size} label={b.size + "ft beam"} {...b} />)}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">🛏️ PLATFORM (sqft)</p>
              <div className="space-y-1.5">{platformStockBars.map((b) => <StockBarRow key={b.mat} label={MAT_LABEL[b.mat]} {...b} />)}</div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">🧵 BATTA (RFT)</p>
              <div className="space-y-1.5">{battaStockBars.map((b) => <StockBarRow key={b.mat} label={MAT_LABEL[b.mat]} {...b} />)}</div>
            </div>
          </div>
        )}
      </div>

      {/* SHORTAGE ALERTS */}
      {shortageCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-red-800 mb-3 flex items-center gap-2">⚠️ Shortage Alerts · {shortageCount} event{shortageCount === 1 ? "" : "s"}</h3>
          <div className="space-y-2">
            {mergedEvents.filter((ev) => ev.truss?.shortageBorne || ev.platform?.shortageBorne || ev.batta?.shortageBorne).map((ev) => (
              <div key={ev.eoId} className="bg-white rounded-lg p-3 border border-red-200">
                <p className="font-semibold text-gray-900 text-sm">{ev.clientName || "—"} ({ev.state})</p>
                <p className="text-xs text-gray-600 mt-1">
                  {ev.truss?.shortageBorne && "🏗️ Truss short "}
                  {ev.platform?.shortageBorne && "🛏️ Platform short "}
                  {ev.batta?.shortageBorne && "🧵 Batta short"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COMBINED EVENTS LIST */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-bold text-gray-700 mb-3">📋 Events on {selectedDate}</h3>
        {mergedEvents.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No truss, platform, or batta demand on this date.</p>
        ) : (
          <div className="space-y-2">
            {mergedEvents.map((ev) => {
              const isOpen = !!expandedEvents[ev.eoId];
              const totalP = ev.truss ? Object.values(ev.truss.totalPillarsUsed || {}).reduce((s, n) => s + n, 0) : 0;
              const totalB = ev.truss ? Object.values(ev.truss.totalBeamsUsed || {}).reduce((s, n) => s + n, 0) : 0;
              const anyShortage = ev.truss?.shortageBorne || ev.platform?.shortageBorne || ev.batta?.shortageBorne;
              const stateColor = ev.state === "hard" ? "bg-indigo-100 text-indigo-800" : "bg-amber-100 text-amber-800";
              return (
                <div key={ev.eoId} className={`rounded-lg border ${anyShortage ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}>
                  <button onClick={() => setExpandedEvents((s) => ({ ...s, [ev.eoId]: !s[ev.eoId] }))} className="w-full p-3 text-left hover:bg-gray-50 flex items-center gap-3 flex-wrap">
                    <span className="text-xs">{isOpen ? "▼" : "▶"}</span>
                    <span className="flex-1 min-w-[160px]">
                      <span className="font-semibold text-sm text-gray-900">{ev.clientName || "—"}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${stateColor}`}>{ev.state === "hard" ? "🔒 SOLD" : "🕒 SOFT"}</span>
                      {anyShortage && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-red-200 text-red-900">⚠ SHORTAGE</span>}
                    </span>
                    <span className="text-xs text-gray-600">{ev.truss ? `🏗️ ${totalP}P+${totalB}B` : ""}</span>
                    <span className="text-xs text-gray-600">{ev.platform ? `🛏️ ${PLATFORM_MATERIALS.filter((m) => ev.platform.totalPlatformSqftByMaterial?.[m] > 0).map((m) => `${ev.platform.totalPlatformSqftByMaterial[m]}sqft`).join(",")}` : ""}</span>
                    <span className="text-xs text-gray-600">{ev.batta ? `🧵 ${BATTA_MATERIALS.filter((m) => ev.batta.totalBattaRftByMaterial?.[m] > 0).map((m) => `${ev.batta.totalBattaRftByMaterial[m]}RFT`).join(",")}` : ""}</span>
                    <span className="text-xs text-gray-500">by {ev.heldBy || "—"}</span>
                  </button>
                  {isOpen && (
                    <div className="p-3 border-t border-gray-200 space-y-3 text-xs">
                      {ev.truss && (
                        <div className="flex items-center justify-between gap-2">
                          <div>🏗️ <strong>Truss:</strong> {Object.entries(ev.truss.totalPillarsUsed || {}).map(([s, q]) => `${q}×${s}ft pillar`).join(", ") || "—"} · {Object.entries(ev.truss.totalBeamsUsed || {}).map(([s, q]) => `${q}×${s}ft beam`).join(", ") || "—"}{ev.truss.override?.reason && <span className="italic text-purple-700"> · override: "{ev.truss.override.reason}"</span>}</div>
                          {ev.truss.hasOverride && canEdit && <button onClick={() => removeOverride("truss", `${ev.truss.eoId}:main`)} className="text-gray-500 hover:text-gray-800 underline shrink-0">Reset override</button>}
                        </div>
                      )}
                      {ev.platform && (
                        <div className="flex items-center justify-between gap-2">
                          <div>🛏️ <strong>Platform:</strong> {PLATFORM_MATERIALS.filter((m) => ev.platform.totalPlatformSqftByMaterial?.[m] > 0).map((m) => `${ev.platform.totalPlatformSqftByMaterial[m]} sqft ${m}`).join(", ") || "—"}{ev.platform.override?.reason && <span className="italic text-purple-700"> · override: "{ev.platform.override.reason}"</span>}</div>
                          {ev.platform.hasOverride && canEdit && <button onClick={() => removeOverride("platform", ev.platform.eoId)} className="text-gray-500 hover:text-gray-800 underline shrink-0">Reset override</button>}
                        </div>
                      )}
                      {ev.batta && (
                        <div className="flex items-center justify-between gap-2">
                          <div>🧵 <strong>Batta:</strong> {BATTA_MATERIALS.filter((m) => ev.batta.totalBattaRftByMaterial?.[m] > 0).map((m) => `${ev.batta.totalBattaRftByMaterial[m]} RFT ${m}`).join(", ") || "—"}{ev.batta.override?.reason && <span className="italic text-purple-700"> · override: "{ev.batta.override.reason}"</span>}</div>
                          {ev.batta.hasOverride && canEdit && <button onClick={() => removeOverride("batta", ev.batta.eoId)} className="text-gray-500 hover:text-gray-800 underline shrink-0">Reset override</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SIMULATOR — one button per domain, since the math genuinely differs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-bold text-gray-700">🧪 What-If Simulator</h3>
          <div className="flex gap-2">
            {DOMAINS.map(({ key }) => (
              <button key={key} onClick={() => canEdit && setSimDialog(key)} disabled={!canEdit}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold ${canEdit ? "bg-purple-600 hover:bg-purple-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}`}>
                + {key === "truss" ? "🏗️ Truss" : key === "platform" ? "🛏️ Platform" : "🧵 Batta"}
              </button>
            ))}
          </div>
        </div>
        {(["truss", "platform", "batta"]).every((d) => Object.values(simulations[d]).filter((s) => s.date === selectedDate).length === 0) ? (
          <p className="text-sm text-gray-500 italic">No active drafts on this date. Simulations expire after 48 hours.</p>
        ) : (
          <div className="space-y-2">
            {DOMAINS.map(({ key }) => Object.values(simulations[key]).filter((s) => s.date === selectedDate).map((sim) => {
              const impactFn = key === "truss" ? simulateImpact : key === "platform" ? simulatePlatformImpact : simulateBattaImpact;
              const others = Object.values(simulations[key]).filter((s) => s.id !== sim.id && s.date === selectedDate);
              const computed = sim.computed || impactFn(sim, dateEntryByDomain[key], others, trussInv);
              const statusColor = computed?.status === "red" ? "bg-red-100 text-red-800" : computed?.status === "yellow" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";
              const statusEmoji = computed?.status === "red" ? "🔴" : computed?.status === "yellow" ? "🟡" : "🟢";
              return (
                <div key={key + sim.id} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900">{key === "truss" ? "🏗️" : key === "platform" ? "🛏️" : "🧵"} {sim.label} <span className="text-xs text-gray-500">({sim.mode})</span></p>
                      <p className="text-xs text-gray-500 mt-1">By {sim.createdBy || "—"} · Expires {fmtTs(sim.expiresAt)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-1 rounded ${statusColor}`}>{statusEmoji} {computed?.reason || "—"}</span>
                      {canEdit && <button onClick={() => discardSimulation(key, sim.id)} className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">Discard</button>}
                    </div>
                  </div>
                </div>
              );
            }))}
          </div>
        )}
      </div>

      {/* CASCADE HISTORY — merged across all three */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <button onClick={() => setHistoryExpanded((s) => !s)} className="w-full text-left flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">📜 Cascade History · {combinedAuditLog.length} entr{combinedAuditLog.length === 1 ? "y" : "ies"} (last 50)</h3>
          <span className="text-xs">{historyExpanded ? "▼" : "▶"}</span>
        </button>
        {historyExpanded && (
          <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
            {combinedAuditLog.length === 0 ? <p className="text-xs text-gray-500 italic">No audit entries yet.</p> : combinedAuditLog.map((entry, idx) => (
              <div key={idx} className="text-xs flex items-start gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
                <span className="w-6 shrink-0">{entry.domain}</span>
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

      {simDialog && (
        <SimDialog
          domain={simDialog}
          selectedDate={selectedDate}
          trussInv={trussInv}
          dateEntry={dateEntryByDomain[simDialog]}
          otherDrafts={Object.values(simulations[simDialog]).filter((s) => s.date === selectedDate)}
          authUser={authUser}
          onClose={() => setSimDialog(null)}
          onSave={(sim) => saveSimulation(simDialog, sim)}
        />
      )}
    </div>
  );
}

// ─── One simulator dialog shape per domain — platform/batta share a {material, amount} row model,
// truss keeps its own {L,W,H,config} zone model since there's real topology to resolve there. ───
function SimDialog({ domain, selectedDate, trussInv, dateEntry, otherDrafts, authUser, onClose, onSave }) {
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState("compound");
  const [trussZones, setTrussZones] = useState([{ name: "Stage", config: "full_box", L: "", W: "", H: "" }]);
  const [rows, setRows] = useState([{ material: "iron", amount: "" }]);
  const [previewResult, setPreviewResult] = useState(null);
  const MATERIALS = domain === "platform" ? PLATFORM_MATERIALS : BATTA_MATERIALS;
  const unit = domain === "platform" ? "sqft" : "RFT";

  const handlePreview = () => {
    if (!label.trim()) { alert("Please provide a label."); return; }
    let tempSim;
    if (domain === "truss") {
      const validZones = trussZones.filter((z) => z.H && (z.L || z.W));
      if (validZones.length === 0) { alert("At least one zone with H + L/W is required."); return; }
      tempSim = { date: selectedDate, label: label.trim(), createdBy: authUser?.name || "—", mode, zones: validZones.map((z) => ({ name: z.name, config: z.config, L: Number(z.L) || 0, W: Number(z.W) || 0, H: Number(z.H) || 0 })) };
    } else {
      const validRows = rows.filter((r) => Number(r.amount) > 0);
      if (validRows.length === 0) { alert(`At least one row with a ${unit} amount is required.`); return; }
      tempSim = { date: selectedDate, label: label.trim(), createdBy: authUser?.name || "—", mode, zones: validRows.map((r) => (domain === "platform" ? { material: r.material, sqft: Number(r.amount) || 0 } : { material: r.material, rft: Number(r.amount) || 0 })) };
    }
    const impactFn = domain === "truss" ? simulateImpact : domain === "platform" ? simulatePlatformImpact : simulateBattaImpact;
    setPreviewResult({ sim: tempSim, computed: impactFn(tempSim, dateEntry, otherDrafts, trussInv) });
  };
  const handleSave = () => { if (!previewResult) { alert("Please preview first."); return; } onSave({ ...previewResult.sim, computed: previewResult.computed }); };
  const result = previewResult?.computed;
  const statusColor = result?.status === "red" ? "bg-red-100 text-red-800 border-red-300" : result?.status === "yellow" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-green-100 text-green-800 border-green-300";

  return (
    <Modal open={true} onClose={onClose} title={`🧪 New ${domain === "truss" ? "Truss" : domain === "platform" ? "Platform" : "Batta"} Simulation`} wide>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Label *</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sharma Wedding · Ashi" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">Mode</label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "compound"} onChange={() => setMode("compound")} /> Compound</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "independent"} onChange={() => setMode("independent")} /> Independent</label>
          </div>
        </div>
        {domain === "truss" ? (
          <div className="space-y-2">
            {trussZones.map((z, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 grid grid-cols-12 gap-2 items-center">
                <input value={z.name} onChange={(e) => setTrussZones((s) => s.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))} placeholder="Name" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <select value={z.config} onChange={(e) => setTrussZones((s) => s.map((r, i) => i === idx ? { ...r, config: e.target.value } : r))} className="col-span-3 px-2 py-1.5 border border-gray-300 rounded text-xs">
                  <option value="u_only">U Truss</option><option value="half_box">Half Box</option><option value="full_box">Full Box</option>
                </select>
                <input type="number" value={z.W} onChange={(e) => setTrussZones((s) => s.map((r, i) => i === idx ? { ...r, W: e.target.value } : r))} placeholder="Width" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <input type="number" value={z.L} onChange={(e) => setTrussZones((s) => s.map((r, i) => i === idx ? { ...r, L: e.target.value } : r))} placeholder="Depth" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                <input type="number" value={z.H} onChange={(e) => setTrussZones((s) => s.map((r, i) => i === idx ? { ...r, H: e.target.value } : r))} placeholder="Height" className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                {trussZones.length > 1 && <button onClick={() => setTrussZones((s) => s.filter((_, i) => i !== idx))} className="col-span-1 text-red-600 hover:text-red-800 text-xs">×</button>}
              </div>
            ))}
            <button onClick={() => setTrussZones((s) => [...s, { name: `Zone ${s.length + 1}`, config: "u_only", L: "", W: "", H: "" }])} className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded">+ Add Zone</button>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-3 grid grid-cols-12 gap-2 items-center">
                <select value={r.material} onChange={(e) => setRows((s) => s.map((row, i) => i === idx ? { ...row, material: e.target.value } : row))} className="col-span-5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                  {MATERIALS.map((m) => <option key={m} value={m}>{MAT_LABEL[m]}</option>)}
                </select>
                <input type="number" min="0" value={r.amount} onChange={(e) => setRows((s) => s.map((row, i) => i === idx ? { ...row, amount: e.target.value } : row))} placeholder={unit} className="col-span-5 px-2 py-1.5 border border-gray-300 rounded text-xs" />
                {rows.length > 1 && <button onClick={() => setRows((s) => s.filter((_, i) => i !== idx))} className="col-span-2 text-red-600 hover:text-red-800 text-xs">×</button>}
              </div>
            ))}
            <button onClick={() => setRows((s) => [...s, { material: "iron", amount: "" }])} className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded">+ Add Row</button>
          </div>
        )}
        <button onClick={handlePreview} className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">🔍 Check Availability</button>
        {result && (
          <div className={`border rounded-lg p-4 ${statusColor}`}>
            <p className="font-semibold mb-2">{result.status === "red" ? "🔴" : result.status === "yellow" ? "🟡" : "🟢"} {result.reason}</p>
            {result.pressure != null && <p className="text-xs font-semibold mt-1">Stock pressure: {result.pressure}%</p>}
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

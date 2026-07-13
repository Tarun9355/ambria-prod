// Read-only situational-multiplier factor breakdown — shared by IMS's Planning →
// Manpower tab, Studio's Deal Check → Manpower "how" popover, and IMS's Planning →
// Dept Ops tab, so all three show the identical pill/legend breakdown. No onClick
// handlers anywhere in this file — editing setup-access/dumping-space stays exclusive
// to ManpowerTab.jsx (the only place those fields can currently be changed).

// mode="tier3": trace is a computeTier3Trace(...) result (src/lib/ims/manpowerFactors.js). qty = final computed count.
// mode="generic": sitMult is an applySituationalMultipliers(...) result. baseQty/qty/label describe the crew type.
// showHeader/showSetupAccess: ManpowerTab.jsx renders its own wrapper + EDITABLE Setup Access
// buttons above this component, so it passes both as false to avoid a duplicate read-only copy.
// dark: Studio's Deal Check is a dark-themed panel (IMS's Manpower/Dept Ops are light) — flips
// the palette so pills don't render as light boxes on a black background.
export default function ManpowerFactorPills({ mode, trace, sitMult, baseQty, qty, label, showHeader = true, showSetupAccess = true, dark = false }) {
  if (mode === "tier3" && trace) {
    const { venueName, venueMin, segment, eventMult, dayPrior, tentative, dumpMult, sayaMult, timingMult, timingLabel, sitMax, sitWinner, heavyExtra, heavyBreakdown, sameDayFns, fn } = trace;
    return (
      <div className={showHeader ? (dark ? "bg-blue-950/30 border border-blue-800/50 rounded-xl p-3 space-y-2" : "bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2") : "space-y-2"}>
        {showHeader && <p className={"text-xs font-bold " + (dark ? "text-blue-300" : "text-blue-800")}>🏢 Labour Factor Breakdown</p>}
        {showSetupAccess && (
          <div className="flex items-center gap-2">
            <span className={"text-xs font-medium " + (dark ? "text-blue-300" : "text-blue-800")}>📅 Setup Access:</span>
            <span className={"text-xs px-2.5 py-1 rounded-lg border-2 font-medium " + (dark ? "bg-white/5 border-white/10 text-gray-300" : "bg-white border-gray-200 text-gray-600")}>
              {dayPrior ? "🟢 Day-Prior ✓" : tentative ? "🟡 Tentative" : "🔴 Same-Day"}
            </span>
            {tentative && <span className="text-xs text-amber-500 italic">Calculates as same-day (conservative)</span>}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          <span className={"text-xs rounded-full px-2 py-0.5 " + (dark ? "bg-white/5 border border-blue-800/50 text-gray-300" : "bg-white border border-blue-200")}>🏢 Venue: {venueName || "Default"} ({venueMin})</span>
          <span className={"text-xs rounded-full px-2 py-0.5 font-medium " + (dark ? "bg-blue-900/40 border border-blue-700 text-blue-300" : "bg-blue-100 border border-blue-300 text-blue-700")}>Layer 1: {segment === "outdoor_premium" ? "★ Premium" : segment === "inhouse" ? "🏠 In-house" : "$ Budgeted"} ×{eventMult}</span>
          {!dayPrior && sitMax > 1 && <span className={"text-xs rounded-full px-2 py-0.5 font-medium " + (dark ? "bg-amber-900/40 border border-amber-700 text-amber-400" : "bg-amber-100 border border-amber-300 text-amber-700")}>Layer 2: {sitWinner} (highest)</span>}
          {dayPrior && <span className={"text-xs rounded-full px-2 py-0.5 font-medium " + (dark ? "bg-green-900/40 border border-green-700 text-green-400" : "bg-green-100 border border-green-300 text-green-700")}>✅ Day-prior confirmed — no situational multiplier</span>}
        </div>
        {!dayPrior && (
          <div className="flex flex-wrap gap-1">
            {[["🚛 Dumping", dumpMult], ["👑 Saya", sayaMult], [timingLabel, timingMult]].map(([lbl, val]) => (
              <span key={lbl} className={"text-xs px-2 py-0.5 rounded-full border " + (val === sitMax && val > 1 ? "bg-amber-500 text-white border-amber-500" : dark ? "bg-white/5 text-gray-400 border-white/10" : "bg-white text-gray-500 border-gray-200")}>
                {lbl} ×{val} {val === sitMax && val > 1 ? "← used" : ""}
              </span>
            ))}
          </div>
        )}
        {heavyBreakdown?.length > 0 && (
          <div className={"text-xs " + (dark ? "text-blue-300" : "text-blue-700")}>
            <span className="font-medium">Heavy elements:</span> {heavyBreakdown.join(", ")} = +{heavyExtra}
          </div>
        )}
        {sameDayFns?.length > 1 && (
          <div className={"text-xs rounded-lg px-2 py-1.5 space-y-1 " + (dark ? "bg-purple-950/30 border border-purple-800/50 text-purple-300" : "bg-purple-50 border border-purple-200 text-purple-700")}>
            <p>🔄 {sameDayFns.length} functions same day at {venueName} — each calculates independently, MAX count used</p>
          </div>
        )}
        <div className={"rounded-lg px-3 py-2 flex items-center justify-between " + (dark ? "bg-white/5 border border-blue-800/40" : "bg-white border border-blue-100")}>
          <span className={"text-xs " + (dark ? "text-gray-400" : "text-gray-600")}>{venueMin} × {eventMult}{!dayPrior && sitMax > 1 ? ` × ${sitMax}` : ""}{heavyExtra > 0 ? ` + ${heavyExtra} heavy` : ""}</span>
          {typeof qty === "number" && <span className={"text-sm font-bold " + (dark ? "text-blue-300" : "text-blue-700")}>= {qty} {label || fn?.type || ""}</span>}
        </div>
      </div>
    );
  }

  if (mode === "generic" && sitMult) {
    return (
      <div className={dark ? "bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 space-y-2" : "bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2"}>
        <p className={"text-xs font-bold " + (dark ? "text-amber-400" : "text-amber-800")}>⚡ Situational Multipliers</p>
        <div className="flex flex-wrap gap-1.5">
          {sitMult.factors.map((f, fi) => (
            <span key={fi} className={"text-xs px-2 py-0.5 rounded-full border " + (f.mult !== 1 ? (dark ? "bg-amber-900/40 border-amber-700 text-amber-400 font-medium" : "bg-amber-100 border-amber-300 text-amber-700 font-medium") : (dark ? "bg-white/5 border-white/10 text-gray-400" : "bg-white border-gray-200 text-gray-500"))}>
              {f.label} ×{f.mult}
            </span>
          ))}
        </div>
        <div className={"rounded-lg px-3 py-2 flex items-center justify-between " + (dark ? "bg-white/5 border border-amber-800/40" : "bg-white border border-amber-100")}>
          <span className={"text-xs " + (dark ? "text-gray-400" : "text-gray-600")}>Base {baseQty} × {sitMult.cappedMult}{sitMult.capped ? " (⚠️ capped from ×" + sitMult.rawMult + ")" : ""}</span>
          {typeof qty === "number" && <span className={"text-sm font-bold " + (dark ? "text-amber-400" : "text-amber-700")}>= {qty} {label || ""}</span>}
        </div>
        {sitMult.tentativeSavings && (
          <div className={"text-xs rounded-lg px-2 py-1.5 " + (dark ? "bg-yellow-950/30 border border-yellow-800/50 text-yellow-400" : "bg-yellow-50 border border-yellow-200 text-yellow-700")}>
            💡 If day-prior confirms → {sitMult.tentativeSavings.ifConfirmed} {label || ""} (saves {sitMult.tentativeSavings.saving})
          </div>
        )}
      </div>
    );
  }

  return null;
}

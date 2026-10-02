import { useState, useMemo } from "react";
import { fnSnapHasData } from "../../lib/studio/sessionData";

// "Copy a build from an existing client" — lets a salesperson search for any other deal, pick one
// or more of ITS functions (each one individually, not the whole deal), and drop that function's
// whole build (zones/elements/reference photo — everything snapshotBuildState/restoreBuildState in
// StudioApp.jsx carry) into THIS deal as a brand-new function, re-dated and re-venued on the way in.
//
// Reads only from clientLedger, already fully loaded with every client's sessions (StudioApp's mount
// effect bulk-fetches studio_sessions once and attaches `.sessions` to every row) — no extra fetch.
// A function's build lives at `client.sessions[0].fnSnapshots[idx]`, exactly the shape
// restoreBuildState expects; its label/date/venue/shift/pax metadata lives in `client.functions[idx]`
// (both arrays share the same index — fn 1 is index 0, "extra" functions are index 1+).
export default function CopyBuildModal({
  clientLedger, activeClientId, currentVenue,
  isDark, border, textP, textS, cardBg, accent,
  onCopy, onClose,
}) {
  const [q, setQ] = useState("");
  const [pickedClientId, setPickedClientId] = useState(null);
  // fnIdx -> { date, venue } for the function(s) ticked on the currently-open client
  const [picks, setPicks] = useState({});

  const candidates = useMemo(() => {
    const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return (clientLedger || [])
      .filter((c) => c.id !== activeClientId && (c.sessions?.length || 0) > 0)
      .filter((c) => {
        if (!tokens.length) return true;
        const hay = `${c.name || ""} ${c.phone || ""} ${c.venue || ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 40);
  }, [clientLedger, activeClientId, q]);

  const pickedClient = pickedClientId ? (clientLedger || []).find((c) => c.id === pickedClientId) : null;
  const session = pickedClient?.sessions?.[0] || null;
  const fns = pickedClient?.functions || (pickedClient ? [{ type: pickedClient.fn, date: pickedClient.eventDate, venue: pickedClient.venue, shift: pickedClient.shift, pax: pickedClient.pax, palette: pickedClient.clientPalette }] : []);

  const openClient = (c) => { setPickedClientId(c.id); setPicks({}); };
  const back = () => { setPickedClientId(null); setPicks({}); };

  const togglePick = (idx) => {
    setPicks((p) => {
      if (p[idx]) { const n = { ...p }; delete n[idx]; return n; }
      return { ...p, [idx]: { date: "", venue: currentVenue || "" } };
    });
  };
  const setPickField = (idx, field, v) => setPicks((p) => ({ ...p, [idx]: { ...(p[idx] || {}), [field]: v } }));

  const pickedIdxs = Object.keys(picks).map(Number);
  const allFilled = pickedIdxs.length > 0 && pickedIdxs.every((i) => picks[i].date && picks[i].venue);

  const doCopy = () => {
    if (!session || !allFilled) return;
    const items = pickedIdxs.sort((a, b) => a - b).map((idx) => {
      const build = session.fnSnapshots?.[idx];
      const meta = fns[idx] || {};
      return {
        build: JSON.parse(JSON.stringify(build)),
        meta: {
          type: meta.type || "", date: picks[idx].date, venue: picks[idx].venue,
          shift: meta.shift || "", pax: meta.pax || "", palette: meta.palette || "Custom",
          flowerPalette: meta.flowerPalette || "",
        },
      };
    });
    onCopy(items);
    onClose();
  };

  const fmtDate = (d) => { if (!d) return "—"; try { return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; } };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10500, background: "rgba(10,10,20,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "85vh", background: isDark ? "#0F0F1A" : "#fff", borderRadius: 14, border: `1px solid ${border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: textP, display: "flex", alignItems: "center", gap: 8 }}>
            {pickedClient && <span onClick={back} title="Back to search" style={{ cursor: "pointer", color: textS, fontSize: 16 }}>‹</span>}
            📋 {pickedClient ? `Copy from ${pickedClient.name}` : "Copy a build from another client"}
          </div>
          <button onClick={onClose} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 13, cursor: "pointer" }}>✕</button>
        </div>

        {!pickedClient ? (
          <>
            <div style={{ padding: "10px 18px" }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search by client name, phone or venue…"
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${border}`, background: isDark ? "#1A1A2E" : "#fff", color: textP, fontSize: 12 }} />
            </div>
            <div style={{ padding: "0 18px 16px", overflowY: "auto", flex: 1 }}>
              {candidates.length === 0 ? (
                <div style={{ padding: "24px 10px", textAlign: "center", color: textS, fontSize: 11, borderRadius: 8, border: `1px dashed ${border}` }}>
                  No matching deals with a saved build.
                </div>
              ) : candidates.map((c) => {
                const nFns = Math.max(1, (c.functions || []).length);
                return (
                  <div key={c.id} onClick={() => openClient(c)}
                    style={{ padding: "9px 11px", borderRadius: 9, cursor: "pointer", border: `1px solid ${border}`, marginBottom: 7, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: textP, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "—"}</div>
                      <div style={{ fontSize: 10.5, color: textS, marginTop: 2 }}>{c.venue || "—"} · {fmtDate(c.eventDate)}</div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: accent, flexShrink: 0, padding: "3px 8px", borderRadius: 999, border: `1px solid ${accent}55` }}>
                      {nFns} fn{nFns === 1 ? "" : "s"}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: "0 18px 16px", overflowY: "auto", flex: 1 }}>
              <div style={{ fontSize: 10.5, color: textS, margin: "12px 0 8px" }}>Tick the function(s) to copy — only the zones/elements get copied, give each one its own date and venue for this deal.</div>
              {fns.map((f, idx) => {
                const build = session?.fnSnapshots?.[idx];
                const hasData = fnSnapHasData(build);
                const totalInfo = session?.fnTotals?.[idx];
                const checked = !!picks[idx];
                const label = (f.type && String(f.type).trim()) || `Function ${idx + 1}`;
                return (
                  <div key={idx} style={{ borderRadius: 9, border: `1px solid ${checked ? accent : border}`, marginBottom: 8, overflow: "hidden" }}>
                    <div onClick={() => hasData && togglePick(idx)}
                      style={{ padding: "9px 11px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: hasData ? "pointer" : "not-allowed", opacity: hasData ? 1 : 0.45 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${checked ? accent : textS}`, background: checked ? accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#1a1a2e", fontWeight: 800 }}>{checked ? "✓" : ""}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: textP }}>{label}</div>
                          <div style={{ fontSize: 10, color: textS }}>{fmtDate(f.date)}{f.shift ? ` · ${f.shift}` : ""} · {f.venue || "—"}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: hasData ? "#059669" : textS, flexShrink: 0 }}>
                        {hasData ? (totalInfo ? `₹${Math.round(totalInfo.total).toLocaleString("en-IN")}${totalInfo.tier ? ` · ${totalInfo.tier}` : ""}` : "has a build") : "no build saved"}
                      </div>
                    </div>
                    {checked && (
                      <div style={{ padding: "0 11px 10px", display: "flex", gap: 8 }}>
                        <input type="date" value={picks[idx].date} onChange={(e) => setPickField(idx, "date", e.target.value)}
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: `1px solid ${picks[idx].date ? border : "#F87171"}`, background: isDark ? "#1A1A2E" : "#fff", color: textP, fontSize: 11.5 }} />
                        <input value={picks[idx].venue} onChange={(e) => setPickField(idx, "venue", e.target.value)} placeholder="Venue"
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: `1px solid ${picks[idx].venue ? border : "#F87171"}`, background: isDark ? "#1A1A2E" : "#fff", color: textP, fontSize: 11.5 }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textS, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={doCopy} disabled={!allFilled}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: allFilled ? accent : border, color: allFilled ? "#1a1a2e" : textS, fontSize: 12, fontWeight: 700, cursor: allFilled ? "pointer" : "not-allowed" }}>
                Copy {pickedIdxs.length || ""} function{pickedIdxs.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

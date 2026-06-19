// ═══════════════════════════════════════════════════════════════════════════
// AMEND REQUEST PANEL — shown inside Deal Check when the deal is SOLD and the
// function is within 7 days. Last-minute additions can't be blocked directly;
// they go to the relevant Department Head (Structure / Floral) for approval.
// Approved → IMS auto-blocks. Rejected → the reason shows right here.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { DEPTS, departmentForItem } from "../../../lib/ims/amend";

export default function AmendRequestPanel({ ctx, fnDate, fnIdx = 0 }) {
  const {
    border, textS, textP, accent, clientName, activeClientId, authUser,
    amendRequests, submitAmendRequest, makeAmendRequest, showMsg, clientLedger,
  } = ctx;

  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState([{ name: "", qty: 1, unit: "" }]);
  const [dept, setDept] = useState("");        // "" = auto-detect from item names
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const eo = (clientLedger || []).find((c) => c.id === activeClientId);
  const eventOrderId = eo?.eventOrderId || eo?.eoId || null;

  const myReqs = (amendRequests || [])
    .filter((r) => r.clientId === activeClientId)
    .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { name: "", qty: 1, unit: "" }]);
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const cleanRows = rows.filter((r) => (r.name || "").trim());
  const autoDept = cleanRows.length ? departmentForItem({ name: cleanRows[0].name }) : "structure";
  const effDept = dept || autoDept;

  const submit = async () => {
    if (!cleanRows.length) { showMsg && showMsg("Add at least one item", "red"); return; }
    setBusy(true);
    try {
      const req = makeAmendRequest({
        eventOrderId, clientId: activeClientId, clientName, fnIdx, fnDate,
        department: effDept,
        items: cleanRows.map((r) => ({ name: r.name.trim(), qty: Number(r.qty) || 1, unit: (r.unit || "").trim() })),
        reason: reason.trim(),
        requestedBy: authUser?.name || authUser?.username || "",
      });
      await submitAmendRequest(req);
      setRows([{ name: "", qty: 1, unit: "" }]); setReason(""); setDept("");
      showMsg && showMsg(`✓ Request sent to ${DEPTS[effDept]?.label} Head for approval`, "green");
    } catch (e) {
      showMsg && showMsg("Could not send request: " + (e?.message || "error"), "red");
    }
    setBusy(false);
  };

  const fmtWhen = (ts) => { try { return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const statusStyle = (s) => s === "pending" ? { bg: "rgba(245,158,11,0.15)", c: "#B45309" } : s === "approved" ? { bg: "rgba(16,185,129,0.15)", c: "#047857" } : { bg: "rgba(239,68,68,0.15)", c: "#B91C1C" };

  const inp = { padding: "6px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: textP, fontSize: 12, outline: "none" };

  return (
    <div style={{ border: `1.5px solid #F59E0B`, background: "rgba(245,158,11,0.06)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>⚠️ Last-minute change — needs Department-Head approval</div>
        <div style={{ fontSize: 13, color: textS }}>{open ? "▴" : "▾"}</div>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: textS, lineHeight: 1.6, marginBottom: 10 }}>
            This deal is SOLD and the function is within 7 days. Adding inventory or manpower now is a last-minute request —
            the department head may need time to plan stock/crew. List what you need to add; it’s sent to the right head, and only
            blocks once they approve.
          </div>

          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input value={r.name} onChange={(e) => setRow(i, "name", e.target.value)} placeholder="Item / manpower to add (e.g. Bangali Fabric, Flowerist)" style={{ ...inp, flex: 1 }} />
              <input type="number" min="1" value={r.qty} onChange={(e) => setRow(i, "qty", e.target.value)} style={{ ...inp, width: 56, textAlign: "center" }} />
              <input value={r.unit} onChange={(e) => setRow(i, "unit", e.target.value)} placeholder="unit" style={{ ...inp, width: 60 }} />
              {rows.length > 1 && <span onClick={() => delRow(i)} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 14 }}>×</span>}
            </div>
          ))}
          <button onClick={addRow} style={{ fontSize: 11, color: accent, background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>+ add another</button>

          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: textS }}>Route to:</span>
            {Object.values(DEPTS).map((d) => {
              const active = effDept === d.id;
              return <span key={d.id} onClick={() => setDept(d.id)} style={{ padding: "3px 10px", fontSize: 11, borderRadius: 6, cursor: "pointer", border: `1px solid ${active ? accent : border}`, background: active ? `${accent}18` : "transparent", color: active ? accent : textS, fontWeight: 600 }}>{d.icon} {d.label} Head</span>;
            })}
            {!dept && <span style={{ fontSize: 10, color: textS }}>(auto — tap to override)</span>}
          </div>

          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason / context for the head (optional)" style={{ ...inp, width: "100%", resize: "vertical", marginBottom: 8, fontFamily: "inherit" }} />

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={submit} disabled={busy || !cleanRows.length} style={{ padding: "8px 16px", borderRadius: 8, border: "none", cursor: busy || !cleanRows.length ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, background: "#F59E0B", color: "#1a1a1a", opacity: busy || !cleanRows.length ? 0.5 : 1 }}>
              {busy ? "Sending…" : `Send to ${DEPTS[effDept]?.label} Head`}
            </button>
          </div>

          {myReqs.length > 0 && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${border}`, paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: textS, marginBottom: 6 }}>Your amendment requests</div>
              {myReqs.map((r) => {
                const st = statusStyle(r.status);
                return (
                  <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 0", borderBottom: `1px solid ${border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: textP }}>{DEPTS[r.department]?.icon} {(r.items || []).map((it) => `${it.name}×${it.qty}`).join(", ")}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: st.bg, color: st.c }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize: 9, color: textS }}>{fmtWhen(r.requestedAt)}{r.decidedBy ? ` · ${r.status} by ${r.decidedBy}` : ""}</div>
                    {r.status === "rejected" && r.decisionNote && <div style={{ fontSize: 10, color: "#B91C1C" }}>Reason: {r.decisionNote}</div>}
                    {r.status === "approved" && r.decisionNote && <div style={{ fontSize: 10, color: "#047857" }}>{r.decisionNote}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

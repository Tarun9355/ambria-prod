// ═══════════════════════════════════════════════════════════════════════════
// APPROVALS — last-minute amendment requests routed to department heads.
// Structure head sees structure requests (truss / fabric / structure manpower);
// Floral head sees floral requests (flowerist / flowers). Admin sees all.
// Approve → auto-blocks matched inventory on the function date. Reject → reason
// is recorded and surfaces back on the Studio amend entry.
// ═══════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { DEPTS, deptsHeadedBy } from "../../lib/ims/amend";

export default function ApprovalsTab({ amendRequests, saveAmendRequests, authUser, inventory, blocks, setBlocks, saveBlocks }) {
  const [filter, setFilter] = useState("pending"); // pending | decided | all
  const isAdmin = (authUser?.role || "").toLowerCase() === "admin" || authUser?.id === "u_admin";
  const myDepts = isAdmin ? Object.keys(DEPTS) : deptsHeadedBy(authUser?.role);

  const visible = useMemo(() => {
    const list = (amendRequests || []).filter((r) => myDepts.includes(r.department));
    const byStatus = list.filter((r) =>
      filter === "all" ? true : filter === "pending" ? r.status === "pending" : r.status !== "pending"
    );
    return byStatus.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  }, [amendRequests, myDepts, filter]);

  const pendingCount = (amendRequests || []).filter((r) => myDepts.includes(r.department) && r.status === "pending").length;

  const fmtDate = (iso) => { if (!iso) return "—"; try { return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return iso; } };
  const fmtWhen = (ts) => { if (!ts) return ""; try { return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const daysOut = (iso) => { try { const d = new Date(iso + "T00:00:00"); const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate()); return Math.round((d - t) / 86400000); } catch { return null; } };

  // Auto-block matched inventory on the function date (held). Returns counts.
  function applyBlocks(req) {
    const next = { ...(blocks || {}) };
    const eventId = req.eventOrderId || req.clientId || req.id;
    let blocked = 0, unmatched = [];
    (req.items || []).forEach((it) => {
      const nm = (it.name || "").trim().toLowerCase();
      if (!nm) return;
      const inv = (inventory || []).find((i) => (i.name || "").trim().toLowerCase() === nm)
        || (inventory || []).find((i) => (i.name || "").toLowerCase().includes(nm) || nm.includes((i.name || "").toLowerCase()));
      if (inv) {
        const arr = Array.isArray(next[inv.id]) ? [...next[inv.id]] : [];
        arr.push({ date: req.fnDate, eventId, qty: Number(it.qty) || 1, status: "held", createdAt: Date.now(), source: "amend", amendId: req.id });
        next[inv.id] = arr;
        blocked++;
      } else {
        unmatched.push(it.name);
      }
    });
    if (blocked > 0) { setBlocks(next); saveBlocks && saveBlocks(next); }
    return { blocked, unmatched };
  }

  function decide(req, status) {
    let note = "";
    if (status === "rejected") {
      note = window.prompt(`Reason for rejecting "${req.clientName}" request? (shown to the salesperson)`, "") || "";
      if (note === null) return;
    }
    let summary = "";
    if (status === "approved") {
      const { blocked, unmatched } = applyBlocks(req);
      summary = `${blocked} item(s) blocked on ${fmtDate(req.fnDate)}` + (unmatched.length ? ` · ${unmatched.length} need manual blocking (${unmatched.join(", ")})` : "");
      note = summary;
    }
    const next = (amendRequests || []).map((r) =>
      r.id === req.id ? { ...r, status, decidedBy: authUser?.name || authUser?.role || "Head", decidedAt: Date.now(), decisionNote: note } : r
    );
    saveAmendRequests(next);
  }

  const deptBadge = (d) => <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: d === "floral" ? "rgba(236,72,153,0.12)" : "rgba(99,102,241,0.12)", color: d === "floral" ? "#DB2777" : "#4F46E5", fontWeight: 600 }}>{DEPTS[d]?.icon} {DEPTS[d]?.label}</span>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">✅ Approvals</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Last-minute amendment requests for {isAdmin ? "all departments" : myDepts.map((d) => DEPTS[d]?.label).join(" + ") || "your departments"}.
            {pendingCount > 0 && <span className="ml-1 text-amber-600 font-semibold">{pendingCount} pending</span>}
          </p>
        </div>
        <div className="flex gap-1">
          {["pending", "decided", "all"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`text-xs px-3 py-1.5 rounded-lg font-medium ${filter === f ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f[0].toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>

      {myDepts.length === 0 && (
        <div className="text-center text-gray-400 py-16 bg-white rounded-xl border">
          <div className="text-3xl mb-2">🔒</div>
          <p className="font-medium text-gray-600">You're not a department head</p>
          <p className="text-xs mt-1">Only Structure / Floral heads (and Admin) see approval requests.</p>
        </div>
      )}

      {myDepts.length > 0 && visible.length === 0 && (
        <div className="text-center text-gray-400 py-16 bg-white rounded-xl border">
          <div className="text-3xl mb-2">📭</div>
          <p className="font-medium text-gray-600">No {filter === "pending" ? "pending " : ""}requests</p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map((req) => {
          const d = daysOut(req.fnDate);
          return (
            <div key={req.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900">{req.clientName || "Client"}</span>
                    {deptBadge(req.department)}
                    <span className="text-xs text-gray-500">Function {fmtDate(req.fnDate)}{d != null && <span className={`ml-1 font-semibold ${d <= 2 ? "text-red-600" : "text-amber-600"}`}>({d < 0 ? "past" : d === 0 ? "today" : `${d}d away`})</span>}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">Requested by {req.requestedBy || "—"} · {fmtWhen(req.requestedAt)}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-lg font-semibold ${req.status === "pending" ? "bg-amber-100 text-amber-700" : req.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{req.status}</span>
              </div>

              <div className="mt-3 bg-gray-50 rounded-lg p-3">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Adding</div>
                <div className="space-y-1">
                  {(req.items || []).map((it, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-800">{it.name}</span>
                      <span className="text-gray-500 font-medium">{it.qty}{it.unit ? " " + it.unit : ""}</span>
                    </div>
                  ))}
                </div>
                {req.reason && <div className="text-xs text-gray-600 mt-2 italic">“{req.reason}”</div>}
              </div>

              {req.status === "pending" ? (
                <div className="flex gap-2 mt-3 justify-end">
                  <button onClick={() => decide(req, "rejected")} className="text-xs px-4 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-semibold">Reject</button>
                  <button onClick={() => decide(req, "approved")} className="text-xs px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 font-semibold">Approve & Block</button>
                </div>
              ) : (
                <div className="text-xs text-gray-500 mt-2">
                  {req.status === "approved" ? "✅" : "❌"} {req.status} by {req.decidedBy} · {fmtWhen(req.decidedAt)}
                  {req.decisionNote && <div className="mt-0.5 text-gray-600">{req.decisionNote}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

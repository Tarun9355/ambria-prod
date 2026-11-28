import { useState } from "react";
import { Badge, Modal } from "../../components/ui";
import { fmt } from "../../lib/format";
import { INV_CATS } from "../../lib/inventory/constants";
import { PRICE_HISTORY, hasIMSPerm } from "../../lib/ims/constants";
import { useAuth } from "../../lib/AuthContext";
import { isFabricAutoPO, fabricPOTarget } from "../../lib/ims/fabricAutoPurchase";
import { fabricStockIndex } from "../../lib/ims/fabricShortfall";

// Faithful copy of the reference IMS PurchaseTab (Supply → Purchase sub-tab), plus a read-only section for
// the fabric auto-purchase engine's own POs (lib/ims/fabricAutoPurchase.js) - those are raised, resized,
// cancelled and credited entirely automatically, so they're deliberately kept OUT of the manual
// request/approve/purchase flow below (no "Approve"/"Log Purchase" button would do anything real on one).
export default function PurchaseTab({ purchase, setPurchase, inventory, setInventory, projects, functions, studio, trussInv }) {
  const { user: authUser } = useAuth();
  const canRequest = hasIMSPerm(authUser, "purchase_request");
  const canApprovePO = hasIMSPerm(authUser, "purchase_approve");
  const canAddInv = hasIMSPerm(authUser, "purchase_add");
  const studioCatLabels = studio?.catLabels || [];
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState(false);
  const [approveId, setApproveId] = useState(null);
  const [purchaseId, setPurchaseId] = useState(null);
  const [fromFlagId, setFromFlagId] = useState(null);
  const [form, setForm] = useState({ item: "", qty: "", unit: "Piece", cat: "Florals", reason: "", requestedBy: "Tarun Sharma", estimatedCost: "", vendor: "", notes: "" });
  const [purchaseForm, setPurchaseForm] = useState({ actualCost: "", actualQty: "", vendor: "", mobile: "", contactPerson: "", invoiceRef: "" });

  const statuses = ["All", "Pending", "Approved", "Rejected", "Purchased", "AddedToInventory"];
  const statusColors = { Pending: "amber", Approved: "green", Rejected: "red", Purchased: "blue", AddedToInventory: "purple" };

  // Everything below (requests, approve/reject, Log Purchase, Add to Inventory, AI-flagged) is the manual
  // flow - a fabric auto-PO never enters it, whatever its status.
  const manualPurchase = purchase.filter((p) => !isFabricAutoPO(p));
  // AI-flagged unmatched items — never auto-become POs. Includes new flags (status "Flagged")
  // and any legacy auto-POs from before this change (Pending + "Auto: unmatched item…").
  const isAiFlag = (p) => p.status === "Flagged" || (p.status === "Pending" && typeof p.reason === "string" && p.reason.startsWith("Auto: unmatched"));
  const flagged = manualPurchase.filter(isAiFlag);
  const filtered = (filter === "All" ? manualPurchase : manualPurchase.filter((p) => p.status === filter)).filter((p) => !isAiFlag(p));

  function createPR() {
    if (!canRequest) return;
    const ts = Date.now();
    const id = "PR_" + ts;
    const poNum = `PO-${new Date().getFullYear()}-${String(purchase.length + 1).padStart(3, "0")}`;
    const newPR = {
      ...form, id, poNumber: poNum, date: new Date().toISOString().split("T")[0],
      qty: parseInt(form.qty) || 1, estimatedCost: parseFloat(form.estimatedCost) || 0,
      status: "Pending", actualCost: null, actualQty: null, approvedBy: null, approvedDate: null, vendorSnapshot: null, functionAllocation: null, buildType: null,
    };
    // If this PO came from an AI flag, consume that flag so it leaves the flagged section.
    setPurchase((prev) => [...(fromFlagId ? prev.filter((p) => p.id !== fromFlagId) : prev), newPR]);
    setForm({ item: "", qty: "", unit: "Piece", cat: "Florals", reason: "", requestedBy: "Tarun Sharma", estimatedCost: "", vendor: "", notes: "" });
    setFromFlagId(null);
    setModal(false);
  }

  // AI flag → prefill the New Request form so the salesperson reviews + raises the PO manually.
  function createPOFromFlag(p) {
    setForm({ item: p.item || "", qty: String(p.qty || 1), unit: p.unit || "Piece", cat: p.cat || "Florals", reason: p.reason || "", requestedBy: "Tarun Sharma", estimatedCost: "", vendor: "", notes: p.notes || "" });
    setFromFlagId(p.id);
    setModal(true);
  }

  function dismissFlag(id) {
    setPurchase((prev) => prev.filter((p) => p.id !== id));
  }

  function approve(id, action) {
    if (!canApprovePO) return;
    setPurchase((prev) => prev.map((p) => p.id === id ? { ...p, status: action, approvedBy: "Tarun Sharma", approvedDate: new Date().toISOString().split("T")[0] } : p));
    setApproveId(null);
  }

  function markPurchased(id) {
    const pr = purchase.find((p) => p.id === id);
    if (!pr) return;
    setPurchase((prev) => prev.map((p) => p.id === id ? {
      ...p, status: "Purchased",
      actualCost: parseFloat(purchaseForm.actualCost) || p.estimatedCost,
      actualQty: parseInt(purchaseForm.actualQty) || p.qty,
      vendorSnapshot: { vendorId: "V_" + id, name: purchaseForm.vendor, mobile: purchaseForm.mobile, contactPerson: purchaseForm.contactPerson },
      invoiceRef: purchaseForm.invoiceRef,
    } : p));
    setPurchaseId(null);
    setPurchaseForm({ actualCost: "", actualQty: "", vendor: "", mobile: "", contactPerson: "", invoiceRef: "" });
  }

  function addToInventory(id) {
    if (!canAddInv) return;
    const pr = purchase.find((p) => p.id === id);
    if (!pr) return;
    const newItem = {
      id: "I" + String(inventory.length + 10).padStart(3, "0"), name: pr.item, cat: pr.cat, type: "Budgeted",
      itemClass: "discrete", qty: pr.actualQty || pr.qty, unit: pr.unit, loc: "Incoming", img: "", boxId: "", notes: pr.notes || "",
      price: 0, cost: pr.actualCost || pr.estimatedCost, breakagePct: 0, blocked: 0, source: "purchase",
    };
    setInventory([...inventory, newItem]);
    setPurchase((prev) => prev.map((p) => p.id === id ? { ...p, status: "AddedToInventory", inventoryId: newItem.id } : p));
  }

  function getPriceHistory(itemName) {
    return PRICE_HISTORY[itemName] || [];
  }

  const selPR = purchase.find((p) => p.id === purchaseId);
  const priceHist = selPR ? getPriceHistory(selPR.item) : [];
  const bestPrice = priceHist.length ? Math.min(...priceHist.map((h) => h.price)) : null;

  // ── Fabric auto-purchase (read-only, except Cancel / Restore / Add bill details - see
  // lib/ims/fabricAutoPurchase.js's own header for why nothing here ever moves stock or a PO's status) ──
  const autoFabric = purchase.filter(isFabricAutoPO);
  const [fabFilter, setFabFilter] = useState("Open");
  // "Crediting" (a credit is mid-write, between the claim and the stock/status update landing) folds into
  // the Open bucket - it's a transient few-hundred-ms state, not a 4th status worth its own chip, but it
  // must still be visible SOMEWHERE rather than silently vanishing from every filter (regression review,
  // 2026-11-28, finding #8).
  const fabBucket = (status) => (status === "Crediting" ? "Open" : status);
  const fabCounts = { Open: 0, Credited: 0, Cancelled: 0 };
  autoFabric.forEach((p) => { const b = fabBucket(p.status); if (fabCounts[b] !== undefined) fabCounts[b] += 1; });
  const fabShown = autoFabric.filter((p) => fabBucket(p.status) === fabFilter).sort((a, b) => (a.fabric?.needDate || "").localeCompare(b.fabric?.needDate || ""));
  const stockIdx = trussInv ? fabricStockIndex(trussInv) : {};
  const [cancelId, setCancelId] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [billId, setBillId] = useState(null);
  const [billForm, setBillForm] = useState({ vendor: "", actualCost: "", actualQty: "", invoiceRef: "" });

  // The reason-entry Modal below (open={!!cancelId}) IS the confirmation step for this action — its own
  // "Cancel this purchase" button is the deliberate click that commits it, so this doesn't also pop a
  // second, generic useConfirm() dialog on top (regression review, 2026-11-28, finding #1: a stray
  // `const confirm = useConfirm()` here was never destructured from the [confirm, confirmDialog] pair
  // every other caller in this codebase uses, so calling it threw and silently ate every Cancel click —
  // removed instead of fixed-in-place, since a second "are you sure?" after this modal would be redundant).
  function cancelFabricPO(id) {
    if (!canApprovePO) return;
    setPurchase((prev) => prev.map((p) => p.id === id ? { ...p, status: "Cancelled", cancelled: { at: Date.now(), by: authUser?.name || "—", reason: cancelReason || "cancelled by ops" }, history: [...(p.history || []), { at: Date.now(), action: "cancelled", by: authUser?.name || "—", reason: cancelReason || "cancelled by ops" }] } : p));
    setCancelId(null);
    setCancelReason("");
  }
  function restoreFabricPO(id) {
    if (!canApprovePO) return;
    setPurchase((prev) => prev.map((p) => p.id === id ? { ...p, status: "Open", cancelled: null, history: [...(p.history || []), { at: Date.now(), action: "reopened", by: authUser?.name || "—" }] } : p));
  }
  function saveFabricBill(id) {
    if (!canRequest) return;
    const billed = { vendor: billForm.vendor, actualCost: parseFloat(billForm.actualCost) || 0, actualQty: parseFloat(billForm.actualQty) || undefined, invoiceRef: billForm.invoiceRef, by: authUser?.name || "—", at: Date.now() };
    setPurchase((prev) => prev.map((p) => p.id === id ? { ...p, billed, history: [...(p.history || []), { at: Date.now(), action: "billed", by: authUser?.name || "—" }] } : p));
    setBillId(null);
    setBillForm({ vendor: "", actualCost: "", actualQty: "", invoiceRef: "" });
  }

  return (
    <div className="space-y-4">
      {autoFabric.length > 0 && (
        <div className="border border-rose-200 bg-rose-50 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🧵</span>
            <span className="font-semibold text-rose-900">Fabric — bought automatically</span>
            <span className="text-xs text-rose-700">Raised and credited by the system, off live deal shortfalls — nothing here is a manual request.</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {["Open", "Credited", "Cancelled"].map((s) => (
              <button key={s} onClick={() => setFabFilter(s)}
                className={"px-3 py-1.5 rounded-full text-sm font-medium transition-all " + (fabFilter === s ? "bg-rose-600 text-white" : "bg-white text-gray-600 border border-rose-200 hover:bg-rose-100")}>
                {s} <span className="ml-1 text-xs opacity-70">({fabCounts[s]})</span>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {fabShown.map((p) => {
              const target = fabricPOTarget(p);
              const stock = target?.kind ? stockIdx[target.kind]?.get(target.colourKey) : null;
              return (
                <div key={p.id} className="bg-white border border-rose-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-medium text-gray-900">{p.item}</span>
                        <Badge color={p.status === "Open" ? "amber" : p.status === "Credited" ? "green" : p.status === "Crediting" ? "blue" : "gray"}>{p.status === "Crediting" ? "Crediting…" : p.status}</Badge>
                        <span className="text-xs text-gray-400">{p.poNumber}</span>
                        {target?.tier && <span className={"text-[10px] px-1.5 py-0.5 rounded font-semibold " + (target.tier === "new" ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700")}>{target.tier === "new" ? "New stock" : "Old stock"}</span>}
                        {/* hiddenInBuild isn't stored on the PO itself (nothing ever sets it there) - it's
                            read live off the current stock row, same as the "In Build" switch Admin's own
                            Fabric Stock screen shows (regression review, 2026-11-28: this badge used to
                            read `p.hiddenInBuild`, which was always undefined and so never rendered). */}
                        {stock?.hiddenInBuild && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-semibold">Hidden in Build</span>}
                        {p.fabric?.needDate && !stockIdx[target?.kind]?.has(target?.colourKey) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-semibold">Not in Fabric Stock</span>}
                      </div>
                      <p className="text-sm text-gray-500">{p.qty} {p.unit} · needed by {p.fabric?.needDate || "—"}</p>
                      {stock && <p className="text-xs text-gray-400">In stock now: Old {stock.old} · New {stock.new}</p>}
                      {Array.isArray(p.events) && p.events.length > 0 && <p className="text-xs text-gray-500 mt-1">{p.events.map((e) => `${e.client} (${e.date}) · ${e.qty}`).join(" · ")}</p>}
                      {p.status === "Credited" && p.credited && <p className="text-xs font-medium text-green-700 mt-1">Credited {p.credited.qty} {p.unit} to {p.credited.tier === "new" ? "New" : "Old"} stock on {new Date(p.credited.at).toLocaleDateString("en-IN")}</p>}
                      {p.status === "Cancelled" && p.cancelled && <p className="text-xs text-gray-500 mt-1">Cancelled by {p.cancelled.by === "system" ? "the system (need gone)" : p.cancelled.by}{p.cancelled.reason ? ` — ${p.cancelled.reason}` : ""}</p>}
                      {p.billed && <p className="text-xs text-gray-500 mt-1">Billed: {p.billed.vendor || "—"} · {fmt(p.billed.actualCost)}{p.billed.actualQty ? ` · ${p.billed.actualQty} ${p.unit}` : ""}{p.billed.invoiceRef ? ` · ${p.billed.invoiceRef}` : ""}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {p.status === "Open" && canApprovePO && <button onClick={() => setCancelId(p.id)} className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded-lg">Cancel</button>}
                      {p.status === "Cancelled" && p.cancelled?.by !== "system" && canApprovePO && <button onClick={() => restoreFabricPO(p.id)} className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-1 rounded-lg">Restore</button>}
                      {/* Open only - once Credited, the actual qty bought can no longer change WHEN or
                          WHAT gets credited (that already happened), so billing it after the fact would be
                          a paper-trail entry that falsely implies it still could (regression review,
                          2026-11-28, finding #8). */}
                      {!p.billed && p.status === "Open" && canRequest && <button onClick={() => { setBillId(p.id); setBillForm({ vendor: "", actualCost: "", actualQty: String(p.qty), invoiceRef: "" }); }} className="text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-2 py-1 rounded-lg">+ Add bill details</button>}
                    </div>
                  </div>
                </div>
              );
            })}
            {fabShown.length === 0 && <div className="text-center py-6 text-gray-400 text-sm">Nothing {fabFilter.toLowerCase()}</div>}
          </div>
        </div>
      )}

      {/* Cancel reason modal */}
      <Modal open={!!cancelId} onClose={() => { setCancelId(null); setCancelReason(""); }} title="Cancel this fabric purchase?">
        <div className="space-y-3">
          <div><label className="text-xs text-gray-500">Reason (optional)</label>
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <button onClick={() => cancelFabricPO(cancelId)} className="w-full bg-red-600 text-white rounded-lg py-2 text-sm">Cancel this purchase</button>
        </div>
      </Modal>

      {/* Add bill details modal - purely the paper trail; it never changes WHEN stock is credited */}
      <Modal open={!!billId} onClose={() => setBillId(null)} title="Add bill details">
        <div className="space-y-3">
          {[["Vendor", "vendor", "text"], ["Actual Cost (₹)", "actualCost", "number"], ["Actual Quantity Bought", "actualQty", "number"], ["Invoice / Bill Ref", "invoiceRef", "text"]].map(([l, k, t]) => (
            <div key={k}><label className="text-xs text-gray-500">{l}</label>
              <input type={t} value={billForm[k]} onChange={(e) => setBillForm({ ...billForm, [k]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          ))}
          <p className="text-xs text-gray-400">Once billed, this purchase is frozen - the system never resizes or cancels it again, and crediting uses the actual quantity bought here instead of the planned one.</p>
          <button onClick={() => saveFabricBill(billId)} className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm">Save</button>
        </div>
      </Modal>

      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {statuses.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={"px-3 py-1.5 rounded-full text-sm font-medium transition-all " + (filter === s ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
              {s} {s !== "All" && <span className="ml-1 text-xs opacity-70">({manualPurchase.filter((p) => (s === "All" || p.status === s) && !isAiFlag(p)).length})</span>}
            </button>
          ))}
        </div>
        {canRequest && <button onClick={() => setModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ New Request</button>}
      </div>

      <div className="space-y-3">
        {filtered.map((pr) => (
          <div key={pr.id} className="bg-white border rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-900">{pr.item}</span>
                  <Badge color={statusColors[pr.status] || "gray"}>{pr.status}</Badge>
                  <span className="text-xs text-gray-400">{pr.poNumber}</span>
                </div>
                <p className="text-sm text-gray-500">{pr.qty} {pr.unit} · {pr.cat} · Est. {fmt(pr.estimatedCost * pr.qty)}</p>
                <p className="text-sm text-gray-500">Reason: {pr.reason}</p>
                <p className="text-xs text-gray-400 mt-1">By {pr.requestedBy} on {pr.date}</p>
                {pr.vendorSnapshot && <p className="text-xs text-gray-500 mt-1">Purchased from: {pr.vendorSnapshot.name} ({pr.vendorSnapshot.mobile}) — Contact: {pr.vendorSnapshot.contactPerson}</p>}
                {pr.actualCost && <p className="text-xs font-medium text-green-700 mt-1">Actual cost: {fmt(pr.actualCost)} × {pr.actualQty} {pr.unit} = {fmt(pr.actualCost * pr.actualQty)}</p>}
              </div>
              <div className="flex gap-2 ml-4">
                {pr.status === "Pending" && canApprovePO && <>
                  <button onClick={() => approve(pr.id, "Approved")} className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-1 rounded-lg">✓ Approve</button>
                  <button onClick={() => approve(pr.id, "Rejected")} className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded-lg">✗ Reject</button>
                </>}
                {pr.status === "Approved" && <button onClick={() => { setPurchaseId(pr.id); setPurchaseForm({ actualCost: pr.estimatedCost, actualQty: pr.qty, vendor: pr.vendor || "", mobile: "", contactPerson: "", invoiceRef: "" }); }} className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-lg">📦 Log Purchase</button>}
                {pr.status === "Purchased" && canAddInv && <button onClick={() => addToInventory(pr.id)} className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 px-2 py-1 rounded-lg">+ Add to Inventory</button>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center py-10 text-gray-400">No purchase requests found</div>}
      </div>

      {/* AI-flagged unmatched items — highlighted, NOT auto-POs. Salesperson raises the PO manually. */}
      {flagged.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">🔎</span>
            <span className="font-semibold text-amber-900">AI-flagged — items not found in inventory ({flagged.length})</span>
          </div>
          <p className="text-xs text-amber-700 mb-3">These came from confirmed events but didn't match any inventory item. No PO is created automatically — review each and raise a PO manually, or dismiss it.</p>
          <div className="space-y-2">
            {flagged.map((p) => (
              <div key={p.id} className="bg-white border border-amber-200 rounded-lg p-3 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-gray-900">{p.item}</span>
                    <span className="text-xs text-gray-400">{p.qty} {p.unit} · {p.cat}</span>
                  </div>
                  <p className="text-xs text-gray-500">{p.reason}</p>
                  {p.notes && <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>}
                </div>
                <div className="flex gap-2 ml-4 shrink-0">
                  <button onClick={() => createPOFromFlag(p)} className="text-xs bg-indigo-600 text-white hover:bg-indigo-700 px-2.5 py-1 rounded-lg">➕ Create PO</button>
                  <button onClick={() => dismissFlag(p.id)} className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2.5 py-1 rounded-lg">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New PR Modal */}
      <Modal open={modal} onClose={() => { setModal(false); setFromFlagId(null); }} title={fromFlagId ? "Raise PO for flagged item" : "New Purchase Request"}>
        <div className="space-y-3">
          {[["Item Name", "item", "text"], ["Quantity", "qty", "number"], ["Estimated Cost (₹/unit)", "estimatedCost", "number"], ["Preferred Vendor", "vendor", "text"]].map(([l, k, t]) => (
            <div key={k}><label className="text-xs text-gray-500">{l}</label>
              <input type={t} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500">Unit</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm">
                {["Piece", "Kg", "Metre", "Bundle", "Roll", "Rft", "Set", "Box"].map((u) => <option key={u}>{u}</option>)}
              </select></div>
            <div><label className="text-xs text-gray-500">Category</label>
              <select value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm">
                {(studioCatLabels.length > 0 ? studioCatLabels : INV_CATS).map((c) => <option key={c}>{c}</option>)}
                {form.cat && !studioCatLabels.includes(form.cat) && !INV_CATS.includes(form.cat) && <option value={form.cat}>{form.cat} (current)</option>}
              </select></div>
          </div>
          <div><label className="text-xs text-gray-500">Reason / Purpose</label>
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-500">Notes</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <button onClick={createPR} className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm">Submit Request</button>
        </div>
      </Modal>

      {/* Log Purchase Modal with Price Intelligence */}
      <Modal open={!!purchaseId} onClose={() => setPurchaseId(null)} title="Log Purchase Details">
        {selPR && <div className="space-y-3">
          {priceHist.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-sm font-semibold text-amber-800 mb-2">💡 Price History — {selPR.item}</p>
              {priceHist.sort((a, b) => a.price - b.price).map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-700 mb-1">
                  <span>{["🥇", "🥈", "🥉"][i] || "  "}</span>
                  <span className="font-medium">{fmt(h.price)}/{h.unit}</span>
                  <span className="text-gray-500">— {h.vendorName} ({h.date})</span>
                </div>
              ))}
            </div>
          )}
          {[["Actual Cost (₹/unit)", "actualCost", "number"], ["Quantity Received", "actualQty", "number"], ["Vendor Name", "vendor", "text"], ["Vendor Mobile", "mobile", "tel"], ["Contact Person", "contactPerson", "text"], ["Invoice / Bill Ref", "invoiceRef", "text"]].map(([l, k, t]) => (
            <div key={k}><label className="text-xs text-gray-500">{l}</label>
              <input type={t} value={purchaseForm[k]} onChange={(e) => setPurchaseForm({ ...purchaseForm, [k]: e.target.value })}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
              {k === "actualCost" && bestPrice && parseFloat(purchaseForm.actualCost) > bestPrice && (
                <p className="text-xs text-red-600 mt-1">⚠️ Paying {Math.round((parseFloat(purchaseForm.actualCost) / bestPrice - 1) * 100)}% more than best price ({fmt(bestPrice)} from {priceHist.sort((a, b) => a.price - b.price)[0]?.vendorName})</p>
              )}
            </div>
          ))}
          {purchaseForm.actualCost && purchaseForm.actualQty && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm">
              <p className="text-gray-700">Total paid: <strong>{fmt(parseFloat(purchaseForm.actualCost) * parseInt(purchaseForm.actualQty))}</strong></p>
              <p className="text-xs text-gray-500 mt-1">40% to function P&L: {fmt(parseFloat(purchaseForm.actualCost) * parseInt(purchaseForm.actualQty) * 0.4)}</p>
              <p className="text-xs text-gray-500">60% to Central Procurement: {fmt(parseFloat(purchaseForm.actualCost) * parseInt(purchaseForm.actualQty) * 0.6)}</p>
            </div>
          )}
          <button onClick={() => markPurchased(purchaseId)} className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm">✓ Mark Purchased</button>
        </div>}
      </Modal>
    </div>
  );
}

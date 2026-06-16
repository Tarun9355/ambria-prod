import { useState } from "react";
import { Badge, Modal } from "../../components/ui";
import { fmt } from "../../lib/format";
import { INV_CATS } from "../../lib/inventory/constants";
import { PRICE_HISTORY } from "../../lib/ims/constants";

// Faithful copy of the reference IMS PurchaseTab (Supply → Purchase sub-tab).
export default function PurchaseTab({ purchase, setPurchase, inventory, setInventory, projects, functions, studio }) {
  const studioCatLabels = studio?.catLabels || [];
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState(false);
  const [approveId, setApproveId] = useState(null);
  const [purchaseId, setPurchaseId] = useState(null);
  const [form, setForm] = useState({ item: "", qty: "", unit: "Piece", cat: "Florals", reason: "", requestedBy: "Tarun Sharma", estimatedCost: "", vendor: "", notes: "" });
  const [purchaseForm, setPurchaseForm] = useState({ actualCost: "", actualQty: "", vendor: "", mobile: "", contactPerson: "", invoiceRef: "" });

  const statuses = ["All", "Pending", "Approved", "Rejected", "Purchased", "AddedToInventory"];
  const statusColors = { Pending: "amber", Approved: "green", Rejected: "red", Purchased: "blue", AddedToInventory: "purple" };

  const filtered = filter === "All" ? purchase : purchase.filter((p) => p.status === filter);

  function createPR() {
    const ts = Date.now();
    const id = "PR_" + ts;
    const poNum = `PO-${new Date().getFullYear()}-${String(purchase.length + 1).padStart(3, "0")}`;
    setPurchase([...purchase, {
      ...form, id, poNumber: poNum, date: new Date().toISOString().split("T")[0],
      qty: parseInt(form.qty) || 1, estimatedCost: parseFloat(form.estimatedCost) || 0,
      status: "Pending", actualCost: null, actualQty: null, approvedBy: null, approvedDate: null, vendorSnapshot: null, functionAllocation: null, buildType: null,
    }]);
    setForm({ item: "", qty: "", unit: "Piece", cat: "Florals", reason: "", requestedBy: "Tarun Sharma", estimatedCost: "", vendor: "", notes: "" });
    setModal(false);
  }

  function approve(id, action) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {statuses.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={"px-3 py-1.5 rounded-full text-sm font-medium transition-all " + (filter === s ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
              {s} {s !== "All" && <span className="ml-1 text-xs opacity-70">({purchase.filter((p) => s === "All" || p.status === s).length})</span>}
            </button>
          ))}
        </div>
        <button onClick={() => setModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ New Request</button>
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
                {pr.status === "Pending" && <>
                  <button onClick={() => approve(pr.id, "Approved")} className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2 py-1 rounded-lg">✓ Approve</button>
                  <button onClick={() => approve(pr.id, "Rejected")} className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2 py-1 rounded-lg">✗ Reject</button>
                </>}
                {pr.status === "Approved" && <button onClick={() => { setPurchaseId(pr.id); setPurchaseForm({ actualCost: pr.estimatedCost, actualQty: pr.qty, vendor: pr.vendor || "", mobile: "", contactPerson: "", invoiceRef: "" }); }} className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 px-2 py-1 rounded-lg">📦 Log Purchase</button>}
                {pr.status === "Purchased" && <button onClick={() => addToInventory(pr.id)} className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 px-2 py-1 rounded-lg">+ Add to Inventory</button>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center py-10 text-gray-400">No purchase requests found</div>}
      </div>

      {/* New PR Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="New Purchase Request">
        <div className="space-y-3">
          {[["Item Name", "item", "text"], ["Quantity", "qty", "number"], ["Estimated Cost (₹/unit)", "estimatedCost", "number"], ["Preferred Vendor", "vendor", "text"]].map(([l, k, t]) => (
            <div key={k}><label className="text-xs text-gray-500">{l}</label>
              <input type={t} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-500">Unit</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm">
                {["Piece", "Kg", "Metre", "Bundle", "Roll", "Set", "Box"].map((u) => <option key={u}>{u}</option>)}
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

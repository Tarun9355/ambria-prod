import { useState } from "react";
import { Tabs, Badge, Modal } from "../../components/ui";

// Faithful copy of the reference IMS BoxesTab (Planning → Boxes & Challans).
export default function BoxesTab({ boxes, setBoxes, functions, projects }) {
  const [subTab, setSubTab] = useState("boxes");
  const [addBox, setAddBox] = useState(false);
  const [scanId, setScanId] = useState("");
  const [form, setForm] = useState({ label: "", loc: "", notes: "", functionId: "" });
  const [challanFn, setChallanFn] = useState("");
  const [challanForm, setChallanForm] = useState({ vehicle: "", driver: "", phone: "" });
  const [selBoxes, setSelBoxes] = useState([]);

  const BOX_STATUSES = ["In Warehouse", "Packed", "Loaded", "At Venue", "Returned"];
  const STATUS_COLORS = { "In Warehouse": "gray", "Packed": "blue", "Loaded": "amber", "At Venue": "green", "Returned": "purple" };

  function createBox() {
    const id = "BOX-" + String(boxes.length + 1).padStart(3, "0");
    setBoxes([...boxes, { id, ...form, status: "In Warehouse" }]);
    setForm({ label: "", loc: "", notes: "", functionId: "" });
    setAddBox(false);
  }
  function updateStatus(id, status) {
    setBoxes((prev) => prev.map((b) => b.id === id ? { ...b, status } : b));
  }

  const scanned = scanId ? boxes.find((b) => b.id.toLowerCase() === scanId.toLowerCase()) : null;

  function printChallan() {
    const fn = functions.find((f) => f.id === challanFn);
    const proj = projects.find((p) => p.id === fn?.projectId);
    const selectedBoxes = boxes.filter((b) => selBoxes.includes(b.id));
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>Challan</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px}h2{color:#7c3aed}@media print{button{display:none}}</style></head><body>
      <h2>Ambria Decorations — Delivery Challan</h2>
      <p>Project: ${proj?.name || "-"} &nbsp;|&nbsp; Function: ${fn?.name || "-"} (${fn?.date || "-"})</p>
      <p>Vehicle: ${challanForm.vehicle} &nbsp;|&nbsp; Driver: ${challanForm.driver} &nbsp;|&nbsp; Phone: ${challanForm.phone}</p>
      <table><tr><th>Box ID</th><th>Label</th><th>Status</th><th>Location</th><th>Notes</th></tr>
      ${selectedBoxes.map((b) => `<tr><td>${b.id}</td><td>${b.label}</td><td>${b.status}</td><td>${b.loc}</td><td>${b.notes}</td></tr>`).join("")}
      </table><br><br>
      <p>Dispatched by: _______________ &nbsp;&nbsp; Received by: _______________</p>
      <p>Date: _______________ &nbsp;&nbsp; Time: _______________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      <Tabs tabs={[{ id: "boxes", label: "📦 Boxes" }, { id: "scan", label: "🔍 Scan Box" }, { id: "challan", label: "🧾 Challans" }]} active={subTab} onChange={setSubTab} />

      {subTab === "boxes" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setAddBox(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ Create Box</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {boxes.map((b) => {
              const fn = functions.find((f) => f.id === b.functionId);
              return (
                <div key={b.id} className="bg-white border rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-gray-900">{b.id}</p>
                      <p className="text-sm text-gray-600">{b.label}</p>
                    </div>
                    <Badge color={STATUS_COLORS[b.status] || "gray"}>{b.status}</Badge>
                  </div>
                  {fn && <p className="text-xs text-indigo-600 mb-2">📋 {fn.name}</p>}
                  <p className="text-xs text-gray-500">📍 {b.loc}</p>
                  {b.notes && <p className="text-xs text-gray-400 mt-1">{b.notes}</p>}
                  <div className="mt-3">
                    <select value={b.status} onChange={(e) => updateStatus(b.id, e.target.value)}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs">
                      {BOX_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          <Modal open={addBox} onClose={() => setAddBox(false)} title="Create New Box">
            <div className="space-y-3">
              {[["Label", "label", "text"], ["Location", "loc", "text"], ["Notes", "notes", "text"]].map(([l, k, t]) => (
                <div key={k}><label className="text-xs text-gray-500">{l}</label>
                  <input type={t} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
              ))}
              <div><label className="text-xs text-gray-500">Link to Function (optional)</label>
                <select value={form.functionId} onChange={(e) => setForm({ ...form, functionId: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-1.5 text-sm">
                  <option value="">None</option>
                  {functions.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
                </select></div>
              <button onClick={createBox} className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm">Create Box</button>
            </div>
          </Modal>
        </div>
      )}

      {subTab === "scan" && (
        <div className="max-w-md mx-auto space-y-4">
          <div className="flex gap-2">
            <input value={scanId} onChange={(e) => setScanId(e.target.value)} placeholder="Enter Box ID (e.g. BOX-001)"
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <button className="bg-gray-100 px-3 py-2 rounded-lg text-sm">🔍</button>
          </div>
          {scanId && (scanned ? (
            <div className="bg-white border rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-gray-900 text-lg">{scanned.id}</h4>
                <Badge color={STATUS_COLORS[scanned.status] || "gray"}>{scanned.status}</Badge>
              </div>
              <p className="text-gray-700 font-medium mb-1">{scanned.label}</p>
              <p className="text-sm text-gray-500">📍 {scanned.loc}</p>
              {scanned.notes && <p className="text-sm text-gray-500 mt-1">{scanned.notes}</p>}
              {functions.find((f) => f.id === scanned.functionId) &&
                <p className="text-sm text-indigo-600 mt-2">📋 Linked: {functions.find((f) => f.id === scanned.functionId)?.name}</p>}
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <p className="text-red-600">❌ Box "{scanId}" not found</p>
            </div>
          ))}
        </div>
      )}

      {subTab === "challan" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500">Select Function</label>
              <select value={challanFn} onChange={(e) => { setChallanFn(e.target.value); setSelBoxes([]); }}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">Select function...</option>
                {functions.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
              </select>
            </div>
          </div>
          {challanFn && <>
            <div className="grid grid-cols-3 gap-3">
              {[["Vehicle No.", "vehicle"], ["Driver Name", "driver"], ["Driver Phone", "phone"]].map(([l, k]) => (
                <div key={k}><label className="text-xs text-gray-500">{l}</label>
                  <input value={challanForm[k]} onChange={(e) => setChallanForm({ ...challanForm, [k]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Select Boxes to Dispatch:</p>
              {boxes.filter((b) => b.functionId === challanFn).map((b) => (
                <label key={b.id} className="flex items-center gap-3 bg-white border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={selBoxes.includes(b.id)} onChange={(e) => setSelBoxes((prev) => e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id))} />
                  <span className="text-sm font-medium">{b.id}</span>
                  <span className="text-sm text-gray-600">{b.label}</span>
                  <Badge color={STATUS_COLORS[b.status] || "gray"}>{b.status}</Badge>
                </label>
              ))}
              {boxes.filter((b) => b.functionId === challanFn).length === 0 && <p className="text-sm text-gray-400 italic">No boxes linked to this function</p>}
            </div>
            <button onClick={printChallan} disabled={selBoxes.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm">
              🖨️ Generate & Print Challan
            </button>
          </>}
        </div>
      )}
    </div>
  );
}

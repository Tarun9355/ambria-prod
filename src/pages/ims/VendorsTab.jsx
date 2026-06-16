import { useState } from "react";
import { Tabs, Badge, Modal } from "../../components/ui";
import { fmt } from "../../lib/format";
import { VENDOR_TYPES } from "../../lib/ims/constants";

// Faithful copy of the reference IMS VendorsTab (Admin → Vendors sub-tab).
export default function VendorsTab({ vendors, setVendors, functions, settings }) {
  const [subTab, setSubTab] = useState("list");
  const [addModal, setAddModal] = useState(false);
  const [bookModal, setBookModal] = useState(null);
  const [portalVendor, setPortalVendor] = useState(null);
  const [form, setForm] = useState({ name: "", type: "Manpower Contractor", contact: "", email: "", isFixed: true, storedRateDesc: "", storedRateAmount: "", labourType: "" });
  const [bookForm, setBookForm] = useState({ functionId: "", serviceDesc: "", qty: "1", unit: "persons", rate: "" });
  const STATUS_C = { Pending: "amber", Confirmed: "green", Rejected: "red" };

  function addVendor() {
    const id = "V" + String(vendors.length + 1).padStart(3, "0");
    const key = "PK-" + id + "-" + form.name.toUpperCase().replace(/\s/g, "").slice(0, 4);
    setVendors((p) => [...p, {
      id, name: form.name, type: form.type, contact: form.contact, email: form.email,
      isFixed: form.isFixed, storedRate: form.isFixed ? { desc: form.storedRateDesc, amount: parseFloat(form.storedRateAmount) || 0 } : null,
      labourType: form.type === "Manpower Contractor" ? (form.labourType || "") : "",
      overallScore: 0, portalKey: key, active: true, bookings: [], bills: [], ratings: [],
    }]);
    setForm({ name: "", type: "Manpower Contractor", contact: "", email: "", isFixed: true, storedRateDesc: "", storedRateAmount: "", labourType: "" });
    setAddModal(false);
  }

  function createBooking() {
    const v = vendors.find((x) => x.id === bookModal);
    if (!v || !bookForm.functionId) return;
    const fn = functions.find((f) => f.id === bookForm.functionId);
    const rate = v.isFixed ? (v.storedRate?.amount || 0) : parseFloat(bookForm.rate) || 0;
    const qty = parseInt(bookForm.qty) || 1;
    const bk = {
      id: "BK" + Date.now(), functionId: bookForm.functionId,
      functionName: (fn?.name || "") + " — " + (fn?.date || ""),
      serviceDesc: bookForm.serviceDesc || (v.storedRate?.desc || ""),
      qty, unit: bookForm.unit, rate, totalAmount: rate * qty,
      date: fn?.date || "", status: "Pending", vendorAccepted: null, respondedAt: null,
    };
    setVendors((p) => p.map((x) => x.id === bookModal ? { ...x, bookings: [...x.bookings, bk] } : x));
    setBookModal(null);
    setBookForm({ functionId: "", serviceDesc: "", qty: "1", unit: "persons", rate: "" });
  }

  function vendorRespond(vendorId, bookingId, accept) {
    setVendors((p) => p.map((v) => v.id === vendorId ? { ...v, bookings: v.bookings.map((b) => b.id === bookingId ?
      { ...b, status: accept ? "Confirmed" : "Rejected", vendorAccepted: accept, respondedAt: new Date().toISOString().split("T")[0] } : b) } : v));
  }

  function regenKey(vendorId) {
    setVendors((p) => p.map((v) => v.id === vendorId ? { ...v, portalKey: "PK-" + vendorId + "-" + Date.now().toString(36).toUpperCase().slice(-4) } : v));
  }

  const pv = portalVendor ? vendors.find((v) => v.id === portalVendor) : null;
  const bv = vendors.find((v) => v.id === bookModal);
  const allBookings = vendors.flatMap((v) => v.bookings.map((b) => ({ ...b, vendorName: v.name, vendorId: v.id })));

  return (
    <div className="space-y-4">
      <Tabs tabs={[{ id: "list", label: "🏢 Vendors" }, { id: "bookings", label: `📋 Bookings (${allBookings.length})` }, { id: "portal", label: "🔗 Vendor Portal Preview" }]} active={subTab} onChange={setSubTab} />

      {/* ── Vendors List ── */}
      {subTab === "list" && <>
        <div className="flex justify-end">
          <button onClick={() => setAddModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm">+ Add Vendor</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {vendors.map((v) => {
            const pending = v.bookings.filter((b) => b.status === "Pending").length;
            const confirmed = v.bookings.filter((b) => b.status === "Confirmed").length;
            return (
              <div key={v.id} className="bg-white border rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-gray-900">{v.name}</p>
                      <Badge color={v.isFixed ? "green" : "amber"}>{v.isFixed ? "Fixed Rate" : "Situational"}</Badge>
                      <Badge color="gray">{v.type}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">📞 {v.contact}{v.email && ` · ✉️ ${v.email}`}</p>
                    {v.isFixed && v.storedRate && <p className="text-xs text-green-700 font-medium mt-0.5">💰 {v.storedRate.desc}: {fmt(v.storedRate.amount)}</p>}
                    {v.type === "Manpower Contractor" && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-gray-500 whitespace-nowrap">👷 Labour type:</span>
                        <select
                          value={v.labourType || ""}
                          onChange={(e) => setVendors((p) => p.map((x) => x.id === v.id ? { ...x, labourType: e.target.value } : x))}
                          className={"text-xs border rounded px-2 py-0.5 outline-none " + (v.labourType ? "bg-indigo-50 border-indigo-200 text-indigo-800 font-semibold" : "bg-amber-50 border-amber-300 text-amber-800")}>
                          <option value="">— Pick to enable avg-rate in Studio —</option>
                          {Object.keys(settings?.dihariSchemes || {}).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  {v.overallScore > 0 && <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">⭐ {v.overallScore}</span>}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded border">🔑 {v.portalKey}</span>
                  <button onClick={() => regenKey(v.id)} className="text-xs text-indigo-500 hover:underline">↺ Regen key</button>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {pending > 0 && <Badge color="amber">⏳ {pending} pending</Badge>}
                  {confirmed > 0 && <Badge color="green">✅ {confirmed} confirmed</Badge>}
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => { setBookModal(v.id); setBookForm({ functionId: "", serviceDesc: v.storedRate?.desc || "", qty: "1", unit: "persons", rate: String(v.storedRate?.amount || "") }); }}
                      className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1.5 rounded-lg font-medium">📋 Book</button>
                    <button onClick={() => { setPortalVendor(v.id); setSubTab("portal"); }}
                      className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg">🔗 Portal</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>}

      {/* ── All Bookings ── */}
      {subTab === "bookings" && (
        <div className="space-y-3">
          {allBookings.length === 0 && <p className="text-center text-gray-400 py-10 italic">No bookings yet. Book a vendor from the Vendors tab.</p>}
          {allBookings.sort((a, b) => a.status === "Pending" ? -1 : 1).map((b) => (
            <div key={b.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-900">{b.vendorName}</span>
                    <Badge color={STATUS_C[b.status] || "gray"}>{b.status}</Badge>
                    <span className="text-xs text-gray-400 font-mono">{b.id}</span>
                  </div>
                  <p className="text-sm text-gray-700">{b.serviceDesc}</p>
                  <p className="text-sm text-gray-500">📋 {b.functionName} · 📅 {b.date}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{b.qty} {b.unit} × {fmt(b.rate)} = <strong className="text-gray-800">{fmt(b.totalAmount)}</strong></p>
                  {b.respondedAt && <p className="text-xs text-gray-400 mt-0.5">Responded: {b.respondedAt}</p>}
                </div>
                {b.status === "Pending" && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => vendorRespond(b.vendorId, b.id, true)} className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1.5 rounded-lg font-medium">✓ Accept</button>
                    <button onClick={() => vendorRespond(b.vendorId, b.id, false)} className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1.5 rounded-lg font-medium">✗ Reject</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Vendor Portal Preview ── */}
      {subTab === "portal" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 font-medium">Preview portal for:</label>
            <select value={portalVendor || ""} onChange={(e) => setPortalVendor(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
              <option value="">Select vendor...</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.portalKey}</option>)}
            </select>
          </div>
          {pv && (
            <div className="border-2 border-dashed border-indigo-300 rounded-2xl overflow-hidden max-w-xl mx-auto">
              <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold text-xl">A</div>
                  <div><p className="font-bold">Ambria Decorations</p><p className="text-sm opacity-75">Vendor Portal</p></div>
                </div>
              </div>
              <div className="bg-white p-5 space-y-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="font-bold text-gray-900 text-lg">{pv.name}</p>
                  <div className="text-sm text-gray-500 mt-1 space-y-0.5">
                    <p>📞 {pv.contact} {pv.email && `· ✉️ ${pv.email}`}</p>
                    <p>🏷 {pv.type}</p>
                    {pv.isFixed && pv.storedRate && <p className="text-green-700 font-medium">💰 Your agreed rate: {fmt(pv.storedRate.amount)} / {pv.storedRate.desc}</p>}
                  </div>
                  {pv.overallScore > 0 && <div className="mt-2 flex items-center gap-1.5"><span className="text-amber-500">{"⭐".repeat(Math.round(pv.overallScore))}</span><span className="text-xs text-gray-500">{pv.overallScore} rating</span></div>}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3">📅 Your Bookings from Ambria</h4>
                  {pv.bookings.length === 0 && <p className="text-sm text-gray-400 italic text-center py-4">No bookings yet</p>}
                  {pv.bookings.map((b) => (
                    <div key={b.id} className={"border rounded-xl p-4 mb-3 " + (b.status === "Pending" ? "border-amber-200 bg-amber-50" : b.status === "Confirmed" ? "border-green-200 bg-green-50" : "border-red-100 bg-red-50")}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{b.serviceDesc}</p>
                          <p className="text-sm text-gray-600">📋 {b.functionName}</p>
                          <p className="text-sm text-gray-600">📅 Date: {b.date}</p>
                          <p className="text-sm text-gray-600 mt-1">{b.qty} {b.unit} × {fmt(b.rate)} = <strong>{fmt(b.totalAmount)}</strong></p>
                        </div>
                        <Badge color={STATUS_C[b.status] || "gray"}>{b.status}</Badge>
                      </div>
                      {b.status === "Pending" && <>
                        <p className="text-xs text-amber-700 mb-2">⚠️ Please respond within 7 days. Ambria team is notified immediately on your response.</p>
                        <div className="flex gap-2">
                          <button onClick={() => vendorRespond(pv.id, b.id, true)} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium">✅ Accept Booking</button>
                          <button onClick={() => vendorRespond(pv.id, b.id, false)} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-medium">❌ Reject</button>
                        </div>
                      </>}
                      {b.status === "Confirmed" && <p className="text-xs text-green-700 font-medium mt-1">✅ Accepted on {b.respondedAt}</p>}
                      {b.status === "Rejected" && <p className="text-xs text-red-600 font-medium mt-1">❌ Rejected on {b.respondedAt}</p>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 text-center border-t pt-3">Your unique portal key: <span className="font-mono font-semibold text-gray-600">{pv.portalKey}</span></p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Vendor Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Vendor">
        <div className="space-y-3">
          {[["Vendor Name", "name"], ["Contact Phone", "contact"], ["Email", "email"]].map(([l, k]) => (
            <div key={k}><label className="text-xs text-gray-500">{l}</label>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          ))}
          <div><label className="text-xs text-gray-500">Vendor Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
              {VENDOR_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select></div>
          {form.type === "Manpower Contractor" && (
            <div><label className="text-xs text-gray-500">Labour Type <span className="text-gray-400">(which dihari category this vendor supplies)</span></label>
              <select value={form.labourType} onChange={(e) => setForm({ ...form, labourType: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">— Select labour type —</option>
                {Object.keys(settings?.dihariSchemes || {}).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">Studio Deal Check averages all vendors of this type to forecast rates.</p>
            </div>
          )}
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 font-medium">Rate Type:</span>
            {[["Fixed Rate", "true"], ["Situational", "false"]].map(([l, v]) => (
              <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={String(form.isFixed) === v} onChange={() => setForm({ ...form, isFixed: v === "true" })} />
                <span className="text-sm">{l}</span>
              </label>
            ))}
          </div>
          {form.isFixed && <div className="space-y-3 bg-green-50 border border-green-100 rounded-xl p-3">
            <div><label className="text-xs text-gray-500">Rate Description</label>
              <input value={form.storedRateDesc} onChange={(e) => setForm({ ...form, storedRateDesc: e.target.value })} placeholder="e.g. Carpenter day rate" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-gray-500">Fixed Rate ₹</label>
              <input type="number" value={form.storedRateAmount} onChange={(e) => setForm({ ...form, storedRateAmount: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>}
          <div className="bg-indigo-50 rounded-lg p-3 text-xs text-indigo-700">🔑 A unique portal key will be auto-generated. Share it with the vendor so they can view and respond to bookings.</div>
          <button onClick={addVendor} className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium">Add Vendor</button>
        </div>
      </Modal>

      {/* Book Vendor Modal */}
      <Modal open={!!bookModal} onClose={() => setBookModal(null)} title={`📋 Book — ${bv?.name || ""}`}>
        {bv && <div className="space-y-3">
          {bv.isFixed && bv.storedRate && <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm">
            <p className="font-medium text-green-800">Fixed rate on file:</p>
            <p className="text-green-700">{bv.storedRate.desc} — <strong>{fmt(bv.storedRate.amount)}</strong></p>
          </div>}
          <div><label className="text-xs text-gray-500">Function</label>
            <select value={bookForm.functionId} onChange={(e) => setBookForm({ ...bookForm, functionId: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select function...</option>
              {functions.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.date}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500">Service Description</label>
            <input value={bookForm.serviceDesc} onChange={(e) => setBookForm({ ...bookForm, serviceDesc: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-gray-500">Qty</label>
              <input type="number" min="1" value={bookForm.qty} onChange={(e) => setBookForm({ ...bookForm, qty: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-gray-500">Unit</label>
              <select value={bookForm.unit} onChange={(e) => setBookForm({ ...bookForm, unit: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
                {["persons", "days", "trips", "pieces", "kg", "sets", "events"].map((u) => <option key={u}>{u}</option>)}
              </select></div>
            <div><label className="text-xs text-gray-500">Rate ₹{bv.isFixed ? " (fixed)" : ""}</label>
              <input type="number" value={bv.isFixed ? (bv.storedRate?.amount || "") : bookForm.rate}
                readOnly={bv.isFixed} onChange={(e) => setBookForm({ ...bookForm, rate: e.target.value })}
                className={"mt-1 w-full border rounded-lg px-3 py-2 text-sm " + (bv.isFixed ? "bg-gray-100" : "")} /></div>
          </div>
          {bookForm.qty && (bv.isFixed ? bv.storedRate?.amount : bookForm.rate) && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-sm">
              <p>Total: <strong className="text-indigo-800">{fmt((bv.isFixed ? bv.storedRate?.amount || 0 : parseFloat(bookForm.rate) || 0) * parseInt(bookForm.qty || 1))}</strong></p>
              <p className="text-xs text-gray-500 mt-1">Booking sent to vendor portal ({bv.portalKey}). Vendor must respond within 7 days.</p>
            </div>
          )}
          <button onClick={createBooking} className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium">📤 Send Booking to Vendor</button>
        </div>}
      </Modal>
    </div>
  );
}

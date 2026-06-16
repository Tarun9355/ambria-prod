import { useState } from "react";
import { Badge, Modal, Field, Input, Sel, Btn } from "../../components/ui";
import { fmt } from "../../lib/format";
import { nextId } from "../../lib/ims/helpers";
import { OVERHEAD_CATS } from "../../lib/ims/constants";

// Faithful copy of the reference IMS OverheadsTab (Finance → Overheads).
export default function OverheadsTab({ overheads, setOverheads }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ type: "manual", category: "Utilities", description: "", amount: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), receipt: "", loggedBy: "Tarun Sharma" });
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());

  function addOverhead() {
    const id = nextId(overheads, "OH");
    setOverheads((p) => [...p, { ...form, id, amount: parseFloat(form.amount) || 0, status: "Pending", date: new Date().toISOString().slice(0, 10), isTemplate: false }]);
    setModal(false); setForm({ type: "manual", category: "Utilities", description: "", amount: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), receipt: "", loggedBy: "Tarun Sharma" });
  }
  function markPaid(id) { setOverheads((p) => p.map((o) => o.id === id ? { ...o, status: "Paid" } : o)); }

  const filtered = overheads.filter((o) => o.month === filterMonth && o.year === filterYear);
  const total = filtered.reduce((s, o) => s + o.amount, 0);
  const paid = filtered.filter((o) => o.status === "Paid").reduce((s, o) => s + o.amount, 0);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Sel value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))} className="w-28">
            {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </Sel>
          <Sel value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="w-24">
            {[2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}
          </Sel>
        </div>
        <Btn onClick={() => setModal(true)} size="sm">+ Add Overhead</Btn>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-4 text-center"><p className="text-2xl font-bold text-indigo-700">{fmt(total)}</p><p className="text-xs text-gray-500 mt-1">Total Overheads</p></div>
        <div className="bg-white border rounded-xl p-4 text-center"><p className="text-2xl font-bold text-green-700">{fmt(paid)}</p><p className="text-xs text-gray-500 mt-1">Paid</p></div>
        <div className="bg-white border rounded-xl p-4 text-center"><p className="text-2xl font-bold text-red-600">{fmt(total - paid)}</p><p className="text-xs text-gray-500 mt-1">Pending</p></div>
      </div>

      <div className="space-y-2">
        {filtered.map((o) => (
          <div key={o.id} className="bg-white border rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-900">{o.description}</span>
                <Badge color="gray">{o.category}</Badge>
                <Badge color={o.type === "recurring" ? "blue" : "gray"}>{o.type}</Badge>
              </div>
              <p className="text-xs text-gray-400">{o.date} · by {o.loggedBy}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-bold text-gray-900">{fmt(o.amount)}</span>
              {o.status === "Pending" ? <Btn onClick={() => markPaid(o.id)} color="green" size="sm">Mark Paid</Btn> : <Badge color="green">✓ Paid</Badge>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center py-8 text-gray-400">No overheads for {months[filterMonth - 1]} {filterYear}</p>}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Add Overhead Entry">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Sel value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="manual">Manual</option><option value="recurring">Recurring</option></Sel></Field>
            <Field label="Category"><Sel value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{OVERHEAD_CATS.map((c) => <option key={c}>{c}</option>)}</Sel></Field>
          </div>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Amount ₹"><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Btn onClick={addOverhead} className="w-full">Add Overhead</Btn>
        </div>
      </Modal>
    </div>
  );
}

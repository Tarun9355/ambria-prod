import { useState, useEffect, useRef } from "react";

// ─── Shared UI primitives (faithful copies of the reference IMS app) ──────────

// Searchable flower picker (position:fixed dropdown to escape overflow containers).
export function FlowerPicker({ value, catalogue, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const inputRef = useRef(null);
  const selected = (catalogue || []).find((f) => f.id === value);
  const term = search.toLowerCase();
  const filtered = term
    ? (catalogue || []).filter((f) => (f.name || "").toLowerCase().includes(term) || (f.flowerCat || "").toLowerCase().includes(term))
    : (catalogue || []);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  useEffect(() => {
    if (!open || !ref.current) return;
    const update = () => { const r = ref.current.getBoundingClientRect(); setPos({ top: r.bottom + 2, left: r.left }); };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [open]);
  const handleFocus = () => { setOpen(true); setSearch(""); };
  const handlePick = (id) => { onChange(id); setOpen(false); setSearch(""); if (inputRef.current) inputRef.current.blur(); };
  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <div className="flex items-center border rounded bg-white hover:border-indigo-300 focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
        <input ref={inputRef} value={open ? search : (selected ? selected.name : "")} onChange={(e) => setSearch(e.target.value)} onFocus={handleFocus}
          placeholder={selected ? selected.name : "Search flower…"} className="flex-1 min-w-0 px-1.5 py-1 text-xs bg-transparent outline-none" />
        <button type="button" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); if (open) { setOpen(false); setSearch(""); } else { handleFocus(); inputRef.current?.focus(); } }}
          className="px-1 text-gray-400 hover:text-gray-600 text-[10px] flex-shrink-0 leading-none">▼</button>
      </div>
      {open && (
        <div style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, minWidth: "15rem", width: "max-content", maxWidth: "20rem" }} className="bg-white border border-gray-200 rounded-lg shadow-lg">
          <div style={{ maxHeight: "200px", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {filtered.length === 0 && <div className="px-3 py-2.5 text-xs text-gray-400 text-center">No match</div>}
            {filtered.map((f) => (
              <div key={f.id} onMouseDown={(e) => { e.preventDefault(); handlePick(f.id); }}
                className={"px-3 py-1.5 text-xs cursor-pointer hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-0" + (f.id === value ? " bg-indigo-50 font-semibold" : "")}>
                <div className="text-gray-800">{f.name}</div>
                <div className="text-[10px] text-gray-400 leading-tight">{f.flowerCat || ""}{f.currentPrice ? ` · ₹${f.currentPrice}/${f.unit || ""}` : ""}</div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-gray-300 text-center py-0.5 border-t bg-gray-50 rounded-b-lg">{filtered.length} flower{filtered.length !== 1 ? "s" : ""}</div>
        </div>
      )}
    </div>
  );
}

export const BADGE_COLORS = {
  green: "bg-green-100 text-green-800", blue: "bg-blue-100 text-blue-800",
  amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800",
  purple: "bg-purple-100 text-purple-800", gray: "bg-gray-100 text-gray-700",
  pink: "bg-pink-100 text-pink-800", indigo: "bg-indigo-100 text-indigo-800",
  teal: "bg-teal-100 text-teal-800", violet: "bg-violet-100 text-violet-800",
  orange: "bg-orange-100 text-orange-800",
};

export function Badge({ color = "gray", children }) {
  return <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + (BADGE_COLORS[color] || BADGE_COLORS.gray)}>{children}</span>;
}

export function TypeBadge({ type }) {
  if (type === "Premium") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">★ Premium</span>;
  if (type === "In-house") return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">🏠 In-house</span>;
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">$ Budgeted</span>;
}

export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}>
      <div className={"bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] " + (wide ? "w-full max-w-4xl" : "w-full max-w-lg")}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={"px-4 py-2 rounded-lg text-sm font-medium transition-all " + (active === t.id ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }) {
  return <div><label className="text-xs text-gray-500 font-medium">{label}</label><div className="mt-1">{children}</div></div>;
}

export function Input(props) {
  return <input {...props} className={"w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 " + (props.className || "")} />;
}

export function Select({ value, onChange, children, className = "" }) {
  return <select value={value} onChange={onChange} className={"w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 " + className}>{children}</select>;
}
export const Sel = Select;

export function Btn({ onClick, color = "indigo", size = "md", children, className = "" }) {
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const col = {
    indigo: "bg-indigo-600 hover:bg-indigo-700 text-white", gray: "bg-gray-100 hover:bg-gray-200 text-gray-700",
    green: "bg-green-600 hover:bg-green-700 text-white", red: "bg-red-100 hover:bg-red-200 text-red-700",
    amber: "bg-amber-500 hover:bg-amber-600 text-white",
  };
  return <button onClick={onClick} className={`${sz} ${col[color] || col.indigo} rounded-lg font-medium transition-all ${className}`}>{children}</button>;
}

export function AddInlineItem({ placeholder, onAdd }) {
  const [val, setVal] = useState("");
  function submit() { if (val.trim()) { onAdd(val.trim()); setVal(""); } }
  return (
    <div className="flex gap-1 mt-1">
      <input value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder={placeholder} className="flex-1 border rounded px-2 py-1 text-xs" />
      <button onClick={submit} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded">Add</button>
    </div>
  );
}

export function Stars({ val, onChange }) {
  return <div className="flex gap-1">{[1, 2, 3, 4, 5].map((i) => <button key={i} onClick={() => onChange && onChange(i)} className={"text-xl " + (i <= val ? "text-amber-400" : "text-gray-200 hover:text-amber-200")}>{i <= val ? "★" : "☆"}</button>)}</div>;
}

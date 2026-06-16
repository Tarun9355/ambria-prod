// ─── Shared UI primitives (faithful copies of the reference IMS app) ──────────

export const BADGE_COLORS = {
  green: "bg-green-100 text-green-800", blue: "bg-blue-100 text-blue-800",
  amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800",
  purple: "bg-purple-100 text-purple-800", gray: "bg-gray-100 text-gray-700",
  pink: "bg-pink-100 text-pink-800", indigo: "bg-indigo-100 text-indigo-800",
  teal: "bg-teal-100 text-teal-800",
};

export function Badge({ color = "gray", children }) {
  return <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + BADGE_COLORS[color]}>{children}</span>;
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

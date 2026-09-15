import { useState, useEffect, useRef } from "react";

// ─── Shared UI primitives (faithful copies of the reference IMS app) ──────────

// Searchable flower picker (position:fixed dropdown to escape overflow containers). `inventory`
// is optional — when passed (e.g. a pattern's "Artificial included?" toggle is on), its items are
// merged into the same searchable/pickable list as the mandi catalogue, each thumbnail-tagged with
// its source so the caller (which writes either `flowerId` or `invItemId` onto the recipe row) can
// tell them apart. `value`/`valueSource` together identify the current pick ({id, source}).
export function FlowerPicker({ value, valueSource, catalogue, inventory, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const inputRef = useRef(null);
  const mandiCands = (catalogue || []).map((f) => ({ source: "mandi", id: f.id, name: f.name, sub: f.flowerCat || "", price: f.currentPrice, unit: f.unit, img: f.photoUrl }));
  const invCands = (inventory || []).map((it) => ({ source: "inventory", id: it.id, name: it.name, sub: it.subCat || it.subcategory || "", price: it.price ?? it.rentalCost, unit: it.unit, img: it.img || it.photoUrls?.[0] }));
  const allCands = [...mandiCands, ...invCands];
  const selected = allCands.find((c) => c.source === (valueSource || "mandi") && c.id === value);
  const term = search.toLowerCase();
  const filtered = term
    ? allCands.filter((c) => (c.name || "").toLowerCase().includes(term) || (c.sub || "").toLowerCase().includes(term))
    : allCands;
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
  const handlePick = (cand) => { onChange({ id: cand.id, source: cand.source }); setOpen(false); setSearch(""); if (inputRef.current) inputRef.current.blur(); };
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
            {filtered.map((c) => (
              <div key={c.source + ":" + c.id} onMouseDown={(e) => { e.preventDefault(); handlePick(c); }}
                className={"flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-0" + (c.source === (valueSource || "mandi") && c.id === value ? " bg-indigo-50 font-semibold" : "")}>
                {c.img ? <img src={c.img} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" /> : <span className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-[10px] flex-shrink-0">{c.source === "inventory" ? "📦" : "🌸"}</span>}
                <div className="min-w-0 flex-1">
                  <div className="text-gray-800 truncate flex items-center gap-1">
                    {c.name}
                    {c.source === "inventory" && <span className="text-[8px] px-1 rounded bg-indigo-100 text-indigo-700 font-bold flex-shrink-0">IMS</span>}
                  </div>
                  <div className="text-[10px] text-gray-400 leading-tight truncate">{c.sub || ""}{c.price ? ` · ₹${c.price}${c.unit ? "/" + c.unit : ""}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-gray-300 text-center py-0.5 border-t bg-gray-50 rounded-b-lg">{filtered.length} match{filtered.length !== 1 ? "es" : ""}</div>
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

// ─── Confirmation dialog ──────────────────────────────────────────────────────
// Replaces window.confirm, which renders the browser's own "localhost:5173 says" chrome —
// unstyled, un-brandable, and it says the site's hostname rather than anything the user
// recognises. It also blocks the main thread, so nothing can animate behind it.
//
// Kept promise-shaped on purpose, so a call site is a one-word change:
//     if (!window.confirm("Delete?")) return;        →   if (!(await confirm({ ... }))) return;
//
// Usage:
//     const [confirm, confirmDialog] = useConfirm();
//     ...
//     return (<> ...  {confirmDialog} </>);
export function useConfirm() {
  const [state, setState] = useState(null); // { title, body, confirmLabel, danger, resolve }

  const confirm = (opts = {}) => new Promise((resolve) => {
    setState({ confirmLabel: "Delete", danger: true, ...opts, resolve });
  });

  const settle = (answer) => {
    setState((s) => { s?.resolve(answer); return null; });
  };

  // Enter confirms, Escape cancels — window.confirm gave us both for free and losing them
  // would make this a downgrade for anyone working quickly through a list.
  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); settle(false); }
      if (e.key === "Enter") { e.preventDefault(); settle(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const dialog = !state ? null : (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={() => settle(false)}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4">
          <h3 className="text-base font-bold text-gray-900">{state.title}</h3>
          {state.body && <p className="text-sm text-gray-500 mt-2 leading-relaxed whitespace-pre-line">{state.body}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5 rounded-b-2xl">
          <button onClick={() => settle(false)}
            className="px-4 py-2 text-sm rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition">
            Cancel
          </button>
          <button autoFocus onClick={() => settle(true)}
            className={"px-4 py-2 text-sm rounded-lg font-medium text-white transition "
              + (state.danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700")}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return [confirm, dialog];
}

// Sub-tab strip. Only the IMS uses this (Planning, Finance, Admin, Flowers, Mandi, Settings) —
// Studio has its own tab chrome — so it is styled to match the IMS nav rail.
// The narrow-screen form of Tabs. A drawn popover rather than a <select>, because a select's
// option list is rendered by the OS — on desktop Chrome that is the flat blue-highlighted list,
// which no amount of styling on the closed control can fix. This one matches the rest of the IMS:
// white card, soft ring, indigo for the current section.
// `tone="accent"` fills the trigger indigo instead of white. It exists for the phone row where
// two of these sit side by side — the section picker and the department picker. Identical white
// pills gave no clue which of the two scoped the page you were reading; filling the department
// one says it is the narrower, page-defining choice without adding a word of label.
export function TabsMenu({ tabs, active, onChange, tone = "plain" }) {
  const accent = tone === "accent";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxH: 0, flip: false });
  const current = tabs.find((t) => t.id === active) || tabs[0];
  useEffect(() => {
    if (!open) return undefined;
    // ── KEEPING A FIXED POPOVER INSIDE THE WINDOW ──
    // This used to be one line: top = trigger.bottom + 6. Three things went wrong with that on a
    // phone, all visible at once on the department picker, which has eight entries:
    //   1. It re-ran on scroll, so the menu followed its trigger up underneath the sticky page
    //      header — and being fixed at z-60 it painted OVER that header instead of behind it.
    //   2. Eight rows are taller than the space under the trigger, so the list simply ran off
    //      the bottom of the screen with no indication there was more.
    //   3. Nothing clamped `left`, so a trigger near the right edge put the menu half off-screen.
    const GAP = 6;     // breathing room between trigger and menu
    const EDGE = 8;    // smallest gap we will leave against any window edge
    const MIN_H = 132; // below this the menu is too short to be worth flipping for
    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      // The trigger has scrolled out of view — most often beneath the sticky header. A menu
      // anchored to something you can no longer see is not a menu, it is a floating panel over
      // unrelated chrome, so close it rather than reposition it. This is the overlap fix.
      if (r.bottom <= 0 || r.top >= window.innerHeight) { setOpen(false); return; }
      const width = Math.max(r.width, 220);
      // Clamp horizontally: prefer left-aligned with the trigger, but never past either edge.
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE));
      const below = window.innerHeight - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      // Open upward only when below is genuinely cramped AND above is roomier — flipping for a
      // few pixels' gain just makes the menu appear somewhere unexpected.
      const flip = below < MIN_H && above > below;
      setPos({
        top: flip ? Math.max(EDGE, r.top - GAP) : r.bottom + GAP,
        left,
        width,
        maxH: Math.max(MIN_H, flip ? above : below), // taller than this and it scrolls internally
        flip,
      });
    };
    place();
    // mousedown, not click: a click listener fires after the option's own handler has already
    // re-rendered, so the menu closed before the pick registered.
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  return (
    // w-fit: it holds one short section name, and stretched across the screen it read as a page
    // header rather than as the control it is.
    <div ref={wrapRef} className="relative w-fit max-w-full">
      {/* White on a light page rather than a flat grey pill: grey-on-grey gave it no edge, so it
          read as a label someone had tinted rather than a control. A hairline ring plus a small
          shadow is what the cards and inputs on these pages use, so it now belongs to the same
          set — and the chevron sits in its own divided cell, the way a real picker does, instead
          of floating a few pixels after the text. */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={"group inline-flex items-center rounded-xl text-[13px] font-semibold transition-all "
          + (accent
            /* Blue, not the plain branch's indigo: `tone="accent"` is used only by Dept Ops,
               which is on the design system's blue. The plain branch stays indigo because nine
               other IMS tabs render it and they are not on the system yet. */
            ? "bg-blue-600 text-white shadow-[0_1px_2px_rgba(37,99,235,0.3),0_6px_16px_-8px_rgba(37,99,235,0.7)] " + (open ? "ring-2 ring-blue-300" : "hover:bg-blue-700")
            : "bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.06)] " + (open ? "ring-2 ring-indigo-400" : "ring-1 ring-gray-200 hover:ring-gray-300 hover:shadow-[0_1px_2px_rgba(16,24,40,0.08),0_4px_10px_-6px_rgba(16,24,40,0.25)]"))}>
        <span className="truncate pl-3 pr-2 py-2">{current?.label}</span>
        <span aria-hidden="true" className={"shrink-0 self-stretch flex items-center px-2 rounded-r-xl transition-colors "
          + (accent
            ? "text-white/70 bg-white/10"
            : open ? "text-indigo-600 bg-indigo-50/70" : "text-gray-400 bg-gray-50 group-hover:bg-gray-100")}>
          <span className={"transition-transform duration-150 " + (open ? "rotate-180" : "")}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </span>
      </button>
      {open && (
        /* When flipped, the menu is anchored by its BOTTOM to the top of the trigger — the only
           way to grow upward without measuring the rendered list first. maxHeight plus overflow
           is what stops a long list running off either edge; it scrolls inside itself instead. */
        <div role="listbox" style={{
          position: "fixed",
          ...(pos.flip ? { bottom: Math.max(0, window.innerHeight - pos.top) } : { top: pos.top }),
          left: pos.left,
          width: pos.width,
          maxHeight: pos.maxH || undefined,
          zIndex: 60,
        }}
          className="rounded-xl bg-white ring-1 ring-gray-200 shadow-[0_4px_12px_rgba(16,24,40,0.1),0_16px_40px_-12px_rgba(16,24,40,0.3)] overflow-y-auto overscroll-contain py-1">
          {tabs.map((t) => {
            const on = t.id === active;
            return (
              <button key={t.id} type="button" role="option" aria-selected={on}
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={"w-full text-left px-3 py-2 flex items-center gap-2 text-[13px] transition-colors " + (on ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-gray-700 font-medium hover:bg-gray-50")}>
                <span className="min-w-0 truncate flex-1">{t.label}</span>
                {/* A tick on the current one, so the list says where you are as well as where
                    you can go — the highlight alone reads as hover on a touch screen. */}
                {on && (
                  <span aria-hidden="true" className="shrink-0 text-indigo-600">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 7.5 L5.75 10 L11 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <>
    {/* ── PHONE: ONE DROPDOWN ──
        Five pills wrap to two or three rows at phone width, which costs a third of the first
        screen before any content starts — and a wrapped strip stops reading as one control.
        Both forms render from the same `tabs` and `active`, so they cannot drift. */}
    <div className="sm:hidden"><TabsMenu tabs={tabs} active={active} onChange={onChange} /></div>
    <div className="hidden sm:flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
      {tabs.map((t) => (
        /* Same hover as the nav rail: the tab lifts and takes on the active pill's white
           ground, so hovering previews what clicking does. The rail nudges right because it
           is a column; a horizontal strip nudges UP for the same reason — the gesture has to
           run across the axis the items are laid out on, or it reads as a wobble.
           transition-all, not transition, or the shadow and the lift arrive on different
           curves and the movement looks loose. */
        <button key={t.id} onClick={() => onChange(t.id)}
          className={"px-4 py-2 rounded-lg text-sm transition-all duration-150 " +
            (active === t.id
              ? "bg-white text-gray-900 font-semibold shadow-[0_1px_2px_rgba(16,24,40,0.1),0_4px_10px_-4px_rgba(16,24,40,0.22)]"
              : "text-gray-500 font-medium hover:text-gray-900 hover:bg-white/70 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_-6px_rgba(16,24,40,0.2)]")}>
          {t.label}
        </button>
      ))}
    </div>
    </>
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

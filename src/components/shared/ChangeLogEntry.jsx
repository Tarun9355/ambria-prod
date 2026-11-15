// One entry of a change log, as the IMS Activity log draws it: a coloured mark for what happened, the headline
// ("Added 3 items"), who did it and when, and the items under it - name left, qty right. Shared by the Activity log and
// the "Changed in the last 48 hours" list on an event (owner ask 2026-11-15: the same look in both).
//
// items: the amend_requests items [{ name, change, qty, from, to, fromName, fn, zones }]. An entry with no items (a Dept Ops
// edit - actuals, manpower, trucks...) shows its `title` with a neutral mark and no list.

/* ── THE VERB IS SAID ONCE, NOT PER ITEM ──
   Grouping by the change means the verb is stated once and the items sit under it, so what happened is one word and what it
   happened to is a scannable list. The verbs get their own colour and their own mark - added, removed, switched and
   qty-changed are genuinely different events. */
const VERB = {
  swapped: { label: "Switched", mark: "⇄", tile: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200", qty: "text-indigo-700" },
  added: { label: "Added", mark: "+", tile: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", qty: "text-emerald-700" },
  removed: { label: "Removed", mark: "−", tile: "bg-rose-50 text-rose-700 ring-1 ring-rose-200", qty: "text-rose-700" },
  qty_changed: { label: "Quantity changed", mark: "±", tile: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", qty: "text-amber-700" },
};
const EDIT_TILE = "bg-amber-50 text-amber-700 ring-1 ring-amber-200";

const verbOf = (it) => (it.change === "swapped" ? "swapped" : it.change === "removed" ? "removed" : (it.change === "qty_changed" || it.change === "changed") ? "qty_changed" : "added");

// What the row says on its right: the count, "151 → 157 (+6)" for a change, "×8 → ×4" for a switch. Entries logged before
// from / to were recorded have only qty.
const qtyText = (k, it) => {
  const from = Number(it.from), to = Number(it.to);
  const has = Number.isFinite(from) && Number.isFinite(to) && it.from != null && it.to != null;
  if (k === "qty_changed" && has) { const d = to - from; return `${from} → ${to} (${d > 0 ? "+" : ""}${d})`; }
  if (k === "swapped" && has) return `×${from} → ×${to}`;
  if (k === "removed" && has) return `×${from}`;
  if (has) return `×${to}`;
  return it.qty ? `×${it.qty}` : "";
};
// where: the function and zone(s)
const whereText = (it) => [it.fn, (Array.isArray(it.zones) ? it.zones : []).join(", ")].filter(Boolean).join(" · ");

export default function ChangeLogEntry({ items, title = "", by, when, stamp = "", sub = "", times = 1, trailing = null }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const groups = {};
  list.forEach((it) => { const k = verbOf(it); (groups[k] = groups[k] || []).push(it); });
  const keys = ["swapped", "added", "qty_changed", "removed"].filter((k) => groups[k]);
  // The mark takes the verb of the entry's largest group; a mixed entry still lists each verb below.
  const lead = keys.slice().sort((a, b) => groups[b].length - groups[a].length)[0] || null;
  const count = list.length;
  const headline = !count ? title
    : keys.length === 1 ? `${VERB[lead].label} ${count} item${count === 1 ? "" : "s"}` : `${count} item${count === 1 ? "" : "s"} changed`;
  return (
    <div className="flex gap-3 py-3.5">
      <span aria-hidden="true" className={"shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold leading-none " + (lead ? VERB[lead].tile : EDIT_TILE)}>{lead ? VERB[lead].mark : "✎"}</span>
      <div className="min-w-0 flex-1">
        {/* What happened on the first line; who and when under it. */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold text-gray-900">{headline}</span>
            {times > 1 && <span className="shrink-0 text-[10px] font-semibold text-amber-800 bg-amber-100 rounded px-1 tabular-nums">{`×${times}`}</span>}
          </span>
          <span className="shrink-0 flex items-baseline gap-1.5">
            {/* exact time on the title - the shorthand is for scanning */}
            <span className="text-[11px] text-gray-400 whitespace-nowrap tabular-nums" title={stamp}>{when}</span>
            {trailing}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">{`by ${by || "—"}`}{sub ? <span className="text-gray-400">{` · ${sub}`}</span> : null}</div>
        {/* One row per item - name left, qty right-aligned in a column - scans like the inventory it is. */}
        {keys.map((k) => (
          <div key={k} className="mt-2.5">
            {keys.length > 1 && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">{VERB[k].label}</div>}
            <div className="rounded-lg bg-gray-50 divide-y divide-gray-100">
              {groups[k].map((it, ii) => {
                const where = whereText(it);
                const q = qtyText(k, it);
                return (
                  <div key={ii} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      {k === "swapped"
                        ? <div className="text-xs text-gray-700" title={`${it.fromName || "?"} → ${it.name}`}><span className="text-gray-500 line-through decoration-gray-300">{it.fromName || "?"}</span> <span aria-hidden="true" className="text-indigo-500">→</span> <span className="font-semibold text-gray-900">{it.name}</span></div>
                        : <div className={"truncate text-xs " + (k === "removed" ? "text-gray-500 line-through decoration-gray-300" : "text-gray-700")} title={it.name}>{it.name}</div>}
                      {where && <div className="mt-0.5 truncate text-[11px] text-gray-400" title={where}>{where}</div>}
                    </div>
                    {q ? <span className={"shrink-0 text-xs font-semibold tabular-nums whitespace-nowrap " + VERB[k].qty}>{q}</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

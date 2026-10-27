import { useState } from "react";
import { thumbUrl } from "../../lib/studio/thumb.js";

// The Fabric department's inventory block, folded to what a planner reads: three fabrics (Liza, Velvet,
// Wall Masking), each with its image and total, collapsed by default. Opening one (the one that was open closes) shows the colour(s)
// allocated and a zone-by-zone breakdown — how many units each zone takes, how the fabric is applied there, and the zone's own photo.
// Data comes from lib/ims/fabricGroups.js. When the booking's functions fall on two or more dates (fnDates[fi] = the date of function fi), each
// fabric also shows how much of it is used on each date - a total per date on its card, and one column per date beside every zone.

// A segment colour per zone, shared by the allocation bar and the zone rows so the two read together.
const ZONE_TONES = ["bg-indigo-500", "bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-orange-500", "bg-teal-500"];

// The photo when there is one, else the colour's own swatch (a dynamic fill, so inline), else the emoji.
function Thumb({ photo, hex, emoji, size = 48, onZoom, label }) {
  const box = { width: size, height: size };
  if (photo) {
    return (
      <img src={thumbUrl(photo, size * 2)} loading="lazy" decoding="async" alt={label || ""} style={box}
        onClick={onZoom ? (e) => { e.stopPropagation(); onZoom(photo); } : undefined}
        className={"rounded-lg object-cover border border-gray-200 shrink-0 " + (onZoom ? "cursor-zoom-in" : "")} />
    );
  }
  return (
    <span aria-hidden="true" style={hex ? { ...box, background: hex } : box}
      className={"rounded-lg border border-gray-200 shrink-0 inline-flex items-center justify-center text-lg " + (hex ? "" : "bg-gray-50")}>
      {hex ? "" : emoji}
    </span>
  );
}

// One fabric's opened detail: its colours, then where it goes zone by zone.
function FabricDetail({ cur, fmt, onZoom, dates = [], dateOf = () => "" }) {
  const showDates = dates.length > 1;
  const zoneCount = new Set(cur.zones.map((z) => `${z.fi}|${z.zoneKey}`)).size;
  return (
    <div className="space-y-3 rounded-xl bg-gray-50/60 ring-1 ring-gray-100 p-2.5" role="region" aria-label={`${cur.label} details`}>
      {/* Colour(s) allocated to this fabric, each with its own stock photo. */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 mb-1.5">Colour for {cur.label}</div>
        {cur.colours.length ? (
          <div className="flex flex-wrap gap-2">
            {cur.colours.map((c) => (
              <div key={c.colour} className="flex items-center gap-2 pr-3 rounded-xl ring-1 ring-gray-200 bg-white p-1.5">
                <Thumb photo={c.photo} hex={c.hex} emoji={cur.emoji} size={40} onZoom={onZoom} label={`${c.colour} ${cur.label}`} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-gray-900 truncate">{c.colour}</span>
                  <span className="block text-[11px] text-gray-500 tabular-nums">
                    {c.qty} {cur.unit}{(c.qtyOld > 0 && c.qtyNew > 0) ? ` · ${c.qtyOld} old + ${c.qtyNew} new` : (c.qtyNew > 0 ? " · new stock" : "")}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-gray-500">No colour has been picked for this fabric yet — it is chosen in Deal Check, under Fabric allocation.</div>
        )}
      </div>

      {/* Where it goes: one stacked bar for the split, then a row per zone. */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400 mb-1.5">
          {cur.qty} {cur.unit} across {zoneCount} zone{zoneCount === 1 ? "" : "s"}
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100" role="img"
          aria-label={cur.zones.map((z) => `${z.name} ${z.qty} ${cur.unit}`).join(", ")}>
          {cur.zones.map((z, i) => (
            <span key={`${z.fi}|${z.zoneKey}`} className={ZONE_TONES[i % ZONE_TONES.length]}
              style={{ width: `${cur.qty > 0 ? (z.qty / cur.qty) * 100 : 0}%` }} title={`${z.name} · ${z.qty} ${cur.unit}`} />
          ))}
        </div>
        {showDates && (
          <div className="hidden sm:flex items-center gap-2.5 mt-2 px-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-gray-400">
            <span className="flex-1" />
            {dates.map((d) => <span key={d} className="w-16 text-right">{dayLabel(d)}</span>)}
            <span className="w-24 text-right">Total</span>
          </div>
        )}
        <div className={showDates ? "mt-1 space-y-1.5" : "mt-2 space-y-1.5"}>
          {cur.zones.map((z, i) => {
            const share = cur.qty > 0 ? Math.round((z.qty / cur.qty) * 100) : 0;
            return (
              <div key={`${z.fi}|${z.zoneKey}`} className="flex items-center gap-2.5 rounded-xl ring-1 ring-gray-100 bg-white p-2">
                <Thumb photo={z.photo} emoji="📍" size={48} onZoom={onZoom} label={`${z.name} photo`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span aria-hidden="true" className={"shrink-0 w-2 h-2 rounded-full " + ZONE_TONES[i % ZONE_TONES.length]} />
                    <span className="text-sm font-semibold text-gray-900 truncate">{z.name}</span>
                    {z.fnLabel && <span className="text-[11px] text-gray-400 truncate">· {z.fnLabel}</span>}
                    {z.tier && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{z.tier} stock</span>}
                  </div>
                  <div className="text-[12px] text-gray-500 mt-0.5">{z.application || "—"}</div>
                </div>
                {showDates && dates.map((d) => (
                  <div key={d} className="hidden sm:block shrink-0 w-16 text-right tabular-nums" title={`${dayLabel(d)}${z.fnLabel ? " · " + z.fnLabel : ""}`}>
                    {dateOf(z) === d ? <span className="text-sm font-semibold text-gray-700">{r2(z.qty)}</span> : <span className="text-sm text-gray-300">—</span>}
                  </div>
                ))}
                <div className={"shrink-0 text-right tabular-nums " + (showDates ? "sm:w-24" : "")}>
                  {showDates && dateOf(z) && <div className="sm:hidden text-[11px] text-gray-400">{dayLabel(dateOf(z))}</div>}
                  <div className="text-sm font-bold text-gray-900">{z.qty} {cur.unit}</div>
                  <div className="text-[11px] text-gray-400">{share}%{z.amount > 0 ? ` · ${fmt(z.amount)}` : ""}</div>
                </div>
              </div>
            );
          })}
          {showDates && (
            <div className="hidden sm:flex items-center gap-2.5 rounded-xl bg-white ring-1 ring-gray-100 px-2 py-1.5">
              <span className="flex-1 text-[12px] font-semibold text-gray-600">Per date</span>
              {dates.map((d) => <span key={d} className="w-16 text-right text-sm font-bold text-gray-900 tabular-nums">{r2(cur.zones.filter((z) => dateOf(z) === d).reduce((a, z) => a + z.qty, 0)) || "—"}</span>)}
              <span className="w-24 text-right text-sm font-bold text-gray-900 tabular-nums">{cur.qty} {cur.unit}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayLabel = (d) => { try { return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch { return d; } };

export default function FabricBlock({ groups, fmt, onZoom, fnDates }) {
  // The fabric whose detail is open — none at first; opening one closes the one that was open, and tapping the open one closes it.
  const [open, setOpen] = useState(() => new Set());
  if (!groups || !groups.length) return null;
  // the dates fabric is used on (only worth showing from two dates up), and a zone's date through its function
  const dateOf = (z) => (z.fi != null && fnDates ? String(fnDates[z.fi] || "").slice(0, 10) : "");
  const dates = [...new Set(groups.flatMap((g) => g.zones.map(dateOf)).filter(Boolean))].sort();
  const toggle = (key) => setOpen((prev) => (prev.has(key) ? new Set() : new Set([key])));

  return (
    <div className="rounded-xl bg-white ring-1 ring-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-2.5 space-y-3">
      {/* The fabrics, folded. Tap one to open or close its colours and zones. */}
      <div className="grid gap-2 sm:grid-cols-3 items-start">
        {groups.map((g) => {
          const on = open.has(g.key);
          return (
            <div key={g.key} className="space-y-2">
              <button type="button" onClick={() => toggle(g.key)} aria-expanded={on}
                className={"w-full flex items-center gap-2.5 p-2 rounded-xl text-left ring-1 transition-colors cursor-pointer " + (on ? "ring-indigo-400 bg-indigo-50" : "ring-gray-200 bg-white hover:bg-gray-50")}>
                <Thumb photo={g.photo} hex={g.hex} emoji={g.emoji} size={52} label={g.label} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{g.label}</span>
                  <span className="block text-[11px] text-gray-500 truncate">{g.colourText}</span>
                  <span className="block text-[13px] font-bold text-gray-900 tabular-nums">
                    {g.qty} {g.unit}<span className="font-medium text-gray-400"> · {fmt(g.amount)}</span>
                  </span>
                  {dates.length > 1 && (
                    <span className="block text-[11px] text-gray-500 tabular-nums truncate" title={dates.map((d) => `${dayLabel(d)}: ${r2(g.zones.filter((z) => dateOf(z) === d).reduce((a, z) => a + z.qty, 0))} ${g.unit}`).join("  ·  ")}>
                      {dates.map((d) => `${dayLabel(d)} ${r2(g.zones.filter((z) => dateOf(z) === d).reduce((a, z) => a + z.qty, 0))}`).join(" · ")} {g.unit}
                    </span>
                  )}
                </span>
                <span aria-hidden="true" className={"shrink-0 text-gray-400 transition-transform duration-150 " + (on ? "rotate-180" : "")}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* The opened fabrics' details, one after another under the row of cards. */}
      {groups.filter((g) => open.has(g.key)).map((g) => <FabricDetail key={g.key} cur={g} fmt={fmt} onZoom={onZoom} dates={dates} dateOf={dateOf} />)}
    </div>
  );
}

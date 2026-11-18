import { useEffect, useState } from "react";
import { supabase, fetchAll } from "../../lib/supabase";
import { assembleVenuesFromRows } from "../../lib/ims/venueProperties";

// Which venue(s) a site supervisor is fixed at (owner ask 2026-11-18) - Admin → Settings → 👷 Supervisors. Picked from the
// Ambria properties (Manaktala, Exotica, Pushpanjali…) in the `venues` table, by id, so a renamed property stays linked. Stored on
// the supervisor's own row (supervisors.fixed_venues, migration 070).

// The properties, read-only and live (same source the Fixed Venues editor reads). `enabled` false: nothing loaded, no channel.
export function useVenueProperties(enabled = true) {
  const [properties, setProperties] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = async () => {
      const rows = await fetchAll("venues").catch(() => []);
      if (!cancelled) setProperties((assembleVenuesFromRows(rows).properties || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))));
    };
    load();
    const ch = supabase
      .channel("realtime:venues:supervisor-venues")
      .on("postgres_changes", { event: "*", schema: "public", table: "venues" }, load)
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, [enabled]);
  return properties;
}

// Chips - one per property, tap to fix / unfix the supervisor there (more than one allowed). value: property ids.
// disabled: the database has no fixed_venues column yet (migration 070 not run) - shown, not editable.
export default function SupervisorVenueChips({ value, onChange, properties, disabled = false }) {
  const picked = new Set(Array.isArray(value) ? value : []);
  // a property deleted since it was picked still shows, so it can be taken off
  const gone = [...picked].filter((id) => !properties.some((p) => p.id === id));
  const toggle = (id) => {
    if (disabled) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  if (!properties.length && !gone.length) return <span className="text-xs text-gray-400">No venues yet</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fixed at venue">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mr-0.5">Fixed at</span>
      {properties.map((p) => {
        const on = picked.has(p.id);
        return (
          <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on} disabled={disabled}
            title={disabled ? "Run migration 070 first (adds supervisors.fixed_venues)" : on ? `Fixed at ${p.name} - tap to take off` : `Fix at ${p.name}`}
            className={"min-h-[28px] px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 " +
              (on ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700")}>
            {p.icon ? `${p.icon} ` : ""}{p.name}
          </button>
        );
      })}
      {gone.map((id) => (
        <button key={id} type="button" onClick={() => toggle(id)} disabled={disabled} title="This venue was deleted - tap to take it off"
          className="min-h-[28px] px-2.5 py-1 rounded-full text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-700">
          ⚠ deleted venue ✕
        </button>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { supabase, fetchAll } from "../../lib/supabase";
import { assembleVenuesFromRows } from "../../lib/ims/venueProperties";

// Which venue(s) a site supervisor is fixed at (owner ask 2026-11-18) - Admin → Settings → 👷 Supervisors. A dropdown of the main
// venues only (Exotica, Manaktala, Pushpanjali, Restro - the `venues` table's properties): an event at any of a property's
// sub-venues counts under it (lib/ims/fixedVenues siteSupervisorsFor). Picked by id, so a rename stays linked. Stored on the
// supervisor's own row (supervisors.fixed_venues, migration 070).

// The properties and their in-house venues, read-only and live (same source the Fixed Venues editor reads).
// `enabled` false: nothing loaded, no channel.
export function useInhouseVenues(enabled = true) {
  const [venues, setVenues] = useState({ properties: [], inhouse: [] });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = async () => {
      const rows = await fetchAll("venues").catch(() => []);
      if (cancelled) return;
      const v = assembleVenuesFromRows(rows);
      const byName = (a, b) => String(a.name).localeCompare(String(b.name));
      setVenues({ properties: (v.properties || []).slice().sort(byName), inhouse: (v.inhouse || []).slice().sort(byName) });
    };
    load();
    const ch = supabase
      .channel("realtime:venues:supervisor-venues")
      .on("postgres_changes", { event: "*", schema: "public", table: "venues" }, load)
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, [enabled]);
  return venues;
}

// Dropdown + the picked venues as tags (more than one allowed). value: venue ids.
// disabled: the database has no fixed_venues column yet (migration 070 not run) - shown, not editable.
export default function SupervisorVenuePicker({ value, onChange, venues, disabled = false }) {
  const properties = venues?.properties || [];
  const inhouse = venues?.inhouse || [];
  const picked = Array.isArray(value) ? value : [];
  // a sub-venue picked before the list became main venues only still shows by name, so it can be taken off
  const nameOf = new Map([...properties.map((p) => [p.id, p.name]), ...inhouse.map((v) => [v.id, v.parent ? `${v.name} · ${v.parent}` : v.name])]);
  const add = (id) => { if (!disabled && id && !picked.includes(id)) onChange([...picked, id]); };
  const remove = (id) => { if (!disabled) onChange(picked.filter((x) => x !== id)); };
  const free = (id) => !picked.includes(id);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mr-0.5">Fixed at</span>
      {picked.map((id) => (
        <span key={id} className={"inline-flex items-center gap-1 min-h-[28px] pl-2.5 pr-1.5 py-1 rounded-full text-xs font-semibold border " +
          (nameOf.has(id) ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-amber-50 border-amber-300 text-amber-700")}>
          {nameOf.get(id) || "⚠ deleted venue"}
          <button type="button" onClick={() => remove(id)} disabled={disabled} aria-label={`Remove ${nameOf.get(id) || "venue"}`}
            className="w-5 h-5 inline-flex items-center justify-center rounded-full hover:bg-white/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">✕</button>
        </span>
      ))}
      <select value="" onChange={(e) => add(e.target.value)} disabled={disabled}
        title={disabled ? "Run migration 070 first (adds supervisors.fixed_venues)" : "Fix this supervisor at a venue"}
        className="h-8 border border-gray-200 rounded-lg px-2 text-xs text-gray-600 bg-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
        <option value="">{picked.length ? "+ Add venue" : "Select venue…"}</option>
        {properties.filter((p) => free(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}

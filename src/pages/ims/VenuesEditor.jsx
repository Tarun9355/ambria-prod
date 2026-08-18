// IMS → Admin → Settings → 🌆 Venues.
// Sole editor for the in-house venue catalogue (properties + their sub-venues) — Studio's own
// "Venue Management" screen is now read-only for this side, same "IMS owns editing, Studio reads"
// pattern the Rate Card migration already used (see RATE_CARD_MIGRATION_PLAN.md). Outdoor venues
// are untouched: they aren't Fixed-Venue-eligible, and Studio's outdoor editor stays exactly as-is.
//
// Data lives in Studio-owned settings row `ambria-v13-venues` ({inhouse:[...], outdoor:[...]}),
// deliberately excluded from IMS's normal settings sync (see IMS.jsx's applySettingsRows) — same
// self-contained fetch FixedVenuesEditor.jsx/ImsTransportPanel.jsx already use for this exact row.
//
// See VENUE_MIGRATION_PLAN.md (repo root) for the full migration this is Phase 1 of. In particular:
// a rename here does NOT yet cascade into video tags / the transport tier's venue name / library
// photo tags the way a Studio-side rename used to (renameVenueEverywhere, ManageSettings.jsx) —
// that port is Phase 2, not done yet. It DOES update Fixed Venues live (the actual Phase 1 goal).
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { VENUES_SK } from "../../lib/studio/keys";
import { migrateVenues, genVenueId } from "../../lib/ims/venueProperties";

export default function VenuesEditor({ settings, setSettings, showMsg }) {
  const [venues, setVenues] = useState(null); // null = still loading
  const [newPropName, setNewPropName] = useState("");
  const [newSubVenue, setNewSubVenue] = useState({}); // propertyId -> draft name
  const [editing, setEditing] = useState(null); // { kind: "property"|"subvenue", id, name }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", VENUES_SK).maybeSingle();
      if (cancelled) return;
      let raw = data?.value;
      if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
      const migrated = migrateVenues(raw || { inhouse: [], outdoor: [] });
      // Only write back if the migration actually changed something (fresh ids/properties on
      // first run) — re-saving identical data on every load would just be noise.
      if (JSON.stringify(migrated) !== JSON.stringify(raw || { inhouse: [], outdoor: [] })) {
        await supabase.from("settings").upsert({ key: VENUES_SK, value: JSON.stringify(migrated) }, { onConflict: "key" });
      }
      setVenues(migrated);
    };
    load();
    const ch = supabase
      .channel(`realtime:settings:${VENUES_SK}:venues-editor`)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings", filter: `key=eq.${VENUES_SK}` }, load)
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);

  const save = async (next) => {
    setVenues(next);
    const { error } = await supabase.from("settings").upsert({ key: VENUES_SK, value: JSON.stringify(next) }, { onConflict: "key" });
    if (error) showMsg?.("Save failed: " + error.message, "red");
  };

  const propertiesSorted = useMemo(
    () => [...(venues?.properties || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [venues],
  );
  const subVenuesOf = (propertyId) => (venues?.inhouse || []).filter((sv) => sv.propertyId === propertyId).sort((a, b) => a.name.localeCompare(b.name));

  const addProperty = () => {
    const name = newPropName.trim();
    if (!name) return;
    if ((venues.properties || []).some((p) => p.name.toLowerCase() === name.toLowerCase())) { showMsg?.("Property already exists", "red"); return; }
    save({ ...venues, properties: [...venues.properties, { id: genVenueId("prop"), name, manager: "—", icon: "🏛️" }] });
    setNewPropName("");
  };

  const renameProperty = (id, newName) => {
    const name = newName.trim();
    if (!name) return;
    if (venues.properties.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) { showMsg?.("Property already exists", "red"); return; }
    // The id stays constant — this is the whole point. Sub-venues reference propertyId, not the
    // name, so they need no change; only their denormalized `.parent` display string follows, so
    // Studio's existing (unchanged) code keeps reading the right name.
    save({
      ...venues,
      properties: venues.properties.map((p) => (p.id === id ? { ...p, name } : p)),
      inhouse: venues.inhouse.map((sv) => (sv.propertyId === id ? { ...sv, parent: name } : sv)),
    });
    // Fixed Venues links by propertyId, but the actual billing-time match (fixedVenueFor,
    // lib/ims/fixedVenues.js) still compares by NAME string — so the linked entry's own `.name`
    // has to follow the rename too, not just what this screen displays, or the display would show
    // the new name while billing kept matching the old one.
    if (setSettings && (settings?.fixedVenues || []).some((fv) => fv.propertyId === id)) {
      setSettings((s) => ({ ...s, fixedVenues: (s.fixedVenues || []).map((fv) => (fv.propertyId === id ? { ...fv, name } : fv)) }));
    }
    setEditing(null);
    showMsg?.("✓ Renamed — Fixed Venues linked to this property update immediately. Video tags / transport tier / library photos do not yet (Phase 2 — see VENUE_MIGRATION_PLAN.md).", "green");
  };

  const deleteProperty = (id) => {
    const subs = subVenuesOf(id);
    if (subs.length > 0) { showMsg?.(`Remove its ${subs.length} sub-venue${subs.length === 1 ? "" : "s"} first`, "red"); return; }
    if (!window.confirm("Delete this property? This cannot be undone.")) return;
    save({ ...venues, properties: venues.properties.filter((p) => p.id !== id) });
  };

  const addSubVenue = (propertyId) => {
    const name = (newSubVenue[propertyId] || "").trim();
    if (!name) return;
    if (venues.inhouse.some((sv) => sv.name.toLowerCase() === name.toLowerCase())) { showMsg?.("Venue already exists", "red"); return; }
    const property = venues.properties.find((p) => p.id === propertyId);
    save({ ...venues, inhouse: [...venues.inhouse, { id: genVenueId("iv"), name, parent: property?.name || "", propertyId, label: "", type: "Outdoor", base: 0 }] });
    setNewSubVenue((p) => ({ ...p, [propertyId]: "" }));
  };

  const renameSubVenue = (id, newName) => {
    const name = newName.trim();
    if (!name) return;
    if (venues.inhouse.some((sv) => sv.id !== id && sv.name.toLowerCase() === name.toLowerCase())) { showMsg?.("Venue already exists", "red"); return; }
    save({ ...venues, inhouse: venues.inhouse.map((sv) => (sv.id === id ? { ...sv, name } : sv)) });
    setEditing(null);
  };

  const deleteSubVenue = (id, name) => {
    if (!window.confirm(`Delete venue "${name}"? This cannot be undone. Past events keep their original venue name.`)) return;
    save({ ...venues, inhouse: venues.inhouse.filter((sv) => sv.id !== id) });
  };

  if (!venues) return <p className="text-sm text-gray-400 italic py-6">Loading venues…</p>;

  return (
    <div className="bg-white border rounded-2xl p-5">
      <p className="font-bold text-gray-900 mb-1">🌆 Venues</p>
      <p className="text-xs text-gray-500 mb-4">
        In-house properties + their sub-venues (rooms/halls). This is the only place these are added, renamed, or deleted —
        Studio's own "Venue Management" screen is read-only. Outdoor venues stay editable in Studio (they aren't Fixed-Venue-eligible).
        Renaming here updates Fixed Venues immediately; it does not yet update video tags, the transport tier's venue name, or
        library photo tags (see <code className="text-[11px]">VENUE_MIGRATION_PLAN.md</code>, Phase 2).
      </p>

      <div className="space-y-4 mb-5">
        {propertiesSorted.map((p) => {
          const subs = subVenuesOf(p.id);
          const isEditingProp = editing?.kind === "property" && editing.id === p.id;
          return (
            <div key={p.id} className="border rounded-xl p-4 bg-gray-50">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-lg">{p.icon}</span>
                {isEditingProp ? (
                  <>
                    <input autoFocus value={editing.name} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && renameProperty(p.id, editing.name)}
                      className="border rounded-lg px-3 py-1.5 text-sm font-semibold" />
                    <button onClick={() => renameProperty(p.id, editing.name)} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium">Save</button>
                    <button onClick={() => setEditing(null)} className="text-xs px-2.5 py-1 rounded-lg border text-gray-500">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-gray-900">{p.name}</span>
                    <span className="text-[10px] text-gray-400">{subs.length} sub-venue{subs.length === 1 ? "" : "s"}</span>
                    <button onClick={() => setEditing({ kind: "property", id: p.id, name: p.name })} className="text-xs text-indigo-600 ml-1" title="Rename">✏️</button>
                    <button onClick={() => deleteProperty(p.id)} className="text-xs text-red-400 ml-auto" title="Delete">🗑️</button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {subs.map((sv) => {
                  const isEditingSv = editing?.kind === "subvenue" && editing.id === sv.id;
                  if (isEditingSv) {
                    return (
                      <div key={sv.id} className="flex items-center gap-1.5 bg-white border rounded-lg px-2 py-1">
                        <input autoFocus value={editing.name} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && renameSubVenue(sv.id, editing.name)}
                          className="border rounded px-2 py-0.5 text-xs w-32" />
                        <button onClick={() => renameSubVenue(sv.id, editing.name)} className="text-[11px] text-indigo-600 font-semibold">✓</button>
                        <button onClick={() => setEditing(null)} className="text-[11px] text-gray-400">✕</button>
                      </div>
                    );
                  }
                  return (
                    <span key={sv.id} className="inline-flex items-center gap-1.5 bg-white border rounded-lg px-2.5 py-1 text-xs text-gray-700">
                      {sv.name}
                      <button onClick={() => setEditing({ kind: "subvenue", id: sv.id, name: sv.name })} className="text-indigo-500" title="Rename">✏️</button>
                      <button onClick={() => deleteSubVenue(sv.id, sv.name)} className="text-red-400" title="Delete">✕</button>
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <input value={newSubVenue[p.id] || ""} onChange={(e) => setNewSubVenue((s) => ({ ...s, [p.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addSubVenue(p.id)}
                  placeholder="e.g. Poolside" className="border rounded-lg px-2.5 py-1 text-xs w-40" />
                <button onClick={() => addSubVenue(p.id)} className="text-xs px-2.5 py-1 rounded-lg border border-indigo-200 text-indigo-600">+ Add sub-venue</button>
              </div>
            </div>
          );
        })}
        {propertiesSorted.length === 0 && <div className="text-center text-gray-400 text-sm py-6 border border-dashed rounded-xl">No properties yet.</div>}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t">
        <input value={newPropName} onChange={(e) => setNewPropName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProperty()}
          placeholder="e.g. Sohna Farm" className="border rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs" />
        <button onClick={addProperty} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">+ Add property</button>
      </div>
    </div>
  );
}

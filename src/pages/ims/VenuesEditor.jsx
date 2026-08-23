// IMS → Admin → Settings → 🗂️ Master Data → 🌆 Venues.
// Sole editor for the ENTIRE venue catalogue — in-house properties + their sub-venues, AND outdoor
// venues. Studio's own "Venue Management" screen is fully decommissioned once this ships (see
// VENUE_MIGRATION_PLAN.md) — same "IMS owns editing, Studio reads" pattern the Rate Card migration
// already used (RATE_CARD_MIGRATION_PLAN.md).
//
// Data lives in Studio-owned settings row `ambria-v13-venues` ({inhouse:[...], outdoor:[...]}),
// deliberately excluded from IMS's normal settings sync (see IMS.jsx's applySettingsRows) — same
// self-contained fetch FixedVenuesEditor.jsx/ImsTransportPanel.jsx already use for this exact row.
//
// Phase 2 (VENUE_MIGRATION_PLAN.md): every rename here (property, sub-venue, or outdoor) also
// cascades the new name into video tags, the transport tier, and library photo tags — the same
// three things Studio's old renameVenueEverywhere (ManageSettings.jsx, kept there unwired as the
// reference implementation) used to update, ported to write directly via Supabase instead of
// through Studio's in-memory state, since none of the three actually need it: video_tags and
// library are real tables, and the transport tier is a settings row ImsTransportPanel.jsx already
// reads/writes directly from IMS the same way.
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { VENUES_SK, RC_SK_TR } from "../../lib/studio/keys";
import { migrateVenues, genVenueId } from "../../lib/ims/venueProperties";

// Cascades a venue rename into the three places Studio's own renameVenueEverywhere used to update.
// Past events are deliberately excluded — client_ledger/event_orders record where a job actually
// happened, and rewriting that would falsify history. Reference data has no such reason.
async function cascadeRename(oldName, newName) {
  const from = (oldName || "").trim(), to = (newName || "").trim();
  const out = { videos: 0, transport: 0, photos: 0 };
  if (!from || !to || from === to) return out;

  // 1. video_tags — a real table, flat `venue` column, so a single UPDATE does it.
  try {
    const { data } = await supabase.from("video_tags").update({ venue: to, updated_at: new Date().toISOString() }).eq("venue", from).select("video_id");
    out.videos = data?.length || 0;
  } catch { /* a failed pass here must not undo the rename itself */ }

  // 2. transport tier — match case-insensitively, exactly as transportCalc does when it looks the
  //    venue up, so a tier written with different casing still follows the rename.
  try {
    const { data } = await supabase.from("settings").select("value").eq("key", RC_SK_TR).maybeSingle();
    let tr = data?.value;
    if (typeof tr === "string") { try { tr = JSON.parse(tr); } catch { tr = null; } }
    if (tr && Array.isArray(tr.venues)) {
      const hits = tr.venues.filter((v) => String(v?.name || "").trim().toLowerCase() === from.toLowerCase());
      if (hits.length) {
        const nextTr = { ...tr, venues: tr.venues.map((v) => (String(v?.name || "").trim().toLowerCase() === from.toLowerCase() ? { ...v, name: to } : v)) };
        await supabase.from("settings").upsert({ key: RC_SK_TR, value: JSON.stringify(nextTr) }, { onConflict: "key" });
        out.transport = hits.length;
      }
    }
  } catch { /* ignore */ }

  // 3. library photos — page through matches, rewrite tags.venue only, leave every other tag alone.
  try {
    for (let guard = 0; guard < 100; guard++) {
      const { data, error } = await supabase.from("library").select("id,tags").eq("tags->>venue", from).limit(500);
      if (error || !data?.length) break;
      const res = await Promise.all(data.map((r) => supabase.from("library").update({ tags: { ...r.tags, venue: to } }).eq("id", r.id)));
      if (res.some((x) => x.error)) break;
      out.photos += data.length;
      if (data.length < 500) break;
    }
  } catch { /* ignore */ }

  return out;
}
// "3 videos · 2 photos · transport tier" — only the parts that actually moved.
const cascadeSummary = (r) => {
  const bits = [];
  if (r.videos) bits.push(`${r.videos} video tag${r.videos === 1 ? "" : "s"}`);
  if (r.photos) bits.push(`${r.photos} photo${r.photos === 1 ? "" : "s"}`);
  if (r.transport) bits.push("transport tier");
  return bits.length ? ` — ${bits.join(" · ")} updated` : "";
};

export default function VenuesEditor({ settings, setSettings, showMsg }) {
  const [venues, setVenues] = useState(null); // null = still loading
  const [newPropName, setNewPropName] = useState("");
  const [newSubVenue, setNewSubVenue] = useState({}); // propertyId -> draft name
  const [editing, setEditing] = useState(null); // { kind: "property"|"subvenue"|"outdoor", id, name }
  const [newOd, setNewOd] = useState({ name: "", empanelled: true });
  const [odSearch, setOdSearch] = useState("");
  // Commission % — a draft per row (keyed "property:id" / "outdoor:name") so typing doesn't write
  // on every keystroke; committed on blur/Enter, same pattern as every rename input on this screen.
  const [commDraft, setCommDraft] = useState({});
  const commKey = (kind, id) => `${kind}:${id}`;

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
    const orig = venues.properties.find((p) => p.id === id)?.name || "";
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
    showMsg?.("✓ Renamed — updating references…", "green");
    cascadeRename(orig, name).then((r) => showMsg?.(`✓ Renamed${cascadeSummary(r)}. Past events keep their original venue name for audit.`, "green"));
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
    const orig = venues.inhouse.find((sv) => sv.id === id)?.name || "";
    save({ ...venues, inhouse: venues.inhouse.map((sv) => (sv.id === id ? { ...sv, name } : sv)) });
    setEditing(null);
    showMsg?.("✓ Renamed — updating references…", "green");
    cascadeRename(orig, name).then((r) => showMsg?.(`✓ Renamed${cascadeSummary(r)}.`, "green"));
  };

  const deleteSubVenue = (id, name) => {
    if (!window.confirm(`Delete venue "${name}"? This cannot be undone. Past events keep their original venue name.`)) return;
    save({ ...venues, inhouse: venues.inhouse.filter((sv) => sv.id !== id) });
  };

  // ═══ OUTDOOR VENUES ═══ No stable-id/property linking needed (never Fixed-Venue-eligible), so
  // this operates directly on venues.outdoor — same shape ({name, empanelled}) Studio always used.
  const outdoorSorted = useMemo(() => [...(venues?.outdoor || [])].sort((a, b) => a.name.localeCompare(b.name)), [venues]);
  const addOutdoorVenue = () => {
    const name = newOd.name.trim();
    if (!name) return;
    if (venues.outdoor.some((v) => v.name.toLowerCase() === name.toLowerCase())) { showMsg?.("Venue already exists", "red"); return; }
    save({ ...venues, outdoor: [...venues.outdoor, { name, empanelled: newOd.empanelled }] });
    setNewOd({ name: "", empanelled: true });
  };
  const renameOutdoorVenue = (origName, patch) => {
    const name = (patch.name ?? origName).trim();
    if (!name) return;
    if (name !== origName && venues.outdoor.some((v) => v.name.toLowerCase() === name.toLowerCase())) { showMsg?.("Venue already exists", "red"); return; }
    save({ ...venues, outdoor: venues.outdoor.map((v) => (v.name === origName ? { name, empanelled: patch.empanelled ?? v.empanelled } : v)) });
    setEditing(null);
    if (name !== origName) {
      showMsg?.("✓ Renamed — updating references…", "green");
      cascadeRename(origName, name).then((r) => showMsg?.(`✓ Renamed${cascadeSummary(r)}.`, "green"));
    }
  };
  const deleteOutdoorVenue = (name) => {
    if (!window.confirm(`Delete venue "${name}"? This cannot be undone.`)) return;
    save({ ...venues, outdoor: venues.outdoor.filter((v) => v.name !== name) });
  };

  // Commission % — one value per in-house PROPERTY (covers all its sub-venues) or per outdoor
  // venue. Deal Check reads this to set aside that % of the deal amount as commission for
  // whichever venue the booking is at; salespeople can still override the computed amount there.
  const commitCommission = (kind, id) => {
    const raw = commDraft[commKey(kind, id)];
    if (raw === undefined) return;
    const n = raw.trim() === "" ? undefined : Math.max(0, Math.min(100, Number(raw) || 0));
    if (kind === "property") save({ ...venues, properties: venues.properties.map((p) => (p.id === id ? { ...p, commissionPct: n } : p)) });
    else save({ ...venues, outdoor: venues.outdoor.map((v) => (v.name === id ? { ...v, commissionPct: n } : v)) });
    setCommDraft((d) => { const nd = { ...d }; delete nd[commKey(kind, id)]; return nd; });
  };
  const CommissionInput = ({ kind, id, value }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title="Commission % of deal amount set aside for this venue">
      <input
        type="number" min={0} max={100} step={0.5}
        value={commDraft[commKey(kind, id)] ?? (value ?? "")}
        onChange={(e) => setCommDraft((d) => ({ ...d, [commKey(kind, id)]: e.target.value }))}
        onBlur={() => commitCommission(kind, id)}
        onKeyDown={(e) => e.key === "Enter" && commitCommission(kind, id)}
        placeholder="0"
        className="border rounded px-1.5 py-0.5 text-[11px] w-12"
      />
      <span className="text-[10px] text-gray-400">% comm.</span>
    </span>
  );

  if (!venues) return <p className="text-sm text-gray-400 italic py-6">Loading venues…</p>;

  return (
    <div className="bg-white border rounded-2xl p-5">
      <p className="font-bold text-gray-900 mb-1">🌆 In-house Properties</p>
      <p className="text-xs text-gray-500 mb-4">
        Properties + their sub-venues (rooms/halls). This is the only place these — and outdoor venues, below —
        are added, renamed, or deleted; Studio's old "Venue Management" screen is gone. Renaming updates Fixed
        Venues immediately, plus video tags, the transport tier, and library photo tags. Each property/venue also
        carries a commission % — Deal Check uses it to set aside that share of the deal amount as commission for
        wherever the booking is held.
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
                    <CommissionInput kind="property" id={p.id} value={p.commissionPct} />
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

      <div className="flex items-center gap-2 pt-3 border-t mb-6">
        <input value={newPropName} onChange={(e) => setNewPropName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addProperty()}
          placeholder="e.g. Sohna Farm" className="border rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs" />
        <button onClick={addProperty} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">+ Add property</button>
      </div>

      {/* ═══ OUTDOOR VENUES ═══ Empanelled partners + venues we've worked at. Never Fixed-Venue-
          eligible, so no property/id linking here — just name + empanelled, same as Studio always had. */}
      <div className="pt-4 border-t">
        <p className="font-bold text-gray-900 mb-1">🌿 Outdoor Venues</p>
        <p className="text-xs text-gray-500 mb-3">Empanelled partners + venues we've worked at</p>

        <div className="text-xs font-semibold text-gray-700 mb-2">⭐ Empanelled</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {outdoorSorted.filter((v) => v.empanelled).map((v) => {
            const isEditingOd = editing?.kind === "outdoor" && editing.id === v.name;
            if (isEditingOd) {
              return (
                <div key={v.name} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  <input autoFocus value={editing.name} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
                    className="border rounded px-2 py-0.5 text-xs w-36" />
                  {[true, false].map((emp) => (
                    <button key={String(emp)} onClick={() => setEditing((s) => ({ ...s, empanelled: emp }))}
                      className={"text-[10px] px-2 py-0.5 rounded font-medium " + ((editing.empanelled ?? true) === emp ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500")}>
                      {emp ? "⭐" : "🏢"}
                    </button>
                  ))}
                  <button onClick={() => renameOutdoorVenue(v.name, { name: editing.name, empanelled: editing.empanelled })} className="text-[11px] text-indigo-600 font-semibold">Save</button>
                  <button onClick={() => setEditing(null)} className="text-[11px] text-gray-400">Cancel</button>
                </div>
              );
            }
            return (
              <span key={v.name} className="inline-flex items-center gap-1.5 bg-white border rounded-lg px-2.5 py-1.5 text-xs text-gray-700">
                {v.name}
                <button onClick={() => setEditing({ kind: "outdoor", id: v.name, name: v.name, empanelled: v.empanelled })} className="text-indigo-500" title="Rename">✏️</button>
                <CommissionInput kind="outdoor" id={v.name} value={v.commissionPct} />
                <button onClick={() => deleteOutdoorVenue(v.name)} className="text-red-400" title="Delete">✕</button>
              </span>
            );
          })}
        </div>

        <div className="text-xs font-semibold text-gray-700 mb-2">🏢 Other Venues <span className="font-normal text-gray-400">({outdoorSorted.filter((v) => !v.empanelled).length})</span></div>
        <input value={odSearch} onChange={(e) => setOdSearch(e.target.value)} placeholder="Search other venues…" className="border rounded-lg px-3 py-1.5 text-xs mb-2 w-full max-w-xs" />
        <div className="max-h-52 overflow-y-auto border rounded-xl mb-4">
          {outdoorSorted.filter((v) => !v.empanelled && (!odSearch.trim() || v.name.toLowerCase().includes(odSearch.toLowerCase()))).map((v) => {
            const isEditingOd = editing?.kind === "outdoor" && editing.id === v.name;
            if (isEditingOd) {
              return (
                <div key={v.name} className="flex items-center gap-2 px-3 py-2 border-b bg-amber-50">
                  <input autoFocus value={editing.name} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} className="border rounded px-2 py-0.5 text-xs flex-1" />
                  {[true, false].map((emp) => (
                    <button key={String(emp)} onClick={() => setEditing((s) => ({ ...s, empanelled: emp }))}
                      className={"text-[10px] px-2 py-0.5 rounded font-medium " + ((editing.empanelled ?? false) === emp ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500")}>
                      {emp ? "⭐" : "🏢"}
                    </button>
                  ))}
                  <button onClick={() => renameOutdoorVenue(v.name, { name: editing.name, empanelled: editing.empanelled })} className="text-[11px] text-indigo-600 font-semibold">Save</button>
                  <button onClick={() => setEditing(null)} className="text-[11px] text-gray-400">Cancel</button>
                </div>
              );
            }
            return (
              <div key={v.name} className="flex items-center justify-between px-3 py-2 border-b last:border-b-0">
                <span className="text-xs text-gray-800">{v.name}</span>
                <div className="flex items-center gap-3">
                  <CommissionInput kind="outdoor" id={v.name} value={v.commissionPct} />
                  <button onClick={() => setEditing({ kind: "outdoor", id: v.name, name: v.name, empanelled: v.empanelled })} className="text-[11px] text-indigo-600">✏️ Edit</button>
                  <button onClick={() => deleteOutdoorVenue(v.name)} className="text-[11px] text-red-400">✕ Remove</button>
                </div>
              </div>
            );
          })}
          {odSearch.trim() && outdoorSorted.filter((v) => !v.empanelled && v.name.toLowerCase().includes(odSearch.toLowerCase())).length === 0 && (
            <div className="px-3 py-3 text-xs text-gray-400 italic">No match — add it below</div>
          )}
        </div>

        <div className="flex items-end gap-2">
          <input value={newOd.name} onChange={(e) => setNewOd((p) => ({ ...p, name: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addOutdoorVenue()}
            placeholder="e.g. The Leela Palace" className="border rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs" />
          {[true, false].map((emp) => (
            <button key={String(emp)} onClick={() => setNewOd((p) => ({ ...p, empanelled: emp }))}
              className={"text-xs px-3 py-1.5 rounded-lg font-medium " + (newOd.empanelled === emp ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500")}>
              {emp ? "⭐ Empanelled" : "🏢 Other"}
            </button>
          ))}
          <button onClick={addOutdoorVenue} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium">+ Add</button>
        </div>
      </div>
    </div>
  );
}

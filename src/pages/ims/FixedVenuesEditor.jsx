// IMS → Admin → Settings → Venue Min Labour → 🏛️ Fixed Venues.
// A fixed (inhouse) venue owns standing inventory permanently installed there.
// That standing list drives BOTH:
//   • Labour — reused standing items need no build crew (only what's built extra counts).
//   • Cost — standing items bill at a discount; extras/other venues bill full rate.
// Match is by SPECIFIC inventory item (design): swap to a different item → full labour + full rental.
import { useState, useMemo, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { VENUES_SK } from "../../lib/studio/keys";
import { migrateVenues, normVenueName } from "../../lib/ims/venueProperties";
import { MANPOWER_TYPES } from "../../lib/ims/constants";
import { thumbUrl } from "../../lib/studio/thumb";

export default function FixedVenuesEditor({ settings, setSettings, inventory = [], trussInv = null }) {
  // In-house venue catalogue — this whole screen only ever applies to Ambria-owned properties (a
  // client's own outside venue can't have Ambria structure standing there), so the venue picker
  // below must offer ONLY those, not every venue name IMS has ever seen. venueParents (what the
  // dropdown used to be built from) mixes those in with outside venues and bare sub-venue names,
  // with no "is this actually in-house" bit to filter on.
  // The venues row (`ambria-v13-venues`) is Studio-owned and deliberately stripped out of IMS's
  // normal settings load (see IMS.jsx's applySettingsRows) — same self-contained fetch
  // ImsTransportPanel.jsx already does for the same reason, mirrored here rather than widening
  // that filter and pulling every Studio blob into IMS's shared settings state.
  // migrateVenues also runs here (not just in VenuesEditor.jsx) so the stable-id property list
  // this screen links against exists from the FIRST time anyone opens Fixed Venues, without
  // depending on someone having visited the new Venues panel first — see VENUE_MIGRATION_PLAN.md.
  const [venues, setVenues] = useState({ inhouse: [], outdoor: [], properties: [] });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("settings").select("value").eq("key", VENUES_SK).maybeSingle();
      if (cancelled) return;
      let raw = data?.value;
      if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
      const migrated = migrateVenues(raw || { inhouse: [], outdoor: [] });
      if (JSON.stringify(migrated) !== JSON.stringify(raw || { inhouse: [], outdoor: [] })) {
        await supabase.from("settings").upsert({ key: VENUES_SK, value: JSON.stringify(migrated) }, { onConflict: "key" });
      }
      setVenues(migrated);
    };
    load();
    // Live: adding/renaming/deleting an in-house venue in Studio → Manage → Settings should show
    // up here without needing to reload this panel — refetch this one settings row on any change
    // to it instead of the one-time-fetch-on-mount ImsTransportPanel.jsx uses for the same row.
    const ch = supabase
      .channel(`realtime:settings:${VENUES_SK}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings", filter: `key=eq.${VENUES_SK}` }, load)
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  // Stable-id property list — "Manaktala", "Exotica", "Pushpanjali", "Restro" — not each individual
  // room/sub-venue under them ("Aura", "Valencia", "Poolside", "Emerald Green"...). Standing
  // inventory belongs to the property (a console installed "at Pushpanjali" isn't tied to one
  // specific hall there), and fixedVenueFor's own venue-matching (lib/ims/fixedVenues.js) already
  // resolves a function's specific sub-venue up to its parent property before comparing against a
  // configured Fixed Venue. Once a Fixed Venue links to one of these by id (propertyId), its
  // displayed/matched name is read live from here, so a rename in IMS's own Venues editor shows up
  // immediately instead of needing a manual re-pick.
  const properties = venues.properties || [];
  // Fixed-venue repeat discount is defined ONCE per sub-category (applies to all fixed venues). A repeat
  // item bills at its sub-category %; a sub-category with no % → full rental. No other fixed-venue formula.
  const subDisc = (settings.fixedVenueSubcatDiscount && typeof settings.fixedVenueSubcatDiscount === "object") ? settings.fixedVenueSubcatDiscount : {};
  const setSubDisc = (sub, val) => {
    const key = String(sub || "").toLowerCase().trim(); if (!key) return;
    const pct = Math.max(0, Math.min(100, parseInt(val) || 0));
    setSettings((s) => { const m = { ...(s.fixedVenueSubcatDiscount || {}) }; if (pct > 0) m[key] = pct; else delete m[key]; return { ...s, fixedVenueSubcatDiscount: m }; });
  };
  // Default "% off" for a standing item = this global sub-category table, matched by the item's
  // OWN sub-category — the same lookup the table above edits. There used to be a second,
  // per-venue "Default discount" in between (and a per-item override on top of THAT), but the
  // actual repeat-rental billing (DealCheckOverlay's repeatDiscPct) only ever reads this
  // sub-category table — the venue-level default never fed into a real number, just its own
  // display. Items still get their own per-item override (editable below); it just now defaults
  // from the one table that actually drives billing instead of a number that didn't.
  const subcatDiscFor = (invId) => {
    const inv = inventory.find((i) => i.id === invId);
    const key = String(inv?.subCat || inv?.subcategory || "").toLowerCase().trim();
    return key ? (subDisc[key] ?? 0) : 0;
  };
  const [openDept, setOpenDept] = useState(null); // which department's sub-category list is expanded
  const _catDeptCfg = (settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const _kwDept = (cat) => { const s = String(cat || "").toLowerCase(); if (s.includes("floral") || s.includes("flower")) return "Floral"; if (s.includes("light") || s.includes("chandel") || s.includes("led")) return "Lighting"; if (s.includes("truss")) return "Tenting"; if (s.includes("mask") || s.includes("fabric") || s.includes("drap") || s.includes("ceiling") || s.includes("liza") || s.includes("curtain")) return "Fabric"; if (s.includes("platform") || s.includes("carpet") || s.includes("tent")) return "Tenting"; if (s.includes("transport") || s.includes("truck")) return "Transport"; if (s.includes("furnitur") || s.includes("sofa") || s.includes("chair") || s.includes("couch")) return "Furniture"; return "Structure"; };
  const _catToDept = (cat) => { const k = String(cat || "").toLowerCase().trim(); return _catDeptCfg[k] || _kwDept(cat); };
  // Distinct sub-categories grouped by their department (from inventory categories).
  const subcatsByDept = useMemo(() => {
    const m = {};
    (inventory || []).forEach((i) => { const sub = String(i.subCat || i.subcategory || "").trim(); if (!sub) return; const dept = _catToDept(i.cat || i.category); (m[dept] = m[dept] || new Set()).add(sub); });
    const out = {}; Object.keys(m).sort().forEach((d) => { out[d] = [...m[d]].sort((a, b) => a.localeCompare(b)); }); return out;
  }, [inventory, settings.categoryDepartments]);
  const pillarSizes = Object.keys(trussInv?.pillars || {}).sort((a, b) => Number(b) - Number(a));
  const beamSizes = Object.keys(trussInv?.beams || {}).sort((a, b) => Number(b) - Number(a));
  const fixedVenues = settings.fixedVenues || [];
  const save = (next) => setSettings((s) => ({ ...s, fixedVenues: next }));
  const [activeId, setActiveId] = useState(null);
  // Raw text of whichever number field is mid-edit, keyed "<venueId>:<invId>:<field>".
  // The inputs used to normalise on every keystroke — `parseInt(v) || 1` meant backspacing to empty
  // snapped straight back to 1, and clamping to `avail` on each character made a number wider than
  // the stock impossible to type at all. Normalising happens on blur now, so typing is untouched.
  const [numDraft, setNumDraft] = useState({});
  const draftKey = (vid, invId, field) => `${vid}:${invId}:${field}`;

  // Venue names must match what Studio uses for a function's venue — and, per the comment
  // above, only an in-house PROPERTY can own standing inventory at all. Already-added fixed
  // venues stay offered too (and selectable even if one somehow drops off the property list
  // later — see the "(not in venue list)" fallback option below), so removing/renaming a venue
  // in Studio can't silently orphan an existing Fixed Venue config here — no existing data is
  // hidden or lost by narrowing this list, only what's offered for NEW picks changes.
  const venueOptions = [...new Set([
    ...properties.map((p) => p.name),
    ...fixedVenues.map((v) => v.name).filter(Boolean),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const addable = venueOptions.filter((n) => !fixedVenues.some((v) => v.name === n));

  const addVenue = (name) => {
    if (!name || fixedVenues.some((v) => v.name === name)) return;
    const cfg = settings.venueMinLabour?.[name];
    const min = (cfg && typeof cfg === "object" ? cfg.min : (typeof cfg === "number" ? cfg : null)) || 4;
    const id = "fv_" + Date.now().toString(36).slice(-6);
    const property = properties.find((p) => p.name === name);
    save([...fixedVenues, { id, name, propertyId: property?.id || null, minLabour: min, items: [] }]);
    setActiveId(id); // jump to the new venue's tab
  };
  const updVenue = (id, patch) => save(fixedVenues.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  // One-time backfill (VENUE_MIGRATION_PLAN.md Phase 1): a Fixed Venue saved before properties[]
  // existed only carries a bare .name. Link it to a property by matching that name once properties
  // load — same normalization fixedVenueFor uses for this exact match — so it starts tracking
  // renames instead of staying a static string forever. Never touches an already-linked entry, and
  // never guesses when a name can't be matched (it just stays as it is today, same as before).
  useEffect(() => {
    if (!properties.length) return;
    const needsLink = fixedVenues.some((v) => !v.propertyId);
    if (!needsLink) return;
    let changed = false;
    const linked = fixedVenues.map((v) => {
      if (v.propertyId) return v;
      const match = properties.find((p) => normVenueName(p.name) === normVenueName(v.name));
      if (!match) return v;
      changed = true;
      return { ...v, propertyId: match.id, name: match.name };
    });
    if (changed) save(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);
  const updCrew = (vid, type, val) => { const v = fixedVenues.find((x) => x.id === vid); updVenue(vid, { fixedCrew: { ...(v.fixedCrew || {}), [type]: Math.max(0, parseInt(val) || 0) } }); };
  const delVenue = (id) => { const v = fixedVenues.find((x) => x.id === id); if (!window.confirm(`Remove fixed venue "${v?.name}"? Its standing inventory config is deleted.`)) return; if (activeId === id) setActiveId(null); save(fixedVenues.filter((x) => x.id !== id)); };

  const addItem = (vid, inv) => {
    if (!inv) return;
    const v = fixedVenues.find((x) => x.id === vid);
    if (v.items.some((it) => it.invId === inv.id)) return; // already added
    updVenue(vid, { items: [...v.items, { invId: inv.id, name: inv.name, qty: 1, discountPct: subcatDiscFor(inv.id) }] });
  };
  const updItem = (vid, invId, patch) => { const v = fixedVenues.find((x) => x.id === vid); updVenue(vid, { items: v.items.map((it) => (it.invId === invId ? { ...it, ...patch } : it)) }); };
  const delItem = (vid, invId) => { const v = fixedVenues.find((x) => x.id === vid); updVenue(vid, { items: v.items.filter((it) => it.invId !== invId) }); };
  const updTruss = (vid, kind, size, qty) => {
    const v = fixedVenues.find((x) => x.id === vid);
    const truss = { pillars: { ...(v.truss?.pillars || {}) }, beams: { ...(v.truss?.beams || {}) } };
    if (qty > 0) truss[kind][size] = qty; else delete truss[kind][size];
    updVenue(vid, { truss });
  };
  // Pieces of an inventory item free to assign HERE = stock minus what other fixed venues hold.
  const invAvail = (invId, vid) => {
    const inv = inventory.find((i) => i.id === invId);
    const stock = Number(inv?.qty ?? inv?.qtyOwned) || 0;
    const otherStanding = fixedVenues.filter((x) => x.id !== vid).reduce((s, x) => s + (Number((x.items || []).find((it) => it.invId === invId)?.qty) || 0), 0);
    return Math.max(0, stock - otherStanding);
  };
  // Which OTHER fixed venues already hold this item standing. The cap on its own just refuses the
  // keystroke; naming who holds the rest turns "why won't it save 10?" into something actionable.
  const standingElsewhere = (invId, vid) => fixedVenues
    .filter((x) => x.id !== vid)
    .map((x) => ({ name: x.name || x.id, qty: Number((x.items || []).find((it) => it.invId === invId)?.qty) || 0 }))
    .filter((r) => r.qty > 0);
  const stockOf = (invId) => {
    const inv = inventory.find((i) => i.id === invId);
    return Number(inv?.qty ?? inv?.qtyOwned) || 0;
  };
  // Photo + dimensions off an inventory row. The standing-item rows already derived these inline;
  // the picker needs the same, so it lives in one place rather than being written twice.
  const invPhoto = (inv) => inv?.img || inv?.photoUrls?.[0] || inv?.photo_urls?.[0] || "";
  const invDims = (inv) => {
    const raw = inv?.dims_LxWxH ?? inv?.dims?.lxwxh;
    if (typeof raw === "string" && raw) return raw;
    if (raw && typeof raw === "object") {
      const d = [raw.l, raw.w, raw.h].filter((x) => x != null && x !== "").join(" × ");
      if (d) return d;
    }
    return typeof inv?.size === "string" ? inv.size : "";
  };
  // Which venue tab's picker is open, and what has been typed into it.
  const [pickQuery, setPickQuery] = useState({});
  const [pickOpen, setPickOpen] = useState(null);
  // Pieces of a truss size available to assign HERE = stock (Planning) minus what other
  // fixed venues already hold standing.
  const trussAvail = (kind, size, vid) => {
    const stock = Number(trussInv?.[kind]?.[size]?.stock) || 0;
    const otherStanding = fixedVenues.filter((x) => x.id !== vid).reduce((s, x) => s + (Number(x.truss?.[kind]?.[size]) || 0), 0);
    return Math.max(0, stock - otherStanding);
  };

  // The venue whose panel is shown — the selected tab, or the first venue as a fallback.
  const active = fixedVenues.find((v) => v.id === activeId) || fixedVenues[0] || null;

  return (
    <div className="bg-white border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="font-bold text-gray-900">🏛️ Fixed Venues (standing inventory)</p>
        {addable.length > 0
          ? <select value="" onChange={(e) => { addVenue(e.target.value); e.target.value = ""; }} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium border-none cursor-pointer">
              <option value="">+ Add Fixed Venue…</option>
              {addable.map((n) => <option key={n} value={n} className="bg-white text-gray-800">{n}</option>)}
            </select>
          : <span className="text-xs text-gray-400">Add venues in “Venue Min Labour” above first</span>}
      </div>
      <p className="text-xs text-gray-500 mb-3">Inhouse venues that own permanently-installed structure. Reusing a standing item = no build labour + discounted rental. Swapping to a different item, or extras beyond the standing qty, bill full labour + full rental.</p>

      {/* Sub-category repeat discounts — set ONCE per sub-category, applied to all fixed venues. A repeat
          item bills at its sub-category %; no % → full rental. This is the ONLY fixed-venue discount. */}
      <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <span className="text-sm font-bold text-emerald-800">♻️ Repeat discounts by sub-category</span>
          <span className="text-xs text-emerald-600">{Object.keys(subDisc).length} set · applies to every fixed venue</span>
        </div>
        <p className="text-xs text-emerald-600 mb-2">Each department sets a discount % per sub-category. A repeat/reused item bills at its sub-category's %; anything without a % bills at full rental.</p>
        <div className="space-y-1.5">
          {Object.entries(subcatsByDept).map(([dept, subs]) => {
            const open = openDept === dept;
            const setCount = subs.filter((sub) => subDisc[sub.toLowerCase().trim()] != null).length;
            return (
              <div key={dept} className="bg-white border border-emerald-100 rounded-lg overflow-hidden">
                <button onClick={() => setOpenDept(open ? null : dept)} className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left">
                  <span className="text-sm font-semibold text-gray-800">{open ? "▾" : "▸"} {dept} <span className="text-xs font-normal text-gray-400">· {subs.length} sub-cat{subs.length > 1 ? "s" : ""}</span></span>
                  {setCount > 0 && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">{setCount} discounted</span>}
                </button>
                {open && (
                  <div className="px-3 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {subs.map((sub) => { const key = sub.toLowerCase().trim(); return (
                      <div key={sub} className="flex items-center gap-2 border rounded-lg px-2 py-1">
                        <span className="text-xs text-gray-700 flex-1 truncate" title={sub}>{sub}</span>
                        <input type="number" min="0" max="100" value={subDisc[key] ?? ""} onChange={(e) => setSubDisc(sub, e.target.value)} placeholder="0" className="w-14 border rounded px-1.5 py-0.5 text-sm text-center" />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                    ); })}
                  </div>
                )}
              </div>
            );
          })}
          {Object.keys(subcatsByDept).length === 0 && <div className="text-xs text-gray-400 text-center py-3">No inventory sub-categories found.</div>}
        </div>
      </div>

      {fixedVenues.length === 0 && <div className="text-center text-gray-400 text-sm py-8 border border-dashed rounded-xl">No fixed venues yet. Add one (e.g. Ambria Exotica) to define its standing inventory.</div>}

      {/* Tab strip — one tab per venue. Only the active venue's panel renders below, so the
          list stays compact no matter how many venues / standing items exist. */}
      {fixedVenues.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap border-b border-gray-200 mb-4">
          {fixedVenues.map((v) => {
            const isActive = (active?.id || fixedVenues[0]?.id) === v.id;
            const count = (v.items?.length || 0) + Object.keys(v.truss?.pillars || {}).length + Object.keys(v.truss?.beams || {}).length;
            return (
              <button key={v.id} onClick={() => setActiveId(v.id)}
                className={"px-3 py-2 text-sm font-semibold rounded-t-lg -mb-px border-b-2 transition-colors " + (isActive ? "border-indigo-600 text-indigo-700 bg-indigo-50" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50")}>
                🏛️ {v.name}{count > 0 && <span className={"ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full " + (isActive ? "bg-indigo-200 text-indigo-800" : "bg-gray-200 text-gray-500")}>{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        {active && [active].map((v) => (
          <div key={v.id} className="border rounded-xl p-4 bg-gray-50">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <select value={v.name} onChange={(e) => { const n = e.target.value; const property = properties.find((p) => p.name === n); updVenue(v.id, { name: n, propertyId: property?.id || null }); }} className="border rounded-lg px-3 py-1.5 text-sm font-semibold flex-1 min-w-[160px] bg-white">
                {venueOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                {!venueOptions.includes(v.name) && <option value={v.name}>{v.name} (not in venue list)</option>}
              </select>
              <div className="flex items-center gap-1"><span className="text-xs text-gray-500">Min labour</span><input type="number" min="0" value={v.minLabour ?? 4} onChange={(e) => updVenue(v.id, { minLabour: parseInt(e.target.value) || 0 })} className="w-14 border rounded px-2 py-1 text-sm text-center" /></div>
              <button onClick={() => delVenue(v.id)} className="text-red-400 hover:text-red-600 text-sm ml-auto">🗑️</button>
            </div>

            {/* Fixed crew per type — the standing/repeat manpower for this venue. On a Repeat deal this is
                the base crew; anything fresh/extra adds on top (same as the Labours floor+extra rule). */}
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Fixed crew (repeat setup) <span className="font-normal text-gray-400 normal-case">— base manpower when the setup is reused; extra fresh work adds on top</span></div>
            <div className="flex flex-wrap gap-2 mb-3">
              {MANPOWER_TYPES.map((t) => (
                <div key={t} className="flex items-center gap-1 bg-white border rounded-lg px-2 py-1">
                  <span className="text-xs text-gray-600">{t}</span>
                  <input type="number" min="0" value={(v.fixedCrew || {})[t] ?? ""} onChange={(e) => updCrew(v.id, t, e.target.value)} placeholder="0" className="w-12 border rounded px-1.5 py-0.5 text-sm text-center" />
                </div>
              ))}
            </div>

            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Standing inventory <span className="font-normal text-gray-400 normal-case">— specific items installed here (location = {v.name})</span></div>
            <div className="space-y-1.5 mb-2">
              {v.items.map((it) => {
                const inv = inventory.find((i) => i.id === it.invId);
                const img = inv?.img || inv?.photoUrls?.[0] || "";
                const dimsRaw = inv?.dims_LxWxH ?? inv?.dims?.lxwxh;
                let dims = "";
                if (typeof dimsRaw === "string") dims = dimsRaw;
                else if (dimsRaw && typeof dimsRaw === "object") dims = [dimsRaw.l, dimsRaw.w, dimsRaw.h].filter((x) => x != null && x !== "").join("×");
                if (!dims) dims = (typeof inv?.size === "string" ? inv.size : "") || "";
                const avail = invAvail(it.invId, v.id);
                // The cap is stock minus what the other venues hold, so it can be well under the
                // stock figure printed next to the name. Explain that rather than silently clamping.
                const elsewhere = standingElsewhere(it.invId, v.id);
                const stock = stockOf(it.invId);
                const typedQty = parseInt(numDraft[draftKey(v.id, it.invId, "qty")] ?? it.qty, 10);
                const overCap = Number.isFinite(typedQty) && typedQty > avail;
                const atCap = !overCap && avail > 0 && (Number(it.qty) || 0) >= avail && elsewhere.length > 0;
                const heldBy = elsewhere.map((r) => `${r.qty} at ${r.name}`).join(", ");
                return (
                <div key={it.invId} className="flex items-center gap-2 bg-white border rounded-lg px-2.5 py-1.5 flex-wrap">
                  {img
                    ? <img src={img} alt="" className="w-11 h-11 rounded object-cover border flex-shrink-0" onError={(e) => { e.target.style.display = "none"; }} />
                    : <div className="w-11 h-11 rounded bg-gray-100 border flex-shrink-0 flex items-center justify-center text-gray-300 text-lg">🖼️</div>}
                  <div className="flex-1 min-w-[140px]">
                    <div className="text-sm text-gray-800">{it.name}</div>
                    <div className="text-[10px] text-gray-400">{dims ? `📐 ${dims}` : "no dimensions"}{inv?.qty != null ? ` · stock ${inv.qty}` : ""}</div>
                  </div>
                  <span className="text-xs text-gray-400">qty</span>
                  <input type="number" min="1" max={avail || undefined}
                    value={numDraft[draftKey(v.id, it.invId, "qty")] ?? it.qty}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setNumDraft((d) => ({ ...d, [draftKey(v.id, it.invId, "qty")]: raw }));
                      // Commit only a usable number as you type; empty or partial input just sits in
                      // the draft, so the field never fights the cursor.
                      const n = parseInt(raw, 10);
                      if (Number.isFinite(n) && n > 0) updItem(v.id, it.invId, { qty: n });
                    }}
                    onBlur={(e) => {
                      const n = parseInt(e.target.value, 10);
                      const safe = Number.isFinite(n) && n > 0 ? (avail > 0 ? Math.min(n, avail) : n) : 1;
                      updItem(v.id, it.invId, { qty: safe });
                      setNumDraft((d) => { const next = { ...d }; delete next[draftKey(v.id, it.invId, "qty")]; return next; });
                    }}
                    className={"w-16 border rounded px-2 py-1 text-sm text-center font-bold " + (it.qty >= avail && avail > 0 ? "border-amber-400" : "")} />
                  <span className="text-[10px] text-gray-400">/{avail}</span>
                  <span className="text-xs text-gray-400">rent @</span>
                  <input type="number" min="0" max="100"
                    value={numDraft[draftKey(v.id, it.invId, "disc")] ?? (it.discountPct ?? subcatDiscFor(it.invId))}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setNumDraft((d) => ({ ...d, [draftKey(v.id, it.invId, "disc")]: raw }));
                      const n = parseInt(raw, 10);
                      if (Number.isFinite(n)) updItem(v.id, it.invId, { discountPct: n });
                    }}
                    onBlur={(e) => {
                      const n = parseInt(e.target.value, 10);
                      const safe = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
                      updItem(v.id, it.invId, { discountPct: safe });
                      setNumDraft((d) => { const next = { ...d }; delete next[draftKey(v.id, it.invId, "disc")]; return next; });
                    }}
                    className="w-14 border rounded px-2 py-1 text-sm text-center" />
                  <span className="text-xs text-gray-400">% off</span>
                  <button onClick={() => delItem(v.id, it.invId)} className="text-red-400 hover:text-red-600 text-xs ml-auto">×</button>
                  {/* basis-full so it drops to its own line inside the wrapping row. Amber while you
                      are typing past the cap; muted once you are simply sitting at it. */}
                  {/* Two different reasons you can hit the cap, and they need different advice:
                      either another venue is holding pieces (go free them), or you simply own no
                      more (go buy/raise stock). Saying "free it there" when there is no "there"
                      just reads as broken. */}
                  {overCap && (
                    <div className="basis-full text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                      Max <strong>{avail}</strong> here — {heldBy
                        ? <>you own {stock}, and {heldBy} {elsewhere.length === 1 && elsewhere[0].qty === 1 ? "is" : "are"} already installed elsewhere. Free {elsewhere.length === 1 && elsewhere[0].qty === 1 ? "it" : "them"} there, or raise the stock in Inventory.</>
                        : <>that is your whole stock. Raise it in Inventory to install more.</>}
                      {" "}Anything higher snaps back to {avail}.
                    </div>
                  )}
                  {atCap && (
                    <div className="basis-full text-[11px] text-gray-500 mt-0.5">
                      At the limit — all {stock} in stock are assigned ({heldBy}).
                    </div>
                  )}
                </div>
                );
              })}
              {/* Same plain wording as the placeholder — "designs" only means something to us. */}
              {v.items.length === 0 && <div className="text-xs text-gray-400 italic">Nothing added yet — search below for the items permanently installed at {v.name}.</div>}
            </div>

            {/* ═══ ITEM PICKER ═══
                Was a native <datalist>, which the browser renders itself — no photo, no dimensions,
                no stock, and no say in how it looks. Standing inventory is chosen by DESIGN, and
                these items are told apart by appearance far more than by name ("Ivory Couple Couch
                11" vs "15"), so a list of bare strings made you guess. This is the same shape as the
                Deal Check lookup: thumbnail, sub-category › category, size, and what is free. */}
            {(() => {
              const q = (pickQuery[v.id] || "").trim().toLowerCase();
              const taken = new Set(v.items.map((it) => it.invId));
              const pool = inventory.filter((i) => !taken.has(i.id));
              const hits = !q ? pool.slice(0, 40) : pool.filter((i) => {
                const hay = `${i.name || ""} ${i.code || ""} ${i.cat || ""} ${i.subCat || i.sub_cat || ""}`.toLowerCase();
                // every word must appear somewhere, so "ivory couch" finds "Ivory Couple Couch 11"
                return q.split(/\s+/).every((t) => hay.includes(t));
              }).slice(0, 40);
              const open = pickOpen === v.id;
              // Capped rather than full-bleed: a search box as wide as the panel looks like the
              // primary control on the page, when it is a small add action under the list.
              // Bounding the wrapper keeps the dropdown (left-0 right-0) to the same width.
              return (
                <div className="relative max-w-md">
                  {/* The box sits below the list, so without a label it reads as a filter for the
                      rows above. "Add" and the venue name are the whole point; the placeholder
                      already covers how to search. */}
                  <div className="text-[11px] font-semibold text-gray-600 mb-1">Add standing inventory at {v.name}</div>
                  <input
                    value={pickQuery[v.id] || ""}
                    // "(design)" was internal shorthand for "pick the exact item, not the category".
                    // An example does that job without the jargon, and shows what typing gets you.
                    placeholder="Type to search — e.g. chandelier, ivory couch"
                    // Width is capped by the wrapper; the height stays normal. Shrinking the padding
                    // and text as well made it look squashed rather than just narrower.
                    className="border rounded-lg px-3 py-1.5 text-sm w-full"
                    onFocus={() => setPickOpen(v.id)}
                    onChange={(e) => { setPickQuery((s) => ({ ...s, [v.id]: e.target.value })); setPickOpen(v.id); }}
                    // A click on a result would otherwise be lost to the blur that closes the list.
                    onBlur={() => setTimeout(() => setPickOpen((o) => (o === v.id ? null : o)), 150)}
                  />
                  {open && (
                    <div className="absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-white border rounded-lg shadow-lg">
                      {hits.length === 0 && (
                        <div className="px-3 py-3 text-xs text-gray-400 italic">
                          {q ? `Nothing matches “${pickQuery[v.id]}”.` : "No inventory left to add here."}
                        </div>
                      )}
                      {hits.map((i) => {
                        const free = invAvail(i.id, v.id);
                        const photo = invPhoto(i);
                        const dims = invDims(i);
                        const sub = i.subCat || i.sub_cat || "";
                        return (
                          <button key={i.id} type="button"
                            onMouseDown={(e) => e.preventDefault()}   // keep focus so onBlur does not fire first
                            onClick={() => { addItem(v.id, i); setPickQuery((s) => ({ ...s, [v.id]: "" })); setPickOpen(null); }}
                            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 text-left border-b last:border-b-0">
                            {photo
                              ? <img src={thumbUrl(photo, 40)} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded object-cover border flex-shrink-0" onError={(e) => { e.target.style.visibility = "hidden"; }} />
                              : <div className="w-10 h-10 rounded border bg-gray-100 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-900 truncate">{i.name}</div>
                              <div className="text-[11px] text-gray-500 truncate">
                                {sub && <span className="text-indigo-600">{sub}</span>}
                                {sub && i.cat ? " › " : ""}{i.cat || ""}{dims ? ` · ${dims}` : ""}
                              </div>
                            </div>
                            {/* What is actually free to install HERE — stock minus other venues. */}
                            <span className={"text-[10px] px-2 py-0.5 rounded flex-shrink-0 " + (free > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                              {free > 0 ? `${free} free` : "none free"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Standing truss — pillars/beams installed here (totals per size, sizes live from Planning) */}
            <div className="text-xs font-semibold text-gray-500 uppercase mt-3 mb-1.5">Standing truss <span className="font-normal text-gray-400 normal-case">— installed pillars/beams · “/N” = pieces free to assign here</span></div>
            {(() => {
              // Sizes come live from Planning truss inventory; also keep any size this venue
              // already uses (so a size removed in Planning can still be zeroed, not lost).
              const vPillars = [...new Set([...pillarSizes, ...Object.keys(v.truss?.pillars || {})])].sort((a, b) => Number(b) - Number(a));
              const vBeams = [...new Set([...beamSizes, ...Object.keys(v.truss?.beams || {})])].sort((a, b) => Number(b) - Number(a));
              if (vPillars.length === 0 && vBeams.length === 0) return <div className="text-xs text-gray-400 italic">Truss sizes load from Planning → Truss inventory. Add sizes there first.</div>;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 w-14">🔩 Pillars</span>
                    {vPillars.map((sz) => { const avail = trussAvail("pillars", sz, v.id); return (
                      <span key={sz} className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-teal-700 font-medium">{sz}ft</span>
                        <input type="number" min="0" max={avail} value={v.truss?.pillars?.[sz] ?? 0} onChange={(e) => updTruss(v.id, "pillars", sz, Math.min(parseInt(e.target.value) || 0, avail))} className="w-12 border border-teal-200 rounded px-1 py-0.5 text-xs text-center font-bold" />
                        <span className="text-[10px] text-gray-400">/{avail}</span>
                      </span>
                    ); })}
                    <span className="text-[10px] text-gray-400">total {Object.values(v.truss?.pillars || {}).reduce((s, q) => s + (Number(q) || 0), 0)} pillars</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 w-14">➖ Beams</span>
                    {vBeams.map((sz) => { const avail = trussAvail("beams", sz, v.id); return (
                      <span key={sz} className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-amber-700 font-medium">{sz}ft</span>
                        <input type="number" min="0" max={avail} value={v.truss?.beams?.[sz] ?? 0} onChange={(e) => updTruss(v.id, "beams", sz, Math.min(parseInt(e.target.value) || 0, avail))} className="w-12 border border-amber-200 rounded px-1 py-0.5 text-xs text-center font-bold" />
                        <span className="text-[10px] text-gray-400">/{avail}</span>
                      </span>
                    ); })}
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

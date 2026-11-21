// IMS → Admin → Settings → 🗂️ Master Data → 🚛 Transport & Power, AND (variant="truck")
// IMS → Planning → 🚚 Truck.
//
// Mounts Studio's TransportEditor/TruckCapacityEditor rather than reimplementing either. The panel
// is a data + theme adapter, nothing more — one ctx builder, no second copy of the fetch/save path
// to keep in step, even though the two editors it can mount now live on separate screens.
//
// Venue names come from the `venues` TABLE (migration 036) directly now — read-only here, same as
// FixedVenuesEditor.jsx and VenuesEditor.jsx.
//
// The transport blob itself (`ambria-transport-v3`) is still a Studio-owned settings row, and IMS
// strips every `ambria-` key out of its own settings object on purpose (see applySettingsRows in
// IMS.jsx), so this fetches that one row itself instead of widening that filter. It's stored as a
// JSON *string*, not an object — Studio's loader does JSON.parse on it, so writing an object here
// would leave Studio unable to read its own transport config. Saves re-stringify.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, fetchAll, subscribeTable } from "../../lib/supabase";
import { patchFromArgs, mergeTransport, readTransport, writeTransport, parseTransport } from "../../lib/studio/transportBlob";
import { makeS } from "../../lib/studio/styles";
import { RC_SK_TR, TR_TIERS, TC_UNITS } from "../../lib/studio/keys";
import { assembleVenuesFromRows } from "../../lib/ims/venueProperties";
import TransportEditor from "../studio/TransportEditor.jsx";
import TruckCapacityEditor from "../studio/TruckCapacityEditor.jsx";

const parseRow = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === "object") return v;                 // already JSON-typed
  try { return JSON.parse(v); } catch { return fallback; }
};

export default function ImsTransportPanel({ rcItems = [], rcCats = [], rateCardCategories = [], inventory = [], showMsg, variant, canEdit = true }) {
  const [tr, setTr] = useState(null);                  // the transport blob
  const [venues, setVenues] = useState({ inhouse: [], outdoor: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newTC, setNewTC] = useState({ item: "", perTruck: 0, unit: "pc" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("settings").select("key,value").eq("key", RC_SK_TR);
      if (cancelled) return;
      if (error) { setErr(error.message); setLoading(false); return; }
      const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      setTr(parseRow(byKey[RC_SK_TR], { venues: [], truckCap: [], floralPerTruck: 50000, bufferTiers: [], gensetRate: 28000, gensetRate62: 18000, gensetCostRate: 0, gensetCostRate62: 0 }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetchAll("venues").then((rows) => { if (!cancelled) setVenues(assembleVenuesFromRows(rows)); }).catch(() => {});
    load();
    const ch = subscribeTable("venues", load);
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);

  // LIVE (audit 2026-11-21): this screen read the row once when it opened, so a capacity or venue
  // changed in Studio or in the other IMS screen never showed here until a reload. Any change to the
  // row now re-reads it.
  const trRef = useRef(null);
  useEffect(() => { trRef.current = tr; }, [tr]);
  useEffect(() => {
    const ch = subscribeTable("settings", (payload) => {
      const key = payload?.new?.key || payload?.old?.key;
      if (key !== RC_SK_TR) return;
      const fromPayload = parseTransport(payload?.new?.value);
      if (fromPayload) setTr(fromPayload);
      else readTransport().then((t) => { if (t) setTr(t); }).catch(() => {});
    });
    return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);

  // Same positional signature as Studio's saveTR, because TransportEditor calls it that way:
  // (venues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62, gensetCostRate, gensetCostRate62).
  // Writes only the fields being changed, onto the row as saved right now (lib/studio/transportBlob) —
  // it used to write this screen's whole copy, read when it opened, back over anything changed
  // elsewhere since. Saves run one after another (each keystroke is a save), so they land in order.
  const saveQueue = useRef(Promise.resolve());
  const saveTR = useCallback((nv, ntc, nfpt, nbt, ngr, ngr62, ngcr, ngcr62) => {
    if (!canEdit) return Promise.resolve();
    const patch = patchFromArgs(nv, ntc, nfpt, nbt, ngr, ngr62, ngcr, ngcr62);
    setTr((prev) => mergeTransport(prev, patch)); // the input shows the new value at once
    const run = async () => {
      try {
        const fresh = await readTransport(); // throws on a failed read — never write over what couldn't be read
        const next = mergeTransport(fresh || trRef.current, patch);
        await writeTransport(next); // stringified inside — Studio JSON.parses this row
        setErr("");
      } catch (e) {
        const m = e?.message || String(e);
        setErr(m); showMsg?.("Save failed: " + m, "red");
      }
    };
    saveQueue.current = saveQueue.current.then(run, run);
    return saveQueue.current;
  }, [showMsg, canEdit]);

  // Studio derives these two from the venues blob; mirror it exactly so the venue table matches
  // what Studio shows rather than quietly listing a different set.
  const allInhouseVenues = useMemo(
    () => (venues.inhouse || []).filter((v) => v.parent && v.parent !== "Custom").map((v) => v.name),
    [venues],
  );
  const allOutdoorDB = useMemo(() => (venues.outdoor || []).slice(), [venues]);

  // IMS is light-theme only, so the Studio style factory is built once in light mode.
  const S = useMemo(() => makeS(false), []);
  const theme = useMemo(() => ({
    S, isDark: false,
    accent: "#C9A96E",
    border: "rgba(26,26,46,0.09)",
    textP: "#1a1a2e",
    textS: "#5A6076",
  }), [S]);

  if (loading) return <p className="text-sm text-gray-400 italic py-6">Loading transport settings…</p>;
  if (!tr) return <p className="text-sm text-red-600 py-6">Could not load transport settings{err ? ` — ${err}` : ""}.</p>;

  const ctx = {
    ...theme, showMsg,
    trVenues: tr.venues || [],
    truckCap: tr.truckCap || [],
    gensetRate: tr.gensetRate,
    gensetRate62: tr.gensetRate62,
    gensetCostRate: tr.gensetCostRate,
    gensetCostRate62: tr.gensetCostRate62,
    bufferTiers: tr.bufferTiers || [],
    saveTR,
    newTC, setNewTC,
    TR_TIERS, TC_UNITS,
    rcItems, rcCats, rateCardCategories, inventory,
    allInhouseVenues, allOutdoorDB,
  };

  return (
    <div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {!canEdit && <div className="rounded-lg bg-gray-100 text-gray-500 text-xs font-semibold px-3 py-2 inline-flex items-center gap-1.5 mb-2">👁 View only — your access to Planning doesn't include editing</div>}
      <fieldset disabled={!canEdit} className="contents">
        {variant === "truck" ? <TruckCapacityEditor ctx={ctx} /> : <TransportEditor ctx={ctx} />}
      </fieldset>
    </div>
  );
}

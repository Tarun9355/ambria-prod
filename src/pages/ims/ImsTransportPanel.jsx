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
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, fetchAll, subscribeTable } from "../../lib/supabase";
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

export default function ImsTransportPanel({ rcItems = [], rcCats = [], rateCardCategories = [], inventory = [], showMsg, variant }) {
  const [tr, setTr] = useState(null);                  // the transport blob
  const [venues, setVenues] = useState({ inhouse: [], outdoor: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newVenue, setNewVenue] = useState({ tier: "inhouse", name: "", rate: 0, gensets: 1 });
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

  // Same positional signature as Studio's saveTR, because TransportEditor calls it that way:
  // (venues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62, gensetCostRate, gensetCostRate62).
  const saveTR = useCallback(async (nv, ntc, nfpt, nbt, ngr, ngr62, ngcr, ngcr62) => {
    setTr((prev) => {
      const next = {
        venues: nv || prev.venues,
        truckCap: ntc || prev.truckCap,
        floralPerTruck: nfpt !== undefined ? nfpt : prev.floralPerTruck,
        bufferTiers: nbt || prev.bufferTiers,
        gensetRate: ngr !== undefined ? ngr : prev.gensetRate,
        gensetRate62: ngr62 !== undefined ? ngr62 : prev.gensetRate62,
        gensetCostRate: ngcr !== undefined ? ngcr : prev.gensetCostRate,
        gensetCostRate62: ngcr62 !== undefined ? ngcr62 : prev.gensetCostRate62,
      };
      // Stringify — Studio JSON.parses this row. Writing an object would break its loader.
      supabase.from("settings").upsert({ key: RC_SK_TR, value: JSON.stringify(next) }, { onConflict: "key" })
        .then(({ error }) => { if (error) { setErr(error.message); showMsg?.("Save failed: " + error.message, "red"); } });
      return next;
    });
  }, [showMsg]);

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
    newVenue, setNewVenue, newTC, setNewTC,
    TR_TIERS, TC_UNITS,
    rcItems, rcCats, rateCardCategories, inventory,
    allInhouseVenues, allOutdoorDB,
  };

  return (
    <div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {variant === "truck" ? <TruckCapacityEditor ctx={ctx} /> : <TransportEditor ctx={ctx} />}
    </div>
  );
}

// IMS → Admin → Settings → 🗂️ Master Data → 🚛 Transport & Power
//
// Mounts Studio's TransportEditor rather than reimplementing it. The panel is a data + theme
// adapter, nothing more — one editor, one behaviour, no second copy to keep in step.
//
// Two things make an adapter necessary rather than a plain import:
//
//  1. The data lives in Studio-owned settings rows (`ambria-transport-v3`, `ambria-v13-venues`)
//     and IMS strips every `ambria-` key out of its own settings object on purpose
//     (see applySettingsRows in IMS.jsx). So this fetches those two rows itself instead of
//     widening that filter and pulling every Studio blob into IMS state.
//
//  2. Both rows are stored as JSON *strings*, not objects. Studio's loader does JSON.parse on
//     them, so writing an object here would leave Studio unable to read its own transport
//     config — every quote would silently fall back to default rates. Saves re-stringify.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { makeS } from "../../lib/studio/styles";
import { RC_SK_TR, VENUES_SK, TR_TIERS, TC_UNITS } from "../../lib/studio/keys";
import TransportEditor from "../studio/TransportEditor.jsx";

const parseRow = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v === "object") return v;                 // already JSON-typed
  try { return JSON.parse(v); } catch { return fallback; }
};

export default function ImsTransportPanel({ rcItems = [], rcCats = [], showMsg }) {
  const [tr, setTr] = useState(null);                  // the transport blob
  const [venues, setVenues] = useState({ inhouse: [], outdoor: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newVenue, setNewVenue] = useState({ tier: "inhouse", name: "", rate: 0, gensets: 1 });
  const [newTC, setNewTC] = useState({ item: "", perTruck: 0, unit: "pc" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("settings").select("key,value").in("key", [RC_SK_TR, VENUES_SK]);
      if (cancelled) return;
      if (error) { setErr(error.message); setLoading(false); return; }
      const byKey = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
      setTr(parseRow(byKey[RC_SK_TR], { venues: [], truckCap: [], floralPerTruck: 50000, bufferTiers: [], gensetRate: 28000, gensetRate62: 18000 }));
      setVenues(parseRow(byKey[VENUES_SK], { inhouse: [], outdoor: [] }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Same positional signature as Studio's saveTR, because TransportEditor calls it that way:
  // (venues, truckCap, floralPerTruck, bufferTiers, gensetRate, gensetRate62).
  const saveTR = useCallback(async (nv, ntc, nfpt, nbt, ngr, ngr62) => {
    setTr((prev) => {
      const next = {
        venues: nv || prev.venues,
        truckCap: ntc || prev.truckCap,
        floralPerTruck: nfpt !== undefined ? nfpt : prev.floralPerTruck,
        bufferTiers: nbt || prev.bufferTiers,
        gensetRate: ngr !== undefined ? ngr : prev.gensetRate,
        gensetRate62: ngr62 !== undefined ? ngr62 : prev.gensetRate62,
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
    bufferTiers: tr.bufferTiers || [],
    saveTR,
    newVenue, setNewVenue, newTC, setNewTC,
    TR_TIERS, TC_UNITS,
    rcItems, rcCats,
    allInhouseVenues, allOutdoorDB,
  };

  return (
    <div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      <TransportEditor ctx={ctx} />
    </div>
  );
}

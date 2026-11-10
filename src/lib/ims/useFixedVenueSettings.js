import { useState, useEffect, useMemo } from "react";
import { supabase, fetchAll } from "../supabase";
import { assembleFixedVenuesFromRows } from "./fixedVenues";

// The Fixed Venues' standing stock — the `fixed_venues` TABLE (migration 038), which IMS's
// `settings` object does not carry (only Studio and the Fixed Venues editor loaded it), so a
// screen reading plain `settings.fixedVenues` sees nothing. Loaded here, live, and merged over
// `settings` so every OTHER settings field a caller needs is still on the same object. Shared by
// DepartmentOpsTab.jsx (the Fixed card, the department book) and the Site Supervisor page's own
// combined-book button, which needs the exact same "📌 Fixed at venue" pages.
export default function useFixedVenueSettings(settings) {
  const [fvRows, setFvRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => { const rows = await fetchAll("fixed_venues").catch(() => []); if (!cancelled) setFvRows(rows || []); };
    load();
    const ch = supabase.channel("realtime:fixed_venues:" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "fixed_venues" }, load)
      .subscribe();
    return () => { cancelled = true; try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, []);
  return useMemo(() => ({ ...(settings || {}), fixedVenues: assembleFixedVenuesFromRows(fvRows) }), [settings, fvRows]);
}

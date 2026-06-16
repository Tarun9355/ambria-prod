// Supabase Edge Function — Season Calendar proxy.
//
// Mirrors the reference Vercel `/api/season` route. Fetches the season-export API on
// the *other* Supabase project, injecting the SEASON_EXPORT_KEY (never exposed to the
// browser). Returns { dates: { "MM-DD": category }, default_category }.
//
// Deploy:
//   supabase functions deploy season
//   supabase secrets set SEASON_EXPORT_KEY=<key>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SEASON_EXPORT_URL = Deno.env.get("SEASON_EXPORT_URL") || "https://ptksdithbytzrznplfiq.supabase.co/functions/v1/season-export";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const key = Deno.env.get("SEASON_EXPORT_KEY");
  if (!key) return json({ error: "SEASON_EXPORT_KEY not configured" }, 500);

  try {
    const r = await fetch(SEASON_EXPORT_URL, { headers: { "x-api-key": key } });
    if (!r.ok) return json({ error: "Season API " + r.status }, 502);
    const data = await r.json();
    return json(data, 200);
  } catch (e) {
    return json({ error: "Season API unreachable: " + String(e?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json", "Cache-Control": "no-store" },
  });
}

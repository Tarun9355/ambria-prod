// Supabase Edge Function — YouTube Data API v3 proxy.
//
// Faithful port of the reference Vercel `/api/youtube.js`. Keeps YT_API_KEY out of the
// client bundle. The browser POSTs { action, params } (or GET ?action=…&…); we inject the
// server-side key and forward to https://www.googleapis.com/youtube/v3/<action>.
//
// Deploy:
//   supabase functions deploy youtube
//   supabase secrets set YT_API_KEY=…           (or YOUTUBE_API_KEY — both are read)
//
// action ∈ { playlistItems, videos, search }. All other query params pass through verbatim
// (part, playlistId, id, maxResults, pageToken, q, type, ...). `key` is always server-set.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ACTIONS: Record<string, string> = {
  playlistItems: "playlistItems",
  videos: "videos",
  search: "search",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Accept action + params from the query string (GET) OR a JSON body (POST).
  const url = new URL(req.url);
  let action = url.searchParams.get("action") || "";
  let rest: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams.entries()) { if (k !== "action") rest[k] = v; }
  if (!action && req.method === "POST") {
    try {
      const body = await req.json();
      action = body?.action || "";
      rest = body?.params || (() => { const { action: _a, ...r } = body || {}; return r; })();
    } catch { /* no body */ }
  }

  if (!action || !ALLOWED_ACTIONS[action]) {
    return json({ error: "Invalid or missing action", allowed: Object.keys(ALLOWED_ACTIONS) }, 400);
  }

  const key = Deno.env.get("YT_API_KEY") || Deno.env.get("YOUTUBE_API_KEY");
  if (!key) return json({ error: "YT_API_KEY not configured on server" }, 500);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (k === "key" || v == null) continue;
    params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  params.set("key", key);

  const upstream = `https://www.googleapis.com/youtube/v3/${ALLOWED_ACTIONS[action]}?${params.toString()}`;
  try {
    const r = await fetch(upstream);
    const data = await r.json();
    return json(data, r.status);
  } catch (e) {
    return json({ error: "Upstream YouTube fetch failed", detail: String((e as Error)?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

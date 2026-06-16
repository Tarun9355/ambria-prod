// Supabase Edge Function — LMS / ERP proxy.
//
// Mirrors the reference Vercel `/api/lms` generic pass-through. The LMS API
// (https://gyv.inqcrm.in) takes a JSON body and requires NO auth token — the browser
// just can't call it directly (CORS), so this function forwards the request server-side.
//
// Deploy (no secrets required):
//   supabase functions deploy lms
//
// The IMS client (lib/ims/lms.js) paginates itself, calling this once per page with
// { endpoint, body }; we forward verbatim and return the ERP JSON (e.g. { Contractinfo: [...] }).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Fixed public LMS host (override only if the ERP host changes).
const LMS_BASE = (Deno.env.get("LMS_BASE_URL") || "https://gyv.inqcrm.in").replace(/\/$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { endpoint, body } = payload || {};
  if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("/api/")) {
    return json({ error: "Valid ERP endpoint path required" }, 400);
  }

  try {
    // No auth token — the LMS API accepts the request body as-is.
    const resp = await fetch(LMS_BASE + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await resp.json().catch(() => ({}));
    return json(data, resp.status);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

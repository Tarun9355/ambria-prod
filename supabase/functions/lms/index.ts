// Supabase Edge Function — LMS / ERP proxy.
//
// Replaces the reference IMS app's Vercel `/api/lms` route. The browser can't call
// the ERP directly (credentials + CORS), so this function injects the ERP token and
// forwards the request.
//
// Deploy:
//   supabase functions deploy lms
//   supabase secrets set LMS_BASE_URL=https://<erp-host> LMS_TOKEN=<token>
//
// Client contract (from lib/ims/lms.js): POST { endpoint, body } → returns the ERP
// JSON verbatim (expected shape: { Contractinfo: [...] }).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const baseUrl = Deno.env.get("LMS_BASE_URL");
  const token = Deno.env.get("LMS_TOKEN");
  if (!baseUrl) return json({ error: "LMS_BASE_URL not configured" }, 500);

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
    const resp = await fetch(baseUrl.replace(/\/$/, "") + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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

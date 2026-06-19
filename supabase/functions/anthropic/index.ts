// Supabase Edge Function — Anthropic (Claude) proxy.
//
// Replaces the reference IMS app's Vercel `/api/anthropic` route. The browser cannot
// call the Anthropic API directly (the key would be exposed), so this function holds
// ANTHROPIC_API_KEY as a Supabase secret and forwards the request.
//
// Deploy:
//   supabase functions deploy anthropic
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Client contract matches callClaudeStreaming(): POST { model, max_tokens, messages }.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { model = "claude-haiku-4-5-20251001", max_tokens = 2000, messages, system } = body || {};
  if (!Array.isArray(messages)) return json({ error: "messages[] required" }, 400);

  try {
    const payload: Record<string, unknown> = { model, max_tokens, messages };
    if (system) payload.system = system;
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    return json(data, resp.status);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

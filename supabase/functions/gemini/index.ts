// Supabase Edge Function — Google Gemini proxy.
//
// Same reason as the `anthropic` function next to it: the browser must never hold the API key,
// so it lives as a Supabase secret and this function forwards the request.
//
// Deploy:
//   supabase functions deploy gemini
//   supabase secrets set GEMINI_API_KEY=...
//
// Client contract: POST { text, system?, model?, maxTokens? } → { text }.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { text, system, model = "gemini-2.5-flash", maxTokens = 300 } = body || {};
  if (typeof text !== "string" || !text.trim()) return json({ error: "text required" }, 400);

  const payload: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) return json({ error: data?.error?.message || `HTTP ${resp.status}` }, resp.status);
    const out = (data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim();
    return json({ text: out });
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

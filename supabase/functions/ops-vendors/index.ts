// Supabase Edge Function — Ambria Ops vendor catalog proxy.
//
// Fetches the filtered vendor list (decor category + "Casual Labour" expense sub-type) from the
// separate "Ambria Ops" app's own vendor-catalog endpoint, so IMS Dept Ops' Manpower plan can offer a
// real vendor picker instead of free text when splitting a dihari into in-house vs vendor crew.
// Sibling to supabase/functions/ops-expenses (same Ops app, same shared secret per Ops' own
// confirmation — a separate OPS_VENDORS_URL since it's a different endpoint path on their side).
//
// Deploy:
//   supabase functions deploy ops-vendors
//   supabase secrets set OPS_VENDORS_URL=<ambria-ops-project>/functions/v1/ambria-ims-vendors
//   (OPS_EXPENSES_KEY, already set for ops-expenses, is reused here — Ops confirmed one shared secret)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const baseUrl = Deno.env.get("OPS_VENDORS_URL");
  const key = Deno.env.get("OPS_EXPENSES_KEY");
  if (!baseUrl || !key) return json({ error: "OPS_VENDORS_URL / OPS_EXPENSES_KEY not configured" }, 500);

  const reqUrl = new URL(req.url);
  const category = reqUrl.searchParams.get("category"); // one of Ambria's 7 decor categories — required by Ops
  const subType = reqUrl.searchParams.get("sub_type") || "Casual Labour";
  if (!category) return json({ error: "category is required" }, 400);

  const upstream = new URL(baseUrl);
  upstream.searchParams.set("category", category);
  upstream.searchParams.set("sub_type", subType);

  try {
    const r = await fetch(upstream.toString(), { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return json({ error: "Ops vendors API " + r.status }, 502);
    const data = await r.json();
    return json(data, 200);
  } catch (e) {
    return json({ error: "Ops vendors API unreachable: " + String(e?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json", "Cache-Control": "no-store" },
  });
}

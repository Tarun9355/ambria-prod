// Supabase Edge Function — Ambria Ops expenses proxy.
//
// Fetches real on-site/field expenses logged in the separate "Ambria Ops" app
// (different Supabase project), for one booked deal, so IMS Dept Ops' Actuals panel can show
// them instead of a salesperson/dept head re-typing what the team already logged there.
//
// The two apps share a join key for free: both independently store the same raw LMS entry
// number — Ambria IMS as client_ledger.lmsLeadId, Ambria Ops as events.contract_no — so no new
// column or form field was needed on either side.
//
// Always passes lms_department=Decor: every one of Ambria IMS's 7 department buckets
// (Furniture/Floral/Structure/Tenting/Transport/Lighting/Fabric) is a Decor sub-type in Ops'
// own LMS contract-type bucketing (Venue/Catering/Decor/Entertainment), which is what Ops needs
// to disambiguate contract_no (not unique across THEIR departments).
//
// Deploy:
//   supabase functions deploy ops-expenses
//   supabase secrets set OPS_EXPENSES_URL=<ambria-ops-project>/functions/v1/ambria-ims-expenses
//   supabase secrets set OPS_EXPENSES_KEY=<shared secret Ops hands over>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const baseUrl = Deno.env.get("OPS_EXPENSES_URL");
  const key = Deno.env.get("OPS_EXPENSES_KEY");
  if (!baseUrl || !key) return json({ error: "OPS_EXPENSES_URL / OPS_EXPENSES_KEY not configured" }, 500);

  const reqUrl = new URL(req.url);
  const contractNo = reqUrl.searchParams.get("contract_no");
  const department = reqUrl.searchParams.get("department"); // one of Ambria's 7 dept names, optional
  if (!contractNo) return json({ error: "contract_no is required" }, 400);

  const upstream = new URL(baseUrl);
  upstream.searchParams.set("contract_no", contractNo);
  upstream.searchParams.set("lms_department", "Decor");
  if (department) upstream.searchParams.set("department", department);

  try {
    const r = await fetch(upstream.toString(), { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return json({ error: "Ops expenses API " + r.status }, 502);
    const data = await r.json();
    return json(data, 200);
  } catch (e) {
    return json({ error: "Ops expenses API unreachable: " + String(e?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json", "Cache-Control": "no-store" },
  });
}

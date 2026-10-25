// ─── Ambria Ops expenses (real on-site spend) ─────────────────────────────────
// Proxied through a Supabase Edge Function (supabase/functions/ops-expenses) that holds
// OPS_EXPENSES_URL/OPS_EXPENSES_KEY and calls the separate Ambria Ops app's own expense-read
// endpoint server-side (its CORS and shared secret never reach the browser).
//
// The two apps share a join key for free: both independently store the same raw LMS entry number
// — Ambria IMS as client_ledger.lmsLeadId (carried onto event_orders as `lmsLeadId`), Ambria Ops
// as events.contract_no — so no new column or form field was needed on either side.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const OPS_EXPENSES_FN_URL = `${SUPABASE_URL}/functions/v1/ops-expenses`;

// Real expenses logged in Ambria Ops for one booked deal, optionally scoped to one department.
// contractNo is the deal's own LMS entry number (event_orders' own `lmsLeadId` field) — a deal
// never synced from an LMS lead has none, and this simply returns []. Returns
// [{department, amount, label, date, loggedBy}], or [] on any failure — this is a nice-to-have
// alongside the manual expense rows, not a blocking dependency, so it never throws.
export async function fetchOpsExpenses(contractNo, department) {
  if (!contractNo) return [];
  try {
    const url = new URL(OPS_EXPENSES_FN_URL);
    url.searchParams.set("contract_no", String(contractNo));
    if (department) url.searchParams.set("department", department);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

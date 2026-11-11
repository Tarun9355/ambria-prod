// ─── Ambria Ops vendor catalog (for the Manpower in-house/vendor split picker) ───────────────────
// Proxied through a Supabase Edge Function (supabase/functions/ops-vendors) that holds
// OPS_VENDORS_URL/OPS_EXPENSES_KEY and calls the separate Ambria Ops app's own vendor-catalog
// endpoint server-side — see lib/ims/opsExpenses.js for the sibling (same Ops app, same shared
// secret) expense-read proxy this mirrors.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const OPS_VENDORS_FN_URL = `${SUPABASE_URL}/functions/v1/ops-vendors`;

// Vendors tagged with `category` (one of DEPTS, lib/ims/deptClassify.js — Ops uses the same 7 names)
// and the "Casual Labour" expense sub-type, with inactive vendors already excluded by Ops. Returns
// [{id, name, phone, active}], or [] on any failure (including Transport, which Ops confirmed has no
// Casual Labour sub-type at all) — a nice-to-have alongside free-text entry, never a blocking
// dependency, so this never throws.
export async function fetchOpsVendors(category) {
  if (!category) return [];
  try {
    const url = new URL(OPS_VENDORS_FN_URL);
    url.searchParams.set("category", category);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data?.vendors) ? data.vendors : [];
  } catch {
    return [];
  }
}

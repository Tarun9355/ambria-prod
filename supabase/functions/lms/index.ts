// Supabase Edge Function — LMS / ERP proxy + server-side sync.
//
// Two modes:
//   (1) POST { endpoint, body }  → generic pass-through to the LMS API (no auth token).
//   (2) POST { op: "sync" }      → paginate venue+decor contracts SERVER-SIDE (parallel
//        batches) and upsert them into the `lms_contracts` table via the service-role
//        key, then prune contracts that disappeared. The browser never paginates LMS.
//
// The LMS API (https://gyv.inqcrm.in) needs NO auth token.
//
// Deploy (no extra secrets — SUPABASE_URL + SERVICE_ROLE_KEY are auto-injected):
//   supabase functions deploy lms

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LMS_BASE = (Deno.env.get("LMS_BASE_URL") || "https://gyv.inqcrm.in").replace(/\/$/, "");
const PAGE_SIZE = 10;
const BATCH = 5; // pages fetched in parallel per dept per round
const PAGE_CEILING = 200;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LMS_VENUE_MAP: Record<string, { lmsName: string; internalName: string }> = {
  "3": { lmsName: "Ambria Pushpanjali", internalName: "Ambria Pushpanjali" },
  "6": { lmsName: "Manaktala Farm", internalName: "Emerald Green" },
  "16": { lmsName: "Ambria Restro", internalName: "Ambria Restro" },
  "18": { lmsName: "TENDER PROGARM", internalName: "TENDER PROGRAM" },
  "19": { lmsName: "Ambria Exotica", internalName: "Ambria Exotica" },
  "20": { lmsName: "All Venues", internalName: "All Venues" },
};
const LMS_FUNCTION_TYPES: Record<string, string> = {
  "1": "Ring Ceremony", "2": "Birthday", "3": "Wedding", "4": "Reception", "5": "Kua Poojan",
  "6": "Anniversary", "7": "Lagan", "8": "Sagan", "9": "Cocktail", "10": "Religious",
  "11": "Corporate", "12": "Proposal Ceremony", "14": "Haldi", "15": "Mehendi",
  "16": "Roka Ceremony", "17": "Residential Wedding", "18": "Destination Wedding",
  "19": "Kothi Booking", "20": "Sangeet", "21": "Baby Shower", "22": "Engagement",
  "23": "Tender", "24": "Barat Assembly", "25": "House Party", "26": "Lunch Function",
  "27": "Breakfast Function", "28": "Dinner Function", "29": "Breakfast", "30": "Lunch",
  "31": "Kitty Party", "32": "Restaurant Sale", "33": "Lohri", "34": "Diwali Party",
  "35": "Get Together", "36": "Mata Ki Chowki",
};
const ENDPOINTS: Record<string, string> = {
  venue: "/api/v1/processerp_api/get_venue_contract_information_list",
  decor: "/api/v1/processerp_api/get_decor_contract_information_list",
};
const REQ_BODY: Record<string, (p: number) => Record<string, string>> = {
  venue: (p) => ({ loggeduserid: "1", fromdate: "", uptodated: "", search_venue_contract: "", priority_search: "", venue_datetype: "", source_search: "", venue_search: "", balance_pending: "", contract_venue_search: "", contract_assginee_search: "", leadtype_search: "", report_fac: "", page_limit: String(p) }),
  decor: (p) => ({ loggeduserid: "1", entertain_search: "", source_search: "", lead_type_search: "", entertain_venue_search: "", priority_search: "", fromdate: "", uptodated: "", entertain_assginee_search: "", entertain_status_search: "", search_date_type: "", visited_search: "", follow_dated: "", page_limit: String(p) }),
};

async function lmsCall(endpoint: string, body: unknown) {
  const r = await fetch(LMS_BASE + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`LMS ${r.status}`);
  return r.json();
}

function normalizeRow(raw: any, dept: string) {
  const isVenue = dept === "venue";
  const entryNo = isVenue ? (raw.fisc_entryno || "") : (raw.dhc_entry_no || "");
  const cancelled = !!((isVenue ? raw.fisc_cancel_remarks : raw.dhc_cancel_remarks) || "").trim();
  const fnTypeId = isVenue ? (raw.fiscd_function_type || "") : (raw.dhcd_function || "");
  const fnDate = isVenue ? (raw.fiscd_function_date || "") : (raw.dhcd_date || "");
  const fnTime = isVenue ? (raw.fiscd_function_timings || "") : (raw.dhcd_time || "");
  const venueId = isVenue ? (raw.fiscd_venue_id || "") : "";
  const vLook = LMS_VENUE_MAP[venueId];
  const fnDetail = {
    functionDate: fnDate, functionTime: fnTime,
    functionType: LMS_FUNCTION_TYPES[fnTypeId] || (raw.functionname || ""),
    session: isVenue ? (raw.fiscd_session || "") : (raw.dhcd_session || ""),
    leadType: isVenue ? (raw.fiscd_lead_type || "") : (raw.dhcd_lead_type || ""),
    pax: isVenue ? (raw.fiscd_pax_no || 0) : 0,
    internalVenueName: vLook?.internalName || "",
    externalVenue: isVenue ? (raw.fiscd_venue_name || "") : (raw.dhcd_venue2 || ""),
    locationName: raw.address1 || "",
    decorLumpsum: isVenue ? parseFloat(raw.fiscd_decoration_lumpsum || "0") : parseFloat(raw.dhcd_lumpsum || "0"),
  };
  const header = {
    dept, entryNo,
    contractDate: isVenue ? (raw.fisc_contract_date || "") : (raw.dhc_contract_date || ""),
    guestName: isVenue ? (raw.fisc_guest_name || "") : (raw.dhc_guest_name || ""),
    contactNo: isVenue ? (raw.fisc_client_mobile || "") : (raw.dhc_contact_no || ""),
    brideName: isVenue ? (raw.fisc_bride_name || "") : (raw.dhc_bride_name || ""),
    groomName: isVenue ? (raw.fisc_groom_name || "") : (raw.dhc_groom_name || ""),
    totalAmt: isVenue ? (raw.fisc_total_amt || 0) : (raw.dhc_total_amt || 0),
    balance: isVenue ? (raw.fisc_balance || 0) : (raw.dhc_balance || 0),
    priority: isVenue ? (raw.fisc_priority || "") : (raw.dhc_priority || ""),
    cancelled,
  };
  return { header, fnDetail };
}

async function fetchDept(dept: string) {
  const map = new Map<string, any>();
  let page = 1;
  while (page <= PAGE_CEILING) {
    const pages = Array.from({ length: BATCH }, (_, i) => page + i);
    const results = await Promise.all(pages.map((p) =>
      lmsCall(ENDPOINTS[dept], REQ_BODY[dept](p)).then((d) => ({ p, rows: d?.Contractinfo || [] })).catch(() => ({ p, rows: [] }))
    ));
    let hitEnd = false;
    for (const { rows } of results.sort((a, b) => a.p - b.p)) {
      if (rows.length === 0) { hitEnd = true; continue; }
      for (const raw of rows) {
        const { header, fnDetail } = normalizeRow(raw, dept);
        if (header.cancelled || !header.entryNo) continue;
        const key = `${dept}-${header.entryNo}`;
        if (!map.has(key)) map.set(key, { id: key, ...header, functions: [], matchedEoId: null, matchType: null });
        if (fnDetail.functionDate || fnDetail.functionType) map.get(key).functions.push(fnDetail);
      }
      if (rows.length < PAGE_SIZE) hitEnd = true;
    }
    if (hitEnd) break;
    page += BATCH;
  }
  return Array.from(map.values());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  // ── Mode 2: server-side full sync → DB ──
  if (payload?.op === "sync") {
    const startedAt = new Date().toISOString();
    try {
      const [venue, decor] = await Promise.all([fetchDept("venue"), fetchDept("decor")]);
      const all = [...venue, ...decor];
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const now = new Date().toISOString();
      const rows = all.map((c) => ({ id: c.id, dept: c.dept, entry_no: c.entryNo, guest_name: c.guestName, data: c, synced_at: now }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.from("lms_contracts").upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (error) throw new Error(error.message);
      }
      // Prune contracts that vanished from LMS (or were cancelled) since this sync started.
      await sb.from("lms_contracts").delete().lt("synced_at", startedAt);
      return json({ synced: rows.length, syncedAt: now });
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 502);
    }
  }

  // ── Mode 1: generic pass-through ──
  const { endpoint, body } = payload || {};
  if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("/api/")) {
    return json({ error: "Valid ERP endpoint path required" }, 400);
  }
  try {
    const data = await lmsCall(endpoint, body || {});
    return json(data, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

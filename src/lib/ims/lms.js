// ─── LMS / ERP contract sync ──────────────────────────────────────────────────
// Faithful port of the reference IMS LMS integration. The LMS API
// (https://gyv.inqcrm.in) needs NO auth token; the browser just can't call it
// directly (CORS), so requests go through a Supabase Edge Function
// (supabase/functions/lms) that forwards them server-side.
//
// Deploy (no secrets required):
//   supabase functions deploy lms
//
// Until that's deployed the sync resolves to [] (Calendar shows no contracts).

import { supabase } from "../supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const LMS_FN_URL = `${SUPABASE_URL}/functions/v1/lms`;

// Trigger the server-side full sync (Edge Function paginates LMS → upserts lms_contracts).
// Returns { synced, syncedAt }. The browser never paginates LMS itself.
export async function triggerLmsSync() {
  const r = await fetch(LMS_FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify({ op: "sync" }),
  });
  if (!r.ok) throw new Error(`LMS sync ${r.status}`);
  return r.json();
}

// Read cached contracts from Supabase (instant — no LMS call). Returns { contracts, lastSync }.
export async function fetchCachedContracts() {
  const { data, error } = await supabase
    .from("lms_contracts")
    .select("data, synced_at")
    .order("synced_at", { ascending: false })
    .limit(5000);
  if (error) return { contracts: [], lastSync: 0 };
  const contracts = (data || []).map((r) => r.data);
  const lastSync = data?.[0]?.synced_at ? new Date(data[0].synced_at).getTime() : 0;
  return { contracts, lastSync };
}

const LMS_VENUE_MAP = {
  "3": { lmsName: "Ambria Pushpanjali", internalName: "Ambria Pushpanjali" },
  "6": { lmsName: "Manaktala Farm", internalName: "Emerald Green" },
  "16": { lmsName: "Ambria Restro", internalName: "Ambria Restro" },
  "18": { lmsName: "TENDER PROGARM", internalName: "TENDER PROGRAM" },
  "19": { lmsName: "Ambria Exotica", internalName: "Ambria Exotica" },
  "20": { lmsName: "All Venues", internalName: "All Venues" },
};

const LMS_FUNCTION_TYPES = {
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

const LMS_ENDPOINTS = {
  venue: "/api/v1/processerp_api/get_venue_contract_information_list",
  decor: "/api/v1/processerp_api/get_decor_contract_information_list",
};

const LMS_REQUEST_BODIES = {
  venue: (page) => ({
    loggeduserid: "1", fromdate: "", uptodated: "", search_venue_contract: "",
    priority_search: "", venue_datetype: "", source_search: "", venue_search: "",
    balance_pending: "", contract_venue_search: "", contract_assginee_search: "",
    leadtype_search: "", report_fac: "", page_limit: String(page),
  }),
  decor: (page) => ({
    loggeduserid: "1", entertain_search: "", source_search: "", lead_type_search: "",
    entertain_venue_search: "", priority_search: "", fromdate: "", uptodated: "",
    entertain_assginee_search: "", entertain_status_search: "", search_date_type: "",
    visited_search: "", follow_dated: "", page_limit: String(page),
  }),
};

// LMS's own `users` table (id → display name) — id is the numeric `entryById`/`fisc_entryby`/
// `dhc_decor_entryby` value a contract or lead is stamped with in LMS, telling us who owns it
// there. Sourced from users.sql (LMS's MySQL dump, project root) — firstname where set, else
// username. Comparisons against Studio's own authUser.name are done case-insensitively (see
// StudioEventInfo's salesperson filter), since the two systems don't agree on capitalization
// (e.g. LMS "Krati" vs Studio's stored "krati").
const LMS_ENTRY_BY_NAMES = {
  "1": "Admin", "2": "Shivika", "3": "Rajnish", "4": "Priyanka Biwal", "5": "Nivedita",
  "6": "Harsh Pachouri", "7": "Kartik", "8": "Pavitra", "9": "Rajesh", "10": "Tarun",
  "11": "Krati", "12": "Himanshu", "13": "Ashi", "14": "Tushita", "15": "Dipesh",
  "16": "Medhavi", "17": "Gaurav", "18": "Sahaj", "19": "Kaushal", "20": "Ajay",
  "21": "Ajay Chauhan", "22": "Pratiksha", "23": "JP Singh", "24": "Amanjeet", "25": "Anmol",
  "26": "Harsh Vardhan", "27": "Rahul", "28": "Expense Test User", "29": "Jitanshu", "30": "Arjun",
  "31": "Tajinder Singh", "32": "Aman", "33": "Amarpreet", "34": "Ompal Sharma", "35": "Lalit Joshi",
  "36": "SUDHIR", "37": "GUDDU", "38": "Karan", "39": "Priyanshu", "40": "Vindeep",
  "41": "Shiven", "42": "Nikhil", "43": "Rajesh V", "44": "Security", "45": "Events",
  "46": "SecurityExp", "47": "Jasmeet Singh", "48": "Rashi Wadhwa", "49": "Chaitanya", "50": "Amar Kumar",
  "51": "Abhishek", "52": "Pratik", "53": "Reception", "54": "VIRENDER", "55": "Umakant",
  "56": "Sandeep Guard", "57": "Kartik Meena", "58": "Amba", "59": "Rajshekhar", "60": "Vipin",
  "61": "Vinay Kumar", "62": "Yatinder", "63": "Aditya", "64": "Bablu Guard", "65": "Ravi",
  "66": "Abhishek Srivastav", "67": "Ruby", "68": "mobiletest", "69": "HV", "70": "Tutor",
  "71": "Finance",
};
const lmsEntryByName = (id) => LMS_ENTRY_BY_NAMES[String(id)] || ("User #" + id);

export function normalizeLmsRow(raw, dept) {
  const isVenue = dept === "venue";
  const entryNo = isVenue ? (raw.fisc_entryno || "") : (raw.dhc_entry_no || "");
  const cancelled = !!((isVenue ? raw.fisc_cancel_remarks : raw.dhc_cancel_remarks) || "").trim();

  const functionTypeId = isVenue ? (raw.fiscd_function_type || "") : (raw.dhcd_function || "");
  const functionDate = isVenue ? (raw.fiscd_function_date || "") : (raw.dhcd_date || "");
  const functionTime = isVenue ? (raw.fiscd_function_timings || "") : (raw.dhcd_time || "");
  const venueId = isVenue ? (raw.fiscd_venue_id || "") : "";
  const venueLookup = LMS_VENUE_MAP[venueId] || null;

  const fnDetail = {
    functionDate, functionTime,
    functionType: LMS_FUNCTION_TYPES[functionTypeId] || (raw.functionname || ""),
    functionTypeId,
    session: isVenue ? (raw.fiscd_session || "") : (raw.dhcd_session || ""),
    leadType: isVenue ? (raw.fiscd_lead_type || "") : (raw.dhcd_lead_type || ""),
    pax: isVenue ? (raw.fiscd_pax_no || 0) : 0,
    venueId,
    venueName: raw.venue1 || venueLookup?.lmsName || "",
    internalVenueName: venueLookup?.internalName || "",
    locationName: raw.address1 || "",
    externalVenue: isVenue ? (raw.fiscd_venue_name || "") : (raw.dhcd_venue2 || ""),
    externalAddress: isVenue ? (raw.fiscd_location_name || "") : (raw.dhcd_address2 || ""),
    decorLumpsum: isVenue ? parseFloat(raw.fiscd_decoration_lumpsum || "0") : parseFloat(raw.dhcd_lumpsum || "0"),
    remarks: isVenue ? (raw.fiscd_remarks || raw.fiscd_notes || "") : (raw.dhcd_remarks || ""),
    pdfLink: raw.pdfLink || "", pptLink: raw.pptLink || "",
  };

  const entryById = isVenue ? (raw.fisc_entryby || "") : (raw.dhc_decor_entryby || "");
  const header = {
    dept, entryNo, lmsId: raw.id || 0,
    contractDate: isVenue ? (raw.fisc_contract_date || "") : (raw.dhc_contract_date || ""),
    guestName: isVenue ? (raw.fisc_guest_name || "") : (raw.dhc_guest_name || ""),
    contactNo: isVenue ? (raw.fisc_client_mobile || "") : (raw.dhc_contact_no || ""),
    secondaryContact: isVenue ? (raw.fisc_secondary_contact || "") : (raw.dhc_secondary_contact || ""),
    email: isVenue ? (raw.fisc_client_email || "") : (raw.dhc_email || ""),
    address: isVenue ? (raw.fisc_address || "") : (raw.dhc_address || ""),
    city: isVenue ? (raw.fisc_city || "") : (raw.dhc_city || ""),
    brideName: isVenue ? (raw.fisc_bride_name || "") : (raw.dhc_bride_name || ""),
    groomName: isVenue ? (raw.fisc_groom_name || "") : (raw.dhc_groom_name || ""),
    totalAmt: isVenue ? (raw.fisc_total_amt || 0) : (raw.dhc_total_amt || 0),
    netAmt: isVenue ? (raw.fisc_net_amt || 0) : (raw.dhc_net_amt || 0),
    balance: isVenue ? (raw.fisc_balance || 0) : (raw.dhc_balance || 0),
    advanceCash: isVenue ? (raw.fisc_advance_cash || 0) : (raw.dhc_advance_cash || 0),
    advanceCheque: isVenue ? (raw.fisc_advance_chq || 0) : (raw.dhc_advance_chq || 0),
    taxAmt: isVenue ? (raw.fisc_tax_amt || 0) : (raw.dhc_tax_amt || 0),
    priority: isVenue ? (raw.fisc_priority || "") : (raw.dhc_priority || ""),
    lmsStatus: isVenue ? (raw.fisc_status || "") : (raw.dhc_status || ""),
    entryById, entryByName: lmsEntryByName(entryById),
    headerRemarks: isVenue ? (raw.fisc_addtional_remrks || "") : (raw.dhc_addtional_remrks || ""),
    cancelled,
  };

  return { header, fnDetail };
}

export function groupLmsRows(rows) {
  const map = new Map();
  for (const { header, fnDetail } of rows) {
    const key = header.dept + "-" + header.entryNo;
    if (!map.has(key)) {
      map.set(key, { id: key, ...header, functions: [], matchedEoId: null, matchType: null, syncedAt: Date.now() });
    }
    // Same guard as the read path: a repeated API row must not become a repeated function.
    if (fnDetail.functionDate || fnDetail.functionType) {
      const bucket = map.get(key).functions;
      if (!bucket.some((f) => fnIdentity(f) === fnIdentity(fnDetail))) bucket.push(fnDetail);
    }
  }
  return Array.from(map.values());
}

export async function fetchLmsDeptContracts(dept, onProgress) {
  const endpoint = LMS_ENDPOINTS[dept];
  const bodyFn = LMS_REQUEST_BODIES[dept];
  const PAGE_CEILING = 200;
  const allRows = [];
  let page = 1;
  let prevCount = -1;

  while (page <= PAGE_CEILING) {
    try {
      const r = await fetch(LMS_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        body: JSON.stringify({ endpoint, body: bodyFn(page) }),
      });
      if (!r.ok) break;
      const data = await r.json();
      const rows = data?.Contractinfo || [];
      if (rows.length === 0 || allRows.length === prevCount) break;
      prevCount = allRows.length;
      for (const row of rows) {
        const parsed = normalizeLmsRow(row, dept);
        if (!parsed.header.cancelled) allRows.push(parsed);
      }
      if (onProgress) onProgress(dept, page, allRows.length);
      page++;
      await new Promise((ok) => setTimeout(ok, 200));
    } catch (e) {
      console.warn(`[lms-sync] ${dept} page ${page} failed:`, e?.message);
      break;
    }
  }
  return groupLmsRows(allRows);
}

export function crossReferenceContracts(contracts, eventOrders) {
  if (!eventOrders?.length) return contracts;
  const normalize = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

  return contracts.map((c) => {
    const cName = normalize(c.guestName);
    const cBride = normalize(c.brideName);
    const cGroom = normalize(c.groomName);
    const cDates = (c.functions || []).map((f) => f.functionDate).filter(Boolean);

    let matchedEoId = null;
    let matchType = null;

    for (const eo of eventOrders) {
      const eoName = normalize(eo.clientName);
      const eoDates = [eo.date || ""];
      if (eo.functionsDetail) {
        for (const fn of eo.functionsDetail) { if (fn.fnDate) eoDates.push(fn.fnDate); }
      }
      const dateMatch = cDates.some((cd) => eoDates.includes(cd));
      if (!dateMatch && cDates.length > 0) continue;
      if (dateMatch && cName && eoName && cName === eoName) { matchedEoId = eo.id; matchType = "exact"; break; }
      if (dateMatch) {
        const nameOverlap = (cName && eoName) && (cName.includes(eoName) || eoName.includes(cName));
        const brideMatch = cBride && eoName && eoName.includes(cBride);
        const groomMatch = cGroom && eoName && eoName.includes(cGroom);
        if (nameOverlap || brideMatch || groomMatch) { matchedEoId = eo.id; matchType = "fuzzy"; break; }
      }
    }
    return { ...c, matchedEoId, matchType };
  });
}

// Full sync: pull venue + decor contracts, cross-reference against event orders.
export async function syncLmsContracts(eventOrders, onProgress) {
  const venue = await fetchLmsDeptContracts("venue", onProgress);
  const decor = await fetchLmsDeptContracts("decor", onProgress);
  return crossReferenceContracts([...venue, ...decor], eventOrders);
}

// ─── §25 Studio lead lookup ────────────────────────────────────────────────────
// Faithful replacement for the reference Studio's `/api/lms?op=search`. Instead of a
// server-side paginating proxy, we search the already-synced `lms_contracts` cache
// (filled by triggerLmsSync) by guest name / phone — instant, no LMS round-trip.
// Returns leads in the shape Studio's loadLmsLead expects.
// Identity of a function: when it is, what it is, which sitting, and where. Two entries agreeing on
// all of those are one function listed twice, not two functions.
export function fnIdentity(f) {
  return [f?.functionDate, f?.functionType, f?.functionTypeId, f?.session, f?.functionTime,
    f?.internalVenueName || f?.venueName || f?.externalVenue].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
}
export function dedupeFns(fns) {
  const seen = new Set();
  return (Array.isArray(fns) ? fns : []).filter((f) => {
    const k = fnIdentity(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function lmsContractToLead(c, source = "venue") {
  if (!c) return null;
  return {
    id: `${source}-${c.entryNo || c.id}`,
    source,
    // A contract is a booked job; a decor lead is an enquiry that may never convert. Decor rows can
    // arrive from either table, so the badge cannot be derived from dept alone.
    booked: source !== "decor-lead",
    guestName: c.guestName || "",
    phone: c.contactNo || "",
    address: c.address || c.city || "",
    brideName: c.brideName || "",
    groomName: c.groomName || "",
    dept: c.dept,
    entryNo: c.entryNo,
    priority: c.priority || "",
    // Who entered this in LMS. The edge function's normalizeRow reads fisc_entryby/dhc_decor_entryby
    // for contracts and normalizeLeadRow reads dh_decor_entryby for decor leads (confirmed against a
    // live sample — it was just never wired up before), so all three sources populate this.
    entryById: c.entryById || "",
    entryByName: c.entryById ? lmsEntryByName(c.entryById) : "",
    // Venue contracts store nothing here (the sync writes no status for them) and decor leads store
    // `status`; lmsStatus is what the fuller normaliser below calls it. Read all three so this stops
    // depending on which producer wrote the row.
    status: c.status || c.lmsStatus || "",
    // Dedupe before mapping. The sync pushes a function row per API row and pages can repeat a row,
    // so a contract ends up carrying the same function twice — decor #00313 has Haldi 2026-12-02
    // Lunch listed twice, byte-identical. Two functions genuinely differing in nothing but their
    // position in the list are the same function, so key on the fields that define one.
    functions: dedupeFns(c.functions)
      .map((f) => ({
        fnDate: String(f.functionDate || "").slice(0, 10),
        fnLabel: f.functionType || "",
        fnType: f.functionTypeId || "",
        venueLabel: f.internalVenueName || f.venueName || f.externalVenue || "",
        // LMS's own venue field names the PROPERTY for an in-house lead ("Ambria Exotica"), never
        // the specific sub-venue (Aura/Valencia/Poolside/...) — that only ever shows up in the
        // lead's separate "Location Detail" field. Carried through so Studio's own venue resolver
        // (loadLmsLead, StudioApp.jsx) can scan it for a sub-venue match instead of dropping the
        // property down to "Others" whenever it isn't an exact venue-name match.
        locationLabel: f.locationName || "",
        shift: f.session || "",
        // Was dropped here entirely, so the guest count LMS already holds never reached the form.
        pax: f.pax || 0,
      }))
      .sort((a, b) => (a.fnDate || "").localeCompare(b.fnDate || "")),
  };
}

// Two sources, because no two of them cover the same ground:
//   lms_contracts dept=decor  — booked decor jobs
//   lms_decor_leads           — decor enquiries that have not converted (and may never)
// Decor contracts used to be left out on the reasoning that a decor guest is a "lead" long before
// becoming a contract. True, but it hid the converted ones: 325 of 339 decor contracts share no
// guest name with any row in the leads table, so those clients could not be found at all.
// Venue (dept=venue) contracts are deliberately NOT queried here — this is Studio, the décor
// quoting tool. A Venue-only booking (venue arm, no décor package) is a different business line's
// contract, not a Studio lead, and showed up in this search with no way to load anything useful
// from it (loadLmsLead has no venue-specific fields to pull). lms_contracts.dept=venue is still
// synced and read elsewhere (e.g. the Calendar's venue-booking view) — only Studio's own search
// stopped looking at it.
export async function searchLmsLeads(query /*, signal */) {
  const q = (query || "").trim();
  if (q.length < 2) return { ok: true, leads: [], complete: true };
  try {
    // Match each WORD separately instead of the whole query as one contiguous substring. Names in
    // LMS are typed by hand -- "Mr.Suresh Rana Ji", "Dr. Shalini" -- so a single LIKE fails on the
    // missing space after a dot, and on any word order but the stored one. Searching "mr suresh"
    // used to return nothing at all; per-word AND finds it.
    // Commas and parens are PostgREST filter syntax and % is a wildcard, so they are stripped
    // rather than passed through into the filter string.
    const tokens = q.split(/\s+/).map((t) => t.replace(/[,()%*"\\]/g, "").trim()).filter(Boolean);
    const match = (b) => {
      for (const t of (tokens.length ? tokens : [q])) {
        b = b.or(`guest_name.ilike.%${t}%,data->>contactNo.ilike.%${t}%`);
      }
      return b.limit(50);
    };
    const [decorContractRes, decorLeadRes] = await Promise.all([
      match(supabase.from("lms_contracts").select("data").eq("dept", "decor")),
      match(supabase.from("lms_decor_leads").select("data")),
    ]);
    if (decorContractRes.error) throw decorContractRes.error;
    if (decorLeadRes.error) throw decorLeadRes.error;

    // Contracts first: they are booked work, and when the same guest exists in both tables the
    // contract is the fuller record, so it is the one that survives the dedupe below.
    const booked = (decorContractRes.data || []).map((r) => lmsContractToLead(r.data, "decor-contract")).filter(Boolean);
    const enquiries = (decorLeadRes.data || []).map((r) => lmsContractToLead(r.data, "decor-lead")).filter(Boolean);

    // Dedupe an enquiry against its own contract — that pair is the same job at two stages of one
    // pipeline (decor-lead → decor-contract once it's booked).
    const digits = (v) => String(v || "").replace(/D/g, "");
    const key = (l) => `${(l.guestName || "").trim().toLowerCase()}|${digits(l.phone)}`;
    const seen = new Set(booked.map(key));
    const leads = [
      ...booked,
      ...enquiries.filter((l) => !seen.has(key(l))),
    ];
    return { ok: true, leads, complete: true, cached: true };
  } catch (e) {
    return { ok: false, leads: [], error: e.message || "LMS unreachable" };
  }
}

// ─── Season Calendar (date categories) ────────────────────────────────────────
// Proxied through a Supabase Edge Function (supabase/functions/season) that holds the
// SEASON_EXPORT_KEY and calls the season-export API on the other project. Runs
// automatically (no manual button) — see IMS shell.
const SEASON_FN_URL = `${SUPABASE_URL}/functions/v1/season`;

export async function fetchSeason() {
  try {
    const r = await fetch(SEASON_FN_URL, { headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Build { "YYYY-MM-DD": "Heavy Saya"|"Saya"|"Normal" } from season data + demand
// (function counts from LMS contracts). Faithful to Studio's §26 adjustedSeasonMap.
export function buildDateCategories(seasonData, lmsContracts) {
  const seasonDates = seasonData?.dates || {};
  const seasonDefault = seasonData?.default_category || "Filler";
  const yr = new Date().getFullYear();
  const base = {};
  Object.entries(seasonDates).forEach(([mmdd, cat]) => { base[`${yr}-${mmdd}`] = cat; base[`${yr + 1}-${mmdd}`] = cat; });

  const fnCount = {};
  for (const c of (lmsContracts || [])) {
    for (const fn of (c.functions || [])) {
      if (fn.functionDate) { const d = String(fn.functionDate).slice(0, 10); fnCount[d] = (fnCount[d] || 0) + 1; }
    }
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const oneMonth = new Date(today); oneMonth.setMonth(today.getMonth() + 1);
  const twoMonths = new Date(today); twoMonths.setMonth(today.getMonth() + 2);

  const adjusted = {};
  new Set([...Object.keys(base), ...Object.keys(fnCount)]).forEach((date) => {
    const count = fnCount[date] || 0;
    const current = base[date] || seasonDefault;
    const d = new Date(date + "T00:00:00");
    if (d < today) { if (current !== seasonDefault) adjusted[date] = current; return; }
    if (count >= 6) { adjusted[date] = "King's"; return; }
    if (d <= oneMonth && count < 5) { adjusted[date] = "Normal"; return; }
    if (current === "King's" && d <= twoMonths && count < 5) { adjusted[date] = "Perfect"; return; }
    if (current !== seasonDefault) adjusted[date] = current;
  });

  const imsMap = { "King's": "Heavy Saya", "Perfect": "Saya", "Normal": "Normal" };
  const dateCategories = {};
  Object.entries(adjusted).forEach(([date, cat]) => { const m = imsMap[cat]; if (m) dateCategories[date] = m; });
  return dateCategories;
}

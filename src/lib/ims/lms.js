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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const LMS_FN_URL = `${SUPABASE_URL}/functions/v1/lms`;

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

const LMS_ENTRY_BY_NAMES = { "1": "Admin", "5": "", "6": "", "9": "", "11": "" };
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
    if (fnDetail.functionDate || fnDetail.functionType) map.get(key).functions.push(fnDetail);
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

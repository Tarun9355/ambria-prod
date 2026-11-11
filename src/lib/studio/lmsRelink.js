// ─── LMS lead → contract auto-relink ──────────────────────────────────────────
// LMS runs two separate numbering sequences for the same guest's journey: a DECOR LEAD (pre-
// contract enquiry, its own entry-number sequence) and a DECOR CONTRACT (once/if that lead
// converts into a signed, booked job — a DIFFERENT entry number, assigned later). Studio's
// client_ledger.lmsLeadId is set once, whenever someone used Event Info's "Load from LMS" against
// whichever of the two existed at the time — and is never re-synced afterward. Ambria Ops' own
// expense system (src/lib/ims/opsExpenses.js, via the ops-expenses Edge Function) is keyed by the
// CONTRACT number, so a deal that was loaded as a lead and later converted keeps pointing at a
// number Ops has never heard of — confirmed live for a real booked deal ("Sangeeta": client_ledger
// held lead #01488, Ambria Ops only knows it as contract #00477) — and its real on-site expenses
// never surface in IMS Dept Ops' Actuals tab.
//
// This module is the pure matching/decision logic only — no Supabase calls, no writes. Its only
// caller is the `lms-relink` Edge Function (via src/lib/studio/lmsRelinkRun.js, imported directly
// by Deno — this file and eventOrderFor.js must stay plain JS with no non-relative, extensionless
// imports, since that's what the edge function bundles). It is
// deliberately NAME-BLIND: `crossReferenceContracts` (lib/ims/lms.js)'s name-based tiers ("exact"/
// "fuzzy") are for display only and are known to mismatch (the "Taj Test Client" case, see its own
// comment) — a silent, no-human-review write can't risk that. This matches on PHONE + FUNCTION DATE
// instead, the same two-factor test StudioEventInfo.jsx's lmsDealAlreadyInStudio already uses to
// decide whether an LMS lead is "the same job" as an existing Studio deal.

import { ownEventOrderIds } from "./eventOrderFor.js";

// Indian mobiles are 10 digits. Mirrors StudioEventInfo.jsx's own digits10 exactly (duplicated
// rather than imported — that one lives inside a component closure, not a shared module).
export function digits10(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
}

// More corrections in one pass than this means the policy is misfiring (a bad sync, a bulk data
// change) — not a real backlog of individually-good matches. Trip the breaker and write nothing
// rather than silently relink a pile of deals unattended.
export const RELINK_CIRCUIT_BREAKER = 15;

const dateSet = (items, field) => {
  const set = new Set();
  (Array.isArray(items) ? items : []).forEach((f) => {
    const d = String(f?.[field] || "").slice(0, 10);
    if (d) set.add(d);
  });
  return set;
};
// A client's own function dates — `functions[].date`, or the legacy single-function mirror
// (`eventDate`) for a client that predates the functions array. Same fallback
// lmsDealAlreadyInStudio already uses.
const clientDates = (c) => {
  const slots = (Array.isArray(c?.functions) && c.functions.length) ? c.functions : [{ date: c?.eventDate }];
  return dateSet(slots, "date");
};
const contractDates = (contract) => dateSet(contract?.functions, "functionDate");
const contractPhones = (contract) => new Set(
  [digits10(contract?.contactNo), digits10(contract?.secondaryContact)].filter((d) => d.length === 10)
);
const hasOverlap = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

/**
 * Decides which client_ledger rows need their lmsLeadId corrected from a lead-stage entry number
 * to the matching decor contract's own entry number, and which already-corrected rows need the
 * SAME correction re-applied (e.g. a stale tab's unrelated save put the old lead number back).
 *
 * @param {object} args
 * @param {Array}  args.clients        client_ledger rows (plain objects: id, name, phone, status,
 *                                     lmsLeadId, lmsDept, lmsLeadEntryNo, lmsContractEntryNo,
 *                                     lmsContractVerifiedId, functions, eventDate)
 * @param {Array}  args.decorContracts lms_contracts.data rows, dept="decor" only
 * @param {Array}  args.decorLeads     lms_decor_leads.data rows. A converted lead is typically no
 *                                     longer present here, so this is used only as a tie-breaker
 *                                     (never required) when a lead number and a contract number
 *                                     collide in the same string space (a real, confirmed case).
 * @param {Array}  [args.knownMissingVerifiedIds] ids this function returned as `newlyMissingVerifiedIds`
 *                                     on a PRIOR call — ids already seen missing before don't count
 *                                     toward the sync-incomplete trip again (a genuinely cancelled/
 *                                     renumbered LMS contract shouldn't wedge every future run
 *                                     forever). Persisted in `lms_relink_runs` (server-side cron caller,
 *                                     src/lib/studio/lmsRelinkRun.js) across runs.
 * @returns {{relinks: Array<{clientId:string,from:string,to:string}>, reapply: Array<{clientId:string,from:string,to:string}>, verify: Array<{clientId:string,id:string}>, skipped: Array<{clientId?:string,reason:string}>, tripped?: boolean, withheld?: {relinks: Array, reapply: Array}, newlyMissingVerifiedIds: string[]}}
 */
export function planLmsRelinks({ clients, decorContracts, decorLeads, knownMissingVerifiedIds }) {
  const contracts = (Array.isArray(decorContracts) ? decorContracts : []).filter((c) => c && c.entryNo);
  const contractByEntryNo = new Map(contracts.map((c) => [String(c.entryNo), c]));
  const leads = (Array.isArray(decorLeads) ? decorLeads : []).filter((l) => l && l.entryNo);
  const leadByEntryNo = new Map(leads.map((l) => [String(l.entryNo), l]));
  const clientList = (Array.isArray(clients) ? clients : []).filter((c) => c && c.id);

  const myPhonesOf = (c) => new Set([digits10(c.phone)].filter((d) => d.length === 10));
  const phoneOk = (rec, myPhones) => hasOverlap(contractPhones(rec), myPhones);

  // What a client's CURRENT id (curId) actually is, using positive evidence from both this run's
  // contracts AND leads — never inferring "must be a lead" purely from "missing from today's
  // contracts" (a transient partial LMS sync can make a genuinely correct contract link look
  // exactly like that — C2), and never trusting a bare string match on its own when the same
  // number could legitimately be both someone's lead and a totally unrelated contract (C4).
  //   "verified"            — previously confirmed (lmsContractVerifiedId) as THIS client's own
  //                            contract id; trusted even if missing from today's fetch.
  //   "contract"             — curId is a real contract this run, but this client's own phone
  //                            doesn't match it — can't confirm, but also not provably wrong.
  //   "contract-verifiable"  — curId is a real contract this run AND this client's phone matches
  //                            it — safe to stamp as verified.
  //   "lead"                 — curId is a real contract this run but ALSO a real lead belonging to
  //                            THIS client (phone matches the lead, not the contract) — a number
  //                            collision; treat curId as the lead it actually is, never a claim.
  //   "unknown"               — curId matches neither this run (the common case for an old,
  //                            already-converted lead number — converted leads usually drop out of
  //                            lms_decor_leads entirely).
  const classify = (c, curId, myPhones) => {
    if (c.lmsContractVerifiedId && String(c.lmsContractVerifiedId) === curId) return "verified";
    const ct = contractByEntryNo.get(curId);
    const ld = leadByEntryNo.get(curId);
    if (ct) {
      if (ld && phoneOk(ld, myPhones) && !phoneOk(ct, myPhones)) return "lead";
      return phoneOk(ct, myPhones) ? "contract-verifiable" : "contract";
    }
    if (ld) return "lead";
    return "unknown";
  };

  // Claims — registered before the main loop so a contract already spoken for (a verified/
  // phone-matching direct link, OR a client waiting on reapply after a stale revert) can never be
  // handed to a second client by the fresh phone+date search below, however that search resolves.
  // Non-decor clients never claim (a venue or ongoing client whose id happens to collide with a
  // decor contract's number must never lock that contract away from its real decor client).
  const claimedByOther = new Map();
  clientList.forEach((c) => {
    if ((c.lmsDept || "decor") !== "decor") return;
    const curId = c.lmsLeadId ? String(c.lmsLeadId) : "";
    if (curId) {
      const k = classify(c, curId, myPhonesOf(c));
      if (k === "verified" || k === "contract" || k === "contract-verifiable") claimedByOther.set(curId, c.id);
    }
    if (c.lmsContractEntryNo && curId && (curId === String(c.lmsLeadEntryNo || "") || curId === String(c.lmsContractEntryNo))) {
      claimedByOther.set(String(c.lmsContractEntryNo), c.id);
    }
  });

  // Canary: a previously-verified contract id absent from today's fetch means THIS RUN's sync is
  // suspect (the LMS edge function can silently drop a whole page of real rows on a transient
  // fetch failure and then prune "missing" rows right out of the table) — write nothing rather
  // than let that trigger a wave of fresh-search guesses against incomplete data. One genuinely
  // cancelled/renumbered contract shouldn't block everything, hence the >=2 floor.
  //
  // `knownMissingVerifiedIds` (optional, caller-persisted — e.g. across runs in localStorage): ids
  // already seen missing on a PRIOR run don't count toward the trip threshold again — otherwise a
  // contract genuinely cancelled/renumbered in LMS (a real, permanent, one-time event, not a sync
  // glitch) would keep counting on every single run forever, and two or three such deals over time
  // would eventually — and permanently — wedge the whole relink run in "sync-incomplete", with
  // nothing but a console.error to ever reveal why. `newlyMissingVerifiedIds` in the return value is
  // the FULL current missing set (known or not) — the caller overwrites its persisted copy with it
  // wholesale each run, so a ghost entry naturally drops off (and would count fresh if seen again)
  // the moment it stops going missing.
  const knownMissing = new Set((Array.isArray(knownMissingVerifiedIds) ? knownMissingVerifiedIds : []).map(String));
  let verifiedTotal = 0, verifiedMissing = 0;
  const newlyMissingVerifiedIds = [];
  clientList.forEach((c) => {
    if (c.status !== "booked" || (c.lmsDept || "decor") !== "decor") return;
    const curId = c.lmsLeadId ? String(c.lmsLeadId) : "";
    if (!curId) return;
    const isVerifiedId = (c.lmsContractVerifiedId && String(c.lmsContractVerifiedId) === curId)
      || (c.lmsContractEntryNo && curId === String(c.lmsContractEntryNo));
    if (!isVerifiedId) return;
    verifiedTotal++;
    if (!contractByEntryNo.has(curId)) {
      newlyMissingVerifiedIds.push(curId);
      if (!knownMissing.has(curId)) verifiedMissing++;
    }
  });
  if (verifiedMissing >= 2 && verifiedMissing > 0.05 * verifiedTotal) {
    return { relinks: [], reapply: [], verify: [], skipped: [{ reason: "sync-incomplete" }], tripped: true, newlyMissingVerifiedIds };
  }

  const relinks = [];
  const reapply = [];
  const verify = [];
  const skipped = [];

  clientList.forEach((c) => {
    if (c.status !== "booked") return; // Ops expenses only exist for executed jobs — out of scope
    const curId = c.lmsLeadId ? String(c.lmsLeadId) : "";
    if (!curId) return; // never linked to LMS at all — a different, out-of-scope case
    if ((c.lmsDept || "decor") !== "decor") return; // venue-linked — Ops' join is decor-only

    const myPhones = myPhonesOf(c);
    const k = classify(c, curId, myPhones);

    if (k === "verified") {
      // Previously confirmed as this client's own contract id — a no-op even if it's missing from
      // today's fetch (that's exactly the transient-sync case this status protects against).
      if (!contractByEntryNo.has(curId)) skipped.push({ clientId: c.id, reason: "verified-contract-missing" });
      return;
    }
    if (k === "contract-verifiable") {
      if (String(c.lmsContractVerifiedId || "") !== curId) verify.push({ clientId: c.id, id: curId });
      return;
    }
    if (k === "contract") return; // a real contract this run, but can't confirm by phone — leave exactly as is, don't guess

    if (c.lmsContractEntryNo) {
      // Already auto-relinked once. Its id isn't a (verifiable) contract this run (checked above),
      // so either a stale tab's unrelated save reverted it to the original lead number (re-apply
      // the SAME recorded target), or a human pointed it somewhere else entirely since (hands off,
      // permanently — never re-decided from a fresh phone/date search).
      if (curId === String(c.lmsLeadEntryNo || "")) {
        const target = contractByEntryNo.get(String(c.lmsContractEntryNo));
        if (target) { reapply.push({ clientId: c.id, from: curId, to: String(c.lmsContractEntryNo) }); return; }
        skipped.push({ clientId: c.id, reason: "reapply-target-missing" });
        return;
      }
      skipped.push({ clientId: c.id, reason: "human-relinked" });
      return;
    }

    // Fresh correction (k is "lead" or "unknown") — find exactly one decor contract sharing this
    // client's own phone AND at least one function date. Name is never consulted.
    if (!myPhones.size) { skipped.push({ clientId: c.id, reason: "no-phone" }); return; }
    const myDates = clientDates(c);
    if (!myDates.size) { skipped.push({ clientId: c.id, reason: "no-date" }); return; }

    const candidates = contracts.filter((ct) => {
      if (String(ct.entryNo) === curId) return false;
      if (!hasOverlap(contractPhones(ct), myPhones)) return false;
      return hasOverlap(contractDates(ct), myDates);
    });

    if (candidates.length !== 1) {
      skipped.push({ clientId: c.id, reason: candidates.length === 0 ? "no-match" : "ambiguous" });
      return;
    }
    const to = String(candidates[0].entryNo);
    const claimedBy = claimedByOther.get(to);
    if (claimedBy && claimedBy !== c.id) { skipped.push({ clientId: c.id, reason: "contract-claimed" }); return; }
    relinks.push({ clientId: c.id, from: curId, to });
  });

  // Two (or more) clients independently resolving to the SAME contract this run — two fresh
  // relinks, or a fresh relink against a client already waiting on reapply — means duplicate
  // booking records (seen before, the Sangeeta duplicate-booking incident) or something else
  // genuinely ambiguous: neither one is written.
  const combined = [...relinks, ...reapply];
  const byTarget = new Map();
  combined.forEach((r) => { (byTarget.get(r.to) || byTarget.set(r.to, []).get(r.to)).push(r); });
  const dupTargets = new Set([...byTarget.entries()].filter(([, list]) => list.length > 1).map(([to]) => to));
  const finalRelinks = relinks.filter((r) => !dupTargets.has(r.to));
  const finalReapply = reapply.filter((r) => !dupTargets.has(r.to));
  combined.forEach((r) => { if (dupTargets.has(r.to)) skipped.push({ clientId: r.clientId, reason: "duplicate-target:" + r.to }); });

  if (finalRelinks.length + finalReapply.length > RELINK_CIRCUIT_BREAKER) {
    // The list is still handed back (never written) so a server-side caller with no console to watch
    // can see what was withheld instead of just knowing something was.
    return { relinks: [], reapply: [], verify: [], skipped: [{ reason: "circuit-breaker" }], tripped: true, newlyMissingVerifiedIds, withheld: { relinks: finalRelinks, reapply: finalReapply } };
  }
  return { relinks: finalRelinks, reapply: finalReapply, verify, skipped, newlyMissingVerifiedIds };
}

/**
 * The event_orders side of an already-decided relink. client_ledger is the source of truth (set by
 * planLmsRelinks above); this just finds every live event_orders row for an already-relinked client
 * that doesn't yet carry its corrected lmsLeadId, so the write side can retry it on every run
 * instead of trying once inline and, on failure, never seeing the drift again (client_ledger's own
 * "already pointing at a verified contract id" no-op would otherwise hide it forever — C6).
 * Derived fresh from current state every call, so a previously-failed patch simply reappears here
 * next run with no separate failure-tracking needed.
 *
 * @param {object} args
 * @param {Array}  args.clients     client_ledger rows
 * @param {Array}  args.eventOrders event_orders rows
 * @returns {{patches: Array<{eoId:string,clientId:string,expect:(string|null),to:string,from:string}>, skipped: Array<{eoId:string,reason:string}>}}
 */
export function planEventOrderLmsSync({ clients, eventOrders }) {
  const patches = [];
  const skipped = [];
  (Array.isArray(clients) ? clients : []).forEach((c) => {
    if (!c || c.status !== "booked") return;
    if ((c.lmsDept || "decor") !== "decor") return;
    if (!c.lmsContractEntryNo) return;
    const to = String(c.lmsContractEntryNo);
    if (String(c.lmsLeadId || "") !== to) return; // not (yet) auto-relinked to its current target
    const from = String(c.lmsLeadEntryNo || "");
    const ids = ownEventOrderIds(eventOrders, c.id, c.name);
    ids.forEach((eoId) => {
      const eo = (Array.isArray(eventOrders) ? eventOrders : []).find((e) => e.id === eoId);
      if (!eo) return;
      const cur = eo.lmsLeadId;
      const curStr = cur == null ? "" : String(cur);
      if (curStr === to) return; // already correct
      if (cur == null || cur === "" || curStr === from) {
        patches.push({ eoId, clientId: c.id, expect: cur == null ? null : String(cur), to, from });
      } else {
        skipped.push({ eoId, reason: "eo-unknown-id:" + curStr });
      }
    });
  });
  return { patches, skipped };
}

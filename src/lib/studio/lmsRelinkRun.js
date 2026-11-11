// Also imported directly (relative path) by the `lms-relink` Supabase Edge Function (Deno) — keep
// this plain JS, no non-relative or extensionless imports.
//
// Orchestrates one full LMS lead->contract relink pass: plan (lmsRelink.js's pure functions), then
// write each decided patch through a caller-supplied `patchClient`/`patchEventOrder` (the actual
// Supabase RPC calls — kept out of this module so it stays testable with fakes and shared as-is
// between the old client-side effect's shape and the new server-side cron runner). Mirrors exactly
// what StudioApp.jsx's relink useEffect used to do inline (now deleted — see migration 056).
import { planLmsRelinks, planEventOrderLmsSync } from "./lmsRelink.js";

/**
 * @param {object} args
 * @param {Array} args.clients        client_ledger rows, as rowToClient produces them
 * @param {Array} args.eventOrders    event_orders rows: {id, clientId, clientName, lmsLeadId, status}
 * @param {Array} args.decorContracts lms_contracts.data rows, dept="decor" only
 * @param {Array} args.decorLeads     lms_decor_leads.data rows
 * @param {Array} [args.knownMissingVerifiedIds] persisted canary state from the prior run
 * @param {(id:string, expect:string|null, patch:object) => Promise<boolean>} args.patchClient
 *   Compare-and-set write to client_ledger (patch_client_ledger_lms RPC). Resolves `true` if it
 *   applied, `false` if another run/tab already moved the row past `expect`. Throws on a real error.
 * @param {(id:string, expect:string|null, patch:object) => Promise<boolean>} args.patchEventOrder
 *   Same shape, for event_orders (patch_event_order_lms RPC).
 * @param {() => number} [args.now] Date.now, injectable for tests.
 * @param {number} [args.verifyCap] caps how many verify-only stamps one pass writes (matches the
 *   original client-side effect's own `.slice(0, 50)`).
 * @returns {{tripped:boolean, tripReason:(string|undefined), withheld:(object|undefined),
 *   relinked:Array, reapplied:Array, verified:Array, casMissed:Array, eoPatched:Array,
 *   eoMissed:Array, skipped:Array, eoSkipped:Array, errors:Array, newlyMissingVerifiedIds:string[]}}
 */
export async function runLmsRelinkPass({
  clients, eventOrders, decorContracts, decorLeads, knownMissingVerifiedIds,
  patchClient, patchEventOrder, now = () => Date.now(), verifyCap = 50,
}) {
  const plan = planLmsRelinks({ clients, decorContracts, decorLeads, knownMissingVerifiedIds });
  const { relinks, reapply, verify, skipped, tripped, withheld, newlyMissingVerifiedIds } = plan;
  const todo = tripped ? [] : [...relinks, ...reapply];
  const toVerify = tripped ? [] : verify.slice(0, verifyCap);

  // A working copy so event_orders sync below (step 3) sees this pass's OWN writes immediately,
  // exactly like the old client-side effect updating clientLedgerRef.current after each RPC —
  // without this, a client relinked earlier in this same pass would still look un-relinked to
  // planEventOrderLmsSync and its event_orders rows would trail by one entire run.
  let cur = [...(Array.isArray(clients) ? clients : [])];
  const replaceClient = (clientId, patch) => {
    cur = cur.map((c) => (c.id === clientId ? { ...c, ...patch } : c));
  };

  const relinked = [], reapplied = [], verified = [], casMissed = [], errors = [];
  const relinkSet = new Set(relinks.map((r) => r.clientId));

  for (const { clientId, from, to } of todo) {
    const patch = {
      lmsLeadId: to, lmsDept: "decor",
      lmsLeadEntryNo: from, lmsContractEntryNo: to, lmsContractVerifiedId: to,
      lmsRelinkedAt: now(), lmsRelinkedBy: "auto", lmsRelinkMatch: "phone+date",
      lastSavedAt: now(),
    };
    let ok;
    try { ok = await patchClient(clientId, from, patch); }
    catch (e) { errors.push({ stage: "client", clientId, message: e?.message || String(e) }); continue; }
    if (!ok) { casMissed.push({ clientId, from, to }); continue; }
    replaceClient(clientId, patch);
    (relinkSet.has(clientId) ? relinked : reapplied).push({ clientId, from, to });
  }

  for (const { clientId, id } of toVerify) {
    try {
      const ok = await patchClient(clientId, id, { lmsContractVerifiedId: id });
      if (!ok) continue;
      replaceClient(clientId, { lmsContractVerifiedId: id });
      verified.push({ clientId, id });
    } catch (e) { errors.push({ stage: "verify", clientId, message: e?.message || String(e) }); }
  }

  // Runs regardless of `tripped` — re-derived from CURRENT (this-pass-updated) client state every
  // run, so a patch that failed earlier (here or in a prior run) is retried automatically (C6).
  const { patches, skipped: eoSkipped } = planEventOrderLmsSync({ clients: cur, eventOrders });
  const eoPatched = [], eoMissed = [];
  for (const { eoId, clientId, expect, to, from } of patches) {
    const eoPatch = { lmsLeadId: to, lmsDept: "decor", lmsRelinkedAt: now(), lmsRelinkedBy: "auto" };
    try {
      const ok = await patchEventOrder(eoId, expect, eoPatch);
      (ok ? eoPatched : eoMissed).push({ eoId, clientId, from, to });
    } catch (e) { errors.push({ stage: "event_order", eoId, clientId, message: e?.message || String(e) }); }
  }

  return {
    tripped: !!tripped,
    tripReason: tripped ? skipped?.[0]?.reason : undefined,
    withheld,
    relinked, reapplied, verified, casMissed,
    eoPatched, eoMissed,
    skipped, eoSkipped, errors,
    newlyMissingVerifiedIds,
  };
}

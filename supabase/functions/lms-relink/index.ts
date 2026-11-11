// Supabase Edge Function — server-side LMS lead-to-contract auto-relink.
//
// Runs the SAME matching/decision logic that used to live entirely inside a Studio browser tab
// (deleted — see src/pages/studio/StudioApp.jsx's old relink useEffect, and migration
// 056_lms_relink_cron.sql) but on a schedule, server-side, via pg_cron + pg_net — so it no longer
// depends on any salesperson happening to have a Studio tab open and focused. Triggered HOURLY by
// migration 056's `public.trigger_lms_relink()`, exactly 10 minutes after the hourly LMS sync
// (`public.trigger_lms_sync()`, same migration) so it always reads lms_contracts/lms_decor_leads from
// the run right before it — never a stale mid-interval read between syncs, which would make the
// canary's "verified contract missing" bookkeeping (planLmsRelinks' knownMissingVerifiedIds) count
// the SAME gap twice before the next real sync had a chance to fix it.
//
// Deliberately imports the pure matching/orchestration modules directly from src/lib/studio/ (relative
// path) instead of duplicating them — those modules are plain JS with zero external dependencies and
// are the single, already-tested (vitest) source of truth. If `supabase functions deploy lms-relink`
// ever fails to bundle this (no other function here imports from outside supabase/functions/, so this
// is unverified past this project's own CLI version), the fallback is mechanical, no logic duplicated:
//   1. Copy src/lib/studio/{lmsRelink,eventOrderFor,lmsRelinkRun,clientRow}.js into
//      supabase/functions/_shared/ unchanged.
//   2. Replace each original src/lib/studio/X.js with a one-line re-export:
//      `export * from "../../../supabase/functions/_shared/X.js";`
//   3. Point this file's two imports below at "../_shared/lmsRelinkRun.js" and "../_shared/clientRow.js".
//   Vite/vitest resolve any path inside the project root, so step 2 changes nothing for the browser
//   build or the existing tests.
//
// Auth: this endpoint is NOT meant to be called from the browser (unlike `lms`'s op=sync, which the
// anon key makes effectively public). It requires a shared secret header so a stray request can't
// trigger a write pass against client_ledger/event_orders.
//
// Deploy:
//   supabase functions deploy lms-relink
//   supabase secrets set LMS_RELINK_CRON_SECRET=<same value stored in Vault as lms_relink_cron_secret>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { runLmsRelinkPass } from "../../../src/lib/studio/lmsRelinkRun.js";
import { rowToClient } from "../../../src/lib/studio/clientRow.js";

const PAGE = 1000;

async function pageAll(sb, table, select, filterFn) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(select).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("LMS_RELINK_CRON_SECRET");
  if (!cronSecret) return json({ error: "LMS_RELINK_CRON_SECRET not configured" }, 500);
  if (req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  let runId = null;
  try {
    const { data: runRow, error: insErr } = await sb
      .from("lms_relink_runs").insert({ status: "running" }).select("id").single();
    if (insErr) console.error("[lms-relink] could not insert run row:", insErr.message);
    else runId = runRow.id;
  } catch (e) { console.error("[lms-relink] could not insert run row:", e?.message || e); }

  try {
    // The canary's self-healing "already seen missing" set — the latest PRIOR run (excluding this
    // one) that actually reached planning, i.e. has a non-null newly_missing_verified_ids. A run
    // that errored before planning leaves this null and is skipped, so the canary state carries
    // forward from the last run that genuinely computed it.
    let knownMissingVerifiedIds = [];
    {
      let q = sb.from("lms_relink_runs").select("newly_missing_verified_ids")
        .not("newly_missing_verified_ids", "is", null)
        .order("id", { ascending: false }).limit(1);
      if (runId != null) q = q.neq("id", runId);
      const { data, error } = await q;
      if (error) throw new Error(`lms_relink_runs (canary read): ${error.message}`);
      knownMissingVerifiedIds = data?.[0]?.newly_missing_verified_ids || [];
    }

    const [contractRows, leadRows, clientRows] = await Promise.all([
      pageAll(sb, "lms_contracts", "id, data, synced_at", (q) => q.eq("dept", "decor")),
      pageAll(sb, "lms_decor_leads", "id, data"),
      pageAll(sb, "client_ledger_light", "*"),
    ]);

    // Read separately from the three above: a failure here must only skip the event_orders sync
    // step (exactly what the old client-side effect's `eoLoadStateRef.current === "ok"` guard did),
    // never abort the client_ledger relinks themselves — those don't depend on event_orders at all.
    let eventOrders = [];
    try {
      const eoRows = await pageAll(sb, "event_orders", "id, status, data->>clientId, data->>clientName, data->>lmsLeadId, dataStatus:data->>status");
      eventOrders = eoRows.map((r) => ({
        id: r.id, clientId: r.clientId, clientName: r.clientName, lmsLeadId: r.lmsLeadId,
        // Exactly StudioApp.jsx's rowToEO: `row.status ?? row?.data?.status`, no further fallback —
        // a row NULL on both sides stays null/undefined, which isCancelled (eventOrderFor.js) simply
        // treats as "not cancelled", same as today.
        status: r.status ?? r.dataStatus,
      }));
    } catch (e) {
      console.error("[lms-relink] event_orders load failed, skipping event_orders sync this run:", e?.message || e);
    }

    const decorContracts = contractRows.map((r) => r.data);
    const decorLeads = leadRows.map((r) => r.data);
    const clients = clientRows.map(rowToClient).filter(Boolean);
    const lmsSyncedAt = contractRows.reduce((max, r) => {
      const t = r.synced_at ? new Date(r.synced_at).getTime() : 0;
      return t > max ? t : max;
    }, 0);

    const patchClient = async (id, expect, patch) => {
      const { data, error } = await sb.rpc("patch_client_ledger_lms", { p_id: id, p_expect: expect, p_patch: patch });
      if (error) throw new Error(error.message);
      return !!data;
    };
    const patchEventOrder = async (id, expect, patch) => {
      const { data, error } = await sb.rpc("patch_event_order_lms", { p_id: id, p_expect: expect, p_patch: patch });
      if (error) throw new Error(error.message);
      return !!data;
    };

    const result = await runLmsRelinkPass({
      clients, eventOrders, decorContracts, decorLeads, knownMissingVerifiedIds,
      patchClient, patchEventOrder,
    });

    const status = result.tripped ? "tripped" : (result.errors.length ? "partial" : "ok");
    const summary = {
      status, finished_at: new Date().toISOString(),
      trip_reason: result.tripReason ?? null,
      lms_synced_at: lmsSyncedAt ? new Date(lmsSyncedAt).toISOString() : null,
      clients_scanned: clients.length, decor_contracts: decorContracts.length,
      decor_leads: decorLeads.length, event_orders_scanned: eventOrders.length,
      relinked: result.relinked, reapplied: result.reapplied, verified: result.verified,
      cas_missed: result.casMissed, eo_patched: result.eoPatched, eo_missed: result.eoMissed,
      skipped: result.skipped, eo_skipped: result.eoSkipped, errors: result.errors,
      withheld: result.withheld ?? null,
      newly_missing_verified_ids: result.newlyMissingVerifiedIds,
    };
    console.log("[lms-relink]", JSON.stringify({
      status, relinked: result.relinked.length, reapplied: result.reapplied.length,
      eoPatched: result.eoPatched.length, errors: result.errors.length, tripped: result.tripped,
    }));
    if (runId != null) {
      const { error } = await sb.from("lms_relink_runs").update(summary).eq("id", runId);
      if (error) console.error("[lms-relink] could not update run row:", error.message);
    }
    return json({ runId, ...summary }, 200);
  } catch (e) {
    const message = String(e?.message || e);
    console.error("[lms-relink] run failed:", message);
    if (runId != null) {
      await sb.from("lms_relink_runs")
        .update({ status: "error", error: message, finished_at: new Date().toISOString() })
        .eq("id", runId);
    }
    return json({ runId, error: message }, 500);
  }
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

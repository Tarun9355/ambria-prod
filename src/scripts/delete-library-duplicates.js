#!/usr/bin/env node
/**
 * Ambria Studio Library — Delete Duplicate Rows
 *
 * Consumes the plan produced by dedupe-library-dry-run.js
 * (src/scripts/dedupe-library-plan.json) and deletes ONLY the rows listed in
 * its `toDelete` array — the untagged twin of each exact-URL duplicate pair.
 * Rows in `needsReview` are never touched by this script.
 *
 * SAFETY:
 *   - Re-fetches each candidate row live right before deleting and re-checks it
 *     still has ZERO tag data (tags/elements/verified/aiTagged). If a row has been
 *     tagged since the dry run, it is SKIPPED, not deleted.
 *   - Requires CONFIRM=DELETE to actually delete anything. Without it, this script
 *     re-verifies the plan against live data and reports what it WOULD delete —
 *     it makes no writes.
 *   - Writes an audit log of every row actually deleted (id, url, keptId) to
 *     src/scripts/dedupe-library-deleted-log.json.
 *
 * Required env vars — set in .env or .env.local, OR export before running:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY            (used if SUPABASE_SERVICE_ROLE_KEY absent)
 *   SUPABASE_SERVICE_ROLE_KEY         (optional — preferred for deletes if RLS
 *                                       blocks the anon key from DELETE)
 *
 * Run (dry — re-verifies plan against live data, deletes nothing):
 *   node src/scripts/delete-library-duplicates.js
 *
 * Run for real (actually deletes):
 *   CONFIRM=DELETE node src/scripts/delete-library-duplicates.js
 */

import { readFileSync, existsSync, writeFileSync } from "fs";

function loadDotEnv() {
  const merged = { ...process.env };
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (!(key in merged)) merged[key] = val;
    }
  }
  return merged;
}

const env = loadDotEnv();
const SB_URL = env.VITE_SUPABASE_URL;
const SB_ANON = env.VITE_SUPABASE_ANON_KEY;
const SB_SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIRM = env.CONFIRM === "DELETE";
const PLAN_PATH = "src/scripts/dedupe-library-plan.json";
const LOG_PATH = "src/scripts/dedupe-library-deleted-log.json";

if (!SB_URL) { console.error("❌  VITE_SUPABASE_URL is required"); process.exit(1); }
if (!SB_ANON && !SB_SERVICE) { console.error("❌  VITE_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required"); process.exit(1); }
if (!existsSync(PLAN_PATH)) {
  console.error(`❌  ${PLAN_PATH} not found — run dedupe-library-dry-run.js first.`);
  process.exit(1);
}

const usingServiceRole = !!SB_SERVICE;
const SB_KEY = SB_SERVICE || SB_ANON;
const SB_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

function tagInfo(row) {
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data)) ? row.data : {};
  const tags = (row.tags && Object.keys(row.tags).length) ? row.tags
    : (d.tags && Object.keys(d.tags || {}).length) ? d.tags : null;
  const elements = (row.elements && row.elements.length) ? row.elements
    : (d.elements && d.elements.length) ? d.elements : null;
  const verified = !!(d._verified || d.verified);
  const aiTagged = !!(d._aiTagged || d.aiTagged);
  return { any: !!(tags || elements || verified || aiTagged) };
}

function buildInFilter(values) {
  return "in.(" + values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",") + ")";
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchRowsByIds(ids) {
  const url = new URL(`${SB_URL}/rest/v1/library`);
  url.searchParams.set("id", buildInFilter(ids));
  url.searchParams.set("select", "id,url,tags,elements,data");
  const r = await fetch(url, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`Supabase GET library ${r.status}: ${await r.text()}`);
  return r.json();
}

async function deleteRowsByIds(ids) {
  const url = new URL(`${SB_URL}/rest/v1/library`);
  url.searchParams.set("id", buildInFilter(ids));
  const r = await fetch(url, {
    method: "DELETE",
    headers: { ...SB_HEADERS, Prefer: "return=representation" },
  });
  if (!r.ok) throw new Error(`Supabase DELETE library ${r.status}: ${await r.text()}`);
  return r.json();
}

function sep() { console.log("─".repeat(70)); }

async function main() {
  sep();
  console.log(" Ambria Studio Library — Delete Duplicate Rows");
  console.log(CONFIRM ? " ⚠️  LIVE MODE — rows WILL be deleted" : " 🧪 DRY MODE — no writes (set CONFIRM=DELETE to actually delete)");
  console.log(` Using ${usingServiceRole ? "SUPABASE_SERVICE_ROLE_KEY" : "VITE_SUPABASE_ANON_KEY"} for requests.`);
  sep();

  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf-8"));
  const candidates = plan.toDelete || [];
  console.log(`\n📋  Plan loaded: ${candidates.length} candidate row(s) to delete, ${plan.needsReview?.length || 0} flagged for review (untouched).`);

  if (!candidates.length) {
    console.log("\n✅  Nothing to delete — plan is empty.");
    return;
  }

  const batches = chunk(candidates, 100);
  const safeToDelete = [];
  const skippedNowTagged = [];
  const skippedMissing = [];

  console.log("\n🔎  Re-verifying candidates against live data before touching anything...");
  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (const batch of batches) {
    const liveRows = await fetchRowsByIds(batch.map((c) => c.id));
    const liveById = new Map(liveRows.map((r) => [r.id, r]));
    for (const cand of batch) {
      const live = liveById.get(cand.id);
      if (!live) { skippedMissing.push(cand); continue; }
      if (tagInfo(live).any) { skippedNowTagged.push(cand); continue; }
      safeToDelete.push(cand);
    }
  }

  console.log(`    Still safe to delete (zero tag data):     ${safeToDelete.length}`);
  console.log(`    Skipped — tagged since dry run:           ${skippedNowTagged.length}`);
  console.log(`    Skipped — already gone:                   ${skippedMissing.length}`);

  if (skippedNowTagged.length) {
    console.log("\n⚠️   Skipped (now have tag data, NOT deleted):");
    skippedNowTagged.slice(0, 10).forEach((c) => console.log(`    - ${c.id}`));
    if (skippedNowTagged.length > 10) console.log(`    ... and ${skippedNowTagged.length - 10} more`);
  }

  if (!CONFIRM) {
    sep();
    console.log(`\n🧪  DRY MODE — would delete ${safeToDelete.length} row(s). No changes made.`);
    console.log("    Re-run with CONFIRM=DELETE to actually delete these rows.\n");
    return;
  }

  console.log(`\n🗑️   Deleting ${safeToDelete.length} row(s)...`);
  const deleteBatches = chunk(safeToDelete, 100);
  const deletedLog = [];
  let errors = 0;
  for (let i = 0; i < deleteBatches.length; i++) {
    const b = deleteBatches[i];
    try {
      const deleted = await deleteRowsByIds(b.map((c) => c.id));
      for (const d of deleted) {
        const orig = byId.get(d.id);
        deletedLog.push({ id: d.id, url: d.url, keptId: orig?.keptId ?? null });
      }
      process.stdout.write(`\r    Batch ${i + 1}/${deleteBatches.length} — ${deletedLog.length} deleted so far`);
    } catch (e) {
      errors++;
      console.error(`\n    ❌  Batch ${i + 1} failed: ${e.message}`);
    }
  }
  console.log("");

  writeFileSync(LOG_PATH, JSON.stringify({ deletedAt: new Date().toISOString(), count: deletedLog.length, deletedLog }, null, 2));

  sep();
  console.log(`\n✅  Done. Deleted ${deletedLog.length} row(s). ${errors ? `${errors} batch error(s).` : ""}`);
  console.log(`    Audit log saved to ${LOG_PATH}\n`);
}

main().catch((e) => {
  console.error("\n❌  Fatal:", e.message || e);
  process.exit(1);
});

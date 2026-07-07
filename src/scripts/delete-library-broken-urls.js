#!/usr/bin/env node
/**
 * Ambria Studio Library — Delete Rows With Broken Cloudinary URLs
 *
 * Targets the "img %"-named rows (e.g. "img 00001") added in the 2026-07-04
 * bulk import under ambria/BAR/... — investigation confirmed Cloudinary 404s
 * ("Resource not found") for every sampled URL in that batch, while other
 * batches load fine. This script re-verifies EVERY candidate live via an HTTP
 * HEAD request right before deleting anything, so it only ever deletes rows
 * whose image is confirmed broken right now — never trusts the investigation
 * sample alone.
 *
 * SAFETY:
 *   - Only considers rows matching name ILIKE 'img %' (the diagnosed batch).
 *   - A row is only deleted if BOTH:
 *       (a) its Cloudinary URL returns a non-2xx HTTP status just now, AND
 *       (b) it has ZERO tag data (no tags, no elements, not verified, not AI-tagged)
 *   - Requires CONFIRM=DELETE to actually delete. Without it, dry-run only —
 *     reports what WOULD be deleted, makes no writes.
 *   - Writes an audit log of every row actually deleted to
 *     src/scripts/delete-library-broken-urls-log.json.
 *
 * Required env vars — set in .env or .env.local, OR export before running:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY            (used if SUPABASE_SERVICE_ROLE_KEY absent)
 *   SUPABASE_SERVICE_ROLE_KEY         (optional — preferred for deletes if RLS
 *                                       blocks the anon key from DELETE)
 *
 * Run (dry — checks live URLs, deletes nothing):
 *   node src/scripts/delete-library-broken-urls.js
 *
 * Run for real (actually deletes):
 *   CONFIRM=DELETE node src/scripts/delete-library-broken-urls.js
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
const LOG_PATH = "src/scripts/delete-library-broken-urls-log.json";
const NAME_PATTERN = "img *"; // "*" is PostgREST's ILIKE wildcard char, translated to "%"
const HEAD_CONCURRENCY = 20;

if (!SB_URL) { console.error("❌  VITE_SUPABASE_URL is required"); process.exit(1); }
if (!SB_ANON && !SB_SERVICE) { console.error("❌  VITE_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is required"); process.exit(1); }

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

/** Fetch every row matching the name pattern, paginated via the Range header (PostgREST default page cap is 1000). */
async function fetchCandidateRows() {
  const out = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const url = new URL(`${SB_URL}/rest/v1/library`);
    url.searchParams.set("name", `ilike.${NAME_PATTERN}`);
    url.searchParams.set("select", "id,url,tags,elements,data,status");
    const r = await fetch(url, {
      headers: { ...SB_HEADERS, Range: `${offset}-${offset + pageSize - 1}` },
    });
    if (!r.ok) throw new Error(`Supabase GET library ${r.status}: ${await r.text()}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function isUrlBroken(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return !r.ok; // broken = any non-2xx (404 "Resource not found" is what we saw)
  } catch {
    return true; // network/DNS failure — treat as broken too
  }
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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
  console.log(" Ambria Studio Library — Delete Rows With Broken Cloudinary URLs");
  console.log(CONFIRM ? " ⚠️  LIVE MODE — rows WILL be deleted" : " 🧪 DRY MODE — no writes (set CONFIRM=DELETE to actually delete)");
  console.log(` Using ${usingServiceRole ? "SUPABASE_SERVICE_ROLE_KEY" : "VITE_SUPABASE_ANON_KEY"} for requests.`);
  sep();

  console.log(`\n📋  Fetching rows matching name ILIKE '${NAME_PATTERN}'...`);
  const candidates = await fetchCandidateRows();
  console.log(`    Found ${candidates.length} candidate row(s).`);
  if (!candidates.length) { console.log("\n✅  Nothing to check — no matching rows."); return; }

  console.log(`\n🌐  Checking each URL live (HEAD request, ${HEAD_CONCURRENCY} concurrent)...`);
  let checked = 0;
  const brokenFlags = await mapWithConcurrency(candidates, HEAD_CONCURRENCY, async (row) => {
    const broken = row.url ? await isUrlBroken(row.url) : true;
    checked++;
    if (checked % 200 === 0) process.stdout.write(`\r    Checked ${checked}/${candidates.length}`);
    return broken;
  });
  console.log(`\r    Checked ${checked}/${candidates.length}`);

  const broken = candidates.filter((_, i) => brokenFlags[i]);
  const healthy = candidates.length - broken.length;
  console.log(`    Broken (Cloudinary 404 or unreachable): ${broken.length}`);
  console.log(`    Still healthy (loaded fine — left alone): ${healthy}`);

  const safeToDelete = broken.filter((row) => !tagInfo(row).any);
  const skippedTagged = broken.filter((row) => tagInfo(row).any);
  console.log(`    Of the broken ones — safe to delete (zero tag data): ${safeToDelete.length}`);
  if (skippedTagged.length) {
    console.log(`    ⚠️  Broken but HAS tag data — NOT deleting, needs manual review: ${skippedTagged.length}`);
    skippedTagged.slice(0, 10).forEach((r) => console.log(`        - ${r.id}`));
    if (skippedTagged.length > 10) console.log(`        ... and ${skippedTagged.length - 10} more`);
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
      const deleted = await deleteRowsByIds(b.map((r) => r.id));
      for (const d of deleted) deletedLog.push({ id: d.id, url: d.url });
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

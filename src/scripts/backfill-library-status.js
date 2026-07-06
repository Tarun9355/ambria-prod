#!/usr/bin/env node
/**
 * Ambria Studio Library — backfill status/tag_source/tagged_at (migration 008)
 *
 * Populates the new typed mirror columns on every existing `library` row from the `data` JSONB
 * blob, using the exact same status/timestamp logic as the app's libItemToRow (see
 * src/lib/studio/libraryQueries.js) so server-side pagination/counts match what the client would
 * have computed. Idempotent — safe to re-run; only touches status/tag_source/tagged_at.
 *
 * Required env vars — set in .env or .env.local, OR export before running:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Run:
 *   node src/scripts/backfill-library-status.js
 */

import { readFileSync, existsSync } from "fs";

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

if (!SB_URL) { console.error("❌  VITE_SUPABASE_URL is required"); process.exit(1); }
if (!SB_ANON) { console.error("❌  VITE_SUPABASE_ANON_KEY is required"); process.exit(1); }

const SB_HEADERS = {
  apikey: SB_ANON,
  Authorization: `Bearer ${SB_ANON}`,
  "Content-Type": "application/json",
};

async function loadLibraryRows() {
  const all = [];
  const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const r = await fetch(
      `${SB_URL}/rest/v1/library?select=id,data,tags,elements&order=id&offset=${from}&limit=${SIZE}`,
      { headers: SB_HEADERS }
    );
    if (!r.ok) throw new Error(`Supabase GET library ${r.status}: ${await r.text()}`);
    const data = await r.json();
    all.push(...data);
    if (data.length < SIZE) break;
  }
  return all;
}

// Mirrors libPhotoIsTagged (src/lib/studio/taxonomy.js) without importing it — this script runs
// standalone via plain `node`, not through the app's Vite bundle.
function libPhotoIsTagged(img) {
  return (img?.elements || []).length > 0
    || Object.entries(img?.tags || {}).some(([k, v]) => k !== "areasElements" && Array.isArray(v) && v.length > 0);
}

// Mirrors computeLibStatus/computeTaggedAtMs in src/lib/studio/libraryQueries.js.
function computeMirrors(row) {
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length) ? row.data : null;
  const it = d || { tags: row.tags || {}, elements: row.elements || [] };
  const status = it._verified ? "verified" : (libPhotoIsTagged(it) ? "review" : "untagged");
  const aiTs = typeof it._aiTaggedAt === "number" ? it._aiTaggedAt : null;
  const verifiedTs = typeof it._verifiedAt === "number" ? it._verifiedAt : null;
  const taggedAtMs = status === "verified" ? (verifiedTs || aiTs || null) : aiTs;
  return {
    id: row.id,
    status,
    tag_source: it.tagSource || null,
    tagged_at: taggedAtMs ? new Date(taggedAtMs).toISOString() : null,
  };
}

function sep() { console.log("─".repeat(70)); }

async function main() {
  sep();
  console.log(" Ambria Studio Library — backfill status/tag_source/tagged_at");
  sep();

  console.log("\n📂  Loading all rows from `library` table...");
  const rows = await loadLibraryRows();
  console.log(`    Loaded ${rows.length} row(s)`);

  const updates = rows.map(computeMirrors);
  const counts = updates.reduce((acc, u) => { acc[u.status] = (acc[u.status] || 0) + 1; return acc; }, {});
  console.log(`\n📊  Computed status: verified=${counts.verified || 0} review=${counts.review || 0} untagged=${counts.untagged || 0}`);
  console.log(`    tag_source: nightly=${updates.filter(u => u.tag_source === "nightly").length} manual=${updates.filter(u => u.tag_source === "manual").length}`);

  console.log("\n📝  Writing in batches of 500 (upsert, merge-duplicates — only status/tag_source/tagged_at touched)...");
  const SIZE = 500;
  let written = 0;
  for (let i = 0; i < updates.length; i += SIZE) {
    const batch = updates.slice(i, i + SIZE);
    const r = await fetch(`${SB_URL}/rest/v1/library?on_conflict=id`, {
      method: "POST",
      headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`Supabase upsert batch ${i}-${i + batch.length} failed ${r.status}: ${await r.text()}`);
    written += batch.length;
    console.log(`    ${written}/${updates.length} written…`);
  }

  sep();
  console.log(`\n✅  Backfill complete — ${written} row(s) updated.\n`);
}

main().catch((e) => {
  console.error("\n❌  Fatal:", e.message || e);
  process.exit(1);
});

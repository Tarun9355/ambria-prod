#!/usr/bin/env node
/**
 * Ambria Studio Library — Duplicate Checker
 *
 * Read-only report. Queries every row from the `library` table, then:
 *   1. Groups by exact `url` — any URL appearing more than once is an exact duplicate.
 *   2. Groups by Cloudinary public_id extracted from the URL (ignoring protocol,
 *      transformation segments, and version segments) — catches near-duplicates like
 *      http vs https or the same image saved with different transform params.
 *
 * Makes NO writes. Prints a report only.
 *
 * Required env vars — set in .env or .env.local, OR export before running:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Run:
 *   node src/scripts/check-library-duplicates.js
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

// Paginated load — mirrors loadLibraryRows() in StudioApp.jsx
async function loadLibraryRows() {
  const all = [];
  const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const r = await fetch(
      `${SB_URL}/rest/v1/library?select=id,name,url&order=id&offset=${from}&limit=${SIZE}`,
      { headers: SB_HEADERS }
    );
    if (!r.ok) throw new Error(`Supabase GET library ${r.status}: ${await r.text()}`);
    const data = await r.json();
    all.push(...data);
    if (data.length < SIZE) break;
  }
  return all;
}

// Segments that indicate a Cloudinary transformation or version, not part of the public_id.
const TRANSFORM_PREFIX = /^(v\d+|[a-z]{1,3}(_[a-zA-Z0-9.:%+-]+)+)$/;
function looksLikeTransformSegment(seg) {
  if (/^v\d+$/.test(seg)) return true;
  // Transformation segments are comma-joined key_value pairs, e.g. "c_fill,w_800,h_600,q_auto"
  const parts = seg.split(",");
  return parts.every((p) => /^[a-z]{1,4}_[A-Za-z0-9.:%+-]+$/.test(p));
}

/** Extract a normalized "identity" for a Cloudinary URL: protocol-agnostic public_id sans transforms. */
function extractIdentity(url) {
  if (!url || typeof url !== "string") return null;
  const uploadIdx = url.indexOf("/upload/");
  if (uploadIdx === -1) return url.replace(/^https?:\/\//, ""); // not a Cloudinary URL — fall back to protocol-agnostic URL
  const after = url.slice(uploadIdx + "/upload/".length);
  const segments = after.split("/");
  let i = 0;
  while (i < segments.length - 1 && looksLikeTransformSegment(segments[i])) i++;
  const publicIdWithExt = segments.slice(i).join("/");
  const publicId = publicIdWithExt.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, "");
  return publicId;
}

function sep() { console.log("─".repeat(70)); }

async function main() {
  sep();
  console.log(" Ambria Studio Library — Duplicate Report (read-only)");
  sep();

  console.log("\n📂  Loading all rows from `library` table...");
  const rows = await loadLibraryRows();
  console.log(`    Loaded ${rows.length} row(s)`);

  // ── Exact URL duplicates ───────────────────────────────────────────────
  const byUrl = new Map();
  for (const row of rows) {
    const url = row.url;
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(row);
  }
  const exactDupGroups = [...byUrl.entries()].filter(([, list]) => list.length > 1);
  const totalExactDupRows = exactDupGroups.reduce((sum, [, list]) => sum + list.length, 0);

  // ── Near-duplicates by extracted public_id (ignoring protocol / transforms) ──
  const byIdentity = new Map();
  for (const row of rows) {
    const identity = extractIdentity(row.url);
    if (!identity) continue;
    if (!byIdentity.has(identity)) byIdentity.set(identity, []);
    byIdentity.get(identity).push(row);
  }
  // "Near-duplicate" groups: same identity, but MORE than one DISTINCT raw URL string
  // (i.e. not just plain exact duplicates already caught above)
  const nearDupGroups = [...byIdentity.entries()].filter(
    ([, list]) => new Set(list.map((r) => r.url)).size > 1
  );

  // ── Report ─────────────────────────────────────────────────────────────
  sep();
  console.log("\n📊  Summary:");
  console.log(`    Total images (rows):        ${rows.length}`);
  console.log(`    Total unique URLs:          ${byUrl.size}`);
  console.log(`    Exact-duplicate URL groups: ${exactDupGroups.length}`);
  console.log(`    Rows involved in exact dups: ${totalExactDupRows}`);
  console.log(`    Total unique public_ids:    ${byIdentity.size}`);
  console.log(`    Near-duplicate groups (same public_id, different URL variant): ${nearDupGroups.length}`);

  const worst = [...exactDupGroups]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  console.log("\n🏆  Top 20 worst offenders (exact URL duplicates):");
  if (!worst.length) {
    console.log("    None found — no exact URL duplicates. ✅");
  } else {
    worst.forEach(([url, list], i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ×${list.length}  ${url}`);
      console.log(`         ids: ${list.map((r) => r.id).join(", ")}`);
    });
  }

  if (nearDupGroups.length) {
    console.log("\n🔎  Near-duplicate groups (same Cloudinary public_id, different URL string):");
    nearDupGroups
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20)
      .forEach(([identity, list], i) => {
        console.log(`    ${String(i + 1).padStart(2)}. ×${list.length}  public_id: ${identity}`);
        list.forEach((r) => console.log(`         - id=${r.id}  ${r.url}`));
      });
  } else {
    console.log("\n🔎  Near-duplicates (same public_id, different URL variant): none found. ✅");
  }

  sep();
  console.log("\n✅  Report complete — no changes were made.\n");
}

main().catch((e) => {
  console.error("\n❌  Fatal:", e.message || e);
  process.exit(1);
});

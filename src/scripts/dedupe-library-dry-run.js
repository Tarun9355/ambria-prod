#!/usr/bin/env node
/**
 * Ambria Studio Library — Dedupe DRY RUN
 *
 * Finds exact-URL duplicate rows in the `library` table and decides, per group,
 * which row(s) are safe to delete: the row(s) with NO tagging data (tags, elements,
 * verification, or AI-tagged flag), keeping whichever row DOES carry tag data.
 *
 * Makes NO writes. Prints a report and saves the delete-candidate id list to
 * a JSON file for review — nothing is deleted by this script.
 *
 * Safety rules:
 *   - A row is only marked deletable if it has ZERO tag data (no tags, no elements,
 *     not verified, not AI-tagged).
 *   - If a group has more than one row WITH tag data, or ZERO rows with tag data,
 *     it is NOT auto-decided — it's flagged under "needsReview" instead.
 *
 * Required env vars — set in .env or .env.local, OR export before running:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Run:
 *   node src/scripts/dedupe-library-dry-run.js
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
      `${SB_URL}/rest/v1/library?select=id,url,name,tags,elements,dims,linked_templates,data&order=id&offset=${from}&limit=${SIZE}`,
      { headers: SB_HEADERS }
    );
    if (!r.ok) throw new Error(`Supabase GET library ${r.status}: ${await r.text()}`);
    const data = await r.json();
    all.push(...data);
    if (data.length < SIZE) break;
  }
  return all;
}

/** Does this row carry any tagging work (tags, elements, verification, AI-tagged)? */
function tagInfo(row) {
  const d = (row.data && typeof row.data === "object" && !Array.isArray(row.data)) ? row.data : {};
  const tags = (row.tags && Object.keys(row.tags).length) ? row.tags
    : (d.tags && Object.keys(d.tags || {}).length) ? d.tags : null;
  const elements = (row.elements && row.elements.length) ? row.elements
    : (d.elements && d.elements.length) ? d.elements : null;
  const verified = !!(d._verified || d.verified);
  const aiTagged = !!(d._aiTagged || d.aiTagged);
  const any = !!(tags || elements || verified || aiTagged);
  return { hasTags: !!tags, hasElements: !!elements, verified, aiTagged, any };
}

function sep() { console.log("─".repeat(70)); }

async function main() {
  sep();
  console.log(" Ambria Studio Library — Dedupe DRY RUN (no writes)");
  sep();

  console.log("\n📂  Loading all rows from `library` table...");
  const rows = await loadLibraryRows();
  console.log(`    Loaded ${rows.length} row(s)`);

  const byUrl = new Map();
  for (const row of rows) {
    if (!row.url) continue;
    if (!byUrl.has(row.url)) byUrl.set(row.url, []);
    byUrl.get(row.url).push(row);
  }
  const dupGroups = [...byUrl.entries()].filter(([, list]) => list.length > 1);

  const toDelete = [];       // { id, url, keptId }
  const needsReview = [];    // { url, rows: [{id, tagInfo}] }

  for (const [url, list] of dupGroups) {
    const withInfo = list.map((r) => ({ row: r, info: tagInfo(r) }));
    const tagged = withInfo.filter((x) => x.info.any);
    const untagged = withInfo.filter((x) => !x.info.any);

    if (tagged.length === 1 && untagged.length === list.length - 1) {
      // Exactly one row has tag data — keep it, delete the rest (which have zero tag data).
      const keep = tagged[0].row;
      for (const x of untagged) {
        toDelete.push({ id: x.row.id, url, keptId: keep.id });
      }
    } else {
      // Ambiguous: 0 rows tagged, or >1 rows tagged — don't auto-decide.
      needsReview.push({
        url,
        rows: withInfo.map((x) => ({ id: x.row.id, ...x.info })),
      });
    }
  }

  sep();
  console.log("\n📊  Summary:");
  console.log(`    Total rows:                 ${rows.length}`);
  console.log(`    Duplicate URL groups:       ${dupGroups.length}`);
  console.log(`    Auto-decided (safe to delete): ${toDelete.length} row(s)`);
  console.log(`    Flagged for manual review:  ${needsReview.length} group(s)`);

  if (needsReview.length) {
    console.log("\n⚠️   Groups needing manual review (0 or >1 tagged rows — not auto-decided):");
    needsReview.slice(0, 20).forEach((g, i) => {
      console.log(`    ${i + 1}. ${g.url}`);
      g.rows.forEach((r) =>
        console.log(`         id=${r.id}  tags=${r.hasTags} elements=${r.hasElements} verified=${r.verified} aiTagged=${r.aiTagged}`)
      );
    });
    if (needsReview.length > 20) console.log(`    ... and ${needsReview.length - 20} more (see saved JSON)`);
  }

  console.log("\n🗑️   Sample of rows that WOULD be deleted (untagged twin, tagged twin kept):");
  toDelete.slice(0, 20).forEach((x, i) => {
    console.log(`    ${i + 1}. delete id=${x.id}   (keeping id=${x.keptId})`);
  });
  if (toDelete.length > 20) console.log(`    ... and ${toDelete.length - 20} more (see saved JSON)`);

  const outPath = "src/scripts/dedupe-library-plan.json";
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: "dry-run", toDelete, needsReview }, null, 2)
  );
  console.log(`\n💾  Full plan saved to ${outPath} (delete candidates + review list).`);

  sep();
  console.log("\n✅  DRY RUN complete — no rows were deleted.\n");
}

main().catch((e) => {
  console.error("\n❌  Fatal:", e.message || e);
  process.exit(1);
});

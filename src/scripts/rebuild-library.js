#!/usr/bin/env node
/**
 * Ambria Studio Library — Cloudinary Rebuild Script
 *
 * Scans all Cloudinary folders and inserts any missing images into the Studio
 * Library (settings table, key "ambria-library-v2"). Already-tagged images are
 * skipped so existing tags are never overwritten.
 *
 * Prerequisites: Node 18+  (uses built-in fetch + Buffer)
 *
 * Required env vars — set in .env or .env.local, OR export before running:
 *   CLOUDINARY_API_SECRET   (required — never hardcoded)
 *   VITE_SUPABASE_URL       (e.g. https://taalribntdkowoqltvqw.supabase.co)
 *   VITE_SUPABASE_ANON_KEY
 *
 * Optional:
 *   CLOUDINARY_API_KEY      (defaults to 592743487577154)
 *
 * Run:
 *   node src/scripts/rebuild-library.js
 *
 * Dry run (shows counts, makes no writes):
 *   DRY_RUN=1 node src/scripts/rebuild-library.js
 */

import { readFileSync, existsSync } from "fs";

// ── Load .env / .env.local ─────────────────────────────────────────────────
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
      if (!(key in merged)) merged[key] = val; // process.env wins
    }
  }
  return merged;
}

const env = loadDotEnv();

const CLD_CLOUD   = "dy9wfqhry";
const CLD_API_KEY = env.CLOUDINARY_API_KEY || "592743487577154";
const CLD_SECRET  = env.CLOUDINARY_API_SECRET;
const SB_URL      = env.VITE_SUPABASE_URL;
const SB_ANON     = env.VITE_SUPABASE_ANON_KEY;
const DRY_RUN     = !!env.DRY_RUN;
const LIB_SK      = "ambria-library-v2";

// Folders to scan — all top-level Cloudinary folders
const TOP_FOLDERS = [
  "Ambria",
  "inhouse venues",
  "inventory",
  "Outside Venues",
  "client-uploads",
  "production-ref",
];

// ── Validation ─────────────────────────────────────────────────────────────
if (!CLD_SECRET)  { console.error("❌  CLOUDINARY_API_SECRET is required"); process.exit(1); }
if (!SB_URL)      { console.error("❌  VITE_SUPABASE_URL is required");     process.exit(1); }
if (!SB_ANON)     { console.error("❌  VITE_SUPABASE_ANON_KEY is required"); process.exit(1); }

// ── Cloudinary helpers ─────────────────────────────────────────────────────
const CLD_AUTH = `Basic ${Buffer.from(`${CLD_API_KEY}:${CLD_SECRET}`).toString("base64")}`;

async function cldGet(path) {
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLD_CLOUD}/${path}`, {
    headers: { Authorization: CLD_AUTH },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Cloudinary ${r.status} ${path}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

/** List all images under a public_id prefix (paginated, 500/page). */
async function* listResourcesByPrefix(prefix) {
  let cursor = null;
  let page = 0;
  do {
    const params = new URLSearchParams({
      type: "upload",
      prefix,
      max_results: "500",
      ...(cursor ? { next_cursor: cursor } : {}),
    });
    const data = await cldGet(`resources/image?${params}`);
    for (const r of data.resources || []) yield r;
    cursor = data.next_cursor ?? null;
    page++;
    if (page > 100) break; // safety cap: 50 000 images per folder
  } while (cursor);
}

/** Recursively collect all folder paths under a root folder. */
async function collectFolders(root) {
  const all = [root];
  const queue = [root];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const f = queue.shift();
    try {
      const encoded = f.split("/").map(encodeURIComponent).join("/");
      const { folders } = await cldGet(`folders/${encoded}`);
      for (const sub of folders ?? []) {
        const full = sub.path || `${f}/${sub.name}`;
        if (!all.includes(full)) { all.push(full); queue.push(full); }
      }
    } catch { /* inaccessible or empty — skip */ }
  }
  return all;
}

// ── Supabase helpers ───────────────────────────────────────────────────────
const SB_HEADERS = {
  apikey: SB_ANON,
  Authorization: `Bearer ${SB_ANON}`,
  "Content-Type": "application/json",
};

async function sbLoadLibrary() {
  const r = await fetch(
    `${SB_URL}/rest/v1/settings?key=eq.${encodeURIComponent(LIB_SK)}&select=value`,
    { headers: SB_HEADERS }
  );
  if (!r.ok) throw new Error(`Supabase GET settings ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  if (!rows.length) return [];
  const raw = rows[0].value;
  try { return JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)); }
  catch { return []; }
}

async function sbSaveLibrary(items) {
  const r = await fetch(`${SB_URL}/rest/v1/settings`, {
    method: "POST",
    headers: { ...SB_HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: LIB_SK, value: JSON.stringify(items) }),
  });
  if (!r.ok) throw new Error(`Supabase UPSERT settings ${r.status}: ${await r.text()}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
function sep() { console.log("─".repeat(60)); }

async function main() {
  sep();
  console.log(" Ambria Studio Library — Cloudinary Rebuild");
  if (DRY_RUN) console.log(" DRY RUN — no writes will be made");
  sep();

  // 1. Load existing library
  console.log("\n📂  Loading existing library from Supabase...");
  const existing = await sbLoadLibrary();
  const existingUrls = new Set(existing.map(i => i.url));
  const existingIds  = new Set(existing.map(i => i.id));
  console.log(`    Existing library: ${existing.length} image(s)`);

  const fresh = [];
  let totalScanned = 0;

  // 2. Scan each top-level folder
  for (const topFolder of TOP_FOLDERS) {
    console.log(`\n📁  Folder: "${topFolder}"`);

    // 2a. Discover all subfolders (so we can show accurate totals)
    process.stdout.write("    Discovering subfolders... ");
    const allFolders = await collectFolders(topFolder);
    console.log(`${allFolders.length} folder(s)`);

    // 2b. Stream all images under this top folder via prefix listing
    //     (prefix listing returns resources from ALL depths, so one pass is enough)
    let folderScanned = 0;
    let folderNew = 0;

    for await (const r of listResourcesByPrefix(topFolder)) {
      if (!r.secure_url) continue;
      folderScanned++;
      totalScanned++;

      // Skip if already in library (by URL or public_id)
      if (existingUrls.has(r.secure_url) || existingIds.has(r.public_id)) continue;

      existingUrls.add(r.secure_url);
      existingIds.add(r.public_id);
      folderNew++;

      const name = (r.public_id ?? "").split("/").pop().replace(/[-_]/g, " ");
      fresh.push({
        id: r.public_id,
        name,
        url: r.secure_url,
        folder: topFolder,
        tags: {},
        elements: [],
        addedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        width:  r.width  ?? null,
        height: r.height ?? null,
        source: "cloudinary-rebuild",
      });

      // Progress tick every 100 images
      if (folderScanned % 100 === 0) {
        process.stdout.write(`\r    Scanned ${folderScanned} · ${folderNew} new          `);
      }

      // Periodic intermediate save every 500 new images (preserve progress on failure)
      if (!DRY_RUN && fresh.length > 0 && fresh.length % 500 === 0) {
        const merged = [...existing, ...fresh];
        await sbSaveLibrary(merged);
        process.stdout.write(`\r    [checkpoint] saved ${merged.length} total            \n`);
      }
    }

    process.stdout.write(`\r    Scanned ${folderScanned} · ${folderNew} new          \n`);
    console.log(`    ✓ "${topFolder}": ${folderScanned} scanned, ${folderNew} new`);
  }

  // 3. Summary
  const skipped = totalScanned - fresh.length;
  sep();
  console.log(`\n📊  Results:`);
  console.log(`    Scanned:          ${totalScanned}`);
  console.log(`    New (to add):     ${fresh.length}`);
  console.log(`    Already existed:  ${skipped}`);

  if (fresh.length === 0) {
    console.log("\n✅  Library is already up to date — nothing to add.");
    return;
  }

  // 4. Merge and save
  const merged = [...existing, ...fresh];
  console.log(`    Total after merge: ${merged.length}`);

  if (DRY_RUN) {
    console.log("\n⚠️   DRY RUN — skipping write. Remove DRY_RUN=1 to apply.");
  } else {
    console.log("\n💾  Saving to Supabase settings table...");
    const approxKB = Math.round(JSON.stringify(merged).length / 1024);
    console.log(`    Payload size: ~${approxKB} KB`);
    await sbSaveLibrary(merged);
    console.log("    Saved ✓");
  }

  sep();
  console.log(
    `\n✅  Library rebuilt: ${fresh.length} images inserted, ` +
    `${skipped} already existed, ${merged.length} total.\n`
  );
  console.log('Next step: open Studio Library → click "🤖 Tag all untagged" to AI-tag the new images.\n');
}

main().catch(e => {
  console.error("\n❌  Fatal:", e.message || e);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Ambria data migration — Upstash Redis (old apps) → Supabase (new app).
//
// One-time, idempotent, re-runnable. Reads the old Redis blobs and routes each key
// to where the NEW app actually reads it:
//   • IMS reads typed TABLES (inventory, functions, vendors, purchase_orders, boxes,
//     overheads, supervisors, users, production_requests, categories, truss_inventory,
//     truss_allocations, event_orders).
//   • Studio reads most blobs via kvGet(<same key>) → the `settings` table (raw passthrough).
//   • IMS settings come from `settings` rows keyed by FRIENDLY names → the old
//     ambria-ims-settings-v1 blob is EXPLODED into per-key rows; mandi/patterns renamed.
//   • A few keys (rate_card, event_orders, truss_allocations) are read BOTH ways → table + raw.
//
// USAGE (PowerShell / bash — set env vars, then run with Node 18+):
//   # source (one or two Upstash REST stores):
//   UPSTASH_REDIS_REST_URL=…  UPSTASH_REDIS_REST_TOKEN=…
//   # optional second store:
//   UPSTASH_REDIS_REST_URL_2=…  UPSTASH_REDIS_REST_TOKEN_2=…
//   # destination:
//   SUPABASE_URL=https://taalribntdkowoqltvqw.supabase.co
//   SUPABASE_SERVICE_KEY=…   (service-role key; anon also works since MVP has no RLS)
//
//   node scripts/migrate.mjs --scan         # list every key + shape + routing (NO writes)
//   node scripts/migrate.mjs --apply --dry-run   # show exactly what WOULD be written
//   node scripts/migrate.mjs --apply        # perform the migration (idempotent upserts)
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";
import { itemToRow } from "../src/lib/inventory/adapter.js";

const MODE = process.argv.includes("--apply") ? "apply" : "scan";
const DRY = process.argv.includes("--dry-run");

// ── Source config (1 or 2 Upstash REST stores) ──
const SOURCES = [
  { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN, label: "src1" },
  { url: process.env.UPSTASH_REDIS_REST_URL_2, token: process.env.UPSTASH_REDIS_REST_TOKEN_2, label: "src2" },
].filter((s) => s.url && s.token);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SOURCES.length) { console.error("✗ No Upstash source configured (set UPSTASH_REDIS_REST_URL + _TOKEN)."); process.exit(1); }
if (MODE === "apply" && (!SUPABASE_URL || !SUPABASE_KEY)) { console.error("✗ SUPABASE_URL + SUPABASE_SERVICE_KEY required for --apply."); process.exit(1); }

// ── Upstash REST helpers ──
async function up(src, path) {
  const r = await fetch(`${src.url}/${path}`, { headers: { Authorization: `Bearer ${src.token}` } });
  if (!r.ok) throw new Error(`Upstash ${src.label} ${path} → ${r.status}`);
  return r.json();
}
async function listKeys(src) { return (await up(src, "keys/*")).result || []; }
async function getVal(src, key) {
  const d = await up(src, `get/${encodeURIComponent(key)}`);
  return d.result ?? null;
}
// Stored values are JSON strings (sometimes double-encoded). Parse defensively.
function parseVal(raw) {
  let v = raw;
  for (let i = 0; i < 2; i++) { if (typeof v === "string") { try { v = JSON.parse(v); } catch { break; } } }
  return v;
}

// ── Row builders (mirror the app's adapters; tables keep a `data` JSONB catch-all) ──
const id = (o, i) => o?.id || o?.code || `mig_${i}`;
const fnToRow = (f) => ({ id: f.id, project_id: f.projectId ?? f.project_id ?? null, name: f.name ?? null, date: f.date ?? null, venue: f.venue ?? null, status: f.status ?? "pending", data: f });
const projectToRow = (p) => ({ id: p.id, name: p.name ?? null, client: p.client ?? null, venue: p.venue ?? null, status: p.status ?? "active", data: p });
const vendorToRow = (v) => ({ id: v.id, name: v.name ?? null, type: v.type ?? null, contact: v.contact ?? null, email: v.email ?? null, data: v });
const purchaseToRow = (p) => ({ id: p.id, vendor_id: p.vendorSnapshot?.vendorId ?? null, amount: p.actualCost ?? p.estimatedCost ?? 0, status: p.status ?? "Pending", items: [], data: p });
const boxToRow = (b) => ({ id: b.id, name: b.label ?? b.name ?? null, items: [], data: b });
const overheadToRow = (o) => ({ id: o.id, name: o.description ?? o.name ?? null, amount: o.amount ?? 0, category: o.category ?? null, data: o });
const supervisorToRow = (s) => ({ id: s.id, name: s.name ?? null, phone: s.phone ?? null, active: s.active ?? true });
const userToRow = (u) => ({ id: u.id, name: u.name ?? null, username: u.username ?? null, password: u.password ?? null, role: u.role ?? "Sales", permissions: u.permissions || [], active: u.active ?? true, phone: u.phone ?? null, email: u.email ?? null, apps: u.apps ?? null });
const prodToRow = (p) => ({ id: p.id, item_id: p.inventoryId ?? null, fn_id: p.functionId ?? null, status: p.status ?? "Requested", data: p });
const eoToRow = (e) => ({ id: e.id, client_name: e.clientName ?? null, event_id: e.eventId ?? null, fn_id: e.fnId ?? null, status: e.status ?? "pending", items: e.items || [], manual_items: e.manualItems || [], decisions: e.decisions || {}, data: e });
const catToRow = (c, i) => (typeof c === "string" ? { id: c, name: c } : { id: c.id || c.name || `cat_${i}`, name: c.name ?? String(c), parent: c.parent ?? null, icon: c.icon ?? null, sort_order: c.sortOrder ?? c.sort_order ?? 0 });
const rcItemToRow = (i) => ({ id: i.id, name: i.name ?? null, cat: i.cat ?? null, sub: i.sub ?? null, unit: i.unit ?? null, inhouse_mode: i.inhouseMode ?? "flat", inhouse_flat: i.inhouseFlat ?? 0, inhouse_s: i.inhouseS ?? 0, inhouse_m: i.inhouseM ?? 0, inhouse_b: i.inhouseB ?? 0, out_s: i.outS ?? 0, out_m: i.outM ?? 0, out_b: i.outB ?? 0, zones: i.zones || [], floral_mode: i.floralMode ?? null, default_real_pct: i.defaultRealPct ?? null, data: i });

// ── Registry: exact old key → routing ──
// action: table | raw | rename | explode | trussInv | trussAlloc | tableAndRaw | skip
const REG = {
  // IMS → tables
  "ambria-ims-inventory-v1": { action: "table", table: "inventory", row: (o) => itemToRow(o) },
  "ambria-ims-functions-v1": { action: "table", table: "functions", row: fnToRow },
  "ambria-ims-projects-v1": { action: "table", table: "projects", row: projectToRow },
  "ambria-ims-vendors-v1": { action: "table", table: "vendors", row: vendorToRow },
  "ambria-ims-purchase-v1": { action: "table", table: "purchase_orders", row: purchaseToRow },
  "ambria-ims-boxes-v1": { action: "table", table: "boxes", row: boxToRow },
  "ambria-ims-overheads-v1": { action: "table", table: "overheads", row: overheadToRow },
  "ambria-ims-supervisors-v1": { action: "table", table: "supervisors", row: supervisorToRow },
  "ambria-ims-team-v1": { action: "table", table: "users", row: userToRow },
  "ambria-ims-prodreq-v1": { action: "table", table: "production_requests", row: prodToRow },
  "ambria-ims-categories-v1": { action: "table", table: "categories", row: catToRow },
  "ambria-ims-truss-inventory-v1": { action: "trussInv" },
  // Read both ways (table for IMS + raw settings key for Studio kvGet)
  "ambria-ratecard-v4": { action: "tableAndRaw", table: "rate_card", row: rcItemToRow },
  "ambria-eventorders-v1": { action: "tableAndRaw", table: "event_orders", row: eoToRow },
  "ambria-ims-truss-allocations-v1": { action: "trussAlloc" },
  // IMS settings blob → explode into friendly-key rows (+ keep raw for Studio's read-only ref)
  "ambria-ims-settings-v1": { action: "explode" },
  // mandi / patterns → friendly settings keys IMS reads
  "ambria-ims-mandi-v1": { action: "rename", to: "mandiCatalogue" },
  "ambria-ims-flower-patterns-v1": { action: "rename", to: "flowerPatterns" },
  // Skip — caches / migration flags / backups / session / re-synced externally
  "ambria-ims-auth": { action: "skip" },
  "ambria-yt-cache-v1": { action: "skip" },
  "ambria-pin-cache-v1": { action: "skip" },
  "ambria-ims-studio-cache-v1": { action: "skip" },
  "ambria-ims-lms-contracts-v1": { action: "skip" }, // re-synced via the lms Edge Function
  "ambria-ims-lms-sync-meta-v1": { action: "skip" },
};
// Everything else → raw settings passthrough (Studio kvGet reads by exact key:
// ambria-v13, -venues, rccats, transport, templates, zonedefs, taxonomy, library,
// team(studio), premia, notifications, yt-tags, clients, datetypes, pimap, scanhist,
// manual/hidden videos, filter-priority, palette, floral-hardprop, dc-counter/cache,
// soft-holds, blocks, truss overrides/sims/audit, studio-lms-cache, …).
// Auto-skip: migration flags, safety backups, per-key snapshots, daily audit logs
// (NOT truss-audit-v1, which the Truss tab reads), and the legacy v3 rate card.
const SKIP_RE = /(migrated|backup|tier\d+|p3-backfilled|snap-prev|ratecard-v3|-audit-\d{4}-\d{2}-\d{2})/i;
// settings keys owned by a dedicated rename — explode must not overwrite them.
const RENAME_TARGETS = new Set(["mandiCatalogue", "flowerPatterns"]);

function classify(key) {
  if (REG[key]) return REG[key];
  if (SKIP_RE.test(key)) return { action: "skip", reason: "flag/backup" };
  return { action: "raw" };
}

function shape(v) {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === "object") return `object{${Object.keys(v).slice(0, 6).join(",")}${Object.keys(v).length > 6 ? ",…" : ""}}`;
  return typeof v + (typeof v === "string" ? `(${v.length})` : "");
}

// ── Gather all keys from all sources ──
async function gather() {
  const map = new Map(); // key → { raw, parsed, sources:[] }
  for (const src of SOURCES) {
    const keys = await listKeys(src);
    console.log(`• ${src.label}: ${keys.length} keys`);
    for (const key of keys) {
      const raw = await getVal(src, key);
      if (!map.has(key)) map.set(key, { raw, parsed: parseVal(raw), sources: [] });
      map.get(key).sources.push(src.label);
    }
  }
  return map;
}

const sb = MODE === "apply" ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }) : null;
async function upsertChunked(table, rows, conflict) {
  if (DRY) return { count: rows.length, dry: true };
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    done += rows.slice(i, i + 500).length;
  }
  return { count: done };
}

async function run() {
  console.log(`\n=== Ambria migration · mode=${MODE}${DRY ? " (dry-run)" : ""} · ${SOURCES.length} source(s) ===\n`);
  const map = await gather();
  console.log(`\nTotal distinct keys: ${map.size}\n`);

  const plan = { table: {}, raw: 0, rename: 0, explode: 0, trussInv: 0, trussAlloc: 0, skip: 0, empty: 0 };
  const settingsRows = [];
  const tableRows = {}; // table → rows[]

  for (const [key, { parsed, sources }] of [...map.entries()].sort()) {
    const r = classify(key);
    const tag = r.action + (r.table ? `:${r.table}` : r.to ? `:${r.to}` : r.reason ? `(${r.reason})` : "");
    if (MODE === "scan") console.log(`  ${key}  [${sources.join("+")}]  ${shape(parsed)}  →  ${tag}`);
    if (parsed == null) { plan.empty++; continue; }

    if (r.action === "skip") { plan.skip++; continue; }
    if (r.action === "raw") { settingsRows.push({ key, value: parsed }); plan.raw++; continue; }
    if (r.action === "rename") { settingsRows.push({ key: r.to, value: parsed }); plan.rename++; continue; }
    if (r.action === "explode") {
      settingsRows.push({ key, value: parsed }); // keep raw blob for Studio's read-only ref
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, val] of Object.entries(parsed)) {
          if (k.startsWith("_") || k.startsWith("ambria-") || RENAME_TARGETS.has(k)) continue;
          settingsRows.push({ key: k, value: val });
        }
      }
      plan.explode++; continue;
    }
    if (r.action === "trussInv") {
      tableRows.truss_inventory = [{ key: "main", data: parsed }]; plan.trussInv++; continue;
    }
    if (r.action === "trussAlloc") {
      settingsRows.push({ key, value: parsed }); // raw for Studio kvGet
      const rows = Object.entries(parsed || {}).map(([date, entry]) => {
        const { events, date: _d, ...pool } = entry || {};
        return { date, events: events || [], pool };
      });
      tableRows.truss_allocations = (tableRows.truss_allocations || []).concat(rows);
      plan.trussAlloc++; continue;
    }
    if (r.action === "table" || r.action === "tableAndRaw") {
      const arr = Array.isArray(parsed) ? parsed : [];
      const rows = arr.map((o, i) => { const row = r.row(o, i); if (!row.id) row.id = id(o, i); return row; });
      tableRows[r.table] = (tableRows[r.table] || []).concat(rows);
      plan.table[r.table] = (plan.table[r.table] || 0) + rows.length;
      if (r.action === "tableAndRaw") { settingsRows.push({ key, value: parsed }); plan.raw++; }
      continue;
    }
  }

  console.log(`\n── Plan ──`);
  console.log(`  settings rows: ${settingsRows.length}  (raw ${plan.raw} · rename ${plan.rename} · explode-groups ${plan.explode})`);
  for (const [t, c] of Object.entries(plan.table)) console.log(`  table ${t}: ${c} rows`);
  if (plan.trussInv) console.log(`  truss_inventory: 1 row`);
  if (tableRows.truss_allocations) console.log(`  truss_allocations: ${tableRows.truss_allocations.length} rows`);
  console.log(`  skipped: ${plan.skip} · empty/null: ${plan.empty}`);

  if (MODE === "scan") { console.log(`\n(scan only — no writes. Re-run with --apply --dry-run, then --apply.)\n`); return; }

  console.log(`\n── ${DRY ? "Would write" : "Writing"} ──`);
  const conflicts = { inventory: "id", functions: "id", projects: "id", vendors: "id", purchase_orders: "id", boxes: "id", overheads: "id", supervisors: "id", users: "id", production_requests: "id", categories: "id", rate_card: "id", event_orders: "id", truss_inventory: "key", truss_allocations: "date" };
  for (const [table, rows] of Object.entries(tableRows)) {
    if (!rows.length) continue;
    // de-dupe by conflict key (last wins)
    const ck = conflicts[table];
    const uniq = [...new Map(rows.map((r) => [r[ck], r])).values()];
    const res = await upsertChunked(table, uniq, ck);
    console.log(`  ${table}: ${res.count}${res.dry ? " (dry)" : ""}`);
  }
  if (settingsRows.length) {
    const uniq = [...new Map(settingsRows.map((r) => [r.key, r])).values()];
    const res = await upsertChunked("settings", uniq, "key");
    console.log(`  settings: ${res.count}${res.dry ? " (dry)" : ""}`);
  }
  console.log(`\n✓ ${DRY ? "Dry-run complete (no writes)." : "Migration complete."}\n`);
}

run().catch((e) => { console.error("\n✗ MIGRATION FAILED:", e.message, "\n"); process.exit(1); });

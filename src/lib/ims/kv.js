// Key-value shim — faithful stand-in for the reference app's Redis (`/api/data`) KV.
// The reference stored truss overrides / simulations / audit (and other blobs) under
// string keys in Upstash Redis via `kvGet(key)` / `reliableSave(key, json, label)`.
// In this Supabase build those keys live in the existing `settings` (key→value JSONB)
// table — the same blob-in-settings pattern already used for mandiCatalogue etc.
//
// reliableSave receives a JSON *string* (the reference always JSON.stringify's before
// saving) and kvGet returns it back as-is; callers JSON.parse defensively. We preserve
// that contract exactly so transcribed code is unchanged.
import { supabase } from "../supabase";

// ── LOAD-FAILURE TRACKING (owner report 2026-11-05) ──────────────────────────
// kvGet/kvTryGet collapse a genuine read FAILURE (network/Supabase error) and a genuine "this key
// has no row yet" into the same `null`/`missing:true` shape, by design (see kvTryGet's own comment —
// callers want one simple default-on-either case for ordinary reads). But several callers then use
// that same silent fallback as the baseline for a LATER save of the key's whole value (taxonomy,
// team, transport settings, palette catalogue, rate-card seeding) — if the read actually failed, the
// save writes the hardcoded default straight over whatever was really stored, same failure class as
// the truss_inventory incident this closes (confirmed live: a failed fetch left `trussInv` at its
// placeholder with the page looking otherwise normal, and the next unrelated edit upserted that
// placeholder over 24/9/14 rows of real fabric-stock data). kvLoadFailed lets a save path refuse
// instead of guessing. "Ever read successfully THIS SESSION" counts as loaded even if a later
// re-read (e.g. a realtime refresh) happens to fail — only a key that has NEVER once loaded
// successfully stays blocked.
const readOk = new Set();
const readFailed = new Map();
const noteReadResult = (key, ok, error) => {
  if (ok) { readOk.add(key); readFailed.delete(key); }
  else readFailed.set(key, error || "Read failed");
};
export const kvLoadFailed = (key) => readFailed.has(key) && !readOk.has(key);

export const kvGet = async (key) => {
  try {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) { noteReadResult(key, false, error.message); return null; }
    noteReadResult(key, true);
    if (!data) return null;
    return data.value ?? null;
  } catch (e) {
    noteReadResult(key, false, e?.message || "Network error");
    return null;
  }
};

// Same read, but it tells you WHY there is no value: `ok:false` means the read itself failed,
// `ok:true, missing:true` means the row genuinely isn't there yet.
//
// kvGet collapses both cases to null. That is fine for load-time defaults, but it is unsafe for
// read-modify-write on a shared blob: a failed read looks identical to an empty store, so merging
// your change onto "nothing" and saving destroys everything that was already in there. That is
// exactly how a day of video tagging (249 verifications) was lost on 30 Jul 2026. Any caller doing
// read-merge-write on shared data should use this and abort when `ok` is false.
export const kvTryGet = async (key) => {
  try {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) { noteReadResult(key, false, error.message); return { ok: false, error: error.message || "Read failed" }; }
    noteReadResult(key, true);
    return { ok: true, missing: !data, value: data ? (data.value ?? null) : null };
  } catch (e) {
    noteReadResult(key, false, e?.message || "Network error");
    return { ok: false, error: e?.message || "Network error" };
  }
};

export const kvSet = async (key, value) => {
  if (kvLoadFailed(key)) return { ok: false, error: `"${key}" didn't load this session — saving now could overwrite the real data with defaults. Reload and try again.`, blocked: true };
  try {
    const { error } = await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "Network error" };
  }
};

// Mirrors the reference reliableSave return shape (ok/key/label/size/error/ts). The
// payload is stored verbatim (a JSON string) under the key.
export const reliableSave = async (key, json, label) => {
  const result = { ok: false, key, label: label || key, size: typeof json === "string" ? json.length : 0, error: null, ts: Date.now() };
  if (typeof json !== "string" || !json.length) {
    result.error = "Empty payload (refused to save)";
    return result;
  }
  if (kvLoadFailed(key)) {
    result.error = `"${result.label}" didn't load this session — saving now could overwrite the real data with defaults. Reload and try again.`;
    result.blocked = true;
    return result;
  }
  try {
    const { error } = await supabase.from("settings").upsert({ key, value: json }, { onConflict: "key" });
    if (error) { result.error = error.message; return result; }
    result.ok = true;
    return result;
  } catch (e) {
    result.error = e?.message || "Network error";
    return result;
  }
};

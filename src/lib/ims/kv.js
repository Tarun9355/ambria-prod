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

export const kvGet = async (key) => {
  try {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error || !data) return null;
    return data.value ?? null;
  } catch {
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
    if (error) return { ok: false, error: error.message || "Read failed" };
    return { ok: true, missing: !data, value: data ? (data.value ?? null) : null };
  } catch (e) {
    return { ok: false, error: e?.message || "Network error" };
  }
};

export const kvSet = async (key, value) => {
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

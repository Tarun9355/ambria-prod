// A settings row ({ by, at }) used as a cheap mutual-exclusion lock between however many IMS tabs happen
// to be open at once - moved out of AutoPlanningSync.jsx's own takeSweepLock so a second background job
// (the fabric auto-purchase scan, lib/ims/fabricAutoPurchase.js) can use the exact same mechanism under
// its own key, without the two stepping on each other (each key is its own row). Behaviour is unchanged
// from the original: a lock is free if nobody holds it, or the holder's lock has expired; taking it writes
// this tab's id, waits briefly for any other tab writing at the same instant to also land, then re-reads -
// whoever's write landed last holds it.
import { supabase } from "../supabase";

const parseLock = (v) => {
  let x = v;
  for (let i = 0; i < 2; i++) { if (typeof x === "string") { try { x = JSON.parse(x); } catch { return null; } } }
  return x && typeof x === "object" ? x : null;
};

export async function takeSettingsLock(key, lockMs, tabId) {
  const read = async () => {
    const { data, error } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return parseLock(data?.value);
  };
  const cur = await read();
  if (cur && cur.by !== tabId && Date.now() - Number(cur.at || 0) < lockMs) return false;
  const { error } = await supabase.from("settings").upsert({ key, value: JSON.stringify({ by: tabId, at: Date.now() }) }, { onConflict: "key" });
  if (error) return false;
  await new Promise((r) => setTimeout(r, 1500)); // another tab writing at the same moment: whoever's write landed last holds it
  const after = await read();
  return after?.by === tabId;
}

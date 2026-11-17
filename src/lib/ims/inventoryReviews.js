import { useCallback, useEffect, useState } from "react";
import { supabase, subscribeTable } from "../supabase";

// IMS Inventory "New / edited" list (owner ask 2026-11-17): an item someone added or edited stays listed until an admin has
// cross-checked it; edited again after that check, it comes back. The check is stored per item in `inventory_reviews`
// (migration 069) as the item version (inventory.updated_at) that was checked.

// Changes before this went live are not listed - the 1,200+ existing items were never "new" to anyone.
export const REVIEW_SINCE = Date.parse("2026-11-17T00:00:00+05:30");

const ts = (v) => { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : 0; };

// The item's latest change: its updated_at (moves on every save - trigger, 001), else when it was created.
export const lastChangeAt = (item) => Math.max(ts(item?.updatedAt), ts(item?.createdAt));

// Added (never edited since) vs edited - a save within a minute of creating it still counts as the add.
export const changeKind = (item) => (ts(item?.updatedAt) - ts(item?.createdAt) > 60000 ? "Edited" : "Added");

// reviews: { [itemId]: { reviewedVersion, reviewedBy } }
export function needsCheck(item, reviews) {
  const at = lastChangeAt(item);
  if (!at || at < REVIEW_SINCE) return false;
  const r = reviews?.[item.id];
  return !r || ts(r.reviewedVersion) < at;
}

// Only an Admin clears an item from the list.
export const canCheckInventory = (user) => user?.role === "Admin" || user?.id === "u_admin";

// Every check, 1000 rows a page, ordered by its own key (fetchAll pages by an "id" column this table does not have).
async function loadAllReviews() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("inventory_reviews").select("*").order("item_id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

const rowToReview = (row) => ({ reviewedVersion: row.reviewed_version, reviewedBy: row.reviewed_by || "", reviewedAt: row.reviewed_at });

// Loads the checks and keeps them live. ready=false while loading or when the table is missing (069 not run yet): the
// list is then simply not offered, nothing else on the Inventory tab changes.
export function useInventoryReviews() {
  const [reviews, setReviews] = useState({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => loadAllReviews()
      .then((rows) => { if (!alive) return; const m = {}; (rows || []).forEach((r) => { m[r.item_id] = rowToReview(r); }); setReviews(m); setReady(true); })
      .catch(() => { if (alive) setReady(false); });
    load();
    const ch = subscribeTable("inventory_reviews", (payload) => {
      if (!alive) return;
      if (payload.eventType === "DELETE") { const id = payload.old?.item_id; if (id) setReviews((m) => { const n = { ...m }; delete n[id]; return n; }); return; }
      const row = payload.new;
      if (row?.item_id) setReviews((m) => ({ ...m, [row.item_id]: rowToReview(row) }));
    });
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);

  // Marks the item's CURRENT version checked. Optimistic; a failed write puts the item back and says so.
  const markChecked = useCallback(async (item, by) => {
    const version = new Date(lastChangeAt(item)).toISOString();
    let before;
    setReviews((m) => { before = m[item.id]; return { ...m, [item.id]: { reviewedVersion: version, reviewedBy: by || "", reviewedAt: new Date().toISOString() } }; });
    const { error } = await supabase.from("inventory_reviews").upsert({ item_id: item.id, reviewed_version: version, reviewed_by: by || null, reviewed_at: new Date().toISOString() }, { onConflict: "item_id" });
    if (error) {
      setReviews((m) => { const n = { ...m }; if (before) n[item.id] = before; else delete n[item.id]; return n; });
      return error.message || "save failed";
    }
    return null;
  }, []);

  return { reviews, ready, markChecked };
}

// "Rows of a planning input changed here" - inventory items, flower recipes, mandi flowers, fixed venues. Saved in this tab,
// announced in this tab: IMS's automatic planning sync (pages/ims/AutoPlanningSync.jsx) listens and re-syncs the booked deals
// that use those rows, so a change reaches every deal's Planning without anyone pressing Sync (owner ask 2026-11-11).
// Only the tab that made the change announces it - every other open IMS tab gets the rows by realtime but syncs nothing, so
// one edit runs one sync, not one per open screen.
export const PLANNING_INPUT_EVENT = "ambria:planning-input";
const TABLES = new Set(["inventory", "flower_patterns", "mandi_flowers", "fixed_venues"]);

export function notePlanningInputChange(table, ids) {
  if (!TABLES.has(table) || typeof window === "undefined") return;
  const list = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null && x !== "").map(String);
  if (!list.length) return;
  try { window.dispatchEvent(new CustomEvent(PLANNING_INPUT_EVENT, { detail: { table, ids: list } })); } catch { /* no window events */ }
}

export function onPlanningInputChange(cb) {
  if (typeof window === "undefined") return () => {};
  const h = (e) => { if (e?.detail) cb(e.detail); };
  window.addEventListener(PLANNING_INPUT_EVENT, h);
  return () => window.removeEventListener(PLANNING_INPUT_EVENT, h);
}

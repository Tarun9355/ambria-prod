// Category → department classifier, shared by every screen that needs to attribute a rate-card
// or inventory category to one of the 7 ops departments (Studio's Dept-Income snapshot in
// DealCheckOverlay.jsx, IMS's DepartmentOpsTab.jsx, and the sold-deal change log in StudioApp.jsx's
// reconcileSoldInventoryBlocks). Previously reimplemented near-verbatim in each of the first two —
// consolidated here so a keyword tweak or a new department can't update one copy and silently drift
// from the other.
export const DEPTS = ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric"];

// `categoryDepartmentsCfg` is the admin-editable override map (IMS → Settings → Departments),
// keyed by lowercased category/sub-category string → department name. Keyword matching is the
// fallback for anything not explicitly configured.
export function catToDept(cat, categoryDepartmentsCfg) {
  const cfg = categoryDepartmentsCfg || {};
  const s = String(cat || "").toLowerCase().trim();
  if (!s) return "Structure";
  if (cfg[s] && DEPTS.includes(cfg[s])) return cfg[s];
  if (s.includes("floral") || s.includes("flower")) return "Floral";
  if (s.includes("light") || s.includes("chandel") || s.includes("led")) return "Lighting";
  if (s.includes("truss")) return "Tenting";
  if (s.includes("mask") || s.includes("fabric") || s.includes("drap") || s.includes("ceiling") || s.includes("liza") || s.includes("curtain")) return "Fabric";
  if (s.includes("platform") || s.includes("carpet") || s.includes("tent")) return "Tenting";
  if (s.includes("transport") || s.includes("truck") || s.includes("logistic")) return "Transport";
  if (s.includes("furnitur") || s.includes("sofa") || s.includes("chair") || s.includes("couch")) return "Furniture";
  if (s.includes("arch") || s.includes("prop") || s.includes("wrought") || s.includes("glass") || s.includes("struct") || s.includes("pillar") || s.includes("stage")) return "Structure";
  return "Structure"; // catch-all
}

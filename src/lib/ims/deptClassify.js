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
  // "pedestal" is here because a pedestal is floral kit — it carries the arrangement, and the floral
  // team owns it. Neither "pedestal" nor "pedestals" contained any stem below, so it fell all the way
  // through to the Structure catch-all on line 25 and the Deal Check → Transport tab filed 6 Mosaic
  // Pedestals under 🏛️ Structure. It was never classified AS Structure; it was simply unclassified.
  // Singular stem on purpose, so it catches the sub-category "Pedestals" and a category "Pedestal"
  // alike. NOTE this classifier is shared — Dept Income (Deal Check) and Dept Ops (IMS) read it too,
  // so pedestal income is now attributed to Floral rather than Structure. That is the intended
  // outcome, but it does move a figure between departments in reporting, not just a heading.
  if (s.includes("floral") || s.includes("flower") || s.includes("pedestal")) return "Floral";
  if (s.includes("light") || s.includes("chandel") || s.includes("led")) return "Lighting";
  if (s.includes("truss")) return "Tenting";
  if (s.includes("mask") || s.includes("fabric") || s.includes("drap") || s.includes("ceiling") || s.includes("liza") || s.includes("curtain")) return "Fabric";
  if (s.includes("platform") || s.includes("carpet") || s.includes("tent")) return "Tenting";
  if (s.includes("transport") || s.includes("truck") || s.includes("logistic")) return "Transport";
  if (s.includes("furnitur") || s.includes("sofa") || s.includes("chair") || s.includes("couch")) return "Furniture";
  if (s.includes("arch") || s.includes("prop") || s.includes("wrought") || s.includes("glass") || s.includes("struct") || s.includes("pillar") || s.includes("stage")) return "Structure";
  return "Structure"; // catch-all
}

// The department a keyword (or the admin map) gives `cat`, or null when only the Structure catch-all would - so a caller can
// fall back to something better than the catch-all.
export function catToDeptStrict(cat, categoryDepartmentsCfg) {
  const s = String(cat || "").toLowerCase().trim();
  if (!s) return null;
  const cfg = categoryDepartmentsCfg || {};
  if (cfg[s] && DEPTS.includes(cfg[s])) return cfg[s];
  const KW = /floral|flower|pedestal|light|chandel|led|truss|mask|fabric|drap|ceiling|liza|curtain|platform|carpet|tent|transport|truck|logistic|furnitur|sofa|chair|couch|arch|prop|wrought|glass|struct|pillar|stage/;
  return KW.test(s) ? catToDept(s, cfg) : null;
}

// A SUB-category's department, as IMS → Settings → Departments says ("a sub-category inherits its category's department"):
// its own map entry, else its own keyword (Carpet -> Tenting, Sofa -> Furniture), else the department of the category its
// items are filed under (`catHint`, else the commonest category of the inventory items carrying it), else Structure. Labours
// used the sub-category's keyword alone, so one with no keyword ("Console Table") fell to the Structure catch-all whatever its
// category (owner report 2026-11-11: Cabinets Console, a Floral item, counted in Structure's crew).
export function makeSubcatDept(inventory, categoryDepartmentsCfg) {
  const catsBySub = new Map(); // sub -> Map(cat -> count)
  (inventory || []).forEach((it) => {
    const sub = String(it?.subCat || it?.subcategory || "").toLowerCase().trim();
    const cat = String(it?.cat || it?.category || "").trim();
    if (!sub || !cat) return;
    const m = catsBySub.get(sub) || new Map();
    m.set(cat, (m.get(cat) || 0) + 1);
    catsBySub.set(sub, m);
  });
  const commonCat = (sub) => { const m = catsBySub.get(sub); if (!m) return ""; let best = "", n = -1; m.forEach((c, k) => { if (c > n) { n = c; best = k; } }); return best; };
  return (sub, catHint) => {
    const s = String(sub || "").toLowerCase().trim();
    return catToDeptStrict(s, categoryDepartmentsCfg) || catToDept(catHint || commonCat(s), categoryDepartmentsCfg);
  };
}

// Owner ask (2026-10-27, widened 2026-11-07): every department except Floral is now run as one
// crew pool under Structure — Furniture+Fabric+Tenting+Lighting+Transport's shared Labours crew no
// longer splits separately per department, it pools entirely into Structure's. (Originally this
// only paired Furniture->Structure and Fabric->Tenting, run by the same two people respectively;
// the owner then asked to fold every remaining non-Floral department into that single Structure
// pool too.) Applied ONLY where Labours usage gets attributed to a department
// (DealCheckOverlay.jsx's per-function usage split, DepartmentOpsTab.jsx's heavy-item filter,
// manpowerCount.js's per-function department split) — an item's own direct income (rental,
// production, buying) still uses plain catToDept, unpooled, so every department keeps tracking its
// own inventory/income; only the shared Labours CREW figure pools.
export function poolLabourDept(d) {
  return d === "Floral" ? d : "Structure";
}
// Display label for a department that may be carrying every pooled partner's share too —
// "Structure" lists every department folded into it; Floral (never pooled) is unchanged.
export function poolLabourDeptLabel(d) {
  return d === "Structure" ? "Structure, Furniture, Tenting, Fabric, Lighting & Transport" : d;
}

// ═══ USER → DEPARTMENT ACCESS ═══
// Which of the 7 departments a user may see, for screens that gate VISIBILITY (Inventory,
// Production, Dept Ops) rather than just report a figure by department. `null` means
// unrestricted — sees every department, same as every user does today before this existed.
//
// `user.departments` (an explicit array, set in IMS -> Admin -> Users & Roles) wins when present.
// Absent — every user that existed before this field did — falls back to the exact inference
// Dept Ops already used: does the role NAME contain one of the 7 department names (e.g. "Dept
// Head - Lighting" -> Lighting). No match (Admin, Sales, Purchase Manager, a role like "Dept
// Head - Painter" that doesn't name one of the 7, ...) -> unrestricted, exactly like today.
export function userDepartments(authUser) {
  if (Array.isArray(authUser?.departments) && authUser.departments.length) return authUser.departments;
  const r = String(authUser?.role || "").toLowerCase();
  const inferred = DEPTS.find((d) => r.includes(d.toLowerCase()));
  return inferred ? [inferred] : null;
}

// True if this user may see `dept` — Admin always can; anyone unrestricted (userDepartments ===
// null) always can; otherwise only if `dept` is one of their assigned departments. `dept` itself
// being falsy (nothing to attribute yet) never hides a row — that's a data gap, not an access
// decision, so it defaults to visible rather than disappearing.
export function canSeeDept(authUser, dept) {
  if (!dept) return true;
  if (authUser?.role === "Admin" || authUser?.id === "u_admin") return true;
  const allowed = userDepartments(authUser);
  return !allowed || allowed.includes(dept);
}

// Supply -> Production tags each request with its OWN department vocabulary (PROD_DEPTS, lib/ims/
// constants.js) — a third, independently-drifted spelling of the same 7-ish departments ("Floral"/
// "Structural"/"Painter & Production"/"Props"/"Other" vs. DEPTS' "Floral"/"Structure"/...). Maps a
// PROD_DEPTS value onto the canonical DEPTS name canSeeDept expects; null for the ones with no
// real equivalent (Painter & Production, Other) — those stay visible to everyone rather than
// guessing an owner for them.
const PROD_DEPT_TO_CANON = {
  Floral: "Floral",
  Fabric: "Fabric",
  Structural: "Structure",
  Lighting: "Lighting",
  Furniture: "Furniture",
  Props: "Structure",
  "Painter & Production": null,
  Other: null,
};
// The Planning → Dept Ops view a production request belongs in: its ops department, and "Painter & Production" in the
// 🎨 Paint view. "Other" has no department, so it is in none.
export function prodDeptToOpsDept(prodDept) {
  if (prodDept === "Painter & Production") return "Paint";
  return PROD_DEPT_TO_CANON[prodDept] ?? null;
}
export function canSeeProdDept(authUser, prodDept) {
  return canSeeDept(authUser, PROD_DEPT_TO_CANON[prodDept] ?? null);
}

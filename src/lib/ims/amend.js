// ═══════════════════════════════════════════════════════════════════════════
// LAST-MINUTE AMENDMENT APPROVALS — shared logic (Studio + IMS).
//
// Policy: once a deal is SOLD/blocked, adding more inventory or manpower within
// 7 days of the function date is a "last-minute" request. It must be approved by
// the relevant DEPARTMENT HEAD before the items/manpower are blocked:
//   • Truss, fabric (Bangali), structure manpower   → STRUCTURE head
//   • Flowerist, flowers, floral                     → FLORAL head
// Heads are designated by ROLE (configured in IMS Users). Requests live in the
// `settings` table under AMEND_SK so both apps + Realtime stay in sync.
// ═══════════════════════════════════════════════════════════════════════════

export const AMEND_SK = "ambria-amend-requests-v1";
export const AMEND_GATE_DAYS = 7;

export const DEPTS = {
  structure: { id: "structure", label: "Structure", icon: "🏗️" },
  floral: { id: "floral", label: "Floral", icon: "🌸" },
};

// Days from today (local midnight) until the function date. Negative = past.
export function daysUntil(fnDate) {
  if (!fnDate) return Infinity;
  try {
    const d = new Date(fnDate + "T00:00:00");
    if (isNaN(d.getTime())) return Infinity;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  } catch { return Infinity; }
}

// True when the function is inside the approval window (today … +7 days).
// Past-dated functions are also treated as last-minute (can't plan retroactively).
export function isLastMinute(fnDate) {
  const d = daysUntil(fnDate);
  return d < AMEND_GATE_DAYS;
}

// Map an item/line to the owning department. Accepts a loose descriptor with any
// of: kind ("truss"|"fabric"|"manpower"|"flowerist"|"flowers"|"floral"),
// category / subCategory / name strings. Defaults to "structure" when unsure
// (structure owns the physical build; floral is the narrower, name-detectable set).
export function departmentForItem(it = {}) {
  const hay = [it.kind, it.category, it.cat, it.subCategory, it.subCat, it.dept, it.name]
    .filter(Boolean).join(" ").toLowerCase();
  const FLORAL = /\b(flower|floral|flowerist|reet|garland|mandi|petal|marigold|rose|orchid|bloom)\b/;
  if (FLORAL.test(hay)) return "floral";
  // everything else physical → structure (truss, fabric/bangali, masking, platform,
  // carpet, lighting, furniture, props, structure manpower, etc.)
  return "structure";
}

// Does a role string designate the head of `dept`? Robust to naming like
// "Dept Head Flower", "Flower Department Head", "Structure Head", "Head - Structure".
export function roleIsDeptHead(role, dept) {
  const r = (role || "").toLowerCase();
  if (!r.includes("head")) return false;
  if (dept === "floral") return /flower|floral/.test(r);
  if (dept === "structure") return /structure|truss|fabric/.test(r);
  return false;
}

// Departments this user heads (by role), e.g. ["structure"] or ["floral","structure"].
export function deptsHeadedBy(role) {
  return Object.keys(DEPTS).filter((d) => roleIsDeptHead(role, d));
}

// Is this user allowed to act on the Approvals panel? Heads (any dept) + Admin.
export function canApprove(user) {
  if (!user) return false;
  if ((user.role || "").toLowerCase() === "admin" || user.id === "u_admin") return true;
  return deptsHeadedBy(user.role).length > 0;
}

// Build a fresh pending request. `items` = [{ name, qty, unit?, kind?, category? }].
export function makeAmendRequest({ eventOrderId, clientId, clientName, fnIdx, fnDate, department, items, reason, requestedBy }) {
  return {
    id: "amd_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    eventOrderId: eventOrderId || null,
    clientId: clientId || null,
    clientName: clientName || "",
    fnIdx: fnIdx ?? 0,
    fnDate: fnDate || "",
    department,
    items: Array.isArray(items) ? items : [],
    reason: reason || "",
    requestedBy: requestedBy || "",
    requestedAt: Date.now(),
    status: "pending", // pending | approved | rejected
    decidedBy: "",
    decidedAt: 0,
    decisionNote: "",
  };
}

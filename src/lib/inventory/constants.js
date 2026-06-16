// ─── Inventory constants (faithful to reference IMS app) ──────────────────────
export const INV_CATS = ["Floral", "Lighting", "Fabric", "Props", "Stage", "Furniture", "Structural", "Consumable"];
export const INV_LOCATIONS = ["Production House", "Ambria Pushpanjali", "Ambria Exotica", "Ambria Manaktala", "Ambria Cafe"];
export const DEPTS = ["Fabric", "Structure", "Furniture", "Light", "Painter & Production", "Flower", "Props", "Other"];
export const INV_TYPES = ["All", "Budgeted", "Premium", "In-house"];

export const PRICING_CAT_STYLES = {
  heavy_saya: "bg-red-100 text-red-700 border-red-200",
  competition: "bg-yellow-100 text-yellow-700 border-yellow-200",
  non_saya: "bg-green-100 text-green-700 border-green-200",
};

// Sentinel for the "Other (custom)" sub-category picker.
export const SUBCAT_OTHER = "__other__";

// Categories/sub-cats for which a paint-override panel is shown (case-insensitive substring match).
export const PAINT_TOKENS = ["truss", "struct", "mask", "platform", "carpet", "furniture", "arch", "prop", "panel", "pillar", "glass", "stage", "wrought", "consumable"];

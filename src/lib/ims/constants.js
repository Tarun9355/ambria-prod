// Shared IMS constants (non-inventory). Faithful to the reference app.
export const ROLES = ["Admin", "Sales", "Production", "Logistics", "Dept Head - Floral", "Dept Head - Fabric", "Dept Head - Lighting", "Dept Head - Painter", "Dept Head - Furniture", "Flower Head", "Purchase Manager", "Site Supervisor"];
export const PERM_GROUPS = {
  "Inventory": ["inv_view", "inv_add", "inv_delete", "inv_import", "inv_categories", "inv_images"],
  "Blocking": ["block_single", "block_bulk", "block_release"],
  "Events": ["events_create", "events_edit", "events_manpower", "events_view"],
  "Boxes & Logistics": ["box_manage", "box_status", "box_scan", "box_challan"],
  "Reports": ["reports_generate"],
  "Purchase": ["purchase_request", "purchase_approve", "purchase_add"],
  "Admin": ["admin_users"],
  "Production": ["prod_tasks", "prod_update", "prod_addinv"],
};
export const PERM_LABELS = {
  inv_view: "View Inventory", inv_add: "Add / Edit Items", inv_delete: "Delete Items",
  inv_import: "Import Excel", inv_categories: "Manage Categories", inv_images: "Upload Images",
  block_single: "Block Items", block_bulk: "Bulk Block", block_release: "Release Items",
  events_create: "Create Events", events_edit: "Edit / Delete Events",
  events_manpower: "Manage Manpower", events_view: "View Events",
  box_manage: "Create / Edit Boxes", box_status: "Update Status", box_scan: "Scan Box", box_challan: "Generate Challans",
  reports_generate: "Generate Reports",
  purchase_request: "Create Requests", purchase_approve: "Approve / Reject", purchase_add: "Add to Inventory",
  admin_users: "Manage Users & Permissions",
  prod_tasks: "View Build Tasks", prod_update: "Update Task Status", prod_addinv: "Add to Inventory",
};
export const ROLE_DEFAULTS = {
  Admin: Object.values(PERM_GROUPS).flat(),
  Sales: ["inv_view", "block_single", "block_bulk", "block_release", "events_create", "events_edit", "events_view", "reports_generate", "purchase_request"],
  Production: ["inv_view", "inv_add", "inv_images", "events_view", "purchase_request", "prod_tasks", "prod_update", "prod_addinv"],
  Logistics: ["inv_view", "box_manage", "box_status", "box_scan", "box_challan", "events_view"],
  "Dept Head - Floral": ["inv_view", "inv_add", "inv_images", "events_view", "events_manpower", "purchase_request", "purchase_approve", "prod_tasks", "prod_update", "reports_generate"],
  "Dept Head - Fabric": ["inv_view", "inv_add", "inv_images", "events_view", "events_manpower", "purchase_request", "purchase_approve", "prod_tasks", "prod_update", "reports_generate"],
  "Dept Head - Lighting": ["inv_view", "inv_add", "inv_images", "events_view", "events_manpower", "purchase_request", "purchase_approve", "prod_tasks", "prod_update", "reports_generate"],
  "Dept Head - Painter": ["inv_view", "inv_add", "inv_images", "events_view", "events_manpower", "purchase_request", "purchase_approve", "prod_tasks", "prod_update", "reports_generate"],
  "Dept Head - Furniture": ["inv_view", "inv_add", "inv_images", "events_view", "events_manpower", "purchase_request", "purchase_approve", "prod_tasks", "prod_update", "reports_generate"],
  "Flower Head": ["inv_view", "inv_add", "inv_images", "events_view", "events_manpower", "purchase_request", "purchase_approve", "prod_tasks", "reports_generate"],
  "Purchase Manager": ["inv_view", "inv_add", "purchase_request", "purchase_approve", "purchase_add", "events_view", "reports_generate"],
  "Site Supervisor": ["inv_view", "events_view", "events_manpower", "box_scan", "box_status", "purchase_request", "reports_generate"],
};

export const PROD_STATUSES = ["Requested", "Acknowledged", "In Progress", "Ready for Review", "Confirmed", "Added to Inventory"];
export const PROD_DEPTS = ["Floral", "Fabric", "Structural", "Lighting", "Painter & Production", "Props", "Furniture", "Other"];
export const DIM_UNITS = ["ft", "cm", "inches", "metres"];
export const VENDOR_TYPES = ["Manpower Contractor", "Transport", "Inventory Supplier", "Printing", "Flower Supplier", "Rental", "Service"];
export const OVERHEAD_CATS = ["Godown Rent", "Fixed Staff Salaries", "Utilities", "Vehicle EMI/Maintenance", "Equipment Maintenance", "Subscriptions/Software", "Other"];
export const MANPOWER_TYPES = ["Flowerists", "Labours", "Fabric Bangali", "Carpenters", "Painters", "Electricians", "Truss Labour", "Drivers", "Supervisors"];
export const DEFAULT_RATES = { Flowerists: 800, Labours: 500, "Fabric Bangali": 600, Carpenters: 900, Painters: 700, Electricians: 1000, "Truss Labour": 800, Drivers: 600, Supervisors: 1200 };
export const DUMPING_LEVELS = [{ id: "nearby", label: "📍 Nearby", mult: 1.0 }, { id: "medium", label: "🚶 Medium", mult: 1.1 }, { id: "far", label: "🚛 Far", mult: 1.2 }];
export const EVENT_TIMINGS = [
  { id: "brunch", label: "🌅 Brunch", mult: 1.3, beforeHour: 11, setupWindow: "~5 hrs" },
  { id: "lunch", label: "☀️ Lunch", mult: 1.15, beforeHour: 14, setupWindow: "~6 hrs" },
  { id: "sundowner", label: "🌆 Sundowner", mult: 1.05, beforeHour: 17, setupWindow: "~8 hrs" },
  { id: "dinner", label: "🌙 Dinner", mult: 1.0, beforeHour: 21, setupWindow: "~11 hrs" },
  { id: "latenight", label: "🌃 Late Night", mult: 1.0, beforeHour: 24, setupWindow: "~14 hrs" },
];
export const SIT_MULT_DEFAULTS = {
  heavySaya: { Flowerists: 1.35, "Fabric Bangali": 1.25, "Truss Labour": 1.2, Electricians: 1.2, Carpenters: 1.15, Painters: 1.15, Labours: 1.1, Helpers: 1.1 },
  premium: { Electricians: 1.4, Painters: 1.3, Flowerists: 1.25, Carpenters: 1.2, "Fabric Bangali": 1.15, "Truss Labour": 1.15, Labours: 1.15, Helpers: 1.1 },
  dayPrior: { Carpenters: 0.7, Painters: 0.75, Labours: 0.8, Helpers: 0.8, "Fabric Bangali": 0.8, "Truss Labour": 0.8, Electricians: 0.85, Flowerists: 0.85 },
  rush: { Labours: 1.3, Helpers: 1.3, Carpenters: 1.25, "Fabric Bangali": 1.2, Painters: 1.2, Electricians: 1.15, Flowerists: 1.1, "Truss Labour": 1.15 },
};

// Manpower types that can carry per-type situational/timing ratios (excludes Drivers/Supervisors,
// which are fixed and never multiplied).
export const SIT_MULT_TYPES = MANPOWER_TYPES.filter((t) => t !== "Drivers" && t !== "Supervisors");

// Event-timing multipliers are now PER-TYPE (like heavySaya) instead of one scalar applied to all.
// Defaults broadcast each timing's old scalar across every type, so behaviour is unchanged until a
// planner tunes individual types (e.g. Painters tighter at brunch than Flowerists).
const _broadcastTiming = (mult) => Object.fromEntries(SIT_MULT_TYPES.map((t) => [t, mult]));
export const EVENT_TIMING_MULT_DEFAULTS = Object.fromEntries(
  EVENT_TIMINGS.map((t) => [t.id, _broadcastTiming(t.mult)])
);

// Read an event-timing multiplier for a specific manpower type. Backward-compatible: accepts both
// the legacy scalar shape ({ brunch: 1.3 }) and the new per-type shape ({ brunch: { Painters: 1.3, … } }).
export function eventTimingMultFor(etm, timingId, type, fallback = 1.0) {
  const v = (etm || {})[timingId];
  if (v == null) return fallback;
  if (typeof v === "number") return v || fallback;            // legacy: one scalar for all types
  if (typeof v === "object") return v[type] ?? v._all ?? fallback; // per-type map
  return fallback;
}

// §23 Truss + Batta + Liza inventory defaults (faithful to reference INIT_TRUSS_INV).
export const INIT_TRUSS_INV = {
  pillars: {
    "15": { stock: 32, name: "Pillar 15ft" },
    "12": { stock: 100, name: "Pillar 12ft" },
    "10": { stock: 22, name: "Pillar 10ft" },
  },
  beams: {
    "15": { stock: 40, name: "Beam 15ft" },
    "12": { stock: 90, name: "Beam 12ft" },
    "10": { stock: 85, name: "Beam 10ft" },
    "8": { stock: 8, name: "Beam 8ft" },
    "5": { stock: 20, name: "Beam 5ft" },
    "4": { stock: 20, name: "Beam 4ft" },
    "3": { stock: 40, name: "Beam 3ft" },
    "2": { stock: 30, name: "Beam 2ft" },
  },
  rates: { pillarRftRate: 0, beamRftRate: 0, battaRftRate: 0, lizaKgRate: 0, maskingPieceRate: 0, curtainPieceRate: 0, lizaKgPurchase: 0, maskingPiecePurchase: 0, curtainPiecePurchase: 0 },
  fabricFreshMarkup: { liza: 40, masking: 40, curtain: 40 },
  fabricFactors: { kgPerRftWrap: 0.3, kgPerSqftDense: 0.08, kgPerSqftModerate: 0.05, kgPerSqftMinimum: 0.03 },
  batta: { stockRft: 3000, bufferPct: 10 },
  liza: { stockKg: 0 },
  lizaStock: [],
  maskingStock: [],
  curtainStock: [],
  settings: { pillarWidthFt: 0.75, maxSpanFt: 30, defaultBackDepthFt: 4, backDepthRange: [3, 5], untaggedFallback: "half_box", hybridPricingMethod: "simple_avg" },
  lastUpdated: null,
  updatedBy: null,
};

// Minimal default settings so finance math (buffer / min-profit) + date pricing work
// before the Settings phase populates the real settings table. Faithful to INIT_SETTINGS.
export const SETTINGS_DEFAULTS = {
  bufferPct: 5,
  minProfitPct: 30,
  datePricing: {
    lastMinuteDays: 10,
    categories: {
      heavy_saya: { label: "👑 King's", multiplier: 1.4, color: "red" },
      competition: { label: "✦ Perfect", multiplier: 1.0, color: "yellow" },
      non_saya: { label: "○ Filler", multiplier: 0.75, color: "green" },
    },
    markedDates: {},
    autoCategories: {},
  },
  artificialColours: ["Red", "White", "Pastels", "Yellow/Orange", "Purple", "Greens", "Mixed/Other"],
  artificialKgToPieces: 200,
  mandiPriceMultipliers: { heavy_saya: 1.4, competition: 1.0, non_saya: 0.85 },
  flowerCategories: ["Rose", "Daisy", "Carnation", "Stock", "Lily & Orchid", "Gladiolus", "Anthurium", "Guldavari", "Marigold", "Mogra", "Tuberose", "Sunflower", "Ranunculus", "Filler & Green", "Palm & Leaf", "Patti (Leaves)", "Specialty", "Other"],
  flowerPatterns: [],
  flowerRecipeSubcats: ["Flower Pattern"],
  defaultStudioMarkup: 3,
  colourCatalogue: [
    { name: "Ivory", hex: "#F5F0E1", isNeutral: true }, { name: "Cream", hex: "#FFFDD0", isNeutral: true },
    { name: "White", hex: "#FFFFFF", isNeutral: true }, { name: "Champagne", hex: "#F7E7CE", isNeutral: true },
    { name: "Off-White", hex: "#FAF9F6", isNeutral: true }, { name: "Antique Gold", hex: "#C5A572", isNeutral: false },
    { name: "Rose Gold", hex: "#B76E79", isNeutral: false }, { name: "Bright Gold", hex: "#FFD700", isNeutral: false },
    { name: "Soft Pink", hex: "#F4C2C2", isNeutral: false }, { name: "Blush", hex: "#DE5D83", isNeutral: false },
    { name: "Coral", hex: "#FF7F50", isNeutral: false }, { name: "Magenta", hex: "#C71585", isNeutral: false },
    { name: "Maroon", hex: "#800000", isNeutral: false }, { name: "Burgundy", hex: "#800020", isNeutral: false },
    { name: "Red", hex: "#DC143C", isNeutral: false }, { name: "Peach", hex: "#FFCBA4", isNeutral: false },
    { name: "Orange", hex: "#FF8C00", isNeutral: false }, { name: "Tangerine", hex: "#F28500", isNeutral: false },
    { name: "Powder Blue", hex: "#B0E0E6", isNeutral: false }, { name: "Royal Blue", hex: "#4169E1", isNeutral: false },
    { name: "Navy", hex: "#000080", isNeutral: false }, { name: "Teal", hex: "#008080", isNeutral: false },
    { name: "Mint", hex: "#98FF98", isNeutral: false }, { name: "Sage", hex: "#9CAF88", isNeutral: false },
    { name: "Emerald", hex: "#50C878", isNeutral: false }, { name: "Lavender", hex: "#E6E6FA", isNeutral: false },
    { name: "Lilac", hex: "#C8A2C8", isNeutral: false }, { name: "Plum", hex: "#8E4585", isNeutral: false },
    { name: "Silver", hex: "#C0C0C0", isNeutral: true }, { name: "Black", hex: "#000000", isNeutral: false },
  ],
  defaultPaintCostPerItem: 400,
  labourTiers: {
    Flowerists: { tier: 1 },
    Electricians: { tier: 1 },
    Painters: { tier: 2, minimum: 1, subCatBatches: { "Arches & Frames": 1, "Backdrops": 2, "Gate/Entry Frames": 1, "Themed Props": 5, "Decorative Objects": 5 } },
    Carpenters: { tier: 2, minimum: 1, subCatBatches: { "Stage Frames": 1, "Mandap Frames": 1, "Gate/Entry Frames": 2, "Bar Counters": 2, "Platforms/Risers": 1 } },
    Labours: { tier: 3 },
    "Fabric Bangali": { tier: "sqft-range" },
    "Truss Labour": { tier: "pillar-range" },
    Supervisors: { tier: "fixed" },
  },
  defaultMinLabour: 4,
  eventTypeMultipliers: { outdoor_premium: 1.5, outdoor_budgeted: 1.0, inhouse: 0.75 },
  sayaMultiplier: 1.3,
  eventTimingMultipliers: EVENT_TIMING_MULT_DEFAULTS,
  venueMinLabour: {
    "The Grand Hyatt": { min: 6, dumpingLevel: "far" },
    "Green Valley Farmhouse": { min: 4, dumpingLevel: "nearby" },
    "Ambria Pushpanjali": { min: 4, dumpingLevel: "nearby" },
    "Ambria Manaktala": { min: 5, dumpingLevel: "medium" },
    "Ambria Exotica": { min: 5, dumpingLevel: "medium" },
  },
  heavyElementRanges: [
    { subCat: "Pillars/Columns", freeUpTo: 10, perCount: 10 },
    { subCat: "Truss Systems", freeUpTo: 2, perCount: 2 },
    { subCat: "Platforms/Risers", freeUpTo: 2, perCount: 3 },
  ],
  situationalMultipliers: {},
  situationalMultiplierCap: 1.8,
  electricianProductivity: {},
  fabricRftPerWorker: 100,
  fabricBackDepthFt: 4,
  carpetFreshMarkup: 40,
  trussLabourRanges: [
    { upTo: 40, labour: 6, label: "Base (up to 40 pillars)" },
    { upTo: 60, labour: 8, label: "+20 pillars" },
    { upTo: 80, labour: 10, label: "+20 pillars" },
    { upTo: 100, labour: 12, label: "+20 pillars" },
    { upTo: 140, labour: 15, label: "+40 pillars" },
    { upTo: 9999, labour: 18, label: "140+ pillars" },
  ],
  fabricBangaliRanges: [
    { upTo: 1000, labour: 3, label: "Up to 1000 sqft (e.g. 30×30)" },
    { upTo: 1600, labour: 4, label: "Up to 1600 sqft (e.g. 40×40)" },
    { upTo: 2500, labour: 8, label: "Up to 2500 sqft (e.g. 50×50)" },
    { upTo: 3600, labour: 12, label: "Up to 3600 sqft (e.g. 60×60)" },
    { upTo: 9999, labour: 16, label: "3600+ sqft" },
  ],
  dihariSchemes: {
    "Flowerists": { rate: 1200, windows: [{ id: "day", label: "9 AM – 6 PM" }, { id: "night", label: "6 PM – 2 AM" }] },
    "Electricians": { rate: 1500, windows: [{ id: "fullday", label: "Full day" }] },
    "Fabric Bangali": { rate: 650, windows: [{ id: "m", label: "9 AM – 5 PM" }, { id: "e", label: "5 PM – 11 PM" }, { id: "ln", label: "11 PM – 2 AM" }, { id: "pd", label: "2 AM – 6 AM" }, { id: "on", label: "6 PM – 9 AM" }] },
    "Labours": { rate: 500, windows: [{ id: "m", label: "9 AM – 5 PM" }, { id: "e", label: "5 PM – 11 PM" }, { id: "ln", label: "11 PM – 2 AM" }, { id: "pd", label: "2 AM – 6 AM" }, { id: "on", label: "6 PM – 9 AM" }] },
    "Carpenters": { rate: 900, windows: [{ id: "m", label: "9 AM – 5 PM" }, { id: "e", label: "5 PM – 11 PM" }, { id: "ln", label: "11 PM – 2 AM" }] },
    "Painters": { rate: 700, windows: [{ id: "m", label: "9 AM – 5 PM" }, { id: "e", label: "5 PM – 11 PM" }] },
    "Truss Labour": { rate: 800, windows: [{ id: "m", label: "9 AM – 5 PM" }, { id: "e", label: "5 PM – 11 PM" }, { id: "ln", label: "11 PM – 2 AM" }] },
    "Helpers": { rate: 400, windows: [{ id: "m", label: "9 AM – 5 PM" }, { id: "e", label: "5 PM – 11 PM" }] },
    "Supervisors": { rate: 1200, windows: [{ id: "fullday", label: "Full day" }] },
    "Drivers": { rate: 600, windows: [{ id: "fullday", label: "Full day" }] },
  },
  defaultWindowsByPhase: {
    "Flowerists": { minusOne: ["day"], event: ["day", "night"], dismantle: ["day"] },
    "Electricians": { minusOne: ["fullday"], event: ["fullday"], dismantle: ["fullday"] },
    "Fabric Bangali": { minusOne: ["m", "e"], event: ["m", "e", "ln"], dismantle: ["m"] },
    "Labours": { minusOne: ["m", "e"], event: ["m", "e", "ln"], dismantle: ["m"] },
    "Carpenters": { minusOne: ["m", "e"], event: ["m", "e"], dismantle: ["m"] },
    "Painters": { minusOne: ["m", "e"], event: ["m"], dismantle: [] },
    "Truss Labour": { minusOne: ["m", "e"], event: ["m", "e"], dismantle: ["m"] },
    "Helpers": { minusOne: ["m"], event: ["m", "e"], dismantle: ["m"] },
    "Supervisors": { minusOne: ["fullday"], event: ["fullday"], dismantle: ["fullday"] },
    "Drivers": { minusOne: [], event: ["fullday"], dismantle: ["fullday"] },
  },
  mandiCatalogue: [
    { id: "F001", flowerCat: "Rose", name: "Rose Baby Pink", unit: "bundle", gattharSize: null, currentPrice: 550, priceHistory: [{ price: 500, date: "2026-02-19" }] },
    { id: "F002", flowerCat: "Rose", name: "Rose White", unit: "bundle", gattharSize: null, currentPrice: 300, priceHistory: [{ price: 300, date: "2026-02-23" }] },
    { id: "F003", flowerCat: "Rose", name: "Rose Rani Pink", unit: "bundle", gattharSize: null, currentPrice: 500, priceHistory: [{ price: 500, date: "2026-02-13" }] },
    { id: "F004", flowerCat: "Rose", name: "Rose Yellow (Pila Gulab)", unit: "bundle", gattharSize: null, currentPrice: 500, priceHistory: [{ price: 500, date: "2026-02-13" }] },
    { id: "F005", flowerCat: "Rose", name: "Rose Peach", unit: "bundle", gattharSize: null, currentPrice: 300, priceHistory: [{ price: 300, date: "2026-02-23" }] },
    { id: "F006", flowerCat: "Daisy", name: "Daisy White", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 300, date: "2026-02-23" }, { price: 350, date: "2026-02-19" }] },
    { id: "F007", flowerCat: "Daisy", name: "Daisy Pink", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 350, date: "2026-02-13" }] },
    { id: "F008", flowerCat: "Daisy", name: "Daisy Maroon", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 350, date: "2026-02-13" }] },
    { id: "F009", flowerCat: "Daisy", name: "Daisy Green", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 350, date: "2026-02-13" }] },
    { id: "F010", flowerCat: "Daisy", name: "Daisy Yellow", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 350, date: "2026-02-13" }] },
    { id: "F011", flowerCat: "Daisy", name: "Daisy Peach", unit: "bundle", gattharSize: null, currentPrice: 300, priceHistory: [{ price: 300, date: "2026-02-23" }] },
    { id: "F012", flowerCat: "Daisy", name: "Green Button Daisy", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 400, date: "2026-02-23" }, { price: 300, date: "2026-02-19" }] },
    { id: "F013", flowerCat: "Daisy", name: "Santini Daisy", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 400, date: "2026-02-13" }, { price: 300, date: "2026-02-23" }] },
    { id: "F014", flowerCat: "Daisy", name: "Calcutta Button Daisy", unit: "bundle", gattharSize: null, currentPrice: 375, priceHistory: [{ price: 375, date: "2026-02-19" }] },
    { id: "F015", flowerCat: "Carnation", name: "Carnation White", unit: "bundle", gattharSize: null, currentPrice: 300, priceHistory: [{ price: 200, date: "2026-02-23" }, { price: 250, date: "2026-02-19" }] },
    { id: "F016", flowerCat: "Carnation", name: "Spray Carnation Baby Pink", unit: "bundle", gattharSize: null, currentPrice: 350, priceHistory: [{ price: 350, date: "2026-02-19" }] },
    { id: "F017", flowerCat: "Stock", name: "Stock Rani Pink", unit: "bundle", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F018", flowerCat: "Stock", name: "Stock Purple", unit: "bundle", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F019", flowerCat: "Stock", name: "Stock White", unit: "bundle", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 20, date: "2026-02-23" }, { price: 100, date: "2026-02-19" }] },
    { id: "F020", flowerCat: "Stock", name: "Stock Pink", unit: "bundle", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-19" }] },
    { id: "F021", flowerCat: "Stock", name: "Stock Peach", unit: "piece", gattharSize: null, currentPrice: 20, priceHistory: [{ price: 20, date: "2026-02-23" }] },
    { id: "F022", flowerCat: "Lily & Orchid", name: "Lily White", unit: "piece", gattharSize: null, currentPrice: 1000, priceHistory: [{ price: 1000, date: "2026-02-23" }, { price: 1200, date: "2026-02-19" }] },
    { id: "F023", flowerCat: "Lily & Orchid", name: "Orchid White", unit: "piece", gattharSize: null, currentPrice: 150, priceHistory: [{ price: 150, date: "2026-02-23" }] },
    { id: "F024", flowerCat: "Gladiolus", name: "Glad White", unit: "piece", gattharSize: null, currentPrice: 150, priceHistory: [{ price: 150, date: "2026-02-23" }] },
    { id: "F025", flowerCat: "Anthurium", name: "Anthurium White", unit: "piece", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-19" }, { price: 100, date: "2026-02-23" }] },
    { id: "F026", flowerCat: "Anthurium", name: "Anthurium Green", unit: "piece", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-23" }] },
    { id: "F027", flowerCat: "Guldavari", name: "Guldavari White", unit: "piece", gattharSize: null, currentPrice: 2000, priceHistory: [{ price: 2000, date: "2026-02-23" }] },
    { id: "F028", flowerCat: "Guldavari", name: "Guldavari Ladi", unit: "kg", gattharSize: null, currentPrice: 333, priceHistory: [{ price: 333, date: "2026-02-23" }] },
    { id: "F029", flowerCat: "Marigold", name: "Genda Loose Rupali", unit: "kg", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F030", flowerCat: "Marigold", name: "Genda Orange Loose", unit: "kg", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F031", flowerCat: "Mogra", name: "Mogra", unit: "gatthar", gattharSize: null, currentPrice: 3000, priceHistory: [{ price: 3000, date: "2026-02-23" }] },
    { id: "F032", flowerCat: "Tuberose", name: "Tuberose (Rajnigandha)", unit: "gatthar", gattharSize: 160, currentPrice: 580, priceHistory: [{ price: 580, date: "2026-02-23" }] },
    { id: "F033", flowerCat: "Filler & Green", name: "Gypso (Baby Breath)", unit: "bundle", gattharSize: null, currentPrice: 200, priceHistory: [{ price: 50, date: "2026-02-13" }, { price: 200, date: "2026-02-23" }, { price: 250, date: "2026-02-19" }] },
    { id: "F034", flowerCat: "Sunflower", name: "Sunflower", unit: "piece", gattharSize: null, currentPrice: 40, priceHistory: [{ price: 40, date: "2026-02-13" }] },
    { id: "F035", flowerCat: "Ranunculus", name: "Ranunculus Pink", unit: "piece", gattharSize: null, currentPrice: 150, priceHistory: [{ price: 150, date: "2026-02-13" }] },
    { id: "F036", flowerCat: "Ranunculus", name: "Ranunculus Green", unit: "piece", gattharSize: null, currentPrice: 150, priceHistory: [{ price: 150, date: "2026-02-13" }] },
    { id: "F037", flowerCat: "Filler & Green", name: "Amaranthus Red", unit: "bundle", gattharSize: null, currentPrice: 50, priceHistory: [{ price: 50, date: "2026-02-13" }] },
    { id: "F038", flowerCat: "Filler & Green", name: "Amaranthus Green", unit: "bundle", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 50, date: "2026-02-13" }, { price: 100, date: "2026-02-23" }] },
    { id: "F039", flowerCat: "Filler & Green", name: "Lemonium", unit: "bundle", gattharSize: null, currentPrice: 300, priceHistory: [{ price: 300, date: "2026-02-13" }] },
    { id: "F040", flowerCat: "Filler & Green", name: "Junado", unit: "bundle", gattharSize: null, currentPrice: 50, priceHistory: [{ price: 50, date: "2026-02-13" }, { price: 50, date: "2026-02-23" }] },
    { id: "F041", flowerCat: "Filler & Green", name: "Finger", unit: "bundle", gattharSize: null, currentPrice: 30, priceHistory: [{ price: 30, date: "2026-02-13" }, { price: 30, date: "2026-02-19" }] },
    { id: "F042", flowerCat: "Filler & Green", name: "Dandela", unit: "bundle", gattharSize: null, currentPrice: 50, priceHistory: [{ price: 50, date: "2026-02-23" }] },
    { id: "F043", flowerCat: "Filler & Green", name: "Black Berry", unit: "bundle", gattharSize: null, currentPrice: 250, priceHistory: [{ price: 250, date: "2026-02-23" }] },
    { id: "F044", flowerCat: "Filler & Green", name: "Dracaena Red", unit: "bundle", gattharSize: null, currentPrice: 20, priceHistory: [{ price: 20, date: "2026-02-13" }] },
    { id: "F045", flowerCat: "Palm & Leaf", name: "Fish Tail Palm", unit: "piece", gattharSize: null, currentPrice: 1000, priceHistory: [{ price: 1000, date: "2026-02-13" }, { price: 1000, date: "2026-02-19" }] },
    { id: "F046", flowerCat: "Palm & Leaf", name: "Ghoda Palm", unit: "piece", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-23" }] },
    { id: "F047", flowerCat: "Palm & Leaf", name: "Mocha", unit: "piece", gattharSize: null, currentPrice: 250, priceHistory: [{ price: 250, date: "2026-02-13" }, { price: 250, date: "2026-02-23" }] },
    { id: "F048", flowerCat: "Patti (Leaves)", name: "Delhi Patti", unit: "bundle", gattharSize: null, currentPrice: 200, priceHistory: [{ price: 100, date: "2026-02-13" }, { price: 200, date: "2026-02-19" }] },
    { id: "F049", flowerCat: "Patti (Leaves)", name: "English Green Patti", unit: "bundle", gattharSize: null, currentPrice: 3000, priceHistory: [{ price: 3000, date: "2026-02-23" }, { price: 3000, date: "2026-02-19" }] },
    { id: "F050", flowerCat: "Patti (Leaves)", name: "Morya Patti", unit: "bundle", gattharSize: null, currentPrice: 1000, priceHistory: [{ price: 167, date: "2026-02-23" }, { price: 1000, date: "2026-02-19" }] },
    { id: "F051", flowerCat: "Patti (Leaves)", name: "Gulab Patti (Rose Petals)", unit: "kg", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F052", flowerCat: "Patti (Leaves)", name: "Hinda Patti", unit: "kg", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F053", flowerCat: "Patti (Leaves)", name: "White Patti", unit: "kg", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-13" }] },
    { id: "F054", flowerCat: "Patti (Leaves)", name: "Salad Patti", unit: "bundle", gattharSize: null, currentPrice: 1000, priceHistory: [{ price: 1000, date: "2026-02-19" }] },
    { id: "F055", flowerCat: "Patti (Leaves)", name: "Golden Patti", unit: "kg", gattharSize: null, currentPrice: 100, priceHistory: [{ price: 100, date: "2026-02-19" }] },
    { id: "F056", flowerCat: "Patti (Leaves)", name: "Murappa Patti", unit: "gatthar", gattharSize: 10, currentPrice: 1000, priceHistory: [{ price: 1000, date: "2026-02-13" }] },
    { id: "F057", flowerCat: "Specialty", name: "Pyaz Flower", unit: "bundle", gattharSize: null, currentPrice: 60, priceHistory: [{ price: 60, date: "2026-02-23" }] },
    { id: "F058", flowerCat: "Specialty", name: "Tomato Pattavar", unit: "piece", gattharSize: null, currentPrice: 6, priceHistory: [{ price: 6, date: "2026-02-13" }] },
    { id: "F059", flowerCat: "Specialty", name: "Sitara (Star)", unit: "dozen", gattharSize: null, currentPrice: 150, priceHistory: [{ price: 150, date: "2026-02-13" }] },
    { id: "F060", flowerCat: "Specialty", name: "Kiance", unit: "kg", gattharSize: null, currentPrice: 500, priceHistory: [{ price: 500, date: "2026-02-23" }] },
    { id: "F061", flowerCat: "Specialty", name: "Juppi", unit: "piece", gattharSize: null, currentPrice: 30, priceHistory: [{ price: 30, date: "2026-02-23" }] },
    { id: "F062", flowerCat: "Specialty", name: "Muraya (Murraya)", unit: "gatthar", gattharSize: null, currentPrice: 1000, priceHistory: [{ price: 1000, date: "2026-02-23" }] },
    { id: "F063", flowerCat: "Specialty", name: "Anar (Pomegranate)", unit: "kg", gattharSize: null, currentPrice: 200, priceHistory: [{ price: 200, date: "2026-02-13" }] },
    { id: "F064", flowerCat: "Specialty", name: "Nimbu (Lemon)", unit: "kg", gattharSize: null, currentPrice: 200, priceHistory: [{ price: 200, date: "2026-02-13" }] },
    { id: "F065", flowerCat: "Specialty", name: "Morning Strip", unit: "bundle", gattharSize: null, currentPrice: 150, priceHistory: [{ price: 150, date: "2026-02-13" }] },
    { id: "F066", flowerCat: "Filler & Green", name: "Ferns", unit: "piece", gattharSize: null, currentPrice: 50, priceHistory: [{ price: 50, date: "2026-02-23" }] },
    { id: "F067", flowerCat: "Palm & Leaf", name: "Cactus Palm", unit: "piece", gattharSize: null, currentPrice: 250, priceHistory: [{ price: 250, date: "2026-02-19" }] },
  ],
  synonymDictionary: [
    { id: "SYN1", words: ["Flower", "Floral", "Phool"] },
    { id: "SYN2", words: ["Arch", "Gate", "Entrance", "Dwar"] },
    { id: "SYN3", words: ["Mandap", "Stage", "Platform", "Manch"] },
    { id: "SYN4", words: ["Sofa", "Couch", "Settee"] },
    { id: "SYN5", words: ["Light", "Lamp", "Chandelier", "Jhumar"] },
    { id: "SYN6", words: ["Curtain", "Drape", "Parda"] },
    { id: "SYN7", words: ["Carpet", "Rug", "Dari"] },
    { id: "SYN8", words: ["Table", "Counter", "Desk"] },
    { id: "SYN9", words: ["Backdrop", "Background", "Panel"] },
    { id: "SYN10", words: ["Pillar", "Column", "Khamba"] },
    { id: "SYN11", words: ["Pot", "Vase", "Gamla"] },
    { id: "SYN12", words: ["Marigold", "Genda", "Gainda"] },
    { id: "SYN13", words: ["Rose", "Gulab"] },
    { id: "SYN14", words: ["Jasmine", "Mogra", "Chameli"] },
    { id: "SYN15", words: ["Tuberose", "Rajnigandha"] },
    { id: "SYN16", words: ["Chair", "Kursi", "Seat"] },
    { id: "SYN17", words: ["Ceiling", "Top", "Chaddar"] },
    { id: "SYN18", words: ["Hanging", "Latkane", "Suspension"] },
    { id: "SYN19", words: ["Fabric", "Cloth", "Kapda"] },
    { id: "SYN20", words: ["Frame", "Structure", "Dhaancha"] },
  ],
};

// Seed price-intelligence data shown in the Purchase "Log Purchase" modal.
export const PRICE_HISTORY = {
  "Foam Flower Base": [
    { vendorId: "V001", vendorName: "Raju Flowers", mobile: "9876500001", price: 72, qty: 50, unit: "Piece", date: "2026-03-10" },
    { vendorId: "V002", vendorName: "Kumar Traders", mobile: "9876500002", price: 85, qty: 30, unit: "Piece", date: "2025-12-05" },
    { vendorId: "V003", vendorName: "Delhi Florals", mobile: "9876500003", price: 95, qty: 20, unit: "Piece", date: "2025-10-20" },
  ],
  "Marigold Garland": [
    { vendorId: "V003", vendorName: "Delhi Florals", mobile: "9876500003", price: 45, qty: 80, unit: "Metre", date: "2025-11-15" },
    { vendorId: "V002", vendorName: "Kumar Traders", mobile: "9876500002", price: 52, qty: 50, unit: "Metre", date: "2025-09-10" },
  ],
};

// Extra labour for a heavy-element rule given the counted quantity.
// New model: { freeUpTo, perCount } → no extra up to freeUpTo, then +1 labour
// per perCount thereafter (floor). e.g. freeUpTo 0, perCount 10, qty 20 → 2.
// Legacy model: { ranges:[{upTo,extra}] } → the extra of the first band the qty fits.
export function heavyExtraLabour(her, count) {
  if (!her || !(count > 0)) return 0;
  if (her.perCount != null || her.freeUpTo != null) {
    const free = Number(her.freeUpTo) || 0;
    const per = Number(her.perCount) || 0;
    if (per <= 0) return 0;
    return Math.floor(Math.max(0, count - free) / per);
  }
  for (const r of (her.ranges || [])) { if (count <= r.upTo) return r.extra || 0; }
  return 0;
}

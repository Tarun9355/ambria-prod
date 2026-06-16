// Shared IMS constants (non-inventory). Faithful to the reference app.
export const VENDOR_TYPES = ["Manpower Contractor", "Transport", "Inventory Supplier", "Printing", "Flower Supplier", "Rental", "Service"];
export const OVERHEAD_CATS = ["Godown Rent", "Fixed Staff Salaries", "Utilities", "Vehicle EMI/Maintenance", "Equipment Maintenance", "Subscriptions/Software", "Other"];

// Minimal default settings so finance math (buffer / min-profit) + date pricing work
// before the Settings phase populates the real settings table. Faithful to INIT_SETTINGS.
export const SETTINGS_DEFAULTS = {
  bufferPct: 5,
  minProfitPct: 30,
  datePricing: {
    lastMinuteDays: 10,
    categories: {
      heavy_saya: { label: "🔴 Heavy Saya", multiplier: 1.4, color: "red" },
      competition: { label: "🟡 Perfect Competition", multiplier: 1.0, color: "yellow" },
      non_saya: { label: "🟢 Non-Saya", multiplier: 0.75, color: "green" },
    },
    markedDates: {},
  },
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

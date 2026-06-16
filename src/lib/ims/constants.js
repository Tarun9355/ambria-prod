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

// Shared IMS constants (non-inventory). Faithful to the reference app.
export const VENDOR_TYPES = ["Manpower Contractor", "Transport", "Inventory Supplier", "Printing", "Flower Supplier", "Rental", "Service"];

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

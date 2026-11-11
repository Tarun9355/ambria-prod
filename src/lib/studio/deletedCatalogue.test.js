import { describe, it, expect } from "vitest";
import {
  assembleDeletedCatalogue, withDeletedRates, withDeletedInventory, deletedKitParts,
  catalogueDeletedLabel, catalogueDeletedTitle, EMPTY_DELETED_CATALOGUE,
} from "./deletedCatalogue.js";

const invRow = (id, patch = {}) => ({
  id, name: "Item " + id, cat: "Furniture", sub_cat: "Chairs", qty: 5, price: 100, sub_items: [], ...patch,
});
const patternRow = (id, patch = {}) => ({
  id, name: "Pattern " + id, flat_or_smb: "flat", sub: "Rose", unit: "pc", sizes: {}, ...patch,
});
const rateRow = (idKey, id, patch = {}) => ({ [idKey]: id, name: "Rate " + id, rate_per_sqft: 10, ...patch });
const deletedRow = (source_table, data, deleted_at = "2026-10-01T00:00:00Z") => ({ source_table, data, deleted_at });

describe("assembleDeletedCatalogue", () => {
  it("recovers an inventory row, stamped catalogueDeleted/catalogueDeletedAt", () => {
    const { inventoryById } = assembleDeletedCatalogue([deletedRow("inventory", invRow("INV1"))]);
    const item = inventoryById.get("INV1");
    expect(item.name).toBe("Item INV1");
    expect(item.catalogueDeleted).toBe(true);
    expect(item.catalogueDeletedAt).toBe("2026-10-01T00:00:00Z");
  });

  it("recovers a flower_patterns row", () => {
    const { patternsById } = assembleDeletedCatalogue([deletedRow("flower_patterns", patternRow("FP1"))]);
    const pattern = patternsById.get("FP1");
    expect(pattern.name).toBe("Pattern FP1");
    expect(pattern.catalogueDeleted).toBe(true);
  });

  it("recovers a carpet_materials row", () => {
    const { carpetMaterials } = assembleDeletedCatalogue([deletedRow("carpet_materials", rateRow("id", "CM1"))]);
    expect(carpetMaterials).toEqual([{ id: "CM1", name: "Rate CM1", ratePerSqft: 10, catalogueDeleted: true, catalogueDeletedAt: "2026-10-01T00:00:00Z" }]);
  });

  it("recovers a print_materials row", () => {
    const { printMaterials } = assembleDeletedCatalogue([deletedRow("print_materials", rateRow("id", "PM1"))]);
    expect(printMaterials[0].id).toBe("PM1");
    expect(printMaterials[0].catalogueDeleted).toBe(true);
  });

  it("recovers a platform_rates row, keyed by `key` not `id`", () => {
    const { platformRates } = assembleDeletedCatalogue([deletedRow("platform_rates", rateRow("key", "PL1"))]);
    expect(platformRates[0].key).toBe("PL1");
    expect(platformRates[0].catalogueDeleted).toBe(true);
  });

  it("skips an unrecognized source_table instead of throwing", () => {
    expect(() => assembleDeletedCatalogue([deletedRow("some_other_table", { id: "X" })])).not.toThrow();
    const result = assembleDeletedCatalogue([deletedRow("some_other_table", { id: "X" })]);
    expect(result.inventoryById.size).toBe(0);
    expect(result.carpetMaterials).toEqual([]);
  });

  it("skips a row with no data rather than throwing", () => {
    expect(() => assembleDeletedCatalogue([{ source_table: "inventory", data: null }])).not.toThrow();
  });

  it("returns the empty shape for no rows", () => {
    const result = assembleDeletedCatalogue([]);
    expect(result.inventoryById.size).toBe(0);
    expect(result.patternsById.size).toBe(0);
    expect(result.carpetMaterials).toEqual([]);
  });
});

describe("EMPTY_DELETED_CATALOGUE", () => {
  it("has the expected shape", () => {
    expect(EMPTY_DELETED_CATALOGUE.inventoryById).toBeInstanceOf(Map);
    expect(EMPTY_DELETED_CATALOGUE.patternsById).toBeInstanceOf(Map);
    expect(EMPTY_DELETED_CATALOGUE.carpetMaterials).toEqual([]);
    expect(EMPTY_DELETED_CATALOGUE.printMaterials).toEqual([]);
    expect(EMPTY_DELETED_CATALOGUE.platformRates).toEqual([]);
  });
});

describe("withDeletedRates", () => {
  it("a live entry wins over a same-id deleted one", () => {
    const live = [{ id: "CM1", name: "Live Carpet", ratePerSqft: 999 }];
    const deleted = [{ id: "CM1", name: "Deleted Carpet", ratePerSqft: 7, catalogueDeleted: true }];
    const merged = withDeletedRates(live, deleted, "id");
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Live Carpet");
  });

  it("includes a deleted-only entry, flagged", () => {
    const live = [{ id: "CM1", name: "Live Carpet", ratePerSqft: 999 }];
    const deleted = [{ id: "CM2", name: "Gone Carpet", ratePerSqft: 7, catalogueDeleted: true }];
    const merged = withDeletedRates(live, deleted, "id");
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.id === "CM2").catalogueDeleted).toBe(true);
  });

  it("uses the given idKey (platform rates key on `key`, not `id`)", () => {
    const live = [{ key: "4in", name: "4 inch" }];
    const deleted = [{ key: "PLx", name: "Old Height", catalogueDeleted: true }];
    const merged = withDeletedRates(live, deleted, "key");
    expect(merged).toHaveLength(2);
  });
});

describe("withDeletedInventory", () => {
  it("a live item wins over a same-id deleted one", () => {
    const live = [{ id: "INV1", name: "Live Item" }];
    const byId = new Map([["INV1", { id: "INV1", name: "Deleted Item", catalogueDeleted: true }]]);
    const merged = withDeletedInventory(live, byId);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Live Item");
  });

  it("includes a deleted-only item", () => {
    const live = [{ id: "INV1", name: "Live Item" }];
    const byId = new Map([["INV2", { id: "INV2", name: "Deleted Item", catalogueDeleted: true }]]);
    const merged = withDeletedInventory(live, byId);
    expect(merged).toHaveLength(2);
    expect(merged.find((i) => i.id === "INV2").catalogueDeleted).toBe(true);
  });
});

describe("deletedKitParts", () => {
  it("finds a deleted part nested inside a sub-kit", () => {
    const subB = { id: "SUB_B", name: "Deleted Sub Part", catalogueDeleted: true, subItems: [] };
    const subA = { id: "SUB_A", name: "Sub Kit A", subItems: [{ itemId: "SUB_B", qty: 2 }] };
    const top = { id: "TOP", name: "Top Kit", subItems: [{ itemId: "SUB_A", qty: 1 }] };
    const parts = deletedKitParts(top, [top, subA, subB], undefined, () => null);
    expect(parts).toEqual(["Deleted Sub Part"]);
  });

  it("honours kitOverrides/subOverrides over the kit's own saved subItems", () => {
    const subB = { id: "SUB_B", name: "Deleted Override Part", catalogueDeleted: true, subItems: [] };
    const top = { id: "TOP", name: "Top Kit", subItems: [{ itemId: "SUB_A", qty: 1 }] };
    const overrides = [{ itemId: "SUB_B", qty: 1 }];
    const parts = deletedKitParts(top, [top, subB], overrides, () => null);
    expect(parts).toEqual(["Deleted Override Part"]);
  });

  it("finds a deleted flower-recipe add-on, suffixed '(recipe)'", () => {
    const top = { id: "TOP", name: "Top Kit", subItems: [{ patternId: "FP_DEL", qty: 1 }] };
    const patternLookup = (id) => (id === "FP_DEL" ? { id: "FP_DEL", name: "Deleted Recipe", catalogueDeleted: true } : null);
    const parts = deletedKitParts(top, [top], undefined, patternLookup);
    expect(parts).toEqual(["Deleted Recipe (recipe)"]);
  });

  it("returns [] when nothing beneath the kit is deleted", () => {
    const subA = { id: "SUB_A", name: "Sub Kit A", subItems: [] };
    const top = { id: "TOP", name: "Top Kit", subItems: [{ itemId: "SUB_A", qty: 1 }] };
    const parts = deletedKitParts(top, [top, subA], undefined, () => null);
    expect(parts).toEqual([]);
  });

  it("returns [] for a non-kit item with no pattern add-ons", () => {
    expect(deletedKitParts({ id: "PLAIN", name: "Plain Item" }, [], undefined, () => null)).toEqual([]);
  });
});

describe("catalogueDeletedLabel", () => {
  it("returns empty string for null info", () => {
    expect(catalogueDeletedLabel(null)).toBe("");
  });
  it("returns the self-deleted label", () => {
    expect(catalogueDeletedLabel({ self: true, kind: "inventory", name: "X", deletedAt: null, parts: [] })).toBe("⚠ deleted");
  });
  it("singular vs plural part counts", () => {
    expect(catalogueDeletedLabel({ self: false, kind: "kit", name: "X", deletedAt: null, parts: ["A"] })).toBe("⚠ 1 part deleted");
    expect(catalogueDeletedLabel({ self: false, kind: "kit", name: "X", deletedAt: null, parts: ["A", "B"] })).toBe("⚠ 2 parts deleted");
  });
});

describe("catalogueDeletedTitle", () => {
  it("returns empty string for null info", () => {
    expect(catalogueDeletedTitle(null)).toBe("");
  });
  it("mentions the item name and rateText when given", () => {
    const title = catalogueDeletedTitle({ self: true, kind: "inventory", name: "Old Chair", deletedAt: "2026-10-01T00:00:00Z", parts: [] }, { rateText: "₹100/pc" });
    expect(title).toContain("Old Chair");
    expect(title).toContain("₹100/pc");
  });
  it("still produces a sensible title with no rateText", () => {
    const title = catalogueDeletedTitle({ self: true, kind: "recipe", name: "Old Recipe", deletedAt: null, parts: [] });
    expect(title).toContain("Old Recipe");
    expect(title).toContain("last known rate");
  });
  it("lists every deleted part for a kit", () => {
    const title = catalogueDeletedTitle({ self: false, kind: "kit", name: "Kit", deletedAt: null, parts: ["A", "B"] });
    expect(title).toContain("A, B");
  });
});

import { describe, it, expect } from "vitest";
import { catToDept, DEPTS } from "./deptClassify";

// This classifier decides which department EARNS a category's income (Deal Check → Dept Income,
// IMS → Dept Ops) as well as which heading a row files under in Deal Check → Transport. A silent
// change here moves money between departments in reporting, so the mappings are pinned.

describe("catToDept", () => {
  it("files a pedestal under Floral", () => {
    // Regression: neither stem matched any rule, so this fell through to the Structure catch-all and
    // 6 Mosaic Pedestals showed under 🏛️ Structure in the Transport tab.
    expect(catToDept("Pedestals")).toBe("Floral");
    expect(catToDept("Pedestal")).toBe("Floral");
    expect(catToDept("Mosaic Pedestal")).toBe("Floral");
  });

  it("keeps the mappings the Transport tab already relied on", () => {
    expect(catToDept("Truss")).toBe("Tenting");
    expect(catToDept("Chandelier")).toBe("Lighting");
    expect(catToDept("LED Light")).toBe("Lighting");
    expect(catToDept("Platform")).toBe("Tenting");
    expect(catToDept("Carpet")).toBe("Tenting");
    expect(catToDept("Draping")).toBe("Fabric");
    expect(catToDept("Sofa")).toBe("Furniture");
    expect(catToDept("Floral")).toBe("Floral");
    expect(catToDept("Flower Pattern")).toBe("Floral");
  });

  it("falls back to Structure for anything unrecognised", () => {
    expect(catToDept("Something Nobody Mapped")).toBe("Structure");
    expect(catToDept("")).toBe("Structure");
    expect(catToDept(null)).toBe("Structure");
    expect(catToDept(undefined)).toBe("Structure");
  });

  it("ignores case and surrounding space", () => {
    expect(catToDept("  PEDESTALS  ")).toBe("Floral");
    expect(catToDept("tRuSs")).toBe("Tenting");
  });

  it("lets the admin override beat every keyword", () => {
    // The override map is keyed by LOWERCASED category and is checked before the cascade.
    expect(catToDept("Truss", { truss: "Furniture" })).toBe("Furniture");
    expect(catToDept("Pedestals", { pedestals: "Structure" })).toBe("Structure");
  });

  it("ignores an override that is not a real department", () => {
    // A stale or hand-edited settings row must not invent a department the UI cannot show.
    expect(catToDept("Truss", { truss: "Nonsense" })).toBe("Tenting");
    expect(catToDept("Pedestals", { pedestals: "" })).toBe("Floral");
  });

  it("only ever returns a known department", () => {
    ["Pedestals", "Truss", "Chandelier", "Sofa", "Draping", "Mystery", ""].forEach((c) => {
      expect(DEPTS).toContain(catToDept(c));
    });
  });
});

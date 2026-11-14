// A non-kit Florals item (an inventory item whose name/sub-category matches a flower recipe) used to
// return its price directly from inside getElPriceFromInventoryCore's `if (isFloral && !isKit)` branch,
// before the shared availability-check block ever ran — meaning it had NO outOfStock flag, NO maxQty
// ceiling, and the Sold gate never stopped it, so it could sell past real stock with no warning at all
// (bug 1, 2026-11-14 audit). The fix makes that branch set kitFlowerCost/kitFlowerSMB/floralBlend and
// fall through, exactly like the kit version of this same bug (F2, 2026-11-13) already does. This is a
// source-reading wiring test, in the style of truckPrintWiring.test.js: it can't call the function
// directly (getElPriceFromInventoryCore isn't exported — it's a closure inside the StudioApp component),
// so it asserts the shape of the source instead.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("non-kit floral pricing falls through to the availability check (bug 1)", () => {
  const src = readFileSync(new URL("../../pages/studio/StudioApp.jsx", import.meta.url), "utf8");

  it("the non-kit floral branch contains no early return", () => {
    const start = src.indexOf('const isFloral = String(item.cat || item.category || "").toLowerCase() === "florals";');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("if (opts?.checkAvailability && liveItem)", start);
    expect(end).toBeGreaterThan(start);
    const branch = src.slice(start, end);
    expect(branch).not.toMatch(/return \{/);
  });

  it("the branch sets kitFlowerCost, kitFlowerSMB and floralBlend instead", () => {
    const start = src.indexOf('const isFloral = String(item.cat || item.category || "").toLowerCase() === "florals";');
    const end = src.indexOf("if (opts?.checkAvailability && liveItem)", start);
    const branch = src.slice(start, end);
    expect(branch).toMatch(/kitFlowerCost = Math\.round\(/);
    expect(branch).toMatch(/kitFlowerSMB = pattern\.mode === "smb"/);
    expect(branch).toMatch(/floralBlend = \{ realPct \}/);
  });

  it("both returns report isFloralBlend/realPct from floralBlend, not hardcoded false/null", () => {
    expect(src.match(/isFloralBlend: !!floralBlend, realPct: floralBlend \? floralBlend\.realPct : null/g)?.length).toBe(2);
  });
});

import { describe, it, expect } from "vitest";
import { isPlatformFoc, withoutTrussFoc } from "./foc.js";
import { platformRowCost, carpetNewShares } from "./taxonomy.js";
import { floorSqftOf } from "./carpetPrefs.js";
import { tentingZoneUsage } from "./manpowerCount.js";

// Platform FOC (owner ask 2026-11-18): the floor - platform AND its carpet - is already laid at the venue. Free, no crew, no plan.
const rates = { platformRates: [{ key: "1ft", ratePerSqft: 40 }], carpetMaterials: [{ id: "cm_old", name: "Carpet Old", ratePerSqft: 7 }] };
const floor = { plH: "1ft", floorDims: { L: 20, W: 6 }, cpT: "cm_old", plQty: 1 };

describe("platform FOC", () => {
  it("reads only an explicit true", () => {
    expect(isPlatformFoc({ platformFoc: true })).toBe(true);
    expect(isPlatformFoc({ platformFoc: "yes" })).toBe(false);
    expect(isPlatformFoc(null)).toBe(false);
  });

  it("bills nothing - platform and carpet", () => {
    const normal = platformRowCost(floor, rates);
    expect(normal.platform).toBeGreaterThan(0);
    expect(normal.carpet).toBeGreaterThan(0);
    expect(platformRowCost({ ...floor, platformFoc: true }, rates)).toEqual({ platform: 0, carpet: 0 });
  });

  it("has no carpet to lay, plan or staff", () => {
    expect(floorSqftOf(floor)).toBe(200); // 20 x 6 laid on the 10 ft roll
    expect(floorSqftOf({ ...floor, platformFoc: true })).toBe(0);
  });

  it("opens no Carpet New roll - the next floor opens it", () => {
    const mats = [{ id: "cm_new", name: "Carpet New", ratePerSqft: 15 }];
    const zoneConfig = {
      a: { floorDims: { L: 20, W: 10 }, cpT: "cm_new", platformFoc: true },
      b: { floorDims: { L: 20, W: 10 }, cpT: "cm_new" },
    };
    const sh = carpetNewShares({ zoneConfig, enabledEls: { a: true, b: true }, zoneOrder: ["a", "b"], carpetMaterials: mats });
    expect(sh["a|0"]).toBeUndefined();
    expect(sh["b|0"]).toMatchObject({ need: 200, billed: 1500 });
  });

  it("counts no platform or carpet crew", () => {
    const fn = (z) => ({ zoneConfig: { a: z }, enabledEls: { a: true } });
    const on = tentingZoneUsage(fn(floor), {});
    expect(on.platform).toBe(1);
    expect(on.carpet).toBe(200);
    const off = tentingZoneUsage(fn({ ...floor, platformFoc: true, extraPlatformRows: [{ ...floor, platformFoc: true }] }), {});
    expect(off).toMatchObject({ platform: 0, carpet: 0 });
  });

  it("is never carried into another deal", () => {
    const out = withoutTrussFoc({ ...floor, platformFoc: true, trussFoc: true, extraPlatformRows: [{ ...floor, platformFoc: true }] });
    expect(out.platformFoc).toBeUndefined();
    expect(out.trussFoc).toBeUndefined();
    expect(out.extraPlatformRows[0].platformFoc).toBeUndefined();
    expect(out.plH).toBe("1ft");
  });
});

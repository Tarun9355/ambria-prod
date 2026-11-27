import { describe, it, expect } from "vitest";
import { truckExtraLoadsByFn, VIRTUAL_TRUCK_SUB_RENAME } from "./truckExtraLoads";

const fns = [{ fnIdx: 0, fnDate: "2026-12-02" }, { fnIdx: 1, fnDate: "2026-12-01" }];

describe("truckExtraLoadsByFn", () => {
  it("a real inventory item rolls into its own sub-category, and a kit decomposes per component", () => {
    const inventory = [
      { id: "iChair", name: "Cocktail Chair", subCat: "Chairs", cat: "Furniture" },
      {
        id: "iKit", name: "Console Set", subCat: "Consoles", cat: "Furniture",
        subItems: [{ itemId: "sTop", qty: 1 }, { itemId: "sLeg", qty: 4 }],
      },
      { id: "sTop", name: "Console Top", subCat: "Fabric Panels", cat: "Fabric" },
      { id: "sLeg", name: "Console Leg", subCat: "Iron Legs", cat: "Structure" },
    ];
    const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Furniture: [
      { id: "a", invId: "iChair", name: "Cocktail Chair", sub: "Chairs", qty: 3 },
      { id: "b", invId: "iKit", name: "Console Set", sub: "Consoles", qty: 2 },
    ] } }] }];
    const out = truckExtraLoadsByFn(trucks, { inventory, fns, fallbackFnIdx: 0 });
    const loads = out.get(0);
    expect(loads).toEqual(expect.arrayContaining([
      { sub: "Chairs", qty: 3, name: "Cocktail Chair", invCat: "Furniture" },
      { sub: "Consoles", qty: 2, name: "Console Set", invCat: "Furniture" },
      { sub: "Fabric Panels", qty: 2, name: "Console Top", invCat: "Fabric" },
      { sub: "Iron Legs", qty: 8, name: "Console Leg", invCat: "Structure" },
    ]));
    expect(loads).toHaveLength(4);
  });

  it("virtual truss pillars/beams keep their own sub (pc, not folded into the zone's sqft 'Truss' bucket)", () => {
    const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [
      { id: "a", invId: "truss:pillars:iron:8", name: "Pillar 8ft", sub: "Truss Pillar", qty: 5, virtual: true },
      { id: "b", invId: "truss:beams:iron:4", name: "Beam 4ft", sub: "Truss Beam", qty: 10, virtual: true },
    ] } }] }];
    const out = truckExtraLoadsByFn(trucks, { inventory: [], fns, fallbackFnIdx: 0 });
    expect(out.get(0)).toEqual([
      { sub: "Truss Pillar", qty: 5, name: "Pillar 8ft", invCat: "" },
      { sub: "Truss Beam", qty: 10, name: "Beam 4ft", invCat: "" },
    ]);
  });

  it("a virtual platform piece converts qty × its own L×W into the sqft 'Platform' bucket", () => {
    const trussInv = { platforms: [{ id: "p1", label: "8x4", lengthFt: 8, widthFt: 4, material: "wood", stock: 10 }] };
    const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [
      { id: "a", invId: "platform:p1", name: "8x4 · Wood", sub: "Platform", qty: 3, virtual: true },
    ] } }] }];
    const out = truckExtraLoadsByFn(trucks, { inventory: [], trussInv, fns, fallbackFnIdx: 0 });
    expect(out.get(0)).toEqual([{ sub: "Platform", qty: 96, name: "8x4 · Wood", invCat: "" }]); // 3 × 8 × 4
  });

  it("a platform piece whose row can no longer be found (deleted since) contributes nothing", () => {
    const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Tenting: [
      { id: "a", invId: "platform:gone", name: "Old size", sub: "Platform", qty: 2, virtual: true },
    ] } }] }];
    const out = truckExtraLoadsByFn(trucks, { inventory: [], trussInv: { platforms: [] }, fns, fallbackFnIdx: 0 });
    expect(out.get(0) || []).toEqual([]);
  });

  it("virtual fabric colours rename to the zone's own Liza/Curtains/Masking buckets, same unit", () => {
    expect(VIRTUAL_TRUCK_SUB_RENAME["liza fabric"]).toBe("Liza");
    const trucks = [{ id: "T1", trips: [{ id: "r1", custom: { Fabric: [
      { id: "a", invId: "fabric:lizaStock:ivory", name: "Liza Fabric - Ivory (kg)", sub: "Liza Fabric", qty: 12, virtual: true },
      { id: "b", invId: "fabric:curtainStock:gold", name: "Velvet Curtains - Gold (pcs)", sub: "Velvet Curtains", qty: 4, virtual: true },
      { id: "c", invId: "fabric:maskingStock:white", name: "Wall Masking - White (pcs)", sub: "Wall Masking", qty: 6, virtual: true },
    ] } }] }];
    const out = truckExtraLoadsByFn(trucks, { inventory: [], fns, fallbackFnIdx: 0 });
    expect(out.get(0)).toEqual([
      { sub: "Liza", qty: 12, name: "Liza Fabric - Ivory (kg)", invCat: "" },
      { sub: "Curtains", qty: 4, name: "Velvet Curtains - Gold (pcs)", invCat: "" },
      { sub: "Masking", qty: 6, name: "Wall Masking - White (pcs)", invCat: "" },
    ]);
  });

  it("a trip targeted at a function (trip.fnIdx) attributes its extras there, not the fallback", () => {
    const trucks = [{ id: "T1", trips: [
      { id: "r1", fnIdx: 1, custom: { Furniture: [{ id: "a", invId: "i1", name: "Chair", sub: "Chairs", qty: 2 }] } },
      { id: "r2", custom: { Furniture: [{ id: "b", invId: "i1", name: "Chair", sub: "Chairs", qty: 7 }] } }, // untargeted -> fallback (earliest-dated fn)
    ] }];
    const inventory = [{ id: "i1", name: "Chair", subCat: "Chairs" }];
    const out = truckExtraLoadsByFn(trucks, { inventory, fns, fallbackFnIdx: 1 }); // fn 1 (2026-12-01) is earlier than fn 0
    expect(out.get(1)).toEqual([{ sub: "Chairs", qty: 2, name: "Chair", invCat: "" }, { sub: "Chairs", qty: 7, name: "Chair", invCat: "" }]);
    expect(out.has(0)).toBe(false);
  });

  it("no trucks or a non-array: an empty map, never throws", () => {
    expect(truckExtraLoadsByFn(undefined, { fns, fallbackFnIdx: 0 })).toEqual(new Map());
    expect(truckExtraLoadsByFn([], { fns, fallbackFnIdx: 0 })).toEqual(new Map());
  });

  it("a row with qty 0, no invId, or an invId that resolves to no inventory row contributes nothing", () => {
    const trucks = [{ id: "T1", trips: [{ custom: { F: [
      { id: "a", invId: "i1", qty: 0 },
      { id: "b", qty: 5 },
      { id: "c", invId: "gone", qty: 5 },
    ] } }] }];
    const out = truckExtraLoadsByFn(trucks, { inventory: [], fns, fallbackFnIdx: 0 });
    expect(out.get(0) || []).toEqual([]);
  });
});

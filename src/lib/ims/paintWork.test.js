import { describe, it, expect } from "vitest";
import { paintWorkOf } from "./paintWork.js";

const inventory = [
  { id: "A1", name: "Wooden Arch", baseColour: "White", photoUrls: ["https://img/arch.jpg"] },
  { id: "C1", name: "Console Table" }, // no base colour: Ivory
];

describe("paintWorkOf", () => {
  it("lists an element split over colours, leaving out the base-colour units", () => {
    const w = paintWorkOf({
      inventory,
      functionsDetail: [{ type: "Wedding", date: "2026-11-14", elements: { stage: [
        { invId: "A1", name: "Wooden Arch", qty: 6, paintAllocation: [{ qty: 4, colour: "Gold" }, { qty: 2, colour: "White" }] },
      ] } }],
    });
    expect(w.fns).toHaveLength(1);
    const r = w.fns[0].rows[0];
    expect(r).toMatchObject({ name: "Wooden Arch", baseColour: "White", qty: 6, painted: 4, photo: "https://img/arch.jpg", zone: "Stage" });
    expect(r.colours).toEqual([{ colour: "Gold", qty: 4 }]);
    expect(w.pieces).toBe(4);
  });

  it("reads the older single paintOverride for every unit, and skips it when it is the base colour", () => {
    const w = paintWorkOf({
      inventory,
      functionsDetail: [{ elements: { entry: [
        { invId: "C1", name: "Console Table", qty: 2, paintOverride: "Rose Gold" },
        { invId: "A1", name: "Wooden Arch", qty: 3, paintOverride: "White" },
      ] } }],
    });
    expect(w.items).toBe(1);
    expect(w.fns[0].rows[0]).toMatchObject({ name: "Console Table", baseColour: "Ivory", painted: 2 });
  });

  it("an event with no paint has nothing", () => {
    const w = paintWorkOf({ inventory, functionsDetail: [{ elements: { stage: [{ invId: "A1", qty: 4 }] } }] });
    expect(w).toEqual({ fns: [], colours: [], pieces: 0, items: 0, cost: 0 });
  });

  it("joins the same item twice in one zone, keeps zones and functions apart, and totals colours over the event", () => {
    const w = paintWorkOf({
      inventory,
      functionsDetail: [
        { type: "Haldi", elements: {
          stage: [{ invId: "C1", qty: 1, paintOverride: "Yellow" }, { invId: "C1", qty: 2, paintOverride: "Yellow" }],
          entry: [{ invId: "C1", qty: 1, paintOverride: "Yellow" }],
        } },
        { type: "Wedding", elements: { stage: [{ invId: "C1", qty: 5, paintAllocation: [{ qty: 5, colour: "yellow" }] }] } },
      ],
    });
    expect(w.fns.map((f) => f.rows.length)).toEqual([2, 1]);
    expect(w.fns[0].rows.find((r) => r.zk === "stage").painted).toBe(3);
    // the same colour in other capitals is one colour
    expect(w.colours).toEqual([{ colour: "Yellow", qty: 9 }]);
  });

  it("leaves out a zone switched off in Build", () => {
    const w = paintWorkOf({
      inventory,
      functionsDetail: [{ enabledEls: { stage: false }, elements: { stage: [{ invId: "C1", qty: 2, paintOverride: "Red" }] } }],
    });
    expect(w.items).toBe(0);
  });

  it("matches the item by name when the element has no id, and uses the zone's own name", () => {
    const w = paintWorkOf({
      inventory,
      functionsDetail: [{ zoneNames: { custom_1: "Photo Booth" }, elements: { custom_1: [{ name: "wooden  arch", qty: 1, paintOverride: "Pink" }] } }],
    });
    expect(w.fns[0].rows[0]).toMatchObject({ name: "Wooden Arch", invId: "A1", zone: "Photo Booth" });
  });

  it("prices the repaint as Studio does: the item's paint cost, else the default rate", () => {
    const inv = [{ id: "A1", name: "Wooden Arch", baseColour: "White", paintCost: 250 }, { id: "C1", name: "Console Table" }];
    const w = paintWorkOf({
      inventory: inv, defaultPaintCost: 400,
      functionsDetail: [{ elements: { stage: [
        { invId: "A1", name: "Wooden Arch", qty: 6, paintAllocation: [{ qty: 4, colour: "Gold" }, { qty: 2, colour: "White" }] },
        { invId: "C1", name: "Console Table", qty: 2, paintOverride: "Rose Gold" },
      ] } }],
    });
    const byName = Object.fromEntries(w.fns[0].rows.map((r) => [r.name, r.cost]));
    expect(byName).toEqual({ "Wooden Arch": 1000, "Console Table": 800 });
    expect(w.cost).toBe(1800);
  });
});

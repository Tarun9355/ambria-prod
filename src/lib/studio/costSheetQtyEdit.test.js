import { describe, it, expect } from "vitest";
import { costSheetQtyEdit } from "./costSheetQtyEdit.js";

const led = { invId: "led", name: "WARM LED", qty: 206, baseQty: 206 };

describe("costSheetQtyEdit — a quantity typed in the cost sheet, applied to the build's own element", () => {
  it("sets the quantity and keeps baseQty in step (no Scale By)", () => {
    const r = costSheetQtyEdit(led, { key: "led", qty: 150, scale: 1 });
    expect(r.ok).toBe(true);
    expect(r.next).toMatchObject({ qty: 150, baseQty: 150, invId: "led" });
  });
  it("with Scale By 2 the base quantity is half of the new quantity", () => {
    expect(costSheetQtyEdit({ ...led, qty: 20, baseQty: 10 }, { key: "led", qty: 30, scale: 2 }).next).toMatchObject({ qty: 30, baseQty: 15 });
  });
  it("clears the 'asked for N' note — a hand-set number ends it", () => {
    const r = costSheetQtyEdit({ ...led, wantedQty: 400 }, { key: "led", qty: 100, scale: 1 });
    expect(r.next.wantedQty).toBeUndefined();
  });
  it("refuses when the row is no longer the element the sheet line came from", () => {
    expect(costSheetQtyEdit({ invId: "other", name: "Something else", qty: 1 }, { key: "led", qty: 5, scale: 1 }).ok).toBe(false);
    expect(costSheetQtyEdit(undefined, { key: "led", qty: 5, scale: 1 }).ok).toBe(false);
  });
  it("matches a recipe or a name-only element by its own key", () => {
    expect(costSheetQtyEdit({ patternId: "FP2", name: "Flower Trail", qty: 4 }, { key: "FP2", qty: 6, scale: 1 }).ok).toBe(true);
    expect(costSheetQtyEdit({ name: "Hand made thing", qty: 4 }, { key: "Hand made thing", qty: 6, scale: 1 }).ok).toBe(true);
  });
  it("won't go below the units already given a paint colour", () => {
    const painted = { invId: "pot", name: "Pot", qty: 10, paintAllocation: [{ qty: 6, colour: "Red" }] };
    const r = costSheetQtyEdit(painted, { key: "pot", qty: 4, scale: 1, baseColour: "Ivory" });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/below 6/);
    expect(costSheetQtyEdit(painted, { key: "pot", qty: 6, scale: 1, baseColour: "Ivory" }).ok).toBe(true);
  });
  it("floors a negative or non-numeric quantity at 0", () => {
    expect(costSheetQtyEdit(led, { key: "led", qty: -5, scale: 1 }).next.qty).toBe(0);
    expect(costSheetQtyEdit(led, { key: "led", qty: "abc", scale: 1 }).next.qty).toBe(0);
  });
});

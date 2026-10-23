import { describe, it, expect } from "vitest";
import { sheetItemLine } from "./sheetRounding.js";

describe("cost sheet line — Amount is Qty × the whole-rupee Rate shown", () => {
  it("Flower Reet ×42 at ₹258.5: Rate ₹259, Amount ₹10,878 (was ₹10,857 against a ₹259 rate)", () => {
    const l = sheetItemLine({ qty: 42, up: 258.5, lt: 10857 });
    expect(l.rate).toBe(259);
    expect(l.total).toBe(42 * 259);
    expect(l.hasDiscount).toBe(false);
    expect(l.adj).toBe(21);
  });
  it("every line of Test Mukesh's Entry & Passage reads Qty × Rate", () => {
    const rows = [
      { qty: 2, up: 1031.5, lt: 2063 }, { qty: 10, up: 1237.5, lt: 12375 }, { qty: 10, up: 1197.1, lt: 11971 },
      { qty: 30, up: 185.9, lt: 5577 }, { qty: 4, up: 309.5, lt: 1238 },
    ];
    rows.forEach(r => { const l = sheetItemLine(r); expect(l.total).toBe(r.qty * l.rate); expect(Number.isInteger(l.rate)).toBe(true); });
  });
  it("a whole-rupee line is untouched", () => {
    expect(sheetItemLine({ qty: 30, up: 165, lt: 4950 })).toMatchObject({ rate: 165, total: 4950, adj: 0 });
  });
  it("a discounted line: Disc. Rate whole, Amount = Qty × Disc. Rate, List = Qty × Rate", () => {
    const l = sheetItemLine({ qty: 10, up: 400, lt: 3000 });
    expect(l).toMatchObject({ hasDiscount: true, discRate: 300, total: 3000, noDiscTotal: 4000, rate: 400 });
  });
  it("a line whose Amount is not Qty × Rate (short-part split) keeps its true figure", () => {
    const l = sheetItemLine({ qty: 10, up: 500, lt: 5600 });
    expect(l.rate).toBe(500);
    expect(l.total).toBe(5600);
    expect(l.adj).toBe(0);
  });
});

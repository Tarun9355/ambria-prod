import { describe, it, expect } from "vitest";
import { applyQtyCeiling } from "./qtyCeiling.js";

describe("applyQtyCeiling — a typed quantity against the stock ceiling", () => {
  it("under the ceiling: as typed", () => {
    expect(applyQtyCeiling({ typed: 150, current: 206, cap: 227 })).toEqual({ qty: 150 });
  });
  it("exactly at the ceiling: as typed", () => {
    expect(applyQtyCeiling({ typed: 227, current: 206, cap: 227 })).toEqual({ qty: 227 });
  });
  it("past the ceiling from a row under it: held at the ceiling and remembered as asked (400 on 206 → 206, asked 400)", () => {
    expect(applyQtyCeiling({ typed: 400, current: 100, cap: 206 })).toEqual({ qty: 206, wantedQty: 400, clamped: true });
  });
  it("typing the very number already held changes nothing", () => {
    expect(applyQtyCeiling({ typed: 206, current: 206, cap: 206 })).toEqual({ qty: 206 });
  });
  it("a row already above the ceiling cannot go higher, but may go lower or stay", () => {
    expect(applyQtyCeiling({ typed: 1300, current: 1222, cap: 227 })).toMatchObject({ refused: true, qty: 1222 });
    expect(applyQtyCeiling({ typed: 1000, current: 1222, cap: 227 })).toEqual({ qty: 1000 });
    expect(applyQtyCeiling({ typed: 1222, current: 1222, cap: 227 })).toEqual({ qty: 1222 });
  });
  it("no ceiling (made-to-order, no stock owned): anything goes", () => {
    expect(applyQtyCeiling({ typed: 5000, current: 1, cap: null })).toEqual({ qty: 5000 });
    expect(applyQtyCeiling({ typed: 5000, current: 1, cap: NaN })).toEqual({ qty: 5000 });
  });
  it("a ceiling of 0 (nothing free): an increase from 0 is held at 0 and remembered", () => {
    expect(applyQtyCeiling({ typed: 10, current: 0, cap: 0 })).toEqual({ qty: 0, wantedQty: 10, clamped: true });
  });
  it("never lets the typed value through when it is over the ceiling and an increase — exhaustive sweep", () => {
    for (const cap of [0, 1, 5, 206]) for (const current of [0, 1, 5, 206, 300]) for (const typed of [0, 1, 2, 5, 6, 206, 207, 400]) {
      const r = applyQtyCeiling({ typed, current, cap });
      if (typed > cap && typed > current) expect(r.qty).toBeLessThanOrEqual(Math.max(cap, current));
      else expect(r.qty).toBe(typed);
    }
  });
});

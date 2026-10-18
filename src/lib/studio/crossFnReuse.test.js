import { describe, it, expect } from "vitest";
import { groupConsecutiveFns } from "./crossFnReuse";

// Regression coverage for the Dept Ops "Inventory blocked" bug: three (or more) same-day/adjacent-
// day functions at one venue must land in ONE group, not three independent pairwise ones — that's
// what let each function's own reuse pool double/triple-count its siblings' needs as "already
// installed", netting every function's billed+displayed qty toward zero even though nothing was
// actually overbought.
describe("groupConsecutiveFns", () => {
  const fn = (fnVenue, fnDate) => ({ fnVenue, fnDate });

  it("groups three same-day functions at the same venue into one component", () => {
    const fns = [fn("Taj", "2026-10-19"), fn("Taj", "2026-10-19"), fn("Taj", "2026-10-19")];
    const groups = groupConsecutiveFns(fns);
    expect(groups[0]).toBe(groups[1]);
    expect(groups[1]).toBe(groups[2]);
  });

  it("chains a venue's functions across consecutive days into one component", () => {
    const fns = [fn("Taj", "2026-10-19"), fn("Taj", "2026-10-20"), fn("Taj", "2026-10-21")];
    const groups = groupConsecutiveFns(fns);
    expect(groups[0]).toBe(groups[1]);
    expect(groups[1]).toBe(groups[2]);
  });

  it("keeps a different venue in its own group even on the same date", () => {
    const fns = [fn("Taj", "2026-10-19"), fn("Leela", "2026-10-19")];
    const groups = groupConsecutiveFns(fns);
    expect(groups[0]).not.toBe(groups[1]);
  });

  it("keeps the same venue separate across a gap day", () => {
    const fns = [fn("Taj", "2026-10-19"), fn("Taj", "2026-10-22")];
    const groups = groupConsecutiveFns(fns);
    expect(groups[0]).not.toBe(groups[1]);
  });

  it("transitively merges A-B-C even though A and C alone aren't adjacent", () => {
    // A (day 1) touches B (day 2); B (day 2) touches C (day 3) — A and C are 2 days apart on their
    // own, but all three must still land in one group via B.
    const fns = [fn("Taj", "2026-10-19"), fn("Taj", "2026-10-20"), fn("Taj", "2026-10-21")];
    const groups = groupConsecutiveFns(fns);
    expect(new Set(groups).size).toBe(1);
  });

  it("functions missing venue/date never group with anything", () => {
    const fns = [fn("Taj", "2026-10-19"), { fnVenue: "", fnDate: "" }, fn(undefined, undefined)];
    const groups = groupConsecutiveFns(fns);
    expect(groups[0]).not.toBe(groups[1]);
    expect(groups[1]).not.toBe(groups[2]);
  });
});

import { describe, it, expect } from "vitest";
import { loadOnDate } from "./loadByDate.js";

const needOf = (m) => m.n;
const day = (date, ...ns) => ({ date, maps: ns.map((n) => ({ n })) });
const col = (chains, dates) => dates.map((d) => loadOnDate(chains, d, needOf));

describe("loadOnDate — pieces already standing at the venue are reused", () => {
  it("the owner's example: 8 needed on the first day, 12 on the next -> load 8, then 4", () => {
    expect(col([[day("2026-10-19", 8), day("2026-10-20", 12)]], ["2026-10-19", "2026-10-20"])).toEqual([8, 4]);
  });
  it("the Taj sofa: 12 both days, same venue -> load 12, then nothing new", () => {
    expect(col([[day("2026-10-19", 12, 12), day("2026-10-20", 12)]], ["2026-10-19", "2026-10-20"])).toEqual([12, 0]);
  });
  it("a smaller need the next day loads nothing, and the extra stays standing for a later day", () => {
    expect(col([[day("2026-10-19", 12), day("2026-10-20", 5), day("2026-10-21", 9)]], ["2026-10-19", "2026-10-20", "2026-10-21"])).toEqual([12, 0, 0]);
    expect(col([[day("2026-10-19", 5), day("2026-10-20", 12), day("2026-10-21", 9)]], ["2026-10-19", "2026-10-20", "2026-10-21"])).toEqual([5, 7, 0]);
  });
  it("the columns add up to the most needed at once", () => {
    const ns = [3, 9, 4, 12, 6];
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    const chain = [ns.map((n, i) => day(dates[i], n))];
    expect(col(chain, dates).reduce((a, b) => a + b, 0)).toBe(12);
  });
  it("functions on the same date at one venue share the pieces: the largest need counts", () => {
    expect(col([[day("2026-10-19", 12, 12, 7)]], ["2026-10-19"])).toEqual([12]);
  });
  it("a day with no event at the venue in between: the pieces went back, the next date loads in full", () => {
    expect(col([[day("2026-10-19", 8), day("2026-10-21", 12)]], ["2026-10-19", "2026-10-21"])).toEqual([8, 12]);
  });
  it("a different venue is its own chain and adds on the same date", () => {
    expect(col([[day("2026-10-19", 8)], [day("2026-10-19", 5)]], ["2026-10-19"])).toEqual([13]);
  });
  it("a date the venue has no function on loads nothing; an item not needed that day shows 0", () => {
    expect(col([[day("2026-10-19", 8)]], ["2026-10-20"])).toEqual([0]);
    expect(col([[day("2026-10-19", 0), day("2026-10-20", 3)]], ["2026-10-19", "2026-10-20"])).toEqual([0, 3]);
  });
  it("junk needs count as 0; no chains, no loads", () => {
    expect(loadOnDate([[{ date: "2026-10-19", maps: [{ n: "x" }, { n: undefined }] }]], "2026-10-19", needOf)).toBe(0);
    expect(loadOnDate([], "2026-10-19", needOf)).toBe(0);
    expect(loadOnDate(null, "2026-10-19", needOf)).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { rankSites, normSearch } from "./siteSearch";

const ev = (id, clientName, venue, d, off = 0) => ({ e: { id, clientName, venue }, d, off });
const opts = [
  ev("1", "Ajay", "Others", "2026-11-19", 0),
  ev("2", "Aditya", "Canvas", "2026-11-19", 0),
  ev("3", "Ajay Test", "Others", "2026-11-19", 0),
  ev("4", "Ajay Pandey / Pragya Arya", "Exotica · Valencia", "2026-11-20", 1),
  ev("5", "Khyati Hans", "Akasa", "2026-11-20", 1),
  ev("6", "Rakesh Raina", "Pushpanjali", "2026-11-25", 6),
];
const venueOf = (e) => e.venue;
const ids = (q) => rankSites(opts, q, venueOf).map((o) => o.e.id);

describe("rankSites - the 'Add a site' search", () => {
  it("nothing typed (or only spaces / punctuation): the list as it came", () => {
    expect(ids("")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(ids("   ")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(ids(" / ")).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
  it("by guest name, any case; the exact name first, then names starting with it", () => {
    expect(ids("AJAY")).toEqual(["1", "3", "4"]);
    expect(ids("ajay p")).toEqual(["4"]);
  });
  it("by venue, and a venue's sub-venue", () => {
    expect(ids("canvas")).toEqual(["2"]);
    expect(ids("valencia")).toEqual(["4"]);
    expect(ids("push")).toEqual(["6"]);
  });
  it("words in any order, across name and venue", () => {
    expect(ids("pragya ajay")).toEqual(["4"]);
    expect(ids("ajay others")).toEqual(["1", "3"]);
    expect(ids("akasa khyati")).toEqual(["5"]);
  });
  it("one typo, a missing or extra letter, two letters swapped", () => {
    expect(ids("aditiya")).toEqual(["2"]);
    expect(ids("khayti")).toEqual(["5"]);
    expect(ids("valencai")).toEqual(["4"]);
    expect(ids("rakes")).toEqual(["6"]);
  });
  it("typed without the space, or part-way into a word", () => {
    expect(ids("ajaypandey")).toEqual(["4"]);
    expect(ids("kesh")).toEqual(["6"]);
  });
  it("by date: the day, '20 nov', or the ISO date", () => {
    expect(ids("20 nov")).toEqual(["4", "5"]);
    expect(ids("2026-11-25")).toEqual(["6"]);
  });
  it("a name beats a venue with the same word; ties keep the nearest date first", () => {
    const list = [ev("a", "Sharma", "Canvas", "2026-11-19"), ev("b", "Canvas Party", "Akasa", "2026-11-21")];
    expect(rankSites(list, "canvas", venueOf).map((o) => o.e.id)).toEqual(["b", "a"]);
  });
  it("no match: empty; odd input never throws", () => {
    expect(ids("zzzz")).toEqual([]);
    expect(rankSites(undefined, "a")).toEqual([]);
    expect(rankSites([{ e: null, d: null }], "x")).toEqual([]);
    expect(normSearch(null)).toBe("");
  });
});

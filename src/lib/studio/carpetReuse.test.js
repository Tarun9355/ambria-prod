import { describe, it, expect } from "vitest";
import { sameVenueHolds, siblingCarpetUse, reuseAwareAvail } from "./carpetReuse.js";
import { CARPET_OFF } from "./taxonomy.js";

const D = "2027-01-03";
const eo = (id, clientName, venue, fns = []) => ({ id, clientName, venue, functionsDetail: fns });
const orders = [
  eo("eo_a", "Mr. Sharma", "Aura", [{ date: D, venue: "Aura", type: "Haldi" }]),
  eo("eo_b", "Ms. Bansal", "Pushpanjali", [{ date: D, venue: "Pushpanjali", type: "Wedding" }]),
  eo("eo_c", "Mrs. Gupta", "Aura", [{ date: "2027-01-04", venue: "Aura", type: "Wedding" }, { date: D, venue: "Exotica", type: "Mehendi" }]),
];

describe("sameVenueHolds — another event holding the carpet at THIS venue that day", () => {
  it("counts a hold by another client's event at the same venue and date", () => {
    const r = sameVenueHolds([{ eventId: "eo_a", qty: 300, date: D }], orders, "Aura", D, "eo_me");
    expect(r.qty).toBe(300);
    expect(r.who).toEqual([{ eventId: "eo_a", qty: 300, name: "Mr. Sharma · Haldi" }]);
  });
  it("venue match ignores case and spaces", () => {
    expect(sameVenueHolds([{ eventId: "eo_a", qty: 10 }], orders, "  aura ", D, "me").qty).toBe(10);
  });
  it("a hold at another venue is a real conflict, not reuse", () => {
    expect(sameVenueHolds([{ eventId: "eo_b", qty: 300 }], orders, "Aura", D, "me").qty).toBe(0);
  });
  it("uses the venue the event has ON THAT DATE (an event can move venue between its functions)", () => {
    // eo_c is at Aura on the 4th but Exotica on the 3rd
    expect(sameVenueHolds([{ eventId: "eo_c", qty: 50 }], orders, "Exotica", D, "me").qty).toBe(50);
    expect(sameVenueHolds([{ eventId: "eo_c", qty: 50 }], orders, "Aura", D, "me").qty).toBe(0);
  });
  it("this event's own holds, released holds, other dates and unknown events are ignored", () => {
    const r = sameVenueHolds([
      { eventId: "eo_me", qty: 100 },
      { eventId: "eo_a", qty: 100, status: "released" },
      { eventId: "eo_a", qty: 100, date: "2027-01-09" },
      { eventId: "eo_gone", qty: 100 },
      { eventId: "eo_a", qty: 0 },
    ], [...orders, eo("eo_me", "Me", "Aura", [{ date: D, venue: "Aura" }])], "Aura", D, "eo_me");
    expect(r).toEqual({ qty: 0, who: [] });
  });
  it("several holds add up, and each is named", () => {
    const more = [...orders, eo("eo_d", "Mr. Jain", "Aura", [{ date: D, venue: "Aura", type: "Cocktail" }])];
    const r = sameVenueHolds([{ eventId: "eo_a", qty: 100 }, { eventId: "eo_d", qty: 40 }], more, "Aura", D, "me");
    expect(r.qty).toBe(140);
    expect(r.who.map((w) => w.name)).toEqual(["Mr. Sharma · Haldi", "Mr. Jain · Cocktail"]);
  });
  it("no venue, no entries, no orders: nothing", () => {
    expect(sameVenueHolds([{ eventId: "eo_a", qty: 5 }], orders, "", D, "me").qty).toBe(0);
    expect(sameVenueHolds(undefined, orders, "Aura", D, "me").qty).toBe(0);
    expect(sameVenueHolds([{ eventId: "eo_a", qty: 5 }], undefined, "Aura", D, "me").qty).toBe(0);
  });
});

describe("siblingCarpetUse — another function of the same deal at this venue and date", () => {
  const fn = (idx, type, venue, date, zones) => ({ fnIdx: idx, fnType: type, fnVenue: venue, fnDate: date, enabledEls: Object.fromEntries(Object.keys(zones).map((k) => [k, true])), zoneConfig: zones });
  const row = (id) => ({ cpT: "old", floorDims: { L: 10, W: 10 }, cpPrefs: [{ id, name: id, free: 100 }], cpInvId: id });
  const me = fn(0, "Cocktail", "Aura", D, { stage: row("A") });

  it("names a sibling function (same venue + date) whose 1st-choice carpet is this one", () => {
    const hal = fn(1, "Haldi", "Aura", D, { entry: row("A") });
    expect(siblingCarpetUse([me, hal], me, "A")).toEqual(["Haldi · entry"]);
  });
  it("a different carpet, venue or date is not a match", () => {
    expect(siblingCarpetUse([me, fn(1, "Haldi", "Aura", D, { entry: row("B") })], me, "A")).toEqual([]);
    expect(siblingCarpetUse([me, fn(1, "Haldi", "Exotica", D, { entry: row("A") })], me, "A")).toEqual([]);
    expect(siblingCarpetUse([me, fn(1, "Haldi", "Aura", "2027-01-04", { entry: row("A") })], me, "A")).toEqual([]);
  });
  it("itself, a switched-off zone and carpet turned off are ignored", () => {
    const off = fn(1, "Haldi", "Aura", D, { entry: { ...row("A"), cpT: CARPET_OFF } });
    const dis = { ...fn(2, "Sangeet", "Aura", D, { entry: row("A") }), enabledEls: { entry: false } };
    expect(siblingCarpetUse([me, off, dis], me, "A")).toEqual([]);
  });
  it("a sibling floor with no size is not really using it", () => {
    const empty = fn(1, "Haldi", "Aura", D, { entry: { ...row("A"), floorDims: {} } });
    expect(siblingCarpetUse([me, empty], me, "A")).toEqual([]);
  });
  it("each sibling is listed once", () => {
    const hal = fn(1, "Haldi", "Aura", D, { entry: row("A"), lawn: row("A") });
    expect(siblingCarpetUse([me, hal], me, "A")).toEqual(["Haldi · entry", "Haldi · lawn"]);
  });
  it("missing venue/date/id: nothing", () => {
    expect(siblingCarpetUse([me], { ...me, fnVenue: "" }, "A")).toEqual([]);
    expect(siblingCarpetUse([me], me, "")).toEqual([]);
  });
});

describe("reuseAwareAvail", () => {
  it("free stock plus what is already laid here covers the floor", () => {
    expect(reuseAwareAvail(50, 300, 7500, 200)).toEqual({ avail: 350, short: 0 });
  });
  it("still short when even that is not enough", () => {
    expect(reuseAwareAvail(50, 100, 7500, 200)).toEqual({ avail: 150, short: 50 });
  });
  it("never more than the studio owns", () => {
    expect(reuseAwareAvail(100, 900, 300, 1000)).toEqual({ avail: 300, short: 700 });
  });
  it("no reuse: plain free vs need", () => {
    expect(reuseAwareAvail(150, 0, 500, 200)).toEqual({ avail: 150, short: 50 });
  });
});

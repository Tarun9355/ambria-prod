import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shortagesRaisedSince } from "./dealAvailability";
import { reindexFnIdxObject } from "./dealCheckReindex.js";

// Owner rule (2026-11-18): a BOOKED deal's out-of-stock gate stops only for a shortage the salesperson has just caused -
// an item or kit part now needed beyond what the deal already had (its last reservation, or what it needed when opened).
// Anything already short (another deal took the stock, Fixed Venues hold it) does not stop the gate.

// ── shortagesRaisedHere, the REAL source out of StudioApp.jsx (module-level, not exported) ──
// Sliced out of the file and compiled with its two collaborators injected, so these tests follow the shipped merge logic,
// not a hand copy that could drift.
const studioSrc = readFileSync(resolve(__dirname, "../../pages/studio/StudioApp.jsx"), "utf8").replace(/\r\n/g, "\n");
const start = studioSrc.indexOf("async function shortagesRaisedHere(");
const end = studioSrc.indexOf("\n}\n", start);
const fnSrc = studioSrc.slice(start, end + 2);
// fetchReservedInventory(): what the fresh client_ledger read returns for dcReservedInventory (throw = the read fails, undefined = no
// row); units: what it returns for dcReservedUnits. Wrapped as the supabase query shortagesRaisedHere makes.
const makeRaisedHere = (fetchReservedInventory, units = null, win = {}) => {
  const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
    const r = await fetchReservedInventory();
    return { data: r === undefined ? null : { r, u: units }, error: null };
  } }) }) }) };
  // eslint-disable-next-line no-new-func
  return new Function("supabase", "shortagesRaisedSince", "console", "window", `${fnSrc}\nreturn shortagesRaisedHere;`)(
    supabase, shortagesRaisedSince, { warn: () => {} }, win,
  );
};

const inv = [
  { id: "candle", name: "Pillar Candle" },
  { id: "chair", name: "Chair" },
  { id: "lamp", name: "Lamp" },
  { id: "cushion", name: "Cushion" },
  { id: "console", name: "Wooden Console", subItems: [{ itemId: "candle", qty: 6 }] },
  { id: "sofa", name: "Sofa Kit", subItems: [{ itemId: "cushion", qty: 4 }] },
  { id: "lounge", name: "Lounge Kit", subItems: [{ itemId: "sofa", qty: 2 }, { itemId: "lamp", qty: 1 }] },
  { id: "archA", name: "Arch A" },
  { id: "archB", name: "Arch B" },
];
// one function: zones -> element lists, every zone enabled unless listed in `off`
const fnD = (fnIdx, zones, off = []) => ({
  fnIdx,
  zoneElements: zones,
  enabledEls: Object.fromEntries(Object.keys(zones).map((z) => [z, !off.includes(z)])),
});
const row = (fnIdx, invId, extra = {}) => ({ fnIdx, invId, zoneKey: "a", idx: 0, itemOut: true, shortParts: [], need: 1, ...extra });
const partRow = (fnIdx, kitId, parts, extra = {}) => ({ fnIdx, invId: kitId, zoneKey: "a", idx: 0, itemOut: false, shortParts: parts, ...extra });
const ids = (list) => list.map((f) => `${f.fnIdx}:${f.zoneKey}:${f.invId}`);

describe("shortagesRaisedSince - realistic booked-deal scenarios", () => {
  describe("multi-function deal, reservation read back from JSON (string fnIdx keys)", () => {
    const reserved = JSON.parse(JSON.stringify({ 0: { candle: 30 }, 1: { chair: 100 } })); // keys "0","1"
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }] }), fnD(1, { a: [{ invId: "chair", qty: 120 }] })];

    it("function 0 unchanged (old shortage) is dropped, function 1 raised is kept", () => {
      const out = shortagesRaisedSince([row(0, "candle"), row(1, "chair")], reserved, fns, inv);
      expect(ids(out)).toEqual(["1:a:chair"]);
    });

    it("numeric reserved keys behave the same as string keys", () => {
      const out = shortagesRaisedSince([row(0, "candle"), row(1, "chair")], { 0: { candle: 30 }, 1: { chair: 100 } }, fns, inv);
      expect(ids(out)).toEqual(["1:a:chair"]);
    });

    it("an item moved from function 0 to function 1 is new in function 1 (different date) and stops", () => {
      const moved = [fnD(0, { a: [] }), fnD(1, { a: [{ invId: "chair", qty: 100 }, { invId: "candle", qty: 30 }] })];
      expect(ids(shortagesRaisedSince([row(1, "candle")], reserved, moved, inv))).toEqual(["1:a:candle"]);
    });

    it("fns passed out of order are matched by their fnIdx, not their position", () => {
      const out = shortagesRaisedSince([row(0, "candle"), row(1, "chair")], reserved, [fns[1], fns[0]], inv);
      expect(ids(out)).toEqual(["1:a:chair"]);
    });

    it("a function added after the last reservation (nothing reserved for it) keeps every shortage", () => {
      const three = [...fns, fnD(2, { a: [{ invId: "lamp", qty: 1 }] })];
      expect(ids(shortagesRaisedSince([row(2, "lamp")], reserved, three, inv))).toEqual(["2:a:lamp"]);
    });
  });

  describe("same item in two zones of one function is judged by the function total", () => {
    const reserved = { 0: { candle: 30 } };

    it("20 + 10 = the 30 reserved: both rows dropped", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 20 }], b: [{ invId: "candle", qty: 10 }] })];
      const flagged = [row(0, "candle", { zoneKey: "a" }), row(0, "candle", { zoneKey: "b" })];
      expect(shortagesRaisedSince(flagged, reserved, fns, inv)).toEqual([]);
    });

    it("moving 5 from zone a to zone b (total unchanged) does not stop", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 15 }], b: [{ invId: "candle", qty: 15 }] })];
      const flagged = [row(0, "candle", { zoneKey: "a" }), row(0, "candle", { zoneKey: "b" })];
      expect(shortagesRaisedSince(flagged, reserved, fns, inv)).toEqual([]);
    });

    it("adding 5 more in zone b (total 35 > 30) stops - zone b's row is kept", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }], b: [{ invId: "candle", qty: 5 }] })];
      const flagged = [row(0, "candle", { zoneKey: "a" }), row(0, "candle", { zoneKey: "b" })];
      const out = shortagesRaisedSince(flagged, reserved, fns, inv);
      expect(ids(out)).toContain("0:b:candle");
      // NOTE: zone a's unchanged row is listed too (the check is per item per function, not per element)
      expect(ids(out)).toEqual(["0:a:candle", "0:b:candle"]);
    });

    it("a kit part and the same item placed loose add up (console part candles + loose candles)", () => {
      // reserved 30 candles = 5 consoles x 6; a loose 1 candle added elsewhere makes 31
      const fns = [fnD(0, { a: [{ invId: "console", qty: 5 }], b: [{ invId: "candle", qty: 1 }] })];
      const flagged = [row(0, "candle", { zoneKey: "b" })];
      expect(ids(shortagesRaisedSince(flagged, { 0: { console: 5, candle: 30 } }, fns, inv))).toEqual(["0:b:candle"]);
    });
  });

  it("qty lowered below the reservation: dropped (the salesperson made it smaller, not bigger)", () => {
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 20 }] })];
    expect(shortagesRaisedSince([row(0, "candle")], { 0: { candle: 30 } }, fns, inv)).toEqual([]);
  });

  describe("kits", () => {
    const reserved = { 0: { console: 5, candle: 30 } };

    it("kit qty raised so a part's total rises: the part row stops", () => {
      const fns = [fnD(0, { a: [{ invId: "console", qty: 6 }] })];
      const flagged = [partRow(0, "console", [{ id: "candle", need: 36 }])];
      expect(shortagesRaisedSince(flagged, reserved, fns, inv)).toHaveLength(1);
    });

    it("kit shell itself short but unchanged, plus a part short but unchanged: dropped", () => {
      const fns = [fnD(0, { a: [{ invId: "console", qty: 5 }] })];
      const flagged = [partRow(0, "console", [{ id: "candle", need: 30 }], { itemOut: true })];
      expect(shortagesRaisedSince(flagged, reserved, fns, inv)).toEqual([]);
    });

    it("kit qty lowered: a part still short is not this edit's", () => {
      const fns = [fnD(0, { a: [{ invId: "console", qty: 3 }] })];
      expect(shortagesRaisedSince([partRow(0, "console", [{ id: "candle", need: 18 }])], reserved, fns, inv)).toEqual([]);
    });

    it("nested kits: lounge > sofa > cushion - unchanged dropped, one more lounge stops on the grandchild", () => {
      // 2 lounges = 4 sofas = 16 cushions, 2 lamps
      const res = { 0: { lounge: 2, sofa: 4, cushion: 16, lamp: 2 } };
      const same = [fnD(0, { a: [{ invId: "lounge", qty: 2 }] })];
      const more = [fnD(0, { a: [{ invId: "lounge", qty: 3 }] })];
      const flagged = [partRow(0, "lounge", [{ id: "cushion", need: 16 }])];
      expect(shortagesRaisedSince(flagged, res, same, inv)).toEqual([]);
      expect(shortagesRaisedSince(flagged, res, more, inv)).toHaveLength(1);
    });

    it("kitOverrides on the element: 8 candles per console instead of 6 is a raise (40 > 30) and stops", () => {
      const fns = [fnD(0, { a: [{ invId: "console", qty: 5, kitOverrides: [{ itemId: "candle", qty: 8 }] }] })];
      expect(shortagesRaisedSince([partRow(0, "console", [{ id: "candle", need: 40 }])], reserved, fns, inv)).toHaveLength(1);
    });

    it("kitOverrides swapping candles for lamps: the lamp is newly needed and stops", () => {
      const fns = [fnD(0, { a: [{ invId: "console", qty: 5, kitOverrides: [{ itemId: "lamp", qty: 6 }] }] })];
      expect(shortagesRaisedSince([partRow(0, "console", [{ id: "lamp", need: 30 }])], reserved, fns, inv)).toHaveLength(1);
    });

    it("kitOverrides cutting the part count (6 -> 4 per console): an old candle shortage is dropped", () => {
      const fns = [fnD(0, { a: [{ invId: "console", qty: 5, kitOverrides: [{ itemId: "candle", qty: 4 }] }] })];
      expect(shortagesRaisedSince([partRow(0, "console", [{ id: "candle", need: 20 }])], reserved, fns, inv)).toEqual([]);
    });

    it("a row with several short parts stops if ANY one of them was raised", () => {
      const res = { 0: { lounge: 2, sofa: 4, cushion: 16, lamp: 2 } };
      const fns = [fnD(0, { a: [{ invId: "lounge", qty: 2, kitOverrides: [{ itemId: "sofa", qty: 2 }, { itemId: "lamp", qty: 2 }] }] })];
      const flagged = [partRow(0, "lounge", [{ id: "cushion", need: 16 }, { id: "lamp", need: 4 }])];
      expect(shortagesRaisedSince(flagged, res, fns, inv)).toHaveLength(1);
    });
  });

  describe("FOC / disabled zones / qty 0", () => {
    it("a FOC element counts nothing (left at the venue, never reserved): its row is dropped", () => {
      const fns = [fnD(0, { a: [{ invId: "chair", qty: 50, foc: true }] })];
      expect(shortagesRaisedSince([row(0, "chair")], { 0: { candle: 30 } }, fns, inv)).toEqual([]);
    });

    it("un-FOC'ing an element (now paid, now drawn from stock, never reserved) stops", () => {
      const fns = [fnD(0, { a: [{ invId: "chair", qty: 50 }] })];
      expect(shortagesRaisedSince([row(0, "chair")], { 0: { candle: 30 } }, fns, inv)).toHaveLength(1);
    });

    it("FOC copy of an item in one zone does not inflate the paid copy's total", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }], b: [{ invId: "candle", qty: 10, foc: true }] })];
      expect(shortagesRaisedSince([row(0, "candle")], { 0: { candle: 30 } }, fns, inv)).toEqual([]);
    });

    it("an element in a disabled zone counts nothing", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }], b: [{ invId: "candle", qty: 10 }] }, ["b"])];
      expect(shortagesRaisedSince([row(0, "candle")], { 0: { candle: 30 } }, fns, inv)).toEqual([]);
    });

    it("re-enabling a zone (its items now drawn again, beyond the reservation) stops", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }], b: [{ invId: "candle", qty: 10 }] })];
      expect(shortagesRaisedSince([row(0, "candle", { zoneKey: "b" })], { 0: { candle: 30 } }, fns, inv)).toHaveLength(1);
    });

    it("an element with qty 0 adds nothing", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }], b: [{ invId: "candle", qty: 0 }, { invId: "console", qty: 0 }] })];
      expect(shortagesRaisedSince([row(0, "candle")], { 0: { candle: 30 } }, fns, inv)).toEqual([]);
    });
  });

  describe("reservation shape", () => {
    it("extra ids in the reservation (items since removed) change nothing", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }, { invId: "lamp", qty: 2 }] })];
      const res = { 0: { candle: 30, ghost: 99, chair: 400, archB: 6 } };
      expect(ids(shortagesRaisedSince([row(0, "candle"), row(0, "lamp")], res, fns, inv))).toEqual(["0:a:lamp"]);
    });

    it("a function whose reservation is empty ({}) keeps every row with a need", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 1 }] })];
      expect(shortagesRaisedSince([row(0, "candle")], { 0: {} }, fns, inv)).toHaveLength(1);
    });

    it("reservation qty stored as a string still compares numerically", () => {
      const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }] })];
      expect(shortagesRaisedSince([row(0, "candle")], { 0: { candle: "30" } }, fns, inv)).toEqual([]);
    });

    it("fractional kit-part totals (walkKitUnits round6) do not false-trigger at equality", () => {
      const fracInv = [...inv, { id: "half", name: "Half kit", subItems: [{ itemId: "candle", qty: 1 / 3 }] }];
      const fns = [fnD(0, { a: [{ invId: "half", qty: 3 }] })];
      expect(shortagesRaisedSince([partRow(0, "half", [{ id: "candle", need: 1 }])], { 0: { half: 3, candle: 1 } }, fns, fracInv)).toEqual([]);
    });

    it("garbage input does not throw", () => {
      expect(() => shortagesRaisedSince(null, { 0: {} }, null, null)).not.toThrow();
      expect(shortagesRaisedSince([null, { fnIdx: 0 }], { 0: { a: 1 } }, [], inv)).toHaveLength(2);
      expect(() => shortagesRaisedSince([row(0, "candle")], { 0: null }, undefined, undefined)).not.toThrow();
    });

    // Not reachable today (scanOutOfStockElements' fnIdx is always a number from allFunctionData), kept as a robustness
    // note: a flagged row carrying a STRING fnIdx finds no function (strict ===), counts 0 units, and is dropped although
    // the item is brand new.
    it.fails("a flagged row with a string fnIdx is still judged against its function [robustness - fails today]", () => {
      const fns = [fnD(0, { a: [{ invId: "lamp", qty: 3 }] })];
      expect(shortagesRaisedSince([row("0", "lamp")], { 0: { candle: 30 } }, fns, inv)).toHaveLength(1);
    });
  });
});

describe("shortagesRaisedHere (real StudioApp source): reservation merged with the on-open snapshot", () => {
  it("the source slice was found", () => {
    expect(start).toBeGreaterThan(0);
    expect(fnSrc).toMatch(/shortagesRaisedSince\(list, base, fns, inventory\)/);
  });

  const cli = { id: "c1", dcReservedInventory: { 0: { candle: 10 } } };

  it("fresh read wins over the tab's copy; base = per-item max(reserved, opened)", async () => {
    const here = makeRaisedHere(async () => ({ 0: { candle: 30 } }));
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 36 }] })];
    // reserved 30, opened 36 -> 36 is not a raise
    expect(await here([row(0, "candle")], cli, fns, inv, { 0: { candle: 36 } })).toEqual([]);
    // reserved 30, opened 20 (lowered since last reconcile, then raised again to 36) -> beyond both -> stops
    expect(await here([row(0, "candle")], cli, fns, inv, { 0: { candle: 20 } })).toHaveLength(1);
  });

  it("fresh read failing falls back to the tab's copy", async () => {
    const here = makeRaisedHere(async () => { throw new Error("offline"); });
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 10 }] })];
    expect(await here([row(0, "candle")], cli, fns, inv, undefined)).toEqual([]);
  });

  it("fresh read returning undefined (no client id) falls back to the tab's copy, no crash", async () => {
    const here = makeRaisedHere(async () => undefined);
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 11 }] })];
    expect(await here([row(0, "candle")], { dcReservedInventory: { 0: { candle: 10 } } }, fns, inv, undefined)).toHaveLength(1);
    expect(await here([row(0, "candle")], undefined, fns, inv, undefined)).toHaveLength(1); // nothing reserved -> all stop
  });

  it("nothing reserved (fresh null) but an on-open snapshot exists: the snapshot alone is the baseline", async () => {
    const here = makeRaisedHere(async () => null);
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }, { invId: "lamp", qty: 1 }] })];
    const out = await here([row(0, "candle"), row(0, "lamp")], cli, fns, inv, { 0: { candle: 30 } });
    expect(ids(out)).toEqual(["0:a:lamp"]);
  });

  it("neither reservation nor snapshot: every row stops", async () => {
    const here = makeRaisedHere(async () => null);
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 30 }] })];
    expect(await here([row(0, "candle")], cli, fns, inv, undefined)).toHaveLength(1);
    expect(await here([row(0, "candle")], cli, fns, inv, {})).toHaveLength(1);
  });

  it("string ('0' from JSON) and numeric (0 from the snapshot) function keys merge into one baseline", async () => {
    const here = makeRaisedHere(async () => JSON.parse('{"0":{"candle":30}}'));
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 36 }, { invId: "console", qty: 1 }] })];
    const out = await here([row(0, "candle"), partRow(0, "console", [{ id: "candle", need: 6 }])], cli, fns, inv, { 0: { candle: 35 } });
    // 36 + 6 = 42 needed, base max(30, 35) = 35 -> raised: both rows naming candle stop
    expect(out).toHaveLength(2);
  });

  it("a kit part the old reservation never walked (absent from reserved) but present on opening is not a raise", async () => {
    const here = makeRaisedHere(async () => ({ 0: { console: 5 } })); // old-style reservation: kit shell only
    const fns = [fnD(0, { a: [{ invId: "console", qty: 5 }] })];
    expect(await here([partRow(0, "console", [{ id: "candle", need: 30 }])], cli, fns, inv, { 0: { console: 5, candle: 30 } })).toEqual([]);
  });

  it("Deal Check split card: reserved holds the split ids (archA 4 + archB 6), Build still says archA 10 - the snapshot covers it", async () => {
    const here = makeRaisedHere(async () => ({ 0: { archA: 4, archB: 6 } }));
    const fns = [fnD(0, { a: [{ invId: "archA", qty: 10 }] })];
    expect(await here([row(0, "archA")], cli, fns, inv, { 0: { archA: 10 } })).toEqual([]);
  });

  it("an empty flagged list short-circuits without reading the reservation", async () => {
    let called = 0;
    const here = makeRaisedHere(async () => { called++; return {}; });
    expect(await here([], cli, [], inv, undefined)).toEqual([]);
    expect(called).toBe(0);
  });

  // Removing a function drops this tab's opened snapshot to {} (StudioApp) and reindexes the saved reservation and units.
  it("after removing function 0, a brand-new short item in the shifted function still stops", async () => {
    const reservedBefore = { 0: { candle: 50 }, 1: { chair: 10 } };
    const here = makeRaisedHere(async () => reindexFnIdxObject(reservedBefore, 0)); // the row is reindexed: { 0: { chair: 10 } }
    const fns = [fnD(0, { a: [{ invId: "chair", qty: 10 }, { invId: "candle", qty: 50 }] })];
    expect(await here([row(0, "candle")], cli, fns, inv, {})).toHaveLength(1);
  });

  // dcReservedUnits (saved only by a reconcile that went through) is the baseline once the deal has one - an edit the gate
  // stopped stays new after a refresh, in another tab, or in the IMS sweep (testing review 2026-11-18).
  it("a raise the gate stopped is still new after a refresh: the saved units win over the reopened snapshot", async () => {
    const here = makeRaisedHere(async () => ({ 0: { candle: 30 } }), { 0: { candle: 30 } });
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 40 }] })];
    expect(await here([row(0, "candle")], cli, fns, inv, { 0: { candle: 40 } })).toHaveLength(1);
  });

  it("saved units cover kit parts the old reservation never walked", async () => {
    const here = makeRaisedHere(async () => ({ 0: { console: 5 } }), { 0: { console: 5, candle: 30 } });
    const fns = [fnD(0, { a: [{ invId: "console", qty: 5 }] })];
    expect(await here([partRow(0, "console", [{ id: "candle", need: 30 }])], cli, fns, inv, undefined)).toEqual([]);
  });

  it("the hidden IMS sweep never uses the opened snapshot (it opens the saved, maybe raised, build)", async () => {
    const here = makeRaisedHere(async () => ({ 0: { candle: 30 } }), null, { __AMBRIA_SWEEP__: true });
    const fns = [fnD(0, { a: [{ invId: "candle", qty: 40 }] })];
    expect(await here([row(0, "candle")], cli, fns, inv, { 0: { candle: 40 } })).toHaveLength(1);
  });
});

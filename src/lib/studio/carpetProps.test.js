// Randomised checks of the carpet logic (seeded, so a failure is reproducible): the invariants that must hold for ANY input.
import { describe, it, expect } from "vitest";
import { prefsOf, prefsPatch, setPrefsPatch, assignCarpets, carpetRemainingFor, CARPET_PREF_MAX } from "./carpetPrefs.js";
import { sameVenueHolds, reuseAwareAvail } from "./carpetReuse.js";
import { planCarpets, carpetFloorsOf, freeForEvent } from "../ims/carpetPlan.js";

// small deterministic PRNG (mulberry32)
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const IDS = ["A", "B", "C", "D", "E", "F"];
const randPref = (r) => ({ id: pick(r, IDS), name: "n", free: r() < 0.15 ? null : Math.floor(r() * 600) });

describe("prefsPatch / setPrefsPatch — any sequence of edits keeps the floor consistent", () => {
  it("never duplicates, never exceeds the cap, and always mirrors the 1st choice into cpInvId", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      let row = {};
      for (let step = 0; step < 25; step++) {
        const op = r();
        if (op < 0.55) row = { ...row, ...prefsPatch(row, Math.floor(r() * 6) - 1, randPref(r)) };
        else if (op < 0.8) row = { ...row, ...prefsPatch(row, Math.floor(r() * 5), null) };
        else if (op < 0.95) row = { ...row, ...setPrefsPatch(Array.from({ length: Math.floor(r() * 7) }, () => randPref(r))) };
        else row = { ...row, cpInvId: pick(r, [null, "A", "Z"]) }; // an older writer that touches the single pick only
        const list = prefsOf(row);
        const ids = list.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(list.length).toBeLessThanOrEqual(CARPET_PREF_MAX);
        if (row.cpPrefs && !(op >= 0.95)) {
          // after one of OUR writers the mirror is exact
          expect(row.cpInvId).toBe(list[0]?.id ?? null);
          expect(row.cpInvName).toBe(list[0]?.name ?? "");
        }
        // reading never invents a carpet that was not written
        list.forEach((p) => expect(["A", "B", "C", "D", "E", "F", "Z"]).toContain(p.id));
      }
    }
  });
  it("a stale cpPrefs behind a changed or cleared cpInvId never resurrects the old picks", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const base = setPrefsPatch(Array.from({ length: 4 }, () => randPref(r)));
      const cleared = { ...base, cpInvId: null };
      expect(prefsOf(cleared)).toEqual([]);
      const swapped = { ...base, cpInvId: "Z", cpInvName: "zed", cpInvFree: 9 };
      expect(prefsOf(swapped)[0].id).toBe("Z");
    }
  });
});

describe("assignCarpets", () => {
  // the original one-pick rule, written out independently, for comparison
  const oldRule = (floors) => {
    const used = {}, short = {};
    floors.forEach((f) => {
      const p = f.prefs[0];
      if (!p || p.free == null || !(f.area > 0)) return;
      const before = used[p.id] || 0;
      used[p.id] = before + f.area;
      const s = Math.min(f.area, Math.max(0, before + f.area - p.free));
      if (s > 0) short[f.key] = s;
    });
    return short;
  };
  it("with one preference per floor it is exactly the old single-pick rule", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      const floors = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({ key: "f" + i, area: Math.floor(r() * 400), prefs: r() < 0.1 ? [] : [randPref(r)] }));
      expect(assignCarpets(floors).short).toEqual(oldRule(floors));
    }
  });
  it("invariants for 1-4 preferences: short is within [0, area], a floor that fits somewhere is never short, ids come from its own prefs", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed * 7);
      const floors = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({
        key: "f" + i, area: Math.floor(r() * 400),
        prefs: Array.from({ length: Math.floor(r() * 5) }, () => randPref(r)).filter((p, j, a) => a.findIndex((x) => x.id === p.id) === j),
      }));
      const { assign, short } = assignCarpets(floors);
      const used = {};
      floors.forEach((f) => {
        const s = short[f.key] || 0;
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(f.area);
        if (assign[f.key] != null) expect(f.prefs.map((p) => p.id)).toContain(assign[f.key]);
        const known = f.prefs.filter((p) => p.free != null);
        if (f.area > 0 && known.length) {
          const fits = known.some((p) => (used[p.id] || 0) + f.area <= p.free);
          if (fits) expect(s).toBe(0);
          else expect(s).toBeGreaterThan(0);
          // replay what it took, to keep `used` in step with the function
          const took = known.find((p) => p.id === assign[f.key]);
          if (took) used[took.id] = (used[took.id] || 0) + f.area;
        }
      });
    }
  });
  it("adding a preference can only reduce the shortage, never create one", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed * 13);
      const floors = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({ key: "f" + i, area: 1 + Math.floor(r() * 300), prefs: [randPref(r)].filter((p) => p.free != null) }));
      const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
      const before = total(assignCarpets(floors).short);
      // give every floor that already has a checkable preference one more, appended last (a floor with none was never checked at all —
      // giving it a first one makes it checkable, which is a different thing)
      const more = floors.map((f) => (f.prefs.length ? { ...f, prefs: [...f.prefs, { id: "X" + f.key, name: "x", free: Math.floor(r() * 500) }] } : f));
      expect(total(assignCarpets(more).short)).toBeLessThanOrEqual(before);
    }
  });
});

describe("carpetRemainingFor", () => {
  it("never exceeds the biggest free figure among the floor's preferences, and is null only without a known one", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed * 3);
      const floors = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({ key: "f" + i, area: Math.floor(r() * 300), prefs: Array.from({ length: Math.floor(r() * 4) }, () => randPref(r)).filter((p, j, a) => a.findIndex((x) => x.id === p.id) === j) }));
      const k = pick(r, floors).key;
      const mine = floors.find((f) => f.key === k);
      const known = mine.prefs.filter((p) => p.free != null);
      const rem = carpetRemainingFor(floors, k);
      if (!known.length) expect(rem).toBeNull();
      else expect(rem).toBeLessThanOrEqual(Math.max(...known.map((p) => p.free)));
    }
  });
});

describe("same-day reuse maths", () => {
  it("reuseAwareAvail: avail never exceeds what is owned, short never negative, short = 0 exactly when avail covers need", () => {
    for (let seed = 1; seed <= 600; seed++) {
      const r = rng(seed * 5);
      const free = Math.floor(r() * 500), reuse = Math.floor(r() * 500), total = r() < 0.2 ? undefined : 1 + Math.floor(r() * 800), need = Math.floor(r() * 900);
      const { avail, short } = reuseAwareAvail(free, reuse, total, need);
      expect(short).toBeGreaterThanOrEqual(0);
      if (total) expect(avail).toBeLessThanOrEqual(total);
      expect(avail).toBeLessThanOrEqual(free + reuse);
      expect(short === 0).toBe(avail >= need);
    }
  });
  it("sameVenueHolds never counts the event itself, a released hold, another date or another venue", () => {
    const D = "2027-01-03";
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 11);
      const venues = ["Aura", "Exotica"];
      const orders = Array.from({ length: 5 }, (_, i) => ({ id: "e" + i, clientName: "c" + i, venue: pick(r, venues), functionsDetail: [{ date: pick(r, [D, "2027-01-04"]), venue: pick(r, venues), type: "T" }] }));
      const entries = Array.from({ length: 8 }, () => ({ eventId: pick(r, ["e0", "e1", "e2", "e3", "e4", "gone"]), qty: Math.floor(r() * 100), date: D, status: pick(r, [undefined, "held", "released"]) }));
      const self = "e0";
      const out = sameVenueHolds(entries, orders, "Aura", D, self);
      let expected = 0;
      entries.forEach((b) => {
        if (b.eventId === self || b.status === "released") return;
        const eo = orders.find((o) => o.id === b.eventId);
        if (!eo) return;
        const fn = eo.functionsDetail.find((f) => f.date === D);
        if (String(fn?.venue || eo.venue).toLowerCase() !== "aura") return;
        if (b.qty > 0) expected += b.qty;
      });
      expect(out.qty).toBe(expected);
      expect(out.who.reduce((a, w) => a + w.qty, 0)).toBe(out.qty);
    }
  });
});

describe("planCarpets — structural invariants on random events", () => {
  it("decided ids are real options, 'decided' status iff a decision stands, over only names decided carpets", () => {
    const D = "2027-01-03";
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 17);
      const items = Object.fromEntries(IDS.map((id) => [id, { id, name: "n" + id, qty: Math.floor(r() * 500), blocked: 0, subCat: "carpet" }]));
      const mkRow = () => ({ cpT: pick(r, ["old", "old", "__off__"]), floorDims: { L: Math.floor(r() * 30), W: Math.floor(r() * 30) }, cpPrefs: Array.from({ length: Math.floor(r() * 5) }, () => ({ id: pick(r, IDS), name: "n", free: Math.floor(r() * 400) })).filter((p, j, a) => a.findIndex((x) => x.id === p.id) === j) });
      const fns = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, fi) => ({ fnIdx: fi, date: pick(r, [D, D, "2027-01-04"]), venue: pick(r, ["Aura", "Exotica"]), type: "F" + fi, enabledEls: { s: true, e: true }, zones: { s: { ...mkRow(), extraPlatformRows: r() < 0.3 ? [mkRow()] : [] }, e: mkRow() } }));
      // mirror the 1st choice like the app does
      fns.forEach((f) => Object.values(f.zones).forEach((z) => [z, ...(z.extraPlatformRows || [])].forEach((row) => { row.cpInvId = row.cpPrefs[0]?.id || null; row.cpInvName = "n"; row.cpInvFree = row.cpPrefs[0]?.free ?? null; })));
      const floors = carpetFloorsOf(fns);
      const choice = {};
      floors.forEach((f) => { if (r() < 0.6) choice[f.key] = { id: pick(r, IDS), name: "x", manual: r() < 0.5 }; });
      const blocks = Object.fromEntries(IDS.map((id) => [id, [{ date: D, eventId: pick(r, ["eo_x", "eo_y"]), qty: Math.floor(r() * 300), status: "held" }]]));
      const orders = [{ id: "eo_x", clientName: "X", venue: "Aura", functionsDetail: [{ date: D, venue: "Aura" }] }, { id: "eo_y", clientName: "Y", venue: "Exotica", functionsDetail: [{ date: D, venue: "Exotica" }] }];
      const { rows, over } = planCarpets({ floors, itemsById: items, blocks, eventId: "eo_me", choice, eventOrders: orders });
      expect(rows.length).toBe(floors.length);
      rows.forEach((row) => {
        const opts = [...row.options, row.manual].filter(Boolean);
        if (row.decidedId) { expect(opts.map((o) => o.id)).toContain(row.decidedId); expect(row.status).toBe("decided"); }
        else expect(row.status).not.toBe("decided");
        row.options.forEach((o) => { expect(o.short === null || o.short >= 0).toBe(true); if (o.known) expect(o.enough).toBe(o.short === 0); });
        if (row.manual) expect(choice[row.key]?.manual).toBe(true);
      });
      Object.keys(over).forEach((id) => expect(rows.some((row) => row.decidedId === id)).toBe(true));
    }
  });
  it("freeForEvent is never negative", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const item = { id: "A", qty: Math.floor(r() * 300), blocked: Math.floor(r() * 50) };
      const blocks = { A: Array.from({ length: 5 }, () => ({ date: "d", eventId: pick(r, ["a", "b", "me"]), qty: Math.floor(r() * 200), status: pick(r, [undefined, "released"]) })) };
      expect(freeForEvent(item, blocks, "d", "me")).toBeGreaterThanOrEqual(0);
    }
  });
});

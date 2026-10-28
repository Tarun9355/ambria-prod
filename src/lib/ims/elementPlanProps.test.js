import { describe, it, expect } from "vitest";
import { planElements, choiceElementsOf } from "./elementPlan.js";
import { elementChoices, applyChoicePicks } from "../studio/elementPrefs.js";

// Seeded randomized checks of the invariants the plan must always keep, whatever the layout, stock and decisions.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

function world(seed) {
  const r = rng(seed);
  const ids = ["A", "B", "C", "D", "E", "F"];
  const itemsById = Object.fromEntries(ids.map((id) => [id, { id, name: "n" + id, qty: int(r, 0, 60), blocked: int(r, 0, 3), subCat: "OVERLAYS" }]));
  const dates = ["2027-01-03", "2027-01-04"];
  const blocks = {};
  ids.forEach((id) => { blocks[id] = Array.from({ length: int(r, 0, 3) }, () => ({ date: pick(r, dates), qty: int(r, 1, 25), eventId: pick(r, ["E1", "OTHER", "OTHER2"]), status: pick(r, ["blocked", "released"]) })); });
  const fns = Array.from({ length: int(r, 1, 3) }, (_, fi) => {
    const zones = ["stage", "entry", "lounge"];
    const elements = {};
    const enabledEls = {};
    zones.forEach((zk) => {
      enabledEls[zk] = r() < 0.8;
      elements[zk] = Array.from({ length: int(r, 0, 4) }, (_, ei) => {
        const first = pick(r, ids);
        const base = { invId: first, name: "n" + first, unit: "Pieces", qty: int(r, 0, 40) };
        if (r() < 0.6) {
          const rest = ids.filter((x) => x !== first).sort(() => r() - 0.5).slice(0, int(r, 1, 3));
          return applyChoicePicks(base, [first, ...rest].map((id) => ({ id, name: "n" + id, free: int(r, 0, 60) })), [], () => `p${fi}${zk}${ei}`);
        }
        return base;
      });
    });
    return { fnIdx: fi, type: pick(r, ["Wedding", "Haldi"]), date: pick(r, dates), venue: "V", enabledEls, elements };
  });
  const rows = choiceElementsOf(fns);
  const choice = {};
  rows.forEach((row) => {
    const t = r();
    if (t < 0.25) choice[row.key] = { id: pick(r, row.prefs).id, date: row.date, fnType: row.fnLabel };
    else if (t < 0.35) choice[row.key] = { other: true, date: row.date, fnType: row.fnLabel };
    else if (t < 0.45) choice[row.key] = { id: pick(r, ids), manual: true, date: row.date, fnType: row.fnLabel };
    else if (t < 0.55) choice[row.key] = { id: pick(r, row.prefs).id, date: "1999-01-01", fnType: row.fnLabel };
    else if (t < 0.6) choice[row.key] = { id: "Z", date: row.date, fnType: row.fnLabel };
  });
  return { fns, itemsById, blocks, choice };
}

describe("elementPlan invariants (randomized)", () => {
  for (let seed = 1; seed <= 150; seed++) {
    it(`seed ${seed}`, () => {
      const w = world(seed);
      const plan = planElements({ functionsDetail: w.fns, itemsById: w.itemsById, blocks: w.blocks, eventId: "E1", choice: w.choice });
      const keys = new Set();
      plan.rows.forEach((row) => {
        expect(keys.has(row.key)).toBe(false); keys.add(row.key);
        // every row is a real element with at least two choices, a positive quantity, and its first choice is its own item
        expect(row.options.length).toBeGreaterThanOrEqual(2);
        expect(row.qty).toBeGreaterThan(0);
        const ch = elementChoices(w.fns[row.fi].elements[row.zk][row.ei]);
        expect(ch.map((c) => c.id)).toEqual(row.options.map((o) => o.id));
        // a design is "enough" exactly when its free quantity covers the whole quantity; short is the gap
        row.options.forEach((o) => {
          if (o.known) { expect(o.enough).toBe(o.free >= row.qty); expect(o.short).toBe(Math.max(0, row.qty - o.free)); expect(o.free).toBeGreaterThanOrEqual(0); expect(o.free).toBeLessThanOrEqual(o.rawFree); }
        });
        // the suggestion is the first that covers it; none covers it -> status short (when something is known)
        const firstEnough = row.options.find((o) => o.enough);
        if (firstEnough) expect(row.suggestedId).toBe(firstEnough.id);
        expect(row.options.map((o) => o.id)).toContain(row.suggestedId);
        if (row.status === "short") expect(row.options.some((o) => o.enough)).toBe(false);
        // decided means: one of the choices, a hand pick, or arranged separately — never a stale or foreign decision
        const d = w.choice[row.key];
        const first = row.options[0];
        const firstUsable = !!first && (first.enough || !first.known);
        if (row.status === "decided" && row.byDefault) {
          // no valid decision was saved: sales' 1st choice stands, and only when it is usable that day
          expect(row.decidedId).toBe(first.id);
          expect(firstUsable).toBe(true);
          if (d && d.date === row.date && d.id && (d.other || d.manual || row.options.some((o) => o.id === d.id))) throw new Error("a valid decision was overridden by the default");
        } else if (row.status === "decided") {
          expect(!!d).toBe(true);
          expect(d.date).toBe(row.date);
          if (row.other) expect(row.decidedId).toBe(null);
          else if (row.options.some((o) => o.id === row.decidedId)) expect(d.id).toBe(row.decidedId);
          else { expect(d.manual).toBe(true); expect(row.manual?.id).toBe(row.decidedId); }
        } else {
          if (d && d.date === row.date && d.id && (d.other || d.manual || row.options.some((o) => o.id === d.id))) throw new Error("a valid decision was ignored");
          // undecided only when the 1st choice cannot be used by default
          expect(firstUsable).toBe(false);
        }
      });
      // over-commit is flagged exactly when the decided elements (and plain elements) on one date need more than is free
      Object.entries(plan.over).forEach(([id, o]) => { expect(o.committed).toBeGreaterThan(o.free); expect(typeof id).toBe("string"); });
    });
  }

  it("the generated worlds really contain elements with choices, decided ones and over-commits (the checks above are not vacuous)", () => {
    let rows = 0, decided = 0, manual = 0, other = 0, over = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const w = world(seed);
      const plan = planElements({ functionsDetail: w.fns, itemsById: w.itemsById, blocks: w.blocks, eventId: "E1", choice: w.choice });
      rows += plan.rows.length; decided += plan.rows.filter((r) => r.status === "decided").length; manual += plan.rows.filter((r) => r.manual).length; other += plan.rows.filter((r) => r.other).length; over += Object.keys(plan.over).length;
    }
    expect(rows).toBeGreaterThan(300); expect(decided).toBeGreaterThan(50); expect(manual).toBeGreaterThan(5); expect(other).toBeGreaterThan(5); expect(over).toBeGreaterThan(0);
  });
});

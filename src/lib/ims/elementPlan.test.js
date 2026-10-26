import { describe, it, expect } from "vitest";
import { choiceElementsOf, planElements, elementStockFor, elementKey } from "./elementPlan.js";

const P = (id, name = "n" + id, free = 100) => ({ id, name, free });
const item = (id, qty, sub = "OVERLAYS", name = "Overlay " + id) => ({ id, name, qty, subCat: sub });
const ITEMS = { A: item("A", 30), B: item("B", 50), C: item("C", 10), D: item("D", 5) };
const el = (pid, prefs, qty = 20, extra = {}) => ({ invId: prefs[0].id, name: "n" + prefs[0].id, qty, unit: "Pieces", pid, prefs, ...extra });
const fn = (elements, extra = {}) => ({ fnIdx: 0, type: "Wedding", date: "2027-01-03", venue: "Taj", enabledEls: { stage: true, entry: true }, elements, ...extra });
const run = (functionsDetail, over = {}) => planElements({ functionsDetail, itemsById: ITEMS, blocks: {}, eventId: "E1", choice: {}, ...over });
const dec = (id, extra = {}) => ({ id, name: "n" + id, date: "2027-01-03", fnType: "Wedding", ...extra });

describe("choiceElementsOf", () => {
  it("lists elements that have choices, in switched-on zones, with a quantity", () => {
    const f = fn({ stage: [el("p1", [P("A"), P("B")]), { invId: "C", qty: 5, name: "plain" }, el("p2", [P("A"), P("B")], 0)], entry: [el("p3", [P("B"), P("C")])] }, { enabledEls: { stage: true, entry: false } });
    const rows = choiceElementsOf([f]);
    expect(rows.map((r) => r.key)).toEqual(["0|stage|p1"]);
    expect(rows[0]).toMatchObject({ qty: 20, unit: "Pieces", date: "2027-01-03", fnLabel: "Wedding", zk: "stage", ei: 0 });
  });
  it("ignores an element whose choices are stale (its item was swapped) or that has no pid", () => {
    const stale = { ...el("p1", [P("A"), P("B")]), invId: "Z" };
    const nopid = { ...el("p2", [P("A"), P("B")]), pid: undefined };
    expect(choiceElementsOf([fn({ stage: [stale, nopid] })])).toEqual([]);
  });
  it("two elements that share a pid get distinct keys", () => {
    const rows = choiceElementsOf([fn({ stage: [el("p1", [P("A"), P("B")]), el("p1", [P("A"), P("B")])] })]);
    expect(rows.map((r) => r.key)).toEqual([elementKey(0, "stage", "p1"), elementKey(0, "stage", "p1~2")]);
  });
  it("uses the zone label given", () => {
    expect(choiceElementsOf([fn({ stage: [el("p1", [P("A"), P("B")])] })], (f, zk) => "Zone " + zk)[0].zoneName).toBe("Zone stage");
  });
});

describe("planElements — each design must cover the whole quantity", () => {
  it("a design covers it only when its free stock is at least the quantity", () => {
    const { rows } = run([fn({ stage: [el("p1", [P("A"), P("B"), P("C")], 40)] })]);
    const o = Object.fromEntries(rows[0].options.map((x) => [x.id, x]));
    expect(o.A.enough).toBe(false); expect(o.A.short).toBe(10);
    expect(o.B.enough).toBe(true);
    expect(o.C.enough).toBe(false); expect(o.C.short).toBe(30);
    expect(rows[0].suggestedId).toBe("B");
    expect(rows[0].status).toBe("open");
  });
  it("suggests the highest-ranked design that covers it", () => {
    const { rows } = run([fn({ stage: [el("p1", [P("C"), P("A"), P("B")], 20)] })]);
    expect(rows[0].suggestedId).toBe("A");
  });
  it("none covers it: short, the suggestion is the one with most free", () => {
    const { rows } = run([fn({ stage: [el("p1", [P("C"), P("D"), P("A")], 90)] })]);
    expect(rows[0].status).toBe("short");
    expect(rows[0].suggestedId).toBe("A");
  });
  it("other events' holds on the date come off the free stock; this event's own do not", () => {
    const blocks = { A: [{ date: "2027-01-03", qty: 25, eventId: "OTHER" }, { date: "2027-01-03", qty: 20, eventId: "E1" }, { date: "2027-01-04", qty: 30, eventId: "OTHER" }] };
    const { rows } = run([fn({ stage: [el("p1", [P("A"), P("B")], 10)] })], { blocks });
    expect(rows[0].options[0].rawFree).toBe(5);
    expect(rows[0].options[0].enough).toBe(false);
  });
  it("the event's other elements on the same date use stock too", () => {
    const f = fn({ stage: [el("p1", [P("A"), P("B")], 20), { invId: "A", name: "plain", qty: 15 }] });
    const a = run([f]).rows[0].options[0];
    expect(a.free).toBe(15); expect(a.enough).toBe(false);
    const g = fn({ stage: [el("p1", [P("A"), P("B")], 20), { invId: "A", name: "plain", qty: 15 }] }, { date: "2027-01-03" });
    const elsewhere = { ...g, fnIdx: 1, date: "2027-01-09", elements: { stage: [{ invId: "A", name: "plain", qty: 15 }] }, enabledEls: { stage: true } };
    const b = run([{ ...f, fnIdx: 0 }, elsewhere]).rows[0].options[0];
    expect(b.free).toBe(15); // the other function is on another date: only the same-date element counts
  });
  it("an element in a zone that is switched off uses nothing", () => {
    const f = fn({ stage: [el("p1", [P("A"), P("B")], 20)], entry: [{ invId: "A", name: "plain", qty: 15 }] }, { enabledEls: { stage: true, entry: false } });
    expect(run([f]).rows[0].options[0].free).toBe(30);
  });
  it("an undecided element holds nothing; once decided it uses its design", () => {
    const f = fn({ stage: [el("p1", [P("A"), P("B")], 20), el("p2", [P("A"), P("C")], 20)] });
    expect(run([f]).rows[1].options[0].free).toBe(30);
    const after = run([f], { choice: { "0|stage|p1": dec("A") } });
    expect(after.rows[1].options[0].free).toBe(10);
    expect(after.rows[0].options[0].free).toBe(30); // its own decision does not count against itself
  });
  it("two elements deciding the same design beyond its stock are flagged", () => {
    const f = fn({ stage: [el("p1", [P("A"), P("B")], 20), el("p2", [P("A"), P("B")], 20)] });
    const { over } = run([f], { choice: { "0|stage|p1": dec("A"), "0|stage|p2": dec("A") } });
    expect(over.A).toMatchObject({ free: 30, committed: 40, date: "2027-01-03" });
    expect(run([f], { choice: { "0|stage|p1": dec("A"), "0|stage|p2": dec("B") } }).over).toEqual({});
  });
  it("same design on two different dates is not a conflict", () => {
    const f0 = fn({ stage: [el("p1", [P("A"), P("B")], 20)] });
    const f1 = { ...fn({ stage: [el("p2", [P("A"), P("C")], 20)] }), fnIdx: 1, date: "2027-01-05", type: "Reception" };
    const { over } = run([f0, f1], { choice: { "0|stage|p1": dec("A"), "1|stage|p2": dec("A", { date: "2027-01-05", fnType: "Reception" }) } });
    expect(over).toEqual({});
  });
});

describe("planElements — decisions", () => {
  const f = fn({ stage: [el("p1", [P("A"), P("B")], 20)] });
  it("a decision for one of the choices makes the element decided", () => {
    const r = run([f], { choice: { "0|stage|p1": dec("B") } }).rows[0];
    expect(r.status).toBe("decided"); expect(r.decidedId).toBe("B");
  });
  it("a decision made for another date or function no longer applies", () => {
    expect(run([f], { choice: { "0|stage|p1": dec("B", { date: "2027-02-01" }) } }).rows[0].status).toBe("open");
    expect(run([f], { choice: { "0|stage|p1": dec("B", { fnType: "Mehendi" }) } }).rows[0].status).toBe("open");
  });
  it("a hand pick that is not one of the choices counts as decided, with its stock", () => {
    const r = run([f], { choice: { "0|stage|p1": dec("D", { manual: true }) } }).rows[0];
    expect(r.status).toBe("decided"); expect(r.decidedId).toBe("D");
    expect(r.manual).toMatchObject({ id: "D", known: true, enough: false });
  });
  it("a decision for a design that is not a choice and was not picked by hand is ignored", () => {
    expect(run([f], { choice: { "0|stage|p1": dec("D") } }).rows[0].status).toBe("open");
  });
  it("a hand pick for an item that has left the inventory still decides, without stock", () => {
    const r = run([f], { choice: { "0|stage|p1": dec("GONE", { manual: true, name: "Old design" }) } }).rows[0];
    expect(r.status).toBe("decided");
    expect(r.manual).toMatchObject({ name: "Old design", known: false });
  });
  it("'arranged separately' decides it with no design", () => {
    const r = run([f], { choice: { "0|stage|p1": { other: true, date: "2027-01-03", fnType: "Wedding" } } }).rows[0];
    expect(r.status).toBe("decided"); expect(r.other).toBe(true); expect(r.decidedId).toBe(null);
  });
  it("a design that cannot be found in inventory falls back to the free figure sales saved", () => {
    const r = planElements({ functionsDetail: [fn({ stage: [el("p1", [P("X", "nx", 50), P("Y", "ny", 5)], 20)] })], itemsById: {}, blocks: {}, eventId: "E1", choice: {} }).rows[0];
    expect(r.options.map((o) => [o.known, o.enough])).toEqual([[true, true], [true, false]]);
  });
});

describe("elementStockFor — every design of the same kind", () => {
  it("lists the same sub-category only, those covering it first", () => {
    const inv = [item("A", 30), item("B", 50), item("C", 10), item("Q", 99, "Cushion", "Cushion Cover Q"), item("R", 99, "Cushion", "White Cushion Insert")];
    const f = fn({ stage: [el("p1", [P("A"), P("B")], 40)] });
    const rows = choiceElementsOf([f]);
    const out = elementStockFor(rows[0], inv, {}, "E1", [f], rows, {});
    expect(out.map((o) => o.id)).toEqual(["B", "A", "C"]);
    expect(out[0].enough).toBe(true);
  });
  it("cushion covers list covers only, not inserts", () => {
    const inv = [item("A", 30, "Cushion", "Cushion Cover A"), item("B", 30, "Cushion", "Cushion Cover B"), item("I", 30, "Cushion", "Cushion Insert")];
    const f = fn({ stage: [el("p1", [P("A"), P("B")], 10)] });
    const rows = choiceElementsOf([f]);
    expect(elementStockFor(rows[0], inv, {}, "E1", [f], rows, {}).map((o) => o.id).sort()).toEqual(["A", "B"]);
  });
});

describe("planElements — a decision that no longer applies holds nothing", () => {
  it("E1 was decided B but sales changed its choices to [A, C]: B is free again for E2", () => {
    const f = fn({ stage: [el("p1", [P("A"), P("C")], 10), el("p2", [P("B"), P("E")], 15)] });
    const r = run([f], { choice: { "0|stage|p1": dec("B") } });
    expect(r.rows[0].status).toBe("open");
    expect(r.rows[1].options[0].free).toBe(50);
  });
});


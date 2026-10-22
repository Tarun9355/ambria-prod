import { describe, it, expect } from "vitest";
import { createSettingsWriter } from "./settingsWriter.js";

// A fake table whose writes take a random-ish time, so an unqueued writer would land them out of order.
const makeDb = (delays) => {
  const db = { calls: [], value: {} };
  let n = 0;
  db.write = async (k, v) => {
    const wait = delays[n++ % delays.length];
    await new Promise((r) => setTimeout(r, wait));
    db.calls.push([k, v]);
    db.value[k] = v;
    return null;
  };
  return db;
};

describe("settings writer", () => {
  it("typing '150' leaves 150 in the database even when the writes would finish in the wrong order", async () => {
    const db = makeDb([30, 5, 1]);
    const w = createSettingsWriter(db.write);
    let s = { price: 80 };
    const tasks = [];
    for (const v of [1, 15, 150]) { const next = { ...s, price: v }; tasks.push(w.enqueue(s, next)); s = next; }
    await Promise.all(tasks);
    expect(db.value.price).toBe(150);
    expect(db.calls.at(-1)).toEqual(["price", 150]);
  });

  it("coalesces edits that pile up behind a write in flight into one write of the newest value", async () => {
    const db = makeDb([20]);
    const w = createSettingsWriter(db.write);
    let s = { name: "" };
    const tasks = [];
    for (const v of ["f", "fi", "fic", "ficu", "ficus"]) { const next = { ...s, name: v }; tasks.push(w.enqueue(s, next)); s = next; }
    await Promise.all(tasks);
    expect(db.calls).toEqual([["name", "ficus"]]);
  });

  it("a key is dirty from the first edit until its newest value is written, and only then", async () => {
    const db = makeDb([20]);
    const w = createSettingsWriter(db.write);
    expect(w.isDirty("price")).toBe(false);
    const t = w.enqueue({ price: 1 }, { price: 2 });
    expect(w.isDirty("price")).toBe(true);
    expect(w.isDirty("other")).toBe(false);
    await t;
    expect(w.isDirty("price")).toBe(false);
  });

  it("an edit made while a write is in flight keeps the key dirty until that newer value is written", async () => {
    const db = makeDb([40, 5]);
    const w = createSettingsWriter(db.write);
    const t1 = w.enqueue({ p: 1 }, { p: 2 });
    await new Promise((r) => setTimeout(r, 10)); // write of 2 is now in flight
    const t2 = w.enqueue({ p: 2 }, { p: 3 });
    await t1;
    expect(w.isDirty("p")).toBe(true);   // 3 is not in the database yet
    await t2;
    expect(w.isDirty("p")).toBe(false);
    expect(db.value.p).toBe(3);
  });

  it("an unchanged settings object writes nothing, and a failed write is reported and does not stick", async () => {
    const errors = [];
    const w = createSettingsWriter(async () => "boom", (k, e) => errors.push([k, e]));
    expect(w.enqueue({ a: 1 }, { a: 1 })).toBe(null);
    await w.enqueue({ a: 1 }, { a: 2 });
    expect(errors).toEqual([["a", "boom"]]);
    expect(w.isDirty("a")).toBe(false);
  });
});

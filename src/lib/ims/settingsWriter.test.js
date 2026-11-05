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

  it("a refetch started before a key's write finished is stale for that key even after it is clean", async () => {
    const db = makeDb([20]);
    const w = createSettingsWriter(db.write);
    const mark = w.mark();                       // refetch starts: it will return the pre-write value
    const t = w.enqueue({ name: "fic" }, { name: "ficu" });
    await t;
    expect(w.isDirty("name")).toBe(false);
    expect(w.isStaleFor("name", mark)).toBe(true);   // its result must not replace "ficu"
    expect(w.isStaleFor("other", mark)).toBe(false); // untouched keys still take the database value
    expect(w.isStaleFor("name", w.mark())).toBe(false); // a refetch started after the write is trusted
  });

  it("a refetch started while the write is still in flight is stale until a later refetch", async () => {
    const db = makeDb([30]);
    const w = createSettingsWriter(db.write);
    const t = w.enqueue({ p: 1 }, { p: 2 });
    const mark = w.mark();
    expect(w.isStaleFor("p", mark)).toBe(true);  // dirty
    await t;
    expect(w.isStaleFor("p", mark)).toBe(true);  // settled after the fetch began
  });

  it("an unchanged settings object writes nothing", () => {
    const w = createSettingsWriter(async () => null);
    expect(w.enqueue({ a: 1 }, { a: 1 })).toBe(null);
  });

  it("a failed write is reported, but the key STAYS dirty (owner report 2026-11-05) — it must not be mistaken for settled", async () => {
    const errors = [];
    const w = createSettingsWriter(async () => "boom", (k, e) => errors.push([k, e]));
    const mark = w.mark();
    await w.enqueue({ a: 1 }, { a: 2 });
    expect(errors).toEqual([["a", "boom"]]);
    // Both must stay true: a realtime echo / refetch reading the untouched database value must be
    // ignored for this key, exactly as if the write were still in flight — otherwise it silently
    // reverts the screen back to the pre-write value with no trace the save ever failed.
    expect(w.isDirty("a")).toBe(true);
    expect(w.isStaleFor("a", mark)).toBe(true);
  });

  it("retryKey re-attempts a failed key's CURRENT value and clears dirty once it succeeds", async () => {
    const db = { value: {} };
    let shouldFail = true;
    const w = createSettingsWriter(async (k, v) => { if (shouldFail) return "boom"; db.value[k] = v; return null; });
    await w.enqueue({ a: 1 }, { a: 2 });
    expect(w.isDirty("a")).toBe(true);
    shouldFail = false;
    const res = await w.retryKey("a");
    expect(res.ok).toBe(true);
    expect(db.value.a).toBe(2);
    expect(w.isDirty("a")).toBe(false);
  });

  it("retryKey picks up a NEWER edit made after the original failure, not the stale failed value", async () => {
    const db = { value: {} };
    let shouldFail = true;
    const w = createSettingsWriter(async (k, v) => { if (shouldFail) return "boom"; db.value[k] = v; return null; });
    await w.enqueue({ a: 1 }, { a: 2 }); // fails, stays dirty at 2
    w.enqueue({ a: 2 }, { a: 3 }); // queued behind the failed task's own chain link, still fails too (shouldFail true)
    shouldFail = false;
    await w.retryKey("a");
    expect(db.value.a).toBe(3);
    expect(w.isDirty("a")).toBe(false);
  });

  it("retryKey on a key that is not dirty is a safe {ok:true} no-op and never calls writeFn", async () => {
    const writeFn = async () => { throw new Error("should not be called"); };
    const w = createSettingsWriter(writeFn);
    const res = await w.retryKey("neverTouched");
    expect(res).toEqual({ ok: true });
  });

  it("markSettled(key, false) leaves an external write's dirty flag set; markSettled(key, true) clears it", () => {
    const w = createSettingsWriter(async () => null);
    w.markWriting("datePricing");
    expect(w.isDirty("datePricing")).toBe(true);
    w.markSettled("datePricing", false);
    expect(w.isDirty("datePricing")).toBe(true); // the RPC failed — must stay dirty
    w.markSettled("datePricing", true);
    expect(w.isDirty("datePricing")).toBe(false);
  });

  it("markSettled defaults to ok=true (existing callers that pass no second argument keep working)", () => {
    const w = createSettingsWriter(async () => null);
    w.markWriting("datePricing");
    w.markSettled("datePricing");
    expect(w.isDirty("datePricing")).toBe(false);
  });

  it("a real retry after a failed external write (markWriting called a SECOND time) still clears dirty on success", () => {
    // Regression for a real bug: markSettled(key, false) used to return before decrementing the
    // pendingExternal counter, so a retry's own markWriting (a second call, not the first) pushed
    // the counter to 2, and the retry's markSettled(key, true) only brought it back to 1 — never 0
    // — leaving the key permanently dirty for the rest of the session even though the retry
    // genuinely succeeded. A test with only ONE markWriting call (like the two above) can't catch
    // this: it has to call markWriting again, exactly as a real retry does.
    const w = createSettingsWriter(async () => null);
    w.markWriting("datePricing");      // original attempt
    w.markSettled("datePricing", false); // ...fails
    w.markWriting("datePricing");      // retry attempt
    w.markSettled("datePricing", true);  // ...succeeds
    expect(w.isDirty("datePricing")).toBe(false);
  });

  it("discardKey clears a dirty key (enqueue-pending or external-pending) so a later refetch is trusted again", async () => {
    const w1 = createSettingsWriter(async () => "boom");
    await w1.enqueue({ a: 1 }, { a: 2 }); // fails, stays dirty
    expect(w1.isDirty("a")).toBe(true);
    w1.discardKey("a");
    expect(w1.isDirty("a")).toBe(false);
    const mark = w1.mark(); // a fetch that starts NOW, after the discard
    expect(w1.isStaleFor("a", mark)).toBe(false); // ...is trusted, not treated as stale

    const w2 = createSettingsWriter(async () => null);
    w2.markWriting("datePricing");
    expect(w2.isDirty("datePricing")).toBe(true);
    w2.discardKey("datePricing");
    expect(w2.isDirty("datePricing")).toBe(false);
  });

  it("onSaved fires only when a write actually clears the key (not on a no-op or a failure)", async () => {
    const saved = [];
    const w = createSettingsWriter(async () => null, null, (k) => saved.push(k));
    await w.enqueue({ a: 1 }, { a: 2 });
    expect(saved).toEqual(["a"]);

    const errors = [];
    const wFail = createSettingsWriter(async () => "boom", (k, e) => errors.push([k, e]), (k) => saved.push(`should-not-fire:${k}`));
    await wFail.enqueue({ b: 1 }, { b: 2 });
    expect(saved).toEqual(["a"]); // unchanged — the failing writer's onSaved never fired
    expect(errors).toEqual([["b", "boom"]]);
  });
});

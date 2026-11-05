import { describe, it, expect, vi, beforeEach } from "vitest";

// A fresh mock per test file run — each test configures what the next call resolves to via
// `nextSelectResult`/`nextUpsertResult` so the real kvGet/kvTryGet/kvSet/reliableSave code runs
// unmodified against a controllable backend, matching this codebase's existing shallow-mock style
// for small Supabase-backed modules.
let nextSelectResult = { data: null, error: null };
let nextUpsertResult = { error: null };
vi.mock("../supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => nextSelectResult }) }),
      upsert: async () => nextUpsertResult,
    }),
  },
}));

// Imported AFTER the mock so kv.js's own `import { supabase } from "../supabase"` resolves to it.
const { kvGet, kvTryGet, kvSet, reliableSave, kvLoadFailed } = await import("./kv.js");

describe("kv.js — a failed read must not let a later save overwrite real data with defaults (owner report 2026-11-05)", () => {
  beforeEach(() => {
    nextSelectResult = { data: null, error: null };
    nextUpsertResult = { error: null };
  });

  it("a successful read, even of a missing row, never blocks a later save", async () => {
    const key = "neverFails_" + Math.random();
    nextSelectResult = { data: null, error: null }; // genuinely missing, not a failure
    expect(await kvGet(key)).toBeNull();
    expect(kvLoadFailed(key)).toBe(false);
    const res = await kvSet(key, { a: 1 });
    expect(res.ok).toBe(true);
  });

  it("a failed kvGet blocks reliableSave/kvSet for that exact key until a read succeeds", async () => {
    const key = "willFail_" + Math.random();
    nextSelectResult = { data: null, error: { message: "network down" } };
    expect(await kvGet(key)).toBeNull();
    expect(kvLoadFailed(key)).toBe(true);

    const saveRes = await reliableSave(key, JSON.stringify({ a: 1 }), "Test blob");
    expect(saveRes.ok).toBe(false);
    expect(saveRes.blocked).toBe(true);
    expect(saveRes.error).toMatch(/didn't load this session/);

    const setRes = await kvSet(key, { a: 1 });
    expect(setRes.ok).toBe(false);
    expect(setRes.blocked).toBe(true);

    // Once a read genuinely succeeds for this key, the block lifts.
    nextSelectResult = { data: { value: "whatever" }, error: null };
    await kvGet(key);
    expect(kvLoadFailed(key)).toBe(false);
    nextUpsertResult = { error: null };
    expect((await kvSet(key, { a: 2 })).ok).toBe(true);
  });

  it("kvTryGet's own failure also blocks a save for that key", async () => {
    const key = "tryGetFails_" + Math.random();
    nextSelectResult = { data: null, error: { message: "timeout" } };
    const r = await kvTryGet(key);
    expect(r.ok).toBe(false);
    expect(kvLoadFailed(key)).toBe(true);
    expect((await kvSet(key, 1)).blocked).toBe(true);
  });

  it("an exception during the read (thrown, not a Supabase {error}) still blocks saves the same way", async () => {
    const key = "throws_" + Math.random();
    // Simulate a thrown network error by making maybeSingle reject this one time.
    const realMock = await import("../supabase");
    const origFrom = realMock.supabase.from;
    realMock.supabase.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error("fetch failed"); } }) }), upsert: async () => nextUpsertResult });
    expect(await kvGet(key)).toBeNull();
    expect(kvLoadFailed(key)).toBe(true);
    realMock.supabase.from = origFrom;
    expect((await kvSet(key, 1)).blocked).toBe(true);
  });

  it("a key that was never read at all is NOT considered load-failed (write-only caches/flags stay usable)", () => {
    expect(kvLoadFailed("neverTouched_" + Math.random())).toBe(false);
  });

  it("reliableSave's existing empty-payload guard still runs before the load-failure check", async () => {
    const key = "empty_" + Math.random();
    const res = await reliableSave(key, "", "Test blob");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Empty payload/);
    expect(res.blocked).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// supabase.js calls createClient(...) at module load — mock @supabase/supabase-js itself (not
// supabase.js, which is the module under test) so the real upsertRow/updateRow/deleteRow code runs
// against a controllable fake client, matching this codebase's existing shallow-mock style.
let nextResult = { data: { id: "x" }, error: null };
// Queue drained before falling back to nextResult — lets a test script "fails, fails, succeeds"
// across writeWithRetry's several internal attempts for one call.
let resultQueue = [];
// A one-shot controllable "hang until resolved" slot, for simulating a request that's still
// in-flight when a second, concurrent call to the SAME target starts (supersession tests).
let pendingResolve = null;
const nextOne = () => {
  if (resultQueue[0] === "HANG") { resultQueue.shift(); return new Promise((resolve) => { pendingResolve = resolve; }); }
  return Promise.resolve(resultQueue.length ? resultQueue.shift() : nextResult);
};
const calls = [];
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} },
    from: (table) => ({
      upsert: (row) => { calls.push(["upsert", table, row]); return { select: () => ({ single: () => nextOne() }) }; },
      update: (changes) => { calls.push(["update", table, changes]); return { eq: () => ({ select: () => ({ single: () => nextOne() }) }) }; },
      delete: () => { calls.push(["delete", table]); return { eq: () => nextOne() }; },
    }),
  }),
}));

const { upsertRow, updateRow, deleteRow } = await import("./supabase.js");
const { getSaveProblems, clearSaveProblem } = await import("./saveHealth.js");

describe("supabase.js — upsertRow/updateRow/deleteRow retry a flaky write before throwing", () => {
  beforeEach(() => {
    nextResult = { data: { id: "x" }, error: null };
    resultQueue = [];
    pendingResolve = null;
    calls.length = 0;
  });

  it("upsertRow retries a flaky write and resolves once the connection recovers", async () => {
    resultQueue = [{ error: { message: "network blip" } }, { data: { id: "row1" }, error: null }];
    const res = await upsertRow("functions", { id: "row1", name: "Mehendi" });
    expect(res).toEqual({ id: "row1" });
    expect(resultQueue).toHaveLength(0);
  });

  it("upsertRow throws a real Error (not a raw object) once attempts are exhausted — existing try/catch callers keep working", async () => {
    nextResult = { data: null, error: { message: "down for good" } };
    const p = upsertRow("functions", { id: "row2", name: "X" });
    await expect(p).rejects.toThrow("down for good");
    await expect(p).rejects.toBeInstanceOf(Error); // a plain object rejection would also pass toThrow() on a message match — this is what actually proves it's a real Error
    clearSaveProblem("write:functions:row2");
  });

  it("the thrown Error keeps PostgREST's code/details/hint, not just the message — a caller branching on e.code still works", async () => {
    // code:23505 (unique violation) also makes shouldAbort stop after ONE attempt, not all 4.
    nextResult = { data: null, error: { message: "duplicate key", code: "23505", details: "Key already exists", hint: "try another id" } };
    const p = upsertRow("functions", { id: "row2b", name: "X" });
    try { await p; throw new Error("expected upsertRow to reject"); } catch (e) {
      expect(e.message).toBe("duplicate key");
      expect(e.code).toBe("23505");
      expect(e.details).toBe("Key already exists");
      expect(e.hint).toBe("try another id");
    }
    clearSaveProblem("write:functions:row2b");
  });

  it("updateRow retries and resolves, scoping its target to table:id", async () => {
    resultQueue = [{ error: { message: "blip" } }];
    nextResult = { data: { id: "row3", status: "sold" }, error: null };
    const res = await updateRow("event_orders", "row3", { status: "sold" });
    expect(res.status).toBe("sold");
  });

  it("deleteRow is idempotent and retries past a flaky failure", async () => {
    resultQueue = [{ error: { message: "blip" } }, { error: null }];
    await expect(deleteRow("blocks", "row4")).resolves.toBeUndefined();
  });

  it("a final failure is reported via saveHealth with NO retry action (retryable:false) — the caller's own snapshot could be stale by the time anyone clicks Retry", async () => {
    nextResult = { data: null, error: { message: "still down" } };
    await expect(updateRow("purchase_orders", "row5", { qty: 5 })).rejects.toThrow();
    const problem = getSaveProblems().find((p) => p.id === "write:purchase_orders:row5");
    expect(problem).toBeDefined();
    expect(problem.retry).toBeUndefined();
    clearSaveProblem("write:purchase_orders:row5");
  }, 10000);

  it("a call superseded by a second, faster write to the SAME row:id rejects with a clear, non-misleading message", async () => {
    // Two rapid edits to different fields of the same row — the first's own request is still
    // in-flight ("HANG") when the second starts and completes first.
    resultQueue = ["HANG"];
    const firstPromise = updateRow("mandi_flowers", "flowerA", { name: "X" });
    const secondResult = await updateRow("mandi_flowers", "flowerA", { flower_cat: "Y" });
    expect(secondResult).toEqual({ id: "x" });
    // The first request finally "resolves" late, as a failure — it must be dropped as superseded,
    // not reported as success, and not thrown as a confusing generic "Write failed".
    pendingResolve({ data: null, error: { message: "finally failed after being superseded" } });
    await expect(firstPromise).rejects.toThrow(/more recent edit/i);
  });
});

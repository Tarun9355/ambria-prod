import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportSaveProblem, clearSaveProblem, discardSaveProblem, getSaveProblems, subscribeSaveProblems, hasUnsavedFailures, retrySaveProblem, retryAllSaveProblems } from "./saveHealth.js";

// getSaveProblems is a shared, module-level store — give every test its own unique ids so they
// can't see each other's state.
const id = (tag) => `${tag}_${Math.random()}`;

describe("saveHealth — a reported problem stays visible until cleared or a successful retry", () => {
  it("report/clear round-trip, and hasUnsavedFailures reflects it", () => {
    const k = id("basic");
    expect(hasUnsavedFailures()).toBe(false || hasUnsavedFailures()); // baseline may be non-empty from other tests; just confirm no throw
    reportSaveProblem(k, { label: "Thing", error: new Error("boom") });
    expect(getSaveProblems().find((p) => p.id === k)).toMatchObject({ id: k, label: "Thing", error: "boom", blocked: false });
    expect(hasUnsavedFailures()).toBe(true);
    clearSaveProblem(k);
    expect(getSaveProblems().find((p) => p.id === k)).toBeUndefined();
  });

  it("a string error is stored as-is; no error at all falls back to a generic message", () => {
    const k1 = id("str");
    reportSaveProblem(k1, { error: "plain string error" });
    expect(getSaveProblems().find((p) => p.id === k1).error).toBe("plain string error");
    clearSaveProblem(k1);

    const k2 = id("none");
    reportSaveProblem(k2, {});
    expect(getSaveProblems().find((p) => p.id === k2).error).toBe("Save failed");
    clearSaveProblem(k2);
  });

  it("reporting the same id again refreshes the message instead of creating a second entry", () => {
    const k = id("refresh");
    reportSaveProblem(k, { error: "first" });
    reportSaveProblem(k, { error: "second" });
    const matches = getSaveProblems().filter((p) => p.id === k);
    expect(matches.length).toBe(1);
    expect(matches[0].error).toBe("second");
    clearSaveProblem(k);
  });

  it("subscribeSaveProblems notifies on report and clear, and unsubscribe stops further notifications", () => {
    const k = id("sub");
    const fn = vi.fn();
    const unsub = subscribeSaveProblems(fn);
    reportSaveProblem(k, { error: "x" });
    expect(fn).toHaveBeenCalled();
    const callsAfterReport = fn.mock.calls.length;
    unsub();
    clearSaveProblem(k);
    expect(fn.mock.calls.length).toBe(callsAfterReport); // no further calls after unsubscribing
  });

  it("retrySaveProblem calls retry() and clears the problem when it resolves ok", async () => {
    const k = id("retry-ok");
    const retry = vi.fn().mockResolvedValue({ ok: true });
    reportSaveProblem(k, { error: "x", retry });
    await retrySaveProblem(k);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getSaveProblems().find((p) => p.id === k)).toBeUndefined();
  });

  it("retrySaveProblem leaves the problem reported when retry() resolves {ok:false} or throws", async () => {
    const k1 = id("retry-fail");
    const retry1 = vi.fn().mockResolvedValue({ ok: false });
    reportSaveProblem(k1, { error: "x", retry: retry1 });
    await retrySaveProblem(k1);
    expect(getSaveProblems().find((p) => p.id === k1)).toBeDefined();
    clearSaveProblem(k1);

    const k2 = id("retry-throw");
    const retry2 = vi.fn().mockRejectedValue(new Error("still broken"));
    reportSaveProblem(k2, { error: "x", retry: retry2 });
    await retrySaveProblem(k2);
    expect(getSaveProblems().find((p) => p.id === k2)).toBeDefined();
    clearSaveProblem(k2);
  });

  it("retrySaveProblem on a problem with no retry() is a safe no-op", async () => {
    const k = id("no-retry");
    reportSaveProblem(k, { error: "x" });
    await expect(retrySaveProblem(k)).resolves.toBeUndefined();
    expect(getSaveProblems().find((p) => p.id === k)).toBeDefined();
    clearSaveProblem(k);
  });

  it("discardSaveProblem runs onDiscard before clearing the problem", () => {
    const k = id("discard");
    const onDiscard = vi.fn();
    reportSaveProblem(k, { error: "x", onDiscard });
    discardSaveProblem(k);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(getSaveProblems().find((p) => p.id === k)).toBeUndefined();
  });

  it("discardSaveProblem still clears the problem even if onDiscard throws", () => {
    const k = id("discard-throw");
    reportSaveProblem(k, { error: "x", onDiscard: () => { throw new Error("boom"); } });
    expect(() => discardSaveProblem(k)).not.toThrow();
    expect(getSaveProblems().find((p) => p.id === k)).toBeUndefined();
  });

  it("discardSaveProblem on a problem with no onDiscard just clears it", () => {
    const k = id("discard-none");
    reportSaveProblem(k, { error: "x" });
    discardSaveProblem(k);
    expect(getSaveProblems().find((p) => p.id === k)).toBeUndefined();
  });

  it("retryAllSaveProblems retries every problem that HAS a retry function, blocked or not", async () => {
    // A load failure (blocked:true) with its own in-place recovery retry (background recovery)
    // participates in the same reconnect sweep a write failure already did — only a blocked entry
    // with NO retry function (the common case, still needing Reload) is skipped, and that's just
    // retrySaveProblem's own existing no-op guard, not a special case here.
    const kOk = id("all-ok");
    const kBlockedWithRetry = id("all-blocked-retry");
    const kBlockedNoRetry = id("all-blocked-no-retry");
    const retryOk = vi.fn().mockResolvedValue({ ok: true });
    const retryBlocked = vi.fn().mockResolvedValue({ ok: true });
    reportSaveProblem(kOk, { error: "x", retry: retryOk });
    reportSaveProblem(kBlockedWithRetry, { error: "x", retry: retryBlocked, blocked: true });
    reportSaveProblem(kBlockedNoRetry, { error: "x", blocked: true }); // no retry — still needs Reload
    retryAllSaveProblems();
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget retries settle
    expect(retryOk).toHaveBeenCalledTimes(1);
    expect(retryBlocked).toHaveBeenCalledTimes(1);
    expect(getSaveProblems().find((p) => p.id === kBlockedNoRetry)).toBeDefined(); // untouched, no-op
    clearSaveProblem(kBlockedNoRetry);
  });
});

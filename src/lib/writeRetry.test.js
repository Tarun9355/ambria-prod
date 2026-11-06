import { describe, it, expect, vi } from "vitest";
import { writeWithRetry, defaultShouldAbort } from "./writeRetry.js";
import { getSaveProblems, clearSaveProblem } from "./saveHealth.js";

const target = (tag) => `${tag}_${Math.random()}`;

describe("writeWithRetry — retries a failed idempotent write, never a stale one over a newer edit", () => {
  it("succeeds immediately with no retry when the first attempt succeeds", async () => {
    const factory = vi.fn().mockResolvedValue({ data: { ok: 1 }, error: null });
    const res = await writeWithRetry(factory, { target: target("ok"), attempts: 4, baseDelayMs: 1 });
    expect(res).toEqual({ ok: true, data: { ok: 1 } });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable error and succeeds on a later attempt", async () => {
    const factory = vi.fn()
      .mockResolvedValueOnce({ error: { message: "network blip" } })
      .mockResolvedValueOnce({ error: { message: "network blip" } })
      .mockResolvedValueOnce({ data: { ok: 1 }, error: null });
    const res = await writeWithRetry(factory, { target: target("retry"), attempts: 4, baseDelayMs: 1 });
    expect(res.ok).toBe(true);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("exhausting all attempts reports a save problem and resolves {ok:false}", async () => {
    const t = target("exhaust");
    const factory = vi.fn().mockResolvedValue({ error: { message: "still down" } });
    const res = await writeWithRetry(factory, { target: t, label: "Thing", attempts: 3, baseDelayMs: 1 });
    expect(res.ok).toBe(false);
    expect(factory).toHaveBeenCalledTimes(3);
    const problem = getSaveProblems().find((p) => p.id === `write:${t}`);
    expect(problem).toBeDefined();
    expect(problem.label).toBe("Thing");
    clearSaveProblem(`write:${t}`);
  });

  it("a non-retryable error (shouldAbort) stops after one attempt", async () => {
    const t = target("abort");
    const factory = vi.fn().mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    const res = await writeWithRetry(factory, { target: t, attempts: 5, baseDelayMs: 1 });
    expect(res.ok).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);
    clearSaveProblem(`write:${t}`);
  });

  it("defaultShouldAbort classifies constraint/RLS/no-row errors as non-retryable, everything else as retryable", () => {
    expect(defaultShouldAbort({ code: "23505" })).toBe(true); // unique violation
    expect(defaultShouldAbort({ code: "23503" })).toBe(true); // FK violation
    expect(defaultShouldAbort({ code: "42501" })).toBe(true); // RLS denial
    expect(defaultShouldAbort({ code: "PGRST116" })).toBe(true); // no row for single()
    expect(defaultShouldAbort({ code: "PGRST301" })).toBe(false); // JWT expired — worth retrying
    expect(defaultShouldAbort({ message: "fetch failed" })).toBe(false); // no code at all
    expect(defaultShouldAbort(null)).toBe(false);
  });

  it("a later writeWithRetry call for the SAME target supersedes an earlier one still retrying", async () => {
    const t = target("supersede");
    let resolveFirst;
    const firstFactory = vi.fn(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const firstPromise = writeWithRetry(firstFactory, { target: t, attempts: 4, baseDelayMs: 1 });

    // A newer write for the same target starts WHILE the first is still in flight.
    const secondFactory = vi.fn().mockResolvedValue({ data: { v: 2 }, error: null });
    const secondPromise = writeWithRetry(secondFactory, { target: t, attempts: 4, baseDelayMs: 1 });
    const secondRes = await secondPromise;
    expect(secondRes.ok).toBe(true);

    // The first attempt's underlying factory call finally "resolves" late (e.g. a slow network) —
    // it must be dropped as superseded, never allowed to report success or overwrite anything.
    resolveFirst({ error: { message: "finally failed after being superseded" } });
    const firstRes = await firstPromise;
    expect(firstRes.superseded).toBe(true);
    expect(firstRes.ok).toBe(false);
  });

  it("a late SUCCESS from a superseded (older) call does not clear a NEWER call's reported problem", async () => {
    // Regression: the attempt itself was already sent and can't be un-sent, so it's still reported
    // as {ok:true} to ITS OWN caller — but it must not touch saveHealth for a target a newer call
    // has since taken over, or a genuinely still-failing newer write's banner would silently vanish
    // while the database actually holds this older, superseded value.
    const t = target("late-success-after-supersede");
    let resolveFirst;
    const firstFactory = vi.fn(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const firstPromise = writeWithRetry(firstFactory, { target: t, attempts: 1, baseDelayMs: 1 });

    const secondFactory = vi.fn().mockResolvedValue({ error: { message: "second call failed" } });
    await writeWithRetry(secondFactory, { target: t, attempts: 1, baseDelayMs: 1 });
    expect(getSaveProblems().find((p) => p.id === `write:${t}`)).toBeDefined();

    resolveFirst({ data: {}, error: null });
    const firstRes = await firstPromise;
    expect(firstRes.ok).toBe(true); // the write itself did land — that part can't be undone
    expect(getSaveProblems().find((p) => p.id === `write:${t}`)).toBeDefined(); // but the newer failure must still be reported
    clearSaveProblem(`write:${t}`);
  });

  it("retrying an OLD reported failure after a newer call has taken over is a safe no-op, not a fresh write that could supersede the newer one", async () => {
    // Regression: retry: () => writeWithRetry(factory, opts) used to start a BRAND NEW call that
    // claimed the newest generation for itself — so clicking Retry on a stale banner entry (or the
    // automatic one-shot retry firing for EVERY reported problem on reconnect) could supersede a
    // genuinely newer write that was still mid-retry, and win with the old stale value.
    const t = target("retry-after-supersede");
    const firstFactory = vi.fn().mockResolvedValue({ error: { message: "first call fails" } });
    await writeWithRetry(firstFactory, { target: t, attempts: 1, baseDelayMs: 1 });
    const problem = getSaveProblems().find((p) => p.id === `write:${t}`);
    expect(typeof problem.retry).toBe("function");

    let resolveSecond;
    const secondFactory = vi.fn(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const secondPromise = writeWithRetry(secondFactory, { target: t, attempts: 4, baseDelayMs: 1 });

    const retryRes = await problem.retry(); // clicking Retry on the OLD banner entry
    expect(retryRes.superseded).toBe(true);
    expect(firstFactory).toHaveBeenCalledTimes(1); // never re-invoked — the retry refused to run at all

    resolveSecond({ data: {}, error: null });
    expect((await secondPromise).ok).toBe(true);
    clearSaveProblem(`write:${t}`);
  });

  it("retryable:false omits the retry function entirely — the banner can only offer Discard", async () => {
    const t = target("not-retryable");
    const factory = vi.fn().mockResolvedValue({ error: { message: "down" } });
    await writeWithRetry(factory, { target: t, attempts: 1, baseDelayMs: 1, retryable: false });
    const problem = getSaveProblems().find((p) => p.id === `write:${t}`);
    expect(problem.retry).toBeUndefined();
    clearSaveProblem(`write:${t}`);
  });

  it("each writeWithRetry call re-invokes the factory fresh, so a retry naturally picks up whatever it currently returns", async () => {
    let currentValue = "v1";
    const factory = vi.fn(async () => {
      if (currentValue === "v1") return { error: { message: "fails for v1" } };
      return { data: { value: currentValue }, error: null };
    });
    const t = target("fresh");
    const resultPromise = writeWithRetry(factory, { target: t, attempts: 5, baseDelayMs: 1 });
    // Simulate the value changing between the first failed attempt and a later retry.
    await new Promise((r) => setTimeout(r, 5));
    currentValue = "v2";
    const res = await resultPromise;
    expect(res.ok).toBe(true);
    expect(res.data.value).toBe("v2");
  });

  it("throws if target is omitted", async () => {
    await expect(writeWithRetry(async () => ({}), {})).rejects.toThrow(/target/);
  });

  it("report:false never touches saveHealth", async () => {
    const t = target("noreport");
    const factory = vi.fn().mockResolvedValue({ error: { message: "down" } });
    await writeWithRetry(factory, { target: t, attempts: 2, baseDelayMs: 1, report: false });
    expect(getSaveProblems().find((p) => p.id === `write:${t}`)).toBeUndefined();
  });

  it("a successful write clears any previously reported problem for the same target", async () => {
    const t = target("clear-on-success");
    const failing = vi.fn().mockResolvedValue({ error: { message: "down" } });
    await writeWithRetry(failing, { target: t, attempts: 1, baseDelayMs: 1 });
    expect(getSaveProblems().find((p) => p.id === `write:${t}`)).toBeDefined();
    const succeeding = vi.fn().mockResolvedValue({ data: {}, error: null });
    await writeWithRetry(succeeding, { target: t, attempts: 1, baseDelayMs: 1 });
    expect(getSaveProblems().find((p) => p.id === `write:${t}`)).toBeUndefined();
  });
});

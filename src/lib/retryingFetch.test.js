import { describe, it, expect, vi, afterEach } from "vitest";
import { makeRetryingFetch } from "./retryingFetch.js";

const okRes = (status = 200) => ({ status, ok: status < 300 });
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

afterEach(() => { vi.useRealTimers(); });

describe("retryingFetch — retries a hung /rest/v1/ READ or a retryable status, never a thrown network error or a write", () => {
  it("a thrown network error (not our own timeout) is passed straight through, not retried — postgrest-js already retries those itself", async () => {
    const base = vi.fn().mockRejectedValue(new Error("still down"));
    const f = makeRetryingFetch(base);
    await expect(f("https://x.supabase.co/rest/v1/settings", { method: "GET" })).rejects.toThrow("still down");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("a hang that exceeds our per-attempt timeout IS retried (our own AbortController firing, not a thrown error)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const base = vi.fn().mockImplementation((input, init) => new Promise((resolve, reject) => {
      calls += 1;
      const thisCall = calls;
      init.signal.addEventListener("abort", () => reject(abortError()));
      if (thisCall === 2) resolve(okRes(200)); // second attempt succeeds; first just hangs until our timeout fires
    }));
    const f = makeRetryingFetch(base);
    const pending = f("https://x.supabase.co/rest/v1/settings", { method: "GET" });
    await vi.advanceTimersByTimeAsync(20000); // past PER_ATTEMPT_TIMEOUT_MS — our own abort fires attempt 1
    await vi.advanceTimersByTimeAsync(5000); // past the jittered backoff before attempt 2
    const res = await pending;
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("a 500 response from /rest/v1/ is retried; a 404 is returned immediately, not retried", async () => {
    const base500 = vi.fn()
      .mockResolvedValueOnce(okRes(500))
      .mockResolvedValueOnce(okRes(200));
    const f500 = makeRetryingFetch(base500);
    const res500 = await f500("https://x.supabase.co/rest/v1/settings", { method: "GET" });
    expect(res500.status).toBe(200);
    expect(base500).toHaveBeenCalledTimes(2);

    const base404 = vi.fn().mockResolvedValueOnce(okRes(404));
    const f404 = makeRetryingFetch(base404);
    const res404 = await f404("https://x.supabase.co/rest/v1/settings", { method: "GET" });
    expect(res404.status).toBe(404);
    expect(base404).toHaveBeenCalledTimes(1);
  });

  it("a POST/PATCH/DELETE to /rest/v1/ is never retried, even on failure", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      const base = vi.fn().mockRejectedValueOnce(new Error("write failed"));
      const f = makeRetryingFetch(base);
      await expect(f("https://x.supabase.co/rest/v1/settings", { method })).rejects.toThrow("write failed");
      expect(base).toHaveBeenCalledTimes(1);
    }
  });

  it("a GET outside /rest/v1/ (auth, storage, functions) is passed through untouched, never retried", async () => {
    for (const url of [
      "https://x.supabase.co/auth/v1/token?grant_type=refresh_token",
      "https://x.supabase.co/storage/v1/object/public/foo.png",
      "https://x.supabase.co/functions/v1/claude-tag",
    ]) {
      const base = vi.fn().mockRejectedValueOnce(new Error("down"));
      const f = makeRetryingFetch(base);
      await expect(f(url, { method: "GET" })).rejects.toThrow("down");
      expect(base).toHaveBeenCalledTimes(1);
    }
  });

  it("a caller-initiated abort (signal already set before the call) is honored, not retried", async () => {
    const controller = new AbortController();
    controller.abort();
    const base = vi.fn();
    const f = makeRetryingFetch(base);
    await expect(f("https://x.supabase.co/rest/v1/settings", { method: "GET", signal: controller.signal })).rejects.toThrow();
    expect(base).not.toHaveBeenCalled();
  });

  it("a caller-initiated abort mid-flight is honored, not retried", async () => {
    const controller = new AbortController();
    const base = vi.fn().mockImplementationOnce((input, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(abortError()));
      controller.abort();
    }));
    const f = makeRetryingFetch(base);
    await expect(f("https://x.supabase.co/rest/v1/settings", { method: "GET", signal: controller.signal })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });
});

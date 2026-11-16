import { describe, it, expect } from "vitest";
import { autoFillDecision } from "./dealCheckAutoFill";

describe("autoFillDecision", () => {
  it("resets to null the instant dcRun goes false", () => {
    expect(autoFillDecision({ dcRun: false, full: false, loading: false, hasClient: true, fired: "headless" })).toEqual({ fire: false, nextFired: null });
    expect(autoFillDecision({ dcRun: false, full: true, loading: false, hasClient: true, fired: "full" })).toEqual({ fire: false, nextFired: null });
  });

  it("does not fire while loading, with no client, or not ready — and preserves whatever already fired", () => {
    expect(autoFillDecision({ dcRun: true, full: false, loading: true, hasClient: true, fired: null })).toEqual({ fire: false, nextFired: null });
    expect(autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: false, fired: "headless" })).toEqual({ fire: false, nextFired: "headless" });
    expect(autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, ready: false, fired: null })).toEqual({ fire: false, nextFired: null });
  });

  it("a fresh headless wake fires once, silently, and does not re-fire on a repeat render", () => {
    const d1 = autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, fired: null });
    expect(d1).toEqual({ fire: true, nextFired: "headless", silent: true });
    const d2 = autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, fired: d1.nextFired });
    expect(d2.fire).toBe(false);
    expect(d2.nextFired).toBe("headless");
  });

  it("a fresh real open fires once, non-silently", () => {
    const d = autoFillDecision({ dcRun: true, full: true, loading: false, hasClient: true, fired: null });
    expect(d).toEqual({ fire: true, nextFired: "full", silent: false });
  });

  it("a real open after a headless wake's one-shot was already spent still fires — non-silently", () => {
    const d = autoFillDecision({ dcRun: true, full: true, loading: false, hasClient: true, fired: "headless" });
    expect(d).toEqual({ fire: true, nextFired: "full", silent: false });
  });

  it("a headless render after a real open already fired does NOT fire again", () => {
    const d = autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, fired: "full" });
    expect(d.fire).toBe(false);
    expect(d.nextFired).toBe("full");
  });

  it("the ready:false -> true transition fires exactly once", () => {
    const blocked = autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, ready: false, fired: null });
    expect(blocked.fire).toBe(false);
    const fired = autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, ready: true, fired: blocked.nextFired });
    expect(fired).toEqual({ fire: true, nextFired: "headless", silent: true });
    const again = autoFillDecision({ dcRun: true, full: false, loading: false, hasClient: true, ready: true, fired: fired.nextFired });
    expect(again.fire).toBe(false);
  });
});

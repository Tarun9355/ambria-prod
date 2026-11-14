// executeConfirmBlocks used to flip an order's own status with `const updated = eventOrders.map(...)`
// off the HOOK's render-time closure — stale by the time this runs, since it's well after an awaited
// server claim + AI matching. setEventOrders (and saveEventOrders, which just calls it again) diffs
// its whole argument array against the LATEST eventOrdersRef.current: every other order that changed
// during the wait got reverted to its stale copy, and any order created during the wait got deleted
// outright (its id wasn't in the stale array). Confirmed live, 2026-11-14 ("finding A", same class of
// bug as the stale-`blocks`-snapshot issue below it). Fix: a functional updater touching only this one
// order by id, and no second saveEventOrders call (it would just re-run the same stale-shaped diff).
// This is a source-reading wiring test, same style as floralFallthrough.test.js — useEventOrderAutoConfirm
// is a React hook with no renderHook infra in this codebase (no @testing-library/react installed), so
// the fix is locked in by shape rather than by executing the hook.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("executeConfirmBlocks's own-order status flip (bug 5b)", () => {
  const src = readFileSync(new URL("./eventAutoConfirm.js", import.meta.url), "utf8");
  const start = src.indexOf("function executeConfirmBlocks(");
  const end = src.indexOf("// Bridge: auto-create Project + Function for operations tabs", start);
  const body = src.slice(start, end);

  it("exists and is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("calls setEventOrders with a FUNCTIONAL updater, not a pre-built array off the stale closure", () => {
    expect(body).toMatch(/setEventOrders\(prev\s*=>\s*prev\.map\(/);
    expect(body).not.toMatch(/const updated\s*=\s*eventOrders\.map/);
  });

  it("does not also call saveEventOrders (setEventOrders already persists — a second call just re-diffs the same stale shape)", () => {
    expect(body).not.toMatch(/saveEventOrders\(/);
  });

  it("the functional updater only touches the row matching eo.id — every other row passes through unchanged", () => {
    expect(body).toContain("e.id===eo.id?{");
    expect(body).toContain("}:e));");
  });
});

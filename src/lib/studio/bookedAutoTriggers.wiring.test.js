// Regression review (2026-11-16, Phase 1 of the "duplicate OOS gate" fix): a Build edit on a booked
// deal reaches Deal Check's reconcile/auto-fill pipeline through TWO independent paths — a direct,
// already-silent call (fixed in commit 50836787), and an invisible "headless" Deal Check instance
// woken by the same edit, whose own one-shot auto-fill effect called runDealCheckGenerate with NO
// silent flag at all. That second path could still pop the hard out-of-stock gate modal with nobody
// near Deal Check (owner report, confirmed live: a plain element edit popped it). Fixed by deriving
// silence from visibility (autoFillDecision, dealCheckAutoFill.js) instead of from the caller.
//
// Same change also closed a "cold client" hazard: reconcileSoldInventoryBlocks used to read its
// manual-items list from a closure (possibly the PREVIOUS client's, or not yet restored) while
// reading "is Deal Check state ready" from a live ref AFTER its own awaits — so a background sync
// starting for a client whose Deal Check state had never loaded this session could see "ready" (once
// openDealCheck's restore landed mid-flight) next to the WRONG manual list.
//
// This is a source-reading wiring test, same style as the other Phase 1 wiring tests (see
// manualItemDoubleCount.wiring.test.js) — these are closures inside the StudioApp component, not
// independently callable.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../pages/studio/StudioApp.jsx", import.meta.url), "utf8");

describe("the auto-fill effect derives silence from visibility, not from how it was woken", () => {
  const start = src.indexOf("const dcAutoFilledRef = useRef(null);");
  const end = src.indexOf("useEffect(() => { setDcHeadless(false); }, [activeClientId]);");

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = src.slice(start, end);

  it("calls autoFillDecision and passes its own silent flag through", () => {
    expect(body).toMatch(/autoFillDecision\(\{\s*dcRun,\s*full:\s*dcFullPageOpen/);
    expect(body).toMatch(/runDealCheckGenerate\(null,\s*\{\s*skipAi:\s*true,\s*silent:\s*d\.silent\s*\}\)/);
  });

  it("a real open clears dcHeadless so the hidden instance doesn't re-mount after close", () => {
    expect(body).toMatch(/if \(dcFullPageOpen\) setDcHeadless\(false\);/);
  });

  it("the decision effect re-runs on a dcFullPageOpen flip (without this dep, a headless-then-full transition would never fire its own non-silent run)", () => {
    expect(body).toMatch(/\}, \[dcRun, dcFullPageOpen, dealCheckLoading, activeClientId\]\);/);
  });

  it("no bare runDealCheckGenerate(null, { skipAi: true }) is left anywhere in the file (every call site states its own silent)", () => {
    expect(src).not.toMatch(/runDealCheckGenerate\(null,\s*\{\s*skipAi:\s*true\s*\}\)/);
  });
});

describe("runDealCheckGenerate only pops the hard gate modal / its own toasts when silent is false", () => {
  it("setOosGateModal from the sold-deal path is still gated on !silent (a silent run toasts instead)", () => {
    const idx = src.indexOf("setOosGateReason(\"dealCheckAutoSync\");");
    expect(idx).toBeGreaterThan(-1);
    const guardStart = src.lastIndexOf("if (activeClientIdRef.current === activeClientId)", idx);
    const guardBlock = src.slice(guardStart, idx);
    expect(guardBlock).toMatch(/if \(!silent\) \{\s*$/m);
  });

  it("the success toast stays gated on !silent (pre-existing, unchanged)", () => {
    expect(src).toMatch(/if \(!silent\) showMsg\(cardsUnmatched > 0/);
  });
});

describe("runDealCheckGenerate's fixed-venue lookup reads the boot-loaded copy, not dealCheckData (which is null for the whole duration of every open's fetch)", () => {
  it("fvCfg inside the per-zone match loop uses sharedFloralSettings.fixedVenues", () => {
    const idx = src.indexOf("setDcGenStatus(`Matching zone \"${zoneKey}\" (fn ${fnIdx + 1})…`);");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 900);
    expect(slice).toMatch(/const fvCfg = \{ fixedVenues: sharedFloralSettings\.fixedVenues/);
    expect(slice).not.toMatch(/fixedVenues: dealCheckData\?\.fixedVenues/);
  });
});

describe("reconcileSoldInventoryBlocks reads readiness + manual items together, once, before its first await", () => {
  const start = src.indexOf("const reconcileSoldInventoryBlocks = useCallback(async (fnsToProcess, newCards, inventoryList, cli) => {");
  const end = src.indexOf("}, [eventOrders, dealCheckData, clientLedger, saveClientLedger, submitAmendRequest, authUser, dcKitEdits, showMsg]);");

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = src.slice(start, end);

  it("reads dcStateRef.current before the function's first await", () => {
    const readyIdx = body.indexOf("const dcsAtStart = dcStateRef.current || {};");
    const firstAwait = body.indexOf("await ");
    expect(readyIdx).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(readyIdx);
  });

  it("derives manualReady and manualItemsNow from that same snapshot", () => {
    expect(body).toMatch(/const manualReady = dcsAtStart\.dcStateReadyClientId === cli\.id;/);
    expect(body).toMatch(/const manualItemsNow = manualReady && Array\.isArray\(dcsAtStart\.dcManualItems\) \? dcsAtStart\.dcManualItems : \[\];/);
  });

  it("no longer reads the live ref or the raw dcManualItems closure a second time later in the function", () => {
    expect(body).not.toMatch(/dcStateReadyForClientRef\.current === cli\.id/);
    expect(body).not.toMatch(/\(dcManualItems \|\| \[\]\)/);
  });

  it("manualByFn is built from manualItemsNow", () => {
    expect(body).toMatch(/manualItemsNow\.filter\(\(mi\) => \(mi\.fnIdx \?\? 0\) === fnIdx\)/);
  });
});

describe("openDealCheck commits the state twin in the same batch as the ready-ness ref", () => {
  it("setDcStateReadyClientId is called immediately after dcStateReadyForClientRef.current is set", () => {
    const refIdx = src.indexOf("dcStateReadyForClientRef.current = activeClientId;");
    expect(refIdx).toBeGreaterThan(-1);
    const after = src.slice(refIdx, refIdx + 300);
    expect(after).toMatch(/setDcStateReadyClientId\(activeClientId\);/);
  });

  it("dcStateReadyClientId is mirrored into dcStateRef alongside dcManualItems", () => {
    const idx = src.indexOf("dcStateRef.current = {");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 1100);
    expect(slice).toMatch(/dcManualItems/);
    expect(slice).toMatch(/dcStateReadyClientId,/);
  });
});

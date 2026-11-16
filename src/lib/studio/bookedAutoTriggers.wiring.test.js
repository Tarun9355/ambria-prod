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
    expect(body).toMatch(/\}, \[dcRun, dcFullPageOpen, dealCheckLoading, activeClientId, dcStateReadyClientId\]\);/);
  });

  it("Phase 2: a silent run is only considered ready once this client's own Deal Check state has restored; a real open is exempt", () => {
    expect(body).toMatch(/const ready = dcFullPageOpen \|\| dcStateReadyClientId === activeClientId;/);
    expect(body).toMatch(/ready,\s*fired:\s*dcAutoFilledRef\.current/);
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
  const end = src.indexOf("}, [eventOrders, dealCheckData, clientLedger, saveClientLedger, submitAmendRequest, authUser, showMsg]);");

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

  it("dcKitEdits gets the same readiness-gated snapshot treatment (owner ask, 2026-11-16: same cold-client hazard, different field)", () => {
    expect(body).toMatch(/const kitEditsNow = manualReady && dcsAtStart\.dcKitEdits && typeof dcsAtStart\.dcKitEdits === "object" \? dcsAtStart\.dcKitEdits : \{\};/);
    expect(body).toMatch(/const edited = kitEditsNow\?\.\[fnIdx\]\?\.\[cardKey\];/);
    expect(body).not.toMatch(/const edited = dcKitEdits\?\.\[fnIdx\]\?\.\[cardKey\];/);
  });

  it("dcKitEdits is no longer in this useCallback's own dependency array", () => {
    // The deps array IS the `end` anchor itself — inspect it directly rather than scanning a fixed
    // slice of the ~45k-char function body (which never reached the deps line and made this vacuous).
    const depsLine = src.slice(end, end + 110);
    expect(depsLine).toMatch(/^\}, \[eventOrders, dealCheckData, clientLedger, saveClientLedger, submitAmendRequest, authUser, showMsg\]\);/);
    expect(depsLine).not.toMatch(/dcKitEdits/);
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

// ═══ Phase 2 — one sync request per edit, a cold guard, and a keep-alive for the hidden run ═══

describe("autoSaveBuild makes ONE sync request per edit (requestBookedSync), not a direct call plus a separate headless wake", () => {
  const start = src.indexOf("if (opts.edited) {");
  const end = src.indexOf("}, []);", start);

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = src.slice(start, end);

  it("calls requestBookedSyncRef.current, not runDealCheckGenerateRef.current or syncDeptOpsHeadlessRef.current directly", () => {
    expect(body).toMatch(/requestBookedSyncRef\.current\?\.\(\);/);
    expect(body).not.toMatch(/runDealCheckGenerateRef\.current/);
    expect(body).not.toMatch(/syncDeptOpsHeadlessRef\.current/);
  });
});

describe("requestBookedSync picks exactly one action via bookedSyncAction", () => {
  const start = src.indexOf("const dcVisRef = useRef({ full: false, headless: false });");
  const end = src.indexOf("const buildHasDataRef = useRef(false);");

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = src.slice(start, end);

  it("wakes dcHeadless on \"wake\", calls runDealCheckGenerateRef directly (silent) on \"direct\"", () => {
    expect(body).toMatch(/bookedSyncAction\(dcVisRef\.current\) === "wake"/);
    expect(body).toMatch(/setDcHeadless\(true\); return;/);
    expect(body).toMatch(/runDealCheckGenerateRef\.current\?\.\(null, \{ skipAi: true, silent: true \}\)/);
  });
});

describe("runDealCheckGenerate defers a cold silent run instead of matching/reconciling from stale dc* state", () => {
  const start = src.indexOf("const runDealCheckGenerate = useCallback(");
  const inFlightIdx = src.indexOf("if (dcGenInFlightRef.current.has(activeClientId)) {", start);

  it("is where we think it is, and sits BEFORE the in-flight guard", () => {
    expect(start).toBeGreaterThan(-1);
    expect(inFlightIdx).toBeGreaterThan(start);
  });

  const body = src.slice(start, inFlightIdx);

  it("defers when silent and this client's dc* state isn't the ready one", () => {
    expect(body).toMatch(/if \(silent && dcStateRef\.current\?\.dcStateReadyClientId !== activeClientId\) \{/);
    expect(body).toMatch(/reason:\s*"cold-deferred"/);
  });

  it("wakes the unseen run only if nothing is already running (dcRunRef)", () => {
    expect(body).toMatch(/if \(!dcRunRef\.current\) setDcHeadless\(true\);/);
  });
});

describe("the Deal Check draft autosave only stamps the collision fields (dcDraftSavedAt/By) from a visibly-open Deal Check", () => {
  const start = src.indexOf("const doSave = (saveOpts = {}) => {");
  const end = src.indexOf("flushDcAutosaveRef.current = doSave;");

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = src.slice(start, end);

  it("stampPatch is empty unless dcVisRef.current.full, and dcSaveBaselineRef only advances for a full-page save", () => {
    // dcVisRef.current.full, not the bare dcFullPageOpen state var — this effect's own deps (below)
    // don't include dcFullPageOpen, so a closure read of it can go stale across a headless->full
    // transition (regression review, 2026-11-16, round 2).
    expect(body).toMatch(/const stampPatch = dcVisRef\.current\.full \? \{ dcDraftSavedAt: nowStamp, dcDraftSavedBy: me \} : \{\};/);
    expect(body).toMatch(/if \(dcVisRef\.current\.full\) dcSaveBaselineRef\.current = \{ savedAt: nowStamp, savedBy: me \};/);
    expect(body).not.toMatch(/dcFullPageOpen \? \{ dcDraftSavedAt/);
    expect(body).not.toMatch(/if \(dcFullPageOpen\) dcSaveBaselineRef/);
    // the write itself still always includes dcDraft/dcCards/etc — only the stamp is conditional
    expect(body).toMatch(/\.\.\.stampPatch \} : c\), undefined, \{ keepalive: !!saveOpts\.keepalive \}\);/);
  });
});

describe("a headless wake's own heavy-field-fetch failure stays silent; a real open still shows it", () => {
  it("ensureClientHeavyFieldsLoaded's toast is gated on !opts.silent", () => {
    const idx = src.indexOf("const ensureClientHeavyFieldsLoaded = useCallback(");
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 1200);
    expect(slice).toMatch(/if \(!opts\.silent\) showMsg\?\.\("Couldn't load this client's Deal Check draft/);
  });

  it("openDealCheck passes silent: !dcVisRef.current.full, not the bare (deps-stale) dcFullPageOpen state var", () => {
    // Regression review, 2026-11-16, round 2: openDealCheck's own useCallback deps don't include
    // dcFullPageOpen, so a real open's click could still read a stale false here and silence the
    // toast it was meant to keep — caught before this shipped.
    expect(src).toMatch(/ensureClientHeavyFieldsLoaded\(activeClientId, \{ silent: !dcVisRef\.current\.full \}\)/);
    expect(src).not.toMatch(/ensureClientHeavyFieldsLoaded\(activeClientId, \{ silent: !dcFullPageOpen \}\)/);
  });

  it("the function-removal reindex flow's own call is unaffected (no silent passed, toast stays unconditional there)", () => {
    const idx = src.indexOf("const c = await ensureClientHeavyFieldsLoaded(id);");
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("DealCheckOverlay's hidden-run lifetime restarts its 2.5s finish timer while a generate is in flight, with a 60s hard cap regardless", () => {
  const src2 = readFileSync(new URL("../../pages/studio/dealcheck/DealCheckOverlay.jsx", import.meta.url), "utf8");

  it("the 2.5s finish effect is gated on !dcGenerating and lists it in its deps", () => {
    expect(src2).toMatch(/if \(!dcHeadless \|\| !dcPriceSettled \|\| dcGenerating\) return;/);
    expect(src2).toMatch(/setTimeout\(\(\) => finishDcHeadless\?\.\(\), 2500\);[\s\S]{0,120}\}, \[dcHeadless, dcPriceSettled, dcGenerating\]\);/);
  });

  it("a separate, unconditional 60s hard cap still exists (not re-armed by dcGenerating)", () => {
    expect(src2).toMatch(/if \(!dcHeadless\) return;[\s\S]{0,40}setTimeout\(\(\) => finishDcHeadless\?\.\(\), 60000\);[\s\S]{0,80}\}, \[dcHeadless\]\);/);
  });
});


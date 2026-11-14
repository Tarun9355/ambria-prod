// bug 6 (2026-11-14 audit): IMS auto-confirm's own independent AI fuzzy matching could reserve a
// DIFFERENT item than Studio's own build actually uses. For a Studio-originated order (every
// event_orders row today — the only id minter is Studio itself), this engine now uses exact-invId-only
// matching (isStudioOrder/studioOrderItems) instead of aiMatchEvent's fuzzy stage-2, removing the
// wrong-item-hold risk entirely. The resulting hold is still WRITTEN, by owner decision (2026-11-14
// regression review): kept as a fallback reservation so a closed tab or a failed fetch right after
// Mark Sold doesn't leave a sold deal briefly unreserved with nothing to retry it — the overlap with
// Studio's own reconcile is harmless now that both resolve the exact same items (planStudioBlocks'
// adoption rule relabels this engine's entry rather than creating a second one). These are pure-
// function tests only; useEventOrderAutoConfirm is a React hook with no renderHook infra in this
// codebase, so the hook-level wiring is covered by the source-reading checks below instead.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isStudioOrder, studioOrderItems } from "./eventAutoConfirm.js";

describe("isStudioOrder", () => {
  it("true for an order with a clientId and a non-empty functionsDetail", () => {
    expect(isStudioOrder({ clientId: "CLI_1", functionsDetail: [{ date: "2026-11-15" }] })).toBe(true);
  });
  it("false without a clientId", () => {
    expect(isStudioOrder({ functionsDetail: [{ date: "2026-11-15" }] })).toBe(false);
  });
  it("false with an empty or missing functionsDetail (legacy path)", () => {
    expect(isStudioOrder({ clientId: "CLI_1", functionsDetail: [] })).toBe(false);
    expect(isStudioOrder({ clientId: "CLI_1" })).toBe(false);
  });
  it("false for null/undefined", () => {
    expect(isStudioOrder(null)).toBe(false);
    expect(isStudioOrder(undefined)).toBe(false);
  });
});

describe("studioOrderItems", () => {
  const inventory = [{ id: "chair1", name: "Chiavari Chair", qty: 100 }, { id: "pot1", name: "Fibre Pot", qty: 20 }];

  it("maps only invId-carrying elements that resolve in inventory", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", venue: "Taj", shift: "evening", type: "Wedding",
      elements: { stage: [{ name: "Chiavari Chair", invId: "chair1", qty: 50 }, { name: "Rate Card Only Prop", qty: 1 }] } }] };
    const r = studioOrderItems(eo, inventory);
    expect(r).toEqual([{ zone: "stage", element: "Chiavari Chair", qty: 50, sizeClass: "M", fnIdx: 0, fnDate: "2026-11-15", fnVenue: "Taj", fnShift: "evening", fnType: "Wedding", stage: 1, match: inventory[0], alternatives: [] }]);
  });

  it("skips FOC elements", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", elements: { stage: [{ name: "Chiavari Chair", invId: "chair1", qty: 50, foc: true }] } }] };
    expect(studioOrderItems(eo, inventory)).toEqual([]);
  });

  it("skips a zone switched off in Build (enabledEls[zk] === false)", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", enabledEls: { stage: false }, elements: { stage: [{ name: "Chiavari Chair", invId: "chair1", qty: 50 }] } }] };
    expect(studioOrderItems(eo, inventory)).toEqual([]);
  });

  it("skips an invId that no longer resolves in inventory (deleted/unknown item) — no fuzzy guess", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", elements: { stage: [{ name: "Gone", invId: "deleted1", qty: 5 }] } }] };
    expect(studioOrderItems(eo, inventory)).toEqual([]);
  });

  it("a missing/zero qty defaults to 1, same convention as aiMatchEvent's own el.qty||1", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", elements: { stage: [{ name: "Chiavari Chair", invId: "chair1", qty: 0 }] } }] };
    expect(studioOrderItems(eo, inventory)[0]?.qty).toBe(1);
  });

  it("skips a negative qty", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", elements: { stage: [{ name: "Chiavari Chair", invId: "chair1", qty: -3 }] } }] };
    expect(studioOrderItems(eo, inventory)).toEqual([]);
  });

  it("never fuzzy-matches — an element with no invId is left out entirely, not matched by name", () => {
    const eo = { functionsDetail: [{ fnIdx: 0, date: "2026-11-15", elements: { stage: [{ name: "Fibre Pot", qty: 3 }] } }] };
    expect(studioOrderItems(eo, inventory)).toEqual([]);
  });

  it("covers every function of a multi-function order, preserving each one's own fnIdx/date/venue", () => {
    const eo = { functionsDetail: [
      { fnIdx: 0, date: "2026-11-15", venue: "Taj", elements: { stage: [{ name: "Chiavari Chair", invId: "chair1", qty: 10 }] } },
      { fnIdx: 1, date: "2026-11-16", venue: "Exotica", elements: { entry: [{ name: "Fibre Pot", invId: "pot1", qty: 4 }] } },
    ] };
    const r = studioOrderItems(eo, inventory);
    expect(r.map((x) => [x.fnIdx, x.fnDate, x.fnVenue, x.match.id])).toEqual([[0, "2026-11-15", "Taj", "chair1"], [1, "2026-11-16", "Exotica", "pot1"]]);
  });
});

describe("autoConfirmEO's Studio-order path (source-reading wiring check)", () => {
  const src = readFileSync(new URL("./eventAutoConfirm.js", import.meta.url), "utf8");

  it("studio orders use exact-match studioOrderItems, never aiMatchEvent's fuzzy matching, but the hold IS still written (owner decision: keep IMS as a fallback reservation)", () => {
    const start = src.indexOf("const autoConfirmEO = useCallback(");
    const end = src.indexOf("}, [inventory, blocks, eventOrders, studio, settings, projects, functions, purchase, trussInv, applyBlocksRpc]);", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const studioOrder = isStudioOrder\(eo\);/);
    expect(body).toMatch(/studioOrder\s*\n?\s*\?\s*studioOrderItems\(eo, inventory\)/);
    expect(body).toMatch(/executeConfirmBlocks\(eo, results, \{\}, studioOrder \? \[\] : \(eo\.manualItems \|\| \[\]\), \{clearReviewState: false\}\)/);
  });

  it("executeConfirmBlocks always writes blocks via the locked RPC — no writeBlocks gate (the fallback-reservation decision)", () => {
    const start = src.indexOf("async function executeConfirmBlocks(");
    const end = src.indexOf("// Bridge: auto-create Project + Function for operations tabs", start);
    const body = src.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/writeBlocks/);
    expect(body).toMatch(/op\.add\.push\(\{ date: fn\.fnDate, qty: sumQty, status: "confirmed", source: "ims-autoconfirm" \}\);/);
    expect(body).toMatch(/applyBlocksRpc\(\[\.\.\.opsByItem\.values\(\)\], \{ onShort: "cap" \}\);/);
  });

  it("skips an item/date entirely once a studio-incremental/studio-manual entry for this event already covers it (regression review, 2026-11-14: a fallback write shouldn't claim anything once the authoritative one already has it)", () => {
    const start = src.indexOf("async function executeConfirmBlocks(");
    const end = src.indexOf("// Bridge: auto-create Project + Function for operations tabs", start);
    const body = src.slice(start, end);
    expect(body).toMatch(/b\.source==="studio-incremental" \|\| b\.source==="studio-manual"/);
    expect(body).toMatch(/if \(alreadyStudioHeld\) return;/);
  });

  it("throws (not just logs) on a genuine blocks-write failure, so autoConfirmEO's own catch returns false and the retry watcher picks it back up", () => {
    const start = src.indexOf("async function executeConfirmBlocks(");
    const end = src.indexOf("// Bridge: auto-create Project + Function for operations tabs", start);
    const body = src.slice(start, end);
    expect(body).toMatch(/if \(res\?\.error\) throw new Error\(/);
    expect(body).not.toMatch(/console\.error\("\[auto-confirm\] blocks write failed/);
  });

  it("the write is idempotent — each item's op removes its own prior ims-autoconfirm entry for the date before re-adding, so a retry can't duplicate it (bug 11)", () => {
    const start = src.indexOf("async function executeConfirmBlocks(");
    const end = src.indexOf("// Bridge: auto-create Project + Function for operations tabs", start);
    const body = src.slice(start, end);
    expect(body).toMatch(/op\.remove\.push\(\{ source: "ims-autoconfirm", date: fn\.fnDate \}\);/);
  });
});

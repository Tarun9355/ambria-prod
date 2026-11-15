// Regression review finding (2026-11-14, Phase 1 of the inventory-blocks fix): a Deal Check manual
// item added while a deal is still ONGOING gets mirrored into Build's zoneElements (syncManualItemToBuild,
// dealCheckSync.js, tagged `_dcManualId`) — and getCardSpecsForZone turns ANY zoneElement into a card
// regardless of that tag, so it was already being counted once via requiredByFn/cardReq. The new
// manualByFn/manualReq addition (bug 6's "Finding C") would otherwise count the SAME item a second
// time for any manual item added before the sale, double-reserving it in `blocks`. Fix: the card loop
// in reconcileSoldInventoryBlocks now skips a card backed by a `_dcManualId` Build element (unless it's
// FOC'd, which already routes elsewhere) — manualByFn is the single source of truth for every Deal
// Check manual item from here on, mirrored into Build or not.
//
// This is a source-reading wiring test, same style as the other Phase 1 wiring tests — the reconcile
// is a closure inside the StudioApp component, not independently callable.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("reconcileSoldInventoryBlocks' card loop skips Deal Check manual items (no double count)", () => {
  const src = readFileSync(new URL("../../pages/studio/StudioApp.jsx", import.meta.url), "utf8");
  const start = src.indexOf("const requiredByFn = {};");
  const end = src.indexOf("requiredByFn[fnIdx] = byItem;", start);
  const body = src.slice(start, end);

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("resolves the card's backing Build element and skips a non-FOC _dcManualId card", () => {
    expect(body).toMatch(/manualEl\?\.\_dcManualId && !isFoc_\) return;/);
  });

  it("a FOC'd manual card still routes through the ordinary FOC branch, not skipped", () => {
    // the skip check must run BEFORE tgt is assigned, and isFoc_ must still decide tgt afterward
    const skipIdx = body.indexOf("if (manualEl?._dcManualId && !isFoc_) return;");
    const tgtIdx = body.indexOf("const tgt = isFoc_ ? focByItem : byItem;");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(tgtIdx).toBeGreaterThan(skipIdx);
  });
});

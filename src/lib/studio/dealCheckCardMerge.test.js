import { describe, it, expect } from "vitest";
import { mergeManualSwaps } from "./dealCheckCardMerge.js";

describe("mergeManualSwaps (bug 17 — manual swap vs a freshly rebuilt card list)", () => {
  it("a manual swap present only in latestCards survives the merge", () => {
    const newCards = { 0: { "el::stage::Pot::0": { imsId: "pot1", qty: 2 } } };
    const latestCards = { 0: { "el::stage::Pot::0": { imsId: "pot2", qty: 2, source: "manual-swap" } } };
    const merged = mergeManualSwaps(newCards, latestCards, {});
    expect(merged[0]["el::stage::Pot::0"]).toEqual({ imsId: "pot2", qty: 2, source: "manual-swap" });
  });

  it("a non-manual-swap card in latestCards is NOT carried forward — newCards wins for it", () => {
    const newCards = { 0: { k: { imsId: "fresh", qty: 1 } } };
    const latestCards = { 0: { k: { imsId: "stale", qty: 1 } } };
    expect(mergeManualSwaps(newCards, latestCards, {})[0].k).toEqual({ imsId: "fresh", qty: 1 });
  });

  it("a pruned key (not in validKeysByFn for a processed fnIdx) is not resurrected, even if it was a manual swap", () => {
    const newCards = { 0: {} };
    const latestCards = { 0: { "gone-key": { imsId: "x", source: "manual-swap" } } };
    const merged = mergeManualSwaps(newCards, latestCards, { 0: new Set() }); // fnIdx 0 processed, "gone-key" not in its valid set
    expect(merged[0]["gone-key"]).toBeUndefined();
  });

  it("an fnIdx with no entry in validKeysByFn (not processed this run) carries every manual-swap card forward unconditionally", () => {
    const newCards = {}; // fnIdx 1 wasn't touched this run at all
    const latestCards = { 1: { k: { imsId: "x", source: "manual-swap" } } };
    const merged = mergeManualSwaps(newCards, latestCards, { 0: new Set(["k"]) }); // only fnIdx 0 has a valid-keys entry
    expect(merged[1].k).toEqual({ imsId: "x", source: "manual-swap" });
  });

  it("latestCards with no entry for an fnIdx leaves newCards' own cards for that fnIdx untouched", () => {
    const newCards = { 0: { k: { imsId: "fresh" } } };
    const merged = mergeManualSwaps(newCards, {}, {});
    expect(merged).toEqual(newCards);
  });

  it("empty/missing inputs never throw", () => {
    expect(mergeManualSwaps({}, {}, {})).toEqual({});
    expect(mergeManualSwaps(undefined, undefined, undefined)).toEqual({});
  });
});

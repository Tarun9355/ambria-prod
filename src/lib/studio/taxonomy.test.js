import { describe, it, expect } from "vitest";
import { liveAreaElementOptions, DEFAULT_TAX, trussRateFor } from "./taxonomy";

// Owner ask (2026-10-20): oversize used to be a cliff — crossing the sqft threshold switched the
// WHOLE area to the lower oversize rate, so a truss just over the line could price LOWER overall
// than one just under it. Now only the sqft ABOVE the threshold gets the oversize rate; the result
// is expressed as a single blended ₹/sqft so `area × rate` still gives the right total everywhere
// that multiplies by it, with the two tiers exposed alongside for a caption to explain.
describe("trussRateFor — oversize is tiered (first N sqft at base, only the rest at oversize)", () => {
  const rates = [{ shape: "box", material: "iron", density: "moderate", ratePerSqft: 20, oversizeThresholdSqft: 1850, oversizeRatePerSqft: 15 }];

  it("bills the first 1850 sqft at the base rate and only the remainder at the oversize rate", () => {
    const r = trussRateFor("box", "iron", "moderate", rates, 2000);
    expect(r.overApplies).toBe(true);
    const expectedTotal = 1850 * 20 + 150 * 15;
    expect(r.rate * 2000).toBeCloseTo(expectedTotal, 5); // blended rate × area = the tiered total
    expect(r.rate).toBeLessThan(20); // still cheaper overall than flat base-rate pricing
    expect(r.rate).toBeGreaterThan(15); // but never as cheap as the old cliff (whole area at 15)
  });

  it("never applies the oversize rate at or under the threshold", () => {
    const atThreshold = trussRateFor("box", "iron", "moderate", rates, 1850);
    expect(atThreshold.overApplies).toBe(false);
    expect(atThreshold.rate).toBe(20);
  });

  it("with no area given (existing callers with nothing to pass), prices flat at the base rate", () => {
    const r = trussRateFor("box", "iron", "moderate", rates);
    expect(r.overApplies).toBe(false);
    expect(r.rate).toBe(20);
  });
});

// Regression guard for a live bug: Build's "Review Upload → zone" tag editor (PhotoTagFields) kept
// showing taxonomy.areasElements' factory-default zone names (Stage, Entry Passage, Centre Lounge…)
// after the real zone list had been edited in Manage → Zone Types — taxonomy.areasElements is only
// best-effort synced on a rename, never a real source of truth. ManageLibrary's filter rail, its
// tag editor, and Build's photo-correction modal were already fixed to read the live zone list
// instead; PhotoTagFields was the one consumer still reading taxonomy.areasElements directly.
//
// All four now call this one function — if a future edit reaches for taxonomy.areasElements
// directly in a new (or "simplified") tag editor instead of calling liveAreaElementOptions, these
// tests still pass, because this is the only file them being right depends on. The thing that
// actually catches a reintroduced direct read is code review spotting `taxonomy.areasElements` (or
// `taxonomy["areasElements"]`) outside of this function — search for that before merging a change
// to any Areas & elements chip picker.
describe("liveAreaElementOptions", () => {
  it("sources labels from the live zone list, not taxonomy.areasElements", () => {
    const zoneKeys = ["stage", "entryPassage"];
    const zoneLabelsD = { stage: { label: "Stage" }, entryPassage: { label: "Entry Passage" } };
    const result = liveAreaElementOptions(zoneKeys, zoneLabelsD, []);
    expect(result).toEqual(["Stage", "Entry Passage"]);
    // The factory-default list must play no part once a live zone list is supplied.
    expect(result).not.toContain("Centre Lounge");
    expect(result).not.toEqual(DEFAULT_TAX.areasElements);
  });

  it("reflects a zone renamed in Manage → Zone Types with no separate sync step", () => {
    const zoneKeys = ["stage"];
    const renamed = { stage: { label: "Main Stage (renamed)" } };
    expect(liveAreaElementOptions(zoneKeys, renamed, [])).toEqual(["Main Stage (renamed)"]);
  });

  it("reflects a zone added in Manage → Zone Types immediately, with no taxonomy edit at all", () => {
    const zoneKeys = ["stage", "newZoneId"];
    const zoneLabelsD = { stage: { label: "Stage" }, newZoneId: { label: "Brand New Zone" } };
    expect(liveAreaElementOptions(zoneKeys, zoneLabelsD, [])).toContain("Brand New Zone");
  });

  it("drops a zone removed in Manage → Zone Types, even though it may still linger in taxonomy.areasElements", () => {
    const zoneKeys = ["stage"]; // "entryPassage" removed from the live zone list
    const zoneLabelsD = { stage: { label: "Stage" }, entryPassage: { label: "Entry Passage" } };
    expect(liveAreaElementOptions(zoneKeys, zoneLabelsD, [])).not.toContain("Entry Passage");
  });

  it("includes a deal's own custom (per-build) zones when supplied", () => {
    const result = liveAreaElementOptions(["stage"], { stage: { label: "Stage" } }, [{ id: "cz1", name: "Mandap Backdrop" }]);
    expect(result).toEqual(["Stage", "Mandap Backdrop"]);
  });

  it("de-dupes a custom zone that happens to share a standard zone's label", () => {
    const result = liveAreaElementOptions(["stage"], { stage: { label: "Stage" } }, [{ id: "cz1", name: "Stage" }]);
    expect(result).toEqual(["Stage"]);
  });

  it("falls back to the zone id when a zone has no label yet, and tolerates a missing zoneLabelsD", () => {
    expect(liveAreaElementOptions(["unlabeledZone"], {}, [])).toEqual(["unlabeledZone"]);
    expect(liveAreaElementOptions(["unlabeledZone"], undefined, [])).toEqual(["unlabeledZone"]);
  });

  it("tolerates missing zoneKeys/customZones (ManageLibrary's filter rail omits customZones entirely)", () => {
    expect(liveAreaElementOptions(undefined, undefined, undefined)).toEqual([]);
    expect(liveAreaElementOptions(["stage"], { stage: { label: "Stage" } })).toEqual(["Stage"]);
  });
});

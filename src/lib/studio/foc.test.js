import { describe, it, expect } from "vitest";
import { isFoc, parseCardKeyLite, cardIsFoc } from "./foc.js";

describe("isFoc", () => {
  it("true only for foc === true, never a truthy-but-not-true value", () => {
    expect(isFoc({ foc: true })).toBe(true);
    expect(isFoc({ foc: false })).toBe(false);
    expect(isFoc({})).toBe(false);
    expect(isFoc(null)).toBe(false);
    expect(isFoc({ foc: 1 })).toBe(false);
  });
});

describe("parseCardKeyLite", () => {
  it("parses an 'el' card key", () => {
    expect(parseCardKeyLite("el::stage::Round Fibre Podium::2")).toEqual({ zoneKey: "stage", rcName: "Round Fibre Podium", idx: 2 });
  });
  it("parses an 'fl' card key (propType ignored, idx still at [3])", () => {
    expect(parseCardKeyLite("fl::entry::Rose::1::vase")).toEqual({ zoneKey: "entry", rcName: "Rose", idx: 1 });
  });
  it("rejects an unknown prefix, a short key, or a non-numeric idx", () => {
    expect(parseCardKeyLite("xx::stage::Name::0")).toBeNull();
    expect(parseCardKeyLite("el::stage::Name")).toBeNull();
    expect(parseCardKeyLite("el::stage::Name::abc")).toBeNull();
    expect(parseCardKeyLite(null)).toBeNull();
  });
});

describe("cardIsFoc — fail-safe on any mismatch", () => {
  const zoneElements = { stage: [{ name: "Round Fibre Podium", invId: "pod1", qty: 5, foc: true }, { name: "Chair", invId: "c1", qty: 10 }] };

  it("true when the backlinked element is FOC and the name matches", () => {
    expect(cardIsFoc(zoneElements, "el::stage::Round Fibre Podium::0")).toBe(true);
  });
  it("false when the backlinked element is not FOC", () => {
    expect(cardIsFoc(zoneElements, "el::stage::Chair::1")).toBe(false);
  });
  it("false (fail-safe) on a name mismatch, even though the element at that index IS foc:true", () => {
    expect(cardIsFoc(zoneElements, "el::stage::Some Other Name::0")).toBe(false);
  });
  it("false for an unparseable or out-of-range cardKey, never throws", () => {
    expect(cardIsFoc(zoneElements, "not-a-card-key")).toBe(false);
    expect(cardIsFoc(zoneElements, "el::stage::Round Fibre Podium::99")).toBe(false);
    expect(cardIsFoc(undefined, "el::stage::Round Fibre Podium::0")).toBe(false);
  });
  it("is case/whitespace-insensitive on the name match, like the rest of the codebase's name comparisons", () => {
    expect(cardIsFoc(zoneElements, "el::stage::  round fibre podium  ::0")).toBe(true);
  });
});

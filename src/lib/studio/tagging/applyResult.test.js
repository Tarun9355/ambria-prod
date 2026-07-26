// Tests for the single shared "apply the AI result" merge (spec §9-B / §12.2).
// Guards the behaviours the three old copies had drifted on: tag_source stamping,
// name-only-if-placeholder, and gotTags gating (empty pass must NOT look "done").
import { describe, it, expect } from "vitest";
import { applyAiTagResult } from "./applyResult.js";

// The tagger only copies taxonomy KEYS that exist here — mirror the live shape.
const TAX = { eventType: [], venueType: [], areasElements: [], colorPalette: [], designStyle: [] };

const fullResult = {
  name: "Mandap Stage — Ivory Drapes & Crystal Chandelier",
  tags: { eventType: ["Wedding"], venueType: ["Banquet"], areasElements: ["Mandap"] },
  elements: [{ name: "Crystal Chandelier", qty: 2 }],
  lightCount: 12,
  unrecognized: ["weird thing"],
  dims: { trussL: 20, trussW: 10, trussH: 12, floorL: 30, floorW: 20, plH: "2", mkT: "fabric", mkWalls: {} },
};

describe("failure / empty result", () => {
  it("null result → gotTags false, no stamps", () => {
    const { patch, gotTags } = applyAiTagResult({ name: "img 1" }, null, { taxonomy: TAX, tagSource: "manual" });
    expect(gotTags).toBe(false);
    expect(patch._aiTagged).toBeUndefined();
    expect(patch.tagSource).toBeUndefined();
  });
  it("result with only empty tag arrays and no elements → gotTags false", () => {
    const res = { tags: { eventType: [], venueType: [] }, elements: [] };
    const { patch, gotTags } = applyAiTagResult({}, res, { taxonomy: TAX, tagSource: "manual" });
    expect(gotTags).toBe(false);
    expect(patch.tags).toBeUndefined();
    expect(patch._aiTagged).toBeUndefined();
  });
});

describe("successful tag merge", () => {
  it("copies only non-empty taxonomy arrays and merges onto existing tags", () => {
    const existing = { tags: { colorPalette: ["Ivory"] } };
    const { patch, gotTags } = applyAiTagResult(existing, fullResult, { taxonomy: TAX, tagSource: "manual" });
    expect(gotTags).toBe(true);
    expect(patch.tags.eventType).toEqual(["Wedding"]);
    expect(patch.tags.venueType).toEqual(["Banquet"]);
    // pre-existing key preserved when the AI didn't supply it
    expect(patch.tags.colorPalette).toEqual(["Ivory"]);
  });
  it("stamps _aiTagged + _aiTaggedAt + tagSource when tags land", () => {
    const { patch } = applyAiTagResult({}, fullResult, { taxonomy: TAX, tagSource: "manual" });
    expect(patch._aiTagged).toBe(true);
    expect(typeof patch._aiTaggedAt).toBe("number");
    expect(patch.tagSource).toBe("manual");
  });
  it("carries elements, lightCount, unrecognized and the _aiTags snapshot", () => {
    const { patch } = applyAiTagResult({}, fullResult, { taxonomy: TAX, tagSource: "build" });
    expect(patch.elements).toHaveLength(1);
    expect(patch.lightCount).toBe(12);
    expect(patch.unrecognized).toEqual(["weird thing"]);
    expect(patch._aiTags).toEqual(fullResult.tags); // snapshot for the corrections diff
    expect(patch.tagSource).toBe("build");
  });
  it("elements alone (no tags) still count as gotTags", () => {
    const { patch, gotTags } = applyAiTagResult({}, { elements: [{ name: "Sofa" }] }, { taxonomy: TAX, tagSource: "manual" });
    expect(gotTags).toBe(true);
    expect(patch.tagSource).toBe("manual");
  });
});

describe("name replacement policy", () => {
  const res = { name: "AI Proposed Name", tags: { eventType: ["Wedding"] } };
  it("replaces a missing name", () => {
    expect(applyAiTagResult({}, res, { taxonomy: TAX }).patch.name).toBe("AI Proposed Name");
  });
  it("replaces a placeholder name ('img ...' / 'Untitled')", () => {
    expect(applyAiTagResult({ name: "img 4521" }, res, { taxonomy: TAX }).patch.name).toBe("AI Proposed Name");
    expect(applyAiTagResult({ name: "Untitled" }, res, { taxonomy: TAX }).patch.name).toBe("AI Proposed Name");
  });
  it("NEVER overwrites a human-chosen name", () => {
    const p = applyAiTagResult({ name: "Ashi's favourite mandap" }, res, { taxonomy: TAX }).patch;
    expect(p.name).toBeUndefined();
  });
});

describe("dims", () => {
  it("writes dims only when a truss/floor dimension is present", () => {
    const { patch } = applyAiTagResult({}, fullResult, { taxonomy: TAX });
    expect(patch.dims.trussL).toBe(20);
    expect(patch.dims.mkT).toBe("fabric");
  });
  it("skips dims entirely when all size fields are absent/zero", () => {
    const res = { tags: { eventType: ["Wedding"] }, dims: { plH: "2" } };
    expect(applyAiTagResult({}, res, { taxonomy: TAX }).patch.dims).toBeUndefined();
  });
});

describe("tagSource is only stamped on success", () => {
  it("no tagSource stamped when nothing landed even if one was passed", () => {
    const { patch } = applyAiTagResult({}, null, { taxonomy: TAX, tagSource: "manual" });
    expect(patch.tagSource).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { normName, nameKey, isDevanagari, needsHindi, parseHindiReply, batches, HINDI_NAMES_PROMPT } from "./hindiNames.js";

describe("hindiNames — pure helpers", () => {
  it("normalises a name: trimmed, spaces collapsed; the key is lower-case", () => {
    expect(normName("  Muradabad  Metal Prop ")).toBe("Muradabad Metal Prop");
    expect(nameKey("  Chivari   CHAIR ")).toBe("chivari chair");
    expect(nameKey(null)).toBe("");
  });
  it("tells Devanagari apart", () => {
    expect(isDevanagari("चिवारी चेयर")).toBe(true);
    expect(isDevanagari("Chivari Chair")).toBe(false);
    expect(isDevanagari("")).toBe(false);
  });
  it("only names with Latin letters, not already Hindi, are asked for", () => {
    expect(needsHindi("Sofa")).toBe(true);
    expect(needsHindi("3x4")).toBe(true);
    expect(needsHindi("—")).toBe(false);
    expect(needsHindi("1200")).toBe(false);
    expect(needsHindi("सोफ़ा")).toBe(false);
  });
  it("reads a clean JSON reply, keyed by the lookup key", () => {
    expect(parseHindiReply('{"Chivari Chair": "चिवारी चेयर", "Couch 13": "काउच 13"}'))
      .toEqual({ "chivari chair": "चिवारी चेयर", "couch 13": "काउच 13" });
  });
  it("tolerates code fences and chatter around the object", () => {
    const r = parseHindiReply('Here you go:\n```json\n{"Sofa":"सोफ़ा"}\n```\nDone.');
    expect(r).toEqual({ sofa: "सोफ़ा" });
  });
  it("drops values that are not Devanagari, not strings, or empty", () => {
    expect(parseHindiReply('{"Sofa":"Sofa","Chair":5,"Table":"  ","Rose Gold":"रोज़ गोल्ड"}')).toEqual({ "rose gold": "रोज़ गोल्ड" });
  });
  it("never throws on junk", () => {
    expect(parseHindiReply("")).toEqual({});
    expect(parseHindiReply("no json here")).toEqual({});
    expect(parseHindiReply("{not: json}")).toEqual({});
    expect(parseHindiReply('["सोफ़ा"]')).toEqual({});
    expect(parseHindiReply(undefined)).toEqual({});
  });
  it("batches at 60", () => {
    const list = Array.from({ length: 125 }, (_, i) => `Item ${i}`);
    expect(batches(list).map(b => b.length)).toEqual([60, 60, 5]);
    expect(batches([])).toEqual([]);
  });
  it("the prompt asks for transliteration and a JSON object only", () => {
    expect(HINDI_NAMES_PROMPT).toMatch(/TRANSLITERATE/);
    expect(HINDI_NAMES_PROMPT).toMatch(/JSON object/);
  });
});

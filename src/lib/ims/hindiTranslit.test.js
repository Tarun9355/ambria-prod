import { describe, it, expect } from "vitest";
import { toHindi, phoneticHindi } from "./hindiTranslit";

describe("toHindi", () => {
  it("spells known words from the list and keeps digits and symbols", () => {
    expect(toHindi("Iron Wooden Coffee Table")).toBe("आयरन वुडन कॉफ़ी टेबल");
    expect(toHindi("Rajnigandha hanging RFT 4ft")).toBe("रजनीगंधा हैंगिंग आरएफ़टी 4फ़ुट");
    expect(toHindi("5 × 12 inches")).toBe("5 × 12 इंच");
    expect(toHindi("Exotica › Aura")).toBe("एक्ज़ोटिका › ऑरा");
  });
  it("spells an acronym letter by letter and keeps a lone letter", () => {
    expect(toHindi("BTR")).toBe("बीटीआर");
    expect(toHindi("3D Box Big")).toBe("3D बॉक्स बिग");
  });
  it("plurals of listed words", () => {
    expect(toHindi("Pedestals")).toBe("पेडस्टल्स");
    expect(toHindi("Chivari Chairs")).toBe("चिवारी चेयर्स");
  });
  it("an unknown word comes out in Devanagari, not English", () => {
    expect(toHindi("Zorblax")).toMatch(/^[ऀ-ॿ]+$/);
    expect(phoneticHindi("candle")).toBe("कंडल");
    expect(phoneticHindi("dandela")).toBe("डंडेला");
  });
  it("leaves text with no Latin letters alone", () => {
    expect(toHindi("गुलाब 12")).toBe("गुलाब 12");
    expect(toHindi("")).toBe("");
    expect(toHindi(null)).toBe("");
  });
});

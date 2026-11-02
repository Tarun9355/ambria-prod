import { describe, it, expect } from "vitest";
import { uiHindi } from "./uiHindi";

describe("uiHindi", () => {
  it("a listed label becomes its Hindi phrase", () => {
    expect(uiHindi("Loading & dispatch")).toBe("लोडिंग और डिस्पैच");
    expect(uiHindi("Truck planning")).toBe("ट्रक प्लानिंग");
  });
  it("keeps emoji, arrows and the spaces around a label", () => {
    expect(uiHindi("🧵 Fabric allocation")).toBe("🧵 फ़ैब्रिक बँटवारा");
    expect(uiHindi(" Real shopping = ")).toBe(" असली ख़रीद = ");
    expect(uiHindi("🌸 Flowers:")).toBe("🌸 फूल:");
  });
  it("names and unlisted text go to Devanagari, digits and ₹ kept", () => {
    expect(uiHindi("Iron Pedestal ×28")).toBe("आयरन पेडस्टल ×28");
    expect(uiHindi("12 pcs")).toBe("12 पीस");
    expect(uiHindi("Tue, 3 Feb 2027")).toBe("मंगल, 3 फ़रवरी 2027");
    expect(uiHindi("₹1,200")).toBe("₹1,200");
  });
  it("leaves emails, links and Hindi alone", () => {
    expect(uiHindi("sales@ambria.in")).toBe("sales@ambria.in");
    expect(uiHindi("गुलाब")).toBe("गुलाब");
  });
});

describe("uiHindi - truck statuses", () => {
  it("statuses are Hindi words, any case", () => {
    expect(uiHindi("Loading")).toBe("लोडिंग");
    expect(uiHindi("dispatched")).toBe("डिस्पैच हुआ");
    expect(uiHindi("At site")).toBe("साइट पर");
  });
});

describe("uiHindi - routing and pieces built around numbers", () => {
  it("Add a site / Send items", () => {
    expect(uiHindi("Add a site")).toBe("साइट जोड़ें");
    expect(uiHindi("Send items to another event")).toBe("सामान दूसरे इवेंट में भेजें");
  });
  it("a listed phrase inside a longer text", () => {
    expect(uiHindi("Short for this date — only 3")).toBe("इस तारीख पर कम — सिर्फ़ 3");
    expect(uiHindi("12 sqft free · covers it")).toBe("12 वर्ग फुट खाली · पूरा पड़ता है");
    expect(uiHindi("🌿 Greens:")).toBe("🌿 ग्रीन्स:");
  });
});

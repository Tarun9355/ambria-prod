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

import { describe, it, expect } from "vitest";
import { uiHindi } from "./uiHindi";

// Loading & dispatch's truck-details / new-truck notes read as Hindi, not as English spelled in Devanagari
// (owner screenshot 2026-11-25: "फ़िल्ल गाड़ी नंबर ... अबोव फ़र्स्ट").
describe("uiHindi - truck notes", () => {
  it.each([
    ["Fill these first:", "पहले ये भरें:"],
    ["nothing can be loaded on this truck until they are filled.", "इन्हें भरे बिना इस ट्रक में कुछ लोड नहीं होगा।"],
    ["A new truck can be added after that.", "उसके बाद नया ट्रक जोड़ सकते हैं।"],
    ["still has space", "में अभी जगह है"],
    ["fill it before adding another truck.", "दूसरा ट्रक जोड़ने से पहले इसे भरें।"],
    ["Add new truck anyway", "फिर भी नया ट्रक जोड़ें"],
    ["Details needed", "जानकारी भरें"],
    ["New truck", "नया ट्रक"],
    ["Save truck", "ट्रक सेव करें"],
    ["+ Add trip", "+ ट्रिप जोड़ें"],
    ["Trucks & dismantle", "ट्रक और डिसमेंटल"],
    ["Dismantle", "डिसमेंटल"],
    ["Dismantle · Routing", "डिसमेंटल · रूटिंग"],
    ["Going", "जाना"],
  ])("%s", (en, hi) => {
    expect(uiHindi(en)).toBe(hi);
  });
  it("a truck's number keeps its digit", () => {
    expect(uiHindi("Truck 2")).toContain("2");
    expect(uiHindi("Truck 2")).not.toMatch(/[A-Za-z]/);
  });
});

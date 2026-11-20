import { describe, it, expect } from "vitest";
import { uiHindi } from "./uiHindi";

// Owner report 2026-11-20: "My events" read as a spelled-out English phrase in the Hindi screen. The Site-Supervisor-view-only role's own
// labels have real Hindi phrases (lib/ims/uiHindiMore).
describe("Site Supervisor role labels in Hindi", () => {
  it("the My events button, with and without the tick", () => {
    expect(uiHindi("My events")).toBe("मेरे इवेंट");
    expect(uiHindi("My events ✓")).toBe("मेरे इवेंट ✓");
  });
  it("the empty-state link and the two PDF buttons", () => {
    expect(uiHindi("Show every event")).toBe("सभी इवेंट दिखाएँ");
    expect(uiHindi("All departments PDF")).toBe("सभी विभागों की PDF");
    expect(uiHindi("Floral PDF")).toBe("फ्लोरल PDF");
  });
  it("the empty-state sentences and the button's tooltips are real Hindi, not a spelled-out English sentence", () => {
    for (const en of [
      "No functions at your venues this month, and none you are the Site Supervisor of - page to another month.",
      "Your login is not on the Site Supervisor list (Admin → Settings → Supervisors) with this name / phone number - ask the admin to add you.",
      "Show only the functions at the venues you are fixed at (and events you are the Site Supervisor of)",
      "Showing only the functions at your venues (and events you are the Site Supervisor of) - tap to show every event",
    ]) {
      const hi = uiHindi(en);
      expect(hi).not.toBe(en);
      expect(hi).toMatch(/[ऀ-ॿ]{4,}/);
      expect(hi).not.toMatch(/[A-Za-z]{4,}\s+[A-Za-z]{4,}\s+[A-Za-z]{4,}/); // no run of untranslated English words (Admin → Settings → Supervisors is a menu path, kept)
    }
  });
  it("the tiles the role sees keep their listed Hindi", () => {
    for (const en of ["Inventory blocked", "Manpower plan", "Receiving", "Dismantle & routing", "Site Supervisor"]) expect(uiHindi(en)).toMatch(/[ऀ-ॿ]/);
    expect(uiHindi("Manpower plan updated")).toBe("मैनपावर प्लान बदला");
  });
});

import { describe, it, expect } from "vitest";
import { aiMatchEvent } from "./eventAutoConfirm.js";

// A FOC'd element must never reach IMS's own AI matching — it's never blocked, even pre-sale
// (see soldBlocksPlan.js's file comment and reconcileSoldInventoryBlocks' cardIsFoc split). Studio's
// FOC guard sits upstream of all of this; this just confirms aiMatchEvent itself holds the line for
// a deal that goes through IMS's auto-confirm before Studio's own reconcile ever gets a chance to run.
const inventory = [{ id: "chair1", name: "Chiavari Chair", cat: "furniture", qty: 100, blocked: 0 }];

describe("aiMatchEvent — FOC elements are skipped, never matched or blocked", () => {
  it("a FOC element produces no match result at all; an ordinary sibling still matches normally", async () => {
    const eventOrder = {
      id: "eo_1",
      functionsDetail: [{
        fnIdx: 0, date: "2026-11-25", venue: "Taj", shift: "evening", type: "Wedding",
        // zones.stage is a plain (non-array) zone-SETTINGS object, as real Studio data sends it —
        // matchOneFn then falls back to reading elements[zoneKey] for the actual element list, which
        // is the path real production data takes (confirmed, regression review 2026-11-14: an
        // earlier version of this test set zones.stage to the SAME array as elements.stage, which
        // meant the array short-circuit — never the real elements[zoneKey] fallback — ran instead).
        elements: { stage: [{ name: "Chiavari Chair", qty: 50, foc: true }, { name: "Chiavari Chair", qty: 20 }] },
        zones: { stage: {} },
      }],
    };
    const results = await aiMatchEvent(eventOrder, inventory, {}, {});
    expect(results.length).toBe(1);
    expect(results[0].qty).toBe(20);
  });

  it("a function that is ENTIRELY FOC produces zero results, and does not fall back to the flat-element-map path", async () => {
    const eventOrder = {
      id: "eo_2",
      functionsDetail: [{
        fnIdx: 0, date: "2026-11-25", venue: "Taj", shift: "evening", type: "Wedding",
        elements: { stage: [{ name: "Chiavari Chair", qty: 50, foc: true }] },
        zones: { stage: {} },
      }],
    };
    const results = await aiMatchEvent(eventOrder, inventory, {}, {});
    expect(results.length).toBe(0);
  });
});

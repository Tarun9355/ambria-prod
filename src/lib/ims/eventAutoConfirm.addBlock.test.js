import { describe, it, expect } from "vitest";
import { addBlock } from "./eventAutoConfirm.js";

describe("addBlock — optional source tag (owner ask, 2026-11-14: Studio's sold-deal reconcile needs to", () => {
  it("tell its own reservations apart from everyone else's)", () => {
    const next = addBlock({}, "ITEM1", "2026-11-25", "eo_1", 4, "confirmed");
    expect(next.ITEM1).toEqual([{ date: "2026-11-25", eventId: "eo_1", qty: 4, status: "confirmed", createdAt: expect.any(Number) }]);
    expect(next.ITEM1[0]).not.toHaveProperty("source");
  });
  it("with a source, the entry carries it — every existing caller (no source passed) is unaffected", () => {
    const next = addBlock({}, "ITEM1", "2026-11-25", "eo_1", 4, "confirmed", "ims-autoconfirm");
    expect(next.ITEM1[0].source).toBe("ims-autoconfirm");
  });
  it("defaults qty to 1 and status to 'held', same as before, regardless of source", () => {
    const next = addBlock({}, "ITEM1", "2026-11-25", "eo_1", undefined, undefined, "ims-manual");
    expect(next.ITEM1[0]).toMatchObject({ qty: 1, status: "held", source: "ims-manual" });
  });
});

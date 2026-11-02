import { describe, it, expect } from "vitest";
import { crossedMiddle } from "./zoneDrop";

describe("zone drag: swap only past the hovered zone's middle", () => {
  // hovered zone spans 400..800 (middle 600)
  it("dragging down: not on entering the top half, yes past the middle", () => {
    expect(crossedMiddle(0, 1, 420, 400, 400)).toBe(false);
    expect(crossedMiddle(0, 1, 599, 400, 400)).toBe(false);
    expect(crossedMiddle(0, 1, 601, 400, 400)).toBe(true);
  });
  it("dragging up: not on entering the bottom half, yes above the middle", () => {
    expect(crossedMiddle(2, 1, 780, 400, 400)).toBe(false);
    expect(crossedMiddle(2, 1, 601, 400, 400)).toBe(false);
    expect(crossedMiddle(2, 1, 599, 400, 400)).toBe(true);
  });
  it("never for the zone itself or an unknown one", () => {
    expect(crossedMiddle(1, 1, 0, 400, 400)).toBe(false);
    expect(crossedMiddle(-1, 1, 900, 400, 400)).toBe(false);
  });
  it("right after a swap the pointer is on the near side of the zone it passed, so it does not swap back", () => {
    // dragged down past B's middle -> A now sits where B was; B moved up above the pointer. Hovering B now means
    // dragging UP over it, which needs the pointer above B's middle - it is below, so nothing happens.
    const bTopAfter = 100, bHeight = 400; // B now spans 100..500, pointer still at 601
    expect(crossedMiddle(1, 0, 601, bTopAfter, bHeight)).toBe(false);
  });
});

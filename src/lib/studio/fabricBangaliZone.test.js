import { describe, it, expect, vi, beforeEach } from "vitest";

// The fabric a truss carries (Liza kg / curtain pieces) is pricing.js's own calculation - stubbed here so the test is about the
// Fabric Bangali rule, not about the fabric maths.
const fab = { lizaKg: 0, curtainPieces: 0 };
vi.mock("./pricing", async (orig) => ({ ...(await orig()), calcZoneFabric: () => ({ ...fab }) }));
const { fabricBangaliZone } = await import("./manpowerCount");

describe("fabricBangaliZone - a U or half box carrying Liza / curtains counts its span (owner report 2026-11-11)", () => {
  beforeEach(() => { fab.lizaKg = 0; fab.curtainPieces = 0; });
  const uStage = { dims: { W: 38.25, H: 15 } }; // Single U, like the Entertainment Stage

  it("a U with Liza and velvet curtains but no masking: its back span is Fabric Bangali's", () => {
    fab.lizaKg = 4; fab.curtainPieces = 6;
    const w = fabricBangaliZone(uStage, {}, [], 4);
    expect(w.config).toBe("u_only");
    expect(w.fabric).toBe(true);
    expect(w.rft).toBeCloseTo(38.25);
  });
  it("a bare U (no fabric, no masking) is not Fabric Bangali's - as before", () => {
    expect(fabricBangaliZone(uStage, {}, [], 4).rft).toBe(0);
  });
  it("a U masked at the back and draped counts the span once", () => {
    fab.lizaKg = 2;
    expect(fabricBangaliZone({ ...uStage, mkOn: true, mkWalls: { back: true } }, {}, [], 4).rft).toBeCloseTo(38.25);
  });
  it("a full box: canopy by the range table and only its masked walls - fabric on it adds nothing new", () => {
    fab.lizaKg = 5;
    const w = fabricBangaliZone({ dims: { L: 10, W: 10, H: 10 } }, {}, [{ upTo: 150, labour: 3 }], 4);
    expect(w).toMatchObject({ config: "full_box", top: 3, rft: 0 });
  });
  it("says wall by wall what counts and why (the Deal Check 'how' lines)", () => {
    fab.curtainPieces = 3;
    expect(fabricBangaliZone(uStage, {}, [], 4).walls).toEqual([{ wall: "back", ft: 38.25, basis: "span", why: "fabric" }]);
    const masked = fabricBangaliZone({ dims: { L: 10, W: 8, H: 10 }, mkOn: true, mkWalls: { back: true, left: true } }, {}, [], 4);
    expect(masked.walls).toEqual([{ wall: "back", ft: 8, basis: "W", why: "masking" }, { wall: "left", ft: 10, basis: "L", why: "masking" }]);
    expect(masked.rft).toBe(18);
  });
  it("no truss: nothing", () => {
    expect(fabricBangaliZone({ dims: {} }, {}, [], 4)).toBeNull();
  });
});

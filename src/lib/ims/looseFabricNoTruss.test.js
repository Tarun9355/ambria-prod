import { describe, it, expect } from "vitest";
import { makeEventPlans } from "./eventPlans.js";
import { calcStructCost } from "../../pages/studio/StudioApp.jsx";

// Loose fabric in a zone with no truss (Build's Elements "🧵 Loose fabric", owner ask 2026-11-17)
const trussInv = { rates: { lizaKgRate: 100, curtainPieceRate: 200, maskingPieceRate: 50 } };
const zone = { looseFabric: [{ kind: "liza", colour: "Ivory", qty: 10 }, { kind: "curtain", colour: "Red", qty: 2 }] };

describe("loose fabric without a truss", () => {
  it("is billed with the zone's structure (10 kg Liza x 100 + 2 curtains x 200, x the guest fabric multiplier)", () => {
    expect(calcStructCost("entrance", zone, { trussInv, fabricMultiplier: 1 }, false).fabric).toBe(1400);
  });
  it("reaches IMS's Fabric block / Dept Book as an entry of its own", () => {
    const sel = { functionsDetail: [{ type: "Haldi", enabledEls: { entrance: true }, zones: { entrance: zone } }] };
    const entries = makeEventPlans({ sel, trussInv }).fabricEntriesOf();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ fi: 0, zk: "entrance", ri: 0, fnLabel: "Haldi" });
    expect(entries[0].row.looseFabric).toHaveLength(2);
  });
  it("not for a switched-off zone, an empty list, or a FOC truss", () => {
    const sel = (z, on = true) => ({ functionsDetail: [{ enabledEls: { entrance: on }, zones: { entrance: z } }] });
    expect(makeEventPlans({ sel: sel(zone, false), trussInv }).fabricEntriesOf()).toHaveLength(0);
    expect(makeEventPlans({ sel: sel({ looseFabric: [{ kind: "liza", qty: 0 }] }), trussInv }).fabricEntriesOf()).toHaveLength(0);
    expect(makeEventPlans({ sel: sel({ ...zone, trussFoc: true }), trussInv }).fabricEntriesOf()).toHaveLength(0);
  });
});

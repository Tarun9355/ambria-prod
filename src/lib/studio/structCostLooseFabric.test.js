import { describe, it, expect } from "vitest";
import { calcStructCost } from "../../pages/studio/StudioApp.jsx";
import { GUEST_FABRIC_MULTIPLIER } from "./pricing.js";

// Owner report, 2026-11-16: Build's "Truss & Masking" chip total never included loose fabric added
// via the Fabric card's own "+ Add loose fabric" row, even though the expanded Fabric card right
// next to it always showed the correct, inclusive number. Root cause: calcStructCost built its first
// truss row as a hand-picked COPY of zc's fields (to let extra rows carry their own independent
// material/density), and that copy left `looseFabric` out — so calcZoneFabricCost, called on the
// copy (not zc itself), always saw it as undefined regardless of what was actually on the zone.
const trussInv = { rates: { lizaKgRate: 100, lizaKgRateNew: 150, curtainPieceRate: 200, maskingPieceRate: 50 } };
const rates = { trussInv };
const zc = { dims: { W: 12, L: 12, H: 12 }, trT: "box", trussQty: 1 };

describe("calcStructCost folds a zone's loose fabric into its own fabric total (and the chip's)", () => {
  it("r.fabric grows when looseFabric is added, holding everything else constant", () => {
    const before = calcStructCost("zoneA", zc, rates, false);
    const after = calcStructCost("zoneA", { ...zc, looseFabric: [{ kind: "liza", colour: "Baby Pink", qty: 50 }] }, rates, false);
    expect(after.fabric).toBeGreaterThan(before.fabric);
    // 50kg extra Liza at the Old rate (100/kg), × the guest fabric multiplier (calcStructCost's own
    // r.fabric accumulation applies guestFabricMultiplier(rates) — same formula the expanded Fabric
    // card uses), adds exactly 50*100*GUEST_FABRIC_MULTIPLIER on top of whatever the geometry-based
    // Liza/curtain already contributed.
    expect(after.fabric - before.fabric).toBeCloseTo(50 * 100 * GUEST_FABRIC_MULTIPLIER, 6);
  });

  it("r.total moves by the same amount — the chip (truss+masking+...+fabric) actually reflects it", () => {
    const before = calcStructCost("zoneA", zc, rates, false);
    const after = calcStructCost("zoneA", { ...zc, looseFabric: [{ kind: "liza", colour: "Baby Pink", qty: 50 }] }, rates, false);
    // Greater-than first (regression review, 2026-11-16: without it this assertion was vacuous —
    // both sides land on 0 === 0 before the fix too, since neither moves) — THEN confirm total moves
    // by exactly as much as fabric did, not some other amount.
    expect(after.total).toBeGreaterThan(before.total);
    expect(after.total - before.total).toBe(after.fabric - before.fabric);
  });

  it("masking-kind loose fabric and curtain-kind loose fabric also register", () => {
    const before = calcStructCost("zoneA", zc, rates, false);
    const withMasking = calcStructCost("zoneA", { ...zc, looseFabric: [{ kind: "masking", colour: "White", qty: 10 }] }, rates, false);
    const withCurtain = calcStructCost("zoneA", { ...zc, looseFabric: [{ kind: "curtain", colour: "Ivory", qty: 4 }] }, rates, false);
    expect(withMasking.fabric - before.fabric).toBe(10 * trussInv.rates.maskingPieceRate * GUEST_FABRIC_MULTIPLIER);
    expect(withCurtain.fabric - before.fabric).toBe(4 * trussInv.rates.curtainPieceRate * GUEST_FABRIC_MULTIPLIER);
  });

  it("an extra truss row (zc.extraTrussRows) is spread verbatim, not hand-picked, so its OWN looseFabric already worked before this fix — regression guard", () => {
    const withExtra = calcStructCost("zoneA", { ...zc, extraTrussRows: [{ dims: { W: 10, L: 10, H: 10 }, trT: "box", trussQty: 1, looseFabric: [{ kind: "liza", colour: "Black", qty: 20 }] }] }, rates, false);
    const withoutExtraLoose = calcStructCost("zoneA", { ...zc, extraTrussRows: [{ dims: { W: 10, L: 10, H: 10 }, trT: "box", trussQty: 1 }] }, rates, false);
    expect(withExtra.fabric - withoutExtraLoose.fabric).toBe(20 * trussInv.rates.lizaKgRate * GUEST_FABRIC_MULTIPLIER);
  });
});

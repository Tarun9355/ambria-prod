import { describe, it, expect } from "vitest";
import { labelForLoadKey, truckManifest, incomingTransfersFor, hasUnmigratedLegacyTrucks } from "./eventTrucks";

describe("labelForLoadKey", () => {
  const inventory = [{ id: "itm1", name: "Buffet Table", img: "buffet.jpg" }];

  it("resolves an 'inv:' key to the real inventory item's name and photo", () => {
    expect(labelForLoadKey("inv:itm1", inventory)).toEqual({ label: "Buffet Table", photo: "buffet.jpg", invId: "itm1" });
  });

  it("resolves a kit-component 'inv:<id>@<kit>' key by its invId alone, ignoring the kit suffix", () => {
    expect(labelForLoadKey("inv:itm1@wedding stage", inventory)).toEqual({ label: "Buffet Table", photo: "buffet.jpg", invId: "itm1" });
  });

  it("falls back to the bare invId when the item isn't in the inventory list", () => {
    expect(labelForLoadKey("inv:missing", inventory)).toEqual({ label: "missing", photo: "", invId: "missing" });
  });

  it("title-cases an 'nm:' key (an item with no inventory id, e.g. a folded fabric colour)", () => {
    expect(labelForLoadKey("nm:liza drape - ivory", inventory)).toEqual({ label: "Liza Drape - Ivory", photo: "", invId: null });
  });
});

describe("truckManifest", () => {
  it("merges every department's load lines for a truck into one list, tagged by department", () => {
    const sel = {
      trucks: [
        { id: "trk_1", vehicle: "DL1LAN2125", driver: "Suresh", loads: { Furniture: { "inv:a": 12 }, Tenting: { "inv:b": 10 } } },
      ],
    };
    const inventory = [{ id: "a", name: "Buffet Table" }, { id: "b", name: "Truss Beam" }];
    const manifest = truckManifest(sel, inventory);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].truck.id).toBe("trk_1");
    expect(manifest[0].lines).toEqual([
      { dept: "Furniture", key: "inv:a", label: "Buffet Table", photo: "", planned: 12, extra: 0 },
      { dept: "Tenting", key: "inv:b", label: "Truss Beam", photo: "", planned: 10, extra: 0 },
    ]);
  });

  it("carries a department's overload (extra) qty alongside the planned qty for the same key", () => {
    const sel = { trucks: [{ id: "t1", loads: { Lighting: { "inv:c": 4 } }, extra: { Lighting: { "inv:c": 1 } } }] };
    const inventory = [{ id: "c", name: "Chandelier" }];
    expect(truckManifest(sel, inventory)[0].lines[0]).toEqual({ dept: "Lighting", key: "inv:c", label: "Chandelier", photo: "", planned: 4, extra: 1 });
  });

  it("keeps a truck with nothing loaded yet, with an empty lines array", () => {
    const sel = { trucks: [{ id: "t2", loads: {} }] };
    expect(truckManifest(sel, [])).toEqual([{ truck: sel.trucks[0], lines: [] }]);
  });

  it("includes a spares-only line (extra qty with no regular load at all)", () => {
    const sel = { trucks: [{ id: "t3", loads: {}, extra: { Furniture: { "inv:d": 2 } } }] };
    const inventory = [{ id: "d", name: "Spare Chair" }];
    expect(truckManifest(sel, inventory)[0].lines).toEqual([{ dept: "Furniture", key: "inv:d", label: "Spare Chair", photo: "", planned: 0, extra: 2 }]);
  });
});

describe("hasUnmigratedLegacyTrucks", () => {
  it("is false once the event has its own shared truck list, even if it's empty", () => {
    expect(hasUnmigratedLegacyTrucks({ trucks: [] })).toBe(false);
    expect(hasUnmigratedLegacyTrucks({ trucks: [{ id: "t1" }] })).toBe(false);
  });

  it("is true when trucks still live only in a department's own legacy deptOps.trucks", () => {
    expect(hasUnmigratedLegacyTrucks({ deptOps: { Furniture: { trucks: [{ id: "t1" }] } } })).toBe(true);
  });

  it("is false when neither exists", () => {
    expect(hasUnmigratedLegacyTrucks({})).toBe(false);
  });
});

describe("incomingTransfersFor", () => {
  it("collects transfer movements from other events addressed to this one", () => {
    const eventOrders = [
      { id: "eo_this" },
      { id: "eo_other", clientName: "Nikhil & Priya", deptOps: { Furniture: { movements: [{ type: "transfer", toEventId: "eo_this", name: "Takhat", qty: 1 }] } } },
      { id: "eo_unrelated", deptOps: { Furniture: { movements: [{ type: "transfer", toEventId: "eo_somewhere_else", name: "Sofa", qty: 2 }] } } },
    ];
    const out = incomingTransfersFor(eventOrders, "eo_this");
    expect(out).toEqual([{ type: "transfer", toEventId: "eo_this", name: "Takhat", qty: 1, fromEvent: "Nikhil & Priya", fromDept: "Furniture" }]);
  });

  it("returns an empty array with no id", () => {
    expect(incomingTransfersFor([{ id: "a" }], null)).toEqual([]);
  });
});

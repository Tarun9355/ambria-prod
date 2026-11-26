// Site Receiving reads the very list Planning loads from (lib/ims/deptLoadList) - the QA audit's gaps 1, 2, 5, 6, 15 (2026-11-26).
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ contains: () => Promise.resolve({ data: [], error: null }) }) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} }, fetchAll: () => Promise.resolve([]) }));
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";

const inv = [
  { id: "CH", name: "Chair", cat: "Furniture" },
  { id: "KW", name: "Candle Wall", cat: "Lighting" },
  { id: "PC", name: "Pillar Candle", cat: "Floral" },
  { id: "OLD", name: "Overlay Old", cat: "Fabric" },
];
const render = (sel) => renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={inv} eventOrders={[sel]} authUser={{}} mode="actual" settings={{}} trussInv={{}} />);
const truck = (loads) => [{ id: "T1", vehicle: "DL1", driver: "Raju", trips: [{ id: "a", status: "dispatched", loads }] }];

describe("Site Receiving = Planning's to-load list", () => {
  it("two functions sharing chairs: need is Deal Check's net 50 (what Planning loads), not the 100 summed per function", () => {
    const html = render({ id: "E", deptInventory: { Furniture: [{ name: "Chair", imsId: "CH", qty: 50 }] }, trucks: truck({ Furniture: { "inv:CH": 50 } }) });
    expect(html).toMatch(/need <!-- -->50<!-- -->(<!-- -->)? · arriving <!-- -->50/);
    expect(html).toContain("all sourced");
  });
  it("a line with no inventory id (platform) not on a truck: its own 'Not loaded' row, and the header counts it short", () => {
    const html = render({ id: "E", deptInventory: { Tenting: [{ name: "Platform Structure", qty: 500, qtyUnit: "sqft" }] }, trucks: [] });
    expect(html).toContain("Platform Structure");
    expect(html).toContain("Not loaded");
    expect(html).toMatch(/need <!-- -->500<!-- --> sqft/);
  });
  it("loaded before a change and no longer in Planning's list: said in amber, never shown as fine", () => {
    const html = render({ id: "E", deptInventory: { Furniture: [{ name: "Chair", imsId: "CH", qty: 1 }] }, trucks: truck({ Fabric: { "inv:OLD": 10 }, Furniture: { "inv:CH": 1 } }) });
    expect(html).toContain("Not in Planning&#x27;s list now");
    expect(html).not.toMatch(/need <!-- -->0/);
  });
  it("a kit part another department holds as its own row is counted once, under that department", () => {
    const html = render({ id: "E", deptInventory: {
      Lighting: [{ name: "Candle Wall", imsId: "KW", qty: 1, isKit: true, components: [{ name: "Pillar Candle", imsId: "PC", qty: 10 }] }],
      Floral: [{ name: "Pillar Candle", imsId: "PC", qty: 10, fromKit: "Candle Wall" }],
    }, trucks: truck({ Floral: { "inv:PC": 10 }, Lighting: { "inv:KW": 1 } }) });
    expect(html).toMatch(/need <!-- -->10<!-- -->(<!-- -->)? · arriving <!-- -->10/);
    expect(html).not.toMatch(/need <!-- -->20/);
  });
  it("FOC: listed at the venue, not short", () => {
    const html = render({ id: "E", deptInventory: { Furniture: [{ name: "Chair", imsId: "CH", qty: 4, foc: true }] }, trucks: [] });
    expect(html).toContain("FOC");
    expect(html).not.toContain("Not loaded");
  });
});

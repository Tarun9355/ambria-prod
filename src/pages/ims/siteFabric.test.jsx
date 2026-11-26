// Site page Receiving: Liza / Velvet / Wall Masking show as Planning's Fabric department sees them (owner ask 2026-11-26) -
// the need from Deal Check's fabric plan (sel.fabricPlan), arriving from the truck lines named "<Fabric> - <colour>".
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ contains: () => Promise.resolve({ data: [], error: null }), then: (f) => f({ data: [], error: null }) }) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} }, fetchAll: () => Promise.resolve([]) }));
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";

const base = (sel) => renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={[]} eventOrders={[sel]} authUser={{ role: "Admin" }} mode="actual" settings={{}}
  trussInv={{ lizaStock: [{ colour: "Powder Blue", photo: "https://x/liza.jpg" }] }} />);

describe("Site Receiving: fabric", () => {
  // Deal Check's Fabric list (deptInventory.Fabric) is what Planning folds into one load line per fabric colour; Site reads the same list.
  const fabLines = [{ id: "f1", name: "Liza Fabric (Old)", sub: "kg · stage", qty: 12, total: 3600 }, { id: "f2", name: "Velvet Curtains (Old)", sub: "pcs · entry", qty: 6, total: 600 }];
  it("a fabric not on any truck: its own row, short in its unit, with the colour's photo", () => {
    const html = base({ id: "E1", fabricPlan: { liza: [{ colour: "Powder Blue", qty: 12 }], curtain: [{ colour: "Maroon", qty: 6 }], masking: [] }, deptInventory: { Fabric: fabLines }, trucks: [] });
    expect(html).toContain("Liza Fabric - Powder Blue");
    expect(html).toContain("Velvet Curtains - Maroon");
    expect(html).toMatch(/need <!-- -->12<!-- -->(<!-- -->)? kg/);
    expect(html).toContain("liza.jpg");
  });
  it("loaded on a truck (Planning's key for the line): weighed against the plan", () => {
    const sel = { id: "E1", fabricPlan: { liza: [{ colour: "Powder Blue", qty: 12 }] }, deptInventory: { Fabric: [fabLines[0]] },
      trucks: [{ id: "T1", vehicle: "DL1", driver: "Raju", trips: [{ id: "a", status: "dispatched", loads: { Fabric: { "nm:liza fabric - powder blue|https://x/liza.jpg": 8 } } }] }] };
    const html = base(sel);
    expect(html).toMatch(/need <!-- -->12/);
    expect(html).toMatch(/arriving <!-- -->8/);
    expect(html).toMatch(/short <!-- -->4/);
  });
  it("the colour's photo from a stock row that has one", () => {
    const html = renderToString(<SiteReceivingPanel sel={{ id: "E1", fabricPlan: { liza: [{ colour: "Ivory", qty: 5 }] }, deptInventory: { Fabric: [{ ...fabLines[0], qty: 5 }] }, trucks: [] }} setEventOrders={() => {}} inventory={[]} eventOrders={[]} authUser={{}} mode="actual" settings={{}}
      trussInv={{ lizaStock: [{ colour: "Ivory" }, { colour: "ivory ", photo: "https://x/ivory.jpg" }] }} />);
    expect(html).toContain("ivory.jpg");
  });
  it("Planning's Fabric block on top: each fabric with its colours and total, no money", () => {
    const sel = { id: "E1", trucks: [], fabricPlan: { liza: [{ colour: "Ivory", qty: 160 }] },
      deptInventory: { Fabric: [{ id: "f1", name: "Liza Fabric (Old)", sub: "kg · stage", qty: 160, total: 48000 }] } };
    const html = base(sel);
    expect(html).toContain(">Fabric<");
    expect(html).toMatch(/Ivory 160 kg/);
    expect(html).not.toContain("48,000");
    expect(html.indexOf(">Fabric<")).toBeLessThan(html.indexOf(">Receiving<"));
  });
  it("the rows follow the Fabric block's colours, not a stale stored plan: a colour the plan no longer has is not asked for", () => {
    // stored plan (stale): Ivory 2 + Maroon 13. The block's groups come from the priced lines + that record, so here they agree -
    // the check is that a row is drawn from the same groups the block shows: Velvet has no line, so no velvet row either.
    const sel = { id: "E1", trucks: [], fabricPlan: { liza: [{ colour: "Maroon", qty: 15 }], curtain: [{ colour: "Ivory", qty: 2 }] },
      deptInventory: { Fabric: [{ id: "f1", name: "Liza Fabric (Old)", sub: "kg · stage", qty: 15, total: 4500 }] } };
    const html = base(sel);
    expect(html).toContain("Liza Fabric - Maroon");
    expect(html).not.toContain("Velvet Curtains - Ivory");
  });
  it("an item added on the truck (not in the deal) says so instead of 'need 0'", () => {
    const sel = { id: "E1", trucks: [{ id: "T1", vehicle: "DL9", driver: "Ganesh", trips: [{ id: "a", status: "dispatched", custom: { Fabric: [{ id: "c1", invId: "cc1", name: "Cushion Cover Maroon", qty: 17 }] } }] }] };
    const html = renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={[{ id: "cc1", name: "Cushion Cover Maroon" }]} eventOrders={[sel]} authUser={{}} mode="actual" settings={{}} trussInv={{}} />);
    expect(html).toContain("Added on truck · not in the deal");
    expect(html).not.toMatch(/need <!-- -->0/);
  });
  it("an item the deal has, with pieces added on the truck on top: '+N extra', never 'not in the deal'", () => {
    const sel = { id: "E1", trucks: [{ id: "T1", vehicle: "DL9", driver: "Ganesh", trips: [{ id: "a", status: "dispatched",
      loads: { Furniture: { "inv:ch": 6 } }, custom: { Furniture: [{ id: "c1", invId: "ch", name: "Chair", qty: 4 }] } }] }] };
    const html = renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={[{ id: "ch", name: "Chair" }]} eventOrders={[sel]} authUser={{}} mode="actual" settings={{}} trussInv={{}} />);
    expect(html).toContain("extra, added on truck");
    expect(html).not.toContain("not in the deal");
  });
  it("a kit's part on a truck takes its need from the department's list (the build list lacked it): no more 'need 0'", () => {
    const sel = { id: "E1",
      deptInventory: { Floral: [{ name: "Glass Consol Table", imsId: "KIT1", qty: 1, isKit: true, components: [{ name: "Green Bottle Vase", imsId: "FLO-00172", qty: 4 }] }] },
      trucks: [{ id: "T1", vehicle: "DL1LAv1350", driver: "Jaiprakash", trips: [{ id: "a", status: "loading", loads: { Floral: { "inv:FLO-00172@glass consol table": 4 } } }] }] };
    const html = renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={[{ id: "FLO-00172", name: "Green Bottle Vase" }, { id: "KIT1", name: "Glass Consol Table" }]} eventOrders={[sel]} authUser={{}} mode="actual" settings={{}} trussInv={{}} />);
    expect(html).toMatch(/need <!-- -->4<!-- --> · arriving <!-- -->4/);
    expect(html).not.toMatch(/need <!-- -->0/);
  });
});

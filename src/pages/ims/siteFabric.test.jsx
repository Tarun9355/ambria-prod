// Site page Receiving: Liza / Velvet / Wall Masking show as Planning's Fabric department sees them (owner ask 2026-11-26) -
// the need from Deal Check's fabric plan (sel.fabricPlan), arriving from the truck lines named "<Fabric> - <colour>".
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ contains: () => Promise.resolve({ data: [], error: null }), then: (f) => f({ data: [], error: null }) }) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} }, fetchAll: () => Promise.resolve([]) }));
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";

const base = (sel) => renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={[]} eventOrders={[sel]} authUser={{ role: "Admin" }} mode="actual" settings={{}}
  trussInv={{ lizaStock: [{ colour: "Powder Blue", photo: "https://x/liza.jpg" }] }} />);

describe("Site Receiving: fabric", () => {
  it("a fabric not on any truck: its own row, short in its unit, with the colour's photo", () => {
    const html = base({ id: "E1", fabricPlan: { liza: [{ colour: "Powder Blue", qty: 12 }], curtain: [{ colour: "Maroon", qty: 6 }], masking: [] }, trucks: [] });
    expect(html).toContain("Liza Fabric - Powder Blue");
    expect(html).toContain("Velvet Curtains - Maroon");
    expect(html).toMatch(/need <!-- -->12<!-- -->(<!-- -->)? kg/);
    expect(html).toContain("liza.jpg");
  });
  it("loaded on a truck: the line weighs what is on trucks against the plan", () => {
    const sel = { id: "E1", fabricPlan: { liza: [{ colour: "Powder Blue", qty: 12 }] },
      trucks: [{ id: "T1", vehicle: "DL1", driver: "Raju", trips: [{ id: "a", status: "dispatched", loads: { Fabric: { "nm:liza fabric - powder blue": 8 } } }] }] };
    const html = base(sel);
    expect(html).toMatch(/need <!-- -->12/);
    expect(html).toMatch(/arriving <!-- -->8/);
    expect(html).toMatch(/short <!-- -->4/);
  });
  it("the colour's photo from a stock row that has one, else the same colour in another fabric's stock", () => {
    const html = renderToString(<SiteReceivingPanel sel={{ id: "E1", fabricPlan: { liza: [{ colour: "Ivory", qty: 5 }], curtain: [{ colour: "Gold", qty: 2 }] }, trucks: [] }} setEventOrders={() => {}} inventory={[]} eventOrders={[]} authUser={{}} mode="actual" settings={{}}
      trussInv={{ lizaStock: [{ colour: "Ivory" }, { colour: "ivory ", photo: "https://x/ivory.jpg" }], curtainStock: [{ colour: "Gold" }], maskingStock: [{ colour: "Gold", photo: "https://x/gold.jpg" }] }} />);
    expect(html).toContain("ivory.jpg");
    expect(html).toContain("gold.jpg");
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
});

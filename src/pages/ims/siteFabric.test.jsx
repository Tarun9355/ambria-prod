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
});

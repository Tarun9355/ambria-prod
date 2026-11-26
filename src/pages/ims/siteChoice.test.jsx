// Site Receiving names the overlay / cushion cover design Planning chose (what is on the truck), as Planning's truck list does (QA gap 7).
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({}) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} }, fetchAll: () => Promise.resolve([]) }));
vi.mock("../../lib/ims/eventPlans", () => ({ makeEventPlans: () => ({
  fabricEntriesOf: () => [], fabricPalettesOf: () => null, carpetPlanOf: () => ({ rows: [] }),
  elementPlanOf: () => ({ rows: [{ key: "k1", qty: 10, prefs: [{ id: "OA", name: "Overlay A" }], decidedId: "OB",
    options: [{ id: "OA", name: "Overlay A" }, { id: "OB", name: "Overlay B Silver", item: { img: "https://x/ob.jpg" } }] }] }),
}) }));
import SiteReceivingPanel from "./SiteReceivingPanel.jsx";

describe("Site Receiving: Planning's chosen design", () => {
  it("an overlay whose design Planning changed shows the chosen one's name and photo", () => {
    const sel = { id: "E", deptInventory: { Fabric: [{ name: "Overlay A", imsId: "OA", qty: 10 }] }, trucks: [] };
    const html = renderToString(<SiteReceivingPanel sel={sel} setEventOrders={() => {}} inventory={[{ id: "OA", name: "Overlay A", cat: "Fabric" }]} eventOrders={[sel]} authUser={{}} mode="actual" settings={{}} trussInv={{}} />);
    expect(html).toContain("Overlay B Silver");
    expect(html).toContain("ob.jpg");
  });
});

// Sold must hold a kit's PARTS too (owner ask 2026-11-18): IMS auto-confirm reserved only the kit's own id, so until
// Studio's reconcile ran, a part (Fabric Cocktail Table inside Full Round Bar) read as free stock. Auto-confirm now walks
// the kit with walkKitUnits, using the deal's own kit edits (el.kitOverrides) - never the catalogue default once Studio
// has changed a part, or the swapped-out part would be held forever (Studio only ADOPTS ims-autoconfirm entries).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { studioOrderItems } from "./eventAutoConfirm.js";

describe("auto-confirm reserves a kit's parts", () => {
  it("studioOrderItems carries the deal's own kit edits along with the kit", () => {
    const inv = [{ id: "K", name: "Full Round Bar", subItems: [{ itemId: "T", qty: 1 }] }, { id: "T", name: "Fabric Cocktail Table" }];
    const eo = { functionsDetail: [{ date: "2026-12-02", elements: { bar: [{ invId: "K", qty: 2, kitOverrides: [{ itemId: "T", qty: 1 }] }] } }] };
    const r = studioOrderItems(eo, inv);
    expect(r).toHaveLength(1);
    expect(r[0].kitOverrides).toEqual([{ itemId: "T", qty: 1 }]);
    const plain = studioOrderItems({ functionsDetail: [{ date: "d", elements: { bar: [{ invId: "K", qty: 2 }] } }] }, inv);
    expect(plain[0].kitOverrides).toBeUndefined();
  });
  it("executeConfirmBlocks walks every accepted kit into its parts, with the deal's edits only for Studio's own pick", () => {
    const src = readFileSync(new URL("./eventAutoConfirm.js", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("function executeConfirmBlocks("), src.indexOf("// ── Step 3"));
    expect(body).toMatch(/walkKitUnits\(a\.itemToBlock, a\.r\.qty\|\|1, inventory, kitOv,/);
    expect(body).toContain("a.itemToBlock.id === a.r.match.id");
    expect(src).toMatch(/qty: Math\.ceil\(sumQty - 1e-6\)/);
  });
});

// The Fabric card's figure is what is pulled from stock (owner report 2026-11-27): Velvet Curtains with some ♻ Repeat zones
// showed only the pieces to pull, but Wall Masking with EVERY zone on Repeat still showed its full 7 pcs as if they were to send.
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import FabricBlock from "./FabricBlock.jsx";

const zone = (name, qty, standing) => ({ fi: 0, zoneKey: name.toLowerCase(), name, qty, standing, colours: [{ colour: "Maroon", qty }], application: "", tier: "Old", dims: "" });
const text = (html) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Fabric card figure", () => {
  it("all zones on Repeat: 0 to send, the standing pieces said beside it", () => {
    const masking = { key: "masking", label: "Wall Masking", unit: "pcs", emoji: "🧱", qty: 7, pullQty: 0, freshQty: 0, standingQty: 7, amount: 0,
      zones: [zone("Side", 3, true), zone("Entry", 2, true), zone("Photo", 2, true)], colours: [], standingOnly: true, colourText: "♻ Repeat · standing Maroon" };
    const t = text(renderToString(<FabricBlock groups={[masking]} />));
    expect(t).toContain("0 pcs · 7 pcs standing (♻ Repeat)");
    expect(t).not.toMatch(/(^|[^\d])7 pcs ·? ?$/);
  });
  it("some zones on Repeat: only the pieces to pull, no standing note on the card", () => {
    const curtain = { key: "curtain", label: "Velvet Curtains", unit: "pcs", emoji: "🎀", qty: 40, pullQty: 4, freshQty: 4, standingQty: 36, amount: 0,
      zones: [zone("Entry", 16, true), zone("Photo", 16, true), zone("Vedi", 4, false), zone("Side", 4, true)], colours: [{ colour: "Maroon", qty: 4 }], standingOnly: false, colourText: "Maroon 4 pcs" };
    const t = text(renderToString(<FabricBlock groups={[curtain]} />));
    expect(t).toContain("Velvet Curtains Maroon 4 pcs 4 pcs");
    expect(t).not.toContain("standing (♻ Repeat)");
  });
});

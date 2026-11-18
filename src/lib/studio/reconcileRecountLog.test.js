// A kit's part newly counted by the reservation (its kit unchanged) is a RECOUNT, not an edit (owner report 2026-11-18:
// "Added 1 item · Fabric Cocktail Table ×2 by Bhaskar" when nobody added anything). Source-reading wiring check, like
// bookedAutoTriggers.wiring.test.js - the reconcile lives inside StudioApp's component.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../pages/studio/StudioApp.jsx", import.meta.url), "utf8");
const start = src.indexOf("const reconcileSoldInventoryBlocks = useCallback(async (fns");
const body = src.slice(start, src.indexOf("const runDealCheckGenerate = useCallback(", start));

describe("sold-deal change log: a kit-part recount is logged by the system", () => {
  it("knows which ids came in only as a kit's part, and from which kits", () => {
    expect(body).toContain("partParentsByFn[fnIdx] = partParents;");
    expect(body).toContain("directByFn[fnIdx] = direct;");
  });
  it("a part whose kits' qty is unchanged goes to the recount log, never the salesperson's", () => {
    expect(body).toMatch(/const recount = !!parents && !directByFn\[fnIdx\]\?\.has\(id\)/);
    expect(body).toMatch(/\(Number\(req\[k\]\) \|\| 0\) === \(Number\(prev\[k\]\) \|\| 0\)/);
    expect(body).toContain('requestedBy: "System (stock re-count)"');
    expect(body).toContain("(part of ${kitNames})");
  });
});

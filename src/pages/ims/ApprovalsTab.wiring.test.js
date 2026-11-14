// bug 13 (2026-11-14 inventory-blocks audit): approving an amend request used to auto-block
// inventory itself — an un-locked write race against Studio's own reconcile (which already reserves
// the same logged change), matching items by fuzzy name (could pick the wrong item), and double-
// counting on top of Studio's existing reservation. Confirmed dead in practice (the only producer of
// amend_requests always writes status:"logged", never "pending", so the button this guarded never
// renders for a current request) — removed rather than migrated. This is a source-reading wiring
// test locking in the removal, not a behavioral test of the component (no React test renderer in
// this codebase).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("ApprovalsTab no longer writes to blocks", () => {
  const src = readFileSync(new URL("./ApprovalsTab.jsx", import.meta.url), "utf8");

  it("takes no blocks/setBlocks/saveBlocks/inventory prop and writes nothing to `blocks`", () => {
    const sig = src.slice(src.indexOf("export default function ApprovalsTab("), src.indexOf(") {", src.indexOf("export default function ApprovalsTab(")));
    expect(sig).not.toMatch(/setBlocks/);
    expect(sig).not.toMatch(/saveBlocks/);
    expect(sig).not.toMatch(/\bblocks\b/);
    expect(sig).not.toMatch(/\binventory\b/);
  });

  it("the applyBlocks function is gone", () => {
    expect(src).not.toMatch(/function applyBlocks/);
  });

  it("decide() still updates the request's own status/decidedBy/decisionNote", () => {
    expect(src).toMatch(/status, decidedBy: authUser\?\.name \|\| authUser\?\.role \|\| "Head", decidedAt: Date\.now\(\), decisionNote: note/);
  });
});

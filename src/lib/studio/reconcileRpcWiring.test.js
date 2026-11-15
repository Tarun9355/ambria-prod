// bug 4 (2026-11-14 audit): Studio's own sold-deal reconcile used to write `blocks` with a plain
// `supabase.from("blocks").upsert(...)` of the whole computed array — no row lock, no availability
// check, the exact class of bug the "Roman Fibre pot" overbook traced back to. It now builds ops via
// planToOps and writes through apply_block_ops (the locked, availability-checking RPC,
// supabase/migrations/066_blocks_write_rpc.sql) in 'cap' mode, and surfaces whatever it couldn't fully
// reserve. Source-reading wiring test, same style as the other Phase 1/2 wiring tests —
// reconcileSoldInventoryBlocks is a closure inside the StudioApp component, not independently callable.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("reconcileSoldInventoryBlocks writes through the locked RPC, not a plain upsert", () => {
  const src = readFileSync(new URL("../../pages/studio/StudioApp.jsx", import.meta.url), "utf8");
  const start = src.indexOf("const plan = planStudioBlocks({");
  const end = src.indexOf('console.info("[reconcile] blocks: event", eo.id, "changed"', start);

  it("is where we think it is", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  const body = () => src.slice(start, end);

  it("never calls the old plain upsert on blocks", () => {
    expect(body()).not.toMatch(/supabase\.from\("blocks"\)\.upsert/);
  });

  it("builds ops via planToOps and writes via apply_block_ops in 'cap' mode", () => {
    expect(body()).toMatch(/const ops = planToOps\(\{ eventId: eo\.id, rowsById, plan, allowOver \}\);/);
    expect(body()).toMatch(/applyBlockOps\(supabase, ops, \{ onShort: "cap" \}\)/);
  });

  it("allowOver exempts a zero-stock or canBeMade item from the stock ceiling, same rule Build's own maxQty uses", () => {
    expect(body()).toMatch(/item\?\.canBeMade === true \|\| !\(Number\(item\?\.qty\) > 0\)/);
  });

  it("surfaces a shortfall via shortfallsOf + showMsg, rather than silently capping with no visibility", () => {
    expect(body()).toMatch(/const shorts = shortfallsOf\(rpcResult\);/);
    expect(body()).toMatch(/showMsg\(`Couldn't fully reserve/);
  });

  it("still respects writeWithRetry's supersession (a newer reconcile of the same event wins)", () => {
    expect(body()).toMatch(/if \(res\.superseded\) \{/);
  });
});

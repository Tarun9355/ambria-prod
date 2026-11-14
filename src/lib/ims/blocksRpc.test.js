import { describe, it, expect, vi } from "vitest";
import { BLOCKS_RPC, applyBlockOps, mergeBlockRows, shortfallsOf, appendOp } from "./blocksRpc.js";

describe("applyBlockOps", () => {
  it("calls client.rpc with the exact RPC name and parameter names", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, applied: true, items: [], rows: [] }, error: null });
    const client = { rpc };
    const ops = [{ item_id: "A", event_id: "eo_1", remove: [], add: [{ date: "2026-11-15", qty: 5 }] }];
    await applyBlockOps(client, ops, { onShort: "cap" });
    expect(rpc).toHaveBeenCalledWith(BLOCKS_RPC, { p_ops: ops, p_on_short: "cap" });
  });

  it("defaults onShort to 'reject' when not given", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, applied: true, items: [], rows: [] }, error: null });
    await applyBlockOps({ rpc }, [{ item_id: "A", event_id: "eo_1", add: [] }]);
    expect(rpc).toHaveBeenCalledWith(BLOCKS_RPC, expect.objectContaining({ p_on_short: "reject" }));
  });

  it("an empty/invalid ops array short-circuits with no network call", async () => {
    const rpc = vi.fn();
    expect(await applyBlockOps({ rpc }, [])).toEqual({ ok: true, applied: false, items: [], rows: [] });
    expect(await applyBlockOps({ rpc }, [{ item_id: "A" }])).toEqual({ ok: true, applied: false, items: [], rows: [] }); // missing event_id
    expect(await applyBlockOps({ rpc }, null)).toEqual({ ok: true, applied: false, items: [], rows: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC error without throwing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await applyBlockOps({ rpc }, [{ item_id: "A", event_id: "eo_1", add: [] }]);
    expect(res.ok).toBe(false);
    expect(res.error.message).toBe("boom");
  });

  it("passes through items/rows from a successful call", async () => {
    const data = { ok: true, applied: true, items: [{ item_id: "A", short: 0 }], rows: [{ item_id: "A", data: [] }] };
    const res = await applyBlockOps({ rpc: vi.fn().mockResolvedValue({ data, error: null }) }, [{ item_id: "A", event_id: "eo_1", add: [] }]);
    expect(res).toEqual({ ok: true, applied: true, items: data.items, rows: data.rows });
  });
});

describe("mergeBlockRows", () => {
  it("applies the RPC's returned rows over the local map, leaving untouched items alone", () => {
    const local = { A: [{ qty: 1 }], B: [{ qty: 2 }] };
    const merged = mergeBlockRows(local, [{ item_id: "A", data: [{ qty: 9 }] }]);
    expect(merged).toEqual({ A: [{ qty: 9 }], B: [{ qty: 2 }] });
    expect(merged.B).toBe(local.B); // untouched item's array reference is unchanged
  });
  it("returns the same object when rows is empty/missing", () => {
    const local = { A: [] };
    expect(mergeBlockRows(local, [])).toBe(local);
    expect(mergeBlockRows(local, undefined)).toBe(local);
  });
  it("tolerates a missing local map", () => {
    expect(mergeBlockRows(undefined, [{ item_id: "A", data: [{ qty: 1 }] }])).toEqual({ A: [{ qty: 1 }] });
  });
});

describe("shortfallsOf", () => {
  it("filters to only entries with short > 0", () => {
    const result = { items: [{ item_id: "A", short: 0 }, { item_id: "B", short: 4 }, { item_id: "C", short: -1 }] };
    expect(shortfallsOf(result)).toEqual([{ item_id: "B", short: 4 }]);
  });
  it("empty/missing result returns []", () => {
    expect(shortfallsOf(null)).toEqual([]);
    expect(shortfallsOf({})).toEqual([]);
  });
});

describe("appendOp", () => {
  it("builds a single-add op with no removes", () => {
    expect(appendOp({ itemId: "A", eventId: "eo_1", date: "2026-11-15", qty: 3, source: "ims-manual" })).toEqual({
      item_id: "A", event_id: "eo_1", remove: [],
      add: [{ date: "2026-11-15", qty: 3, status: "confirmed", source: "ims-manual", allowOver: false }],
    });
  });
  it("carries extra through when given", () => {
    const op = appendOp({ itemId: "A", eventId: "eo_1", date: "D", qty: 1, source: "s", extra: { sizeClass: "M" } });
    expect(op.add[0].extra).toEqual({ sizeClass: "M" });
  });
});

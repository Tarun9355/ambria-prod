import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reloadAllocTable } from "./allocReload";

const mk = (flag, fetchRows) => {
  const loadOkRef = { current: flag === undefined ? {} : { batta_allocations: flag } };
  const ref = { current: {} };
  const setState = vi.fn();
  const onFail = vi.fn();
  return { loadOkRef, ref, setState, onFail, args: { loadOkRef, key: "batta_allocations", fetchRows, toMap: (rows) => Object.fromEntries(rows.map((r) => [r.date, r])), ref, setState, onFail } };
};

describe("reloadAllocTable", () => {
  it("a table that failed to load is read again, put in state and ref, and marked loaded", async () => {
    const m = mk(false, async () => [{ date: "2026-11-20", events: [] }]);
    expect(await reloadAllocTable(m.args)).toBe(true);
    expect(m.loadOkRef.current.batta_allocations).toBe(true);
    expect(m.ref.current).toEqual({ "2026-11-20": { date: "2026-11-20", events: [] } });
    expect(m.setState).toHaveBeenCalledWith(m.ref.current);
    expect(m.onFail).not.toHaveBeenCalled();
  });
  it("an unset flag (still loading when the edit came) is treated the same", async () => {
    const m = mk(undefined, async () => []);
    expect(await reloadAllocTable(m.args)).toBe(true);
    expect(m.loadOkRef.current.batta_allocations).toBe(true);
  });
  it("a table already loaded is not read again", async () => {
    const fetchRows = vi.fn(async () => []);
    const m = mk(true, fetchRows);
    expect(await reloadAllocTable(m.args)).toBe(true);
    expect(fetchRows).not.toHaveBeenCalled();
    expect(m.setState).not.toHaveBeenCalled();
  });
  it("a read that fails again returns false, leaves the flag false and the state untouched, and reports why", async () => {
    const m = mk(false, async () => { throw new Error("timeout"); });
    expect(await reloadAllocTable(m.args)).toBe(false);
    expect(m.loadOkRef.current.batta_allocations).toBe(false);
    expect(m.setState).not.toHaveBeenCalled();
    expect(m.onFail).toHaveBeenCalledOnce();
  });
  it("if the background retry loaded the table while this read was in flight, its data is left alone (never overwritten with this read)", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const m = mk(false, async () => { await gate; return [{ date: "stale" }]; });
    const p = reloadAllocTable(m.args);
    m.loadOkRef.current.batta_allocations = true; // the background retry won
    m.ref.current = { fresh: { date: "fresh" } };
    release();
    expect(await p).toBe(true);
    expect(m.ref.current).toEqual({ fresh: { date: "fresh" } });
    expect(m.setState).not.toHaveBeenCalled();
  });
});

describe("IMS wiring: the three allocation setters reload instead of showing the popup first", () => {
  const src = readFileSync(resolve(__dirname, "../../pages/ims/IMS.jsx"), "utf8").replace(/\r\n/g, "\n");
  it.each([["setTrussAlloc", "truss_allocations", "Truss"], ["setPlatformAlloc", "platform_allocations", "Platform"], ["setBattaAlloc", "batta_allocations", "Batta"]])("%s", (fn, table, label) => {
    const a = src.indexOf(`const ${fn} = useCallback((updater) => {`);
    expect(a).toBeGreaterThan(0);
    const body = src.slice(a, src.indexOf("}, [trackWrite]);", a));
    // the guard is still there and still stops the write on an unloaded table
    expect(body).toContain(`if (loadOkRef.current.${table} !== true) {`);
    expect(body).toContain(`reloadAllocTable({ loadOkRef, key: "${table}"`);
    // the message only after a failed re-read, and the change applied after a good one
    expect(body).toContain(`.then((ok) => { if (ok) ${fn}(updater); else setError("${label} allocations haven't loaded`);
    // the popup is not raised synchronously any more
    const guard = body.slice(body.indexOf(`if (loadOkRef.current.${table} !== true) {`), body.indexOf("const prev ="));
    expect(guard.indexOf("reloadAllocTable")).toBeLessThan(guard.indexOf("setError("));
    expect(guard).toContain("return;");
  });
});

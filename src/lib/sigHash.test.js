import { describe, it, expect } from "vitest";
import { sigHash } from "./sigHash.js";

describe("sigHash", () => {
  it("is stable: the same signature always gives the same fingerprint", () => {
    const s = JSON.stringify({ inc: { a: 1 }, lay: [[0, { date: "2026-11-22" }]] });
    expect(sigHash(s)).toBe(sigHash(s));
  });
  it("any change to the signature changes the fingerprint", () => {
    const base = JSON.stringify({ inc: { decor: 100000 }, mp: { x: 1 } });
    const seen = new Set([sigHash(base)]);
    for (let i = 0; i < 2000; i++) seen.add(sigHash(JSON.stringify({ inc: { decor: 100000 + i + 1 }, mp: { x: 1 } })));
    expect(seen.size).toBe(2001);
  });
  it("one character apart in a 70 KB string still differs", () => {
    const big = "x".repeat(70000);
    expect(sigHash(big)).not.toBe(sigHash(big.slice(0, 35000) + "y" + big.slice(35001)));
  });
  it("is short, and an old full-length signature never equals it (so an old row re-pushes once)", () => {
    const long = "{\"inc\":" + "1".repeat(70000) + "}";
    expect(sigHash(long).length).toBeLessThan(30);
    expect(sigHash(long)).not.toBe(long);
  });
});

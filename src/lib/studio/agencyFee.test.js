import { describe, it, expect } from "vitest";
import { AGENCY_FEE_MAX, clampAgencyFeePct, dealAgencyFeePct, feePctOf } from "./agencyFee.js";

describe("clampAgencyFeePct — one deal's own fee, 0 to 25", () => {
  it("passes a valid value through", () => {
    expect(clampAgencyFeePct(15)).toBe(15);
    expect(clampAgencyFeePct("12.5")).toBe(12.5);
    expect(clampAgencyFeePct(AGENCY_FEE_MAX)).toBe(25);
  });
  it("0 is a real value (no fee), not 'nothing set'", () => {
    expect(clampAgencyFeePct(0)).toBe(0);
    expect(clampAgencyFeePct("0")).toBe(0);
  });
  it("never goes above the 25% cap", () => {
    expect(clampAgencyFeePct(26)).toBe(25);
    expect(clampAgencyFeePct(100)).toBe(25);
    expect(clampAgencyFeePct("99")).toBe(25);
  });
  it("negative, blank and junk are 'nothing set'", () => {
    expect(clampAgencyFeePct(-5)).toBeNull();
    expect(clampAgencyFeePct("")).toBeNull();
    expect(clampAgencyFeePct(null)).toBeNull();
    expect(clampAgencyFeePct(undefined)).toBeNull();
    expect(clampAgencyFeePct("abc")).toBeNull();
    expect(clampAgencyFeePct(NaN)).toBeNull();
  });
  it("keeps at most one decimal", () => {
    expect(clampAgencyFeePct(12.34)).toBe(12.3);
    expect(clampAgencyFeePct(7.96)).toBe(8);
  });
});

describe("dealAgencyFeePct — the deal's own rate beats the house rate", () => {
  it("a deal with its own fee uses it", () => {
    expect(dealAgencyFeePct(10, 25)).toBe(10);
    expect(dealAgencyFeePct(25, 20)).toBe(25);
  });
  it("a deal set to 0 is billed no fee (it does not fall back to the house rate)", () => {
    expect(dealAgencyFeePct(0, 25)).toBe(0);
  });
  it("a deal with nothing set follows the house rate", () => {
    expect(dealAgencyFeePct(undefined, 25)).toBe(25);
    expect(dealAgencyFeePct(null, 18)).toBe(18);
    expect(dealAgencyFeePct("", 18)).toBe(18);
  });
  it("a stale over-cap value on a deal is held to 25", () => {
    expect(dealAgencyFeePct(40, 20)).toBe(25);
  });
  it("no house rate either: 20", () => {
    expect(dealAgencyFeePct(undefined, undefined)).toBe(20);
    expect(feePctOf(undefined)).toBe(20);
    expect(feePctOf("junk")).toBe(20);
  });
});

import { describe, it, expect } from "vitest";
import { mandiHow } from "./floralHow.js";

const detail = {
  0: { fnType: "Wedding", fnDate: "2026-11-20", mandi: [
    { name: "Carnation Himachal", unit: "bundle", need: 12.5, contributors: [
      { el: "Flower Reet", zone: "stage", size: "B", elQty: 4, per: 2.5, qty: 10, realFrac: 1 },
      { el: "Floating Floral", zone: "entry_gate", size: "S", elQty: 5, per: 1, qty: 2.5, realFrac: 0.5 },
    ] },
    { name: "Guldavari Star", unit: "piece", need: 250, contributors: [{ el: "Flower Reet", zone: "stage", size: "B", elQty: 4, per: 62.5, qty: 250, realFrac: 1 }] },
  ] },
  1: { fnType: "Reception", fnDate: "2026-11-21", mandi: [
    { name: "carnation  himachal", unit: "bundle", need: 3, contributors: [{ el: "Flower Garden", zone: "—", size: "—", elQty: 1, per: 3, qty: 3, realFrac: 1 }] },
  ] },
};

describe("mandiHow", () => {
  it("lists the arrangements behind a flower, per function, and adds the functions up", () => {
    const h = mandiHow(detail, "Carnation Himachal");
    expect(h.unit).toBe("bundle");
    expect(h.need).toBe(15.5);
    expect(h.groups.map((g) => g.label)).toEqual(["Wedding · 2026-11-20", "Reception · 2026-11-21"]);
    expect(h.groups[0].rows[0]).toMatchObject({ el: "Flower Reet", zone: "Stage", size: "B", elQty: 4, per: 2.5, qty: 10 });
    expect(h.groups[0].rows[1]).toMatchObject({ zone: "Entry gate", realFrac: 0.5 });
  });
  it("matches the name ignoring case and spacing, and leaves out a blank zone / size", () => {
    const g = mandiHow(detail, "CARNATION HIMACHAL").groups[1];
    expect(g.rows[0]).toMatchObject({ zone: "", size: "", qty: 3 });
  });
  it("keeps a piece unit as it is", () => {
    expect(mandiHow(detail, "Guldavari Star")).toMatchObject({ unit: "piece", need: 250 });
  });
  it("is null for a flower no function lists, or when there is no detail", () => {
    expect(mandiHow(detail, "Rose")).toBeNull();
    expect(mandiHow(null, "Rose")).toBeNull();
    expect(mandiHow({}, "")).toBeNull();
  });
});

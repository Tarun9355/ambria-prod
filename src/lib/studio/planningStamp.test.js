import { describe, it, expect, vi } from "vitest";

// Each table's newest updated_at, and the settings rows - stubbed so the test is about which inputs count.
const stamps = { settings: [{ key: "labourTiers", updated_at: "2026-11-01T00:00:00Z" }], inventory: "2026-11-05T00:00:00Z", flower_patterns: "2026-11-11T09:30:00Z", mandi_flowers: null, fixed_venues: "2026-11-02T00:00:00Z" };
vi.mock("../supabase", () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        in: async () => ({ data: stamps.settings }),
        order: () => ({ limit: async () => {
          if (table === "mandi_flowers") throw new Error("table unreadable");
          return { data: stamps[table] ? [{ updated_at: stamps[table] }] : [] };
        } }),
      }),
    }),
  },
}));
const { latestPlanningInputStamp, PLANNING_INPUT_TABLES } = await import("./planningSync.js");

describe("latestPlanningInputStamp - a recipe edit makes booked deals' planning stale (owner report 2026-11-11)", () => {
  it("counts the recipe, mandi and fixed-venue tables, not only settings and inventory", () => {
    expect(PLANNING_INPUT_TABLES).toEqual(expect.arrayContaining(["inventory", "flower_patterns", "mandi_flowers", "fixed_venues"]));
  });
  it("the newest change anywhere wins - here a recipe edited after everything else", async () => {
    expect(await latestPlanningInputStamp()).toBe(Date.parse("2026-11-11T09:30:00Z"));
  });
  it("a table that cannot be read adds nothing and never fails the check", async () => {
    stamps.flower_patterns = null;
    expect(await latestPlanningInputStamp()).toBe(Date.parse("2026-11-05T00:00:00Z"));
  });
});

import { describe, it, expect } from "vitest";
import { planningNeedsSync, planningSnapshotOutdated, PLANNING_SNAPSHOT_VERSION } from "./planningSync.js";

const future = new Date(Date.now() + 5 * 86400000).toLocaleDateString("en-CA");
const eo = (over = {}) => ({ date: future, deptSyncedAt: Date.now() - 3600000, deptSnapVer: PLANNING_SNAPSHOT_VERSION, ...over });

describe("planningNeedsSync", () => {
  it("is stale only when an input changed after the sync (a minute of slack)", () => {
    const e = eo();
    expect(planningNeedsSync(e, e.deptSyncedAt + 30000)).toBe(false);
    expect(planningNeedsSync(e, e.deptSyncedAt + 120000)).toBe(true);
  });
  it("ignores past events and orders that were never synced", () => {
    expect(planningNeedsSync(eo({ date: "2020-01-01" }), Date.now())).toBe(false);
    expect(planningNeedsSync({ date: future }, Date.now())).toBe(false);
  });
  it("an older snapshot shape counts as stale even with no setting change, until synced again", () => {
    const old = eo({ deptSnapVer: undefined, deptSyncedAt: Date.parse("2026-10-21T08:00:00Z") });
    expect(planningSnapshotOutdated(old)).toBe(true);
    expect(planningNeedsSync(old, 1)).toBe(true);
    const fresh = eo({ deptSyncedAt: Date.now() });
    expect(planningNeedsSync(fresh, 1)).toBe(false);
  });
  it("a finished sweep (since) stops flagging an order it skipped", () => {
    const old = eo({ deptSnapVer: undefined, deptSyncedAt: Date.parse("2026-10-21T08:00:00Z") });
    expect(planningNeedsSync(old, 1, Date.now())).toBe(false);
  });
});

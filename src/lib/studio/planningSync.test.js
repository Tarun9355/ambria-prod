import { describe, it, expect } from "vitest";
import { planningNeedsSync, planningNeverSynced, planningSnapshotOutdated, PLANNING_SNAPSHOT_VERSION } from "./planningSync.js";

const future = new Date(Date.now() + 5 * 86400000).toLocaleDateString("en-CA");
const eo = (over = {}) => ({ date: future, deptSyncedAt: Date.now() - 3600000, deptSnapVer: PLANNING_SNAPSHOT_VERSION, ...over });

describe("planningNeedsSync", () => {
  it("is stale only when an input changed after the sync (a minute of slack)", () => {
    const e = eo();
    expect(planningNeedsSync(e, e.deptSyncedAt + 30000)).toBe(false);
    expect(planningNeedsSync(e, e.deptSyncedAt + 120000)).toBe(true);
  });
  it("counts past events too", () => {
    const e = eo({ date: "2020-01-01" });
    expect(planningNeedsSync(e, e.deptSyncedAt + 120000)).toBe(true);
  });
  it("a Studio deal never synced to IMS needs a sync (upcoming, not cancelled) - no button needed", () => {
    const never = { id: "eo_mwvtcd45", clientName: "Jahdev", status: "blocked", functionsDetail: [{ date: future, venue: "Restro" }] };
    expect(planningNeverSynced(never)).toBe(true);
    expect(planningNeedsSync(never, 0)).toBe(true);
    expect(planningNeedsSync(never, Date.now(), Date.now())).toBe(true); // a finished sweep's stamp does not hide it
    expect(planningNeedsSync({ ...never, status: "cancelled" }, Date.now())).toBe(false);
    expect(planningNeedsSync({ ...never, functionsDetail: [{ date: "2020-01-01" }] }, Date.now())).toBe(false); // history
    expect(planningNeedsSync({ date: future, status: "blocked" }, Date.now())).toBe(false); // IMS-only order, no Studio deal
    expect(planningNeverSynced({ ...never, deptSyncedAt: Date.now() })).toBe(false);
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
    expect(planningNeedsSync(old, 1, Date.parse("2030-01-01T00:00:00Z"))).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { samePerson, supervisorIdsOfUser, isMyEvent } from "./mySupervisorEvents";
import { IMS_SUBTABS, userTabOn, userSubTabs, hasTabPerm, roleSubTabs, userTabVed } from "./tabAccess";

// Extra edge cases for the "My events" matcher and for the role's tab access (agent review of the Site-Supervisor-view-only role).

describe("samePerson - phones", () => {
  const P = (phone, name = "") => ({ name, phone });
  it("+91, 91, 0 prefixes, spaces, dashes, brackets and dots all reduce to the last 10 digits", () => {
    for (const v of ["9810011111", "+91 98100 11111", "91-9810011111", "09810011111", "(98100) 11111", "98100.11111", "+91 (981) 001-1111"]) expect(samePerson(P(v), P("9810011111"))).toBe(true);
  });
  it("different 10-digit numbers never match, even with identical names (a name collision cannot override two real phones)", () => {
    expect(samePerson(P("9810011111", "Raja"), P("9810022222", "Raja"))).toBe(false);
  });
  it("a number shorter than 10 digits is ignored and the names decide", () => {
    expect(samePerson(P("12345", "Raja"), P("9810011111", "raja"))).toBe(true);
    expect(samePerson(P("12345", "Raja"), P("9810011111", "Rani"))).toBe(false);
  });
  it("one side without a phone: names decide (and a phone-less pair with different names does not match)", () => {
    expect(samePerson(P("", "Sunil Kumar"), P("9810022222", "SUNIL   KUMAR"))).toBe(true);
    expect(samePerson(P(null, "Sunil"), P(undefined, "Sunil Kumar"))).toBe(false);
  });
  it("numeric phone values (a number, not a string) are handled", () => {
    expect(samePerson({ name: "x", phone: 9810011111 }, { name: "y", phone: "9810011111" })).toBe(true);
  });
  it("RISK: two 10+ digit numbers that agree only on the last 10 digits are the same person (country code differences ignored)", () => {
    expect(samePerson(P("+44 9810011111"), P("+91 9810011111"))).toBe(true);
  });
  it("names: tabs / newlines / non-breaking spaces. \\s covers NBSP so they collapse; empty after trim never matches", () => {
    expect(samePerson({ name: "Sunil\tKumar" }, { name: "sunil kumar" })).toBe(true);
    expect(samePerson({ name: "Sunil Kumar" }, { name: "sunil kumar" })).toBe(true);
    expect(samePerson({ name: "   " }, { name: "   " })).toBe(false);
  });
  it("names are compared whole, not as prefixes or substrings", () => {
    expect(samePerson({ name: "Raj" }, { name: "Raja" })).toBe(false);
    expect(samePerson({ name: "Raja Singh" }, { name: "Raja" })).toBe(false);
  });
  it("non-string names do not throw", () => {
    expect(() => samePerson({ name: 12, phone: {} }, { name: ["a"], phone: [] })).not.toThrow();
  });
});

describe("supervisorIdsOfUser - roster shapes", () => {
  const user = { name: "Raja", phone: "9810011111" };
  it("duplicate roster rows for the same person return every id (an event on either row is mine)", () => {
    const roster = [{ id: "S1", name: "Raja", phone: "9810011111" }, { id: "S7", name: "Raja ", phone: "+91 9810011111" }, { id: "S2", name: "Other", phone: "9000000000" }];
    expect(supervisorIdsOfUser(user, roster)).toEqual(["S1", "S7"]);
  });
  it("name collision with different phones: only the row whose phone matches", () => {
    const roster = [{ id: "A", name: "Raja", phone: "9810000001" }, { id: "B", name: "Raja", phone: "9810011111" }];
    expect(supervisorIdsOfUser(user, roster)).toEqual(["B"]);
  });
  it("RISK: a login with NO phone matches EVERY roster row of that name (two supervisors both called Raja)", () => {
    const roster = [{ id: "A", name: "Raja", phone: "9810000001" }, { id: "B", name: "Raja", phone: "9810011111" }];
    expect(supervisorIdsOfUser({ name: "Raja" }, roster)).toEqual(["A", "B"]);
  });
  it("rows with a null / missing id, null rows and non-array rosters are skipped / safe", () => {
    expect(supervisorIdsOfUser(user, [null, undefined, { name: "Raja", phone: "9810011111" }, { id: null, name: "Raja" }, { id: "S1", name: "Raja" }])).toEqual(["S1"]);
    for (const bad of [undefined, null, "S1", 5, {}]) expect(supervisorIdsOfUser(user, bad)).toEqual([]);
  });
  it("a row with id 0 is a real id (not dropped as falsy)", () => {
    expect(supervisorIdsOfUser(user, [{ id: 0, name: "Raja", phone: "9810011111" }])).toEqual([0]);
  });
  it("inactive roster rows still count (an event assigned before they were deactivated is still theirs)", () => {
    expect(supervisorIdsOfUser(user, [{ id: "S1", name: "Raja", phone: "9810011111", active: false }])).toEqual(["S1"]);
  });
  it("null / undefined / empty user matches nothing", () => {
    const roster = [{ id: "S1", name: "Raja", phone: "9810011111" }, { id: "S2", name: "", phone: "" }];
    for (const u of [null, undefined, {}, { name: "", phone: "" }]) expect(supervisorIdsOfUser(u, roster)).toEqual([]);
  });
});

describe("isMyEvent - edges", () => {
  const me = { name: "Raja", phone: "9810011111" };
  const roster = [{ id: "S1", name: "Raja", phone: "9810011111" }, { id: "S2", name: "Sunil", phone: "9810022222" }];
  it("siteSupervisorId set but the roster is EMPTY / not loaded: falls back to the kept name / phone", () => {
    expect(isMyEvent({ siteSupervisorId: "S1", siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, [])).toBe(true);
    expect(isMyEvent({ siteSupervisorId: "S1", siteSupervisorName: "Sunil", siteSupervisorPhone: "9810022222" }, me, [])).toBe(false);
    expect(isMyEvent({ siteSupervisorId: "S1", siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, undefined)).toBe(true);
  });
  it("siteSupervisorId set, roster empty, and no kept name / phone: not mine", () => {
    expect(isMyEvent({ siteSupervisorId: "S1" }, me, [])).toBe(false);
  });
  it("numeric vs string ids: ids are compared strictly (documented) - a roster of numbers does not match string ids on the event", () => {
    const numRoster = [{ id: 1, name: "Raja", phone: "9810011111" }];
    expect(isMyEvent({ siteSupervisorId: 1 }, me, numRoster)).toBe(true);
    // the event stored "1" (string), roster has 1 (number): strict ===, so the id path misses ...
    expect(isMyEvent({ siteSupervisorId: "1" }, me, numRoster)).toBe(false);
    // ... and, because no row === "1", it is NOT treated as "on the roster", so the kept name/phone rescue it
    expect(isMyEvent({ siteSupervisorId: "1", siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, numRoster)).toBe(true);
  });
  it("empty-string id is 'nobody picked' (falls to the kept name / phone, which a picked-then-cleared event has nulled)", () => {
    expect(isMyEvent({ siteSupervisorId: "", siteSupervisorName: null, siteSupervisorPhone: null }, me, roster)).toBe(false);
    expect(isMyEvent({ siteSupervisorId: null, siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, roster)).toBe(true);
  });
  it("id 0 is a real id", () => {
    expect(isMyEvent({ siteSupervisorId: 0 }, me, [{ id: 0, name: "Raja", phone: "9810011111" }])).toBe(true);
  });
  it("the roster supervisor is somebody else even though the event's kept name says Raja: the roster wins (not mine)", () => {
    expect(isMyEvent({ siteSupervisorId: "S2", siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, roster)).toBe(false);
  });
  it("login and roster row differ in phone but share a name: not mine (phone decides)", () => {
    const r = [{ id: "S1", name: "Raja", phone: "9810099999" }];
    expect(isMyEvent({ siteSupervisorId: "S1" }, me, r)).toBe(false);
  });
  it("login without a phone is matched through the roster by name", () => {
    expect(isMyEvent({ siteSupervisorId: "S1" }, { name: " RAJA " }, roster)).toBe(true);
    expect(isMyEvent({ siteSupervisorId: "S2" }, { name: " RAJA " }, roster)).toBe(false);
  });
  it("RISK: a supervisor re-added to the roster under a NEW id, old event still holds the old (now missing) id: rescued only by the kept name / phone", () => {
    const reAdded = [{ id: "S99", name: "Raja", phone: "9810011111" }];
    expect(isMyEvent({ siteSupervisorId: "S1" }, me, reAdded)).toBe(false);
    expect(isMyEvent({ siteSupervisorId: "S1", siteSupervisorName: "Raja", siteSupervisorPhone: "9810011111" }, me, reAdded)).toBe(true);
  });
  it("kept phone only (no kept name) still matches; kept name only still matches", () => {
    expect(isMyEvent({ siteSupervisorId: "GONE", siteSupervisorPhone: "+91 98100 11111" }, { phone: "9810011111" }, [])).toBe(true);
    expect(isMyEvent({ siteSupervisorId: "GONE", siteSupervisorName: "raja" }, { name: "Raja" }, [])).toBe(true);
  });
  it("an event row with an unassigned supervisor but an old kept name (legacy row) is matched by name - the assign dropdown nulls these, but a legacy row would show up", () => {
    expect(isMyEvent({ siteSupervisorName: "Raja" }, me, roster)).toBe(true);
  });
  it("null user / empty objects never throw and never match", () => {
    expect(isMyEvent({ siteSupervisorId: "S1" }, null, roster)).toBe(false);
    expect(isMyEvent({ siteSupervisorId: "S1", siteSupervisorName: "Raja" }, undefined, roster)).toBe(false);
    expect(isMyEvent({}, {}, {})).toBe(false);
  });
});

describe("tab access for the role (role config AND per-user override)", () => {
  const roleSettings = { roleTabs: { "PDF Viewer": { tabs: ["planning"], subTabs: { planning: ["deptops_onsite"] }, ved: { planning: { edit: false, del: false } } } } };
  const roleUser = { id: "u1", role: "PDF Viewer" };
  const overrideUser = (subs, extra = {}) => ({ id: "u2", role: "Sales", tab_override: { ims: { tabs: { planning: true }, subTabs: { planning: subs }, ...extra } } });

  it("sub-tab list has the new id exactly once, right after Dept Ops, with a label that names the limited view", () => {
    const ids = IMS_SUBTABS.planning.map((t) => t.id);
    expect(ids.filter((i) => i === "deptops_onsite")).toHaveLength(1);
    expect(ids.indexOf("deptops_onsite")).toBe(ids.indexOf("deptops") + 1);
    expect(IMS_SUBTABS.planning.find((t) => t.id === "deptops_onsite").label).toMatch(/Site Supervisor view only/);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("role config: Planning on, only deptops_onsite, no edit - through userTabOn / userSubTabs / hasTabPerm / roleSubTabs", () => {
    expect(userTabOn(roleUser, roleSettings, "ims", "planning")).toBe(true);
    expect(userSubTabs(roleUser, roleSettings, "ims", "planning")).toEqual(["deptops_onsite"]);
    expect(roleSubTabs("PDF Viewer", roleSettings, "ims", "planning")).toEqual(["deptops_onsite"]);
    expect(hasTabPerm(roleUser, roleSettings, "ims", "planning", "view")).toBe(true);
    expect(hasTabPerm(roleUser, roleSettings, "ims", "planning", "edit")).toBe(false);
    expect(hasTabPerm(roleUser, roleSettings, "ims", "inventory", "view")).toBe(false);
  });
  it("per-user tab_override (snake_case, as the logged-in row) with sub-tabs ['deptops_onsite']", () => {
    const u = overrideUser(["deptops_onsite"]);
    expect(userSubTabs(u, {}, "ims", "planning")).toEqual(["deptops_onsite"]);
    expect(userTabOn(u, {}, "ims", "planning")).toBe(true);
    expect(hasTabPerm(u, {}, "ims", "planning", "view")).toBe(true);
  });
  it("per-user tabOverride (camelCase, as the Admin users list row) works the same", () => {
    const u = { id: "u3", role: "Sales", tabOverride: { ims: { tabs: { planning: true }, subTabs: { planning: ["deptops_onsite"] } } } };
    expect(userSubTabs(u, {}, "ims", "planning")).toEqual(["deptops_onsite"]);
  });
  it("a user override beats the role's sub-tabs in both directions", () => {
    // role says onsite-only, override says full Dept Ops
    const u = { ...roleUser, tab_override: { ims: { subTabs: { planning: ["deptops"] } } } };
    expect(userSubTabs(u, roleSettings, "ims", "planning")).toEqual(["deptops"]);
    // override 'ALL' -> unrestricted (null) even though the role is restricted
    const all = { ...roleUser, tab_override: { ims: { subTabs: { planning: "ALL" } } } };
    expect(userSubTabs(all, roleSettings, "ims", "planning")).toBeNull();
    // override absent -> role
    expect(userSubTabs({ ...roleUser, tab_override: { ims: { subTabs: {} } } }, roleSettings, "ims", "planning")).toEqual(["deptops_onsite"]);
  });
  it("an override can switch Planning on for a role that never had it, and its edit right is independent", () => {
    const u = { id: "u4", role: "Nobody", tab_override: { ims: { tabs: { planning: true }, subTabs: { planning: ["deptops_onsite"] }, ved: { planning: { edit: false } } } } };
    expect(userTabOn(u, {}, "ims", "planning")).toBe(true);
    expect(userTabVed(u, {}, "ims", "planning").edit).toBe(false);
    expect(hasTabPerm(u, {}, "ims", "planning", "edit")).toBe(false);
  });
  it("both ids together: userSubTabs returns both, so PlanningTab's `includes('deptops')` rule (not this module) decides", () => {
    expect(userSubTabs(overrideUser(["deptops", "deptops_onsite"]), {}, "ims", "planning")).toEqual(["deptops", "deptops_onsite"]);
  });
  it("Admin is never restricted, whatever the override says", () => {
    const admin = { id: "u_admin", role: "Admin", tab_override: { ims: { subTabs: { planning: ["deptops_onsite"] } } } };
    expect(userSubTabs(admin, roleSettings, "ims", "planning")).toBeNull();
    expect(userSubTabs({ id: "x", role: "Admin" }, roleSettings, "ims", "planning")).toBeNull();
    expect(hasTabPerm(admin, roleSettings, "ims", "planning", "edit")).toBe(true);
  });
  it("a role absent from roleTabs gets no sub-tab restriction (so never onsiteOnly)", () => {
    expect(userSubTabs({ id: "u5", role: "Sales" }, roleSettings, "ims", "planning")).toBeNull();
    expect(userSubTabs(null, roleSettings, "ims", "planning")).toBeNull();
  });
  it("an empty role sub-tab array is 'unrestricted' (null), never an onsite-only grant", () => {
    const s = { roleTabs: { R: { tabs: ["planning"], subTabs: { planning: [] } } } };
    expect(userSubTabs({ id: "u6", role: "R" }, s, "ims", "planning")).toBeNull();
  });
});

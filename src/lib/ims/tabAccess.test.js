import { describe, it, expect } from "vitest";
import {
  roleTabOn, roleTabVed, roleSubTabs,
  userTabOn, userTabVed, userSubTabs, userTabCustom, userHasAnyOverride,
  hasTabPerm,
} from "./tabAccess";

// This module is the single source of truth two screens (RoleAccessModal.jsx's role-level "Edit
// Access" and UsersTab.jsx's per-user override) read from, plus the intended future enforcement
// entry point (hasTabPerm) — a wrong default here is wrong in three places at once, and a role
// that reads as "everything off" here when the app itself already grants it most of IMS is exactly
// the regression this file exists to catch (confirmed once already: roleTabOn used to ignore
// IMS.jsx's own DEFAULT_ROLE_TABS/"every tab but Site" fallback entirely).

describe("roleTabOn", () => {
  it("Admin always sees every tab", () => {
    expect(roleTabOn("Admin", {}, "ims", "finance")).toBe(true);
    expect(roleTabOn("Admin", {}, "studio", "settings")).toBe(true);
  });

  it("Attendance is forced on, Dashboard forced off, for every non-Admin role", () => {
    expect(roleTabOn("Sales", {}, "ims", "attendance")).toBe(true);
    expect(roleTabOn("Sales", {}, "ims", "dashboard")).toBe(false);
  });

  it("an unconfigured role falls back to DEFAULT_ROLE_TABS (Site Supervisor -> site only)", () => {
    expect(roleTabOn("Site Supervisor", {}, "ims", "site")).toBe(true);
    expect(roleTabOn("Site Supervisor", {}, "ims", "inventory")).toBe(false);
  });

  it("an unconfigured role with no DEFAULT_ROLE_TABS entry gets every tab except Site", () => {
    expect(roleTabOn("Sales", {}, "ims", "inventory")).toBe(true);
    expect(roleTabOn("Sales", {}, "ims", "finance")).toBe(true);
    expect(roleTabOn("Sales", {}, "ims", "site")).toBe(false);
  });

  it("a configured role uses its own saved tabs list, not the fallback", () => {
    const settings = { roleTabs: { Sales: { tabs: ["inventory"], subTabs: {} } } };
    expect(roleTabOn("Sales", settings, "ims", "inventory")).toBe(true);
    expect(roleTabOn("Sales", settings, "ims", "finance")).toBe(false);
  });

  it("Studio defaults to Design Studio only when unconfigured", () => {
    expect(roleTabOn("Sales", {}, "studio", "design")).toBe(true);
    expect(roleTabOn("Sales", {}, "studio", "library")).toBe(false);
  });
});

describe("roleTabVed", () => {
  it("defaults Edit and Delete to true when never configured — restriction is opt-in", () => {
    expect(roleTabVed("Sales", {}, "ims", "inventory")).toEqual({ edit: true, del: true });
  });

  it("Admin is always fully editable", () => {
    expect(roleTabVed("Admin", {}, "ims", "inventory")).toEqual({ edit: true, del: true });
  });

  it("an explicit false sticks, an explicit true is just the default", () => {
    const settings = { roleTabs: { Sales: { tabs: ["inventory"], ved: { inventory: { edit: true, del: false } } } } };
    expect(roleTabVed("Sales", settings, "ims", "inventory")).toEqual({ edit: true, del: false });
  });
});

describe("roleSubTabs", () => {
  it("null (unrestricted) when never configured", () => {
    expect(roleSubTabs("Sales", {}, "ims", "planning")).toBe(null);
  });
  it("the explicit list when restricted", () => {
    const settings = { roleTabs: { Sales: { tabs: ["planning"], subTabs: { planning: ["deptops"] } } } };
    expect(roleSubTabs("Sales", settings, "ims", "planning")).toEqual(["deptops"]);
  });
});

describe("user effective reads — no override yet", () => {
  const settings = { roleTabs: { Sales: { tabs: ["inventory"], subTabs: {}, ved: { inventory: { edit: false } } } } };
  const user = { role: "Sales" };

  it("inherits the role's tab on/off", () => {
    expect(userTabOn(user, settings, "ims", "inventory")).toBe(true);
    expect(userTabOn(user, settings, "ims", "finance")).toBe(false);
  });
  it("inherits the role's edit/delete", () => {
    expect(userTabVed(user, settings, "ims", "inventory")).toEqual({ edit: false, del: true });
  });
  it("userHasAnyOverride is false", () => {
    expect(userHasAnyOverride(user)).toBe(false);
  });
});

describe("user overrides on top of the role", () => {
  const settings = { roleTabs: { Sales: { tabs: ["inventory", "planning"], subTabs: { planning: ["deptops", "structure"] } } } };

  it("an explicit tabOverride.tabs entry wins over the role", () => {
    const user = { role: "Sales", tabOverride: { ims: { tabs: { finance: true } } } };
    expect(userTabOn(user, settings, "ims", "finance")).toBe(true); // role says off, user override says on
    expect(userTabOn(user, settings, "ims", "inventory")).toBe(true); // untouched — still inherited
  });

  it("an explicit ved override only overrides the one field it names", () => {
    const user = { role: "Sales", tabOverride: { ims: { ved: { inventory: { edit: true } } } } };
    expect(userTabVed(user, settings, "ims", "inventory")).toEqual({ edit: true, del: true }); // del still inherited (default true)
  });

  it("Admin user ignores any override and is always fully open", () => {
    const user = { role: "Admin", tabOverride: { ims: { tabs: { inventory: false } } } };
    expect(userTabOn(user, settings, "ims", "inventory")).toBe(true);
  });

  // ── The confirmed bug: unchecking a restricted role's LAST visible sub-tab must not silently
  // re-grant every other sub-tab the role itself restricts. Fixed by giving "explicitly show all"
  // its own "ALL" sentinel instead of overloading a bare empty array. ──
  describe("sub-tab override — the empty-array-vs-ALL distinction", () => {
    it("no override at all: inherits the role's restricted list", () => {
      const user = { role: "Sales" };
      expect(userSubTabs(user, settings, "ims", "planning")).toEqual(["deptops", "structure"]);
    });

    it("override set to an explicit empty array: shows NONE of them — not all", () => {
      const user = { role: "Sales", tabOverride: { ims: { subTabs: { planning: [] } } } };
      expect(userSubTabs(user, settings, "ims", "planning")).toEqual([]);
    });

    it('override set to the "ALL" sentinel: unrestricted for this user regardless of the role', () => {
      const user = { role: "Sales", tabOverride: { ims: { subTabs: { planning: "ALL" } } } };
      expect(userSubTabs(user, settings, "ims", "planning")).toBe(null);
    });

    it("a real two-item custom list still works normally", () => {
      const user = { role: "Sales", tabOverride: { ims: { subTabs: { planning: ["paint"] } } } };
      expect(userSubTabs(user, settings, "ims", "planning")).toEqual(["paint"]);
    });
  });

  it("userTabCustom flags exactly the fields that are overridden", () => {
    const user = { role: "Sales", tabOverride: { ims: { tabs: { finance: true }, ved: { inventory: { edit: true } }, subTabs: { planning: [] } } } };
    expect(userTabCustom(user, "ims", "finance")).toEqual({ on: true, edit: false, del: false, subTabs: false });
    expect(userTabCustom(user, "ims", "inventory")).toEqual({ on: false, edit: true, del: false, subTabs: false });
    expect(userTabCustom(user, "ims", "planning")).toEqual({ on: false, edit: false, del: false, subTabs: true });
  });

  it("userHasAnyOverride is true once any field anywhere is overridden", () => {
    expect(userHasAnyOverride({ role: "Sales", tabOverride: { ims: { tabs: { finance: true } } } })).toBe(true);
    expect(userHasAnyOverride({ role: "Sales", tabOverride: { ims: {}, studio: {} } })).toBe(false);
  });
});

describe("hasTabPerm", () => {
  const settings = { roleTabs: { Sales: { tabs: ["inventory"], ved: { inventory: { del: false } } } } };

  it("view requires the tab to be on", () => {
    const user = { role: "Sales" };
    expect(hasTabPerm(user, settings, "ims", "inventory", "view")).toBe(true);
    expect(hasTabPerm(user, settings, "ims", "finance", "view")).toBe(false);
  });

  it("edit/del are false outright when the tab itself is off", () => {
    const user = { role: "Sales" };
    expect(hasTabPerm(user, settings, "ims", "finance", "edit")).toBe(false);
  });

  it("edit/del read the resolved ved state when the tab is on", () => {
    const user = { role: "Sales" };
    expect(hasTabPerm(user, settings, "ims", "inventory", "edit")).toBe(true);
    expect(hasTabPerm(user, settings, "ims", "inventory", "del")).toBe(false);
  });

  it("Admin passes everything", () => {
    expect(hasTabPerm({ role: "Admin" }, settings, "ims", "finance", "del")).toBe(true);
  });
});

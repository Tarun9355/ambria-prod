import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { userTabOn, userSubTabs } from "./tabAccess";

// A user's own Tab Access override wins over the role in IMS (owner report 2026-11-19: Anmol, role Sales, given Planning by hand
// in Admin → Users, still saw only Attendance and Inventory - IMS read the role only).
const settings = { roleTabs: {
  Sales: { tabs: ["dashboard", "inventory"], subTabs: {} },
  "Site Supervisor": { tabs: ["dashboard", "events", "inventory"], subTabs: { planning: ["deptops"] } },
} };
// Anmol's row as it came back from the database (snake_case tab_override - the logged-in user's raw row)
const anmol = { id: "UC364AACB52", name: "Anmol", role: "Sales",
  tab_override: { ims: { ved: {}, tabs: { flowers: false, planning: true }, subTabs: {} }, studio: { tabs: { library: false, settings: false } } } };

describe("IMS tabs follow the user's own override", () => {
  it("Anmol (Sales) gets Planning from his override, keeps Inventory from the role, not Flowers", () => {
    expect(userTabOn(anmol, settings, "ims", "planning")).toBe(true);
    expect(userTabOn(anmol, settings, "ims", "inventory")).toBe(true);
    expect(userTabOn(anmol, settings, "ims", "flowers")).toBe(false);
    expect(userTabOn(anmol, settings, "ims", "supply")).toBe(false);
  });
  it("another Sales user without an override: no Planning", () => {
    expect(userTabOn({ role: "Sales" }, settings, "ims", "planning")).toBe(false);
  });
  it("an override can switch a role's tab off; sub-tabs follow the override, else the role", () => {
    const u = { role: "Site Supervisor", tabOverride: { ims: { tabs: { inventory: false }, subTabs: { planning: ["deptops", "truck"] } } } };
    expect(userTabOn(u, settings, "ims", "inventory")).toBe(false);
    expect(userSubTabs(u, settings, "ims", "planning")).toEqual(["deptops", "truck"]);
    expect(userSubTabs({ role: "Site Supervisor" }, settings, "ims", "planning")).toEqual(["deptops"]);
  });
  it("wiring: IMS's sidebar and every sub-tab screen read the user, not the role alone", () => {
    const read = (f) => readFileSync(resolve(__dirname, "../../pages/ims", f), "utf8");
    expect(read("IMS.jsx")).toMatch(/userTabOn\(user, settings, "ims", t\.id\)/);
    for (const [f, key] of [["PlanningTab.jsx", "planning"], ["SupplyTab.jsx", "supply"], ["FlowersTab.jsx", "flowers"], ["FinanceTab.jsx", "finance"], ["AdminTab.jsx", "admin"], ["AdminSettingsTab.jsx", "settings"]]) {
      const src = read(f);
      expect(src).toContain(`userSubTabs(authUser, settings, "ims", "${key}")`);
      expect(src).not.toMatch(/roleConfig\?\.subTabs\?\./);
    }
  });
});

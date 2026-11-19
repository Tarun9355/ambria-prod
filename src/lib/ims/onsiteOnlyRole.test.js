import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IMS_SUBTABS, userSubTabs, userTabOn, hasTabPerm } from "./tabAccess";

// A role that sees only Dept Ops' Site Supervisor view and downloads the PDFs (owner ask 2026-11-19): Planning on, sub-tab
// "deptops_onsite", Edit off. Built in Admin → Users → + role → Tab Access - no code needed for the role itself.
const read = (p) => readFileSync(resolve(__dirname, "../../pages/ims", p), "utf8");
const settings = { roleTabs: { "PDF Viewer": { tabs: ["planning"], subTabs: { planning: ["deptops_onsite"] }, ved: { planning: { edit: false, del: false } } } } };
const user = { id: "u1", role: "PDF Viewer" };

describe("role with only the Site Supervisor view of Dept Ops", () => {
  it("the Tab Access screens offer the sub-tab", () => {
    expect(IMS_SUBTABS.planning.some((t) => t.id === "deptops_onsite")).toBe(true);
  });
  it("such a role sees Planning (that sub-tab only), no other tab, and cannot edit", () => {
    expect(userTabOn(user, settings, "ims", "planning")).toBe(true);
    expect(userTabOn(user, settings, "ims", "inventory")).toBe(false);
    expect(userSubTabs(user, settings, "ims", "planning")).toEqual(["deptops_onsite"]);
    expect(hasTabPerm(user, settings, "ims", "planning", "edit")).toBe(false);
  });
  it("wiring: PlanningTab turns it into Dept Ops with onsiteOnly (never for admin or the hidden PDF run); Dept Ops keeps to the on-site view", () => {
    const pt = read("PlanningTab.jsx");
    expect(pt).toContain('subsOn.includes("deptops_onsite") && !subsOn.includes("deptops")');
    expect(pt).toContain("!isAdmin && !autoPdfFor");
    expect(pt).toContain("<DepartmentOpsTab onsiteOnly={onsiteOnly}");
    const d = read("DepartmentOpsTab.jsx");
    expect(d).toContain('const opsView = onsiteOnly ? "onsite" : opsViewRaw;');
    expect(d).toContain('{!onsiteOnly && [["planning", "Department Head"');
  });
});

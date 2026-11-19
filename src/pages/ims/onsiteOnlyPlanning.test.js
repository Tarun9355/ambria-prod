import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";

// PlanningTab, rendered for real: the "Dept Ops: Site Supervisor view only" sub-tab (deptops_onsite) mounts Dept Ops with onsiteOnly (owner ask
// 2026-11-19). Dept Ops itself is stubbed to show the prop it got.
vi.mock("../../components/ui", () => ({ Tabs: ({ tabs, active }) => h("nav", { "data-active": active }, tabs.map((t) => t.id).join(",")) }));
vi.mock("./PaintPlanningTab.jsx", () => ({ default: () => h("div", { id: "paint" }) }));
vi.mock("./AdminSettingsTab.jsx", () => ({ default: ({ mode }) => h("div", { id: mode }) }));
vi.mock("./StructurePlanningTab.jsx", () => ({ default: () => h("div", { id: "structure" }) }));
vi.mock("./DepartmentOpsTab.jsx", () => ({ default: ({ onsiteOnly, autoPdfFor }) => h("div", { id: "deptops", "data-onsite": String(!!onsiteOnly), "data-auto": autoPdfFor || "" }) }));

import PlanningTab from "./PlanningTab.jsx";

let saved;
beforeEach(() => { saved = null; vi.stubGlobal("sessionStorage", { getItem: () => saved, setItem() {} }); });
afterEach(() => vi.unstubAllGlobals());

const render = (props) => renderToString(h(PlanningTab, { eventOrders: [], functions: [], settings: {}, ...props }));
const withSubs = (subs) => ({ id: "u1", role: "Sales", tab_override: { ims: { tabs: { planning: true }, subTabs: { planning: subs } } } });

describe("Dept Ops: Site Supervisor view only", () => {
  it("only that sub-tab: Dept Ops is the one tab, mounted with onsiteOnly", () => {
    const html = render({ authUser: withSubs(["deptops_onsite"]) });
    expect(html).toContain('id="deptops"');
    expect(html).toContain('data-onsite="true"');
    expect(html).toContain(">deptops<");
    expect(html).not.toContain('id="structure"');
  });
  it("a stale stored sub-tab that is not offered cannot hide it", () => {
    saved = "structure";
    expect(render({ authUser: withSubs(["deptops_onsite"]) })).toContain('data-onsite="true"');
  });
  it("with another sub-tab (Truck) beside it: both offered, Dept Ops still onsiteOnly", () => {
    saved = "deptops";
    const html = render({ authUser: withSubs(["deptops_onsite", "truck"]) });
    expect(html).toContain("deptops,truck");
    expect(html).toContain('data-onsite="true"');
  });
  it("the full Dept Ops wins when both are given; plain Dept Ops is unchanged", () => {
    expect(render({ authUser: withSubs(["deptops", "deptops_onsite"]) })).toContain('data-onsite="false"');
    expect(render({ authUser: withSubs(["deptops"]) })).toContain('data-onsite="false"');
  });
  it("never for an admin, an unrestricted role, or the hidden Deal Check PDF run", () => {
    expect(render({ authUser: { id: "u_admin", role: "Admin" } })).toContain('data-onsite="false"');
    expect(render({ authUser: { id: "u2", role: "Sales" }, settings: { roleTabs: { Sales: { tabs: ["planning"] } } } })).toContain('data-onsite="false"');
    const run = render({ authUser: withSubs(["deptops_onsite"]), autoPdfFor: "EO-1" });
    expect(run).toContain('data-onsite="false"');
    expect(run).toContain('data-auto="EO-1"');
  });
  it("a role set up in Role Access (settings.roleTabs) works the same as a user override", () => {
    const settings = { roleTabs: { "PDF Viewer": { tabs: ["planning"], subTabs: { planning: ["deptops_onsite"] } } } };
    expect(render({ authUser: { id: "u3", role: "PDF Viewer" }, settings })).toContain('data-onsite="true"');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// PlanningTab rendered for real, Dept Ops stubbed to expose what it was handed (agent review, edge cases of how onsiteOnly is derived).
vi.mock("../../components/ui", () => ({ Tabs: ({ tabs, active }) => h("nav", { "data-active": active }, tabs.map((t) => t.id).join(",")) }));
vi.mock("./PaintPlanningTab.jsx", () => ({ default: () => h("div", { id: "paint" }) }));
vi.mock("./AdminSettingsTab.jsx", () => ({ default: ({ mode }) => h("div", { id: mode }) }));
vi.mock("./StructurePlanningTab.jsx", () => ({ default: () => h("div", { id: "structure" }) }));
vi.mock("./DepartmentOpsTab.jsx", () => ({ default: (p) => h("div", { id: "deptops", "data-onsite": String(p.onsiteOnly), "data-has-supervisors": String(Array.isArray(p.supervisors)), "data-auto": p.autoPdfFor || "" }) }));

import PlanningTab from "./PlanningTab.jsx";

let saved;
beforeEach(() => { saved = null; vi.stubGlobal("sessionStorage", { getItem: () => saved, setItem() {} }); });
afterEach(() => vi.unstubAllGlobals());

const render = (props) => renderToString(h(PlanningTab, { eventOrders: [], functions: [], settings: {}, ...props })).replace(/<!-- -->/g, "");
const navOf = (html) => /<nav[^>]*>([^<]*)<\/nav>/.exec(html)[1].split(",").filter(Boolean);
const activeOf = (html) => /<nav data-active="([^"]*)"/.exec(html)[1];
const ov = (subs, role = "Sales") => ({ id: "u1", role, tab_override: { ims: { tabs: { planning: true }, subTabs: { planning: subs } } } });
const onsite = (html) => /data-onsite="(true|false)"/.exec(html)?.[1];

describe("PlanningTab - onsiteOnly derivation", () => {
  it("only deptops_onsite: one tab (deptops), selected, onsiteOnly", () => {
    const html = render({ authUser: ov(["deptops_onsite"]) });
    expect(navOf(html)).toEqual(["deptops"]);
    expect(activeOf(html)).toBe("deptops");
    expect(onsite(html)).toBe("true");
  });
  it("deptops_onsite + truck: tabs deptops and truck (in Planning's own order), Dept Ops first and onsiteOnly", () => {
    const html = render({ authUser: ov(["truck", "deptops_onsite"]) });
    expect(navOf(html)).toEqual(["deptops", "truck"]);
    expect(activeOf(html)).toBe("deptops");
    expect(onsite(html)).toBe("true");
  });
  it("deptops_onsite + several others: every listed one stays, nothing unlisted appears", () => {
    const html = render({ authUser: ov(["paint", "deptops_onsite", "fabricstock"]) });
    expect(navOf(html)).toEqual(["deptops", "paint", "fabricstock"]);
    expect(onsite(html)).toBe("true");
  });
  it("deptops_onsite WITH deptops: full Dept Ops (not onsiteOnly), and the tab appears once", () => {
    const html = render({ authUser: ov(["deptops_onsite", "deptops", "truck"]) });
    expect(navOf(html)).toEqual(["deptops", "truck"]);
    expect(onsite(html)).toBe("false");
  });
  it("without deptops_onsite (any other list): never onsiteOnly", () => {
    for (const subs of [["deptops"], ["truck"], ["paint", "structure"]]) {
      const html = render({ authUser: ov(subs) });
      expect(html.includes('data-onsite="true"')).toBe(false);
    }
  });
  it("another sub-tab only (no Dept Ops at all): the Dept Ops tab is not offered and not mounted", () => {
    const html = render({ authUser: ov(["truck"]) });
    expect(navOf(html)).toEqual(["truck"]);
    expect(html).not.toContain('id="deptops"');
  });
  it("sentinel 'ALL' override and unrestricted roles: every tab, never onsiteOnly (even when the ROLE is onsite-only)", () => {
    const settings = { roleTabs: { "PDF Viewer": { tabs: ["planning"], subTabs: { planning: ["deptops_onsite"] } } } };
    const html = render({ authUser: { id: "u1", role: "PDF Viewer", tab_override: { ims: { subTabs: { planning: "ALL" } } } }, settings });
    expect(navOf(html)).toHaveLength(7);
    expect(onsite(html)).toBe("false");
    expect(onsite(render({ authUser: { id: "u2", role: "Sales" } }))).toBe("false");
  });
  it("an override with an EMPTY list falls back to every tab and is not onsiteOnly (documented pre-existing fallback)", () => {
    const html = render({ authUser: ov([]) });
    expect(navOf(html)).toHaveLength(7);
    expect(onsite(html)).toBe("false");
  });
  it("admin by role OR by the u_admin id, even holding the sub-tab through an override: all tabs, never onsiteOnly", () => {
    for (const u of [{ id: "x", role: "Admin", tab_override: { ims: { subTabs: { planning: ["deptops_onsite"] } } } }, { id: "u_admin", role: "Sales", tab_override: { ims: { subTabs: { planning: ["deptops_onsite"] } } } }]) {
      const html = render({ authUser: u });
      expect(navOf(html)).toHaveLength(7);
      expect(onsite(html)).toBe("false");
    }
  });
  it("hidden Deal Check PDF run: never onsiteOnly, Dept Ops is forced even for a role that lacks it, autoPdfFor is passed on", () => {
    let html = render({ authUser: ov(["deptops_onsite"]), autoPdfFor: "EO-9" });
    expect(onsite(html)).toBe("false");
    expect(html).toContain('data-auto="EO-9"');
    html = render({ authUser: ov(["truck"]), autoPdfFor: "EO-9" });
    expect(navOf(html)).toEqual(["truck", "deptops"]);
    expect(activeOf(html)).toBe("deptops");
    expect(onsite(html)).toBe("false");
  });
  it("a stale stored sub-tab (structure / paint / unknown) is ignored for this role; a stored 'deptops' / 'truck' is honoured", () => {
    for (const s of ["structure", "paint", "nonsense"]) { saved = s; expect(activeOf(render({ authUser: ov(["deptops_onsite"]) }))).toBe("deptops"); }
    saved = "truck";
    const html = render({ authUser: ov(["deptops_onsite", "truck"]) });
    expect(activeOf(html)).toBe("truck");
    expect(html).not.toContain('id="deptops"');
  });
  it("authUser missing: no throw, full tabs, not onsiteOnly", () => {
    expect(() => render({ authUser: undefined })).not.toThrow();
    expect(onsite(render({ authUser: undefined }))).toBe("false");
    expect(onsite(render({ authUser: null }))).toBe("false");
  });
  it("the supervisors roster reaches Dept Ops (needed for My events); undefined becomes the component's own default, never a crash", () => {
    expect(render({ authUser: ov(["deptops_onsite"]), supervisors: [{ id: "S1" }] })).toContain('data-has-supervisors="true"');
  });
  it("role config + per-user override both given: the override wins (role onsite-only, override full Dept Ops -> not onsiteOnly)", () => {
    const settings = { roleTabs: { "PDF Viewer": { tabs: ["planning"], subTabs: { planning: ["deptops_onsite"] } } } };
    expect(onsite(render({ authUser: { id: "u1", role: "PDF Viewer" }, settings }))).toBe("true");
    expect(onsite(render({ authUser: { id: "u1", role: "PDF Viewer", tab_override: { ims: { subTabs: { planning: ["deptops"] } } } }, settings }))).toBe("false");
  });
});

describe("PlanningTab source wiring", () => {
  const pt = readFileSync(resolve(__dirname, "PlanningTab.jsx"), "utf8");
  it("onsiteOnly is passed ONLY to Dept Ops (no other sub-tab receives it)", () => {
    const uses = pt.split("\n").filter((l) => l.includes("onsiteOnly") && l.includes("<"));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("<DepartmentOpsTab onsiteOnly={onsiteOnly}");
  });
  it("the exact rule: not admin, not the hidden run, a list that holds deptops_onsite and NOT deptops", () => {
    expect(pt).toContain('const onsiteOnly = !isAdmin && !autoPdfFor && Array.isArray(subsOn) && subsOn.includes("deptops_onsite") && !subsOn.includes("deptops");');
  });
  it("RISK guard: the deptops_onsite id is not a real tab id in allTabs (it must never be rendered as its own tab)", () => {
    const allTabsBlock = pt.slice(pt.indexOf("const allTabs = ["), pt.indexOf("];", pt.indexOf("const allTabs = [")));
    expect(allTabsBlock).not.toContain("deptops_onsite");
  });
});

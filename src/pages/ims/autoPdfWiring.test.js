import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";

// ═══ Deal Check "All departments PDF": the wiring inside the hidden IMS frame ═══
// IMS.jsx (autoPdfFor, allowedTabs) -> PlanningTab.jsx (Dept Ops forced) -> DepartmentOpsTab.jsx (auto run).
// PlanningTab is rendered for real (react-dom/server, children stubbed); IMS.jsx / DepartmentOpsTab.jsx are far too large to mount
// here, so their lines are read as source, in the style of bookedOosRaised.scenarios.test.js.

vi.mock("../../components/ui", () => ({ Tabs: ({ tabs, active }) => h("nav", { "data-active": active }, tabs.map((t) => t.id).join(",")) }));
vi.mock("./PaintPlanningTab.jsx", () => ({ default: () => h("div", { id: "paint" }) }));
vi.mock("./AdminSettingsTab.jsx", () => ({ default: ({ mode }) => h("div", { id: mode }) }));
vi.mock("./StructurePlanningTab.jsx", () => ({ default: () => h("div", { id: "structure" }) }));
vi.mock("./DepartmentOpsTab.jsx", () => ({ default: ({ autoPdfFor }) => h("div", { id: "deptops", "data-auto": autoPdfFor || "" }) }));

import PlanningTab from "./PlanningTab.jsx";
import { userTabOn } from "../../lib/ims/tabAccess";

const read = (p) => readFileSync(resolve(__dirname, p), "utf8");
let saved;
beforeEach(() => { saved = null; vi.stubGlobal("sessionStorage", { getItem: () => saved, setItem() {} }); });
afterEach(() => vi.unstubAllGlobals());

const render = (props) => renderToString(h(PlanningTab, { eventOrders: [], functions: [], ...props }));
const salesRestricted = (subs) => ({ id: "u1", role: "Sales", tab_override: { ims: { tabs: { planning: true }, subTabs: { planning: subs } } } });
const settingsFor = {};

describe("PlanningTab forces Dept Ops during the Deal Check run", () => {
  it("a role whose Planning sub-tabs exclude Dept Ops: no run -> Dept Ops is not even offered", () => {
    saved = "deptops"; // stale value cannot select a tab that is not offered
    const html = render({ authUser: salesRestricted(["structure"]), settings: settingsFor });
    expect(html).toContain('id="structure"');
    expect(html).not.toContain('id="deptops"');
    expect(html).toContain(">structure<");
  });

  it("same role during the run (autoPdfFor) with the frame's private storage holding 'deptops' (IMS.openEventInPlanning writes it) -> Dept Ops mounts and gets autoPdfFor", () => {
    saved = "deptops";
    const html = render({ authUser: salesRestricted(["structure"]), settings: settingsFor, autoPdfFor: "EO-1" });
    expect(html).toContain('id="deptops"');
    expect(html).toContain('data-auto="EO-1"');
    expect(html).toContain("structure,deptops"); // appended, still reachable
  });

  it("an admin and an unrestricted role land on Dept Ops (first sub-tab) with no help", () => {
    expect(render({ authUser: { id: "u_admin", role: "Admin" }, settings: settingsFor, autoPdfFor: "EO-1" })).toContain('id="deptops"');
    expect(render({ authUser: { id: "u2", role: "Sales" }, settings: { roleTabs: { Sales: { tabs: ["planning"] } } }, autoPdfFor: "EO-1" })).toContain('id="deptops"');
  });

  // FRAGILE COUPLING (see report): PlanningTab picks the Dept Ops sub-tab only through the "ambria-ims-planning-sub" value that
  // IMS.openEventInPlanning wrote just before it. If that write ever fails (sessionStorage throws, key renamed) a restricted
  // role mounts on its first allowed sub-tab, Dept Ops never mounts, the run goes silent and Deal Check ends it after 90 s.
  it("a restricted role with NO stored sub-tab still opens Dept Ops while autoPdfFor is set (fixed: autoPdfFor picks it directly)", () => {
    saved = null;
    const html = render({ authUser: salesRestricted(["structure"]), settings: settingsFor, autoPdfFor: "EO-1" });
    expect(html).toContain('id="deptops"');
  });
});

describe("IMS.jsx: autoPdfFor + allowedTabs", () => {
  const src = read("./IMS.jsx");

  it("Planning is appended after the role / user-override filter, the calendar strip and before Approvals, only while autoPdfFor is set", () => {
    const iRole = src.indexOf('let allowedTabs = isAdmin ? TABS : TABS.filter((t) => t.id !== "dashboard" && (t.id === "attendance" || userTabOn(user, settings, "ims", t.id)));');
    const iCal = src.indexOf('allowedTabs = allowedTabs.filter((t) => t.id !== "calendar");');
    const iPdf = src.indexOf('if (autoPdfFor && !allowedTabs.some((t) => t.id === "planning")) allowedTabs = [...allowedTabs, TABS.find((t) => t.id === "planning")].filter(Boolean);');
    const iAppr = src.indexOf('if (canApprove(user) && !allowedTabs.some((t) => t.id === "approvals"))');
    expect(iRole).toBeGreaterThan(-1);
    expect(iPdf).toBeGreaterThan(iCal);
    expect(iCal).toBeGreaterThan(iRole);
    expect(iAppr).toBeGreaterThan(iPdf);
  });

  it("the role filter is the userTabOn read: a role with no Planning has none without the run (so the append is what gives it)", () => {
    const sales = { id: "u2", role: "Sales" };
    const settings = { roleTabs: { Sales: { tabs: ["inventory"] } } };
    expect(userTabOn(sales, settings, "ims", "planning")).toBe(false);
    // a per-user override switching Planning on (Anmol's case) is honoured
    expect(userTabOn({ ...sales, tab_override: { ims: { tabs: { planning: true } } } }, settings, "ims", "planning")).toBe(true);
    // a Site Supervisor (DEFAULT_ROLE_TABS: only "site") has no Planning either
    expect(userTabOn({ id: "u3", role: "Site Supervisor" }, {}, "ims", "planning")).toBe(false);
  });

  it("the run opens the event once data is in (private sessionStorage write first, then the tab), 'alive' pings only while loading", () => {
    expect(src).toMatch(/const openEventInPlanning = \(eoId[^)]*\) => \{\s*try \{ sessionStorage\.setItem\("ambria-ims-planning-sub", "deptops"\); \} catch/);
    expect(src).toMatch(/if \(!autoPdfFor \|\| loading \|\| autoPdfOpenedRef\.current\) return;\s*autoPdfOpenedRef\.current = true;\s*openEventInPlanning\(autoPdfFor\);/);
    expect(src).toMatch(/if \(!autoPdfFor \|\| !loading\) return undefined;[\s\S]{0,260}phase: "alive"[\s\S]{0,200}setInterval\(tell, 10000\)/);
    // only inside a frame
    expect(src).toContain("m && window.self !== window.top ? decodeURIComponent(m[1]) : null");
  });

  it("autoPdfFor reaches Planning and ends through finishAutoPdf", () => {
    expect(src).toContain("autoPdfFor={autoPdfFor} onAutoPdfDone={finishAutoPdf}");
    expect(src).toContain("const finishAutoPdf = useCallback(() => setAutoPdfFor(null), []);");
  });
});

describe("DepartmentOpsTab auto run", () => {
  const src = read("./DepartmentOpsTab.jsx");
  const i = src.indexOf("const autoPdfStartedRef = useRef(false);");
  const run = src.slice(i, i + 3200);

  it("posts to the parent with the exact origin only", () => {
    expect(run).toContain('window.parent?.postMessage({ type: "ambria-dept-pdf", phase, ...extra }, window.location.origin)');
  });
  it("waits 3 s, for the event, and for the venues; starts once", () => {
    expect(run).toContain("!autoPdfFor || autoPdfStartedRef.current || selId !== autoPdfFor || !sel || !inhouseVenues.loaded");
    expect(run).toContain("}, 3000);");
    expect(run).toContain("autoPdfStartedRef.current = true;");
  });
  it("heartbeats every 10 s, stops it in finally, restores window.alert", () => {
    expect(run).toContain('const beat = setInterval(() => tell("alive"), 10000);');
    expect(run).toMatch(/finally \{ window\.alert = realAlert; pdfAllCarpetsRef\.current = false; clearInterval\(beat\); \}/);
  });
  it("sends the file BEFORE 'done' (the file goes up inside exportPdf, 'done' after it resolves)", () => {
    const iFile = run.indexOf('tell("file", { blob, name })');
    const iDone = run.indexOf('tell(ok ? "done" : "error", { notes })');
    expect(iFile).toBeGreaterThan(-1);
    expect(iDone).toBeGreaterThan(iFile);
  });
  it("tell() reports whether the post went through, and a lost 'file' becomes an error, never 'done' (fixed)", () => {
    expect(run).toMatch(/postMessage\([^;]*\); return true; \} catch \{ return false;/);
    expect(run).toContain("fileLost");
    expect(run).toMatch(/if \(fileLost\) tell\("error"/);
  });
  it("'No department plan' returns inside try: the error is posted but onAutoPdfDone is never called (frame stays until Deal Check removes it)", () => {
    expect(run).toMatch(/if \(!deptsWithWork\.length\) \{ tell\("error", \{ reason: "No department plan[^}]*\}\); return; \}/);
  });
});

describe("main.jsx frame isolation", () => {
  const src = read("../../main.jsx");
  it("private sessionStorage + the PDF flag are set only inside a frame, and the flag only after the storage swap succeeded", () => {
    expect(src).toContain("/[?&](sweep=1\\b|pdfEvent=)/.test(window.location.hash) && window.self !== window.top");
    const iDefine = src.indexOf('Object.defineProperty(window, "sessionStorage"');
    const iFlag = src.indexOf("window.__AMBRIA_PDF_FRAME__ = true");
    expect(iDefine).toBeGreaterThan(-1);
    expect(iFlag).toBeGreaterThan(iDefine);
    expect(src).toContain("} catch { /* cannot isolate sessionStorage");
  });
});

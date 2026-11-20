import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { userDepartments } from "../../lib/ims/deptClassify";
import { stampDeptChanges } from "../../lib/ims/recentChanges";

// Commit 0bcd5b32 (owner ask 2026-11-20): Planning -> Dept Ops, "Changed in the last 48 hours" gets an "OK" button. A department
// head of THAT department presses it -> markChangesSeen([dept]) writes deptOps[dept].changesSeen[seenKey] = now (setEventOrders),
// and the banner + the calendar's alert go for that person only. The PDF download no longer marks anything seen.
//
// DepartmentOpsTab is rendered FOR REAL (react-dom/server). Test-only taps (same technique as onsiteRole.manpower.agent.test.jsx):
//   - useState is wrapped so state a click would set (selId, dept, exporting ...) is forced by matching the caller's source line;
//   - the jsx runtime records every <button> + its props, so the real onClick can be called and the setEventOrders updater applied;
//   - useEffect is a no-op recorder (SSR never runs effects anyway);
//   - deptBookPdf.renderDeptBook is mocked to "succeed" so the real exportPdf runs to its end without building a PDF.
const SRC = readFileSync(resolve(__dirname, "DepartmentOpsTab.jsx"), "utf8");
const SRC_LINES = SRC.split("\n");
const forced = { map: {} };
const rec = { els: [] };
const srcLineOfCaller = () => {
  const frame = new Error().stack.split("\n").find((l) => l.includes("DepartmentOpsTab.jsx"));
  const m = frame && /DepartmentOpsTab\.jsx:(\d+):/.exec(frame);
  return m ? SRC_LINES[Number(m[1]) - 1] || "" : null;
};
vi.mock("react", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useState: (init) => {
      const fr = Object.keys(forced.map);
      if (fr.length) {
        const text = srcLineOfCaller();
        if (text != null) {
          const key = fr.find((k) => text.includes(k));
          if (key) return [forced.map[key], () => {}];
        }
      }
      return actual.useState(init);
    },
    useEffect: () => {},
  };
});
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const a = await orig();
  const wrap = (name) => (type, props, ...rest) => { if (type === "button") rec.els.push({ type, props }); return a[name](type, props, ...rest); };
  return { ...a, jsxDEV: wrap("jsxDEV") };
});
vi.mock("react/jsx-runtime", async (orig) => {
  const a = await orig();
  const wrap = (name) => (type, props, ...rest) => { if (type === "button") rec.els.push({ type, props }); return a[name](type, props, ...rest); };
  return { ...a, jsx: wrap("jsx"), jsxs: wrap("jsxs") };
});
vi.mock("./PlanningSyncButton.jsx", () => ({ default: () => null }));
const pdf = vi.hoisted(() => ({ calls: [] }));
vi.mock("../../lib/ims/deptBookPdf", async (orig) => {
  const a = await orig();
  return { ...a, renderDeptBook: async (args) => { pdf.calls.push(args); return { ok: true, url: "", name: "x.pdf" }; } };
});

import DepartmentOpsTab from "./DepartmentOpsTab.jsx";

const F = {
  selId: "const [selId, setSelId]",
  dept: "const [dept, setDept]",
  exporting: "const [exporting, setExporting]",
};
const pad = (n) => String(n).padStart(2, "0");
const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const TODAY = iso(Date.now()); // in the month the calendar opens on
const NOW = Date.now();
const HOUR = 3600000;

const floralHead = { id: "h1", role: "Dept Head - Floral", name: "Sudhir", departments: ["Floral"] };
const floralHead2 = { id: "h2", role: "Dept Head - Floral", name: "Anmol", departments: ["Floral"] };
const multiHead = { id: "h3", role: "Dept Head - Floral", name: "Krati", departments: ["Floral", "Fabric"] };
const fabricHead = { id: "h4", role: "Dept Head - Fabric", name: "Aman", departments: ["Fabric"] };
const admin = { id: "u_admin", role: "Admin", name: "Tarun" };
const adminWithDepts = { id: "a2", role: "Admin", name: "Ajay", departments: ["Floral"] };
const sales = { id: "s1", role: "Sales", name: "Ashi" };
const production = { id: "p1", role: "Production", name: "Prod", departments: ["Floral"] };
const viewer = { id: "v1", role: "PDF Viewer", name: "Raja", departments: ["Floral"] };

const ev = (extra = {}) => ({
  id: "E1", clientName: "MineWedding", status: "confirmed", date: TODAY,
  functionsDetail: [{ date: TODAY, venue: "Hall", type: "Wedding", shift: "evening" }],
  deptOps: { Floral: { changes: { mp: { at: NOW - 2 * HOUR, by: "Anmol" } } } },
  ...extra,
});
const amend = (o = {}) => ({ id: "A1", eventOrderId: "E1", status: "logged", department: "Floral", requestedAt: NOW - HOUR, requestedBy: "Ashi", items: [{ name: "Round Table", change: "added", qty: 2 }], ...o });

const store0 = (events) => { const st = { events, calls: 0 }; st.set = (u) => { st.calls += 1; st.events = typeof u === "function" ? u(st.events) : u; }; return st; };
const props = (st, o = {}) => ({ onsiteOnly: false, eventOrders: st.events, setEventOrders: st.set, authUser: floralHead, settings: {}, supervisors: [], inventory: [], functions: [], blocks: [], amendRequests: [], ...o });
const mount = (p, f = {}) => {
  rec.els = []; forced.map = f;
  try {
    const html = renderToString(h(DepartmentOpsTab, p)).replace(/<!-- -->/g, "");
    return { html, els: rec.els.slice() };
  } finally { forced.map = {}; }
};
const OPEN = { [F.selId]: "E1", [F.dept]: "Floral", [F.exporting]: false };
const CAL = { [F.dept]: "Floral" };
const BANNER = ">Changed in the last 48 hours<";
const okBtn = (els) => els.find((x) => x.type === "button" && String(x.props.title || "").startsWith("Mark these changes as seen"));
const calMark = (html) => html.includes("Changed in the last 48 h —"); // the ChangedMark tooltip on the calendar chip
const amberDot = (html) => html.includes("w-1.5 h-1.5 rounded-full bg-amber-500");
const bellCount = (html) => { const m = /Activity log — (\d+) recent changes/.exec(html); return m ? Number(m[1]) : 0; };
const pressOk = (st, user, extra = {}, f = OPEN) => {
  const { els } = mount(props(st, { authUser: user, ...extra }), f);
  const b = okBtn(els);
  expect(b, "OK button rendered").toBeTruthy();
  b.props.onClick();
};

let lsStore;
beforeEach(() => { lsStore = {}; pdf.calls = []; vi.stubGlobal("localStorage", { getItem: (k) => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v); } }); });
afterEach(() => vi.unstubAllGlobals());

// ───────────────────────── 1. the department head presses OK ─────────────────────────
describe("1. a Floral department head presses OK", () => {
  it("before: the banner shows with the OK button, the calendar chip has the alert and the month grid dot is amber", () => {
    const st = store0([ev()]);
    const { html, els } = mount(props(st, { amendRequests: [amend()] }), OPEN);
    expect(html).toContain(BANNER);
    expect(html).toContain("✓ OK");
    expect(okBtn(els)).toBeTruthy();
    const cal = mount(props(st, { amendRequests: [amend()] }), CAL).html;
    expect(calMark(cal)).toBe(true);
    expect(amberDot(cal)).toBe(true);
  });
  it("the OK button sits in the banner's header (after the title)", () => {
    const { html } = mount(props(store0([ev()])), OPEN);
    const i = html.indexOf(BANNER);
    const j = html.indexOf("✓ OK");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(j - i).toBeLessThan(1500);
  });
  it("after OK (real onClick, setEventOrders updater applied): banner, OK button, calendar alert and amber dot are gone for that head", () => {
    const st = store0([ev()]);
    const reqs = [amend()];
    pressOk(st, floralHead, { amendRequests: reqs });
    expect(st.calls).toBe(1);
    expect(Number(st.events[0].deptOps.Floral.changesSeen.h1)).toBeGreaterThanOrEqual(NOW);
    const { html, els } = mount(props(st, { amendRequests: reqs }), OPEN);
    expect(html).not.toContain(BANNER);
    expect(okBtn(els)).toBeFalsy();
    const cal = mount(props(st, { amendRequests: reqs }), CAL).html;
    expect(calMark(cal)).toBe(false);
    expect(amberDot(cal)).toBe(false);
  });
  it("another Floral head (different seenKey) and an Admin still see the banner and the calendar alert", () => {
    const st = store0([ev()]);
    const reqs = [amend()];
    pressOk(st, floralHead, { amendRequests: reqs });
    for (const u of [floralHead2, admin]) {
      const { html } = mount(props(st, { authUser: u, amendRequests: reqs }), OPEN);
      expect(html, u.name).toContain(BANNER);
      const cal = mount(props(st, { authUser: u, amendRequests: reqs }), CAL).html;
      expect(calMark(cal), u.name).toBe(true);
    }
    // the other head still has their own OK
    expect(okBtn(mount(props(st, { authUser: floralHead2, amendRequests: reqs }), OPEN).els)).toBeTruthy();
  });
  it("a change stamped after OK shows again (a Dept Ops edit, and a new logged amend request)", () => {
    const st = store0([ev()]);
    pressOk(st, floralHead);
    expect(mount(props(st), OPEN).html).not.toContain(BANNER);
    const seenAt = st.events[0].deptOps.Floral.changesSeen.h1;
    // a later Dept Ops edit (truss) on the event
    const later = { ...st.events[0], deptOps: { Floral: { ...st.events[0].deptOps.Floral, changes: { ...st.events[0].deptOps.Floral.changes, truss: { at: seenAt + 1, by: "Ajay" } } } } };
    const html = mount(props(store0([later])), OPEN).html;
    expect(html).toContain(BANNER);
    expect(html).toContain("Truss plan updated");
    expect(html).not.toContain("Manpower plan updated"); // the one already OK'd stays seen
    // a later inventory change logged by Studio
    const html2 = mount(props(st, { amendRequests: [amend({ requestedAt: seenAt + 1 })] }), OPEN).html;
    expect(html2).toContain(BANNER);
  });
  it("the activity-log bell's count is unaffected by OK (it counts the logged amend requests, not per-person seen)", () => {
    const st = store0([ev()]);
    const reqs = [amend(), amend({ id: "A2", items: [{ name: "Chair", change: "removed", qty: 4 }], requestedAt: NOW - 3 * HOUR })];
    expect(bellCount(mount(props(st, { amendRequests: reqs }), OPEN).html)).toBe(2);
    pressOk(st, floralHead, { amendRequests: reqs });
    const html = mount(props(st, { amendRequests: reqs }), OPEN).html;
    expect(html).not.toContain(BANNER);
    expect(bellCount(html)).toBe(2);
  });
  it("only an amend request (no Dept Ops change) also gets the OK, and OK clears it", () => {
    const st = store0([ev({ deptOps: {} })]);
    const reqs = [amend()];
    expect(mount(props(st, { amendRequests: reqs }), OPEN).html).toContain(BANNER);
    pressOk(st, floralHead, { amendRequests: reqs });
    expect(mount(props(st, { amendRequests: reqs }), OPEN).html).not.toContain(BANNER);
  });
});

// ───────────────────────── 2. who does NOT get the button ─────────────────────────
describe("2. no OK button for anyone but the department's own heads", () => {
  const st = () => store0([ev()]);
  const cases = [
    ["Admin", admin],
    ["Admin who also has departments", adminWithDepts],
    ["Sales (no departments)", sales],
    ["a role without 'head' (Production, departments Floral)", production],
    ["a Fabric head looking at Floral", fabricHead],
  ];
  for (const [name, u] of cases) {
    it(`${name}: banner shown, no OK`, () => {
      const { html, els } = mount(props(st(), { authUser: u }), OPEN);
      expect(html).toContain(BANNER);
      expect(html).not.toContain("✓ OK");
      expect(okBtn(els)).toBeFalsy();
    });
  }
  it("the Site-Supervisor-view-only role (onsiteOnly, role 'PDF Viewer'): banner shown (inv / mp lines), no OK", () => {
    const { html, els } = mount(props(st(), { authUser: viewer, onsiteOnly: true }), OPEN);
    expect(html).toContain(BANNER);
    expect(okBtn(els)).toBeFalsy();
  });
  it("a multi-department head gets OK in each of their own departments (Fabric too)", () => {
    const s = store0([ev({ deptOps: { Fabric: { changes: { fabreq: { at: NOW - HOUR, by: "Aman" } } } } })]);
    const { html, els } = mount(props(s, { authUser: multiHead }), { ...OPEN, [F.dept]: "Fabric" });
    expect(html).toContain(BANNER);
    expect(okBtn(els)).toBeTruthy();
  });
  it("no changes in 48 h: no banner, no OK", () => {
    const old = store0([ev({ deptOps: { Floral: { changes: { mp: { at: NOW - 49 * HOUR, by: "x" } } } } })]);
    const { html, els } = mount(props(old), OPEN);
    expect(html).not.toContain(BANNER);
    expect(okBtn(els)).toBeFalsy();
  });
});

// ───────────────────────── 3. the PDF download no longer marks seen ─────────────────────────
describe("3. downloading the PDF (real exportPdf) writes no changesSeen", () => {
  it("every download button on the event runs exportPdf to the end (renderDeptBook ok) and setEventOrders is never called", async () => {
    const st = store0([ev()]);
    const { els } = mount(props(st), OPEN);
    const dl = els.filter((x) => x.type === "button" && typeof x.props.onClick === "function" && /exportDeptPdf\(/.test(x.props.onClick.toString()));
    expect(dl.length).toBeGreaterThan(0);
    for (const b of dl) await b.props.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(pdf.calls.length).toBeGreaterThan(0); // the book was "made" - the old code then called markChangesSeen(inThisBook)
    expect(pdf.calls.every((a) => a.view === false)).toBe(true);
    expect(st.calls).toBe(0);
    expect(st.events[0].deptOps.Floral.changesSeen).toBeUndefined();
    // and the head still sees the banner afterwards
    expect(mount(props(st), OPEN).html).toContain(BANNER);
  });
});

// ───────────────────────── 4. edges of markChangesSeen ─────────────────────────
describe("4. markChangesSeen edges", () => {
  it("writes only the department on screen - a multi-department head's other department (Fabric) is not marked; its tab dot stays", () => {
    const st = store0([ev({ deptOps: {
      Floral: { changes: { mp: { at: NOW - HOUR, by: "a" } } },
      Fabric: { changes: { fabreq: { at: NOW - HOUR, by: "b" } } },
    } })]);
    pressOk(st, multiHead);
    expect(st.events[0].deptOps.Floral.changesSeen.h3).toBeGreaterThanOrEqual(NOW);
    expect(st.events[0].deptOps.Fabric.changesSeen).toBeUndefined();
    const { html } = mount(props(st, { authUser: multiHead }), OPEN);
    expect(html).not.toContain(BANNER);
    expect(html).toContain('aria-label="Fabric changed in the last 48 hours"');
  });
  it("keeps other people's changesSeen, the `changes` stamps and everything else of the department; no updatedAt / updatedBy", () => {
    const floral = { changes: { mp: { at: NOW - HOUR, by: "a" } }, changesSeen: { h2: NOW - 5 * HOUR, someone: 123 }, mp: { x: 1 }, updatedAt: 42, updatedBy: "Old" };
    const st = store0([ev({ deptOps: { Floral: floral } }), { id: "E2", clientName: "Other", status: "confirmed", date: TODAY, deptOps: { Floral: { changes: {} } } }]);
    const e2Before = st.events[1];
    pressOk(st, floralHead);
    const after = st.events[0].deptOps.Floral;
    expect(after.changesSeen).toEqual({ h2: NOW - 5 * HOUR, someone: 123, h1: expect.any(Number) });
    expect(after.changes).toEqual(floral.changes);
    expect(after.mp).toEqual({ x: 1 });
    expect(after.updatedAt).toBe(42);
    expect(after.updatedBy).toBe("Old");
    expect(st.events[0].updatedAt).toBeUndefined();
    expect(st.events[1]).toBe(e2Before); // other events untouched (same object)
  });
  it("changesSeen is bookkeeping (NOT_A_CHANGE): a save patch carrying it would stamp no change", () => {
    expect(stampDeptChanges({}, { changesSeen: { h1: 1 } }, 5, "x")).toEqual({});
  });
  it("works when deptOps[dept] does not exist yet (only an amend request) - and when deptOps itself is missing", () => {
    const st = store0([ev({ deptOps: undefined })]);
    pressOk(st, floralHead, { amendRequests: [amend()] });
    expect(st.events[0].deptOps).toEqual({ Floral: { changesSeen: { h1: expect.any(Number) } } });
  });
  it("a head WITHOUT Planning edit permission still gets OK and it saves (it only records that they read it - by design)", () => {
    const noEdit = { roleTabs: { "Dept Head - Floral": { tabs: ["planning"], subTabs: { planning: ["deptops"] }, ved: { planning: { edit: false, del: false } } } } };
    const st = store0([ev()]);
    pressOk(st, floralHead, { settings: noEdit });
    expect(st.calls).toBe(1);
    expect(st.events[0].deptOps.Floral.changesSeen.h1).toBeGreaterThanOrEqual(NOW);
  });
  it("seenKey falls back to the name when the login has no id", () => {
    const st = store0([ev()]);
    pressOk(st, { role: "Dept Head - Floral", name: "Sudhir", departments: ["Floral"] });
    expect(st.events[0].deptOps.Floral.changesSeen.Sudhir).toBeGreaterThanOrEqual(NOW);
  });
  it("RISK (documented): a head with no id AND no name sees the OK button but pressing it does nothing (seenKey is '')", () => {
    const st = store0([ev()]);
    pressOk(st, { role: "Dept Head - Floral", departments: ["Floral"] });
    expect(st.calls).toBe(0);
  });
  it("fixed: no OK in the Site-Supervisor-view-only view (it shows only part of the changes, so it must not mark the department seen)", () => {
    const st = store0([ev({ deptOps: { Floral: { changes: { mp: { at: NOW - HOUR, by: "a" }, truss: { at: NOW - HOUR, by: "b" } } } } })]);
    const { html, els } = mount(props(st, { onsiteOnly: true }), OPEN);
    expect(html).toContain(BANNER);
    expect(okBtn(els)).toBeFalsy();
    expect(mount(props(st, { onsiteOnly: false }), OPEN).html).toContain("Truss plan updated");
  });
  it("fixed: a change stamped a few seconds AHEAD of this machine's clock (another PC's clock; the list accepts up to +60 s) stays listed after OK - the OK looks broken (DepartmentOpsTab.jsx:1185 stamps Date.now(), recentChanges.js:97/129 compare against it)", () => {
    const st = store0([ev({ deptOps: {} })]);
    const reqs = [amend({ requestedAt: Date.now() + 30000 })];
    expect(mount(props(st, { amendRequests: reqs }), OPEN).html).toContain(BANNER);
    pressOk(st, floralHead, { amendRequests: reqs });
    expect(mount(props(st, { amendRequests: reqs }), OPEN).html).not.toContain(BANNER);
  });
});

// ───────────────────────── 4b. who counts as a department head (isDeptHead, DepartmentOpsTab.jsx:1166) ─────────────────────────
describe("4b. isDeptHead recognition - real heads that get NO OK button", () => {
  const hasOk = (u) => okBtn(mount(props(store0([ev()]), { authUser: u }), OPEN).els) != null;
  it("recognised: 'Dept Head - Floral' (departments inferred from the role name, none set)", () => {
    expect(hasOk({ id: "x1", role: "Dept Head - Floral" })).toBe(true);
  });
  it("recognised: 'Flower Head' WITH departments ['Floral'] set in Users & Roles", () => {
    expect(hasOk({ id: "x2", role: "Flower Head", departments: ["Floral"] })).toBe(true);
  });
  it("NOT recognised: 'Flower Head' (a ROLES entry - the Floral head) without departments: 'flower' does not infer 'Floral' (deptClassify.js:101)", () => {
    expect(userDepartments({ role: "Flower Head" })).toBeNull();
    expect(hasOk({ id: "x3", role: "Flower Head" })).toBe(false);
  });
  it("NOT recognised: 'Dept Head - Painter' (a ROLES entry) - infers no department (Paint is not in DEPTS)", () => {
    expect(userDepartments({ role: "Dept Head - Painter" })).toBeNull();
  });
  it("NOT recognised: heads whose role says HOD / In-charge / Manager / Supervisor instead of 'head'", () => {
    for (const role of ["HOD - Floral", "Floral Incharge", "Floral Manager", "Floral Supervisor"]) expect(hasOk({ id: role, role, departments: ["Floral"] }), role).toBe(false);
  });
  it("false positive: any role containing 'head' as a substring with departments (e.g. 'Headquarters Staff') counts as a head", () => {
    expect(hasOk({ id: "x4", role: "Headquarters Staff", departments: ["Floral"] })).toBe(true);
  });
});

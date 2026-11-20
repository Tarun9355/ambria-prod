import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventChanges } from "../../lib/ims/recentChanges";

// Owner ask 2026-11-20 (commit abcefdb5): the Site-Supervisor-view-only role (onsiteOnly) sees the crew exactly as the Department
// Head does - the "Manpower plan" tile (k "mp") and its panel - instead of the separate "On-site crew" card (k "oscrew"); what the
// supervisor changes there is the same deptOps data the Department Head sees, and it is stamped into the activity log.
//
// DepartmentOpsTab is rendered FOR REAL (react-dom/server). Two test-only taps make the REAL handlers callable without a DOM:
//   - useState is wrapped so state a click would set (selId, dept, modal, logOpen ...) is forced by matching the caller's source line;
//   - the jsx runtime is wrapped to record every <input>/<button> element + its props, so a test can call the real onChange / onClick
//     (saveDept / writeDept / setMpDay ... -> setEventOrders updater) and apply the updater to the event list.
// useEffect is replaced by a recorder (SSR never runs effects) so the mpSeen bookkeeping effect can be run by hand.
const SRC = readFileSync(resolve(__dirname, "DepartmentOpsTab.jsx"), "utf8");
const SRC_LINES = SRC.split("\n");
const forced = { map: {} };
const rec = { els: [], effects: [] };
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
    useEffect: (fn, deps) => { if (srcLineOfCaller() != null) rec.effects.push({ fn, deps }); },
  };
});
vi.mock("react/jsx-dev-runtime", async (orig) => {
  const a = await orig();
  const wrap = (name) => (type, props, ...rest) => { if (type === "input" || type === "button") rec.els.push({ type, props }); return a[name](type, props, ...rest); };
  return { ...a, jsxDEV: wrap("jsxDEV") };
});
vi.mock("react/jsx-runtime", async (orig) => {
  const a = await orig();
  const wrap = (name) => (type, props, ...rest) => { if (type === "input" || type === "button") rec.els.push({ type, props }); return a[name](type, props, ...rest); };
  return { ...a, jsx: wrap("jsx"), jsxs: wrap("jsxs") };
});
vi.mock("./PlanningSyncButton.jsx", () => ({ default: () => h("span", { "data-sync": "1" }, "SYNC-BUTTON") }));

import DepartmentOpsTab from "./DepartmentOpsTab.jsx";

const F = {
  selId: "const [selId, setSelId]",
  modal: "const [modal, setModal]",
  dept: "const [dept, setDept]",
  opsView: "const [opsViewRaw, setOpsView]",
  logOpen: "const [logOpen, setLogOpen]",
};
const pad = (n) => String(n).padStart(2, "0");
const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const FUT = iso(Date.now() + 3 * 86400000); // an event still ahead: its actuals are not locked
const PAST = iso(Date.now() - 20 * 86400000); // an old event: actuals auto-locked

const me = { id: "u1", role: "PDF Viewer", name: "Raja", phone: "+91 9810011111" };
const withManpower = { ...me, permissions: ["events_manpower"] };
const admin = { id: "u_admin", role: "Admin", name: "Tarun" };
const noEditSettings = { roleTabs: { "PDF Viewer": { tabs: ["planning"], subTabs: { planning: ["deptops_onsite"] }, ved: { planning: { edit: false, del: false } } } } };
const dihariSettings = { dihariSchemes: { Labours: { rate: 500, windows: [{ id: "w1", label: "9 AM - 6 PM" }, { id: "w2", label: "6 PM - 2 AM" }] } } };
const roster = [{ id: "S1", name: "Raja", phone: "98100 11111", active: true }];

// Floral crew: Flowerists = plain head-count row (no schedule), Labours = a day-wise row (schedule, not shared)
const crewEvent = (extra = {}, date = FUT) => ({
  id: "E1", clientName: "MineWedding", status: "confirmed", date, siteSupervisorId: "S1",
  functionsDetail: [{ date, venue: "Hall", type: "Wedding", shift: "evening" }],
  manpowerDetail: {
    Floral: [
      { type: "Flowerists", count: 3, rate: 600, cost: 1800, shared: false, schedule: null },
      { type: "Labours", count: 4, rate: 500, cost: 2000, shared: false, schedule: [{ date, phase: "event", count: 4, windows: 1, windowIds: ["w1"] }] },
    ],
  },
  deptOps: {},
  ...extra,
});
const store0 = (events) => { const st = { events, calls: 0 }; st.set = (u) => { st.calls += 1; st.events = typeof u === "function" ? u(st.events) : u; }; return st; };
const props = (st, o = {}) => ({ onsiteOnly: true, eventOrders: st.events, setEventOrders: st.set, authUser: me, settings: dihariSettings, supervisors: roster, inventory: [], functions: [], blocks: [], ...o });
const mount = (p, f = {}) => {
  rec.els = []; rec.effects = []; forced.map = f;
  try {
    const html = renderToString(h(DepartmentOpsTab, p)).replace(/<!-- -->/g, "");
    return { html, els: rec.els.slice(), effects: rec.effects.slice() };
  } finally { forced.map = {}; }
};
const FSEL = { [F.selId]: "E1", [F.dept]: "Floral" };
const wrapStates = (html) => (html.match(/<div data-ops-panel[^>]*>/g) || []).map((w) => w.includes("fixed inset-0"));
const tileTitles = (html) => [...html.matchAll(/font-semibold text-gray-900 leading-snug">([^<]+)</g)].map((m) => m[1]);
const e = (v) => ({ target: { value: v }, preventDefault() {}, stopPropagation() {} });
const cls = (x) => String(x.props.className || "");
const find = (els, type, pred) => els.find((x) => x.type === type && pred(x));
const qtyInput = (els) => find(els, "input", (x) => cls(x).includes("w-16 rounded-lg px-2 py-1.5"));
const flowRate = (els) => find(els, "input", (x) => cls(x).includes("w-24 rounded-lg ring-1"));
const labRate = (els) => find(els, "input", (x) => cls(x).includes("w-20 rounded-lg px-2 py-1.5"));
const dayInput = (els) => find(els, "input", (x) => /Manage Manpower|Crew this day|locked/.test(String(x.props.title || "")));
const osPeople = (els) => find(els, "input", (x) => cls(x).includes("w-12 bg-transparent"));
const addCrew = (els) => find(els, "button", (x) => cls(x).includes("border-dashed"));
const shiftInput = (els) => find(els, "input", (x) => cls(x).includes("w-11 rounded bg-white ring-1"));
const resetDay = (els) => find(els, "button", (x) => String(x.props.title || "").startsWith("Undo this day's hand edits"));
// the Manpower plan block (its header strip -> the Actuals header) and whether its wrapper is the visible (un-"hidden") one
const blockOf = (html, headerMarker, endMarker) => {
  const i = html.indexOf(headerMarker);
  if (i < 0) return null;
  const w = html.lastIndexOf("overflow-hidden", i);
  const j = endMarker ? html.indexOf(endMarker, i) : -1;
  return { visible: !html.slice(w, w + 30).startsWith("overflow-hidden hidden"), body: html.slice(i, j > 0 ? j : i + 6000) };
};
const mpBlock = (html) => blockOf(html, 'font-semibold text-gray-900 truncate">Manpower plan<', 'text-[15px] font-semibold text-gray-900">Actuals<');
const osBlock = (html) => blockOf(html, 'text-[15px] font-semibold text-gray-900">On-site crew<', null);

let store;
beforeEach(() => { store = {}; vi.stubGlobal("localStorage", { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }); });
afterEach(() => vi.unstubAllGlobals());

// ───────────────────────── 1. what the role sees ─────────────────────────
describe("1. role (onsiteOnly) with a crew: the Manpower plan tile + panel replace the On-site crew card", () => {
  const st = () => store0([crewEvent()]);
  it("tiles: Inventory blocked, Manpower plan (crew lines + a rupee figure), Dismantle & routing - no On-site crew, no Actuals/Truck/Carpet/Truss/Fabric/Dismantle plan", () => {
    const { html } = mount(props(st()), FSEL);
    const t = tileTitles(html);
    expect(t).toContain("Inventory blocked");
    expect(t).toContain("Manpower plan");
    expect(t).toContain("Dismantle &amp; routing");
    for (const bad of ["On-site crew", "Actuals", "Truck planning", "Carpet plan", "Truss plan", "Fabric plan", "Dismantle plan"]) expect(t).not.toContain(bad);
    const tile = /leading-snug">Manpower plan<[^]*?<\/button>/.exec(html)[0];
    expect(tile).toContain("2 crew lines");
    expect(tile).toMatch(/tabular-nums tracking-tight">₹/);
  });
  it("tile order: planning block (Inventory, Manpower) then the on-site block (Dismantle & routing)", () => {
    const html = mount(props(st()), FSEL).html;
    const a = html.indexOf('leading-snug">Inventory blocked<'), b = html.indexOf('leading-snug">Manpower plan<'), c = html.indexOf('leading-snug">Dismantle &amp; routing<');
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
  it("modal 'mp': the planning panel (#1) opens, the on-site panel (#2) does not; the Manpower plan block is the visible one and holds the crew rows and inputs", () => {
    const { html } = mount(props(st()), { ...FSEL, [F.modal]: "mp" });
    expect(wrapStates(html)).toEqual([true, false]);
    const b = mpBlock(html);
    expect(b.visible).toBe(true);
    expect(b.body).toContain("Flowerists");
    expect(b.body).toContain("Labours");
    expect(b.body).toContain("Add crew type");
    expect(b.body).toContain("Whole event");
    expect((b.body.match(/<input type="number"/g) || []).length).toBeGreaterThanOrEqual(4); // qty, 2 x rate, a day box
    expect(osBlock(html).visible).toBe(false); // the old card is never the open one
  });
  it("modal 'oscrew' opens nothing for the role (both wrappers hidden, the Manpower block hidden, the On-site crew card hidden)", () => {
    const { html } = mount(props(st()), { ...FSEL, [F.modal]: "oscrew" });
    expect(wrapStates(html)).toEqual([false, false]);
    expect(mpBlock(html).visible).toBe(false);
    expect(tileTitles(html)).not.toContain("On-site crew");
  });
  it("opening Manpower plan shows no other planning block (Actuals / Truck / Inventory stay hidden)", () => {
    const { html } = mount(props(st()), { ...FSEL, [F.modal]: "mp" });
    expect(blockOf(html, 'text-[15px] font-semibold text-gray-900">Actuals<', null).visible).toBe(false);
  });
  it("a Furniture event (no crew types of its own): the role still gets the tile ('no crew assigned') and a panel that says so; still no On-site crew", () => {
    const { html } = mount(props(st()), { [F.selId]: "E1", [F.dept]: "Furniture", [F.modal]: "mp" });
    expect(tileTitles(html)).toContain("Manpower plan");
    expect(html).toContain("no crew assigned");
    expect(html).toContain("No crew assigned to Furniture");
    expect(wrapStates(html)).toEqual([true, false]);
    expect(tileTitles(html)).not.toContain("On-site crew");
  });
  it("no income / net / production requests / fixed-venue / changes banner / Paint anywhere for the role", () => {
    const html = mount(props(store0([crewEvent({ deptIncome: { Floral: { total: 987654 } }, deptOps: { Floral: { changes: { mp: { at: Date.now() - 60000, by: "Anmol" } } } } })])), FSEL).html;
    for (const t of ["Total income", "Fixed at venue", "Production requests", "987,654", "9,87,654"]) expect(html).not.toContain(t);
    expect(html).not.toContain(">Paint<");
  });
  it("the Manpower panel carries no link to another tile (no setModal call between the Manpower plan block and the Actuals block)", () => {
    const a = SRC.indexOf("{/* Manpower plan (editable / override) */}");
    const z = SRC.indexOf("{/* Actuals → exact cost */}");
    expect(a).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(a);
    expect(SRC.slice(a, z)).not.toMatch(/setModal\(|setOpsView\(|setDept\(|goToChange\(/);
  });
});

describe("1b. everyone else is unchanged", () => {
  const st = () => store0([crewEvent()]);
  it("Department Head view (admin): Manpower plan tile + panel exactly as before; no On-site crew tile in that view", () => {
    const { html } = mount(props(st(), { onsiteOnly: false, authUser: admin }), { ...FSEL, [F.modal]: "mp" });
    expect(tileTitles(html)).toContain("Manpower plan");
    expect(tileTitles(html)).toContain("Actuals");
    expect(tileTitles(html)).not.toContain("On-site crew");
    expect(wrapStates(html)[0]).toBe(true);
    expect(mpBlock(html).visible).toBe(true);
    expect(html).toContain("One PDF with all");
    expect(html).toContain("SYNC-BUTTON");
  });
  it("Site Supervisor view (admin): the On-site crew tile is there and 'oscrew' opens the on-site panel with the card", () => {
    const { html } = mount(props(st(), { onsiteOnly: false, authUser: admin }), { ...FSEL, [F.opsView]: "onsite", [F.modal]: "oscrew" });
    expect(tileTitles(html)).toContain("On-site crew");
    expect(tileTitles(html)).not.toContain("Manpower plan");
    expect(wrapStates(html)).toEqual([true]); // only the on-site panel exists in that view, and it is open
    expect(osBlock(html).visible).toBe(true);
    expect(osBlock(html).body).toContain("Flowerists");
  });
  it("a Department Head with Planning edit but no Site-Supervisor-only sub-tab (any non-role) keeps the full tile set", () => {
    const { html } = mount(props(st(), { onsiteOnly: false, authUser: { ...me, role: "Floral Head", departments: ["Floral"] } }), FSEL);
    for (const t of ["Inventory blocked", "Manpower plan", "Actuals", "Truck planning"]) expect(tileTitles(html)).toContain(t);
  });
});

// ───────────────────────── 4. gating ─────────────────────────
describe("4. gating of the Manpower plan panel for the role", () => {
  it("default role (Planning edit on by default, no events_manpower): count + rate inputs live, the day-wise box disabled with a 'Manage Manpower' hint", () => {
    const { els, html } = mount(props(store0([crewEvent()])), { ...FSEL, [F.modal]: "mp" });
    expect(qtyInput(els).props.disabled).toBeFalsy();
    expect(flowRate(els).props.disabled).toBeFalsy();
    expect(labRate(els).props.disabled).toBeFalsy();
    expect(dayInput(els).props.disabled).toBe(true);
    expect(html).toContain("Requires &quot;Manage Manpower&quot;");
  });
  it("with events_manpower the day-wise box is enabled", () => {
    const { els } = mount(props(store0([crewEvent()]), { authUser: withManpower }), { ...FSEL, [F.modal]: "mp" });
    expect(dayInput(els).props.disabled).toBeFalsy();
  });
  it("a locked event (actuals auto-lock): every crew box is disabled through the fieldset / its own flag", () => {
    const { html, els } = mount(props(store0([crewEvent({}, PAST)]), { authUser: withManpower }), { ...FSEL, [F.modal]: "mp" });
    expect(dayInput(els).props.disabled).toBe(true);
    expect(mpBlock(html).body.split("Add crew type")[0]).not.toBe(null);
    expect(html).toMatch(/<fieldset disabled="" class="contents">/);
  });
  it("Planning edit OFF and no events_manpower (view-only): every write is dropped (qty, rate, day, reset, add)", () => {
    const st = store0([crewEvent({ deptOps: { Floral: { mpDay: { Labours: { [FUT]: 6 } } } } })]);
    const { els } = mount(props(st, { settings: { ...dihariSettings, ...noEditSettings } }), { ...FSEL, [F.modal]: "mp" });
    qtyInput(els).props.onChange(e("9"));
    flowRate(els).props.onChange(e("700"));
    labRate(els).props.onChange(e("700"));
    dayInput(els).props.onChange(e("9"));
    resetDay(els).props.onClick();
    addCrew(els).props.onClick();
    expect(st.calls).toBe(0);
  });
  it("Planning edit OFF but events_manpower ON: only the day-wise paths (setMpDay / resetMpDay) write; count/rate/add are dropped", () => {
    const st = store0([crewEvent({ deptOps: { Floral: { mpDay: { Labours: { [FUT]: 6 } } } } })]);
    const { els } = mount(props(st, { settings: { ...dihariSettings, ...noEditSettings }, authUser: withManpower }), { ...FSEL, [F.modal]: "mp" });
    qtyInput(els).props.onChange(e("9"));
    flowRate(els).props.onChange(e("700"));
    addCrew(els).props.onClick();
    expect(st.calls).toBe(0);
    dayInput(els).props.onChange(e("9"));
    expect(st.calls).toBe(1);
    expect(st.events[0].deptOps.Floral.mpDay.Labours[FUT]).toBe("9");
    resetDay(els).props.onClick();
    expect(st.calls).toBe(2);
    expect(st.events[0].deptOps.Floral.mpDay.Labours?.[FUT]).toBeUndefined();
  });
  it("BUG: with Planning edit OFF the Manpower plan count / rate boxes should be disabled (owner expectation: view-only = inputs disabled); today they look live and the typed value silently snaps back because saveDept drops the write", () => {
    // DepartmentOpsTab.jsx: the Manpower plan's <fieldset> is `disabled={lock.locked}` only (the `|| !canEditPlanning` guard is on the ACTUALS fieldset)
    const { els, html } = mount(props(store0([crewEvent()]), { settings: { ...dihariSettings, ...noEditSettings } }), { ...FSEL, [F.modal]: "mp" });
    expect(html).toContain("View only"); // the page itself already says it is view-only (Site Supervisor select)
    expect(qtyInput(els).props.disabled).toBe(true);
    expect(flowRate(els).props.disabled).toBe(true);
    expect(labRate(els).props.disabled).toBe(true);
    expect(addCrew(els).props.disabled).toBe(true);
  });
  it("BUG: with Planning edit OFF the per-shift ('dihari') crew boxes are live too (their write goes through saveDept and is dropped)", () => {
    const { els } = mount(props(store0([crewEvent()]), { settings: { ...dihariSettings, ...noEditSettings }, authUser: withManpower }), { ...FSEL, [F.modal]: "mp" });
    expect(shiftInput(els)).toBeTruthy();
    expect(shiftInput(els).props.disabled).toBe(true);
  });
  it("the per-shift box needs Planning edit (saveDept), NOT events_manpower - unlike the day box beside it (inconsistent gating, documented)", () => {
    const st = store0([crewEvent()]);
    const { els } = mount(props(st), { ...FSEL, [F.modal]: "mp" }); // no events_manpower, Planning edit on
    expect(dayInput(els).props.disabled).toBe(true);
    shiftInput(els).props.onChange(e("2"));
    expect(st.calls).toBe(1);
    expect(st.events[0].deptOps.Floral.mpWinCount.Labours[FUT].w1).toBe(2);
    expect(st.events[0].deptOps.Floral.changes.mp.by).toBe("Raja");
  });
  it("contrast: the ACTUALS fieldset is disabled for that same view-only role (so the missing guard on the Manpower fieldset is an omission, not a pattern)", () => {
    const { html } = mount(props(store0([crewEvent()]), { settings: { ...dihariSettings, ...noEditSettings } }), { ...FSEL, [F.modal]: "actuals" });
    const i = html.indexOf('text-[15px] font-semibold text-gray-900">Actuals<');
    expect(html.slice(i, i + 4000)).toMatch(/<fieldset disabled="" class="contents">/);
  });
  it("source: saveDept needs Planning edit, setMpDay / resetMpDay need events_manpower and call writeDept directly", () => {
    expect(SRC).toMatch(/const saveDept = \(patch\) => \{ if \(!canEditPlanning\) return; writeDept\(patch\); \};/);
    expect(SRC).toMatch(/const setMpDay = \(type, date, val\) => \{ if \(!canManpower\) return; writeDept\(mpDayPatch/);
    expect(SRC).toMatch(/const resetMpDay = \(type, date\) => \{ if \(!canManpower\) return; writeDept\(resetMpDayPatch/);
    expect(SRC).toMatch(/const canManpower = hasIMSPerm\(authUser, "events_manpower"\);/);
    expect(SRC).toMatch(/const canEditPlanning = hasTabPerm\(authUser, settings, "ims", "planning", "edit"\);/);
  });
});

// ───────────────────────── 2 + 3. real handlers: shared data + activity-log stamp ─────────────────────────
describe("2/3. the supervisor's edits in the Manpower plan panel are the Department Head's data, and are stamped", () => {
  const NOW = Date.now();
  const run = (user, mutate, events = [crewEvent()], settings = dihariSettings) => {
    const st = store0(events);
    const { els } = mount(props(st, { authUser: user, settings }), { ...FSEL, [F.modal]: "mp" });
    mutate(els);
    return st;
  };
  const dh = (st, f = {}, o = {}) => mount(props(st, { onsiteOnly: false, authUser: admin, ...o }), { ...FSEL, ...f });

  it("qty edit -> deptOps.Floral.mpOverrides.Flowerists.count, updatedBy, changes.mp stamped with the editor; other sections / departments untouched", () => {
    const st = run(me, (els) => qtyInput(els).props.onChange(e("5")));
    const d = st.events[0].deptOps;
    expect(Number(d.Floral.mpOverrides.Flowerists.count)).toBe(5);
    expect(d.Floral.updatedBy).toBe("Raja");
    expect(d.Floral.changes.mp.by).toBe("Raja");
    expect(Math.abs(d.Floral.changes.mp.at - NOW)).toBeLessThan(60000);
    expect(Object.keys(d.Floral.changes)).toEqual(["mp"]);
    expect(Object.keys(d)).toEqual(["Floral"]);
  });
  it("the Department Head's view of the same event then shows the supervisor's number, and the supervisor's own view still does", () => {
    const st = run(me, (els) => qtyInput(els).props.onChange(e("5")));
    expect(qtyInput(dh(st, { [F.modal]: "mp" }).els).props.value).toBe("5");
    expect(qtyInput(mount(props(st), { ...FSEL, [F.modal]: "mp" }).els).props.value).toBe("5");
    // cost agrees in both views (1800 * 5/3 * 1 = 3000, + Labours 2000)
    const tile = (html) => /leading-snug">Manpower plan<[^]*?<\/button>/.exec(html)[0].match(/tracking-tight">([^<]+)</)[1];
    expect(tile(dh(st).html)).toBe(tile(mount(props(st), FSEL).html));
    expect(tile(dh(st).html)).toBe("₹5,000");
  });
  it("and the other way: the Department Head's edit shows in the supervisor's panel", () => {
    const st = store0([crewEvent()]);
    const dhm = mount(props(st, { onsiteOnly: false, authUser: admin }), { ...FSEL, [F.modal]: "mp" });
    flowRate(dhm.els).props.onChange(e("750"));
    expect(flowRate(mount(props(st), { ...FSEL, [F.modal]: "mp" }).els).props.value).toBe("750");
    expect(st.events[0].deptOps.Floral.changes.mp.by).toBe("Tarun");
  });
  it("the old On-site crew card (non-role, on-site view) writes the SAME field: its People edit shows in the role's Manpower panel, and vice versa", () => {
    const st = store0([crewEvent()]);
    const os = mount(props(st, { onsiteOnly: false, authUser: admin }), { ...FSEL, [F.opsView]: "onsite", [F.modal]: "oscrew" });
    osPeople(os.els).props.onChange(e("8"));
    expect(st.events[0].deptOps.Floral.mpOverrides.Flowerists.count).toBe(8);
    expect(st.events[0].deptOps.Floral.changes.mp.by).toBe("Tarun"); // stamped as the Manpower plan, not a separate 'oscrew' section
    expect(Number(qtyInput(mount(props(st), { ...FSEL, [F.modal]: "mp" }).els).props.value)).toBe(8);
    qtyInput(mount(props(st), { ...FSEL, [F.modal]: "mp" }).els).props.onChange(e("6"));
    const os2 = mount(props(st, { onsiteOnly: false, authUser: admin }), { ...FSEL, [F.opsView]: "onsite", [F.modal]: "oscrew" });
    expect(osPeople(os2.els).props.value).toBe(6);
    expect(st.events[0].deptOps.Floral.changes.oscrew).toBeUndefined();
  });
  it("rate edit (both rows), '+ Add crew type', day box and ↺ reset each stamp changes.mp with the editor's name", () => {
    const paths = {
      flowRate: (els) => flowRate(els).props.onChange(e("650")),
      labRate: (els) => labRate(els).props.onChange(e("650")),
      add: (els) => addCrew(els).props.onClick(),
    };
    for (const [name, fn] of Object.entries(paths)) {
      const st = run(me, fn);
      expect(st.calls, name).toBe(1);
      expect(st.events[0].deptOps.Floral.changes.mp.by, name).toBe("Raja");
    }
    const stDay = run(withManpower, (els) => dayInput(els).props.onChange(e("7")));
    expect(stDay.events[0].deptOps.Floral.mpDay.Labours[FUT]).toBe("7");
    expect(stDay.events[0].deptOps.Floral.changes.mp.by).toBe("Raja");
    expect(stDay.events[0].deptOps.Floral.updatedBy).toBe("Raja");
    const stReset = run(withManpower, (els) => resetDay(els).props.onClick(), [crewEvent({ deptOps: { Floral: { mpDay: { Labours: { [FUT]: 6 } } } } })]);
    expect(stReset.events[0].deptOps.Floral.changes.mp.by).toBe("Raja");
  });
  it("a supervisor edit appears in eventChanges for that department within 48 h, by the editor, as 'Manpower plan'", () => {
    const st = run(me, (els) => qtyInput(els).props.onChange(e("5")));
    const list = eventChanges(st.events[0], [], Date.now());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ dept: "Floral", section: "mp", label: "Manpower plan", by: "Raja" });
    expect(eventChanges(st.events[0], [], Date.now() + 49 * 3600000)).toEqual([]);
  });
  it("an edit made while the actuals are locked is dropped by the lock (writeDept only blocks Actuals keys, so the Manpower edit passes - documents which)", () => {
    // patchTouchesActuals is about actuals keys; the Manpower fieldset is disabled by the lock in the UI, the handler itself is not
    const st = run(withManpower, (els) => dayInput(els).props.onChange(e("7")), [crewEvent({}, PAST)]);
    expect(st.calls).toBe(1); // handler-level: only the UI (disabled fieldset) stops it on a locked event - same as for the Department Head
  });
});

// ───────────────────────── 3. bell / activity log / banner ─────────────────────────
describe("3. activity log for the role", () => {
  const recent = (by = "Anmol") => crewEvent({ deptOps: { Floral: { changes: { mp: { at: Date.now() - 5 * 60000, by } } } } });
  it("the Manpower plan tile carries the '⚠ Updated' mark with who/when in its tooltip; the 48-hour list shows the same edit", () => {
    const html = mount(props(store0([recent()])), FSEL).html;
    const tile = /leading-snug">Manpower plan<[^]*?<\/button>/.exec(html)[0];
    expect(tile).toContain("⚠ Updated 5 min ago");
    expect(tile).toContain("Manpower plan · Anmol · 5 min ago");
    expect(html).toContain("Changed in the last 48 hours");
    expect(html).toContain("Manpower plan updated");
  });
  it("control: the Department Head (admin) sees the 48-hour banner with the Manpower plan line, the editor and a clickable entry", () => {
    const html = mount(props(store0([recent()]), { onsiteOnly: false, authUser: admin }), FSEL).html;
    expect(html).toContain("Changed in the last 48 hours");
    expect(html).toContain("Manpower plan updated");
    expect(html).toContain("Anmol");
    expect(html).toContain('title="Open Manpower plan"');
  });
  it("for the role the list holds only Manpower plan / Inventory blocked entries (a line opens a block the role has); other blocks' entries are not listed, so goToChange can never open a hidden panel", () => {
    const mixed = crewEvent({ deptOps: { Floral: { changes: {
      mp: { at: Date.now() - 5 * 60000, by: "Anmol" }, truck: { at: Date.now() - 4 * 60000, by: "Anmol" },
      carpet: { at: Date.now() - 3 * 60000, by: "Anmol" }, actuals: { at: Date.now() - 2 * 60000, by: "Anmol" }, truss: { at: Date.now() - 60000, by: "Anmol" } } } } });
    const html = mount(props(store0([mixed])), FSEL).html;
    expect(html).toContain('title="Open Manpower plan"');
    for (const t of ["Truck planning", "Carpet plan", "Actuals", "Truss plan"]) {
      expect(html).not.toContain(`${t} updated`);
      expect(html).not.toContain(`title="Open ${t}"`);
    }
    // control: the Department Head sees every one of them
    const head = mount(props(store0([mixed]), { onsiteOnly: false, authUser: admin }), FSEL).html;
    for (const t of ["Truck planning", "Carpet plan", "Actuals", "Truss plan"]) expect(head).toContain(`${t} updated`);
    expect(SRC).toContain('const list = deptChangesOf(sel.id).filter((c) => !onsiteOnly || c.section === "inv" || c.section === "mp");');
  });
  it("the bell + Activity log dialog still render for the role (Studio inventory logs for the department)", () => {
    const amend = [{ id: "A1", eventOrderId: "E1", department: "Floral", status: "logged", requestedAt: Date.now() - 60000, requestedBy: "Sales", items: [{ name: "Rose Vase", change: "added", qty: 2 }] }];
    const closed = mount(props(store0([crewEvent()]), { amendRequests: amend }), FSEL).html;
    expect(closed).toContain("Activity log — 1 recent changes");
    const open = mount(props(store0([crewEvent()]), { amendRequests: amend }), { ...FSEL, [F.logOpen]: true }).html;
    expect(open).toContain('role="dialog"');
    expect(open).toContain("Rose Vase");
  });
  it("a crew edit by someone else shows in the role's changes list, with who changed it", () => {
    const html = mount(props(store0([recent("Anmol")])), FSEL).html;
    expect(html).toContain("Changed in the last 48 hours");
    expect(html).toContain("Manpower plan updated");
    expect(html).toContain("Anmol");
  });
});

// ───────────────────────── 4b. mpSeen bookkeeping ─────────────────────────
describe("4b. mpSeen bookkeeping effect (runs when the Manpower plan is opened)", () => {
  const stale = () => crewEvent({ deptOps: { Floral: { mpSeen: { sig: "stale", cost: 1000, items: {}, at: 1 }, updatedBy: "Sunil", updatedAt: 111, changes: { mp: { at: 222, by: "Sunil" } } } } });
  const seenEffect = (effects) => effects.find((x) => String(x.fn).includes("setMpNote(null)"));
  const alertOn = (html) => html.includes("Changed since you last looked");
  it("the tile is red for a stale signature (role and Department Head alike)", () => {
    expect(alertOn(mount(props(store0([stale()])), FSEL).html)).toBe(true);
    expect(alertOn(mount(props(store0([stale()]), { onsiteOnly: false, authUser: admin }), FSEL).html)).toBe(true);
  });
  it("for the role, opening the panel writes nothing at all (mpSeen is ONE value per department - their looking must not clear the Department Head's alert)", () => {
    const st = store0([stale()]);
    const { effects } = mount(props(st, { settings: { ...dihariSettings, ...noEditSettings } }), { ...FSEL, [F.modal]: "mp" });
    try { seenEffect(effects).fn(); } catch { /* the setMpNote setter outside a render */ }
    expect(st.calls).toBe(0);
  });
  it("for the Department Head, opening the panel writes ONLY mpSeen: no changes stamp, no updatedAt / updatedBy of the viewer", () => {
    const st = store0([stale()]);
    const { effects } = mount(props(st, { onsiteOnly: false, authUser: admin, settings: { ...dihariSettings, ...noEditSettings } }), { ...FSEL, [F.modal]: "mp" });
    try { seenEffect(effects).fn(); } catch { /* the setMpNote setter outside a render */ }
    expect(st.calls).toBe(1);
    const d = st.events[0].deptOps.Floral;
    expect(d.mpSeen.sig).not.toBe("stale");
    expect(d.updatedBy).toBe("Sunil");
    expect(d.updatedAt).toBe(111);
    expect(d.changes).toEqual({ mp: { at: 222, by: "Sunil" } });
  });
  it("the effect does nothing while another panel is open (modal !== 'mp')", () => {
    const st = store0([stale()]);
    const { effects } = mount(props(st), { ...FSEL, [F.modal]: "inv" });
    seenEffect(effects).fn();
    expect(st.calls).toBe(0);
  });
  it("BUG: mpSeen is ONE value per department on the event, not per person - the supervisor opening the Manpower plan clears the Department Head's red '⚠ Changed since you last looked' alert before the Department Head ever saw it (before abcefdb5 the supervisor never opened this panel)", () => {
    const st = store0([stale()]);
    const { effects } = mount(props(st), { ...FSEL, [F.modal]: "mp" });
    try { seenEffect(effects).fn(); } catch { /* setter */ }
    const headView = mount(props(st, { onsiteOnly: false, authUser: admin }), FSEL).html;
    expect(alertOn(headView)).toBe(true); // the Department Head should still be warned
  });
});

// ───────────────────────── 5. regression hunt ─────────────────────────
describe("5. regression hunt", () => {
  it("BUG: the 'Fabric shortfalls' header button is not gated for the role, but the planning panel it opens ('fabshort') is hidden for the role - a dead button (and on a phone the body scroll is locked behind nothing)", () => {
    const fab = crewEvent({ fabricPlan: { liza: [{ colour: "Red", qty: 50 }] } });
    const view = (modal) => mount(props(store0([fab])), { [F.selId]: "E1", [F.dept]: "Fabric", ...(modal ? { [F.modal]: modal } : {}) }).html;
    // the role never gets a control that opens a hidden panel: no Fabric shortfalls button at all
    expect(view(null).includes("Fabric shortfalls ·")).toBe(false);
    expect(view("fabshort").includes("Fabric shortfalls ·")).toBe(false);
    expect(wrapStates(view("fabshort"))).toEqual([false, false]);
  });
  it("Paint is not offered to the role, and the Manpower plan tile also exists in every offered department", () => {
    for (const d of ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric"]) {
      const { html } = mount(props(store0([crewEvent()])), { [F.selId]: "E1", [F.dept]: d });
      expect(tileTitles(html), d).toContain("Manpower plan");
      expect(tileTitles(html), d).not.toContain("On-site crew");
    }
  });
  it("the Manpower panel still names an 'income card' the role cannot see (cosmetic): 'Sum matches the income card.'", () => {
    const { html } = mount(props(store0([crewEvent()])), { ...FSEL, [F.modal]: "mp" });
    expect(mpBlock(html).body).toContain("Sum matches the income card.");
    expect(html).not.toContain("Total income");
  });
  it("the Whole-event panel (👥) inside the Manpower plan shows every department's crew cost to the role (same as the Department Head - documented, it is money beyond the role's own department)", () => {
    const html = mount(props(store0([crewEvent()])), { ...FSEL, [F.modal]: "mp", "const [mpEventOpen, setMpEventOpen]": true }).html;
    expect(html).toContain("Whole event manpower");
    expect(html).toContain("all departments");
  });
  it("render does not throw for a null / missing authUser, an event with no manpowerDetail, or events without functionsDetail (hooks order stays stable across modal values)", () => {
    for (const m of [null, "inv", "mp", "oscrew", "rcv", "route", "actuals"]) {
      const bare = { id: "E1", clientName: "Bare", status: "confirmed", date: FUT, siteSupervisorId: "S1" };
      expect(() => mount(props(store0([bare])), { ...FSEL, [F.modal]: m })).not.toThrow();
      expect(() => mount(props(store0([crewEvent()]), { authUser: null }), { ...FSEL, [F.modal]: m })).not.toThrow();
    }
  });
});

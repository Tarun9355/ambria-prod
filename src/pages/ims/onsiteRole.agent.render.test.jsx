import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// DepartmentOpsTab, rendered FOR REAL (react-dom/server, no stub of the tab itself) for the "Site Supervisor view only" role
// (onsiteOnly) and for everyone else. State that only a click could set (myOnly, selId, modal, pickDay, exporting, dept,
// floralPdfWanted) is forced by wrapping useState and matching the caller's SOURCE line (stack traces are source-mapped),
// so the forced hooks keep working when lines move.
const SRC = readFileSync(resolve(__dirname, "DepartmentOpsTab.jsx"), "utf8");
const SRC_LINES = SRC.split("\n");
const forced = { map: {} };
vi.mock("react", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useState: (init) => {
      const fr = Object.keys(forced.map);
      if (fr.length) {
        const frame = new Error().stack.split("\n").find((l) => l.includes("DepartmentOpsTab.jsx"));
        const m = frame && /DepartmentOpsTab\.jsx:(\d+):/.exec(frame);
        if (m) {
          const text = SRC_LINES[Number(m[1]) - 1] || "";
          const key = fr.find((k) => text.includes(k));
          if (key) return [forced.map[key], () => {}];
        }
      }
      return actual.useState(init);
    },
  };
});
// a visible marker so "no Sync" is assertable (the real one renders nothing unless the plan is stale)
vi.mock("./PlanningSyncButton.jsx", () => ({ default: () => h("span", { "data-sync": "1" }, "SYNC-BUTTON") }));

import DepartmentOpsTab from "./DepartmentOpsTab.jsx";

const F = {
  myOnly: "const [myOnly, setMyOnly]",
  selId: "const [selId, setSelId]",
  modal: "const [modal, setModal]",
  pickDay: "const [pickDay, setPickDay]",
  exporting: "const [exporting, setExporting]",
  dept: "const [dept, setDept]",
  floral: "const [floralPdfWanted, setFloralPdfWanted]",
};
const mm = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const PANEL_WRAP = /const PANEL_WRAP = "([^"]+)"/.exec(SRC)[1];

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const day = (d) => `${ym}-${pad(d)}`;
const ev = (id, clientName, d, extra = {}) => ({ id, clientName, status: "confirmed", date: day(d), functionsDetail: [{ date: day(d), venue: "Hall" }], ...extra });

const roster = [
  { id: "S1", name: "Raja", phone: "98100 11111", active: true },
  { id: "S2", name: "Sunil Kumar", phone: "9810022222", active: true },
];
const me = { id: "u1", role: "PDF Viewer", name: "Raja", phone: "+91 9810011111" };
const events = [
  ev("E1", "MineWedding", 3, { siteSupervisorId: "S1" }),
  ev("E2", "SunilsParty", 4, { siteSupervisorId: "S2" }),
  ev("E3", "NobodyGala", 5),
  ev("E4", "RemovedSupMine", 6, { siteSupervisorId: "S9", siteSupervisorName: "raja", siteSupervisorPhone: "9810011111" }),
];

const base = (o = {}) => ({ onsiteOnly: true, eventOrders: events, setEventOrders() {}, authUser: me, settings: {}, supervisors: roster, inventory: [], functions: [], blocks: [], ...o });
const render = (props, f = {}) => {
  // "Changed in the last 48 hours" is shut by default (owner ask 2026-11-25) - opened here so these tests still read its list
  forced.map = { "const [changesOpen, setChangesOpen]": true, ...f };
  try { return renderToString(h(DepartmentOpsTab, props)).replace(/<!-- -->/g, ""); } finally { forced.map = {}; }
};

let store;
beforeEach(() => { store = {}; vi.stubGlobal("localStorage", { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }); });
afterEach(() => vi.unstubAllGlobals());

describe("calendar (no event picked) - My events button", () => {
  it("onsiteOnly: month calendar + 'Pick an event to plan' + the My events toggle, unpressed, listing every event", () => {
    const html = render(base());
    expect(html).toContain("Pick an event to plan");
    expect(html).toMatch(/aria-pressed="false"[^>]*>[^]*?My events/);
    expect(html).toContain("My events");
    for (const n of ["MineWedding", "SunilsParty", "NobodyGala", "RemovedSupMine"]) expect(html).toContain(n);
    expect(html).toContain("4 sold events this month");
  });
  it("everyone else: no My events button (flag false, and the prop omitted)", () => {
    expect(render(base({ onsiteOnly: false }))).not.toContain("My events");
    const p = base(); delete p.onsiteOnly;
    expect(render(p)).not.toContain("My events");
  });
  it("My events pressed: the grid and the month count hold only this login's events (roster id AND a removed supervisor's kept name/phone)", () => {
    const html = render(base(), { [F.myOnly]: true });
    expect(html).toContain("My events ✓");
    expect(html).toMatch(/aria-pressed="true"/);
    expect(html).toContain("MineWedding");
    expect(html).toContain("RemovedSupMine");
    expect(html).not.toContain("SunilsParty");
    expect(html).not.toContain("NobodyGala");
    expect(html).toContain("2 sold events this month");
  });
  it("the filter is inert unless onsiteOnly (a stale myOnly can never hide events from another role)", () => {
    const html = render(base({ onsiteOnly: false }), { [F.myOnly]: true });
    expect(html).toContain("SunilsParty");
    expect(html).toContain("4 sold events this month");
    expect(html).not.toContain("Show every event");
  });
  it("phone day list: the opened day shows only my events when pressed", () => {
    const all = render(base(), { [F.pickDay]: day(4) });
    expect(all).toContain("SunilsParty");
    const mine = render(base(), { [F.myOnly]: true, [F.pickDay]: day(4) });
    expect(mine).not.toContain("SunilsParty");
    const mine3 = render(base(), { [F.myOnly]: true, [F.pickDay]: day(3) });
    expect(mine3).toContain("MineWedding");
  });
  it("login not on the roster and no kept name matches: empty state says to ask the admin, with a Show every event link", () => {
    const html = render(base({ authUser: { id: "u9", role: "PDF Viewer", name: "Stranger", phone: "9000000000" } }), { [F.myOnly]: true });
    expect(html).toContain("0 sold events this month");
    expect(html).toContain("ask the admin to add you");
    expect(html).toContain("Show every event");
  });
  it("on the roster but no event this month: the other empty message", () => {
    const html = render(base({ eventOrders: [ev("E2", "SunilsParty", 4, { siteSupervisorId: "S2" })] }), { [F.myOnly]: true });
    expect(html).toContain("No functions at your venues this month");
    expect(html).toContain("Show every event");
    expect(html).not.toContain("ask the admin to add you");
  });
  it("login with no phone, matched by name only (case / spacing)", () => {
    const html = render(base({ authUser: { id: "u1", role: "PDF Viewer", name: "  SUNIL   kumar " } }), { [F.myOnly]: true });
    expect(html).toContain("SunilsParty");
    expect(html).not.toContain("MineWedding");
  });
  it("authUser null / supervisors undefined do not throw", () => {
    expect(() => render(base({ authUser: null, supervisors: undefined }), { [F.myOnly]: true })).not.toThrow();
    expect(() => render(base({ authUser: undefined }))).not.toThrow();
  });
  it("pending / cancelled events never show, even when mine", () => {
    const html = render(base({ eventOrders: [ev("E1", "MineWedding", 3, { siteSupervisorId: "S1", status: "cancelled" })] }), { [F.myOnly]: true });
    expect(html).not.toContain("MineWedding");
  });
  it("phone: the calendar toggle sits in the calendar card header (before Today)", () => {
    const html = render(base());
    expect(html.indexOf("Pick an event to plan")).toBeLessThan(html.indexOf("My events"));
    expect(html.indexOf("My events")).toBeLessThan(html.indexOf(">Today<"));
  });
});

const sel = (extra = {}) => base({ ...extra });
const F_SEL = { [F.selId]: "E1" };

describe("event opened - onsiteOnly", () => {
  const html = render(sel(), F_SEL);
  it("renders the event header without the Department Head | Site Supervisor switch", () => {
    expect(html).toContain("Furniture — MineWedding");
    expect(html).not.toContain(">Department Head<");
    expect(html).not.toMatch(/aria-pressed="(true|false)"[^>]*>(?:(?!<\/button>)[^])*Department Head/);
  });
  it("department bar stays: chips for every department + the EN / हिं toggle", () => {
    for (const d of ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric"]) expect(html).toContain(d);
    expect(html).not.toContain("Paint"); // the role is never offered Paint (its view prints paint costs)
    expect(html).toContain("English - screen and PDF");
    expect(html).toContain("Hindi - screen and PDF");
  });
  it("the bar has no Download PDF button (the all-departments title) and no Sync", () => {
    expect(html).not.toContain("One PDF with all");
    expect(html).not.toContain("SYNC-BUTTON");
  });
  it("two buttons under the header: All departments PDF and Floral PDF", () => {
    expect(html).toContain("All departments PDF");
    expect(html).toContain("Floral PDF");
    expect(html.indexOf("Furniture — MineWedding")).toBeLessThan(html.indexOf("All departments PDF"));
    expect(html.indexOf("All departments PDF")).toBeLessThan(html.indexOf("Inventory blocked"));
  });
  it("tiles: Inventory blocked + Dismantle & routing; no planning tiles, no income, no changes banner, no fixed-venue card", () => {
    expect(html).toContain("Inventory blocked");
    expect(html).toContain("Dismantle &amp; routing");
    // tile titles only (a hidden panel block carries its own heading text, e.g. the Manpower plan block, in the DOM)
    for (const t of ["Actuals", "Trucks &amp; dismantle", "Truck planning", "Carpet plan", "Truss plan", "Fabric plan", "Dismantle plan"]) expect(html).not.toContain(`leading-snug">${t}<`);
    expect(html).toContain('leading-snug">Inventory blocked<');
    // the Department Head's own Manpower plan tile is there (owner ask 2026-11-20), the on-site crew tile is not
    expect(html).toContain('leading-snug">Manpower plan<');
    expect(html).not.toContain('leading-snug">On-site crew<');
    for (const t of ["Total income", "Fixed at venue", "Production requests"]) expect(html).not.toContain(t);
  });
  it("no Department Head view tiles AND the on-site tiles together (Inventory before Dismantle & routing)", () => {
    expect(html.indexOf("Inventory blocked")).toBeLessThan(html.indexOf("Dismantle &amp; routing"));
  });
  it("exactly two panel wrappers, both hidden while nothing is open", () => {
    const wraps = html.match(/data-ops-panel=""[^>]*class="[^"]*"/g) || html.match(/<div data-ops-panel[^>]*>/g) || [];
    expect(wraps.length).toBe(2);
    wraps.forEach((w) => expect(w).not.toContain("fixed inset-0"));
  });
});

describe("event opened - everyone else is unchanged", () => {
  const html = render(sel({ onsiteOnly: false }), F_SEL);
  it("Department Head tag (no Site Supervisor tag any more - the sidebar's Site page has it), bar Download PDF, Sync present", () => {
    expect(html).toContain("Department Head");
    expect(html).not.toContain(">Site Supervisor</button>");
    expect(html).toContain("One PDF with all");
    expect(html).toContain("SYNC-BUTTON");
  });
  it("planning tiles present, no extra PDF row, no My events", () => {
    expect(html).toContain('leading-snug">Manpower plan<');
    expect(html).toContain('leading-snug">Trucks &amp; dismantle<'); // Truck planning + Dismantle plan, one tile (owner ask 2026-11-25)
    expect(html).toContain("Inventory blocked");
    expect(html).not.toContain("All departments PDF");
    expect(html).not.toContain("Floral PDF");
    expect(html).not.toContain("My events");
  });
  it("Department Head view does not show the on-site tiles; the dept starts on the first department", () => {
    expect(html).not.toContain("Dismantle &amp; routing");
    expect(html).toContain("Furniture — MineWedding");
  });
  it("Site Supervisor view (opsView onsite) is still selectable for them and unchanged", () => {
    const sv = render(sel({ onsiteOnly: false }), { ...F_SEL, 'const [opsViewRaw, setOpsView]': "onsite" });
    expect(sv).toContain("Dismantle &amp; routing");
    expect(sv).not.toContain('leading-snug">Manpower plan<');
  });
});

describe("panels open only for their own tiles", () => {
  const wrapStates = (html) => (html.match(/<div data-ops-panel[^>]*>/g) || []).map((w) => w.includes("fixed inset-0"));
  const open = (modal, onsiteOnly = true) => wrapStates(render(sel({ onsiteOnly }), { ...F_SEL, [F.modal]: modal }));
  it("onsiteOnly: inv / mp -> planning panel only; rcv / route -> on-site panel only; any other (oscrew included) -> none", () => {
    for (const m of ["inv", "mp"]) expect(open(m)).toEqual([true, false]);
    for (const m of ["rcv", "route"]) expect(open(m)).toEqual([false, true]);
    for (const m of ["oscrew", "actuals", "truck", "carpet", "truss", "fabreq", "fabshort", "dism", "bogus"]) expect(open(m)).toEqual([false, false]);
  });
  it("everyone else: Department Head view opens its panel for any key (unchanged wrapper rule)", () => {
    expect(wrapStates(render(sel({ onsiteOnly: false }), { ...F_SEL, [F.modal]: "mp" }))[0]).toBe(true);
    expect(wrapStates(render(sel({ onsiteOnly: false }), { ...F_SEL, [F.modal]: "inv" }))[0]).toBe(true);
  });
  it("PANEL_WRAP is the 'fixed inset-0' class (the markers above rely on it)", () => {
    expect(PANEL_WRAP).toContain("fixed inset-0");
  });
});

describe("PDF buttons states", () => {
  const html = (f) => render(sel(), { ...F_SEL, ...f });
  const btn = (s, label) => { const m = new RegExp("<button[^>]*>(?:(?!</button>)[^])*" + label + "[^]*?</button>").exec(s); return m && m[0]; };
  it("enabled with an event and nothing exporting", () => {
    expect(btn(html({}), "All departments PDF")).not.toMatch(/disabled=""/);
    expect(btn(html({}), "Floral PDF")).not.toMatch(/disabled=""/);
  });
  it("disabled while exporting (both)", () => {
    const s = html({ [F.exporting]: "download" });
    expect(btn(s, "Building the PDF|All departments PDF")).toMatch(/disabled=""/);
    expect(btn(s, "Floral PDF")).toMatch(/disabled=""/);
  });
  it("Floral PDF is disabled once a Floral build is queued (no double click)", () => {
    expect(btn(html({ [F.floral]: true }), "Floral PDF")).toMatch(/disabled=""/);
  });
  it("no Floral PDF button for a person who cannot see Floral (explicit departments / role name), All departments stays", () => {
    const s = render(sel({ authUser: { ...me, departments: ["Tenting", "Fabric"] } }), F_SEL);
    expect(s).not.toContain("Floral PDF");
    expect(s).toContain("All departments PDF");
    const s2 = render(sel({ authUser: { ...me, role: "Site Supervisor Tenting" } }), F_SEL);
    expect(s2).not.toContain("Floral PDF");
  });
  it("Floral button shows when Floral is among their departments", () => {
    expect(render(sel({ authUser: { ...me, departments: ["Floral", "Fabric"] } }), F_SEL)).toContain("Floral PDF");
  });
  it("on the Floral department the same two buttons show, and tiles are still only Inventory blocked + on-site cards", () => {
    const s = html({ [F.dept]: "Floral" });
    expect(s).toContain("Floral PDF");
    expect(s).toContain("Inventory blocked");
    expect(s).toContain('leading-snug">Manpower plan<');
  });
  it("RISK (documented): in the Paint view both PDF buttons are hidden (dept !== PAINT gate)", () => {
    const s = html({ [F.dept]: "Paint" });
    expect(s).not.toContain("All departments PDF");
    expect(s).not.toContain("Floral PDF");
  });
});

describe("PDF / screen language default", () => {
  const toggleOn = (s, lang) => new RegExp('aria-pressed="true"[^>]*aria-label="' + (lang === "hi" ? "Hindi" : "English") + ' - screen and PDF"').test(s);
  it("onsiteOnly with nothing stored: Hindi", () => {
    const s = render(sel(), F_SEL);
    expect(toggleOn(s, "hi")).toBe(true);
    expect(toggleOn(s, "en")).toBe(false);
  });
  it("everyone else with nothing stored: English", () => {
    expect(toggleOn(render(sel({ onsiteOnly: false }), F_SEL), "en")).toBe(true);
  });
  it("a stored choice always wins, both ways", () => {
    store["ims.deptOps.pdfLang"] = "en";
    expect(toggleOn(render(sel(), F_SEL), "en")).toBe(true);
    store["ims.deptOps.pdfLang"] = "hi";
    expect(toggleOn(render(sel({ onsiteOnly: false }), F_SEL), "hi")).toBe(true);
  });
  it("a garbage stored value falls back to the role default", () => {
    store["ims.deptOps.pdfLang"] = "fr";
    expect(toggleOn(render(sel(), F_SEL), "hi")).toBe(true);
    expect(toggleOn(render(sel({ onsiteOnly: false }), F_SEL), "en")).toBe(true);
  });
  it("localStorage that throws: still the role default", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); } });
    expect(toggleOn(render(sel(), F_SEL), "hi")).toBe(true);
    expect(toggleOn(render(sel({ onsiteOnly: false }), F_SEL), "en")).toBe(true);
  });
  it("Deal Check's frame (window.__AMBRIA_PDF_FRAME__ + &pdfLang=) overrides, even over a stored choice", () => {
    store["ims.deptOps.pdfLang"] = "hi";
    vi.stubGlobal("window", { matchMedia: mm, __AMBRIA_PDF_FRAME__: true, location: { hash: "#/ims?autoPdf=1&pdfLang=en" } });
    expect(toggleOn(render(sel({ onsiteOnly: false }), F_SEL), "en")).toBe(true);
    vi.unstubAllGlobals();
  });
  it("window flag without a pdfLang in the hash does not break the role default", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
    vi.stubGlobal("window", { matchMedia: mm, __AMBRIA_PDF_FRAME__: true, location: { hash: "#/ims" } });
    expect(toggleOn(render(sel(), F_SEL), "hi")).toBe(true);
  });
  it("&pdfLang= in the hash WITHOUT the frame flag is ignored", () => {
    vi.stubGlobal("window", { matchMedia: mm, location: { hash: "#/ims?pdfLang=en" } });
    expect(toggleOn(render(sel(), F_SEL), "hi")).toBe(true);
  });
});


describe("money / planning data the role must not see (fixture with income, a recent change and a fixed venue)", () => {
  const rich = (o = {}) => ev("E1", "MineWedding", 3, {
    siteSupervisorId: "S1",
    deptIncome: { Furniture: { total: 987654, manpower: 111, sales: 222 } },
    deptOps: { Furniture: { changes: { mp: { at: Date.now() - 60000, by: "Anmol" }, actuals: { at: Date.now() - 120000, by: "Anmol" } } } },
    ...o,
  });
  const settings = { fixedVenues: [{ id: "fv1", name: "Hall", venue: "Hall", items: [{ name: "Standing Chair", qty: 4, dept: "Furniture" }] }] };
  const view = (onsiteOnly) => render(base({ onsiteOnly, eventOrders: [rich()], settings }), F_SEL);
  it("control: everyone else sees Total income, the changes banner and the Manpower tile for this fixture", () => {
    const html = view(false);
    expect(html).toContain("Total income");
    expect(html).toContain("Changed in the last 48 hours");
  });
  it("onsiteOnly: none of the money / change / planning surfaces appear", () => {
    const html = view(true);
    expect(html).not.toContain("Total income");
    expect(html).not.toContain("987,654");
    expect(html).not.toContain("9,87,654");
    // the changes list shows the role only the entries of the blocks it has (Manpower plan, Inventory blocked) - never Actuals
    expect(html).toContain("Manpower plan updated");
    expect(html).not.toContain("Actuals updated");
    expect(html).not.toContain("Sales discount");
  });
});

describe("RISKS (documented behaviour, not a spec violation of the listed tiles)", () => {
  it("the Inventory blocked tile carries a rupee figure (value: fmt(invBlockedTotal)) - the spec lists the tile, so this is by design, but it is money on screen", () => {
    const html = render(sel(), F_SEL);
    const tile = /leading-snug">Inventory blocked<[^]*?<\/button>/.exec(html)[0];
    expect(tile).toMatch(/tabular-nums tracking-tight">₹/);
  });
  it("the event header still shows 'Deal value ₹...' for the role (header is shown as-is by spec)", () => {
    const html = render(base({ eventOrders: [ev("E1", "MineWedding", 3, { siteSupervisorId: "S1", dealValue: { amount: 1234567, pending: 0 } })] }), F_SEL);
    expect(html).toContain("Deal value");
  });
  it("the role never gets the Site Supervisor dropdown (owner ask 2026-11-20): no select, no 'unassigned'; the assigned name is shown as plain text; everyone else keeps the dropdown", () => {
    const withSup = (onsiteOnly) => render(base({ onsiteOnly, eventOrders: [ev("E1", "MineWedding", 3, { siteSupervisorId: "S1", siteSupervisorName: "Raju" })] }), F_SEL);
    const role = withSup(true);
    expect(role).not.toContain("— unassigned —");
    expect(role).not.toMatch(/<select[^>]*>\s*<option value="">— unassigned/);
    expect(role).toContain("Site Supervisor");
    expect(role).toContain("Raju");
    const none = render(base({ onsiteOnly: true, eventOrders: [ev("E1", "MineWedding", 3, {})] }), F_SEL);
    expect(none).not.toContain("— unassigned —");
    expect(none).not.toContain("👷 Site Supervisor");
    // control: the Department Head still picks the supervisor - the name as text with a "Change" button (the picker opens on tap)
    expect(withSup(false)).toContain("Raju");
    expect(withSup(false)).toContain(">+ Add supervisor</button>"); // adds one more, never replaces (owner ask 2026-11-25)
    expect(withSup(false)).toContain('aria-label="Remove Raju"');
    expect(withSup(false)).not.toContain("<select");
    const two = render(base({ onsiteOnly: false, eventOrders: [ev("E1", "MineWedding", 3, { extraSupervisors: [{ id: "S1", name: "Raju" }, { id: "S2", name: "Chandan" }] })] }), F_SEL);
    expect(two).toContain("Raju");
    expect(two).toContain("Chandan");
    const noneHead = render(base({ onsiteOnly: false, eventOrders: [ev("E1", "MineWedding", 3, {})] }), F_SEL);
    expect(noneHead).toContain("— unassigned —");
    expect(noneHead).toContain(">+ Add supervisor</button>");
  });
  it("Paint department: the planning panel (PaintDeptView with its ₹ paint costs) is not gated on onsiteOnly", () => {
    const paintSrc = SRC.match(/\{dept === PAINT && <PaintDeptView[^\n]*/)[0];
    expect(paintSrc).not.toContain("onsiteOnly");
    expect(readFileSync(resolve(__dirname, "PaintDeptView.jsx"), "utf8")).toContain("₹");
  });
});

describe("RISK: the Activity-log bell (header actionIcons) is not gated for the role", () => {
  it("with a logged amendment for the department the bell ('Activity log - N recent changes') still renders for onsiteOnly, and a logged inventory change is listed in the changes list too", () => {
    const amend = [{ id: "A1", eventOrderId: "E1", department: "Furniture", status: "logged", requestedAt: Date.now() - 60000, requestedBy: "Sales", items: [{ name: "Chair", change: "added", qty: 2 }] }];
    const html = render(base({ amendRequests: amend }), F_SEL);
    expect(html).toContain("Changed in the last 48 hours");
    expect(html).toContain("Activity log");
    expect(render(base({ onsiteOnly: false, amendRequests: amend }), F_SEL)).toContain("Activity log");
  });
});

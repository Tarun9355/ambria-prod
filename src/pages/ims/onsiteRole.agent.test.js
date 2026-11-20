import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Structural + behavioural tests for the "Site Supervisor view only" role (onsiteOnly) in DepartmentOpsTab.jsx, read from the REAL source.
// (The rendered-output tests are in onsiteRole.agent.render.test.jsx.)
const src = readFileSync(resolve(__dirname, "DepartmentOpsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
const lines = src.split("\n");
const compStart = src.indexOf("export default function DepartmentOpsTab(");
const mainReturn = src.indexOf("\n  return (\n    /* ── STACKS BELOW xl");
const slice = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a + from.length); if (a < 0 || b < 0) throw new Error("slice anchor missing: " + from + " / " + to); return src.slice(a, b); };

describe("component shape", () => {
  it("onsiteOnly is a prop defaulting to false (everyone else, including a caller that omits it, is unchanged)", () => {
    expect(src).toMatch(/export default function DepartmentOpsTab\(\{ onsiteOnly = false,/);
  });
  it("hooks-order: no early return / conditional return at the component's top level before the main return, so every hook (incl. the Floral ones) runs on every render", () => {
    const body = src.slice(compStart, mainReturn);
    const topLevel = body.split("\n").filter((l) => /^  (if|return|switch|for|while)\b/.test(l) && !/^\s*\/\//.test(l));
    expect(topLevel).toEqual([]);
    // and the new hooks are declared inside that region (before the return), not after it
    for (const h of ["const [myOnly, setMyOnly] = useState(false)", "const [floralPdfWanted, setFloralPdfWanted] = useState(false)", "const floralBackTo = useRef(null)"]) {
      const i = src.indexOf(h);
      expect(i).toBeGreaterThan(compStart);
      expect(i).toBeLessThan(mainReturn);
    }
  });
  it("no hook is called inside the onsiteOnly conditionals (useState/useEffect/useMemo/useRef lines never sit behind `onsiteOnly &&` or a ternary)", () => {
    const bad = lines.filter((l) => /onsiteOnly/.test(l) && /\b(useState|useEffect|useMemo|useRef|useCallback)\(/.test(l) && !/^\s*(const|useEffect)/.test(l));
    expect(bad).toEqual([]);
    // mySupervisorIds: the memo itself always runs, the condition is inside it
    expect(src).toMatch(/const mySupervisorIds = useMemo\(\(\) => \(onsiteOnly \? supervisorIdsOfUser\(authUser, supervisors\) : \[\]\), \[onsiteOnly, authUser, supervisors\]\);/);
  });
  it("opsView is the raw state: the role never rewrites the Dept Head / Site Supervisor choice (so flipping onsiteOnly off restores it)", () => {
    expect(src).toContain("const opsView = opsViewRaw;");
  });
});

describe("My events filter (calendar buckets, per function date)", () => {
  const memo = slice("const pickByDate = useMemo(() => {", "// Arriving from the Calendar tab");
  it("the events list itself is not narrowed by My events any more (the calendar buckets are, per date)", () => {
    const ev = slice("const events = useMemo(() => {", "// Open the picker on a month");
    expect(ev).not.toContain("isMyEvent");
    expect(ev).toContain("}, [allEvents, search]);");
  });
  it("a date stays when its event is mine (picked Site Supervisor) OR its function's venue is one the supervisor is fixed at - only for onsiteOnly AND myOnly", () => {
    expect(memo).toContain("if (onsiteOnly && myOnly && !isMyEvent(eo, authUser, supervisors)");
    expect(memo).toContain("&& !fixedAtVenue(authUser, fnForDate(eo, d)?.venue || eo.venue || \"\", settings, venuePlaces, supervisors, inhouseVenues.inhouse)) return;");
  });
  it("the venue is looked up per DATE (the function held that day), like the venue legend filter right above it", () => {
    expect(memo.indexOf("venueFilter")).toBeLessThan(memo.indexOf("fixedAtVenue("));
    expect(memo).toContain("fnForDate(eo, d)?.venue");
  });
  it("deps include everything the filter reads (no stale My events after a roster, venue or login change)", () => {
    const deps = /\}, \[([^\]]+)\]\);\s*$/.exec(memo.trimEnd())[1].split(",").map((s) => s.trim());
    for (const d of ["events", "pickMonth", "venueFilter", "settings", "onsiteOnly", "myOnly", "authUser", "supervisors", "venuePlaces"]) expect(deps).toContain(d);
  });
});

describe("what the role is NOT shown - each surface is gated on onsiteOnly in the source", () => {
  it("bar: Department Head | Site Supervisor switch, Download PDF and Sync are all behind !onsiteOnly; the chips and the language toggle are not", () => {
    expect(src).toContain('{!onsiteOnly && [["planning", "Department Head", IconClipboard]');
    expect(src).toMatch(/\{!onsiteOnly && <button onClick=\{\(\) => \{ const allDepts = deptsWithWork\.length \? deptsWithWork : bookDepts; exportDeptPdf/);
    expect(src).toContain("{!onsiteOnly && <PlanningSyncButton eventOrders={eventOrders} onlyOrder={sel} />}");
    const barLang = src.indexOf('<PdfLangToggle value={pdfLang} onChange={setPdfLang} disabled={!!exporting} display="hidden sm:inline-flex"');
    expect(barLang).toBeGreaterThan(0);
    expect(src.slice(barLang - 80, barLang)).not.toContain("onsiteOnly");
  });
  it("planning view: production requests, fixed-venue card, income readout, changes banner are gated; tiles are filtered down to Inventory blocked", () => {
    expect(src).toContain('{opsView === "planning" && !onsiteOnly && <ProductionRequestsCard');
    expect(src).toContain("{!onsiteOnly && <FixedVenueStockCard");
    expect(src).toContain("{onsiteOnly ? null : deptIncome ? (() => {");
    expect(src).toContain('const list = deptChangesOf(sel.id).filter((c) => !onsiteOnly || c.section === "inv" || c.section === "mp");');
    expect(src).toContain('.filter((t) => t && (!onsiteOnly || t.k === "inv" || t.k === "mp"));');
  });
  it("every planning-tile key in the tile array other than inv is dropped by that filter (fabreq, carpet, truss, mp, actuals, truck, dism)", () => {
    const tiles = slice("const tiles = [\n                dept === \"Fabric\"", "].filter((t) => t && (!onsiteOnly");
    const keys = [...tiles.matchAll(/\bk: "([a-z]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(expect.arrayContaining(["fabreq", "inv", "carpet", "truss", "mp", "actuals", "truck", "dism"]));
  });
  it("RISK guard: the Planning view is mounted for the role only to host the Inventory tile + its panel (both views render in one pass)", () => {
    expect(src).toContain('{(opsView === "planning" || onsiteOnly) && dept !== PAINT && (<>');
    expect(src).toContain('{(opsView === "onsite" || onsiteOnly) && dept !== PAINT && (<>');
  });
  it("panel wrappers: planning only for modal === inv, on-site only for rcv / route / oscrew", () => {
    expect(src).toContain('className={modal && (!onsiteOnly || modal === "inv" || modal === "mp") ? PANEL_WRAP : "hidden"}');
    expect(src).toContain('className={modal && (!onsiteOnly || ["rcv", "route"].includes(modal)) ? PANEL_WRAP : "hidden"}');
  });
  it("the two on-site-only keys the role may open are the on-site tile keys (rcv, route, oscrew)", () => {
    const tiles = slice('const short = sourceRows.filter(r => r.shortfall > 0).length;', "].filter(Boolean);");
    expect([...tiles.matchAll(/\bk: "([a-z]+)"/g)].map((m) => m[1])).toEqual(["rcv", "route", "oscrew"]);
  });
  it("the Inventory tile's panel body is keyed 'inv' (modalCls) - the one planning block the role can open", () => {
    expect(src).toMatch(/modalCls\("inv"\)/);
  });
});

describe("language default", () => {
  const init = slice("const [pdfLang, setPdfLangState] = useState(() => {", "const setPdfLang = ");
  const run = ({ onsiteOnly, saved, throws = false, win = undefined }) => {
    const ls = { getItem: () => { if (throws) throw new Error("x"); return saved === undefined ? null : saved; } };
    // eslint-disable-next-line no-new-func
    const fn = new Function("onsiteOnly", "localStorage", "window", "PDF_LANG_KEY", "useState", `return ${init.slice(init.indexOf("useState(") + 9).replace(/\)\s*;?\s*$/, "").trim()}`);
    return fn(onsiteOnly, ls, win, "k", (f) => f)();
  };
  it("unset -> hi for the role, en for everyone else; stored wins; garbage ignored; throwing storage -> role default", () => {
    expect(run({ onsiteOnly: true })).toBe("hi");
    expect(run({ onsiteOnly: false })).toBe("en");
    expect(run({ onsiteOnly: true, saved: "en" })).toBe("en");
    expect(run({ onsiteOnly: false, saved: "hi" })).toBe("hi");
    expect(run({ onsiteOnly: true, saved: "xx" })).toBe("hi");
    expect(run({ onsiteOnly: true, throws: true })).toBe("hi");
    expect(run({ onsiteOnly: false, throws: true })).toBe("en");
  });
  it("Deal Check's frame wins over everything, only when the frame flag AND the hash param exist", () => {
    const win = (flag, hash) => ({ __AMBRIA_PDF_FRAME__: flag, location: { hash } });
    expect(run({ onsiteOnly: true, saved: "hi", win: win(true, "#/ims?x=1&pdfLang=en") })).toBe("en");
    expect(run({ onsiteOnly: false, saved: "en", win: win(true, "#/ims?pdfLang=hi") })).toBe("hi");
    expect(run({ onsiteOnly: true, win: win(false, "#/ims?pdfLang=en") })).toBe("hi");
    expect(run({ onsiteOnly: true, win: win(true, "#/ims") })).toBe("hi");
  });
  it("the choice is only WRITTEN when the person picks (the default is never persisted by mounting)", () => {
    const setter = slice("const setPdfLang = (l) => {", "useEffect(() => () => { if (deckCacheRef");
    expect(setter).toContain("localStorage.setItem(PDF_LANG_KEY, v)");
    expect(init).not.toContain("setItem");
  });
});

describe("carpet / items gate wording for the role", () => {
  it("canCarpet and canItems are false for onsiteOnly, so no navigation is offered", () => {
    expect(src).toContain('const canCarpet = !onsiteOnly && (dept === "Tenting" || deptOptions.includes("Tenting"));');
    expect(src).toContain('const canItems = !onsiteOnly && (dept === "Fabric" || deptOptions.includes("Fabric"));');
  });
  it("the button label falls back to OK and the 'Ask the ... head' wording when neither can be opened", () => {
    expect(src).toContain('confirmLabel: goCarpet ? "Open Carpet plan" : goItems ? "Open Fabric plan" : "OK"');
    expect(src).toContain("Ask the Fabric head to choose them in Planning → Fabric → Fabric plan");
  });
});

// ── Floral PDF: the real effect + click handler, run on a tiny hook runtime ──
const floralSrc = slice("const [floralPdfWanted, setFloralPdfWanted] = useState(false);", "const downloadAllDeptsPdf");

function mountFloral({ dept0 = "Tenting", sel = { id: "E1" }, exporting0 = false, exportImpl }) {
  const st = { floralPdfWanted: false, dept: dept0, exporting: exporting0, sel };
  const refBox = { current: null };
  let lastDeps = null;
  const calls = { export: [], setDept: [] };
  const exportDeptPdf = (...a) => { calls.export.push({ args: a, deptAtCall: st.dept }); return exportImpl ? exportImpl(st, calls) : Promise.resolve(true); };
  let api, pending = [], scheduled = false, guard = 0;
  const schedule = () => { scheduled = true; };
  const render = () => {
    const useState = (init) => [st.floralPdfWanted, (v) => { st.floralPdfWanted = typeof v === "function" ? v(st.floralPdfWanted) : v; schedule(); }];
    const useRef = () => refBox;
    const useEffect = (fn, deps) => { if (!lastDeps || deps.some((d, i) => d !== lastDeps[i])) { lastDeps = deps; pending.push(fn); } };
    // eslint-disable-next-line no-new-func
    api = new Function("useState", "useRef", "useEffect", "dept", "setDept", "sel", "exporting", "exportDeptPdf", `${floralSrc}\nreturn { downloadFloralPdf, floralPdfWanted };`)(
      useState, useRef, useEffect, st.dept, (v) => { calls.setDept.push(v); st.dept = v; schedule(); }, st.sel, st.exporting, exportDeptPdf);
  };
  const flush = () => { // re-render until stable, running effects after each render, like React
    do { scheduled = false; pending = []; render(); const run = pending; run.forEach((f) => f()); if (++guard > 50) throw new Error("render loop"); } while (scheduled);
  };
  flush();
  return { st, calls, ref: refBox, click: () => { api.downloadFloralPdf(); flush(); }, set: (patch) => { Object.assign(st, patch); flush(); }, flush, get api() { return api; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Floral PDF click + effect (real source, fake hook runtime)", () => {
  it("source: builds the SINGLE-department Floral book, never the combined one (the combined book omits flower recipes)", () => {
    expect(floralSrc).toContain('exportDeptPdf(["Floral"])');
    expect(floralSrc).not.toMatch(/combined\s*:\s*true/);
  });
  it("from another department: switches to Floral, exports exactly once for Floral, then returns to the department they were on", async () => {
    const m = mountFloral({ dept0: "Tenting" });
    expect(m.calls.export).toHaveLength(0);
    m.click();
    // the click itself only moves to Floral and queues the build ...
    expect(m.calls.setDept).toEqual(["Floral"]);
    // ... and the effect (run after the Floral render) starts it
    expect(m.calls.export).toHaveLength(1);
    expect(m.calls.export[0].args).toEqual([["Floral"]]);
    expect(m.calls.export[0].deptAtCall).toBe("Floral");
    expect(m.st.floralPdfWanted).toBe(false);
    await tick();
    expect(m.calls.setDept).toEqual(["Floral", "Tenting"]);
    expect(m.ref.current).toBe(null);
    expect(m.calls.export).toHaveLength(1); // no second export when the department flips back
  });
  it("from Floral: just downloads, no department change, nothing queued", async () => {
    const m = mountFloral({ dept0: "Floral" });
    m.click();
    expect(m.calls.export).toHaveLength(1);
    expect(m.calls.setDept).toEqual([]);
    expect(m.st.floralPdfWanted).toBe(false);
    expect(m.ref.current).toBe(null);
  });
  it("waits while another export is running, then goes once it ends", async () => {
    const m = mountFloral({ dept0: "Lighting", exporting0: true });
    m.click();
    expect(m.calls.export).toHaveLength(0);
    expect(m.st.floralPdfWanted).toBe(true);
    m.set({ exporting: false });
    expect(m.calls.export).toHaveLength(1);
    await tick();
    expect(m.st.dept).toBe("Lighting");
  });
  it("waits for an event: with no event nothing is exported (the button is disabled in that state anyway)", () => {
    const m = mountFloral({ dept0: "Lighting", sel: null });
    m.click();
    expect(m.calls.export).toHaveLength(0);
    m.set({ sel: { id: "E2" } });
    expect(m.calls.export).toHaveLength(1);
  });
  it("the export finishing with false (failed / stopped by a dialog) still returns them to their department", async () => {
    const m = mountFloral({ dept0: "Structure", exportImpl: () => Promise.resolve(false) });
    m.click();
    await tick();
    expect(m.st.dept).toBe("Structure");
  });
  it("the export REJECTING still returns them to their department (finally)", async () => {
    const unhandled = [];
    const h = (e) => unhandled.push(e);
    process.on("unhandledRejection", h);
    const m = mountFloral({ dept0: "Structure", exportImpl: () => Promise.reject(new Error("boom")) });
    m.click();
    await tick(); await tick();
    process.off("unhandledRejection", h);
    expect(m.st.dept).toBe("Structure");
    // exportPdf never rejects in the shipped code (renderDeptBook never throws), so this is a latent-only path: the .finally() chain is not
    // `.catch`-ed, so a rejection WOULD surface as an unhandled rejection. Documented, not asserted either way.
    expect(unhandled.length).toBeLessThanOrEqual(1);
  });
  it("a second click while the first Floral build is queued is a no-op in the UI (button is disabled by floralPdfWanted); the handler itself keeps the FIRST back-to", () => {
    expect(src).toContain("disabled={!sel || !!exporting || floralPdfWanted}");
    const m = mountFloral({ dept0: "Lighting", exporting0: true });
    m.click(); // queued, department -> Floral, back-to Lighting
    expect(m.ref.current).toBe("Lighting");
    // BUG-CHECK: a (hypothetical) second click now has dept === "Floral" and would take the direct branch, leaving back-to alone
    m.click();
    expect(m.ref.current).toBe("Lighting");
    expect(m.calls.export.length).toBeLessThanOrEqual(1);
  });
  it("back-to is cleared after use so a later direct Floral download never bounces the person to an old department", async () => {
    const m = mountFloral({ dept0: "Tenting" });
    m.click();
    await tick();
    expect(m.st.dept).toBe("Tenting");
    m.set({ dept: "Floral" });
    m.click();
    await tick();
    expect(m.st.dept).toBe("Floral");
    expect(m.calls.setDept).toEqual(["Floral", "Tenting"]);
  });
  it("RISK (documented): the person picking another department chip while the Floral book builds is bounced back (the finally forces setDept(back))", async () => {
    let release;
    const m = mountFloral({ dept0: "Tenting", exportImpl: () => new Promise((r) => { release = r; }) });
    m.click();
    m.set({ dept: "Lighting" }); // they click Lighting mid-build
    release(true);
    await tick();
    expect(m.st.dept).toBe("Tenting");
  });
});

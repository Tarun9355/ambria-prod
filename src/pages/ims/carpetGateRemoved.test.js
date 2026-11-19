import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Owner (2026-11-19): the "Carpet not selected" hold belongs in Deal Check, not IMS Dept Ops - an IMS PDF download must never stop on it.
// The overlay / cushion-cover hold (needItems: Fabric book and all-departments book) stays.
// The REAL gate block is sliced out of DepartmentOpsTab.jsx's exportPdf and run with stubs, so these follow the shipped code.

const src = readFileSync(resolve(__dirname, "DepartmentOpsTab.jsx"), "utf8").replace(/\r\n/g, "\n");
const exportStart = src.indexOf("const exportPdf = async (");
const exportEnd = src.indexOf("const exportDeptPdf = ", exportStart);
const exportSrc = src.slice(exportStart, exportEnd);
const gateStart = exportSrc.indexOf("const needCarpets");
const gateEnd = exportSrc.indexOf("setExporting(view ?");

const FUTURE = "2099-06-01", PAST = "2000-01-01";

// run the gate: resolves "pass" when the download would go on to build the book, false when the dialog stopped it
const makeGate = () => {
  const calls = { confirm: [], setDept: [], setOpsView: [], setModal: [], carpetPlanOf: 0, elementPlanOf: 0 };
  const run = async ({
    multi = false, depts = ["Tenting"], shared = null, gate = true, allCarpets = false,
    dept = "Tenting", deptOptions = ["Tenting", "Fabric"], carpetRows = [], itemRows = [], confirmAnswer = false, gateOpen = false,
  } = {}) => {
    const inThisBook = shared || depts;
    const pdfAllCarpetsRef = { current: allCarpets };
    const carpetGateOpenRef = { current: gateOpen };
    const carpetPlanOf = () => { calls.carpetPlanOf += 1; return { rows: carpetRows }; };
    const elementPlanOf = () => { calls.elementPlanOf += 1; return { rows: itemRows }; };
    const confirm = async (o) => { calls.confirm.push(o); return confirmAnswer; };
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "multi", "inThisBook", "gate", "pdfAllCarpetsRef", "carpetGateOpenRef", "carpetPlanOf", "elementPlanOf", "confirm",
      "dept", "deptOptions", "setDept", "setOpsView", "setModal",
      `return (async () => {\n${exportSrc.slice(gateStart, gateEnd)}\nreturn "pass";\n})();`,
    );
    const out = await fn(multi, inThisBook, gate, pdfAllCarpetsRef, carpetGateOpenRef, carpetPlanOf, elementPlanOf, confirm, dept, deptOptions,
      (v) => calls.setDept.push(v), (v) => calls.setOpsView.push(v), (v) => calls.setModal.push(v));
    return { out, gateOpenAfter: carpetGateOpenRef.current };
  };
  return { run, calls };
};

const carpetRow = (o = {}) => ({ status: "open", zoneName: "Stage", fnLabel: "Wedding", date: FUTURE, ...o });
const itemRow = (o = {}) => ({ status: "open", zoneName: "Stage", name: "Table overlay", fnLabel: "Wedding", date: FUTURE, ...o });
// every carpet floor status the plan can produce, all undecided / short / none, none of them ever read by the gate any more
const openCarpets = [carpetRow({ status: "open" }), carpetRow({ status: "short", zoneName: "Mandap" }), carpetRow({ status: "none", zoneName: "Entry" })];

describe("source: the carpet gate is switched off, the items gate is not", () => {
  it("needCarpets is the constant false, needItems still keys on multi / Fabric", () => {
    expect(gateStart).toBeGreaterThan(0);
    expect(exportSrc).toMatch(/const needCarpets = false;/);
    expect(exportSrc).toMatch(/const needItems = multi \|\| inThisBook\.includes\("Fabric"\);/);
    expect(exportSrc).not.toMatch(/needCarpets = multi/);
  });
  it("carpetPlanOf is read in exportPdf only behind needCarpets (nothing else in the download depends on a carpet decision)", () => {
    const uses = exportSrc.split("\n").filter((l) => /carpetPlanOf|carpetChoice|carpetDecided/.test(l) && !/^\s*\/\//.test(l));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/needCarpets \? carpetPlanOf\(\)/);
  });
  it("the book builder is still handed carpetPlanOf (deptBookHtml destructures it) - the prop must not be dropped with the gate", () => {
    expect(src).toMatch(/trussPlanOf, fabricEntriesOf, fabricPalettesOf, carpetPlanOf, elementPlanOf, zoneLabelFor/);
  });
  it("the items-only title is the 'Overlay / cushion cover not chosen' one", () => {
    expect(exportSrc).toContain('title = "Overlay / cushion cover not chosen"');
  });
});

describe("(a) the gate never triggers for carpet", () => {
  const books = [
    ["shared Fabric & Tenting book opened from Tenting, no items open", { depts: ["Tenting"], shared: ["Fabric", "Tenting"] }],
    ["Structure book", { depts: ["Structure"] }],
    ["Floral book", { depts: ["Floral"] }],
    ["Tenting-only book", { depts: ["Tenting"] }],
    ["all-departments book, no items open", { multi: true, depts: ["Tenting", "Fabric", "Floral"] }],
    ["all-departments book of ONE department", { multi: true, depts: ["Tenting"] }],
  ];
  it.each(books)("%s: open / short / none carpet floors never stop it and never open the dialog", async (_n, o) => {
    const { run, calls } = makeGate();
    const r = await run({ ...o, carpetRows: openCarpets, itemRows: [] });
    expect(r.out).toBe("pass");
    expect(calls.confirm).toHaveLength(0);
    expect(calls.carpetPlanOf).toBe(0); // not even read
  });

  it("never shows 'Carpet not selected' or the carpet part of 'Choices not made', even with items open too", async () => {
    const { run, calls } = makeGate();
    const r = await run({ multi: true, depts: ["Tenting", "Fabric"], carpetRows: openCarpets, itemRows: [itemRow()] });
    expect(r.out).toBe(false);
    expect(calls.confirm).toHaveLength(1);
    const { title, body, confirmLabel } = calls.confirm[0];
    expect(title).toBe("Overlay / cushion cover not chosen");
    expect(title).not.toBe("Carpet not selected");
    expect(title).not.toBe("Choices not made");
    expect(body).not.toMatch(/carpet/i);
    expect(body).not.toMatch(/Tenting/);
    expect(body).not.toContain("Open Carpet plan");
    expect(confirmLabel).not.toBe("Open Carpet plan");
    expect(calls.carpetPlanOf).toBe(0);
  });
});

describe("(b) the items gate still triggers, with no carpet in its message", () => {
  it("all-departments book with an open overlay row is refused", async () => {
    const { run, calls } = makeGate();
    const r = await run({ multi: true, depts: ["Tenting", "Fabric"], itemRows: [itemRow({ name: "Round overlay" }), itemRow({ name: "Cushion cover", status: "short" })] });
    expect(r.out).toBe(false);
    const { title, body } = calls.confirm[0];
    expect(title).toBe("Overlay / cushion cover not chosen");
    expect(body).toContain("these elements");
    expect(body).toContain("Stage · Round overlay");
    expect(/Stage · Cushion cover — Wedding · [^\n]*\(none of the choices covers it\)/.test(body)).toBe(true);
    expect(body).not.toMatch(/carpet/i);
    expect(calls.elementPlanOf).toBe(1);
  });
  it("the Fabric book (and the shared Fabric & Tenting book opened from either tab) is refused too", async () => {
    for (const o of [{ depts: ["Fabric"], dept: "Fabric" }, { depts: ["Tenting"], shared: ["Fabric", "Tenting"] }, { depts: ["Fabric"], shared: ["Fabric", "Tenting"], dept: "Fabric" }]) {
      const { run, calls } = makeGate();
      const r = await run({ ...o, itemRows: [itemRow()] });
      expect(r.out).toBe(false);
      expect(calls.confirm).toHaveLength(1);
    }
  });
  it("a single element reads 'this element'", async () => {
    const { run, calls } = makeGate();
    await run({ depts: ["Fabric"], dept: "Fabric", itemRows: [itemRow()] });
    expect(calls.confirm[0].body).toContain("Choose the design for this element first");
  });
  it("only decided rows left: passes", async () => {
    const { run, calls } = makeGate();
    const r = await run({ multi: true, depts: ["Fabric"], itemRows: [itemRow({ status: "decided" })] });
    expect(r.out).toBe("pass");
    expect(calls.confirm).toHaveLength(0);
  });
  it("lists at most 8 and says how many more", async () => {
    const { run, calls } = makeGate();
    await run({ depts: ["Fabric"], dept: "Fabric", itemRows: Array.from({ length: 11 }, (_, i) => itemRow({ name: "E" + i })) });
    expect(calls.confirm[0].body).toContain("…and 3 more");
  });
  it("Tenting / Structure / Floral single books are not held by overlay rows", async () => {
    for (const d of ["Tenting", "Structure", "Floral", "Lights"]) {
      const { run, calls } = makeGate();
      const r = await run({ depts: [d], dept: d, itemRows: [itemRow()] });
      expect(r.out).toBe("pass");
      expect(calls.elementPlanOf).toBe(0);
    }
  });
});

describe("items-only path: goCarpet is always false, goItems / button label / navigation are right", () => {
  it("Fabric head (dept Fabric): button 'Open Fabric plan', OK click opens the fabreq modal on Fabric planning", async () => {
    const { run, calls } = makeGate();
    await run({ depts: ["Fabric"], dept: "Fabric", deptOptions: ["Fabric"], itemRows: [itemRow()], confirmAnswer: true });
    expect(calls.confirm[0].confirmLabel).toBe("Open Fabric plan");
    expect(calls.setDept).toEqual([]); // already on Fabric
    expect(calls.setOpsView).toEqual(["planning"]);
    expect(calls.setModal).toEqual(["fabreq"]);
    expect(calls.confirm[0].body).toContain("Pick a design for each in Fabric → Fabric plan");
  });
  it("an all-departments download from the Tenting tab switches to Fabric and opens the fabric modal (never the carpet modal)", async () => {
    const { run, calls } = makeGate();
    await run({ multi: true, depts: ["Tenting", "Fabric"], dept: "Tenting", deptOptions: ["Tenting", "Fabric"], itemRows: [itemRow()], carpetRows: openCarpets, confirmAnswer: true });
    expect(calls.confirm[0].confirmLabel).toBe("Open Fabric plan");
    expect(calls.setDept).toEqual(["Fabric"]);
    expect(calls.setModal).toEqual(["fabreq"]);
    expect(calls.setModal).not.toContain("carpet");
  });
  it("declining the dialog navigates nowhere", async () => {
    const { run, calls } = makeGate();
    await run({ multi: true, depts: ["Fabric"], itemRows: [itemRow()], confirmAnswer: false });
    expect(calls.setDept).toEqual([]);
    expect(calls.setModal).toEqual([]);
    expect(calls.setOpsView).toEqual([]);
  });
  it("a person who cannot open Fabric (no Fabric in deptOptions) gets an 'OK' button and is told who to ask - no navigation", async () => {
    const { run, calls } = makeGate();
    await run({ multi: true, depts: ["Tenting"], dept: "Tenting", deptOptions: ["Tenting"], itemRows: [itemRow()], confirmAnswer: true });
    expect(calls.confirm[0].confirmLabel).toBe("OK");
    expect(calls.confirm[0].body).toContain("Ask the Fabric head");
    expect(calls.setModal).toEqual([]);
    expect(calls.setDept).toEqual([]);
  });
});

describe("(c) the existing skips still work", () => {
  const open = { multi: true, depts: ["Tenting", "Fabric"], itemRows: [itemRow()], carpetRows: openCarpets };
  it("gate=false (View deck auto-rebuild) skips and reads no plan", async () => {
    const { run, calls } = makeGate();
    const r = await run({ ...open, gate: false });
    expect(r.out).toBe("pass");
    expect(calls.confirm).toHaveLength(0);
    expect(calls.elementPlanOf).toBe(0);
  });
  it("pdfAllCarpetsRef.current (Deal Check's hidden run) skips", async () => {
    const { run, calls } = makeGate();
    const r = await run({ ...open, allCarpets: true });
    expect(r.out).toBe("pass");
    expect(calls.confirm).toHaveLength(0);
  });
  it("rows dated in the past are never 'open'; a function dated today or later still is; a row with no date still is", async () => {
    let g = makeGate();
    expect((await g.run({ ...open, itemRows: [itemRow({ date: PAST })] })).out).toBe("pass");
    g = makeGate();
    expect((await g.run({ ...open, itemRows: [itemRow({ date: PAST }), itemRow({ date: FUTURE })] })).out).toBe(false);
    g = makeGate();
    expect((await g.run({ ...open, itemRows: [itemRow({ date: "" })] })).out).toBe(false);
    g = makeGate();
    expect((await g.run({ ...open, itemRows: [itemRow({ date: new Date().toLocaleDateString("en-CA") })] })).out).toBe(false);
  });
  it("a double click while the dialog is up returns false without a second dialog", async () => {
    const { run, calls } = makeGate();
    const r = await run({ ...open, gateOpen: true });
    expect(r.out).toBe(false);
    expect(calls.confirm).toHaveLength(0);
  });
  it("carpetGateOpenRef is reset after the dialog closes", async () => {
    const { run } = makeGate();
    expect((await run({ ...open })).gateOpenAfter).toBe(false);
  });
  it("a carpet-only situation never engages the double-click guard (no stuck ref)", async () => {
    const { run } = makeGate();
    const r = await run({ multi: true, depts: ["Tenting"], carpetRows: openCarpets, itemRows: [] });
    expect(r.out).toBe("pass");
    expect(r.gateOpenAfter).toBe(false);
  });
});

describe("callers of exportPdf", () => {
  it("the Deal Check hidden run sets pdfAllCarpetsRef and always clears it", () => {
    expect(/pdfAllCarpetsRef\.current = true;[\s\S]{0,300}?exportPdf\(deptsWithWork, \{ combined: true/.test(src)).toBe(true);
    expect(/finally \{ window\.alert = realAlert; pdfAllCarpetsRef\.current = false;/.test(src)).toBe(true);
  });
  it("the View-deck auto-rebuild passes gate:false", () => {
    expect(src).toMatch(/exportPdf\(\[dept\], \{ view: true, cacheKey: deckKey, gate: false \}\)/);
  });
});

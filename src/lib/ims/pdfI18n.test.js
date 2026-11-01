import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDF_HI, pdfT, formatDateHi, formatDateTimeHi, pdfDate, hindiReportHtml } from "./pdfI18n.js";

const DEVANAGARI = /[ऀ-ॿ]/;

describe("pdfT — the Dept Ops book's words in English or Hindi", () => {
  it("English returns every key exactly as given", () => {
    const t = pdfT("en");
    for (const k of Object.keys(PDF_HI)) if (!k.includes("{")) expect(t(k)).toBe(k);
    expect(t("Not in the dictionary at all")).toBe("Not in the dictionary at all");
  });
  it("an unknown language is English", () => {
    expect(pdfT(undefined)("Qty")).toBe("Qty");
    expect(pdfT("fr")("Qty")).toBe("Qty");
  });
  it("Hindi returns Devanagari", () => {
    const t = pdfT("hi");
    expect(t("Qty")).toBe("मात्रा");
    expect(t("Truss")).toBe("ट्रस");
    expect(t("Floral")).toBe("फ्लोरल");
    expect(t("No zone photo")).toMatch(DEVANAGARI);
  });
  it("every Hindi entry is Devanagari", () => {
    for (const [k, v] of Object.entries(PDF_HI)) expect(v, k).toMatch(DEVANAGARI);
  });
  it("a missing key falls back to the English", () => {
    expect(pdfT("hi")("Some new label")).toBe("Some new label");
    expect(pdfT("hi")("Brand new {n} thing", { n: 3 })).toBe("Brand new 3 thing");
  });
  it("templates fill their values, in both languages", () => {
    expect(pdfT("en")("Zone {n}", { n: "03" })).toBe("Zone 03");
    expect(pdfT("hi")("Zone {n}", { n: "03" })).toBe("ज़ोन 03");
    expect(pdfT("en")("Part {part} of {parts}", { part: 1, parts: 2 })).toBe("Part 1 of 2");
    expect(pdfT("hi")("Part {part} of {parts}", { part: 1, parts: 2 })).toBe("भाग 1 / 2");
  });
  it("a value is never filled a second time", () => {
    expect(pdfT("en")("Inside {kit}", { kit: "{n} box" })).toBe("Inside {n} box");
  });
  it("singular / plural pairs pick by n in English, one form in Hindi", () => {
    const en = pdfT("en"), hi = pdfT("hi");
    expect(en("{n} item|{n} items", { n: 1 })).toBe("1 item");
    expect(en("{n} item|{n} items", { n: 4 })).toBe("4 items");
    expect(en("{n} item|{n} items", { n: 0 })).toBe("0 items");
    expect(hi("{n} item|{n} items", { n: 4 })).toBe("4 आइटम");
    expect(en("{n} truss|{n} trusses", { n: 2 })).toBe("2 trusses");
    expect(en("{dept} fills {trucks} of the {n} truck this event needs|{dept} fills {trucks} of the {n} trucks this event needs", { dept: "Floral", trucks: 0.5, n: 1 }))
      .toBe("Floral fills 0.5 of the 1 truck this event needs");
  });
});

describe("Hindi dates", () => {
  it("month and weekday names in Hindi, Western digits", () => {
    const d = new Date(2026, 7, 29); // Sat 29 Aug 2026
    expect(formatDateHi(d, { weekday: "long" })).toBe("शनिवार, 29 अगस्त 2026");
    expect(formatDateHi(d, { weekday: "short" })).toBe("शनि, 29 अगस्त 2026");
    expect(formatDateHi(d)).toBe("29 अगस्त 2026");
    expect(formatDateHi(d, { year: false })).toBe("29 अगस्त");
    expect(formatDateTimeHi(new Date(2026, 10, 1, 9, 5))).toBe("1 नवंबर 2026, 09:05");
  });
  it("English goes through toLocaleDateString exactly as before", () => {
    const d = new Date(2026, 7, 29);
    const opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    expect(pdfDate("en", d, opts)).toBe(d.toLocaleDateString("en-IN", opts));
    expect(pdfDate("hi", d, opts)).toBe("शनिवार, 29 अगस्त 2026");
  });
  it("a bad date comes back as given", () => {
    expect(formatDateHi("not a date")).toBe("not a date");
  });
});

describe("hindiReportHtml", () => {
  const src = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap"><style>
  body{font-family:"Inter",Arial,sans-serif}h2{font-family:"Playfair Display",Georgia,serif}</style></head><body></body></html>`;
  const out = hindiReportHtml(src);
  it("sets lang, loads and stacks the Devanagari faces, drops letter-spacing and uppercase", () => {
    expect(out).toContain('<html lang="hi">');
    expect(out).toContain("family=Noto+Sans+Devanagari");
    expect(out).toContain("family=Noto+Serif+Devanagari");
    expect(out).toContain('"Inter","Noto Sans Devanagari",Arial');
    expect(out).toContain('"Playfair Display","Noto Serif Devanagari",Georgia');
    expect(out).toMatch(/letter-spacing:0!important;text-transform:none!important/);
  });
});

// ── COVERAGE ── every literal the book passes to t() has its Hindi, so a label added without one fails here.
describe("coverage: every t() literal in DepartmentOpsTab.jsx has a Hindi entry", () => {
  const file = fileURLToPath(new URL("../../pages/ims/DepartmentOpsTab.jsx", import.meta.url));
  const text = readFileSync(file, "utf8");
  const found = new Set();
  // t("…") / t('…') / t(`…`) — a template literal only when it has no ${}
  const re = /(?<![\w$.])t\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\$])*)`)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3];
    found.add(raw.replace(/\\(.)/g, "$1"));
  }
  it("finds the book's labels", () => {
    expect(found.size).toBeGreaterThan(100);
    expect(found.has("No zone photo")).toBe(true);
  });
  it("has a translation for each", () => {
    const missing = [...found].filter(k => !Object.prototype.hasOwnProperty.call(PDF_HI, k));
    expect(missing).toEqual([]);
  });
  it("the department titles are there too (t(dept) is not a literal)", () => {
    for (const d of ["Furniture", "Floral", "Structure", "Tenting", "Transport", "Lighting", "Fabric", "Paint"]) expect(PDF_HI[d], d).toBeTruthy();
  });
});

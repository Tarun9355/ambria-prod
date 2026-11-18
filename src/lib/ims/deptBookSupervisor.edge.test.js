import { describe, it, expect } from "vitest";
import { buildDeptBookHtml } from "./deptBookHtml";

// Dept PDF cover: the site supervisor block (.cv-sup) - placement, escaping, the 3-name cap, combined book, Hindi.
const ctx = (sups, extra = {}) => ({
  dept: "Tenting", sel: { id: "e1", clientName: "Test", date: "2026-12-01", functionsDetail: [{ type: "Wedding", date: "2026-12-01", venue: "Aura", zones: {}, elements: {} }], deptInventory: {} },
  inventory: [], blocks: {}, settings: {}, trussInv: {}, catToDept: () => "", authUser: { name: "x" },
  flowerPatterns: [], mandiCatalogue: [], floralModeBySub: {}, fvSettings: {}, trVenues: [],
  blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
  trussPlanOf: () => [], fabricEntriesOf: () => [], fabricPalettesOf: () => ({}), carpetPlanOf: () => ({ rows: [] }), elementPlanOf: () => ({ rows: [] }),
  zoneLabelFor: (fi, zk) => zk, zoneAdminOrder: [], ...(sups === undefined ? {} : { siteSupervisors: sups }), ...extra,
});
// the cover's event card (from its opening tag to the cover's bottom strip) and the bottom strip itself
const parts = (html) => {
  const cardAt = html.indexOf('<div class="cv-card');
  const bottomAt = html.indexOf('<div class="cv-bottom">');
  const headerEnd = html.indexOf("</header>", bottomAt);
  return { card: html.slice(cardAt, bottomAt), bottom: html.slice(bottomAt, headerEnd), cardAt, bottomAt };
};
const supBlock = (html) => {
  const at = html.indexOf('<div class="cv-sup">');
  return at < 0 ? "" : html.slice(at, html.indexOf("</div></div>", at) + 12);
};

describe("Dept Book cover - supervisor block placement", () => {
  it("inside the event card, before the card closes, never in cv-bottom", () => {
    const html = buildDeptBookHtml(ctx([{ name: "Raja", phone: "7607225147" }]), {}, {}, {});
    const { card, bottom, cardAt, bottomAt } = parts(html);
    expect(cardAt).toBeGreaterThan(-1);
    expect(bottomAt).toBeGreaterThan(cardAt);
    expect(card.startsWith('<div class="cv-card has-sup">')).toBe(true);
    expect(card).toContain('<div class="cv-sup">');
    expect(bottom).not.toContain("cv-sup");
    expect(bottom).not.toContain("Raja");
    // exactly one block, in the cover only
    expect(html.split('<div class="cv-sup">').length - 1).toBe(1);
  });
  it("CSS: the block is absolutely placed bottom-right of a positioned card, and has-sup makes room for it", () => {
    const html = buildDeptBookHtml(ctx([{ name: "Raja", phone: "1" }]), {}, {}, {});
    expect(html).toMatch(/\.cv-card\{position:absolute;/);
    expect(html).toMatch(/\.cv-sup\{position:absolute;right:\d+px;bottom:\d+px/);
    expect(html).toContain(".cv-card.has-sup{padding-bottom:96px}");
  });
  it("siteSupervisors missing from ctx (older callers): no block, no has-sup", () => {
    const html = buildDeptBookHtml(ctx(undefined), {}, {}, {});
    expect(html).not.toContain('<div class="cv-sup">');
    expect(html).not.toContain("has-sup\"");
    expect(html).toContain('<div class="cv-card">');
  });
});

describe("Dept Book cover - supervisor names and numbers", () => {
  it("HTML in a name or phone is escaped, not rendered", () => {
    const html = buildDeptBookHtml(ctx([{ name: `<b>Raj</b> "R" & 'S'`, phone: `<img src=x onerror=alert(1)>` }]), {}, {}, {});
    const block = supBlock(html);
    expect(block).toContain("&lt;b&gt;Raj&lt;/b&gt; &quot;R&quot; &amp; &#39;S&#39;");
    expect(block).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(block).not.toContain("<b>");
    expect(block).not.toContain("<img");
  });
  it("no phone: the name alone, no empty number span", () => {
    const block = supBlock(buildDeptBookHtml(ctx([{ name: "Manish", phone: "" }]), {}, {}, {}));
    expect(block).toContain('<div class="v">Manish</div>');
    expect(block).not.toContain("<span>");
  });
  it("at most 3 supervisors printed, in the order given", () => {
    const four = ["A", "B", "C", "D"].map((n, i) => ({ name: n, phone: String(i) }));
    const block = supBlock(buildDeptBookHtml(ctx(four), {}, {}, {}));
    expect((block.match(/<div class="v">/g) || []).length).toBe(3);
    expect(block.indexOf("A<span>")).toBeLessThan(block.indexOf("B<span>"));
    expect(block).toContain("C<span>2</span>");
    expect(block).not.toContain("D<span>");
  });
  it("label is 'Site supervisor' for one or many (no plural form)", () => {
    const block = supBlock(buildDeptBookHtml(ctx([{ name: "A", phone: "" }, { name: "B", phone: "" }]), {}, {}, {}));
    expect(block).toContain('<div class="k">Site supervisor</div>');
  });
});

describe("Dept Book cover - combined vs single-department book, Hindi", () => {
  const sups = [{ name: "Raja", phone: "7607225147" }];
  it("the combined (all departments) book carries the same block in the event card", () => {
    const html = buildDeptBookHtml(ctx(sups), {}, {}, { combined: true, depts: ["Tenting", "Fabric", "Lighting"] });
    const { card, bottom } = parts(html);
    expect(card).toContain("Raja<span>7607225147</span>");
    expect(bottom).not.toContain("Raja");
  });
  it("a shared single book (Fabric & Tenting) carries it too", () => {
    const html = buildDeptBookHtml(ctx(sups), {}, {}, { depts: ["Fabric", "Tenting"] });
    expect(parts(html).card).toContain("Raja<span>7607225147</span>");
  });
  it("Hindi: the label is translated, the phone digits are kept, the name goes through hn() and stays escaped", () => {
    const collect = new Set();
    const html = buildDeptBookHtml(ctx([{ name: "Raja <x>", phone: "7607225147" }]), {}, {}, { lang: "hi", collect });
    const block = supBlock(html);
    expect(block).toContain("साइट सुपरवाइज़र");
    expect(block).not.toContain("Site supervisor");
    expect(block).toContain("<span>7607225147</span>");
    expect(block).not.toContain("<x>");
  });
  it("Hindi with a known name map: the Devanagari name is printed", () => {
    const html = buildDeptBookHtml(ctx([{ name: "Raja", phone: "1" }]), {}, {}, { lang: "hi", names: { raja: "राजा", Raja: "राजा" } });
    const block = supBlock(html);
    expect(block).toMatch(/<div class="v">[^<]*[ऀ-ॿ][^<]*<span>1<\/span>/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═══ renderDeptBook: onFile hands the file up instead of saving it (Deal Check's hidden IMS frame) ═══
// jsPDF / html2canvas / the Supabase-backed helpers are mocked; document is a recording fake (node env, no jsdom).
const h = vi.hoisted(() => ({ pdfs: [], h2c: null }));

vi.mock("jspdf", () => {
  class jsPDF {
    constructor() {
      this.saved = []; this.pages = 1; this.images = 0;
      this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 }, getNumberOfPages: () => this.pages };
      h.pdfs.push(this);
    }
    setFillColor() {} rect() {} setFontSize() {} setTextColor() {} text() {} setPage() {}
    addPage() { this.pages++; }
    addImage() { this.images++; }
    save(n) { this.saved.push(n); }
    output(kind) { if (kind !== "blob") throw new Error("unexpected output kind " + kind); return new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }); }
  }
  return { jsPDF };
});
vi.mock("html2canvas", () => ({ default: (...a) => h.h2c(...a) }));
vi.mock("./kv", () => ({ kvGet: async () => null }));
vi.mock("./hindiNames", () => ({ loadHindiNames: async () => new Map(), ensureHindiNames: async () => {} }));
vi.mock("../studio/brand.js", () => ({ LOGO_ASSET: null, LOGO_BOX: { x: 0, y: 0, cw: 1, ch: 1 } }));

import { renderDeptBook } from "./deptBookPdf.js";

let anchors, revokedUrls, alerts;
const fakeCanvas = () => ({ width: 1191, height: 600, toDataURL: () => "data:image/jpeg;base64,AAAA" });
const block = () => ({ style: {}, className: "b", tagName: "DIV", hasAttribute: () => false, contains: () => false, querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 600, width: 794 }) });

beforeEach(() => {
  h.pdfs.length = 0;
  anchors = []; revokedUrls = []; alerts = [];
  h.h2c = async () => fakeCanvas();
  const sheet = { scrollHeight: 600, querySelectorAll: () => [block()] };
  const doc = { open() {}, write() {}, close() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => sheet, fonts: null, body: {} };
  vi.stubGlobal("window", { location: { origin: "https://x" } });
  vi.stubGlobal("alert", (m) => alerts.push(String(m)));
  vi.stubGlobal("document", {
    body: { appendChild() {} },
    head: { appendChild() {} },
    querySelector: () => null,
    createElement: (tag) => (tag === "iframe"
      ? { style: {}, setAttribute() {}, contentDocument: doc, remove() {} }
      : tag === "link"
        ? { setAttribute() {}, set onload(f) { Promise.resolve().then(f); }, set onerror(_f) {} }
        : { click() { anchors.push({ href: this.href, download: this.download }); }, remove() {} }),
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:https://x/u1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => revokedUrls.push(u));
  vi.spyOn(console, "error").mockImplementation((...a) => { if (process.env.DBG) process.stderr.write(String((a[1] && a[1].stack) || a[1] || a[0]) + "\n"); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const base = () => ({
  buildHtml: () => "<html><body><div id='sheet'></div></body></html>",
  lang: "en", multi: true, dept: null, depts: ["Floral", "Tenting"],
  sel: { clientName: "Mehra" }, selDateStr: "2026-12-01", onNote: () => {},
});

describe("renderDeptBook - onFile", () => {
  it("hands the PDF Blob + name to onFile and does NOT pdf.save", async () => {
    const onFile = vi.fn();
    const r = await renderDeptBook({ ...base(), onFile });
    expect(r.ok).toBe(true);
    expect(onFile).toHaveBeenCalledTimes(1);
    const [blob, name] = onFile.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
    expect(name).toBe("All departments - Mehra - 2026-12-01.pdf");
    expect(h.pdfs[0].saved).toEqual([]);
  });

  it("the Hindi book's name carries '(Hindi)'", async () => {
    const onFile = vi.fn();
    await renderDeptBook({ ...base(), lang: "hi", onFile });
    expect(onFile.mock.calls[0][1]).toBe("All departments - Mehra - 2026-12-01 (Hindi).pdf");
  });

  it("without onFile it still saves with pdf.save (IMS's own Download PDF button is unchanged)", async () => {
    const r = await renderDeptBook({ ...base() });
    expect(r.ok).toBe(true);
    expect(h.pdfs[0].saved).toEqual(["All departments - Mehra - 2026-12-01.pdf"]);
  });

  it("view:true wins over onFile: a blob URL comes back and onFile is not called", async () => {
    const onFile = vi.fn();
    const r = await renderDeptBook({ ...base(), view: true, onFile });
    expect(onFile).not.toHaveBeenCalled();
    expect(r.url).toBe("blob:https://x/u1");
  });

  it("every block failing -> HTML fallback is handed to onFile (not downloaded in the frame); ok false; no anchor clicked", async () => {
    h.h2c = async () => { throw new Error("canvas too big"); };
    const onFile = vi.fn();
    const r = await renderDeptBook({ ...base(), onFile });
    expect(r.ok).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(1);
    const [blob, name] = onFile.mock.calls[0];
    expect(blob.type).toMatch(/^text\/html/);
    expect(name).toMatch(/^All departments \(partial — export failed\) - Mehra - 2026-12-01\.html$/);
    expect(anchors).toHaveLength(0);
    expect(alerts.join("\n")).toContain("downloaded as an HTML file instead");
  });

  it("the same failure WITHOUT onFile downloads the .html from the calling page (anchor click) and revokes 10 s later", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true });
    h.h2c = async () => { throw new Error("canvas too big"); };
    const r = await renderDeptBook({ ...base() });
    expect(r.ok).toBe(false);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toMatch(/\.html$/);
    expect(revokedUrls).toHaveLength(0);
    vi.advanceTimersByTime(10100);
    expect(revokedUrls).toEqual(["blob:https://x/u1"]);
    vi.useRealTimers();
  });

  it("a section that fails once at 1.5x is retried smaller and the PDF is still handed up", async () => {
    let n = 0;
    h.h2c = async (el, opts) => { n++; if (opts.scale >= 1.5) throw new Error("Canvas exceeds max size"); return fakeCanvas(); };
    const onFile = vi.fn();
    const r = await renderDeptBook({ ...base(), onFile });
    expect(r.ok).toBe(true);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(n).toBeGreaterThan(1);
  });

  it("every canvas blank (Safari past its memory): retried at smaller scales, then NOT a blank-page PDF - the HTML report is handed up instead, with a reason (fixed)", async () => {
    h.h2c = async () => ({ width: 1191, height: 600, toDataURL: () => "data:," });
    const onFile = vi.fn();
    const r = await renderDeptBook({ ...base(), onFile });
    expect(r.ok).toBe(false);
    expect(h.pdfs[0].images).toBe(0);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][1]).toMatch(/\.html$/);
    expect(alerts.join(" ")).toMatch(/every section failed to render/);
  });
  it("a blank canvas at the first scale only: the next scale down is used", async () => {
    let n = 0;
    h.h2c = async () => ({ width: 1191, height: 600, toDataURL: () => (++n === 1 ? "data:," : "data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAAAAAA") });
    const r = await renderDeptBook({ ...base(), onFile: vi.fn() });
    expect(r.ok).toBe(true);
    expect(h.pdfs[0].images).toBe(1);
  });
});

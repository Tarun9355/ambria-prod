import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Deal Check's "All departments PDF" on Safari (owner's video 2026-11-18: "Building PDF…", no file on a Mac). The hidden IMS frame
// no longer saves the file itself - Safari ignores a download started in a hidden frame with no click there. It hands the PDF up
// and Deal Check saves it from the page, with a "⬇ Save PDF" link as the sure way.
const read = (p) => readFileSync(resolve(__dirname, p), "utf8");

describe("Deal Check PDF: saved by the page, not the hidden frame", () => {
  it("renderDeptBook hands the blob to onFile instead of pdf.save when asked", () => {
    const src = read("../../lib/ims/deptBookPdf.js");
    expect(src).toMatch(/else if \(typeof onFile === "function"\) onFile\(pdf\.output\("blob"\), fileName\);\s*else pdf\.save\(fileName\);/);
  });
  it("the frame's auto run passes onFile and posts the file up", () => {
    const src = read("../../pages/ims/DepartmentOpsTab.jsx");
    expect(src).toContain('ok = await exportPdf(deptsWithWork, { combined: true, onFile: (blob, name) => tell("file", { blob, name }) });');
    expect(src).toMatch(/onNote: setExportNote, onFile,/);
  });
  it("Deal Check saves the posted file from the page and keeps a Save PDF link", () => {
    const src = read("./DeptPdfButton.jsx");
    expect(src).toContain('if (d.phase === "file" && d.blob)');
    expect(src).toContain("a.download = name;");
    expect(src).toContain("⬇ Save PDF");
    expect(src).not.toContain('"PDF downloaded"');
  });
});

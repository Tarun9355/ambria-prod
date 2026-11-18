// Deal Check's "All departments PDF" in English or Hindi (owner ask 2026-11-18): the choice rides to IMS's hidden frame as
// &pdfLang=, and Dept Ops uses it for that run only - never over this browser's own IMS language choice.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const btn = readFileSync(new URL("./DeptPdfButton.jsx", import.meta.url), "utf8");
const ops = readFileSync(new URL("../../pages/ims/DepartmentOpsTab.jsx", import.meta.url), "utf8");

describe("Deal Check PDF language", () => {
  it("the frame URL carries the chosen language", () => {
    expect(btn).toContain("#/ims?pdfEvent=${encodeURIComponent(orderId)}&pdfLang=${lang}");
    expect(btn).toContain('langBtn("hi", "हिं", "Hindi")');
  });
  it("Dept Ops takes it only inside the PDF frame, and does not store it", () => {
    const start = ops.indexOf("const [pdfLang, setPdfLangState] = useState(() => {");
    const init = ops.slice(start, ops.indexOf("});", start));
    expect(init).toMatch(/pdfLang=\(hi\|en\)/);
    expect(init).toContain("window.__AMBRIA_PDF_FRAME__");
    expect(init).not.toContain("setItem");
  });
});

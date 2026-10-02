// ─── Excel (.xlsx) export helpers ─────────────────────────────────────────────
// ExcelJS is loaded from a CDN on first use, the same way Studio's cost-sheet export does
// (StudioSummary.jsx) — cdnjs first, jsDelivr as the fallback — so it never weighs on the bundle.

export async function loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
    s.onload = resolve;
    s.onerror = () => {
      const s2 = document.createElement("script");
      s2.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
      s2.onload = resolve;
      s2.onerror = () => reject(new Error("Excel library unavailable — check the connection and try again"));
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
  return window.ExcelJS;
}

/** Writes the workbook and hands it to the browser as a download. */
export async function downloadWorkbook(workbook, fileName) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/** Bold white-on-dark header row + frozen top row — the house style for every sheet here. */
export function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

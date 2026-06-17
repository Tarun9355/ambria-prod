// PDF / spreadsheet / zip libs. The reference IMS app loaded pdf.js, XLSX and JSZip
// from CDN at runtime (window.pdfjsLib / window.XLSX / window.JSZip) and rendered PPT/PDF
// design decks to JPEG slides for Claude Vision. We replicate that faithfully — inject the
// same CDN <script> tags once on mount; extractPdfPages then uses window.pdfjsLib.
const PDF_MAX_PAGES = 15;
const PDF_RENDER_WIDTH = 1200; // px — enough detail for AI, keeps payload small
const PDF_JPEG_QUALITY = 0.75;

// Inject the CDN libs once (idempotent). Faithful to the reference's runtime <script> loads.
export function ensureCdnLibs() {
  if (typeof window === "undefined") return;
  if (!window.XLSX && !document.querySelector('script[data-ambria-lib="xlsx"]')) {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.dataset.ambriaLib = "xlsx";
    document.head.appendChild(s);
  }
  if (!window.JSZip && !document.querySelector('script[data-ambria-lib="jszip"]')) {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.dataset.ambriaLib = "jszip";
    document.head.appendChild(s);
  }
  if (!window.pdfjsLib && !document.querySelector('script[data-ambria-lib="pdfjs"]')) {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.dataset.ambriaLib = "pdfjs";
    s.onload = () => { if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; };
    document.head.appendChild(s);
  }
}

// Render a base64 PDF to JPEG slides (capped at PDF_MAX_PAGES). Faithful to reference.
export async function extractPdfPages(base64Data, onProgress) {
  if (!window.pdfjsLib) {
    throw new Error("PDF.js not loaded yet. Please wait a moment and try again.");
  }
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  const totalPages = pdf.numPages;
  const pagesToRender = Math.min(totalPages, PDF_MAX_PAGES);
  const images = [];

  for (let p = 1; p <= pagesToRender; p++) {
    if (onProgress) onProgress(p, pagesToRender, totalPages);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const scale = PDF_RENDER_WIDTH / vp.width;
    const scaledVp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = scaledVp.width;
    canvas.height = scaledVp.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: scaledVp }).promise;
    const jpegData = canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY).split(",")[1];
    images.push({ media_type: "image/jpeg", data: jpegData, pageNum: p });
    canvas.width = 0; canvas.height = 0;
  }
  return { images, totalPages, rendered: pagesToRender, skipped: Math.max(0, totalPages - pagesToRender) };
}

import { useState, useEffect, useRef } from "react";

// "All departments PDF" for a deal, from Deal Check. The book is built by IMS's Planning → Dept Ops
// (it needs that page's own data and layout), so this opens IMS in an invisible frame on that event
// (#/ims?pdfEvent=ID); IMS selects the event, builds the combined PDF and downloads it, and reports back
// here. Nothing on screen changes — the person stays in Deal Check.
//
// The frame is same-origin, so it can post back, and main.jsx gives it a private in-memory
// sessionStorage so it cannot disturb the tab IMS remembers for this browser.
const NOTE_MS = 7000;
// The book's language, chosen here (owner ask 2026-11-18): Hindi by default, English when picked - remembered per viewer in this
// browser (key v2: everyone starts on Hindi once, also a viewer who had picked EN under the old key). It rides to
// the frame as &pdfLang=, which Dept Ops uses for that one run - IMS's own EN | हिं choice (its screen + PDF) is left alone.
const LANG_KEY = "studio.dealCheck.pdfLang.v2";
const readLang = () => { try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "hi"; } catch { return "hi"; } };

export default function DeptPdfButton({ eventOrderId, clientKey, border = "rgba(26,26,46,0.15)" }) {
  const [run, setRun] = useState(false);
  const [lang, setLangState] = useState(readLang);
  const setLang = (l) => { const v = l === "hi" ? "hi" : "en"; setLangState(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* private window: this session only */ } };
  const [note, setNote] = useState("");
  // the last PDF the frame handed up: { href, name } - kept a while as a "⬇ Save PDF" link, the sure way on Safari (a click of the
  // viewer's own), in case the automatic save below was held back
  const [file, setFile] = useState(null);
  // the link's own 2 minutes, and the file's URL freed when it goes (two effects: one timer must not be cancelled by the other's cleanup)
  useEffect(() => {
    if (!file) return undefined;
    const t = setTimeout(() => setFile(null), 120000);
    return () => clearTimeout(t);
  }, [file]);
  useEffect(() => () => { if (file?.href) URL.revokeObjectURL(file.href); }, [file]);
  const heard = useRef(false);
  const gotFile = useRef(false); // the frame's file reached this page in the current run
  // Once this deal's event order has been seen, the button stays for as long as this deal is open. The
  // order is looked up in a list that live updates replace row by row, and for a moment a row can come
  // back without its details — the lookup then found nothing and the button blinked out and back.
  const seen = useRef({ key: null, id: null });
  if (seen.current.key !== clientKey) seen.current = { key: clientKey, id: null };
  if (eventOrderId) seen.current.id = eventOrderId;
  const orderId = seen.current.id;

  const finish = (text, ms = NOTE_MS) => {
    setRun(false);
    setNote(text);
    setTimeout(() => setNote(""), ms);
  };

  useEffect(() => {
    if (!run) return undefined;
    heard.current = false;
    gotFile.current = false;
    // Never hangs: a frame silent for 90 s (not signed in here, a stuck load…) or a run past 5 minutes ends the attempt.
    // The frame says "alive" as it loads, opens the event and builds (IMS / DepartmentOpsTab), which restarts the 90 s. Before,
    // only the final "done" counted, so a run past 90 s (a Hindi book, which also asks for its names) was cut off mid-build.
    const onQuiet = () => finish(heard.current ? "The PDF stopped responding — try again" : "Could not start — refresh the page and try again", 15000);
    let quiet = setTimeout(onQuiet, 90000);
    const onMsg = (e) => {
      const d = e.data;
      if (e.origin !== window.location.origin || !d || d.type !== "ambria-dept-pdf") return;
      heard.current = true;
      // the frame is alive and working (a Hindi book also asks for its names - well past 90 s on a big event): the quiet timer restarts
      if (d.phase === "alive") { clearTimeout(quiet); quiet = setTimeout(onQuiet, 90000); return; }
      // the finished PDF from the frame - saved from this page, not from inside the hidden frame, which Safari does not allow
      // without a click there (owner's video 2026-11-18: "Building PDF…" and no file on a Mac)
      if (d.phase === "file" && d.blob) {
        gotFile.current = true;
        clearTimeout(quiet); // the file is here - nothing left to wait for from the frame
        const name = d.name || "All departments.pdf";
        const html = /\.html$/i.test(name); // the build threw and the frame sent its fallback report instead of the PDF
        // the bytes are copied first, so the file outlives the frame (it is removed as the run ends); the copy is what is saved
        Promise.resolve(typeof d.blob.arrayBuffer === "function" ? d.blob.arrayBuffer().then((buf) => new Blob([buf], { type: d.blob.type || (html ? "text/html" : "application/pdf") })) : d.blob)
          .catch(() => d.blob)
          .then((blob) => {
            const href = URL.createObjectURL(blob);
            try {
              const a = document.createElement("a");
              a.href = href; a.download = name; a.rel = "noopener";
              document.body.appendChild(a); a.click(); a.remove();
            } catch (err) { console.warn("[dept pdf] auto save failed - the Save link is there:", err); }
            setFile({ href, name }); // the link stays for 2 minutes
            finish(html
              ? "The PDF could not be built - a web page of the report is ready, open it and print to PDF" + (d.notes?.length ? " — " + d.notes[0] : "")
              : "PDF ready — if it didn't download, tap ⬇ Save PDF", html ? 15000 : 12000);
          })
          .catch((err) => { console.warn("[dept pdf] could not keep the file:", err); finish("The PDF was built but could not be saved — try again", 15000); });
        return;
      }
      // "ready", not "downloaded": a browser can hold the automatic save back - the Save PDF link beside it then saves it
      // a "done" with no file before it is not a PDF: say so instead of "ready" (the file post failed on the way)
      if (d.phase === "done") finish(gotFile.current ? "PDF ready" + (d.notes?.length ? " — " + d.notes[0] : "") : "The PDF was built but did not reach this page — try again", gotFile.current && !d.notes?.length ? NOTE_MS : 15000);
      else if (d.phase === "error") finish(d.reason || "Could not build the PDF" + (d.notes?.length ? " — " + d.notes[0] : ""), 15000);
    };
    window.addEventListener("message", onMsg);
    const cap = setTimeout(() => finish("The PDF took too long — stopped", 15000), 300000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(quiet); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  if (!orderId) return null;
  const startRun = () => { setNote(""); setFile(null); setRun(true); };
  const frameUrl = `${window.location.origin}${window.location.pathname}#/ims?pdfEvent=${encodeURIComponent(orderId)}&pdfLang=${lang}`;
  const langBtn = (k, label, name) => (
    <button key={k} type="button" onClick={() => setLang(k)} disabled={run} aria-pressed={lang === k} title={`PDF in ${name}`}
      style={{ height: 28, padding: "0 10px", borderRadius: 999, border: "none", cursor: run ? "default" : "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
        background: lang === k ? "#1A1A2E" : "transparent", color: lang === k ? "#fff" : "#1A1A2E", opacity: run && lang !== k ? 0.5 : 1 }}>{label}</button>
  );
  return (
    <>
      {run && <iframe title="dept-pdf" src={frameUrl} aria-hidden="true" tabIndex={-1} style={{ position: "fixed", top: 0, left: -20000, width: 1400, height: 900, opacity: 0, pointerEvents: "none", border: 0 }} />}
      {note && <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1A2E", maxWidth: 260 }}>{note}</span>}
      {/* the finished file, one click away - if the browser held the automatic download back (Safari), this always works */}
      {file && !run && (
        <a href={file.href} download={file.name} title={`Save ${file.name}`}
          style={{ height: 32, padding: "0 12px", borderRadius: 999, background: "#1A1A2E", color: "#fff", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", whiteSpace: "nowrap" }}>
          {/\.html$/i.test(file.name) ? "⬇ Save report (.html)" : "⬇ Save PDF"}
        </a>
      )}
      {/* the book's language - English or Hindi */}
      <span role="group" aria-label="PDF language" style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: 3, borderRadius: 999, border: `1px solid ${border}` }}>
        {langBtn("en", "EN", "English")}{langBtn("hi", "हिं", "Hindi")}
      </span>
      <button onClick={startRun} disabled={run}
        title="One PDF with every department's plan for this event, as IMS Planning builds it — from the last synced Deal Check figures"
        style={{ height: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${border}`, background: "transparent", color: "#1A1A2E", fontSize: 12.5, fontWeight: 700, cursor: run ? "default" : "pointer", opacity: run ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
        {run
          ? <><span aria-hidden="true" style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid rgba(26,26,46,0.2)", borderTopColor: "#2563EB", display: "inline-block", animation: "dcpdfspin .8s linear infinite" }} />Building PDF…</>
          : <>📄 All departments PDF{lang === "hi" ? " · हिं" : ""}</>}
      </button>
      <style>{"@keyframes dcpdfspin{to{transform:rotate(360deg)}}"}</style>
    </>
  );
}

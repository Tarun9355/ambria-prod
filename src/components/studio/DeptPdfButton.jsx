import { useState, useEffect, useRef } from "react";

// "All departments PDF" for a deal, from Deal Check. The book is built by IMS's Planning → Dept Ops
// (it needs that page's own data and layout), so this opens IMS in an invisible frame on that event
// (#/ims?pdfEvent=ID); IMS selects the event, builds the combined PDF and downloads it, and reports back
// here. Nothing on screen changes — the person stays in Deal Check.
//
// The frame is same-origin, so it can post back, and main.jsx gives it a private in-memory
// sessionStorage so it cannot disturb the tab IMS remembers for this browser.
const NOTE_MS = 7000;
// The book's language, chosen here (owner ask 2026-11-18): English or Hindi, remembered per viewer in this browser. It rides to
// the frame as &pdfLang=, which Dept Ops uses for that one run - IMS's own EN | हिं choice (its screen + PDF) is left alone.
const LANG_KEY = "studio.dealCheck.pdfLang";
const readLang = () => { try { return localStorage.getItem(LANG_KEY) === "hi" ? "hi" : "en"; } catch { return "en"; } };

export default function DeptPdfButton({ eventOrderId, clientKey, border = "rgba(26,26,46,0.15)" }) {
  const [run, setRun] = useState(false);
  const [lang, setLangState] = useState(readLang);
  const setLang = (l) => { const v = l === "hi" ? "hi" : "en"; setLangState(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* private window: this session only */ } };
  const [note, setNote] = useState("");
  const heard = useRef(false);
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
    const onMsg = (e) => {
      const d = e.data;
      if (e.origin !== window.location.origin || !d || d.type !== "ambria-dept-pdf") return;
      heard.current = true;
      if (d.phase === "done") finish("PDF downloaded" + (d.notes?.length ? " — " + d.notes[0] : ""), d.notes?.length ? 15000 : NOTE_MS);
      else if (d.phase === "error") finish(d.reason || "Could not build the PDF" + (d.notes?.length ? " — " + d.notes[0] : ""), 15000);
    };
    window.addEventListener("message", onMsg);
    // Never hangs: nothing heard in 90 s (not signed in here, a slow load…) or a run
    // past 4 minutes ends the attempt.
    const quiet = setTimeout(() => { if (!heard.current) finish("Could not start — refresh the page and try again", 15000); }, 90000);
    const cap = setTimeout(() => finish("The PDF took too long — stopped", 15000), 240000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(quiet); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  if (!orderId) return null;
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
      {/* the book's language - English or Hindi */}
      <span role="group" aria-label="PDF language" style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: 3, borderRadius: 999, border: `1px solid ${border}` }}>
        {langBtn("en", "EN", "English")}{langBtn("hi", "हिं", "Hindi")}
      </span>
      <button onClick={() => { setNote(""); setRun(true); }} disabled={run}
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

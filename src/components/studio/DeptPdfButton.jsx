import { useState, useEffect, useRef } from "react";

// "All departments PDF" for a deal, from Deal Check. The book is built by IMS's Planning → Dept Ops
// (it needs that page's own data and layout), so this opens IMS in an invisible frame on that event
// (#/ims?pdfEvent=ID); IMS selects the event, builds the combined PDF and downloads it, and reports back
// here. Nothing on screen changes — the person stays in Deal Check.
//
// The frame is same-origin, so it can post back, and main.jsx gives it a private in-memory
// sessionStorage so it cannot disturb the tab IMS remembers for this browser.
const NOTE_MS = 7000;

export default function DeptPdfButton({ eventOrderId, border = "rgba(26,26,46,0.15)" }) {
  const [run, setRun] = useState(false);
  const [note, setNote] = useState("");
  const heard = useRef(false);

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
    // Never hangs: nothing heard in 90 s (not signed in to IMS here, no access to Planning…) or a run
    // past 4 minutes ends the attempt.
    const quiet = setTimeout(() => { if (!heard.current) finish("Could not start — open IMS once in this browser and try again", 15000); }, 90000);
    const cap = setTimeout(() => finish("The PDF took too long — stopped", 15000), 240000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(quiet); clearTimeout(cap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const frameUrl = `${window.location.origin}${window.location.pathname}#/ims?pdfEvent=${encodeURIComponent(eventOrderId)}`;
  return (
    <>
      {run && <iframe title="dept-pdf" src={frameUrl} aria-hidden="true" tabIndex={-1} style={{ position: "fixed", top: 0, left: -20000, width: 1400, height: 900, opacity: 0, pointerEvents: "none", border: 0 }} />}
      {note && <span style={{ fontSize: 12, fontWeight: 600, color: "#1A1A2E", maxWidth: 260 }}>{note}</span>}
      <button onClick={() => { setNote(""); setRun(true); }} disabled={run}
        title="One PDF with every department's plan for this event, as IMS Planning builds it — from the last synced Deal Check figures"
        style={{ height: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${border}`, background: "transparent", color: "#1A1A2E", fontSize: 12.5, fontWeight: 700, cursor: run ? "default" : "pointer", opacity: run ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
        {run
          ? <><span aria-hidden="true" style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid rgba(26,26,46,0.2)", borderTopColor: "#2563EB", display: "inline-block", animation: "dcpdfspin .8s linear infinite" }} />Building PDF…</>
          : <>📄 All departments PDF</>}
      </button>
      <style>{"@keyframes dcpdfspin{to{transform:rotate(360deg)}}"}</style>
    </>
  );
}

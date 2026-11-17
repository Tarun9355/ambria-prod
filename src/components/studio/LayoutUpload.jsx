import { useRef, useState } from "react";
import { uploadToStorage, STORAGE_FOLDERS } from "../../lib/storage";
import { fitUrl } from "../../lib/studio/thumb.js";
import LayoutViewer from "./LayoutViewer.jsx";

// Build's "Layout" control, beside the Flower Palette (owner ask 2026-11-17): the venue layout / floor plan for THIS function,
// as an image. Empty: "+ Layout" opens the file picker. Set: a small thumbnail chip that opens the layout full screen, with
// Replace and Remove there. The URL is the function's own (clientLayoutUrl for function 1, extraFunctions[i].layoutUrl for the
// rest) and reaches Deal Check and IMS with the function - the Dept Book prints it on a full page right after the cover.
export default function LayoutUpload({ value, onChange, accent, border, cardBg, textP, textS }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const pick = () => fileRef.current && fileRef.current.click();
  const upload = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type || "")) { alert("Layout must be an image — JPG or PNG. A PDF layout: export or screenshot it as an image first."); return; }
    setBusy(true);
    try { onChange(await uploadToStorage(file, STORAGE_FOLDERS.CLIENT)); setOpen(false); }
    catch (e) { alert("Layout upload failed: " + (e?.message || e)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const chip = { display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 10px", borderRadius: 8, border: `1px solid ${border}`, background: cardBg, fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" };
  return (
    <>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: textP, marginLeft: 10 }}>Layout</span>
      {!value
        ? <button type="button" onClick={pick} disabled={busy} title="Upload this function's venue layout (JPG / PNG) — shown in Deal Check and on its own page in the Dept PDF"
            style={{ ...chip, color: busy ? textS : accent, borderStyle: busy ? "solid" : "dashed" }}>{busy ? "Uploading…" : "+ Upload"}</button>
        : <button type="button" onClick={() => setOpen(true)} disabled={busy} title="View, replace or remove the layout"
            style={{ ...chip, color: textP, padding: "0 10px 0 3px" }}>
            <img src={fitUrl(value, 40)} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: "cover", background: "#eee" }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            {busy ? "Uploading…" : "View"}
          </button>}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => upload(e.target.files && e.target.files[0])} />
      {open && value && (
        <LayoutViewer layouts={[{ key: "this", label: "", url: value }]} onClose={() => setOpen(false)}
          actions={() => (<>
            <button type="button" onClick={pick} disabled={busy} style={{ ...chip, height: 32, color: "#1A1A2E", background: "#fff", border: "1px solid #fff" }}>{busy ? "Uploading…" : "Replace"}</button>
            <button type="button" onClick={() => { if (window.confirm("Remove this function's layout?")) { onChange(""); setOpen(false); } }}
              style={{ ...chip, height: 32, color: "#fff", background: "#B91C1C", border: "1px solid #B91C1C" }}>Remove</button>
          </>)} />
      )}
    </>
  );
}

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useConfirm } from "../../components/ui";
import { makeEventPlans } from "../../lib/ims/eventPlans";
import { buildDeptBookHtml } from "../../lib/ims/deptBookHtml";
import { renderDeptBook } from "../../lib/ims/deptBookPdf";
import useFixedVenueSettings from "../../lib/ims/useFixedVenueSettings";
import { kvGet } from "../../lib/ims/kv";
import { RC_SK_TR } from "../../lib/studio/keys";
import PdfLangToggle from "./PdfLangToggle";

const PDF_LANG_KEY = "ims.deptOps.pdfLang"; // same key DepartmentOpsTab.jsx uses, so the choice follows the person, not the screen

// The same "All departments" combined production book DepartmentOpsTab.jsx's own Download PDF
// button builds — reused here via buildDeptBookHtml/renderDeptBook (lib/ims/deptBookHtml.js,
// deptBookPdf.js) rather than a second copy of that ~2000-line template + renderer. This page has
// no per-department tabs, so there is no "this department only" option — only the combined book
// makes sense here, which is also the one every zone page already tags each item's department on.
export default function SitePdfButton({ sel, settings, inventory, blocks, trussInv, rateCardCategories, eventOrders, authUser, catToDept }) {
  const [exporting, setExporting] = useState(null); // "download" | "view" | null
  const [pdfLang, setPdfLang] = useState(() => { try { return localStorage.getItem(PDF_LANG_KEY) || "en"; } catch { return "en"; } });
  const [deckView, setDeckView] = useState(null); // {url, name} — the in-page viewer
  const deckUrlRef = useRef(null); // the blob URL behind deckView, so it can be revoked on close/replace
  const [confirm, confirmDialog] = useConfirm();
  const fvSettings = useFixedVenueSettings(settings);
  const [trVenues, setTrVenues] = useState([]);
  useEffect(() => {
    let on = true;
    kvGet(RC_SK_TR).then((v) => {
      let o = v;
      for (let i = 0; i < 2 && typeof o === "string"; i++) { try { o = JSON.parse(o); } catch { break; } }
      if (on && Array.isArray(o?.venues)) setTrVenues(o.venues);
    }).catch(() => {});
    return () => { on = false; };
  }, []);
  // Revoke whatever blob URL is behind the viewer the moment it's no longer shown — nothing else
  // ever held a reference to clean it up, and a combined book's PDF can be tens of MB.
  useEffect(() => () => { if (deckUrlRef.current) URL.revokeObjectURL(deckUrlRef.current); }, []);
  const closeDeck = () => { if (deckUrlRef.current) URL.revokeObjectURL(deckUrlRef.current); deckUrlRef.current = null; setDeckView(null); };

  const setLang = (v) => { setPdfLang(v); try { localStorage.setItem(PDF_LANG_KEY, v); } catch { /* private window — just won't be remembered */ } };

  const flowerPatterns = Array.isArray(settings?.flowerPatterns) ? settings.flowerPatterns : [];
  const mandiCatalogue = Array.isArray(settings?.mandiCatalogue) ? settings.mandiCatalogue : [];
  const floralModeBySub = new Map((rateCardCategories || []).map((r) => [String(r?.id ?? "").trim().replace(/\s+/g, " ").toLowerCase(), r?.floral_mode]));

  const buildHtml = (zoneLabels, zoneAdminOrder, logos, opts) => {
    const plans = makeEventPlans({ sel, inventory, blocks, eventOrders, settings, trussInv });
    return buildDeptBookHtml({
      dept: null, sel, inventory, blocks, settings, trussInv, catToDept, authUser,
      flowerPatterns, mandiCatalogue, floralModeBySub, fvSettings, trVenues,
      // Department-only sections (loading, transport, dismantle routing, fabric required-vs-stock)
      // never print in combined mode, so these have nothing real to read from on this page.
      blockedItemsGrouped: [], blockedItems: [], trucks: [], movements: [], fabricReqRows: [],
      ...plans,
      zoneAdminOrder,
      // Always Planning's real decisions, never sales' 1st choices — an undecided row already
      // prints as "1st choice (not decided)" either way (deptBookHtml.js's own fallback), so
      // dealCheckMode would only do one thing here: silently REPLACE a floor/design Planning HAS
      // already decided with sales' 1st choice instead. Bypassing the gate below must never do that.
      dealCheckMode: false,
      // Meaningless on the combined book — every zone page spans every department, so no single
      // department's own last editor is "the preparer" here; falls back to the exporting user.
      preparedBy: null,
    }, zoneLabels, logos, { ...opts, combined: true });
  };

  // Mirrors DepartmentOpsTab.jsx's own gate (exportPdf): a carpet floor or overlay/cushion-cover
  // design nobody has decided yet still prints (as "1st choice (not decided)"), but the gate
  // refuses to build at all until someone has acknowledged that. That screen can send a dept head
  // straight to the panel that decides it; this page has no such panel, so it can only say who to
  // ask — and, since the owner asked for it, offer to download anyway rather than block entirely.
  const checkGate = async () => {
    const today = new Date().toLocaleDateString("en-CA");
    const open = (r) => r.status !== "decided" && !(r.date && r.date < today);
    const plans = makeEventPlans({ sel, inventory, blocks, eventOrders, settings, trussInv });
    const carpetLeft = plans.carpetPlanOf().rows.filter(open);
    const itemsLeft = plans.elementPlanOf().rows.filter(open);
    if (!carpetLeft.length && !itemsLeft.length) return true;
    const when = (d) => { try { return d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""; } catch { return d || ""; } };
    const listOf = (rows, label, tail) => {
      const lines = rows.slice(0, 8).map((r) => `• ${label(r)}${[r.fnLabel, when(r.date)].filter(Boolean).length ? " — " + [r.fnLabel, when(r.date)].filter(Boolean).join(" · ") : ""}${tail(r)}`);
      if (rows.length > 8) lines.push(`…and ${rows.length - 8} more`);
      return lines.join("\n");
    };
    const carpetLines = listOf(carpetLeft, (r) => r.zoneName, (r) => (r.status === "none" ? " (sales picked no carpet)" : ""));
    const itemLines = listOf(itemsLeft, (r) => `${r.zoneName} · ${r.name}`, (r) => (r.status === "short" ? " (none of the choices covers it)" : ""));
    const tail = "Everything else prints as Planning already has it — only these still show as the client's 1st choice, marked \"not decided\", until someone picks.";
    let title, body;
    if (carpetLeft.length && itemsLeft.length) {
      title = "Choices not made yet";
      body = `Carpet:\n${carpetLines}\n\nOverlays / cushion covers:\n${itemLines}\n\nAsk the Tenting / Fabric head to decide in Planning.\n\n${tail}`;
    } else if (carpetLeft.length) {
      title = "Carpet not selected";
      body = `The carpet for ${carpetLeft.length === 1 ? "this floor" : "these floors"} hasn't been chosen yet:\n\n${carpetLines}\n\nAsk the Tenting head to decide in Planning → Carpet plan.\n\n${tail}`;
    } else {
      title = "Overlay / cushion cover not chosen";
      body = `The design for ${itemsLeft.length === 1 ? "this element" : "these elements"} hasn't been chosen yet:\n\n${itemLines}\n\nAsk the Fabric head to decide in Planning → Fabric plan.\n\n${tail}`;
    }
    return confirm({ title, body, confirmLabel: "Download anyway", danger: false });
  };

  const run = async (view) => {
    if (exporting || !sel) return;
    if (!(await checkGate())) return;
    setExporting(view ? "view" : "download");
    const selDateStr = sel?.functionsDetail?.[0]?.date || sel?.date || sel?.eventDate || "";
    const { ok, url, name } = await renderDeptBook({
      buildHtml, lang: pdfLang, multi: true, dept: null,
      depts: ["__combined__"], sel, selDateStr, view, onNote: () => {},
    });
    if (view && ok && url) {
      if (deckUrlRef.current) URL.revokeObjectURL(deckUrlRef.current);
      deckUrlRef.current = url;
      setDeckView({ url, name });
    }
    setExporting(null);
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <PdfLangToggle value={pdfLang} onChange={setLang} disabled={!!exporting} compact />
        <button onClick={() => run(true)} disabled={!sel || !!exporting}
          className="h-8 px-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11.5px] font-semibold disabled:opacity-60">
          {exporting === "view" ? "…" : "👁 View"}
        </button>
        <button onClick={() => run(false)} disabled={!sel || !!exporting}
          className="h-8 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11.5px] font-semibold disabled:opacity-60">
          {exporting === "download" ? "Building…" : "📚 Download PDF"}
        </button>
      </div>
      {confirmDialog}
      {deckView && createPortal(
        <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-gray-900 text-white">
            <button onClick={closeDeck}
              className="h-9 pl-2 pr-3.5 rounded-full border border-white/25 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1 text-[14px] font-semibold cursor-pointer">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
            <div className="flex-1 min-w-0 truncate text-[14px] font-semibold">{deckView.name.replace(/\.pdf$/, "")}</div>
            <a href={deckView.url} download={deckView.name}
              className="h-9 px-3.5 rounded-full bg-white text-gray-900 hover:bg-gray-100 inline-flex items-center gap-1.5 text-[13px] font-semibold">
              Download
            </a>
          </div>
          <iframe title="Deck" src={deckView.url} className="flex-1 w-full border-0 bg-white" />
        </div>,
        document.body
      )}
    </>
  );
}

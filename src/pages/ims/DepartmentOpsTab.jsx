import { useState, useMemo, useEffect, useRef } from "react";
import { fmt } from "../../lib/format";
import { mpDayWise, mpBaseDay, mpEffDay, mpEffWindows, mpLineCost, mpDayCost, isLiveEventOrder } from "../../lib/ims/helpers";
import { uploadAudioToStorage } from "../../lib/storage";
import { DEPTS as SHARED_DEPTS, catToDept as sharedCatToDept, userDepartments } from "../../lib/ims/deptClassify";
import ManpowerFactorPills from "../../components/shared/ManpowerFactorPills.jsx";
import { TabsMenu } from "../../components/ui";
import { hasIMSPerm } from "../../lib/ims/constants";

// ── THE SUMMARY TILE ROW ──
// auto-FIT, not auto-fill. The difference only shows when there are fewer tiles than columns
// that would fit: auto-fill keeps the empty tracks and they take up space, so five tiles in a
// six-column row left a tile-sized hole on the right; auto-fit collapses the empty ones and the
// real tiles stretch to fill the width.
// This was auto-fill on purpose once, to keep the tiles column-aligned with the income CARDS
// above them. Those cards became a single readout panel, so there is no second grid left to
// line up with and the trade no longer buys anything.
// Two fixed columns on a phone, auto-fit from sm up.
//
// It cannot be one rule: auto-fit picks the column count from a MINIMUM width, and the minimum
// that yields two columns at 390px (~150px) yields six on a 1200px desktop — far too many for
// tiles this size. So the phone count is stated outright and auto-fit takes over only where it
// gives a sensible answer. Written as classes rather than the inline style this replaces because
// an inline style has no breakpoints.
const GRID = "grid gap-3 sm:gap-4 items-stretch grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(212px,1fr))]";

/* ── THE CARD'S ICONS ──
   Drawn, not emoji, and only for the event header card the design system specifies. Emoji were
   fine as block markers — each block needs to be told apart at a glance and an emoji does that
   in one character — but they cannot take a colour or a stroke weight, and this card's icons
   have to go blue when their tag is active and grey when it is not. Each inherits currentColor
   and sits on a 16px box, so the caller sets both by setting text colour and nothing else.
   Kept at module scope: they close over nothing, so redefining them on every render of a
   2700-line component would allocate three functions per keystroke for no reason. */
/* A glyph for a crew line, matched on the type NAME rather than an id, because crew types are
   free text a salesperson types in Studio — "Labours", "Labour", "Helpers" all arrive. Matching
   on a substring means a new wording still lands on the right picture, and anything unrecognised
   falls back to a generic person rather than to a wrong one. */
function crewIcon(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("superv") || t.includes("manager") || t.includes("incharge")) return "🧑‍💼";
  if (t.includes("driver")) return "🚚";
  if (t.includes("carpenter") || t.includes("tech") || t.includes("electric")) return "🔧";
  if (t.includes("labour") || t.includes("labor") || t.includes("helper") || t.includes("crew")) return "👷";
  return "👤";
}

/* One figure under its own column label, for the inventory rows. Fixed widths from sm up, so a
   kit's components line up under the kit's own qty / rate / total — the components sum to the kit
   line, and that comparison is most of the reason the contents can be opened at all. Below sm the
   three share the row equally instead, because fixed columns plus a name do not fit 390px. */
const StatCell = ({ label, w, children }) => (
  <div className={"flex-1 sm:flex-none text-right " + w}>
    <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400 leading-none">{label}</div>
    <div className="mt-1">{children}</div>
  </div>
);
const STAT_W = { qty: "sm:w-16", rate: "sm:w-20", total: "sm:w-24" };

/* Page with a down-arrow: a document you take away, which is what the export produces. Not a
   printer glyph — the print dialog is how it is saved, not what it is for. */
const IconDownload = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9.2 1.8H4.4a1.4 1.4 0 0 0-1.4 1.4v9.6a1.4 1.4 0 0 0 1.4 1.4h7.2a1.4 1.4 0 0 0 1.4-1.4V5.6L9.2 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M9 2v3.4h3.6" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 7.6v4m0 0L6.4 10M8 11.6 9.6 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconBell = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2a3.6 3.6 0 0 0-3.6 3.6c0 2.7-1 3.6-1 3.6h9.2s-1-.9-1-3.6A3.6 3.6 0 0 0 8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M6.7 11.6a1.4 1.4 0 0 0 2.6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const IconClipboard = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2.75" y="3.25" width="10.5" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2.75 6.25h10.5M5.75 2v2.5M10.25 2v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const IconTruck = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.75 4.5h7v6.25h-7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M8.75 7h2.6l2.9 2.2v1.55h-5.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <circle cx="4.75" cy="11.75" r="1.25" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="11.25" cy="11.75" r="1.25" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

// One glyph per income head, keyed on the label the rows are built with (see `rows` in the
// readout). Keyed on the label rather than an index so reordering the heads — or a department
// that only has some of them — cannot silently shift every icon by one. Anything unmapped falls
// back to a dot, which is a neutral placeholder rather than a wrong picture.
const HEAD_ICON = {
  "Inventory rental": "📦",
  "Truss": "🏗️",
  "Fabric / draping": "🧵",
  "Real flowers (mandi)": "🌷",
  "Artificial flowers": "🌸",
  "Manpower": "👥",
  "Production": "🏭",
  "Buying": "🛒",
  "Transport": "🚚",
};

// "2h ago" for the activity log. Relative reads faster than a date when the question is
// "did this change since I last looked" — which is the only question this log answers. It stops
// being useful past a week, so beyond that it falls back to the actual date, and the exact
// timestamp is always kept on the element's title so nothing is lost to the shorthand.
function relTime(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return "just now";          // clock skew between the writer's machine and this one
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// Small in-browser voice-note recorder → uploads to Cloudinary, hands the URL back via onSave.
// Used on-site so the ops manager can attach a spoken note to a transferred/repair item; the receiving
// site hears it before the item arrives (e.g. "front leg is loose — fix before use").
function VoiceRecorder({ value, onSave, compact = false, label = "voice note" }) {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mrRef = useRef(null), chunksRef = useRef([]), streamRef = useRef(null);
  const start = async () => {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("no mic"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        (streamRef.current?.getTracks() || []).forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setBusy(true);
        try { const url = await uploadAudioToStorage(blob); onSave(url); } catch { setErr("upload failed"); }
        setBusy(false);
      };
      mr.start(); mrRef.current = mr; setRec(true);
    } catch { setErr("mic blocked"); }
  };
  const stop = () => { try { mrRef.current?.stop(); } catch {} setRec(false); };
  if (busy) return <span className="text-[10px] text-gray-400 whitespace-nowrap">⏳ saving…</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {value && !rec && !compact && <audio src={value} controls className="h-6 max-w-[130px]" />}
      {rec
        ? <button onClick={stop} className="text-[10px] font-semibold text-white bg-red-600 rounded-full px-2 py-1 animate-pulse whitespace-nowrap">⏹ stop</button>
        : <button onClick={start} className={"text-[10px] font-semibold rounded-full px-2 py-1 border whitespace-nowrap " + (value ? "text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100" : "text-blue-600 border-blue-200 hover:bg-blue-50")} title={value ? "re-record " + label : "record " + label}>🎤 {value ? "✓" : (compact ? "" : label)}</button>}
      {err && <span className="text-[10px] text-red-500">{err}</span>}
    </span>
  );
}

// ═══ DEPARTMENT OPERATIONS (Planning → Dept Ops) ═══
// Per-department backend for department heads: see their department's requirements + income for any
// event (blocked inventory with photos, manpower), override the manpower plan, and log ACTUALS
// (real mandi cost + on-site expenses) so projected cost converts to exact cost (reflected to Studio).
const DEPTS = SHARED_DEPTS;
const DEPT_ICON = { Furniture: "🛋️", Floral: "🌸", Structure: "🏛️", Tenting: "⛺", Transport: "🚚", Lighting: "💡", Fabric: "🧵" };
// Primary manpower types per department (for the editable crew plan).
const DEPT_MP = {
  Floral: ["Flowerists", "Labours"],
  Structure: ["Carpenters", "Labours"],
  Tenting: ["Painters", "Truss Labour", "Labours"],
  Fabric: ["Fabric Bangali", "Labours"],
  Lighting: ["Electricians", "Labours"],
  Transport: ["Drivers"],
  Furniture: ["Labours"],
};

// Suggested essential tools per department — one-tap to add to the reusable template.
const DEFAULT_TOOLS = {
  Floral: ["Ladder", "Tripal", "Buckets", "Oasis", "Scissors", "Binding wire", "Cutter"],
  Fabric: ["Nails", "Hammer", "Stapler + pins", "Safety pins", "Needle & thread", "Scissors"],
  Tenting: ["Ropes", "Hammer", "Spanner set", "Cable ties", "Tripal"],
  Structure: ["Drill machine", "Screws", "Spanner set", "Nuts & bolts", "Spirit level"],
  Lighting: ["Extension boards", "Cable ties", "Line tester", "Insulation tape", "Bulbs spare"],
  Transport: ["Ropes", "Tarpaulin", "Trolley", "Straps"],
  Furniture: ["Trolley", "Covers", "Cleaning cloth", "Cushion spares"],
};

export default function DepartmentOpsTab({ eventOrders, setEventOrders, inventory, setInventory, blocks, settings, setSettings, trussInv, setTrussInv, authUser, amendRequests, focusEventId, focusSearch, focusLeadEntry, onFocusHandled, onGoToCalendar }) {
  const catDeptCfg = (settings && settings.categoryDepartments && typeof settings.categoryDepartments === "object") ? settings.categoryDepartments : {};
  const catToDept = (cat) => sharedCatToDept(cat, catDeptCfg);
  const dihari = settings?.dihariSchemes || {};
  const isAdmin = authUser?.role === "Admin" || authUser?.id === "u_admin";
  const canManpower = hasIMSPerm(authUser, "events_manpower");
  // This user's allowed departments — an explicit grant (user.departments, set in Admin -> Users &
  // Roles) if present, else the same role-name inference this screen always used (e.g. "Dept Head
  // - Tenting" -> Tenting). null = unrestricted (sees every department), same as before this
  // existed for Admin/Sales/any role that doesn't name one.
  const myDepts = useMemo(() => userDepartments(authUser), [authUser]);
  const roleDept = myDepts && myDepts.length === 1 ? myDepts[0] : null; // the common single-dept case — locks the picker to a badge, same as before
  const deptOptions = isAdmin || !myDepts ? DEPTS : DEPTS.filter((d) => myDepts.includes(d));

  const [dept, setDept] = useState(roleDept || deptOptions[0] || "Floral");
  const [search, setSearch] = useState("");
  const [leadEntry, setLeadEntry] = useState(null); // LMS entry no of the lead we arrived from
  // Month shown by the event picker below. Starts on the current month and is nudged, once, to a
  // month that actually has events — see the effect further down.
  const _now = new Date();
  const [pickMonth, setPickMonth] = useState({ y: _now.getFullYear(), m: _now.getMonth() });
  // Which date the phone layout has open. Desktop shows every day's events in the grid at once
  // and never needs this; on a phone the grid is dates only, so one has to be chosen to list.
  const [pickDay, setPickDay] = useState(null);
  const [selId, setSelId] = useState(null);
  const [zoomImg, setZoomImg] = useState(null); // click-to-enlarge lightbox (ops needs a clear big photo)
  const [opsView, setOpsView] = useState("planning"); // "planning" | "onsite" — split on-site (receiving/dismantle) into its own view
  // The mini calendar that used to sit in this rail is gone — the IMS Calendar tab is the one
  // calendar, and clicking an event there lands here with that event already selected. Its
  // date-filter state went with it; the search box still narrows the list.
  const [mandiQuery, setMandiQuery] = useState(""); // autocomplete text for adding a mandi flower
  const [artHowOpen, setArtHowOpen] = useState(false); // expand the artificial-flower "how derived" box
  const [newTool, setNewTool] = useState(""); // text for adding an essential tool to the template
  // The activity log opens from the bell in the event header. It is a notification, not a
  // section of the page: a permanent panel meant an event with two edits pushed everything
  // below it down to say so, on every visit. Closed by default, and the bell only appears when
  // there is something to show.
  const [logOpen, setLogOpen] = useState(false);
  // ── THE CONTENT BLOCKS LIVE IN A MODAL ──
  // The page is a grid of summary tiles; opening one puts that block's full body in a dialog.
  // Six stacked blocks, several of them long tables, meant the figure you wanted was always a
  // scroll away from the figure you wanted to compare it to. `modal` holds the key of the block
  // currently showing, or null for the tile grid.
  //
  // The blocks themselves are NOT moved or re-parented to do this: they stay exactly where they
  // are in the tree, inside one container that is either hidden or promoted to a dialog, and
  // each block hides itself unless it is the open one. That keeps every block's JSX untouched —
  // no fragments to mis-close around bodies hundreds of lines long — and leaves their inputs
  // mounted, so a half-typed truck number survives opening and closing the dialog.
  const [modal, setModal] = useState(null);
  // ── "ADD A SITE" MENU ──
  // A real popover, not a <select>. The option list of a native select is drawn by the OS, so
  // none of it can be styled — the dates and day-offsets could only ever be crammed into one
  // line of plain text per row. position:fixed with measured coordinates because this card sets
  // overflow-hidden, which would clip an absolutely-positioned menu. Same approach FlowerPicker
  // in components/ui already uses for the same reason.
  const [siteMenu, setSiteMenu] = useState(false);
  const siteBtnRef = useRef(null);
  const [siteMenuPos, setSiteMenuPos] = useState({ top: 0, left: 0, width: 0 });
  useEffect(() => {
    if (!siteMenu) return undefined;
    const place = () => {
      const r = siteBtnRef.current?.getBoundingClientRect();
      if (r) setSiteMenuPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 280) });
    };
    place();
    const onDown = (e) => { if (!siteBtnRef.current?.parentElement?.contains(e.target)) setSiteMenu(false); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setSiteMenu(false); } };
    // mousedown, not click: a click listener fires after the option's own handler has already
    // re-rendered the list, so the menu closed before the pick registered.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [siteMenu]);
  // Tracked in JS, not just CSS, because two behaviours can't be expressed in a class: locking
  // the page behind the sheet, and swallowing a backdrop tap. 639px is the pixel below Tailwind's
  // `sm`, so this flips on exactly the same line the classes below do.
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const modalCls = (k) => (modal === k ? "" : " hidden");
  // ── THE PANEL: inline from sm up, a bottom sheet on a phone ──
  // Opening in place works on the desktop grid because the tiles sit four to a row and stay in
  // view beside the panel. On a 390px column the tiles are stacked one per row, so "inline under
  // the tiles" puts the panel a screen and a half below the tap — it reads as nothing having
  // happened. Same DOM either way; only these three class strings differ, so a block never has to
  // be moved or re-parented to change which form it takes.
  const PANEL_WRAP = "fixed inset-0 z-50 flex items-end bg-gray-900/40 sm:static sm:z-auto sm:block sm:bg-transparent";
  const PANEL_CARD = "w-full max-h-[88vh] flex flex-col rounded-t-2xl bg-gray-50 ring-1 ring-gray-200 overflow-hidden sm:max-h-none sm:block sm:rounded-2xl";
  const PANEL_BODY = "flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3 sm:flex-none sm:overflow-visible sm:p-4";
  // Tapping the dimmed area closes, the way every sheet on the platform does. Guarded on the
  // phone breakpoint: from sm up this same element is the plain inline wrapper, and a click that
  // lands on it rather than on a child would otherwise shut the panel for no visible reason.
  const onPanelBackdrop = (e) => { if (isPhone && e.target === e.currentTarget) setModal(null); };
  // Escape closes, and the page behind stops scrolling while the dialog is up — without the
  // lock, a flick inside a short dialog scrolls the page underneath it instead.
  useEffect(() => {
    if (!modal && !logOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { setModal(null); setLogOpen(false); } };
    window.addEventListener("keydown", onKey);
    // From sm up an open block is part of the page, so freezing the scroll would trap you in it —
    // you could not reach the tiles above or anything below. On a phone the same block is a sheet
    // over the page, and without the lock a flick inside a short one scrolls the page underneath
    // instead of the sheet. The activity log is a dialog at every width, so it always locks.
    const prev = document.body.style.overflow;
    if (logOpen || (modal && isPhone)) document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [modal, logOpen, isPhone]);
  // Switching event or department while the log is open would leave the dialog showing another
  // context's entries — close it, since its contents are scoped to both.
  useEffect(() => { setLogOpen(false); }, [selId, dept]);
  const [mpOpen, setMpOpen] = useState({}); // which manpower rows have their derivation expanded
  // Which kits have their components showing. Collapsed by default: a kit's own line already
  // carries the qty, the rate and the total that matter, and six components under each of four
  // kits buried the ordinary items between them.
  const [kitOpen, setKitOpen] = useState({});
  // Set while the PDF is being built. The first export also downloads the jsPDF chunk, so there
  // is a real pause — without a busy state the button looks broken and gets pressed again.
  const [exporting, setExporting] = useState(false);
  const [mpDayHow, setMpDayHow] = useState({}); // which per-day rows have their "how" derivation expanded
  const [routeDraft, setRouteDraft] = useState({}); // dismantle routing draft per item: {qty, type, toEventId}
  const [manTruck, setManTruck] = useState({}); // confirm-time truck details per destination group: {[groupKey]:{vehicle,driver,phone}}
  const [manSel, setManSel] = useState({}); // which items load on THIS truck (transfer groups): {[groupKey::itemKey]:false} (default selected)
  const [manCond, setManCond] = useState({}); // on-site condition per manifest item: {[groupKey::itemKey]:{repair,broken}}
  const [manNote, setManNote] = useState({}); // on-site voice note per manifest item: {[groupKey::itemKey]:url}
  const [manOpen, setManOpen] = useState({}); // Loading-manifest destination groups: collapsed by default
  const [osMp, setOsMp] = useState({}); // on-site crew rows expanded to the per-day / per-shift editor
  const [showFleet, setShowFleet] = useState(false); // toggle the own-fleet manager
  const [newVeh, setNewVeh] = useState({ vehicle: "", driver: "", phone: "" }); // new fleet entry
  const mandiCatalogue = useMemo(() => (Array.isArray(settings?.mandiCatalogue) ? settings.mandiCatalogue : []), [settings]);

  const eventDate = (eo) => eo?.functionsDetail?.[0]?.date || eo?.date || eo?.eventDate || "";
  const today = new Date().toISOString().slice(0, 10);
  // A "live" event for ops = confirmed/finalised. Excludes pending (not yet auto-confirmed), cancelled,
  // and review — so cancelled/dead deals never clutter the list or the transfer pickers.
  const isLiveEvent = isLiveEventOrder;

  // All events (date-tagged) — drives the list.
  const allEvents = useMemo(() => (eventOrders || []).map(eo => ({ eo, date: eventDate(eo) })), [eventOrders]);

  // Event list — search-filtered, sorted by date (upcoming first).
  const events = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allEvents
      // Ops plans only for SOLD/finalised events — hide pending, cancelled and review deals.
      .filter(({ eo }) => isLiveEvent(eo))
      .filter(({ eo }) => !q || (eo.clientName || "").toLowerCase().includes(q) || (eo.functionsDetail?.[0]?.venue || eo.venue || "").toLowerCase().includes(q))
      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  }, [allEvents, search]);

  // Open the picker on a month that actually has events — nearest upcoming, else the most recent
  // past one. Sold events cluster in a few months; landing on "today" usually meant an empty grid
  // and two clicks of ‹ before anything appeared. Once only, so paging around is never undone.
  const pickInitRef = useRef(false);
  useEffect(() => {
    if (pickInitRef.current || events.length === 0) return;
    pickInitRef.current = true;
    const dated = events.map(e => e.date).filter(Boolean).sort();
    const target = dated.find(d => d >= today) || dated[dated.length - 1];
    if (target) { const dt = new Date(target + "T00:00:00"); setPickMonth({ y: dt.getFullYear(), m: dt.getMonth() }); }
  }, [events, today]);

  // Events for the visible month, bucketed by date — the picker grid reads this.
  const pickByDate = useMemo(() => {
    const out = {};
    events.forEach(({ eo, date }) => {
      if (!date) return;
      const [y, m] = date.split("-").map(Number);
      if (y !== pickMonth.y || m !== pickMonth.m + 1) return;
      (out[date] = out[date] || []).push(eo);
    });
    return out;
  }, [events, pickMonth]);

  // Arriving from the Calendar tab: it hands over the event_order id that was clicked and this
  // selects it. Cleared straight after via onFocusHandled, so the hand-off is a one-shot — left
  // set, it would re-select that event every time this tab re-rendered and quietly undo the
  // user's next pick from the list.
  // A lead with no Studio deal behind it arrives with focusSearch instead: no event to select,
  // so the client name goes into the search box and the filtered list answers the question —
  // either the deal is there under a different spelling, or it is not sold yet.
  useEffect(() => {
    if (!focusEventId && !focusSearch) return;
    // Always resync the search term, including to "". Left alone, a name carried over from a
    // previous unmatched lead would still be filtering `events` — which now only feeds the
    // nearby-events count and the empty states, so the staleness would be invisible but wrong.
    setSearch(focusSearch || "");
    // Kept locally because onFocusHandled clears the incoming props on the same tick, and the
    // "Build this deal in Studio" button below needs the LMS entry number at render time.
    setLeadEntry(focusLeadEntry || null);
    if (focusEventId && (eventOrders || []).some(e => e.id === focusEventId)) setSelId(focusEventId);
    else if (focusSearch) setSelId(null);
    onFocusHandled?.();
  }, [focusEventId, focusSearch, focusLeadEntry, eventOrders, onFocusHandled]);

  const sel = (eventOrders || []).find(e => e.id === selId);
  const selDateStr = sel ? eventDate(sel) : "";
  // Lifted out of the activity-log block so the bell in the event header can show the count
  // without recomputing it — one query, two readers, and they cannot disagree about how many
  // changes there are.
  const recentChanges = useMemo(() => (amendRequests || [])
    .filter(r => r.eventOrderId === sel?.id && r.department === dept && r.status === "logged")
    .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0))
    .slice(0, 8), [amendRequests, sel, dept]);

  // ── Department income snapshot (pushed from Deal Check → matches Studio exactly) ──
  const deptIncome = (sel?.deptIncome && sel.deptIncome[dept]) || null;
  const deptInvSnap = (sel?.deptInventory && Array.isArray(sel.deptInventory[dept])) ? sel.deptInventory[dept] : null;

  // ── Swap detection: a request row that both adds and removes an item in the same batch is a
  // straight swap (a Deal Check pick replacing another, logged by reconcileSoldInventoryBlocks in
  // one go) — tag the newly-added item SWAPPED so ops sees at a glance this isn't extra inventory,
  // it's a substitution. Most recent qualifying row wins per item name; when a batch bundles more
  // than one removal the "from" is shown as a count rather than guessing which item paired with which.
  const swapInfo = useMemo(() => {
    const map = new Map();
    const rows = (amendRequests || [])
      .filter(r => r.eventOrderId === sel?.id && r.department === dept && r.status === "logged")
      .sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    for (const r of rows) {
      const items = r.items || [];
      const added = items.filter(it => it.change === "added");
      const removed = items.filter(it => it.change === "removed");
      if (!added.length || !removed.length) continue;
      const fromLabel = removed.length === 1 ? removed[0].name : `${removed.length} items`;
      for (const a of added) {
        if (!map.has(a.name)) map.set(a.name, { swappedFrom: fromLabel, at: r.requestedAt });
      }
    }
    return map;
  }, [amendRequests, sel, dept]);

  // ── Blocked inventory: prefer the Deal Check snapshot; fall back to IMS blocks if not synced ──
  // GROUPED view (kit as one line + its components) — used for the inventory/income display.
  const blockedItemsGrouped = useMemo(() => {
    if (!sel) return [];
    if (deptInvSnap && deptInvSnap.length) {
      const rows = deptInvSnap.map((x, i) => ({ id: x.name + i, invId: x.imsId || null, name: x.name, photo: x.photo || "", qty: x.qty || 0, unit: x.unit || 0, total: x.total || 0, sub: x.sub || "", isKit: !!x.isKit, components: Array.isArray(x.components) ? x.components : null, shortQty: x.shortQty || 0, shortCost: x.shortCost || 0, prodOrBuy: x.prodOrBuy || null, isSwapped: swapInfo.has(x.name), swappedFrom: swapInfo.get(x.name)?.swappedFrom || null }));
      // Short items first (need chasing/ordering), then Production/Buying (not real stock — worth
      // knowing apart from what's actually reserved), then everything else — the order requested
      // for this list. Stable within each group: Array.prototype.sort is stable, so ties keep the
      // snapshot's own order (whichever function/zone order dcCostRollup built them in).
      const rank = (it) => (it.shortQty > 0 ? 0 : it.prodOrBuy ? 1 : 2);
      return rows.sort((a, b) => rank(a) - rank(b));
    }
    const out = [];
    Object.entries(blocks || {}).forEach(([itemId, arr]) => {
      const qty = (arr || []).filter(b => b.eventId === sel.id).reduce((s, b) => s + (Number(b.qty) || 0), 0);
      if (qty <= 0) return;
      const item = (inventory || []).find(i => String(i.id) === String(itemId));
      if (!item) return;
      const d = catToDept(item.cat || item.category);
      if (d !== dept) return;
      const unit = Number(item.price ?? item.rentalCost) || 0;
      out.push({ id: itemId, invId: itemId, name: item.name, photo: item.img || (Array.isArray(item.photoUrls) && item.photoUrls[0]) || "", qty, unit, total: unit * qty, sub: item.subCat || item.subcategory || "" });
    });
    return out.sort((a, b) => b.total - a.total);
  }, [sel, blocks, inventory, dept, swapInfo]);
  // FLAT view — kits expanded into the kit shell + each component as its own physical row. Used by
  // Loading & dispatch, Receiving and Dismantle (the ops manager loads/moves each real item).
  const blockedItems = useMemo(() => {
    const out = [];
    blockedItemsGrouped.forEach(it => {
      if (it.isKit && Array.isArray(it.components) && it.components.length) {
        const partsSum = it.components.reduce((s, c) => s + (Number(c.total) || 0), 0);
        out.push({ ...it, isKit: false, components: null, total: Math.max(0, (Number(it.total) || 0) - partsSum) }); // kit shell (its own base value)
        it.components.forEach((cp, ci) => out.push({ id: it.id + "__c" + ci, invId: cp.imsId || null, name: cp.name, photo: cp.photo || "", qty: Number(cp.qty) || 0, unit: cp.unit || 0, total: Number(cp.total) || 0, sub: cp.sub || "", kitOf: it.name }));
      } else out.push(it);
    });
    return out;
  }, [blockedItemsGrouped]);
  const rentalIncome = blockedItemsGrouped.reduce((s, x) => s + x.total, 0);

  // ── Department-saved data on the event order ──
  const deptData = (sel?.deptOps && sel.deptOps[dept]) || {};
  const deptTypes = DEPT_MP[dept] || ["Labours"];
  // Prefer the reconciling per-dept manpower detail from Deal Check (sums EXACTLY to the income card:
  // mapped crew in full + this dept's share of general labour/supervisors). Each row carries the
  // system count/rate/cost + basis (all multipliers) so the head sees how it was derived and edits it.
  // A snapshot exists once Studio has pushed Deal Check. When it has, THIS dept's manpower is
  // exactly manpowerDetail[dept] — even if empty (a dept with no crew share, e.g. Furniture with no
  // income, must show 0 to match its income card, NOT the global plan). Only with no snapshot at all
  // do we fall back to the global plan / defaults.
  const hasMpSnapshot = !!(sel?.manpowerDetail && typeof sel.manpowerDetail === "object" && Object.keys(sel.manpowerDetail).length);
  const mpDetail = (sel?.manpowerDetail && Array.isArray(sel.manpowerDetail[dept])) ? sel.manpowerDetail[dept] : (hasMpSnapshot ? [] : null);
  const sysPlan = (Array.isArray(sel?.manpowerPlan) ? sel.manpowerPlan : []).filter(p => deptTypes.includes(p.type));
  // days = the multi-day total cost ÷ (peak crew × day rate) — so the derivation math actually adds up.
  const dayCount = (count, rate, cost) => (count > 0 && rate > 0 && cost > 0) ? Math.max(1, Math.round(cost / (count * rate))) : 1;
  // Head edits are stored as per-type OVERRIDES (count/rate only) + any extra crew types they added —
  // so the SYSTEM figures (sysCount / trace / basis / schedule) are ALWAYS taken fresh from the snapshot
  // and never freeze. Only the head's actual changes are kept.
  const migrateOv = () => {
    if (!Array.isArray(deptData.mp)) return {};
    const byT = {}; (mpDetail || []).forEach(s => { byT[s.type] = s; });
    const ov = {};
    deptData.mp.forEach(r => { const s = byT[r.type]; if (!s) return; const o = {}; if (r.count !== "" && r.count != null && Number(r.count) !== Number(s.count ?? 0)) o.count = r.count; if (Number(r.rate) !== Number(s.rate ?? 0)) o.rate = r.rate; if (Object.keys(o).length) ov[r.type] = o; });
    return ov;
  };
  const mpOverrides = (deptData.mpOverrides && typeof deptData.mpOverrides === "object") ? deptData.mpOverrides : migrateOv();
  const snapTypes = new Set((mpDetail || []).map(s => s.type));
  const mpExtra = Array.isArray(deptData.mpExtra) ? deptData.mpExtra : (Array.isArray(deptData.mp) ? deptData.mp.filter(r => !snapTypes.has(r.type)) : []);
  const mpRows = hasMpSnapshot
    ? [
        ...(mpDetail || []).map(s => { const ov = mpOverrides[s.type] || {}; return { type: s.type, count: ov.count != null ? ov.count : (s.count ?? ""), rate: ov.rate != null ? ov.rate : (s.rate || 0), basis: s.basis || "", shared: !!s.shared, sysCount: s.count, sysRate: s.rate || 0, sysCost: s.cost || 0, days: dayCount(Number(s.count) || 0, Number(s.rate) || 0, Number(s.cost) || 0), trace: s.trace || null, splitInfo: s.splitInfo || null, schedule: s.schedule || null }; }),
        ...mpExtra.filter(r => !snapTypes.has(r.type)).map(r => ({ type: r.type, count: r.count ?? "", rate: r.rate || 0, basis: "added crew", shared: false, sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true })),
      ]
    : (sysPlan.length ? sysPlan.map(p => ({ type: p.type, count: p.count, rate: p.rate || Number(dihari[p.type]?.rate) || 0, basis: p.basis || "", sysCount: p.count, sysRate: p.rate || 0, sysCost: (p.count || 0) * (p.rate || 0), days: 1, _extra: true }))
      : deptTypes.map(t => ({ type: t, count: "", rate: Number(dihari[t]?.rate) || 0, basis: "", sysCount: null, sysRate: 0, sysCost: 0, days: 1, _extra: true })));
  const expenses = Array.isArray(deptData.expenses) ? deptData.expenses : [];
  const realMandi = deptData.realMandi || "";
  // Manual discount the department head grants the salesperson on this deal — a goodwill/incentive
  // figure the head types in directly, unrelated to Deal Check's own venue/repeat pricing discounts
  // and not derived from anything else on this page.
  const discount = deptData.discount ?? "";

  const saveDept = (patch) => {
    if (!sel) return;
    setEventOrders(prev => prev.map(e => {
      if (e.id !== sel.id) return e;
      const ops = { ...(e.deptOps || {}) };
      ops[dept] = { ...(ops[dept] || {}), ...patch, updatedAt: Date.now(), updatedBy: authUser?.name || "—" };
      return { ...e, deptOps: ops };
    }));
  };

  // Day-wise crew overrides: deptData.mpDay = { [type]: { [date]: count } }. Any crew with a working
  // schedule can be tuned per day (Day 1 = 4, Day 2 = 6); cost = Sum(dayCount x shifts x rate).
  // SHARED crew (Labours / Supervisors) carry a GLOBAL schedule + a split share of the event total —
  // so this dept's per-day crew defaults to globalCount × share, and is editable just like mapped crew.
  // Day-wise editing delegates to the shared reconciliation helpers (lib/ims/helpers) so the IMS view
  // and Studio's P&L compute identical numbers. Thin wrappers bind this component's mpDay/mpOverrides.
  const mpDay = (deptData.mpDay && typeof deptData.mpDay === "object") ? deptData.mpDay : {};
  // Per-day dihari-timing overrides: deptData.mpWin = { [type]: { [date]: [windowId, …] } }. The dept
  // head can toggle which shifts each crew works on a given day; cost = crew × shifts × rate.
  const mpWin = (deptData.mpWin && typeof deptData.mpWin === "object") ? deptData.mpWin : {};
  // Per-shift crew counts (ops on-site): deptData.mpWinCount = { [type]: { [date]: { [windowId]: count } } }.
  // Lets a single day hold different crew per shift (e.g. 3 in the day, 1 in the evening).
  const mpWinCount = (deptData.mpWinCount && typeof deptData.mpWinCount === "object") ? deptData.mpWinCount : {};
  const dayWise = mpDayWise;
  const effDay = (r, d) => mpEffDay(r, d, mpDay);
  const showDay = (r, d) => Math.round(effDay(r, d));
  const dayOv = (r, d) => { const ov = mpDay[r.type]; return !!(ov && ov[d.date] != null && Number(ov[d.date]) !== Math.round(mpBaseDay(r, d))); };
  const effWinIds = (r, d) => { const ov = mpWin[r.type]; return ov && ov[d.date] != null ? ov[d.date] : (Array.isArray(d.windowIds) ? d.windowIds : []); };
  const effWin = (r, d) => mpEffWindows(r, d, mpWin);
  const setMpDay = (type, date, val) => { if (!canManpower) return; saveDept({ mpDay: { ...mpDay, [type]: { ...(mpDay[type] || {}), [date]: val } } }); };
  const setMpAllDays = (type, schedule, val) => { const m = { ...(mpDay[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = val; }); saveDept({ mpDay: { ...mpDay, [type]: m } }); };
  const toggleWin = (type, date, winId, curIds) => { const next = curIds.includes(winId) ? curIds.filter(x => x !== winId) : [...curIds, winId]; saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: next } } }); };
  const setWinAllDays = (type, schedule, ids) => { const m = { ...(mpWin[type] || {}) }; (schedule || []).forEach(d => { m[d.date] = ids; }); saveDept({ mpWin: { ...mpWin, [type]: m } }); };
  // Set the crew for ONE shift on ONE day (per-shift split). Ensures that window is marked worked.
  const setShiftCount = (type, date, winId, val, curIds) => { const n = Math.max(0, Number(val) || 0); const t = { ...(mpWinCount[type] || {}) }; t[date] = { ...(t[date] || {}), [winId]: n }; const patch = { mpWinCount: { ...mpWinCount, [type]: t } }; if (Array.isArray(curIds) && !curIds.includes(winId)) patch.mpWin = { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: [...curIds, winId] } }; saveDept(patch); };
  const effShift = (r, d, winId) => { const wc = mpWinCount[r.type] && mpWinCount[r.type][d.date]; if (wc && wc[winId] != null) return Number(wc[winId]); const sc = d && d.winCount; if (sc && sc[winId] != null) return Number(sc[winId]); return Math.round(effDay(r, d)); }; // head override → Deal Check per-shift (schedule.winCount) → day count
  // Add another dihari (shift) to a day — the next unused scheme window, else a synthetic slot — so ops
  // can split a single day into e.g. 2 crew in the day shift + 1 in the evening (each shift billed).
  const addDihari = (r, date, curIds) => { const wins = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : []; const unused = wins.find(w => !curIds.includes(w.id)); const id = unused ? unused.id : ("x" + Date.now()); const t = { ...(mpWinCount[r.type] || {}) }; t[date] = { ...(t[date] || {}), [id]: 1 }; saveDept({ mpWin: { ...mpWin, [r.type]: { ...(mpWin[r.type] || {}), [date]: [...curIds, id] } }, mpWinCount: { ...mpWinCount, [r.type]: t } }); };
  const removeDihari = (type, date, slotId, curIds) => { const t = { ...(mpWinCount[type] || {}) }; if (t[date]) { const dd = { ...t[date] }; delete dd[slotId]; t[date] = dd; } saveDept({ mpWin: { ...mpWin, [type]: { ...(mpWin[type] || {}), [date]: curIds.filter(x => x !== slotId) } }, mpWinCount: { ...mpWinCount, [type]: t } }); };
  const lineCost = (r) => mpLineCost(r, mpDay, mpOverrides, mpWin, mpWinCount);
  const mpCost = mpRows.reduce((s, r) => s + lineCost(r), 0);
  const mpPlannedCost = mpRows.reduce((s, r) => s + (Number(r.sysCost) || 0), 0); // system baseline (before edits)
  // ── Event-wide Labours total. Ops runs the whole event, so he sets the TOTAL labour headcount and the
  // system re-splits it across every department by their existing usage share (scale each dept's per-day
  // labour by newTotal/currentTotal). Writes each dept's mpDay → flows via the normal reconciliation. ──
  const labDetailFor = (d) => { const rows = sel?.manpowerDetail?.[d]; return Array.isArray(rows) ? rows.find(r => r.type === "Labours") : null; };
  const labEffPerDay = (d, day) => { const md = sel?.deptOps?.[d]?.mpDay?.Labours || {}; if (md[day.date] != null) return Number(md[day.date]) || 0; return day.share != null ? (Number(day.count) || 0) * Number(day.share) : (Number(day.count) || 0); };
  const labShiftsFor = (d, day) => { const mw = sel?.deptOps?.[d]?.mpWin?.Labours; const ids = mw && mw[day.date] != null ? mw[day.date] : (Array.isArray(day.windowIds) ? day.windowIds : null); return ids ? ids.length : (Number(day.windows) || 0); };
  const labDihariFor = (d) => { const lab = labDetailFor(d); if (!lab || !Array.isArray(lab.schedule)) return 0; return lab.schedule.reduce((s, day) => s + labEffPerDay(d, day) * labShiftsFor(d, day), 0); };
  const eventLabourDihari = Math.round(DEPTS.reduce((s, d) => s + labDihariFor(d), 0));
  const anyLabours = DEPTS.some(d => labDetailFor(d));
  const setEventLabourTotal = (val) => {
    const target = Math.max(0, Number(val) || 0);
    const cur = DEPTS.reduce((s, d) => s + labDihariFor(d), 0);
    if (cur <= 0 || !sel) return;
    const ratio = target / cur;
    setEventOrders(prev => prev.map(e => {
      if (e.id !== sel.id) return e;
      const ops = { ...(e.deptOps || {}) };
      DEPTS.forEach(d => {
        const lab = labDetailFor(d); if (!lab || !Array.isArray(lab.schedule)) return;
        const od = { ...(ops[d] || {}) }; const md = { ...(od.mpDay || {}) }; const labDay = { ...(md.Labours || {}) };
        lab.schedule.forEach(day => { labDay[day.date] = Math.max(0, Math.round(labEffPerDay(d, day) * ratio)); });
        md.Labours = labDay; od.mpDay = md; od.updatedAt = Date.now(); od.updatedBy = authUser?.name || "—";
        ops[d] = od;
      });
      return { ...e, deptOps: ops };
    }));
  };
  const mpEdited = Object.keys(mpOverrides).length > 0 || Object.keys(mpDay).length > 0 || Object.keys(mpWin).length > 0 || Object.keys(mpWinCount).length > 0 || (Array.isArray(mpExtra) && mpExtra.length > 0);
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const realMandiNum = Number(realMandi) || 0;

  const setMp = (i, key, val) => {
    const row = mpRows[i]; if (!row) return;
    if (row._extra) {
      const base = Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra;
      const idx = base.findIndex(r => r.type === row.type);
      const next = base.slice();
      if (idx >= 0) next[idx] = { ...next[idx], [key]: val }; else next.push({ type: row.type, count: row.count, rate: row.rate, [key]: val });
      saveDept({ mpExtra: next });
    } else {
      saveDept({ mpOverrides: { ...mpOverrides, [row.type]: { ...(mpOverrides[row.type] || {}), [key]: val } } });
    }
  };
  const addMp = () => saveDept({ mpExtra: [...(Array.isArray(deptData.mpExtra) ? deptData.mpExtra : mpExtra), { type: "Labours", count: "", rate: Number(dihari["Labours"]?.rate) || 0 }] });
  // On-site actual crew: set the real head-count held (applies to every scheduled day for day-wise crew,
  // else a straight count override) → flows to the P&L + Studio via the same mpDay/mpOverrides fields.
  const setActualCrew = (r, i, val) => { const n = Math.max(0, Number(val) || 0); if (mpDayWise(r) && Array.isArray(r.schedule) && r.schedule.length) { const m = { ...(mpDay[r.type] || {}) }; r.schedule.forEach(d => { m[d.date] = n; }); const wc = { ...mpWinCount }; delete wc[r.type]; saveDept({ mpDay: { ...mpDay, [r.type]: m }, mpWinCount: wc }); } else setMp(i, "count", n); };
  const resetMpLine = (r) => { const nd = { ...mpDay }; delete nd[r.type]; const nw = { ...mpWin }; delete nw[r.type]; const no = { ...mpOverrides }; delete no[r.type]; const wc = { ...mpWinCount }; delete wc[r.type]; saveDept({ mpDay: nd, mpWin: nw, mpOverrides: no, mpWinCount: wc }); };
  const addExpense = () => saveDept({ expenses: [...expenses, { label: "", amount: "" }] });
  const setExpense = (i, key, val) => { const next = expenses.map((e, j) => j === i ? { ...e, [key]: val } : e); saveDept({ expenses: next }); };
  const delExpense = (i) => saveDept({ expenses: expenses.filter((_, j) => j !== i) });

  // ── Floral: editable real-mandi shopping list (projected vs actual, side-by-side) ──
  const fp = sel?.floralPlan || {};
  const fpFlowers = Array.isArray(fp.flowers) ? fp.flowers : [];
  const artificialProj = fpFlowers.filter(f => f.artificial).reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const seedMandi = fpFlowers.filter(f => !f.artificial && (Number(f.qty) || 0) > 0)
    .map(f => ({ name: f.name, unit: f.unit || "", projQty: Number(f.qty) || 0, projCost: Number(f.cost) || 0, qty: Number(f.qty) || 0, price: f.qty ? Math.round(((Number(f.cost) || 0) / f.qty) * 100) / 100 : 0 }));
  const mandiRows = Array.isArray(deptData.mandiLines) ? deptData.mandiLines : seedMandi;
  const mandiActualReal = mandiRows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const mandiActualTotal = mandiActualReal + artificialProj; // artificial carried over (not re-shopped at mandi)
  const projMandiReal = mandiRows.reduce((s, r) => s + (Number(r.projCost) || 0), 0);
  // Persist the list AND the headline actual (realMandi) so Studio's P&L reflection picks it up.
  const saveMandi = (next) => saveDept({ mandiLines: next, realMandi: next.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0) + artificialProj });
  const setMandi = (i, key, val) => saveMandi(mandiRows.map((r, j) => j === i ? { ...r, [key]: val } : r));
  const delMandi = (i) => saveMandi(mandiRows.filter((_, j) => j !== i));
  const addMandi = (cat) => { saveMandi([...mandiRows, { name: cat.name, unit: cat.unit || "", projQty: 0, projCost: 0, qty: 1, price: Number(cat.currentPrice) || 0 }]); setMandiQuery(""); };
  // Reset the real shopping list back to the system's original mandi plan (from Deal Check).
  const resetMandi = () => saveMandi(seedMandi.map(r => ({ ...r })));
  const mandiSuggest = useMemo(() => {
    const q = mandiQuery.toLowerCase().trim();
    if (!q) return [];
    return mandiCatalogue.filter(f => (f.name || "").toLowerCase().includes(q)).slice(0, 8);
  }, [mandiQuery, mandiCatalogue]);

  // ── Reusable essentials / tools template (per department) + per-event loading state ──
  const toolkitAll = (settings?.deptToolkits && typeof settings.deptToolkits === "object") ? settings.deptToolkits : {};
  const deptTools = Array.isArray(toolkitAll[dept]) ? toolkitAll[dept] : [];
  const saveTools = (next) => setSettings && setSettings(s => ({ ...s, deptToolkits: { ...(s.deptToolkits || {}), [dept]: next } }));
  const addTool = (name) => { const n = String(name || "").trim(); if (!n || deptTools.some(t => (t.name || "").toLowerCase() === n.toLowerCase())) return; saveTools([...deptTools, { name: n, qty: 1 }]); setNewTool(""); };
  const setTool = (i, key, val) => saveTools(deptTools.map((t, j) => j === i ? { ...t, [key]: val } : t));
  const delTool = (i) => saveTools(deptTools.filter((_, j) => j !== i));

  const loaded = (deptData.loaded && typeof deptData.loaded === "object") ? deptData.loaded : {};
  const toggleLoaded = (key) => saveDept({ loaded: { ...loaded, [key]: !loaded[key] } });
  const loadKeys = [...blockedItems.map(it => "inv:" + it.id), ...deptTools.map(t => "tool:" + t.name)];
  const totalLoadItems = loadKeys.length;
  const loadedCount = loadKeys.filter(k => loaded[k]).length;
  const dispatch = deptData.dispatch || { vehicle: "", driver: "", phone: "" };
  const setDispatch = (key, val) => saveDept({ dispatch: { ...dispatch, [key]: val } });
  // ── Multi-truck dispatch — inventory goes out across several trucks, each with its own challan ──
  const TRUCK_STATUS = ["loading", "dispatched", "at-site", "returned"];
  const trucks = Array.isArray(deptData.trucks) ? deptData.trucks : [];
  const addTruck = () => saveDept({ trucks: [...trucks, { id: "trk_" + Date.now(), vehicle: "", driver: "", phone: "", status: "loading", items: {} }] });
  const setTruck = (id, patch) => saveDept({ trucks: trucks.map(t => t.id === id ? { ...t, ...patch } : t) });
  const setTruckItem = (id, key, qty) => saveDept({ trucks: trucks.map(t => t.id === id ? { ...t, items: { ...(t.items || {}), [key]: qty } } : t) });
  const delTruck = (id) => saveDept({ trucks: trucks.filter(t => t.id !== id) });
  const truckLoadedQty = (key) => trucks.reduce((s, t) => s + (Number(t.items?.[key]) || 0), 0); // total loaded across all trucks
  const printTruckChallan = (truck, n) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = blockedItems.filter(it => (Number(truck.items?.["inv:" + it.id]) || 0) > 0)
      .map(it => `<tr><td>${it.name}</td><td>${it.sub || "—"}</td><td style="text-align:center">${Number(truck.items["inv:" + it.id]) || 0} of ${it.qty}</td></tr>`).join("");
    const toolRows = deptTools.map(t => `<tr><td>🛠️ ${t.name}</td><td>essential / tool</td><td style="text-align:center">${t.qty || 1}</td></tr>`).join("");
    w.document.write(`<html><head><title>Challan — ${dept} — Truck ${n}</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f3f4f6;text-align:left}h2{color:#4f46e5;margin-bottom:2px}h4{margin:14px 0 0}@media print{button{display:none}}</style></head><body>
      <h2>${DEPT_ICON[dept]} Ambria — ${dept} Challan · Truck ${n}</h2>
      <p>Event: ${sel?.clientName || "-"} &nbsp;|&nbsp; ${selDateStr || "-"} &nbsp;|&nbsp; ${sel?.functionsDetail?.[0]?.venue || sel?.venue || "-"}</p>
      <p>Vehicle: ${truck.vehicle || "______"} &nbsp;|&nbsp; Driver: ${truck.driver || "______"} &nbsp;|&nbsp; Phone: ${truck.phone || "______"}</p>
      <h4>Inventory on this truck</h4>
      <table><tr><th>Item</th><th>Type</th><th>Qty</th></tr>${rows || '<tr><td colspan="3" style="text-align:center;color:#999">No items assigned to this truck</td></tr>'}</table>
      ${toolRows ? `<h4>Essentials / tools</h4><table><tr><th>Item</th><th>Type</th><th>Qty</th></tr>${toolRows}</table>` : ""}
      <br><p>Dispatched by: _______________ &nbsp;&nbsp; Received by: _______________</p>
      <p>Date: ____________ &nbsp;&nbsp; Time: ____________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  };
  // Own fleet — vehicle + regular driver + phone, saved once in settings; one tap fills all three.
  const fleet = Array.isArray(settings?.fleet) ? settings.fleet : [];
  // All trucks in play for THIS event — own fleet + any truck ANY department already entered (dispatch
  // trucks, dismantle movements, saved dispatch). A vendor truck typed by one dept becomes a one-tap
  // chip for every other dept, since the same truck often carries several departments' items together.
  const eventTrucks = useMemo(() => {
    const map = new Map();
    const add = (v, dr, ph) => { const vehicle = String(v || "").trim(), driver = String(dr || "").trim(), phone = String(ph || "").trim(); if (!vehicle && !driver && !phone) return; const key = (vehicle + "|" + driver + "|" + phone).toLowerCase(); if (!map.has(key)) map.set(key, { id: "et_" + map.size, vehicle, driver, phone }); };
    (Array.isArray(settings?.fleet) ? settings.fleet : []).forEach(f => add(f.vehicle, f.driver, f.phone));
    if (sel) Object.values(sel.deptOps || {}).forEach(od => {
      (Array.isArray(od?.trucks) ? od.trucks : []).forEach(t => add(t.vehicle, t.driver, t.phone));
      (Array.isArray(od?.movements) ? od.movements : []).forEach(m => add(m.vehicle, m.driver, m.phone));
      if (od?.dispatch) add(od.dispatch.vehicle, od.dispatch.driver, od.dispatch.phone);
    });
    return [...map.values()];
  }, [settings, sel]);
  const saveFleet = (next) => setSettings && setSettings(s => ({ ...s, fleet: next }));
  const pickFleet = (f) => saveDept({ dispatch: { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" } });
  const addFleet = () => { const v = (newVeh.vehicle || "").trim(); if (!v) return; saveFleet([...fleet, { id: "veh_" + Date.now(), vehicle: v, driver: (newVeh.driver || "").trim(), phone: (newVeh.phone || "").trim() }]); setNewVeh({ vehicle: "", driver: "", phone: "" }); };
  const delFleet = (id) => saveFleet(fleet.filter(f => f.id !== id));

  // Actual spend logged by the head → exact P&L (mandi list + on-site expenses + edited crew).
  const mandiSpend = dept === "Floral" ? mandiActualTotal : 0;
  const actualCost = mandiSpend + expenseTotal + mpCost;
  const hasActuals = mandiSpend > 0 || expenseTotal > 0 || mpEdited;

  // ── THE DEPARTMENT'S INCOME, BROKEN INTO HEADS ──
  // Read by the on-screen readout AND by the PDF export. It lives here rather than inside the
  // panel's render because two copies of this arithmetic would eventually disagree, and the one
  // thing worse than a missing breakdown is two breakdowns of the same department that differ.
  const income = useMemo(() => {
    if (!deptIncome) return { shown: [], shownSum: 0, gap: 0, liveTotal: 0, pct: () => 0 };
    // fp (floralPlan) is a whole-EVENT floral sourcing plan, not scoped per department — only
    // show its real/artificial split under the Floral dept itself.
    const artTotal = (dept === "Floral" && fp.artificial) ? Math.round(fp.artificial.total) : 0;
    const realFloral = dept === "Floral" ? Math.max(0, Math.round((deptIncome.florals || 0) - artTotal)) : 0;
    const liveManpower = Math.round(mpCost);   // edited crew plan (not the stale snapshot)
    const liveTotal = Math.round((deptIncome.total || 0) - (deptIncome.manpower || 0) + liveManpower);
    // Fixed order, so a head does not move the moment another one appears or drops to zero —
    // the position of a figure is how you find it again on the next event.
    const rows = [
      { label: "Inventory rental", value: deptIncome.rental },
      { label: "Truss", value: deptIncome.truss },
      { label: "Fabric / draping", value: deptIncome.fabric },
      { label: "Real flowers (mandi)", value: realFloral },
      { label: "Artificial flowers", value: artTotal },
      { label: "Manpower", value: liveManpower },
      { label: "Production", value: deptIncome.production },
      { label: "Buying", value: deptIncome.buying },
      { label: "Transport", value: deptIncome.transport },
    ];
    // ── SHARE OF THE DEPARTMENT'S OWN INCOME ──
    // The percentages are taken against the SUM OF THE HEADS SHOWN, not against liveTotal.
    // liveTotal is deptIncome.total with the stale manpower swapped for the live edited crew, so
    // it can carry heads this list does not — and a column of percentages that silently fails to
    // reach 100 is worse than no percentages. Computed this way they always total 100, and `gap`
    // states it outright if the two figures disagree rather than leaving the reader to notice.
    const shown = rows.filter(r => r.value > 0).map(r => ({ ...r, value: Math.round(r.value) }));
    const shownSum = shown.reduce((s, r) => s + r.value, 0);
    return {
      shown,
      shownSum,
      gap: liveTotal - shownSum,
      liveTotal,
      pct: (v) => (shownSum > 0 ? Math.round((v / shownSum) * 100) : 0),
    };
  }, [deptIncome, dept, fp, mpCost]);

  const printChallan = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const rows = [
      ...blockedItems.map(it => `<tr><td>${loaded["inv:" + it.id] ? "☑" : "☐"}</td><td>${it.name}</td><td>${it.sub || "—"}</td><td style="text-align:center">${it.qty}</td></tr>`),
      ...deptTools.map(t => `<tr><td>${loaded["tool:" + t.name] ? "☑" : "☐"}</td><td>🛠️ ${t.name}</td><td>essential / tool</td><td style="text-align:center">${t.qty || 1}</td></tr>`),
    ].join("");
    w.document.write(`<html><head><title>Challan — ${dept}</title><style>body{font-family:Arial;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f3f4f6;text-align:left}h2{color:#4f46e5;margin-bottom:2px}@media print{button{display:none}}</style></head><body>
      <h2>${DEPT_ICON[dept]} Ambria — ${dept} Loading Challan</h2>
      <p>Event: ${sel?.clientName || "-"} &nbsp;|&nbsp; ${selDateStr || "-"} &nbsp;|&nbsp; ${sel?.functionsDetail?.[0]?.venue || sel?.venue || "-"}</p>
      <p>Vehicle: ${dispatch.vehicle || "______"} &nbsp;|&nbsp; Driver: ${dispatch.driver || "______"} &nbsp;|&nbsp; Phone: ${dispatch.phone || "______"}</p>
      <table><tr><th>✓</th><th>Item</th><th>Type</th><th>Qty</th></tr>${rows || '<tr><td colspan="4" style="text-align:center;color:#999">Nothing to load</td></tr>'}</table>
      <br><p>Dispatched by: _______________ &nbsp;&nbsp; Received by: _______________</p>
      <p>Date: ____________ &nbsp;&nbsp; Time: ____________</p>
      <button onclick="window.print()">🖨️ Print</button></body></html>`);
    w.document.close();
  };

  // ── Dismantle routing: after teardown, each item's at-site qty splits into return / transfer-to-Site-2 / damaged ──
  const movements = Array.isArray(deptData.movements) ? deptData.movements : [];
  const movedQty = (itemKey, type) => movements.filter(m => m.itemKey === itemKey && (!type || m.type === type)).reduce((s, m) => s + (Number(m.qty) || 0), 0);
  const adjustInventory = (invId, delta) => {
    if (!invId || !setInventory) return;
    setInventory(prev => prev.map(r => String(r.id) === String(invId) ? { ...r, qty: Math.max(0, (Number(r.qty) || 0) + delta), qtyOwned: Math.max(0, (Number(r.qtyOwned ?? r.qty) || 0) + delta) } : r));
  };
  const addMovement = (it, type, qty, extra = {}) => {
    const q = Number(qty) || 0; if (q <= 0) return;
    const mv = { id: "mv_" + Date.now() + "_" + Math.floor(Math.random() * 1000), itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, type, qty: q, at: Date.now(), by: authUser?.name || "—", ...extra };
    saveDept({ movements: [...movements, mv] });
    if (type === "damage") adjustInventory(it.invId, -q); // broken units leave owned stock immediately
  };
  const delMovement = (id) => {
    const mv = movements.find(m => m.id === id);
    saveDept({ movements: movements.filter(m => m.id !== id) });
    if (mv && mv.type === "damage") adjustInventory(mv.invId, +(Number(mv.qty) || 0)); // undo the decrement
  };
  const setDraft = (key, patch) => setRouteDraft(d => ({ ...d, [key]: { type: "return", ...(d[key] || {}), ...patch } }));
  const logRoute = (it) => {
    const key = "inv:" + it.id; const d = routeDraft[key] || {};
    const q = Number(d.qty !== undefined && d.qty !== "" ? d.qty : unroutedQty(it)) || 0; if (q <= 0) return;
    const type = d.type || "return";
    let extra = {};
    if (type === "transfer") { const ev = (eventOrders || []).find(e => e.id === d.toEventId); if (!ev) return; extra = { toEventId: ev.id, toEventName: ev.clientName || "Event", vehicle: d.vehicle || "", driver: d.driver || "", phone: d.phone || "" }; }
    addMovement(it, type, q, extra);
    setDraft(key, { qty: "" });
  };
  // Fast dismantle: route the FULL remaining qty of an item in one tap (no typing).
  const unroutedQty = (it) => { const k = "inv:" + it.id; return Math.max(0, it.qty - (movedQty(k, "return") + movedQty(k, "transfer") + movedQty(k, "damage") + movedQty(k, "repair"))); };
  const routeRemaining = (it, type, extra = {}) => { const q = unroutedQty(it); if (q > 0) addMovement(it, type, q, extra); };
  const routeAllToWarehouse = () => { const rest = blockedItems.filter(it => unroutedQty(it) > 0); if (!rest.length) return; saveDept({ movements: [...movements, ...rest.map(it => ({ id: "mv_" + Date.now() + "_" + Math.floor(Math.random() * 100000), itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, type: "return", qty: unroutedQty(it), at: Date.now(), by: authUser?.name || "—" }))] }); };
  // Dept-head dismantle PLAN (set in Planning; ops confirms on-site). Per item = an ARRAY of splits
  // so one item can go to several places: { [itemKey]: [{qty, type, toEventId, toEventName}, …] }.
  const dismantlePlan = (deptData.dismantlePlan && typeof deptData.dismantlePlan === "object") ? deptData.dismantlePlan : {};
  const ROUTE_LABEL = { return: "🏬 Warehouse", transfer: "↪️ Reuse/Transfer", repair: "🔧 Repair", damage: "❌ Broken" };
  const ROUTE_SHORT = { return: "🏬 Wh", transfer: "↪️", repair: "🔧", damage: "❌" };
  // Split rows for an item (back-compat: legacy single-object plan → one full-qty row; none → default warehouse).
  const planFor = (it) => { const raw = dismantlePlan["inv:" + it.id]; if (Array.isArray(raw) && raw.length) return raw; if (raw && raw.type) return [{ qty: Number(it.qty) || 0, type: raw.type, toEventId: raw.toEventId, toEventName: raw.toEventName }]; return [{ qty: Number(it.qty) || 0, type: "return" }]; };
  const setPlanRows = (key, rows) => saveDept({ dismantlePlan: { ...dismantlePlan, [key]: rows } });
  // ── Matrix dismantle plan: dept head picks destination sites; every item gets a Production House
  // column (auto-remainder) + one column per site. Typing a site qty reduces production house. Stored
  // in the SAME {return/transfer} plan shape so planFor / destGroups / on-site confirm all still work. ──
  const savedSites = Array.isArray(deptData.dismantleSites) ? deptData.dismantleSites : [];
  const dismantleSites = (() => {
    const out = savedSites.map(s => ({ ...s }));
    Object.values(dismantlePlan).forEach(rows => (Array.isArray(rows) ? rows : []).forEach(r => { if (r.type === "transfer" && r.toEventId && !out.some(s => s.id === r.toEventId)) { const ev = (eventOrders || []).find(e => e.id === r.toEventId); out.push({ id: r.toEventId, name: ev?.clientName || r.toEventName || "Event", date: ev ? eventDate(ev) : "" }); } }));
    return out;
  })();
  const planSiteQty = (it, eventId) => { const raw = dismantlePlan["inv:" + it.id]; if (!Array.isArray(raw)) return 0; const r = raw.find(x => x.type === "transfer" && x.toEventId === eventId); return r ? (Number(r.qty) || 0) : 0; };
  const planProdQty = (it) => Math.max(0, (Number(it.qty) || 0) - dismantleSites.reduce((s, st) => s + planSiteQty(it, st.id), 0));
  const buildSitePlan = (it, siteMap, sites) => { const rows = []; sites.forEach(st => { const q = Number(siteMap[st.id]) || 0; if (q > 0) rows.push({ type: "transfer", toEventId: st.id, toEventName: st.name, qty: q }); }); const rem = Math.max(0, (Number(it.qty) || 0) - rows.reduce((a, r) => a + r.qty, 0)); if (rem > 0) rows.unshift({ type: "return", qty: rem }); return rows.length ? rows : [{ type: "return", qty: 0 }]; };
  const setSiteQty = (it, eventId, val) => { const key = "inv:" + it.id; const cur = {}; dismantleSites.forEach(st => { cur[st.id] = planSiteQty(it, st.id); }); const other = dismantleSites.reduce((a, st) => a + (st.id === eventId ? 0 : (Number(cur[st.id]) || 0)), 0); const cap = Math.max(0, (Number(it.qty) || 0) - other); cur[eventId] = Math.min(cap, Math.max(0, Number(val) || 0)); setPlanRows(key, buildSitePlan(it, cur, dismantleSites)); };
  const addDismantleSite = (eventId) => { if (!eventId || dismantleSites.some(s => s.id === eventId)) return; const ev = (eventOrders || []).find(e => e.id === eventId); saveDept({ dismantleSites: [...dismantleSites, { id: eventId, name: ev?.clientName || "Event", date: ev ? eventDate(ev) : "" }] }); };
  const removeDismantleSite = (eventId) => { const next = dismantleSites.filter(s => s.id !== eventId); const nextPlan = { ...dismantlePlan }; blockedItems.forEach(it => { const cur = {}; next.forEach(st => { cur[st.id] = planSiteQty(it, st.id); }); nextPlan["inv:" + it.id] = buildSitePlan(it, cur, next); }); saveDept({ dismantleSites: next, dismantlePlan: nextPlan }); };
  // Build movement objects from the plan splits, each capped to the item's remaining (so re-confirm is safe).
  const buildPlannedMovements = (items) => {
    const now = Date.now(); const out = []; let seq = 0;
    items.forEach(it => {
      let remaining = unroutedQty(it);
      planFor(it).forEach(row => {
        let q = Math.min(Number(row.qty) || 0, remaining); if (q <= 0) return;
        let extra = {};
        if (row.type === "transfer") { if (!row.toEventId) return; const ev = (eventOrders || []).find(e => e.id === row.toEventId); extra = { toEventId: row.toEventId, toEventName: ev?.clientName || row.toEventName || "Event" }; }
        remaining -= q;
        out.push({ id: "mv_" + now + "_" + (seq++), itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, type: row.type || "return", qty: q, at: now, by: authUser?.name || "—", ...extra });
      });
    });
    return out;
  };
  const logMovements = (rows) => { if (!rows.length) return; saveDept({ movements: [...movements, ...rows] }); rows.filter(m => m.type === "damage").forEach(m => adjustInventory(m.invId, -m.qty)); };
  const confirmItemPlanned = (it) => logMovements(buildPlannedMovements([it]));
  const confirmAllPlanned = () => logMovements(buildPlannedMovements(blockedItems));
  // TESTING: wipe the dept-head plan + all on-site movements for this dept/event so the split flow can
  // be re-tried without making a new client. Restores stock for any "broken" write-offs first.
  const resetDismantle = () => {
    if (!sel) return;
    if (!window.confirm(`Reset the dismantle plan AND all on-site movements for ${sel.clientName || "this event"} · ${dept}? (for testing)`)) return;
    movements.filter(m => m.type === "damage").forEach(m => adjustInventory(m.invId, +(Number(m.qty) || 0)));
    saveDept({ dismantlePlan: {}, movements: [], dismantleSites: [] });
    setManTruck({}); setManSel({}); setManCond({}); setRouteDraft({});
  };
  // Destination-grouped manifest: everything going to each place (warehouse / repair / broken / each
  // transfer site) as its own list with item qtys — so ops loads per destination, not per item.
  const destGroups = useMemo(() => {
    const groups = {};
    blockedItems.forEach(it => {
      let left = unroutedQty(it); if (left <= 0) return;
      planFor(it).forEach(row => {
        let q = Math.min(Number(row.qty) || 0, left); if (q <= 0) return; left -= q;
        const key = row.type === "transfer" ? "transfer:" + (row.toEventId || "?") : row.type;
        const ev = row.type === "transfer" ? (eventOrders || []).find(e => e.id === row.toEventId) : null;
        const label = row.type === "transfer" ? `↪️ ${ev?.clientName || row.toEventName || "Event"}${ev ? " · " + (eventDate(ev) || "") : ""}` : ROUTE_LABEL[row.type];
        if (!groups[key]) groups[key] = { key, label, type: row.type, toEventId: row.toEventId, items: [] };
        groups[key].items.push({ it, qty: q });
      });
    });
    // Warehouse first, then repair/broken, then transfer sites.
    const order = { return: 0, repair: 1, damage: 2 };
    return Object.values(groups).sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));
  }, [blockedItems, dismantlePlan, movements, eventOrders]);
  // Confirm-time helpers: the ops manager loads the truck, records ONE set of truck details for the
  // whole list, optionally selects a subset (rest goes on another truck), and marks anything broken /
  // needing repair — those deduct from the qty reaching the destination.
  const gKey = (gk, it) => gk + "::inv:" + it.id;
  const isSel = (ck) => manSel[ck] !== false; // default selected
  const toggleManSel = (ck) => setManSel(m => ({ ...m, [ck]: m[ck] === false }));
  const setTruckField = (gk, key, val) => setManTruck(m => ({ ...m, [gk]: { ...(m[gk] || {}), [key]: val } }));
  const pickTruckFleet = (gk, f) => setManTruck(m => ({ ...m, [gk]: { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" } }));
  const condOf = (ck) => manCond[ck] || {};
  // repair + broken can never exceed the item's available qty on this list — typing one caps the other.
  const setManCondVal = (ck, key, val, cap) => setManCond(m => { const cur = { ...(m[ck] || {}) }; const other = key === "repair" ? (Number(cur.broken) || 0) : (Number(cur.repair) || 0); cur[key] = Math.min(Math.max(0, Number(val) || 0), Math.max(0, cap - other)); return { ...m, [ck]: cur }; });
  const confirmGroup = (group) => {
    const gk = group.key; const isTransfer = group.type === "transfer";
    const truck = manTruck[gk] || {};
    let ev = null;
    if (isTransfer) { if (!group.toEventId) return; ev = (eventOrders || []).find(e => e.id === group.toEventId); }
    const now = Date.now(); let seq = 0; const out = [];
    group.items.forEach(({ it, qty }) => {
      const ck = gKey(gk, it);
      if (isTransfer && !isSel(ck)) return; // left for the next truck
      const cap = Math.min(qty, unroutedQty(it)); if (cap <= 0) return;
      const c = condOf(ck);
      const rep = Math.min(Number(c.repair) || 0, cap);
      const brk = Math.min(Number(c.broken) || 0, cap - rep);
      const dest = Math.max(0, cap - rep - brk);
      const note = manNote[ck];
      const base = { itemKey: "inv:" + it.id, invId: it.invId || null, name: it.name, at: now, by: authUser?.name || "—", ...(note ? { voiceNote: note } : {}) };
      if (dest > 0) out.push({ id: "mv_" + now + "_" + (seq++), ...base, type: group.type, qty: dest, ...(isTransfer ? { toEventId: group.toEventId, toEventName: ev?.clientName || "Event", vehicle: truck.vehicle || "", driver: truck.driver || "", phone: truck.phone || "" } : {}) });
      if (rep > 0) out.push({ id: "mv_" + now + "_" + (seq++), ...base, type: "repair", qty: rep });
      if (brk > 0) out.push({ id: "mv_" + now + "_" + (seq++), ...base, type: "damage", qty: brk });
    });
    logMovements(out);
    // Reset this group's transient inputs (confirmed items leave the list; remaining default back to selected).
    setManSel(m => { const n = { ...m }; group.items.forEach(({ it }) => delete n[gKey(gk, it)]); return n; });
    setManCond(m => { const n = { ...m }; group.items.forEach(({ it }) => delete n[gKey(gk, it)]); return n; });
    setManNote(m => { const n = { ...m }; group.items.forEach(({ it }) => delete n[gKey(gk, it)]); return n; });
    setManTruck(m => { const n = { ...m }; delete n[gk]; return n; });
  };
  // Sold events sorted by date-proximity to this event (for the transfer picker — nearby dates first).
  const nearbyTransferEvents = useMemo(() => {
    const base = selDateStr ? new Date(selDateStr + "T00:00:00").getTime() : 0;
    return (eventOrders || []).filter(e => e.id !== selId && isLiveEvent(e))
      .map(e => { const d = eventDate(e); const off = (d && base) ? Math.round((new Date(d + "T00:00:00").getTime() - base) / 864e5) : 999; return { e, d, off }; })
      .sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
  }, [eventOrders, selId, selDateStr]);
  // Incoming transfers — items other events routed to THIS event for same-day reuse.
  const incomingTransfers = useMemo(() => {
    if (!sel) return [];
    const out = [];
    (eventOrders || []).forEach(eo => {
      if (eo.id === sel.id) return;
      Object.entries(eo.deptOps || {}).forEach(([dp, od]) => {
        (Array.isArray(od?.movements) ? od.movements : []).forEach(m => { if (m.type === "transfer" && m.toEventId === sel.id) out.push({ ...m, fromEvent: eo.clientName || "Event", fromDept: dp }); });
      });
    });
    return out;
  }, [eventOrders, sel]);
  // Group incoming reuse by item (match the receiving event's blocked item by inventory id, else name).
  const itemKeyFor = (invId, name) => invId ? "id:" + invId : "nm:" + String(name || "").toLowerCase().trim();
  const incomingByItem = useMemo(() => {
    const map = {};
    incomingTransfers.forEach(m => {
      const key = itemKeyFor(m.invId, m.name);
      if (!map[key]) map[key] = { name: m.name, total: 0, sources: [] };
      map[key].total += Number(m.qty) || 0;
      map[key].sources.push({ from: m.fromEvent, dept: m.fromDept, qty: Number(m.qty) || 0, vehicle: m.vehicle || "", driver: m.driver || "", phone: m.phone || "", voiceNote: m.voiceNote || "" });
    });
    return map;
  }, [incomingTransfers]);
  // Ops-manager receiving view: reconcile each item's requirement against its sources — own dispatch
  // trucks (from the production house / warehouse) + same-day reuse arriving from other sites — each
  // with vehicle + driver, and a shortfall flag.
  const sourceRows = useMemo(() => {
    if (incomingTransfers.length === 0 && trucks.length === 0) return [];
    const rows = [], used = new Set();
    blockedItems.forEach(it => {
      const key = itemKeyFor(it.invId, it.name); used.add(key);
      const inc = incomingByItem[key]; const reused = inc?.total || 0;
      const whTrucks = trucks.map((t, ti) => ({ id: t.id, n: ti + 1, vehicle: t.vehicle, driver: t.driver, phone: t.phone || "", qty: Number(t.items?.["inv:" + it.id]) || 0 })).filter(x => x.qty > 0);
      const whQty = whTrucks.reduce((s, x) => s + x.qty, 0);
      const totalIn = whQty + reused;
      if (it.qty > 0 || totalIn > 0) rows.push({ name: it.name, photo: it.photo || "", required: it.qty, reused, whTrucks, whQty, totalIn, shortfall: Math.max(0, it.qty - totalIn), over: Math.max(0, totalIn - it.qty), sources: inc?.sources || [] });
    });
    Object.entries(incomingByItem).forEach(([key, inc]) => { if (!used.has(key)) rows.push({ name: inc.name, required: 0, reused: inc.total, whTrucks: [], whQty: 0, totalIn: inc.total, shortfall: 0, over: inc.total, sources: inc.sources }); });
    return rows;
  }, [blockedItems, incomingByItem, incomingTransfers, trucks]);

  // ── Fabric (dept = Fabric): total available (Old + New) vs required, with date-wise shortfall ──
  const FABRIC_TYPES = [
    { key: "liza", label: "Liza Fabric", stockKey: "lizaStock", qtyField: "stockKg", unit: "kg", emoji: "🪡" },
    { key: "masking", label: "Wall Masking", stockKey: "maskingStock", qtyField: "stockPieces", unit: "pcs", emoji: "🧱" },
    { key: "curtain", label: "Velvet Curtains", stockKey: "curtainStock", qtyField: "stockPieces", unit: "pcs", emoji: "🎀" },
  ];
  const fabricAvail = useMemo(() => {
    const out = {};
    FABRIC_TYPES.forEach(ft => {
      const m = {};
      (Array.isArray(trussInv?.[ft.stockKey]) ? trussInv[ft.stockKey] : []).forEach(r => {
        const c = r.colour || "(unassigned)";
        if (!m[c]) m[c] = { old: 0, new: 0 };
        m[c].old += Number(r[ft.qtyField]) || 0;
        m[c].new += Number(r[`${ft.qtyField}New`]) || 0;
      });
      out[ft.key] = m;
    });
    return out;
  }, [trussInv]);
  // Same-day contention: fabric the SAME stock is committed to on OTHER events on the same date —
  // so each event is checked against the remainder after the others (the same Liza can't be in two
  // places on the same day).
  const sameDayReserved = (date, exclId, ftKey, colour) => {
    if (!date) return 0;
    let s = 0;
    (eventOrders || []).forEach(eo => {
      if (eo.id === exclId || eventDate(eo) !== date || !eo.fabricPlan) return;
      (Array.isArray(eo.fabricPlan[ftKey]) ? eo.fabricPlan[ftKey] : []).forEach(r => { if ((r.colour || "") === colour) s += Number(r.qty) || 0; });
    });
    return s;
  };
  // Requirement vs available for the SELECTED event (net of same-day commitments elsewhere).
  const fabricReqRows = (dept === "Fabric" && sel?.fabricPlan) ? FABRIC_TYPES.map(ft => {
    const req = Array.isArray(sel.fabricPlan[ft.key]) ? sel.fabricPlan[ft.key] : [];
    const rows = req.map(r => {
      const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 };
      const stock = av.old + av.new;
      const otherDay = sameDayReserved(selDateStr, sel.id, ft.key, r.colour);
      const avail = Math.max(0, stock - otherDay);
      return { colour: r.colour, required: r.qty, old: av.old, new: av.new, stock, otherDay, avail, short: Math.max(0, r.qty - avail) };
    });
    return { ...ft, rows };
  }).filter(f => f.rows.length) : [];
  // All upcoming events scanned for fabric shortfalls (same-day contention included) → order-ahead heads-up.
  const upcomingFabricShort = useMemo(() => {
    if (dept !== "Fabric") return [];
    const out = [];
    (eventOrders || []).forEach(eo => {
      const d = eventDate(eo); if (!d || d < today || !eo.fabricPlan) return;
      FABRIC_TYPES.forEach(ft => {
        (Array.isArray(eo.fabricPlan[ft.key]) ? eo.fabricPlan[ft.key] : []).forEach(r => {
          const av = fabricAvail[ft.key]?.[r.colour] || { old: 0, new: 0 };
          const otherDay = sameDayReserved(d, eo.id, ft.key, r.colour);
          const short = (Number(r.qty) || 0) - Math.max(0, (av.old + av.new) - otherDay);
          if (short > 0) out.push({ event: eo.clientName || "Event", date: d, fabric: ft.label, colour: r.colour, short, unit: ft.unit, contended: otherDay > 0 });
        });
      });
    });
    return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [dept, eventOrders, fabricAvail, today]);

  // Derivation box for a crew type — same pattern as Deal Check's "HOW … DERIVED".
  const renderMpTrace = (t) => {
    if (!t) return null;
    if (t.kind === "tier2" && Array.isArray(t.rows) && t.rows.length > 0) return (
      <div className="mb-1.5 bg-white border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-1 bg-gray-100 text-[10px] uppercase tracking-wide text-gray-500 font-semibold"><span>{t.perRow ? "Recipe / item" : "Sub-category"}</span><span className="text-right w-12">{t.countLabel || "Count"}</span><span className="text-right w-12">Batch</span><span className="text-right w-12">Need</span></div>
        {t.rows.map((tr, ti) => (<div key={ti} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 py-0.5 text-[10px] text-gray-700"><span className="truncate" title={tr.sub}>{tr.sub}</span><span className="text-right w-12">{tr.count}</span><span className="text-right w-12 text-gray-400">÷{tr.batch}</span><span className="text-right w-12 font-semibold">{tr.need.toFixed(2)}</span></div>))}
        <div className="px-2 py-1 bg-gray-50 text-[10px] text-right text-gray-600">{t.perRow ? <>Σ each ⌈need⌉ = <b className="text-gray-900">{t.result}</b></> : <>Σ {t.need.toFixed(2)} → ⌈ {Math.ceil(t.need)} ⌉ · max(min {t.min}) = <b className="text-gray-900">{t.result}</b></>}</div>
      </div>
    );
    if (t.kind === "pillars") return <div className="mb-1.5 text-[10px] text-gray-600">🏗️ {t.total} pillar(s){t.zoneP ? ` — ${t.zoneP} from truss tool${t.recipeP ? `, ${t.recipeP} from build` : ""}` : ""} → range → <b>{t.result}</b></div>;
    if (t.kind === "ratio") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.num} {t.numLabel} ÷ {t.denomLabel} = <b>{t.result}</b></div>;
    if (t.kind === "range") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.value} {t.unit} → range → <b>{t.result}</b></div>;
    // "labours" is a frozen snapshot captured at booking time (StudioApp.jsx) — it only stores the
    // COMBINED situational multiplier (season/timing maxed together), not the individual dumping/
    // saya/timing factors ManpowerTab.jsx's live Tier-3 breakdown exposes, so the pill display here
    // is necessarily a simpler "what we know" version rather than the full Setup-Access/Dumping-Space
    // breakdown — that granularity isn't in the stored data to show honestly.
    if (t.kind === "labours") return (
      <div className="mb-1.5 space-y-1">
        <ManpowerFactorPills mode="generic" label="Labours" baseQty={t.venueMin}
          qty={t.result}
          sitMult={{ factors: [{ label: "📐 Venue-min situational", mult: t.mult }], cappedMult: t.mult, rawMult: t.mult, capped: false }} />
        {t.heavy > 0 && <div className="text-[10px] text-gray-500 px-1">+ {t.heavy} heavy-element add-on</div>}
      </div>
    );
    if (t.kind === "fixed") return <div className="mb-1.5 text-[10px] text-gray-600">📐 {t.note} = <b>{t.result}</b>{" "}(before split)</div>;
    return null;
  };
  // Day-wise plan (which days × crew × which dihari shift windows) — mirrors Deal Check's day/timing
  // breakdown, but editable here: the dept head can change crew per day AND toggle each day's shifts.
  const phaseLbl = (d) => d.phase === "minusOne" ? "−1 setup" : d.phase === "dismantle" ? "+1 dismantle" : d.phase === "gap" ? "gap" : (d.date || "event");
  const renderMpSchedule = (r) => {
    const sch = r && r.schedule;
    if (!Array.isArray(sch) || !sch.length) return null;
    const editable = dayWise(r);
    const winDefs = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : [];
    const totalDihari = sch.reduce((s, d) => s + effDay(r, d) * effWin(r, d), 0);
    return (
      <div className="mt-1.5 bg-white border rounded-lg p-2 text-[10px] text-gray-600">
        <div className="font-semibold text-gray-500 mb-0.5">📅 Day-wise plan (crew × dihari shifts){editable ? (r.shared ? " — edit this dept's crew & timings per day" : " — edit crew & timings per day") : ""}</div>
        <div className="text-[10px] text-gray-400 mb-1">🔼 Cumulative-max rule: crew only scales <b>up</b> across the booking — each day holds the max of its own need and any busier earlier day (it never drops mid-event). Open a day's <b>how</b> to see its own requirement; edit any day if you disagree.</div>
        {sch.map((d, i) => {
          const ov = editable && dayOv(r, d);
          const ids = effWinIds(r, d);
          const shifts = effWin(r, d);
          const dayKey = `${r.type}|${d.date}`;
          const howOpen = !!mpDayHow[dayKey];
          const hasShare = r.shared && d.share != null;
          return (
            <div key={i} className="py-1">
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5">
                  <button onClick={() => setMpDayHow(o => ({ ...o, [dayKey]: !o[dayKey] }))} className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1 leading-tight" title="How this day's crew was calculated">{howOpen ? "▾" : "▸"} how</button>
                  <span className="font-medium text-gray-700">{phaseLbl(d)}</span>
                </span>
                <span className="flex items-center gap-1">
                  {editable
                    ? <input type="number" min="0" value={showDay(r, d)} onChange={e => setMpDay(r.type, d.date, e.target.value)} disabled={!canManpower}
                        title={canManpower ? undefined : "Requires \"Manage Manpower\""}
                        className={"w-10 border rounded px-1 py-0.5 text-[10px] text-center " + (ov ? "border-amber-400 bg-amber-50 font-bold" : "") + (canManpower ? "" : " opacity-50 cursor-not-allowed")} />
                    : <b>{d.count}</b>}
                  crew × {shifts} shift{shifts === 1 ? "" : "s"}
                </span>
              </div>
              {/* Per-dihari (per-shift) crew — dept head can hold different crew per shift (e.g. 6 in the day
                  shift, 3 in the evening). Same mpWinCount data + cost model as the on-site editor → synced. */}
              {winDefs.length > 0 && editable && (Array.isArray(d.windowIds) || (mpWin[r.type] && mpWin[r.type][d.date] != null)) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-gray-400">per shift:</span>
                  {ids.map((id, si) => { const wd = winDefs.find(w => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`; return (
                    <span key={id} className="inline-flex items-center gap-1 border rounded px-1 py-0.5 bg-white">
                      <span className="text-[10px] text-gray-400">{lbl}</span>
                      <input type="number" min="0" value={effShift(r, d, id)} onChange={e => setShiftCount(r.type, d.date, id, e.target.value, ids)} className="w-9 border rounded px-1 py-0.5 text-[10px] text-center" />
                      {ids.length > 1 && <button onClick={() => removeDihari(r.type, d.date, id, ids)} className="text-red-300 hover:text-red-500 text-[10px]" title="remove this dihari">×</button>}
                    </span>
                  ); })}
                  <button onClick={() => addDihari(r, d.date, ids)} className="text-[10px] font-semibold text-blue-600 border border-blue-200 rounded-full px-1.5 py-0.5" title="Add another dihari (shift) this day">+ dihari</button>
                </div>
              )}
              {winDefs.length > 0 && !editable && (Array.isArray(d.windowIds) || (mpWin[r.type] && mpWin[r.type][d.date] != null)) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {winDefs.map(w => { const on = ids.includes(w.id); return <span key={w.id} className={"px-1.5 py-0.5 rounded-full border text-[10px] " + (on ? "border-emerald-300 bg-emerald-50 text-emerald-600" : "border-gray-100 text-gray-300")}>{on ? "✓ " : ""}{w.label}{on ? ` ${effShift(r, d, w.id)}` : ""}</span>; })}
                </div>
              )}
              {howOpen && (
                <div className="mt-1 bg-gray-50 border rounded-lg p-2">
                  {d.trace ? renderMpTrace(d.trace)
                    : <div className="text-[10px] text-gray-500 mb-1">{d.phase === "minusOne" ? "⏮️ −1 setup — full crew staged early (peak of all functions)." : d.phase === "dismantle" ? "🧹 dismantle day — crew carried from the event." : "⏸️ gap day — crew carried from the previous day."}</div>}
                  {d.trace && Number(d.trace.result) > 0 && Number(d.trace.result) < Number(d.count) && (
                    <div className="text-[10px] text-amber-600 mt-1">🔼 Cumulative-max: this day's own need is <b>{d.trace.result}</b>, but crew is held at <b>{d.count}</b> (carried from a busier day — crew only scales up).</div>
                  )}
                  {hasShare && (
                    <div className="text-[10px] text-gray-600 bg-white border rounded p-1.5">
                      Bifurcation: <b>{d.count}</b> total {r.type} this day × <b>{Math.round((Number(d.share) || 0) * 100)}%</b> ({dept}'s usage this day) = <b className="text-gray-900">{(d.count * (Number(d.share) || 0)).toFixed(2)}</b> → {Math.round(effDay(r, d))} crew to {dept}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="mt-1 pt-1 text-right">= <b className="text-gray-800">{Math.round(totalDihari)} dihari</b> · line {fmt(lineCost(r))}</div>
      </div>
    );
  };

  // ── DEPARTMENT REPORT → PDF ──
  // Everything this tab knows about ONE department on ONE event, in one printable page: the
  // money, the blocked inventory, the crew, what was actually spent, the trucks, the dismantle
  // routing, and (for Fabric) the requirement against stock. Scoped exactly like the page it is
  // exported from — `dept` and `sel` are what the whole tab is filtered by — so the button needs
  // no arguments and there is no way to export a department you are not looking at.
  //
  // Printed via the browser rather than a PDF library: this is a client-only SPA on GitHub Pages
  // with no server to render on, and a bundled generator would add hundreds of kilobytes to
  // every page load for a button used occasionally. "Save as PDF" is in the print dialog of every
  // browser the team uses, and the same approach already prints the loading challans above.
  const buildReportHtml = () => {
    // Anything that reaches the page goes through this first. The values are client names,
    // venues, crew types and item names typed by staff in Studio — an apostrophe or a stray
    // "<" in one of them would otherwise break the markup or inject into it.
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const money = (v) => esc(fmt(Math.round(Number(v) || 0)));
    // data-block marks a unit the paginator will try to keep on one page. Sections are the
    // natural unit: a heading stranded at the foot of a page with its table overleaf is the
    // single thing that makes a generated report look generated.
    let sectionNo = 0;
    const sect = (title, body) => {
      if (!body) return "";
      sectionNo += 1;
      return `<section data-block><div class="sh"><span class="sn">${String(sectionNo).padStart(2, "0")}</span><h3>${esc(title)}</h3><i></i></div>${body}</section>`;
    };
    const table = (heads, rows, widths) => rows.length
      ? `<table><colgroup>${widths.map(w => `<col style="width:${w}">`).join("")}</colgroup><thead><tr>${heads.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`
      : "";

    const venue = sel?.functionsDetail?.[0]?.venue || sel?.venue || "—";

    /* Money. `income` is the same memo the readout on screen uses, so the report and the page
       cannot disagree about what the department earns. */
    const headRows = income.shown.map(r =>
      `<tr><td>${esc(r.label)}</td><td class="n">${money(r.value)}</td><td class="n">${income.pct(r.value)}%</td></tr>`);
    // Each head also gets a drawn share bar. On screen these were dropped as noise, but a page
    // that cannot be scrolled or hovered has nothing else to make a column of percentages
    // comparable at a glance, and here the bars sit in their own narrow column rather than
    // running the width of the sheet.
    const headRowsBar = income.shown.map(r =>
      `<tr><td>${esc(r.label)}</td><td class="n">${money(r.value)}</td><td class="bar"><i style="width:${Math.max(income.pct(r.value), 2)}%"></i></td><td class="n pct">${income.pct(r.value)}%</td></tr>`);
    const moneyBlock = `
      <div class="cards">
        <div class="card hi"><div class="k">Total income</div><div class="v">${money(income.liveTotal)}</div><div class="s">What ${esc(dept)} earns · synced from Deal Check</div></div>
        <div class="card"><div class="k">Actual cost logged</div><div class="v ${hasActuals ? "" : "muted"}">${hasActuals ? money(actualCost) : "—"}</div><div class="s">${hasActuals ? "What you actually spent" : "Not logged yet"}</div></div>
      </div>
      ${table(["Head", "Amount", "", "Share"], headRowsBar, ["46%", "22%", "22%", "10%"])}
      ${income.gap !== 0 && income.shown.length ? `<p class="note">Heads above sum to ${money(income.shownSum)} — ${money(Math.abs(income.gap))} ${income.gap > 0 ? "less than" : "more than"} the department total. The total carries the live crew plan; a head may not be broken out here.</p>` : ""}`;

    /* Inventory, with each kit's components indented beneath it — the components sum to the kit
       line, which is the one comparison this section exists to support. */
    const invRows = [];
    blockedItemsGrouped.forEach(it => {
      const flags = [it.isKit ? "KIT" : "", it.shortQty > 0 ? `SHORT x${it.shortQty}` : "", it.prodOrBuy ? it.prodOrBuy.toUpperCase() : "", it.isSwapped ? "SWAPPED" : ""].filter(Boolean).join(" · ");
      invRows.push(`<tr><td>${esc(it.name)}${flags ? ` <span class="tag">${esc(flags)}</span>` : ""}<div class="sub">${esc(it.sub || "—")}</div></td><td class="n">${esc(it.qty)}</td><td class="n">${money(it.unit)}</td><td class="n b">${money(it.total)}</td></tr>`);
      (it.isKit && Array.isArray(it.components) ? it.components : []).forEach(cp => {
        invRows.push(`<tr class="kit"><td>&#8627; ${esc(cp.name)}</td><td class="n">${esc(cp.qty)}</td><td class="n">${money(cp.unit)}</td><td class="n">${money(cp.total)}</td></tr>`);
      });
    });

    const crewRows = mpRows.map(r => {
      const count = dayWise(r)
        ? (Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : 0) + " dihari"
        : esc(r.count);
      return `<tr><td>${esc(r.type)}${r.shared ? ' <span class="tag">SHARED</span>' : ""}</td><td class="n">${count}</td><td class="n">${money(r.rate)}</td><td class="n b">${money(lineCost(r))}</td></tr>`;
    });
    if (crewRows.length) crewRows.push(`<tr class="tot"><td>Total</td><td class="n"></td><td class="n"></td><td class="n b">${money(mpCost)}</td></tr>`);

    const spendRows = [
      ...(dept === "Floral" && mandiSpend > 0 ? [`<tr><td>Mandi shopping (real flowers)</td><td class="n b">${money(mandiSpend)}</td></tr>`] : []),
      ...expenses.map(e => `<tr><td>${esc(e.label || e.note || "Expense")}</td><td class="n b">${money(e.amount)}</td></tr>`),
      ...(mpCost > 0 ? [`<tr><td>Crew (per the plan above)</td><td class="n b">${money(mpCost)}</td></tr>`] : []),
    ];
    if (spendRows.length) spendRows.push(`<tr class="tot"><td>Total logged</td><td class="n b">${money(actualCost)}</td></tr>`);

    const truckRows = trucks.map((t, i) => {
      const n = blockedItems.filter(it => (Number(t.items?.["inv:" + it.id]) || 0) > 0).length;
      return `<tr><td>Truck ${i + 1}</td><td>${esc(t.vehicle || "—")}</td><td>${esc(t.driver || "—")}</td><td>${esc(t.phone || "—")}</td><td class="n">${n} item${n === 1 ? "" : "s"}</td><td>${esc(t.status || "—")}</td></tr>`;
    });

    const moveRows = movements.map(m =>
      `<tr><td>${esc(m.name)}</td><td>${esc(m.type === "transfer" ? `Transfer → ${m.toEventName || "site"}` : m.type === "damage" ? "Damaged" : "Back to production house")}</td><td class="n">${esc(m.qty)}</td><td>${esc(m.by || "—")}</td></tr>`);

    const fabRows = dept === "Fabric" ? fabricReqRows.flatMap(ft => ft.rows.map(r =>
      `<tr><td>${esc(ft.label)} · ${esc(r.colour)}</td><td class="n">${esc(r.required)} ${esc(ft.unit)}</td><td class="n">${esc(r.avail)} ${esc(ft.unit)}</td><td class="n ${r.short > 0 ? "bad" : "ok"}">${r.short > 0 ? `short ${esc(r.short)} ${esc(ft.unit)}` : "ok"}</td></tr>`)) : [];

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(dept)} — ${esc(sel?.clientName || "Event")} — Ambria</title>
<style>
  /* ── A PAGE, NOT A WEB PAGE ──
     The first version had no width at all, so the browser laid it out across the whole window:
     on a 1920px screen the Item column and the Qty column ended up a foot apart and the sheet
     read as a spreadsheet dump. Everything here is sized to ONE A4 sheet — 794px is A4's
     210mm at 96dpi — and centred, so what you see is what the PDF is. */
  *{box-sizing:border-box}
  html,body{margin:0;background:#EEF1F6}
  body{font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#111827;font-size:11px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .sheet{width:794px;margin:0 auto;background:#fff;padding:38px 44px 30px}

  /* Header: a rule of colour, the department as the headline, the event beneath it, and the
     facts that identify this sheet as labelled pairs — a report is found again by its
     identifiers, so they are the one thing that must never be a run-on sentence. */
  .hdr{border-top:3px solid #2563EB;padding-top:14px;margin-bottom:20px}
  .brand{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
  .brand .co{font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#2563EB}
  .brand .kind{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#9CA3AF}
  h1{font-size:25px;line-height:1.15;margin:0;color:#0F172A;letter-spacing:-.02em;font-weight:700}
  h1 span{color:#94A3B8;font-weight:400}
  .facts{display:flex;gap:26px;margin-top:14px;padding-top:12px;border-top:1px solid #E8ECF2}
  .facts div{min-width:0}
  .facts .k{font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9CA3AF;margin-bottom:2px}
  .facts .v{font-size:11.5px;font-weight:600;color:#1F2937}

  /* Section head: a number, the name, and a rule that runs out to the margin. The number is
     what lets someone on a phone call say "look at section 3" instead of "scroll down a bit". */
  section{margin-bottom:20px}
  .sh{display:flex;align-items:center;gap:9px;margin-bottom:9px}
  .sh .sn{font-size:8.5px;font-weight:700;color:#2563EB;background:#EFF6FF;border-radius:3px;padding:2px 5px;letter-spacing:.04em}
  .sh h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#334155;margin:0;white-space:nowrap}
  .sh i{flex:1;height:1px;background:#E8ECF2}

  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th,td{padding:6px 9px;text-align:left;vertical-align:middle;word-wrap:break-word}
  th{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#94A3B8;border-bottom:1px solid #CBD5E1;padding-bottom:5px}
  td{border-bottom:1px solid #F1F5F9;font-size:11px}
  tbody tr:last-child td{border-bottom:0}
  .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .b{font-weight:700;color:#0F172A}
  .sub{color:#94A3B8;font-size:9.5px;margin-top:1px}
  .kit td{color:#475569;font-size:10px;background:#F8FAFF;border-bottom:1px solid #EEF2FF}
  .kit td:first-child{padding-left:26px;color:#64748B}
  .tot td{background:#F8FAFC;font-weight:700;border-top:1.5px solid #CBD5E1;border-bottom:0;color:#0F172A}
  .tag{display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:7.5px;font-weight:700;padding:1.5px 4px;border-radius:2.5px;vertical-align:middle;letter-spacing:.04em;margin-left:3px}
  /* The share bar gets its own narrow column so it stays a measure instead of becoming a rule
     across the sheet, which is what made it read as a divider on screen. */
  .bar{padding-right:4px}
  .bar i{display:block;height:4px;border-radius:2px;background:#2563EB;min-width:2px}
  td.bar{position:relative;background:linear-gradient(#EEF2F7,#EEF2F7) 9px center/calc(100% - 18px) 4px no-repeat}
  .pct{font-size:10px;color:#64748B;font-weight:600}

  .cards{display:flex;gap:11px;margin-bottom:13px}
  .card{flex:1;border:1px solid #E8ECF2;border-radius:9px;padding:12px 14px}
  .card.hi{background:#2563EB;border-color:#2563EB;color:#fff}
  .card .k{font-size:8px;text-transform:uppercase;letter-spacing:.1em;font-weight:700;opacity:.72}
  .card .v{font-size:23px;font-weight:700;margin:5px 0 3px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .card .v.muted{color:#CBD5E1}
  .card .s{font-size:9px;opacity:.72;line-height:1.35}
  .meta{color:#94A3B8;font-size:9.5px;margin:7px 0 0}
  .note{background:#FFFBEB;border-left:3px solid #F59E0B;color:#92400E;padding:7px 10px;border-radius:0 5px 5px 0;font-size:10px;margin:9px 0 0}
  .empty{color:#94A3B8;font-style:italic;font-size:10.5px;margin:2px 0 0}
  .ok{color:#059669;font-weight:600}
  .bad{color:#DC2626;font-weight:700}
  footer{margin-top:26px;padding-top:11px;border-top:1px solid #E8ECF2;color:#94A3B8;font-size:8.5px;display:flex;justify-content:space-between;gap:16px}

  /* The button is screen furniture. It is hidden from print, and the exporter removes it from
     the DOM outright before rendering, so it can never appear in the file either way. */
  .noprint{position:fixed;top:16px;right:16px;background:#2563EB;color:#fff;border:0;border-radius:9px;padding:10px 18px;font:600 13px/1 inherit;cursor:pointer;box-shadow:0 4px 14px rgba(37,99,235,.35)}
  @media print{
    @page{size:A4;margin:0}
    html,body{background:#fff}
    .noprint{display:none!important}
    .sheet{width:auto;padding:14mm 14mm 10mm}
    section{break-inside:avoid}
    tr{break-inside:avoid}
  }
</style></head><body>
<button class="noprint" onclick="window.print()">Save as PDF</button>
<div class="sheet" id="sheet">
<header class="hdr" data-block>
  <div class="brand"><span class="co">Ambria</span><span class="kind">Department report</span></div>
  <h1>${esc(dept)} <span>— ${esc(sel?.clientName || "Event")}</span></h1>
  <div class="facts">
    <div><div class="k">Event date</div><div class="v">${esc(selDateStr || "—")}</div></div>
    <div><div class="k">Venue</div><div class="v">${esc(venue)}</div></div>
    <div><div class="k">Department</div><div class="v">${esc(dept)}</div></div>
    <div><div class="k">Last edited by</div><div class="v">${esc(deptData.updatedBy || "—")}</div></div>
  </div>
</header>
${deptIncome ? sect("Money", moneyBlock) : sect("Money", '<p class="empty">No Deal Check breakdown synced yet for this event.</p>')}
${sect("Inventory blocked", invRows.length ? table(["Item", "Qty", "Rate / unit", "Total"], invRows, ["52%", "10%", "18%", "20%"]) + `<p class="meta">${blockedItemsGrouped.length} item${blockedItemsGrouped.length === 1 ? "" : "s"} held · ${money(rentalIncome)}</p>` : '<p class="empty">No inventory blocked for this department.</p>')}
${sect("Manpower plan", crewRows.length ? table(["Crew type", "Count", "Rate / day", "Line total"], crewRows, ["40%", "20%", "20%", "20%"]) : '<p class="empty">No crew assigned.</p>')}
${sect("Actual spend logged", spendRows.length ? table(["What", "Amount"], spendRows, ["70%", "30%"]) : '<p class="empty">Nothing logged yet.</p>')}
${truckRows.length ? sect("Loading & dispatch", table(["#", "Vehicle", "Driver", "Phone", "Load", "Status"], truckRows, ["11%", "22%", "21%", "18%", "14%", "14%"])) : ""}
${moveRows.length ? sect("Dismantle routing", table(["Item", "Goes to", "Qty", "Logged by"], moveRows, ["38%", "32%", "12%", "18%"])) : ""}
${fabRows.length ? sect("Fabric required vs available", table(["Fabric · colour", "Required", "Available", "Status"], fabRows, ["40%", "20%", "20%", "20%"])) : ""}
<footer data-block>
  <span>Generated from Ambria IMS · ${esc(new Date().toLocaleString("en-IN"))} · ${esc(authUser?.name || "—")}</span>
  <span>Figures are live at the moment of export</span>
</footer>
</div>
</body></html>`;
    return html;
  };

  // ── THE DOWNLOAD ──
  // Renders the report offscreen, turns it into an A4 PDF and saves it, with no print dialog in
  // the way. jsPDF and html2canvas are pulled in with a DYNAMIC import so Vite splits them into
  // their own chunk: nobody who never presses this button pays for them, which is what kept a
  // PDF library off the table when this was a print-window export.
  //
  // Paginated block by block rather than as one tall image sliced every 841pt. Slicing a single
  // strip cuts through whatever happens to sit on the boundary — a table row bisected, a heading
  // with its table on the next page. Each `data-block` is measured first and moved to a fresh
  // page if it does not fit, so breaks land between sections. A block taller than a page (a long
  // inventory table) still has to be cut, but it is the only thing that ever is.
  const exportDeptPdf = async () => {
    if (exporting) return;
    setExporting(true);
    const frame = document.createElement("iframe");
    try {
      const [{ jsPDF }, h2c] = await Promise.all([import("jspdf"), import("html2canvas")]);
      const html2canvas = h2c.default;

      // An iframe, not a div in this page: the report's CSS is written for a bare document, and
      // dropped into the app it would inherit Tailwind's reset and its oklch() colours — which
      // html2canvas cannot parse and silently renders as black.
      // Offscreen via position, NOT display:none or visibility:hidden — an element with no
      // layout box has nothing to rasterise, and the canvas would come back empty.
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1200px;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      doc.open(); doc.write(buildReportHtml()); doc.close();
      // The button exists for the fallback path only; it must not be rasterised into the file.
      doc.querySelector(".noprint")?.remove();
      // Let the iframe lay out and its webfont settle before measuring anything.
      await new Promise(r => setTimeout(r, 120));
      if (doc.fonts?.ready) { try { await doc.fonts.ready; } catch { /* font API absent — the fallback stack is fine */ } }

      const sheet = doc.getElementById("sheet");
      frame.style.height = Math.max(1200, sheet.scrollHeight + 80) + "px";
      await new Promise(r => setTimeout(r, 60));

      const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const MARGIN = 28;                       // pt of white around the content on every page
      const usableW = pageW - MARGIN * 2;
      const usableH = pageH - MARGIN * 2;

      const blocks = [...sheet.querySelectorAll("[data-block], section")];
      let y = MARGIN;
      let first = true;
      for (const el of blocks) {
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true, windowWidth: 794 });
        const img = canvas.toDataURL("image/jpeg", 0.92);
        const h = (canvas.height * usableW) / canvas.width;   // scaled to the content column
        if (h <= usableH) {
          // Fits whole. Start a new page if it will not fit in what is left of this one.
          if (!first && y + h > pageH - MARGIN) { pdf.addPage(); y = MARGIN; }
          pdf.addImage(img, "JPEG", MARGIN, y, usableW, h);
          y += h + 10;
        } else {
          // Taller than a whole page — the only case we cut. Walk it down page by page.
          if (!first) { pdf.addPage(); }
          let drawn = 0;
          while (drawn < h - 1) {
            if (drawn > 0) pdf.addPage();
            pdf.addImage(img, "JPEG", MARGIN, MARGIN - drawn, usableW, h);
            // Mask whatever of the image spills past this page's bottom margin.
            pdf.setFillColor(255, 255, 255);
            pdf.rect(0, pageH - MARGIN, pageW, MARGIN, "F");
            pdf.rect(0, 0, pageW, MARGIN, "F");
            drawn += usableH;
          }
          y = pageH;   // force the next block onto a fresh page
        }
        first = false;
      }

      // Page numbers, added once the total is known.
      const total = pdf.internal.getNumberOfPages();
      for (let p = 1; p <= total; p++) {
        pdf.setPage(p);
        pdf.setFontSize(7.5);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`${p} / ${total}`, pageW - MARGIN, pageH - 12, { align: "right" });
      }

      // Filename is what the file is called in someone's Downloads folder a month later, so it
      // carries all three identifiers. Slashes and colons are illegal in filenames on Windows.
      const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
      pdf.save(`${safe(dept)} - ${safe(sel?.clientName || "Event")} - ${safe(selDateStr || "no date")}.pdf`);
    } catch (err) {
      // Anything at all went wrong — chunk blocked, canvas tainted, old browser. Fall back to
      // the print window, which needs no libraries and has "Save as PDF" in its own dialog. A
      // button that reports failure and leaves you with nothing is worse than one extra click.
      console.error("PDF export failed, falling back to print:", err);
      const w = window.open("", "_blank");
      if (!w) { alert("Could not generate the PDF, and the pop-up fallback was blocked. Allow pop-ups for this site and try again."); return; }
      w.document.write(buildReportHtml());
      w.document.close();
    } finally {
      frame.remove();
      setExporting(false);
    }
  };

  // ── VIEW CONTROLS: nearby count, activity bell, Planning / On-site ──
  // ONE home: the right-hand end of the event header. They had been split across two — the
  // income panel's figure row in Planning, a row of their own above the tiles in On-site — so
  // the same two controls moved every time you flipped the view, and in On-site they sat on a
  // strip that existed only to hold them. The header renders in both views, sits outside the
  // planning-only block (so On-site keeps its way back to Planning), travels with the event
  // these controls scope, and had an empty right half since the toggle last moved out of it.
  const viewControls = sel ? (
  <div className="flex items-center gap-2 shrink-0">
    {/* ── ACTIVITY BEHIND A BELL ──
        The log was a permanent panel between the header and the content, so an
        event with two edits pushed the whole page down to say so — every time, even
        on the hundredth visit. It is a notification, not a section: it belongs on a
        count you can ignore. The bell only renders when there IS something, so an
        untouched event shows nothing at all rather than an empty panel. */}
    {recentChanges.length > 0 && (
      <button onClick={() => setLogOpen(true)}
        className="group relative shrink-0 w-7 h-7 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-600 flex items-center justify-center transition-colors">
        <IconBell s={13} />
        {/* -top/-right so the badge overhangs the button instead of shrinking the
            glyph to make room for it. */}
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-red-500 text-white text-[9px] font-bold leading-[14px] text-center tabular-nums ring-2 ring-white">{recentChanges.length}</span>
        <span className="sr-only">Activity log — {recentChanges.length} recent changes</span>
        {/* A drawn tooltip rather than the native `title`: title waits about a
            second before appearing, which is long enough that people click the
            unlabelled bell to find out what it is instead of waiting.
            Drops BELOW the bell — above would put it behind the sticky page header.
            right-0 so it grows leftward and cannot push the header wider.
            pointer-events-none so it never intercepts the click it is describing. */}
        <span role="tooltip" className="pointer-events-none absolute top-full right-0 mt-2 z-20 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          Activity log
        </span>
      </button>
    )}
    {/* ── EXPORT THIS DEPARTMENT ──
        Sits with the bell rather than inside a panel, because the report covers ALL of the
        panels — money, inventory, crew, spend, trucks, dismantle — so it cannot belong to any
        one of them. Here it is also scoped the way the page is: whatever department and event
        the header names is exactly what the PDF contains.
        Icon-only, like the bell: spelled out it was the widest thing in a row that already has
        two tags to fit on a 390px screen. The tooltip and the sr-only label carry the meaning. */}
    <button onClick={() => exportDeptPdf()} disabled={exporting}
      className="group relative shrink-0 w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 disabled:opacity-60 flex items-center justify-center transition-colors">
      {exporting
        ? <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
        : <IconDownload />}
      <span className="sr-only">{exporting ? "Building the PDF…" : "Download this department as PDF"}</span>
      <span role="tooltip" className="pointer-events-none absolute top-full right-0 mt-2 z-20 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {exporting ? "Building the PDF…" : `Download ${dept} as PDF`}
      </span>
    </button>
    {/* It briefly lived on the department row above — which does render in both views,
        but that row scrolls off the top the moment you start reading, and the switch
        was gone exactly when you wanted it. */}
    {/* ── STATUS TAGS, NOT A SEGMENTED TRACK ──
        Two standalone tags per the design system: the one you are on is filled soft blue with
        blue-700 text, the other is plain. The grey track they used to share made this read as a
        setting with an on and an off position; as two tags it reads as two places, which is
        what it is.
        Only the ACTIVE tag is outlined. Giving both a ring drew four boxes into one small
        corner — the bell's, two rings and the card's own edge — which is what made this corner
        read as clutter rather than as three controls. Unringed, the inactive tag is just a
        label until you want it, and the one that is outlined is the one that means something.
        28px tall, matching the bell. */}
    {[["planning", "Planning", IconClipboard], ["onsite", "On-site", IconTruck]].map(([k, label, Icon]) => {
      const on = opsView === k;
      return (
        <button key={k} onClick={() => setOpsView(k)} aria-pressed={on}
          className={"shrink-0 h-7 inline-flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-semibold transition-colors "
            + (on
              ? "bg-blue-100 text-blue-700 ring-1 ring-blue-200"
              : "text-gray-500 hover:text-gray-900 hover:bg-gray-100")}>
          <span className={on ? "text-blue-600" : "text-gray-400"}><Icon s={13} /></span>
          {label}
        </button>
      );
    })}
  </div>
  ) : null;

  return (
    /* ── STACKS BELOW xl ──
       Two columns only once there is room for both: the rail is a fixed 288px, so at 768px it
       took 40% of the viewport and on a phone it left the detail column ~90px wide, which is
       not a narrow layout but a broken one. Below xl the rail becomes a full-width block above
       the detail — same panel, same controls, just stacked.
       xl and not lg because the IMS shell's own nav rail takes 208px: at a 1024px viewport the
       content box is ~768px, and splitting that would hand 288px to the picker and ~460px to
       the thing you came to read. */
    /* ── ONE MEASURE FOR THE WHOLE TAB ──
       The single width cap for this page, and the only one — the department bar, the cards and
       the tiles all end on the same right edge because they all sit inside it. It used to be
       1484px, which was the arithmetic of the old two-column layout (288px event rail + 16px
       gap + a 1180px detail column). That rail is gone, so the sum meant nothing and the page
       simply stopped short of the space it had.
       Still capped rather than full-width: the IMS shell is left-aligned and unbounded, and past
       ~1600px the wide tables turn into strips with their content pinned to both far edges. */
    <div className="space-y-4 xl:max-w-[1600px]">
      {/* ── DEPARTMENT PICKER ──
          Was a <select> buried at the top of the left rail. A dropdown hides its options until
          you open it, so the one thing that scopes this entire page — every figure, every tile,
          every dialog below it — gave no indication of what else it could be showing. Laid out
          flat, the whole set is readable and switching is one click instead of two.
          It sits above the columns rather than inside the rail because it scopes BOTH of them.
          The permission rule is carried over exactly: a user with a single department still gets
          a static badge, because there is nothing for them to switch to. */}
      {/* One row: the department picker on the left, the Planning / On-site switch on the right.
          The switch lives HERE rather than in the income panel, because that panel only renders
          in Planning view — putting the switch inside it would leave On-site with no way back.
          This row renders in both. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
      {/* w-fit so the bar ends where the last department does. As a block element it stretched
          the full measure, leaving most of it empty white — a panel the width of the page reads
          as a section header rather than as the control it is.
          max-w-full keeps it inside the page on narrow screens, where the inner overflow-x
          takes over and the chips scroll instead. */}
      {/* The white card is sm-and-up only. On a phone this is one small dropdown, and the section
          dropdown directly above it has no card — a bare control next to a carded one reads as
          two unrelated things. Stripped here, the two stack as a matching pair. */}
      {/* ── PHONE: SHARE THE SECTION PICKER'S LINE ──
          The section dropdown is rendered by PlanningTab and this one by DepartmentOpsTab, so
          they are block siblings in a space-y-4 stack and cannot be put in one flex row without
          lifting `dept` state out of this component. Instead this row is pulled up onto that
          line: -48px = the control's own 32px height (py-2 ×2 + a 16px line) plus the 16px
          space-y-4 gap. The offset is safe because BOTH controls are now the same TabsMenu, so
          their heights cannot diverge — and ml-auto keeps this one on the right, clear of it.
          56 rather than the bare 48: this sits inside a `flex items-center` row that adds a few
          pixels of its own above the control, which the raw height calculation does not see. */}
      <div className="w-fit max-w-full ml-auto -mt-14 sm:mt-0 sm:ml-0 sm:bg-white sm:rounded-xl sm:shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] sm:px-3 sm:py-2">
        {/* Scrolls sideways rather than wrapping to a second row: eight departments at a phone
            width would otherwise turn a one-line control into a four-line block. Bar hidden, as
            everywhere else on this page. */}
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {/* The eyebrow earns its place beside a row of chips, where the row needs naming. Beside
              a dropdown that already reads "🛋 Furniture" it is just a second label for the same
              thing, so it drops out on phone. */}
          <span className="hidden sm:inline shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400 pr-1.5">Department</span>
          {/* ── PHONE: THE SAME MENU THE SUB-TABS USE ──
              Eight chips on one scrolling line showed three, and the other five gave no sign
              they existed — a horizontal scroller with no visible edge reads as the whole list.
              The menu shows all eight at once and reuses TabsMenu, so the department picker and
              the section picker behave identically instead of being two different controls that
              happen to look alike. */}
          {!(roleDept && !isAdmin) && (
            <div className="sm:hidden">
              <TabsMenu tabs={deptOptions.map(d => ({ id: d, label: `${DEPT_ICON[d]} ${d}` }))} active={dept} onChange={setDept} tone="accent" />
            </div>
          )}
          {roleDept && !isAdmin ? (
            <span className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold whitespace-nowrap">{DEPT_ICON[roleDept]} {roleDept}</span>
          ) : deptOptions.map(d => {
            const on = dept === d;
            return (
              <button key={d} onClick={() => setDept(d)} aria-current={on ? "true" : undefined}
                className={"hidden sm:inline-flex shrink-0 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-all duration-150 " +
                  (on
                    ? "bg-blue-50 text-blue-700 font-semibold shadow-[0_1px_2px_rgba(37,99,235,0.14),0_4px_10px_-4px_rgba(37,99,235,0.3)]"
                    : "text-gray-600 font-medium hover:text-gray-900 hover:bg-gray-50 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(16,24,40,0.06),0_4px_10px_-6px_rgba(16,24,40,0.2)]")}>
                {DEPT_ICON[d]} {d}
              </button>
            );
          })}
        </div>
      </div>
      </div>

      {/* ── Department detail for the selected event ──
          The event-list rail that used to sit to the left of this is gone: the Calendar tab is
          now the one place an event is chosen, and it hands the choice over. This page shows
          whatever it was given.
          ── A MEASURE, NOT A CAP ──
          The IMS shell is full-width and left-aligned, which removed the dead margin — but it
          also let this column grow to ~2200px on a wide monitor. At that width every card
          became a strip with its content pinned to the two far edges: the event header read as
          empty in the middle, and the inventory table's ITEM column took half the row before
          DETAILS even started. max-w caps the READING width while min-w-0 keeps it
          left-aligned, so the gap does not come back — the space simply sits to the right of
          the content instead of inside it. */}
      {/* No cap of its own any more. 1180px was this column's share back when a 288px event rail
          sat to its left; with the rail gone it just left a dead strip down the right-hand side.
          The wrapper above still sets the reading measure, so the content fills that and stops. */}
      <div className="w-full min-w-0">
        {!sel ? (
          /* ── WHY THIS LEAD HAS NO PLANNING ──
             Landing here from an LMS lead in the Calendar tab, the search finds nothing and the
             detail pane sat on "Select an event", which reads as "pick one from the list" when
             the list is empty. The honest answer is that ops plans Studio deals, and this lead
             is not one yet — so say that, and say what to do about it. */
          search.trim() && events.length === 0 ? (
            <div className="max-w-md mx-auto text-center py-16 px-4">
              <div aria-hidden="true" className="text-3xl">📭</div>
              <div className="mt-3 text-sm font-semibold text-gray-800">“{search.trim()}” is not a Studio deal yet</div>
              <div className="mt-2 text-xs text-gray-500 leading-relaxed">
                This looks like an LMS lead. Ops plans from Studio deals only — build the event in
                Studio and mark it sold, and it will appear in this list on its own. Nothing needs
                to be created here.
              </div>
              {/* A filled button, not a text link. It is the only action on an otherwise dead
                  end, so it has to read as the way out — blue text on white was competing
                  with the body copy above it and losing.
                  The link carries the client name and, when we know it, the LMS entry number.
                  Studio sets those into its client-name field, which is what already drives its
                  LMS lead search, then loads the named contract through its own "Load →" path —
                  so the Event Info form opens filled in, not blank. */}
              <a href={`${import.meta.env.BASE_URL}#/studio?client=${encodeURIComponent(search.trim())}${leadEntry ? `&lmsRef=${encodeURIComponent(leadEntry)}` : ""}`}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(37,99,235,0.3),0_6px_16px_-6px_rgba(37,99,235,0.6)] hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(37,99,235,0.3),0_12px_24px_-8px_rgba(37,99,235,0.65)] transition-all duration-150">
                <span aria-hidden="true">🎨</span>
                Build this deal in Studio
                <span aria-hidden="true">→</span>
              </a>
            </div>
          ) : (
            /* ── PICK AN EVENT, RIGHT HERE ──
               A month grid of the events this page can actually plan, so choosing one no longer
               means a round trip to the Calendar tab. Deliberately NOT the Calendar tab's grid:
               that one lists every LMS lead, and most of those have no Studio deal behind them —
               they would be un-clickable rows on a page whose whole job is planning a sold deal.
               This shows only what `events` already holds: live, sold event_orders. */
            (() => {
              const { y, m } = pickMonth;
              const first = new Date(y, m, 1);
              const startDow = first.getDay();
              const dim = new Date(y, m + 1, 0).getDate();
              const pad = (n) => String(n).padStart(2, "0");
              // Changing month clears the open day — its date belongs to the month you just left,
              // so the list underneath would keep showing events that are no longer on the grid.
              const prev = () => { setPickDay(null); setPickMonth(m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }); };
              const next = () => { setPickDay(null); setPickMonth(m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }); };
              const cells = [];
              for (let i = 0; i < startDow; i++) cells.push(null);
              for (let d = 1; d <= dim; d++) cells.push(d);
              while (cells.length % 7 !== 0) cells.push(null);   // close the last week
              const monthTotal = Object.values(pickByDate).reduce((s, a) => s + a.length, 0);
              // The phone grid shows the real dates either side of the month instead of blanks,
              // greyed out. A blank corner reads as a rendering fault; "27 28 29 30" reads as
              // the week continuing, which is what a calendar is supposed to show.
              const iso = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
              const mCells = [];
              for (let i = startDow; i > 0; i--) { const dt = new Date(y, m, 1 - i); mCells.push({ d: dt.getDate(), ds: iso(dt), out: true }); }
              for (let d = 1; d <= dim; d++) mCells.push({ d, ds: `${y}-${pad(m + 1)}-${pad(d)}`, out: false });
              for (let i = 1; mCells.length % 7 !== 0; i++) { const dt = new Date(y, m + 1, i); mCells.push({ d: dt.getDate(), ds: iso(dt), out: true }); }
              const dayLabel = pickDay ? new Date(pickDay + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "";
              return (
                <div className="bg-white rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
                  <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">Pick an event to plan</div>
                      <h3 className="mt-0.5 text-base font-bold text-gray-900 tracking-tight">{first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h3>
                      <div className="text-[11px] text-gray-500 mt-0.5">{monthTotal} sold event{monthTotal === 1 ? "" : "s"} this month · {DEPT_ICON[dept]} {dept}</div>
                    </div>
                    {/* Today as a pill, the arrows as circles — the arrows are a pair doing one
                        job and the pill is a separate one, so they should not look alike. Drawn
                        chevrons rather than ‹ › glyphs, which sit off-centre in most faces. */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => { setPickDay(null); setPickMonth({ y: _now.getFullYear(), m: _now.getMonth() }); }}
                        className="px-3 h-9 rounded-full text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition">Today</button>
                      <button onClick={prev} title="Previous month" aria-label="Previous month"
                        className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 transition">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3.5 L5 7 L9 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                      <button onClick={next} title="Next month" aria-label="Next month"
                        className="w-9 h-9 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900 transition">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  </div>
                  {/* ── PHONE LAYOUT ──
                      Seven columns of 84px cells with a name chip inside each is a desktop shape;
                      at phone width a column is ~45px, so the chips truncate to two characters
                      and the month becomes unreadable. Below sm the grid collapses to dates only
                      — a dot marks a day that has events — and tapping a date lists that day's
                      events underneath at full width, where the names actually fit. */}
                  <div className="sm:hidden">
                    <div className="grid grid-cols-7 px-2">
                      {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                        <div key={i} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 py-2">{d}</div>
                      ))}
                    </div>
                    {/* Every date is a filled tile, not a bare number on white. It gives each day
                        a real edge to aim at on a touch screen, and it is what separates the
                        month from the days either side of it without needing a rule. */}
                    <div className="grid grid-cols-7 px-2 pb-3 gap-1">
                      {mCells.map(({ d, ds, out }) => {
                        const evs = out ? [] : (pickByDate[ds] || []);
                        const isToday = ds === today;
                        const on = pickDay === ds;
                        return (
                          <button key={ds} onClick={() => !out && evs.length && setPickDay(on ? null : ds)}
                            disabled={out || !evs.length}
                            aria-label={`${ds}${evs.length ? ` — ${evs.length} event(s)` : ""}`}
                            className={"h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors "
                              + (on ? "bg-blue-600"
                                : out ? "bg-transparent"
                                : evs.length ? "bg-blue-50 active:bg-blue-100"
                                : "bg-gray-50")}>
                            <span className={"text-[13px] tabular-nums leading-none "
                              + (on ? "text-white font-bold"
                                : out ? "text-gray-300 font-normal"
                                : evs.length ? "text-blue-800 font-bold"
                                : isToday ? "text-blue-600 font-bold" : "text-gray-600 font-medium")}>{d}</span>
                            {/* A dot only where there is something — the tile tint already says
                                it too, but the dot survives at a glance when the row is scanned
                                rather than read. */}
                            <span className={"w-1.5 h-1.5 rounded-full " + (on ? "bg-white" : evs.length ? "bg-blue-500" : "bg-transparent")} />
                          </button>
                        );
                      })}
                    </div>
                    {(() => {
                      const dayEvs = pickDay ? (pickByDate[pickDay] || []) : [];
                      if (!pickDay) return <div className="px-4 pb-4 text-center text-[11px] text-gray-400">Tap a highlighted date to see its events.</div>;
                      return (
                        <div className="px-3 pb-3">
                          <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                            <span className="text-[13px] font-bold text-gray-900">Events on {dayLabel}</span>
                            <span className="shrink-0 text-[11px] text-gray-400">{dayEvs.length} event{dayEvs.length === 1 ? "" : "s"}</span>
                          </div>
                          <div className="space-y-2">
                            {dayEvs.map(eo => (
                              <button key={eo.id} onClick={() => setSelId(eo.id)}
                                className="w-full text-left rounded-xl bg-gray-50 hover:bg-blue-50 active:bg-blue-100 px-3 py-3 flex items-center gap-3 transition-colors">
                                <span aria-hidden="true" className="shrink-0 w-2.5 h-2.5 rounded-full bg-blue-500" />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-gray-900 truncate">{eo.clientName || "Event"}</span>
                                  {/* Venue and shift, because that is what an event_order actually
                                      carries — there are no start/end times on one to show. */}
                                  <span className="block text-[11px] text-gray-500 truncate">
                                    {eo.functionsDetail?.[0]?.venue || eo.venue || "—"}
                                    {eo.functionsDetail?.[0]?.shift ? ` · ${eo.functionsDetail[0].shift}` : ""}
                                  </span>
                                </span>
                                <span aria-hidden="true" className="shrink-0 text-gray-400">
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3.5 L9 7 L5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="hidden sm:grid grid-cols-7">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                      <div key={d} className="text-center text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 py-2.5">{d}</div>
                    ))}
                  </div>
                  <div className="hidden sm:grid grid-cols-7 gap-px bg-gray-100">
                    {cells.map((d, i) => {
                      if (!d) return <div key={"e" + i} className="min-h-[84px] bg-gray-50/70" />;
                      const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
                      const evs = pickByDate[ds] || [];
                      const isToday = ds === today;
                      return (
                        <div key={d} className={"min-h-[84px] p-1.5 bg-white " + (isToday ? "bg-blue-50/60" : "")}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={"tabular-nums leading-none " + (isToday ? "bg-blue-600 text-white text-[11px] font-bold rounded-full w-[20px] h-[20px] flex items-center justify-center" : "text-[12px] font-semibold text-gray-600")}>{d}</span>
                          </div>
                          <div className="space-y-1">
                            {/* Each event is its own button — clicking a DAY would be ambiguous on
                                a date carrying two events, and this page can only show one. */}
                            {evs.map(eo => (
                              <button key={eo.id} onClick={() => setSelId(eo.id)} title={`Plan ${eo.clientName || "Event"}`}
                                className="w-full text-left text-[11px] font-medium leading-tight pl-2 pr-1.5 py-1 rounded-md truncate border-l-[3px] border-blue-500 bg-blue-50/80 text-blue-900 hover:bg-blue-100 transition-colors">
                                {eo.clientName || "Event"}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {monthTotal === 0 && (
                    <div className="px-4 py-3 text-center text-[11px] text-gray-400">
                      No sold events this month — page to another month{onGoToCalendar ? ", or open the Calendar to see every LMS lead" : ""}.
                      {onGoToCalendar && <button onClick={onGoToCalendar} className="ml-1 font-semibold text-blue-600 hover:text-blue-800">Open Calendar →</button>}
                    </div>
                  )}
                </div>
              );
            })()
          )
        ) : (
          <div className="space-y-4">
            {/* ── EVENT HEADER ──
                The department emoji moves out of the title text into a tile. Inline, it was
                set at heading size and competed with the words; in a tile it becomes the mark
                you find the department BY and the title reads as one phrase.
                The Planning / On-site switch moves up here from below the Recent-changes
                panel. It decides what the whole right-hand column shows, so it belongs beside
                the thing it scopes rather than buried between two content cards. Same two
                buttons and the same setOpsView — relocated, not added to. */}
            {/* Full width, like every other card in this column — it is the event's header, so it
                spans what it heads. Only the height came down: the icon tile, the chevron and the
                type each dropped a step (see below), which is what made the bar thinner without
                changing what it holds.
                justify-between gives the bell and the Planning / On-site switch the far right of
                this row — see `viewControls` for why they belong here and nowhere else. */}
            {/* ── CARD CONTAINER (design system §7) ──
                rounded-2xl on a soft, wide shadow rather than the tight hairline the other cards
                use. This is the one card on the page that names what everything below it is
                about, so it is allowed to sit a little further off the ground than they do.
                font-body puts Inter on the card's running text; the title takes Playfair from
                font-display below. Scoped to this card and not to `body`, because Studio has its
                own typography and is not part of this system. */}
            <div className="font-body bg-white rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.2)] px-3 py-2.5 flex items-center justify-between flex-wrap gap-x-2 gap-y-1.5">
              <div className="flex items-center gap-2 min-w-0">
                {/* ── THE WAY BACK ──
                    Picking an event on the calendar replaces it with this header, and there was
                    no route back — the calendar only renders while nothing is selected, so the
                    only escape was reloading the tab.
                    It clears `search` as well as the selection: arriving from an unmatched LMS
                    lead leaves a client name in there, and with it still set the empty-list
                    branch would show "not a Studio deal yet" instead of the calendar. */}
                <button onClick={() => { setSelId(null); setSearch(""); }}
                  title="Back to the calendar" aria-label="Back to the calendar"
                  className="group shrink-0 w-8 h-8 rounded-lg bg-white ring-1 ring-gray-200 hover:ring-gray-300 hover:bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors">
                  <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path d="M9.5 3.5 L5 7.5 L9.5 11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {/* The system draws this as a photo of the item. There is no image on a
                    department — it is a category, not a product — so the tile keeps the
                    department's emoji and takes the system's shape and soft-blue ground
                    instead. Blue rather than grey also separates it from the back button
                    beside it, which is now white: two grey squares side by side read as a
                    pair of buttons, and only one of them is one. */}
                <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-[15px] leading-none">{DEPT_ICON[dept]}</span>
                <div className="min-w-0">
                  {/* ── TEXT ELEMENTS (design system §8) ──
                      Playfair SemiBold for the title, Inter Regular for the line under it — the
                      system's one typographic rule, serif for what names the thing and sans for
                      what describes it.
                      The spec sets H2 at 22 and body at 16, drawn at desktop width. Both are held
                      a step down on a phone — 16 and 12. At the spec's sizes this card was the
                      tallest thing above the fold on a 390px screen and its two rows ran into
                      each other, which is the whole reason it read as big and clustered. Playfair
                      also carries more weight per pixel than the sans it replaced, so 16px here
                      is not smaller than the 15px plain title it started as. Full spec sizes
                      from sm up, where there is room for them. */}
                  <div className="font-display text-[16px] sm:text-[22px] font-semibold text-gray-900 leading-tight sm:leading-snug truncate">{dept} — {sel.clientName || "Event"}</div>
                  {/* Wraps to a second line on a phone rather than truncating. Three facts are
                      joined here — date, venue, who touched it last — and a single line at 390px
                      always cut the third one mid-name, which is the one piece you would be
                      reading it for. Capped at two lines so a long venue cannot push the card
                      taller than the tiles it sits above; from sm there is room for one line and
                      it truncates as before. */}
                  <div className="text-[12px] sm:text-sm text-gray-500 leading-snug line-clamp-2 sm:truncate">{selDateStr || "no date"} · {sel.functionsDetail?.[0]?.venue || sel.venue || "—"}{deptData.updatedBy ? ` · last edited by ${deptData.updatedBy}` : ""}</div>
                  {/* Deal value — read-only mirror of Studio's negotiated amount (client_ledger),
                      written whenever Deal Check syncs. It stays frozen once booked by owner decision;
                      "pending" is the live build's drift since booking, shown here so ops sees the same
                      number Studio does, but only Studio can fold it into the deal value (Apply button
                      on the Summary hero) — this view has no action for it. */}
                  {sel.dealValue && (
                    <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-700">💰 Deal value: ₹{Number(sel.dealValue.amount || 0).toLocaleString("en-IN")}</span>
                      {!!sel.dealValue.pending && (
                        <span className={"font-bold px-1.5 py-0.5 rounded text-[11px] " + (sel.dealValue.pending > 0 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                          {sel.dealValue.pending > 0 ? "+" : ""}₹{Number(sel.dealValue.pending).toLocaleString("en-IN")} pending (not yet applied in Studio)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {viewControls}
            </div>

            {/* Recent changes — a salesperson can now add/remove/change items on a sold deal at any
                time, no approval needed (owner decision, replaces the old last-minute amendment gate).
                This is purely informational: what changed, who changed it, when — read-only, no
                action required. Written by StudioApp.jsx's reconcileSoldInventoryBlocks whenever this
                event's + this department's reserved items actually change. */}
            {(() => {
              const shown = recentChanges;
              if (!logOpen || !shown.length) return null;
              return (
                <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6">
                  <div className="absolute inset-0 bg-gray-900/50" onClick={() => setLogOpen(false)} />
                  <div role="dialog" aria-modal="true" className="relative w-full sm:max-w-2xl bg-white sm:rounded-2xl shadow-2xl overflow-y-auto max-h-full sm:max-h-[80vh]">
                  <div className="sticky top-0 z-10 bg-white px-4 py-3 flex items-center gap-2">
                    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center text-base leading-none">🕑</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900">Activity log</div>
                      <div className="text-[11px] text-gray-500">Read-only · written from Studio · {dept} · {sel.clientName || "Event"}</div>
                    </div>
                    <button onClick={() => setLogOpen(false)} aria-label="Close"
                      className="group shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    {/* A drawn cross, not the ✕ character. The glyph is a font fallback away
                       from rendering at the wrong weight or off-centre, and it cannot be given
                       a real stroke width. Grey at rest, red on hover: a permanently red X reads
                       as a warning on a panel you are only reading. */}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                  </div>
                  <div className="px-4 py-3">
                  {/* A timeline, not a paragraph list. Each entry is one edit at one time, and a
                      dot with a connecting rule says that at a glance — the previous version ran
                      the author, the change and the timestamp together as prose, so telling two
                      entries apart meant reading both in full. */}
                  <div className="">
                    {shown.map(r => {
                      /* ── THE VERB IS SAID ONCE, NOT PER ITEM ──
                         This was one run-on sentence that repeated the verb for every item:
                         "added X ×1, added Y ×2, added Z ×16, added W ×8". Four items meant four
                         "added"s and the names buried between them. Grouping by the change means
                         the verb is stated once and the items sit under it as chips, so what
                         happened is one word and what it happened to is a scannable list. The
                         three verbs get their own colour and their own mark — added, removed and
                         qty-changed are genuinely different events. */
                      const VERB = {
                        added: { label: "Added", mark: "+", tile: "bg-emerald-100 text-emerald-700", item: "bg-white border-emerald-200 text-emerald-900" },
                        removed: { label: "Removed", mark: "−", tile: "bg-rose-100 text-rose-700", item: "bg-white border-rose-200 text-rose-900" },
                        qty_changed: { label: "Quantity changed", mark: "±", tile: "bg-amber-100 text-amber-700", item: "bg-white border-amber-200 text-amber-900" },
                      };
                      const groups = {};
                      (r.items || []).forEach(it => {
                        const k = it.change === "removed" ? "removed" : it.change === "qty_changed" ? "qty_changed" : "added";
                        (groups[k] = groups[k] || []).push(it);
                      });
                      const keys = ["added", "qty_changed", "removed"].filter(k => groups[k]);
                      // The tile takes the verb of the entry's largest group. An entry that mixes
                      // verbs still lists each one below; the tile is a glance-level mark, and a
                      // mixed entry has no single true colour — so it takes the dominant one
                      // rather than inventing a fourth "mixed" state.
                      const lead = keys.slice().sort((a, b) => groups[b].length - groups[a].length)[0] || "added";
                      const count = (r.items || []).length;
                      const stamp = r.requestedAt ? new Date(r.requestedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
                      return (
                        <div key={r.id} className="flex gap-3 py-2.5 first:pt-1">
                          <span aria-hidden="true" className={"shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold leading-none " + VERB[lead].tile}>{VERB[lead].mark}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-xs font-bold text-gray-900">
                                {keys.length === 1 ? `${VERB[lead].label} ${count} item${count === 1 ? "" : "s"}` : `${count} item${count === 1 ? "" : "s"} changed`}
                                <span className="font-medium text-gray-500"> · {r.requestedBy || "—"}</span>
                              </span>
                              {/* Exact time stays on the title — the shorthand is for scanning,
                                  not a replacement for the record. */}
                              <span className="shrink-0 text-[10px] font-medium text-gray-400 whitespace-nowrap tabular-nums" title={stamp}>{relTime(r.requestedAt)}</span>
                            </div>
                            {keys.map(k => (
                              <div key={k} className="mt-1.5 flex items-start gap-1.5 flex-wrap">
                                {keys.length > 1 && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400 pt-0.5">{VERB[k].label}</span>}
                                {groups[k].map((it, ii) => (
                                  <span key={ii} className={"text-[11px] px-2 py-0.5 rounded border " + VERB[k].item}>
                                    {it.name}{it.qty ? <span className="font-semibold tabular-nums"> ×{it.qty}</span> : null}
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                  </div>
                </div>
              );
            })()}

            {/* Sub-view switch (Planning / On-site) now lives in the event header above — it
                scopes the entire column, so it sits with the event rather than between cards. */}

            {opsView === "planning" && (<>

            {/* Department income (from Deal Check snapshot — matches Studio). Floral is split into real
                (mandi) vs artificial; Manpower uses the LIVE edited plan so crew edits move the total. */}
            {deptIncome ? (() => {
              // The maths moved to the `income` memo so the PDF export and this panel cannot
              // drift: a head added here but not there would put two different breakdowns of the
              // same department in front of the same person.
              const { shown, shownSum, gap, liveTotal, pct } = income;
              return (
              <div className="space-y-3">
                {/* ── A READOUT, NOT CARDS ──
                    These figures open nothing. As a row of cards they were indistinguishable
                    from the tiles below — same size, same elevation, same rounded box — so the
                    page showed two identical rows and only one of them answered a click. A card
                    is a promise of interactivity; spending it on read-only numbers makes the
                    real targets harder to find.
                    So: one surface. The total sits on the left behind a blue rule, the heads
                    that make it up are stat columns beside it. Nothing here can be mistaken for
                    something to press. */}
                <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] overflow-hidden">
                  {/* The total is its own tier. Sharing a line with the heads made it just the
                      leftmost of four numbers; on its own row at twice their size it reads as
                      the figure the others add up to. */}
                  {/* ── EARNED vs SPENT, AS TWO CARDS ──
                      One shape for both, so the pair reads as a comparison rather than a headline
                      with a footnote. Same padding, same type scale, same ground — only the
                      figures differ. Equal min-widths keep them the same size whatever the two
                      numbers are, so neither looks more important because it has more digits.
                      ("Projected income" was a third card here and is gone: it was
                      deptIncome.total exactly as synced, while Total income is that same figure
                      with the snapshot crew swapped for the live crew plan. They differed only by
                      however much the crew had been edited since the sync — on an untouched deal,
                      by nothing but rounding.) */}
                  {/* flex-1 min-w-0 below sm, so the pair sits two-up on a phone instead of
                      stacking: at 210px minimum they could not share a 390px screen and the
                      comparison — earned against spent — turned into two unrelated figures a
                      scroll apart. From sm the old minimum is back, which is what keeps them
                      equally sized whatever the two numbers are. */}
                  <div className="px-4 py-3 flex items-stretch gap-3 flex-wrap">
                    {/* The earned figure is filled, not another grey box. It is the number the
                        whole panel is about and everything below is it taken apart, so it carries
                        the page's one block of colour. Its partner stays grey: two filled cards
                        would be a pair of headlines with nothing to compare them against. */}
                    <div className="rounded-xl bg-blue-600 px-4 py-3 flex-1 min-w-0 sm:min-w-[210px] shadow-[0_1px_2px_rgba(37,99,235,0.25),0_8px_20px_-10px_rgba(37,99,235,0.75)]">
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-blue-200">Total income</div>
                      <div className="mt-1.5 text-[20px] leading-none font-bold text-white tabular-nums tracking-tight">{fmt(liveTotal)}</div>
                      <div className="mt-1.5 text-[10px] text-blue-100">What {dept} earns · synced from Deal Check</div>
                    </div>
                    {/* Not synced from anywhere, unlike its neighbours — a plain manual figure the
                        department head types in themselves. Amber, not grey/blue, so it never looks
                        like another system-derived readout. */}
                    <div className="rounded-xl bg-amber-50 px-4 py-3 flex-1 min-w-0 sm:min-w-[210px] ring-1 ring-amber-200">
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-amber-600">Discount to salesperson</div>
                      <div className="mt-1.5 flex items-center gap-1">
                        <span className="text-[16px] font-bold text-amber-900">₹</span>
                        <input type="number" min="0" value={discount}
                          onChange={e => saveDept({ discount: e.target.value === "" ? "" : Math.max(0, Number(e.target.value) || 0) })}
                          placeholder="0" className="w-full bg-transparent text-[20px] leading-none font-bold text-amber-900 tabular-nums tracking-tight outline-none" />
                      </div>
                      <div className="mt-1.5 text-[10px] text-amber-700">Manual — set by {dept} head for the salesperson on this deal</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-4 py-3 flex-1 min-w-0 sm:min-w-[210px]">
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-400">Actual cost logged</div>
                      {/* Grey dash until something is logged. A ₹0 here would read as "spent
                          nothing", which is a different claim from "not recorded yet". */}
                      <div className={"mt-1.5 text-[20px] leading-none font-bold tabular-nums tracking-tight " + (hasActuals ? "text-gray-900" : "text-gray-300")}>{hasActuals ? fmt(actualCost) : "—"}</div>
                      <div className="mt-1.5 text-[10px] text-gray-500">{hasActuals ? "What you actually spent" : "Not logged yet"}</div>
                    </div>
                    {/* Net = income − discount − actual cost. The bottom line the first three cards
                        add up to, so it gets its own colour rather than sharing grey/amber with a
                        component it's actually the result of. Actual cost counts as 0 here until
                        logged (Not logged yet ≠ spent nothing, but a net figure has to start somewhere). */}
                    {(() => {
                      const netAmount = liveTotal - (Number(discount) || 0) - (hasActuals ? actualCost : 0);
                      const neg = netAmount < 0;
                      return (
                        <div className={"rounded-xl px-4 py-3 flex-1 min-w-0 sm:min-w-[210px] ring-1 " + (neg ? "bg-red-50 ring-red-200" : "bg-emerald-50 ring-emerald-200")}>
                          <div className={"text-[9px] font-bold uppercase tracking-[0.08em] " + (neg ? "text-red-600" : "text-emerald-600")}>Net</div>
                          <div className={"mt-1.5 text-[20px] leading-none font-bold tabular-nums tracking-tight " + (neg ? "text-red-900" : "text-emerald-900")}>{fmt(netAmount)}</div>
                          <div className={"mt-1.5 text-[10px] " + (neg ? "text-red-700" : "text-emerald-700")}>Income − discount − actual cost{!hasActuals ? " (cost not logged yet)" : ""}</div>
                        </div>
                      );
                    })()}
                  </div>
                  {/* Saying it in words. The heads below are not a second set of numbers, they
                      are the one above taken apart — and nothing on the panel said so, which is
                      the whole reason it needed reading twice. */}
                  <div className="px-4 py-1.5 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-gray-500">What makes up this total</span>
                    <span className="text-[9px] font-semibold text-gray-400 tabular-nums">{shown.length} head{shown.length === 1 ? "" : "s"} · {fmt(shownSum)}</span>
                  </div>
                  {/* gap-px over a grey ground, not divide-x: with divide-x the hairline is drawn
                      per element, so a wrapped row gets a stray rule down its leading edge. The
                      grid gap shows the ground through and separates cells correctly however
                      many heads a department has and however they wrap. */}
                  <div className="grid gap-px bg-gray-100" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
                    {shown.map((r, i) => (
                      <div key={i} className="bg-white px-4 py-2.5">
                        {/* The emoji sits in a neutral tile rather than loose beside the label.
                            Loose, a column of them read as clutter — each glyph renders at its
                            own weight and colour, so they never looked like a set. Boxed at one
                            size on one grey, the tile is the repeated shape and the glyph inside
                            it is just what distinguishes this row, the same way it works on the
                            blocks below.
                            Sentence case, not uppercase: these are names to read, and "Real
                            flowers (mandi)" set in tracked capitals is slower than it looks. */}
                        <div className="flex items-center gap-2 min-w-0">
                          <span aria-hidden="true" className="shrink-0 w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-[13px] leading-none">{HEAD_ICON[r.label] || "•"}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold text-gray-700 truncate" title={r.label}>{r.label}</div>
                            <div className="mt-0.5 text-[14px] leading-none font-bold text-gray-900 tabular-nums tracking-tight">{fmt(r.value)}</div>
                          </div>
                        </div>
                        {/* No drawn bar. The share is stated, not plotted: at these widths the
                            bar was a full-width blue rule under every head, which read as a
                            divider before it read as a measure — and the number beside it was
                            the part anyone actually used.
                            "42%" alone begs the question "of what", so the two words stay. */}
                        <div className="mt-1 pl-9 text-[9px] font-medium text-gray-400 tabular-nums">{pct(r.value)}% of total</div>
                      </div>
                    ))}
                  </div>
                  {/* Came off the P&L panel that used to close the page. It explains where the
                      "Actual cost logged" figure above goes, so it belongs with it — and without
                      it, nothing tells ops that what they record here is what the salesperson
                      sees in Studio. */}
                  <div className="px-4 py-2 bg-gray-50 text-[10px] text-gray-500">
                    Actuals you save here flow to the event&apos;s P&amp;L, visible to the salesperson in Studio.
                  </div>
                </div>

                {shown.length === 0 && (
                  <div className="bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] px-4 py-5 text-center text-xs text-gray-400">No income heads on this department yet.</div>
                )}
                {/* The donut and its legend are gone — every figure they carried (label, share,
                    amount) is already on the cards above, so the ring restated the strip in a
                    second, less precise form. This note is NOT decoration and stays: it is the
                    only place the page says the heads and the department total disagree. */}
                {gap !== 0 && shown.length > 0 && (
                  <div className="bg-amber-50 rounded-xl px-4 py-2.5 text-[11px] text-amber-800">
                    Heads above sum to {fmt(shownSum)} — {fmt(Math.abs(gap))} {gap > 0 ? "less than" : "more than"} the department total. The total carries the live crew plan; a head may not be broken out here.
                  </div>
                )}
              </div>
              );
            })() : (
              <div className="bg-amber-50 rounded-lg px-4 py-3 text-xs text-amber-800">No Deal Check breakdown synced yet for this event. In Studio → Deal Check → <b>Dept Income</b>, click <b>📤 Sync to IMS Dept Ops</b> to push the numbers here.</div>
            )}

            {/* ── THE TILE GRID ──
                One tile per content block, four to a row. Each carries the one figure you open
                the block for, so the common case — "what is the manpower cost" — is answered
                without opening anything at all. */}
            {(() => {
              const n = (v, s) => `${v} ${s}${v === 1 ? "" : "s"}`;
              const tiles = [
                dept === "Fabric" && upcomingFabricShort.length > 0 && { k: "fabshort", icon: "⚠️", title: "Fabric shortfalls", sub: n(upcomingFabricShort.length, "upcoming event"), tone: "bg-red-50", alert: true },
                dept === "Fabric" && { k: "fabreq", icon: "🧵", title: "Fabric required", sub: fabricReqRows.length ? n(fabricReqRows.length, "fabric type") : "nothing required" },
                { k: "inv", icon: "📦", title: "Inventory blocked", sub: n(blockedItemsGrouped.length, "item") + " held", value: fmt(rentalIncome) },
                { k: "mp", icon: "👷", title: "Manpower plan", sub: mpRows.length ? n(mpRows.length, "crew line") : "no crew assigned", value: fmt(mpCost) },
                { k: "actuals", icon: "🧾", title: "Actuals", sub: hasActuals ? "real spend logged" : "nothing logged yet", value: hasActuals ? fmt(actualCost) : null },
                { k: "load", icon: "🚚", title: "Loading & dispatch", sub: trucks.length ? n(trucks.length, "truck") : "no trucks yet" },
                blockedItems.length > 0 && { k: "dism", icon: "🔁", title: "Dismantle plan", sub: "where each item goes after" },
              ].filter(Boolean);
              return (
                <div className={GRID}>
                  {tiles.map(t => (
                    /* No drawn outline. Separation comes from the slate-100 page ground under a
                       white fill, plus a two-layer shadow — a tight 1px one that reads as the
                       card's edge and a wide soft one that lifts it off the ground. The tinted
                       tiles (red for a shortfall, sky for receiving) separate by fill alone. */
                    <button key={t.k} onClick={() => setModal(t.k)}
                      /* Clicking the open tile again closes it — with the block inline, the tile
                         is a toggle, not a launcher. The open one is ringed so you can tell at a
                         glance which of the five the panel below belongs to. */
                      onClickCapture={e => { if (modal === t.k) { e.stopPropagation(); setModal(null); } }}
                      className={"group text-left rounded-xl p-3 sm:p-3.5 h-full flex flex-col transition-all duration-150 shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(16,24,40,0.1),0_14px_28px_-10px_rgba(16,24,40,0.28)] " + (modal === t.k ? "ring-2 ring-blue-500 " : "") + (t.tone || "bg-white")}>
                      {/* One size at every width now. The phone tile used to be the full column
                          wide — one per row — so its type was bumped a step to fill it. Two to a
                          row it is about 170px, narrower than the desktop tile, and the bumped
                          sizes wrapped every title onto three lines. items-start rather than
                          centred for the same reason: once a title can wrap, the icon has to
                          stay level with its first line. */}
                      <div className="flex items-start gap-2.5">
                        <span aria-hidden="true" className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base leading-none " + (t.alert ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "bg-gray-100")}>{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 leading-tight">{t.title}</div>
                          <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{t.sub}</div>
                        </div>
                        {/* gray-300 put this at ~1.5:1 on white — present in the markup, absent
                            on screen. gray-500 is 4.8:1, and it darkens on hover so the chevron
                            confirms the whole tile is the target, not just the corner it sits in.
                            Hidden below sm: at a 170px column it cost real width the title needed,
                            and on a touch screen there is no hover state for it to explain. */}
                        <span aria-hidden="true" className="hidden sm:block shrink-0 text-gray-500 group-hover:text-gray-900 text-base font-semibold leading-none transition-colors">›</span>
                      </div>
                      {/* Only tiles that HAVE a headline figure reserve room for one — an empty
                          line on the others would read as a number that failed to load. */}
                      {t.value && <div className="mt-auto pt-2.5 text-lg font-bold text-gray-900 tabular-nums tracking-tight">{t.value}</div>}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── THE BODIES ──
                Every block below stays exactly where it was written. This wrapper is `hidden`
                until a tile is picked, at which point it becomes the dialog and the one block
                whose key matches un-hides itself (see modalCls). */}
            {/* ── OPENS IN PLACE, UNDER THE TILES ──
                Not a dialog any more. A block is its tile's own detail, so it belongs directly
                beneath the row you clicked rather than over the top of the page — the tiles, the
                income cards and the event header all stay in view while you read it.
                Same mechanic as before: every block still lives here and hides itself unless it
                is the open one (modalCls), so nothing had to be moved or re-parented. */}
            <div onClick={onPanelBackdrop} className={modal ? PANEL_WRAP : "hidden"}>
              <div className={PANEL_CARD}>
                {/* NOT sticky from sm up. It was, back when this panel was a dialog with its own
                    scroll — but inline the page scrolls instead, so a sticky bar just hovers over
                    the block underneath and covered the first block's subtitle permanently.
                    Nothing is lost by letting it scroll away: the tile above toggles the panel
                    shut, and Escape still closes it. On a phone it is pinned by the flex column
                    instead — the body scrolls under it — so the close button is always reachable
                    without scrolling a sheet back to the top. */}
                <div className="shrink-0 bg-white px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 text-[13px] font-semibold text-gray-600 truncate">{DEPT_ICON[dept]} {dept} · {sel.clientName || "Event"}</div>
                  <button onClick={() => setModal(null)} aria-label="Close"
                    className="group shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    {/* A drawn cross, not the ✕ character. The glyph is a font fallback away
                       from rendering at the wrong weight or off-centre, and it cannot be given
                       a real stroke width. Grey at rest, red on hover: a permanently red X reads
                       as a warning on a panel you are only reading. */}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className={PANEL_BODY}>

            {/* Fabric: stock vs requirement + shortfall (Fabric dept only) */}
            {dept === "Fabric" && (
              <div className="space-y-3">
                {/* Prior heads-up: any upcoming event short on fabric */}
                {upcomingFabricShort.length > 0 && (
                  <div className={"bg-red-50 rounded-xl overflow-hidden" + modalCls("fabshort")}>
                    <div className="px-4 py-2.5 bg-red-100/70 text-sm font-bold text-red-800">⚠️ {upcomingFabricShort.length} upcoming fabric shortfall{upcomingFabricShort.length > 1 ? "s" : ""} — order ahead</div>
                    <div className="">
                      {upcomingFabricShort.map((s, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs">
                          <span className="text-red-800"><b>{s.fabric}</b> · {s.colour}</span>
                          <span className="text-red-700">short <b>{s.short} {s.unit}</b> for {s.event} on <b>{s.date}</b>{s.contended ? " (shared with another same-day event)" : ""}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-1.5 text-[10px] text-red-500">Total available counts Old + New stock. Update live quantities in Planning → Fabric Stock after each washing cycle.</div>
                  </div>
                )}
                {/* This event's requirement vs available */}
                <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("fabreq")}>
                  <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-semibold text-gray-800">🧵 Fabric required vs available <span className="text-xs font-normal text-gray-400">— for this event</span></span>
                    <span className="text-xs text-gray-400">Available = Old + New stock</span>
                  </div>
                  {fabricReqRows.length === 0 ? (
                    <div className="px-4 py-5 text-center text-xs text-gray-400">{sel?.fabricPlan ? "No fabric required for this event." : "No fabric plan synced yet — open Deal Check for this event in Studio."}</div>
                  ) : fabricReqRows.map(ft => (
                    <div key={ft.key}>
                      <div className="px-4 py-1.5 bg-gray-50/60 text-xs font-semibold text-gray-700">{ft.emoji} {ft.label}</div>
                      <div className="">
                        {ft.rows.map((r, i) => (
                          /* Four fixed columns need ~430px. Below sm the colour takes its own
                             line and need / have / short wrap under it left-aligned — the
                             right-alignment only earns its keep when the rows line up. */
                          <div key={i} className="flex flex-wrap sm:grid sm:grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 sm:gap-2 px-4 py-1.5 text-xs items-center">
                            <span className="w-full sm:w-auto text-gray-800">{r.colour}</span>
                            <span className="text-gray-500 sm:w-24 sm:text-right">need <b>{r.required} {ft.unit}</b></span>
                            <span className="text-gray-500 sm:w-40 sm:text-right">have {r.avail} <span className="text-gray-400">({r.old} old + {r.new} new{r.otherDay > 0 ? ` − ${r.otherDay} same-day` : ""})</span></span>
                            <span className={"sm:w-24 sm:text-right font-bold " + (r.short > 0 ? "text-red-600" : "text-emerald-600")}>{r.short > 0 ? `short ${r.short} ${ft.unit}` : "✓ ok"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocked inventory */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("inv")}>
              {/* Summary strip. Tinted blue rather than grey and the figure set in a white pill:
                  with the rows below now white cards on a light ground, a grey header read as
                  one more row instead of as the thing they add up to. */}
              {/* No flex-wrap. It was wrapping on a phone — title on one line, the figure dropped
                  onto a second — which doubled the strip's height for a caption and a number that
                  both fit once the title is allowed to truncate. min-w-0 on the text block is what
                  lets it truncate rather than push the figure off the row. */}
              <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-blue-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] flex items-center justify-center text-sm leading-none">📦</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">Inventory blocked for {dept}</div>
                    <div className="text-[10px] text-gray-500 truncate">{blockedItemsGrouped.length} item{blockedItemsGrouped.length === 1 ? "" : "s"} held for this event</div>
                  </div>
                </div>
                <div className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[15px] font-bold text-gray-900 tabular-nums whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,0.06)]">{fmt(rentalIncome)}</div>
              </div>
              {blockedItemsGrouped.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No inventory blocked for this department on this event.</div>
              ) : (
                /* ── ONE CARD PER ITEM, NOT A TABLE ──
                   This was a five-column table with a header row, which meant two different
                   layouts to maintain: a real table from sm up and a grid that faked one below,
                   with the whole display chain (table → tbody → tr → td) switching at the
                   breakpoint. One card per row is a single layout that works at every width, and
                   it drops the 640px minimum that used to put a money table in a horizontal
                   scroller on a phone.
                   The header row goes with it: with one row per card there is nothing for a
                   shared header to sit above, so each figure carries its own label — which is
                   also the only form that survived the phone layout anyway. */
                <div className="p-2.5 space-y-2">
                  {blockedItemsGrouped.map(it => {
                    // ── WHY THE TOTAL IS NOT ALWAYS RATE × QTY ──
                    // On rows pushed from Deal Check, `unit` and `total` are independent fields:
                    // unit is the base rental, total is the line rental — and for a KIT that
                    // total also carries its components (see the snapshot branch of
                    // blockedItemsGrouped). Only the IMS fallback path computes total = unit ×
                    // qty. Naming the two as columns therefore displays arithmetic that visibly
                    // fails on kit lines, so a row where they disagree says why instead of
                    // looking like a calculation bug.
                    const derived = Math.round((Number(it.unit) || 0) * (Number(it.qty) || 0));
                    const mismatch = derived !== Math.round(Number(it.total) || 0);
                    return (
                    <div key={it.id} className="rounded-xl bg-white ring-1 ring-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] overflow-hidden">
                      {/* flex-wrap, so the figures drop to their own full-width line on a phone
                          and sit inline beside the name from sm up — one rule instead of two
                          layouts. */}
                      <div className="p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-12 h-12 rounded-lg object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-lg shrink-0">📦</div>}
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 truncate">{it.name}</div>
                              {/* Every status badge the flat-list version carried, kept as a
                                  wrapping row under the name instead of trailing off the end of
                                  it — in a fixed-width ITEM column four inline badges pushed the
                                  name out of sight, which is the opposite of what they are for. */}
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {/* ── THE KIT BADGE IS THE TOGGLE ──
                                    The components are the one thing on this row that can be
                                    opened, and the badge is already the thing that says there
                                    are any — so it opens them rather than a separate control
                                    competing with it. It carries the count, so you can tell
                                    what you are unfolding before you unfold it.
                                    A kit with no components stays a plain label: a control that
                                    reveals nothing is worse than no control. */}
                                {it.isKit && ((it.components || []).length > 0 ? (
                                  <button onClick={() => setKitOpen(o => ({ ...o, [it.id]: !o[it.id] }))}
                                    aria-expanded={!!kitOpen[it.id]}
                                    title={kitOpen[it.id] ? "Hide the kit's contents" : "Show what is inside this kit"}
                                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold hover:bg-blue-200 transition-colors">
                                    KIT · {it.components.length}
                                    <span aria-hidden="true" className={"transition-transform duration-150 " + (kitOpen[it.id] ? "rotate-180" : "")}>
                                      <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                    </span>
                                  </button>
                                ) : (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">KIT</span>
                                ))}
                                {it.shortQty > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">SHORT ×{it.shortQty}</span>}
                                {it.prodOrBuy && <span className={"text-[10px] px-1.5 py-0.5 rounded font-bold " + (it.prodOrBuy === "buying" ? "bg-orange-100 text-orange-700" : "bg-purple-100 text-purple-700")}>{it.prodOrBuy === "buying" ? "🛒 BUYING" : "🏭 PRODUCTION"}</span>}
                                {it.isSwapped && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold">🔁 SWAPPED</span>}
                              </div>
                              {/* Sub-category and the explanations that go with it. They used to
                                  be their own DETAILS column; on a card they belong under the
                                  name they describe. */}
                              <div className="text-xs text-gray-500 mt-0.5">
                                <div className="truncate" title={it.sub || ""}>{it.sub || "—"}</div>
                                {it.shortQty > 0 && <div className="text-amber-600 mt-0.5">{it.shortQty} short of stock — priced at cost, chase or produce</div>}
                                {it.isSwapped && <div className="text-sky-600 mt-0.5">swapped in for {it.swappedFrom}</div>}
                              </div>
                            </div>
                          </div>
                          {/* Divided from the name and from each other, so three right-aligned
                              figures read as three columns rather than one run of digits. */}
                          <div className="w-full sm:w-auto flex items-start gap-0 divide-x divide-gray-100 sm:border-l sm:border-gray-100 sm:pl-1">
                            <StatCell label="Qty" w={STAT_W.qty}>
                              <span className="text-sm font-semibold text-gray-700 tabular-nums">×{it.qty}</span>
                            </StatCell>
                            <StatCell label="Rate" w={STAT_W.rate}>
                              <span className="text-sm text-gray-600 tabular-nums">{fmt(it.unit)}</span>
                            </StatCell>
                            <StatCell label="Total" w={STAT_W.total}>
                              <div className="text-sm font-bold text-gray-900 tabular-nums">{fmt(it.total)}</div>
                              {mismatch && <div className="text-[10px] text-gray-400 tabular-nums mt-0.5" title={`Rate × qty is ${fmt(derived)}. This line is ${fmt(it.total)}${it.isKit ? " because a kit's total includes the components listed below." : "."}`}>{it.isKit ? "incl. kit" : `≠ ${fmt(derived)}`}</div>}
                            </StatCell>
                          </div>
                      </div>
                      {/* Kit contents — each sub-element loaded separately, with its own rental
                          (customised per-deal by the salesperson). Their totals sum to the kit
                          total above, which is why the three figures reuse the kit row's own
                          column widths: the sum only reads as a sum if it lines up under it.
                          Tinted and inset, so an opened kit is visibly part of its card rather
                          than a run of new items after it. */}
                      {it.isKit && kitOpen[it.id] && it.components && it.components.length > 0 && (
                        <div className="bg-blue-50/50 px-2.5 py-1.5 space-y-1">
                          {it.components.map((cp, ci) => (
                            <div key={"c" + ci} className="flex items-center gap-2">
                              <span aria-hidden="true" className="text-blue-300 shrink-0 text-xs">└</span>
                              {cp.photo ? <img src={cp.photo} alt="" onClick={() => setZoomImg(cp.photo)} className="w-6 h-6 rounded object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-[10px] shrink-0">🌸</div>}
                              <span className="text-xs text-gray-700 truncate flex-1 min-w-0" title={cp.sub || ""}>{cp.name}</span>
                              <span className={"shrink-0 text-xs font-medium text-gray-500 text-right tabular-nums " + STAT_W.qty}>×{cp.qty}</span>
                              <span className={"shrink-0 text-xs text-gray-500 text-right tabular-nums " + STAT_W.rate}>{fmt(cp.unit)}</span>
                              <span className={"shrink-0 text-xs font-semibold text-gray-700 text-right tabular-nums " + STAT_W.total}>{fmt(cp.total)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Manpower plan (editable / override) */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("mp")}>
              {/* Same compact tinted strip the Inventory panel uses, deliberately. The reference
                  for this panel draws a taller header with the figure on its own line below the
                  caption — but that is the shape that was just trimmed off Inventory for being
                  too tall, and two panels opened from the same row of tiles should not disagree
                  about what their own header looks like. */}
              <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-blue-50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] flex items-center justify-center text-sm leading-none">👷</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">Manpower plan</div>
                    <div className="text-[10px] text-gray-500 truncate">From Studio; edit any field, it saves. Sum matches the income card.</div>
                  </div>
                </div>
                <div className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[15px] font-bold text-gray-900 tabular-nums whitespace-nowrap shadow-[0_1px_2px_rgba(16,24,40,0.06)]">{fmt(mpCost)}</div>
              </div>
              {/* The booking note as its own tinted card with a marker, not a grey 10px line
                  wedged under the header. It explains how every figure below is arrived at, so
                  it is the thing to read before the rows — at 10px grey on grey it read as a
                  caption on the header and was skipped. */}
              {sel.mpPhases && (
                <div className="m-2.5 mb-0 px-2.5 py-2 rounded-xl bg-gray-50 flex items-start gap-2 text-[11px] text-gray-600 leading-relaxed">
                  <span aria-hidden="true" className="shrink-0 text-sm leading-none mt-px">📅</span>
                  <span>Crew booked across: {sel.mpPhases.minusOne ? "−1 setup day · " : ""}{sel.mpPhases.eventDays || 0} event day{(sel.mpPhases.eventDays || 0) > 1 ? "s" : ""}{sel.mpPhases.gapDays ? ` · ${sel.mpPhases.gapDays} gap day(s)` : ""}{sel.mpPhases.dismantle ? " · +1 dismantle day" : ""}. Each crew line = peak count × ₹/day × its working days (open a row to see the math).</span>
                </div>
              )}
              {mpRows.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-gray-400">No crew assigned to {dept} for this event — matches the ₹0 income card. Add a crew type below if you need one.</div>
              )}
              <div className="p-2.5 space-y-2">
                {mpRows.map((r, i) => {
                  const overridden = r.sysCount != null && Number(r.count) !== Number(r.sysCount);
                  const open = !!mpOpen[i];
                  return (
                    /* ── ONE CARD PER CREW TYPE ──
                       These rows were a single wrapping flex line with the derivation toggle as
                       a small "▸ how" pill at its head. With two inputs, a label, a badge and a
                       total on one line, a phone wrapped it into an unpredictable shape — and the
                       toggle, which is the most useful control here, looked like the least
                       important thing on the row.
                       As a card it is two deliberate lines: who, and how many, on top; what they
                       cost, below. The toggle becomes the chevron tile that opens the card. */
                    <div key={i} className="rounded-xl bg-white ring-1 ring-gray-100 shadow-[0_1px_2px_rgba(16,24,40,0.05)] p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setMpOpen(o => ({ ...o, [i]: !o[i] }))}
                          aria-expanded={open}
                          className="shrink-0 w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors"
                          title={open ? "Hide how this crew number was calculated" : "How this crew number was calculated"}>
                          <span aria-hidden="true" className={"transition-transform duration-150 " + (open ? "rotate-180" : "")}>
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3.5 5 L7 8.5 L10.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </span>
                        </button>
                        <span aria-hidden="true" className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-sm leading-none">{crewIcon(r.type)}</span>
                        <span className="flex-1 min-w-0 text-sm font-semibold text-gray-900 truncate">{r.type}{r.shared && <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold align-middle">SHARED</span>}</span>
                        {r.shared && !dayWise(r) ? (
                          <span className="shrink-0 text-[10px] text-gray-400">split allocation</span>
                        ) : dayWise(r) ? (
                          <div className="shrink-0 flex items-center gap-1.5"><span className="text-[11px] text-gray-400" title="Total dihari (crew × shifts, summed across all days). Auto-calculated — edit the crew on any day in the plan below and this updates.">dihari</span><span className="w-16 rounded-lg px-2 py-1.5 text-sm text-center font-bold bg-gray-100 text-gray-700" title="Auto-calculated from the day-wise plan below">{Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : 0}</span></div>
                        ) : (
                          <div className="shrink-0 flex items-center gap-1.5"><span className="text-[11px] text-gray-400">qty</span><input type="number" min="0" value={r.count} onChange={e => setMp(i, "count", e.target.value)} className={"w-16 rounded-lg px-2 py-1.5 text-sm text-center font-semibold ring-1 " + (overridden ? "ring-amber-400 bg-amber-50 font-bold" : "ring-gray-200 bg-white")} /></div>
                        )}
                      </div>
                      {/* Second line: the rate that is editable, and the line total it produces.
                          The total sits in a filled pill rather than as loose text so the one
                          figure you cannot type into does not look like another input. */}
                      {!(r.shared && !dayWise(r)) && (
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 text-[11px] text-gray-400">₹/day</span>
                          <input type="number" min="0" value={r.rate} onChange={e => setMp(i, "rate", e.target.value)} className="w-24 rounded-lg ring-1 ring-gray-200 bg-white px-2 py-1.5 text-sm text-center font-semibold" />
                          <div className="ml-auto shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-900 tabular-nums">{fmt(lineCost(r))}</div>
                        </div>
                      )}
                      {r.shared && !dayWise(r) && (
                        <div className="flex items-center">
                          <div className="ml-auto shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-900 tabular-nums">{fmt(lineCost(r))}</div>
                        </div>
                      )}
                      {open && (
                        <div className="text-[10px] text-gray-500 leading-relaxed bg-gray-50 rounded-lg p-2">
                          {r.shared ? (
                            <>
                              <div className="text-[10px] uppercase tracking-wide text-blue-500 font-semibold mb-1">How {r.type} derived → then split</div>
                              {renderMpTrace(r.trace)}
                              {renderMpSchedule(r)}
                              {r.splitInfo && r.splitInfo.byUsage && r.splitInfo.usageTotal > 0 ? (
                                <div className="mt-1 bg-white border rounded-lg p-2 text-gray-600">
                                  <b>{r.type}</b> split by <b>sub-category usage</b>{r.splitInfo.perDay ? ", computed per day" : ""} — each sub-category's labour goes to its department (1 labour per N units → charged to that sub's dept).<br />
                                  {r.splitInfo.perDay && <span className="text-gray-500">Per-day bifurcation is in the schedule above (open each day's <b>how</b>). Booking average: </span>}
                                  This dept's labour usage <b>{r.splitInfo.deptUsage}</b> ÷ all-dept usage <b>{r.splitInfo.usageTotal}</b> = <b>{Math.round((r.splitInfo.deptUsage / r.splitInfo.usageTotal) * 100)}%</b><br />
                                  → total {r.type} {fmt(r.splitInfo.total)} → <b className="text-gray-900">{fmt(Number(r.sysCost) || 0)}</b> to {dept}
                                </div>
                              ) : r.splitInfo && r.splitInfo.directTotal > 0 ? (
                                <div className="mt-1 bg-white border rounded-lg p-2 text-gray-600">
                                  <b>{r.type}</b> are shared crew, split across all departments by income share:<br />
                                  Total {r.type} on this event: <b>{fmt(r.splitInfo.total)}</b><br />
                                  This dept's direct income {fmt(r.splitInfo.deptDirect)} ÷ all-dept income {fmt(r.splitInfo.directTotal)} = <b>{Math.round((r.splitInfo.deptDirect / r.splitInfo.directTotal) * 100)}%</b><br />
                                  → {fmt(r.splitInfo.total)} × {Math.round((r.splitInfo.deptDirect / r.splitInfo.directTotal) * 100)}% = <b className="text-gray-900">{fmt(Number(r.sysCost) || 0)}</b> to {dept}
                                </div>
                              ) : <div className="text-gray-500">Split across departments. This dept's allocation = <b>{fmt(Number(r.sysCost) || 0)}</b>.</div>}
                              {Number(lineCost(r)) !== (Number(r.sysCost) || 0) && (
                                <div className="mt-1 text-amber-600 font-semibold">✏️ You tuned this dept's crew/rate per day → line now <b>{fmt(lineCost(r))}</b> (system split was {fmt(Number(r.sysCost) || 0)}).</div>
                              )}
                            </>
                          ) : (<>
                            <div className="text-[10px] uppercase tracking-wide text-blue-500 font-semibold mb-1">How {r.sysCount != null && r.sysCount !== "" ? r.sysCount : (r.count || "")} {r.type} derived</div>
                            {renderMpTrace(r.trace)}
                            {renderMpSchedule(r)}
                            {r.basis && !r.trace && <span className="text-gray-600">📐 {r.basis}<br /></span>}
                            {r.sysCount != null && r.sysCount !== "" && (() => {
                              // Cost is DIHARI-based (crew × shifts per day + dismantle), not crew×days — show it that
                              // way so the math reconciles with the day-wise total (e.g. 33 dihari × ₹1,500 = ₹49,500)
                              // instead of the misleading "N crew × days" which doesn't multiply to the shown total.
                              const sysDihari = Number(r.sysRate) > 0 ? Math.round((Number(r.sysCost) || 0) / Number(r.sysRate)) : (Number(r.sysCount) || 0);
                              const ovrDihari = Number(r.rate) > 0 ? Math.round(Number(lineCost(r)) / Number(r.rate)) : (Number(r.count) || 0);
                              return (
                              <span className={overridden ? "text-amber-600 font-semibold" : "text-gray-500"}>
                                Studio plan: {sysDihari} dihari × {fmt(r.sysRate || 0)} = {fmt(r.sysCost || 0)}
                                {overridden && <> → you set <b>{ovrDihari} dihari × {fmt(r.rate || 0)} = {fmt(lineCost(r))}</b></>}
                              </span>
                              );
                            })()}
                          </>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* A dashed full-width slot rather than a small text link. It sits at the end of a
                  column of filled cards, so drawing it as the outline of the card it would add
                  says what it does without a word of explanation — and gives it a target the
                  width of the rows it joins instead of the width of three words. */}
              <div className="px-2.5 pb-2.5">
                <button onClick={addMp} className="w-full rounded-xl border-2 border-dashed border-blue-200 hover:border-blue-300 hover:bg-blue-50/50 text-blue-600 text-[13px] font-semibold py-2.5 flex items-center justify-center gap-1.5 transition-colors">
                  <span aria-hidden="true" className="text-base leading-none">+</span> Add crew type
                </button>
              </div>
            </div>

            {/* Actuals → exact cost */}
            <div className={"bg-emerald-50 rounded-xl overflow-hidden" + modalCls("actuals")}>
              <div className="px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold text-emerald-900">🧾 Actuals (real spend) <span className="text-xs font-normal text-emerald-600">— turns projected into exact P&L</span></span>
                {hasActuals && <span className="text-sm font-bold text-emerald-800">{fmt(actualCost)}</span>}
              </div>
              <div className="px-4 pb-3 space-y-2">
                {dept === "Floral" && (() => {
                  const projectedTotal = Number(fp.projected) || 0;
                  const variance = mandiActualTotal - projectedTotal;
                  return (
                    <div className="space-y-2">
                      {/* Ops view — FLORAL COST (what ops spends to source flowers). Client billing is
                          intentionally NOT shown here — ops only needs the real mandi + artificial spend
                          and how each is derived. */}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-hidden text-xs">
                        <div className="px-3 py-2 bg-emerald-50 font-semibold text-emerald-900 flex justify-between"><span>🌸 Floral cost to source</span><span>{fmt(mandiActualTotal)}</span></div>
                        <div className="">
                          <div className="flex justify-between px-3 py-1.5"><span className="text-gray-600">🌿 Real flowers (mandi) <span className="text-[10px] text-gray-400">— see shopping list below</span></span><span className="font-medium text-gray-800">{fmt(mandiActualReal)}</span></div>
                          <div>
                            <div className="flex justify-between px-3 py-1.5 items-center">
                              <span className="text-gray-600 flex items-center gap-1.5">🌸 Artificial flowers {fp.artificial && <button onClick={() => setArtHowOpen(o => !o)} className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1 leading-tight" title="How the artificial cost is derived">{artHowOpen ? "▾" : "▸"} how</button>}</span>
                              <span className="font-medium text-gray-800">{fmt(fp.artificial ? fp.artificial.total : artificialProj)}</span>
                            </div>
                            {fp.artificial && artHowOpen && (
                              <div className="px-3 pb-2">
                                <div className="bg-gray-50 border rounded-lg p-2 text-[10px] text-gray-600 space-y-1">
                                  {fp.artificial.flowerBunches > 0 && <div>🌸 Flowers: <b>{fp.artificial.flowerBunches}</b> bunches ÷ {fp.artificial.flowerBPK}/kg = <b>{fp.artificial.flowerKg} kg</b> × {fmt(fp.artificial.flowerRate)}/kg = <b className="text-gray-900">{fmt(fp.artificial.flowerCost)}</b></div>}
                                  {fp.artificial.greenBunches > 0 && <div>🌿 Greens: <b>{fp.artificial.greenBunches}</b> bunches ÷ {fp.artificial.greenBPK}/kg = <b>{fp.artificial.greenKg} kg</b> × {fmt(fp.artificial.greenRate)}/kg = <b className="text-gray-900">{fmt(fp.artificial.greenCost)}</b></div>}
                                  {fp.artificial.flowerBunches <= 0 && fp.artificial.greenBunches <= 0 && <div className="text-gray-400 italic">No artificial bunches captured — set "Art Bunches/Unit" on flowers in the Mandi tab.</div>}
                                  <div className="pt-1 text-right">Total artificial = <b className="text-gray-900">{fmt(fp.artificial.total)}</b></div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {fp.season && fp.season.mult && fp.season.mult !== 1 && <div className="px-3 py-1.5 rounded-lg text-[10px] text-emerald-700 bg-emerald-100/50 border border-emerald-100">📅 {fp.season.label} date — mandi flower prices ×{fp.season.mult} (e.g. a ₹1000 flower bills at ₹{Math.round(1000 * fp.season.mult)})</div>}
                      {/* Projected vs real mandi — side by side, editable real shopping list */}
                      {/* Projected and Real are two fixed columns (w-28 + w-44) and Real holds
                          qty × ₹/unit × total × delete — ~330px that cannot compress, which left
                          the flower name about 30px on a phone. The comparison only works if the
                          two columns stay aligned, so this scrolls sideways rather than reflows. */}
                      <div className="bg-white border border-emerald-100 rounded-lg overflow-x-auto">
                        <div className="min-w-[430px]">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-100/60 text-[10px] font-semibold text-emerald-900 uppercase tracking-wide items-center">
                          <span className="flex items-center gap-2">🌸 Flower
                            {seedMandi.length > 0 && <button onClick={resetMandi} title="Undo your edits — restore the system's original mandi plan from Deal Check" className="normal-case text-[10px] font-semibold text-emerald-700 border border-emerald-300 rounded px-1.5 py-0.5 hover:bg-emerald-200/60">↺ Reset to system plan</button>}
                          </span>
                          <span className="text-right w-28">Projected (plan)</span>
                          <span className="text-right w-44">Real shopping</span>
                        </div>
                        {/* Column labels for the two editable fields */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 pt-1 text-[10px] text-emerald-700/70 uppercase tracking-wide">
                          <span></span><span className="w-28"></span>
                          <span className="flex items-center justify-end gap-1 w-44"><span className="w-12 text-center">qty</span><span className="text-transparent">×</span><span className="w-16 text-center">₹/unit</span><span className="w-14 text-right">total</span><span className="w-3"></span></span>
                        </div>
                        <div className="px-3 py-1 bg-emerald-50/40 text-[10px] text-emerald-700/80">Real shopping = <b>qty × ₹/unit</b>. Projected = planned units from the recipe × mandi price{fp.season && fp.season.mult && fp.season.mult !== 1 ? ` × ${fp.season.mult} season` : ""}.</div>
                        {mandiRows.length === 0 && fpFlowers.length === 0 ? (
                          <div className="px-3 py-3 text-xs text-gray-400 text-center">No mandi plan captured. Add flowers below, or run Deal Check before marking Sold to auto-capture it.</div>
                        ) : (
                          <div className="">
                            {mandiRows.map((r, i) => {
                              const lineActual = (Number(r.qty) || 0) * (Number(r.price) || 0);
                              const lineVar = lineActual - (Number(r.projCost) || 0);
                              return (
                                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 items-center">
                                  <div className="min-w-0"><div className="text-xs font-medium text-gray-800 truncate">{r.name}</div>{r.projQty > 0 && <div className="text-[10px] text-gray-400">{r.projQty} {r.unit} planned</div>}</div>
                                  <div className="text-right w-28 text-xs text-gray-400">{r.projCost > 0 ? fmt(r.projCost) : <span className="text-amber-500">extra</span>}</div>
                                  <div className="flex items-center justify-end gap-1 w-44">
                                    <input type="number" min="0" value={r.qty} onChange={e => setMandi(i, "qty", e.target.value)} className="w-12 border rounded px-1.5 py-1 text-xs text-center" title="qty" />
                                    <span className="text-[10px] text-gray-300">×</span>
                                    <input type="number" min="0" value={r.price} onChange={e => setMandi(i, "price", e.target.value)} className="w-16 border rounded px-1.5 py-1 text-xs text-center" title="₹/unit" />
                                    <span className={"text-xs font-semibold w-14 text-right " + (lineVar > 0 ? "text-red-500" : lineVar < 0 ? "text-emerald-600" : "text-gray-700")}>{fmt(lineActual)}</span>
                                    <button onClick={() => delMandi(i)} className="text-red-300 hover:text-red-500 text-xs">×</button>
                                  </div>
                                </div>
                              );
                            })}
                            {(fp.artificial || artificialProj > 0) && (() => {
                              const art = fp.artificial;
                              const artTot = art ? art.total : artificialProj;
                              return (
                                <div className="bg-gray-50/60">
                                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 items-center">
                                    <div className="text-xs text-gray-500 flex items-center gap-1.5 min-w-0">
                                      {art && <button onClick={() => setArtHowOpen(o => !o)} className="shrink-0 text-[10px] font-semibold text-blue-500 hover:text-blue-700 border border-blue-200 rounded px-1 leading-tight" title="How the artificial cost was calculated">{artHowOpen ? "▾" : "▸"} how</button>}
                                      <span className="truncate">Artificial flowers / greens <span className="text-[10px] text-gray-400">(not mandi-shopped)</span></span>
                                    </div>
                                    <div className="text-right w-28 text-xs text-gray-400">{fmt(artTot)}</div>
                                    <div className="text-right w-44 text-xs text-gray-500 pr-6">{fmt(artTot)}</div>
                                  </div>
                                  {art && artHowOpen && (
                                    <div className="px-3 pb-2">
                                      <div className="bg-white border rounded-lg p-2 text-[10px] text-gray-600 space-y-1">
                                        {art.flowerBunches > 0 && <div>🌸 Flowers: <b>{art.flowerBunches}</b> bunches ÷ {art.flowerBPK}/kg = <b>{art.flowerKg} kg</b> × {fmt(art.flowerRate)}/kg = <b className="text-gray-900">{fmt(art.flowerCost)}</b></div>}
                                        {art.greenBunches > 0 && <div>🌿 Greens: <b>{art.greenBunches}</b> bunches ÷ {art.greenBPK}/kg = <b>{art.greenKg} kg</b> × {fmt(art.greenRate)}/kg = <b className="text-gray-900">{fmt(art.greenCost)}</b></div>}
                                        {art.flowerBunches <= 0 && art.greenBunches <= 0 && <div className="text-gray-400 italic">No artificial bunches captured — set "Art Bunches/Unit" on flowers in the Mandi tab.</div>}
                                        <div className="pt-1 text-right">Total artificial = <b className="text-gray-900">{fmt(art.total)}</b></div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {/* Totals row */}
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 bg-emerald-50 items-center">
                          <span className="text-xs font-bold text-emerald-900">Total</span>
                          <span className="text-right w-28 text-xs font-semibold text-gray-500">{fmt(projectedTotal)}</span>
                          <span className="text-right w-44 text-sm font-bold text-emerald-800 pr-6">{fmt(mandiActualTotal)}</span>
                        </div>
                        </div>
                      </div>
                      {/* Add a flower with autocomplete from the Mandi Prices tab */}
                      <div className="relative">
                        <input value={mandiQuery} onChange={e => setMandiQuery(e.target.value)} placeholder="➕ Add flower — type e.g. 'mu' for Muraya (from Mandi Prices)" className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm" />
                        {mandiSuggest.length > 0 && (
                          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                            {mandiSuggest.map(f => (
                              <button key={f.id} onClick={() => addMandi(f)} className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-emerald-50 text-left">
                                <span className="font-medium text-gray-800">{f.name} <span className="text-[10px] text-gray-400">{f.flowerCat} · {f.unit}</span></span>
                                <span className="text-xs font-semibold text-emerald-700">{fmt(f.currentPrice)}/{f.unit}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {mandiQuery.trim() && mandiSuggest.length === 0 && <div className="absolute z-20 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg px-3 py-2 text-xs text-gray-400">No match in Mandi Prices. <button onClick={() => addMandi({ name: mandiQuery.trim(), unit: "bundle", currentPrice: 0 })} className="text-emerald-600 font-medium">Add "{mandiQuery.trim()}" anyway</button></div>}
                      </div>
                      {mandiActualTotal > 0 && projectedTotal > 0 && (
                        <div className={"text-xs font-semibold " + (variance > 0 ? "text-red-600" : "text-emerald-700")}>
                          {variance > 0 ? "▲ Over" : variance < 0 ? "▼ Under" : "On"} plan by {fmt(Math.abs(variance))} — salesperson's P&L uses the real {fmt(mandiActualTotal)}.
                        </div>
                      )}
                    </div>
                  );
                })()}
                {expenses.map((ex, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={ex.label} onChange={e => setExpense(i, "label", e.target.value)} placeholder="on-site expense" className="flex-1 border border-emerald-200 rounded-lg px-3 py-2 text-sm" />
                    <input type="number" min="0" value={ex.amount} onChange={e => setExpense(i, "amount", e.target.value)} placeholder="₹" className="w-28 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-right" />
                    <button onClick={() => delExpense(i)} className="text-red-400 hover:text-red-600 text-sm px-1">×</button>
                  </div>
                ))}
                <button onClick={addExpense} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium">+ Add on-site expense</button>
              </div>
            </div>

            {/* Loading / dispatch — cross-check inventory + essentials while loading the truck */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("load")}>
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold text-gray-800">🚚 Loading & dispatch <span className="text-xs font-normal text-gray-400">— split inventory across trucks; each prints its own challan</span></span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowFleet(v => !v)} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">{showFleet ? "Done" : "⚙️ Manage fleet"}</button>
                  <button onClick={addTruck} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Add truck</button>
                </div>
              </div>
              {showFleet && (
                <div className="px-4 py-3 bg-gray-50 space-y-2">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Own fleet (shared across departments)</div>
                  {fleet.map(f => (
                    <div key={f.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 font-medium text-gray-700">🚛 {f.vehicle}</span>
                      <span className="text-gray-500">{f.driver || "—"}</span>
                      <span className="text-gray-400">{f.phone || ""}</span>
                      <button onClick={() => delFleet(f.id)} className="text-red-300 hover:text-red-500">×</button>
                    </div>
                  ))}
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-end">
                    <input value={newVeh.vehicle} onChange={e => setNewVeh(v => ({ ...v, vehicle: e.target.value }))} placeholder="Vehicle no." className="border rounded px-2 py-1.5 text-xs" />
                    <input value={newVeh.driver} onChange={e => setNewVeh(v => ({ ...v, driver: e.target.value }))} placeholder="Driver name" className="border rounded px-2 py-1.5 text-xs" />
                    <input value={newVeh.phone} onChange={e => setNewVeh(v => ({ ...v, phone: e.target.value }))} placeholder="Phone" className="border rounded px-2 py-1.5 text-xs" />
                    <button onClick={addFleet} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium">Add</button>
                  </div>
                </div>
              )}
              {/* Per-item loaded summary across all trucks */}
              {blockedItems.length > 0 && trucks.length > 0 && (
                <div className="px-4 py-2 bg-gray-50/40">
                  <div className="text-[10px] uppercase text-gray-400 font-semibold mb-1">Loaded across trucks</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {blockedItems.map(it => { const k = "inv:" + it.id; const ld = truckLoadedQty(k); const full = ld >= it.qty; return (
                      <span key={k} className={"text-[11px] " + (full ? "text-emerald-600 font-semibold" : ld > 0 ? "text-amber-600" : "text-gray-400")}>{it.name}: {ld}/{it.qty}</span>
                    ); })}
                  </div>
                </div>
              )}
              {/* Trucks */}
              {trucks.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No trucks yet. Add a truck to load inventory for dispatch across one or more vehicles.</div>
              ) : (
                <div className="">
                  {trucks.map((t, ti) => (
                    <div key={t.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-semibold text-gray-700">🚛 Truck {ti + 1}{t.driver ? <span className="font-normal text-gray-400"> · {t.driver}</span> : null}</span>
                        <div className="flex items-center gap-2">
                          {t.phone && <a href={"tel:" + t.phone} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 hover:bg-emerald-100" title={"Call " + (t.driver || "driver") + " · " + t.phone}>📞 Call</a>}
                          <select value={t.status || "loading"} onChange={e => setTruck(t.id, { status: e.target.value })} className="border rounded-lg px-2 py-1 text-xs capitalize">{TRUCK_STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                          <button onClick={() => printTruckChallan(t, ti + 1)} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg font-medium">🖨️ Challan</button>
                          <button onClick={() => delTruck(t.id)} className="text-red-400 hover:text-red-600 text-sm">×</button>
                        </div>
                      </div>
                      {eventTrucks.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {eventTrucks.map(f => { const on = t.vehicle === f.vehicle && t.driver === f.driver; return (
                            <button key={f.id} onClick={() => setTruck(t.id, { vehicle: f.vehicle || "", driver: f.driver || "", phone: f.phone || "" })} className={"text-[11px] px-2 py-1 rounded-lg border " + (on ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-blue-50")}>🚛 {f.vehicle || f.driver}{f.vehicle && f.driver ? ` · ${f.driver}` : ""}</button>
                          ); })}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[["Vehicle no.", "vehicle"], ["Driver", "driver"], ["Phone", "phone"]].map(([l, k]) => (
                          <div key={k}><label className="text-[10px] text-gray-400">{l}</label><input value={t[k] || ""} onChange={e => setTruck(t.id, { [k]: e.target.value })} placeholder={k === "vehicle" ? "outside vehicle?" : ""} className="mt-0.5 w-full border rounded-lg px-2 py-1.5 text-sm" /></div>
                        ))}
                      </div>
                      {blockedItems.length > 0 ? (
                        <div className="rounded-lg bg-gray-50/60 p-1">
                          {blockedItems.map(it => { const k = "inv:" + it.id; const onThis = Number(t.items?.[k]) || 0; const totalLoaded = truckLoadedQty(k); const matchCls = totalLoaded === it.qty ? "text-emerald-600" : totalLoaded > it.qty ? "text-red-600" : totalLoaded > 0 ? "text-amber-600" : "text-gray-400"; return (
                            <div key={k} className="flex items-center flex-wrap gap-x-3 gap-y-1.5 px-3 py-1.5">
                              {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-xs shrink-0">📦</div>}
                              <span className="flex-1 min-w-[120px] text-sm text-gray-800">{it.name} <span className="text-[10px] text-gray-400">need {it.qty}</span></span>
                              <span className={"text-[11px] font-semibold w-28 text-right " + matchCls}>{totalLoaded}/{it.qty} loaded{totalLoaded > it.qty ? " ⚠️" : totalLoaded === it.qty ? " ✓" : ""}</span>
                              <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">this truck</span><input type="number" min="0" value={onThis || ""} onChange={e => setTruckItem(t.id, k, e.target.value)} placeholder="0" className="w-14 border rounded px-2 py-1 text-sm text-center" /></div>
                            </div>
                          ); })}
                        </div>
                      ) : <div className="text-xs text-gray-400">No inventory blocked for this department.</div>}
                    </div>
                  ))}
                </div>
              )}
              {/* Essentials / tools */}
              <div className="bg-amber-50/40">
                <div className="px-4 py-2 text-xs font-semibold text-amber-800 flex items-center justify-between">
                  <span>🛠️ Essentials / tools <span className="font-normal text-amber-600">— things you carry but don't block (saved for every {dept} event)</span></span>
                </div>
                {deptTools.length > 0 && (
                  <div className="">
                    {deptTools.map((t, i) => {
                      const k = "tool:" + t.name; const on = !!loaded[k];
                      return (
                        <div key={i} className="flex items-center gap-3 px-4 py-2">
                          <input type="checkbox" checked={on} onChange={() => toggleLoaded(k)} className="w-4 h-4" />
                          <span className={"flex-1 text-sm " + (on ? "line-through text-gray-400" : "text-gray-800")}>{t.name}</span>
                          <input type="number" min="1" value={t.qty || 1} onChange={e => setTool(i, "qty", e.target.value)} className="w-14 border rounded px-1.5 py-1 text-xs text-center" title="qty" />
                          <button onClick={() => delTool(i)} className="text-red-300 hover:text-red-500 text-xs">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="px-4 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={newTool} onChange={e => setNewTool(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addTool(newTool); }} placeholder="Add an essential (e.g. ladder, nails)…" className="flex-1 border border-amber-200 rounded-lg px-3 py-1.5 text-sm" />
                    <button onClick={() => addTool(newTool)} className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium">Add</button>
                  </div>
                  {(DEFAULT_TOOLS[dept] || []).filter(s => !deptTools.some(t => (t.name || "").toLowerCase() === s.toLowerCase())).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(DEFAULT_TOOLS[dept] || []).filter(s => !deptTools.some(t => (t.name || "").toLowerCase() === s.toLowerCase())).map(s => (
                        <button key={s} onClick={() => addTool(s)} className="text-[11px] px-2 py-1 rounded-full bg-white border border-amber-200 text-amber-700 hover:bg-amber-100">+ {s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Dismantle plan — dept head pre-sets where each item goes; ops just confirms on-site */}
            {blockedItems.length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("dism")}>
                <div className="px-4 py-3 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-lg bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] flex items-center justify-center text-base leading-none">🔁</span>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-gray-900">Dismantle plan</div>
                      <div className="text-xs text-gray-500">Pick the transfer sites, then type how many of each item goes to each; the rest stay for production house.</div>
                    </div>
                  </div>
                  <button onClick={resetDismantle} className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg whitespace-nowrap" title="Testing: clear this plan + all on-site movements so you can re-test splits">↺ Reset (testing)</button>
                </div>
                {/* ── SITE CHOOSER ──
                    Each site named here becomes a column in the matrix below, which is the thing
                    the old "Transfer sites:" sentence never said. The label is now an uppercase
                    eyebrow like every other section marker on the page, and the count sits with
                    it so the row states what it has done rather than just what it is.
                    The sky wash is gone: it tinted a strip across a white card for no reason
                    other than that the sites are sky-coloured elsewhere. */}
                <div className="px-4 py-2.5 bg-gray-50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 shrink-0">
                      Transfer sites
                      {dismantleSites.length > 0 && <span className="ml-1.5 text-gray-400 tabular-nums">{dismantleSites.length}</span>}
                    </span>
                    {dismantleSites.map(s => (
                      /* The × is a real target now, not a 10px glyph tucked against the text —
                         and it only turns red on hover, so a destructive control is not shouting
                         from a row you are only reading. */
                      <span key={s.id} className="group inline-flex items-center gap-1.5 text-xs font-semibold bg-white ring-1 ring-sky-200 text-sky-800 rounded-lg pl-2.5 pr-1 py-1">
                        <span aria-hidden="true">↪️</span>
                        <span className="truncate max-w-[220px]">{s.name}</span>
                        {s.date && <span className="font-normal text-sky-500 tabular-nums">{s.date}</span>}
                        <button onClick={() => removeDismantleSite(s.id)} title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`}
                          className="ml-0.5 w-5 h-5 rounded-md flex items-center justify-center text-sky-300 hover:text-red-600 hover:bg-red-50 transition">×</button>
                      </span>
                    ))}
                    {(() => {
                      const opts = nearbyTransferEvents.filter(({ e }) => !dismantleSites.some(s => s.id === e.id));
                      return (
                        <div className="relative">
                          <button ref={siteBtnRef} type="button" onClick={() => setSiteMenu(o => !o)}
                            aria-haspopup="listbox" aria-expanded={siteMenu}
                            className={"inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 px-3 py-1.5 text-xs font-semibold transition " + (siteMenu ? "ring-blue-400 text-blue-700" : "ring-gray-200 hover:ring-gray-300 text-gray-700")}>
                            <span aria-hidden="true" className="text-gray-400">＋</span>
                            Add a site
                            <span aria-hidden="true" className={"text-gray-400 text-[9px] transition-transform " + (siteMenu ? "rotate-180" : "")}>▼</span>
                          </button>
                          {siteMenu && (
                            <div role="listbox" style={{ position: "fixed", top: siteMenuPos.top, left: siteMenuPos.left, width: siteMenuPos.width, zIndex: 60 }}
                              className="rounded-xl bg-white shadow-[0_4px_12px_rgba(16,24,40,0.1),0_16px_40px_-12px_rgba(16,24,40,0.3)] ring-1 ring-gray-200 overflow-hidden">
                              <div className="px-3 py-2 bg-gray-50 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">
                                Send items to another event
                              </div>
                              <div className="max-h-64 overflow-y-auto">
                                {opts.length === 0 && (
                                  <div className="px-3 py-4 text-center text-xs text-gray-400">No other sold events nearby.</div>
                                )}
                                {opts.map(({ e, d, off }) => (
                                  <button key={e.id} type="button" role="option" aria-selected="false"
                                    onClick={() => { addDismantleSite(e.id); setSiteMenu(false); }}
                                    className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-blue-50 transition-colors">
                                    <span className="min-w-0 flex-1">
                                      <span className="block text-[13px] font-semibold text-gray-900 truncate">{e.clientName || "Event"}</span>
                                      <span className="block text-[11px] text-gray-500 tabular-nums">{d || "no date"}</span>
                                    </span>
                                    {/* Same-day is called out because it is the tight one — the
                                        truck has to reach the next site the same evening. The
                                        rest just say how far off, with the sign kept. */}
                                    <span className={"shrink-0 text-[10px] font-bold px-2 py-1 rounded-md tabular-nums whitespace-nowrap " + (off === 0 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500")}>
                                      {off === 0 ? "same day" : off > 0 ? `+${off}d` : `${off}d`}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  {/* Its own line, not trailing off the end of the row — at the end it wrapped
                      under the controls and read as a caption for the dropdown. */}
                  {dismantleSites.length === 0 && (
                    <div className="mt-1.5 text-[10px] text-gray-400">
                      None yet, so everything returns to the production house. Add a site to send items straight there instead.
                    </div>
                  )}
                </div>
                {/* Matrix — one row per item, a column for production house (auto) + each site */}
                <div className="overflow-x-auto">
                  {/* ── NO RULES BETWEEN ROWS ──
                      Every row carried a full-width divider, so a dozen items read as a dozen
                      stripes before it read as a list. Rows are separated by their own height and
                      a hover tint instead — and since the eye tracks a row across to type a
                      number into it, the hover is what actually helps here, which a static line
                      never did. The one rule left is under the header, where it marks the change
                      from labels to data. */}
                  <table className="w-full min-w-[520px] text-sm border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 px-4 py-3">Item</th>
                        <th className="text-center text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 px-3 py-3 whitespace-nowrap">🏭 Production House</th>
                        {dismantleSites.map(s => <th key={s.id} className="text-center text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 px-3 py-3 whitespace-nowrap" title={s.date}>↪️ {s.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {blockedItems.map(it => {
                        const prod = planProdQty(it);
                        // Everything routed to a site — the row is done, so it recedes rather
                        // than sitting at the same weight as the ones still needing a number.
                        const done = prod === 0;
                        return (
                          <tr key={it.id} className="group hover:bg-blue-50/40 transition-colors">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-9 h-9 rounded-lg object-cover cursor-zoom-in shrink-0" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs shrink-0">📦</div>}
                                <span className="min-w-0 truncate text-sm font-medium text-gray-800">{it.name}</span>
                                <span className="shrink-0 text-[11px] font-semibold text-gray-400 tabular-nums">×{it.qty}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={"inline-block min-w-[2.75rem] px-2.5 py-1.5 rounded-lg text-sm font-bold tabular-nums " + (done ? "bg-gray-50 text-gray-300" : "bg-blue-50 text-blue-700")}
                                title="Auto — whatever is left after the sites below">{prod}</span>
                            </td>
                            {dismantleSites.map(s => (
                              <td key={s.id} className="px-3 py-2.5 text-center">
                                {/* Borderless until you touch it: a grid of outlined boxes was
                                    the heaviest thing on the table, and most of them hold 0. */}
                                <input type="number" min="0" max={it.qty} value={planSiteQty(it, s.id) || ""} onChange={e => setSiteQty(it, s.id, e.target.value)} placeholder="0"
                                  className="w-16 rounded-lg bg-gray-100 px-2 py-1.5 text-sm text-center tabular-nums font-semibold text-gray-800 placeholder:font-normal placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:bg-white transition" />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
                </div>
              </div>
            </div>
            </>)}

            {opsView === "onsite" && (<>
            {/* The department chip row that used to sit here is gone. It switched department,
                which is exactly what the Department picker in the left rail already does, under
                the same permission rules — roleDept locks the rail to a badge only when the user
                has ONE department, i.e. only when there is nothing to switch to. So no user
                loses the ability to change department by this removal. */}
            {/* Same tile grid as Planning — the on-site view has three blocks of its own and the
                shortfall count, which is the thing an ops manager checks first, rides on its
                tile so it is answered before anything is opened. */}
            {(() => {
              const short = sourceRows.filter(r => r.shortfall > 0).length;
              const n = (v, s) => `${v} ${s}${v === 1 ? "" : "s"}`;
              const tiles = [
                sourceRows.length > 0 && { k: "rcv", icon: "📥", title: "Receiving", sub: short > 0 ? `⚠️ ${n(short, "item")} short` : "✓ all sourced", tone: short > 0 ? "bg-red-50" : "bg-sky-50", alert: short > 0 },
                { k: "route", icon: "🔁", title: "Dismantle & routing", sub: blockedItems.length ? n(blockedItems.filter(it => unroutedQty(it) > 0).length, "item") + " left to route" : "nothing to route" },
                mpRows.length > 0 && { k: "oscrew", icon: "👷", title: "On-site crew", sub: mpEdited ? "actual logged" : "as planned", value: fmt(mpCost) },
              ].filter(Boolean);
              return (
                <div className={GRID}>
                  {tiles.map(t => (
                    /* No drawn outline. Separation comes from the slate-100 page ground under a
                       white fill, plus a two-layer shadow — a tight 1px one that reads as the
                       card's edge and a wide soft one that lifts it off the ground. The tinted
                       tiles (red for a shortfall, sky for receiving) separate by fill alone. */
                    <button key={t.k} onClick={() => setModal(t.k)}
                      /* Clicking the open tile again closes it — with the block inline, the tile
                         is a toggle, not a launcher. The open one is ringed so you can tell at a
                         glance which of the five the panel below belongs to. */
                      onClickCapture={e => { if (modal === t.k) { e.stopPropagation(); setModal(null); } }}
                      className={"group text-left rounded-xl p-3.5 h-full flex flex-col transition-all duration-150 shadow-[0_1px_2px_rgba(16,24,40,0.07),0_4px_12px_-4px_rgba(16,24,40,0.12)] hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(16,24,40,0.1),0_14px_28px_-10px_rgba(16,24,40,0.28)] " + (modal === t.k ? "ring-2 ring-blue-500 " : "") + (t.tone || "bg-white")}>
                      <div className="flex items-start gap-2.5">
                        <span aria-hidden="true" className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base leading-none " + (t.alert ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "bg-white shadow-[0_1px_2px_rgba(16,24,40,0.08)]")}>{t.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-gray-900 leading-tight">{t.title}</div>
                          <div className="text-[11px] text-gray-500 leading-tight mt-0.5">{t.sub}</div>
                        </div>
                        {/* gray-300 put this at ~1.5:1 on white — present in the markup, absent
                            on screen. gray-500 is 4.8:1, and it darkens on hover so the chevron
                            confirms the whole tile is the target, not just the corner it sits in. */}
                        <span aria-hidden="true" className="shrink-0 text-gray-500 group-hover:text-gray-900 text-base font-semibold leading-none transition-colors">›</span>
                      </div>
                      {t.value && <div className="mt-auto pt-2.5 text-lg font-bold text-gray-900 tabular-nums tracking-tight">{t.value}</div>}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── OPENS IN PLACE, UNDER THE TILES ──
                Not a dialog any more. A block is its tile's own detail, so it belongs directly
                beneath the row you clicked rather than over the top of the page — the tiles, the
                income cards and the event header all stay in view while you read it.
                Same mechanic as before: every block still lives here and hides itself unless it
                is the open one (modalCls), so nothing had to be moved or re-parented. */}
            <div onClick={onPanelBackdrop} className={modal ? PANEL_WRAP : "hidden"}>
              <div className={PANEL_CARD}>
                {/* NOT sticky — see the Planning panel above: inline, a sticky bar just hovers
                    over the block beneath it and hides its subtitle. */}
                <div className="shrink-0 bg-white px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 text-[13px] font-semibold text-gray-600 truncate">{DEPT_ICON[dept]} {dept} · {sel.clientName || "Event"}</div>
                  <button onClick={() => setModal(null)} aria-label="Close"
                    className="group shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors">
                    {/* A drawn cross, not the ✕ character. The glyph is a font fallback away
                       from rendering at the wrong weight or off-centre, and it cannot be given
                       a real stroke width. Grey at rest, red on hover: a permanently red X reads
                       as a warning on a panel you are only reading. */}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className={PANEL_BODY}>

            {/* Receiving — ops manager sees every item's sources (which truck + driver, from where) + shortfall */}
            {sourceRows.length > 0 && (
              <div className={"bg-sky-50 rounded-xl overflow-hidden" + modalCls("rcv")}>
                <div className="px-4 py-2.5 bg-sky-100/70 text-sm font-bold text-sky-800 flex items-center justify-between flex-wrap gap-2">
                  <span>📥 Receiving — sources per item <span className="text-xs font-normal text-sky-600">— who&apos;s bringing what, on which truck</span></span>
                  {(() => { const sc = sourceRows.filter(r => r.shortfall > 0).length; return <span className={"text-xs font-semibold px-2 py-0.5 rounded-full " + (sc > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>{sc > 0 ? `⚠️ ${sc} short` : "✓ all sourced"}</span>; })()}
                </div>
                {sourceRows.some(r => r.shortfall > 0) && (
                  <div className="px-4 py-2 bg-red-50 text-xs text-red-700 font-semibold">⚠️ Shortfall on {sourceRows.filter(r => r.shortfall > 0).length} item(s) — not enough assigned from any source. Check with the dept head / production house.</div>
                )}
                <div>
                  {sourceRows.map((r, i) => (
                    <div key={i} className="px-4 py-2">
                      <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 text-xs">
                        <span className="text-sky-900 font-semibold flex items-center gap-2 min-w-0">
                          {r.photo ? <img src={r.photo} alt="" onClick={() => setZoomImg(r.photo)} className="w-8 h-8 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-8 h-8 rounded bg-sky-100 flex items-center justify-center text-sky-300 text-xs">📦</div>}
                          {r.name}
                        </span>
                        <span className={r.shortfall > 0 ? "text-red-600 font-bold" : "text-sky-800"}>
                          {r.required > 0 ? <>need <b>{r.required}</b> · arriving <b>{r.totalIn}</b></> : <>arriving <b>{r.totalIn}</b></>}
                          {r.shortfall > 0 && <span> · short {r.shortfall}</span>}
                          {r.over > 0 && <span className="text-amber-600"> · +{r.over} extra</span>}
                          {r.required > 0 && r.shortfall === 0 && <span className="text-emerald-600"> ✓</span>}
                        </span>
                      </div>
                      <div className="text-[10px] text-sky-600 mt-1 pl-1 space-y-0.5">
                        {r.whTrucks.map((t, j) => <div key={"w" + j} className="flex items-center gap-1.5 flex-wrap"><span>🚛 {t.qty}× from production house · Truck {t.n}{t.vehicle ? ` (${t.vehicle}${t.driver ? " · " + t.driver : ""})` : t.driver ? ` (${t.driver})` : ""}</span>{t.phone
                          ? <a href={"tel:" + t.phone} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 hover:bg-emerald-100" title={"Call " + (t.driver || "driver") + " · " + t.phone}>📞 Call {t.driver || ""}</a>
                          : <input defaultValue="" onClick={e => e.stopPropagation()} onBlur={e => { const v = e.target.value.trim(); if (v && t.id) setTruck(t.id, { phone: v }); }} placeholder="📞 add driver phone" className="border border-sky-300 rounded-full px-2 py-0.5 text-[10px] w-32" title="Enter the driver's phone to enable Call" />
                        }</div>)}
                        {r.sources.map((s, j) => <div key={"r" + j} className="flex items-center gap-1.5 text-sky-700 flex-wrap"><span>↪️ {s.qty}× reused from {s.from} ({s.dept}){s.vehicle || s.driver ? ` · ${s.vehicle || ""}${s.vehicle && s.driver ? " · " : ""}${s.driver || ""}` : ""}</span>{s.phone && <a href={"tel:" + s.phone} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 hover:bg-emerald-100" title={"Call " + (s.driver || "driver") + " · " + s.phone}>📞 Call {s.driver || ""}</a>}{s.voiceNote && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700"><span title="voice note from the sending site — listen before it arrives">🎤 note:</span><audio src={s.voiceNote} controls className="h-6 max-w-[150px]" /></span>}</div>)}
                        {r.whTrucks.length === 0 && r.sources.length === 0 && <div className="text-gray-400">No truck assigned yet.</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dismantle & return routing */}
            <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("route")}>
              <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">🔁 Dismantle & return routing <span className="text-xs font-normal text-gray-400">— confirm the dept head's plan, or tap a chip to route the full remaining qty</span></span>
                <div className="flex items-center gap-1.5">
                  {blockedItems.some(it => unroutedQty(it) > 0) && (<>
                    <button onClick={confirmAllPlanned} className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap">✓ Confirm all as planned</button>
                    <button onClick={routeAllToWarehouse} className="text-xs font-bold bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg whitespace-nowrap">🏬 All → warehouse</button>
                  </>)}
                  <button onClick={resetDismantle} className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg whitespace-nowrap" title="Testing: clear the plan + all movements so you can re-test">↺ Reset (testing)</button>
                </div>
              </div>
              {/* Loading manifest — grouped by destination (the dept head's plan). Each list = one place. */}
              {destGroups.length > 0 && (
                <div className="px-4 py-3 space-y-2 bg-sky-50/40">
                  <div className="text-xs font-semibold text-gray-600">📦 Loading manifest — by destination · put the truck details, mark anything broken/repair, then confirm</div>
                  {destGroups.map(g => {
                    const isTransfer = g.type === "transfer";
                    const truck = manTruck[g.key] || {};
                    const hasTruck = !!(truck.vehicle || truck.driver || truck.phone);
                    const selRows = g.items.filter(({ it }) => !isTransfer || isSel(gKey(g.key, it)));
                    const canConfirm = selRows.length > 0 && (!isTransfer || hasTruck);
                    const open = !!manOpen[g.key];
                    return (
                    <div key={g.key} className="bg-white border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                        <button onClick={() => setManOpen(o => ({ ...o, [g.key]: !o[g.key] }))} className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 text-left">
                          <span className="text-gray-400">{open ? "▾" : "▸"}</span>{g.label} <span className="text-[10px] text-gray-400">· {g.items.reduce((s, x) => s + x.qty, 0)} pc · {g.items.length} item{g.items.length > 1 ? "s" : ""}</span>{isTransfer && hasTruck ? <span className="text-[10px] text-emerald-600">· 🚛 {truck.vehicle || truck.driver || "truck set"}</span> : null}
                        </button>
                        <button onClick={() => confirmGroup(g)} disabled={!canConfirm} className="text-[11px] font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded-lg whitespace-nowrap">{isTransfer ? `✓ Loaded on this truck${selRows.length < g.items.length ? ` (${selRows.length})` : ""}` : "✓ Confirm — back to production house"}</button>
                      </div>
                      {open && (<>
                      {/* Truck details — only for transfers to another site (production house needs none) */}
                      {isTransfer && (
                        <div className="px-3 py-2 bg-sky-50/60 space-y-1.5">
                          <div className="text-[10px] text-sky-700 font-semibold">🚛 Which truck is carrying this to {g.label.replace("↪️ ", "")}? — shown to the receiving site</div>
                          {eventTrucks.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {eventTrucks.map(f => { const on = truck.vehicle === f.vehicle && truck.driver === f.driver; return (
                                <button key={f.id} onClick={() => pickTruckFleet(g.key, f)} className={"text-[11px] px-2 py-1 rounded-lg border " + (on ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-blue-50")}>🚛 {f.vehicle || f.driver}{f.vehicle && f.driver ? ` · ${f.driver}` : ""}</button>
                              ); })}
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            <input value={truck.vehicle || ""} onChange={e => setTruckField(g.key, "vehicle", e.target.value)} placeholder="Vehicle no." className="border rounded px-2 py-1 text-xs" />
                            <input value={truck.driver || ""} onChange={e => setTruckField(g.key, "driver", e.target.value)} placeholder="Driver" className="border rounded px-2 py-1 text-xs" />
                            <input value={truck.phone || ""} onChange={e => setTruckField(g.key, "phone", e.target.value)} placeholder="Phone" className="border rounded px-2 py-1 text-xs" />
                          </div>
                          {g.items.length > 1 && <div className="text-[10px] text-gray-400">Tick only what fits on this truck — untick the rest and confirm them on a second truck.</div>}
                        </div>
                      )}
                      <div className="">
                        {g.items.map(({ it, qty }, i) => {
                          const ck = gKey(g.key, it); const c = condOf(ck);
                          const rep = Number(c.repair) || 0, brk = Number(c.broken) || 0;
                          const dest = Math.max(0, qty - rep - brk);
                          const sel = isSel(ck);
                          return (
                          <div key={i} className={"flex items-center gap-2 px-3 py-1.5 flex-wrap " + (isTransfer && !sel ? "opacity-40" : "")}>
                            {isTransfer && <input type="checkbox" checked={sel} onChange={() => toggleManSel(ck)} className="w-4 h-4" title="load this item on this truck" />}
                            {it.photo ? <img src={it.photo} alt="" onClick={() => setZoomImg(it.photo)} className="w-7 h-7 rounded object-cover border cursor-zoom-in" onError={e => { e.target.style.display = "none"; }} /> : <div className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-[10px]">📦</div>}
                            <span className="flex-1 text-xs text-gray-700 min-w-[80px]">{it.name}</span>
                            <span className={"text-[11px] font-bold w-14 text-right " + (dest > 0 ? "text-gray-900" : "text-gray-300")} title="going to this destination">→ {dest}</span>
                            <label className="flex items-center gap-0.5 text-[10px] text-amber-700" title="needs repair (kept in stock)">🔧<input type="number" min="0" max={qty} value={c.repair ?? ""} onChange={e => setManCondVal(ck, "repair", e.target.value, qty)} placeholder="0" className="w-10 border border-amber-200 rounded px-1 py-0.5 text-center" /></label>
                            <label className="flex items-center gap-0.5 text-[10px] text-red-600" title="broken — written off, removed from stock">❌<input type="number" min="0" max={qty} value={c.broken ?? ""} onChange={e => setManCondVal(ck, "broken", e.target.value, qty)} placeholder="0" className="w-10 border border-red-200 rounded px-1 py-0.5 text-center" /></label>
                            <span className="text-[10px] text-gray-400 w-10 text-right">of {qty}</span>
                            <VoiceRecorder compact value={manNote[ck]} onSave={url => setManNote(m => ({ ...m, [ck]: url }))} label="note for site" />
                          </div>
                        ); })}
                      </div>
                      </>)}
                    </div>
                  ); })}
                </div>
              )}
              {movements.some(m => m.type === "repair") && (
                <div className="px-4 py-2 bg-amber-50 text-xs text-amber-800">
                  🔧 <b>Repairs needed</b> (kept in stock — fix before next use): {movements.filter(m => m.type === "repair").map((m, i) => <span key={m.id}>{i > 0 ? ", " : ""}{m.qty}× {m.name}</span>)}
                </div>
              )}
              {blockedItems.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-gray-400">No inventory to route for this department.</div>
              )}
              {blockedItems.length > 0 && destGroups.length === 0 && (
                <div className="px-4 py-4 text-center text-xs text-emerald-600 font-semibold">✓ Everything routed — see the movement log below.</div>
              )}
              {/* Movement log for this event */}
              {movements.length > 0 && (
                <div className="bg-gray-50/40">
                  <div className="px-4 py-1.5 text-[10px] uppercase text-gray-400 font-semibold">Movement log</div>
                  <div className="">
                    {movements.slice().reverse().map(m => (
                      <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-1.5 text-xs flex-wrap">
                        <span className={m.type === "damage" ? "text-red-600 font-semibold" : m.type === "repair" ? "text-amber-600 font-semibold" : m.type === "transfer" ? "text-sky-700" : "text-gray-600"}>
                          {m.type === "damage" ? "⚠️ Broken" : m.type === "repair" ? "🔧 Needs repair" : m.type === "transfer" ? `↪️ Reused → ${m.toEventName || "event"}` : "↩️ Returned"} · {m.qty}× {m.name}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-gray-400">{m.voiceNote && <audio src={m.voiceNote} controls className="h-6 max-w-[130px]" title="voice note" />}{m.by}{m.type === "damage" && m.invId ? " · stock −" + m.qty : m.type === "repair" ? " · kept in stock" : ""}<button onClick={() => delMovement(m.id)} className="text-red-300 hover:text-red-500 text-sm">×</button></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* On-site crew — actual held. Ops logs the real crew kept on site (count + shifts); this
                writes the same mpDay/mpWin/mpOverrides the plan uses, so it becomes the exact manpower
                cost in this event's P&L and reflects back to the salesperson in Studio. */}
            {mpRows.length > 0 && (
              <div className={"bg-white rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_1px_3px_rgba(16,24,40,0.05)] overflow-hidden" + modalCls("oscrew")}>
                <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800">👷 On-site crew — actual held <span className="text-xs font-normal text-gray-400">— log the crew you actually kept; sets the real manpower cost</span></span>
                  <span className="text-sm font-bold text-gray-900">{fmt(mpCost)}{mpEdited && <span className="ml-1 text-[10px] font-semibold text-amber-600">actual</span>}</span>
                </div>
                <div className="">
                  {mpRows.map((r, i) => {
                    if (r.type === "Supervisors") return null; // ops IS the supervisor — no separate line for him
                    const daywise = mpDayWise(r);
                    const sched = Array.isArray(r.schedule) ? r.schedule : [];
                    const winDefs = (dihari[r.type] && Array.isArray(dihari[r.type].windows)) ? dihari[r.type].windows : [];
                    const planCost = Number(r.sysCost) || 0;
                    const actCost = Number(lineCost(r));
                    const edited = actCost !== planCost;
                    const readOnly = r.shared && !daywise; // shared crew with no schedule = fixed split, can't tune
                    const expanded = !!osMp[i];
                    const rate = Number(r.rate) || 0;
                    // Show the SAME metric the dept head's Manpower plan shows: dihari for day-wise crew
                    // (auto = cost ÷ rate), plain qty for mapped crew — so by default both screens match.
                    const actDihari = rate > 0 ? Math.round(actCost / rate) : 0;
                    const planDihari = rate > 0 ? Math.round(planCost / rate) : 0;
                    const planPeak = Number(r.sysCount) || 0;
                    return (
                      <div key={i} className="px-4 py-2.5 hover:bg-gray-50/70 transition-colors">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="flex-1 text-sm font-medium text-gray-800 min-w-[90px]">{r.type}{r.shared && <span className="ml-2 text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-semibold">SHARED</span>}</span>
                          {readOnly ? <span className="text-[10px] text-gray-400">split allocation · {fmt(actCost)}</span> : daywise ? (<>
                            <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">dihari</span><span className={"w-14 rounded-lg px-2 py-1 text-sm text-center font-semibold " + (edited ? "bg-amber-50 text-amber-700 border border-amber-300" : "bg-gray-100 text-gray-700")} title="Total dihari held (crew × shifts across all days) — matches the plan until you edit below">{actDihari}</span></div>
                            {sched.length > 0 && <button onClick={() => setOsMp(o => ({ ...o, [i]: !o[i] }))} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-1.5 py-1" title="Adjust crew per day and per shift (e.g. drop the evening, or keep 1 in evening)">{expanded ? "▾ by day/shift" : "▸ by day/shift"}</button>}
                            <span className="text-sm font-semibold text-gray-700 w-24 text-right">{fmt(actCost)}</span>
                            {edited && <button onClick={() => resetMpLine(r)} className="text-[10px] text-blue-500 hover:underline whitespace-nowrap" title="revert to the dept head's planned crew">↺ plan</button>}
                          </>) : (<>
                            <div className="flex items-center gap-1"><span className="text-[10px] text-gray-400">people</span><input type="number" min="0" value={Number(r.count) || 0} onChange={e => setActualCrew(r, i, e.target.value)} className={"w-14 border rounded-lg px-2 py-1 text-sm text-center " + ((Number(r.count) || 0) !== planPeak ? "border-amber-400 bg-amber-50 font-bold" : "")} /></div>
                            <span className="text-sm font-semibold text-gray-700 w-24 text-right">{fmt(actCost)}</span>
                            {edited && <button onClick={() => resetMpLine(r)} className="text-[10px] text-blue-500 hover:underline whitespace-nowrap" title="revert to the dept head's planned crew">↺ plan</button>}
                          </>)}
                        </div>
                        {!readOnly && <div className="text-[10px] text-gray-400 mt-0.5 pl-0.5">{daywise
                          ? <>Planned {planDihari} dihari · {fmt(planCost)}{edited ? <span className="text-amber-600 font-semibold"> → actual {actDihari} dihari = {fmt(actCost)}</span> : ""}</>
                          : <>Planned {planPeak} × {fmt(planCost)}{edited ? <span className="text-amber-600 font-semibold"> → actual {Number(r.count) || 0} = {fmt(actCost)}</span> : ""}</>}</div>}
                        {r.type === "Labours" && anyLabours && (
                          <div className="mt-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5 flex items-center gap-2 flex-wrap text-[11px]">
                            <span className="font-semibold text-blue-700">👥 All-dept labour total</span>
                            <input type="number" min="0" value={eventLabourDihari} onChange={e => setEventLabourTotal(e.target.value)} className="w-16 border border-blue-300 rounded px-2 py-0.5 text-center font-semibold" />
                            <span className="text-blue-600">dihari — set the whole event's labour; auto-splits across every department by usage</span>
                          </div>
                        )}
                        {expanded && daywise && sched.length > 0 && (
                          <div className="mt-1.5 bg-gray-50 border rounded-lg p-2 space-y-1">
                            <div className="text-[10px] text-gray-400">Set the crew per day & per dihari (shift). Add a dihari to split a day — e.g. 2 in the day shift + 1 in the evening; each shift is billed. Set 0 or remove to drop one.</div>
                            {sched.map((d, di) => {
                              const ids = effWinIds(r, d) || [];
                              const dayCost = mpDayCost(r, d, mpDay, mpWin, mpWinCount, rate);
                              const hasSlots = winDefs.length > 0 || ids.length > 0;
                              return (
                                <div key={di} className="flex items-start gap-2 flex-wrap text-[11px] py-1.5">
                                  <span className="w-24 text-gray-600 font-medium pt-1">{phaseLbl(d)}</span>
                                  {hasSlots ? (
                                    <div className="flex items-center gap-1.5 flex-wrap flex-1">
                                      {ids.map((id, si) => { const wd = winDefs.find(w => w.id === id); const lbl = wd ? wd.label : `dihari ${si + 1}`; return (
                                        <span key={id} className="inline-flex items-center gap-1 border rounded-lg px-1.5 py-0.5 bg-white">
                                          <span className="text-gray-400">{lbl}</span>
                                          <input type="number" min="0" value={effShift(r, d, id)} onChange={e => setShiftCount(r.type, d.date, id, e.target.value, ids)} className="w-11 border rounded px-1 py-0.5 text-center" />
                                          {ids.length > 1 && <button onClick={() => removeDihari(r.type, d.date, id, ids)} className="text-red-300 hover:text-red-500" title="remove this dihari">×</button>}
                                        </span>
                                      ); })}
                                      <button onClick={() => addDihari(r, d.date, ids)} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full px-2 py-0.5" title="Add another dihari (shift) for this day">+ dihari</button>
                                    </div>
                                  ) : (
                                    <label className="flex items-center gap-1 flex-1"><span className="text-gray-400">crew</span><input type="number" min="0" value={Math.round(effDay(r, d))} onChange={e => setMpDay(r.type, d.date, e.target.value)} className="w-12 border rounded px-1 py-0.5 text-center" /></label>
                                  )}
                                  <span className="text-gray-400 pt-1">= {fmt(Math.round(dayCost))}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="px-4 py-2 bg-gray-50 flex items-center justify-between text-xs gap-2 flex-wrap">
                  <span className="text-gray-500">Planned manpower <b className="text-gray-700">{fmt(mpPlannedCost)}</b></span>
                  <span className="text-gray-800 font-semibold">Actual held {fmt(mpCost)} {mpCost !== mpPlannedCost && <span className={mpCost < mpPlannedCost ? "text-emerald-600" : "text-red-600"}>({mpCost < mpPlannedCost ? "▼ saved " : "▲ over "}{fmt(Math.abs(mpCost - mpPlannedCost))})</span>}</span>
                </div>
              </div>
            )}
                </div>
              </div>
            </div>
            </>)}

          </div>
        )}
      </div>
      {/* Click-to-enlarge lightbox — ops can view any item/kit photo big & clear */}
      {zoomImg && (
        <div onClick={() => setZoomImg(null)} className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out">
          <img src={zoomImg} alt="" className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

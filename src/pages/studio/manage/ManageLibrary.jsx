import { Fragment, useCallback, useMemo, useState, useRef, useEffect } from "react";
import LazyYT from "../../../components/studio/LazyYT";
import KitComponentsEditor from "../../../components/shared/KitComponentsEditor";
import { logVideoOpen, logPhotoOpen, logBulk } from "../../../lib/studio/userActions";
import ItemHoverThumb from "../../../components/shared/ItemHoverThumb";
import InventoryItemPickerModal from "../../../components/shared/InventoryItemPickerModal";
import { libPhotoIsTagged, carpetPricingFor, defaultCarpetMatId, CARPET_OFF, trussRateFor, maskingRateFor, maskingOptions, TRUSS_MATERIALS, venueTypeLabel } from "../../../lib/studio/taxonomy";
import { logFieldCorrections } from "../../../lib/studio/tagFeedback";
// The same filter kit Browse and Build use — collapsible sections with the bullet, the caps label, the
// count badge and the rotating chevron. Imported rather than rebuilt here for the reason the kit exists
// at all: three hand-rolled copies of one panel is how they drift apart.
import { makeFilterUI, useRailMaxHeight } from "../../../components/studio/filterUI.jsx";
import { IconCamera, IconPlay, IconClipboardCheck, IconPalette, IconSliders, IconChevron,
  IconCheck, IconFactory, IconCalendar, IconWall, IconCrown, IconSparkle, IconBulb, IconRepeat,
  IconFlower, IconBox, IconAlert, IconStar, IconNote } from "../../../components/icons.jsx";

// ══ THE PAGE'S GROUND ══
// The same artwork Deal Check uses, and the same glob-not-import reasoning as every other background
// in this app: if the file is not there the glob resolves to {}, ML_BG is null, and the plain page
// colour carries it. An import of a missing asset fails the whole build instead.
const ML_BG = Object.values(
  import.meta.glob("../../../assets/ambria-dealcheck-bg.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" })
)[0] || null;
import { applyAiTagResult } from "../../../lib/studio/tagging/applyResult.js";
import { fetchLibraryPage, fetchLibraryCounts, checkExistingLibraryUrls, fetchAllLibraryRowsMinimal, LIB_STATUS, TAG_SOURCE, LIBRARY_PAGE_SIZE } from "../../../lib/studio/libraryQueries";
import { isHiddenSubcat } from "../../../lib/rateCard";
import { supabase, subscribeTable } from "../../../lib/supabase";
import { deleteStorageObjects, listStorageTree } from "../../../lib/storage";
import { itemDimsText, priceForInvItem } from "../../../lib/ims/helpers";
import { addPaletteInline } from "../../../lib/studio/colours";
import PaletteQuickAdd from "../../../components/studio/PaletteQuickAdd.jsx";

// Server-side paginated + status-scoped browse grid. Resets to page 1 whenever the status chip,
// any sidebar filter, venue selection, or (debounced) search term changes.
// Chip counts are scoped to the same filters/search but NOT the status chip itself, per spec.
//
// ── PAGES, NOT AN ENDLESS SCROLL ──
// This used to append: a sentinel at the foot of the grid auto-loaded the next page whenever it came
// into view, so the DOM grew for as long as you kept scrolling — nearly 2000 tiles in one grid on
// "Needs review". Now exactly LIBRARY_PAGE_SIZE rows are mounted and you step between pages.
//
// The queries underneath are KEYSET paginated (a cursor of the last row's sort value + id), not
// OFFSET, so page N stays fast at any depth — but a cursor only points FORWARD. Going back therefore
// needs the cursor each page started from, which is what cursorsRef keeps: index i holds the cursor
// that opens page i, and page 0's is null. That makes Prev free (a cursor we already hold) and means
// no page can be jumped to before it has been walked past — which is why this is Prev/Next and not
// numbered pages, rather than numbered pages that quietly re-fetch everything before them.
function usePaginatedLibrary({ libStatus, filters, venueGroup, venueNames, inhouseVenueNames, search, mergeLibItems }) {
  const [items, setItems] = useState([]);
  const [pageIdx, setPageIdx] = useState(0);
  const cursorsRef = useRef([null]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({ verified: 0, review: 0, untagged: 0, manual: 0, build: 0 });
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  // A failed page/counts fetch used to be swallowed silently, leaving counts at their zero-
  // initialized state and the grid empty — indistinguishable from "the library is actually empty."
  // Track it explicitly so the UI can show "failed to load" instead of a misleading empty state.
  const [error, setError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const retry = useCallback(() => setRetryTick((t) => t + 1), []);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // `libStatus` is a UI-only selector that unions the two orthogonal dimensions (lifecycle +
  // tag source) into one chip row. Split it back into (status, tagSource) for the query — these are
  // NOT one enum (spec §9-D). See LIB_STATUS / TAG_SOURCE in libraryQueries.js.
  const isTagSourceChip = libStatus === TAG_SOURCE.MANUAL || libStatus === TAG_SOURCE.BUILD;
  const status = isTagSourceChip ? undefined : libStatus;
  const tagSource = isTagSourceChip ? libStatus : undefined;
  const filterKey = JSON.stringify(filters);
  const venueKey = `${venueGroup}|${venueNames.join(",")}`;
  // Everything that defines WHICH rows this grid is showing. When it changes, the cursors collected
  // for the old query are meaningless and page 0 is the only page we can open.
  const queryKey = `${status}|${tagSource}|${filterKey}|${venueKey}|${debouncedSearch}`;
  const lastQueryKeyRef = useRef(queryKey);

  useEffect(() => {
    // A new query resets the walk. Returning early when we were not already on page 0 lets the
    // setPageIdx re-run do the fetch, so the change costs one request rather than two — the stale
    // one would only have been thrown away by the reqId guard anyway.
    if (lastQueryKeyRef.current !== queryKey) {
      lastQueryKeyRef.current = queryKey;
      cursorsRef.current = [null];
      if (pageIdx !== 0) { setPageIdx(0); return; }
    }
    const id = ++reqIdRef.current;
    setLoading(true); setItems([]); setHasMore(true); setError(null);
    fetchLibraryPage({ status, tagSource, filters, venueGroup, venueNames, inhouseVenueNames, search: debouncedSearch, cursor: cursorsRef.current[pageIdx] || null })
      .then(({ items: page, nextCursor, hasMore: more }) => {
        if (id !== reqIdRef.current) return;
        // Remember where the NEXT page starts. This is the only place cursors are recorded, so a page
        // can never be opened without having been reached.
        cursorsRef.current[pageIdx + 1] = nextCursor;
        setItems(page); mergeLibItems(page); setHasMore(more);
      })
      .catch((e) => { if (id === reqIdRef.current) { setHasMore(false); setError(e?.message || "Failed to load images"); } })
      .finally(() => { if (id === reqIdRef.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, pageIdx, retryTick]);

  const refreshCounts = useCallback(() => {
    fetchLibraryCounts({ filters, venueGroup, venueNames, inhouseVenueNames, search: debouncedSearch })
      .then(setCounts)
      .catch((e) => setError((prev) => prev || e?.message || "Failed to load counts"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, venueGroup, venueKey, debouncedSearch]);
  useEffect(() => { refreshCounts(); }, [refreshCounts, retryTick]);

  // Keep the chips honest. They used to refresh only on mount, on a filter change, or while a bulk
  // tag ran — so verifying one photo left its old bucket's number stale until you reloaded, and the
  // chip could disagree with the grid it opens ("Showing 0 of 1"). Any write to `library`, by anyone,
  // now re-counts.
  //
  // Debounced because a bulk tag or a folder import fires hundreds of row events: without it each one
  // would trigger five COUNT queries. 1.5s is long enough to collapse a burst and short enough that a
  // single verify feels immediate.
  useEffect(() => {
    let timer = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; refreshCounts(); }, 1500); };
    const ch = subscribeTable("library", bump);
    return () => { if (timer) clearTimeout(timer); try { supabase.removeChannel(ch); } catch { /* ignore */ } };
  }, [refreshCounts]);

  // Page moves just set the index — the effect above owns every fetch, so there is one code path
  // that loads a page and one place cursors are written.
  const nextPage = useCallback(() => {
    if (loading || !hasMore) return;
    setPageIdx((i) => i + 1);
  }, [loading, hasMore]);
  const prevPage = useCallback(() => {
    if (loading) return;
    setPageIdx((i) => (i > 0 ? i - 1 : 0));
  }, [loading]);

  // Live "new tags stream in" during batch tagging: refetch page 1 (which is ordered most-recently-
  // tagged first) and PREPEND any rows not already shown — so freshly-tagged photos appear at the top
  // of Needs review as the batch runs, without resetting scroll or the page cursors. Guarded by the
  // request id so it no-ops if a full reload (status/filter change) happened meanwhile.
  const refreshNew = useCallback(() => {
    // Page 0 only. This prepends newly-tagged rows, and page 1 is the newest-first page they belong
    // to — doing it while the user is on page 4 would splice unrelated rows into the middle of the
    // run and push that page's last rows off the end.
    if (pageIdx !== 0) return;
    const id = reqIdRef.current;
    fetchLibraryPage({ status, tagSource, filters, venueGroup, venueNames, inhouseVenueNames, search: debouncedSearch })
      .then(({ items: page }) => {
        if (id !== reqIdRef.current) return;
        mergeLibItems(page);
        setItems((prev) => {
          // Update rows already shown (so a re-tagged photo's confidence/tags refresh in place) AND
          // prepend any genuinely new ones. Page 1 is newest-tagged first, so re-tags land here.
          const byId = new Map(page.map((p) => [p.id, p]));
          const merged = prev.map((it) => (byId.has(it.id) ? { ...it, ...byId.get(it.id) } : it));
          const have = new Set(prev.map((i) => i.id));
          const fresh = page.filter((p) => !have.has(p.id));
          return fresh.length ? [...fresh, ...merged] : merged;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tagSource, filterKey, venueGroup, venueKey, debouncedSearch, pageIdx]);

  const updateItem = useCallback((id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it))), []);
  const removeItem = useCallback((id) => setItems((prev) => prev.filter((it) => it.id !== id)), []);
  const prependItems = useCallback((newItems) => setItems((prev) => [...newItems, ...prev]), []);

  return { items, counts, loading, hasMore, nextPage, prevPage, pageIdx, pageSize: LIBRARY_PAGE_SIZE, updateItem, removeItem, prependItems, error, retry, refreshCounts, refreshNew };
}

// ═══ MANAGE: LIBRARY & CONTENT ═══
// Faithful rebuild of the reference AmbriStudioInner library view.
// Reference: App_latest.jsx — ManageLibrary() render block (~11684), LibraryBrowse()
// (~11042), plus the inline helpers
// toggleLibFilter/toggleLibVenueName/clearLibFilters (~10964–10995) — filtering/status/search/sort
// itself is now server-side (usePaginatedLibrary), not the client-side libFiltered memo this once was.
//
// Cloudinary photo browser (cld* block, reference ~11706–11817) and the Videos
// subsystem (libView==="videos" + zone-picker modal, reference ~11846–12319) are
// transcribed VERBATIM below, rewired to the ctx data layer:
//   • /api/cloudinary fetches → ctx.cldAdmin(action, params)  (via cld* handlers on ctx)
//   • /api/youtube loaders     → ctx.loadAllYT / ctx.searchYT
//   • /api/anthropic video tag → ctx.aiTagVideo (callClaudeStreaming inside StudioApp)
//   • image upload             → unsigned client upload (handled inside StudioApp.handleCldUpload)
//
// AI image tagging routes through ctx.aiTagImage (already ported into StudioApp).
export default function ManageLibrary({ ctx }) {
  const {
    // theme / chrome
    S, isDark, accent, border, textS, fmt,
    accentBg, accentText, textP, cardBg,
    // taxonomy
    taxonomy, setTaxonomy, saveTax, TAX_LABELS, imsPaletteCatalogue, setImsPaletteCatalogue, imsColourCatalogue, setImsColourCatalogue, savePaletteData, paletteCatalogueLoaded,
    taxOr, FUNCTIONS, CATEGORIES,
    // derived venue memos
    allInhouseVenues, allOutdoorDB, customOutdoor, inhouseParentNames, allInhouseVenueOrParentNames, subVenuesOfParent, leafInhouseVenues,
    // permissions
    studioLibraryAllowed,
    // library state + persistence
    libItems, saveLib, mergeLibItems, libView, setLibView,
    libSearch, setLibSearch, libFilters, setLibFilters,
    libVenueGroup, setLibVenueGroup, libVenueNames, setLibVenueNames,
    libEditImg, setLibEditImg, libElSearch, setLibElSearch,
    libAiLoading, setLibAiLoading,
    // photo tag venue picker
    tagVenueGroup, setTagVenueGroup, tagOutsideSub, setTagOutsideSub,
    setPreviewImg,
    // rate card (element breakdown) — kept for legacy/AI-tagged elements without invId
    rcItems, rcCats, rcIsSMB, isSubTagHidden, rcSubcatFactors, rcFactorByKey, rcFloralModeByKey, floralRatio,
    // IMS inventory (element breakdown "+Add element" now sources from here, not the Rate Card)
    imsInventory, getElPriceFromInventory,
    // Print material rates (IMS Admin → Settings → 🖨️ Print Materials) — per-element Print section
    imsPrintMaterials,
    // Carpet material rates (IMS Admin → Settings → 🟫 Carpet Materials) — own master list
    imsCarpetMaterials,
    // Truss & masking rates (IMS Admin → Settings → 🏗️ Truss & Masking Rates)
    imsTrussRates, imsMaskingRates,
    // Pure flower-recipe elements with no inventory backing (e.g. "Flower Garden") — addable
    // alongside inventory items, priced straight from the recipe
    recipeOnlyPatterns, getElPriceFromPattern, studioFloralData, dealCheckData,
    // misc
    showMsg, askConfirm, askConfirmAsync, aiTagImage, authUser, corrLog, logVerificationEvent, refreshCorrLog, tagKB, rebuildTagKB, tagCorrections, refreshTagCorrections, bulkTag, runBulkTag, stopBulkTag, runTagSelected, bulkVid, runBulkTagVideos, bulkVidVenue, runBulkTagVideoVenues, importCloudinaryFolder,
    // events + persistence (video → event linking)
    events, save,
    // ═══ CLOUDINARY PHOTO BROWSER ═══
    cldOpen, setCldOpen, cldFolders, setCldFolders, cldPath, setCldPath, cldImages, setCldImages, cldLoading,
    cldUploading, cldUploadProgress, setCldUploadProgress, cldUploadRef, cldFolderUploadRef,
    cldSelectMode, setCldSelectMode, cldSelected, setCldSelected, cldDeleting,
    fetchCldFolders, cldNavigate, cldGoBack, handleCldUpload, handleCldBulkDelete, handleCldDeleteFolder,
    // ═══ VIDEOS SUBSYSTEM ═══
    allVideos, ytVideos, loadAllYT, ytLoading, ytSearch, setYtSearch, ytFilterPL,
    ytVideoTags, saveYtTags, ytTagEdit, setYtTagEdit, aiTaggingVideo, aiTagVideo, aiTagVideoSave,
    aiVideoDraft, setAiVideoDraft, untaggedVideoCount, hiddenVideos, saveHiddenVideos,
    manualVideos, saveManualVideos, showHidden, setShowHidden, lastVisitTs,
    ytPicker, setYtPicker, getPhotos, ZONE_ICONS,
    ytFilterVenue, setYtFilterVenue, ytFilterFn, setYtFilterFn, ytFilterTier, setYtFilterTier,
    ytFilterIO, setYtFilterIO, ytFilterStyle, setYtFilterStyle, ytFilterColor, setYtFilterColor,
    ytFilterLinked, setYtFilterLinked,
    // cloudinary video browser
    addVideoOpen, setAddVideoOpen, cldVideoFolders, cldVideoPath, cldVideoList, cldVideoLoading,
    openCldVideoBrowser, cldVideoNavigate, cldVideoGoBack, addCldVideo,
  } = ctx;

  // Element Breakdown hover previews: enlarged thumbnail on hover, and — for a kit — its component
  // list on hovering the name. position:fixed (computed from the trigger's own
  // getBoundingClientRect on mouse-enter) rather than position:absolute — the whole photo-edit
  // panel scrolls via overflowY:auto, which clips any absolutely-positioned popover that extends
  // past its bounds; fixed positioning escapes that clipping since it's relative to the viewport.
  const [elHoverImg, setElHoverImg] = useState(null); // { idx, top, left }
  // Row-hover highlight for the Element Breakdown grid — ops kept misclicking the × on the row
  // above/below the one they meant, since with no wrapping row element a plain CSS :hover can't
  // paint the whole row; track the hovered index in JS and tint every cell of that row instead.
  const [hoveredElIdx, setHoveredElIdx] = useState(null);
  // "+ Add Print" search text for the Print section's element picker.
  // Per-row "link to an inventory item" search text, keyed by print row id — linking is optional,
  // so each print row manages its own tiny search independently of any other row's.
  const [printLinkSearch, setPrintLinkSearch] = useState({});
  // Custom Ceiling / Custom Masking picker — { kind: "ceiling"|"masking", ri: null (row 0) | index into dims.trussRows }
  const [libCustomPicker, setLibCustomPicker] = useState(null);

  // `tagVenueGroup` defaults to "inhouse" (StudioApp.jsx) and is shared/sticky across whichever
  // photo is open, so without this it wins over the derived inhouse/outside group every time a
  // photo is (re)opened — e.g. opening a photo tagged with an Outside venue like "Canvas" would
  // show the "Inhouse" pill highlighted even though Canvas is correctly selected below it. Reset
  // it to "" whenever a different photo opens so the group re-derives from that photo's own venue.
  useEffect(() => { setTagVenueGroup(""); setTagOutsideSub("all"); }, [libEditImg?.id, setTagVenueGroup, setTagOutsideSub]);

  // reference module-scope theme bg (~7081)
  const bg = isDark ? "#0F0F1A" : "#FAF9F6";

  // ── inline helper: taxonomy label (reference module-scope getTaxLabel ~line 1267) ──
  const getTaxLabel = (k) => TAX_LABELS[k] || k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\s+/g, " ").replace(/^./, s => s.toUpperCase()).trim();

  // ── inline helpers (reference ~10964–10995) ──
  // Filtering/status/search/sort now happen server-side (see usePaginatedLibrary below) —
  // libFilters/libVenueGroup/libVenueNames/libSearch are just the query params.
  const toggleLibFilter = (cat, val) => {
    setLibFilters(prev => {
      const cur = prev[cat] || [];
      const has = cur.includes(val);
      const next = has ? cur.filter(v => v !== val) : [...cur, val];
      return { ...prev, [cat]: next };
    });
  };
  const toggleLibVenueName = (name) => setLibVenueNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  const clearLibFilters = () => { setLibFilters({}); setLibSearch(""); setLibVenueGroup("all"); setLibVenueNames([]); };

  // ── Tagging status (Phase 1a) ──────────────────────────────────────────────
  // A photo is "Verified" once a human saves/corrects it; "AI-tagged" (needs review) once an
  // AI pass has filled it but no human has confirmed; otherwise "Untagged". This lets the team
  // use AI tags immediately while a person — or salespeople on the build screen — cleans them up.
  // Folder-imported photos carry only a seeded zone tag (areasElements) until the AI runs — that
  // alone must NOT read as "tagged", or they hide in Needs-review and bulk skips them. libPhotoIsTagged
  // discounts the seeded zone and keys off the _aiTagged stamp / real tags.
  // Lifecycle only (LIB_STATUS) — the client-side twin of libraryQueries.computeLibStatus; reads
  // NONE of tag_source, which is a separate/orthogonal attribution dimension (spec §9-D).
  const photoStatus = (img) => img?._verified ? LIB_STATUS.VERIFIED
    : libPhotoIsTagged(img) ? LIB_STATUS.REVIEW
    : LIB_STATUS.UNTAGGED;
  // Same 3-state model for videos: verified (a person confirmed), review (AI/has tags, unconfirmed),
  // or untagged (no tag entry yet). Drives the Videos status folders + bulk video tagging.
  const videoStatus = (v) => {
    const t = ytVideoTags[v.id];
    if (!t) return "untagged";
    if (t._verified) return "verified";
    const hasTag = t._aiTagged || t.venue || t.fn || t.tier || t.io || (t.styles || []).length || (t.colors || []).length || Object.keys(t.zonePhotos || {}).length;
    return hasTag ? "review" : "untagged";
  };
  const [libStatus, setLibStatus] = useState(LIB_STATUS.REVIEW); // LIB_STATUS.* | TAG_SOURCE.* (a UI-only union of the two dims) — defaults to review so users don't land on Verified images and accidentally retag them

  const libPage = usePaginatedLibrary({
    libStatus, filters: libFilters, venueGroup: libVenueGroup, venueNames: libVenueNames,
    inhouseVenueNames: allInhouseVenues, search: libSearch, mergeLibItems,
  });
  // Keep the folder counts (esp. "Needs review") live during and after batch tagging. The count query
  // is otherwise static after load, so untagged→review moves during a batch wouldn't show until you
  // switch folders. Refresh on each running/finished transition, and poll every 4s while a batch runs.
  useEffect(() => { libPage.refreshCounts(); libPage.refreshNew(); }, [bulkTag?.running, bulkTag?.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bulkTag?.running) return;
    const id = setInterval(() => { libPage.refreshCounts(); libPage.refreshNew(); }, 4000);
    return () => clearInterval(id);
  }, [bulkTag?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const [libSelected, setLibSelected] = useState(new Set()); // IDs selected for manual AI tagging
  useEffect(() => { setLibSelected(new Set()); }, [libStatus]); // clear selection when switching tabs
  const [bigTagVid, setBigTagVid] = useState(null); // video id open in the full-screen tag editor
  // Videos you open in a tag editor collect at the top of the grid, newest first: the one you just
  // tagged sits at #1, the one before it at #2, and so on — otherwise each is lost in a 300-card grid.
  const editingVid = bigTagVid || ytTagEdit || null;
  const [recentVids, setRecentVids] = useState([]); // video ids, most recently tagged first
  useEffect(() => {
    if (editingVid) setRecentVids(p => p[0] === editingVid ? p : [editingVid, ...p.filter(id => id !== editingVid)]);
  }, [editingVid]);
  const vidRank = (id) => { const i = recentVids.indexOf(id); return i < 0 ? 1e9 : i; };
  // Permission gate for the Images / Videos / Contributions sub-views. If the current view isn't
  // allowed for this role, fall back to the first one that is.
  const libAllowed = (v) => v === "palettes" ? true : (studioLibraryAllowed ? studioLibraryAllowed(v) : true);
  useEffect(() => {
    if (!libAllowed(libView)) {
      const first = ["images", "videos", "corrections"].find(libAllowed);
      if (first && first !== libView) setLibView(first);
    }
  }, [studioLibraryAllowed, libView]);
  const [tagRules, setTagRules] = useState(null); // editable house tagging-rules draft (null = modal closed)
  const [corrRange, setCorrRange] = useState("today"); // contributions panel date range
  const [corrUser, setCorrUser] = useState("");          // contributions panel user filter
  const [corrKind, setCorrKind] = useState("all");       // all | photo | video
  const [corrSearch, setCorrSearch] = useState("");      // search by person or photo/video name
  const [importingFolder, setImportingFolder] = useState(false); // recursive folder import in progress
  const [rebuildRunning, setRebuildRunning] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState("");
  const [orphanScan, setOrphanScan] = useState({ running: false, msg: "", result: null }); // { orphaned:[{id,name,url}], totalLibrary, totalStorage }
  const [orphanDeleting, setOrphanDeleting] = useState(false);
  const untaggedCount = libPage.counts.untagged; // server count (migration 008 `status` column) — not a full-array scan

  // Bulk "Tag all untagged" now runs APP-WIDE (in StudioApp) so it keeps going while you move
  // between Studio screens, with a global progress pill + completion toast. This just confirms
  // and kicks it off. `bulkTag` (progress) / `stopBulkTag` come from ctx.
  const startTagAll = async () => {
    if (untaggedCount === 0) { showMsg("Nothing to tag — every photo is already AI-tagged or verified.", "green"); return; }
    if (!(await askConfirmAsync(`AI-tag ${untaggedCount} untagged photo${untaggedCount === 1 ? "" : "s"}?`, {
      note: "Runs in the background — keep working, progress shows in the corner. Stop any time; it resumes where it left off. A person still reviews and verifies afterwards.",
      yesLabel: "Start tagging",
    }))) return;
    runBulkTag?.();
  };

  // Rebuild Library — walks every top-level Storage folder and inserts missing images.
  // Existing images (and their tags) are always preserved.
  const handleRebuildLibrary = async () => {
    if (!(await askConfirmAsync("Rebuild the Library from Storage?", {
      note: "Walks the whole media bucket (~5,400 images) and adds anything missing as Untagged. Existing tags are preserved — nothing is overwritten. Takes about a minute; run “Tag all untagged” afterwards.",
      yesLabel: "Rebuild",
    }))) return;

    setRebuildRunning(true);
    setRebuildMsg("Starting…");

    const seen = new Set(); // keys collected THIS scan (dedupe within this run)
    const fresh = [];
    let totalScanned = 0;

    try {
      // From the root, so loose files outside the known top-level folders are picked up too.
      const files = await listStorageTree("", ({ folder, files: n, visited }) =>
        setRebuildMsg(`Scanning "${folder || "/"}" — ${visited} folder(s), ${n} images…`));
      for (const r of files) {
        totalScanned++;
        if (seen.has(r.path)) continue;
        seen.add(r.path);
        fresh.push({
          id: r.path,
          name: r.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
          url: r.url,
          folder: r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "",
          tags: {},
          elements: [],
          addedAt: r.updatedAt ? new Date(r.updatedAt).getTime() : Date.now(),
          width: null,
          height: null,
          source: "storage-rebuild",
        });
      }

      // Batched server existence check (not a full-table scan) drops anything already in the Library.
      setRebuildMsg(`Checking ${fresh.length} candidates against the Library…`);
      const existing = await checkExistingLibraryUrls(fresh.map(r => r.url));
      const newImgs = fresh.filter(r => !existing.has(r.url));
      const skipped = totalScanned - newImgs.length;
      if (newImgs.length === 0) {
        showMsg(`Library up to date — all ${totalScanned} Storage images already in Library.`, "green");
        return;
      }

      setRebuildMsg(`Saving ${newImgs.length} new images…`);
      await saveLib(newImgs);
      libPage.prependItems(newImgs.filter(i => libStatus === LIB_STATUS.UNTAGGED));
      showMsg(
        `✅ Library rebuilt: ${newImgs.length} added (${skipped} already existed). ` +
        `Run "🤖 Tag all untagged" next.`,
        "green"
      );
      setRebuildMsg("");
    } catch (e) {
      showMsg("Rebuild failed: " + (e.message || "Unknown error"), "red");
      setRebuildMsg("");
    } finally {
      setRebuildRunning(false);
    }
  };

  // A public Storage URL → its object key. Lets the orphan check match a Library row whose stored
  // URL differs cosmetically from the one we'd build today — a /render/image/ transform URL, a
  // query string, or different percent-encoding of the same path.
  const storageKeyFromUrl = (url) => {
    if (!url) return null;
    const m = String(url).split("?")[0].match(/\/(?:object|render\/image)\/public\/[^/]+\/(.+)$/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  };

  // Find Orphaned Images — the reverse of Rebuild Library. Walks the same Storage folders to build
  // the set of objects that ACTUALLY still exist, then flags any Library row whose image isn't in
  // that set (e.g. the team deleted it straight from the bucket, bypassing the app).
  // Read-only: only reports the list — deleting is a separate explicit action below.
  const handleFindOrphaned = async () => {
    if (!(await askConfirmAsync("Scan for orphaned Library images?", {
      note: "Walks the whole media bucket (~5,400 images) and cross-checks every Library row. Read-only — nothing is deleted, you get a list to review first. Takes about a minute.",
      yesLabel: "Scan",
    }))) return;

    setOrphanScan({ running: true, msg: "Starting…", result: null });
    const existingUrls = new Set();
    const existingIds = new Set();
    try {
      // From the root — a folder missed here becomes a Library row wrongly offered for deletion.
      const files = await listStorageTree("", ({ folder, files: n, visited }) =>
        setOrphanScan((s) => ({ ...s, msg: `Scanning "${folder || "/"}" — ${visited} folder(s), ${n} images…` })));
      for (const r of files) { existingUrls.add(r.url); existingIds.add(r.path); }
      // A scan that found nothing means the listing failed or the bucket moved — not that every
      // Library row is orphaned. Bailing out here stops the UI offering to delete all of them.
      if (existingIds.size === 0) {
        setOrphanScan({ running: false, msg: "", result: null });
        showMsg("Orphan scan aborted — Storage returned no files at all. Check the upload Edge Function is deployed.", "red");
        return;
      }
      setOrphanScan((s) => ({ ...s, msg: `Fetching Library rows…` }));
      const rows = await fetchAllLibraryRowsMinimal((n) => setOrphanScan((s) => ({ ...s, msg: `Fetching Library rows… ${n}` })));
      const orphaned = rows.filter((r) => r.url && !existingUrls.has(r.url) && !existingIds.has(storageKeyFromUrl(r.url)));
      setOrphanScan({ running: false, msg: "", result: { orphaned, totalLibrary: rows.length, totalStorage: existingUrls.size } });
      showMsg(orphaned.length ? `Found ${orphaned.length} orphaned row(s) out of ${rows.length} Library images.` : "No orphaned rows found — Library matches Storage.", orphaned.length ? "orange" : "green");
    } catch (e) {
      setOrphanScan({ running: false, msg: "", result: null });
      showMsg("Orphan scan failed: " + (e.message || "Unknown error"), "red");
    }
  };

  const handleDeleteOrphaned = async () => {
    const ids = (orphanScan.result?.orphaned || []).map((r) => r.id);
    if (!ids.length) return;
    if (!(await askConfirmAsync(`Delete ${ids.length} orphaned Library row${ids.length === 1 ? "" : "s"}?`, {
      note: "Removes the Library entry only — there's no Storage file left to delete. This can't be undone.",
      yesLabel: "Delete rows",
    }))) return;
    setOrphanDeleting(true);
    try {
      await saveLib([], ids);
      ids.forEach((id) => libPage.removeItem(id));
      logBulk(authUser, "photo.delete-orphans", ids.length, { ok: true }, { ids: ids.slice(0, 50) });
      showMsg(`✓ Deleted ${ids.length} orphaned row(s).`, "green");
      setOrphanScan({ running: false, msg: "", result: null });
    } catch (e) {
      logBulk(authUser, "photo.delete-orphans", ids.length, { ok: false, error: e.message });
      showMsg("Delete failed: " + (e.message || "Unknown error"), "red");
    }
    setOrphanDeleting(false);
  };

  // Status filter, search, sidebar filters, and sort (most-recently-tagged first for
  // review/manual) all happen server-side now — see usePaginatedLibrary above.
  // Some rows point at a Cloudinary asset that no longer resolves (e.g. a failed/partial import) —
  // rather than the <img> silently going blank and leaving a name-only card, drop the whole card
  // once its image 404s. brokenImgIds is session-local (not persisted) and reset per page load.
  // ── THE SHARED FILTER KIT ──
  // Same call Browse and Build make, so this rail is the same object they have rather than a lookalike.
  // makeFilterUI caches per (isDark, accent, textP), so calling it on every render is one map lookup.
  const { Section: FSection, Pill: FPill, css: filterCSS } = makeFilterUI({ isDark, accent, textP, S });
  // Which sections are expanded. All closed to start: the rail carries eight groups and open-by-default
  // was the reason it scrolled for a screen and a half — the point of an accordion is that the list of
  // GROUPS is the thing you scan first.
  const [libSecOpen, setLibSecOpen] = useState({});
  // Rail shown or folded, same as Build's leftRailOpen. It lives up here with libSecOpen and NOT
  // inside LibraryBrowse, because that is re-created on every render of this component — state
  // declared in there would be a fresh hook each time.
  const [libRailOpen, setLibRailOpen] = useState(true);
  // Which side of the Videos venue filter is showing its names. UI only — the filter itself is still
  // the single ytFilterVenue string, exactly as the dropdown left it. This is the same shape the
  // Images rail uses (libVenueGroup) so the two panels behave identically.
  const [vidVenueGroup, setVidVenueGroup] = useState("all");
  // Videos paginate client-side, unlike Images. The whole list is already in memory (YouTube +
  // manual, loaded in one go) and filtered with a plain predicate, so there is no cursor to keep —
  // the page is a slice. Same 80 as the Images grid so the two views feel like one page.
  const [vidPage, setVidPage] = useState(0);
  // Recent contributions, paged. 30 a page rather than the 80 the media grids use: these are text
  // rows being read, not thumbnails being scanned, and the whole point of paging them is that you
  // stop scrolling a 997-row list.
  // Declared here, not inside CorrectionsPanel — that is called conditionally
  // (libView === "corrections"), so a hook in there would change the hook order on every tab switch.
  const CORR_PAGE_SIZE = 30;
  const [corrPage, setCorrPage] = useState(0);
  // Back to page 1 whenever the set changes — including corrUser, so clicking a person in the list
  // beside it drops you at the top of THEIR work rather than on page 12 of it.
  useEffect(() => { setCorrPage(0); }, [corrRange, corrKind, corrSearch, corrUser]);
  // Back to page 1 whenever the set being paged through changes. Without this, narrowing a filter
  // while on page 5 leaves you on a page that no longer exists — the render clamps it, but the state
  // would stay stale and Prev would then walk back from the wrong place.
  useEffect(() => { setVidPage(0); }, [ytSearch, ytFilterVenue, ytFilterFn, ytFilterTier, ytFilterLinked, ytFilterStyle, ytFilterColor, ytFilterIO, showHidden]);
  // The rail sticks below the header instead of scrolling away with the grid — with 1966 photos the
  // grid is thousands of pixels tall, and the filters were only reachable by scrolling all the way
  // back up. 70 is the sticky offset Build already uses for its own rails, so the two pages clear the
  // header the same way. The MAX HEIGHT is measured, not guessed: useRailMaxHeight (the same kit hook
  // Browse and Build use) reads the rail's real distance from the top of the viewport on scroll and
  // resize, so it fills the space that's actually there and scrolls internally past that.
  // Declared here, not inside LibraryBrowse — that is called conditionally (libView === "images"),
  // and a hook behind a condition changes the hook order when the tab changes.
  // The pager sits under the grid, so a page change leaves you parked at the BOTTOM of a page whose
  // content starts 80 tiles above — you'd land looking at the end of what you just asked to see.
  // Scrolls the whole window rather than an inner container because the grid has no scrollport of
  // its own; the page is what scrolls. `smooth` so it reads as a move, not a jump cut.
  // ── SHARED TAG-EDITOR FURNITURE ──
  // One definition used by BOTH full-screen editors — the video one (bigTagVid) and the photo one
  // (libEditImg). They were separate before and the photo editor had drifted to 9px chips and bare
  // labels while the video editor had cards; two editors doing the same job should not look like two
  // different products, and the only way to keep that true is for there to be one implementation.
  const mlTagChip = (label, on, onClick) => <span key={label} onClick={onClick} style={{ padding: "6px 12px", borderRadius: 9, fontSize: 11.5, cursor: "pointer", fontWeight: on ? 700 : 500, background: on ? accent : (isDark ? "rgba(255,255,255,0.04)" : "#fff"), color: on ? "#fff" : textS, border: `1px solid ${on ? accent : border}`, transition: "background .13s ease, border-color .13s ease", whiteSpace: "nowrap" }}>{label}</span>;
  const mlTagRow = { display: "flex", flexWrap: "wrap", gap: 6 };
  // n is the number in the heading; extra is an optional right-aligned slot (a count, say).
  const mlTagCard = (n, icon, title, body, extra) => (
    <div key={title} style={{ breakInside: "avoid", background: isDark ? "rgba(255,255,255,0.03)" : "#fff", border: `1px solid ${border}`, borderRadius: 14, padding: "14px 16px 16px", marginBottom: 14, boxShadow: isDark ? "none" : "0 1px 2px rgba(26,26,46,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ display: "inline-flex", color: accent }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: textP }}>{n}. {title}</span>
        {extra}
      </div>
      {body}
    </div>
  );
  // Which icon a taxonomy group gets. Falls back to the palette glyph for a category added later —
  // a missing icon should be a generic one, not a crash or a hole in the row.
  const ML_TAX_ICON = { tier: <IconCrown size={14} />, eventType: <IconCalendar size={14} />, venueType: <IconWall size={14} />, designStyle: <IconSparkle size={14} />, timeSetting: <IconBulb size={14} />, categoryTier: <IconCrown size={14} />, colorPalette: <IconFlower size={14} />, areasElements: <IconBox size={14} /> };

  // ── THE VIEW TABS ──
  // These were S.btn(active), whose active state is the gold gradient (accent #C9A96E). Gold is the
  // NAVBAR's accent — it reads on that dark navy bar — but on this light page it was the loudest
  // thing on the screen.
  // The fill is the app's dark navy: linear-gradient(135deg,#1a1a2e,#2d1b69), the exact pair Summary
  // uses for .total-hero and .grand and Build reuses — so "selected" here is the same dark navy
  // blue as the anchor surfaces on those pages, rather than a third colour invented for this row.
  // Written as one helper rather than four copies of a spread so the four tabs cannot drift apart.
  const libTab = (active) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 15px", borderRadius: 10, fontSize: 11.5, fontWeight: active ? 700 : 600,
    cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${active ? "transparent" : border}`,
    background: active ? "linear-gradient(135deg,#1a1a2e,#2d1b69)" : (isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)"),
    color: active ? "#fff" : textS,
    // Only the selected tab is lifted. Shadowing all four would make the row read as four cards
    // rather than one control with one choice made.
    boxShadow: active ? "0 2px 6px rgba(26,26,46,0.30)" : "none",
    transition: "background .15s ease, color .15s ease",
  });
  const libScrollTop = useCallback(() => {
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
  }, []);
  const LIB_RAIL_TOP = 70;
  const libRailRef = useRef(null);
  const libRailMaxH = useRailMaxHeight(libRailRef, LIB_RAIL_TOP);
  const [brokenImgIds, setBrokenImgIds] = useState(() => new Set());
  const markImgBroken = useCallback((id) => setBrokenImgIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  const libVisible = libPage.items.filter((img) => !brokenImgIds.has(img.id));

  // ═══ VIDEOS: THE FILTER RAIL ═══
  // Same shape as the Images rail below — .ml-glass .ml-rail, the shared FSection/FPill kit, sticky
  // under the header — so the two views read as one page with one filter surface, not two designs.
  //
  // What did NOT change is the semantics. Each of these was a <select>: ONE value, "all" for no
  // choice. They stay that way — a pill sets its section's value and clicking the chosen pill again
  // returns it to "all". They are not turned into the multi-select the Images rail has, because the
  // filter functions further down read a single string (ytFilterFn === "all" || tag.fn === ytFilterFn),
  // and making them arrays would be a change to what the filters DO, not to how they look.
  // Hence FPill is used directly rather than a toggle helper: single-choice is the honest mapping of
  // a dropdown, and it keeps every video the filters return exactly what it returned before.
  const vidRail = () => {
    // One row of pills for a single-valued filter. `cur` is the live value, `set` its setter.
    const oneOf = (cur, set, opts, label) => (
      <FSection key={label} id={`vid-${label}`} label={label}
        count={cur !== "all" ? 1 : 0}
        open={!!libSecOpen[`vid-${label}`]}
        onToggle={() => setLibSecOpen(p => ({ ...p, [`vid-${label}`]: !p[`vid-${label}`] }))}
        cols={2}>
        {opts.map(o => {
          const val = typeof o === "string" ? o : o.value;
          const text = typeof o === "string" ? o : o.label;
          return <FPill key={val} on={cur === val} onClick={() => set(cur === val ? "all" : val)}>{text}</FPill>;
        })}
      </FSection>
    );
    // ytFilterLinked is deliberately NOT counted here and NOT reset by Clear all below. The rail no
    // longer shows status, so counting it would light up "Clear all" over a panel with nothing
    // active on it, and clearing it would silently move the status card selection above the grid —
    // a control this panel can no longer see.
    const anyOn = ytFilterVenue !== "all" || ytFilterFn !== "all" || ytFilterTier !== "all"
      || ytFilterStyle !== "all" || ytFilterColor !== "all" || ytFilterIO !== "all";
    if (!libRailOpen) return (
      <div className="ml-tile" onClick={() => setLibRailOpen(true)} title="Show filters"
        style={{ width: 38, flexShrink: 0, alignSelf: "flex-start", position: "sticky", top: LIB_RAIL_TOP, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 0 14px",
          borderRadius: 10, border: `1px solid ${border}`, background: cardBg }}>
        <span style={{ writingMode: "vertical-rl", textOrientation: "mixed", fontSize: 9.5, fontWeight: 700,
          letterSpacing: 1, textTransform: "uppercase", color: textS, whiteSpace: "nowrap" }}>Filters</span>
        {anyOn && <span style={{ width: 7, height: 7, borderRadius: 4, background: accent }} />}
      </div>
    );
    // Shares libRailRef with the Images rail on purpose: libView is exclusive, so only one of the
    // two is ever mounted, and this way both get the same MEASURED height from useRailMaxHeight
    // instead of one of them carrying a hardcoded calc() that would drift from the other.
    return (
      <div ref={libRailRef} className="ml-glass ml-rail" style={{ width: 264, flexShrink: 0, alignSelf: "flex-start", position: "sticky", top: LIB_RAIL_TOP, overflowY: "auto", maxHeight: libRailMaxH }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.1, color: accent }}>Filters</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {anyOn && <div onClick={() => { setYtFilterVenue("all"); setVidVenueGroup("all"); setYtFilterFn("all"); setYtFilterTier("all"); setYtFilterStyle("all"); setYtFilterColor("all"); setYtFilterIO("all"); }}
              style={{ fontSize: 11, fontWeight: 600, color: "#E11D48", cursor: "pointer", whiteSpace: "nowrap" }}>Clear all</div>}
            <button type="button" onClick={() => setLibRailOpen(false)} title="Hide the filters and widen the grid"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 8,
                flexShrink: 0, cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${border}`,
                background: "transparent", color: textS, fontSize: 10.5, fontWeight: 600 }}>Hide</button>
          </div>
        </div>
        {/* NO STATUS SECTION. The four status cards above the grid (All / Verified / Needs review /
            Untagged) already set ytFilterLinked — this was the same control twice, and the copy in
            here was the one competing with the pill sections for the top of the panel. */}
        {/* Venue: ONE two-level group, laid out exactly as the Images rail does it — All / Inhouse /
            Outside, then the names for whichever side is chosen. This replaced four separate venue
            blocks (a parent-properties row plus three collapsed sections), which was the same
            information spread over four headings and the reason this panel didn't look like the
            other one.
            The property names sit with the inhouse names because that is what they are: picking a
            parent matches any room in it (subVenuesOfParent, in the filter below) — the old
            dropdown said "(any room)". Marked with a · so the two kinds are still distinguishable. */}
        <div style={{ marginBottom: 12 }}>
          <div className="ml-rail-h" style={{ color: textS }}>Venue</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
            <span onClick={() => { setVidVenueGroup("all"); setYtFilterVenue("all"); }} style={{ ...S.pill(vidVenueGroup === "all"), fontSize: 12, padding: "5px 11px" }}>All</span>
            <span onClick={() => { setVidVenueGroup("inhouse"); setYtFilterVenue("all"); }} style={{ ...S.pill(vidVenueGroup === "inhouse"), fontSize: 12, padding: "5px 11px" }}>Inhouse</span>
            <span onClick={() => { setVidVenueGroup("outside"); setYtFilterVenue("all"); }} style={{ ...S.pill(vidVenueGroup === "outside"), fontSize: 12, padding: "5px 11px" }}>Outside</span>
          </div>
          {vidVenueGroup === "inhouse" && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...inhouseParentNames.map(p => ({ name: p, parent: true })), ...allInhouseVenues.map(v => ({ name: v, parent: false }))].map(v => {
              const sel = ytFilterVenue === v.name;
              return <span key={(v.parent ? "p-" : "v-") + v.name} onClick={() => setYtFilterVenue(sel ? "all" : v.name)} title={v.parent ? `${v.name} — any room` : undefined}
                style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 11.5, padding: "4px 10px" }}>{v.parent ? `· ${v.name}` : v.name}</span>;
            })}
          </div>}
          {vidVenueGroup === "outside" && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {customOutdoor.map(o => {
              const sel = ytFilterVenue === o.name;
              return <span key={o.name} onClick={() => setYtFilterVenue(sel ? "all" : o.name)}
                style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 11.5, padding: "4px 10px" }}>{o.name}{o.empanelled ? " ★" : ""}</span>;
            })}
          </div>}
        </div>
        {oneOf(ytFilterFn, setYtFilterFn, taxOr(taxonomy.eventType, FUNCTIONS), "Event type")}
        {oneOf(ytFilterTier, setYtFilterTier, taxOr(taxonomy.tier, CATEGORIES), "Tier")}
        {oneOf(ytFilterIO, setYtFilterIO, taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(v => ({ value: v, label: venueTypeLabel(v) })), "Venue type")}
        {oneOf(ytFilterStyle, setYtFilterStyle, taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]), "Design style")}
        {oneOf(ytFilterColor, setYtFilterColor, (imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"])), "Palette")}
        {/* Not a filter on the tags — a switch for whether hidden videos are in the set at all.
            Stays a checkbox because that is what it is, and it sits apart from the pill sections so
            it doesn't read as an eighth tag filter. */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: textS, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} style={{ accentColor: accent }} />
          Show hidden
        </label>
        {/* Add Video / Refresh YT. These are ACTIONS, not filters, so they get their own divider and
            sit full-width at the foot rather than blending into the pill sections above.
            Note they now fold away with the rail — anything the panel holds does. That is fine for
            filters; for these two it means Hide also hides the way to add a video, one click from
            being back. Say the word and I'll leave them out on the grid instead. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
          <button onClick={() => openCldVideoBrowser()} style={{ ...S.btn(true), fontSize: 11, padding: "8px 14px", whiteSpace: "nowrap" }}>+ Add Video</button>
          <button onClick={() => loadAllYT(true)} disabled={ytLoading} style={{ ...S.btn(false), fontSize: 11, padding: "8px 14px", whiteSpace: "nowrap", opacity: ytLoading ? 0.5 : 1 }}>{ytLoading ? "⏳" : "🔄"} Refresh YT</button>
        </div>
      </div>
    );
  };

  // ═══ LIBRARY: BROWSE (filtered grid + detail/editor panel) ═══
  // alignItems:flex-start so neither column is stretched to the other's height. minHeight stays — it
  // stops the page jumping when a filter narrows the grid to two rows — but it was also what made the
  // rail draw a full-height pane behind eight collapsed sections.
  const LibraryBrowse = () => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 18, minHeight: "70vh" }}>
      {/* Filter sidebar — its own pane rather than bare labels on the page, which is what the
          reference shows and what Browse and Build already do with their rails. */}
      {/* alignSelf:flex-start, and that is the fix for the tall empty panel. This is a child of a
          display:flex row, and a flex item stretches to the row's height by default — so with the
          sections collapsed the rail was drawing its full glass down past the last one, and 300px of
          empty pane reads as something that failed to load. It now ends where its content ends.
          maxHeight stays as the ceiling for when every section IS open, with its own scrollport.
          225 → 264: the sections are two columns of pills now, and at 225 the longer labels
          ("Indoor + Outdoor", "Garden Inspired") had nowhere to go but their own line. */}
      {!libRailOpen
        /* Folded: a 38px strip on the grid's edge that brings the rail back — the same affordance
           Build folds its own filter rail into (railTab there), so this reads as one behaviour in
           two places rather than a second invention. Vertical label to keep the strip narrow. */
        ? <div className="ml-tile" onClick={() => setLibRailOpen(true)} title="Show filters"
            style={{ width: 38, flexShrink: 0, alignSelf: "flex-start", position: "sticky", top: LIB_RAIL_TOP, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 0 14px",
              borderRadius: 10, border: `1px solid ${border}`, background: cardBg }}>
            <span style={{ display: "flex", color: accent }}><IconSliders size={14} /></span>
            <span style={{ writingMode: "vertical-rl", textOrientation: "mixed", fontSize: 9.5, fontWeight: 700,
              letterSpacing: 1, textTransform: "uppercase", color: textS, whiteSpace: "nowrap" }}>Filters</span>
            {/* Count of what is still filtering while hidden — a folded rail must not hide the fact
                that the grid below it is a filtered subset. */}
            {(() => {
              const n = Object.values(libFilters).reduce((s, a) => s + (a?.length || 0), 0)
                + (libVenueGroup !== "all" ? 1 : 0) + libVenueNames.length;
              return n > 0 ? <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: accent,
                borderRadius: 9, minWidth: 17, textAlign: "center", padding: "2px 4px" }}>{n}</span> : null;
            })()}
            <span style={{ display: "flex", color: textS, transform: "rotate(-90deg)" }}><IconChevron size={11} /></span>
          </div>
      : <div ref={libRailRef} className="ml-glass ml-rail" style={{ width: 264, flexShrink: 0, alignSelf: "flex-start", position: "sticky", top: LIB_RAIL_TOP, overflowY: "auto", maxHeight: libRailMaxH }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.1, color: accent }}>Filters</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {(Object.values(libFilters).some(a => a?.length) || libVenueGroup !== "all" || libVenueNames.length > 0) && <div onClick={clearLibFilters} style={{ fontSize: 11, fontWeight: 600, color: "#E11D48", cursor: "pointer", whiteSpace: "nowrap" }}>Clear all</div>}
            {/* Hide, worded and shaped like Build's. Chevron rotated to point the way the rail folds. */}
            <button type="button" onClick={() => setLibRailOpen(false)} title="Hide the filters and widen the grid"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 8,
                flexShrink: 0, cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${border}`,
                background: "transparent", color: textS, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2 }}>
              <span style={{ display: "inline-flex", transform: "rotate(90deg)" }}><IconChevron size={10} /></span>Hide
            </button>
          </div>
        </div>
        {/* Venue filter (2-level — mirrors Browse page) */}
        <div style={{ marginBottom: 12 }}>
          <div className="ml-rail-h" style={{ color: textS }}>Venue</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
            <span onClick={() => { setLibVenueGroup("all"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "all"), fontSize: 12, padding: "5px 11px" }}>All</span>
            <span onClick={() => { setLibVenueGroup("inhouse"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "inhouse"), fontSize: 12, padding: "5px 11px" }}>Inhouse</span>
            <span onClick={() => { setLibVenueGroup("outside"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "outside"), fontSize: 12, padding: "5px 11px" }}>Outside</span>
          </div>
          {libVenueGroup === "inhouse" && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allInhouseVenues.map(v => {
              const sel = libVenueNames.includes(v);
              return <span key={v} onClick={() => toggleLibVenueName(v)} style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 11.5, padding: "4px 10px" }}>{v}</span>;
            })}
            {libVenueNames.length > 0 && <span onClick={() => setLibVenueNames([])} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕</span>}
          </div>}
          {libVenueGroup === "outside" && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allOutdoorDB.map(v => {
              const sel = libVenueNames.includes(v.name);
              return <span key={v.name} onClick={() => toggleLibVenueName(v.name)} style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 11.5, padding: "4px 10px" }}>{v.name}{v.empanelled ? " ★" : ""}</span>;
            })}
            {libVenueNames.length > 0 && <span onClick={() => setLibVenueNames([])} style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11.5, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕</span>}
          </div>}
        </div>
        {Object.keys(taxonomy).filter(k => Array.isArray(taxonomy[k])).map(k => {
          // colorPalette: use paletteCatalogue names instead of legacy taxonomy values
          // (filter to array-valued keys so non-array fields like taggingStandards never .map-crash)
          const vals = k === "colorPalette" && imsPaletteCatalogue.length > 0
            ? imsPaletteCatalogue.map(p => p.name)
            : taxonomy[k];
          const secCount = (libFilters[k] || []).length;
          return (
          <FSection key={k} id={k} label={k === "colorPalette" ? "Palette" : getTaxLabel(k)} count={secCount}
            cols={2} open={!!libSecOpen[k]} onToggle={() => setLibSecOpen(p => ({ ...p, [k]: !p[k] }))}>
              {vals.map(v => {
                const sel = (libFilters[k] || []).includes(v);
                return <FPill key={v} on={sel} onClick={() => toggleLibFilter(k, v)}>{v}</FPill>;
              })}
          </FSection>);
        })}
      </div>}
      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* The search box lives on the tab row above — same libSearch state, same query. Its
            placeholder can name tags and venue because the query really does look there; see
            SEARCH_TAG_KEYS in libraryQueries.js. */}
        {/* ── Status "folders" + bulk AI tag (Phase 1a) ── */}
        <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            [LIB_STATUS.VERIFIED, "✅", "Verified", "reviewed by a person", libPage.counts.verified, "#059669"],
            [LIB_STATUS.REVIEW, "🤖", "Needs review", "AI-tagged — to check", libPage.counts.review, "#7C3AED"],
            [LIB_STATUS.UNTAGGED, "❓", "Untagged", "no tags yet", libPage.counts.untagged, "#9CA3AF"],
            [TAG_SOURCE.BUILD, "🏗️", "Build Added", "uploaded from Build — cross-check before verifying", libPage.counts.build, "#EC4899"],
          ].map(([k, icon, label, sub, count, col]) => {
            const on = libStatus === k;
            // ml-tile only when NOT selected: the selected card keeps its own tinted border and fill,
            // which is the one thing telling you which status is active. Glassing it too would take
            // that away, and the hover lift on the current selection reads as if it were still a
            // choice to make.
            return <div key={k} className={on ? undefined : "ml-tile"} onClick={() => setLibStatus(k)} title={sub} style={{ cursor: "pointer", minWidth: 104, padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${on ? col : "transparent"}`, background: on ? `${col}14` : undefined, display: "flex", flexDirection: "column", gap: 1 }}>
              {/* The count is the whole point of these cards, so it gets the size. The caption was at
                  8px — below the point where it is read rather than squinted at — and the label at 10
                  was the same weight of small as everything else on the page. */}
              <div className="ml-cap" style={{ color: on ? col : textS }}>{icon} {label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.4, fontVariantNumeric: "tabular-nums", color: on ? col : textP }}>{count}</span><span style={{ fontSize: 10.5, color: textS, lineHeight: 1.3 }}>{sub}</span></div>
            </div>;
          })}
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "center" }}>
            {bulkTag?.running ? (
              <>
                <span style={{ fontSize: 10, color: textS }}>Tagging {bulkTag.done}/{bulkTag.total} · {bulkTag.ok}✓ {bulkTag.fail}✕</span>
                <button onClick={() => stopBulkTag?.()} style={{ ...S.btn(false), fontSize: 10, padding: "4px 10px", color: "#E11D48" }}>■ Stop</button>
              </>
            ) : (
              untaggedCount > 0 && <button onClick={startTagAll} style={{ ...S.btn(true), fontSize: 10, padding: "6px 14px", background: "#7C3AED" }}>🤖 Tag all untagged ({untaggedCount})</button>
            )}
            {/* Knowledge base — distilled from verified photos, fed to the AI tagger. */}
            {rebuildTagKB && (()=>{
              const built = tagKB?.builtAt ? Math.round((Date.now() - tagKB.builtAt) / 3600000) : null;
              const rel = built == null ? "not built yet" : built < 1 ? "updated just now" : built < 24 ? `updated ${built}h ago` : `updated ${Math.round(built/24)}d ago`;
              return (
                <span style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8, marginLeft: 2, borderLeft: `1px solid ${border}` }} title={tagKB?.fromCount ? `Knowledge base learned from ${tagKB.fromCount} verified photos. Fed to the AI tagger so it follows your conventions.` : "No knowledge base yet — verify some photos, then rebuild."}>
                  <span style={{ fontSize: 10, color: textS }}>🧠 KB: {tagKB?.fromCount ? `${tagKB.fromCount} verified · ${rel}` : "not built"}</span>
                  <button onClick={async () => { const kb = await rebuildTagKB(); showMsg(kb ? `🧠 Knowledge base rebuilt from ${kb.fromCount} verified photos` : "No verified photos yet to learn from", kb ? "green" : "orange"); }} style={{ ...S.btn(false), fontSize: 10, padding: "4px 10px" }}>↻ Rebuild</button>
                  {saveTax && <button onClick={() => setTagRules(String(taxonomy.taggingStandards || ""))} title="House tagging rules the AI must follow (e.g. 'always count every light')" style={{ ...S.btn(false), fontSize: 10, padding: "4px 10px" }}>📋 Rules</button>}
                </span>
              );
            })()}
          </div>
        </div>
        {bulkTag?.running && <div style={{ height: 4, background: border, borderRadius: 2, marginBottom: 8 }}><div style={{ height: 4, width: `${bulkTag.total ? (bulkTag.done / bulkTag.total) * 100 : 0}%`, background: "#7C3AED", borderRadius: 2, transition: "width 0.3s" }} /></div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          {/* The RANGE, not just a count: with pages, "Showing 80 of 1966" on page 4 tells you the
              size of the page and nothing about where you are in the set. */}
          {(() => {
            const total = libPage.counts[libStatus] ?? libVisible.length;
            const from = libPage.pageIdx * libPage.pageSize + 1;
            const to = libPage.pageIdx * libPage.pageSize + libVisible.length;
            return <span style={{ fontSize: 11, color: textS, fontVariantNumeric: "tabular-nums" }}>
              {libVisible.length === 0 ? `0 of ${total}` : `Showing ${from}–${to} of ${total}`}{libPage.loading ? "…" : ""}
            </span>;
          })()}
          {libStatus === LIB_STATUS.UNTAGGED && libVisible.length > 0 && (
            <>
              <button onClick={() => setLibSelected(libSelected.size === libVisible.length ? new Set() : new Set(libVisible.map(i => i.id)))} style={{ ...S.btn(false), fontSize: 12, padding: "5px 11px" }}>
                {libSelected.size === libVisible.length ? "Deselect all" : `Select all (${libVisible.length})`}
              </button>
              {libSelected.size > 0 && (
                <>
                  <span style={{ fontSize: 10, color: "#7C3AED", fontWeight: 600 }}>{libSelected.size} selected</span>
                  <button onClick={() => setLibSelected(new Set())} style={{ ...S.btn(false), fontSize: 12, padding: "5px 11px" }}>Clear</button>
                  <button
                    disabled={bulkTag?.running}
                    onClick={() => { runTagSelected?.([...libSelected]); setLibSelected(new Set()); }}
                    style={{ ...S.btn(true), fontSize: 10, padding: "4px 12px", background: "#7C3AED", opacity: bulkTag?.running ? 0.5 : 1 }}
                  >🤖 Tag selected ({libSelected.size})</button>
                </>
              )}
            </>
          )}
        </div>
        {!libPage.loading && libVisible.length === 0 && libPage.error && (
          <div style={{ textAlign: "center", padding: 60, color: "#EF4444" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Failed to load images</div>
            <div style={{ fontSize: 12, color: textS, marginBottom: 12 }}>{libPage.error} — this isn't necessarily an empty library, the request itself failed.</div>
            <button onClick={libPage.retry} style={{ ...S.btn(true), fontSize: 11, padding: "6px 16px" }}>↻ Retry</button>
          </div>
        )}
        {!libPage.loading && libVisible.length === 0 && !libPage.error && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📸</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No images here</div>
            <div style={{ fontSize: 12 }}>Try a different status tab or clear filters — or switch to "Add images"/"Bulk import" to add photos.</div>
          </div>
        )}
        {/* EIGHT to a row, so the column count is now fixed rather than derived from a min width —
            which is why this moved out of an inline style into .ml-grid: a fixed 8 at every width
            would put ~40px thumbnails on a laptop, so the count steps down at real breakpoints
            (8 → 6 → 4 → 2). The thumb height rides along in the same media queries, otherwise a
            fixed 150px on a narrower card turns every photo into a portrait crop.
            See .ml-grid in the injected stylesheet below. */}
        <div className="ml-grid" style={{ "--mlc": libRailOpen ? 6 : 8 }}>
          {libVisible.map(img => {
            const isSel = libSelected.has(img.id);
            // ml-tile drives the glass and the hover lift. Selected and being-edited keep their own
            // border colour — that is state, and it has to win over the glass edge.
            return (
            <div key={img.id} title={img.name || "Untitled"} className={(isSel || libEditImg?.id === img.id) ? undefined : "ml-tile"} onClick={() => libStatus === LIB_STATUS.UNTAGGED && libSelected.size > 0 ? setLibSelected(prev => { const n = new Set(prev); n.has(img.id) ? n.delete(img.id) : n.add(img.id); return n; }) : (logPhotoOpen(authUser, img), setLibEditImg(img))} style={{ borderRadius: 10, overflow: "hidden", border: `1.5px solid ${isSel ? "#7C3AED" : libEditImg?.id === img.id ? accent : "transparent"}`, cursor: "pointer", background: isSel ? "#7C3AED0A" : libEditImg?.id === img.id ? cardBg : undefined, position: "relative" }}>
              {/* Height comes from .ml-grid's breakpoints (var set there), not from a fixed inline
                  value, so it tracks the column count. */}
              <img className="ml-thumb" src={img.url} alt="" loading="lazy" style={{ width: "100%", objectFit: "cover", display: "block" }} onError={() => markImgBroken(img.id)} />
              {(() => {
                const st = photoStatus(img);
                const m = st === LIB_STATUS.VERIFIED ? { t: "✅", c: "#059669" } : st === LIB_STATUS.REVIEW ? { t: "🤖", c: "#7C3AED" } : { t: "❓", c: "#9CA3AF" };
                const verifier = st === LIB_STATUS.VERIFIED ? (img._verifiedBy || null) : null;
                const dateStr = st === LIB_STATUS.VERIFIED && img._verifiedAt ? new Date(img._verifiedAt).toLocaleDateString() : null;
                const editedBy = st === LIB_STATUS.VERIFIED && img._lastEditedBy && img._lastEditedBy !== verifier ? img._lastEditedBy : null;
                const editDateStr = editedBy && img._lastEditedAt ? new Date(img._lastEditedAt).toLocaleDateString() : null;
                const tip = st === LIB_STATUS.VERIFIED
                  ? `Tagged by ${verifier || "unknown"}${dateStr ? ` on ${dateStr}` : ""}${editedBy ? ` · edited by ${editedBy}${editDateStr ? ` on ${editDateStr}` : ""}` : ""}`
                  : st === LIB_STATUS.REVIEW ? "AI-tagged — needs review" : "Untagged";
                return (
                  <div style={{ position: "absolute", top: 6, left: 6, right: 30, display: "flex", alignItems: "center", gap: 3 }}>
                    <div title={tip} style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 9, background: "rgba(0,0,0,0.6)", border: `1.5px solid ${m.c}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>{m.t}</div>
                    {verifier && <div title={tip} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 8, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "2px 5px", borderRadius: 6 }}>{verifier}</div>}
                  </div>
                );
              })()}
              {/* Checkbox — shown in untagged view; clicking it toggles selection without opening detail */}
              {libStatus === LIB_STATUS.UNTAGGED && (
                <div onClick={e => { e.stopPropagation(); setLibSelected(prev => { const n = new Set(prev); n.has(img.id) ? n.delete(img.id) : n.add(img.id); return n; }); }} style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 5, border: `2px solid ${isSel ? "#7C3AED" : "rgba(255,255,255,0.8)"}`, background: isSel ? "#7C3AED" : "rgba(0,0,0,0.35)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>
                  {isSel ? "✓" : ""}
                </div>
              )}
              {libStatus !== LIB_STATUS.UNTAGGED && (img.linkedTemplates || []).length > 0 &&<div style={{ position: "absolute", top: 6, right: 6, padding: "2px 6px", borderRadius: 6, background: "rgba(0,0,0,0.65)", fontSize: 9, color: "#fff", display: "flex", alignItems: "center", gap: 3 }}>🔗 {(img.linkedTemplates || []).length}</div>}
              {(img.elements || []).length > 0 && <div style={{ position: "absolute", top: 28, left: 6, padding: "2px 6px", borderRadius: 6, background: "rgba(124,58,237,0.8)", fontSize: 9, color: "#fff" }}>📋 {(img.elements || []).length}</div>}
              {/* AI tag confidence badge — tag-TIME estimate (match strength + completeness), NOT verified
                  accuracy. Green ≥80 / amber ≥60 / red <60 flags photos that most need a human review. */}
              {typeof img._aiConfidence === "number" && (
                <div title={`AI tag confidence: ${img._aiConfidence}% — a tag-time estimate from match strength + how many items it could place. Not verified accuracy; a reviewer still confirms.`}
                  style={{ position: "absolute", top: 28, right: 6, padding: "3px 9px", borderRadius: 7, fontSize: 12, fontWeight: 800, color: "#fff", background: img._aiConfidence >= 80 ? "rgba(5,150,105,0.92)" : img._aiConfidence >= 60 ? "rgba(217,119,6,0.92)" : "rgba(225,29,72,0.92)" }}>
                  {img._aiConfidence}%
                </div>
              )}
              {/* NO FILENAME. These are storage names — "huvordh6mli01tbcadzp.jpg" — so the line under
                  every thumbnail was a random hash, and twelve of them down a screen is noise that
                  reads as information. The tags say what the photo IS, which is the thing anyone is
                  actually scanning for; the name is still on the card's title attribute and in the
                  editor for when it is genuinely needed.
                  The same cleanup was already made elsewhere in the app ("Stop showing storage
                  filenames under photos") — this grid was the copy that kept it.
                  Chips went 8px → 10px in the same pass: chips that small stop being read and start
                  being texture. */}
              <div style={{ padding: "8px 10px 10px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {(img.tags?.categoryTier || []).map(t => <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: t === "Enhanced" ? "#0EA5E922" : "#6B728022", color: t === "Enhanced" ? "#0EA5E9" : textS }}>{t}</span>)}
                  {(img.tags?.areasElements || []).slice(0, 2).map(t => <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 999, background: `${accent}12`, color: accent }}>{t}</span>)}
                </div>
              </div>
            </div>
          );
          })}
        </div>
        {libPage.loading && <div style={{ textAlign: "center", padding: 16, fontSize: 11, color: textS }}>Loading…</div>}
        {/* Pager. No auto-load sentinel any more — the grid holds one page and you step through it.
            Prev/Next rather than page numbers because the queries are keyset-paginated: a cursor
            points forward only, so a page can be opened once it has been reached, and offering "go to
            page 17" would mean silently walking sixteen pages first. Both buttons are always rendered
            and disabled at the ends, so the row doesn't reflow as you move. */}
        {!libPage.loading && libVisible.length > 0 && (libPage.pageIdx > 0 || libPage.hasMore) && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 16 }}>
            <button className="ml-page-btn" onClick={() => { libPage.prevPage(); libScrollTop(); }} disabled={libPage.pageIdx === 0}
              style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px", opacity: libPage.pageIdx === 0 ? 0.4 : 1, cursor: libPage.pageIdx === 0 ? "default" : "pointer" }}>← Prev</button>
            {/* "Page 3 of 25", not a bare "Page 3" — on its own the number says where you are but not
                how much is left, which is the thing you actually want before clicking Next twenty
                more times. The total comes from the same filter-scoped count the caption above uses,
                so the two can't disagree. Falls back to just the number if the count isn't in yet. */}
            {(() => {
              const total = libPage.counts[libStatus] ?? 0;
              const pages = total > 0 ? Math.ceil(total / libPage.pageSize) : 0;
              return <span style={{ fontSize: 11, color: textS, fontVariantNumeric: "tabular-nums" }}>
                Page {libPage.pageIdx + 1}{pages > 0 ? ` of ${pages}` : ""}
              </span>;
            })()}
            <button className="ml-page-btn" onClick={() => { libPage.nextPage(); libScrollTop(); }} disabled={!libPage.hasMore}
              style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px", opacity: libPage.hasMore ? 1 : 0.4, cursor: libPage.hasMore ? "pointer" : "default" }}>Next →</button>
          </div>
        )}
        {/* House tagging-rules editor — saved to taxonomy.taggingStandards, injected into the tagger */}
        {tagRules !== null && (
          <div onClick={() => setTagRules(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.62)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, margin: "24px auto", background: cardBg, borderRadius: 14, border: `1px solid ${border}`, padding: 18, boxShadow: "0 12px 48px rgba(0,0,0,0.45)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>📋 House Tagging Rules</div>
              <div style={{ fontSize: 11, color: textS, marginBottom: 10 }}>Plain-English rules the AI follows on every photo, on top of the knowledge base. One per line — e.g. "Always count every light fixture and report the total." · "A Stage always has a backdrop — tag it." · "Bar counters are sub-category BAR."</div>
              <textarea value={tagRules} onChange={e => setTagRules(e.target.value)} rows={10} style={{ ...S.input, fontSize: 12, width: "100%", fontFamily: "inherit", lineHeight: 1.5 }} placeholder={"Always count every light fixture and report the total.\nChairs and tables are Furniture; count them.\n..."} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button onClick={() => setTagRules(null)} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px" }}>Cancel</button>
                <button onClick={() => { saveTax({ ...taxonomy, taggingStandards: tagRules }); setTagRules(null); showMsg("📋 Tagging rules saved — applied to all future tagging", "green"); }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px", background: "#7C3AED" }}>Save rules</button>
              </div>
            </div>
          </div>
        )}
        {libCustomPicker && (
          <InventoryItemPickerModal
            title={libCustomPicker.kind === "ceiling" ? "Custom Ceiling — Fabric › Ceiling" : "Custom Masking — Fabric › Printed Walls"}
            icon={libCustomPicker.kind === "ceiling" ? "🎬" : "🖼️"}
            accent="#7C3AED"
            imsInventory={imsInventory}
            categoryMatch="fabric"
            subcatMatch={libCustomPicker.kind === "ceiling" ? "ceiling" : "printed wall"}
            rcFactorByKey={rcFactorByKey}
            onSelect={(item) => {
              const field = libCustomPicker.kind === "ceiling" ? "customCeilingItemId" : "customMaskingItemId";
              if (libCustomPicker.ri == null) {
                setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), [field]: item.id } });
              } else {
                const rows = [...((libEditImg.dims || {}).trussRows || [])];
                rows[libCustomPicker.ri] = { ...rows[libCustomPicker.ri], [field]: item.id };
                setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussRows: rows } });
              }
              setLibCustomPicker(null);
            }}
            onClose={() => setLibCustomPicker(null)}
            isDark={isDark} border={border} textP={textP} textS={textS} cardBg={cardBg}
          />
        )}
        {/* Detail panel — opens as a centered popup so you don't scroll past the whole grid */}
        {libEditImg && (
          <div onClick={() => setLibEditImg(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.62)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "96vw", maxWidth: "96vw", margin: "0 auto", background: cardBg, borderRadius: 14, border: `1px solid ${border}`, height: "96vh", boxShadow: "0 12px 48px rgba(0,0,0,0.45)", display: "flex", overflow: "hidden" }}>
            {/* Left: big image, fixed in place — the right side scrolls on its own so you never
                need to scroll back up to re-check the photo while working through tags/dims/elements. */}
            <div style={{ width: "38%", flexShrink: 0, padding: 16, borderRight: `1px solid ${border}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              {/* contain (not cover) — most of these are landscape shots, and cropping to fill the
                  column height was cutting off the sides. Full width visible, letterboxed if needed. */}
              <img src={libEditImg.url} alt="" onClick={()=>setPreviewImg(libEditImg.url)} style={{ width: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 10, cursor: "pointer", border: "2px solid transparent" }} title="Click to view full size" onError={e => { e.target.style.display = "none"; }} />
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 16, overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <input value={libEditImg.name || ""} onChange={e => setLibEditImg({ ...libEditImg, name: e.target.value })} style={{ ...S.input, fontSize: 14, fontWeight: 600, flex: 1, marginRight: 8 }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={libAiLoading} onClick={async() => {
                      setLibAiLoading(true); showMsg("🤖 Analyzing image...","green");
                      try{
                        const result=await Promise.race([aiTagImage(libEditImg.url),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),75000))]); // 75s: allows the two-call self-verify pass to finish
                        if(result){
                          // Shared merge — see applyAiTagResult (spec §9-B). Stamps tagSource:"manual"
                          // (this button used to omit it, so re-tagged photos silently missed the
                          // "Manual Tagged" chip — now fixed by going through the one helper).
                          const { patch } = applyAiTagResult(libEditImg, result, { taxonomy, tagSource: TAG_SOURCE.MANUAL });
                          setLibEditImg({ ...libEditImg, ...patch });
                          libPage.updateItem?.(libEditImg.id, patch); // refresh the grid card (confidence/tags) after a single re-tag, not just the modal
                          const d=result.dims||{};
                          const hasDims=(d.trussL||d.trussW||d.trussH||d.floorL||d.floorW);
                          showMsg(`✓ AI: ${result.elements?.length||0} elements${hasDims?", dims "+d.trussL+"×"+d.trussW+"×"+d.trussH:"— no dims (fill manually)"}`,"green");
                        }
                        // No else here: aiTagImage already shows the specific reason (rate limit,
                        // empty response, parse error, etc.) via its own showMsg before returning
                        // null — a generic "no results" message here would just overwrite it.
                      }catch(e){showMsg("AI error: "+e.message,"red");}
                      setLibAiLoading(false);
                    }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px", background: "#7C3AED", opacity: libAiLoading ? 0.5 : 1 }}>{libAiLoading ? "🔄 Tagging..." : "🤖 AI Tag"}</button>
                    <button onClick={async () => {
                      // Drape density defaults to Moderate when unset (house standard), so it's no longer
                      // mandatory for Full Box photos — the tagger can still pick Minimum/Dense to override.
                      const d = libEditImg.dims || {};
                      // A human save = Verified: stamps who/when so it leaves the "needs review" pile.
                      // Credit stays with whoever verified it FIRST — a later editor's save updates the
                      // tags but must not steal the original verifier's attribution (their own edit is
                      // still logged as its own contribution below). Instead it stamps _lastEditedBy so
                      // the badge can show "Tagged by A · edited by B".
                      const wasVerified = !!libEditImg._verified;
                      const verified = wasVerified
                        ? { ...libEditImg, _verified: true, _lastEditedBy: authUser?.name || "—", _lastEditedAt: Date.now() }
                        : { ...libEditImg, _verified: true, _verifiedBy: authUser?.name || "—", _verifiedAt: Date.now() };
                      const res = await saveLib([verified]);
                      // saveLib shows its own red toast on a failed write but used to swallow the
                      // failure otherwise — this button kept going and claimed "Saved & verified"
                      // regardless, so a failed save looked identical to a real one until the tags
                      // reverted on the next refresh. Stop here instead: the modal stays open with the
                      // edits intact so nothing is lost, and no false "saved" message is shown.
                      if (!res?.ok) return;
                      // Already-verified photo re-saved → update in place; newly-verified → it just
                      // left this tab (review/untagged/manual/build), drop it from the visible page.
                      if (wasVerified) libPage.updateItem(verified.id, verified); else libPage.removeItem(verified.id);
                      setLibEditImg(verified);
                      // Only the first verification counts as a contribution — re-saves of an
                      // already-verified photo update _lastEditedBy above but don't log again.
                      if (!wasVerified) logVerificationEvent?.({ photoId: libEditImg.id, photoName: libEditImg.name, source: "library" });
                      // Capture per-field corrections (AI suggestion → what the human saved) so future
                      // tagging learns from them; then refresh the in-session corrections feed.
                      if (libEditImg._aiTags) logFieldCorrections(libEditImg.id, libEditImg._aiTags, libEditImg.tags || {}, authUser?.name).then((n) => { if (n) refreshTagCorrections?.(); });
                      showMsg("✅ Saved & verified", "green");
                    }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px",
                      // Dim the Save button when Full Box + no density to give visual cue
                      opacity: (libEditImg.dims?.trussL && libEditImg.dims?.trussW && libEditImg.dims?.trussH && !libEditImg.dims?.drapeDensity) ? 0.45 : 1
                    }}>{libEditImg._verified ? "✅ Save" : "✅ Save & Verify"}</button>
                    <button onClick={async () => { const res = await saveLib([], [libEditImg.id]); if (!res?.ok) return; libPage.removeItem(libEditImg.id); setLibEditImg(null); }} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px", color: "#E11D48" }}>Delete</button>
                    <button onClick={() => setLibEditImg(null)} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px" }}>Close</button>
                  </div>
                </div>
                {/* Review status (🤖 AI suggested / ✓ Reviewed) + light count (💡) + missing items (⚠) */}
                {(() => {
                  const lc = (typeof libEditImg.lightCount === "number") ? libEditImg.lightCount : null;
                  const conf = (typeof libEditImg._aiConfidence === "number") ? libEditImg._aiConfidence : null;
                  const newEls = (libEditImg.elements || []).filter(e => e && e.new).map(e => e.name).filter(Boolean);
                  const unrec = Array.isArray(libEditImg.unrecognized) ? libEditImg.unrecognized : [];
                  const attention = [...newEls, ...unrec];
                  const reviewed = !!libEditImg._verified;
                  const aiSuggested = !!libEditImg._aiTagged && !reviewed;
                  if (lc == null && attention.length === 0 && !reviewed && !aiSuggested && conf == null) return null;
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "2px 0 8px" }}>
                      {reviewed && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, background: "#05966922", color: "#059669" }}>✓ Tagged by {libEditImg._verifiedBy || "—"}{libEditImg._verifiedAt ? ` on ${new Date(libEditImg._verifiedAt).toLocaleDateString()}` : ""}{libEditImg._lastEditedBy && libEditImg._lastEditedBy !== libEditImg._verifiedBy ? ` · edited by ${libEditImg._lastEditedBy}${libEditImg._lastEditedAt ? ` on ${new Date(libEditImg._lastEditedAt).toLocaleDateString()}` : ""}` : ""}</span>}
                      {aiSuggested && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, background: "#7C3AED22", color: "#7C3AED" }}>🤖 AI suggested — review</span>}
                      {conf != null && <span title="AI tag confidence — a tag-time estimate from match strength + how many items it could place. Not verified accuracy; a reviewer still confirms." style={{ fontSize: 15, fontWeight: 800, padding: "6px 14px", borderRadius: 9, background: conf >= 80 ? "#05966922" : conf >= 60 ? "#D9770622" : "#E11D4822", color: conf >= 80 ? "#059669" : conf >= 60 ? "#D97706" : "#E11D48" }}>🎯 {conf}% confidence</span>}
                      {lc != null && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, background: "#F59E0B22", color: "#F59E0B" }}>💡 {lc} light{lc === 1 ? "" : "s"}</span>}
                      {attention.length > 0 && <span style={{ fontSize: 10, color: "#EF4444", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>⚠ Needs attention: {attention.map((a, i) => <span key={i} style={{ padding: "1px 6px", borderRadius: 6, background: "#EF444418" }}>{a}</span>)}</span>}
                    </div>
                  );
                })()}
                {/* AI reasoning — the model's own extended-thinking summary for why it tagged this
                    photo the way it did (which knowledge-base exemplars/house rules it leaned on,
                    what it saw). Only present once this photo has been (re)tagged since this feature
                    shipped — older tags have nothing to show here. */}
                {libEditImg._aiThinking && (
                  <details style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 10, fontWeight: 700, color: accent }}>🧠 Why the AI tagged this photo this way</summary>
                    <div style={{ marginTop: 4, fontSize: 10, color: textS, whiteSpace: "pre-wrap", maxHeight: 180, overflowY: "auto", padding: 8, borderRadius: 6, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${border}` }}>{libEditImg._aiThinking}</div>
                  </details>
                )}
                {/* Raw model output — exactly what Claude returned before element-matching mutated
                    names/sizes/invId onto them. Useful for telling apart "the AI guessed wrong" from
                    "the AI was right but our matching picked the wrong inventory item". */}
                {libEditImg._aiRawResponse && (
                  <details style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: "pointer", fontSize: 10, fontWeight: 700, color: accent }}>📄 Raw AI response (before matching)</summary>
                    <pre style={{ marginTop: 4, fontSize: 9, color: textS, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflowY: "auto", padding: 8, borderRadius: 6, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${border}`, fontFamily: "monospace" }}>{JSON.stringify(libEditImg._aiRawResponse, null, 2)}</pre>
                  </details>
                )}
                {/* The tag groups, in the same numbered cards and the same masonry columns as the
                    video editor — one shared mlTagCard, so the two full-screen editors cannot drift
                    apart again. .vt-cols is the same column flow, for the same reason: these groups
                    are very unevenly tall and a grid row would size every card to its tallest. */}
                <div className="vt-cols">
                {/* Venue tag (2-level chip picker — mirrors Browse page) */}
                {mlTagCard(1, <IconFactory size={14} />, "Venue", (() => {
                    const curVenue = libEditImg.tags?.venue || "";
                    const isInhouse = curVenue && allInhouseVenues.includes(curVenue);
                    const activeGroup = tagVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                    const outsideFiltered = allOutdoorDB.filter(o => tagOutsideSub === "empanelled" ? o.empanelled : tagOutsideSub === "other" ? !o.empanelled : true);
                    const setPhVenue = (val) => setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, venue: val || "" } });
                    return <>
                      <div style={mlTagRow}>
                        {mlTagChip("Inhouse", activeGroup === "inhouse", () => { setTagVenueGroup("inhouse"); setTagOutsideSub("all"); })}
                        {mlTagChip("Outside", activeGroup === "outside", () => { setTagVenueGroup("outside"); setTagOutsideSub("all"); })}
                        {curVenue && <span onClick={() => { setPhVenue(""); setTagVenueGroup(""); }} style={{ padding: "6px 12px", borderRadius: 9, fontSize: 11.5, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕ {curVenue}</span>}
                      </div>
                      {activeGroup === "inhouse" && <div style={{ ...mlTagRow, marginTop: 6 }}>
                        {leafInhouseVenues.map(vn => mlTagChip(vn, curVenue === vn, () => setPhVenue(curVenue === vn ? "" : vn)))}
                      </div>}
                      {activeGroup === "outside" && <>
                        <div style={{ ...mlTagRow, marginTop: 6 }}>
                          {mlTagChip("All", tagOutsideSub === "all", () => setTagOutsideSub("all"))}
                          {mlTagChip("Empanelled", tagOutsideSub === "empanelled", () => setTagOutsideSub("empanelled"))}
                          {mlTagChip("Other", tagOutsideSub === "other", () => setTagOutsideSub("other"))}
                        </div>
                        <div style={{ ...mlTagRow, marginTop: 4 }}>
                          {outsideFiltered.map(o => mlTagChip(o.name + (o.empanelled ? " ★" : ""), curVenue === o.name, () => setPhVenue(curVenue === o.name ? "" : o.name)))}
                        </div>
                      </>}
                    </>;
                  })())}
                {Object.keys(taxonomy).filter(k => Array.isArray(taxonomy[k])).map((k, ki) => {
                  const vals = k === "colorPalette" && imsPaletteCatalogue.length > 0
                    ? imsPaletteCatalogue.map(p => p.name)
                    : taxonomy[k];
                  const picked = (libEditImg.tags?.[k] || []).length;
                  return mlTagCard(ki + 2, ML_TAX_ICON[k] || <IconPalette size={14} />, k === "colorPalette" ? "Palette" : getTaxLabel(k),
                    <div style={mlTagRow}>
                      {vals.map(v => {
                        const sel = (libEditImg.tags?.[k] || []).includes(v);
                        return mlTagChip(v, sel, () => {
                          const cur = libEditImg.tags?.[k] || [];
                          const next = sel ? cur.filter(x => x !== v) : [...cur, v];
                          setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, [k]: next } });
                        });
                      })}
                      {k === "colorPalette" && <PaletteQuickAdd dense accent={accent} border={border} textS={textS}
                        onAdd={(name) => {
                          const added = addPaletteInline(name, imsPaletteCatalogue, setImsPaletteCatalogue, savePaletteData);
                          if (!added) return;
                          const cur = libEditImg.tags?.colorPalette || [];
                          if (!cur.includes(added)) setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, colorPalette: [...cur, added] } });
                        }} />}
                    </div>,
                    // Count on the long groups only — Palette and Areas & elements run to thirty-odd
                    // chips, and there the selection scrolls out of sight behind the rest.
                    picked > 0 ? <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: `${accent}1A`, color: accent }}>{picked}</span> : null);
                })}
                </div>
            {/* ── Zone Dimensions ── */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#C9A96E", marginBottom: 8 }}>{"📐"} Zone Dimensions</div>
              {(() => {
                const d = libEditImg.dims || {};
                const isBox = !!(d.trussL && d.trussW && d.trussH);
                const setD = (patch) => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), ...patch } });
                const cell = { fontSize: 9, color: textS, marginBottom: 2 };
                const inp = { ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 };
                return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 6, marginBottom: 8 }}>
                  <div><div style={cell}>Truss Depth (ft)</div><input type="number" value={d.trussL || ""} onChange={e => setD({ trussL: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                  <div><div style={cell}>Truss Width (ft)</div><input type="number" value={d.trussW || ""} onChange={e => setD({ trussW: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                  <div><div style={cell}>Truss Height (ft)</div><input type="number" value={d.trussH || ""} onChange={e => setD({ trussH: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                  <div><div style={cell}>Truss Qty</div><input type="number" min={1} value={d.trussQty || ""} placeholder="1" onChange={e => setD({ trussQty: Math.max(1, parseInt(e.target.value) || 1) })} style={inp} /></div>
                  {!!(d.trussW && d.trussH) &&<div><div style={cell} title="Box front extended both sides — priced as 2× Single U truss">Front ext (ft/side)</div><input type="number" min={0} step="0.5" value={d.trussFrontExt || ""} placeholder="0" onChange={e => setD({ trussFrontExt: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                  {!!(d.trussW && d.trussH) &&(Number(d.trussFrontExt) || 0) > 0 && <div><div style={cell}>Ext height (ft)</div><input type="number" min={0} step="0.5" value={d.trussFrontExtH || ""} placeholder={String(d.trussH || 0)} onChange={e => setD({ trussFrontExtH: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                </div>;
              })()}
              {!!(libEditImg.dims?.trussW && libEditImg.dims?.trussH) && (() => {
                const d = libEditImg.dims || {};
                const isFullBox = !!(d.trussL && d.trussW && d.trussH);
                const missing = false;
                return (
                  <>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                      <span style={{ fontSize:9, color:textS }}>Truss Type:</span>
                      {TRUSS_MATERIALS.map(m => {
                        const sel = (d.trussMaterial || "iron") === m.key;
                        return <span key={m.key} onClick={()=>setLibEditImg({...libEditImg, dims:{...(libEditImg.dims||{}), trussMaterial: m.key}})}
                          style={{ padding:"2px 7px", borderRadius:5, fontSize:9, fontWeight:sel?700:400, cursor:"pointer", border:`1px solid ${sel?accent:border}`, background: sel?`${accent}22`:"transparent", color: sel?accent:textS }}>{m.label}</span>;
                      })}
                      {isFullBox && (() => {
                        const ceilingItem = d.customCeilingItemId ? (imsInventory || []).find(i => i.id === d.customCeilingItemId) : null;
                        if (ceilingItem) return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 7px", borderRadius:5, fontSize:9, background:"rgba(124,58,237,0.12)", color:"#7C3AED", fontWeight:600, marginLeft:4 }}>
                          🎬 {ceilingItem.name}
                          <span onClick={()=>setLibEditImg({...libEditImg, dims:{...(libEditImg.dims||{}), customCeilingItemId: null}})} style={{ cursor:"pointer", color:"#E11D48", fontWeight:700 }}>×</span>
                        </span>;
                        return <button onClick={()=>setLibCustomPicker({ kind:"ceiling", ri:null })} style={{ padding:"2px 7px", borderRadius:5, fontSize:9, border:`1px dashed ${border}`, background:"transparent", color:textS, cursor:"pointer", marginLeft:4 }}>🎬 Custom Ceiling</button>;
                      })()}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap", padding:"5px 8px", borderRadius:6, background: missing?(isDark?"rgba(239,68,68,0.10)":"#FEF2F2"):"transparent" }}>
                      <span style={{ fontSize:9, fontWeight:600, color: missing?"#B91C1C":textS }}>🪡 Density{missing?" * Required":!isFullBox?" (optional)":""}:</span>
                      {[{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o => {
                        const sel = (d.drapeDensity || "moderate") === o.v;
                        return <span key={o.v} onClick={()=>setLibEditImg({...libEditImg, dims:{...(libEditImg.dims||{}), drapeDensity: o.v}})}
                          style={{ padding:"3px 8px", borderRadius:5, fontSize:9, fontWeight:sel?700:500, cursor:"pointer", border:`1px solid ${sel?"#EC4899":border}`, background: sel?"rgba(236,72,153,0.12)":"transparent", color: sel?"#9D174D":textS }}>{o.l}</span>;
                      })}
                    </div>
                  </>
                );
              })()}
              {(libEditImg.dims?.trussW || libEditImg.dims?.trussH) && (() => {
                const dL=libEditImg.dims?.trussL||0, dW=libEditImg.dims?.trussW||0, dH=libEditImg.dims?.trussH||0;
                const isBoxW=dL&&dW&&dH;
                const mw=libEditImg.dims?.mkWalls||{};
                const mkT=libEditImg.dims?.mkT||"";
                const toggleW=(wall)=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),mkWalls:{...mw,[wall]:!mw[wall]}}});
                const setMkT=(t)=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),mkT:t}});
                // A U truss (open on the sides, only 2 of 3 dims filled) only has a back panel to
                // mask — no left/right walls exist to hang fabric on.
                const walls=isBoxW?[
                  {id:"back",label:"Back wall",dim:`${dW}×${dH} ft`},
                  {id:"left",label:"Left wall",dim:`${dL}×${dH} ft`},
                  {id:"right",label:"Right wall",dim:`${dL}×${dH} ft`}
                ]:[
                  {id:"back",label:"Back wall",dim:`${dW}×${dH} ft`}
                ];
                return <div>
                  <div style={{ fontSize: 9, color: textS, marginBottom: 4 }}>{"🧱"} Masking</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap:"wrap", alignItems:"center" }}>
                    {maskingOptions(imsMaskingRates).map(o=>{
                      const sel=mkT===o.id;
                      return <span key={o.id} onClick={()=>setMkT(sel?"":o.id)} style={{padding:"4px 8px",borderRadius:6,fontSize:9,cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}22`:"transparent",color:sel?accent:textS,fontWeight:sel?600:400}}>{o.l} ₹{maskingRateFor(o.id,imsMaskingRates)}</span>;
                    })}
                    {(() => {
                      const maskItem = libEditImg.dims?.customMaskingItemId ? (imsInventory || []).find(i => i.id === libEditImg.dims.customMaskingItemId) : null;
                      if (maskItem) return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:6, fontSize:9, background:"rgba(124,58,237,0.12)", color:"#7C3AED", fontWeight:600 }}>
                        🖼️ {maskItem.name}
                        <span onClick={()=>setLibEditImg({...libEditImg, dims:{...(libEditImg.dims||{}), customMaskingItemId: null}})} style={{ cursor:"pointer", color:"#E11D48", fontWeight:700 }}>×</span>
                      </span>;
                      return <button onClick={()=>setLibCustomPicker({ kind:"masking", ri:null })} style={{ padding:"3px 8px", borderRadius:6, fontSize:9, border:`1px dashed ${border}`, background:"transparent", color:textS, cursor:"pointer" }}>🖼️ Custom Masking</button>;
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {walls.map(w=>{const on=mw[w.id];return <div key={w.id} onClick={()=>toggleW(w.id)} style={{flex:1,minWidth:80,padding:"6px 8px",borderRadius:8,cursor:"pointer",border:`1.5px solid ${on?accent:border}`,background:on?`${accent}18`:"transparent",textAlign:"center"}}>
                      <div style={{fontSize:10,fontWeight:600,color:on?accent:textS}}>{on?"✓ ":""}{w.label}</div>
                      <div style={{fontSize:9,color:on?accent:textS}}>{w.dim}</div>
                    </div>;})}
                  </div>
                </div>;
              })()}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button onClick={() => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussRows: [...((libEditImg.dims || {}).trussRows || []), { id: "TR" + Date.now() + Math.floor(Math.random() * 1000), trussL: 0, trussW: 0, trussH: 0, trussQty: 1, trussFrontExt: 0, trussFrontExtH: 0, mkOn: false, mkT: "", mkWalls: {} }] } })}
                  style={{ fontSize: 10, fontWeight: 600, color: "#7C3AED", background: "transparent", border: "1px dashed #7C3AED80", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add Truss</button>
              </div>
              {((libEditImg.dims || {}).trussRows || []).map((row, ri) => {
                const setRow = (patch) => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussRows: (libEditImg.dims.trussRows || []).map((x, i) => (i === ri ? { ...x, ...patch } : x)) } });
                const removeRow = () => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), trussRows: (libEditImg.dims.trussRows || []).filter((_, i) => i !== ri) } });
                const rIsBox = !!(row.trussL && row.trussW && row.trussH);
                const cell = { fontSize: 9, color: textS, marginBottom: 2 };
                const inp = { ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 };
                const mw = row.mkWalls || {};
                const rMissing = false;
                // A U truss (only 2 of 3 dims filled) is open on the sides — only its back can be
                // masked, not left/right.
                const walls = rIsBox
                  ? [{ id: "back", label: "Back wall", dim: `${row.trussW}×${row.trussH} ft` }, { id: "left", label: "Left wall", dim: `${row.trussL}×${row.trussH} ft` }, { id: "right", label: "Right wall", dim: `${row.trussL}×${row.trussH} ft` }]
                  : [{ id: "back", label: "Back wall", dim: `${row.trussW || 0}×${row.trussH || 0} ft` }];
                return (
                  <div key={row.id} style={{ marginBottom: 10, padding: 10, borderRadius: 8, background: isDark ? "rgba(124,58,237,0.06)" : "rgba(124,58,237,0.04)", border: "1px solid rgba(124,58,237,0.25)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#7C3AED" }}>Truss #{ri + 2}</span>
                      <span onClick={removeRow} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12 }}>×</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 6, marginBottom: 8 }}>
                      <div><div style={cell}>Truss Depth (ft)</div><input type="number" value={row.trussL || ""} onChange={e => setRow({ trussL: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                      <div><div style={cell}>Truss Width (ft)</div><input type="number" value={row.trussW || ""} onChange={e => setRow({ trussW: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                      <div><div style={cell}>Truss Height (ft)</div><input type="number" value={row.trussH || ""} onChange={e => setRow({ trussH: parseFloat(e.target.value) || 0 })} style={inp} placeholder="—" /></div>
                      <div><div style={cell}>Truss Qty</div><input type="number" min={1} value={row.trussQty || ""} placeholder="1" onChange={e => setRow({ trussQty: Math.max(1, parseInt(e.target.value) || 1) })} style={inp} /></div>
                      {!!(row.trussW && row.trussH) &&<div><div style={cell} title="Box front extended both sides — priced as 2× Single U truss">Front ext (ft/side)</div><input type="number" min={0} step="0.5" value={row.trussFrontExt || ""} placeholder="0" onChange={e => setRow({ trussFrontExt: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                      {!!(row.trussW && row.trussH) &&(Number(row.trussFrontExt) || 0) > 0 && <div><div style={cell}>Ext height (ft)</div><input type="number" min={0} step="0.5" value={row.trussFrontExtH || ""} placeholder={String(row.trussH || 0)} onChange={e => setRow({ trussFrontExtH: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                    </div>
                    {(row.trussW || row.trussH) && (
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                        <span style={{ fontSize:9, color:textS }}>Material:</span>
                        {TRUSS_MATERIALS.map(m => {
                          const sel = (row.trussMaterial || "iron") === m.key;
                          return <span key={m.key} onClick={()=>setRow({trussMaterial:m.key})} style={{ padding:"2px 7px", borderRadius:5, fontSize:9, fontWeight:sel?700:400, cursor:"pointer", border:`1px solid ${sel?"#7C3AED":border}`, background: sel?"#7C3AED22":"transparent", color: sel?"#7C3AED":textS }}>{m.label}</span>;
                        })}
                        {rIsBox && (() => {
                          const ceilingItem = row.customCeilingItemId ? (imsInventory || []).find(i => i.id === row.customCeilingItemId) : null;
                          if (ceilingItem) return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 7px", borderRadius:5, fontSize:9, background:"rgba(124,58,237,0.12)", color:"#7C3AED", fontWeight:600, marginLeft:4 }}>
                            🎬 {ceilingItem.name}
                            <span onClick={()=>setRow({customCeilingItemId:null})} style={{ cursor:"pointer", color:"#E11D48", fontWeight:700 }}>×</span>
                          </span>;
                          return <button onClick={()=>setLibCustomPicker({ kind:"ceiling", ri })} style={{ padding:"2px 7px", borderRadius:5, fontSize:9, border:`1px dashed ${border}`, background:"transparent", color:textS, cursor:"pointer", marginLeft:4 }}>🎬 Custom Ceiling</button>;
                        })()}
                      </div>
                    )}
                    {rIsBox && (
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap", padding:"5px 8px", borderRadius:6, background: rMissing?(isDark?"rgba(239,68,68,0.10)":"#FEF2F2"):"transparent" }}>
                        <span style={{ fontSize:9, fontWeight:600, color: rMissing?"#B91C1C":textS }}>🪡 Density{rMissing?" * Required":""}:</span>
                        {[{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o => {
                          const sel = (row.drapeDensity || "moderate") === o.v;
                          return <span key={o.v} onClick={()=>setRow({drapeDensity:o.v})} style={{ padding:"3px 8px", borderRadius:5, fontSize:9, fontWeight:sel?700:500, cursor:"pointer", border:`1px solid ${sel?"#EC4899":border}`, background: sel?"rgba(236,72,153,0.12)":"transparent", color: sel?"#9D174D":textS }}>{o.l}</span>;
                        })}
                      </div>
                    )}
                    {(row.trussW || row.trussH) && (
                      <div>
                        <div style={{ fontSize: 9, color: textS, marginBottom: 4 }}>{"🧱"} Masking</div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems:"center" }}>
                          {maskingOptions(imsMaskingRates).map(o => {
                            const sel = row.mkT === o.id;
                            return <span key={o.id} onClick={() => setRow({ mkT: sel ? "" : o.id, mkOn: !sel })} style={{ padding: "4px 8px", borderRadius: 6, fontSize: 9, cursor: "pointer", border: `1px solid ${sel ? "#7C3AED" : border}`, background: sel ? "#7C3AED22" : "transparent", color: sel ? "#7C3AED" : textS, fontWeight: sel ? 600 : 400 }}>{o.l} ₹{maskingRateFor(o.id,imsMaskingRates)}</span>;
                          })}
                          {(() => {
                            const maskItem = row.customMaskingItemId ? (imsInventory || []).find(i => i.id === row.customMaskingItemId) : null;
                            if (maskItem) return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:6, fontSize:9, background:"rgba(124,58,237,0.12)", color:"#7C3AED", fontWeight:600 }}>
                              🖼️ {maskItem.name}
                              <span onClick={()=>setRow({customMaskingItemId:null})} style={{ cursor:"pointer", color:"#E11D48", fontWeight:700 }}>×</span>
                            </span>;
                            return <button onClick={()=>setLibCustomPicker({ kind:"masking", ri })} style={{ padding:"3px 8px", borderRadius:6, fontSize:9, border:`1px dashed ${border}`, background:"transparent", color:textS, cursor:"pointer" }}>🖼️ Custom Masking</button>;
                          })()}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {walls.map(w => { const on = mw[w.id]; return <div key={w.id} onClick={() => setRow({ mkWalls: { ...mw, [w.id]: !mw[w.id] } })} style={{ flex:1, minWidth:80, padding: "6px 8px", borderRadius: 8, cursor: "pointer", border: `1.5px solid ${on ? "#7C3AED" : border}`, background: on ? "#7C3AED18" : "transparent", textAlign:"center" }}>
                            <div style={{fontSize:10,fontWeight:600,color:on?"#7C3AED":textS}}>{on ? "✓ " : ""}{w.label}</div>
                            <div style={{fontSize:9,color:on?"#7C3AED":textS}}>{w.dim}</div>
                          </div>; })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {/* Same "default cpT to Carpet Old the moment a real floor dimension is typed" as
                    Build's sFD — only while cpT is still unset, so an explicit pick is never
                    overwritten. See the comment on Build's sFD (StudioBuild.jsx). */}
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Depth (ft)</div><input type="number" value={libEditImg.dims?.floorL || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), cpT: libEditImg.dims?.cpT || defaultCarpetMatId(imsCarpetMaterials), floorL: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Width (ft)</div><input type="number" value={libEditImg.dims?.floorW || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), cpT: libEditImg.dims?.cpT || defaultCarpetMatId(imsCarpetMaterials), floorW: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Platform</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[{v:"",l:"None"},{v:"4in",l:"4\""},{v:"1ft",l:"Raised"}].map(o=>{
                      const sel=(libEditImg.dims?.plH||"")=== o.v;
                      return <span key={o.v} onClick={()=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),plH:o.v}})} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:10,fontWeight:sel?600:400,textAlign:"center",cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}18`:"transparent",color:sel?accent:textS}}>{o.l}</span>;
                    })}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize: 9, color: textS }}>🟫 Carpet</span>
                  <select value={libEditImg.dims?.cpT||""} onChange={e=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),cpT:e.target.value}})} style={{fontSize:10,padding:"3px 6px",borderRadius:6,border:`1px solid ${border}`,background:"#fff",color:"#111827"}}>
                    <option value={CARPET_OFF} style={{color:"#111827",background:"#fff"}}>— None —</option>
                    {(imsCarpetMaterials||[]).map(m=><option key={m.id} value={m.id} style={{color:"#111827",background:"#fff"}}>{m.name} · ₹{m.ratePerSqft}/sqft</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", margin: "6px 0" }}>
                <button onClick={() => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), platformRows: [...((libEditImg.dims || {}).platformRows || []), { id: "PL" + Date.now() + Math.floor(Math.random() * 1000), plH: "", floorL: 0, floorW: 0 }] } })}
                  style={{ fontSize: 10, fontWeight: 600, color: "#059669", background: "transparent", border: "1px dashed #05966980", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add Platform</button>
              </div>
              {((libEditImg.dims || {}).platformRows || []).map((row, ri) => {
                const setRow = (patch) => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), platformRows: (libEditImg.dims.platformRows || []).map((x, i) => (i === ri ? { ...x, ...patch } : x)) } });
                const removeRow = () => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), platformRows: (libEditImg.dims.platformRows || []).filter((_, i) => i !== ri) } });
                return (
                  <div key={row.id} style={{ marginBottom: 8, padding: 10, borderRadius: 8, background: isDark ? "rgba(5,150,105,0.06)" : "rgba(5,150,105,0.04)", border: "1px solid rgba(5,150,105,0.25)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#059669" }}>Platform #{ri + 2}</span>
                      <span onClick={removeRow} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12 }}>×</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Depth (ft)</div><input type="number" value={row.floorL || ""} onChange={e => setRow({ cpT: row.cpT || defaultCarpetMatId(imsCarpetMaterials), floorL: parseFloat(e.target.value) || 0 })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                      <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Width (ft)</div><input type="number" value={row.floorW || ""} onChange={e => setRow({ cpT: row.cpT || defaultCarpetMatId(imsCarpetMaterials), floorW: parseFloat(e.target.value) || 0 })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                      <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Platform</div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {[{v:"",l:"None"},{v:"4in",l:"4\""},{v:"1ft",l:"Raised"}].map(o=>{
                            const sel=(row.plH||"")=== o.v;
                            return <span key={o.v} onClick={()=>setRow({plH:o.v})} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:10,fontWeight:sel?600:400,textAlign:"center",cursor:"pointer",border:`1px solid ${sel?"#059669":border}`,background:sel?"#05966918":"transparent",color:sel?"#059669":textS}}>{o.l}</span>;
                          })}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ fontSize: 9, color: textS }}>🟫 Carpet</span>
                        <select value={row.cpT||""} onChange={e=>setRow({cpT:e.target.value})} style={{fontSize:10,padding:"3px 6px",borderRadius:6,border:`1px solid ${border}`,background:"#fff",color:"#111827"}}>
                          <option value={CARPET_OFF} style={{color:"#111827",background:"#fff"}}>— None —</option>
                          {(imsCarpetMaterials||[]).map(m=><option key={m.id} value={m.id} style={{color:"#111827",background:"#fff"}}>{m.name} · ₹{m.ratePerSqft}/sqft</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: textS }}>
                <span>{(libEditImg.dims?.trussL && libEditImg.dims?.trussW && libEditImg.dims?.trussH) ? <span style={{ color: "#C9A96E", fontWeight: 600 }}>{"🔩"} Box Truss</span> : (libEditImg.dims?.trussW && libEditImg.dims?.trussH) ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>{"🔩"} Single U</span> : "Fill truss dims"}</span>
                {(libEditImg.dims?.floorL && libEditImg.dims?.floorW) ? <span>{"🧹"} Floor: {libEditImg.dims.floorL}×{libEditImg.dims.floorW} = {libEditImg.dims.floorL * libEditImg.dims.floorW} sqft</span> : null}
                {libEditImg.dims?.plH ? <span style={{ color: "#059669", fontWeight: 600 }}>{"🔨"} {libEditImg.dims.plH === "4in" ? "4 inch" : "1ft-3ft raise"}</span> : null}
              </div>
            </div>
            {/* ── Zone Structure Costs — sums the primary row + any extra Truss/Platform rows ── */}
            {(() => {
              const d=libEditImg.dims||{};
              const trussRowCalc=(row)=>{
                const dL=row.trussL||0, dW=row.trussW||0, dH=row.trussH||0;
                const isBox=dL&&dW&&dH;
                const isSingleU=!isBox&&dW&&dH;
                const trussSqft=isBox?(()=>{const s=[dL,dW,dH].sort((a,b)=>b-a);return s[0]*s[1];})():(isSingleU?dW*dH:0);
                const _tr=isBox?trussRateFor("box",row.trussMaterial,row.drapeDensity,imsTrussRates):trussRateFor("singleU",row.trussMaterial,row.drapeDensity,imsTrussRates);
                const ceilingItem = row.customCeilingItemId ? (imsInventory||[]).find(i=>i.id===row.customCeilingItemId) : null;
                const trussRate=(isBox&&ceilingItem)?Math.max(0,_tr.rate-_tr.ceilingRate):_tr.rate;
                const qty=Math.max(1,Number(row.trussQty)||1);
                let trussCost=trussSqft*trussRate*qty;
                if(ceilingItem) trussCost += priceForInvItem(ceilingItem, rcFactorByKey, imsInventory) * qty;
                const mw=row.mkWalls||{};const mkT=row.mkT||"";
                const mkRate=maskingRateFor(mkT,imsMaskingRates);
                let maskSqft=0;const maskWalls=[];
                // U truss has no left/right walls to mask — only its back panel (dW×dH) counts.
                if(isBox){
                  if(mw.back){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Back",dim:`${dW}×${dH}`,sqft:a});}
                  if(mw.left){const a=dL*dH;maskSqft+=a;maskWalls.push({label:"Left",dim:`${dL}×${dH}`,sqft:a});}
                  if(mw.right){const a=dL*dH;maskSqft+=a;maskWalls.push({label:"Right",dim:`${dL}×${dH}`,sqft:a});}
                } else if(isSingleU){
                  if(mw.back){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Back",dim:`${dW}×${dH}`,sqft:a});}
                }
                const maskItem = row.customMaskingItemId ? (imsInventory||[]).find(i=>i.id===row.customMaskingItemId) : null;
                const maskCost = maskItem ? priceForInvItem(maskItem, rcFactorByKey, imsInventory) * qty : maskSqft*mkRate*qty;
                return {isBox,trussSqft,trussRate,trussCost,mkT:maskItem?`custom: ${maskItem.name}`:mkT,mkRate,maskSqft,maskWalls,maskCost,ceilingItem,maskItem};
              };
              const platformRowCalc=(row)=>{
                const fL=row.floorL||0, fW=row.floorW||0;
                const flSqft=fL*fW;
                const plRate=row.plH==="4in"?30:row.plH==="1ft"?45:0;
                const plCost=flSqft*plRate;
                const cp=carpetPricingFor(row.cpT, imsCarpetMaterials);
                const cpRate=row.cpT===CARPET_OFF?0:cp.rate;const cpCost=flSqft*cpRate;
                return {fL,fW,flSqft,plH:row.plH,plRate,plCost,cpRate,cpCost,cpLabel:cp.label};
              };
              const trussRows=[{trussL:d.trussL,trussW:d.trussW,trussH:d.trussH,trussQty:d.trussQty,mkT:d.mkT,mkWalls:d.mkWalls,trussMaterial:d.trussMaterial,drapeDensity:d.drapeDensity,customCeilingItemId:d.customCeilingItemId,customMaskingItemId:d.customMaskingItemId}, ...(d.trussRows||[])];
              const platformRows=[{floorL:d.floorL,floorW:d.floorW,plH:d.plH,cpT:d.cpT}, ...(d.platformRows||[])];
              const trussResults=trussRows.map(trussRowCalc);
              const platformResults=platformRows.map(platformRowCalc);
              const structTotal=trussResults.reduce((s,r)=>s+r.trussCost+r.maskCost,0)+platformResults.reduce((s,r)=>s+r.plCost+r.cpCost,0);
              const anyTruss=trussResults.some(r=>r.trussSqft>0), anyFloor=platformResults.some(r=>r.flSqft>0);
              if(!anyTruss&&!anyFloor)return null;
              return <div style={{marginTop:14,borderTop:`1px solid ${border}`,paddingTop:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:600,color:accent}}>{"🏗️"} Zone Structure Cost</div>
                  <div style={{fontSize:13,fontWeight:600,color:accent}}>{fmt(structTotal)}</div>
                </div>
                {trussResults.map((r,ri)=> r.trussSqft>0 && <div key={"tr"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{ri>0?`Truss #${ri+1} — `:""}{r.isBox?"Box Truss":"Single U"}</span><br/><span style={{fontSize:10,color:textS}}>{r.trussSqft} sqft × ₹{r.trussRate}{r.ceilingItem?` + custom ceiling: ${r.ceilingItem.name}`:""}</span></div>
                  <span style={{fontWeight:600}}>{fmt(r.trussCost)}</span>
                </div>)}
                {trussResults.map((r,ri)=> r.maskCost>0 && <div key={"mk"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{ri>0?`Truss #${ri+1} — `:""}{r.maskItem?`Custom Masking: ${r.maskItem.name}`:`${r.mkT.charAt(0).toUpperCase()+r.mkT.slice(1)} Masking`}</span><br/><span style={{fontSize:10,color:textS}}>{r.maskItem?`${r.maskWalls.map(w=>w.label).join(" + ")||"walls"} — flat item rate`:`${r.maskWalls.map(w=>`${w.label} ${w.dim}=${w.sqft}`).join(" + ")} = ${r.maskSqft} sqft × ₹${r.mkRate}`}</span></div>
                  <span style={{fontWeight:600}}>{fmt(r.maskCost)}</span>
                </div>)}
                {platformResults.map((r,ri)=> r.plCost>0 && <div key={"pl"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{ri>0?`Platform #${ri+1} — `:""}Platform ({r.plH==="4in"?"4 inch":"1ft-3ft"})</span><br/><span style={{fontSize:10,color:textS}}>{r.fL}×{r.fW} = {r.flSqft} sqft × ₹{r.plRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(r.plCost)}</span>
                </div>)}
                {platformResults.map((r,ri)=> r.cpCost>0 && <div key={"cp"+ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11}}>
                  <div><span style={{fontWeight:600}}>{ri>0?`Platform #${ri+1} — `:""}Carpet ({r.cpLabel})</span><br/><span style={{fontSize:10,color:textS}}>{r.fL}×{r.fW} = {r.flSqft} sqft × ₹{r.cpRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(r.cpCost)}</span>
                </div>)}
              </div>;
            })()}
            {/* ── Element Breakdown Card ── */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#7C3AED" }}>📋 Element Breakdown</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {libItems.filter(i => i.id !== libEditImg.id && (i.elements || []).length > 0).length > 0 && (
                    <select onChange={e => { if (!e.target.value) return; const src = libItems.find(i => i.id === e.target.value); if (src) setLibEditImg({ ...libEditImg, elements: JSON.parse(JSON.stringify(src.elements)) }); e.target.value = ""; }} style={{ ...S.select, fontSize: 10, padding: "3px 6px", width: "auto" }}>
                      <option value="">Copy from...</option>
                      {libItems.filter(i => i.id !== libEditImg.id && (i.elements || []).length > 0).map(i => <option key={i.id} value={i.id}>{i.name} ({i.elements.length} items)</option>)}
                    </select>
                  )}
                  <div style={{ position: "relative" }}>
                    <input value={libElSearch} onChange={e => setLibElSearch(e.target.value)} placeholder="+ Add element..." style={{ ...S.input, fontSize: 10, padding: "3px 8px", width: 160, marginBottom: 0 }} onFocus={() => setLibElSearch("")} />
                    {libElSearch.length >= 1 && (() => {
                      // Token AND-match (every typed word must appear SOMEWHERE in the haystack,
                      // any order) instead of one literal substring — "candle 3d" now finds "3D iron
                      // candle wall" even though the words appear in a different order in the name.
                      const tokens = libElSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
                      const matchesTokens = (haystack) => tokens.every(t => haystack.includes(t));
                      // A kit already sold/priced already covers its own components — don't also let
                      // the search offer adding "Round Fibre Pot" separately when a "Molding Console"
                      // kit containing that same pot is already on this photo (would double the item
                      // and double its cost).
                      const kitCoveredIds = new Set((libEditImg.elements || []).filter(el => el.invId).flatMap(el => {
                        const it = (imsInventory || []).find(i => i.id === el.invId);
                        const comps = Array.isArray(el.kitOverrides) ? el.kitOverrides : (it?.subItems || []);
                        return comps.map(c => c.itemId);
                      }));
                      // Searches IMS inventory + pure flower-recipe patterns with no inventory backing
                      // (Rate Card is not consulted here — see getElPriceFromInventory /
                      // getElPriceFromPattern in StudioApp.jsx).
                      const invMatches = (imsInventory || []).filter(it => !(libEditImg.elements || []).find(el => el.invId === it.id) && !kitCoveredIds.has(it.id) && !isHiddenSubcat(it, rcSubcatFactors) && matchesTokens([it.name, it.cat, it.subCat || it.subcategory].filter(Boolean).join(" ").toLowerCase()));
                      const patMatches = (recipeOnlyPatterns || []).filter(pt => !(libEditImg.elements || []).find(el => el.patternId === pt.id) && matchesTokens(pt.name.toLowerCase()));
                      const matches = [...invMatches.map(it => ({ kind: "inv", it })), ...patMatches.map(pt => ({ kind: "pat", pt }))];
                      return matches.length > 0 ? <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", maxHeight: 340, overflowY: "auto", width: 320 }}>
                        {matches.map(m => {
                          if (m.kind === "pat") { const pt = m.pt; return <div key={"pat:" + pt.id}
                            onClick={() => {
                              if (!(libEditImg.elements || []).find(el => el.patternId === pt.id)) {
                                setLibEditImg({ ...libEditImg, elements: [...(libEditImg.elements || []), { name: pt.name, qty: 1, unit: pt.unit, size: "", patternId: pt.id }] });
                              }
                              setLibElSearch("");
                            }}
                            style={{ padding: "8px 10px", fontSize: 11, cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 22, opacity: 0.5 }}>🌺</span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pt.name}</span>
                                <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(236,72,153,0.15)", color: "#EC4899", fontWeight: 700, flexShrink: 0 }}>🌺 RECIPE</span>
                              </div>
                              <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{pt.sub ? pt.sub + " › " : ""}Flower recipe — no inventory item</div>
                            </div>
                          </div>; }
                          const it = m.it; const isKit = Array.isArray(it.subItems) && it.subItems.length > 0; const src = it.img || it.photoUrls?.[0]; return <div key={"inv:" + it.id}
                            onClick={() => {
                              if (!(libEditImg.elements || []).find(el => el.invId === it.id)) {
                                setLibEditImg({ ...libEditImg, elements: [...(libEditImg.elements || []), { name: it.name, qty: 1, unit: it.unit, size: "", invId: it.id }] });
                              }
                              setLibElSearch("");
                            }}
                            style={{ padding: "8px 10px", fontSize: 11, cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10 }}>
                            <ItemHoverThumb src={src} size={56} name={it.name} sub={(it.subCat || it.subcategory) ? (it.subCat || it.subcategory) + " › " + (it.cat || "") : it.cat} dims={itemDimsText(it)} border={border} cardBg={cardBg} textP={textP} textS={textS} emptyBg={isDark ? "#1a1a2e" : "#eee"} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                                {isKit && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(99,102,241,0.15)", color: "#6366F1", fontWeight: 700, flexShrink: 0 }}>📦 KIT</span>}
                              </div>
                              <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{(it.subCat || it.subcategory) ? (it.subCat || it.subcategory) + " › " : ""}{it.cat}{itemDimsText(it) ? ` · 📐 ${itemDimsText(it)}` : ""}</div>
                            </div>
                          </div>;
                        })}
                      </div> : <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, padding: "8px 10px", fontSize: 10, color: textS, width: 320 }}>No matches</div>;
                    })()}
                  </div>
                </div>
              </div>
              {(libEditImg.elements || []).length === 0 ? (
                <div style={{ fontSize: 11, color: textS, padding: "12px 0", textAlign: "center" }}>No elements added yet — use dropdown above or AI tagging fills this automatically</div>
              ) : (
                <div style={{ fontSize: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 55px 50px 70px 24px", gap: "4px 5px", alignItems: "center", padding: "0 4px" }}>
                    <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>ELEMENT</div>
                    <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>QTY</div>
                    <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>SIZE</div>
                    <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>UNIT</div>
                    <div style={{ fontWeight: 600, color: textS, fontSize: 9, textAlign: "right" }}>COST</div>
                    <div></div>
                  </div>
                  {(libEditImg.elements || []).map((el, idx) => {
                    const rowStyle = { display: "grid", gridTemplateColumns: "1fr 60px 55px 50px 70px 24px", gap: "4px 5px", alignItems: "center", padding: "3px 4px", borderRadius: 6, background: hoveredElIdx === idx ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)") : "transparent" };
                    const rowHover = { onMouseEnter: () => setHoveredElIdx(idx), onMouseLeave: () => setHoveredElIdx(null) };
                    if (el.invId) {
                      // IMS inventory-sourced element — priced via getElPriceFromInventory (StudioApp.jsx),
                      // no Rate Card lookup at all. Flat price, UNLESS the item matches a flower recipe
                      // (isFloralBlend) — those get a real/artificial % + Small/Medium/Big size toggle,
                      // same as Build view.
                      const invItem = (imsInventory || []).find(i => i.id === el.invId);
                      const isKit = !!(invItem && Array.isArray(invItem.subItems) && invItem.subItems.length > 0);
                      const { lineCost, isFloralBlend, realPct, patternSMB } = getElPriceFromInventory(el);
                      const thumbSrc = invItem?.img || invItem?.photoUrls?.[0];
                      return (
                        <div key={idx} style={rowStyle} {...rowHover}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: invItem ? textP : "#F59E0B", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center", cursor: thumbSrc ? "zoom-in" : "default" }}
                              onMouseEnter={(e) => {
                                if (!thumbSrc) return;
                                const r = e.currentTarget.getBoundingClientRect();
                                const POP = 164;
                                const openUp = window.innerHeight - r.bottom < POP + 8 && r.top > POP + 8;
                                setElHoverImg({ idx, openUp, top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined, left: Math.min(r.left, window.innerWidth - 168) });
                              }}
                              onMouseLeave={() => setElHoverImg(null)}>
                              {thumbSrc ? <img src={thumbSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 10, opacity: 0.3 }}>📦</span>}
                            </div>
                            {elHoverImg?.idx === idx && thumbSrc && (
                              <div style={{ position: "fixed", top: elHoverImg.top, bottom: elHoverImg.bottom, left: elHoverImg.left, zIndex: 10000, width: 160, height: 160, borderRadius: 8, overflow: "hidden", border: `2px solid ${border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                                <img src={thumbSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              </div>
                            )}
                            <span>{invItem?.name || el.name}</span>
                            {isKit && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(99,102,241,0.15)", color: "#6366F1", fontWeight: 700 }}>📦 KIT</span>}
                            {!invItem && <span title="This inventory item no longer exists" style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>⚠ DELETED</span>}
                            {el.lowConfidence && <span title={`AI matched this by a ${el.matchScore ?? "?"}% keyword overlap, not an exact/near-exact name — please verify it's the right item`} style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700 }}>❓ VERIFY</span>}
                            {el.matchMethod && !el.lowConfidence && <span title={el.matchMethod === "exact" ? "AI matched this by an exact name match" : el.matchMethod === "substring" ? "AI matched this by a name substring match" : `AI matched this by a ${el.matchScore}% keyword overlap`} style={{ fontSize: 8, opacity: 0.4, cursor: "help" }}>ⓘ</span>}
                            {isFloralBlend && <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700 }}>🌸<button onClick={() => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], realPct: undefined }; setLibEditImg({ ...libEditImg, elements: elems }); }} title="Use this sub-category's default real/artificial ratio" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: typeof el.realPct !== "number" ? "#EC4899" : "rgba(236,72,153,0.12)", color: typeof el.realPct !== "number" ? "#fff" : "#EC4899" }}>🌐 Ratio</button><button onClick={() => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], realPct: 100 }; setLibEditImg({ ...libEditImg, elements: elems }); }} title="Price this element at 100% the recipe's Studio rate, overriding the sub-category's default" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: el.realPct === 100 ? "#EC4899" : "rgba(236,72,153,0.12)", color: el.realPct === 100 ? "#fff" : "#EC4899" }}>🎯 100%</button><input type="number" min="0" max="100" value={el.realPct ?? ""} placeholder={String(realPct ?? "")} onChange={(e) => { const v = e.target.value; const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], realPct: v === "" ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0)) }; setLibEditImg({ ...libEditImg, elements: elems }); }} title="Manually set the exact % real — overrides Ratio/100%" style={{ width: 42, padding: "1px 4px", borderRadius: 3, border: `1px solid ${border}`, background: cardBg, color: textP, fontSize: 9, textAlign: "center" }} /></span>}
                          </div>
                          <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                          {patternSMB ? (
                            <select value={el.size || "B"} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                              {["S", "M", "B"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                          <div style={{ fontSize: 10, color: textS }}>{invItem?.unit || el.unit}</div>
                          <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: lineCost > 0 ? textP : textS }}>{lineCost > 0 ? fmt(lineCost) : invItem ? "₹0" : "—"}</div>
                          <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                          {isKit && (
                            <div style={{ gridColumn: "1 / -1" }}>
                              <KitComponentsEditor
                                item={invItem}
                                overrides={el.kitOverrides}
                                onChange={(next) => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], kitOverrides: next }; setLibEditImg({ ...libEditImg, elements: elems }); }}
                                imsInventory={imsInventory}
                                flowerPatterns={(dealCheckData||studioFloralData)?.flowerPatterns||recipeOnlyPatterns}
                                qtyMultiplier={el.qty || 1}
                                rcSubcatFactors={rcSubcatFactors}
                                rcFactorByKey={rcFactorByKey}
                                elSize={el.size}
                                mandiCatalogue={(dealCheckData||studioFloralData)?.mandiCatalogue||[]} studioMarkup={Number((dealCheckData||studioFloralData)?.defaultStudioMarkup)||3}
                                floralRatio={floralRatio} rcFloralModeByKey={rcFloralModeByKey} floralSettings={(dealCheckData||studioFloralData)||{}}
                                textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                              />
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (el.patternId) {
                      // Pure flower-recipe element (no inventory item at all) — priced via
                      // getElPriceFromPattern (StudioApp.jsx), same recipe real/artificial blend as
                      // an invId floral element, just without an underlying physical item.
                      const { lineCost, isFloralBlend, realPct, patternSMB } = getElPriceFromPattern(el);
                      const livePattern = (recipeOnlyPatterns || []).find(p => p.id === el.patternId);
                      const patternExists = !!livePattern;
                      return (
                        <div key={idx} style={rowStyle} {...rowHover}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: textP, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.5 }}>🌺</span>
                            </div>
                            {livePattern?.name || el.name}
                            <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(236,72,153,0.15)", color: "#EC4899", fontWeight: 700 }}>🌺 RECIPE</span>
                            {!patternExists && <span title="This flower recipe no longer exists" style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>⚠ DELETED</span>}
                            {el.lowConfidence && <span title={`AI matched this by a ${el.matchScore ?? "?"}% keyword overlap, not an exact/near-exact name — please verify it's the right recipe`} style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(239,68,68,0.15)", color: "#EF4444", fontWeight: 700 }}>❓ VERIFY</span>}
                            {el.matchMethod && !el.lowConfidence && <span title={el.matchMethod === "exact" ? "AI matched this by an exact name match" : el.matchMethod === "substring" ? "AI matched this by a name substring match" : `AI matched this by a ${el.matchScore}% keyword overlap`} style={{ fontSize: 8, opacity: 0.4, cursor: "help" }}>ⓘ</span>}
                            {isFloralBlend && <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700 }}>🌸<button onClick={() => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], realPct: undefined }; setLibEditImg({ ...libEditImg, elements: elems }); }} title="Use this sub-category's default real/artificial ratio" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: typeof el.realPct !== "number" ? "#EC4899" : "rgba(236,72,153,0.12)", color: typeof el.realPct !== "number" ? "#fff" : "#EC4899" }}>🌐 Ratio</button><button onClick={() => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], realPct: 100 }; setLibEditImg({ ...libEditImg, elements: elems }); }} title="Price this element at 100% the recipe's Studio rate, overriding the sub-category's default" style={{ padding: "1px 6px", borderRadius: 3, border: "none", cursor: "pointer", background: el.realPct === 100 ? "#EC4899" : "rgba(236,72,153,0.12)", color: el.realPct === 100 ? "#fff" : "#EC4899" }}>🎯 100%</button><input type="number" min="0" max="100" value={el.realPct ?? ""} placeholder={String(realPct ?? "")} onChange={(e) => { const v = e.target.value; const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], realPct: v === "" ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0)) }; setLibEditImg({ ...libEditImg, elements: elems }); }} title="Manually set the exact % real — overrides Ratio/100%" style={{ width: 42, padding: "1px 4px", borderRadius: 3, border: `1px solid ${border}`, background: cardBg, color: textP, fontSize: 9, textAlign: "center" }} /></span>}
                          </div>
                          <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                          {patternSMB ? (
                            <select value={el.size || "B"} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                              {["S", "M", "B"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                          <div style={{ fontSize: 10, color: textS }}>{livePattern?.unit || el.unit}</div>
                          <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: lineCost > 0 ? textP : textS }}>{lineCost > 0 ? fmt(lineCost) : "₹0"}</div>
                          <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                        </div>
                      );
                    }
                    const rc = rcItems.find(i => i.name === el.name);
                    const sizes = rcIsSMB(rc) ? ["S","M","B"] : null;
                    const isTrussSqft = rc && rc.unit === "truss_sqft";
                    let unitPrice=0;
                    if(rc){const sz=(el.size||"").toUpperCase();if(rcIsSMB(rc)){if(sz==="S")unitPrice=rc.inhouseS||0;else if(sz==="B")unitPrice=rc.inhouseB||0;else unitPrice=rc.inhouseM||0;}else{unitPrice=rc.inhouseFlat||0;}}
                    const lineCost=(el.qty||0)*unitPrice;
                    return (
                    <div key={idx} style={rowStyle} {...rowHover}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: rc ? textP : "#F59E0B", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>{el.name}{(el.new || !rc) && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}>NEW</span>}{sizes && <button onClick={() => { const elems = [...(libEditImg.elements || [])]; const used = new Set(elems.filter(e => e.name === el.name).map(e => e.size || "M")); const ns = ["B","M","S"].find(s => !used.has(s)) || "B"; elems.splice(idx + 1, 0, { ...el, size: ns, qty: 1 }); setLibEditImg({ ...libEditImg, elements: elems }); }} title="Split into another size (e.g. 3 Big + 2 Small)" style={{ padding: "0 5px", borderRadius: 3, border: `1px dashed ${border}`, fontSize: 8, fontWeight: 700, cursor: "pointer", background: "transparent", color: accent }}>＋ size</button>}</div>
                      {isTrussSqft ? (
                        <div title="Area-based — uses zone truss/floor sqft" style={{ fontSize: 11, fontWeight: 600, color: textS, padding: "3px 5px", borderRadius: 4, background: isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)", textAlign: "center" }}>area</div>
                      ) : (
                        <input type="number" value={el.qty || ""} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], qty: parseFloat(e.target.value) || 0 }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.input, fontSize: 11, padding: "3px 5px", textAlign: "center" }} placeholder="0" />
                      )}
                      {sizes ? (
                        <select value={el.size || sizes[0]} onChange={e => { const elems = [...(libEditImg.elements || [])]; elems[idx] = { ...elems[idx], size: e.target.value }; setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ ...S.select, fontSize: 10, padding: "2px 3px" }}>
                          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <div style={{ fontSize: 10, color: textS, textAlign: "center" }}>—</div>}
                      <div style={{ fontSize: 10, color: textS }}>{rc?.unit || el.unit}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: (isTrussSqft ? unitPrice : lineCost) > 0 ? textP : textS }}>{isTrussSqft ? (unitPrice > 0 ? `₹${unitPrice.toLocaleString("en-IN")}/sqft` : "—") : (lineCost > 0 ? fmt(lineCost) : rc ? "₹0" : "—")}</div>
                      <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                    </div>
                  );})}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: textS }}>Manually-added elements come from IMS inventory (📦 KIT items price as one line at the kit's own rate). Items tagged <span style={{color:"#F59E0B",fontWeight:600}}>NEW</span> were AI-detected but have no matching IMS inventory item — add the item to Inventory, or remove. Items tagged <span style={{color:"#EF4444",fontWeight:600}}>❓ VERIFY</span> were matched by a weak keyword guess, not an exact name — double-check they're the right item.</div>
            </div>
            {/* ── Print — a print job (Flex/Vinyl/Sunboard etc.); linking it to an inventory element
                 is optional, not required, since a print isn't always for something already in
                 Inventory (e.g. a custom banner/backdrop graphic). ── */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0EA5E9" }}>🖨️ Print</div>
                <button onClick={() => {
                  const entry = { id: "PR" + Date.now() + Math.floor(Math.random() * 1000), material: (imsPrintMaterials || [])[0]?.id || "", areaW: 0, areaD: 0, qty: 1, refImageUrl: "", invId: null };
                  setLibEditImg({ ...libEditImg, prints: [...(libEditImg.prints || []), entry] });
                }} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #0EA5E9", background: "rgba(14,165,233,0.14)", color: "#0EA5E9", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>+ Add Print Row</button>
              </div>
              {(() => {
                // Opens with one ready-to-edit blank row instead of a "no prints" empty state — purely
                // visual (not written to libEditImg.prints) until the user actually edits it, so closing
                // without touching Print never persists an empty row.
                const rows = (libEditImg.prints || []).length === 0
                  ? [{ id: "__phantom__", material: (imsPrintMaterials || [])[0]?.id || "", areaW: 0, areaD: 0, qty: 1, refImageUrl: "", invId: null }]
                  : libEditImg.prints;
                return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {rows.map((p, pi) => {
                    const isPhantom = p.id === "__phantom__";
                    const invItem = p.invId ? (imsInventory || []).find(i => i.id === p.invId) : null;
                    const thumbSrc = invItem?.img || invItem?.photoUrls?.[0];
                    const mat = (imsPrintMaterials || []).find(m => m.id === p.material);
                    const sqft = (Number(p.areaW) || 0) * (Number(p.areaD) || 0);
                    const rate = mat?.ratePerSqft || 0;
                    const qty = Math.max(1, Math.round(Number(p.qty) || 1));
                    const cost = sqft * rate * qty;
                    const setPrint = (patch) => {
                      if (isPhantom) { setLibEditImg({ ...libEditImg, prints: [{ ...p, ...patch, id: "PR" + Date.now() + Math.floor(Math.random() * 1000) }] }); return; }
                      setLibEditImg({ ...libEditImg, prints: libEditImg.prints.map((x, i) => (i === pi ? { ...x, ...patch } : x)) });
                    };
                    const linkQ = printLinkSearch[p.id] || "";
                    return (
                      <div key={p.id} style={{ padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(14,165,233,0.06)" : "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.25)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <select value={p.material || ""} onChange={e => setPrint({ material: e.target.value })} style={{ ...S.select, fontSize: 10, padding: "3px 6px", width: "auto" }}>
                            <option value="">Material…</option>
                            {(imsPrintMaterials || []).map(m => <option key={m.id} value={m.id}>{m.name} (₹{m.ratePerSqft}/sqft)</option>)}
                          </select>
                          <input type="number" min="0" step="0.1" value={p.areaW || ""} onChange={e => setPrint({ areaW: parseFloat(e.target.value) || 0 })} placeholder="W ft" style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 56, marginBottom: 0, textAlign: "center" }} />
                          <span style={{ fontSize: 10, color: textS }}>×</span>
                          <input type="number" min="0" step="0.1" value={p.areaD || ""} onChange={e => setPrint({ areaD: parseFloat(e.target.value) || 0 })} placeholder="D ft" style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 56, marginBottom: 0, textAlign: "center" }} />
                          <span style={{ fontSize: 10, color: textS }}>ft = {sqft ? sqft.toFixed(1) : 0} sqft</span>
                          <span style={{ fontSize: 10, color: textS }}>×</span>
                          <input type="number" min="1" step="1" value={p.qty ?? 1} onChange={e => setPrint({ qty: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })} title="Qty — how many copies of this same print" style={{ ...S.input, fontSize: 10, padding: "3px 6px", width: 40, marginBottom: 0, textAlign: "center" }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#0EA5E9", marginLeft: "auto" }}>{rate > 0 ? fmt(cost) : "— pick material"}</span>
                          {!isPhantom && <span onClick={() => setLibEditImg({ ...libEditImg, prints: libEditImg.prints.filter((_, i) => i !== pi) })} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12 }}>×</span>}
                        </div>
                        <input value={p.refImageUrl || ""} onChange={e => setPrint({ refImageUrl: e.target.value })} placeholder="Reference image URL (optional)" style={{ ...S.input, fontSize: 10, padding: "3px 8px", marginTop: 6, marginBottom: 0, width: "100%" }} />
                        {p.refImageUrl && <img src={p.refImageUrl} alt="" style={{ marginTop: 6, width: "100%", maxHeight: 100, objectFit: "cover", borderRadius: 6 }} onError={e => { e.target.style.display = "none"; }} />}
                        {/* Optional link to an inventory element — for cross-reference only, never required */}
                        {p.invId ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {thumbSrc ? <img src={thumbSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 10, opacity: 0.3 }}>📦</span>}
                            </div>
                            <span style={{ fontSize: 10, color: invItem ? textS : "#F59E0B", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {invItem ? invItem.name : `⚠ ${p.invId} not in IMS`}</span>
                            <span onClick={() => setPrint({ invId: null })} style={{ cursor: "pointer", color: textS, fontSize: 9, textDecoration: "underline" }}>Unlink</span>
                          </div>
                        ) : (
                          <div style={{ position: "relative", marginTop: 6 }}>
                            <input value={linkQ} onChange={e => setPrintLinkSearch(prev => ({ ...prev, [p.id]: e.target.value }))} placeholder="🔗 Link to an inventory item (optional)" style={{ ...S.input, fontSize: 10, padding: "3px 8px", width: "100%", marginBottom: 0 }} />
                            {linkQ.trim() && (() => {
                              const tokens = linkQ.toLowerCase().trim().split(/\s+/).filter(Boolean);
                              const matches = (imsInventory || []).filter(it => tokens.every(t => (it.name + " " + (it.subCat || it.subcategory || "") + " " + (it.cat || "")).toLowerCase().includes(t))).slice(0, 40);
                              return (
                                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: cardBg, border: `1px solid ${border}`, borderRadius: 8, marginTop: 2, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", maxHeight: 260, overflowY: "auto" }}>
                                  {matches.length === 0 && <div style={{ padding: "8px 10px", fontSize: 10, color: textS }}>No matches</div>}
                                  {matches.map(it => {
                                    const src = it.img || it.photoUrls?.[0];
                                    return (
                                      <div key={it.id} onClick={() => {
                                        const toFt = (v, u) => (Number(v) || 0) * ({ Feet: 1, Inches: 1 / 12, Cm: 1 / 30.48, Metre: 3.28084 }[u] || 1);
                                        const patch = { invId: it.id };
                                        if (!p.areaW && !p.areaD) { if (it.printW) patch.areaW = toFt(it.printW, it.printUnit); if (it.printL) patch.areaD = toFt(it.printL, it.printUnit); }
                                        setPrint(patch);
                                        setPrintLinkSearch(prev => ({ ...prev, [p.id]: "" }));
                                      }} style={{ padding: "8px 10px", fontSize: 11, cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                          {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 15, opacity: 0.3 }}>📦</span>}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{it.name}</div>
                                          <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{(it.subCat || it.subcategory) ? (it.subCat || it.subcategory) + " › " : ""}{it.cat}{it.printW ? " · print area on file" : ""}</div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(libEditImg.prints || []).length > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, paddingTop: 4 }}>
                    <span style={{ color: textP }}>Print Total</span>
                    <span style={{ color: "#0EA5E9" }}>{fmt((libEditImg.prints || []).reduce((sum, p) => { const m = (imsPrintMaterials || []).find(x => x.id === p.material); const s = (Number(p.areaW) || 0) * (Number(p.areaD) || 0); const q = Math.max(1, Math.round(Number(p.qty) || 1)); return sum + s * (m?.ratePerSqft || 0) * q; }, 0))}</span>
                  </div>}
                </div>
                );
              })()}
            </div>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );

  // ═══ CONTRIBUTIONS PANEL — who corrected how many photos, by date (Phase 1b reporting) ═══
  const CorrectionsPanel = () => {
    const now = Date.now();
    const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    const since = { today: startOfToday, "7d": now - 7 * 86400000, "30d": now - 30 * 86400000, all: 0 }[corrRange] ?? 0;
    const q = corrSearch.trim().toLowerCase();
    const kindOf = (e) => e.kind === "video" ? "video" : "photo";
    // Dedupe to ONE row per person + item (keep the latest save), so repeated saves of the same photo
    // don't show as duplicates or inflate counts — a contribution = a unique photo/video a person fixed.
    const dedupeRows = (rows) => {
      const m = new Map();
      rows.forEach(e => { const k = (e.user || "—") + "|" + (e.photoId || e.photoName || "") + "|" + kindOf(e); const p = m.get(k); if (!p || (e.ts || 0) > (p.ts || 0)) m.set(k, e); });
      return Array.from(m.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    };
    // Range + text-search, WITHOUT the kind filter (search matches person OR photo/video name).
    const rangeAndText = (corrLog || []).filter(e => (e.ts || 0) >= since
      && (!q || (e.user || "").toLowerCase().includes(q) || (e.photoName || "").toLowerCase().includes(q)));
    // The stat cards read off this one — the period's full picture, kind filter NOT applied. That is
    // deliberate: the cards double as the Photos/Videos picker, and if they were kind-filtered like
    // the lists, choosing Photos would drop the Videos card to 0 and leave you clicking a zero to get
    // back. The cards describe the period; the highlight says which one is selected.
    const baseAllKinds = dedupeRows(rangeAndText);
    // What the lists show: the same set with the kind filter applied. Identical to before.
    const base = dedupeRows(rangeAndText.filter(e => corrKind === "all" || kindOf(e) === corrKind));
    const inRange = base.filter(e => !corrUser || e.user === corrUser);
    const byUser = {};
    base.forEach(e => { const u = e.user || "—"; const b = byUser[u] || (byUser[u] = { total: 0, photo: 0, video: 0 }); b.total++; b[kindOf(e)]++; });
    const userRows = Object.entries(byUser).sort((a, b) => b[1].total - a[1].total);
    const fmtTs = (ts) => new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    // Clamped on read as well as reset by the effect: narrowing a filter can shrink the list between
    // the state update and this render, and a page index past the end renders an empty panel that
    // looks exactly like "nothing matches".
    const corrPages = Math.max(1, Math.ceil(inRange.length / CORR_PAGE_SIZE));
    const cp = Math.min(corrPage, corrPages - 1);
    // ── THE FOUR STAT CARDS ──
    // The reference puts Verified / Needs review / Untagged / Build added here. Those are LIBRARY
    // counts (libPage.counts), and two things are wrong with showing them on this tab: they are
    // scoped to the Images tab's filters and search, so a filter left on over there would silently
    // narrow them here where no filter UI is visible — and they say nothing about contributions,
    // which is what this page is for. Same four-card treatment, numbers that mean something on the
    // page they are on: they answer "how much work, by how many people, on what".
    // `pick` is the corrKind value a card selects — the SAME state the Content type pills set, so
    // this is a second surface onto one filter, not a second filter. A card with no pick (People)
    // is a readout and says so by not reacting to the cursor.
    const nPhoto = baseAllKinds.filter(e => kindOf(e) === "photo").length;
    const nVideo = baseAllKinds.filter(e => kindOf(e) === "video").length;
    const stats = [
      [<IconClipboardCheck size={16} />, "Contributions", baseAllKinds.length, "items in this period", "#7C3AED", "all"],
      [<IconStar size={16} />, "People", new Set(baseAllKinds.map(e => e.user || "—")).size, "contributors", "#059669", null],
      [<IconCamera size={16} />, "Photos", nPhoto, "photos corrected", "#0EA5E9", "photo"],
      [<IconPlay size={16} />, "Videos", nVideo, "videos verified", "#D97706", "video"],
    ];
    const statCard = ([icon, label, value, sub, col, pick]) => {
      const on = pick && corrKind === pick;
      return (
      <div key={label} className={pick ? "cp-stat" : undefined} onClick={pick ? () => setCorrKind(corrKind === pick ? "all" : pick) : undefined}
        title={pick ? (on ? `Showing ${label.toLowerCase()} only — click to clear` : `Show only ${label.toLowerCase()}`) : undefined}
        style={{ padding: "13px 15px", borderRadius: 13, display: "flex", alignItems: "center", gap: 12,
          cursor: pick ? "pointer" : "default",
          // The selected card carries its own colour, so which one is active is legible without
          // reading back up to the pills.
          border: `1px solid ${on ? col : (isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.85)")}`,
          background: on ? `${col}12` : (isDark ? "rgba(255,255,255,0.03)" : "linear-gradient(148deg,rgba(255,255,255,0.62) 0%,rgba(250,249,255,0.40) 100%)") }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `${col}18`, color: col }}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: on ? col : textS }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, color: textP, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{value}</div>
          <div style={{ fontSize: 10, color: textS }}>{sub}</div>
        </div>
      </div>
      );
    };
    // A labelled group of pills. The filters were one undifferentiated row before — two unrelated
    // choices separated by a hairline, which is not enough to say they are different questions.
    const pillGroup = (label, opts, cur, set) => (
      <div>
        <div className="ml-rail-h" style={{ color: textS, marginBottom: 6 }}>{label}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {opts.map(([k, l]) => <span key={k} onClick={() => set(k)} style={{ padding: "6px 14px", fontSize: 11.5, borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", fontWeight: cur === k ? 700 : 500, border: `1px solid ${cur === k ? accent : border}`, background: cur === k ? accent : (isDark ? "rgba(255,255,255,0.04)" : "#fff"), color: cur === k ? "#fff" : textS, transition: "background .13s ease" }}>{l}</span>)}
        </div>
      </div>
    );
    const panel = (icon, title, right, body) => (
      <div className="ml-glass" style={{ borderRadius: 14, padding: "14px 16px 16px", alignSelf: "start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ display: "inline-flex", color: accent }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: textP }}>{title}</span>
          {right}
        </div>
        {body}
      </div>
    );
    return (
      <div>
        {/* The explainer as a banner rather than a grey paragraph. It is the only thing telling you
            what counts as a "contribution", so it earns the tint. */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", borderRadius: 12, marginBottom: 16, background: `${accent}0F`, border: `1px solid ${accent}2E` }}>
          <span style={{ display: "inline-flex", flexShrink: 0, color: accent, marginTop: 1 }}><IconAlert size={14} /></span>
          <div style={{ fontSize: 11.5, color: textS, lineHeight: 1.5 }}>
            Every photo correction (&quot;Save correction to master&quot; / &quot;Save &amp; Verify&quot;) and video tag verification is logged here — who corrected how many photos and videos, and when. Click a person to see only their work.
          </div>
        </div>
        <div style={{ display: "flex", gap: 22, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          {/* No Custom range: the reference shows one, but it needs a date picker and a second range
              state, which is new functionality rather than a new look. The four presets are the ones
              that exist. */}
          {pillGroup("Time period", [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["all", "All time"]], corrRange, setCorrRange)}
          {pillGroup("Content type", [["all", "All"], ["photo", "Photos"], ["video", "Videos"]], corrKind, setCorrKind)}
          <div style={{ flex: 1, minWidth: 200, display: "flex", alignItems: "center", gap: 8 }}>
            <input value={corrSearch} onChange={e => setCorrSearch(e.target.value)} placeholder="Search by person or photo/video name…" style={{ ...S.input, fontSize: 12, marginBottom: 0, flex: 1, minWidth: 160 }} />
            {(corrUser || corrSearch) && <span onClick={() => { setCorrUser(""); setCorrSearch(""); }} style={{ fontSize: 11, fontWeight: 600, color: "#E11D48", cursor: "pointer", whiteSpace: "nowrap" }}>Clear</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginBottom: 16 }}>
          {stats.map(statCard)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,340px) minmax(0,1fr)", gap: 14 }} className="cp-cols">
          {/* No "View all" in this header, though the reference has one: clicking the highlighted
              person already clears the selection, and the Clear beside the search clears both. A
              third control for the same thing is a control to explain, not a shortcut. */}
          {panel(<IconStar size={14} />, "By person",
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: textS, fontVariantNumeric: "tabular-nums" }}>{userRows.length}</span>,
            <>
            {userRows.length === 0 ? <div style={{ fontSize: 11.5, color: textS, padding: "10px 0" }}>No contributions in this period yet.</div> :
              // The selected person gets a solid left rule as well as the tint. The tint alone is
              // faint against the glass, and this row is what the whole right-hand panel is showing —
              // it has to be obvious which one is picked, and clickable again to clear.
              userRows.map(([u, c], i) => (
                <div key={u} className="cp-row" onClick={() => setCorrUser(corrUser === u ? "" : u)}
                  title={corrUser === u ? `Showing ${u} only — click to clear` : `Show only ${u}`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 9px", borderRadius: 9, cursor: "pointer", background: corrUser === u ? `${accent}18` : "transparent", boxShadow: corrUser === u ? `inset 3px 0 0 ${accent}` : "none" }}>
                  <span style={{ fontSize: 12.5, color: textP, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: textS, marginRight: 7, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>{u}</span>
                  <span style={{ fontSize: 10.5, color: textS, display: "flex", gap: 8, alignItems: "baseline", flexShrink: 0 }}>
                    {c.photo > 0 && <span title="photos" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><IconCamera size={11} />{c.photo}</span>}
                    {c.video > 0 && <span title="videos" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><IconPlay size={11} />{c.video}</span>}
                    <span style={{ fontSize: 15, fontWeight: 800, color: accent, fontVariantNumeric: "tabular-nums" }}>{c.total}</span>
                  </span>
                </div>
              ))}
            {/* Legend, as in the reference. The two glyphs in every row are otherwise unexplained. */}
            {userRows.length > 0 && <div style={{ display: "flex", gap: 14, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}`, fontSize: 10, color: textS }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconCamera size={11} />Photos</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconPlay size={11} />Videos</span>
            </div>}
            </>)}
          {panel(<IconNote size={14} />, corrUser ? `Recent — ${corrUser}` : "Recent contributions",
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: textS, fontVariantNumeric: "tabular-nums" }}>{inRange.length}</span>,
            // No inner scrollport any more. It was a 460px window onto a 400-row slice — you scrolled
            // inside a panel that was itself on a scrolling page, and the rows below the fold were
            // invisible to the browser's own find. A page of 30 is short enough to just render.
            <div>
              {inRange.length === 0 ? <div style={{ fontSize: 11.5, color: textS, padding: "10px 0" }}>Nothing matches.</div> :
                inRange.slice(cp * CORR_PAGE_SIZE, cp * CORR_PAGE_SIZE + CORR_PAGE_SIZE).map(e => {
                  const isVid = kindOf(e) === "video";
                  const thumb = isVid ? (allVideos.find(v => v.id === e.photoId)?.thumb) : (libItems.find(i => i.id === e.photoId)?.url);
                  return (
                  <div key={e.id} className="cp-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 9px", borderRadius: 9 }}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                      {/* The kind glyph sits in a tinted tile when there is no thumbnail, so a row
                          without one keeps the same left edge as a row with one. */}
                      {thumb
                        ? <img src={thumb} alt="" loading="lazy" style={{ width: 42, height: 30, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} onError={ev => { ev.target.style.display = "none"; }} />
                        : <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 42, height: 30, borderRadius: 6, flexShrink: 0, background: `${accent}14`, color: accent }}>{isVid ? <IconPlay size={13} /> : <IconCamera size={13} />}</span>}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: textP, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.photoName || e.photoId || "(item)"}</div>
                        <div style={{ fontSize: 10, color: textS }}>{e.user} · {e.source === "build" ? "build screen" : e.source === "video" ? "video" : "library"}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: textS, whiteSpace: "nowrap", flexShrink: 0 }}>{fmtTs(e.ts)}</span>
                  </div>
                  );
                })}
              {/* Only when there is more than one page — a disabled Prev/Next pair under a list of
                  nine rows is furniture. The range is spelled out because "Page 3 of 34" alone does
                  not tell you where in 997 items you are. */}
              {corrPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` }}>
                  <button className="ml-page-btn" onClick={() => setCorrPage(p => Math.max(0, p - 1))} disabled={cp === 0}
                    style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px", opacity: cp === 0 ? 0.4 : 1, cursor: cp === 0 ? "default" : "pointer" }}>← Prev</button>
                  <span style={{ fontSize: 11, color: textS, fontVariantNumeric: "tabular-nums" }}>
                    {cp * CORR_PAGE_SIZE + 1}–{Math.min(inRange.length, cp * CORR_PAGE_SIZE + CORR_PAGE_SIZE)} of {inRange.length}
                    <span style={{ opacity: 0.6 }}> · page {cp + 1}/{corrPages}</span>
                  </span>
                  <button className="ml-page-btn" onClick={() => setCorrPage(p => Math.min(corrPages - 1, p + 1))} disabled={cp >= corrPages - 1}
                    style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px", opacity: cp >= corrPages - 1 ? 0.4 : 1, cursor: cp >= corrPages - 1 ? "default" : "pointer" }}>Next →</button>
                </div>
              )}
            </div>)}
        </div>
      </div>
    );
  };

  // ═══ MANAGE: LIBRARY & CONTENT ═══ (reference ManageLibrary() ~11684)
  return (
    <div className="ml-root" style={{ position: "relative" }}>
      <style>{`
/* ── THE GROUND ──
   position:FIXED, and that is the whole trick. Absolute + inset:0 made this layer as tall as the
   PAGE, and this page scrolls for thousands of pixels — so background-size:cover scaled the artwork
   up to cover all of it and what landed in view was one empty corner of the image. Fixed sizes the
   layer to the VIEWPORT, which is what Deal Check gets for free by living inside a fixed overlay.
   This is NOT background-attachment:fixed. That property re-composites the image against the scroll
   offset on every frame, which is the cost that was flickering these pages on Mac. A fixed ELEMENT
   with a static background is painted once and simply does not move.
   Children are lifted above it by the rule below rather than each carrying its own z-index: a static
   sibling paints BELOW a positioned layer however late it comes in the DOM, so without that rule the
   cards would sit under the artwork. */
.ml-wash{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:#F7F5F1;background-size:cover;background-position:center;background-repeat:no-repeat}
/* ── VIGNETTE ──
   A soft darkening that stays out of the middle and gathers in the corners. Two things it earns:
   the pale artwork stops competing with the white glass panels sitting on it, and the grid reads as
   lit from the centre instead of evenly flat.
   The colour is the app's navy ink, NOT black — black over this warm off-white goes grey and muddy,
   while the navy keeps the shade inside the palette the rest of the page uses.
   It lives on a pseudo-element rather than in the .ml-wash background, because that background is
   set INLINE from the artwork URL and an inline background-image would win over anything layered
   into the shorthand here. Fixed parent, absolute child, so it costs one paint and does not
   re-composite while the page scrolls. */
.ml-wash::after{content:"";position:absolute;inset:0;
  background:radial-gradient(125% 95% at 50% 38%,
    rgba(26,26,46,0) 40%, rgba(26,26,46,0.07) 72%, rgba(26,26,46,0.17) 100%)}
/* position:relative and DELIBERATELY no z-index. The job here is only to lift the page's content off
   the wash, and being positioned is enough for that: the wash is a positioned z-index:0 element that
   comes FIRST in the DOM, and positioned siblings with z-index:auto paint in tree order, so they
   land on top of it. (Static siblings would not — that is the bug this rule was added for.)
   The z-index:1 it used to carry made every one of these children a stacking context, which trapped
   the modals nested inside them: a dialog at z-index 9999 was being composited inside a layer whose
   own index is 1, so the app header at 50 painted over it. That is the navbar overlap. Removing the
   index removes the trap without weakening the lift — do not put it back. */
.ml-root > *:not(.ml-wash){position:relative}
/* ── GLASS, PAINTED NOT SAMPLED ──
   No backdrop-filter anywhere here. It re-reads and re-blurs whatever is behind it every frame, and
   what reads as glass is the bright top edge, the diagonal sheen and the shadow — all of which are
   just paint. Same decision as the cost sheet and Deal Check, and the reason Safari stopped dimming
   those panels.
   !important because most of these surfaces set their background inline from cardBg, and an inline
   declaration beats a plain rule. */
.ml-glass{
  background:linear-gradient(148deg,rgba(255,255,255,0.78) 0%,rgba(250,249,255,0.58) 100%) !important;
  border:1px solid rgba(255,255,255,0.85) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(26,26,46,0.04), 0 18px 40px -22px rgba(26,26,46,0.26) !important}
/* Panes that sit ON the glass are clearer again — two sheets at the same strength composite to
   opaque and the pair reads as one flat slab. */
.ml-tile{
  background:linear-gradient(148deg,rgba(255,255,255,0.52) 0%,rgba(250,249,255,0.30) 100%) !important;
  border:1px solid rgba(255,255,255,0.8) !important;
  transition:background .16s ease, box-shadow .18s ease, transform .16s ease}
.ml-tile:hover{transform:translateY(-2px);
  background:linear-gradient(148deg,rgba(255,255,255,0.68) 0%,rgba(250,249,255,0.44) 100%) !important;
  box-shadow:0 1px 2px rgba(26,26,46,0.05), 0 14px 30px -14px rgba(26,26,46,0.34) !important}
/* ── TYPOGRAPHY ──
   Defined here rather than borrowed from Deal Check's .dc-cap: that stylesheet mounts only while the
   Deal Check overlay is open, so the class would silently not exist on this page and every caption
   would fall back to inherited body type. A page's own type belongs to the page.
   Captions are small-and-wide, not just small — the tracking is what makes 11px read as a LABEL
   instead of as body text shrunk down, which is what most of this screen was doing. */
.ml-cap{font-size:11px;font-weight:700;letter-spacing:0.9px;text-transform:uppercase;line-height:1.25}
/* Section headings in the filter rail. Same idea one step up. */
/* The Venue group is still hand-rolled (two-level — venue names nest under Inhouse/Outside), so it
   keeps this heading. Sized to match the kit's section labels above so it does not read as a different
   kind of thing sitting on top of them. Colour left as it was. */
.ml-rail-h{font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:0.6;margin-bottom:8px}
/* ── HOVER ON THE TWO CONTROLS THAT HAD NONE ──
   Everything card-shaped on this page lifts under .ml-tile, but the view tabs and the pager were
   flat: nothing happened until you clicked, which on a pager reading "Page 3 of 25" leaves you
   unsure the arrows are live at all.
   The tabs respond only when NOT selected — data-on marks the current one, and hovering the tab you
   are already on suggests something is still to be gained by clicking it.
   The pager responds only when NOT disabled, for the same reason: an end-stop that highlights reads
   as a button that will do something. */
.ml-tab:not([data-on]):hover{background:rgba(26,26,46,0.055) !important;color:#1a1a2e !important}
/* Filled navy, not the faint grey S.btn(false) they inherited — Prev/Next are the only way off a
   page and they were the quietest thing on it, reading as disabled captions rather than buttons.
   The same #1a1a2e/#2d1b69 the active view tab and Summary's totals use, so "this is a control you
   press" is one colour across the app.
   !important because each button spreads S.btn(false) inline, and an inline declaration beats a
   plain rule. Dark mode gets a light fill for the same reason in reverse — navy on near-navy is the
   invisibility this change exists to fix. */
.ml-page-btn:not(:disabled){transition:background .14s ease, transform .14s ease, box-shadow .16s ease;
  background:${isDark ? "rgba(255,255,255,0.14)" : "linear-gradient(135deg,#1a1a2e,#2d1b69)"} !important;
  color:${isDark ? "#fff" : "#fff"} !important;
  border:1px solid ${isDark ? "rgba(255,255,255,0.18)" : "transparent"} !important;
  font-weight:600 !important;
  box-shadow:0 1px 3px rgba(26,26,46,0.22)}
.ml-page-btn:not(:disabled):hover{background:${isDark ? "rgba(255,255,255,0.22)" : "linear-gradient(135deg,#2d1b69,#3d2589)"} !important;
  transform:translateY(-1px);box-shadow:0 3px 10px rgba(26,26,46,0.30)}
/* Disabled stays flat and grey so an end-stop never looks pressable. The inline opacity:0.4 alone
   would have left a dimmed navy button, which still reads as a button. */
.ml-page-btn:disabled{background:${isDark ? "rgba(255,255,255,0.05)" : "rgba(26,26,46,0.06)"} !important;
  color:${textS} !important;border:1px solid transparent !important;box-shadow:none;
  /* Cancels the inline opacity:0.4 each call site sets. That was there to dim a light-grey button;
     against this grey fill it would double up and leave the end-stop all but invisible, and a
     disabled control still has to be readable enough to say which end you are at. */
  opacity:1 !important}
@media (prefers-reduced-motion: reduce){.ml-page-btn:not(:disabled){transition:none}.ml-page-btn:not(:disabled):hover{transform:none}}
/* ── THE VIDEO TAG EDITOR ──
   The tagging groups flow down CSS columns rather than sitting in a grid. Their heights are wildly
   uneven — Colors is thirty chips, In/Out is three — and in a grid every card in a row is sized to
   the tallest one in it, which left craters under the short groups. Columns let each card be its own
   height; break-inside:avoid is what stops one being sliced across a column boundary.
   The video/summary pair above it goes one-column when there is no longer room for a 700px player
   beside a readable summary. */
/* Contributions: the two panels go one-column when the person list can no longer sit beside a
   readable feed. cp-row is the hover for both lists' rows — they are clickable in one and scannable
   in the other, and a row you can point at should say so. */
@media (max-width:980px){.cp-cols{grid-template-columns:minmax(0,1fr) !important}}
/* Only the cards that DO something lift. The People card is a readout and stays put, which is the
   difference a cursor alone would not carry. */
.cp-stat{transition:transform .14s ease, box-shadow .16s ease}
.cp-stat:hover{transform:translateY(-2px);box-shadow:0 1px 2px rgba(26,26,46,0.05), 0 14px 30px -14px rgba(26,26,46,0.30)}
@media (prefers-reduced-motion: reduce){.cp-stat{transition:none}.cp-stat:hover{transform:none}}
/* auto-fit already collapses this to one column below its 420px floor, so no breakpoint is needed. */
/* ── PALETTES PAGE ──
   Nothing on this screen reacted to the cursor, and it is the densest screen in the app: a hundred
   and eighty-odd anchor chips, each one a toggle, laid out identically whether or not you can click
   them. The chip's LABEL half is the toggle and its star is a separate action, so they highlight
   separately — hovering the row and having the whole thing light up would promise one target where
   there are two.
   Background only on the anchors: they already carry state in their border and fill, and a transform
   would make a wrapped grid of them jitter as the cursor crosses. */
/* + Add Colour / + Add Palette. They were the gold accent, which on this light page is the loudest
   thing on screen and — more to the point — disagreed with every other primary control in the app:
   the active view tab, Summary's totals and the pagers are all this navy. One colour for "press
   this", everywhere. Dark mode takes a light fill; navy on near-navy is invisible.
   No !important needed here, unlike the pagers: these two carry no inline background any more. */
.pal-add{color:#fff;box-shadow:0 1px 3px rgba(26,26,46,0.22);
  background:${isDark ? "rgba(255,255,255,0.14)" : "linear-gradient(135deg,#1a1a2e,#2d1b69)"};
  transition:background .14s ease, transform .14s ease, box-shadow .16s ease}
.pal-add:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(26,26,46,0.30);
  background:${isDark ? "rgba(255,255,255,0.22)" : "linear-gradient(135deg,#2d1b69,#3d2589)"}}
.pal-add:active{transform:translateY(0)}
.pal-anchor{transition:background .12s ease}
.pal-anchor:hover{background:${isDark ? "rgba(255,255,255,0.10)" : "rgba(26,26,46,0.07)"}}
.pal-star{transition:background .12s ease, color .12s ease}
.pal-star:hover{background:${accent}22;color:${accent}}
/* Destructive, so it says so on approach rather than only in the colour of the glyph. */
.pal-del{transition:background .12s ease}
.pal-del:hover{background:rgba(225,29,72,0.14)}
/* The two catalogue cards and each palette card: a resting border that warms on hover, so a card
   reads as a thing you work inside rather than a printed block. */
.pal-card{transition:border-color .16s ease, box-shadow .18s ease}
.pal-card:hover{border-color:${accent}66 !important;box-shadow:0 2px 6px rgba(26,26,46,0.05), 0 14px 30px -18px rgba(26,26,46,0.22)}
@media (prefers-reduced-motion: reduce){.pal-anchor,.pal-star,.pal-del,.pal-card,.pal-add{transition:none}.pal-add:hover{transform:none}}
.cp-row{transition:background .13s ease}
.cp-row:hover{background:${isDark ? "rgba(255,255,255,0.05)" : "rgba(26,26,46,0.04)"}}
.vt-cols{column-count:3;column-gap:14px}
.vt-cols > div{break-inside:avoid}
@media (max-width:1250px){.vt-cols{column-count:2}}
@media (max-width:1100px){.vt-top{grid-template-columns:minmax(0,1fr) !important}}
@media (max-width:760px){.vt-cols{column-count:1}}
/* Figures line up: the four status cards sit in a row and their counts are meant to be compared. */
.ml-root{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"lnum" 1}
/* ── THE PHOTO GRID: EIGHT UP ──
   A fixed count, not auto-fill: the ask was eight to a row, and auto-fill cannot promise a count —
   it divides by a min width, so the answer changes with the window and with whether the filter rail
   is folded. minmax(0,1fr) rather than (Npx,1fr) so the columns can go below their content's natural
   width instead of overflowing the row.
   Stepping down at real widths is what keeps this honest — eight columns held at every width would
   be ~40px thumbnails on a 13" laptop, and the thumbnails are the reason the page exists.
   --mlt is the thumb height, dropped in step with the count so a narrower card doesn't become a
   portrait crop of a landscape photo. */
/* The count comes from --mlc, set inline from libRailOpen: 6 while the filter rail is showing, 8 once
   it is hidden. The rail is 264px + an 18px gap, so holding 8 either way meant the open state paid
   for the rail out of the thumbnails and the hidden state left the reclaimed space unused.
   Inline is the right place for it precisely BECAUSE an inline custom property beats a stylesheet
   one — the breakpoints below therefore cannot fight it, and they don't try: they set
   grid-template-columns outright, which caps the count on narrow windows regardless of rail state.
   The fallback in var() keeps the grid at 6 rather than collapsing to one column if the property
   ever fails to arrive. */
.ml-grid{display:grid;gap:12px;grid-template-columns:repeat(var(--mlc,6),minmax(0,1fr));--mlt:132px}
/* Fallback in the var() on purpose: with no height at all a width:100% thumb renders at the photo's
   own aspect ratio, which is a full-bleed image per row. A missing custom property should cost a few
   pixels of height, not the whole layout. */
.ml-thumb{height:var(--mlt,140px)}
@media (max-width:1500px){.ml-grid{grid-template-columns:repeat(6,minmax(0,1fr));--mlt:142px}}
@media (max-width:1180px){.ml-grid{grid-template-columns:repeat(4,minmax(0,1fr));--mlt:150px}}
@media (max-width:820px){.ml-grid{grid-template-columns:repeat(3,minmax(0,1fr));--mlt:140px}}
@media (max-width:560px){.ml-grid{grid-template-columns:repeat(2,minmax(0,1fr));--mlt:132px}}
/* ── THE RAIL'S TYPE, TURNED UP ──
   Size only. The kit's colours stay exactly as they are — an earlier pass darkened them too and that
   was the part that was wrong, so this deliberately touches nothing but font-size and the padding that
   has to grow with it.
   !important because the kit sets these inline (see pill() and Section in filterUI.jsx), and an inline
   declaration beats a plain rule. Scoped to .ml-rail so Browse and Build keep the kit's own sizing —
   this is a local turn-up, not a change to the shared component.
   The section label is the SECOND span in the header: bullet, label, optional count badge, chevron.
   nth-of-type(2) holds whether or not the badge is there, since the badge comes after it. */
/* ── THE WHOLE ROW IS THE TARGET, NOT THE WORDS ──
   The kit stretches this header with negative margins written against a 12px panel padding
   (margin:0 -12px, see Section in filterUI.jsx). This rail pads 14, so the row stopped 2px short of
   each edge and the strip beside the label — most of the row's width — was not part of the button.
   Matching the margin to this padding makes the hit area run the full width of the pane, which is
   what an accordion row should be: you press the row, not the word.
   The taller padding is the same idea vertically — a 12px-tall target for a 12px label is a target
   you have to aim at. */
/* ── THE WHOLE SECTION ROW IS THE BUTTON ──
   The kit stretches its header with negative margins (margin:0 -12px; width:auto) so the hover fill
   bleeds past the panel padding. That works in Browse and Build, whose panels don't scroll. This
   rail sets overflow-y:auto — and per spec, once one overflow axis is not visible the other
   computes to auto as well, so the overhang became horizontal overflow: clipped, and shorter still
   once the scrollbar took its width. The row ended before the panel edge and the dead strip beside
   the label was not part of the button.
   width:100% + margin:0 instead. The fill no longer bleeds to the very edge, but it spans every
   pixel of the row you can actually see and click, which is the point. box-sizing so the padding
   stays inside that 100% rather than pushing it wide again and reintroducing the overflow. */
.ml-rail .sb-head{margin:0 !important;width:100% !important;box-sizing:border-box !important;padding:11px 12px !important}
.ml-rail .sb-head > span:nth-of-type(2){font-size:12px !important;letter-spacing:1px !important}
.ml-rail .sb-pill{font-size:12.5px !important;padding:7px 12px !important;min-height:30px !important}
/* The filter rail: same glass, and its pills lift on hover so the column reads as pressable rather
   than as a list of labels. */
.ml-rail{border-radius:14px;padding:14px 14px 16px}
.ml-rail button,.ml-rail [role="button"]{transition:background .14s ease, border-color .14s ease}
@media (prefers-reduced-motion: reduce){
  .ml-tile{transition:none}
  .ml-tile:hover{transform:none}
  /* The kit states this as a caller's job (see the note at the end of filterUI.jsx): it ships the
     transitions but leaves the reduced-motion opt-out to whoever mounts it, so each page can decide
     without the kit second-guessing. Honoured here now that this page is one of those callers. */
  .sb-pill,.sb-head{transition:none}
}
`}</style>
      {/* The kit's own CSS — the section-header hover fill (.sb-head) and its pill states live there,
          not in the block above. Without this the sections render but the rows do not respond. */}
      <style>{filterCSS}</style>
      {/* Under everything, above nothing. See .ml-wash. */}
      <div className="ml-wash" aria-hidden="true" style={ML_BG ? { backgroundImage: `url(${ML_BG})` } : undefined} />
      {/* Inline add bar */}
      <div className="ml-glass" style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, borderRadius: 12, marginBottom: 14 }}>
        <button onClick={() => {if(!cldOpen){setCldOpen("library");setCldPath([]);setCldFolders([]);setCldImages([]);fetchCldFolders("");}else setCldOpen(null);}} style={{ ...S.btn(cldOpen==="library"), fontSize: 11 }}>🗂️ Storage</button>
        <button onClick={handleRebuildLibrary} disabled={rebuildRunning} title="Scan all Storage folders and add any missing images to the Library" style={{ ...S.btn(false), fontSize: 11, opacity: rebuildRunning ? 0.5 : 1, border: `1px solid ${rebuildRunning ? "#9CA3AF" : "#7C3AED"}`, color: rebuildRunning ? "#9CA3AF" : "#7C3AED" }}>{rebuildRunning ? "⏳ Rebuilding…" : "🔄 Rebuild Library"}</button>
        <button onClick={handleFindOrphaned} disabled={orphanScan.running} title="Scan Storage and flag Library rows whose image no longer exists there" style={{ ...S.btn(false), fontSize: 11, opacity: orphanScan.running ? 0.5 : 1, border: `1px solid ${orphanScan.running ? "#9CA3AF" : "#E11D48"}`, color: orphanScan.running ? "#9CA3AF" : "#E11D48" }}>{orphanScan.running ? "⏳ Scanning…" : "🧹 Find Orphaned"}</button>
      </div>
      {rebuildMsg && <div style={{ padding: "8px 14px", borderRadius: 8, background: "#7C3AED12", border: "1px solid #7C3AED30", marginBottom: 8, fontSize: 11, color: "#7C3AED" }}>⏳ {rebuildMsg}</div>}
      {orphanScan.msg && <div style={{ padding: "8px 14px", borderRadius: 8, background: "#E11D4812", border: "1px solid #E11D4830", marginBottom: 8, fontSize: 11, color: "#E11D48" }}>⏳ {orphanScan.msg}</div>}
      {orphanScan.result && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginBottom: 14, background: cardBg }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: orphanScan.result.orphaned.length ? 10 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: orphanScan.result.orphaned.length ? "#E11D48" : "#10B981" }}>
              {orphanScan.result.orphaned.length ? `🧹 ${orphanScan.result.orphaned.length} orphaned row(s) found` : "✓ No orphaned rows — Library matches Storage"}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: textS }}>{orphanScan.result.totalLibrary} Library rows · {orphanScan.result.totalStorage} Storage images</span>
              {orphanScan.result.orphaned.length > 0 && (
                <button onClick={handleDeleteOrphaned} disabled={orphanDeleting} style={{ ...S.btn(true), fontSize: 11, padding: "5px 10px", background: "#E11D48", opacity: orphanDeleting ? 0.5 : 1 }}>
                  {orphanDeleting ? "Deleting…" : `🗑 Delete ${orphanScan.result.orphaned.length}`}
                </button>
              )}
              <button onClick={() => setOrphanScan({ running: false, msg: "", result: null })} style={{ ...S.btn(false), fontSize: 11, padding: "5px 10px" }}>Dismiss</button>
            </div>
          </div>
          {orphanScan.result.orphaned.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {orphanScan.result.orphaned.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, padding: "4px 8px", borderRadius: 6, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
                  <span style={{ color: textP, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name || r.id}</span>
                  <span style={{ color: textS, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "50%" }} title={r.url}>{r.url}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Cloudinary Browser for Library */}
      {cldOpen==="library"&&<div style={{border:`1px solid ${accent}`,borderRadius:12,padding:14,marginBottom:14,background:isDark?"rgba(201,169,110,0.04)":"rgba(201,169,110,0.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:700,color:accent}}>📂 Browse Storage Photos</div>
          <span onClick={()=>setCldOpen(null)} style={{fontSize:11,cursor:"pointer",color:"#E11D48",fontWeight:700}}>✕ Close</span>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
          <span onClick={()=>cldGoBack(0)} style={{fontSize:10,color:accent,cursor:"pointer",fontWeight:600}}>Root</span>
          {cldPath.map((seg,si)=><Fragment key={si}>
            <span style={{fontSize:10,color:textS}}>/</span>
            <span onClick={()=>cldGoBack(si+1)} style={{fontSize:10,color:si===cldPath.length-1?textP:accent,cursor:"pointer",fontWeight:600}}>{seg}</span>
          </Fragment>)}
        </div>
        {/* Upload & select buttons — visible when inside a folder */}
        {cldPath.length>0&&<div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
          <input ref={cldUploadRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>{if(e.target.files.length)handleCldUpload(e.target.files,false);e.target.value="";}} />
          <input ref={cldFolderUploadRef} type="file" accept="image/*" multiple webkitdirectory="" directory="" style={{display:"none"}} onChange={e=>{if(e.target.files.length)handleCldUpload(e.target.files,true);e.target.value="";}} />
          <button onClick={()=>cldUploadRef.current?.click()} disabled={cldUploading} style={{...S.btn(true),fontSize:11,padding:"7px 16px",opacity:cldUploading?0.5:1}}>📤 Upload Photos</button>
          <button onClick={()=>cldFolderUploadRef.current?.click()} disabled={cldUploading} style={{...S.btn(false),fontSize:11,padding:"7px 16px",opacity:cldUploading?0.5:1,border:`1px solid ${accent}`}}>📂 Upload Folder</button>
          {cldImages.length>0&&<button onClick={()=>{setCldSelectMode(!cldSelectMode);setCldSelected(new Set());}} style={{...S.btn(cldSelectMode),fontSize:11,padding:"7px 16px",border:`1px solid ${cldSelectMode?"#E11D48":border}`,color:cldSelectMode?"#E11D48":textS}}>{cldSelectMode?"✕ Cancel":"☑️ Select"}</button>}
          {/* Recursive import: pull EVERY photo under this folder (all subfolders), deduped */}
          <button onClick={async()=>{
            const prefix=cldPath.join("/");
            if(!(await askConfirmAsync(`Import every photo under "${prefix}"?`, {
              note: "Includes every subfolder. Already-imported photos are skipped automatically, so there are no duplicates. Run \u201CTag all untagged\u201D afterwards.",
              yesLabel: "Import",
            })))return;
            setImportingFolder(true);
            try{ await importCloudinaryFolder?.(prefix); } finally { setImportingFolder(false); }
          }} disabled={importingFolder||cldUploading} style={{...S.btn(true),fontSize:11,padding:"7px 16px",background:"#7C3AED",opacity:(importingFolder||cldUploading)?0.5:1}}>{importingFolder?"⏳ Importing…":"📁 Import folder + subfolders"}</button>
          <span style={{fontSize:10,color:textS}}>→ {cldPath.join("/")}</span>
        </div>}
        {/* Select mode toolbar */}
        {cldSelectMode&&<div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,padding:"8px 12px",borderRadius:8,background:"#E11D4812",border:"1px solid #E11D4840"}}>
          <span style={{fontSize:11,color:"#E11D48",fontWeight:600}}>{cldSelected.size} selected</span>
          <button onClick={()=>{const all=new Set(cldImages.map(i=>i.public_id));setCldSelected(cldSelected.size===cldImages.length?new Set():all);}} style={{...S.btn(false),fontSize:10,padding:"4px 10px",color:accent}}>
            {cldSelected.size===cldImages.length?"Deselect All":"Select All"}
          </button>
          {cldSelected.size>0&&<button onClick={handleCldBulkDelete} disabled={cldDeleting} style={{...S.btn(true),fontSize:10,padding:"4px 12px",background:"#E11D48",opacity:cldDeleting?0.5:1}}>
            {cldDeleting?"Deleting...":` Delete ${cldSelected.size}`}
          </button>}
        </div>}
        {/* Upload progress */}
        {cldUploadProgress.length>0&&<div style={{marginBottom:10,padding:10,borderRadius:8,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"rgba(0,0,0,0.02)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:600,color:textP}}>Upload Progress</span>
            {!cldUploading&&<span onClick={()=>setCldUploadProgress([])} style={{fontSize:10,cursor:"pointer",color:"#E11D48",fontWeight:600}}>✕ Clear</span>}
          </div>
          {cldUploadProgress.map((f,i)=>{
            const isDone=f.status==="done",isErr=f.status==="error",isSkip=f.status==="skipped",isUnsup=f.status==="unsupported";
            const clr=isDone?"#10B981":isErr?"#E11D48":isSkip?"#3B82F6":isUnsup?"#F59E0B":"#F59E0B";
            const icon=isDone?"✅":isErr?"❌":isSkip?"⊘":isUnsup?"⚠️":f.status==="compressing"?"🗜️":f.status==="checking"?"🔍":"⏳";
            return <div key={i} style={{display:"flex",gap:8,alignItems:"center",fontSize:10,color:textS,padding:"3px 0"}}>
              <span style={{color:clr}}>{icon}</span>
              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
              <span style={{fontSize:9,color:clr}}>{f.status}</span>
            </div>;
          })}
        </div>}
        {cldLoading&&<div style={{textAlign:"center",padding:20,color:textS,fontSize:11}}>⏳ Loading...</div>}
        {!cldLoading&&cldFolders.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:10}}>
          {cldFolders.map(f=>{const fn=f.name||f.path;return <div key={fn} style={{position:"relative",padding:"10px 12px",borderRadius:8,border:`1px solid ${border}`,cursor:"pointer",textAlign:"center",fontSize:11,fontWeight:600,color:textP,background:isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.02)"}}>
            <div onClick={()=>cldNavigate(fn)}>📁 {fn}</div>
            <button onClick={(e)=>{e.stopPropagation();handleCldDeleteFolder(fn);}} disabled={cldDeleting} style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,0.5)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",fontSize:9,color:"#F87171",lineHeight:1,opacity:cldDeleting?0.3:0.7}} title="Delete folder">✕</button>
          </div>;})}
        </div>}
        {!cldLoading&&cldImages.length>0&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:8,flexWrap:"wrap"}}>
            <div style={{fontSize:10,color:textS}}>{cldImages.length} images{cldPath.length>0?` · folder "${cldPath[cldPath.length-1]}"`:""}</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {/* Phase 3 — import a whole event folder: stamp the event name + auto-sort by zone from filename */}
              <button onClick={async ()=>{
                const eventName=(cldPath[cldPath.length-1]||"Event").toString();
                const zones=taxonomy.areasElements||[];
                const KW={stage:"Stage",entry:"Entry Passage",passage:"Entry Passage",vedi:"Vedi",mandap:"Vedi",lounge:"Centre Lounge","side lounge":"Side Lounge",photobooth:"Photobooth","photo booth":"Photobooth",centrepiece:"Centre Pieces","centre piece":"Centre Pieces","center piece":"Centre Pieces",prop:"Props",install:"Installations"};
                const detectZone=(f)=>{ const s=f.toLowerCase(); let z=zones.find(zn=>s.includes(zn.toLowerCase())); if(z)return z; for(const [k,zn] of Object.entries(KW)){ if(s.includes(k)&&zones.includes(zn))return zn; } return ""; };
                const existUrls=await checkExistingLibraryUrls(cldImages.map(img=>img.secure_url));
                const stamp=Date.now().toString(36);
                const newImgs=cldImages.filter(img=>!existUrls.has(img.secure_url)).map((img,ix)=>{
                  const fname=(img.public_id||"").split("/").pop().replace(/[-_]/g," ");
                  const zone=detectZone(fname);
                  return { id:"LIB"+stamp+ix.toString(36)+Math.random().toString(36).slice(2,4), url:img.secure_url, name:fname, tags:{eventType:[],venueType:[],venue:"",areasElements:zone?[zone]:[],colorPalette:[],categoryTier:[],designStyle:[],timeSetting:[]}, elements:[], addedAt:Date.now(), source:"folder-import", _event:eventName };
                });
                if(!newImgs.length){showMsg("All photos in this folder are already in the Library","orange");return;}
                saveLib(newImgs);
                const matching=newImgs.filter(i=>photoStatus(i)===libStatus);
                if(matching.length) libPage.prependItems(matching);
                const zoned=newImgs.filter(i=>(i.tags.areasElements||[]).length).length;
                showMsg(`✓ Imported ${newImgs.length} photos as event "${eventName}"${zoned?` · ${zoned} auto-sorted by zone`:""}. Now run "🤖 Tag all untagged".`,"green");
              }} disabled={cldPath.length===0} style={{...S.btn(true),fontSize:10,padding:"6px 12px",opacity:cldPath.length===0?0.4:1}}>📁 Import as event folder</button>
              <button onClick={async ()=>{
                const existUrls=await checkExistingLibraryUrls(cldImages.map(img=>img.secure_url));
                const stamp=Date.now().toString(36);
                const newImgs=cldImages.filter(img=>!existUrls.has(img.secure_url)).map((img,ix)=>({
                  id:"LIB"+stamp+ix.toString(36)+Math.random().toString(36).slice(2,4),
                  url:img.secure_url,
                  name:(img.public_id||"").split("/").pop().replace(/[-_]/g," "),
                  tags:{eventType:[],venueType:[],venue:"",areasElements:[],colorPalette:[],categoryTier:[],designStyle:[],timeSetting:[]},
                  elements:[],addedAt:Date.now(),source:"cloudinary"
                }));
                if(!newImgs.length){showMsg("All already in Library","orange");return;}
                saveLib(newImgs);
                const matching=newImgs.filter(i=>photoStatus(i)===libStatus);
                if(matching.length) libPage.prependItems(matching);
                showMsg(`✓ ${newImgs.length} photos added to Library — tag them now`,"green");
              }} style={{...S.btn(false),fontSize:10,padding:"6px 12px"}}>Add All ({cldImages.length})</button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:6,maxHeight:300,overflowY:"auto"}}>
            {cldImages.map(img=>{
              const imgUrl=img.secure_url;
              const alreadyAdded=libItems.some(l=>l.url===imgUrl);
              const isSelected=cldSelected.has(img.public_id);
              return <div key={img.public_id} style={{position:"relative",borderRadius:6,overflow:"hidden",border:isSelected?`2px solid #E11D48`:`1px solid ${border}`}}>
                <div onClick={async ()=>{
                  if(cldSelectMode){
                    const ns=new Set(cldSelected);
                    if(ns.has(img.public_id))ns.delete(img.public_id);else ns.add(img.public_id);
                    setCldSelected(ns);return;
                  }
                  // Authoritative check at click time — `alreadyAdded` (below) only reflects the lazy
                  // local cache and is a visual hint, not a guarantee, now that libItems isn't the whole table.
                  if((await checkExistingLibraryUrls([imgUrl])).has(imgUrl)){showMsg("Already in Library","orange");return;}
                  const libImg={id:"LIB"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),url:imgUrl,name:(img.public_id||"").split("/").pop().replace(/[-_]/g," "),tags:{eventType:[],venueType:[],venue:"",areasElements:[],colorPalette:[],categoryTier:[],designStyle:[],timeSetting:[]},elements:[],addedAt:Date.now(),source:"cloudinary"};
                  saveLib([libImg]);
                  if (photoStatus(libImg) === libStatus) libPage.prependItems([libImg]);
                  showMsg("✓ Added to Library — tap to tag it","green");
                }} style={{cursor:"pointer",opacity:alreadyAdded&&!cldSelectMode?0.5:1}}>
                  <img src={imgUrl} alt="" style={{width:"100%",height:70,objectFit:"cover",display:"block"}} loading="lazy" onError={e=>{e.target.style.display="none"}}/>
                  {cldSelectMode&&<div style={{position:"absolute",top:3,left:3,width:18,height:18,borderRadius:4,border:"2px solid #fff",background:isSelected?"#E11D48":"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {isSelected&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
                  </div>}
                  {!cldSelectMode&&alreadyAdded&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.4)"}}><span style={{color:"#fff",fontSize:14,fontWeight:700}}>✓</span></div>}
                </div>
                {!cldSelectMode&&<button onClick={async(e)=>{
                  e.stopPropagation();
                  if(!(await askConfirmAsync("Delete this photo?", { note: "Removed from Storage permanently. This can't be undone.", yesLabel: "Delete" }))) return;
                  try {
                    await deleteStorageObjects([img.public_id]);
                    setCldImages(prev=>prev.filter(p=>p.public_id!==img.public_id));
                    showMsg("✓ Deleted","green");
                  }catch(err){showMsg("Delete failed: "+err.message,"red");}
                }} style={{position:"absolute",top:2,right:2,background:"rgba(0,0,0,0.6)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",fontSize:10,color:"#F87171",lineHeight:1}}>✕</button>}
              </div>;
            })}
          </div>
        </>}
        {!cldLoading&&cldFolders.length===0&&cldImages.length===0&&cldPath.length>0&&<div style={{fontSize:11,color:textS,textAlign:"center",padding:16}}>Empty folder</div>}
      </div>}
      {/* Images / Videos toggle — with the search box on the same line, at the right end.
          alignItems:center so the field sits level with the tab pills rather than on the row's
          baseline, and flexWrap so a user whose permissions allow every tab doesn't get the field
          squeezed to nothing — it drops to its own line instead. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {libAllowed("images") && <button onClick={() => setLibView("images")} className="ml-tab" data-on={libView === "images" ? "1" : undefined} style={libTab(libView === "images")}><IconCamera size={14} />Images ({libPage.counts.verified + libPage.counts.review + libPage.counts.untagged})</button>}
        {libAllowed("videos") && <button onClick={() => { setLibView("videos"); if(!ytVideos.length) loadAllYT(); }} className="ml-tab" data-on={libView === "videos" ? "1" : undefined} style={libTab(libView === "videos")}><IconPlay size={14} />Videos ({allVideos.length})</button>}
        {libAllowed("corrections") && <button onClick={() => { setLibView("corrections"); refreshCorrLog?.(); }} className="ml-tab" data-on={libView === "corrections" ? "1" : undefined} style={libTab(libView === "corrections")}><IconClipboardCheck size={14} />Contributions ({new Set((corrLog || []).map(e => (e.user || "—") + "|" + (e.photoId || e.photoName || "") + "|" + (e.kind === "video" ? "video" : "photo"))).size})</button>}
        <button onClick={() => setLibView("palettes")} className="ml-tab" data-on={libView === "palettes" ? "1" : undefined} style={libTab(libView === "palettes")}><IconPalette size={14} />Palettes {paletteCatalogueLoaded ? `(${imsPaletteCatalogue.length})` : "(loading…)"}</button>
        {/* The search box for whichever view is showing, in the one position — right end of the tab
            row. Images and Videos each have their own search state and each searches something
            different, so this switches between them rather than being one shared field.
            Not rendered on Contributions or Palettes: neither has a search, and a box that takes
            typing and changes nothing is worse than no box.
            The spacer is what pushes it right; a max-width stops it running the full width of a wide
            monitor, where a 900px search field reads as the page's main event. */}
        {(libView === "images" || libView === "videos") && <>
          <div style={{ flex: 1, minWidth: 12 }} />
          {libView === "images"
            ? <input value={libSearch} onChange={e => setLibSearch(e.target.value)}
                placeholder="Search venue, event, style, element…"
                title="Searches the photo's tags as well as its name. Multiple words all have to match — “wedding gold” means both."
                style={{ ...S.input, fontSize: 12.5, flex: "1 1 240px", maxWidth: 420, minWidth: 160 }} />
            : <input value={ytSearch} onChange={e => setYtSearch(e.target.value)}
                placeholder="Search title, venue, event, style, colour…"
                title="Searches the video's tags as well as its title. Multiple words all have to match — “wedding gold” means both."
                style={{ ...S.input, fontSize: 12.5, flex: "1 1 240px", maxWidth: 420, minWidth: 160 }} />}
        </>}
      </div>
      {libView === "palettes" && !paletteCatalogueLoaded && (
        <div style={{ maxWidth: 650, padding: "24px 18px", textAlign: "center", color: textS, fontSize: 12 }}>Loading palette catalogue…</div>
      )}
      {/* The wrapper below has NO maxWidth. It was capped at 650 while the library tab runs to 1640,
          which is where all that empty right-hand side came from — the two catalogues were sitting in
          a third of the page. The colour chips wrap, so they fill whatever width they are given. */}
      {libView === "palettes" && paletteCatalogueLoaded && (
        <div>
          {/* 🎨 Colour Catalogue */}
          <div className="pal-card" style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: "14px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              {/* Same heading treatment as the Palette Catalogue below, so the two panels read as a
                  pair. maxWidth keeps the subline to a readable measure instead of letting it run
                  the full 1600px now that the page is no longer capped. */}
              <div style={{ maxWidth: 640 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: textP, letterSpacing: -0.2 }}>🎨 Colour Catalogue</div>
                <div style={{ fontSize: 11.5, color: textS, marginTop: 3, lineHeight: 1.5 }}>Master colours for the paint picker and inventory base colour. <strong style={{ color: accent, fontWeight: 700 }}>★</strong> marks a neutral, which shows in every palette.</div>
              </div>
              <button onClick={() => { const next = [...imsColourCatalogue, { name: "New Colour", hex: "#CCCCCC", isNeutral: false }]; setImsColourCatalogue(next); savePaletteData(next, null); }} className="pal-add" style={{ padding: "8px 16px", borderRadius: 9, border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add Colour</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {imsColourCatalogue.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: `1px solid ${c.isNeutral ? accent : border}`, background: c.isNeutral ? `${accent}08` : "transparent" }}>
                  <input type="color" value={c.hex || "#ccc"} onChange={e => { const next = [...imsColourCatalogue]; next[i] = { ...next[i], hex: e.target.value }; setImsColourCatalogue(next); savePaletteData(next, null); }} style={{ width: 20, height: 20, border: "none", cursor: "pointer", borderRadius: 4, padding: 0 }} />
                  <input type="text" value={c.name || ""} onChange={e => { const next = [...imsColourCatalogue]; next[i] = { ...next[i], name: e.target.value }; setImsColourCatalogue(next); }} onBlur={() => savePaletteData(null, null)} style={{ border: "none", background: "transparent", color: textP, fontSize: 12.5, fontWeight: 500, width: 104, outline: "none" }} />
                  <span onClick={() => { const next = [...imsColourCatalogue]; next[i] = { ...next[i], isNeutral: !next[i].isNeutral }; setImsColourCatalogue(next); savePaletteData(next, null); }} className="pal-star" style={{ fontSize: 13, cursor: "pointer", borderRadius: 4, padding: "0 2px", color: c.isNeutral ? accent : textS }} title="Toggle neutral">{c.isNeutral ? "★" : "☆"}</span>
                  {/* Confirm first. This was a one-click permanent delete on a master record: the
                      colour feeds the paint picker, the inventory base colour and the anchor list of
                      every palette, and it saves immediately with no undo. The count of palettes
                      using it is in the prompt, because that is the cost you cannot see from here. */}
                  <span onClick={async () => {
                    const used = imsPaletteCatalogue.filter(p => (p.anchorColours || []).includes(c.name)).length;
                    if (!(await askConfirmAsync(`Delete the colour "${c.name || "Untitled"}"?`, {
                      note: used > 0
                        ? `It is an anchor colour in ${used} palette${used === 1 ? "" : "s"} and will be removed from ${used === 1 ? "it" : "them"}. It also feeds the paint picker and inventory base colour. This cannot be undone.`
                        : "It feeds the paint picker and inventory base colour. This cannot be undone.",
                      yesLabel: "Delete",
                    }))) return;
                    const next = imsColourCatalogue.filter((_, j) => j !== i); setImsColourCatalogue(next); savePaletteData(next, null);
                  }} className="pal-del" style={{ fontSize: 11.5, cursor: "pointer", color: "#E11D48", fontWeight: 700, borderRadius: 4, padding: "0 3px" }}>×</span>
                </div>
              ))}
            </div>
          </div>
          {/* 🌈 Palette Catalogue */}
          <div className="pal-card" style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              {/* The per-card instruction moved up here. It was repeated verbatim inside every
                  palette — a 130-character sentence printed as many times as you have palettes, and
                  three times per row at this width. Said once under the heading it is the same
                  information taking a fraction of the page, and each card is left showing only what
                  differs between them, which is the whole point of a list of cards. */}
              <div style={{ maxWidth: 640 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: textP, letterSpacing: -0.2 }}>🌈 Palette Catalogue</div>
                <div style={{ fontSize: 11.5, color: textS, marginTop: 3, lineHeight: 1.5 }}>Named themes for salespeople to pick per function. Drives the Build screen colour picker and the library filter. Tap a colour to add it to a palette; <strong style={{ color: accent, fontWeight: 700 }}>★</strong> marks the primary colour — you can star more than one — which drives Build photo order.</div>
              </div>
              <button onClick={() => { const next = [...imsPaletteCatalogue, { name: "New Palette", anchorColours: [] }]; setImsPaletteCatalogue(next); savePaletteData(null, next); }} className="pal-add" style={{ padding: "8px 16px", borderRadius: 9, border: "none", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add Palette</button>
            </div>
            {/* Two to a row was the ask when this panel was capped at 650px wide. The cap is gone
                now, so a hard 2 would put the sparseness back — two 780px cards each holding a name
                field and a short chip strip. auto-fit with a 420px floor instead: three across on a
                wide monitor, two at laptop width, one on a narrow window. Never fewer than the two
                that were asked for, at any width where two would fit. */}
            <div className="pal-cols" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 10, alignItems: "start" }}>
            {imsPaletteCatalogue.map((p, pi) => (
              <div key={pi} className="pal-card" style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${border}`, background: isDark ? "rgba(255,255,255,0.02)" : "#FAFAF7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input type="text" value={p.name || ""} onChange={e => { const next = [...imsPaletteCatalogue]; next[pi] = { ...next[pi], name: e.target.value }; setImsPaletteCatalogue(next); }} onBlur={() => savePaletteData(null, null)} style={{ ...S.input, fontSize: 14.5, fontWeight: 600, padding: "5px 10px", flex: 1, marginBottom: 0 }} />
                  {/* Same for a whole palette — salespeople pick these per function on Build, so
                      deleting one takes away a choice from that screen and the library filter. */}
                  <span onClick={async () => {
                    if (!(await askConfirmAsync(`Delete the palette "${p.name || "Untitled"}"?`, {
                      note: "Salespeople pick this per function on the Build screen, and it drives the library colour filter. This cannot be undone.",
                      yesLabel: "Delete",
                    }))) return;
                    const next = imsPaletteCatalogue.filter((_, j) => j !== pi); setImsPaletteCatalogue(next); savePaletteData(null, next);
                  }} className="pal-del" style={{ fontSize: 13, cursor: "pointer", color: "#E11D48", fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>🗑</span>
                </div>
                {/* A short label now — the instruction it used to carry is stated once in the panel
                    header. Small-and-wide so it reads as a label introducing the chips rather than
                    as a line of prose competing with them. */}
                <div className="ml-cap" style={{ color: textS, marginBottom: 7, fontSize: 9.5, letterSpacing: 1.1 }}>Anchor colours</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {imsColourCatalogue.filter(c => !c.isNeutral).map(c => {
                    const isAnchor = (p.anchorColours || []).includes(c.name);
                    const primaries = Array.isArray(p.primaryColours) ? p.primaryColours : (p.primaryColour ? [p.primaryColour] : []);
                    const isPrimary = primaries.includes(c.name);
                    const toggleAnchor = () => {
                      const anchors = p.anchorColours || [];
                      const nextA = isAnchor ? anchors.filter(a => a !== c.name) : [...anchors, c.name];
                      const next = [...imsPaletteCatalogue];
                      next[pi] = { ...next[pi], anchorColours: nextA, primaryColours: isAnchor ? primaries.filter(x => x !== c.name) : primaries };
                      delete next[pi].primaryColour;
                      setImsPaletteCatalogue(next); savePaletteData(null, next);
                    };
                    const setPrimary = (e) => {
                      e.stopPropagation();
                      const nextP = isPrimary ? primaries.filter(x => x !== c.name) : [...primaries, c.name];
                      const next = [...imsPaletteCatalogue];
                      next[pi] = { ...next[pi], primaryColours: nextP };
                      delete next[pi].primaryColour;
                      if (!isPrimary && !isAnchor) next[pi].anchorColours = [...(p.anchorColours || []), c.name];
                      setImsPaletteCatalogue(next); savePaletteData(null, next);
                    };
                    return <span key={c.name} style={{ padding: "3px 8px", fontSize: 11.5, borderRadius: 6, display: "flex", alignItems: "center", gap: 4, border: `1px solid ${isPrimary ? "#C9A96E" : isAnchor ? accent : border}`, background: isPrimary ? "rgba(201,169,110,0.18)" : isAnchor ? `${accent}18` : "transparent", color: isPrimary ? "#C9A96E" : isAnchor ? accent : textS }}>
                      <span className="pal-anchor" onClick={toggleAnchor} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", borderRadius: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: c.hex || "#ccc", display: "inline-block", border: "1px solid rgba(0,0,0,0.1)" }} />
                        {c.name}
                      </span>
                      {isAnchor && <span onClick={setPrimary} title={isPrimary ? "Primary colour (tap to unset)" : "Mark as primary"} style={{ cursor: "pointer", fontSize: 12.5, color: isPrimary ? "#C9A96E" : textS }}>{isPrimary ? "★" : "☆"}</span>}
                    </span>;
                  })}
                </div>
              </div>
            ))}
            </div>
          </div>
        </div>
      )}
      {/* Content */}
      {libView === "corrections" && CorrectionsPanel()}
      {libView === "images" && LibraryBrowse()}
      {libView === "videos" && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 18, minHeight: "70vh" }}>
        {vidRail()}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Add Video and Refresh YT moved into the foot of the filter rail — see vidRail. The row
              that held them (and, before that, the search) is gone entirely rather than left as an
              empty flex container taking up 10px of margin. */}
          {/* ── Status "folders" + bulk video AI tag (mirrors the Images tab) ── */}
          {(() => {
            const vis = allVideos.filter(v => !hiddenVideos[v.id]);
            const cnt = (k) => k === "all" ? vis.length : vis.filter(v => videoStatus(v) === k).length;
            const untaggedN = cnt("untagged");
            const noVenueN = vis.filter(v => !ytVideoTags[v.id]?.venue).length;
            return (
              <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {[
                  ["all", "📁", "All", "everything", cnt("all"), accent],
                  ["verified", "✅", "Verified", "reviewed by a person", cnt("verified"), "#059669"],
                  ["review", "🤖", "Needs review", "AI-tagged — to check", cnt("review"), "#7C3AED"],
                  ["untagged", "❓", "Untagged", "no tags yet", untaggedN, "#9CA3AF"],
                ].map(([k, icon, label, sub, count, col]) => {
                  const on = ytFilterLinked === k;
                  // ml-tile only when NOT selected — same rule the Images status cards follow: the
                  // chosen one keeps its own tinted border and fill, and glassing it would take away
                  // the only thing saying which is active.
                  return <div key={k} className={on ? undefined : "ml-tile"} onClick={() => setYtFilterLinked(k)} title={sub} style={{ cursor: "pointer", minWidth: 104, padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${on ? col : "transparent"}`, background: on ? `${col}14` : undefined, display: "flex", flexDirection: "column", gap: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: on ? col : textS }}>{icon} {label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}><span style={{ fontSize: 17, fontWeight: 800, color: on ? col : textP }}>{count}</span><span style={{ fontSize: 8, color: textS }}>{sub}</span></div>
                  </div>;
                })}
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "center" }}>
                  {bulkVid?.running ? (
                    <span style={{ fontSize: 10, color: textS }}>🎬 Tagging {bulkVid.done}/{bulkVid.total} · {bulkVid.ok}✓ {bulkVid.fail}✕</span>
                  ) : untaggedN > 0 ? (
                    <button onClick={() => askConfirm(`Tag ${untaggedN} untagged video${untaggedN === 1 ? "" : "s"} from their descriptions?`, () => runBulkTagVideos?.(), { note: "Runs in the background — keep working, progress shows in the corner. Each description is parsed for venue, event, tier and so on, and gets best-match zone photos. The team reviews and verifies after; tagged videos appear on Browse.", yesLabel: "Start tagging" })} style={{ ...S.btn(true), fontSize: 10, padding: "6px 14px", background: "#0EA5E9" }}>🎬 Tag all untagged ({untaggedN})</button>
                  ) : null}
                  {bulkVidVenue?.running ? (
                    <span style={{ fontSize: 10, color: textS }}>🗺 Venue {bulkVidVenue.done}/{bulkVidVenue.total} · {bulkVidVenue.ok}✓ {bulkVidVenue.skip}– {bulkVidVenue.fail}✕</span>
                  ) : noVenueN > 0 ? (
                    <button onClick={() => askConfirm(`Backfill the venue on ${noVenueN} video${noVenueN === 1 ? "" : "s"}?`, () => runBulkTagVideoVenues?.(), { note: "Reads each description's \u201CVenue:\u201D line and matches it to your Inhouse/Outside list. Anything matching nothing known is filed under Outside \u2192 Non-empanelled. Videos that already have a venue, including a manual fix, are left untouched. Runs in the background.", yesLabel: "Backfill" })} style={{ ...S.btn(false), fontSize: 10, padding: "6px 14px", color: "#0EA5E9", border: "1px solid #0EA5E9" }}>🗺 Backfill venue ({noVenueN})</button>
                  ) : null}
                  {/* Reset every "Needs review" video back to Untagged (wipes its tags entirely) so a
                      full re-tag from description — now including venue — starts clean instead of
                      merging over stale AI tags from before venue-extraction existed. */}
                  {cnt("review") > 0 && (
                    <button onClick={async () => {
                      const ids = vis.filter(v => videoStatus(v) === "review").map(v => v.id);
                      if (!(await askConfirmAsync(`Clear tags on ${ids.length} video${ids.length === 1 ? "" : "s"} and move ${ids.length === 1 ? "it" : "them"} back to Untagged?`, {
                        note: "Wipes their venue, event, tier, style and colour tags entirely so you can re-tag them fresh. This can't be undone.",
                        yesLabel: "Clear tags",
                      }))) return;
                      const patch = {};
                      ids.forEach(id => { patch[id] = null; });
                      // Logged as a bulk action as well as per-video: one click, N videos wiped, and
                      // the count is what you want when working out where tags went.
                      saveYtTags(patch).then((res) => logBulk(authUser, "video.reset-tags", ids.length, res, { ids: ids.slice(0, 50) }));
                      showMsg(`Cleared tags on ${ids.length} video${ids.length === 1 ? "" : "s"} — moved to Untagged`, "green");
                    }} style={{ ...S.btn(false), fontSize: 10, padding: "6px 14px", color: "#E11D48", border: "1px solid #E11D48" }}>🗑 Reset Needs-review → Untagged ({cnt("review")})</button>
                  )}
                </div>
              </div>
            );
          })()}
          {/* Add Video Panel (Cloudinary Video Browser) */}
          {addVideoOpen&&<div style={{border:`1px solid ${accent}`,borderRadius:12,padding:14,marginBottom:12,background:isDark?"rgba(201,169,110,0.04)":"rgba(201,169,110,0.06)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:accent}}>📂 Add Video from Storage</div>
              <span onClick={()=>setAddVideoOpen(false)} style={{fontSize:11,cursor:"pointer",color:"#E11D48",fontWeight:700}}>✕ Close</span>
            </div>
            {/* Breadcrumb */}
            <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
              <span onClick={()=>cldVideoGoBack(0)} style={{fontSize:10,color:accent,cursor:"pointer",fontWeight:600}}>Root</span>
              {cldVideoPath.map((seg,si)=><Fragment key={si}>
                <span style={{fontSize:10,color:textS}}>/</span>
                <span onClick={()=>cldVideoGoBack(si+1)} style={{fontSize:10,color:si===cldVideoPath.length-1?textP:accent,cursor:"pointer",fontWeight:600}}>{seg}</span>
              </Fragment>)}
            </div>
            {cldVideoLoading&&<div style={{textAlign:"center",padding:20,color:textS,fontSize:11}}>⏳ Loading...</div>}
            {/* Folders */}
            {!cldVideoLoading&&cldVideoFolders.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:10}}>
              {cldVideoFolders.map(f=><div key={f.name||f.path} onClick={()=>cldVideoNavigate(f.name||f.path)} style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${border}`,cursor:"pointer",textAlign:"center",fontSize:11,fontWeight:600,color:textP,background:isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.02)"}}>
                📁 {f.name||f.path}
              </div>)}
            </div>}
            {/* Video files */}
            {!cldVideoLoading&&cldVideoList.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
              {cldVideoList.map(res=>{
                const fileName=(res.public_id||"").split("/").pop().replace(/[-_]/g," ");
                const alreadyAdded=manualVideos.some(m=>m.videoUrl===res.secure_url);
                return <div key={res.public_id} style={{borderRadius:8,border:`1px solid ${border}`,overflow:"hidden",opacity:alreadyAdded?0.4:1}}>
                  {/* Storage has no server-side video thumbnailing the way Cloudinary did, so the
                      tile is the video itself seeked to its first frame — preload="metadata" keeps
                      that to a range request rather than pulling the whole file. */}
                  <video src={res.secure_url+"#t=0.1"} preload="metadata" muted playsInline style={{width:"100%",height:100,objectFit:"cover",display:"block",background:isDark?"#1a1a2e":"#f0f0f0"}}/>
                  <div style={{padding:"6px 8px"}}>
                    <div style={{fontSize:10,fontWeight:600,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{fileName}</div>
                    {alreadyAdded?<div style={{fontSize:9,color:"#059669",fontWeight:600}}>✓ Added</div>:
                    <button onClick={()=>addCldVideo(res)} style={{...S.btn(true),fontSize:9,padding:"4px 10px",width:"100%"}}>+ Add to App</button>}
                  </div>
                </div>;
              })}
            </div>}
            {!cldVideoLoading&&cldVideoFolders.length===0&&cldVideoList.length===0&&cldVideoPath.length>0&&<div style={{fontSize:11,color:textS,textAlign:"center",padding:16}}>No video files in this folder</div>}
            <div style={{fontSize:9,color:textS,marginTop:8}}>Upload videos to any Storage folder first, then browse them here. Supports mp4, mov, webm.</div>
          </div>}
          {/* The seven <select>s that used to sit here are gone — they are now the same rail the
              Images view has, mounted to the left of this column. See vidRail() above. All that is
              left inline is the tally, which is a readout, not a filter. */}
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,color:textS,marginLeft:"auto"}}>{Object.keys(ytVideoTags).length} tagged · {Object.keys(hiddenVideos).length} hidden · {allVideos.length} total</span>
          </div>
          {/* Picker banner */}
          {ytPicker&&<div style={{padding:"10px 16px",background:"rgba(14,165,233,0.12)",borderRadius:10,border:"1px solid rgba(14,165,233,0.3)",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><span style={{fontWeight:600,color:"#0EA5E9",fontSize:12}}>🔗 Linking video to:</span> <span style={{fontSize:12,fontWeight:700}}>{events.find(e=>e.id===ytPicker)?.name||"Event"}</span></div>
            <button onClick={()=>setYtPicker(null)} style={{...S.btn(false),fontSize:10,padding:"4px 10px"}}>Cancel</button>
          </div>}
          {ytLoading&&<div style={{textAlign:"center",padding:40,color:textS}}>⏳ Loading videos from YouTube...</div>}
          {!ytLoading&&allVideos.length===0&&<div style={{textAlign:"center",padding:40,color:textS}}>No videos found. Hit Refresh to load from YouTube, or Add Video from Storage.</div>}
          {/* Video grid, paged. The filter + sort is unchanged and still decides the whole set; the
              only new step is slicing one page out of it before rendering. */}
          {(() => {
            const vidFiltered = allVideos.filter(v=>{
              // The video open in an editor always stays on screen — tagging it would otherwise
              // push it out of the current folder (e.g. Untagged) and yank the card out from under you.
              if(v.id===editingVid) return true;
              // Hidden filter
              const isHid = !!hiddenVideos[v.id];
              if(ytFilterLinked==="hidden") return isHid;
              if(isHid && !showHidden) return false;
              if(ytFilterPL!=="all"&&v.playlistId!==ytFilterPL) return false;
              // ── SEARCH ACROSS THE TAGS, NOT JUST THE TITLE ──
              // Every field the filter rail offers is searchable here too, so typing "exotica" or
              // "sangeet" finds what picking it from the rail would. Matches the Images search, which
              // does the same thing against the photo tags (SEARCH_TAG_KEYS in libraryQueries.js) —
              // except that one has to ask Postgres and this list is already in memory.
              // Each WORD must match somewhere; within a word, any field will do. So "wedding gold"
              // means both, which is the point — those two words live in different tag fields and no
              // single string contains them together.
              // Reads ytVideoTags directly rather than the `tag` const, which is declared further down
              // this predicate — referencing it here would be a temporal dead zone, i.e. a runtime
              // ReferenceError that the build does not catch.
              if(ytSearch.trim()){
                const st=ytVideoTags[v.id];
                // The six the rail filters on — venue, event, tier, in/out, style, colour — plus
                // palette and time/setting, which the tag carries but the rail has no section for.
                // Including them costs nothing and means a word the video genuinely IS tagged with
                // never comes back empty. venue_custom needs no entry: it maps to a boolean flag and
                // the name itself is always in `venue` (rowToVideoTag).
                const hay=[v.title,st?.venue,st?.tier,st?.io,st?.palette,st?.timeSetting,
                  ...(Array.isArray(st?.fn)?st.fn:[st?.fn]),
                  ...(st?.styles||[]),...(st?.colors||[])].filter(Boolean).join(" ").toLowerCase();
                if(!ytSearch.toLowerCase().trim().split(/\s+/).every(w=>hay.includes(w))) return false;
              }
              // Already-tagged videos from this session keep their spot at the top instead of
              // vanishing out of the folder they no longer belong to (e.g. Untagged). Search and
              // the hidden filter above still apply — this only exempts the folder/tag filters.
              if(recentVids.includes(v.id)) return true;
              const tag=ytVideoTags[v.id];
              // Selecting a property (e.g. "Restro") also matches any of its own rooms, plus any
              // video tagged ambiguously at just the property level — same rollup as Browse.
              if(ytFilterVenue!=="all"){
                const okVenues=new Set([ytFilterVenue,...(subVenuesOfParent[ytFilterVenue]||[])]);
                if(!tag?.venue||!okVenues.has(tag.venue)) return false;
              }
              if(ytFilterFn!=="all"&&!(tag?.fn||[]).includes?.(ytFilterFn)&&tag?.fn!==ytFilterFn) return false;
              if(ytFilterTier!=="all"&&tag?.tier!==ytFilterTier) return false;
              if(ytFilterIO!=="all"&&tag?.io!==ytFilterIO) return false;
              if(ytFilterStyle!=="all"&&!(tag?.styles||[]).includes(ytFilterStyle)) return false;
              if(ytFilterColor!=="all"&&!(tag?.colors||[]).includes(ytFilterColor)) return false;
              if(ytFilterLinked==="tagged"&&videoStatus(v)==="untagged") return false;
              if(ytFilterLinked==="untagged"&&videoStatus(v)!=="untagged") return false;
              if(ytFilterLinked==="verified"&&videoStatus(v)!=="verified") return false;
              if(ytFilterLinked==="review"&&videoStatus(v)!=="review") return false;
              if(ytFilterLinked==="linked"&&!(tag?.linkedEvents?.length>0)) return false;
              return true;
            }).sort((a,b)=>vidRank(a.id)-vidRank(b.id));
            const vidPages = Math.max(1, Math.ceil(vidFiltered.length / LIBRARY_PAGE_SIZE));
            // Clamped on read, not just reset in the effect: a filter can shrink the set between the
            // state update and this render, and a page index past the end would render an empty grid
            // with no way to tell it apart from "nothing matches".
            const vp = Math.min(vidPage, vidPages - 1);
            const vidShown = vidFiltered.slice(vp * LIBRARY_PAGE_SIZE, vp * LIBRARY_PAGE_SIZE + LIBRARY_PAGE_SIZE);
            return <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
            {vidShown.map(v=>{
              const savedTag=ytVideoTags[v.id]||{};
              const hasDraft=aiVideoDraft&&aiVideoDraft.videoId===v.id;
              const tag=hasDraft?aiVideoDraft.tags:savedTag;
              const isEditing=ytTagEdit===v.id;
              const rank=vidRank(v.id); // 0 = most recently tagged, 1e9 = not touched this session
              const linkedEvts=(savedTag.linkedEvents||[]).map(eid=>events.find(e=>e.id===eid)).filter(Boolean);
              const hasTag=savedTag.venue||savedTag.fn||(savedTag.styles||[]).length||savedTag.tier||savedTag.io||(savedTag.colors||[]).length;
              // ml-tile (glass + hover lift) only on the plain cards. A card that is being edited or
              // is rank-highlighted carries an accent border that says so, and the glass would
              // overwrite the fill that border is sitting on — the same exception the Images grid
              // and both status rows make.
              return(
              <div key={v.id} className={(isEditing||rank<1e9)?undefined:"ml-tile"} style={{...S.card,overflow:"hidden",border:(isEditing||rank===0)?`2px solid ${accent}`:rank<1e9?`1px solid ${accent}66`:"1px solid transparent",transition:"border 0.2s"}}>
                {/* Thumbnail */}
                <div style={{position:"relative",cursor:"pointer"}} onClick={()=>{
                  if(ytPicker){
                    const idx=events.findIndex(e=>e.id===ytPicker);
                    if(idx>=0){
                      const upd=[...events];upd[idx]={...upd[idx],video:`https://www.youtube.com/embed/${v.id}`};save(upd);
                      saveYtTags({[v.id]:t=>({...t,linkedEvents:[...new Set([...(t.linkedEvents||[]),ytPicker])]})});
                      setYtPicker(null);
                    }
                  } else {
                    logVideoOpen(authUser, v);
                    setBigTagVid(v.id); // open the full-screen editor (play + tag + hide)
                  }
                }}>
                  {/* Storage-hosted videos have no poster image — Storage can't render a frame the
                      way Cloudinary's so_0 transform did — so the first frame of the file stands in. */}
                  {v.thumb
                    ? <img src={v.thumb} alt={v.title} loading="lazy" style={{width:"100%",height:140,objectFit:"cover",display:"block"}} onError={e=>{e.target.style.display="none"}}/>
                    : <video src={v.videoUrl?v.videoUrl+"#t=0.1":undefined} preload="metadata" muted playsInline style={{width:"100%",height:140,objectFit:"cover",display:"block",background:"#000"}}/>}
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:44,height:32,borderRadius:8,background:"rgba(255,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:0,height:0,borderLeft:"12px solid #fff",borderTop:"7px solid transparent",borderBottom:"7px solid transparent",marginLeft:2}}/></div>
                  </div>
                  {v.duration&&<div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.8)",color:"#fff",fontSize:9,padding:"2px 5px",borderRadius:4,fontWeight:600}}>{v.duration}</div>}
                  {/* NEW badge */}
                  {(v.addedAt||0)>lastVisitTs&&lastVisitTs>0&&<div style={{position:"absolute",bottom:4,left:4,background:"rgba(239,68,68,0.95)",color:"#fff",fontSize:8,padding:"2px 6px",borderRadius:4,fontWeight:800,letterSpacing:0.5}}>NEW</div>}
                  {/* Source badge */}
                  {v.source==="cloudinary"&&<div style={{position:"absolute",bottom:4,left:v.addedAt>lastVisitTs&&lastVisitTs>0?40:4,background:"rgba(99,102,241,0.9)",color:"#fff",fontSize:8,padding:"2px 6px",borderRadius:4,fontWeight:700}}>☁️ CLD</div>}
                  {/* Hidden overlay */}
                  {!!hiddenVideos[v.id]&&<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontSize:12,fontWeight:700}}>👁‍🗨 Hidden</span></div>}
                  {/* Tag badges on thumbnail */}
                  <div style={{position:"absolute",top:4,left:4,display:"flex",gap:3,flexWrap:"wrap",maxWidth:"80%"}}>
                    {tag.venue&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:"rgba(14,165,233,0.9)",color:"#fff",fontWeight:700}}>{tag.venue}</span>}
                    {tag.fn&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:"rgba(168,85,247,0.9)",color:"#fff",fontWeight:700}}>{typeof tag.fn==="string"?tag.fn:(tag.fn||[]).join(", ")}</span>}
                    {tag.tier&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:tag.tier==="Gold"?"rgba(245,158,11,0.9)":"rgba(148,163,184,0.9)",color:"#fff",fontWeight:700}}>{tag.tier}</span>}
                    {tag.io&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:"rgba(16,185,129,0.9)",color:"#fff",fontWeight:700}}>{venueTypeLabel(tag.io)}</span>}
                    {(tag.styles||[]).length>0&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:"rgba(236,72,153,0.9)",color:"#fff",fontWeight:700}}>{tag.styles[0]}{tag.styles.length>1?` +${tag.styles.length-1}`:""}</span>}
                    {(tag.colors||[]).length>0&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:"rgba(249,115,22,0.9)",color:"#fff",fontWeight:700}}>{tag.colors[0]}{tag.colors.length>1?` +${tag.colors.length-1}`:""}</span>}
                  </div>
                  {linkedEvts.length>0&&<div style={{position:"absolute",top:4,right:4,background:"rgba(5,150,105,0.9)",color:"#fff",fontSize:8,padding:"2px 6px",borderRadius:4,fontWeight:700}}>🔗 {linkedEvts.length}</div>}
                  {getPhotos(tag).length>0&&!linkedEvts.length&&<div style={{position:"absolute",top:4,right:4,background:"rgba(14,165,233,0.9)",color:"#fff",fontSize:8,padding:"2px 6px",borderRadius:4,fontWeight:700}}>📸 {getPhotos(tag).length}</div>}
                  {getPhotos(tag).length>0&&linkedEvts.length>0&&<div style={{position:"absolute",top:22,right:4,background:"rgba(14,165,233,0.9)",color:"#fff",fontSize:8,padding:"2px 6px",borderRadius:4,fontWeight:700}}>📸 {getPhotos(tag).length}</div>}
                </div>
                {/* Title + date */}
                <div style={{padding:"8px 10px"}}>
                  <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",lineHeight:1.4,color:textP}}>{v.title}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4,gap:6}}>
                    <div style={{fontSize:9,color:textS}}>{v.date}</div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      {rank<1e9&&<span title={editingVid===v.id?"Open in the tag editor — held at the top of the grid":`Tagged this session — ${rank===0?"the latest one":`${rank} video${rank===1?"":"s"} ago`}. Kept near the top so you can go back to it.`} style={{fontSize:9,color:accent,fontWeight:700,whiteSpace:"nowrap"}}>{editingVid===v.id?"★ Tagging":rank===0?"★ Just tagged":`★ #${rank+1}`}</span>}
                      {!hasTag&&<span style={{fontSize:9,color:"#F59E0B",fontWeight:600}}>Untagged</span>}
                      {hiddenVideos[v.id]&&<span style={{fontSize:9,color:textS,fontWeight:600}}>🙈 Hidden</span>}
                      <button onClick={(e)=>{e.stopPropagation();logVideoOpen(authUser, v);setBigTagVid(v.id);}} title="Open the full-screen editor — play, tag, pick zone photos, hide" style={{padding:"2px 8px",borderRadius:6,border:`1px solid ${accent}`,background:`${accent}12`,color:accent,fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🖥 Open editor</button>
                    </div>
                  </div>
                </div>
                {/* Expanded tag editor */}
                {isEditing&&<div style={{padding:"10px 12px",borderTop:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"rgba(0,0,0,0.01)"}}>
                  {/* Playable video — admin watches here before tagging (Fix 4). Cloudinary uses <video>, YouTube uses LazyYT/iframe. */}
                  <div onClick={e=>e.stopPropagation()} style={{marginBottom:10,borderRadius:8,overflow:"hidden",background:"#000",aspectRatio:"16/9"}}>
                    {v.source==="cloudinary"&&v.videoUrl
                      ? <video src={v.videoUrl} poster={v.thumb} controls preload="none" style={{width:"100%",height:"100%",objectFit:"contain",background:"#000"}}/>
                      : <LazyYT src={`https://www.youtube.com/embed/${v.id}`} poster={v.thumb} title={v.title}/>}
                  </div>
                  {/* AI Draft banner */}
                  {hasDraft&&<div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 12px",marginBottom:10,borderRadius:8,background:"rgba(201,169,110,0.12)",border:`1px solid ${accent}40`}}>
                    <span style={{fontSize:11,color:accent,fontWeight:600,flex:1}}>📋 Parsed from description — review & save</span>
                    <button onClick={()=>{saveYtTags({[v.id]:{...aiVideoDraft.tags,_aiTagged:true,_savedBy:authUser?.name||"—",_savedAt:Date.now()}});setAiVideoDraft(null);showMsg("✓ AI tags saved — video now live on Browse","green");}} style={{padding:"4px 12px",borderRadius:6,border:"none",background:accent,color:"#1a1a2e",fontSize:10,fontWeight:600,cursor:"pointer"}}>✓ Save</button>
                    <button onClick={()=>{setAiVideoDraft(null);setYtTagEdit(null);}} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:10,fontWeight:500,cursor:"pointer"}}>✕ Discard</button>
                  </div>}
                  {/* Row 1: Venue (2-level chip picker — mirrors Browse page pattern) */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Venue</div>
                    {(() => {
                      const curVenue = tag.venue || "";
                      const isInhouse = curVenue && allInhouseVenueOrParentNames.includes(curVenue);
                      // Auto-sync group when venue is already set
                      const activeGroup = tagVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                      const setVidVenue = (val) => {
                        const setVenue = (t) => ({ ...t, venue: val || undefined, venueCustom: undefined });
                        if (hasDraft) { setAiVideoDraft(p => ({ ...p, tags: setVenue(p.tags || {}) })); } else { saveYtTags({ [v.id]: setVenue }); }
                      };
                      const outsideFiltered = customOutdoor.filter(o => tagOutsideSub === "empanelled" ? o.empanelled : tagOutsideSub === "other" ? !o.empanelled : true);
                      return <>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          <div onClick={()=>{setTagVenueGroup("inhouse");setTagOutsideSub("all");}} style={S.pill(activeGroup==="inhouse")}>Inhouse</div>
                          <div onClick={()=>{setTagVenueGroup("outside");setTagOutsideSub("all");}} style={S.pill(activeGroup==="outside")}>Outside</div>
                          {curVenue&&<div onClick={()=>{setVidVenue("");setTagVenueGroup("");}} style={{padding:"4px 8px",borderRadius:12,fontSize:9,cursor:"pointer",color:textS,border:`1px dashed ${border}`}}>✕ {curVenue}</div>}
                        </div>
                        {/* Sub-venues only — property/group names are excluded, they aren't a
                            specific bookable room. */}
                        {activeGroup==="inhouse"&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                          {leafInhouseVenues.map(vn=>{const on=curVenue===vn;return <div key={vn} onClick={()=>setVidVenue(on?"":vn)} style={{...S.pill(on),background:on?`${accent}22`:"transparent",color:on?accentText:textS,border:on?`1px solid ${accent}55`:`1px solid ${border}`,fontSize:10,padding:"4px 10px"}}>{vn}</div>;})}
                        </div>}
                        {activeGroup==="outside"&&<>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                            <div onClick={()=>{setTagOutsideSub("all");}} style={{...S.pill(tagOutsideSub==="all"),fontSize:10,padding:"4px 10px"}}>All</div>
                            <div onClick={()=>{setTagOutsideSub("empanelled");}} style={{...S.pill(tagOutsideSub==="empanelled"),fontSize:10,padding:"4px 10px"}}>Empanelled</div>
                            <div onClick={()=>{setTagOutsideSub("other");}} style={{...S.pill(tagOutsideSub==="other"),fontSize:10,padding:"4px 10px"}}>Other</div>
                          </div>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                            {outsideFiltered.map(o=>{const on=curVenue===o.name;return <div key={o.name} onClick={()=>setVidVenue(on?"":o.name)} style={{...S.pill(on),background:on?`${accent}22`:"transparent",color:on?accentText:textS,border:on?`1px solid ${accent}55`:`1px solid ${border}`,fontSize:9,padding:"3px 8px"}}>{o.name}{o.empanelled?" ★":""}</div>;})}
                          </div>
                        </>}
                      </>;
                    })()}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Tier</div>
                      <select value={tag.tier||""} onChange={e=>{const val=e.target.value||undefined;const set=t=>({...t,tier:val});if(hasDraft){setAiVideoDraft(p=>({...p,tags:set(p.tags||{})}));}else{saveYtTags({[v.id]:set});}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
                        <option value="">—</option>
                        {taxOr(taxonomy.tier, CATEGORIES).map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Indoor / Outdoor</div>
                      <select value={tag.io||""} onChange={e=>{const val=e.target.value||undefined;const set=t=>({...t,io:val});if(hasDraft){setAiVideoDraft(p=>({...p,tags:set(p.tags||{})}));}else{saveYtTags({[v.id]:set});}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
                        <option value="">—</option>
                        {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(v=><option key={v} value={v}>{venueTypeLabel(v)}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Time / Setting</div>
                      <select value={tag.timeSetting||""} onChange={e=>{const val=e.target.value||undefined;const set=t=>({...t,timeSetting:val});if(hasDraft){setAiVideoDraft(p=>({...p,tags:set(p.tags||{})}));}else{saveYtTags({[v.id]:set});}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
                        <option value="">—</option>
                        {taxOr(taxonomy.timeSetting, ["Day","Night","Twilight"]).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    {/* §23 Phase 2.9c — palette per video (drives Build screen paint picker grouping) */}
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>🎨 Palette</div>
                      <select value={tag.palette||""} onChange={e=>{const val=e.target.value||undefined;const set=t=>({...t,palette:val});if(hasDraft){setAiVideoDraft(p=>({...p,tags:set(p.tags||{})}));}else{saveYtTags({[v.id]:set});}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
                        <option value="">—</option>
                        {(imsPaletteCatalogue.length>0?imsPaletteCatalogue:[{name:"Custom"}]).map(p=><option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                  {/* Row 2: Event type — multi-select chips */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:textS,marginBottom:4,fontWeight:600}}>Event type <span style={{fontWeight:400,opacity:0.7}}>(tap to toggle)</span></div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {taxOr(taxonomy.eventType, FUNCTIONS).map(f=>{
                        const sel=(tag.fn||[]).includes?.(f)||(typeof tag.fn==="string"&&tag.fn===f);
                        // Toggle off the LATEST tag, never this render's `tag` — a save is a network
                        // round-trip, so consecutive quick taps would otherwise all rebuild the array
                        // from the same pre-burst snapshot and keep only the last one.
                        const toggleFn=(t)=>{
                          const cur=Array.isArray(t.fn)?t.fn:(t.fn?[t.fn]:[]);
                          const next=cur.includes(f)?cur.filter(x=>x!==f):[...cur,f];
                          return {...t,fn:next.length?next:undefined};
                        };
                        return <span key={f} onClick={()=>{
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:toggleFn(p.tags||{})}));}else{saveYtTags({[v.id]:toggleFn});}
                        }} style={{fontSize:9,padding:"3px 8px",borderRadius:6,cursor:"pointer",fontWeight:600,
                          background:sel?"rgba(168,85,247,0.2)":"transparent",
                          border:`1px solid ${sel?"rgba(168,85,247,0.5)":border}`,
                          color:sel?"#A855F7":textS}}>{f}</span>;
                      })}
                    </div>
                  </div>
                  {/* Row 3: Style — multi-select chips */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:textS,marginBottom:4,fontWeight:600}}>Design Style <span style={{fontWeight:400,opacity:0.7}}>(tap to toggle)</span></div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]).map(s=>{
                        const sel=(tag.styles||[]).includes(s);
                        const toggleStyle=(t)=>{
                          const cur=t.styles||[];
                          const next=cur.includes(s)?cur.filter(x=>x!==s):[...cur,s];
                          return {...t,styles:next.length?next:undefined};
                        };
                        return <span key={s} onClick={()=>{
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:toggleStyle(p.tags||{})}));}else{saveYtTags({[v.id]:toggleStyle});}
                        }} style={{fontSize:9,padding:"3px 8px",borderRadius:6,cursor:"pointer",fontWeight:600,
                          background:sel?"rgba(236,72,153,0.2)":"transparent",
                          border:`1px solid ${sel?"rgba(236,72,153,0.5)":border}`,
                          color:sel?"#EC4899":textS}}>{s}</span>;
                      })}
                    </div>
                  </div>
                  {/* Row 4: Color Palette — multi-select chips */}
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:9,color:textS,marginBottom:4,fontWeight:600}}>Color Palette <span style={{fontWeight:400,opacity:0.7}}>(tap to toggle)</span></div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"])).map(c=>{
                        const sel=(tag.colors||[]).includes(c);
                        const toggleColor=(t)=>{
                          const cur=t.colors||[];
                          const next=cur.includes(c)?cur.filter(x=>x!==c):[...cur,c];
                          return {...t,colors:next.length?next:undefined};
                        };
                        return <span key={c} onClick={()=>{
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:toggleColor(p.tags||{})}));}else{saveYtTags({[v.id]:toggleColor});}
                        }} style={{fontSize:9,padding:"3px 8px",borderRadius:6,cursor:"pointer",fontWeight:600,
                          background:sel?"rgba(249,115,22,0.2)":"transparent",
                          border:`1px solid ${sel?"rgba(249,115,22,0.5)":border}`,
                          color:sel?"#F97316":textS}}>{c}</span>;
                      })}
                      <PaletteQuickAdd dense accent={accent} border={border} textS={textS}
                        onAdd={(name)=>{
                          const added=addPaletteInline(name,imsPaletteCatalogue,setImsPaletteCatalogue,savePaletteData);
                          if(!added)return;
                          const addColor=(t)=>{ const cur=t.colors||[]; return cur.includes(added)?t:{...t,colors:[...cur,added]}; };
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:addColor(p.tags||{})}));}else{saveYtTags({[v.id]:addColor});}
                        }} />
                    </div>
                  </div>
                  {/* Quick actions */}
                  <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                    {/* Patch, not the whole map — see saveHiddenVideos. */}
                    <button onClick={(e)=>{e.stopPropagation();const nowHidden=!hiddenVideos[v.id];saveHiddenVideos({[v.id]:nowHidden?true:null});showMsg(nowHidden?"Video hidden":"Video visible","green");}} style={{...S.btn(false),fontSize:9,padding:"4px 10px"}}>
                      {hiddenVideos[v.id]?"👁 Unhide":"👁‍🗨 Hide"}
                    </button>
                    {v.source==="cloudinary"&&<button onClick={(e)=>{e.stopPropagation();askConfirm("Remove this video from the app?", () => { saveManualVideos(manualVideos.filter(m=>m.id!==v.id),[v.id]); saveYtTags({[v.id]:null}); setYtTagEdit(null); }, { note: "The file stays in Storage — only its entry in the app is removed.", yesLabel: "Remove" });}} style={{...S.btn(false),fontSize:9,padding:"4px 10px",color:"#E11D48"}}>🗑 Delete</button>}
                    {hasTag&&<button onClick={()=>saveYtTags({[v.id]:null})} style={{...S.btn(false),fontSize:9,padding:"4px 10px",color:"#E11D48"}}>Clear Tags</button>}
                    {/* Verify video tags — marks reviewed + logs a video contribution. Keeps the
                        original verifier's credit if someone re-verifies after editing tags. */}
                    <button onClick={()=>{const wasVerified=!!(ytVideoTags[v.id]||{})._verified;const stamp=wasVerified?{_lastEditedBy:authUser?.name||"—",_lastEditedAt:Date.now()}:{_verifiedBy:authUser?.name||"—",_verifiedAt:Date.now()};saveYtTags({[v.id]:t=>({...t,_verified:true,...stamp})});if(!wasVerified)logVerificationEvent?.({photoId:v.id,photoName:v.title,source:"video",kind:"video"});showMsg("✅ Video tags verified","green");}} style={{...S.btn(true),fontSize:9,padding:"4px 10px",background:"#059669"}}>{savedTag._verified?"✅ Verified":"✅ Verify tags"}</button>
                    <button onClick={()=>aiTagVideo(v.id)} disabled={aiTaggingVideo===v.id} style={{...S.btn(false),fontSize:9,padding:"4px 10px",color:accent,opacity:aiTaggingVideo===v.id?0.5:1}}>{aiTaggingVideo===v.id?"⏳ Tagging...":"📋 Tag from description"}</button>
                    <button onClick={()=>{setYtTagEdit(null);setCldOpen(null);}} style={{...S.btn(true),fontSize:9,padding:"4px 10px"}}>Done</button>
                  </div>
                </div>}
              </div>);
            })}
          </div>
            {/* Same pager as the Images grid, and only when there is more than one page — on a
                filtered-down set of twenty videos a disabled Prev/Next pair is just furniture.
                Here the total IS known (the whole list is in memory), so it can say "of 8" without
                the estimate the cursor-paged Images grid needs. */}
            {vidPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 16 }}>
                <button className="ml-page-btn" onClick={() => { setVidPage(p => Math.max(0, p - 1)); libScrollTop(); }} disabled={vp === 0}
                  style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px", opacity: vp === 0 ? 0.4 : 1, cursor: vp === 0 ? "default" : "pointer" }}>← Prev</button>
                <span style={{ fontSize: 11, color: textS, fontVariantNumeric: "tabular-nums" }}>Page {vp + 1} of {vidPages} · {vidFiltered.length} videos</span>
                <button className="ml-page-btn" onClick={() => { setVidPage(p => Math.min(vidPages - 1, p + 1)); libScrollTop(); }} disabled={vp >= vidPages - 1}
                  style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px", opacity: vp >= vidPages - 1 ? 0.4 : 1, cursor: vp >= vidPages - 1 ? "default" : "pointer" }}>Next →</button>
              </div>
            )}
            </>;
          })()}
        </div>
        </div>
      )}
      {/* ═══ FULL-SCREEN VIDEO TAG EDITOR — all metadata + a left/right photo scroller per zone ═══ */}
      {bigTagVid && (() => {
        const v = allVideos.find(x => x.id === bigTagVid) || {};
        const vTag = ytVideoTags[bigTagVid] || {};
        // Both go through saveYtTags' FUNCTION form. `vTag` is this render's snapshot, and a save
        // takes a network round-trip, so anything derived from `vTag` at click time is stale for
        // every further click in that window — clicking three colours quickly kept only the last,
        // because each one spread a `colors` array that still predated its neighbours.
        const updTag = (patch) => saveYtTags({ [bigTagVid]: (prev) => ({ ...prev, ...patch }) });
        const toggleArr = (field, val) => saveYtTags({ [bigTagVid]: (prev) => {
          const cur = Array.isArray(prev[field]) ? prev[field] : [];
          const next = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val];
          return { ...prev, [field]: next.length ? next : undefined };
        } });
        const fnArr = Array.isArray(vTag.fn) ? vTag.fn : (vTag.fn ? [vTag.fn] : []);
        const palettes = imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : taxOr(taxonomy.colorPalette, []);
        const lbl = { fontSize: 11, fontWeight: 700, color: textS, marginBottom: 5 };
        // The shared definitions — see mlTagChip / mlTagCard at component scope. Aliased rather than
        // renamed throughout so this block reads as it did.
        const chipRow = mlTagRow;
        const chip = mlTagChip;
        const tagCard = mlTagCard;
        // Read-only summary tile. Shows what is already set, so the state of the video is legible
        // without reading down every group below. Values come straight off vTag — nothing computed,
        // nothing stored.
        const sumTile = (icon, label, value) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${border}`, borderRadius: 12, background: isDark ? "rgba(255,255,255,0.03)" : "#fff", minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: `${accent}1A`, color: accent }}>{icon}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: textS }}>{label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: value ? textP : textS, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || "—"}</div>
            </div>
          </div>
        );
        const lastTs = vTag._lastEditedAt || vTag._verifiedAt || vTag._savedAt || null;
        return <div onClick={() => setBigTagVid(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.85)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: "2vh 1vw" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: bg, borderRadius: 16, width: "98vw", maxWidth: 1600, minHeight: "92vh", border: `1px solid ${border}`, overflow: "hidden" }}>
            {/* Header. Same four actions, same handlers — restyled so the destructive-ish one (Hide)
                and the affirming one (Verify) are told apart by colour rather than by reading them,
                and Close is pushed to the corner. */}
            <div style={{ position: "sticky", top: 0, zIndex: 2, background: bg, borderBottom: `1px solid ${border}`, padding: "14px 22px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: `${accent}1A`, color: accent }}><IconPlay size={16} /></span>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: textP, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title || "Video"}</div>
                {/* "Saved" is a restatement of the line beside it, not a live save indicator — every
                    edit here goes straight through saveYtTags with no draft state to be out of sync
                    with. Left as plain text for that reason: a spinner would imply a state that does
                    not exist. */}
                <div style={{ fontSize: 11, color: textS, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  Changes save instantly
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#059669", fontWeight: 700 }}><IconCheck size={11} />Saved</span>
                </div>
              </div>
              <button onClick={() => aiTagVideoSave?.(bigTagVid)} disabled={aiTaggingVideo === bigTagVid} style={{ ...S.btn(false), fontSize: 12, padding: "9px 14px", borderRadius: 10, color: accent, opacity: aiTaggingVideo === bigTagVid ? 0.5 : 1 }}>{aiTaggingVideo === bigTagVid ? "⏳ Tagging…" : "🏷 Tag from description"}</button>
              <button onClick={() => { const nowHidden = !hiddenVideos[bigTagVid]; saveHiddenVideos({ [bigTagVid]: nowHidden ? true : null }); showMsg(nowHidden ? "🙈 Video hidden — won't show in the app or Needs-review" : "👁 Video visible again", "green"); }} style={{ ...S.btn(false), fontSize: 12, padding: "9px 14px", borderRadius: 10, color: hiddenVideos[bigTagVid] ? "#059669" : "#E11D48" }}>{hiddenVideos[bigTagVid] ? "👁 Unhide" : "🙈 Hide"}</button>
              <button onClick={() => { const wasVerified = !!vTag._verified; const stamp = wasVerified ? { _lastEditedBy: authUser?.name || "—", _lastEditedAt: Date.now() } : { _verifiedBy: authUser?.name || "—", _verifiedAt: Date.now() }; saveYtTags({ [bigTagVid]: (prev) => ({ ...prev, _verified: true, ...stamp }) }); if (!wasVerified) logVerificationEvent?.({ photoId: bigTagVid, photoName: v.title, source: "video", kind: "video" }); showMsg("✅ Video tags verified", "green"); }} style={{ ...S.btn(true), fontSize: 12, padding: "9px 18px", borderRadius: 10, background: "#059669", display: "inline-flex", alignItems: "center", gap: 6 }}><IconCheck size={13} />{vTag._verified ? "Verified" : "Verify"}</button>
              <button onClick={() => setBigTagVid(null)} style={{ ...S.btn(false), fontSize: 12, padding: "9px 16px", borderRadius: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>✕ Close</button>
            </div>
            <div style={{ padding: "18px 22px" }}>
              {/* Video beside a read-out of what is already tagged. The reference pairs them, and it
                  earns the space: you watch the clip and check the summary without scrolling between
                  them. Collapses to one column under 1100px. */}
              <div className="vt-top" style={{ display: "grid", gridTemplateColumns: "minmax(0,700px) minmax(0,1fr)", gap: 18, alignItems: "start", marginBottom: 20 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ borderRadius: 14, overflow: "hidden", background: "#000", aspectRatio: "16/9" }}>
                    {v.source === "cloudinary" && v.videoUrl
                      ? <video src={v.videoUrl} poster={v.thumb} controls preload="none" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
                      : <LazyYT src={`https://www.youtube.com/embed/${bigTagVid}`} poster={v.thumb} title={v.title} />}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, minWidth: 0 }}>
                  {sumTile(<IconFactory size={14} />, "Venue", vTag.venue)}
                  {sumTile(<IconPalette size={14} />, "Palette", vTag.palette)}
                  {sumTile(<IconCalendar size={14} />, "Event type", fnArr.join(", "))}
                  {sumTile(<IconWall size={14} />, "In / Out", vTag.io ? venueTypeLabel(vTag.io) : "")}
                  {sumTile(<IconCrown size={14} />, "Tier", vTag.tier)}
                  {sumTile(<IconSparkle size={14} />, "Design style", (vTag.styles || []).join(", "))}
                  {sumTile(<IconBulb size={14} />, "Time / Setting", vTag.timeSetting)}
                  {sumTile(<IconRepeat size={14} />, "Last updated", lastTs ? new Date(lastTs).toLocaleDateString() : "")}
                </div>
              </div>
              {/* The tagging groups, as numbered cards in a masonry column flow. CSS columns rather
                  than a grid because the groups are wildly different heights — Colors is thirty
                  chips, In/Out is three — and a grid row would size every card to the tallest in it,
                  leaving craters. column-fill:balance plus break-inside:avoid on the cards keeps
                  each one whole. */}
              <div className="vt-cols">
              {/* Venue (2-level chip picker — same pattern/shared toggle state as the inline grid
                  editor's own Venue row above); this full-screen editor previously had no way to
                  set it at all, unlike the image tagger's Venue picker. */}
              {tagCard(1, <IconFactory size={14} />, "Venue", (() => {
                  const curVenue = vTag.venue || "";
                  const isInhouse = curVenue && allInhouseVenueOrParentNames.includes(curVenue);
                  const activeGroup = tagVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                  const setVidVenue = (val) => updTag({ venue: val || undefined, venueCustom: undefined });
                  const outsideFiltered = customOutdoor.filter(o => tagOutsideSub === "empanelled" ? o.empanelled : tagOutsideSub === "other" ? !o.empanelled : true);
                  return <>
                    <div style={chipRow}>
                      {chip("Inhouse", activeGroup === "inhouse", () => { setTagVenueGroup("inhouse"); setTagOutsideSub("all"); })}
                      {chip("Outside", activeGroup === "outside", () => { setTagVenueGroup("outside"); setTagOutsideSub("all"); })}
                      {curVenue && <span onClick={() => { setVidVenue(""); setTagVenueGroup(""); }} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕ {curVenue}</span>}
                    </div>
                    {/* Sub-venues only — property/group names are excluded, they aren't a specific
                        bookable room. */}
                    {activeGroup === "inhouse" && <div style={{ ...chipRow, marginTop: 6 }}>
                      {leafInhouseVenues.map(vn => chip(vn, curVenue === vn, () => setVidVenue(curVenue === vn ? "" : vn)))}
                    </div>}
                    {activeGroup === "outside" && <>
                      <div style={{ ...chipRow, marginTop: 6 }}>
                        {chip("All", tagOutsideSub === "all", () => setTagOutsideSub("all"))}
                        {chip("Empanelled", tagOutsideSub === "empanelled", () => setTagOutsideSub("empanelled"))}
                        {chip("Other", tagOutsideSub === "other", () => setTagOutsideSub("other"))}
                      </div>
                      <div style={{ ...chipRow, marginTop: 4 }}>{outsideFiltered.map(o => chip(o.name + (o.empanelled ? " ★" : ""), curVenue === o.name, () => setVidVenue(curVenue === o.name ? "" : o.name)))}</div>
                    </>}
                  </>;
                })())}
              {tagCard(2, <IconCrown size={14} />, "Tier", <div style={chipRow}>{taxOr(taxonomy.tier, CATEGORIES).map(t => chip(t, vTag.tier === t, () => updTag({ tier: vTag.tier === t ? undefined : t })))}</div>)}
              {tagCard(3, <IconPalette size={14} />, "Palette", <select value={vTag.palette || ""} onChange={e => updTag({ palette: e.target.value || undefined })} style={{ ...S.select, width: "100%", marginBottom: 0 }}><option value="">—</option>{palettes.map(p => <option key={p} value={p}>{p}</option>)}</select>)}
              {tagCard(4, <IconCalendar size={14} />, "Event Type", <div style={chipRow}>{taxOr(taxonomy.eventType, FUNCTIONS).map(f => chip(f, fnArr.includes(f), () => toggleArr("fn", f)))}</div>)}
              {tagCard(5, <IconWall size={14} />, "In / Out", <div style={chipRow}>{taxOr(taxonomy.venueType, ["Indoor", "Outdoor", "Semi-Outdoor"]).map(io => chip(venueTypeLabel(io), vTag.io === io, () => updTag({ io: vTag.io === io ? undefined : io })))}</div>)}
              {tagCard(6, <IconSparkle size={14} />, "Design Style", <div style={chipRow}>{(taxonomy.designStyle || []).map(s => chip(s, (vTag.styles || []).includes(s), () => toggleArr("styles", s)))}</div>)}
              {tagCard(7, <IconBulb size={14} />, "Time / Setting", <div style={chipRow}>{taxOr(taxonomy.timeSetting, ["Day", "Night", "Twilight"]).map(t => chip(t, vTag.timeSetting === t, () => updTag({ timeSetting: vTag.timeSetting === t ? undefined : t })))}</div>)}
              {tagCard(8, <IconFlower size={14} />, "Colors", <div style={chipRow}>
                  {palettes.map(c => chip(c, (vTag.colors || []).includes(c), () => toggleArr("colors", c)))}
                  <PaletteQuickAdd accent={accent} border={border} textS={textS}
                    onAdd={(name) => {
                      const added = addPaletteInline(name, imsPaletteCatalogue, setImsPaletteCatalogue, savePaletteData);
                      if (added && !(vTag.colors || []).includes(added)) toggleArr("colors", added);
                    }} />
                </div>,
                // Count of what is picked, in the heading — Colors is the longest list here and the
                // only group where the selection can scroll out of view behind the others.
                (vTag.colors || []).length > 0 ? <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: `${accent}1A`, color: accent }}>{(vTag.colors || []).length}</span> : null)}
              </div>
            </div>
          </div>
        </div>;
      })()}
    </div>
  );
}

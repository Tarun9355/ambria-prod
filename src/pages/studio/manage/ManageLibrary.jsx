import { Fragment, useCallback, useMemo, useState, useRef, useEffect } from "react";
import LazyYT from "../../../components/studio/LazyYT";
import { libPhotoIsTagged } from "../../../lib/studio/taxonomy";
import { logTagCorrections } from "../../../lib/studio/tagFeedback";
import { fetchLibraryPage, fetchLibraryCounts, checkExistingLibraryUrls, fetchAllLibraryRowsMinimal } from "../../../lib/studio/libraryQueries";

// Server-side paginated + status-scoped browse grid. Resets to page 1 whenever the status chip,
// any sidebar filter, venue selection, or (debounced) search term changes; loadMore() appends.
// Chip counts are scoped to the same filters/search but NOT the status chip itself, per spec.
function usePaginatedLibrary({ libStatus, filters, venueGroup, venueNames, inhouseVenueNames, search, mergeLibItems }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({ verified: 0, review: 0, untagged: 0, nightly: 0, manual: 0 });
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const status = (libStatus === "nightly" || libStatus === "manual") ? undefined : libStatus;
  const tagSource = libStatus === "nightly" ? "nightly" : libStatus === "manual" ? "manual" : undefined;
  const filterKey = JSON.stringify(filters);
  const venueKey = `${venueGroup}|${venueNames.join(",")}`;

  useEffect(() => {
    const id = ++reqIdRef.current;
    setLoading(true); setItems([]); setCursor(null); setHasMore(true);
    fetchLibraryPage({ status, tagSource, filters, venueGroup, venueNames, inhouseVenueNames, search: debouncedSearch })
      .then(({ items: page, nextCursor, hasMore: more }) => {
        if (id !== reqIdRef.current) return;
        setItems(page); mergeLibItems(page); setCursor(nextCursor); setHasMore(more);
      })
      .catch(() => { if (id === reqIdRef.current) setHasMore(false); })
      .finally(() => { if (id === reqIdRef.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tagSource, filterKey, venueGroup, venueKey, debouncedSearch]);

  useEffect(() => {
    fetchLibraryCounts({ filters, venueGroup, venueNames, inhouseVenueNames, search: debouncedSearch })
      .then(setCounts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, venueGroup, venueKey, debouncedSearch]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || !cursor) return;
    setLoading(true);
    fetchLibraryPage({ status, tagSource, filters, venueGroup, venueNames, inhouseVenueNames, search: debouncedSearch, cursor })
      .then(({ items: page, nextCursor, hasMore: more }) => {
        setItems((prev) => [...prev, ...page]); mergeLibItems(page); setCursor(nextCursor); setHasMore(more);
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tagSource, filterKey, venueGroup, venueKey, debouncedSearch, cursor, hasMore, loading]);

  const updateItem = useCallback((id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it))), []);
  const removeItem = useCallback((id) => setItems((prev) => prev.filter((it) => it.id !== id)), []);
  const prependItems = useCallback((newItems) => setItems((prev) => [...newItems, ...prev]), []);

  return { items, counts, loading, hasMore, loadMore, updateItem, removeItem, prependItems };
}

// Real component (not a plain helper function) so its hooks are safe even though the grid that
// renders it is itself toggled on/off by a parent condition — a genuine mount/unmount, not a
// conditional hook call.
// getLibPhotosForZone is async (server-queried) now — this bridges it back to the synchronous
// "just read {exact,similar,fallback}" shape the video zone-photo pickers render inline, by caching
// results keyed on (zone list + the bits of videoTag that affect scoring) and kicking off a fetch
// on first read. Returns empty arrays (never null) while a key's fetch is in flight.
function useZoneMatchCache(getLibPhotosForZone) {
  const [cache, setCache] = useState({});
  const inFlight = useRef(new Set());
  const get = useCallback((zone, videoTag) => {
    const key = JSON.stringify([Array.isArray(zone) ? zone : [zone], videoTag?.tier, videoTag?.colors, videoTag?.styles, videoTag?.fn, videoTag?.io]);
    const hit = cache[key];
    if (hit) return hit;
    if (!inFlight.current.has(key)) {
      inFlight.current.add(key);
      getLibPhotosForZone(zone, videoTag).then((result) => {
        setCache((prev) => ({ ...prev, [key]: result }));
      }).finally(() => inFlight.current.delete(key));
    }
    return { exact: [], similar: [], fallback: [] };
  }, [cache, getLibPhotosForZone]);
  return get;
}

function LoadMoreSentinel({ onIntersect }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) onIntersect(); }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [onIntersect]);
  return <div ref={ref} style={{ height: 1 }} />;
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
    taxonomy, setTaxonomy, saveTax, TAX_LABELS, imsPaletteCatalogue, setImsPaletteCatalogue, imsColourCatalogue, setImsColourCatalogue, savePaletteData,
    taxOr, FUNCTIONS, CATEGORIES,
    // derived venue memos
    allInhouseVenues, allOutdoorDB, customOutdoor,
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
    rcItems, rcCats, rcIsSMB, isSubTagHidden,
    // IMS inventory (element breakdown "+Add element" now sources from here, not the Rate Card)
    imsInventory, getElPriceFromInventory,
    // Pure flower-recipe elements with no inventory backing (e.g. "Flower Garden") — addable
    // alongside inventory items, priced straight from the recipe
    recipeOnlyPatterns, getElPriceFromPattern,
    // misc
    showMsg, aiTagImage, authUser, corrLog, logCorrection, tagKB, rebuildTagKB, tagCorrections, refreshTagCorrections, bulkTag, runBulkTag, stopBulkTag, runTagSelected, bulkVid, runBulkTagVideos, importCloudinaryFolder,
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
    // zone picker modal
    zonePickerVid, setZonePickerVid, zonePickerZone, setZonePickerZone,
    getLibPhotosForZone, calcElsCost, filterPriority,
    zpFilterOpen, setZpFilterOpen, zpFilters, setZpFilters, zpToggleFilter, zpHasFilters, zpFilterPhoto,
  } = ctx;

  // Element Breakdown hover previews: enlarged thumbnail on hover, and — for a kit — its component
  // list on hovering the name. position:fixed (computed from the trigger's own
  // getBoundingClientRect on mouse-enter) rather than position:absolute — the whole photo-edit
  // panel scrolls via overflowY:auto, which clips any absolutely-positioned popover that extends
  // past its bounds; fixed positioning escapes that clipping since it's relative to the viewport.
  const [elHoverImg, setElHoverImg] = useState(null); // { idx, top, left }
  const [elHoverKit, setElHoverKit] = useState(null); // { idx, top, left }

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
  const photoStatus = (img) => img?._verified ? "verified"
    : libPhotoIsTagged(img) ? "review"
    : "untagged";
  // Same 3-state model for videos: verified (a person confirmed), review (AI/has tags, unconfirmed),
  // or untagged (no tag entry yet). Drives the Videos status folders + bulk video tagging.
  const videoStatus = (v) => {
    const t = ytVideoTags[v.id];
    if (!t) return "untagged";
    if (t._verified) return "verified";
    const hasTag = t._aiTagged || t.venue || t.fn || t.tier || t.io || (t.styles || []).length || (t.colors || []).length || Object.keys(t.zonePhotos || {}).length;
    return hasTag ? "review" : "untagged";
  };
  const [libStatus, setLibStatus] = useState("review"); // review | verified | untagged | nightly | manual — defaults to review so users don't land on Verified images and accidentally retag them
  const libPage = usePaginatedLibrary({
    libStatus, filters: libFilters, venueGroup: libVenueGroup, venueNames: libVenueNames,
    inhouseVenueNames: allInhouseVenues, search: libSearch, mergeLibItems,
  });
  const getZoneMatches = useZoneMatchCache(getLibPhotosForZone);
  const [libSelected, setLibSelected] = useState(new Set()); // IDs selected for manual AI tagging
  useEffect(() => { setLibSelected(new Set()); }, [libStatus]); // clear selection when switching tabs
  const [bigTagVid, setBigTagVid] = useState(null); // video id open in the full-screen tag editor
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
  const [orphanScan, setOrphanScan] = useState({ running: false, msg: "", result: null }); // { orphaned:[{id,name,url}], totalLibrary, totalCloudinary }
  const [orphanDeleting, setOrphanDeleting] = useState(false);
  const untaggedCount = libPage.counts.untagged; // server count (migration 008 `status` column) — not a full-array scan

  // Bulk "Tag all untagged" now runs APP-WIDE (in StudioApp) so it keeps going while you move
  // between Studio screens, with a global progress pill + completion toast. This just confirms
  // and kicks it off. `bulkTag` (progress) / `stopBulkTag` come from ctx.
  const startTagAll = () => {
    if (untaggedCount === 0) { showMsg("Nothing to tag — every photo is already AI-tagged or verified.", "green"); return; }
    if (!window.confirm(`AI-tag ${untaggedCount} untagged photo(s)?\n\nRuns in the background — keep working in the app (other Studio screens) and watch progress in the corner. Stop anytime; it resumes where it left off. A person still reviews/verifies afterwards.`)) return;
    runBulkTag?.();
  };

  // Rebuild Library — scans ALL Cloudinary folders and inserts missing images.
  // Uses the same cldAdmin edge-function path as importCloudinaryFolder.
  // Existing images (and their tags) are always preserved.
  const handleRebuildLibrary = async () => {
    const TOP_FOLDERS = ["Ambria", "inhouse venues", "inventory", "Outside Venues", "client-uploads", "production-ref"];
    if (!window.confirm(
      `Rebuild Library from Cloudinary?\n\n` +
      `Scans all ${TOP_FOLDERS.length} folders (~9,987 images total).\n` +
      `• Existing tags are preserved — nothing is overwritten\n` +
      `• Missing images are added as Untagged\n` +
      `• May take 3–8 minutes\n\n` +
      `Run "🤖 Tag all untagged" afterwards.`
    )) return;

    setRebuildRunning(true);
    setRebuildMsg("Starting…");

    const seen = new Set(); // secure_urls/public_ids collected THIS scan (dedupe within this run)
    const fresh = [];
    let totalScanned = 0;

    try {
      for (const topFolder of TOP_FOLDERS) {
        setRebuildMsg(`Scanning "${topFolder}"…`);

        // Page through all images under this prefix (catches all depths)
        let cursor = "";
        let folderScanned = 0;
        for (let pg = 0; pg < 100; pg++) {
          const d = await ctx.cldAdmin("list", {
            prefix: topFolder,
            max_results: 500,
            ...(cursor ? { next_cursor: cursor } : {}),
          });
          for (const r of d.resources || []) {
            if (!r.secure_url) continue;
            folderScanned++;
            totalScanned++;
            if (seen.has(r.secure_url) || seen.has(r.public_id)) continue;
            seen.add(r.secure_url);
            seen.add(r.public_id);
            const name = (r.public_id ?? "").split("/").pop().replace(/[-_]/g, " ");
            fresh.push({
              id: r.public_id,
              name,
              url: r.secure_url,
              folder: topFolder,
              tags: {},
              elements: [],
              addedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
              width:  r.width  ?? null,
              height: r.height ?? null,
              source: "cloudinary-rebuild",
            });
          }
          setRebuildMsg(`"${topFolder}": ${folderScanned} scanned · ${fresh.length} new total…`);
          if (!d.next_cursor) break;
          cursor = d.next_cursor;
        }
        console.log(`Rebuild: "${topFolder}" — ${folderScanned} scanned`);
      }

      // Batched server existence check (not a full-table scan) drops anything already in the Library.
      setRebuildMsg(`Checking ${fresh.length} candidates against the Library…`);
      const existing = await checkExistingLibraryUrls(fresh.map(r => r.url));
      const newImgs = fresh.filter(r => !existing.has(r.url));
      const skipped = totalScanned - newImgs.length;
      if (newImgs.length === 0) {
        showMsg(`Library up to date — all ${totalScanned} Cloudinary images already in Library.`, "green");
        return;
      }

      setRebuildMsg(`Saving ${newImgs.length} new images…`);
      await saveLib(newImgs);
      libPage.prependItems(newImgs.filter(i => libStatus === "untagged"));
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

  // Cloudinary secure_url → public_id (strip domain/version prefix + extension) — lets the
  // orphan check match a library row even if its stored URL's version number is stale (e.g. the
  // asset was re-uploaded/overwritten rather than deleted), same as handleRebuildLibrary's own
  // dedupe which keys on both secure_url AND public_id.
  const cldPublicIdFromUrl = (url) => {
    if (!url) return null;
    const afterUpload = String(url).replace(/^.*\/upload\/(v\d+\/)?/, "").replace(/\.[a-zA-Z0-9]+$/, "");
    try { return decodeURIComponent(afterUpload); } catch { return afterUpload; }
  };

  // Find Orphaned Images — the reverse of Rebuild Library. Scans the same Cloudinary folders to
  // build the set of assets that ACTUALLY still exist, then flags any Library row whose image
  // isn't in that set (e.g. the team deleted it directly in Cloudinary, bypassing the app).
  // Read-only: only reports the list — deleting is a separate explicit action below.
  const handleFindOrphaned = async () => {
    const TOP_FOLDERS = ["Ambria", "inhouse venues", "inventory", "Outside Venues", "client-uploads", "production-ref"];
    if (!window.confirm(
      `Scan for orphaned Library images?\n\n` +
      `Scans all ${TOP_FOLDERS.length} Cloudinary folders (~9,987 images) and cross-checks every Library row.\n` +
      `Read-only — nothing is deleted yet, you'll get a list to review first.\n` +
      `May take 3–8 minutes.`
    )) return;

    setOrphanScan({ running: true, msg: "Starting…", result: null });
    const existingUrls = new Set();
    const existingIds = new Set();
    try {
      for (const topFolder of TOP_FOLDERS) {
        setOrphanScan((s) => ({ ...s, msg: `Scanning "${topFolder}"…` }));
        let cursor = "";
        for (let pg = 0; pg < 100; pg++) {
          const d = await ctx.cldAdmin("list", { prefix: topFolder, max_results: 500, ...(cursor ? { next_cursor: cursor } : {}) });
          for (const r of d.resources || []) {
            if (r.secure_url) existingUrls.add(r.secure_url);
            if (r.public_id) existingIds.add(r.public_id);
          }
          if (!d.next_cursor) break;
          cursor = d.next_cursor;
        }
      }
      setOrphanScan((s) => ({ ...s, msg: `Fetching Library rows…` }));
      const rows = await fetchAllLibraryRowsMinimal((n) => setOrphanScan((s) => ({ ...s, msg: `Fetching Library rows… ${n}` })));
      const orphaned = rows.filter((r) => r.url && !existingUrls.has(r.url) && !existingIds.has(cldPublicIdFromUrl(r.url)));
      setOrphanScan({ running: false, msg: "", result: { orphaned, totalLibrary: rows.length, totalCloudinary: existingUrls.size } });
      showMsg(orphaned.length ? `Found ${orphaned.length} orphaned row(s) out of ${rows.length} Library images.` : "No orphaned rows found — Library matches Cloudinary.", orphaned.length ? "orange" : "green");
    } catch (e) {
      setOrphanScan({ running: false, msg: "", result: null });
      showMsg("Orphan scan failed: " + (e.message || "Unknown error"), "red");
    }
  };

  const handleDeleteOrphaned = async () => {
    const ids = (orphanScan.result?.orphaned || []).map((r) => r.id);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} orphaned Library row(s)?\n\nThis removes the Library entry only (there's no Cloudinary image left to delete) and cannot be undone.`)) return;
    setOrphanDeleting(true);
    try {
      await saveLib([], ids);
      ids.forEach((id) => libPage.removeItem(id));
      showMsg(`✓ Deleted ${ids.length} orphaned row(s).`, "green");
      setOrphanScan({ running: false, msg: "", result: null });
    } catch (e) {
      showMsg("Delete failed: " + (e.message || "Unknown error"), "red");
    }
    setOrphanDeleting(false);
  };

  // Status filter, search, sidebar filters, and sort (most-recently-tagged first for
  // review/nightly/manual) all happen server-side now — see usePaginatedLibrary above.
  // Some rows point at a Cloudinary asset that no longer resolves (e.g. a failed/partial import) —
  // rather than the <img> silently going blank and leaving a name-only card, drop the whole card
  // once its image 404s. brokenImgIds is session-local (not persisted) and reset per page load.
  const [brokenImgIds, setBrokenImgIds] = useState(() => new Set());
  const markImgBroken = useCallback((id) => setBrokenImgIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  const libVisible = libPage.items.filter((img) => !brokenImgIds.has(img.id));

  // ═══ LIBRARY: BROWSE (filtered grid + detail/editor panel) ═══
  const LibraryBrowse = () => (
    <div style={{ display: "flex", gap: 16, minHeight: "70vh" }}>
      {/* Filter sidebar */}
      <div style={{ width: 190, flexShrink: 0, overflowY: "auto", maxHeight: "75vh" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: accent }}>Filters</div>
          {(Object.values(libFilters).some(a => a?.length) || libVenueGroup !== "all" || libVenueNames.length > 0) && <div onClick={clearLibFilters} style={{ fontSize: 10, color: "#E11D48", cursor: "pointer" }}>Clear all</div>}
        </div>
        {/* Venue filter (2-level — mirrors Browse page) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: textS, marginBottom: 4 }}>Venue</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
            <span onClick={() => { setLibVenueGroup("all"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "all"), fontSize: 10, padding: "3px 8px" }}>All</span>
            <span onClick={() => { setLibVenueGroup("inhouse"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "inhouse"), fontSize: 10, padding: "3px 8px" }}>Inhouse</span>
            <span onClick={() => { setLibVenueGroup("outside"); setLibVenueNames([]); }} style={{ ...S.pill(libVenueGroup === "outside"), fontSize: 10, padding: "3px 8px" }}>Outside</span>
          </div>
          {libVenueGroup === "inhouse" && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {allInhouseVenues.map(v => {
              const sel = libVenueNames.includes(v);
              return <span key={v} onClick={() => toggleLibVenueName(v)} style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "2px 6px" }}>{v}</span>;
            })}
            {libVenueNames.length > 0 && <span onClick={() => setLibVenueNames([])} style={{ padding: "2px 6px", borderRadius: 10, fontSize: 9, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕</span>}
          </div>}
          {libVenueGroup === "outside" && <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {allOutdoorDB.map(v => {
              const sel = libVenueNames.includes(v.name);
              return <span key={v.name} onClick={() => toggleLibVenueName(v.name)} style={{ ...S.pill(sel), background: sel ? `${accent}22` : "transparent", color: sel ? accentText : textS, border: sel ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "2px 6px" }}>{v.name}{v.empanelled ? " ★" : ""}</span>;
            })}
            {libVenueNames.length > 0 && <span onClick={() => setLibVenueNames([])} style={{ padding: "2px 6px", borderRadius: 10, fontSize: 9, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕</span>}
          </div>}
        </div>
        {Object.keys(taxonomy).filter(k => Array.isArray(taxonomy[k])).map(k => {
          // colorPalette: use paletteCatalogue names instead of legacy taxonomy values
          // (filter to array-valued keys so non-array fields like taggingStandards never .map-crash)
          const vals = k === "colorPalette" && imsPaletteCatalogue.length > 0
            ? imsPaletteCatalogue.map(p => p.name)
            : taxonomy[k];
          return (
          <div key={k} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: textS, marginBottom: 4 }}>{k === "colorPalette" ? "Palette" : getTaxLabel(k)}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {vals.map(v => {
                const sel = (libFilters[k] || []).includes(v);
                return <span key={v} onClick={() => toggleLibFilter(k, v)} style={{ padding: "3px 8px", fontSize: 10, borderRadius: 10, cursor: "pointer", border: `1px solid ${sel ? accent : border}`, background: sel ? `${accent}18` : "transparent", color: sel ? accent : textS }}>{v}</span>;
              })}
            </div>
          </div>);
        })}
      </div>
      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <input value={libSearch} onChange={e => setLibSearch(e.target.value)} placeholder="Search by name..." style={{ ...S.input, marginBottom: 8, fontSize: 13 }} />
        {/* ── Status "folders" + bulk AI tag (Phase 1a) ── */}
        <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          {[
            ["verified", "✅", "Verified", "reviewed by a person", libPage.counts.verified, "#059669"],
            ["review", "🤖", "Needs review", "AI-tagged — to check", libPage.counts.review, "#7C3AED"],
            ["untagged", "❓", "Untagged", "no tags yet", libPage.counts.untagged, "#9CA3AF"],
            ["nightly", "🌙", "Nightly Tagged", "tagged by nightly cron", libPage.counts.nightly, "#0EA5E9"],
            ["manual", "✋", "Manual Tagged", "tagged via manual selection", libPage.counts.manual, "#F59E0B"],
          ].map(([k, icon, label, sub, count, col]) => {
            const on = libStatus === k;
            return <div key={k} onClick={() => setLibStatus(k)} title={sub} style={{ cursor: "pointer", minWidth: 104, padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${on ? col : border}`, background: on ? `${col}14` : cardBg, display: "flex", flexDirection: "column", gap: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: on ? col : textS }}>{icon} {label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}><span style={{ fontSize: 17, fontWeight: 800, color: on ? col : textP }}>{count}</span><span style={{ fontSize: 8, color: textS }}>{sub}</span></div>
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
          <span style={{ fontSize: 11, color: textS }}>Showing {libVisible.length} of {libPage.counts[libStatus] ?? libVisible.length}{libPage.loading ? "…" : ""}</span>
          {libStatus === "untagged" && libVisible.length > 0 && (
            <>
              <button onClick={() => setLibSelected(libSelected.size === libVisible.length ? new Set() : new Set(libVisible.map(i => i.id)))} style={{ ...S.btn(false), fontSize: 10, padding: "3px 8px" }}>
                {libSelected.size === libVisible.length ? "Deselect all" : `Select all (${libVisible.length})`}
              </button>
              {libSelected.size > 0 && (
                <>
                  <span style={{ fontSize: 10, color: "#7C3AED", fontWeight: 600 }}>{libSelected.size} selected</span>
                  <button onClick={() => setLibSelected(new Set())} style={{ ...S.btn(false), fontSize: 10, padding: "3px 8px" }}>Clear</button>
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
        {!libPage.loading && libVisible.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: textS }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📸</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No images here</div>
            <div style={{ fontSize: 12 }}>Try a different status tab or clear filters — or switch to "Add images"/"Bulk import" to add photos.</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
          {libVisible.map(img => {
            const isSel = libSelected.has(img.id);
            return (
            <div key={img.id} onClick={() => libStatus === "untagged" && libSelected.size > 0 ? setLibSelected(prev => { const n = new Set(prev); n.has(img.id) ? n.delete(img.id) : n.add(img.id); return n; }) : setLibEditImg(img)} style={{ borderRadius: 10, overflow: "hidden", border: `1.5px solid ${isSel ? "#7C3AED" : libEditImg?.id === img.id ? accent : border}`, cursor: "pointer", background: isSel ? "#7C3AED0A" : cardBg, position: "relative" }}>
              <img src={img.url} alt="" loading="lazy" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} onError={() => markImgBroken(img.id)} />
              {(() => {
                const st = photoStatus(img);
                const m = st === "verified" ? { t: "✅", c: "#059669" } : st === "review" ? { t: "🤖", c: "#7C3AED" } : { t: "❓", c: "#9CA3AF" };
                const verifier = st === "verified" ? (img._verifiedBy || null) : null;
                const dateStr = st === "verified" && img._verifiedAt ? new Date(img._verifiedAt).toLocaleDateString() : null;
                const tip = st === "verified"
                  ? `Verified by ${verifier || "unknown"}${dateStr ? ` on ${dateStr}` : ""}`
                  : st === "review" ? "AI-tagged — needs review" : "Untagged";
                return (
                  <div style={{ position: "absolute", top: 6, left: 6, right: 30, display: "flex", alignItems: "center", gap: 3 }}>
                    <div title={tip} style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 9, background: "rgba(0,0,0,0.6)", border: `1.5px solid ${m.c}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9 }}>{m.t}</div>
                    {verifier && <div title={tip} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 8, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.6)", padding: "2px 5px", borderRadius: 6 }}>{verifier}</div>}
                  </div>
                );
              })()}
              {/* Checkbox — shown in untagged view; clicking it toggles selection without opening detail */}
              {libStatus === "untagged" && (
                <div onClick={e => { e.stopPropagation(); setLibSelected(prev => { const n = new Set(prev); n.has(img.id) ? n.delete(img.id) : n.add(img.id); return n; }); }} style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: 5, border: `2px solid ${isSel ? "#7C3AED" : "rgba(255,255,255,0.8)"}`, background: isSel ? "#7C3AED" : "rgba(0,0,0,0.35)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>
                  {isSel ? "✓" : ""}
                </div>
              )}
              {libStatus !== "untagged" && (img.linkedTemplates || []).length > 0 && <div style={{ position: "absolute", top: 6, right: 6, padding: "2px 6px", borderRadius: 6, background: "rgba(0,0,0,0.65)", fontSize: 9, color: "#fff", display: "flex", alignItems: "center", gap: 3 }}>🔗 {(img.linkedTemplates || []).length}</div>}
              {(img.elements || []).length > 0 && <div style={{ position: "absolute", top: 28, left: 6, padding: "2px 6px", borderRadius: 6, background: "rgba(124,58,237,0.8)", fontSize: 9, color: "#fff" }}>📋 {(img.elements || []).length}</div>}
              <div style={{ padding: "6px 8px" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: textP, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{img.name || "Untitled"}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 3 }}>
                  {(img.tags?.categoryTier || []).map(t => <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: t === "Enhanced" ? "#0EA5E922" : "#6B728022", color: t === "Enhanced" ? "#0EA5E9" : textS }}>{t}</span>)}
                  {(img.tags?.areasElements || []).slice(0, 2).map(t => <span key={t} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 6, background: `${accent}12`, color: accent }}>{t}</span>)}
                </div>
              </div>
            </div>
          );
          })}
        </div>
        {libPage.loading && <div style={{ textAlign: "center", padding: 16, fontSize: 11, color: textS }}>Loading…</div>}
        {!libPage.loading && libPage.hasMore && libVisible.length > 0 && (
          <>
            <LoadMoreSentinel onIntersect={libPage.loadMore} />
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button onClick={libPage.loadMore} style={{ ...S.btn(false), fontSize: 11, padding: "6px 16px" }}>Load more</button>
            </div>
          </>
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
        {/* Detail panel — opens as a centered popup so you don't scroll past the whole grid */}
        {libEditImg && (
          <div onClick={() => setLibEditImg(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.62)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 940, margin: "0 auto", background: cardBg, borderRadius: 14, border: `1px solid ${border}`, padding: 16, maxHeight: "94vh", overflowY: "auto", boxShadow: "0 12px 48px rgba(0,0,0,0.45)" }}>
            <div style={{ display: "flex", gap: 16 }}>
              <img src={libEditImg.url} alt="" onClick={()=>setPreviewImg(libEditImg.url)} style={{ width: 200, height: 140, objectFit: "cover", borderRadius: 10, flexShrink: 0, cursor: "pointer", border: "2px solid transparent" }} title="Click to view full size" onError={e => { e.target.style.display = "none"; }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <input value={libEditImg.name || ""} onChange={e => setLibEditImg({ ...libEditImg, name: e.target.value })} style={{ ...S.input, fontSize: 14, fontWeight: 600, flex: 1, marginRight: 8 }} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={libAiLoading} onClick={async() => {
                      setLibAiLoading(true); showMsg("🤖 Analyzing image...","green");
                      try{
                        const result=await Promise.race([aiTagImage(libEditImg.url),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),30000))]);
                        if(result){
                          const updated={...libEditImg};
                          // Handle tags — support both {tags:{...}} and flat {eventType:[...]} formats
                          const tagSrc=result.tags||result;
                          if(tagSrc){updated.tags={...(updated.tags||{})};Object.keys(taxonomy).forEach(k=>{if(Array.isArray(tagSrc[k])&&tagSrc[k].length)updated.tags[k]=tagSrc[k];});}
                          if(result.name&&(!updated.name||updated.name.startsWith("img ")))updated.name=result.name;
                          if(Array.isArray(result.elements)&&result.elements.length>0)updated.elements=result.elements;
                          if(typeof result.lightCount==="number")updated.lightCount=result.lightCount;
                          if(Array.isArray(result.unrecognized))updated.unrecognized=result.unrecognized;
                          if(result.tags&&typeof result.tags==="object")updated._aiTags=result.tags; // snapshot AI suggestion for the corrections diff
                          if(result._aiThinking)updated._aiThinking=result._aiThinking; // model's own reasoning, shown in the panel below
                          updated._aiTagged=true;
                          updated._aiTaggedAt=Date.now(); // so Needs-review sorts by most-recently-tagged
                          // Handle dims
                          const d=result.dims||{};
                          const hasDims=(d.trussL||d.trussW||d.trussH||d.floorL||d.floorW);
                          if(hasDims){updated.dims={...(updated.dims||{}),trussL:d.trussL||0,trussW:d.trussW||0,trussH:d.trussH||0,floorL:d.floorL||0,floorW:d.floorW||0,plH:d.plH||updated.dims?.plH||"",mkT:d.mkT||updated.dims?.mkT||"",mkWalls:d.mkWalls||updated.dims?.mkWalls||{}};}
                          setLibEditImg(updated);
                          showMsg(`✓ AI: ${result.elements?.length||0} elements${hasDims?", dims "+d.trussL+"×"+d.trussW+"×"+d.trussH:"— no dims (fill manually)"}`,"green");
                        }
                        // No else here: aiTagImage already shows the specific reason (rate limit,
                        // empty response, parse error, etc.) via its own showMsg before returning
                        // null — a generic "no results" message here would just overwrite it.
                      }catch(e){showMsg("AI error: "+e.message,"red");}
                      setLibAiLoading(false);
                    }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px", background: "#7C3AED", opacity: libAiLoading ? 0.5 : 1 }}>{libAiLoading ? "🔄 Tagging..." : "🤖 AI Tag"}</button>
                    <button onClick={() => {
                      // §23 Phase 2.9e — Mandate drape density for Full Box photos (trussL && trussW && trussH all filled)
                      const d = libEditImg.dims || {};
                      const isFullBox = !!(d.trussL && d.trussW && d.trussH);
                      const hasDensity = !!d.drapeDensity;
                      if (isFullBox && !hasDensity) {
                        showMsg("🪡 Drape Density required for Full Box photos — pick Minimum, Moderate, or Dense", "red");
                        return;
                      }
                      // A human save = Verified: stamps who/when so it leaves the "needs review" pile.
                      const wasVerified = !!libEditImg._verified;
                      const verified = { ...libEditImg, _verified: true, _verifiedBy: authUser?.name || "—", _verifiedAt: Date.now() };
                      saveLib([verified]);
                      // Already-verified photo re-saved → update in place; newly-verified → it just
                      // left this tab (review/untagged/nightly/manual), drop it from the visible page.
                      if (wasVerified) libPage.updateItem(verified.id, verified); else libPage.removeItem(verified.id);
                      setLibEditImg(verified);
                      logCorrection?.({ photoId: libEditImg.id, photoName: libEditImg.name, source: "library" });
                      // Capture per-field corrections (AI suggestion → what the human saved) so future
                      // tagging learns from them; then refresh the in-session corrections feed.
                      if (libEditImg._aiTags) logTagCorrections(libEditImg.id, libEditImg._aiTags, libEditImg.tags || {}, authUser?.name).then((n) => { if (n) refreshTagCorrections?.(); });
                      showMsg("✅ Saved & verified", "green");
                    }} style={{ ...S.btn(true), fontSize: 11, padding: "6px 12px",
                      // Dim the Save button when Full Box + no density to give visual cue
                      opacity: (libEditImg.dims?.trussL && libEditImg.dims?.trussW && libEditImg.dims?.trussH && !libEditImg.dims?.drapeDensity) ? 0.45 : 1
                    }}>{libEditImg._verified ? "✅ Save" : "✅ Save & Verify"}</button>
                    <button onClick={() => { saveLib([], [libEditImg.id]); libPage.removeItem(libEditImg.id); setLibEditImg(null); }} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px", color: "#E11D48" }}>Delete</button>
                    <button onClick={() => setLibEditImg(null)} style={{ ...S.btn(false), fontSize: 11, padding: "6px 12px" }}>Close</button>
                  </div>
                </div>
                {/* Review status (🤖 AI suggested / ✓ Reviewed) + light count (💡) + missing items (⚠) */}
                {(() => {
                  const lc = (typeof libEditImg.lightCount === "number") ? libEditImg.lightCount : null;
                  const newEls = (libEditImg.elements || []).filter(e => e && e.new).map(e => e.name).filter(Boolean);
                  const unrec = Array.isArray(libEditImg.unrecognized) ? libEditImg.unrecognized : [];
                  const attention = [...newEls, ...unrec];
                  const reviewed = !!libEditImg._verified;
                  const aiSuggested = !!libEditImg._aiTagged && !reviewed;
                  if (lc == null && attention.length === 0 && !reviewed && !aiSuggested) return null;
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "2px 0 8px" }}>
                      {reviewed && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, background: "#05966922", color: "#059669" }}>✓ Verified by {libEditImg._verifiedBy || "—"}{libEditImg._verifiedAt ? ` on ${new Date(libEditImg._verifiedAt).toLocaleDateString()}` : ""}</span>}
                      {aiSuggested && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 7, background: "#7C3AED22", color: "#7C3AED" }}>🤖 AI suggested — review</span>}
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
                {/* Venue tag (2-level chip picker — mirrors Browse page) */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: textS, marginBottom: 2 }}>Venue</div>
                  {(() => {
                    const curVenue = libEditImg.tags?.venue || "";
                    const isInhouse = curVenue && allInhouseVenues.includes(curVenue);
                    const activeGroup = tagVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                    const outsideFiltered = allOutdoorDB.filter(o => tagOutsideSub === "empanelled" ? o.empanelled : tagOutsideSub === "other" ? !o.empanelled : true);
                    const setPhVenue = (val) => setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, venue: val || "" } });
                    return <>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <div onClick={() => { setTagVenueGroup("inhouse"); setTagOutsideSub("all"); }} style={S.pill(activeGroup === "inhouse")}>Inhouse</div>
                        <div onClick={() => { setTagVenueGroup("outside"); setTagOutsideSub("all"); }} style={S.pill(activeGroup === "outside")}>Outside</div>
                        {curVenue && <div onClick={() => { setPhVenue(""); setTagVenueGroup(""); }} style={{ padding: "4px 8px", borderRadius: 12, fontSize: 9, cursor: "pointer", color: textS, border: `1px dashed ${border}` }}>✕ {curVenue}</div>}
                      </div>
                      {activeGroup === "inhouse" && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {allInhouseVenues.map(vn => { const on = curVenue === vn; return <div key={vn} onClick={() => setPhVenue(on ? "" : vn)} style={{ ...S.pill(on), background: on ? `${accent}22` : "transparent", color: on ? accentText : textS, border: on ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "3px 8px" }}>{vn}</div>; })}
                      </div>}
                      {activeGroup === "outside" && <>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          <div onClick={() => setTagOutsideSub("all")} style={{ ...S.pill(tagOutsideSub === "all"), fontSize: 9, padding: "3px 8px" }}>All</div>
                          <div onClick={() => setTagOutsideSub("empanelled")} style={{ ...S.pill(tagOutsideSub === "empanelled"), fontSize: 9, padding: "3px 8px" }}>Empanelled</div>
                          <div onClick={() => setTagOutsideSub("other")} style={{ ...S.pill(tagOutsideSub === "other"), fontSize: 9, padding: "3px 8px" }}>Other</div>
                        </div>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
                          {outsideFiltered.map(o => { const on = curVenue === o.name; return <div key={o.name} onClick={() => setPhVenue(on ? "" : o.name)} style={{ ...S.pill(on), background: on ? `${accent}22` : "transparent", color: on ? accentText : textS, border: on ? `1px solid ${accent}55` : `1px solid ${border}`, fontSize: 9, padding: "3px 8px" }}>{o.name}{o.empanelled ? " ★" : ""}</div>; })}
                        </div>
                      </>}
                    </>;
                  })()}
                </div>
                {Object.keys(taxonomy).filter(k => Array.isArray(taxonomy[k])).map(k => {
                  const vals = k === "colorPalette" && imsPaletteCatalogue.length > 0
                    ? imsPaletteCatalogue.map(p => p.name)
                    : taxonomy[k];
                  return (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: textS, marginBottom: 2 }}>{k === "colorPalette" ? "Palette" : getTaxLabel(k)}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {vals.map(v => {
                        const sel = (libEditImg.tags?.[k] || []).includes(v);
                        return <span key={v} onClick={() => {
                          const cur = libEditImg.tags?.[k] || [];
                          const next = sel ? cur.filter(x => x !== v) : [...cur, v];
                          setLibEditImg({ ...libEditImg, tags: { ...libEditImg.tags, [k]: next } });
                        }} style={{ padding: "2px 7px", fontSize: 9, borderRadius: 8, cursor: "pointer", border: `1px solid ${sel ? accent : border}`, background: sel ? `${accent}18` : "transparent", color: sel ? accent : textS }}>{v}</span>;
                      })}
                    </div>
                  </div>);
                })}
              </div>
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
                  {isBox && <div><div style={cell} title="Box front extended both sides — priced as 2× Single U truss">Front ext (ft/side)</div><input type="number" min={0} step="0.5" value={d.trussFrontExt || ""} placeholder="0" onChange={e => setD({ trussFrontExt: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                  {isBox && (Number(d.trussFrontExt) || 0) > 0 && <div><div style={cell}>Ext height (ft)</div><input type="number" min={0} step="0.5" value={d.trussFrontExtH || ""} placeholder={String(d.trussH || 0)} onChange={e => setD({ trussFrontExtH: Math.max(0, parseFloat(e.target.value) || 0) })} style={inp} /></div>}
                </div>;
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Depth (ft)</div><input type="number" value={libEditImg.dims?.floorL || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), floorL: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Floor Width (ft)</div><input type="number" value={libEditImg.dims?.floorW || ""} onChange={e => setLibEditImg({ ...libEditImg, dims: { ...(libEditImg.dims || {}), floorW: parseFloat(e.target.value) || 0 } })} style={{ ...S.input, fontSize: 13, padding: "6px 8px", textAlign: "center", fontWeight: 600 }} placeholder="—" /></div>
                <div><div style={{ fontSize: 9, color: textS, marginBottom: 2 }}>Platform</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[{v:"",l:"None"},{v:"4in",l:"4\""},{v:"1ft",l:"Raised"}].map(o=>{
                      const sel=(libEditImg.dims?.plH||"")=== o.v;
                      return <span key={o.v} onClick={()=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),plH:o.v}})} style={{flex:1,padding:"6px 0",borderRadius:6,fontSize:10,fontWeight:sel?600:400,textAlign:"center",cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}18`:"transparent",color:sel?accent:textS}}>{o.l}</span>;
                    })}
                  </div>
                </div>
              </div>
              {/* ── §23 Phase 2.9e (26 May 2026) — Drape Density (Liza kg/sqft for Full Box ceiling) ── */}
              {(() => {
                const d = libEditImg.dims || {};
                const isFullBox = !!(d.trussL && d.trussW && d.trussH);
                const hasDensity = !!d.drapeDensity;
                const missing = isFullBox && !hasDensity;
                const borderC  = missing ? "rgba(239,68,68,0.55)" : "rgba(244,114,182,0.25)";
                const bgC      = missing ? (isDark?"rgba(239,68,68,0.10)":"#FEF2F2") : (isDark?"rgba(244,114,182,0.06)":"#FDF2F8");
                const labelC   = missing ? "#B91C1C" : "#9D174D";
                return (
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:8, padding:"6px 10px", borderRadius:8, background:bgC, border:`1px solid ${borderC}` }}>
                    <span style={{ fontSize:11, fontWeight:600, color:labelC }}>🪡 Drape Density {isFullBox && <span style={{ color: missing?"#B91C1C":"#059669", fontWeight:700, marginLeft:4 }}>{missing ? "* Required" : "✓"}</span>}</span>
                    <span style={{ fontSize:9, color:textS, flex:1 }}>{isFullBox ? "Required for Full Box (ceiling drape)" : "Optional — only used when Full Box truss"}</span>
                    <div style={{ display:"flex", gap:4 }}>
                      {[{v:"",l:"—"},{v:"minimum",l:"Minimum"},{v:"moderate",l:"Moderate"},{v:"dense",l:"Dense"}].map(o => {
                        const sel = (libEditImg.dims?.drapeDensity || "") === o.v;
                        // Hide the "—" option for Full Box (must pick one of the 3 real values)
                        if (isFullBox && o.v === "") return null;
                        return <span key={o.v} onClick={()=>setLibEditImg({...libEditImg, dims:{...(libEditImg.dims||{}), drapeDensity: o.v}})}
                          style={{ padding:"4px 10px", borderRadius:6, fontSize:10, fontWeight:sel?700:500, textAlign:"center", cursor:"pointer", border:`1px solid ${sel?"#EC4899":border}`, background: sel?"rgba(236,72,153,0.12)":"transparent", color: sel?"#9D174D":textS }}>{o.l}</span>;
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 10, color: textS }}>
                <span>{(libEditImg.dims?.trussL && libEditImg.dims?.trussW && libEditImg.dims?.trussH) ? <span style={{ color: "#C9A96E", fontWeight: 600 }}>{"🔩"} Box Truss</span> : (libEditImg.dims?.trussW && libEditImg.dims?.trussH) ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>{"🔩"} Single U</span> : "Fill truss dims"}</span>
                {(libEditImg.dims?.floorL && libEditImg.dims?.floorW) ? <span>{"🧹"} Floor: {libEditImg.dims.floorL}×{libEditImg.dims.floorW} = {libEditImg.dims.floorL * libEditImg.dims.floorW} sqft</span> : null}
                {libEditImg.dims?.plH ? <span style={{ color: "#059669", fontWeight: 600 }}>{"🔨"} {libEditImg.dims.plH === "4in" ? "4 inch" : "1ft-3ft raise"}</span> : null}
              </div>
              {/* ── Masking walls ── */}
              {(libEditImg.dims?.trussW || libEditImg.dims?.trussH) && (() => {
                const dL=libEditImg.dims?.trussL||0, dW=libEditImg.dims?.trussW||0, dH=libEditImg.dims?.trussH||0;
                const isBox=dL&&dW&&dH;
                const mw=libEditImg.dims?.mkWalls||{};
                const mkT=libEditImg.dims?.mkT||"";
                const anyWall=mw.back||mw.left||mw.right;
                const toggleW=(wall)=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),mkWalls:{...mw,[wall]:!mw[wall]}}});
                const setMkT=(t)=>setLibEditImg({...libEditImg,dims:{...(libEditImg.dims||{}),mkT:t}});
                const walls=isBox?[
                  {id:"back",label:"Back wall",dim:`${dL} × ${dH} ft`},
                  {id:"left",label:"Left wall",dim:`${dW} × ${dH} ft`},
                  {id:"right",label:"Right wall",dim:`${dW} × ${dH} ft`}
                ]:[
                  {id:"left",label:"Left wall",dim:`${dW} × ${dH} ft`},
                  {id:"right",label:"Right wall",dim:`${dW} × ${dH} ft`}
                ];
                return <div style={{ marginTop: 10, background: anyWall ? (isDark ? "rgba(201,169,110,0.08)" : "rgba(201,169,110,0.06)") : (isDark ? "rgba(255,255,255,0.03)" : "#FAFAFA"), borderRadius: 10, padding: "12px 14px", border: `1px solid ${anyWall ? accent+"40" : border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: anyWall ? accent : textP, marginBottom: 8 }}>{"🧱"} Masking</div>
                  <div style={{ fontSize: 10, color: textS, marginBottom: 6 }}>Material type</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {[{id:"fabric",l:"Fabric ₹20"},{id:"acrylic",l:"Acrylic ₹100"},{id:"flex",l:"Flex ₹45"},{id:"vinyl",l:"Vinyl ₹90"}].map(o=>{
                      const sel=mkT===o.id;
                      return <span key={o.id} onClick={()=>setMkT(sel?"":o.id)} style={{padding:"6px 12px",borderRadius:8,fontSize:11,cursor:"pointer",border:`1.5px solid ${sel?accent:border}`,background:sel?`${accent}22`:"transparent",color:sel?accent:textS,fontWeight:sel?600:400}}>{o.l}</span>;
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: textS, marginBottom: 6 }}>Select walls to mask</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {walls.map(w=>{const on=mw[w.id];return <div key={w.id} onClick={()=>toggleW(w.id)} style={{flex:1,minWidth:90,padding:"10px 12px",borderRadius:10,cursor:"pointer",border:`2px solid ${on?accent:border}`,background:on?(isDark?"rgba(201,169,110,0.12)":"rgba(201,169,110,0.08)"):"transparent",textAlign:"center"}}>
                      <div style={{fontSize:14,fontWeight:600,color:on?accent:textS,marginBottom:2}}>{on?"✓ ":""}{w.label}</div>
                      <div style={{fontSize:11,color:on?accent:textS}}>{w.dim}</div>
                    </div>;})}
                  </div>
                </div>;
              })()}
            </div>
            {/* ── Zone Structure Costs ── */}
            {(() => {
              const d=libEditImg.dims||{};
              const dL=d.trussL||0, dW=d.trussW||0, dH=d.trussH||0, fL=d.floorL||0, fW=d.floorW||0;
              const isBox=dL&&dW&&dH;
              const isSingleU=!isBox&&dW&&dH;
              const trussSqft=isBox?(()=>{const s=[dL,dW,dH].sort((a,b)=>b-a);return s[0]*s[1];})():(isSingleU?dW*dH:0);
              const trussRate=isBox?50:30;
              const trussCost=trussSqft*trussRate;
              const mw=d.mkWalls||{};const mkT=d.mkT||"";
              const mkRates={fabric:20,acrylic:100,flex:45,vinyl:90};
              const mkRate=mkRates[mkT]||0;
              let maskSqft=0;const maskWalls=[];
              if(mw.back&&isBox){const a=dL*dH;maskSqft+=a;maskWalls.push({label:"Back",dim:`${dL}×${dH}`,sqft:a});}
              if(mw.left){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Left",dim:`${dW}×${dH}`,sqft:a});}
              if(mw.right){const a=dW*dH;maskSqft+=a;maskWalls.push({label:"Right",dim:`${dW}×${dH}`,sqft:a});}
              const maskCost=maskSqft*mkRate;
              const flSqft=fL*fW;
              const plRate=d.plH==="4in"?30:d.plH==="1ft"?45:0;
              const plCost=flSqft*plRate;
              const cpRate=15;const cpCost=flSqft*cpRate;
              const structTotal=trussCost+maskCost+plCost+cpCost;
              if(!trussSqft&&!flSqft)return null;
              return <div style={{marginTop:14,borderTop:`1px solid ${border}`,paddingTop:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:12,fontWeight:600,color:accent}}>{"🏗️"} Zone Structure Cost</div>
                  <div style={{fontSize:13,fontWeight:600,color:accent}}>{fmt(structTotal)}</div>
                </div>
                {trussSqft>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{isBox?"Box Truss":"Single U"}</span><br/><span style={{fontSize:10,color:textS}}>{isBox?`Top 2: ${[dL,dW,dH].sort((a,b)=>b-a).slice(0,2).join("×")} = ${trussSqft} sqft × ₹${trussRate}`:`${dW}×${dH} = ${trussSqft} sqft × ₹${trussRate}`}</span></div>
                  <span style={{fontWeight:600}}>{fmt(trussCost)}</span>
                </div>}
                {maskCost>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>{mkT.charAt(0).toUpperCase()+mkT.slice(1)} Masking</span><br/><span style={{fontSize:10,color:textS}}>{maskWalls.map(w=>`${w.label} ${w.dim}=${w.sqft}`).join(" + ")} = {maskSqft} sqft × ₹{mkRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(maskCost)}</span>
                </div>}
                {plCost>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11,borderBottom:`0.5px solid ${border}`}}>
                  <div><span style={{fontWeight:600}}>Platform ({d.plH==="4in"?"4 inch":"1ft-3ft"})</span><br/><span style={{fontSize:10,color:textS}}>{fL}×{fW} = {flSqft} sqft × ₹{plRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(plCost)}</span>
                </div>}
                {flSqft>0&&<div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:11}}>
                  <div><span style={{fontWeight:600}}>Carpet (New)</span><br/><span style={{fontSize:10,color:textS}}>{fL}×{fW} = {flSqft} sqft × ₹{cpRate}</span></div>
                  <span style={{fontWeight:600}}>{fmt(cpCost)}</span>
                </div>}
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
                      // Searches IMS inventory + pure flower-recipe patterns with no inventory backing
                      // (Rate Card is not consulted here — see getElPriceFromInventory /
                      // getElPriceFromPattern in StudioApp.jsx).
                      const invMatches = (imsInventory || []).filter(it => !(libEditImg.elements || []).find(el => el.invId === it.id) && matchesTokens([it.name, it.cat, it.subCat || it.subcategory].filter(Boolean).join(" ").toLowerCase()));
                      const patMatches = (recipeOnlyPatterns || []).filter(pt => !(libEditImg.elements || []).find(el => el.patternId === pt.id) && matchesTokens(pt.name.toLowerCase()));
                      const matches = [...invMatches.map(it => ({ kind: "inv", it })), ...patMatches.map(pt => ({ kind: "pat", pt }))];
                      // Thumbnail is sized to actually be readable inline — no hover step required to
                      // see it properly (an earlier hover-preview panel was fiddly and could run
                      // off-screen depending on where this search box sits on the page).
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
                            <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, opacity: 0.3 }}>📦</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                                {isKit && <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "rgba(99,102,241,0.15)", color: "#6366F1", fontWeight: 700, flexShrink: 0 }}>📦 KIT</span>}
                              </div>
                              <div style={{ fontSize: 9, color: textS, marginTop: 2 }}>{(it.subCat || it.subcategory) ? (it.subCat || it.subcategory) + " › " : ""}{it.cat}</div>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 55px 50px 70px 24px", gap: "4px 5px", alignItems: "center", fontSize: 10 }}>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>ELEMENT</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>QTY</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>SIZE</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9 }}>UNIT</div>
                  <div style={{ fontWeight: 600, color: textS, fontSize: 9, textAlign: "right" }}>COST</div>
                  <div></div>
                  {(libEditImg.elements || []).map((el, idx) => {
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
                        <Fragment key={idx}>
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
                            <span style={{ cursor: isKit ? "help" : "default" }}
                              onMouseEnter={(e) => {
                                if (!isKit) return;
                                const r = e.currentTarget.getBoundingClientRect();
                                const rows = (invItem.subItems || []).length;
                                const estH = Math.min(24 + rows * 34 + 16, 360);
                                const spaceBelow = window.innerHeight - r.bottom;
                                const spaceAbove = r.top;
                                const openUp = spaceBelow < estH + 8 && spaceAbove > spaceBelow;
                                const avail = (openUp ? spaceAbove : spaceBelow) - 12;
                                setElHoverKit({ idx, openUp, top: openUp ? undefined : r.bottom + 4, bottom: openUp ? window.innerHeight - r.top + 4 : undefined, left: Math.min(r.left, window.innerWidth - 288), maxHeight: Math.max(avail, 80) });
                              }}
                              onMouseLeave={() => setElHoverKit(null)}>
                              {el.name}
                            </span>
                            {isKit && elHoverKit?.idx === idx && (
                              <div style={{ position: "fixed", top: elHoverKit.top, bottom: elHoverKit.bottom, left: elHoverKit.left, zIndex: 10000, minWidth: 200, maxWidth: 280, maxHeight: elHoverKit.maxHeight, overflowY: "auto", background: cardBg, border: `1px solid ${border}`, borderRadius: 8, padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: textS, marginBottom: 4 }}>📦 Kit contents</div>
                                {(invItem.subItems || []).map((si, i) => {
                                  const comp = (imsInventory || []).find(x => x.id === si.itemId);
                                  if (!comp) return null;
                                  const compSrc = comp.img || comp.photoUrls?.[0];
                                  return (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                                      <div style={{ width: 28, height: 28, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                        {compSrc ? <img src={compSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 10, opacity: 0.3 }}>📦</span>}
                                      </div>
                                      <div style={{ fontSize: 10, color: textP, flex: 1, whiteSpace: "nowrap" }}>{comp.name}</div>
                                      <div style={{ fontSize: 9, color: textS, flexShrink: 0 }}>×{si.qty}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
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
                          <div style={{ fontSize: 10, color: textS }}>{el.unit}</div>
                          <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: lineCost > 0 ? textP : textS }}>{lineCost > 0 ? fmt(lineCost) : invItem ? "₹0" : "—"}</div>
                          <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                        </Fragment>
                      );
                    }
                    if (el.patternId) {
                      // Pure flower-recipe element (no inventory item at all) — priced via
                      // getElPriceFromPattern (StudioApp.jsx), same recipe real/artificial blend as
                      // an invId floral element, just without an underlying physical item.
                      const { lineCost, isFloralBlend, realPct, patternSMB } = getElPriceFromPattern(el);
                      const patternExists = (recipeOnlyPatterns || []).some(p => p.id === el.patternId);
                      return (
                        <Fragment key={idx}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: textP, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: isDark ? "#1a1a2e" : "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 11, opacity: 0.5 }}>🌺</span>
                            </div>
                            {el.name}
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
                          <div style={{ fontSize: 10, color: textS }}>{el.unit}</div>
                          <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: lineCost > 0 ? textP : textS }}>{lineCost > 0 ? fmt(lineCost) : "₹0"}</div>
                          <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                        </Fragment>
                      );
                    }
                    const rc = rcItems.find(i => i.name === el.name);
                    const sizes = rcIsSMB(rc) ? ["S","M","B"] : null;
                    const isTrussSqft = rc && rc.unit === "truss_sqft";
                    let unitPrice=0;
                    if(rc){const sz=(el.size||"").toUpperCase();if(rcIsSMB(rc)){if(sz==="S")unitPrice=rc.inhouseS||0;else if(sz==="B")unitPrice=rc.inhouseB||0;else unitPrice=rc.inhouseM||0;}else{unitPrice=rc.inhouseFlat||0;}}
                    const lineCost=(el.qty||0)*unitPrice;
                    return (
                    <Fragment key={idx}>
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
                      <div style={{ fontSize: 10, color: textS }}>{el.unit}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, textAlign: "right", color: (isTrussSqft ? unitPrice : lineCost) > 0 ? textP : textS }}>{isTrussSqft ? (unitPrice > 0 ? `₹${unitPrice.toLocaleString("en-IN")}/sqft` : "—") : (lineCost > 0 ? fmt(lineCost) : rc ? "₹0" : "—")}</div>
                      <span onClick={() => { const elems = (libEditImg.elements || []).filter((_, i) => i !== idx); setLibEditImg({ ...libEditImg, elements: elems }); }} style={{ cursor: "pointer", color: "#E11D48", fontWeight: 700, fontSize: 12, textAlign: "center" }}>×</span>
                    </Fragment>
                  );})}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: textS }}>Manually-added elements come from IMS inventory (📦 KIT items price as one line at the kit's own rate). Items tagged <span style={{color:"#F59E0B",fontWeight:600}}>NEW</span> were AI-detected but have no matching IMS inventory item — add the item to Inventory, or remove. Items tagged <span style={{color:"#EF4444",fontWeight:600}}>❓ VERIFY</span> were matched by a weak keyword guess, not an exact name — double-check they're the right item.</div>
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
    // Range + kind + text-search (search matches person OR photo/video name). User filter applied only to the detail list.
    const baseRaw = (corrLog || []).filter(e => (e.ts || 0) >= since
      && (corrKind === "all" || kindOf(e) === corrKind)
      && (!q || (e.user || "").toLowerCase().includes(q) || (e.photoName || "").toLowerCase().includes(q)));
    // Dedupe to ONE row per person + item (keep the latest save), so repeated saves of the same photo
    // don't show as duplicates or inflate counts — a contribution = a unique photo/video a person fixed.
    const dedup = new Map();
    baseRaw.forEach(e => { const k = (e.user || "—") + "|" + (e.photoId || e.photoName || "") + "|" + kindOf(e); const p = dedup.get(k); if (!p || (e.ts || 0) > (p.ts || 0)) dedup.set(k, e); });
    const base = Array.from(dedup.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const inRange = base.filter(e => !corrUser || e.user === corrUser);
    const byUser = {};
    base.forEach(e => { const u = e.user || "—"; const b = byUser[u] || (byUser[u] = { total: 0, photo: 0, video: 0 }); b.total++; b[kindOf(e)]++; });
    const userRows = Object.entries(byUser).sort((a, b) => b[1].total - a[1].total);
    const fmtTs = (ts) => new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return (
      <div>
        <div style={{ fontSize: 12, color: textS, marginBottom: 10 }}>Every photo correction ("Save correction to master" / "Save & Verify") and video tag verification is logged here — see who corrected how many photos and videos, and when. Click a person to see only their work; search by name; switch Photos/Videos.</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          {[["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["all", "All time"]].map(([k, l]) => (
            <span key={k} onClick={() => setCorrRange(k)} style={{ padding: "4px 12px", fontSize: 11, borderRadius: 14, cursor: "pointer", fontWeight: corrRange === k ? 700 : 500, border: `1px solid ${corrRange === k ? accent : border}`, background: corrRange === k ? `${accent}18` : "transparent", color: corrRange === k ? accent : textS }}>{l}</span>
          ))}
          <span style={{ width: 1, height: 18, background: border, margin: "0 2px" }} />
          {[["all", "All"], ["photo", "📷 Photos"], ["video", "🎬 Videos"]].map(([k, l]) => (
            <span key={k} onClick={() => setCorrKind(k)} style={{ padding: "4px 12px", fontSize: 11, borderRadius: 14, cursor: "pointer", fontWeight: corrKind === k ? 700 : 500, border: `1px solid ${corrKind === k ? accent : border}`, background: corrKind === k ? `${accent}18` : "transparent", color: corrKind === k ? accent : textS }}>{l}</span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <input value={corrSearch} onChange={e => setCorrSearch(e.target.value)} placeholder="🔍 Search by person or photo/video name…" style={{ ...S.input, fontSize: 12, marginBottom: 0, flex: 1, minWidth: 220 }} />
          <span style={{ fontSize: 11, color: textS }}>{base.length} item{base.length === 1 ? "" : "s"}{corrUser ? ` · ${corrUser}` : ""}</span>
          {(corrUser || corrSearch) && <span onClick={() => { setCorrUser(""); setCorrSearch(""); }} style={{ fontSize: 10, color: "#E11D48", cursor: "pointer" }}>✕ clear</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14 }}>
          <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: 14, alignSelf: "start" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 8 }}>👥 By person</div>
            {userRows.length === 0 ? <div style={{ fontSize: 11, color: textS, padding: "10px 0" }}>No contributions in this period yet.</div> :
              userRows.map(([u, c], i) => (
                <div key={u} onClick={() => setCorrUser(corrUser === u ? "" : u)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 8px", borderRadius: 8, cursor: "pointer", background: corrUser === u ? `${accent}14` : "transparent", borderBottom: `1px solid ${border}` }}>
                  <span style={{ fontSize: 12, color: textP }}><span style={{ color: textS, marginRight: 6 }}>{i + 1}.</span>{u}</span>
                  <span style={{ fontSize: 10, color: textS, display: "flex", gap: 6, alignItems: "baseline" }}>
                    {c.photo > 0 && <span title="photos">📷 {c.photo}</span>}
                    {c.video > 0 && <span title="videos">🎬 {c.video}</span>}
                    <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{c.total}</span>
                  </span>
                </div>
              ))}
          </div>
          <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 8 }}>📝 Recent{corrUser ? ` — ${corrUser}` : ""}</div>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {inRange.length === 0 ? <div style={{ fontSize: 11, color: textS, padding: "10px 0" }}>Nothing matches.</div> :
                inRange.slice(0, 400).map(e => {
                  const isVid = kindOf(e) === "video";
                  const thumb = isVid ? (allVideos.find(v => v.id === e.photoId)?.thumb) : (libItems.find(i => i.id === e.photoId)?.url);
                  return (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${border}` }}>
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      {thumb
                        ? <img src={thumb} alt="" loading="lazy" style={{ width: 40, height: 28, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} onError={ev => { ev.target.style.display = "none"; }} />
                        : <span style={{ fontSize: 14, width: 40, textAlign: "center", flexShrink: 0 }}>{isVid ? "🎬" : "📷"}</span>}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: textP, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isVid ? "🎬 " : ""}{e.photoName || e.photoId || "(item)"}</div>
                        <div style={{ fontSize: 9, color: textS }}>{e.user} · {e.source === "build" ? "build screen" : e.source === "video" ? "video" : "library"}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 9, color: textS, whiteSpace: "nowrap" }}>{fmtTs(e.ts)}</span>
                  </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ═══ MANAGE: LIBRARY & CONTENT ═══ (reference ManageLibrary() ~11684)
  return (
    <div>
      {/* Inline add bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 12, background: cardBg, border: `1px dashed ${accent}40`, borderRadius: 12, marginBottom: 14 }}>
        <button onClick={() => {if(!cldOpen){setCldOpen("library");setCldPath([]);setCldFolders([]);setCldImages([]);fetchCldFolders("");}else setCldOpen(null);}} style={{ ...S.btn(cldOpen==="library"), fontSize: 11 }}>☁️ Cloudinary</button>
        <button onClick={handleRebuildLibrary} disabled={rebuildRunning} title="Scan all Cloudinary folders and add any missing images to the Library" style={{ ...S.btn(false), fontSize: 11, opacity: rebuildRunning ? 0.5 : 1, border: `1px solid ${rebuildRunning ? "#9CA3AF" : "#7C3AED"}`, color: rebuildRunning ? "#9CA3AF" : "#7C3AED" }}>{rebuildRunning ? "⏳ Rebuilding…" : "🔄 Rebuild Library"}</button>
        <button onClick={handleFindOrphaned} disabled={orphanScan.running} title="Scan Cloudinary and flag Library rows whose image no longer exists there" style={{ ...S.btn(false), fontSize: 11, opacity: orphanScan.running ? 0.5 : 1, border: `1px solid ${orphanScan.running ? "#9CA3AF" : "#E11D48"}`, color: orphanScan.running ? "#9CA3AF" : "#E11D48" }}>{orphanScan.running ? "⏳ Scanning…" : "🧹 Find Orphaned"}</button>
      </div>
      {rebuildMsg && <div style={{ padding: "8px 14px", borderRadius: 8, background: "#7C3AED12", border: "1px solid #7C3AED30", marginBottom: 8, fontSize: 11, color: "#7C3AED" }}>⏳ {rebuildMsg}</div>}
      {orphanScan.msg && <div style={{ padding: "8px 14px", borderRadius: 8, background: "#E11D4812", border: "1px solid #E11D4830", marginBottom: 8, fontSize: 11, color: "#E11D48" }}>⏳ {orphanScan.msg}</div>}
      {orphanScan.result && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginBottom: 14, background: cardBg }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: orphanScan.result.orphaned.length ? 10 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: orphanScan.result.orphaned.length ? "#E11D48" : "#10B981" }}>
              {orphanScan.result.orphaned.length ? `🧹 ${orphanScan.result.orphaned.length} orphaned row(s) found` : "✓ No orphaned rows — Library matches Cloudinary"}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: textS }}>{orphanScan.result.totalLibrary} Library rows · {orphanScan.result.totalCloudinary} Cloudinary images</span>
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
          <div style={{fontSize:12,fontWeight:700,color:accent}}>📂 Browse Cloudinary Photos</div>
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
            if(!window.confirm(`Import ALL photos under "${prefix}" — including every subfolder — into the Library?\n\nAlready-imported photos are skipped automatically (no duplicates). Then run "Tag all untagged".`))return;
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
                  if(!confirm("Delete this photo from Cloudinary permanently?")) return;
                  try {
                    const d=await ctx.cldAdmin("delete",{public_id:img.public_id});
                    if(d.deleted){setCldImages(prev=>prev.filter(p=>p.public_id!==img.public_id));showMsg("✓ Deleted","green");}
                    else{showMsg("Delete failed: "+(d.error||"unknown"),"red");}
                  }catch(err){showMsg("Delete failed","red");}
                }} style={{position:"absolute",top:2,right:2,background:"rgba(0,0,0,0.6)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",fontSize:10,color:"#F87171",lineHeight:1}}>✕</button>}
              </div>;
            })}
          </div>
        </>}
        {!cldLoading&&cldFolders.length===0&&cldImages.length===0&&cldPath.length>0&&<div style={{fontSize:11,color:textS,textAlign:"center",padding:16}}>Empty folder</div>}
      </div>}
      {/* Images / Videos toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {libAllowed("images") && <button onClick={() => setLibView("images")} style={{ ...S.btn(libView === "images"), fontSize: 11 }}>📸 Images ({libPage.counts.verified + libPage.counts.review + libPage.counts.untagged})</button>}
        {libAllowed("videos") && <button onClick={() => { setLibView("videos"); if(!ytVideos.length) loadAllYT(); }} style={{ ...S.btn(libView === "videos"), fontSize: 11 }}>🎬 Videos ({allVideos.length})</button>}
        {libAllowed("corrections") && <button onClick={() => setLibView("corrections")} style={{ ...S.btn(libView === "corrections"), fontSize: 11 }}>📊 Contributions ({new Set((corrLog || []).map(e => (e.user || "—") + "|" + (e.photoId || e.photoName || "") + "|" + (e.kind === "video" ? "video" : "photo"))).size})</button>}
        <button onClick={() => setLibView("palettes")} style={{ ...S.btn(libView === "palettes"), fontSize: 11 }}>🎨 Palettes ({imsPaletteCatalogue.length})</button>
      </div>
      {libView === "palettes" && (
        <div style={{ maxWidth: 650 }}>
          {/* 🎨 Colour Catalogue */}
          <div style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: "14px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: textP }}>🎨 Colour Catalogue</div><div style={{ fontSize: 10, color: textS, marginTop: 2 }}>Master colours for paint picker + inventory base colour. ★ = Neutral (shows in every palette).</div></div>
              <button onClick={() => { const next = [...imsColourCatalogue, { name: "New Colour", hex: "#CCCCCC", isNeutral: false }]; setImsColourCatalogue(next); savePaletteData(next, null); }} style={{ padding: "5px 14px", borderRadius: 8, border: "none", background: accent, color: isDark ? "#1a1a2e" : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Add Colour</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {imsColourCatalogue.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: `1px solid ${c.isNeutral ? accent : border}`, background: c.isNeutral ? `${accent}08` : "transparent" }}>
                  <input type="color" value={c.hex || "#ccc"} onChange={e => { const next = [...imsColourCatalogue]; next[i] = { ...next[i], hex: e.target.value }; setImsColourCatalogue(next); savePaletteData(next, null); }} style={{ width: 20, height: 20, border: "none", cursor: "pointer", borderRadius: 4, padding: 0 }} />
                  <input type="text" value={c.name || ""} onChange={e => { const next = [...imsColourCatalogue]; next[i] = { ...next[i], name: e.target.value }; setImsColourCatalogue(next); }} onBlur={() => savePaletteData(null, null)} style={{ border: "none", background: "transparent", color: textP, fontSize: 11, fontWeight: 500, width: 80, outline: "none" }} />
                  <span onClick={() => { const next = [...imsColourCatalogue]; next[i] = { ...next[i], isNeutral: !next[i].isNeutral }; setImsColourCatalogue(next); savePaletteData(next, null); }} style={{ fontSize: 12, cursor: "pointer", color: c.isNeutral ? accent : textS }} title="Toggle neutral">{c.isNeutral ? "★" : "☆"}</span>
                  <span onClick={() => { const next = imsColourCatalogue.filter((_, j) => j !== i); setImsColourCatalogue(next); savePaletteData(next, null); }} style={{ fontSize: 10, cursor: "pointer", color: "#E11D48", fontWeight: 700 }}>×</span>
                </div>
              ))}
            </div>
          </div>
          {/* 🌈 Palette Catalogue */}
          <div style={{ background: cardBg, borderRadius: 12, border: `1px solid ${border}`, padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: textP }}>🌈 Palette Catalogue</div><div style={{ fontSize: 10, color: textS, marginTop: 2 }}>Named themes for salesperson to pick per function. Drives the Build screen colour picker + library filter.</div></div>
              <button onClick={() => { const next = [...imsPaletteCatalogue, { name: "New Palette", anchorColours: [] }]; setImsPaletteCatalogue(next); savePaletteData(null, next); }} style={{ padding: "5px 14px", borderRadius: 8, border: "none", background: accent, color: isDark ? "#1a1a2e" : "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Add Palette</button>
            </div>
            {imsPaletteCatalogue.map((p, pi) => (
              <div key={pi} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${border}`, marginBottom: 8, background: isDark ? "rgba(255,255,255,0.02)" : "#FAFAF7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input type="text" value={p.name || ""} onChange={e => { const next = [...imsPaletteCatalogue]; next[pi] = { ...next[pi], name: e.target.value }; setImsPaletteCatalogue(next); }} onBlur={() => savePaletteData(null, null)} style={{ ...S.input, fontSize: 13, fontWeight: 600, padding: "5px 10px", flex: 1, marginBottom: 0 }} />
                  <span onClick={() => { const next = imsPaletteCatalogue.filter((_, j) => j !== pi); setImsPaletteCatalogue(next); savePaletteData(null, next); }} style={{ fontSize: 12, cursor: "pointer", color: "#E11D48", fontWeight: 700, padding: "2px 8px" }}>🗑</span>
                </div>
                <div style={{ fontSize: 10, color: textS, marginBottom: 4 }}>Anchor colours (tap to toggle · ★ marks primary colour(s) — you can star more than one — which drive Build photo order):</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
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
                    return <span key={c.name} style={{ padding: "3px 8px", fontSize: 10, borderRadius: 6, display: "flex", alignItems: "center", gap: 4, border: `1px solid ${isPrimary ? "#C9A96E" : isAnchor ? accent : border}`, background: isPrimary ? "rgba(201,169,110,0.18)" : isAnchor ? `${accent}18` : "transparent", color: isPrimary ? "#C9A96E" : isAnchor ? accent : textS }}>
                      <span onClick={toggleAnchor} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: c.hex || "#ccc", display: "inline-block", border: "1px solid rgba(0,0,0,0.1)" }} />
                        {c.name}
                      </span>
                      {isAnchor && <span onClick={setPrimary} title={isPrimary ? "Primary colour (tap to unset)" : "Mark as primary"} style={{ cursor: "pointer", fontSize: 11, color: isPrimary ? "#C9A96E" : textS }}>{isPrimary ? "★" : "☆"}</span>}
                    </span>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Content */}
      {libView === "corrections" && CorrectionsPanel()}
      {libView === "images" && LibraryBrowse()}
      {libView === "videos" && (
        <div>
          {/* Search + Refresh + Add Video row */}
          <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
            <input value={ytSearch} onChange={e=>setYtSearch(e.target.value)} placeholder="Search videos by title..." style={{...S.input,flex:1,marginBottom:0,fontSize:12}}/>
            <button onClick={()=>openCldVideoBrowser()} style={{...S.btn(true),fontSize:10,padding:"8px 14px",whiteSpace:"nowrap"}}>+ Add Video</button>
            <button onClick={()=>loadAllYT(true)} disabled={ytLoading} style={{...S.btn(false),fontSize:10,padding:"8px 14px",whiteSpace:"nowrap",opacity:ytLoading?0.5:1}}>{ytLoading?"⏳":"🔄"} Refresh YT</button>
          </div>
          {/* ── Status "folders" + bulk video AI tag (mirrors the Images tab) ── */}
          {(() => {
            const vis = allVideos.filter(v => !hiddenVideos[v.id]);
            const cnt = (k) => k === "all" ? vis.length : vis.filter(v => videoStatus(v) === k).length;
            const untaggedN = cnt("untagged");
            return (
              <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {[
                  ["all", "📁", "All", "everything", cnt("all"), accent],
                  ["verified", "✅", "Verified", "reviewed by a person", cnt("verified"), "#059669"],
                  ["review", "🤖", "Needs review", "AI-tagged — to check", cnt("review"), "#7C3AED"],
                  ["untagged", "❓", "Untagged", "no tags yet", untaggedN, "#9CA3AF"],
                ].map(([k, icon, label, sub, count, col]) => {
                  const on = ytFilterLinked === k;
                  return <div key={k} onClick={() => setYtFilterLinked(k)} title={sub} style={{ cursor: "pointer", minWidth: 104, padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${on ? col : border}`, background: on ? `${col}14` : cardBg, display: "flex", flexDirection: "column", gap: 1 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: on ? col : textS }}>{icon} {label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}><span style={{ fontSize: 17, fontWeight: 800, color: on ? col : textP }}>{count}</span><span style={{ fontSize: 8, color: textS }}>{sub}</span></div>
                  </div>;
                })}
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "center" }}>
                  {bulkVid?.running ? (
                    <span style={{ fontSize: 10, color: textS }}>🎬 Tagging {bulkVid.done}/{bulkVid.total} · {bulkVid.ok}✓ {bulkVid.fail}✕</span>
                  ) : untaggedN > 0 ? (
                    <button onClick={() => { if (window.confirm(`AI-tag ${untaggedN} untagged video${untaggedN === 1 ? "" : "s"}?\n\nRuns in the background — keep working; progress shows in the corner. Each video is metadata-tagged and gets best-match zone photos. The team reviews/verifies after, and tagged videos appear on Browse.`)) runBulkTagVideos?.(); }} style={{ ...S.btn(true), fontSize: 10, padding: "6px 14px", background: "#0EA5E9" }}>🎬 Tag all untagged ({untaggedN})</button>
                  ) : null}
                </div>
              </div>
            );
          })()}
          {/* Add Video Panel (Cloudinary Video Browser) */}
          {addVideoOpen&&<div style={{border:`1px solid ${accent}`,borderRadius:12,padding:14,marginBottom:12,background:isDark?"rgba(201,169,110,0.04)":"rgba(201,169,110,0.06)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:accent}}>📂 Add Video from Cloudinary</div>
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
                const thumbUrl=res.secure_url.replace("/video/upload/","/video/upload/so_0,w_320,h_180,c_fill/").replace(/\.[^.]+$/,".jpg");
                const fileName=(res.public_id||"").split("/").pop().replace(/[-_]/g," ");
                const alreadyAdded=manualVideos.some(m=>m.videoUrl===res.secure_url);
                return <div key={res.public_id} style={{borderRadius:8,border:`1px solid ${border}`,overflow:"hidden",opacity:alreadyAdded?0.4:1}}>
                  <img src={thumbUrl} alt={fileName} style={{width:"100%",height:100,objectFit:"cover",display:"block"}} loading="lazy" onError={e=>{e.target.style.background=isDark?"#1a1a2e":"#f0f0f0";e.target.style.height="100px";}}/>
                  <div style={{padding:"6px 8px"}}>
                    <div style={{fontSize:10,fontWeight:600,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{fileName}</div>
                    {alreadyAdded?<div style={{fontSize:9,color:"#059669",fontWeight:600}}>✓ Added</div>:
                    <button onClick={()=>addCldVideo(res)} style={{...S.btn(true),fontSize:9,padding:"4px 10px",width:"100%"}}>+ Add to App</button>}
                  </div>
                </div>;
              })}
            </div>}
            {!cldVideoLoading&&cldVideoFolders.length===0&&cldVideoList.length===0&&cldVideoPath.length>0&&<div style={{fontSize:11,color:textS,textAlign:"center",padding:16}}>No video files in this folder</div>}
            <div style={{fontSize:9,color:textS,marginTop:8}}>Upload videos to any Cloudinary folder first, then browse them here. Supports mp4, mov, webm.</div>
          </div>}
          {/* Filter pills row */}
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,color:textS,fontWeight:600}}>Filter:</span>
            <select value={ytFilterVenue} onChange={e=>setYtFilterVenue(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">All Venues</option>
              <optgroup label="Inhouse">
                {allInhouseVenues.map(v=><option key={v} value={v}>{v}</option>)}
              </optgroup>
              {customOutdoor.filter(o=>o.empanelled).length>0&&<optgroup label="Outside — Empanelled">
                {customOutdoor.filter(o=>o.empanelled).map(o=><option key={"em-"+o.name} value={o.name}>{o.name}</option>)}
              </optgroup>}
              {customOutdoor.filter(o=>!o.empanelled).length>0&&<optgroup label="Outside — Other">
                {customOutdoor.filter(o=>!o.empanelled).map(o=><option key={"ot-"+o.name} value={o.name}>{o.name}</option>)}
              </optgroup>}
            </select>
            <select value={ytFilterFn} onChange={e=>setYtFilterFn(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">All Events</option>
              {taxOr(taxonomy.eventType, FUNCTIONS).map(f=><option key={f} value={f}>{f}</option>)}
            </select>
            <select value={ytFilterTier} onChange={e=>setYtFilterTier(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">All Tiers</option>
              {taxOr(taxonomy.tier, CATEGORIES).map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <select value={ytFilterIO} onChange={e=>setYtFilterIO(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">In/Out</option>
              {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(v=><option key={v} value={v}>{v}</option>)}
            </select>
            <select value={ytFilterStyle} onChange={e=>setYtFilterStyle(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">All Styles</option>
              {taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]).map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <select value={ytFilterColor} onChange={e=>setYtFilterColor(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">All Colors</option>
              {(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"])).map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <select value={ytFilterLinked} onChange={e=>setYtFilterLinked(e.target.value)} style={{...S.select,fontSize:10,width:"auto",padding:"4px 8px",marginBottom:0}}>
              <option value="all">All</option>
              <option value="verified">✅ Verified</option>
              <option value="review">🤖 Needs review</option>
              <option value="tagged">Tagged</option>
              <option value="untagged">Untagged</option>
              <option value="linked">Linked to Event</option>
              <option value="hidden">Hidden</option>
            </select>
            <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,color:textS}}>
              <input type="checkbox" checked={showHidden} onChange={e=>setShowHidden(e.target.checked)} style={{accentColor:accent}}/>
              Show hidden
            </label>
            {(ytFilterVenue!=="all"||ytFilterFn!=="all"||ytFilterTier!=="all"||ytFilterLinked!=="all"||ytFilterStyle!=="all"||ytFilterColor!=="all"||ytFilterIO!=="all")&&
              <span onClick={()=>{setYtFilterVenue("all");setYtFilterFn("all");setYtFilterTier("all");setYtFilterLinked("all");setYtFilterStyle("all");setYtFilterColor("all");setYtFilterIO("all");}} style={{fontSize:10,color:"#E11D48",cursor:"pointer",fontWeight:600}}>✕ Clear</span>}
            <span style={{fontSize:10,color:textS,marginLeft:"auto"}}>{Object.keys(ytVideoTags).length} tagged · {Object.keys(hiddenVideos).length} hidden · {allVideos.length} total</span>
          </div>
          {/* Picker banner */}
          {ytPicker&&<div style={{padding:"10px 16px",background:"rgba(14,165,233,0.12)",borderRadius:10,border:"1px solid rgba(14,165,233,0.3)",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><span style={{fontWeight:600,color:"#0EA5E9",fontSize:12}}>🔗 Linking video to:</span> <span style={{fontSize:12,fontWeight:700}}>{events.find(e=>e.id===ytPicker)?.name||"Event"}</span></div>
            <button onClick={()=>setYtPicker(null)} style={{...S.btn(false),fontSize:10,padding:"4px 10px"}}>Cancel</button>
          </div>}
          {ytLoading&&<div style={{textAlign:"center",padding:40,color:textS}}>⏳ Loading videos from YouTube...</div>}
          {!ytLoading&&allVideos.length===0&&<div style={{textAlign:"center",padding:40,color:textS}}>No videos found. Hit Refresh to load from YouTube or Add Video from Cloudinary.</div>}
          {/* Video grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
            {allVideos.filter(v=>{
              // Hidden filter
              const isHid = !!hiddenVideos[v.id];
              if(ytFilterLinked==="hidden") return isHid;
              if(isHid && !showHidden) return false;
              if(ytFilterPL!=="all"&&v.playlistId!==ytFilterPL) return false;
              if(ytSearch.trim()&&!v.title.toLowerCase().includes(ytSearch.toLowerCase())) return false;
              const tag=ytVideoTags[v.id];
              if(ytFilterVenue!=="all"&&tag?.venue!==ytFilterVenue) return false;
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
            }).map(v=>{
              const savedTag=ytVideoTags[v.id]||{};
              const hasDraft=aiVideoDraft&&aiVideoDraft.videoId===v.id;
              const tag=hasDraft?aiVideoDraft.tags:savedTag;
              const isEditing=ytTagEdit===v.id;
              const linkedEvts=(savedTag.linkedEvents||[]).map(eid=>events.find(e=>e.id===eid)).filter(Boolean);
              const hasTag=savedTag.venue||savedTag.fn||(savedTag.styles||[]).length||savedTag.tier||savedTag.io||(savedTag.colors||[]).length;
              return(
              <div key={v.id} style={{...S.card,overflow:"hidden",border:isEditing?`2px solid ${accent}`:`1px solid ${border}`,transition:"border 0.2s"}}>
                {/* Thumbnail */}
                <div style={{position:"relative",cursor:"pointer"}} onClick={()=>{
                  if(ytPicker){
                    const idx=events.findIndex(e=>e.id===ytPicker);
                    if(idx>=0){
                      const upd=[...events];upd[idx]={...upd[idx],video:`https://www.youtube.com/embed/${v.id}`};save(upd);
                      const nt={...ytVideoTags,[v.id]:{...tag,linkedEvents:[...new Set([...(tag.linkedEvents||[]),ytPicker])]}};saveYtTags(nt);
                      setYtPicker(null);
                    }
                  } else {
                    setBigTagVid(v.id); // open the full-screen editor (play + tag + hide)
                  }
                }}>
                  <img src={v.thumb} alt={v.title} loading="lazy" style={{width:"100%",height:140,objectFit:"cover",display:"block"}} onError={e=>{e.target.style.display="none"}}/>
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
                    {tag.io&&<span style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:"rgba(16,185,129,0.9)",color:"#fff",fontWeight:700}}>{tag.io}</span>}
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
                      {!hasTag&&<span style={{fontSize:9,color:"#F59E0B",fontWeight:600}}>Untagged</span>}
                      {hiddenVideos[v.id]&&<span style={{fontSize:9,color:textS,fontWeight:600}}>🙈 Hidden</span>}
                      <button onClick={(e)=>{e.stopPropagation();setBigTagVid(v.id);}} title="Open the full-screen editor — play, tag, pick zone photos, hide" style={{padding:"2px 8px",borderRadius:6,border:`1px solid ${accent}`,background:`${accent}12`,color:accent,fontSize:9,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🖥 Open editor</button>
                    </div>
                  </div>
                </div>
                {/* Expanded tag editor */}
                {isEditing&&<div style={{padding:"10px 12px",borderTop:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"rgba(0,0,0,0.01)"}}>
                  {/* Playable video — admin watches here before tagging (Fix 4). Cloudinary uses <video>, YouTube uses LazyYT/iframe. */}
                  <div onClick={e=>e.stopPropagation()} style={{marginBottom:10,borderRadius:8,overflow:"hidden",background:"#000",aspectRatio:"16/9"}}>
                    {v.source==="cloudinary"&&v.videoUrl
                      ? <video src={v.videoUrl} poster={v.thumb} controls preload="none" style={{width:"100%",height:"100%",objectFit:"contain",background:"#000"}}/>
                      : <LazyYT src={`https://www.youtube.com/embed/${v.id}`} poster={v.thumb}/>}
                  </div>
                  {/* AI Draft banner */}
                  {hasDraft&&<div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 12px",marginBottom:10,borderRadius:8,background:"rgba(201,169,110,0.12)",border:`1px solid ${accent}40`}}>
                    <span style={{fontSize:11,color:accent,fontWeight:600,flex:1}}>🤖 AI suggested — review & save</span>
                    <button onClick={()=>{const nt={...ytVideoTags,[v.id]:{...aiVideoDraft.tags,_aiTagged:true,_savedBy:authUser?.name||"—",_savedAt:Date.now()}};saveYtTags(nt);setAiVideoDraft(null);showMsg("✓ AI tags saved — video now live on Browse","green");}} style={{padding:"4px 12px",borderRadius:6,border:"none",background:accent,color:"#1a1a2e",fontSize:10,fontWeight:600,cursor:"pointer"}}>✓ Save</button>
                    <button onClick={()=>{setAiVideoDraft(null);setYtTagEdit(null);}} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:10,fontWeight:500,cursor:"pointer"}}>✕ Discard</button>
                  </div>}
                  {/* Row 1: Venue (2-level chip picker — mirrors Browse page pattern) */}
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Venue</div>
                    {(() => {
                      const curVenue = tag.venue || "";
                      const isInhouse = curVenue && allInhouseVenues.includes(curVenue);
                      // Auto-sync group when venue is already set
                      const activeGroup = tagVenueGroup || (isInhouse ? "inhouse" : (curVenue ? "outside" : ""));
                      const setVidVenue = (val) => {
                        const nt = { ...ytVideoTags, [v.id]: { ...tag, venue: val || undefined, venueCustom: undefined } };
                        if (hasDraft) { setAiVideoDraft(p => ({ ...p, tags: { ...p.tags, venue: val || undefined, venueCustom: undefined } })); } else { saveYtTags(nt); }
                      };
                      const outsideFiltered = customOutdoor.filter(o => tagOutsideSub === "empanelled" ? o.empanelled : tagOutsideSub === "other" ? !o.empanelled : true);
                      return <>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          <div onClick={()=>{setTagVenueGroup("inhouse");setTagOutsideSub("all");}} style={S.pill(activeGroup==="inhouse")}>Inhouse</div>
                          <div onClick={()=>{setTagVenueGroup("outside");setTagOutsideSub("all");}} style={S.pill(activeGroup==="outside")}>Outside</div>
                          {curVenue&&<div onClick={()=>{setVidVenue("");setTagVenueGroup("");}} style={{padding:"4px 8px",borderRadius:12,fontSize:9,cursor:"pointer",color:textS,border:`1px dashed ${border}`}}>✕ {curVenue}</div>}
                        </div>
                        {activeGroup==="inhouse"&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                          {allInhouseVenues.map(vn=>{const on=curVenue===vn;return <div key={vn} onClick={()=>setVidVenue(on?"":vn)} style={{...S.pill(on),background:on?`${accent}22`:"transparent",color:on?accentText:textS,border:on?`1px solid ${accent}55`:`1px solid ${border}`,fontSize:10,padding:"4px 10px"}}>{vn}</div>;})}
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
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Tier</div>
                      <select value={tag.tier||""} onChange={e=>{if(hasDraft){setAiVideoDraft(p=>({...p,tags:{...p.tags,tier:e.target.value||undefined}}));}else{const nt={...ytVideoTags,[v.id]:{...tag,tier:e.target.value||undefined}};saveYtTags(nt);}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
                        <option value="">—</option>
                        {taxOr(taxonomy.tier, CATEGORIES).map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>Indoor / Outdoor</div>
                      <select value={tag.io||""} onChange={e=>{if(hasDraft){setAiVideoDraft(p=>({...p,tags:{...p.tags,io:e.target.value||undefined}}));}else{const nt={...ytVideoTags,[v.id]:{...tag,io:e.target.value||undefined}};saveYtTags(nt);}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
                        <option value="">—</option>
                        {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(v=><option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    {/* §23 Phase 2.9c — palette per video (drives Build screen paint picker grouping) */}
                    <div>
                      <div style={{fontSize:9,color:textS,marginBottom:3,fontWeight:600}}>🎨 Palette</div>
                      <select value={tag.palette||""} onChange={e=>{if(hasDraft){setAiVideoDraft(p=>({...p,tags:{...p.tags,palette:e.target.value||undefined}}));}else{const nt={...ytVideoTags,[v.id]:{...tag,palette:e.target.value||undefined}};saveYtTags(nt);}}} style={{...S.select,fontSize:10,width:"100%",padding:"5px 6px",marginBottom:0}}>
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
                        return <span key={f} onClick={()=>{
                          const cur=Array.isArray(tag.fn)?tag.fn:(tag.fn?[tag.fn]:[]);
                          const next=cur.includes(f)?cur.filter(x=>x!==f):[...cur,f];
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:{...p.tags,fn:next.length?next:undefined}}));}else{const nt={...ytVideoTags,[v.id]:{...tag,fn:next.length?next:undefined}};saveYtTags(nt);}
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
                        return <span key={s} onClick={()=>{
                          const cur=tag.styles||[];
                          const next=cur.includes(s)?cur.filter(x=>x!==s):[...cur,s];
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:{...p.tags,styles:next.length?next:undefined}}));}else{const nt={...ytVideoTags,[v.id]:{...tag,styles:next.length?next:undefined}};saveYtTags(nt);}
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
                        return <span key={c} onClick={()=>{
                          const cur=tag.colors||[];
                          const next=cur.includes(c)?cur.filter(x=>x!==c):[...cur,c];
                          if(hasDraft){setAiVideoDraft(p=>({...p,tags:{...p.tags,colors:next.length?next:undefined}}));}else{const nt={...ytVideoTags,[v.id]:{...tag,colors:next.length?next:undefined}};saveYtTags(nt);}
                        }} style={{fontSize:9,padding:"3px 8px",borderRadius:6,cursor:"pointer",fontWeight:600,
                          background:sel?"rgba(249,115,22,0.2)":"transparent",
                          border:`1px solid ${sel?"rgba(249,115,22,0.5)":border}`,
                          color:sel?"#F97316":textS}}>{c}</span>;
                      })}
                    </div>
                  </div>
                  {/* ═══ PHOTOS BY ZONE (Phase 2) — every zone on one screen, ranked candidates, one-click assign ═══ */}
                  <div style={{marginBottom:8,borderTop:`1px solid ${border}`,paddingTop:10}}>
                    <div style={{fontSize:10,color:textS,fontWeight:600,marginBottom:6}}>📸 Photos by zone — tap a thumbnail to assign, or hit <span style={{color:accent,fontWeight:700}}>🔍 Big view</span> to pick from large photos in a full-screen popup.</div>
                    {(taxonomy.areasElements||[]).map((zone,zi)=>{
                      const zp=tag.zonePhotos||{};
                      const libId=zp[zone];
                      const chosen=libId?libItems.find(li=>li.id===libId):null;
                      const {exact,similar}=getZoneMatches(zone,tag);
                      const cands=[...exact,...similar];
                      // keep the chosen photo visible even if it isn't in the top matches
                      const stripList=[...(chosen&&!cands.find(c=>c.id===chosen.id)?[chosen]:[]),...cands].slice(0,14);
                      const setZonePhoto=(id)=>{const np={...zp};if(id)np[zone]=id;else delete np[zone];const nt={...ytVideoTags,[v.id]:{...tag,zonePhotos:np}};saveYtTags(nt);};
                      return <div key={zone} style={{padding:"8px 0",borderBottom:zi<(taxonomy.areasElements||[]).length-1?`1px solid ${border}`:"none"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                          <span style={{fontSize:14,width:20,textAlign:"center"}}>{ZONE_ICONS[zone]||"📍"}</span>
                          <span style={{fontSize:11,fontWeight:600,color:textP,flex:1}}>{zone}</span>
                          {chosen?<span style={{fontSize:9,color:"#059669",fontWeight:600,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>✓ {chosen.name||"selected"}</span>:<span style={{fontSize:9,color:textS}}>{cands.length} match{cands.length===1?"":"es"}</span>}
                          <span onClick={(e)=>{e.stopPropagation();setZonePickerVid(v.id);setZonePickerZone(zone);setZpFilterOpen(false);setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],venue:""});}} title="Open the big full-screen picker for this zone" style={{fontSize:9,fontWeight:700,cursor:"pointer",flexShrink:0,padding:"3px 9px",borderRadius:6,border:`1px solid ${accent}`,color:accent,background:`${accent}12`}}>🔍 Big view</span>
                          {chosen&&<span onClick={(e)=>{e.stopPropagation();setZonePhoto(null);}} style={{fontSize:10,color:"#E11D48",cursor:"pointer",fontWeight:700,flexShrink:0}}>× clear</span>}
                        </div>
                        {stripList.length===0
                          ? <div style={{fontSize:9,color:textS,paddingLeft:28}}>No matching photos yet — use "More…" or tag more library photos for this zone.</div>
                          : <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4,paddingLeft:28}} onClick={e=>e.stopPropagation()}>
                              {stripList.map(li=>{const isSel=li.id===libId;return <div key={li.id} onClick={()=>setZonePhoto(isSel?null:li.id)} title={li.name||""} style={{flexShrink:0,width:92,borderRadius:8,overflow:"hidden",cursor:"pointer",border:isSel?"2px solid #059669":`1px solid ${border}`,background:cardBg}}>
                                <img src={li.url} alt="" loading="lazy" style={{width:92,height:60,objectFit:"cover",display:"block",opacity:isSel?1:0.92}} onError={e=>{e.target.style.display="none"}}/>
                                <div style={{padding:"3px 5px",fontSize:8,fontWeight:isSel?700:500,color:isSel?"#059669":textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{isSel?"✓ ":""}{li.name||"Untitled"}</div>
                              </div>;})}
                            </div>}
                      </div>;
                    })}
                    {Object.keys(tag.zonePhotos||{}).length>0&&<div style={{fontSize:9,color:textS,marginTop:6}}>{Object.keys(tag.zonePhotos||{}).length} of {(taxonomy.areasElements||[]).length} zones assigned</div>}
                  </div>
                  {/* Quick actions */}
                  <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap"}}>
                    <button onClick={(e)=>{e.stopPropagation();const nh={...hiddenVideos};if(nh[v.id])delete nh[v.id];else nh[v.id]=true;saveHiddenVideos(nh);showMsg(nh[v.id]?"Video hidden":"Video visible","green");}} style={{...S.btn(false),fontSize:9,padding:"4px 10px"}}>
                      {hiddenVideos[v.id]?"👁 Unhide":"👁‍🗨 Hide"}
                    </button>
                    {v.source==="cloudinary"&&<button onClick={(e)=>{e.stopPropagation();if(!confirm("Delete this video from app?"))return;saveManualVideos(manualVideos.filter(m=>m.id!==v.id),[v.id]);const nt={...ytVideoTags};delete nt[v.id];saveYtTags(nt);setYtTagEdit(null);}} style={{...S.btn(false),fontSize:9,padding:"4px 10px",color:"#E11D48"}}>🗑 Delete</button>}
                    {hasTag&&<button onClick={()=>{const nt={...ytVideoTags};delete nt[v.id];saveYtTags(nt);}} style={{...S.btn(false),fontSize:9,padding:"4px 10px",color:"#E11D48"}}>Clear Tags</button>}
                    {/* Verify video tags — marks reviewed + logs a video contribution */}
                    <button onClick={()=>{const cur=ytVideoTags[v.id]||{};const nt={...ytVideoTags,[v.id]:{...cur,_verified:true,_verifiedBy:authUser?.name||"—",_verifiedAt:Date.now()}};saveYtTags(nt);logCorrection?.({photoId:v.id,photoName:v.title,source:"video",kind:"video"});showMsg("✅ Video tags verified","green");}} style={{...S.btn(true),fontSize:9,padding:"4px 10px",background:"#059669"}}>{savedTag._verified?"✅ Verified":"✅ Verify tags"}</button>
                    <button onClick={()=>aiTagVideo(v.id)} disabled={aiTaggingVideo===v.id} style={{...S.btn(false),fontSize:9,padding:"4px 10px",color:accent,opacity:aiTaggingVideo===v.id?0.5:1}}>{aiTaggingVideo===v.id?"⏳ Tagging...":"🤖 AI Tag"}</button>
                    <button onClick={()=>{setYtTagEdit(null);setCldOpen(null);}} style={{...S.btn(true),fontSize:9,padding:"4px 10px"}}>Done</button>
                  </div>
                </div>}
              </div>);
            })}
          </div>
        </div>
      )}
      {/* ═══ FULL-SCREEN LIBRARY PICKER MODAL ═══ */}
      {zonePickerVid&&zonePickerZone&&(()=>{
        const vTag=ytVideoTags[zonePickerVid]||{};
        const {exact:rawExact,similar:rawSimilar,fallback:rawFallback}=getZoneMatches(zonePickerZone,vTag);
        const exact=zpHasFilters?rawExact.filter(zpFilterPhoto):rawExact;
        const similar=zpHasFilters?rawSimilar.filter(zpFilterPhoto):rawSimilar;
        const fallback=zpHasFilters?rawFallback.filter(zpFilterPhoto):rawFallback;
        const totalRaw=rawExact.length+rawSimilar.length+rawFallback.length;
        const totalFiltered=exact.length+similar.length+fallback.length;
        const currentLibId=(vTag.zonePhotos||{})[zonePickerZone];
        const selectPhoto=(libId)=>{
          const zp={...(vTag.zonePhotos||{}), [zonePickerZone]:libId};
          const nt={...ytVideoTags,[zonePickerVid]:{...vTag,zonePhotos:zp}};
          saveYtTags(nt);
          setZonePickerVid(null);setZonePickerZone(null);
        };
        const calcElCost=(li)=>{
          if(!(li.elements||[]).length)return 0;
          return calcElsCost(li.elements, true, null);
        };
        const renderCard=(li)=>{
          const isCurrent=li.id===currentLibId;
          const cost=calcElCost(li);
          return <div key={li.id} onClick={()=>selectPhoto(li.id)} style={{borderRadius:10,border:isCurrent?`2px solid ${accent}`:`1px solid ${border}`,overflow:"hidden",cursor:"pointer",background:cardBg,position:"relative"}}>
            <div style={{position:"relative"}}>
              <img src={li.url} alt={li.name||""} style={{width:"100%",height:200,objectFit:"cover",display:"block"}} loading="lazy" onError={e=>{e.target.style.background=isDark?"#1a1a2e":"#f0f0f0";e.target.style.height="200px";}}/>
              {isCurrent&&<div style={{position:"absolute",top:4,right:4,background:accent,color:"#fff",fontSize:9,padding:"2px 8px",borderRadius:4,fontWeight:700}}>Current</div>}
              {cost>0&&<div style={{position:"absolute",top:4,left:4,background:"rgba(0,0,0,0.75)",color:"#fff",fontSize:10,padding:"2px 8px",borderRadius:4,fontWeight:700}}>{fmt(cost)}</div>}
            </div>
            <div style={{padding:"6px 8px"}}>
              <div style={{fontSize:11,fontWeight:600,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{li.name||"Untitled"}</div>
              <div style={{fontSize:9,color:textS}}>{(li.elements||[]).length} elements</div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:3}}>
                {(li.tags?.colorPalette||[]).map(c=><span key={c} style={{fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(249,115,22,0.12)",color:"#F97316"}}>{c}</span>)}
                {(li.tags?.designStyle||[]).map(s=><span key={s} style={{fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(236,72,153,0.12)",color:"#EC4899"}}>{s}</span>)}
                {(li.tags?.categoryTier||[]).map(t=><span key={t} style={{fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(148,163,184,0.15)",color:textS}}>{t}</span>)}
              </div>
            </div>
          </div>;
        };
        const priorityLabels = filterPriority.map(p=>p.label).join(" > ");
        return <div style={{position:"fixed",inset:0,zIndex:9999,background:isDark?"rgba(0,0,0,0.92)":"rgba(0,0,0,0.6)",display:"flex",justifyContent:"center",alignItems:"flex-start",overflow:"auto",padding:20}} onClick={()=>{setZonePickerVid(null);setZonePickerZone(null);}}>
          <div onClick={e=>e.stopPropagation()} style={{background:bg,borderRadius:16,width:"96vw",maxWidth:1500,maxHeight:"94vh",overflow:"auto",border:`1px solid ${border}`}}>
            <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:bg,zIndex:1}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:textP}}>{ZONE_ICONS[zonePickerZone]||"📍"} Select photo for {zonePickerZone}</div>
                <div style={{fontSize:12,color:textS,marginTop:2}}>Priority: {priorityLabels}</div>
              </div>
              <span onClick={()=>{setZonePickerVid(null);setZonePickerZone(null);}} style={{fontSize:18,cursor:"pointer",color:textS,fontWeight:700,padding:"4px 8px"}}>✕</span>
            </div>
            <div style={{padding:"10px 20px",borderBottom:`1px solid ${border}`,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:10,color:textS}}>Video tags:</span>
              {vTag.tier&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(148,163,184,0.2)",color:textP,fontWeight:600}}>{vTag.tier}</span>}
              {(vTag.colors||[]).map(c=><span key={c} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(249,115,22,0.15)",color:"#F97316",fontWeight:600}}>{c}</span>)}
              {(vTag.styles||[]).map(s=><span key={s} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:600}}>{s}</span>)}
              {(Array.isArray(vTag.fn)?vTag.fn:(vTag.fn?[vTag.fn]:[])).map(f=><span key={f} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(168,85,247,0.15)",color:"#A855F7",fontWeight:600}}>{f}</span>)}
              {vTag.io&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"#10B981",fontWeight:600}}>{vTag.io}</span>}
            </div>
            {/* Filter toggle + panel */}
            <div style={{padding:"8px 20px",borderBottom:`1px solid ${border}`,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <span onClick={()=>setZpFilterOpen(!zpFilterOpen)} style={{padding:"4px 12px",borderRadius:8,background:zpFilterOpen?`${accent}22`:"transparent",border:`1px solid ${zpFilterOpen?accent:border}`,color:zpFilterOpen?accent:textS,fontSize:11,fontWeight:500,cursor:"pointer"}}>🔍 Filters {zpFilterOpen?"▲":"▼"}</span>
              {zpHasFilters&&<span style={{fontSize:10,color:textS}}>{totalFiltered} of {totalRaw}</span>}
              {zpHasFilters&&<span onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],venue:""})} style={{fontSize:10,color:"#E11D48",cursor:"pointer"}}>Clear</span>}
            </div>
            {zpFilterOpen&&<div style={{padding:"10px 20px",borderBottom:`1px solid ${border}`,background:isDark?"rgba(201,169,110,0.03)":"rgba(201,169,110,0.05)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:accent,marginBottom:4}}>Event type</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {taxOr(taxonomy.eventType, FUNCTIONS).map(v=><span key={v} onClick={()=>zpToggleFilter("eventType",v)} style={{padding:"3px 9px",borderRadius:10,fontSize:10,cursor:"pointer",background:zpFilters.eventType.includes(v)?accent:"transparent",color:zpFilters.eventType.includes(v)?isDark?"#1a1a2e":"#fff":textS,border:`1px solid ${zpFilters.eventType.includes(v)?accent:border}`,fontWeight:zpFilters.eventType.includes(v)?600:400}}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:accent,marginBottom:4}}>Venue type</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(v=><span key={v} onClick={()=>zpToggleFilter("venueType",v)} style={{padding:"3px 9px",borderRadius:10,fontSize:10,cursor:"pointer",background:zpFilters.venueType.includes(v)?accent:"transparent",color:zpFilters.venueType.includes(v)?isDark?"#1a1a2e":"#fff":textS,border:`1px solid ${zpFilters.venueType.includes(v)?accent:border}`,fontWeight:zpFilters.venueType.includes(v)?600:400}}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:accent,marginBottom:4}}>Design style</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]).map(v=><span key={v} onClick={()=>zpToggleFilter("designStyle",v)} style={{padding:"3px 9px",borderRadius:10,fontSize:10,cursor:"pointer",background:zpFilters.designStyle.includes(v)?accent:"transparent",color:zpFilters.designStyle.includes(v)?isDark?"#1a1a2e":"#fff":textS,border:`1px solid ${zpFilters.designStyle.includes(v)?accent:border}`,fontWeight:zpFilters.designStyle.includes(v)?600:400}}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:accent,marginBottom:4}}>Color palette</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"])).map(v=><span key={v} onClick={()=>zpToggleFilter("colorPalette",v)} style={{padding:"3px 9px",borderRadius:10,fontSize:10,cursor:"pointer",background:zpFilters.colorPalette.includes(v)?accent:"transparent",color:zpFilters.colorPalette.includes(v)?isDark?"#1a1a2e":"#fff":textS,border:`1px solid ${zpFilters.colorPalette.includes(v)?accent:border}`,fontWeight:zpFilters.colorPalette.includes(v)?600:400}}>{v}</span>)}
                  </div>
                </div>
              </div>
            </div>}
            <div style={{padding:20}}>
              {exact.length>0&&<>
                <div style={{fontSize:12,fontWeight:700,color:accent,marginBottom:8}}>Best matches ({exact.length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:12,marginBottom:20}}>
                  {exact.map(renderCard)}
                </div>
              </>}
              {similar.length>0&&<>
                <div style={{fontSize:12,fontWeight:600,color:textS,marginBottom:8}}>Similar options ({similar.length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:12,marginBottom:20}}>
                  {similar.map(renderCard)}
                </div>
              </>}
              {fallback.length>0&&<>
                <div style={{fontSize:12,fontWeight:600,color:textS,marginBottom:8}}>More options ({fallback.length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:12,marginBottom:20}}>
                  {fallback.map(renderCard)}
                </div>
              </>}
              {exact.length===0&&similar.length===0&&fallback.length===0&&<div style={{textAlign:"center",padding:40,color:textS}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>No photos in Library yet</div>
                <div style={{fontSize:12}}>Add photos to Library and tag them to see options here.</div>
              </div>}
            </div>
          </div>
        </div>;
      })()}

      {/* ═══ FULL-SCREEN VIDEO TAG EDITOR — all metadata + a left/right photo scroller per zone ═══ */}
      {bigTagVid && (() => {
        const v = allVideos.find(x => x.id === bigTagVid) || {};
        const vTag = ytVideoTags[bigTagVid] || {};
        const updTag = (patch) => saveYtTags({ ...ytVideoTags, [bigTagVid]: { ...vTag, ...patch } });
        const setZP = (zone, id) => { const zp = { ...(vTag.zonePhotos || {}) }; if (id) zp[zone] = id; else delete zp[zone]; updTag({ zonePhotos: zp }); };
        const toggleArr = (field, val) => { const cur = Array.isArray(vTag[field]) ? vTag[field] : []; const next = cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val]; updTag({ [field]: next.length ? next : undefined }); };
        const fnArr = Array.isArray(vTag.fn) ? vTag.fn : (vTag.fn ? [vTag.fn] : []);
        const palettes = imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p => p.name) : taxOr(taxonomy.colorPalette, []);
        const zones = taxonomy.areasElements || [];
        const assigned = Object.keys(vTag.zonePhotos || {}).length;
        const lbl = { fontSize: 11, fontWeight: 700, color: textS, marginBottom: 5 };
        const chipRow = { display: "flex", flexWrap: "wrap", gap: 5 };
        const chip = (label, on, onClick) => <span key={label} onClick={onClick} style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontWeight: on ? 700 : 500, background: on ? accent : "transparent", color: on ? (isDark ? "#1a1a2e" : "#fff") : textS, border: `1px solid ${on ? accent : border}` }}>{label}</span>;
        return <div onClick={() => setBigTagVid(null)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.85)", display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto", padding: "2vh 1vw" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: bg, borderRadius: 16, width: "98vw", maxWidth: 1600, minHeight: "92vh", border: `1px solid ${border}`, overflow: "hidden" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 2, background: bg, borderBottom: `1px solid ${border}`, padding: "14px 22px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: textP, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎬 {v.title || "Video"}</div>
                <div style={{ fontSize: 11, color: textS, marginTop: 2 }}>{assigned} of {zones.length} zones have a photo · changes save instantly</div>
              </div>
              <button onClick={() => aiTagVideoSave?.(bigTagVid)} disabled={aiTaggingVideo === bigTagVid} style={{ ...S.btn(false), fontSize: 12, padding: "8px 14px", color: accent, opacity: aiTaggingVideo === bigTagVid ? 0.5 : 1 }}>{aiTaggingVideo === bigTagVid ? "⏳ Tagging…" : "🤖 AI Tag"}</button>
              <button onClick={() => { const nh = { ...hiddenVideos }; if (nh[bigTagVid]) delete nh[bigTagVid]; else nh[bigTagVid] = true; saveHiddenVideos(nh); showMsg(nh[bigTagVid] ? "🙈 Video hidden — won't show in the app or Needs-review" : "👁 Video visible again", "green"); }} style={{ ...S.btn(false), fontSize: 12, padding: "8px 14px", color: hiddenVideos[bigTagVid] ? "#059669" : "#E11D48" }}>{hiddenVideos[bigTagVid] ? "👁 Unhide" : "🙈 Hide"}</button>
              <button onClick={() => { const nt = { ...ytVideoTags, [bigTagVid]: { ...vTag, _verified: true, _verifiedBy: authUser?.name || "—", _verifiedAt: Date.now() } }; saveYtTags(nt); logCorrection?.({ photoId: bigTagVid, photoName: v.title, source: "video", kind: "video" }); showMsg("✅ Video tags verified", "green"); }} style={{ ...S.btn(true), fontSize: 12, padding: "8px 16px", background: "#059669" }}>{vTag._verified ? "✅ Verified" : "✅ Verify"}</button>
              <button onClick={() => setBigTagVid(null)} style={{ ...S.btn(false), fontSize: 13, padding: "8px 16px" }}>✕ Close</button>
            </div>
            <div style={{ padding: "16px 22px" }}>
              {/* Playable video — watch to see what elements it includes before tagging */}
              <div style={{ marginBottom: 16, borderRadius: 12, overflow: "hidden", background: "#000", maxWidth: 760, aspectRatio: "16/9" }}>
                {v.source === "cloudinary" && v.videoUrl
                  ? <video src={v.videoUrl} poster={v.thumb} controls preload="none" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
                  : <LazyYT src={`https://www.youtube.com/embed/${bigTagVid}`} poster={v.thumb} />}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginBottom: 18 }}>
                <div><div style={lbl}>Tier</div><div style={chipRow}>{["Silver", "Gold", "Platinum"].map(t => chip(t, vTag.tier === t, () => updTag({ tier: vTag.tier === t ? undefined : t })))}</div></div>
                <div><div style={lbl}>Palette</div><select value={vTag.palette || ""} onChange={e => updTag({ palette: e.target.value || undefined })} style={{ ...S.select, width: "100%" }}><option value="">—</option>{palettes.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                <div><div style={lbl}>Event type</div><div style={chipRow}>{taxOr(taxonomy.eventType, FUNCTIONS).map(f => chip(f, fnArr.includes(f), () => toggleArr("fn", f)))}</div></div>
                <div><div style={lbl}>In / Out</div><div style={chipRow}>{taxOr(taxonomy.venueType, ["Indoor", "Outdoor"]).map(io => chip(io, vTag.io === io, () => updTag({ io: vTag.io === io ? undefined : io })))}</div></div>
                <div><div style={lbl}>Colors</div><div style={chipRow}>{palettes.map(c => chip(c, (vTag.colors || []).includes(c), () => toggleArr("colors", c)))}</div></div>
                <div><div style={lbl}>Design style</div><div style={chipRow}>{(taxonomy.designStyle || []).map(s => chip(s, (vTag.styles || []).includes(s), () => toggleArr("styles", s)))}</div></div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 8 }}>📸 Photo per zone — scroll ◀ ▶ and click to pick</div>
              {zones.map(zone => {
                const zp = vTag.zonePhotos || {};
                const chosenId = zp[zone];
                const { exact, similar, fallback } = getZoneMatches(zone, vTag);
                const cands = [...exact, ...similar, ...fallback];
                const chosen = chosenId ? libItems.find(l => l.id === chosenId) : null;
                const strip = [...(chosen && !cands.find(c => c.id === chosen.id) ? [chosen] : []), ...cands].slice(0, 40);
                return <div key={zone} style={{ padding: "10px 0", borderBottom: `1px solid ${border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 18 }}>{ZONE_ICONS[zone] || "📍"}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: textP, flex: 1 }}>{zone}</span>
                    {chosen ? <span style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>✓ {chosen.name || "selected"}</span> : <span style={{ fontSize: 11, color: textS }}>{strip.length} options</span>}
                    {chosen && <span onClick={() => setZP(zone, null)} style={{ fontSize: 11, color: "#E11D48", cursor: "pointer", fontWeight: 700 }}>× clear</span>}
                  </div>
                  {strip.length === 0 ? <div style={{ fontSize: 11, color: textS, paddingLeft: 28 }}>No matching photos for this zone yet — tag more library photos for it.</div> :
                    <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                      {strip.map(li => { const isSel = li.id === chosenId; return <div key={li.id} onClick={() => setZP(zone, isSel ? null : li.id)} title={li.name || ""} style={{ flexShrink: 0, width: 190, borderRadius: 10, overflow: "hidden", cursor: "pointer", border: isSel ? `3px solid #059669` : `1px solid ${border}`, background: cardBg }}>
                        <img src={li.url} alt="" loading="lazy" style={{ width: 190, height: 130, objectFit: "cover", display: "block", opacity: isSel ? 1 : 0.9 }} onError={e => { e.target.style.display = "none"; }} />
                        <div style={{ padding: "5px 8px" }}>
                          <div style={{ fontSize: 11, fontWeight: isSel ? 700 : 600, color: isSel ? "#059669" : textP, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isSel ? "✓ " : ""}{li.name || "Untitled"}</div>
                          <div style={{ fontSize: 9, color: textS }}>{(li.elements || []).length} elements</div>
                        </div>
                      </div>; })}
                    </div>}
                </div>;
              })}
            </div>
          </div>
        </div>;
      })()}
    </div>
  );
}

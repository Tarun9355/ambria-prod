import { Fragment, useState, useRef, useEffect } from "react";
import {
  TIER_TO_CAT, ZONE_TYPE_TO_AREA, getCat, taxOr, FUNCTIONS,
  MASK_OPTS, PLAT_OPTS, CARP_OPTS,
} from "../../../lib/studio/taxonomy";
import { resolveTrussConfig } from "../../../lib/studio/pricing";
import { qtyUsedElsewhereInBuild } from "../../../lib/studio/dealAvailability";
import { isHiddenSubcat } from "../../../lib/rateCard";
import { fixedVenueFor } from "../../../lib/ims/fixedVenues";
import { itemImsSubcat } from "../../../lib/ims/helpers";
import LazyYT from "../../../components/studio/LazyYT.jsx";
import KitComponentsEditor from "../../../components/shared/KitComponentsEditor";

// Temporary crowd-sourced library cleanup (Phase 1b). While true, anyone on the build screen
// can push a corrected element list back to the master library photo ("Save correction to
// master"). Flip to false (one-line deploy) once all photos are verified to remove the button.
const CORRECTION_MODE = true;

export default function StudioBuild({ ctx }) {
  const {
    // theme / chrome
    S, isDark, accent, border, textS, textP, cardBg, fmt, cat,
    // events / library / video sources
    events, libItems, sourceEvent, sourceVideo, ytVideoTags, allVideos,
    getFullCost, findTemplate, templates,
    // client / function meta
    clientName, clientDate, activeFnMeta, venue, fn, extraFunctions, setExtraFunctions,
    studioFloralData, venueParents, loadAvailability, getStudioAvailable, activeBlocksForDate,
    clientPalette, setClientPalette, activeFnIdx, collectAllFunctionData, rcSubcatFactors,
    // palette / colour catalogues
    imsPaletteCatalogue, imsColourCatalogue,
    // venues (for named-venue correction + the zone-photo Venue pill filter)
    allInhouseVenues = [], customOutdoor = [], allVenueData = {}, allOutdoorDB = [],
    // date demand
    dateTypes, clientLedger, activeClientId,
    // build canvas
    showCosts, setShowCosts, grandTotal, totalCost, transportCalc,
    savedInsps, setStep, setPreviewImg,
    floralRatio, setFloralRatio,
    zoneKeys, customZones, setCustomZones, zoneLabelsD, zoneMeta,
    enabledEls, setEnabledEls, elTiers, setElTiers, customMode, toggleEl,
    zoneElements, setZoneElements, zoneConfig, setZoneConfig, setActiveZones,
    calcElsCost, calcStructCost, calcPhotoCost, getElPrice, applyFloralRatio,
    elSelectedPhoto, selectElPhoto, elNotes, setElNotes,
    setElGallery, setGalleryIdx,
    newCzName, setNewCzName,
    // uploads / ai
    zoneUploading, handleZoneUpload, zoneAiFilling, setZoneAiFilling, aiTagImage,
    zoneElSearch, setZoneElSearch, zonePrintSearch, setZonePrintSearch,
    // zone-photo filters
    zpFilterOpen, setZpFilterOpen, zpHasFilters, zpFilters, setZpFilters, zpToggleFilter, zpFilterPhoto,
    // rate card — kept for legacy/AI-tagged elements without invId
    rcItems, rcCats, rcIsSMB, isSubTagHidden,
    // IMS inventory — "+Add element" sources from here now, not the Rate Card
    imsInventory,
    // Print material rates (IMS Admin → Settings → 🖨️ Print Materials)
    imsPrintMaterials,
    // Pure flower-recipe elements with no inventory backing (e.g. "Flower Garden") — addable
    // alongside inventory items in the "+Add element" search
    recipeOnlyPatterns,
    // taxonomy
    taxonomy,
    // paint / deal check
    dealCheckData, normalizePaintAllocation, paintPillLabel, isSubcatPaintable,
    PAINT_TOKENS_FALLBACK, maxRepaintCostInSubcat, imsDefaultPaintCost, setPaintPickerTarget,
    // custom items
    dcCustomItems, setDcCustomItems, setDcCustomModal,
    // video modal
    setVideoModal, setVideoPlaying,
    // misc
    showMsg, saveLib, authUser, logCorrection,
    // point-lookup safety net (lazy library cache — see StudioApp.jsx)
    ensureLibItems,
  } = ctx;

  const getLibPhotosForZone = ctx.getLibPhotosForZone;
  // ═══ Zone-photo filter pills — shared style + venue-type-aware venue list ═══
  const zpPill = (active) => ({ padding: "2px 8px", borderRadius: 8, fontSize: 9, cursor: "pointer", background: active ? accent : "transparent", color: active ? (isDark ? "#1a1a2e" : "#fff") : textS, border: `1px solid ${active ? accent : border}`, fontWeight: active ? 600 : 400 });
  const zpIndoorVenues = allInhouseVenues.filter(v => (allVenueData[v]?.type || "Outdoor") === "Indoor");
  const zpOutdoorVenues = [
    ...allInhouseVenues.filter(v => (allVenueData[v]?.type || "Outdoor") !== "Indoor"),
    ...(allOutdoorDB || []).map(v => v.name).filter(Boolean),
  ];
  const zpWantIndoor = (zpFilters.venueType || []).includes("Indoor");
  const zpWantOutdoor = (zpFilters.venueType || []).some(v => v === "Outdoor" || v === "Semi-Outdoor");
  const zpVenueChoices = zpWantIndoor && !zpWantOutdoor ? zpIndoorVenues
    : zpWantOutdoor && !zpWantIndoor ? zpOutdoorVenues
    : Array.from(new Set([...zpIndoorVenues, ...zpOutdoorVenues]));
  // "Correct photo tags" modal target — { libId, zoneKey, name, tags } (Phase 1b: full-tag correction)
  const [correctPhoto, setCorrectPhoto] = useState(null);
  const [corrVenueGrp, setCorrVenueGrp] = useState(""); // build correction modal: inhouse|outside venue group
  const [gridZones, setGridZones] = useState({}); // per-zone: show the photo picker as a wrapping grid vs horizontal strip
  // Fixed-venue "Repeat setup" — when the current function's venue is a fixed venue, each zone can be
  // marked ♻️ Repeat (reuse the standing setup → discounted rental, no build labour; venue's fixed crew
  // covers it) vs ✨ Fresh (default). Stored in zoneConfig[k].repeat so it flows to Deal Check.
  // Prefer dealCheckData (populated once Deal Check opens); fall back to the mount-loaded config so the
  // Repeat/Fresh chip shows in Build without needing to open Deal Check first.
  const _fvCfg = {
    fixedVenues: (dealCheckData?.fixedVenues && dealCheckData.fixedVenues.length) ? dealCheckData.fixedVenues : (studioFloralData?.fixedVenues || []),
    venueParents: dealCheckData?.venueParents || venueParents || {},
  };
  const fixedVenueHere = fixedVenueFor(_fvCfg, activeFnMeta?.venue || venue);

  // Live soft-blocking: how much of an inventory item is left for THIS event, after
  // netting out both other events' commitments (getStudioAvailable) and whatever
  // sibling zones/functions of this same deal have already used (qtyUsedElsewhereInBuild).
  // exclude={fnIdx,zoneKey} → whole-zone exclusion; add elIdx to exclude just one row.
  // Returns null when the item's stock isn't otherwise touched this deal (no badge needed) —
  // only surfaces a signal once some OTHER zone/function has actually drawn on it.
  const remainingForItem = (itemId, zoneKey, elIdx) => {
    const it = (imsInventory || []).find(i => i.id === itemId);
    if (!it) return null;
    const fns = collectAllFunctionData ? collectAllFunctionData() : [];
    const exclude = elIdx == null ? { fnIdx: activeFnIdx, zoneKey } : { fnIdx: activeFnIdx, zoneKey, elIdx };
    const usedElsewhere = qtyUsedElsewhereInBuild(itemId, fns, imsInventory, exclude, activeFnMeta?.date || clientDate);
    if (usedElsewhere <= 0) return null;
    const otherEventsAvail = getStudioAvailable(it, activeBlocksForDate);
    return Math.max(0, otherEventsAvail - usedElsewhere);
  };

  const isRepeat = (k) => !!(zoneConfig[k] && zoneConfig[k].repeat);
  const toggleRepeat = (k) => setZoneConfig(p => ({ ...p, [k]: { ...(p[k] || {}), repeat: !(p[k] && p[k].repeat) } }));

  // ── Scale By (Centre Pieces) ─────────────────────────────────────────────────────────────────
  // A single "set of N" multiplier for a zone: instead of hand-bumping each element (1 table, 6 chairs…),
  // the salesperson sets Scale By = N and every element count is rescaled proportionally. Because it
  // rewrites the actual element qtys, pricing, Deal Check and manpower all follow automatically. Stored
  // in zoneConfig[k].scale for the field value + proportional math.
  const zoneScaleVal = (k) => Math.max(1, Math.round(Number(zoneConfig[k]?.scale) || 1));
  const setZoneScale = (k, raw) => {
    const newS = Math.max(1, Math.round(Number(raw) || 1));
    const oldS = zoneScaleVal(k);
    setZoneElements(p => ({ ...p, [k]: (p[k] || []).map(e => {
      // Per-unit base: use the stored baseQty, else derive it from the current (possibly already-scaled)
      // qty. Effective qty = base × scale — always from a fixed base, so it never drifts across changes.
      const base = (e.baseQty != null && Number.isFinite(Number(e.baseQty)))
        ? Number(e.baseQty)
        : (oldS > 1 ? Math.round((Number(e.qty) || 0) / oldS) : (Number(e.qty) || 0));
      return { ...e, baseQty: base, qty: Math.max(0, Math.round(base * newS)) };
    }) }));
    setZoneConfig(p => ({ ...p, [k]: { ...(p[k] || {}), scale: newS } }));
  };

  // ── Per-element stock availability browser (Build) ───────────────────────────────────────────
  // A discreet 📦 on each element opens a modal listing that element's IMS sub-category items (alias-aware)
  // with the FREE count on the event date (owned − blocked). Picking one + Save pins it on the element
  // (deal-local) → Deal Check auto-match honors the pin. No costs shown — availability only.
  const [availModal, setAvailModal] = useState(null); // { zoneKey, idx, elName, subcat, loading, items, selectedId }
  // Hover-to-zoom on an element's thumbnail — same fixed-position enlarged-preview pattern as
  // ManageLibrary.jsx's elHoverImg. Keyed by "zoneKey:idx" since two near-duplicate element-list
  // blocks in this file can both be on screen at once.
  const [elThumbHover, setElThumbHover] = useState(null); // { key, top, bottom, left }
  const openAvailModal = async (zoneKey, idx, el, rc) => {
    // Inventory-sourced elements (el.invId) already know their exact real sub-category — no
    // Rate-Card→IMS alias lookup needed, unlike the legacy rc path below.
    const invItem = el?.invId ? (imsInventory || []).find(i => i.id === el.invId) : null;
    const subcat = (invItem ? (invItem.subCat || invItem.subcategory) : "") || (rc ? itemImsSubcat(rc) : "") || rc?.sub || "";
    const date = activeFnMeta?.date || clientDate || "";
    setAvailModal({ zoneKey, idx, elName: el?.name || "", subcat, date, loading: true, items: [], selectedId: el?.imsId || null });
    try {
      const { inventory, blocksForDate } = await loadAvailability(date);
      const target = String(subcat).toLowerCase().trim();
      const items = (inventory || [])
        .filter(it => String(it.subCat || it.subcategory || "").toLowerCase().trim() === target)
        .map(it => ({ id: it.id, name: it.name, photo: (Array.isArray(it.photoUrls) && it.photoUrls[0]) || it.img || "", free: getStudioAvailable(it, blocksForDate) }))
        .sort((a, b) => b.free - a.free);
      setAvailModal(m => (m && m.zoneKey === zoneKey && m.idx === idx) ? { ...m, loading: false, items } : m);
    } catch { setAvailModal(m => m ? { ...m, loading: false } : m); }
  };
  const saveAvailPick = () => {
    if (!availModal) return;
    const { zoneKey, idx, selectedId, items } = availModal;
    const pick = (items || []).find(i => i.id === selectedId);
    setZoneElements(p => {
      const elems = [...(p[zoneKey] || [])];
      if (!elems[idx]) return p;
      elems[idx] = selectedId
        ? { ...elems[idx], imsId: selectedId, imsName: pick?.name || "", imsPhoto: pick?.photo || "" }
        : (() => { const e = { ...elems[idx] }; delete e.imsId; delete e.imsName; delete e.imsPhoto; return e; })();
      return { ...p, [zoneKey]: elems };
    });
    setAvailModal(null);
  };

  // The currently-selected photo per zone can be restored from a saved session and its id may not
  // be in the lazy library cache yet (used below for the "correct & save to master" lookup) —
  // prefetch on the off chance it's missing, so `libItems.find` doesn't silently come up empty.
  useEffect(() => {
    const ids = Object.values(elSelectedPhoto || {}).map(p => p?.eventId).filter(Boolean);
    if (ids.length) ensureLibItems?.(ids);
  }, [elSelectedPhoto, ensureLibItems]);

  // getLibPhotosForZone is async (server-queried zone match) now. Bridge it back to the synchronous
  // shape getMatchedPhotos renders inline: cache results per zone-area-set (bumped whenever the
  // scoring context — source video or active photo filters — changes), fetch on first read, return
  // empty until it resolves. Zone key is tier-agnostic (tier filtering happens after, below).
  const [zoneMatchCache, setZoneMatchCache] = useState({});
  const zoneFetchInFlight = useRef(new Set());
  const [matchGen, setMatchGen] = useState(0);
  useEffect(() => { setMatchGen(g => g + 1); }, [sourceVideo?.id, zpHasFilters, JSON.stringify(zpFilters)]);
  const ensureZoneMatches = (areaNames) => {
    if (!areaNames.length) return;
    const cacheKey = `${matchGen}::${areaNames.join("|")}`;
    if (zoneFetchInFlight.current.has(cacheKey) || zoneMatchCache[cacheKey]) return;
    zoneFetchInFlight.current.add(cacheKey);
    const vTag = sourceVideo ? (ytVideoTags[sourceVideo.id] || {}) : {};
    getLibPhotosForZone(areaNames, vTag, zpHasFilters ? zpFilterPhoto : null)
      .then((result) => setZoneMatchCache((prev) => ({ ...prev, [cacheKey]: result })))
      .finally(() => zoneFetchInFlight.current.delete(cacheKey));
  };
  // Kick off the fetch for every currently-rendered zone (cheap no-op for already-cached/in-flight keys).
  useEffect(() => {
    const keys = [...zoneKeys, ...customZones.filter(cz => cz.sourceType).map(cz => cz.id)];
    keys.forEach((k) => {
      const czSrc = customZones.find(cz => cz.id === k);
      const srcType = czSrc?.sourceType || k;
      const areaNamesRaw = ZONE_TYPE_TO_AREA[srcType];
      let areaNames = Array.isArray(areaNamesRaw) ? areaNamesRaw : (areaNamesRaw ? [areaNamesRaw] : []);
      if (!areaNames.length) {
        const label = (zoneLabelsD[srcType]?.label) || srcType || "";
        if (label) { const hit = Object.values(ZONE_TYPE_TO_AREA).find(arr => (arr || []).includes(label)); areaNames = hit ? [...hit] : [label]; }
      }
      ensureZoneMatches(areaNames);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKeys, customZones, matchGen]);

  // Strict category filter: Simple=Silver ONLY, Enhanced=Gold ONLY
  // No mixing — each tab shows ONLY its category's photos
  const getMatchedPhotos = (elKey, tier) => {
    const targetCat = TIER_TO_CAT[tier] || "Silver";
    const areaNamesRaw = ZONE_TYPE_TO_AREA[elKey];
    let areaNames = Array.isArray(areaNamesRaw) ? areaNamesRaw : (areaNamesRaw ? [areaNamesRaw] : []);
    // Custom / renamed zones (keys living in zoneDefs.meta, not the static map) have no direct
    // area mapping. Resolve them by display label so they're still zone-restricted instead of
    // falling through to the "show any library photo" padding below (which leaks e.g. Bar photos
    // into a Lounge section). Reverse-lookup the area-set that contains the label; else use the
    // label itself as the area name.
    if (!areaNames.length) {
      const label = (zoneLabelsD[elKey]?.label) || elKey || "";
      if (label) {
        const hit = Object.values(ZONE_TYPE_TO_AREA).find(arr => (arr || []).includes(label));
        areaNames = hit ? [...hit] : [label];
      }
    }
    const photos = [];
    const seen = new Set();

    // 1. VIDEO DEFAULT — if sourceVideo has a zone photo for this area, show it first
    if (sourceVideo && areaNames.length) {
      const vTag = ytVideoTags[sourceVideo.id] || {};
      const zp = vTag.zonePhotos || {};
      const libId = areaNames.map(n => zp[n]).find(Boolean);
      if (libId) {
        const li = libItems.find(l => l.id === libId);
        if (li && li.url) {
          seen.add(li.url);
          photos.push({
            src: li.url, eventId: li.id, eventName: li.name || "Video default",
            category: targetCat, fn: "", space: "", mood: "", venue: "", video: "",
            tags: [], zones: [], itemGrades: {}, itemQtys: {}, enabledEls: [],
            isLibrary: true, elements: li.elements || [], dims: li.dims || {}, isVideoDefault: true,
          });
        }
      }
    }

    // 2. LIBRARY PHOTOS — scored by admin priority, capped at 50
    // Strict tier tab: Silver shows only Simple-tagged photos, Gold only Enhanced.
    // Photos tagged the OPPOSITE tier are excluded; untagged photos appear under either tab.
    const tabTier = tier === "enhanced" ? "Enhanced" : tier === "premium" ? "Premium" : "Simple";
    if (areaNames.length) {
      // Async zone match (getLibPhotosForZone) — read from the cache populated by the effect above
      // (empty arrays until it resolves, same render cost as before once warm).
      const {exact, similar, fallback} = zoneMatchCache[`${matchGen}::${areaNames.join("|")}`] || { exact: [], similar: [], fallback: [] };
      // getLibPhotosForZone merges non-zone "overflow" fillers into `fallback` (the Manage
      // zone-picker wants those). On Build we must show ONLY photos actually tagged for this
      // zone — otherwise a Stage panel surfaces photos tagged Entry Passage / Bar Counter, etc.
      const allMatches = [...exact, ...similar, ...fallback].filter(img =>
        (img.tags?.areasElements || []).some(a => areaNames.includes(a)));
      for (const img of allMatches) {
        if (photos.length >= 50) break;
        if (!img.url || seen.has(img.url)) continue;
        const liTier = img.tags?.categoryTier || [];
        if (liTier.length && !liTier.includes(tabTier)) continue; // tagged opposite tier → hide
        seen.add(img.url);
        photos.push({
          src: img.url, eventId: img.id, eventName: img.name || "Library",
          category: targetCat, fn: "", space: "", mood: "", venue: "", video: "",
          tags: [], zones: [], itemGrades: {}, itemQtys: {}, enabledEls: [],
          isLibrary: true, elements: img.elements || [], dims: img.dims || {},
        });
      }
    }

    // 3. EVENT PHOTOS — only for zones with NO area mapping (untagged custom zones).
    // For mapped zones we deliberately stop at zone-tagged library photos above; event
    // photos aren't tagged per-zone, so padding with them re-introduces wrong-zone images.
    if (!areaNames.length && photos.length < 50) {
      const catEvents = events.filter(ev => {
        if (getCat(getFullCost(ev)).label !== targetCat) return false;
        return (ev.enabledEls || []).includes(elKey) || (ev.elements && ev.elements[elKey]);
      });
      const sorted = catEvents.map(ev => {
        let relevance = 0;
        if (fn && ev.fn === fn) relevance += 4;
        if (venue && ev.venue === venue) relevance += 1;
        return { ev, relevance };
      }).sort((a, b) => b.relevance - a.relevance);
      for (const { ev } of sorted) {
        for (const p of (ev.photos || [])) {
          if (!seen.has(p) && photos.length < 50) {
            seen.add(p);
            photos.push({
              src: p, eventId: ev.id, eventName: ev.name,
              category: getCat(getFullCost(ev)).label,
              fn: ev.fn, space: ev.space, mood: ev.mood, venue: ev.venue, video: ev.video,
              tags: ev.tags || [],
              zones: ev.templateId?((findTemplate(ev.templateId,templates)||{}).zones||[]):(ev.zones||[]),
              itemGrades: ev.itemGrades || {}, itemQtys: ev.itemQtys || {}, enabledEls: ev.enabledEls || [],
            });
          }
        }
      }
    }

    // 4. NEVER EMPTY — only for unmapped zones. A mapped zone with no tagged photos shows
    // its empty state (prompting the team to tag/upload) rather than random library photos.
    // NOTE: `libItems` is a lazy cache (not the whole library) now, so this rare last-resort
    // filler draws from whatever's already been loaded this session rather than a true random
    // sample of the whole table — acceptable for an edge case (an unmapped custom zone with zero
    // zone-tagged matches at all).
    if (!areaNames.length && photos.length === 0) {
      for (const img of libItems.slice(0, 50)) {
        if (!img.url || seen.has(img.url)) continue;
        seen.add(img.url);
        photos.push({
          src: img.url, eventId: img.id, eventName: img.name || "Library",
          category: targetCat, fn: "", space: "", mood: "", venue: "", video: "",
          tags: [], zones: [], itemGrades: {}, itemQtys: {}, enabledEls: [],
          isLibrary: true, elements: img.elements || [], dims: img.dims || {},
        });
      }
    }

    return photos;
  };

  return (
  <div style={S.main}>
    <div style={{fontSize:28,fontWeight:700,marginBottom:6}}>Build Your Decor</div>
    <div style={{fontSize:14,color:textS,marginBottom:clientDate?8:24,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      {clientName&&<strong>{clientName} · </strong>}
      <span>{activeFnMeta.venue || venue} · {activeFnMeta.type || fn}</span>
      {extraFunctions.length > 0 && <span style={{padding:"2px 10px",borderRadius:8,fontSize:10,fontWeight:600,background:`${accent}20`,color:accent,letterSpacing:0.3}}>Function {activeFnIdx + 1} of {extraFunctions.length + 1}</span>}
    </div>

    {/* ═══ §23 Phase 2.9c — PALETTE STRIP ═══
        Auto-set from selected video's YT tag. Salesperson can override here if client requests a different palette. */}
    {(()=>{
      const activePalette = activeFnIdx === 0 ? clientPalette : (extraFunctions[activeFnIdx-1]?.palette || "");
      const palettes = imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue : [];
      const pObj = palettes.find(p => p.name === activePalette);
      const isUnset = !activePalette || activePalette === "Custom";
      const updatePalette = (v) => activeFnIdx === 0
        ? setClientPalette(v)
        : setExtraFunctions(prev => { const n=[...prev]; if (n[activeFnIdx-1]) n[activeFnIdx-1] = {...n[activeFnIdx-1], palette: v}; return n; });
      return (
        <div style={{
          padding:"12px 16px",
          borderRadius:12,
          marginBottom:16,
          background: isUnset ? (isDark?"rgba(245,158,11,0.10)":"#FFFBEB") : (isDark?"rgba(124,58,237,0.10)":"#FAF5FF"),
          border: `2px solid ${isUnset ? "rgba(245,158,11,0.5)" : "rgba(124,58,237,0.35)"}`,
          display:"flex",
          alignItems:"center",
          gap:14,
          flexWrap:"wrap"
        }}>
          {isUnset ? (
            <>
              <span style={{fontSize:18}}>⚠️</span>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:13,fontWeight:700,color:"#92400E"}}>Pick a Colour Palette to continue</div>
                <div style={{fontSize:10,color:"#B45309",marginTop:2}}>
                  {sourceVideo?.tags?.palette === undefined && sourceVideo
                    ? `Selected video has no palette tagged. Ops can add one in Browse → Tag Editor.`
                    : `No video selected, or video has no palette set.`}
                </div>
              </div>
              <select value={activePalette||""} onChange={e=>updatePalette(e.target.value)}
                style={{padding:"8px 12px",borderRadius:8,border:"2px solid #F59E0B",background:"#fff",fontSize:12,fontWeight:600,minWidth:180,cursor:"pointer"}}>
                <option value="">— Choose palette —</option>
                {palettes.map(p=><option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </>
          ) : (
            <>
              <span style={{fontSize:18}}>🎨</span>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <div style={{fontSize:11,color:textS,fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>Event Palette</div>
                <div style={{fontSize:15,fontWeight:700,color:"#7c3aed"}}>{activePalette}</div>
              </div>
              {pObj && pObj.anchorColours && pObj.anchorColours.length > 0 && (
                <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap",flex:1}}>
                  {pObj.anchorColours.map(cn => {
                    const cObj = imsColourCatalogue.find(c => c.name === cn);
                    const _prim = Array.isArray(pObj.primaryColours) ? pObj.primaryColours : (pObj.primaryColour ? [pObj.primaryColour] : []);
                    const isPrimary = _prim.includes(cn);
                    return (
                      <div key={cn} title={isPrimary ? "Primary colour — drives photo order" : ""} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",background:isPrimary?"rgba(201,169,110,0.18)":(isDark?"rgba(255,255,255,0.05)":"#fff"),border:`1px solid ${isPrimary?"#C9A96E":"rgba(124,58,237,0.2)"}`,borderRadius:12,fontSize:10}}>
                        <span style={{width:11,height:11,borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",background:cObj?.hex||"#ccc"}} />
                        <span style={{color:isPrimary?"#C9A96E":textP,fontWeight:isPrimary?700:500}}>{cn}{isPrimary?" ★":""}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <select value={activePalette} onChange={e=>updatePalette(e.target.value)}
                style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.04)":"#fff",fontSize:11,color:textS,cursor:"pointer"}}>
                {palettes.map(p=><option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            </>
          )}
        </div>
      );
    })()}

    {/* ═══ DATE DEMAND BANNER ═══ */}
    {clientDate&&(()=>{
      const dt=dateTypes[clientDate];const booked=clientLedger.filter(c=>c.eventDate===clientDate&&c.status==="booked").length;const ongoing=clientLedger.filter(c=>c.eventDate===clientDate&&c.status==="ongoing"&&c.id!==activeClientId).length;
      const dtInfo=dt==="saya"?{bg:"rgba(239,68,68,0.08)",border:"rgba(239,68,68,0.2)",icon:"🔴",label:"Saya Day"}:dt==="competition"?{bg:"rgba(100,100,100,0.08)",border:"rgba(100,100,100,0.2)",icon:"⚫",label:"Competition Day"}:null;
      const isHigh=booked>=2||dt==="saya";const isMod=!isHigh&&booked===1;const isLow=!isHigh&&!isMod&&!dt;
      return <div style={{padding:"8px 14px",borderRadius:10,marginBottom:16,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",fontSize:12,background:isHigh?"rgba(239,68,68,0.08)":(dtInfo?dtInfo.bg:(isDark?"rgba(201,169,110,0.05)":"#FFFDF7")),border:`1px solid ${isHigh?"rgba(239,68,68,0.2)":(dtInfo?dtInfo.border:border)}`}}>
        <span style={{fontWeight:600}}>📅 {new Date(clientDate+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}</span>
        {dtInfo&&<span style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:600,background:dtInfo.bg,color:dt==="saya"?"#EF4444":"#888"}}>{dtInfo.icon} {dtInfo.label}</span>}
        {booked>0&&<span style={{color:"#10B981",fontWeight:600}}>🟢 {booked} booked</span>}
        {ongoing>0&&<span style={{color:"#F59E0B"}}>🟡 {ongoing} ongoing</span>}
        {isHigh&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"rgba(239,68,68,0.1)",color:"#EF4444",fontWeight:600}}>🔴 High demand</span>}
        {isMod&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"rgba(245,158,11,0.1)",color:"#F59E0B",fontWeight:600}}>🟡 Moderate</span>}
        {isLow&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"rgba(16,185,129,0.1)",color:"#10B981",fontWeight:600}}>🟢 Low demand</span>}
      </div>;
    })()}

    {/* ═══ SOURCE EVENT BANNER ═══ */}
    {sourceEvent&&<div style={{...S.card,marginBottom:20,overflow:"hidden"}}>
      <div style={{display:"flex",gap:0}}>
        <div style={{width:220,minHeight:140,flexShrink:0,position:"relative",background:sourceEvent.gradient,overflow:"hidden"}}>
          <LazyYT src={sourceEvent.video} gradient={sourceEvent.gradient} poster={sourceEvent.img||sourceEvent.photos?.[0]} style={{position:"absolute",inset:0}}/>
        </div>
        <div style={{flex:1,padding:"14px 18px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div>
              <div style={{fontSize:10,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600,marginBottom:4}}>Building from reference</div>
              <div style={{fontSize:17,fontWeight:700}}>{sourceEvent.name}</div>
              <div style={{fontSize:12,color:textS,marginTop:2}}>{sourceEvent.venue} · {sourceEvent.fn} · {sourceEvent.space}</div>
            </div>
            {showCosts&&<div style={{textAlign:"right"}}>
              <div style={{fontSize:18,fontWeight:700,color:textP}}>{fmt(grandTotal)}</div>
              <div style={{fontSize:9,color:textS}}>{fmt(totalCost())} decor + {fmt(transportCalc.total)} transport</div>
              <span style={{fontSize:10,padding:"3px 10px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
            </div>}
          </div>
          <div style={{fontSize:12,color:textS,lineHeight:1.5,marginBottom:8}}>{sourceEvent.desc}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {(sourceEvent.tags||[]).map((t,i)=><span key={i} style={{fontSize:10,padding:"3px 8px",borderRadius:8,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS,fontWeight:500}}>{t}</span>)}
          </div>
          {sourceEvent.photos?.length>0&&<div style={{display:"flex",gap:6,marginTop:10,overflowX:"auto"}}>
            {sourceEvent.photos.map((p,i)=><img key={i} src={p} alt="" loading="lazy" style={{width:70,height:46,objectFit:"cover",borderRadius:6,flexShrink:0,cursor:"pointer",border:`2px solid ${border}`}} onClick={()=>setPreviewImg(p)} onError={e=>{e.target.style.display="none"}}/>)}
          </div>}
        </div>
      </div>
    </div>}

    {/* ═══ SOURCE VIDEO BANNER ═══ */}
    {sourceVideo&&!sourceEvent&&(()=>{
      const vTag=ytVideoTags[sourceVideo.id]||{};
      const vid=allVideos.find(v=>v.id===sourceVideo.id);
      const zoneCount=Object.keys(vTag.zonePhotos||{}).length;
      const ytWatchUrl=sourceVideo.id?`https://www.youtube.com/watch?v=${sourceVideo.id}`:"";
      const embedUrl=sourceVideo.id?`https://www.youtube.com/embed/${sourceVideo.id}`:null;
      return <div style={{...S.card,marginBottom:20,overflow:"hidden"}}>
        <div style={{display:"flex",gap:0}}>
          {vid?.thumb&&<div style={{width:220,minHeight:120,flexShrink:0,position:"relative",overflow:"hidden",cursor:"pointer"}} onClick={()=>{setVideoModal({name:sourceVideo.title||vid?.title||"Video",venue:venue||"",fn:fn||"",desc:"",video:embedUrl?`https://www.youtube.com/embed/${sourceVideo.id}`:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[vid?.thumb].filter(Boolean),tags:[]});setVideoPlaying(true);}}>
            <img src={vid.thumb} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>{e.target.style.display="none"}}/>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.2)"}}>
              <div style={{width:48,height:34,borderRadius:8,background:"rgba(255,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 12px rgba(255,0,0,0.4)"}}><div style={{width:0,height:0,borderLeft:"12px solid #fff",borderTop:"7px solid transparent",borderBottom:"7px solid transparent",marginLeft:2}}/></div>
            </div>
          </div>}
          <div style={{flex:1,padding:"14px 18px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:10,color:textS,textTransform:"uppercase",letterSpacing:1,fontWeight:600,marginBottom:4}}>Building from video</div>
                <div style={{fontSize:17,fontWeight:700}}>{sourceVideo.title||vid?.title||"Video"}</div>
              </div>
              {showCosts&&<div style={{textAlign:"right"}}>
                <div style={{fontSize:18,fontWeight:700,color:textP}}>{fmt(grandTotal)}</div>
                <span style={{fontSize:10,padding:"3px 10px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
              </div>}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
              {vTag.tier&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(148,163,184,0.2)",color:textP,fontWeight:600}}>{vTag.tier}</span>}
              {(vTag.colors||[]).map(c=><span key={c} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(249,115,22,0.12)",color:"#F97316",fontWeight:600}}>{c}</span>)}
              {(vTag.styles||[]).map(s=><span key={s} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(0,0,0,0.05)",color:"#888",fontWeight:600}}>{s}</span>)}
              {vTag.io&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(16,185,129,0.12)",color:"#10B981",fontWeight:600}}>{vTag.io}</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8}}>
              <div style={{fontSize:11,color:textS}}>{zoneCount} zones pre-assigned</div>
              <button onClick={()=>{setVideoModal({name:sourceVideo.title||vid?.title||"Video",venue:venue||"",fn:fn||"",desc:"",video:embedUrl?`https://www.youtube.com/embed/${sourceVideo.id}`:"",gradient:"linear-gradient(135deg,#1a1a2e,#C9A96E)",photos:[vid?.thumb].filter(Boolean),tags:[]});setVideoPlaying(true);}} style={{padding:"4px 14px",borderRadius:6,border:"none",background:"rgba(255,0,0,0.9)",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>{"▶"} Play Video</button>
              {ytWatchUrl&&<button onClick={()=>{try{navigator.clipboard.writeText(ytWatchUrl);showMsg("✓ YouTube link copied!","green");}catch{}}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:10,fontWeight:600,cursor:"pointer"}}>{"📋"} Copy Link</button>}
            </div>
          </div>
        </div>
      </div>;
    })()}      {savedInsps.length>0&&<div style={{background:"#FFF1F2",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{display:"flex",gap:4}}>{savedInsps.slice(0,5).map((s,i)=><div key={i} style={{width:32,height:32,borderRadius:6,background:s.gradient||"#EDE9FE"}}/>)}</div><div style={{fontSize:12,fontWeight:600,color:"#BE123C"}}>{savedInsps.length} inspirations</div></div></div>}




    {/* ═══ DETAILS & PRICING TOGGLE ═══ */}
    <div onClick={()=>setShowCosts(p=>!p)} style={{borderRadius:14,padding:"12px 18px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",border:showCosts?`2px solid ${accent}`:`2px solid ${border}`,background:showCosts?(isDark?"rgba(201,169,110,0.08)":"rgba(201,169,110,0.06)"):(isDark?"rgba(255,255,255,0.03)":"#FAFAFA"),transition:"all 0.25s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:18}}>{showCosts?"📊":"📋"}</span>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:textP}}>{showCosts?"Details & Pricing Visible":"Details & Pricing Hidden"}</div>
          <div style={{fontSize:11,color:textS,marginTop:1}}>{showCosts?"Item quantities, zone structure & cost breakdown shown":"Tap to reveal items, zones & pricing for all sections"}</div>
        </div>
      </div>
      <div style={{width:44,height:26,borderRadius:13,background:showCosts?accent:"rgba(120,120,120,0.3)",position:"relative",transition:"background 0.25s"}}>
        <div style={{width:22,height:22,borderRadius:11,background:"#fff",position:"absolute",top:2,left:showCosts?20:2,transition:"left 0.25s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
      </div>
    </div>

    {/* ═══ FLORAL RATIO CONTROL — art/real split is a design control, show it even when costs are hidden ═══ */}
    {<div style={{borderRadius:10,padding:"10px 16px",marginBottom:14,border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#F9F9F9",display:"flex",alignItems:"center",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <span style={{fontSize:13}}>{"🌸"}</span>
        <span style={{fontSize:11,fontWeight:600,color:textP}}>Artificial</span>
      </div>
      <input type="range" min={0} max={100} step={5} value={floralRatio} onChange={e=>setFloralRatio(parseInt(e.target.value))} style={{flex:1,accentColor:"#888",cursor:"pointer",minWidth:80}}/>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        <span style={{fontSize:13,fontWeight:700,color:textP,minWidth:32,textAlign:"right"}}>{floralRatio}%</span>
        <div style={{fontSize:9,color:textS,lineHeight:1.2}}>art<br/>/{100-floralRatio}% real</div>
      </div>
      <div style={{display:"flex",gap:3,flexShrink:0}}>
        {[0,50,70,100].map(v=><button key={v} onClick={()=>setFloralRatio(v)} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:9,fontWeight:floralRatio===v?700:400,cursor:"pointer",background:floralRatio===v?"rgba(0,0,0,0.08)":"transparent",color:floralRatio===v?textP:textS}}>{v}%</button>)}
      </div>
    </div>}

    {/* ═══ ELEMENT CARDS — photos change with tier ═══ */}
    {[...zoneKeys, ...customZones.filter(cz=>cz.sourceType).map(cz=>cz.id)].sort((a,b)=>(enabledEls[a]?0:1)-(enabledEls[b]?0:1)).map(k=>{
      const czSrc=customZones.find(cz=>cz.id===k);
      const srcType=czSrc?.sourceType||k;
      const el=czSrc?{label:czSrc.name,icon:czSrc.icon||"📦"}:zoneLabelsD[k];
      const isCentrepieceZone=/centre\s*piece|center\s*piece|centrepiece/i.test(el?.label||k||"");
      const isOn=enabledEls[k];const tier=elTiers[k]||"simple";const isCust=customMode[k];
      let matchedPhotos = getMatchedPhotos(srcType, tier).filter(ph => {
        if (!zpHasFilters) return true;
        if (!ph.isLibrary || !ph.eventId) return true; // don't filter out event photos
        const li = libItems.find(l => l.id === ph.eventId);
        if (!li) return true;
        return zpFilterPhoto(li);
      });
      // Pin the last-selected photo to the FRONT of the strip (and force it in even if relevance/
      // filters would drop it), so re-opening a saved session shows the saved pick first — no
      // scrolling left/right to hunt for it. Its saved elements & dims live in zoneElements/
      // zoneConfig and are already restored; keeping it first also stops an accidental click on a
      // different photo from resetting those edits.
      const selP = elSelectedPhoto[k];
      if (selP?.src) {
        const existing = matchedPhotos.find(ph => ph.src === selP.src);
        matchedPhotos = [existing || selP, ...matchedPhotos.filter(ph => ph.src !== selP.src)];
      }
      const isDuplicate=!!czSrc?.sourceType;
      return(<div key={k} style={{background:isOn?cardBg:isDark?"#12121F":"#FAFAFA",borderRadius:16,border:isOn?`2px solid ${isDuplicate?"#C9A96E":"#444"}`:`2px solid ${border}`,marginBottom:14,overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",cursor:"pointer"}} onClick={()=>toggleEl(k)}>
          <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:22}}>{el.icon}</span><div style={{fontSize:15,fontWeight:600,color:isOn?textP:textS}}>{el.label}</div>{isDuplicate&&<span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:"rgba(201,169,110,0.15)",color:"#C9A96E",fontWeight:600}}>Duplicate</span>}</div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {isOn&&showCosts&&<div style={{fontSize:14,fontWeight:700,color:textP}}>{fmt(calcElsCost(zoneElements[k],true,zoneConfig[k])+(zoneConfig[k]?calcStructCost(k,zoneConfig[k]).total:0)+dcCustomItems.filter(c=>c.fnIdx===(activeFnIdx||0)&&c.zoneKey===k).reduce((s,c)=>s+(c.manualPrice||c.refPrice||0)*(Number(c.qty)||1),0))}</div>}
            <span title="Add Production item" onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx:activeFnIdx||0,zoneKey:k,type:"production"});}} style={{cursor:"pointer",fontSize:13,opacity:0.6,padding:"2px 4px",borderRadius:4,background:"rgba(168,85,247,0.08)"}}>🏭</span>
            <span title="Add Buying item" onClick={e=>{e.stopPropagation();setDcCustomModal({fnIdx:activeFnIdx||0,zoneKey:k,type:"buying"});}} style={{cursor:"pointer",fontSize:13,opacity:0.6,padding:"2px 4px",borderRadius:4,background:"rgba(245,158,11,0.08)"}}>🛒</span>
            {!isDuplicate&&<span title="Duplicate this zone" onClick={e=>{e.stopPropagation();const count=customZones.filter(cz=>cz.sourceType===k).length+2;const id="cz_"+Date.now();const newCz={id,name:`${el.label} (${count})`,sourceType:k,icon:el.icon};setCustomZones(p=>[...p,newCz]);setEnabledEls(p=>({...p,[id]:true}));showMsg(`✓ ${newCz.name} added`,"green");}} style={{cursor:"pointer",fontSize:16,opacity:0.5}}>📋</span>}
            {isDuplicate&&<span onClick={e=>{e.stopPropagation();if(confirm("Remove "+el.label+"?")){setCustomZones(p=>p.filter(z=>z.id!==k));setEnabledEls(p=>{const n={...p};delete n[k];return n;});setZoneElements(p=>{const n={...p};delete n[k];return n;});setZoneConfig(p=>{const n={...p};delete n[k];return n;});}}} style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700}}>✕</span>}
            {isOn&&isCentrepieceZone&&<span onClick={e=>e.stopPropagation()} title="Scale the whole set — multiplies every element count below (e.g. 10 tables → 10× tables, chairs, centre pieces…). Works even with pricing hidden." style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:10,background:isDark?"rgba(201,169,110,0.08)":"rgba(201,169,110,0.10)",border:`1px solid ${accent}40`}}>
              <span style={{fontSize:10,fontWeight:700,color:accent,letterSpacing:0.3}}>✕ Scale</span>
              <input type="number" min="1" step="1" value={zoneScaleVal(k)} onClick={e=>e.stopPropagation()} onChange={e=>setZoneScale(k, e.target.value)} onFocus={e=>e.target.select()} style={{width:40,padding:"2px 3px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:12,fontWeight:700,textAlign:"center",MozAppearance:"textfield"}} />
            </span>}
            {isOn&&<span onClick={e=>{e.stopPropagation();toggleRepeat(k);}} title={isRepeat(k)?"Reusing an existing setup — discounted rental, no build labour":"New build this time — full rental + labour + transport"} style={{cursor:"pointer",fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:10,border:`1px solid ${isRepeat(k)?"#059669":border}`,background:isRepeat(k)?"#05966918":"transparent",color:isRepeat(k)?"#059669":textS}}>{isRepeat(k)?"♻️ Repeat":"✨ Fresh"}</span>}
            <div style={{width:44,height:26,borderRadius:13,background:isOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}} onClick={e=>{e.stopPropagation();toggleEl(k);}}><div style={{width:22,height:22,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isOn?20:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}/></div>
          </div>
        </div>
        {isOn&&<div style={{padding:"0 18px 16px"}}>
          {/* ═══ DYNAMIC PHOTO GALLERY — select a photo to load its pricing ═══ */}
          {matchedPhotos.length>0 ? (
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:600,color:textS}}>📷 {TIER_TO_CAT[tier]} {el.label} — tap to apply pricing</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {elSelectedPhoto[k]&&<div style={{fontSize:10,color:"#059669",fontWeight:600}}>✓ {elSelectedPhoto[k].eventName}</div>}
                  <label style={{padding:"4px 12px",borderRadius:8,border:`1px solid ${accent}60`,background:zoneUploading===k?accent+"20":"transparent",color:zoneUploading===k?accent:accent,fontSize:10,fontWeight:600,cursor:zoneUploading?"wait":"pointer",display:"flex",alignItems:"center",gap:3}}>
                    {zoneUploading===k?"⏳ Uploading...":"📷 Upload"}
                    <input type="file" accept="image/*" capture="environment" style={{display:"none"}} disabled={!!zoneUploading} onChange={e=>{const f=e.target.files?.[0];if(f)handleZoneUpload(k,f);e.target.value="";}}/>
                  </label>
                  <button onClick={()=>setGridZones(g=>({...g,[k]:!g[k]}))} title={gridZones[k]?"Show as strip":"Show all in a grid"} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${gridZones[k]?accent:border}`,background:gridZones[k]?`${accent}15`:"transparent",color:gridZones[k]?accent:textS,fontSize:12,fontWeight:500,cursor:"pointer"}}>{gridZones[k]?"▭":"▦"}</button>
                  <button onClick={()=>setZpFilterOpen(!zpFilterOpen)} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${zpFilterOpen||zpHasFilters?accent:border}`,background:zpFilterOpen||zpHasFilters?`${accent}15`:"transparent",color:zpFilterOpen||zpHasFilters?accent:textS,fontSize:10,fontWeight:500,cursor:"pointer"}}>🔍{zpHasFilters?` (${Object.values(zpFilters).flat().length})`:""}</button>
                </div>
              </div>
              {zpFilterOpen&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:10,marginBottom:8,borderRadius:10,border:`1px solid ${accent}30`,background:isDark?"rgba(201,169,110,0.03)":"rgba(201,169,110,0.05)"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Event type</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,eventType:[]}))} style={zpPill(zpFilters.eventType.length===0)}>All</span>
                    {taxOr(taxonomy.eventType, FUNCTIONS).map(v=><span key={v} onClick={()=>zpToggleFilter("eventType",v)} style={zpPill(zpFilters.eventType.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Venue type</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,venueType:[]}))} style={zpPill(zpFilters.venueType.length===0)}>All</span>
                    {taxOr(taxonomy.venueType, ["Indoor","Outdoor","Semi-Outdoor"]).map(v=><span key={v} onClick={()=>zpToggleFilter("venueType",v)} style={zpPill(zpFilters.venueType.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Design style</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,designStyle:[]}))} style={zpPill(zpFilters.designStyle.length===0)}>All</span>
                    {taxOr(taxonomy.designStyle, ["Floral","Modern","Traditional","Royal","Minimal"]).map(v=><span key={v} onClick={()=>zpToggleFilter("designStyle",v)} style={zpPill(zpFilters.designStyle.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Color palette</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,colorPalette:[]}))} style={zpPill(zpFilters.colorPalette.length===0)}>All</span>
                    {(imsPaletteCatalogue.length > 0 ? imsPaletteCatalogue.map(p=>p.name) : taxOr(taxonomy.colorPalette, ["White & Gold","Red & Gold","Pastels","Teal"])).map(v=><span key={v} onClick={()=>zpToggleFilter("colorPalette",v)} style={zpPill(zpFilters.colorPalette.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>Day / Night</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,timeSetting:[]}))} style={zpPill(zpFilters.timeSetting.length===0)}>All</span>
                    {taxOr(taxonomy.timeSetting, ["Day","Night","Twilight"]).map(v=><span key={v} onClick={()=>zpToggleFilter("timeSetting",v)} style={zpPill(zpFilters.timeSetting.includes(v))}>{v}</span>)}
                  </div>
                </div>
                <div style={{gridColumn:"1/-1"}}>
                  <div style={{fontSize:9,fontWeight:600,color:accent,marginBottom:3}}>
                    Venue{zpWantIndoor&&!zpWantOutdoor?" — Indoor":zpWantOutdoor&&!zpWantIndoor?" — Outdoor":""}
                  </div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",maxHeight:110,overflowY:"auto"}}>
                    <span onClick={()=>setZpFilters(p=>({...p,venue:[]}))} style={zpPill(zpFilters.venue.length===0)}>All</span>
                    {zpVenueChoices.map(v=><span key={v} onClick={()=>zpToggleFilter("venue",v)} style={zpPill(zpFilters.venue.includes(v))}>{v}</span>)}
                    {zpVenueChoices.length===0&&<span style={{fontSize:9,color:textS}}>No venues configured yet</span>}
                  </div>
                </div>
                {zpHasFilters&&<div style={{gridColumn:"1/-1",textAlign:"right"}}><span onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[]})} style={{fontSize:9,color:"#E11D48",cursor:"pointer"}}>Clear filters</span></div>}
              </div>}
              <div style={gridZones[k]?{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8,paddingBottom:6,maxHeight:560,overflowY:"auto"}:{display:"flex",gap:8,overflowX:"auto",paddingBottom:6}}>
              {matchedPhotos.map((ph,i)=>{
                const isSource = sourceEvent && ph.eventName === sourceEvent.name;
                const isSelected = elSelectedPhoto[k]?.src === ph.src;
                // Calculate cost: SAME formula as zone header — elements (with floralRatio) + current zone structure
                const photoFullCost = calcPhotoCost(k, ph);
                return (
                <div key={i} style={{flexShrink:0,width:gridZones[k]?"auto":160,borderRadius:10,overflow:"hidden",
                  border:isSelected?`3px solid #059669`:isSource?`2px solid #C9A96E`:`2px solid ${border}`,
                  cursor:"pointer",position:"relative",background:isSelected?(isDark?"#0D2818":"#ECFDF5"):cardBg,
                  boxShadow:isSelected?"0 2px 12px rgba(5,150,105,0.2)":"none",
                  transition:"all 0.15s"}}>
                  <div style={{position:"relative",cursor:"zoom-in"}} onClick={(e)=>{e.stopPropagation();setElGallery({elKey:k,photos:matchedPhotos,title:`${TIER_TO_CAT[tier]} ${el.label}`});setGalleryIdx(i);}}>
                    <img src={ph.src} alt={ph.eventName} loading="lazy" style={{width:gridZones[k]?"100%":160,height:95,objectFit:"cover",display:"block",opacity:isSelected?1:0.85}} onError={e=>{e.target.style.display="none"}}/>
                    <div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.6)",color:"#fff",padding:"2px 6px",borderRadius:4,fontSize:8}}>🔍 Preview</div>
                    {showCosts&&photoFullCost>0&&<div style={{position:"absolute",top:6,left:6,background:isSelected?"#059669":"rgba(0,0,0,0.7)",color:"#fff",padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:700}}>{fmt(photoFullCost)}</div>}
                    {ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"rgba(124,58,237,0.8)",color:"#fff",padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:600}}>Library</div>}
                    {isSelected&&!ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"#059669",color:"#fff",width:22,height:22,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700}}>✓</div>}
                    {isSource&&!isSelected&&!ph.isLibrary&&<div style={{position:"absolute",top:6,right:6,background:"#C9A96E",color:"#0F0F1A",fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:4}}>SOURCE</div>}
                    {ph.isVideoDefault&&!isSelected&&<div style={{position:"absolute",top:6,right:6,background:"#C9A96E",color:"#fff",fontSize:8,fontWeight:700,padding:"2px 6px",borderRadius:4}}>Default</div>}
                  </div>
                  <div style={{padding:"6px 8px",cursor:"pointer",background:isSelected?(isDark?"#0D2818":"#ECFDF5"):"transparent"}} onClick={()=>selectElPhoto(k,ph)}>
                    <div style={{fontSize:10,fontWeight:isSelected?700:600,color:isSelected?"#059669":textP,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ph.eventName}</div>
                    <div style={{fontSize:9,color:isSelected?"#059669":textS,marginTop:3}}>
                      {ph.isLibrary ? `${(ph.elements||[]).length} elements` : (ph.fn || "Event") + " · " + (ph.space || "")}
                    </div>
                    <div style={{fontSize:9,color:accent,marginTop:2,fontWeight:500}}>{isSelected ? "✓ Selected" : "Tap to select"}</div>
                  </div>
                </div>);
              })}
              </div>
            </div>
          ) : (
            <div style={{background:isDark?"rgba(201,169,110,0.06)":"#FFFBEB",borderRadius:12,padding:"16px 20px",marginBottom:12,textAlign:"center"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#D97706",marginBottom:4}}>{zpHasFilters?`No ${TIER_TO_CAT[tier]} ${el.label} photos match your filters`:`No ${TIER_TO_CAT[tier]} ${el.label} photos yet`}</div>
              <div style={{fontSize:11,color:textS,marginBottom:8}}>{zpHasFilters?"Your photo filters hid everything for this zone. Clear them to see all photos again.":"Upload a client photo or add Library photos to see options here."}</div>
              <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                {zpHasFilters&&<button onClick={()=>setZpFilters({eventType:[],venueType:[],designStyle:[],colorPalette:[],timeSetting:[],venue:[]})} style={{padding:"8px 18px",borderRadius:8,border:`1px solid ${accent}`,background:"transparent",color:accent,fontSize:12,fontWeight:600,cursor:"pointer"}}>✕ Clear filters</button>}
                <label style={{display:"inline-flex",alignItems:"center",gap:4,padding:"8px 20px",borderRadius:8,border:"none",background:accent,color:"#0F0F1A",fontSize:12,fontWeight:600,cursor:zoneUploading?"wait":"pointer"}}>
                  {zoneUploading===k?"⏳ Uploading...":"📷 Upload Client Photo"}
                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}} disabled={!!zoneUploading} onChange={e=>{const f=e.target.files?.[0];if(f)handleZoneUpload(k,f);e.target.value="";}}/>
                </label>
              </div>
            </div>
          )}

          {/* ═══ AI INSPIRATION per element — HIDDEN pending search integration ═══ */}

          {/* ═══ TIER SELECTOR — always visible ═══ */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {["simple","enhanced"].map(t=><button key={t} onClick={()=>{setElTiers(p=>({...p,[k]:t}));}} style={{flex:1,padding:"8px 10px",border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:tier===t?700:400,background:tier===t?"#444":isDark?"rgba(255,255,255,0.04)":"#F3F4F6",color:tier===t?"#fff":textS,textTransform:"capitalize"}}>{t === "simple" ? "Silver" : "Gold"}</button>)}
          </div>

          {/* ═══ ELEMENT CARD + ZONE STRUCTURE — behind showCosts toggle ═══ */}
          {showCosts&&<Fragment>

          {/* ═══ ELEMENT CARD PRICING — from selected photo ═══ */}
          {zoneElements[k] ? (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:"#666"}}>{"📋"} Element card — {elSelectedPhoto[k]?.eventName || "Library photo"}</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {/* Permanent correction (Phase 1b) — push the corrected element list back to the
                      master library photo so the fix sticks for everyone. Shows only for a selected
                      library photo while CORRECTION_MODE is on. Past quotes keep their own numbers. */}
                  {CORRECTION_MODE && elSelectedPhoto[k]?.isLibrary && elSelectedPhoto[k]?.eventId && (()=>{
                    const libId = elSelectedPhoto[k].eventId;
                    const master = libItems.find(i => i.id === libId);
                    const verified = !!master?._verified;
                    return <button onClick={()=>{
                      if(!master){showMsg("Couldn't find the master photo for this image.","red");return;}
                      // Open the full tag-correction panel (tier/venue/event/style/palette/zone + elements) pre-filled from master.
                      const mv=master.tags?.venue||"";
                      setCorrVenueGrp(allInhouseVenues.includes(mv)?"inhouse":(mv?"outside":""));
                      setCorrectPhoto({ libId, zoneKey:k, name: master.name||"", tags: JSON.parse(JSON.stringify(master.tags||{})) });
                    }} title="Correct this photo's tags + elements and save back to the shared library photo (permanent, for everyone)"
                      style={{...S.btn(false),fontSize:10,padding:"4px 10px",border:`1px solid ${verified?"#059669":"#7C3AED"}`,color:verified?"#059669":"#7C3AED",fontWeight:600}}>
                      ✏️ {verified?"Correct & update master":"Correct & save to master"}
                    </button>;
                  })()}
                  {elSelectedPhoto[k]?.src && <button disabled={zoneAiFilling[k]} onClick={async()=>{
                    const url=elSelectedPhoto[k]?.src;if(!url)return;
                    setZoneAiFilling(p=>({...p,[k]:true}));
                    try{
                      const result=await Promise.race([aiTagImage(url),new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),25000))]);
                      if(result){
                        const {elements:aiEl}=result;
                        if(Array.isArray(aiEl)&&aiEl.length>0){
                          setZoneElements(p=>({...p,[k]:aiEl}));
                          showMsg(`✓ AI found ${aiEl.length} elements`,"green");
                        }else{showMsg("AI found no elements — add manually","red");}
                      }else{showMsg("AI tagging failed","red");}
                    }catch(e){showMsg(e.message==="timeout"?"Timed out — add manually":"AI failed","red");}
                    setZoneAiFilling(p=>({...p,[k]:false}));
                  }} style={{...S.btn(false),fontSize:10,padding:"4px 10px",opacity:zoneAiFilling[k]?0.6:1}}>{zoneAiFilling[k]?"🔄 Reading...":"🤖 AI Fill"}</button>}
                  <div style={{position:"relative"}}>
                    <input value={zoneElSearch[k]||""} onChange={e=>setZoneElSearch(p=>({...p,[k]:e.target.value}))} placeholder="+ Add element..." style={{...S.input,fontSize:10,padding:"3px 8px",width:140,marginBottom:0}} onFocus={()=>setZoneElSearch(p=>({...p,[k]:""})) } />
                    {(zoneElSearch[k]||"").length>=1&&(()=>{
                      const q=(zoneElSearch[k]||"").toLowerCase();
                      // A kit's own components are already covered by that kit — don't offer adding
                      // one separately (would double the item and double its cost).
                      const kitCoveredIds=new Set((zoneElements[k]||[]).filter(el=>el.invId).flatMap(el=>{
                        const it=(imsInventory||[]).find(i=>i.id===el.invId);
                        const comps=Array.isArray(el.kitOverrides)?el.kitOverrides:(it?.subItems||[]);
                        return comps.map(c=>c.itemId);
                      }));
                      // Searches IMS inventory + pure flower-recipe patterns with no inventory backing
                      // (Rate Card is not consulted here — see getElPriceFromInventory /
                      // getElPriceFromPattern in StudioApp.jsx).
                      const invMatches=(imsInventory||[]).filter(it=>!(zoneElements[k]||[]).find(el=>el.invId===it.id)&&!kitCoveredIds.has(it.id)&&!isHiddenSubcat(it,rcSubcatFactors)&&(it.name.toLowerCase().includes(q)||(it.cat||"").toLowerCase().includes(q)||(it.subCat||it.subcategory||"").toLowerCase().includes(q))).slice(0,8);
                      const patMatches=(recipeOnlyPatterns||[]).filter(pt=>!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)&&pt.name.toLowerCase().includes(q)).slice(0,4);
                      const matches=[...invMatches.map(it=>({kind:"inv",it})),...patMatches.map(pt=>({kind:"pat",pt}))].slice(0,8);
                      return matches.length>0?<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:340,overflowY:"auto",width:320}}>
                        {matches.map(m=>{
                          if(m.kind==="pat"){ const pt=m.pt; return <div key={"pat:"+pt.id}
                            onClick={()=>{
                              if(!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:pt.name,qty:1,unit:pt.unit,size:"",patternId:pt.id}]}));}
                              setZoneElSearch(prev=>({...prev,[k]:""}));
                            }}
                            style={{padding:"8px 10px",fontSize:11,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                            <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontSize:22,opacity:0.5}}>🌺</span>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pt.name}</span>
                                <span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:700,flexShrink:0}}>🌺 RECIPE</span>
                              </div>
                              <div style={{fontSize:9,color:textS,marginTop:2}}>{pt.sub?pt.sub+" › ":""}Flower recipe — no inventory item</div>
                            </div>
                          </div>; }
                          const it=m.it; const isKit=Array.isArray(it.subItems)&&it.subItems.length>0; const src=it.img||it.photoUrls?.[0];
                          const remaining=remainingForItem(it.id,k); const isBlocked=remaining!=null&&remaining<=0;
                          return <div key={"inv:"+it.id}
                            onClick={()=>{
                              if(isBlocked) return;
                              if(!(zoneElements[k]||[]).find(el=>el.invId===it.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:it.name,qty:1,unit:it.unit,size:"",invId:it.id}]}));}
                              setZoneElSearch(prev=>({...prev,[k]:""}));
                            }}
                            style={{padding:"8px 10px",fontSize:11,cursor:isBlocked?"not-allowed":"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10,opacity:isBlocked?0.45:1}}>
                            <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:<span style={{fontSize:22,opacity:0.3}}>📦</span>}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</span>
                                {isKit&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700,flexShrink:0}}>📦 KIT</span>}
                                {isBlocked&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700,flexShrink:0}}>🚫 fully used in this event</span>}
                                {!isBlocked&&remaining!=null&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700,flexShrink:0}}>{remaining} left for this event</span>}
                              </div>
                              <div style={{fontSize:9,color:textS,marginTop:2}}>{(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › ":""}{it.cat}</div>
                            </div>
                          </div>;
                        })}
                      </div>:<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,padding:"8px 10px",fontSize:10,color:textS,width:320}}>No matches</div>;
                    })()}
                  </div>
                </div>
              </div>
              <div style={{background:isDark?"#12121F":"#FAFAFA",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
                {(zoneElements[k]||[]).map((el, idx) => {
                  const priceInfo = getElPrice(el, zoneConfig[k], { checkAvailability: true });
                  const rc = priceInfo.rc;
                  const hasSizes = rcIsSMB(rc);
                  const isTrussSqft = rc && rc.unit === "truss_sqft";
                  const rawUp = priceInfo.unitPrice;
                  const adjUp = applyFloralRatio(rawUp, rc);
                  const lineTotal = isTrussSqft
                    ? applyFloralRatio(priceInfo.lineCost, rc)
                    : (el.qty||0) * adjUp;
                  const invItem = el.invId ? (imsInventory||[]).find(i=>i.id===el.invId) : null;
                  const isKit = !!(invItem && Array.isArray(invItem.subItems) && invItem.subItems.length>0);
                  const thumbItem = invItem || (imsInventory||[]).find(i=>i.name===el.name);
                  const thumbSrc = thumbItem?.img || thumbItem?.photoUrls?.[0];
                  const thumbKey = `${k}:${idx}`;
                  return (
                  <div key={idx} style={{display:"flex",flexDirection:"column",padding:"6px 0",borderBottom:`1px solid ${border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{position:"relative",flexShrink:0}}
                          onMouseEnter={(e)=>{
                            if(!thumbSrc) return;
                            const r=e.currentTarget.getBoundingClientRect();
                            const POP=164;
                            const openUp=window.innerHeight-r.bottom<POP+8 && r.top>POP+8;
                            setElThumbHover({key:thumbKey,openUp,top:openUp?undefined:r.bottom+4,bottom:openUp?window.innerHeight-r.top+4:undefined,left:Math.min(r.left,window.innerWidth-168)});
                          }}
                          onMouseLeave={()=>setElThumbHover(null)}>
                          {thumbSrc ? <img src={thumbSrc} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover",cursor:"zoom-in"}}/> : <div style={{width:20,height:20,borderRadius:4,background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>📦</div>}
                          {elThumbHover?.key===thumbKey && thumbSrc && (
                            <div style={{position:"fixed",top:elThumbHover.top,bottom:elThumbHover.bottom,left:elThumbHover.left,zIndex:10000,width:160,height:160,borderRadius:8,overflow:"hidden",border:`2px solid ${border}`,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",pointerEvents:"none"}}>
                              <img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            </div>
                          )}
                        </div>
                        <span style={{fontSize:12,fontWeight:500,color:(rc||el.invId||el.patternId)?textP:"#F59E0B"}}>{el.name}</span>
                        {isKit&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700}}>📦 KIT</span>}
                        {!rc&&!el.invId&&!el.patternId&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700}}>NEW</span>}
                        {el.invId&&priceInfo.warning&&<span title={priceInfo.warning} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700}}>⚠ short</span>}
                        {(rc||el.invId)&&<span onClick={()=>openAvailModal(k, idx, el, rc)} title="Check stock availability & pick an item" style={{cursor:"pointer",fontSize:11,opacity:0.5,padding:"0 1px",lineHeight:1}}>📦</span>}
                        {el.imsId&&<span onClick={()=>openAvailModal(k, idx, el, rc)} title={`Booking: ${el.imsName||"selected item"} — tap to change`} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:2,fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"#059669",fontWeight:700,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>📌 {el.imsName||"pinned"}</span>}
                        {showCosts&&rc&&(rc.cat||"").toLowerCase()==="florals"&&floralRatio>0&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(0,0,0,0.05)",color:"#888",fontWeight:700}}>{"🌸"} {100-floralRatio}% real</span>}
                        {isTrussSqft&&priceInfo.area>0&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(59,130,246,0.12)",color:"#3B82F6",fontWeight:600}}>{priceInfo.area} sqft</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2,flexWrap:"wrap"}}>
                        {hasSizes&&!priceInfo.isFloralBlend&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:9,fontWeight:(el.size||"M")===s?700:400,cursor:"pointer",background:(el.size||"M")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"M")===s?"#666":textS}}>{s}</button>)}
                        {priceInfo.isFloralBlend&&priceInfo.patternSMB&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:9,fontWeight:(el.size||"B")===s?700:400,cursor:"pointer",background:(el.size||"B")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"B")===s?"#666":textS}}>{s}</button>)}
                        {hasSizes&&!priceInfo.isFloralBlend&&<button onClick={()=>{const elems=[...(zoneElements[k]||[])];const used=new Set(elems.filter(e=>e.name===el.name).map(e=>e.size||"M"));const ns=["B","M","S"].find(s=>!used.has(s))||"B";elems.splice(idx+1,0,{...el,size:ns,qty:1});setZoneElements(p=>({...p,[k]:elems}));}} title="Split into another size (e.g. 3 Big + 2 Small)" style={{padding:"1px 6px",borderRadius:4,border:`1px dashed ${border}`,fontSize:9,fontWeight:600,cursor:"pointer",background:"transparent",color:accent}}>＋ size</button>}
                        {priceInfo.isFloralBlend&&<span style={{display:"flex",alignItems:"center",gap:3,fontSize:9,fontWeight:700}}>{"🌸"}<button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:undefined};setZoneElements(p=>({...p,[k]:elems}));}} title="Use this sub-category's default real/artificial ratio" style={{padding:"1px 6px",borderRadius:3,border:"none",cursor:"pointer",background:typeof el.realPct!=="number"?"#EC4899":"rgba(236,72,153,0.12)",color:typeof el.realPct!=="number"?"#fff":"#EC4899"}}>🌐 Ratio</button><button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:100};setZoneElements(p=>({...p,[k]:elems}));}} title="Price this element at 100% the recipe's Studio rate, overriding the sub-category's default" style={{padding:"1px 6px",borderRadius:3,border:"none",cursor:"pointer",background:el.realPct===100?"#EC4899":"rgba(236,72,153,0.12)",color:el.realPct===100?"#fff":"#EC4899"}}>🎯 100%</button><input type="number" min="0" max="100" value={el.realPct??""} placeholder={String(priceInfo.realPct??"")} onChange={e=>{const v=e.target.value;const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:v===""?undefined:Math.max(0,Math.min(100,parseFloat(v)||0))};setZoneElements(p=>({...p,[k]:elems}));}} title="Manually set the exact % real — overrides Ratio/100%" style={{width:42,padding:"1px 4px",borderRadius:3,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:9,textAlign:"center"}} /></span>}
                        {/* §23 Phase 2.9 → Paint Allocation Ops (05 Jun 2026) — item-level paintability */}
                        {(()=>{
                          // New rule: paintable iff sub-category has ≥1 IMS item with paintCost > 0
                          // Falls back to PAINT_TOKENS keyword match when IMS inventory not loaded
                          const imsInv = dealCheckData?.inventory || [];
                          const subcatCheck = rc ? isSubcatPaintable(rc.sub, imsInv) : false;
                          let isPaintable;
                          if (subcatCheck === null) {
                            // IMS not loaded — fall back to keyword match
                            const _cat = String(rc?.cat||"").toLowerCase();
                            const _sub = String(rc?.sub||"").toLowerCase();
                            isPaintable = rc && PAINT_TOKENS_FALLBACK.some(tok => _cat.includes(tok) || _sub.includes(tok));
                          } else {
                            isPaintable = subcatCheck;
                          }
                          if (!isPaintable) return null;
                          // Look up baseColour from IMS inventory (via dealCheckData if available)
                          const invItem = (dealCheckData?.inventory || []).find(i => i.name === el.name);
                          const baseColour = invItem?.baseColour || "Ivory";
                          // §23 Phase 2.9d — multi-colour allocation aware
                          const allocs = normalizePaintAllocation(el, baseColour);
                          const isOverridden = allocs.length > 0;
                          const label = paintPillLabel(el, baseColour);
                          // Swatch colour: if 1 alloc, show that. If 2+, show first 2 split chip.
                          const firstColour = allocs[0]?.colour || baseColour;
                          const secondColour = allocs[1]?.colour;
                          const cObj1 = imsColourCatalogue.find(c => c.name === firstColour);
                          const cObj2 = secondColour ? imsColourCatalogue.find(c => c.name === secondColour) : null;
                          return (
                            <button onClick={()=>setPaintPickerTarget({zoneKey:k, elIdx:idx})}
                              title="Tap to allocate paint colours"
                              style={{
                                display:"flex",
                                alignItems:"center",
                                gap:4,
                                padding:"3px 8px 3px 6px",
                                borderRadius:6,
                                border: isOverridden ? "1.5px solid #EC4899" : `1.5px dashed ${isDark?"rgba(255,255,255,0.25)":"rgba(124,58,237,0.4)"}`,
                                background: isOverridden ? "rgba(236,72,153,0.10)" : (isDark?"rgba(124,58,237,0.08)":"rgba(124,58,237,0.05)"),
                                cursor:"pointer",
                                fontSize:10,
                                fontWeight:isOverridden?700:600,
                                color: isOverridden ? "#EC4899" : (isDark?"#C4B5FD":"#7c3aed")
                              }}>
                              <span style={{fontSize:11}}>🎨</span>
                              {/* Split-chip swatch when 2+ colours */}
                              {cObj2 ? (
                                <span style={{display:"inline-flex",width:14,height:10,borderRadius:2,overflow:"hidden",border:"1px solid rgba(0,0,0,0.15)"}}>
                                  <span style={{width:7,background:cObj1?.hex||"#F5F0E1"}} />
                                  <span style={{width:7,background:cObj2?.hex||"#ccc"}} />
                                </span>
                              ) : (
                                <span style={{width:10,height:10,borderRadius:2,border:"1px solid rgba(0,0,0,0.15)",background:cObj1?.hex||"#F5F0E1"}} />
                              )}
                              <span>{label}</span>
                              {isOverridden && <span style={{fontSize:8,padding:"0 4px",borderRadius:3,background:"#EC4899",color:"#fff",fontWeight:700,marginLeft:2}}>🖌</span>}
                            </button>
                          );
                        })()}
                        {showCosts&&<span style={{fontSize:10,color:textS,marginLeft:4}}>{adjUp>0?`₹${adjUp.toLocaleString("en-IN")}/${isTrussSqft?"truss sqft":(invItem?.unit||rc?.unit||el.unit)}`:"₹0"}</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {isTrussSqft ? (
                        <div style={{fontSize:11,fontWeight:600,color:textS,padding:"3px 8px",borderRadius:6,background:isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)",minWidth:64,textAlign:"center"}}>{priceInfo.area>0?`× ${priceInfo.area} sqft`:"× — sqft"}</div>
                      ) : (
                        <>
                          <button onClick={()=>{
                            const elems=[...(zoneElements[k]||[])];
                            const nextQty = Math.max(0,(el.qty||0)-1);
                            // §23 Phase 2.9d — block qty reduction below paint allocation total
                            const invItem = (dealCheckData?.inventory || []).find(i => i.name === el.name);
                            const baseColour = invItem?.baseColour || "Ivory";
                            const allocs = normalizePaintAllocation(el, baseColour);
                            const allocTotal = allocs.reduce((s,a) => s + a.qty, 0);
                            if (allocTotal > 0 && nextQty < allocTotal) {
                              showMsg(`Cannot reduce qty below ${allocTotal} — paint allocation is set. Open 🎨 picker to adjust allocation first.`, "red");
                              return;
                            }
                            elems[idx]={...elems[idx],qty:nextQty};
                            setZoneElements(p=>({...p,[k]:elems}));
                          }} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>{"−"}</button>
                          <input type="number" min="0" value={el.qty||0} onChange={e=>{
                            const elems=[...(zoneElements[k]||[])];
                            const nextQty = Math.max(0,parseInt(e.target.value)||0);
                            // §23 Phase 2.9d — same guard for direct typing
                            const invItem = (dealCheckData?.inventory || []).find(i => i.name === el.name);
                            const baseColour = invItem?.baseColour || "Ivory";
                            const allocs = normalizePaintAllocation(el, baseColour);
                            const allocTotal = allocs.reduce((s,a) => s + a.qty, 0);
                            if (allocTotal > 0 && nextQty < allocTotal) {
                              showMsg(`Cannot set qty below ${allocTotal} — paint allocation is set. Open 🎨 picker first.`, "red");
                              return;
                            }
                            elems[idx]={...elems[idx],qty:nextQty};
                            setZoneElements(p=>({...p,[k]:elems}));
                          }} onFocus={e=>e.target.select()} style={{width:46,padding:"3px 4px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:(el.qty||0)>0?textP:textS,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit",MozAppearance:"textfield"}}/>
                          <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:(el.qty||0)+1};setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                        </>
                      )}
                      {showCosts&&<div style={{fontSize:12,fontWeight:600,color:lineTotal>0?textP:textS,minWidth:60,textAlign:"right"}}>{lineTotal>0?fmt(lineTotal):"—"}</div>}
                      <span onClick={()=>{const elems=(zoneElements[k]||[]).filter((_,i)=>i!==idx);setZoneElements(p=>({...p,[k]:elems}));}} style={{cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12}}>×</span>
                    </div>
                    </div>
                    {isTrussSqft&&priceInfo.warning&&<div style={{fontSize:10,color:"#F59E0B",marginTop:4,padding:"4px 6px",borderRadius:4,background:"rgba(245,158,11,0.08)"}}>{priceInfo.warning}</div>}
                    {isKit&&<KitComponentsEditor
                      item={invItem}
                      overrides={el.kitOverrides}
                      onChange={(next)=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],kitOverrides:next};setZoneElements(p=>({...p,[k]:elems}));}}
                      imsInventory={imsInventory}
                      qtyMultiplier={el.qty||1}
                      dealAwareness={{getRemaining:(itemId)=>remainingForItem(itemId,k,idx)}}
                      rcSubcatFactors={rcSubcatFactors}
                      textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                    />}
                  </div>);
                })}
                {(zoneElements[k]||[]).length>0&&showCosts&&<div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0 0",fontWeight:700,color:textP}}>{fmt(calcElsCost(zoneElements[k],true,zoneConfig[k]))}</div>}
              </div>
            </div>
          ) : (
            <div style={{background:isDark?"rgba(124,58,237,0.06)":"#F5F3FF",borderRadius:12,padding:"20px 16px",marginBottom:10,textAlign:"center"}}>
              <div style={{fontSize:13,fontWeight:600,color:"#666",marginBottom:4}}>{"📷"} Select a photo above to load element pricing</div>
              <div style={{fontSize:11,color:textS}}>Pick a library photo with an element card — items, quantities, and Rate Card pricing will load automatically</div>
            </div>
          )}

          {/* Print — a print job (Flex/Vinyl/Sunboard etc.). Stored on zoneConfig[k].prints so it
              free-rides every existing zoneConfig save/load/copy path without needing its own
              persistence plumbing (mirrors Library's ManageLibrary.jsx). Linking a print row to an
              inventory element is optional, not required — a print isn't always for something
              already in Inventory (e.g. a custom banner/backdrop graphic). */}
          <div style={{background:isDark?"#12121F":"#F9F9F6",borderRadius:10,padding:"10px 14px",marginBottom:10,border:`1px solid ${border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:"#0EA5E9"}}>{"🖨️"} Print</div>
              <button onClick={()=>{
                const entry={id:"PR"+Date.now()+Math.floor(Math.random()*1000),material:(imsPrintMaterials||[])[0]?.id||"",areaW:0,areaD:0,refImageUrl:"",invId:null};
                setZoneConfig(p=>({...p,[k]:{...(p[k]||{}),prints:[...((p[k]||{}).prints||[]),entry]}}));
              }} style={{padding:"4px 10px",borderRadius:8,border:"1px solid #0EA5E9",background:"rgba(14,165,233,0.14)",color:"#0EA5E9",fontSize:10,fontWeight:600,cursor:"pointer"}}>+ Add Print Row</button>
            </div>
            {(()=>{
              // Opens with one ready-to-edit blank row instead of a "no prints" empty state — purely
              // visual (not written to zoneConfig) until the user actually edits it, so leaving it
              // untouched never persists an empty row.
              const rows=((zoneConfig[k]||{}).prints||[]).length===0
                ? [{id:"__phantom__",material:(imsPrintMaterials||[])[0]?.id||"",areaW:0,areaD:0,refImageUrl:"",invId:null}]
                : (zoneConfig[k]||{}).prints;
              return (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {rows.map((p,pi)=>{
                  const isPhantom=p.id==="__phantom__";
                  const invItem=p.invId?(imsInventory||[]).find(i=>i.id===p.invId):null;
                  const thumbSrc=invItem?.img||invItem?.photoUrls?.[0];
                  const mat=(imsPrintMaterials||[]).find(m=>m.id===p.material);
                  const sqft=(Number(p.areaW)||0)*(Number(p.areaD)||0);
                  const rate=mat?.ratePerSqft||0;
                  const cost=sqft*rate;
                  const setPrint=(patch)=>{
                    if(isPhantom){setZoneConfig(prev=>({...prev,[k]:{...(prev[k]||{}),prints:[{...p,...patch,id:"PR"+Date.now()+Math.floor(Math.random()*1000)}]}}));return;}
                    setZoneConfig(prev=>({...prev,[k]:{...(prev[k]||{}),prints:(prev[k]?.prints||[]).map((x,i)=>i===pi?{...x,...patch}:x)}}));
                  };
                  const removePrint=()=>setZoneConfig(prev=>({...prev,[k]:{...(prev[k]||{}),prints:(prev[k]?.prints||[]).filter((_,i)=>i!==pi)}}));
                  const linkQ=zonePrintSearch[p.id]||"";
                  return <div key={p.id} style={{padding:"8px 10px",borderRadius:8,background:isDark?"rgba(14,165,233,0.06)":"rgba(14,165,233,0.05)",border:"1px solid rgba(14,165,233,0.25)"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <select value={p.material||""} onChange={e=>setPrint({material:e.target.value})} style={{...S.select,fontSize:10,padding:"3px 6px",width:"auto"}}>
                        <option value="">Material…</option>
                        {(imsPrintMaterials||[]).map(m=><option key={m.id} value={m.id}>{m.name} (₹{m.ratePerSqft}/sqft)</option>)}
                      </select>
                      <input type="number" min="0" step="0.1" value={p.areaW||""} onChange={e=>setPrint({areaW:parseFloat(e.target.value)||0})} placeholder="W ft" style={{...S.input,fontSize:10,padding:"3px 6px",width:56,marginBottom:0,textAlign:"center"}} />
                      <span style={{fontSize:10,color:textS}}>×</span>
                      <input type="number" min="0" step="0.1" value={p.areaD||""} onChange={e=>setPrint({areaD:parseFloat(e.target.value)||0})} placeholder="D ft" style={{...S.input,fontSize:10,padding:"3px 6px",width:56,marginBottom:0,textAlign:"center"}} />
                      <span style={{fontSize:10,color:textS}}>ft = {sqft?sqft.toFixed(1):0} sqft</span>
                      {showCosts&&<span style={{fontSize:11,fontWeight:700,color:"#0EA5E9",marginLeft:"auto"}}>{rate>0?fmt(cost):"— pick material"}</span>}
                      {!isPhantom&&<span onClick={removePrint} style={{cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12}}>×</span>}
                    </div>
                    <input value={p.refImageUrl||""} onChange={e=>setPrint({refImageUrl:e.target.value})} placeholder="Reference image URL (optional)" style={{...S.input,fontSize:10,padding:"3px 8px",marginTop:6,marginBottom:0,width:"100%"}} />
                    {p.refImageUrl&&<img src={p.refImageUrl} alt="" style={{marginTop:6,width:"100%",maxHeight:100,objectFit:"cover",borderRadius:6}} onError={e=>{e.target.style.display="none";}} />}
                    {/* Optional link to an inventory element — for cross-reference only, never required */}
                    {p.invId ? (
                      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                        <div style={{width:20,height:20,borderRadius:4,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {thumbSrc?<img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:10,opacity:0.3}}>📦</span>}
                        </div>
                        <span style={{fontSize:10,color:invItem?textS:"#F59E0B",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{"🔗 "}{invItem?invItem.name:`⚠ ${p.invId} not in IMS`}</span>
                        <span onClick={()=>setPrint({invId:null})} style={{cursor:"pointer",color:textS,fontSize:9,textDecoration:"underline"}}>Unlink</span>
                      </div>
                    ) : (
                      <div style={{position:"relative",marginTop:6}}>
                        <input value={linkQ} onChange={e=>setZonePrintSearch(prev=>({...prev,[p.id]:e.target.value}))} placeholder="🔗 Link to an inventory item (optional)" style={{...S.input,fontSize:10,padding:"3px 8px",width:"100%",marginBottom:0}} />
                        {linkQ.trim() && (()=>{
                          const tokens=linkQ.toLowerCase().trim().split(/\s+/).filter(Boolean);
                          const matches=(imsInventory||[]).filter(it=>tokens.every(t=>(it.name+" "+(it.subCat||it.subcategory||"")+" "+(it.cat||"")).toLowerCase().includes(t))).slice(0,40);
                          return <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:260,overflowY:"auto"}}>
                            {matches.length===0&&<div style={{padding:"8px 10px",fontSize:10,color:textS}}>No matches</div>}
                            {matches.map(it=>{
                              const src=it.img||it.photoUrls?.[0];
                              return <div key={it.id} onClick={()=>{
                                const toFt=(v,u)=>(Number(v)||0)*({Feet:1,Inches:1/12,Cm:1/30.48,Metre:3.28084}[u]||1);
                                const patch={invId:it.id};
                                if(!p.areaW&&!p.areaD){if(it.printW)patch.areaW=toFt(it.printW,it.printUnit);if(it.printL)patch.areaD=toFt(it.printL,it.printUnit);}
                                setPrint(patch);
                                setZonePrintSearch(prev=>({...prev,[p.id]:""}));
                              }} style={{padding:"8px 10px",fontSize:11,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:32,height:32,borderRadius:6,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                                  {src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:15,opacity:0.3}}>📦</span>}
                                </div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{it.name}</div>
                                  <div style={{fontSize:9,color:textS,marginTop:2}}>{(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › ":""}{it.cat}{it.printW?" · print area on file":""}</div>
                                </div>
                              </div>;
                            })}
                          </div>;
                        })()}
                      </div>
                    )}
                  </div>;
                })}
                {showCosts&&((zoneConfig[k]||{}).prints||[]).length>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:700,paddingTop:4}}>
                  <span style={{color:textP}}>Print Total</span>
                  <span style={{color:"#0EA5E9"}}>{fmt(((zoneConfig[k]||{}).prints||[]).reduce((sum,p)=>{const m=(imsPrintMaterials||[]).find(x=>x.id===p.material);const s=(Number(p.areaW)||0)*(Number(p.areaD)||0);return sum+s*(m?.ratePerSqft||0);},0))}</span>
                </div>}
              </div>
              );
            })()}
          </div>

          {/* Zone structure — always visible, costs hidden behind toggle */}
          {zoneMeta[k]&&zoneMeta[k].dimFields?.length>0&&zoneConfig[k]&&(()=>{
            const zm=zoneMeta[k],zc=zoneConfig[k],st=calcStructCost(k,zc);
            const dl={L:"Depth",W:"Width",H:"Height",S:"Size"};
            const sZ=u=>{setActiveZones([]);setZoneConfig(p=>({...p,[k]:{...p[k],...u}}));};
            const sD=(d,v)=>{setActiveZones([]);setZoneConfig(p=>{const cur=p[k]||{};const dims={...(cur.dims||{}),[d]:parseFloat(v)||0};
              // 3 dims filled ⇒ Box, exactly 2 ⇒ Single U — keep the toggle + pricing in sync with the dims.
              const n=[dims.W,dims.L,dims.H].filter(x=>(Number(x)||0)>0).length;const trT=n>=3?"box":n===2?"singleU":cur.trT;
              return {...p,[k]:{...cur,dims,trT}};});};
            const sFD=(d,v)=>{setActiveZones([]);setZoneConfig(p=>({...p,[k]:{...p[k],floorDims:{...(p[k]?.floorDims||{}),[d]:parseFloat(v)||0}}}));};
            const fd=zc.floorDims||{};
            return(<div style={{background:isDark?"#12121F":"#F9F9F6",borderRadius:10,padding:"10px 14px",marginBottom:10,border:`1px solid ${border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:textS}}>{"📐"} Zone Structure</div>
                {showCosts&&<div style={{fontSize:13,fontWeight:700,color:textP}}>{fmt(st.total)}</div>}
              </div>
              {/* ── TRUSS + MASKING → then truss dims ── */}
              <div style={{fontSize:12,marginBottom:6}}>
                {zm.defaultTruss&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><span>{"🔩"} Truss</span>
                    {["box","singleU"].map(tt=><button key={tt} onClick={()=>sZ({trT:tt})} style={{padding:"2px 8px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.trT===tt?700:400,background:zc.trT===tt?"rgba(0,0,0,0.08)":"transparent",color:zc.trT===tt?textP:textS}}>{tt==="box"?"Box"+(showCosts?" ₹50":""):"Single U"+(showCosts?" ₹30":"")}{showCosts?"/sqft":""}</button>)}
                  </div>{showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(st.truss)}</span>}
                </div>}
                {zm.hasMasking&&(()=>{
                  const dL=zc.dims?.L||zc.dims?.S||0,dW=zc.dims?.W||zc.dims?.S||0,dH=zc.dims?.H||0;
                  const mw=zc.mkWalls||{};
                  const toggleWall=(wall)=>sZ({mkWalls:{...mw,[wall]:!mw[wall]},mkOn:true});
                  // §23 Phase 2.8 — config-aware walls (3 branches)
                  //   Full Box  → back/left/right toggleable (front always open)
                  //   Half Box  → back (L-span) + left/right (backDepth) all toggleable
                  //   U Truss   → back only (L-span). No left/right options.
                  const _trCfg = resolveTrussConfig(zc);
                  const _cfg = _trCfg?.config || (zc.trT==="box" ? "full_box" : "half_box");
                  const _spanL = _trCfg?.spanFt || dL || dW;
                  const _backDepth = zc.trussBackDepth || 4;
                  // §23 Phase 2.8 silent migration — set defaults once per zone.
                  // FIX A (26 May): For existing zones, force-tick left/right ON for Half Box
                  // and back ON for U Truss — overwriting prior `false` values. Runs once per
                  // zone, guarded by _mkWallsMigratedV28 flag. After migration, the user can
                  // untick freely; flag prevents re-migration.
                  if (zc.mkOn && !zc._mkWallsMigratedV28) {
                    const _nextMw = {...mw};
                    let _changed = false;
                    if (_cfg === "half_box") {
                      if (_nextMw.back  !== true) { _nextMw.back  = true; _changed = true; }
                      if (_nextMw.left  !== true) { _nextMw.left  = true; _changed = true; }
                      if (_nextMw.right !== true) { _nextMw.right = true; _changed = true; }
                    } else if (_cfg === "u_only") {
                      if (_nextMw.back !== true) { _nextMw.back = true; _changed = true; }
                    }
                    // Always mark migrated + record current config (even if no change needed)
                    setTimeout(() => sZ(_changed ? {mkWalls: _nextMw, _mkWallsMigratedV28: true, _lastMkCfg: _cfg} : {_mkWallsMigratedV28: true, _lastMkCfg: _cfg}), 0);
                  }
                  // §23 Phase 2.8 type-transition handler — if user adds/removes W dim and the truss
                  // config flips (half_box ↔ full_box, full_box → u_only, etc.), reset mkWalls per
                  // the new type's defaults. Half Box → Full Box: all OFF (opt-in). Anything → Half Box:
                  // all ON (default). Anything → U Truss: back ON, left/right cleared.
                  else if (zc.mkOn && zc._lastMkCfg && zc._lastMkCfg !== _cfg) {
                    let _resetMw;
                    if (_cfg === "full_box") {
                      // Opt-in per spec — start fully unchecked
                      _resetMw = {back: false, left: false, right: false};
                    } else if (_cfg === "half_box") {
                      _resetMw = {back: true, left: true, right: true};
                    } else if (_cfg === "u_only") {
                      _resetMw = {back: true};
                    } else {
                      _resetMw = mw;
                    }
                    setTimeout(() => sZ({mkWalls: _resetMw, _lastMkCfg: _cfg}), 0);
                  }
                  const walls = _cfg === "full_box" ? [
                    {id:"back",label:"Back",dim:`${dW}×${dH}`,sqft:dW*dH},
                    {id:"left",label:"Left",dim:`${dL}×${dH}`,sqft:dL*dH},
                    {id:"right",label:"Right",dim:`${dL}×${dH}`,sqft:dL*dH}
                  ] : _cfg === "half_box" ? [
                    {id:"back",label:"Back",dim:`${_spanL}×${dH}`,sqft:_spanL*dH},
                    {id:"left",label:"Left",dim:`${_backDepth}×${dH}`,sqft:_backDepth*dH},
                    {id:"right",label:"Right",dim:`${_backDepth}×${dH}`,sqft:_backDepth*dH}
                  ] : [
                    {id:"back",label:"Back",dim:`${_spanL}×${dH}`,sqft:_spanL*dH}
                  ];
                  return <div style={{padding:"4px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}><span>{"🧱"} Masking</span>
                      <div onClick={()=>sZ({mkOn:!zc.mkOn,mkWalls:zc.mkOn?{}:mw})} style={{width:30,height:16,borderRadius:8,background:zc.mkOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}}><div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:zc.mkOn?16:2,transition:"left 0.2s"}}/></div>
                    </div>{showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(st.masking)}</span>}
                  </div>
                  {zc.mkOn&&<div style={{marginTop:4,paddingLeft:20}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
                      {MASK_OPTS.map(o=><button key={o.id} onClick={()=>sZ({mkT:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.mkT===o.id?700:400,background:zc.mkT===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.mkT===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {walls.map(w=>{const on=mw[w.id];return <button key={w.id} onClick={()=>toggleWall(w.id)} style={{padding:"3px 10px",borderRadius:6,border:`1px solid ${on?textP:border}`,fontSize:10,cursor:"pointer",fontWeight:on?600:400,background:on?"rgba(0,0,0,0.06)":"transparent",color:on?textP:textS}}>{on?"✓":""} {w.label} ({w.dim}){showCosts&&w.sqft>0?` = ${w.sqft} sqft`:""}</button>;})}
                    </div>
                  </div>}
                </div>;})()}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:6}}>
                {[["W","Width"],["L","Depth"],["H","Height"]].map(([d,label])=><div key={d} style={{flex:1}}><div style={{fontSize:10,color:textS,marginBottom:3}}>Truss {label} (ft)</div>
                  <input type="number" value={zc.dims?.[d]||""} onChange={e=>sD(d,e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>)}
                {zc.trT&&<div style={{flex:1}}><div style={{fontSize:10,color:textS,marginBottom:3}}>Truss Qty</div>
                  <input type="number" min={1} value={zc.trussQty||1} onChange={e=>sZ({trussQty:Math.max(1,parseInt(e.target.value)||1)})} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>}
                {zc.trT==="box"&&<div style={{flex:1}}><div style={{fontSize:10,color:textS,marginBottom:3}} title="Single-U extension on each front side, this many ft long. Priced as 2× Single U truss. Rare.">Front ext (ft/side)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExt||""} onChange={e=>sZ({trussFrontExt:Math.max(0,parseFloat(e.target.value)||0)})} placeholder="0" style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>}
                {zc.trT==="box"&&(Number(zc.trussFrontExt)||0)>0&&<div style={{flex:1}}><div style={{fontSize:10,color:textS,marginBottom:3}} title="Height of the front extension (can differ from box height). Defaults to box height.">Ext height (ft)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExtH||""} onChange={e=>sZ({trussFrontExtH:Math.max(0,parseFloat(e.target.value)||0)})} placeholder={String(zc.dims?.H||0)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}}/></div>}
              </div>
              {/* §23 Phase 5 (28 May 2026) — Smart truss tip: add 1ft per pillar to physical span */}
              {(() => {
                const dims = zc.dims || {};
                const L = parseFloat(dims.L) || 0;
                const W = parseFloat(dims.W) || 0;
                if (L < 4 && W < 4) return null;  // no dims yet
                const span = Math.max(L, W);
                // Sweet spots for clean truss (using standard 15/12/10/8/5/4/3/2 beam stock + 1ft/pillar budget)
                // 2-pillar (span ≤ 30): 12, 17, 24, 27, 29, 32 → these give 0/1 joint, 0-gap
                // 3-pillar (31-60): 43, 47, 53, 57, 63 → 1-2 joints per segment
                // 4-pillar (61-90): 64, 74, 84 → 2 joints per segment
                const sweetSpots2 = [12, 17, 24, 27, 29, 32];
                const sweetSpots3 = [43, 47, 53, 57, 63];
                const sweetSpots4 = [64, 74, 84];
                const all = [...sweetSpots2, ...sweetSpots3, ...sweetSpots4];
                const isExact = all.includes(span);
                // Find nearest sweet spot within ±5ft
                let nearest = null;
                let nearestDist = 999;
                for (const s of all) {
                  const d = Math.abs(s - span);
                  if (d > 0 && d <= 5 && d < nearestDist) {
                    nearest = s;
                    nearestDist = d;
                  }
                }
                if (isExact) {
                  return <div style={{marginBottom:10,padding:"4px 8px",borderRadius:6,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)",fontSize:10,color:"#15803D",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>✓</span><span>Smart truss: clean allocation (minimum joints).</span>
                  </div>;
                }
                if (nearest) {
                  return <div style={{marginBottom:10,padding:"4px 8px",borderRadius:6,background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.25)",fontSize:10,color:"#1E40AF",display:"flex",alignItems:"center",gap:6}}>
                    <span>💡</span><span>Tip: try <strong>{nearest}ft</strong> for cleanest truss (fewer joints, less ops effort).</span>
                  </div>;
                }
                return null;
              })()}
              {/* ── §23 Truss Type selector + Height-anchor validation ── */}
              {(()=>{
                const tr = resolveTrussConfig(zc);
                // Don't render anything when no truss intended (all blank)
                if (tr.source === "none") return null;
                // Validation error → inline red message (soft-block via Summary nav warning)
                if (tr.source === "invalid") {
                  return <div style={{marginBottom:10,padding:"8px 12px",borderRadius:8,background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.3)",fontSize:11,color:"#B91C1C",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>⚠️</span><span>{tr.error}</span>
                  </div>;
                }
                // 3-dim filled → auto-Full Box (read-only label, no choice)
                if (tr.source === "auto-3dim") {
                  return <div style={{marginBottom:10,padding:"6px 10px",borderRadius:8,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.2)",fontSize:11,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{color:textS}}>Truss Type:</span>
                    <span style={{fontWeight:700,color:"#B91C1C"}}>🔴 Full Box <span style={{fontWeight:400,color:textS,fontSize:10}}>(auto — all 3 dims filled)</span></span>
                  </div>;
                }
                // 2-dim → sales picks U or Half Box (default Half if not picked)
                const picked = zc.trussType;
                const opts = [
                  { id:"u_only",   label:"🟢 U Truss",       hint:"Cheapest — top + 2 sides only" },
                  { id:"half_box", label:"🟡 Half Box Truss", hint:"Middle — 3 sides (no back beam)" },
                ];
                return <div style={{marginBottom:10,padding:"8px 10px",borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#FFFEF8",border:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:11,fontWeight:600,color:textS}}>Truss Type:</span>
                    {tr.source==="default-on-forget" && <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:"rgba(217,119,6,0.12)",color:"#A16207",fontWeight:600}}>defaulted to Single U</span>}
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {opts.map(o=>{
                      const isOn = picked === o.id;
                      // When not picked, Single U (u_only) visually shows as the default (lighter highlight)
                      const isDefault = !picked && o.id === "u_only";
                      return <button key={o.id} onClick={()=>sZ({trussType:o.id})}
                        style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${isOn?textP:(isDefault?"rgba(217,119,6,0.4)":border)}`,background:isOn?"rgba(0,0,0,0.06)":(isDefault?"rgba(217,119,6,0.06)":"transparent"),color:isOn?textP:textS,fontSize:10,cursor:"pointer",fontWeight:isOn?700:(isDefault?600:400)}}
                        title={o.hint}>{o.label}</button>;
                    })}
                  </div>
                </div>;
              })()}
              {/* ── PLATFORM + CARPET → then floor dims ── */}
              <div style={{fontSize:12,marginBottom:6}}>
                {zm.hasPlatform&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><span>{"🏗️"} Platform</span>
                    {PLAT_OPTS.map(o=><button key={o.id} onClick={()=>sZ({plH:zc.plH===o.id?null:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.plH===o.id?700:400,background:zc.plH===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.plH===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                  </div>{showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(st.platform)}</span>}
                </div>}
                {zm.hasCarpet&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><span>{"🟫"} Carpet</span>
                    {CARP_OPTS.map(o=><button key={o.id} onClick={()=>sZ({cpT:zc.cpT===o.id?null:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.cpT===o.id?700:400,background:zc.cpT===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.cpT===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                  </div>{showCosts&&<span style={{fontWeight:600,color:textP}}>{fmt(st.carpet)}</span>}
                </div>}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:4}}>
                <div style={{flex:1}}><div style={{fontSize:10,color:textS,marginBottom:3}}>Floor Width (ft)</div>
                  <input type="number" value={fd.W||""} onChange={e=>sFD("W",e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}} placeholder={zc.dims?.W||"—"}/></div>
                <div style={{flex:1}}><div style={{fontSize:10,color:textS,marginBottom:3}}>Floor Depth (ft)</div>
                  <input type="number" value={fd.L||""} onChange={e=>sFD("L",e.target.value)} style={{...S.input,padding:"6px 8px",fontSize:14,fontWeight:600,textAlign:"center"}} placeholder={zc.dims?.L||"—"}/></div>
                <div style={{flex:1,display:"flex",alignItems:"flex-end"}}><div style={{fontSize:10,color:textS,lineHeight:1.3}}>{(fd.L||fd.W)?`${fd.L||0}×${fd.W||0} = ${(fd.L||0)*(fd.W||0)} sqft`:"Uses truss L×W if empty"}</div></div>
              </div>
            </div>);
          })()}
          </Fragment>}

          {/* §26.13 — Production/Buying custom items in this zone */}
          {dcCustomItems.filter(ci => ci.fnIdx === (activeFnIdx||0) && ci.zoneKey === k).length > 0 && (
            <div style={{marginTop:10,marginBottom:4}}>
              {dcCustomItems.filter(ci => ci.fnIdx === (activeFnIdx||0) && ci.zoneKey === k).map(ci => {
                const isP = ci.type === "production";
                const ciColor = isP ? "#A855F7" : "#F59E0B";
                const ciIcon = isP ? "🏭" : "🛒";
                const unitCost = ci.manualPrice || ci.refPrice || 0;
                return (
                  <div key={ci.id} style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${ciColor}30`,background:isDark?`${ciColor}08`:`${ciColor}06`,marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>{ciIcon}</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,color:textP}}>{ci.subCat} <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:`${ciColor}15`,color:ciColor,fontWeight:700}}>{isP?"PRODUCTION":"BUYING"}</span></div>
                      <div style={{fontSize:10,color:textS,marginTop:2}}>× {ci.qty}{ci.dims.l?` · ${ci.dims.w}W × ${ci.dims.l}D × ${ci.dims.h}H ft`:""}{ci.notes?` · ${ci.notes}`:""}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:700,color:ciColor}}>₹{Math.round(unitCost * (Number(ci.qty)||1)).toLocaleString("en-IN")}</div>
                      {ci.qty > 1 && <div style={{fontSize:9,color:textS}}>₹{Math.round(unitCost).toLocaleString("en-IN")} × {ci.qty}</div>}
                    </div>
                    <button onClick={()=>setDcCustomItems(prev=>prev.filter(x=>x.id!==ci.id))} style={{padding:"4px 8px",borderRadius:6,border:`1px solid #E11D4820`,background:"#E11D4810",color:"#E11D48",fontSize:11,cursor:"pointer",fontWeight:600}}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
          {/* ═══ CLIENT NOTES per element — always visible ═══ */}
          <div style={{marginTop:10,background:elNotes[k]?(isDark?"rgba(201,169,110,0.06)":"#FFFDF7"):"transparent",borderRadius:10,padding:elNotes[k]?"10px 12px":"0"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:12}}>📝</span>
              <span style={{fontSize:11,fontWeight:600,color:elNotes[k]?textP:textS}}>Client Notes</span>
              {elNotes[k]&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS}}>Will appear in PPT</span>}
            </div>
            <textarea value={elNotes[k]||""} onChange={e=>setElNotes(p=>({...p,[k]:e.target.value}))}
              placeholder={`e.g. "Remove couch from stage", "Use only white roses", "Client wants minimal lighting"...`}
              style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${elNotes[k]?textP+"40":border}`,background:isDark?"#12121F":"#fff",color:textP,fontSize:12,outline:"none",resize:"vertical",minHeight:36,maxHeight:100,boxSizing:"border-box",fontFamily:"inherit"}}/>
          </div>

        </div>}
      </div>);
    })}

    {/* ═══ CUSTOM ZONES (non-duplicates only — duplicates render in main loop above) ═══ */}
    {customZones.filter(cz=>!cz.sourceType).map(cz=>{
      const k=cz.id;const isOn=enabledEls[k];
      const czElCost=calcElsCost(zoneElements[k],true,zoneConfig[k]);
      const czStructCost=zoneConfig[k]?calcStructCost(k,zoneConfig[k]).total:0;
      const czTotal=czElCost+czStructCost;
      return(<div key={k} style={{background:isOn?cardBg:isDark?"#12121F":"#FAFAFA",borderRadius:16,border:isOn?`2px solid #444`:`2px solid ${border}`,marginBottom:14,overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",cursor:"pointer"}} onClick={()=>setEnabledEls(p=>({...p,[k]:!p[k]}))}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:22}}>{cz.icon||"📦"}</span>
            <div style={{fontSize:15,fontWeight:600,color:isOn?textP:textS}}>{cz.name}</div>
            <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:isDark?"rgba(255,255,255,0.06)":"#F0F0F0",color:textS}}>Custom</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {isOn&&showCosts&&<div style={{fontSize:14,fontWeight:700,color:textP}}>{fmt(czTotal)}</div>}
            <div style={{width:44,height:26,borderRadius:13,background:isOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}} onClick={e=>{e.stopPropagation();setEnabledEls(p=>({...p,[k]:!p[k]}));}}><div style={{width:22,height:22,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:isOn?20:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.15)"}}/></div>
            <span onClick={e=>{e.stopPropagation();if(confirm("Remove "+cz.name+"?")){setCustomZones(p=>p.filter(z=>z.id!==k));setEnabledEls(p=>{const n={...p};delete n[k];return n;});setZoneElements(p=>{const n={...p};delete n[k];return n;});setZoneConfig(p=>{const n={...p};delete n[k];return n;});}}} style={{cursor:"pointer",color:"#E11D48",fontSize:14,fontWeight:700}}>✕</span>
          </div>
        </div>
        {isOn&&<div style={{padding:"0 18px 16px"}}>
          {/* Element card — add items from Rate Card */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:"#666"}}>📋 Items — {cz.name}</div>
              <div style={{position:"relative"}}>
                <input value={zoneElSearch[k]||""} onChange={e=>setZoneElSearch(p=>({...p,[k]:e.target.value}))} placeholder="+ Add element..." style={{...S.input,fontSize:10,padding:"3px 8px",width:140,marginBottom:0}} onFocus={()=>setZoneElSearch(p=>({...p,[k]:""})) } />
                {(zoneElSearch[k]||"").length>=1&&(()=>{
                  const q=(zoneElSearch[k]||"").toLowerCase();
                  // A kit's own components are already covered by that kit — don't offer adding
                  // one separately (would double the item and double its cost).
                  const kitCoveredIds=new Set((zoneElements[k]||[]).filter(el=>el.invId).flatMap(el=>{
                    const it=(imsInventory||[]).find(i=>i.id===el.invId);
                    const comps=Array.isArray(el.kitOverrides)?el.kitOverrides:(it?.subItems||[]);
                    return comps.map(c=>c.itemId);
                  }));
                  // Searches IMS inventory + pure flower-recipe patterns with no inventory backing
                  // (Rate Card is not consulted here — see getElPriceFromInventory /
                  // getElPriceFromPattern in StudioApp.jsx).
                  const invMatches=(imsInventory||[]).filter(it=>!(zoneElements[k]||[]).find(el=>el.invId===it.id)&&!kitCoveredIds.has(it.id)&&!isHiddenSubcat(it,rcSubcatFactors)&&(it.name.toLowerCase().includes(q)||(it.cat||"").toLowerCase().includes(q)||(it.subCat||it.subcategory||"").toLowerCase().includes(q))).slice(0,8);
                  const patMatches=(recipeOnlyPatterns||[]).filter(pt=>!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)&&pt.name.toLowerCase().includes(q)).slice(0,4);
                  const matches=[...invMatches.map(it=>({kind:"inv",it})),...patMatches.map(pt=>({kind:"pat",pt}))].slice(0,8);
                  return matches.length>0?<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",maxHeight:340,overflowY:"auto",width:320}}>
                    {matches.map(m=>{
                      if(m.kind==="pat"){ const pt=m.pt; return <div key={"pat:"+pt.id}
                        onClick={()=>{
                          if(!(zoneElements[k]||[]).find(el=>el.patternId===pt.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:pt.name,qty:1,unit:pt.unit,size:"",patternId:pt.id}]}));}
                          setZoneElSearch(prev=>({...prev,[k]:""}));
                        }}
                        style={{padding:"8px 10px",fontSize:11,cursor:"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <span style={{fontSize:22,opacity:0.5}}>🌺</span>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pt.name}</span>
                            <span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(236,72,153,0.15)",color:"#EC4899",fontWeight:700,flexShrink:0}}>🌺 RECIPE</span>
                          </div>
                          <div style={{fontSize:9,color:textS,marginTop:2}}>{pt.sub?pt.sub+" › ":""}Flower recipe — no inventory item</div>
                        </div>
                      </div>; }
                      const it=m.it; const isKit=Array.isArray(it.subItems)&&it.subItems.length>0; const src=it.img||it.photoUrls?.[0];
                      const remaining=remainingForItem(it.id,k); const isBlocked=remaining!=null&&remaining<=0;
                      return <div key={"inv:"+it.id}
                        onClick={()=>{
                          if(isBlocked) return;
                          if(!(zoneElements[k]||[]).find(el=>el.invId===it.id)){setZoneElements(prev=>({...prev,[k]:[...(prev[k]||[]),{name:it.name,qty:1,unit:it.unit,size:"",invId:it.id}]}));}
                          setZoneElSearch(prev=>({...prev,[k]:""}));
                        }}
                        style={{padding:"8px 10px",fontSize:11,cursor:isBlocked?"not-allowed":"pointer",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"center",gap:10,opacity:isBlocked?0.45:1}}>
                        <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",flexShrink:0,background:isDark?"#1a1a2e":"#eee",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {src?<img src={src} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} />:<span style={{fontSize:22,opacity:0.3}}>📦</span>}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:500,color:textP,display:"flex",alignItems:"center",gap:4,minWidth:0}}>
                            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</span>
                            {isKit&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700,flexShrink:0}}>📦 KIT</span>}
                            {isBlocked&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700,flexShrink:0}}>🚫 fully used in this event</span>}
                            {!isBlocked&&remaining!=null&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700,flexShrink:0}}>{remaining} left for this event</span>}
                          </div>
                          <div style={{fontSize:9,color:textS,marginTop:2}}>{(it.subCat||it.subcategory)?(it.subCat||it.subcategory)+" › ":""}{it.cat}</div>
                        </div>
                      </div>;
                    })}
                  </div>:<div style={{position:"absolute",top:"100%",right:0,zIndex:50,background:cardBg,border:`1px solid ${border}`,borderRadius:8,marginTop:2,padding:"8px 10px",fontSize:10,color:textS,width:320}}>No matches</div>;
                })()}
              </div>
            </div>
            {(zoneElements[k]||[]).length>0&&<div style={{background:isDark?"#12121F":"#FAFAFA",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              {(zoneElements[k]||[]).map((el, idx) => {
                const priceInfo = getElPrice(el, zoneConfig[k], { checkAvailability: true });
                const rc = priceInfo.rc;
                const hasSizes = rcIsSMB(rc);
                const isTrussSqft = rc && rc.unit === "truss_sqft";
                const rawUp = priceInfo.unitPrice;
                const adjUp = applyFloralRatio(rawUp, rc);
                const lineTotal = isTrussSqft
                  ? applyFloralRatio(priceInfo.lineCost, rc)
                  : (el.qty||0) * adjUp;
                const invItem = el.invId ? (imsInventory||[]).find(i=>i.id===el.invId) : null;
                const isKit = !!(invItem && Array.isArray(invItem.subItems) && invItem.subItems.length>0);
                const thumbItem = invItem || (imsInventory||[]).find(i=>i.name===el.name);
                const thumbSrc = thumbItem?.img || thumbItem?.photoUrls?.[0];
                const thumbKey = `${k}:${idx}`;
                return (
                <div key={idx} style={{display:"flex",flexDirection:"column",padding:"6px 0",borderBottom:`1px solid ${border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <div style={{position:"relative",flexShrink:0}}
                        onMouseEnter={(e)=>{
                          if(!thumbSrc) return;
                          const r=e.currentTarget.getBoundingClientRect();
                          const POP=164;
                          const openUp=window.innerHeight-r.bottom<POP+8 && r.top>POP+8;
                          setElThumbHover({key:thumbKey,openUp,top:openUp?undefined:r.bottom+4,bottom:openUp?window.innerHeight-r.top+4:undefined,left:Math.min(r.left,window.innerWidth-168)});
                        }}
                        onMouseLeave={()=>setElThumbHover(null)}>
                        {thumbSrc ? <img src={thumbSrc} alt="" style={{width:20,height:20,borderRadius:4,objectFit:"cover",cursor:"zoom-in"}}/> : <div style={{width:20,height:20,borderRadius:4,background:isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>📦</div>}
                        {elThumbHover?.key===thumbKey && thumbSrc && (
                          <div style={{position:"fixed",top:elThumbHover.top,bottom:elThumbHover.bottom,left:elThumbHover.left,zIndex:10000,width:160,height:160,borderRadius:8,overflow:"hidden",border:`2px solid ${border}`,boxShadow:"0 8px 24px rgba(0,0,0,0.4)",pointerEvents:"none"}}>
                            <img src={thumbSrc} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                          </div>
                        )}
                      </div>
                      <span style={{fontSize:12,fontWeight:500,color:(rc||el.invId||el.patternId)?textP:"#F59E0B"}}>{el.name}</span>
                      {isKit&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(99,102,241,0.15)",color:"#6366F1",fontWeight:700}}>📦 KIT</span>}
                      {!rc&&!el.invId&&!el.patternId&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(245,158,11,0.15)",color:"#F59E0B",fontWeight:700}}>NEW</span>}
                      {el.invId&&priceInfo.warning&&<span title={priceInfo.warning} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(239,68,68,0.15)",color:"#EF4444",fontWeight:700}}>⚠ short</span>}
                      {isTrussSqft&&priceInfo.area>0&&<span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(59,130,246,0.12)",color:"#3B82F6",fontWeight:600}}>{priceInfo.area} sqft</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                      {hasSizes&&!priceInfo.isFloralBlend&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:9,fontWeight:(el.size||"M")===s?700:400,cursor:"pointer",background:(el.size||"M")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"M")===s?"#666":textS}}>{s}</button>)}
                      {priceInfo.isFloralBlend&&priceInfo.patternSMB&&["S","M","B"].map(s=><button key={s} onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],size:s};setZoneElements(p=>({...p,[k]:elems}));}} style={{padding:"1px 6px",borderRadius:4,border:"none",fontSize:9,fontWeight:(el.size||"B")===s?700:400,cursor:"pointer",background:(el.size||"B")===s?"rgba(0,0,0,0.06)":"transparent",color:(el.size||"B")===s?"#666":textS}}>{s}</button>)}
                      {hasSizes&&!priceInfo.isFloralBlend&&<button onClick={()=>{const elems=[...(zoneElements[k]||[])];const used=new Set(elems.filter(e=>e.name===el.name).map(e=>e.size||"M"));const ns=["B","M","S"].find(s=>!used.has(s))||"B";elems.splice(idx+1,0,{...el,size:ns,qty:1});setZoneElements(p=>({...p,[k]:elems}));}} title="Split into another size (e.g. 3 Big + 2 Small)" style={{padding:"1px 6px",borderRadius:4,border:`1px dashed ${border}`,fontSize:9,fontWeight:600,cursor:"pointer",background:"transparent",color:accent}}>＋ size</button>}
                      {priceInfo.isFloralBlend&&<span style={{display:"flex",alignItems:"center",gap:3,fontSize:9,fontWeight:700}}>{"🌸"}<button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:undefined};setZoneElements(p=>({...p,[k]:elems}));}} title="Use this sub-category's default real/artificial ratio" style={{padding:"1px 6px",borderRadius:3,border:"none",cursor:"pointer",background:typeof el.realPct!=="number"?"#EC4899":"rgba(236,72,153,0.12)",color:typeof el.realPct!=="number"?"#fff":"#EC4899"}}>🌐 Ratio</button><button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:100};setZoneElements(p=>({...p,[k]:elems}));}} title="Price this element at 100% the recipe's Studio rate, overriding the sub-category's default" style={{padding:"1px 6px",borderRadius:3,border:"none",cursor:"pointer",background:el.realPct===100?"#EC4899":"rgba(236,72,153,0.12)",color:el.realPct===100?"#fff":"#EC4899"}}>🎯 100%</button><input type="number" min="0" max="100" value={el.realPct??""} placeholder={String(priceInfo.realPct??"")} onChange={e=>{const v=e.target.value;const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],realPct:v===""?undefined:Math.max(0,Math.min(100,parseFloat(v)||0))};setZoneElements(p=>({...p,[k]:elems}));}} title="Manually set the exact % real — overrides Ratio/100%" style={{width:42,padding:"1px 4px",borderRadius:3,border:`1px solid ${border}`,background:cardBg,color:textP,fontSize:9,textAlign:"center"}} /></span>}
                      {showCosts&&<span style={{fontSize:10,color:textS,marginLeft:4}}>{adjUp>0?`₹${adjUp.toLocaleString("en-IN")}/${isTrussSqft?"truss sqft":(invItem?.unit||rc?.unit||el.unit)}`:"₹0"}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    {isTrussSqft ? (
                      <div style={{fontSize:11,fontWeight:600,color:textS,padding:"3px 8px",borderRadius:6,background:isDark?"rgba(59,130,246,0.08)":"rgba(59,130,246,0.06)",minWidth:64,textAlign:"center"}}>{priceInfo.area>0?`× ${priceInfo.area} sqft`:"× — sqft"}</div>
                    ) : (
                      <>
                        <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:Math.max(0,(el.qty||0)-1)};setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>{"−"}</button>
                        <input type="number" min="0" value={el.qty||0} onChange={e=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:Math.max(0,parseInt(e.target.value)||0)};setZoneElements(p=>({...p,[k]:elems}));}} onFocus={e=>e.target.select()} style={{width:46,padding:"3px 4px",borderRadius:6,border:`1px solid ${border}`,background:cardBg,color:(el.qty||0)>0?textP:textS,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:"inherit",MozAppearance:"textfield"}}/>
                        <button onClick={()=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],qty:(el.qty||0)+1};setZoneElements(p=>({...p,[k]:elems}));}} style={{width:26,height:26,borderRadius:6,border:`1px solid ${border}`,background:cardBg,cursor:"pointer",fontSize:14,fontWeight:600,color:textS,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                      </>
                    )}
                    {showCosts&&<div style={{fontSize:12,fontWeight:600,color:lineTotal>0?textP:textS,minWidth:60,textAlign:"right"}}>{lineTotal>0?fmt(lineTotal):"—"}</div>}
                    <span onClick={()=>{const elems=(zoneElements[k]||[]).filter((_,i)=>i!==idx);setZoneElements(p=>({...p,[k]:elems}));}} style={{cursor:"pointer",color:"#E11D48",fontWeight:700,fontSize:12}}>×</span>
                  </div>
                  </div>
                  {isTrussSqft&&priceInfo.warning&&<div style={{fontSize:10,color:"#F59E0B",marginTop:4,padding:"4px 6px",borderRadius:4,background:"rgba(245,158,11,0.08)"}}>{priceInfo.warning}</div>}
                  {isKit&&<KitComponentsEditor
                    item={invItem}
                    overrides={el.kitOverrides}
                    onChange={(next)=>{const elems=[...(zoneElements[k]||[])];elems[idx]={...elems[idx],kitOverrides:next};setZoneElements(p=>({...p,[k]:elems}));}}
                    imsInventory={imsInventory}
                    qtyMultiplier={el.qty||1}
                    dealAwareness={{getRemaining:(itemId)=>remainingForItem(itemId,k,idx)}}
                    rcSubcatFactors={rcSubcatFactors}
                    textP={textP} textS={textS} border={border} cardBg={cardBg} accent={accent} isDark={isDark} fmt={fmt}
                  />}
                </div>);
              })}
              {showCosts&&<div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0 0",fontWeight:700,color:textP}}>Items: {fmt(czElCost)}</div>}
            </div>}
          </div>
          {/* Zone structure — FULL, same as standard zones */}
          {(()=>{
            const zc=zoneConfig[k]||{};
            const dims=zc.dims||{};
            const fd=zc.floorDims||{};
            const st=calcStructCost(k,zc);
            const sZ=u=>{setZoneConfig(p=>({...p,[k]:{...p[k],...u}}));};
            const sD=(d,v)=>{setZoneConfig(p=>{const cur=p[k]||{};const dims={...(cur.dims||{}),[d]:parseFloat(v)||0};
              // 3 dims filled ⇒ Box, exactly 2 ⇒ Single U — keep the toggle + pricing in sync with the dims.
              const n=[dims.W,dims.L,dims.H].filter(x=>(Number(x)||0)>0).length;const trT=n>=3?"box":n===2?"singleU":cur.trT;
              return {...p,[k]:{...cur,dims,trT}};});};
            const sFD=(d,v)=>{setZoneConfig(p=>({...p,[k]:{...p[k],floorDims:{...(p[k]?.floorDims||{}),[d]:parseFloat(v)||0}}}));};
            const mw={back:true,left:true,right:true};
            return <div style={{borderRadius:10,padding:"10px 14px",border:`1px solid ${border}`,background:isDark?"rgba(255,255,255,0.02)":"#F9F9F9",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:textS}}>📐 Zone Structure</div>
                {showCosts&&st.total>0&&<div style={{fontWeight:600,color:textP}}>{fmt(st.total)}</div>}
              </div>
              {/* Truss type */}
              <div style={{display:"flex",gap:4,marginBottom:8}}>
                {[{id:"box",l:"Box Truss"},{id:"singleU",l:"Single U Truss"},{id:null,l:"None"}].map(o=><button key={o.id||"none"} onClick={()=>sZ({trT:o.id})} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${zc.trT===o.id?textP:border}`,background:zc.trT===o.id?"rgba(0,0,0,0.06)":"transparent",color:zc.trT===o.id?textP:textS,fontSize:10,cursor:"pointer",fontWeight:zc.trT===o.id?600:400}}>{o.l}{showCosts&&o.id?` ₹${o.id==="box"?50:30}/sqft`:""}</button>)}
              </div>
              {/* Truss dims: L, W, H + Qty */}
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                {[["W","Width"],["L","Depth"],["H","Height"]].map(([d,label])=><div key={d} style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Truss {label} (ft)</div>
                  <input type="number" value={dims[d]||""} onChange={e=>sD(d,e.target.value)} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder="0"/></div>)}
                {zc.trT&&<div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Truss Qty</div>
                  <input type="number" min={1} value={zc.trussQty||1} onChange={e=>sZ({trussQty:Math.max(1,parseInt(e.target.value)||1)})} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder="1"/></div>}
                {zc.trT==="box"&&<div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}} title="Single-U extension on each front side, this many ft long. Priced as 2× Single U truss. Rare.">Front ext (ft/side)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExt||""} onChange={e=>sZ({trussFrontExt:Math.max(0,parseFloat(e.target.value)||0)})} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder="0"/></div>}
                {zc.trT==="box"&&(Number(zc.trussFrontExt)||0)>0&&<div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}} title="Height of the front extension (can differ from box height). Defaults to box height.">Ext height (ft)</div>
                  <input type="number" min={0} step="0.5" value={zc.trussFrontExtH||""} onChange={e=>sZ({trussFrontExtH:Math.max(0,parseFloat(e.target.value)||0)})} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder={String(zc.dims?.H||0)}/></div>}
              </div>
              {/* ── §23 Truss Type selector + Height-anchor validation (custom zone) ── */}
              {(()=>{
                const tr = resolveTrussConfig(zc);
                if (tr.source === "none") return null;
                if (tr.source === "invalid") {
                  return <div style={{marginBottom:8,padding:"6px 10px",borderRadius:8,background:"rgba(220,38,38,0.08)",border:"1px solid rgba(220,38,38,0.3)",fontSize:10,color:"#B91C1C",fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    <span>⚠️</span><span>{tr.error}</span>
                  </div>;
                }
                if (tr.source === "auto-3dim") {
                  return <div style={{marginBottom:8,padding:"5px 10px",borderRadius:8,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.2)",fontSize:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{color:textS}}>Truss Type:</span>
                    <span style={{fontWeight:700,color:"#B91C1C"}}>🔴 Full Box <span style={{fontWeight:400,color:textS,fontSize:9}}>(auto · 3 dims)</span></span>
                  </div>;
                }
                const picked = zc.trussType;
                const opts = [
                  { id:"u_only",   label:"🟢 U Truss" },
                  { id:"half_box", label:"🟡 Half Box" },
                ];
                return <div style={{marginBottom:8,padding:"6px 10px",borderRadius:8,background:isDark?"rgba(255,255,255,0.03)":"#FFFEF8",border:`1px solid ${border}`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:600,color:textS}}>Truss Type:</span>
                    {tr.source==="default-on-forget" && <span style={{fontSize:8,padding:"1px 5px",borderRadius:4,background:"rgba(217,119,6,0.12)",color:"#A16207",fontWeight:600}}>defaulted</span>}
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    {opts.map(o=>{
                      const isOn = picked === o.id;
                      const isDefault = !picked && o.id === "half_box";
                      return <button key={o.id} onClick={()=>sZ({trussType:o.id})}
                        style={{padding:"3px 8px",borderRadius:5,border:`1px solid ${isOn?textP:(isDefault?"rgba(217,119,6,0.4)":border)}`,background:isOn?"rgba(0,0,0,0.06)":(isDefault?"rgba(217,119,6,0.06)":"transparent"),color:isOn?textP:textS,fontSize:9,cursor:"pointer",fontWeight:isOn?700:(isDefault?600:400)}}>{o.label}</button>;
                    })}
                  </div>
                </div>;
              })()}
              {showCosts&&st.truss>0&&<div style={{fontSize:10,color:textS,marginBottom:6}}>Truss: {fmt(st.truss)}</div>}
              {/* Masking */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11}}><span>🧱 Masking</span>
                  <div onClick={()=>sZ({mkOn:!zc.mkOn,mkWalls:zc.mkOn?{}:mw})} style={{width:30,height:16,borderRadius:8,background:zc.mkOn?"#444":"#D1D5DB",position:"relative",cursor:"pointer"}}><div style={{width:12,height:12,borderRadius:6,background:"#fff",position:"absolute",top:2,left:zc.mkOn?16:2,transition:"left 0.2s"}}/></div>
                </div>{showCosts&&st.masking>0&&<span style={{fontWeight:600,fontSize:11,color:textP}}>{fmt(st.masking)}</span>}
              </div>
              {zc.mkOn&&<div style={{display:"flex",gap:4,marginBottom:6,paddingLeft:20}}>
                {MASK_OPTS.map(o=><button key={o.id} onClick={()=>sZ({mkT:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.mkT===o.id?700:400,background:zc.mkT===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.mkT===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
              </div>}
              {/* Platform */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,fontSize:11}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span>🏗️ Platform</span>
                  {PLAT_OPTS.map(o=><button key={o.id} onClick={()=>sZ({plH:zc.plH===o.id?null:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.plH===o.id?700:400,background:zc.plH===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.plH===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                </div>{showCosts&&st.platform>0&&<span style={{fontWeight:600,color:textP}}>{fmt(st.platform)}</span>}
              </div>
              {/* Carpet */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,fontSize:11}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span>🟫 Carpet</span>
                  {CARP_OPTS.map(o=><button key={o.id} onClick={()=>sZ({cpT:zc.cpT===o.id?null:o.id})} style={{padding:"2px 7px",borderRadius:5,border:"none",fontSize:10,cursor:"pointer",fontWeight:zc.cpT===o.id?700:400,background:zc.cpT===o.id?"rgba(0,0,0,0.08)":"transparent",color:zc.cpT===o.id?textP:textS}}>{o.l}{showCosts?` ₹${o.r}`:""}</button>)}
                </div>{showCosts&&st.carpet>0&&<span style={{fontWeight:600,color:textP}}>{fmt(st.carpet)}</span>}
              </div>
              {/* Floor dims */}
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Floor Width (ft)</div>
                  <input type="number" value={fd.W||""} onChange={e=>sFD("W",e.target.value)} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder={dims.W||"—"}/></div>
                <div style={{flex:1}}><div style={{fontSize:9,color:textS,marginBottom:3}}>Floor Depth (ft)</div>
                  <input type="number" value={fd.L||""} onChange={e=>sFD("L",e.target.value)} style={{...S.input,fontSize:12,padding:"6px 8px",textAlign:"center"}} placeholder={dims.L||"—"}/></div>
                <div style={{flex:1,display:"flex",alignItems:"flex-end"}}><div style={{fontSize:9,color:textS}}>{(fd.L||fd.W)?`${fd.L||0}×${fd.W||0} = ${(fd.L||0)*(fd.W||0)} sqft`:"Uses truss L×W"}</div></div>
              </div>
            </div>;
          })()}
        </div>}
      </div>);
    })}

    {/* ═══ + ADD CUSTOM ZONE ═══ */}
    <div style={{borderRadius:14,border:`2px dashed ${border}`,padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
      <input value={newCzName} onChange={e=>setNewCzName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newCzName.trim()){const id="cz_"+Date.now();setCustomZones(p=>[...p,{id,name:newCzName.trim(),icon:"📦"}]);setEnabledEls(p=>({...p,[id]:true}));setNewCzName("");}}} placeholder="e.g. Banquet Carpet, Artist Stage, Gajra Counter..." style={{...S.input,flex:1,marginBottom:0,fontSize:13}}/>
      <button onClick={()=>{if(newCzName.trim()){const id="cz_"+Date.now();setCustomZones(p=>[...p,{id,name:newCzName.trim(),icon:"📦"}]);setEnabledEls(p=>({...p,[id]:true}));setNewCzName("");}}} style={{...S.btn(!!newCzName.trim()),padding:"10px 20px",fontSize:12,opacity:newCzName.trim()?1:0.5}}>+ Add Zone</button>
    </div>

    {/* ═══ BUILD PAGE TOTAL — detailed breakdown ═══ */}
    {showCosts&&venue&&<div style={{background:"linear-gradient(135deg,#0F0F1A,#2d1b69)",borderRadius:16,padding:"20px 24px",color:"#fff",marginTop:24}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:12,color:"#a5b4fc"}}>{"🏗"} Decor (all zones)</span>
        <span style={{fontSize:14,fontWeight:600}}>{fmt(totalCost())}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,paddingBottom:10,borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
        <span style={{fontSize:12,color:"#a5b4fc"}}>{"🚚"} Transport ({transportCalc.trucks} trucks + genset)</span>
        <span style={{fontSize:14,fontWeight:600}}>{fmt(transportCalc.total)}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:14,fontWeight:700,color:"#C9A96E"}}>Grand Total</span>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:28,fontWeight:700}}>{fmt(grandTotal)}</div>
          <span style={{fontSize:11,padding:"3px 12px",borderRadius:8,background:cat.bg,color:cat.color,fontWeight:600}}>{cat.label}</span>
        </div>
      </div>
    </div>}

    {/* ── §23 Soft truss validation summary (warns but doesn't block nav) ── */}
    {(()=>{
      const invalidZones = [];
      Object.entries(zoneConfig||{}).forEach(([zk,zc])=>{
        if (!enabledEls[zk]) return;
        const tr = resolveTrussConfig(zc);
        if (tr.source === "invalid") {
          const label = zoneMeta[zk]?.label || (customZones.find(cz=>cz.id===zk)?.name) || zk;
          invalidZones.push({ zk, label, error: tr.error });
        }
      });
      if (invalidZones.length === 0) return null;
      return <div style={{marginTop:20,padding:"12px 16px",borderRadius:10,background:"rgba(220,38,38,0.06)",border:"1px solid rgba(220,38,38,0.25)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:16}}>⚠️</span>
          <span style={{fontSize:13,fontWeight:700,color:"#B91C1C"}}>Truss dimensions incomplete in {invalidZones.length} zone{invalidZones.length>1?"s":""}</span>
        </div>
        <div style={{fontSize:11,color:"#7F1D1D",lineHeight:1.5}}>
          {invalidZones.map(z => <div key={z.zk}>• <strong>{z.label}</strong>: {z.error}</div>)}
        </div>
        <div style={{fontSize:10,color:"#A16207",marginTop:6,fontStyle:"italic"}}>You can continue, but the cost preview won't include truss for these zones until dimensions are fixed.</div>
      </div>;
    })()}

    {/* ═══ CORRECT PHOTO TAGS → save to master (full tagging, mirrors the Library editor) ═══ */}
    {correctPhoto && (()=>{
      const master = libItems.find(i=>i.id===correctPhoto.libId);
      const taxLabel=(key)=>({eventType:"Event type",venueType:"Venue type",areasElements:"Areas / zones",colorPalette:"Palette",categoryTier:"Category tier",tier:"Tier",designStyle:"Design style",timeSetting:"Time / setting"}[key]||key);
      const toggle=(key,val)=>setCorrectPhoto(p=>{const cur=p.tags?.[key]||[];const next=cur.includes(val)?cur.filter(x=>x!==val):[...cur,val];return {...p,tags:{...p.tags,[key]:next}};});
      const save=()=>{
        if(!master){showMsg("Photo not found.","red");setCorrectPhoto(null);return;}
        const elems=JSON.parse(JSON.stringify(zoneElements[correctPhoto.zoneKey]||master.elements||[]));
        // Keep the original verifier's credit — a later editor's correction updates tags/elements
        // but shouldn't steal the "verified by" attribution from whoever verified it first.
        const wasVerified=!!master._verified;
        const stamp=wasVerified?{}:{_verifiedBy:authUser?.name||"—",_verifiedAt:Date.now()};
        const corrected={...master,name:correctPhoto.name||master.name,tags:correctPhoto.tags,elements:elems,_verified:true,...stamp,_correctedOn:"build"};
        saveLib(libItems.map(i=>i.id===correctPhoto.libId?corrected:i));
        logCorrection?.({photoId:correctPhoto.libId,photoName:corrected.name,source:"build"});
        showMsg("✅ Correction saved to master — thanks!","green");
        setCorrectPhoto(null);
      };
      return <div onClick={()=>setCorrectPhoto(null)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.6)",display:"flex",justifyContent:"center",alignItems:"flex-start",overflow:"auto",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:cardBg,borderRadius:16,width:"100%",maxWidth:620,maxHeight:"90vh",overflow:"auto",border:`1px solid ${border}`,padding:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:15,fontWeight:700,color:textP}}>✏️ Correct photo tags</div>
            <span onClick={()=>setCorrectPhoto(null)} style={{fontSize:18,cursor:"pointer",color:textS,fontWeight:700}}>✕</span>
          </div>
          <div style={{fontSize:11,color:textS,marginBottom:12}}>Fix any tags below — they save to the shared library photo for everyone (future quotes). Element quantities come from your edits in the build card above. Quotes already given keep their own numbers.</div>
          <div style={{display:"flex",gap:12,marginBottom:12}}>
            {master?.url&&<img src={master.url} alt="" style={{width:120,height:84,objectFit:"cover",borderRadius:10,flexShrink:0}} onError={e=>{e.target.style.display="none"}}/>}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:9,color:textS,marginBottom:3}}>Name</div>
              <input value={correctPhoto.name} onChange={e=>setCorrectPhoto(p=>({...p,name:e.target.value}))} style={{...S.input,fontSize:13,fontWeight:600}}/>
              <div style={{fontSize:9,color:textS,marginTop:6}}>📋 {(zoneElements[correctPhoto.zoneKey]||master?.elements||[]).length} elements (from your edits above)</div>
            </div>
          </div>
          {/* Specific named venue (2-level: Inhouse / Outside) */}
          {(()=>{
            const curVenue=correctPhoto.tags?.venue||"";
            const setV=(val)=>setCorrectPhoto(p=>({...p,tags:{...p.tags,venue:val||""}}));
            const pill=(on)=>({padding:"3px 10px",borderRadius:8,fontSize:10,cursor:"pointer",fontWeight:on?700:500,border:`1px solid ${on?accent:border}`,background:on?`${accent}18`:"transparent",color:on?accent:textS});
            return <div style={{marginBottom:10}}>
              <div style={{fontSize:10,color:textS,marginBottom:3,fontWeight:600}}>Venue (specific)</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>
                <span onClick={()=>setCorrVenueGrp("inhouse")} style={pill(corrVenueGrp==="inhouse")}>Inhouse</span>
                <span onClick={()=>setCorrVenueGrp("outside")} style={pill(corrVenueGrp==="outside")}>Outside</span>
                {curVenue&&<span onClick={()=>setV("")} style={{padding:"3px 9px",borderRadius:8,fontSize:9,cursor:"pointer",color:"#E11D48",border:`1px dashed ${border}`}}>✕ {curVenue}</span>}
              </div>
              {corrVenueGrp==="inhouse"&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {allInhouseVenues.map(vn=>{const on=curVenue===vn;return <span key={vn} onClick={()=>setV(on?"":vn)} style={{...pill(on),fontSize:9,padding:"3px 8px"}}>{vn}</span>;})}
              </div>}
              {corrVenueGrp==="outside"&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {customOutdoor.map(o=>{const on=curVenue===o.name;return <span key={o.name} onClick={()=>setV(on?"":o.name)} style={{...pill(on),fontSize:9,padding:"3px 8px"}}>{o.name}{o.empanelled?" ★":""}</span>;})}
              </div>}
            </div>;
          })()}
          {Object.keys(taxonomy).filter(key=>Array.isArray(taxonomy[key])).map(key=>{
            const vals=key==="colorPalette"&&imsPaletteCatalogue.length>0?imsPaletteCatalogue.map(p=>p.name):taxonomy[key];
            return <div key={key} style={{marginBottom:8}}>
              <div style={{fontSize:10,color:textS,marginBottom:3,fontWeight:600}}>{taxLabel(key)}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {(vals||[]).map(v=>{const sel=(correctPhoto.tags?.[key]||[]).includes(v);return <span key={v} onClick={()=>toggle(key,v)} style={{padding:"3px 9px",fontSize:10,borderRadius:8,cursor:"pointer",border:`1px solid ${sel?accent:border}`,background:sel?`${accent}18`:"transparent",color:sel?accent:textS}}>{v}</span>;})}
              </div>
            </div>;
          })}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <button onClick={()=>setCorrectPhoto(null)} style={{...S.btn(false),fontSize:12}}>Cancel</button>
            <button onClick={save} style={{...S.btn(true),fontSize:12,background:"#7C3AED"}}>💾 Save to master</button>
          </div>
        </div>
      </div>;
    })()}

    <div style={{display:"flex",justifyContent:"space-between",marginTop:32}}><button onClick={()=>setStep(1)} style={S.btn(false)}>← Browse</button><button onClick={()=>setStep(3)} style={S.btn(true)}>Summary →</button></div>

    {/* ── Per-element stock availability modal — image + free count only, pick one to book ── */}
    {availModal && (
      <div onClick={()=>setAvailModal(null)} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:isDark?"#12121F":"#fff",borderRadius:16,border:`1px solid ${border}`,width:"min(900px,95vw)",maxHeight:"85vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.4)"}}>
          <div style={{padding:"16px 20px",borderBottom:`1px solid ${border}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:textP}}>📦 Availability — {availModal.elName}</div>
              <div style={{fontSize:11,color:textS,marginTop:2,letterSpacing:0.3}}>{availModal.subcat||"—"} · free on {availModal.date||"event date"} · tap to pick</div>
            </div>
            <span onClick={()=>setAvailModal(null)} style={{cursor:"pointer",fontSize:22,color:textS,lineHeight:1}}>×</span>
          </div>
          <div style={{padding:16,overflowY:"auto",flex:1}}>
            {availModal.loading ? (
              <div style={{padding:"48px 0",textAlign:"center",color:textS,fontSize:13}}>Loading availability…</div>
            ) : (availModal.items.length===0 ? (
              <div style={{padding:"48px 0",textAlign:"center",color:textS,fontSize:13}}>No inventory found in “{availModal.subcat||"this sub-category"}”.</div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                {availModal.items.map(it=>{
                  const sel = availModal.selectedId===it.id;
                  const out = it.free<=0;
                  return (
                    <div key={it.id} onClick={()=>setAvailModal(m=>({...m,selectedId: sel?null:it.id}))} style={{cursor:"pointer",borderRadius:12,overflow:"hidden",border:`2px solid ${sel?"#059669":border}`,background:isDark?"#0F0F1A":"#FAFAFA",position:"relative"}}>
                      {sel&&<span style={{position:"absolute",top:6,left:6,zIndex:2,fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:6,background:"#059669",color:"#fff"}}>✓</span>}
                      <div title="Free on the event date" style={{position:"absolute",top:6,right:6,zIndex:2,fontSize:12,fontWeight:800,minWidth:22,textAlign:"center",padding:"2px 7px",borderRadius:8,background:out?"rgba(239,68,68,0.92)":"rgba(16,185,129,0.92)",color:"#fff"}}>{it.free}</div>
                      {it.photo ? <img src={it.photo} alt="" style={{width:"100%",height:120,objectFit:"cover",display:"block",opacity:out?0.5:1}}/> : <div style={{width:"100%",height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30,background:isDark?"#1a1a2e":"#eee"}}>🪑</div>}
                      <div style={{padding:"8px 10px",fontSize:11,fontWeight:600,color:textP,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{padding:"12px 20px",borderTop:`1px solid ${border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:textS}}>{availModal.selectedId ? "This item will be booked in Deal Check for this element." : "Pick an item to book it — or clear the current pin."}</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setAvailModal(null)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${border}`,background:"transparent",color:textS,fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button>
              <button onClick={saveAvailPick} style={{padding:"8px 18px",borderRadius:8,border:"none",background:"#059669",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
  );
}

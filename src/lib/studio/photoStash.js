// Per-photo saved builds for a Build zone (owner ask 2026-10-31).
//
// Every photo a zone has been built on keeps its own copy of the zone - its elements, the whole zone config
// (truss & masking, platform, print, custom items...) and the client note - in zoneConfig[zone].photoStash,
// keyed by the photo. zoneConfig is saved with the deal, so the copies survive a refresh; stripPhotoStash keeps
// them out of everything that leaves Studio (IMS, library masters).
//
// Changing a zone's photo after editing it asks:
//   Save & Replace - the new photo keeps the zone exactly as it is now (saved under both photos).
//   Save & Switch  - the zone is saved with the current photo, and the new photo opens with its own saved
//                    build, else fresh from the photo.
//   Cancel         - nothing changes.

export const PHOTO_STASH_LIMIT = 12; // newest photos kept per zone - enough to go back and forth

export const photoStashKey = (photo) => photo?.src || photo?.eventId || "";

// A zone config's own content. scale / repeat are live deal choices, not what a photo's build is, and the stash
// is not part of the build either.
export function zoneCfgSig(cfg) {
  const { scale: _s, repeat: _r, repeatCats: _rc, photoStash: _ps, ...rest } = cfg || {}; // eslint-disable-line no-unused-vars
  return JSON.stringify(rest);
}

// What the zone holds now, and whether it differs from what was loaded with its photo (the _loaded* stamps
// selectElPhoto puts on elSelectedPhoto[zone]). No stamp - a deal reopened, or a zone picked before the stamps -
// counts as changed, so it is asked about / saved rather than thrown away.
export function zoneSwitchState({ currentSel, elements, zoneCfg, note }) {
  const { photoStash: prevStash, ...curCfg } = zoneCfg || {};
  const els = elements || [];
  const curNote = note || "";
  const elementsChanged = els.length > 0
    && (!currentSel?._loadedElements || JSON.stringify(currentSel._loadedElements) !== JSON.stringify(els));
  const noteChanged = curNote !== (currentSel?._loadedNote ?? "");
  const configChanged = !!currentSel && (currentSel._loadedCfg == null || currentSel._loadedCfg !== zoneCfgSig(curCfg));
  return {
    curCfg, curNote, elements: els, prevStash: prevStash || {},
    hasUnsavedWork: elementsChanged || noteChanged, // asked about
    configChanged, // a truss / platform / print edit alone is saved without asking
    hasPhoto: !!photoStashKey(currentSel),
  };
}

// Keeps the newest PHOTO_STASH_LIMIT entries.
export function capPhotoStash(stash) {
  return Object.fromEntries(Object.entries(stash || {})
    .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
    .slice(0, PHOTO_STASH_LIMIT));
}

// The switch itself. choice: "replace" | "switch" | "fresh" ("fresh" = no current photo to save with, and the
// user chose the new photo's own build). Returns the zone's next stash and how the new photo opens:
//   mode "replace" - keep elements / config / note as they are
//   mode "saved"   - open savedIn (the new photo's own saved build)
//   mode "fresh"   - load the photo's elements and config as usual
export function planPhotoSwitch({ state, currentSel, photo, choice, now = Date.now() }) {
  const stash = { ...state.prevStash };
  const work = { elements: state.elements, config: state.curCfg, note: state.curNote, savedAt: now };
  const hasWork = state.elements.length > 0 || !!state.curNote || Object.keys(state.curCfg).length > 0;
  const outKey = photoStashKey(currentSel);
  if (outKey && hasWork && (state.hasUnsavedWork || state.configChanged)) stash[outKey] = JSON.parse(JSON.stringify(work));
  const inKey = photoStashKey(photo);
  if (choice === "replace") {
    if (inKey) stash[inKey] = JSON.parse(JSON.stringify({ ...work, savedAt: now + 1 }));
    return { mode: "replace", stash: capPhotoStash(stash), savedIn: null };
  }
  const nextStash = capPhotoStash(stash);
  const savedIn = inKey && nextStash[inKey] ? JSON.parse(JSON.stringify(nextStash[inKey])) : null;
  return { mode: savedIn ? "saved" : "fresh", stash: nextStash, savedIn };
}

// The zone after a "replace" or "saved" plan: { elements, config, note, sel } - sel is the selected-photo record
// with its _loaded* stamps. liveCfg is the zone's config right now (repeat / repeatCats are kept from it: they are
// the deal's live choice, not part of a photo's build). "fresh" is not handled here - it loads from the photo.
export function zoneAfterSwitch({ plan, state, photo, liveCfg }) {
  const stashPatch = Object.keys(plan.stash).length ? { photoStash: plan.stash } : {};
  if (plan.mode === "replace") {
    const { photoStash: _old, ...cfgNow } = liveCfg || {}; // eslint-disable-line no-unused-vars
    return {
      elements: state.elements, config: { ...cfgNow, ...stashPatch }, note: state.curNote,
      sel: { ...photo, _loadedElements: state.elements, _loadedCfg: zoneCfgSig(state.curCfg), _loadedNote: state.curNote },
    };
  }
  if (plan.mode === "saved") {
    // its own scale comes with it - its elements were scaled by it
    const elements = plan.savedIn.elements || [];
    const cfgIn = plan.savedIn.config || {};
    const note = plan.savedIn.note || "";
    return {
      elements, config: { ...cfgIn, repeat: liveCfg?.repeat, repeatCats: liveCfg?.repeatCats, ...stashPatch }, note,
      sel: { ...photo, _loadedElements: elements, _loadedCfg: zoneCfgSig(cfgIn), _loadedNote: note },
    };
  }
  return null;
}

// zoneConfig without each zone's photoStash - for anything that leaves Studio. A zone left with nothing but its
// stash is dropped.
export function stripPhotoStash(zoneConfig) {
  const out = {};
  Object.entries(zoneConfig || {}).forEach(([zk, zc]) => {
    if (!zc || typeof zc !== "object") { out[zk] = zc; return; }
    const { photoStash, ...rest } = zc;
    if (photoStash && !Object.keys(rest).length) return;
    out[zk] = rest;
  });
  return out;
}

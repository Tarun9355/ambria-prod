// ═══ Deal Check's own per-function state reindex, on function removal ═══
// StudioApp.jsx's removeFunction already reindexes `fnBuilds` (the raw zone/element content) when a
// function is removed — every build above the removed index shifts down one slot, since fnBuilds is
// keyed by raw array position. Deal Check keeps a SEPARATE, much larger set of its own per-function
// state (manual items, kit edits, card assignments, floral allocations, collapsed-section UI state,
// and more) that never got the same treatment: removing a function left every one of these still
// pointing at the OLD numbering, so the function that shifted into the removed one's old slot could
// silently inherit a different function's manual items, kit edits or card state. Confirmed live via
// code reading (2026-11-12), not yet via a reported incident — see
// project_rakesh_taneja_resumesavedsession_incident memory for the sibling fnBuilds-class bugs this
// extends the fix to.
//
// These primitives are used from TWO places, which must stay in exact agreement: StudioApp.jsx's own
// `reindexDealCheckStateForRemoval` (the LIVE React state, right when removeFunction fires) and
// StudioEventInfo.jsx's `removeFunction` itself (the PERSISTED client-ledger copy of the same
// fields — Deal Check's own autosave only runs while it is actually open (`dcRun`), so a function
// removed with Deal Check closed would otherwise leave the ledger's STALE, pre-removal copy sitting
// there to silently overwrite the live reindex the next time Deal Check reopens and restores from it).

// A plain `{[fnIdx]: value}` object (dcCards, dcKitEdits, dcCarpetPick, etc.) — drop the removed
// function's own entry, shift every entry above it down by one.
export function reindexFnIdxObject(obj, removedIdx) {
  if (!obj || typeof obj !== "object") return obj;
  const next = {};
  Object.entries(obj).forEach(([k, v]) => {
    const i = Number(k);
    if (!Number.isInteger(i)) { next[k] = v; return; } // not an fnIdx-shaped key at all — leave untouched rather than silently drop it
    if (i === removedIdx) return;
    next[i > removedIdx ? i - 1 : i] = v;
  });
  return next;
}

// An array of items each carrying their OWN `.fnIdx` field (dcManualItems, dcCustomItems) — drop
// items that belonged to the removed function, decrement `.fnIdx` on every item above it.
export function reindexFnIdxArray(arr, removedIdx) {
  if (!Array.isArray(arr)) return arr;
  return arr
    .filter((it) => it?.fnIdx !== removedIdx)
    .map((it) => (typeof it?.fnIdx === "number" && it.fnIdx > removedIdx) ? { ...it, fnIdx: it.fnIdx - 1 } : it);
}

// A composite string key with an fnIdx embedded somewhere inside it (e.g. "2|bar",
// "transport:2:dept:Floral", "mandiList:2"). `parseIdx(key)` returns the embedded fnIdx, or null for
// a key that doesn't carry one at all (left untouched, never dropped). `rebuildKey(key, newIdx)`
// returns the same key with its fnIdx replaced.
export function reindexCompositeKeyObject(obj, removedIdx, parseIdx, rebuildKey) {
  if (!obj || typeof obj !== "object") return obj;
  const next = {};
  Object.entries(obj).forEach(([k, v]) => {
    const i = parseIdx(k);
    if (i == null) { next[k] = v; return; }
    if (i === removedIdx) return;
    next[rebuildKey(k, i > removedIdx ? i - 1 : i)] = v;
  });
  return next;
}

// A Set of strings each prefixed "${fnIdx}::…" (DealCheckOverlay.jsx's own kitHandEditsRef — a kit
// a salesperson has hand-edited, so an IMS-side kit-definition change doesn't silently overwrite
// their swap). Drops entries for the removed function, shifts the prefix down on entries above it.
export function reindexFnIdxPrefixedSet(set, removedIdx) {
  if (!(set instanceof Set)) return set;
  const next = new Set();
  set.forEach((entry) => {
    const m = /^(\d+)::/.exec(entry);
    if (!m) { next.add(entry); return; } // not fnIdx-prefixed at all — leave untouched
    const i = Number(m[1]);
    if (i === removedIdx) return;
    next.add((i > removedIdx ? i - 1 : i) + "::" + entry.slice(m[0].length));
  });
  return next;
}

// The composite-key shapes actually in use. `dcCollapsedZones` and `dcManualSearch` share the same
// "${fnIdx}|${zoneKey}" shape; `dcCollapsedFnBlocks` only embeds an fnIdx in its "transport:…" keys
// (its "manpower:${date}"/"pl:${d}"/"gyv:…" keys carry no fnIdx and must pass through as-is);
// `dcFloralCalcOpen` only embeds one in its "mandiList:${fnIdx}"/"elementList:${fnIdx}" keys (its
// "mandi:…"/"el:…" keys don't carry an fnIdx either — "el:${mgi}" is a list position, not an fnIdx).
export const ZONE_PIPE_KEY = {
  parseIdx: (k) => { const m = /^(\d+)\|/.exec(k); return m ? Number(m[1]) : null; },
  rebuildKey: (k, newIdx) => k.replace(/^\d+\|/, newIdx + "|"),
};
// DCTrussTab's own fold-state keys — same "${fnIdx}|${zoneKey}" shape as ZONE_PIPE_KEY but with a
// "truss:" prefix and a trailing "|${rowIdx}" (e.g. "truss:2|bar|0"). A regression review found this
// shares `dcCollapsedZones` with ZONE_PIPE_KEY's own plain keys, so both have to be checked — chain
// both reindexes when touching this field; neither regex false-matches the other's key shape.
export const TRUSS_ZONE_PIPE_KEY = {
  parseIdx: (k) => { const m = /^truss:(\d+)\|/.exec(k); return m ? Number(m[1]) : null; },
  rebuildKey: (k, newIdx) => k.replace(/^truss:\d+\|/, "truss:" + newIdx + "|"),
};
export const TRANSPORT_COLLAPSE_KEY = {
  parseIdx: (k) => { const m = /^transport:(\d+)(:|$)/.exec(k); return m ? Number(m[1]) : null; },
  rebuildKey: (k, newIdx) => k.replace(/^transport:\d+/, "transport:" + newIdx),
};
export const FLORAL_CALC_OPEN_KEY = {
  parseIdx: (k) => { const m = /^(mandiList|elementList):(\d+)$/.exec(k); return m ? Number(m[2]) : null; },
  rebuildKey: (k, newIdx) => k.replace(/:(\d+)$/, ":" + newIdx),
};

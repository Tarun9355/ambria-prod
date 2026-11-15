// Deal Check regenerate vs. a manual swap made in the same run — pulled out of StudioApp.jsx
// (bug 17, 2026-11-14 audit) so it's one pure function instead of being duplicated between what gets
// written into React state and what the sold-deal reconcile actually reserves. Before this fix, the
// regenerate's own setDcCards(prev => ...) correctly re-applied a manual swap from `prev` (the latest
// state) on top of the freshly rebuilt `newCards` — but reconcileSoldInventoryBlocks was called with
// the UN-merged `newCards` directly, so a swap made in Deal Check — most reachable right after a hard
// refresh, when this run's own `dcCards` closure can still read stale/empty (see the call site's own
// comment) — reserved the ORIGINAL item instead of the swapped one.
//
// Not merged into lib/studio/dealCheckSync.js (a pre-existing, unrelated module: Deal Check's edits
// written back into Build's zoneElements for an ONGOING, not-yet-sold deal) — this is the opposite
// direction and only matters for a SOLD deal's reconcile, operating on cards, not zoneElements.
//
// newCards: this run's freshly rebuilt cards, { [fnIdx]: { [cardKey]: card } }.
// latestCards: the latest known dcCards (either React's own `prev` inside a functional update, or a
//   ref mirroring dcCards synchronously) — never a stale render-time closure.
// validKeysByFn: { [fnIdx]: Set<cardKey> } — only defined for an fnIdx THIS RUN actually touched.
//   A key missing from it was genuinely pruned (its Build element is gone/renamed/reindexed) and must
//   not be resurrected. An fnIdx with no entry here wasn't processed at all this pass — every one of
//   its manual-swap cards carries forward unconditionally, same as before.
export function mergeManualSwaps(newCards, latestCards, validKeysByFn) {
  const merged = { ...newCards };
  Object.keys(latestCards || {}).forEach((fi) => {
    const prevFn = latestCards[fi] || {};
    const vKeys = validKeysByFn?.[fi];
    let mergedFn = null;
    Object.keys(prevFn).forEach((key) => {
      if (prevFn[key]?.source === "manual-swap" && (!vKeys || vKeys.has(key))) {
        if (!mergedFn) mergedFn = { ...(merged[fi] || {}) };
        mergedFn[key] = prevFn[key];
      }
    });
    if (mergedFn) merged[fi] = mergedFn;
  });
  return merged;
}

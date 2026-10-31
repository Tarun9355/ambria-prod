// Carpet preferences. A floor's carpet is not one pick any more: the salesperson ranks up to three stock carpets
// (1st to 3rd choice) and Planning decides which one is actually used, from what is free on the event date.
//
// Stored on the floor row (the zone's own floor, or an entry of extraPlatformRows):
//   cpPrefs  [{ id, name, free }]   in rank order — `free` is the carpet's free sqft when it was picked
// and the 1st choice is mirrored into cpInvId / cpInvName / cpInvFree, which is where every older reader (stock checks,
// Deal Check's carpet card, the layout pushed to IMS) already looks. Anything that changes a pick goes through
// prefsPatch, so the two can't disagree.

export const CARPET_PREF_MAX = 3;
export const CARPET_PREF_LABELS = ["1st choice", "2nd choice", "3rd choice"];

const clean = (p) => {
  if (!p || !p.id) return null;
  const free = p.free === null || p.free === undefined || p.free === "" ? null : (Number(p.free) || 0);
  return { id: String(p.id), name: String(p.name || ""), free };
};

// The floor's preferences in rank order. A floor saved before preferences existed has just cpInvId — that is its one
// preference. cpPrefs is trusted only while its 1st entry is still the mirrored cpInvId: an older writer that changed
// or cleared cpInvId alone leaves cpPrefs stale, and the single pick then wins.
export function prefsOf(row) {
  if (!row) return [];
  const seen = new Set();
  const list = (Array.isArray(row.cpPrefs) ? row.cpPrefs : []).map(clean).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  const legacyId = row.cpInvId ? String(row.cpInvId) : "";
  if (list.length && legacyId && list[0].id === legacyId) return list.slice(0, CARPET_PREF_MAX);
  if (legacyId) {
    const first = clean({ id: legacyId, name: row.cpInvName, free: row.cpInvFree });
    // a stale list behind a changed single pick: the new pick leads, the still-valid others follow it
    return [first, ...list.filter((p) => p.id !== legacyId)].slice(0, CARPET_PREF_MAX);
  }
  return [];
}

// The fields to write onto the floor row for "slot (0..2) becomes this pick" — or, with pick = null, "empty that slot".
// Choosing a carpet that is already in another slot moves it; removing a slot closes the gap so the ranks stay 1, 2, 3.
export function prefsPatch(row, slot, pick) {
  const next = prefsOf(row).slice();
  const s = Math.max(0, Math.min(CARPET_PREF_MAX - 1, Math.floor(Number(slot) || 0)));
  const p = clean(pick);
  if (!p) {
    next.splice(s, 1);
  } else {
    const dup = next.findIndex((x) => x.id === p.id);
    if (s < next.length) {
      next[s] = p;
      if (dup >= 0 && dup !== s) next.splice(dup, 1);
    } else {
      if (dup >= 0) next.splice(dup, 1);
      next.push(p);
    }
  }
  const list = next.slice(0, CARPET_PREF_MAX);
  return { cpPrefs: list, cpInvId: list[0]?.id || null, cpInvName: list[0]?.name || "", cpInvFree: list[0] ? list[0].free : null };
}

// The fields for "these picks, in this order, ARE the preferences" — what the picker's Save writes when it lets all of them be
// chosen in one go. Empty or unusable picks clear them. At most three, no repeats.
export function setPrefsPatch(picks) {
  const seen = new Set();
  const list = (Array.isArray(picks) ? picks : []).map(clean).filter((p) => p && !seen.has(p.id) && seen.add(p.id)).slice(0, CARPET_PREF_MAX);
  return { cpPrefs: list, cpInvId: list[0]?.id || null, cpInvName: list[0]?.name || "", cpInvFree: list[0] ? list[0].free : null };
}

// The sqft a floor row needs: its footprint times its Qty (identical footprints), the same figure the carpet is BILLED on
// (taxonomy.platformRowCost), so stock checks and the bill can never disagree about how much carpet a floor is.
export function floorSqftOf(row) {
  const fd = row?.floorDims || {};
  const area = (Number(fd.L) || Number(fd.S) || 0) * (Number(fd.W) || Number(fd.S) || 0);
  const qty = Math.max(1, Math.round(Number(row?.plQty) || 1));
  return area * qty;
}

export const clearPrefsPatch = () => ({ cpPrefs: [], cpInvId: null, cpInvName: "", cpInvFree: null });

export function prefsStatus(row) {
  const count = prefsOf(row).length;
  return { count, max: CARPET_PREF_MAX, complete: count >= CARPET_PREF_MAX };
}

// ── Which preference each floor would take, and what it is short of ──
// floors: [{ key, area, prefs }] in the order stock is handed out (zone order, each zone's floor then its extra platforms).
// A floor takes its highest-ranked preference that still has room for the whole floor. If none does, it takes the one
// with the most left and is short by the rest. A preference whose free sqft is unknown can't be checked, so it is
// skipped; a floor with no checkable preference is left alone (not short).
// With one preference this is exactly the old single-pick rule.
export function assignCarpets(floors) {
  const used = {};
  const assign = {};
  const short = {};
  (floors || []).forEach((f) => {
    const area = Number(f?.area) || 0;
    const prefs = Array.isArray(f?.prefs) ? f.prefs : [];
    assign[f?.key] = prefs[0]?.id || null;
    const known = prefs.filter((p) => p && p.free !== null && p.free !== undefined);
    if (!(area > 0) || !known.length) return;
    const fits = known.find((p) => (used[p.id] || 0) + area <= p.free);
    const pick = fits || known.reduce((best, p) => ((p.free - (used[p.id] || 0)) > (best.free - (used[best.id] || 0)) ? p : best), known[0]);
    const before = used[pick.id] || 0;
    used[pick.id] = before + area;
    assign[f.key] = pick.id;
    const s = Math.min(area, Math.max(0, before + area - pick.free));
    if (s > 0) short[f.key] = s;
  });
  return { assign, short };
}

// Sqft this floor can still be sized to: the most any of its preferences has left after every OTHER floor has taken its
// share. null when none of its preferences has a known free figure (nothing to limit it by).
export function carpetRemainingFor(floors, key) {
  const mine = (floors || []).find((f) => f?.key === key);
  const known = (mine?.prefs || []).filter((p) => p && p.free !== null && p.free !== undefined);
  if (!known.length) return null;
  const others = (floors || []).filter((f) => f?.key !== key);
  const used = {};
  // replay the others, in order, to see what they take
  others.forEach((f) => {
    const area = Number(f?.area) || 0;
    const ks = (f?.prefs || []).filter((p) => p && p.free !== null && p.free !== undefined);
    if (!(area > 0) || !ks.length) return;
    const fits = ks.find((p) => (used[p.id] || 0) + area <= p.free);
    const pick = fits || ks.reduce((best, p) => ((p.free - (used[p.id] || 0)) > (best.free - (used[best.id] || 0)) ? p : best), ks[0]);
    used[pick.id] = (used[pick.id] || 0) + area;
  });
  return Math.max(...known.map((p) => p.free - (used[p.id] || 0)));
}

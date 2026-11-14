// FOC ("free of cost") — a per-element flag, same shape as repeatOverride: set on a
// zoneElements[zk][idx] entry (or its functionsDetail.elements deep copy). A FOC'd element is
// billed nothing (guest and internal cost alike), costs no manpower or transport, and is never
// blocked in the `blocks` reservation ledger — it's already sitting at the venue from a previous
// event. One shared predicate so every cost/manpower/transport/blocking/reuse walker tests it the
// same way.
export const isFoc = (el) => el?.foc === true;

// A Deal Check cardKey encodes "el::zoneKey::rcName::idx" or "fl::zoneKey::rcName::idx::propType"
// (StudioApp.jsx's buildElCardKey/buildFlCardKey) — idx is always index 3. Lightweight re-parse so
// any module can resolve a card's own FOC status without importing StudioApp.jsx's parseCardKey.
export function parseCardKeyLite(key) {
  const parts = String(key || "").split("::");
  if (parts[0] !== "el" && parts[0] !== "fl") return null;
  if (parts.length < 4) return null;
  const idx = Number(parts[3]);
  if (!Number.isFinite(idx)) return null;
  return { zoneKey: parts[1], rcName: parts[2], idx };
}

// Is a Deal Check card's underlying Build element marked FOC? Resolved live via the cardKey's own
// zoneKey+idx backlink into zoneElements (never a card-side field, so toggling FOC never needs a
// card regeneration or re-run of IMS matching). The rcName check fails SAFE (treats a mismatch as
// NOT FOC) — a stale cardKey pointing at a different, since-edited element must never wrongly zero
// out or release something it was never meant to; FOC moves money and inventory holds to zero, a
// higher-stakes mistake than most other per-element reads getting a stale index. The single shared
// implementation every caller uses, so the fail-safe check can never be applied in one place and
// skipped in another (confirmed gap, regression review 2026-11-14).
export function cardIsFoc(zoneElements, cardKey) {
  const parsed = parseCardKeyLite(cardKey);
  if (!parsed) return false;
  const el = zoneElements?.[parsed.zoneKey]?.[parsed.idx];
  if (!isFoc(el)) return false;
  return String(el.name || "").trim().toLowerCase() === String(parsed.rcName || "").trim().toLowerCase();
}

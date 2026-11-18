// FOC ("free of cost") — a per-element flag, same shape as repeatOverride: set on a
// zoneElements[zk][idx] entry (or its functionsDetail.elements deep copy). A FOC'd element is
// billed nothing (guest and internal cost alike), costs no manpower or transport, and is never
// blocked in the `blocks` reservation ledger — it's already sitting at the venue from a previous
// event. One shared predicate so every cost/manpower/transport/blocking/reuse walker tests it the
// same way.
export const isFoc = (el) => el?.foc === true;

// FOC on a TRUSS (owner ask 2026-11-17, from sales): the whole truss setup - the structure, its drape / Liza / curtains, its
// masking, its loose fabric and its custom ceiling - is already standing at the venue from a previous event. Billed nothing,
// no truss / fabric crew, no truck, nothing reserved in IMS (pillars, beams, batta, fabric stock). `row` is one truss of a
// zone: the zone config itself (its own truss, "Truss 1") or one entry of zc.extraTrussRows. The flag is trussFoc, not foc,
// because row 0 IS the zone config, which also carries the zone's platform, carpet and prints - none of which this frees.
// Checked at the source - resolveTrussConfig (so every truss preview / engine / crew count sees no truss), trussRowCost and
// calcZoneFabricCost - so every reader of a truss row follows without a check of its own.
export const isTrussFoc = (row) => row?.trussFoc === true;

// FOC on a PLATFORM (owner ask 2026-11-18): this floor - the platform AND the carpet on it - is already laid at the venue from a
// previous event. Billed nothing, no platform / carpet crew or truck, nothing reserved or planned in IMS (battas, carpet stock,
// the Tenting carpet plan). `row` is the zone config itself (its own floor, row 0) or one entry of zc.extraPlatformRows; the flag
// is platformFoc because row 0 IS the zone config. Checked at the source - taxonomy.platformRowCost / carpetNewShares,
// carpetPrefs.floorSqftOf (the carpet sqft every plan, stock check and crew count reads), buildPlatformPlan - plus the few
// places that rebuild row 0 field by field (which must carry the flag along).
export const isPlatformFoc = (row) => row?.platformFoc === true;

// A zone config without any truss FOC - for every path that carries a build into ANOTHER deal or context (a library master's
// saved build, picking that photo, copying a build from another client). "Already at the venue" is true of this event only:
// carried along, it would silently bill a truss, its fabric and masking at Rs 0 on a deal where nobody chose that.
// Also drops a platform FOC (platformFoc, on the zone and its extraPlatformRows) - "already at the venue" is this event's only.
export function withoutTrussFoc(cfg) {
  if (!cfg || typeof cfg !== "object") return cfg;
  const { trussFoc: _f, platformFoc: _pf, ...rest } = cfg; // eslint-disable-line no-unused-vars
  if (Array.isArray(rest.extraPlatformRows)) {
    rest.extraPlatformRows = rest.extraPlatformRows.map((r) => {
      if (!r || typeof r !== "object") return r;
      const { platformFoc: _x, ...o } = r; // eslint-disable-line no-unused-vars
      return o;
    });
  }
  if (Array.isArray(rest.extraTrussRows)) {
    rest.extraTrussRows = rest.extraTrussRows.map((r) => {
      if (!r || typeof r !== "object") return r;
      const { trussFoc: _x, ...o } = r; // eslint-disable-line no-unused-vars
      return o;
    });
  }
  return rest;
}
// the same over a whole build snapshot ({ zoneConfig: { [zk]: cfg } })
export function buildWithoutTrussFoc(build) {
  if (!build || typeof build !== "object" || !build.zoneConfig || typeof build.zoneConfig !== "object") return build;
  const zoneConfig = {};
  Object.entries(build.zoneConfig).forEach(([zk, cfg]) => { zoneConfig[zk] = withoutTrussFoc(cfg); });
  return { ...build, zoneConfig };
}

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

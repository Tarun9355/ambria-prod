// ═══════════════════════════════════════════════════════════════
// DEAL CHECK — MANPOWER SUB-TAB (Studio slice).
// VERBATIM port of the reference `dcActiveTab === "manpower"` body
// (reference App_latest.jsx ~14658–15619) plus the inline dcMpCalcOpen
// per-day calculation breakdown panel it drives (15416–15587).
// ═══════════════════════════════════════════════════════════════
import { resolveTrussConfig } from "../../../../lib/studio/pricing";
import { heavyExtraLabour, eventTimingMultFor } from "../../../../lib/ims/constants";
import { standingReductionBySubcat, standingPillarCount, fixedVenueFor } from "../../../../lib/ims/fixedVenues";
import { itemImsSubcat } from "../../../../lib/ims/helpers";

export default function DCManpowerTab({ ctx }) {
  const {
    // chrome / theme
    border, textS,
    // build / fn state
    collectAllFunctionData,
    // settings + zone meta + rate card
    dealCheckData, rcItems, zoneMeta, dcCards,
    // pricing helpers (module-exposed via ctx)
    calcZoneTrussPreview,
    // manpower state
    dcMpOverrides, setDcMpOverrides,
    dcMpWinCount, setDcMpWinCount,
    dcMpIncludeMinusOne, setDcMpIncludeMinusOne,
    dcMpIncludeDismantle, setDcMpIncludeDismantle,
    dcMpCalcOpen, setDcMpCalcOpen,
  } = ctx;

  return (() => {
                  // ═══ MANPOWER TAB — Booking-level day-wise forecast (22 May 2026) ═══
                  // Replaces per-fn Flowerist/Electrician view with booking-level multi-day layout.
                  // - People count: per-ceremony Tier 1/2/3 mirror of IMS (calcTier1Flowerist@1701, calcTier2@1738, calcTier3@1756)
                  // - Cumulative MAX rule: labour only scales UP across booking days
                  // - Cost = people × ticked_windows × rate (sequential window count)
                  // - Day-wise window checkbox overrides stored in dcMpOverrides
                  const fns = collectAllFunctionData ? collectAllFunctionData() : [];
                  if (fns.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No functions configured yet.</div>;

                  // ── Settings (IMS Redis) ──────────────────────────────────
                  const dihariSchemes = dealCheckData?.dihariSchemes || {};
                  const defaultWindowsByPhase = dealCheckData?.defaultWindowsByPhase || {};
                  const labourTiers = dealCheckData?.labourTiers || {};
                  const venueMinLabour = dealCheckData?.venueMinLabour || {};
                  const defaultMinLabour = dealCheckData?.defaultMinLabour || 4;
                  const eventTypeMultipliers = dealCheckData?.eventTypeMultipliers || { outdoor_budgeted:1.0 };
                  const eventTimingMultipliers = dealCheckData?.eventTimingMultipliers || {};
                  const sayaMultiplier = dealCheckData?.sayaMultiplier || 1.3;
                  const heavyElementRanges = dealCheckData?.heavyElementRanges || [];
                  const fabricBangaliRanges = dealCheckData?.fabricBangaliRanges || [];
                  const trussLabourRanges = dealCheckData?.trussLabourRanges || [];
                  // §23 Phase 2.6 — RFT divisor for Fabric Bangali side-wall calc
                  const fabricRftPerWorker = Number(dealCheckData?.fabricRftPerWorker) || 100;
                  const flowerPatternsMP = dealCheckData?.flowerPatterns || [];
                  const electricianProdMP = dealCheckData?.electricianProductivity || {};
                  const seasonMapMP = dealCheckData?.seasonMap || {};
                  const recipeSubsMP = (dealCheckData?.flowerRecipeSubcats || ["Flower Pattern"]).map(s => String(s||"").toLowerCase().trim());
                  // ── Vendor avg-rate lookup (22 May 2026) ─────────────
                  // For each labour type: avg of (vendor.storedRate.amount) where
                  // vendor.type==="Manpower Contractor", vendor.active, vendor.isFixed, vendor.labourType===type.
                  // Falls back to dihariSchemes[type].rate (house default) when no vendors match.
                  const vendorsMP = (dealCheckData?.vendors || []).filter(v => v && v.active && v.type === "Manpower Contractor" && v.isFixed && v.labourType && Number(v?.storedRate?.amount) > 0);
                  const rateByType = {};
                  const rateSourceByType = {};
                  Object.keys(dihariSchemes).forEach(type => {
                    const matches = vendorsMP.filter(v => v.labourType === type);
                    if (matches.length > 0) {
                      const sum = matches.reduce((s, v) => s + Number(v.storedRate.amount || 0), 0);
                      rateByType[type] = Math.round(sum / matches.length);
                      rateSourceByType[type] = { kind: "vendor_avg", count: matches.length, vendors: matches.map(v => v.name) };
                    } else {
                      rateByType[type] = Number(dihariSchemes[type]?.rate || 0);
                      rateSourceByType[type] = { kind: "house_default", count: 0 };
                    }
                  });

                  // ── Helpers ───────────────────────────────────────────────
                  const sizeFromMode = (inhouseMode, elSize) => {
                    if (inhouseMode === "smb") {
                      const s = (elSize || "M").toUpperCase();
                      if (s === "S") return "small";
                      if (s === "B") return "big";
                      return "medium";
                    }
                    return "medium";
                  };
                  const shiftToTiming = (shift) => {
                    const s = String(shift||"").toLowerCase();
                    if (s.includes("morning") || s.includes("brunch")) return "brunch";
                    if (s.includes("lunch")) return "lunch";
                    if (s.includes("sundowner")) return "sundowner";
                    if (s.includes("night")) return "dinner";
                    return "dinner";
                  };
                  // Walk all elements in a fn (mirror of existing flowerist code path)
                  const walkFnElements = (fn, cb) => {
                    Object.entries(fn.zoneElements || {}).forEach(([zk, elems]) => {
                      if (!fn.enabledEls?.[zk]) return;
                      (elems || []).forEach(el => {
                        const rc = rcItems.find(i => i.name.toLowerCase() === (el.name || "").toLowerCase());
                        if (!rc) return;
                        const qty = el.qty || 0;
                        if (qty <= 0) return;
                        cb({ el, rc, qty, zoneKey: zk });
                      });
                    });
                  };

                  // Fixed-venue "Repeat" model — MUST match DealCheckOverlay: drop repeat zones from the
                  // computation (reused = no build labour), then floor each type at the venue's fixed crew.
                  const _fvCfgAll = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                  // Repeat zones (ANY venue) drop out of the build-labour computation. The fixed-crew FLOOR
                  // below still only applies at configured fixed venues (fv truthy); non-fixed → computed only.
                  const freshFnMP = (fn) => {
                    const zc = fn.zoneConfig || {}, en = fn.enabledEls || {};
                    const repeatZk = Object.keys(zc).filter(zk => en[zk] && zc[zk]?.repeat);
                    if (!repeatZk.length) return fn;
                    const nen = { ...en }; repeatZk.forEach(zk => { nen[zk] = false; });
                    return { ...fn, enabledEls: nen };
                  };
                  const fixedCrewFloor = (fv, type) => { const c = fv.fixedCrew || {}; if (c[type] != null && c[type] !== "") return Number(c[type]) || 0; if (type === "Labours") return Number(fv.minLabour) || 0; return 0; };
                  // Usage-based labour floor — MUST match the project-total rollup (DealCheckOverlay):
                  // Labours = ceil(Σ sub-cat units ÷ per-unit) over FRESH zones (repeat excluded).
                  const _labBatches = {}; heavyElementRanges.forEach(her => { if (her && her.subCat && Number(her.perCount) > 0) _labBatches[her.subCat] = Number(her.perCount); });
                  const labourUsageMode = Object.keys(_labBatches).length > 0;
                  let labourUsageTotal = 0;
                  if (labourUsageMode) fns.forEach(fn => walkFnElements(freshFnMP(fn), ({ rc, qty }) => { const b = _labBatches[itemImsSubcat(rc)]; if (b) labourUsageTotal += (Number(qty) || 0) / b; }));

                  // ── People count per ceremony per labour type ─────────────
                  // Mirror of IMS App.jsx calcTier1Flowerist (line 1701). DO NOT diverge without IMS commit.
                  const calcPeopleFlowerists = (fn) => {
                    let total = 0;
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      const subLC = String(rc.sub||"").toLowerCase().trim();
                      if (cat !== "florals") return;
                      // Count if the recipe has flowerist productivity: an EXACT pattern-name match counts on
                      // its own (so a defined recipe like "Console Table Floral" is included without needing its
                      // sub-cat toggled into flowerRecipeSubcats); loose name matching stays gated to those subs.
                      const inRS = recipeSubsMP.includes(subLC);
                      const targetName = (rc.name||"").toLowerCase().trim();
                      let pattern = flowerPatternsMP.find(p => (p.name||"").toLowerCase().trim() === targetName);
                      if (!pattern && inRS) {
                        pattern = flowerPatternsMP.find(p => {
                          const n = (p.name||"").toLowerCase().trim();
                          return n && (n.includes(targetName) || targetName.includes(n));
                        });
                      }
                      if (!pattern) return;
                      const sizeKey = sizeFromMode(rc.inhouseMode, el.size);
                      const sizes = pattern.sizes || {};
                      let comp = sizes[sizeKey] || sizes.medium;
                      if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                      const upf = Number(comp?.unitsPerFlowerist || 0);
                      if (upf > 0) total += qty / upf; // fractional, ceil once below
                    });
                    return Math.ceil(total);
                  };
                  // Mirror of IMS calcTier1Electrician (line 1729).
                  const calcPeopleElectricians = (fn) => {
                    let total = 0;
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      if (cat !== "lighting") return;
                      const sub = rc.sub || "";
                      const prod = electricianProdMP[sub];
                      if (!prod) return;
                      const sizeKey = sizeFromMode(rc.inhouseMode, el.size);
                      const upe = Number(prod.sizes?.[sizeKey]) || Number(prod.sizes?.medium) || 0;
                      if (upe > 0) total += qty / upe; // fractional, ceil once below
                    });
                    return Math.ceil(total);
                  };
                  // Mirror of IMS calcTier2 (line 1738). Tier 2 = sub-cat batches.
                  const calcPeopleTier2 = (fn, type) => {
                    const cfg = labourTiers[type] || { minimum:1, subCatBatches:{} };
                    const batches = cfg.subCatBatches || {};
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => {
                      const sub = itemImsSubcat(rc);
                      if (batches[sub]) subCounts[sub] = (subCounts[sub] || 0) + qty;
                    });
                    // Sum fractional need across sub-categories, THEN round up once.
                    let frac = 0;
                    Object.entries(subCounts).forEach(([sc, count]) => {
                      const b = batches[sc] || 3;
                      frac += count / b;
                    });
                    return Math.max(cfg.minimum || 1, Math.ceil(frac));
                  };
                  // Mirror of IMS calcTier3 (line 1756). Tier 3 = venue + event + situational + heavy.
                  const calcPeopleTier3Labours = (fn) => {
                    const venueName = fn.fnVenue || "";
                    // No internal venue floor — the fixed-venue floor is applied uniformly for ALL types in
                    // peopleByFn (max(fixedCrew, computed)). Here we only compute the usage/heavy build need.
                    const venueMin = 0;
                    const dumpingLevel = (dealCheckData?.venueDumping || {})[venueName] || "nearby";
                    const dumpingMult = ({ nearby:1.0, medium:1.1, far:1.2 })[dumpingLevel] || 1.0;
                    const segment = "outdoor_budgeted"; // default (Studio has no segment field)
                    const eventMult = eventTypeMultipliers[segment] || 1;
                    const base = Math.ceil(venueMin * eventMult);
                    const dayPrior = dcMpIncludeMinusOne; // -1 day enabled = day-prior confirmed
                    let situationalMult = 1.0;
                    if (!dayPrior) {
                      const candidates = [dumpingMult];
                      const season = seasonMapMP[fn.fnDate||""];
                      if (season === "kings") candidates.push(sayaMultiplier);
                      const timingId = shiftToTiming(fn.fnShift);
                      candidates.push(eventTimingMultFor(eventTimingMultipliers, timingId, "Labours", 1.0));
                      situationalMult = Math.max(...candidates, 1.0);
                    }
                    const adjusted = Math.ceil(base * situationalMult);
                    // Heavy element add-ons
                    let heavyExtra = 0;
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => {
                      const sub = itemImsSubcat(rc);
                      subCounts[sub] = (subCounts[sub] || 0) + qty;
                    });
                    // Net fixed-venue standing inventory (by matched item id) — mirrors IMS.
                    const reduction = standingReductionBySubcat({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || "", (dcCards || {})[fns.indexOf(fn)], dealCheckData?.inventory || []);
                    heavyElementRanges.forEach(her => {
                      const count = Math.max(0, (subCounts[her.subCat] || 0) - (reduction[her.subCat] || 0));
                      heavyExtra += heavyExtraLabour(her, count);
                    });
                    // Usage-based floor (matches the rollup / quote): never fewer than 1 labour per N units.
                    return labourUsageMode ? Math.max(adjusted + heavyExtra, Math.ceil(labourUsageTotal)) : (adjusted + heavyExtra);
                  };
                  // §23 Phase 2.8 (26 May 2026) — Per-zone Fabric Bangali calculation
                  //   • Per-zone RFT ceil (each zone rounds independently, not summed)
                  //   • U Truss: only "back" checkbox = L-span (no left/right options)
                  //   • Half Box: back (L-span) + left (backDepth) + right (backDepth), all per-toggle
                  //   • Full Box: back (dL) + left (dW) + right (dW). NEVER front (audience-facing, always open)
                  //   • Wall Masking element-card branch deleted — fabric only ever comes from zone truss dims
                  //   • mkOn applies to all configs uniformly (was: half/u always-on under Phase 2.6 — reverted)
                  //   • Defaults set in normalizeMkWallsDefaults() applied silently on session load
                  // FINAL = Σ (zoneTop + ceil(zoneRft / fabricRftPerWorker)) over enabled zones with mkOn
                  // Multipliers (Heavy Saya × Premium × Day-Prior/Rush) deferred to Phase 2.7.
                  const calcPeopleFabricBangali = (fn) => {
                    let total = 0;
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    const engBackDepth = Number(dealCheckData?.trussInv?.settings?.defaultBackDepthFt) || 4;
                    Object.keys(zc).forEach(zk => {
                      if (!en[zk] || !zc[zk]) return;
                      const z = zc[zk];
                      if (!z.mkOn) return;
                      const cfg = resolveTrussConfig(z);
                      if (!cfg || !cfg.config) return;
                      const config = cfg.config;
                      const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0;
                      const dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
                      const mw = z.mkWalls || {};
                      const sideDepth = Number(z.trussBackDepth) || engBackDepth;

                      let zoneTop = 0;
                      let zoneRft = 0;

                      if (config === "full_box") {
                        // Top sqft per-zone range lookup
                        const topSqft = dL * dW;
                        if (topSqft > 0 && fabricBangaliRanges.length > 0) {
                          for (const r of fabricBangaliRanges) {
                            if (topSqft <= r.upTo) { zoneTop = r.labour || 0; break; }
                          }
                        }
                        // Side walls — back spans the WIDTH (dW), left/right span the DEPTH (dL). Never front.
                        if (mw.back  && dW > 0) zoneRft += dW;
                        if (mw.left  && dL > 0) zoneRft += dL;
                        if (mw.right && dL > 0) zoneRft += dL;
                      } else if (config === "half_box") {
                        // Half Box — back (L-span) + left/right (backDepth) per-toggle
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back  && spanL > 0)      zoneRft += spanL;
                        if (mw.left  && sideDepth > 0)  zoneRft += sideDepth;
                        if (mw.right && sideDepth > 0)  zoneRft += sideDepth;
                      } else if (config === "u_only") {
                        // U Truss — only "back" checkbox (L-span). No left/right.
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back && spanL > 0) zoneRft += spanL;
                      }

                      const zoneRftLabour = zoneRft > 0 ? Math.ceil(zoneRft / fabricRftPerWorker) : 0;
                      total += zoneTop + zoneRftLabour;
                    });

                    return total;
                  };
                  // Truss Labour — §23 Phase 2.5 rewire: count pillars from zone-derived Layer 1
                  // topology (matches what Deal Check Truss tab shows). The previous element-counting
                  // logic (Pillar/Column/Truss subcat scan) was never reaching zone-defined trusses
                  // because §23 stores truss as zone.trussType + zone.dims, not as Pillar elements.
                  const calcPeopleTrussLabour = (fn) => {
                    let pillars = 0;
                    // ── §23 Phase 2.5: zone-derived pillar count (Layer 1 truth) ──
                    const tInv = dealCheckData?.trussInv;
                    if (tInv) {
                      const zc = fn.zoneConfig || {};
                      const en = fn.enabledEls || {};
                      Object.keys(zc).forEach(zk => {
                        if (!en[zk] || !zc[zk]) return;
                        try {
                          const pv = calcZoneTrussPreview(zc[zk], tInv);
                          if (pv?.topology?.pillarCount) pillars += pv.topology.pillarCount;
                        } catch {}
                      });
                    }
                    // Net the venue's standing (installed) pillars — reused truss adds no labour.
                    pillars = Math.max(0, pillars - standingPillarCount({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || ""));
                    if (pillars <= 0 || trussLabourRanges.length === 0) return 0;
                    for (const r of trussLabourRanges) {
                      if (pillars <= r.upTo) return r.labour || 0;
                    }
                    return trussLabourRanges[trussLabourRanges.length-1]?.labour || 0;
                  };
                  // Default counts for types without IMS auto-compute
                  const calcPeopleDefault = (fn, type) => {
                    if (type === "Supervisors") return 1;
                    if (type === "Helpers") return 0;
                    if (type === "Drivers") return 0;
                    return 0;
                  };
                  // Dispatcher
                  const calcPeopleForType = (fn, type) => {
                    if (type === "Flowerists") return calcPeopleFlowerists(fn);
                    if (type === "Electricians") return calcPeopleElectricians(fn);
                    if (type === "Labours") return calcPeopleTier3Labours(fn);
                    if (type === "Fabric Bangali") return calcPeopleFabricBangali(fn);
                    if (type === "Truss Labour") return calcPeopleTrussLabour(fn);
                    const cfg = labourTiers[type];
                    if (cfg && cfg.tier === 2) return calcPeopleTier2(fn, type);
                    if (cfg && cfg.tier === 3) return calcPeopleTier3Labours(fn);
                    return calcPeopleDefault(fn, type);
                  };

                  // ── Trace helpers (22 May 2026 · breakdown UI) ─────────────
                  // Return calculation breakdown structures for the "how" toggle panel.
                  // Each returns { type:"element_table"|"formula_chain"|"subcat_table"|"range_lookup"|"default", ... }
                  // Aggregate identical elements (same name + size + productivity) ACROSS zones into one row —
                  // flowerists/electricians are fungible & the count is just Σ(qty÷productivity), so showing the
                  // same element once (with its combined qty) reads cleaner and doesn't change the total.
                  // (Fabric Bangali stays per-zone — its RFT ceils per zone, so it MUST NOT be combined.)
                  const traceFlowerists = (fn) => {
                    const agg = {};
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      const subLC = String(rc.sub||"").toLowerCase().trim();
                      if (cat !== "florals") return;
                      // Count if the recipe has flowerist productivity: an EXACT pattern-name match counts on
                      // its own (so a defined recipe like "Console Table Floral" is included without needing its
                      // sub-cat toggled into flowerRecipeSubcats); loose name matching stays gated to those subs.
                      const inRS = recipeSubsMP.includes(subLC);
                      const targetName = (rc.name||"").toLowerCase().trim();
                      let pattern = flowerPatternsMP.find(p => (p.name||"").toLowerCase().trim() === targetName);
                      if (!pattern && inRS) {
                        pattern = flowerPatternsMP.find(p => {
                          const n = (p.name||"").toLowerCase().trim();
                          return n && (n.includes(targetName) || targetName.includes(n));
                        });
                      }
                      if (!pattern) { const k = `${targetName}||nopattern`; if (!agg[k]) agg[k] = { name: rc.name, size: null, qty: 0, productivity: null, missing: "no pattern" }; agg[k].qty += qty; return; }
                      const sizeKey = sizeFromMode(rc.inhouseMode, el.size);
                      const sizes = pattern.sizes || {};
                      let comp = sizes[sizeKey] || sizes.medium;
                      if (!comp && sizeKey === "big" && sizes.large) comp = sizes.large;
                      const upf = Number(comp?.unitsPerFlowerist || 0);
                      const k = `${targetName}|${sizeKey}|${upf}`;
                      if (!agg[k]) agg[k] = { name: rc.name, size: sizeKey, qty: 0, productivity: upf, missing: upf <= 0 ? "no productivity" : null };
                      agg[k].qty += qty;
                    });
                    let total = 0;
                    const items = Object.values(agg).map(r => { const need = r.productivity > 0 ? r.qty / r.productivity : 0; total += need; return { ...r, need: Math.round(need * 100) / 100 }; });
                    return { kind: "element_table", header: ["Floral element","Qty","Per flwr","Need"], items, total: Math.ceil(total), formula: "⌈Σ(qty ÷ productivity)⌉ — sum then round up (Tier 1)" };
                  };
                  const traceElectricians = (fn) => {
                    const agg = {};
                    walkFnElements(fn, ({ rc, qty, el }) => {
                      const cat = String(rc.cat||"").toLowerCase();
                      if (cat !== "lighting") return;
                      const sub = rc.sub || "";
                      const prod = electricianProdMP[sub];
                      if (!prod) { const k = `${(rc.name||"").toLowerCase().trim()}||noprod`; if (!agg[k]) agg[k] = { name: rc.name, size: null, qty: 0, productivity: null, missing: "no productivity" }; agg[k].qty += qty; return; }
                      const sizeKey = sizeFromMode(rc.inhouseMode, el.size);
                      const upe = Number(prod.sizes?.[sizeKey]) || Number(prod.sizes?.medium) || 0;
                      const k = `${(rc.name||"").toLowerCase().trim()}|${sizeKey}|${upe}`;
                      if (!agg[k]) agg[k] = { name: rc.name, size: sizeKey, qty: 0, productivity: upe, missing: upe <= 0 ? "no productivity" : null };
                      agg[k].qty += qty;
                    });
                    let total = 0;
                    const items = Object.values(agg).map(r => { const need = r.productivity > 0 ? r.qty / r.productivity : 0; total += need; return { ...r, need: Math.round(need * 100) / 100 }; });
                    return { kind: "element_table", header: ["Lighting element","Qty","Per electr","Need"], items, total: Math.ceil(total), formula: "⌈Σ(qty ÷ productivity)⌉ — sum then round up (Tier 1)" };
                  };
                  const traceTier2 = (fn, type) => {
                    const cfg = labourTiers[type] || { minimum:1, subCatBatches:{} };
                    const batches = cfg.subCatBatches || {};
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => {
                      const sub = itemImsSubcat(rc);
                      if (batches[sub]) subCounts[sub] = (subCounts[sub] || 0) + qty;
                    });
                    const rows = []; let frac = 0;
                    Object.entries(subCounts).forEach(([sc, count]) => {
                      const b = batches[sc] || 3;
                      const part = count / b;
                      rows.push({ sub: sc, count, batch: b, need: Math.round(part * 100) / 100 }); // fractional contribution
                      frac += part;
                    });
                    const sum = Math.ceil(frac);
                    const total = Math.max(cfg.minimum || 1, sum);
                    return { kind: "subcat_table", header: ["Sub-category","Count","Batch","Need"], rows, sum, frac: Math.round(frac * 100) / 100, minimum: cfg.minimum || 1, total, formula: "max(min, ⌈Σ(count ÷ batch)⌉) (Tier 2)" };
                  };
                  const traceTier3Labours = (fn) => {
                    // Labours are fungible: EVERY element's sub-category contributes (count ÷ its "1-per-N")
                    // — summed across ALL elements and rounded up ONCE (mirrors calcPeopleTier3Labours'
                    // labourUsageTotal). The venue-min (+ situational) acts as a FLOOR. The old trace only
                    // showed per-sub-category FLOORED heavy add-ons, so tiny quantities (e.g. 6 console tables
                    // at 1-per-20) vanished and it looked like only Stage counted — but the count already
                    // summed them. This table now shows the real derivation.
                    const venueName = fn.fnVenue || "—";
                    const _fvCfg = { fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} };
                    const _fv = fixedVenueFor(_fvCfg, venueName);
                    const venueMin = _fv ? (_fv.minLabour ?? defaultMinLabour) : 0; // min only for fixed venues
                    const dumpingLevel = (dealCheckData?.venueDumping || {})[venueName] || "nearby";
                    const dumpingMult = ({ nearby:1.0, medium:1.1, far:1.2 })[dumpingLevel] || 1.0;
                    const eventMult = eventTypeMultipliers["outdoor_budgeted"] || 1;
                    const base = Math.ceil(venueMin * eventMult);
                    let situationalMult = 1.0;
                    if (!dcMpIncludeMinusOne) {
                      const cands = [dumpingMult];
                      const season = seasonMapMP[fn.fnDate||""];
                      if (season === "kings") cands.push(sayaMultiplier);
                      cands.push(eventTimingMultFor(eventTimingMultipliers, shiftToTiming(fn.fnShift), "Labours", 1.0));
                      situationalMult = Math.max(...cands, 1.0);
                    }
                    const adjusted = Math.ceil(base * situationalMult); // venue-min floor (with situational)
                    const subCounts = {};
                    walkFnElements(fn, ({ rc, qty }) => { const s = itemImsSubcat(rc); subCounts[s] = (subCounts[s] || 0) + qty; });
                    const reductionB = standingReductionBySubcat({ fixedVenues: dealCheckData?.fixedVenues || [], venueParents: dealCheckData?.venueParents || {} }, fn.fnVenue || "", (dcCards || {})[fns.indexOf(fn)], dealCheckData?.inventory || []);
                    const rows = []; let usageSum = 0, heavyFloor = 0;
                    heavyElementRanges.forEach(her => {
                      const per = Number(her.perCount) || 0; if (per <= 0) return;
                      const count = Math.max(0, (subCounts[her.subCat] || 0) - (reductionB[her.subCat] || 0));
                      if (count <= 0) return;
                      usageSum += count / per;
                      heavyFloor += heavyExtraLabour(her, count);
                      rows.push({ sub: her.subCat, count, batch: per, need: Math.round((count / per) * 100) / 100 });
                    });
                    rows.sort((a, b) => b.need - a.need);
                    const usageCeil = Math.ceil(usageSum);
                    const floorSide = adjusted + heavyFloor; // venue-min (situational) + per-sub-cat heavy floors
                    const total = Math.max(floorSide, usageCeil);
                    return { kind: "subcat_table", header: ["Sub-category","Count","1 per","Need"], rows, sum: usageCeil, frac: Math.round(usageSum * 100) / 100, minimum: floorSide, total, formula: "max(venue-min floor, ⌈Σ(count ÷ 1-per-N)⌉) — summed across ALL elements (Tier 3)" };
                  };
                  // §23 Phase 2.6 — trace mirrors new top+RFT logic
                  const traceFabricBangali = (fn) => {
                    // §23 Phase 2.8 — Per-zone breakdown: each zone shows its own top + RFT + ceiling.
                    // Wall Masking element-card branch removed (fabric only ever from zone truss).
                    const items = [];
                    let grandTotal = 0;
                    let grandRft = 0;
                    let grandTop = 0;
                    const zc = fn.zoneConfig || {};
                    const en = fn.enabledEls || {};
                    const engBackDepth = Number(dealCheckData?.trussInv?.settings?.defaultBackDepthFt) || 4;
                    Object.keys(zc).forEach(zk => {
                      if (!en[zk] || !zc[zk]) return;
                      const z = zc[zk];
                      if (!z.mkOn) return;
                      const cfg = resolveTrussConfig(z);
                      if (!cfg || !cfg.config) return;
                      const config = cfg.config;
                      const dL = Number(z.dims?.L) || Number(z.dims?.S) || 0;
                      const dW = Number(z.dims?.W) || Number(z.dims?.S) || 0;
                      const mw = z.mkWalls || {};
                      const sideDepth = Number(z.trussBackDepth) || engBackDepth;
                      const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                      const cfgLabel = config === "u_only" ? "U Truss" : config === "half_box" ? "Half Box" : "Full Box";

                      let zoneTop = 0;
                      let zoneRft = 0;
                      const parts = []; // per-zone wall lines

                      if (config === "full_box") {
                        const topSqft = dL * dW;
                        if (topSqft > 0 && fabricBangaliRanges.length > 0) {
                          for (const r of fabricBangaliRanges) {
                            if (topSqft <= r.upTo) { zoneTop = r.labour || 0; break; }
                          }
                        }
                        parts.push({ kind: "top", label: `Top ${dL}×${dW} = ${topSqft} sqft → ${zoneTop} ppl`, workers: zoneTop });
                        if (mw.back  && dW > 0) { parts.push({ kind: "rft", label: `Back RFT: ${dW}`,  rft: dW }); zoneRft += dW; }
                        if (mw.left  && dL > 0) { parts.push({ kind: "rft", label: `Left RFT: ${dL}`,  rft: dL }); zoneRft += dL; }
                        if (mw.right && dL > 0) { parts.push({ kind: "rft", label: `Right RFT: ${dL}`, rft: dL }); zoneRft += dL; }
                      } else if (config === "half_box") {
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back  && spanL > 0)     { parts.push({ kind: "rft", label: `Back RFT: ${spanL} (L-span)`,  rft: spanL }); zoneRft += spanL; }
                        if (mw.left  && sideDepth > 0) { parts.push({ kind: "rft", label: `Left RFT: ${sideDepth} (backDepth)`,  rft: sideDepth }); zoneRft += sideDepth; }
                        if (mw.right && sideDepth > 0) { parts.push({ kind: "rft", label: `Right RFT: ${sideDepth} (backDepth)`, rft: sideDepth }); zoneRft += sideDepth; }
                      } else if (config === "u_only") {
                        const spanL = cfg.spanFt || dL || dW;
                        if (mw.back && spanL > 0) { parts.push({ kind: "rft", label: `Back RFT: ${spanL} (L-span)`, rft: spanL }); zoneRft += spanL; }
                      }

                      // Skip zones with zero contribution (mkOn but no walls ticked)
                      if (zoneTop === 0 && zoneRft === 0) return;

                      const zoneRftLabour = zoneRft > 0 ? Math.ceil(zoneRft / fabricRftPerWorker) : 0;
                      const zoneTotal = zoneTop + zoneRftLabour;
                      grandTop += zoneTop;
                      grandRft += zoneRft;
                      grandTotal += zoneTotal;

                      items.push({
                        zoneHeader: `${zLabel} (${cfgLabel})`,
                        parts,
                        rftSum: zoneRft,
                        rftLabour: zoneRftLabour,
                        topLabour: zoneTop,
                        zoneTotal,
                        zoneSubLabel: zoneRft > 0
                          ? `Zone RFT: ${zoneRft} ÷ ${fabricRftPerWorker} → ${zoneRftLabour} ppl${zoneTop > 0 ? `   |   Top: ${zoneTop} ppl` : ""}`
                          : (zoneTop > 0 ? `Top: ${zoneTop} ppl` : ""),
                      });
                    });

                    const rangeLabel = `Per-zone: top sqft → range table | side RFT → ceil(zoneRft ÷ ${fabricRftPerWorker})`;
                    return {
                      kind: "range_lookup_per_zone",
                      items,
                      totalAmount: grandRft,
                      totalUnit: `RFT total across zones (each ceiled per-zone)`,
                      rangeLabel,
                      total: grandTotal,
                      topLabour: grandTop,
                      totalRft: grandRft,
                      formula: "Per-zone: top sqft → range table + ceil(zoneRft ÷ " + fabricRftPerWorker + "). Each zone calculated independently. (Multipliers TBD Phase 2.7)"
                    };
                  };
                  const traceTrussLabour = (fn) => {
                    const items = []; let pillars = 0;
                    // ── §23 Phase 2.5: zone-derived pillar count (Layer 1 truth) ──
                    const tInv = dealCheckData?.trussInv;
                    if (tInv) {
                      const zc = fn.zoneConfig || {};
                      const en = fn.enabledEls || {};
                      Object.keys(zc).forEach(zk => {
                        if (!en[zk] || !zc[zk]) return;
                        try {
                          const pv = calcZoneTrussPreview(zc[zk], tInv);
                          if (pv?.topology?.pillarCount) {
                            const zLabel = (zoneMeta?.[zk]?.label) || ((fn.customZones || []).find(cz => cz.id === zk)?.name) || zk;
                            const cfg = pv.config === "u_only" ? "U Truss" : pv.config === "half_box" ? "Half Box" : "Full Box";
                            items.push({ name: `${zLabel} (${cfg})`, sub: "(zone-derived)", qty: pv.topology.pillarCount });
                            pillars += pv.topology.pillarCount;
                          }
                        } catch {}
                      });
                    }
                    let total = 0, rangeLabel = "—";
                    if (pillars > 0 && trussLabourRanges.length > 0) {
                      for (const r of trussLabourRanges) {
                        if (pillars <= r.upTo) { total = r.labour || 0; rangeLabel = `up to ${r.upTo} pillars`; break; }
                      }
                      if (total === 0) { const last = trussLabourRanges[trussLabourRanges.length-1]; total = last?.labour || 0; rangeLabel = `${last?.upTo}+ pillars`; }
                    }
                    return { kind: "range_lookup", items, totalAmount: pillars, totalUnit: "pillars", rangeLabel, total, formula: "Σ pillar count from §23 Layer 1 topology (zone-derived) → range table lookup" };
                  };
                  const traceForType = (fn, type) => {
                    if (type === "Flowerists") return traceFlowerists(fn);
                    if (type === "Electricians") return traceElectricians(fn);
                    if (type === "Labours") return traceTier3Labours(fn);
                    if (type === "Fabric Bangali") return traceFabricBangali(fn);
                    if (type === "Truss Labour") return traceTrussLabour(fn);
                    const cfg = labourTiers[type];
                    if (cfg && cfg.tier === 2) return traceTier2(fn, type);
                    if (cfg && cfg.tier === 3) return traceTier3Labours(fn);
                    return { kind: "default", note: `${type} count is a fixed default (no derivation)`, total: calcPeopleDefault(fn, type) };
                  };
                  const toggleCalcOpen = (date, type) => {
                    setDcMpCalcOpen(prev => ({ ...prev, [`${date}|${type}`]: !prev[`${date}|${type}`] }));
                  };

                  // ── Booking timeline ──────────────────────────────────────
                  const fnDates = fns.map(f => f.fnDate).filter(Boolean).sort();
                  if (fnDates.length === 0) return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>No function dates set.</div>;
                  const addDays = (isoDate, n) => {
                    const d = new Date(isoDate + "T00:00:00Z");
                    d.setUTCDate(d.getUTCDate() + n);
                    return d.toISOString().slice(0,10);
                  };
                  const earliest = fnDates[0];
                  const latest = fnDates[fnDates.length-1];
                  const dayList = [];
                  if (dcMpIncludeMinusOne) dayList.push({ date: addDays(earliest, -1), phase: "minusOne", fns: [] });
                  // Iterate days from earliest to latest, marking fn days as 'event' and in-between days as 'gap'
                  let cur = earliest;
                  while (cur <= latest) {
                    const fnsOnDay = fns.filter(f => f.fnDate === cur);
                    if (fnsOnDay.length > 0) dayList.push({ date: cur, phase: "event", fns: fnsOnDay });
                    else dayList.push({ date: cur, phase: "gap", fns: [] });
                    cur = addDays(cur, 1);
                  }
                  if (dcMpIncludeDismantle) dayList.push({ date: addDays(latest, 1), phase: "dismantle", fns: [] });

                  // ── People count per fn × labour type ─────────────────────
                  // For each labour type present in dihariSchemes, compute people count for each fn.
                  const labourTypes = Object.keys(dihariSchemes);
                  const peopleByFn = {}; // { [labourType]: { [fnIdx]: count } }
                  labourTypes.forEach(type => {
                    peopleByFn[type] = {};
                    fns.forEach((fn, fi) => {
                      const fv = fixedVenueFor(_fvCfgAll, fn.fnVenue || "");
                      const computed = calcPeopleForType(freshFnMP(fn), type) || 0;
                      peopleByFn[type][fi] = fv ? Math.max(fixedCrewFloor(fv, type), computed) : computed;
                    });
                  });

                  // ── Cumulative MAX per day per type ───────────────────────
                  // Rule: people only scale UP. On each day, count = MAX(yesterday's count, today's ceremony need).
                  // Setup (-1 day): count = max of ALL upcoming events' need (full crew comes early).
                  // Gap day: count = previous day's count (carry forward).
                  // Dismantle: count = previous day's count.
                  // Event day: count = MAX(yesterday, max of fns on this day).
                  const countByDay = {}; // { [date]: { [type]: count } }
                  let runningMax = {};
                  labourTypes.forEach(t => { runningMax[t] = 0; });
                  dayList.forEach(d => {
                    if (d.phase === "minusOne") {
                      // Setup day: full crew per type = MAX of all event days' needs
                      labourTypes.forEach(t => {
                        let mx = 0;
                        fns.forEach((fn, fi) => { if ((peopleByFn[t][fi]||0) > mx) mx = peopleByFn[t][fi]; });
                        runningMax[t] = Math.max(runningMax[t], mx);
                      });
                    } else if (d.phase === "event") {
                      labourTypes.forEach(t => {
                        let todaysNeed = 0;
                        d.fns.forEach(fn => {
                          const fi = fns.indexOf(fn);
                          if ((peopleByFn[t][fi]||0) > todaysNeed) todaysNeed = peopleByFn[t][fi];
                        });
                        runningMax[t] = Math.max(runningMax[t], todaysNeed);
                      });
                    } else if (d.phase === "dismantle") {
                      // Dismantle day: apply dismantlingPct per type from settings
                      labourTypes.forEach(t => {
                        const pct = (labourTiers[t]||{}).dismantlingPct;
                        if (typeof pct === "number") {
                          runningMax[t] = pct > 0 ? Math.ceil(runningMax[t] * pct / 100) : 0;
                        }
                        // else: no dismantlingPct set → carry forward full crew (backward compat)
                      });
                    } // gap: carry runningMax forward unchanged
                    countByDay[d.date] = { ...runningMax };
                  });

                  // ── Resolve windows for a day × type (overrides → defaults → empty) ──
                  const getWindowsForDayType = (dateISO, type, phase) => {
                    const overrideKey = `${dateISO}|${type}`;
                    if (dcMpOverrides[overrideKey]) return dcMpOverrides[overrideKey];
                    return (defaultWindowsByPhase[type] || {})[phase] || [];
                  };
                  const setWindowsForDayType = (dateISO, type, windowIds) => {
                    setDcMpOverrides(prev => ({ ...prev, [`${dateISO}|${type}`]: windowIds }));
                  };
                  const toggleWindow = (dateISO, type, winId, phase) => {
                    const cur = getWindowsForDayType(dateISO, type, phase);
                    const next = cur.includes(winId) ? cur.filter(x=>x!==winId) : [...cur, winId];
                    setWindowsForDayType(dateISO, type, next);
                    // Turning a window OFF clears any per-shift count so it doesn't linger; ON leaves it to default.
                    if (cur.includes(winId)) setWinCount(dateISO, type, winId, null);
                  };
                  // Per-shift (per-dihari) crew count: the ops manager can keep e.g. 2 flowerists in shift 1 but
                  // only 1 in shift 2. Default = the day's computed crew count. Stored in dcMpWinCount.
                  const winCountFor = (dateISO, type, winId, defPpl) => { const v = dcMpWinCount?.[type]?.[dateISO]?.[winId]; return (v != null && v !== "") ? (Number(v) || 0) : defPpl; };
                  const setWinCount = (dateISO, type, winId, val) => setDcMpWinCount(prev => {
                    const n = { ...(prev || {}) };
                    const byType = { ...(n[type] || {}) };
                    const byDate = { ...(byType[dateISO] || {}) };
                    if (val == null) delete byDate[winId]; else byDate[winId] = Math.max(0, Number(val) || 0);
                    if (Object.keys(byDate).length) byType[dateISO] = byDate; else delete byType[dateISO];
                    if (Object.keys(byType).length) n[type] = byType; else delete n[type];
                    return n;
                  });

                  // ── Compute booking-total cost (per-shift crew aware) ─────────
                  let bookingTotalCost = 0, bookingTotalDihari = 0;
                  const dayCosts = {}; // { [date]: { total, byType: { [type]: { ppl, dihari, cost } } } }
                  dayList.forEach(d => {
                    const dayBreakdown = { total: 0, byType: {} };
                    labourTypes.forEach(t => {
                      const ppl = countByDay[d.date][t] || 0;
                      if (ppl <= 0) return;
                      const scheme = dihariSchemes[t] || { rate:0, windows:[] };
                      const wins = getWindowsForDayType(d.date, t, d.phase);
                      const dihari = wins.length;
                      const effRate = rateByType[t] || 0;
                      const slots = wins.reduce((s, id) => s + winCountFor(d.date, t, id, ppl), 0); // Σ per-shift crew
                      const cost = slots * effRate;
                      dayBreakdown.byType[t] = { ppl, dihari, cost, windowsTicked: wins };
                      dayBreakdown.total += cost;
                      bookingTotalDihari += slots;
                    });
                    dayCosts[d.date] = dayBreakdown;
                    bookingTotalCost += dayBreakdown.total;
                  });

                  // ── UI ─────────────────────────────────────────────────────
                  const fmtDateShort = (iso) => {
                    try {
                      const d = new Date(iso + "T00:00:00Z");
                      return d.toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short", timeZone:"UTC" });
                    } catch { return iso; }
                  };
                  const phaseEmoji = (p) => ({ minusOne:"⏮️", event:"🎉", gap:"⏸️", dismantle:"🧹" })[p] || "📅";
                  const phaseLabel = (p) => ({ minusOne:"-1 Day · Early Setup", event:"Function Day", gap:"In-between Day", dismantle:"Dismantle Day" })[p] || p;
                  const typeEmoji = (t) => ({
                    "Flowerists":"🌸", "Electricians":"⚡", "Labours":"🔨", "Carpenters":"🪚",
                    "Painters":"🎨", "Fabric Bangali":"🧵", "Truss Labour":"🏗️",
                    "Helpers":"🤝", "Supervisors":"👔", "Drivers":"🚛"
                  })[t] || "👷";

                  if (labourTypes.length === 0) {
                    return <div style={{padding:"50px 30px",textAlign:"center",color:textS,fontSize:11}}>
                      No labour types defined. Set them in IMS Settings → 💰 Dihari Timings.
                    </div>;
                  }

                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>
                      {/* Header — toggles + booking total */}
                      <div style={{padding:"14px 16px",borderRadius:10,background:"rgba(251,191,36,0.06)",border:`1px solid rgba(251,191,36,0.20)`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:10}}>
                          <div>
                            <div style={{fontSize:11,color:textS,letterSpacing:0.6,textTransform:"uppercase",fontWeight:700,marginBottom:4}}>👷 Manpower Forecast — Booking</div>
                            <div style={{fontSize:10,color:textS}}>{fns.length} ceremon{fns.length===1?"y":"ies"} · {dayList.length} day{dayList.length===1?"":"s"} · cumulative MAX rule applied</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:11,color:textS}}>Total cost</div>
                            <div style={{fontSize:22,fontWeight:800,color:"#FBBF24",fontVariantNumeric:"tabular-nums"}}>₹{Math.round(bookingTotalCost).toLocaleString("en-IN")}</div>
                            <div style={{fontSize:10,color:textS,fontVariantNumeric:"tabular-nums"}}>{bookingTotalDihari} dihari total</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#fff",cursor:"pointer"}}>
                            <input type="checkbox" checked={dcMpIncludeMinusOne} onChange={e=>setDcMpIncludeMinusOne(e.target.checked)} />
                            ⏮️ Include -1 day early setup
                          </label>
                          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#fff",cursor:"pointer"}}>
                            <input type="checkbox" checked={dcMpIncludeDismantle} onChange={e=>setDcMpIncludeDismantle(e.target.checked)} />
                            🧹 Include dismantle day
                          </label>
                        </div>
                      </div>

                      {/* Day rows */}
                      {dayList.map((d, di) => {
                        const breakdown = dayCosts[d.date] || { total:0, byType:{} };
                        const fnsOnDay = d.fns || [];
                        return (
                          <div key={di} style={{padding:"12px 14px",borderRadius:10,background:"rgba(56,189,248,0.04)",border:`1px solid ${border}`}}>
                            {/* Day header */}
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:12,flexWrap:"wrap",borderBottom:`1px solid ${border}33`,paddingBottom:8,marginBottom:10}}>
                              <div>
                                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{phaseEmoji(d.phase)} {fmtDateShort(d.date)} · <span style={{color:textS,fontWeight:500}}>{phaseLabel(d.phase)}</span></div>
                                {fnsOnDay.length > 0 && (
                                  <div style={{fontSize:10,color:textS,marginTop:2}}>
                                    {fnsOnDay.map((fn, fi) => `${fn.fnType||"?"}${fn.fnShift?` (${fn.fnShift})`:""}`).join(" · ")}
                                  </div>
                                )}
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:"#fff",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>
                                {breakdown.total > 0 ? `₹${Math.round(breakdown.total).toLocaleString("en-IN")}` : <span style={{color:textS,fontWeight:400,fontSize:11}}>—</span>}
                              </div>
                            </div>
                            {/* Labour type rows */}
                            <div style={{display:"flex",flexDirection:"column",gap:8}}>
                              {labourTypes.map(t => {
                                const ppl = countByDay[d.date][t] || 0;
                                if (ppl <= 0) return null;
                                const scheme = dihariSchemes[t] || { rate:0, windows:[] };
                                const wins = scheme.windows || [];
                                const ticked = getWindowsForDayType(d.date, t, d.phase);
                                const dihari = ticked.length;
                                const effRate = rateByType[t] || 0;
                                const src = rateSourceByType[t] || { kind:"house_default", count:0 };
                                const slots = ticked.reduce((s, id) => s + winCountFor(d.date, t, id, ppl), 0); // Σ per-shift crew
                                const uniform = ticked.every(id => winCountFor(d.date, t, id, ppl) === ppl);
                                const cost = slots * effRate;
                                return (
                                  <div key={t} style={{padding:"8px 10px",borderRadius:7,background:"rgba(148,163,184,0.04)",border:`1px solid ${border}55`}}>
                                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8,flexWrap:"wrap",marginBottom:6}}>
                                      <div style={{fontSize:11,color:"#fff",fontWeight:600}}>
                                        {typeEmoji(t)} {t}  <span style={{color:textS,fontWeight:400}}>· {ppl} ppl @ ₹{effRate}/dihari</span>
                                        {src.kind === "vendor_avg" ? (
                                          <span title={`Avg of: ${(src.vendors||[]).join(", ")}`} style={{marginLeft:6,fontSize:9,padding:"1px 6px",borderRadius:7,background:"rgba(16,185,129,0.15)",color:"#10B981",fontWeight:600}}>📊 avg of {src.count} vendor{src.count===1?"":"s"}</span>
                                        ) : (
                                          <span style={{marginLeft:6,fontSize:9,padding:"1px 6px",borderRadius:7,background:"rgba(148,163,184,0.10)",color:textS,fontWeight:500}}>🏠 house rate</span>
                                        )}
                                      </div>
                                      <div style={{fontSize:11,color:cost>0?"#10B981":textS,fontWeight:700,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>
                                        {cost > 0 ? (uniform ? `${dihari} dihari × ${ppl} = ₹${Math.round(cost).toLocaleString("en-IN")}` : `${slots} crew-shifts = ₹${Math.round(cost).toLocaleString("en-IN")}`) : "0 dihari"}
                                      </div>
                                    </div>
                                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                                      {wins.map(w => {
                                        const on = ticked.includes(w.id);
                                        if (!on) return (
                                          <button key={w.id} onClick={()=>toggleWindow(d.date, t, w.id, d.phase)}
                                            style={{ fontSize:10,padding:"3px 8px",borderRadius:11,cursor:"pointer",border:`1px solid ${border}`,background:"transparent",color:textS,fontWeight:400 }}>
                                            {w.label}
                                          </button>
                                        );
                                        // ON window → label toggle + per-shift crew stepper (− N +). Default = day count.
                                        const wc = winCountFor(d.date, t, w.id, ppl);
                                        return (
                                          <span key={w.id} style={{display:"inline-flex",alignItems:"center",border:`1px solid #10B981`,borderRadius:11,overflow:"hidden",background:"rgba(16,185,129,0.15)"}}>
                                            <button onClick={()=>toggleWindow(d.date, t, w.id, d.phase)} title="Remove this shift" style={{fontSize:10,padding:"3px 6px 3px 9px",cursor:"pointer",border:"none",background:"transparent",color:"#10B981",fontWeight:600}}>✓ {w.label}</button>
                                            <button onClick={()=>setWinCount(d.date, t, w.id, Math.max(0, wc-1))} title="One fewer this shift" style={{fontSize:11,width:18,cursor:"pointer",border:"none",borderLeft:`1px solid rgba(16,185,129,0.4)`,background:"rgba(16,185,129,0.10)",color:"#10B981",fontWeight:700}}>−</button>
                                            <span title="Crew in this shift" style={{fontSize:10,minWidth:16,textAlign:"center",color:"#fff",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{wc}</span>
                                            <button onClick={()=>setWinCount(d.date, t, w.id, wc+1)} title="One more this shift" style={{fontSize:11,width:18,cursor:"pointer",border:"none",borderRight:`1px solid rgba(16,185,129,0.4)`,borderLeft:`1px solid rgba(16,185,129,0.4)`,background:"rgba(16,185,129,0.10)",color:"#10B981",fontWeight:700}}>+</button>
                                          </span>
                                        );
                                      })}
                                      {wins.length === 0 && <span style={{fontSize:10,color:textS,fontStyle:"italic"}}>No windows defined for this type</span>}
                                      {/* "how" toggle — opens calculation breakdown */}
                                      <button onClick={()=>toggleCalcOpen(d.date, t)}
                                        style={{
                                          marginLeft:"auto",fontSize:10,padding:"2px 8px",borderRadius:7,cursor:"pointer",
                                          border:dcMpCalcOpen[`${d.date}|${t}`]?`1px solid #A78BFA`:`1px solid rgba(167,139,250,0.40)`,
                                          background:dcMpCalcOpen[`${d.date}|${t}`]?"rgba(124,58,237,0.20)":"rgba(124,58,237,0.08)",
                                          color:"#A78BFA",fontWeight:500
                                        }}>
                                        {dcMpCalcOpen[`${d.date}|${t}`] ? "× hide" : "🧮 how"}
                                      </button>
                                    </div>
                                    {/* Calculation breakdown panel — visible when toggled on */}
                                    {dcMpCalcOpen[`${d.date}|${t}`] && (() => {
                                      // For event days: trace each fn on this day. For other phases: explain carry-over.
                                      if (d.phase === "event" && d.fns.length > 0) {
                                        return (
                                          <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
                                            {d.fns.map((cfn, cfi) => {
                                              const trace = traceForType(cfn, t);
                                              return (
                                                <div key={cfi} style={{padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7}}>
                                                  <div style={{fontSize:9,color:"#A78BFA",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:8}}>
                                                    How {trace.total||0} {t.toLowerCase()} derived{d.fns.length > 1 ? ` · ${cfn.fnType || "fn "+(cfi+1)}` : ""}
                                                  </div>
                                                  {/* Element table (Flowerists/Electricians) */}
                                                  {trace.kind === "element_table" && (
                                                    trace.items.length === 0 ? (
                                                      <div style={{fontSize:10,color:textS,fontStyle:"italic"}}>No matching elements in this function.</div>
                                                    ) : (
                                                      <>
                                                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                                                          <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                            {trace.header.map((h,hi) => (
                                                              <th key={hi} style={{textAlign:hi===0?"left":"right",padding:"4px 4px 6px",color:textS,fontWeight:500}}>{h}</th>
                                                            ))}
                                                          </tr></thead>
                                                          <tbody>
                                                            {trace.items.map((it, ii) => (
                                                              <tr key={ii}>
                                                                <td style={{padding:"5px 4px",color:"#fff"}}>{it.name}{it.size?<span style={{color:textS,marginLeft:4,textTransform:"capitalize"}}>({it.size})</span>:null}</td>
                                                                <td style={{textAlign:"right",padding:"5px 4px",color:"#fff",fontVariantNumeric:"tabular-nums"}}>{it.qty}</td>
                                                                <td style={{textAlign:"right",padding:"5px 4px",color:textS,fontVariantNumeric:"tabular-nums"}}>{it.missing?"⚠ "+it.missing:"÷ "+it.productivity}</td>
                                                                <td style={{textAlign:"right",padding:"5px 4px",color:it.missing?"#F59E0B":"#fff",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{it.missing?"—":it.need}</td>
                                                              </tr>
                                                            ))}
                                                            <tr style={{borderTop:`1px solid ${border}`}}>
                                                              <td colSpan={3} style={{textAlign:"right",padding:"5px 4px",color:textS}}>Sum:</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:"#FBBF24",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{trace.total}</td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                      </>
                                                    )
                                                  )}
                                                  {/* Sub-cat table (Carpenters/Painters Tier 2) */}
                                                  {trace.kind === "subcat_table" && (
                                                    trace.rows.length === 0 ? (
                                                      <div style={{fontSize:10,color:textS,fontStyle:"italic"}}>No matching sub-cats; using minimum ({trace.minimum}).</div>
                                                    ) : (
                                                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                                                        <thead><tr style={{borderBottom:`1px solid ${border}`}}>
                                                          {trace.header.map((h,hi) => (
                                                            <th key={hi} style={{textAlign:hi===0?"left":"right",padding:"4px 4px 6px",color:textS,fontWeight:500}}>{h}</th>
                                                          ))}
                                                        </tr></thead>
                                                        <tbody>
                                                          {trace.rows.map((r, ri) => (
                                                            <tr key={ri}>
                                                              <td style={{padding:"5px 4px",color:"#fff"}}>{r.sub}</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:"#fff",fontVariantNumeric:"tabular-nums"}}>{r.count}</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:textS,fontVariantNumeric:"tabular-nums"}}>÷ {r.batch}</td>
                                                              <td style={{textAlign:"right",padding:"5px 4px",color:"#fff",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{r.need}</td>
                                                            </tr>
                                                          ))}
                                                          <tr style={{borderTop:`1px solid ${border}`}}>
                                                            <td colSpan={3} style={{textAlign:"right",padding:"5px 4px",color:textS}}>Σ {trace.frac} → ⌈⌉ {trace.sum} · max(min {trace.minimum}):</td>
                                                            <td style={{textAlign:"right",padding:"5px 4px",color:"#FBBF24",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>{trace.total}</td>
                                                          </tr>
                                                        </tbody>
                                                      </table>
                                                    )
                                                  )}
                                                  {/* Formula chain (Tier 3 Labours) */}
                                                  {trace.kind === "formula_chain" && (
                                                    <div style={{display:"flex",flexDirection:"column",gap:5,fontSize:11}}>
                                                      {trace.steps.map((s, si) => (
                                                        <div key={si} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                                                          <span style={{color:textS}}>{s.label}</span>
                                                          <span style={{color:"#fff",fontVariantNumeric:"tabular-nums",fontWeight:si===trace.steps.length-1?500:400}}>{s.value}</span>
                                                        </div>
                                                      ))}
                                                      <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${border}`,fontWeight:600}}>
                                                        <span style={{color:"#FBBF24"}}>Total</span>
                                                        <span style={{color:"#FBBF24",fontVariantNumeric:"tabular-nums"}}>{trace.total}</span>
                                                      </div>
                                                    </div>
                                                  )}
                                                  {/* Range lookup (Fabric Bangali / Truss Labour) */}
                                                  {trace.kind === "range_lookup" && (
                                                    trace.items.length === 0 ? (
                                                      <div style={{fontSize:10,color:textS,fontStyle:"italic"}}>No {trace.totalUnit==="sqft"?"fabric/wall masking":"pillar/truss"} elements in this function.</div>
                                                    ) : (
                                                      <div style={{display:"flex",flexDirection:"column",gap:5,fontSize:11}}>
                                                        {trace.items.map((it, ii) => (
                                                          <div key={ii} style={{display:"flex",justifyContent:"space-between"}}>
                                                            <span style={{color:textS}}>{it.name}{it.L?` (${it.L}×${it.W} ft)`:""}</span>
                                                            <span style={{color:"#fff",fontVariantNumeric:"tabular-nums"}}>{it.sqft||it.qty} {trace.totalUnit==="sqft"?"sqft":""}</span>
                                                          </div>
                                                        ))}
                                                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:5,borderTop:`1px solid ${border}`}}>
                                                          <span style={{color:textS}}>Total {trace.totalUnit}</span>
                                                          <span style={{color:"#fff",fontVariantNumeric:"tabular-nums",fontWeight:500}}>{trace.totalAmount} {trace.totalUnit}</span>
                                                        </div>
                                                        <div style={{display:"flex",justifyContent:"space-between"}}>
                                                          <span style={{color:textS}}>Range lookup · "{trace.rangeLabel}"</span>
                                                          <span style={{color:"#fff",fontVariantNumeric:"tabular-nums"}}>→ {trace.total} ppl</span>
                                                        </div>
                                                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${border}`,fontWeight:600}}>
                                                          <span style={{color:"#FBBF24"}}>Total</span>
                                                          <span style={{color:"#FBBF24",fontVariantNumeric:"tabular-nums"}}>{trace.total}</span>
                                                        </div>
                                                      </div>
                                                    )
                                                  )}
                                                  {/* Per-zone Fabric Bangali (§23 Phase 2.8) — each zone shows its own RFT ceil */}
                                                  {trace.kind === "range_lookup_per_zone" && (
                                                    trace.items.length === 0 ? (
                                                      <div style={{fontSize:10,color:textS,fontStyle:"italic"}}>No truss masking found in this function (no zone with mkOn + walls selected).</div>
                                                    ) : (
                                                      <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:11}}>
                                                        {trace.items.map((zone, zi) => (
                                                          <div key={zi} style={{padding:"6px 8px",background:"rgba(255,255,255,0.04)",borderRadius:6,border:`1px solid ${border}`}}>
                                                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                                                              <span style={{color:"#fff",fontWeight:600}}>{zone.zoneHeader}</span>
                                                              <span style={{color:"#FBBF24",fontVariantNumeric:"tabular-nums",fontWeight:600}}>→ {zone.zoneTotal} ppl</span>
                                                            </div>
                                                            <div style={{display:"flex",flexDirection:"column",gap:2,paddingLeft:8}}>
                                                              {zone.parts.map((p, pi) => (
                                                                <div key={pi} style={{fontSize:10,color:textS}}>• {p.label}</div>
                                                              ))}
                                                            </div>
                                                            {zone.zoneSubLabel && (
                                                              <div style={{marginTop:4,paddingTop:4,borderTop:`1px dashed ${border}`,fontSize:10,color:textS,fontStyle:"italic"}}>{zone.zoneSubLabel}</div>
                                                            )}
                                                          </div>
                                                        ))}
                                                        <div style={{display:"flex",justifyContent:"space-between",paddingTop:6,borderTop:`1px solid ${border}`,fontWeight:600}}>
                                                          <span style={{color:"#FBBF24"}}>Grand Total</span>
                                                          <span style={{color:"#FBBF24",fontVariantNumeric:"tabular-nums"}}>{trace.total} ppl</span>
                                                        </div>
                                                      </div>
                                                    )
                                                  )}
                                                  {/* Default (Supervisors etc.) */}
                                                  {trace.kind === "default" && (
                                                    <div style={{fontSize:11,color:textS,fontStyle:"italic"}}>{trace.note}</div>
                                                  )}
                                                  {trace.formula && (
                                                    <div style={{marginTop:8,paddingTop:6,borderTop:`1px dashed ${border}`,fontSize:10,color:textS,fontStyle:"italic"}}>{trace.formula}</div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      }
                                      // Non-event day (minusOne / gap / dismantle) — explain carry-over
                                      const ppl = countByDay[d.date][t] || 0;
                                      const dismPct = (labourTiers[t]||{}).dismantlingPct;
                                      const phaseNote = d.phase === "minusOne"
                                        ? "Setup day: hired in advance, count = MAX across upcoming ceremonies."
                                        : d.phase === "gap"
                                          ? "Gap day: count carried forward from previous day (no new hires)."
                                          : typeof dismPct === "number"
                                            ? `Dismantle day: ${dismPct}% of event-day crew. Event peak × ${dismPct}% = ${ppl} ${t.toLowerCase()}.`
                                            : "Dismantle day: count carried forward from final event day (no dismantling % set in Settings → Workforce).";
                                      return (
                                        <div style={{marginTop:10,padding:"10px 12px",background:"rgba(124,58,237,0.06)",border:"1px dashed rgba(167,139,250,0.35)",borderRadius:7,fontSize:11,color:textS}}>
                                          <div style={{fontSize:9,color:"#A78BFA",fontWeight:600,letterSpacing:0.4,textTransform:"uppercase",marginBottom:6}}>How {ppl} {t.toLowerCase()} on this day</div>
                                          <div style={{color:"#fff",fontStyle:"italic"}}>{phaseNote}</div>
                                          <div style={{marginTop:6}}>See trajectory footer for cumulative MAX progression.</div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                              {Object.keys(breakdown.byType).length === 0 && (
                                <div style={{fontSize:11,color:textS,fontStyle:"italic",padding:"6px 0"}}>No manpower needed this day. (Untick all windows to model labour going home.)</div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Hire trajectory footer */}
                      <div style={{padding:"12px 14px",borderRadius:10,background:"rgba(148,163,184,0.04)",border:`1px dashed ${border}`}}>
                        <div style={{fontSize:11,fontWeight:700,color:textS,letterSpacing:0.6,textTransform:"uppercase",marginBottom:8}}>📈 Hire Trajectory (cumulative MAX)</div>
                        <div style={{fontSize:10,color:textS,marginBottom:8,fontStyle:"italic"}}>People hired per type across booking days. Labour only scales UP — once hired, they stay.</div>
                        <div style={{display:"flex",flexDirection:"column",gap:4}}>
                          {labourTypes.map(t => {
                            const seq = dayList.map(d => countByDay[d.date][t] || 0);
                            const peak = Math.max(...seq, 0);
                            if (peak === 0) return null;
                            return (
                              <div key={t} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                                <span style={{minWidth:140,color:"#fff",fontWeight:600}}>{typeEmoji(t)} {t}</span>
                                <span style={{color:textS,fontVariantNumeric:"tabular-nums",fontFamily:"monospace"}}>{seq.join(" → ")}</span>
                                <span style={{color:"#FBBF24",fontVariantNumeric:"tabular-nums",fontWeight:700}}>peak {peak}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
  })();
}

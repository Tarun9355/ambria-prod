// Event taxonomy + zone definitions (faithful to the reference Studio app).
// VERBATIM copies of the module-scope constants/helpers — only `export` added.
//
// NOTE on requested names that do not exist as module-scope in the reference:
//   - zoneKeys / zoneLabelsD : component-scope useMemo values (derive from zoneMeta
//     React state) — NOT pure, so cannot be extracted. The pure module-scope
//     analogues are ZONE_LABELS + EL_KEYS + ZONE_META + ZONE_PRESETS (included below).
//   - ZONE_DEFAULTS / SHIFT_LABELS : no such module-scope constant exists in the
//     reference. The shift constants that DO exist (CLIENT_SHIFTS_DD / SHIFT_LETTER)
//     are included verbatim below.

// ── Client shift dropdown (Commit 3 — pill display) ──
export const CLIENT_SHIFTS_DD = ["Morning","Lunch","Sundowner","Night"];
export const SHIFT_LETTER = { Morning: "M", Lunch: "L", Sundowner: "S", Night: "N" }; // Commit 3 — pill display

export const FUNCTIONS=["Wedding","Reception","Sangeet","Cocktail","Haldi","Mehendi","Engagement","Anniversary"];
// Commit 3 taxonomy — length-safe fallback. Returns fallback when taxonomy list is missing OR empty array.
// Fixes the silent-bug where taxOr(taxonomy.eventType, FUNCTIONS) gives [] instead of FUNCTIONS when admin clears taxonomy.
export const taxOr = (arr, fb) => (Array.isArray(arr) && arr.length > 0) ? arr : fb;
export const MOODS=[
  {id:"royal",label:"Royal & Grand",emoji:"👑",colors:["#8B0000","#FFD700","#4A0E2B"]},
  {id:"modern",label:"Modern Minimal",emoji:"◻️",colors:["#1a1a2e","#e0e0e0","#fff"]},
  {id:"boho",label:"Boho Rustic",emoji:"🌿",colors:["#8B7355","#D4A574","#2D5016"]},
  {id:"traditional",label:"Traditional",emoji:"🪔",colors:["#B8860B","#DC143C","#FF8C00"]},
  {id:"fairytale",label:"Fairy Tale",emoji:"✨",colors:["#FFB6C1","#E6E6FA","#F0F8FF"]},
  {id:"luxe",label:"Luxe Opulent",emoji:"💎",colors:["#2C1810","#C9A96E","#1a1a2e"]},
  {id:"garden",label:"Garden Natural",emoji:"🌺",colors:["#228B22","#FFE4E1","#F5F5DC"]},
  {id:"minimalist",label:"Clean & White",emoji:"🤍",colors:["#fff","#f5f5f0","#d4d4d4"]},
];
export const PALETTES=[
  {id:"pastel",label:"Pastels",bg:"linear-gradient(135deg,#FFB6C1,#E6E6FA,#B0E0E6)"},
  {id:"red",label:"Royal Red",bg:"linear-gradient(135deg,#8B0000,#DC143C,#FF6347)"},
  {id:"gold",label:"Gold & Ivory",bg:"linear-gradient(135deg,#B8860B,#FFD700,#FFFFF0)"},
  {id:"white",label:"All White",bg:"linear-gradient(135deg,#FFFFF0,#FFF5EE,#F0F0F0)"},
  {id:"green",label:"Sage & Green",bg:"linear-gradient(135deg,#2E8B57,#98FB98,#F0FFF0)"},
  {id:"jewel",label:"Jewel Tones",bg:"linear-gradient(135deg,#4B0082,#006400,#8B0000)"},
  {id:"earth",label:"Earth Tones",bg:"linear-gradient(135deg,#8B7355,#D2B48C,#F5DEB3)"},
  {id:"blush",label:"Blush & Mauve",bg:"linear-gradient(135deg,#DDA0DD,#FFB6C1,#FFF0F5)"},
];
// ═══ MASTER ITEM CATALOG — single source of truth for all pricing ═══
// ═══ ZONE LABELS (replaces old ELEMENTS/ITEM_CATALOG/ZONE_ITEMS) ═══
export const ZONE_LABELS={
  stage:{label:"Stage",icon:"🎭"},
  entry:{label:"Entry & Passage",icon:"🚪"},
  lounge:{label:"Lounge",icon:"🛋️"},
  bar:{label:"Bar / Counter",icon:"🍸"},
  photobooth:{label:"Photo Op / Booth",icon:"📸"},
  vedi:{label:"Vedi / Mandap",icon:"🔥"},
  lighting:{label:"Lighting",icon:"💡"},
  ceiling:{label:"Ceiling",icon:"☁️"},
  tableDecor:{label:"Centre Pieces / Table Decor",icon:"🍽️"},
};
export const EL_KEYS=Object.keys(ZONE_LABELS);
export const TIERS=["simple","enhanced","premium"];
export const CATEGORIES=["Silver","Gold","Platinum"];
export const SPACES=["Indoor","Outdoor","Semi-Outdoor"];

// ═══ TIER → CATEGORY MAPPING ═══
export const TIER_TO_CAT = { simple: "Silver", enhanced: "Gold", premium: "Platinum" };

// ══ ZONE PRICING ENGINE (from IMS Pricing Spec March 27 discussion) ══
export const ZONE_META = {
  stage:     {label:"Stage",        dimFields:["L","W","H"], defaultTruss:"box",     hasPlatform:true,  hasCarpet:true,  hasMasking:true},
  entry:     {label:"Entry & Passage", dimFields:["L","W","H"], defaultTruss:"singleU", hasPlatform:false, hasCarpet:true,  hasMasking:true},
  lounge:    {label:"Lounge",       dimFields:["L","W","H"], defaultTruss:"box",     hasPlatform:true,  hasCarpet:true,  hasMasking:true},
  bar:       {label:"Bar / Counter",dimFields:["L","W","H"], defaultTruss:null,      hasPlatform:true,  hasCarpet:true,  hasMasking:false},
  vedi:      {label:"Vedi / Mandap",dimFields:["L","W","H"], defaultTruss:"box",     hasPlatform:true,  hasCarpet:true,  hasMasking:true},
  photobooth:{label:"Photo Op",     dimFields:["L","W","H"], defaultTruss:"singleU", hasPlatform:false, hasCarpet:false, hasMasking:true},
  tableDecor: {label:"Table Decor",   dimFields:[],            defaultTruss:null,      hasPlatform:false, hasCarpet:false, hasMasking:false},
};
export const BASE_RATES={truss:{box:50,singleU:30},masking:{fabric:20,acrylic:100,flex:45,vinyl:90},platform:{"4in":30,"1ft":45},arch:{"2d":60,"3d":100},pillar:2000,glass:{"2d":120,"3d":180}};
export const MASK_OPTS=[{id:"fabric",l:"Fabric",r:20},{id:"acrylic",l:"Acrylic",r:100},{id:"flex",l:"Flex",r:45},{id:"vinyl",l:"Vinyl",r:90}];
export const PLAT_OPTS=[{id:"4in",l:"4 inch",r:30},{id:"1ft",l:"1ft–3ft",r:45}];
export const ARCH_OPTS=[{id:"2d",l:"2D (Flat)",r:60},{id:"3d",l:"3D (Built-out)",r:100}];
export const GLASS_OPTS=[{id:"2d",l:"2D (Flat)",r:120},{id:"3d",l:"3D (Built-out)",r:180}];

// Truss and masking rates used to be the fixed numbers in BASE_RATES above. They're now editable
// live from IMS Admin → Settings → 🏗️ Truss & Masking Rates — unlike Print Materials (a free-form
// list), truss shape/material and masking material are a FIXED small set tied to the geometry/
// pricing formulas elsewhere (box vs single-U truss math, per-wall masking area math), so the
// settings arrays are keyed by stable fields (not a free-form id) and rows can't be added/removed,
// only their rate edited. `settings.trussRates`/`settings.maskingRates` missing or not yet
// customized falls back to these same defaults, so nothing changes price until an admin edits one.
export const TRUSS_SHAPES=[{key:"box",label:"Box Truss"},{key:"singleU",label:"Single U Truss"}];
export const TRUSS_MATERIALS=[{key:"pole",label:"Pole"},{key:"aluminium",label:"Aluminium"},{key:"iron",label:"Iron"}];
export const DRAPE_DENSITIES=[{key:"minimum",label:"Minimum"},{key:"moderate",label:"Moderate"},{key:"dense",label:"Dense"}];
// One rate row per (shape × material × density) — 9 per shape, 18 total. `ceilingRatePerSqft` is
// the portion of `ratePerSqft` attributable to the ceiling drape specifically — when a zone opts to
// do its ceiling via a printed panel instead (see `ceilingViaPrint` on a truss row), that portion is
// subtracted from the truss rate rather than charging for fabric drape AND a printed ceiling both.
// All 18 rows seed at the shape's old flat rate with ceilingRatePerSqft: 0, so pricing is identical
// to before this model existed until an admin actually customizes a specific cell.
export const DEFAULT_TRUSS_RATES = TRUSS_SHAPES.flatMap((shape) => TRUSS_MATERIALS.flatMap((material) => DRAPE_DENSITIES.map((density) => ({
  shape: shape.key, material: material.key, density: density.key,
  ratePerSqft: shape.key === "box" ? 50 : 30, ceilingRatePerSqft: 0,
}))));
export const DEFAULT_MASKING_RATES=[{key:"fabric",name:"Fabric",ratePerSqft:20},{key:"acrylic",name:"Acrylic",ratePerSqft:100},{key:"flex",name:"Flex",ratePerSqft:45},{key:"vinyl",name:"Vinyl",ratePerSqft:90}];
// `material`/`density` default to "pole"/"moderate" when a row hasn't set them yet (e.g. zones
// saved before this model existed) — safe because every material/density starts at the same
// default rate, so an unset value never silently changes an existing zone's price.
export function trussRateFor(shape, material, density, trussRates) {
  const list = (Array.isArray(trussRates) && trussRates.length) ? trussRates : DEFAULT_TRUSS_RATES;
  const mat = material || "pole", den = density || "moderate";
  const row = list.find((r) => r.shape === shape && r.material === mat && r.density === den)
    || DEFAULT_TRUSS_RATES.find((r) => r.shape === shape && r.material === mat && r.density === den);
  return { rate: Number(row?.ratePerSqft) || 0, ceilingRate: Number(row?.ceilingRatePerSqft) || 0 };
}
export function maskingRateFor(key, maskingRates) {
  const list = (Array.isArray(maskingRates) && maskingRates.length) ? maskingRates : DEFAULT_MASKING_RATES;
  const row = list.find((r) => r.key === key) || DEFAULT_MASKING_RATES.find((r) => r.key === key);
  return Number(row?.ratePerSqft) || 0;
}

// Sentinel `cpT` value meaning "salesperson explicitly turned carpet off" — any OTHER falsy value
// (null/undefined, from every zone-creation path that doesn't set cpT at all) means "not decided
// yet", which prices as Carpet Old by default rather than as no carpet — carpet used to be priced
// unconditionally whenever a zone had a floor footprint, so leaving it untouched must keep pricing,
// not silently drop to ₹0.
export const CARPET_OFF = "__off__";

// Carpet used to be a fixed Old/New rate baked in here. It's now priced live from IMS Admin →
// Settings → 🖨️ Print Materials — `cpT` on a zone holds a printMaterials row id, not an enum, so
// editing a material's rate there (or adding new floor-covering options) updates every zone
// instantly instead of requiring a code change. `{rate, label}` together so pricing and display
// (StudioApp's structItems line, StudioSummary's breakdown) read off the same lookup.
export function carpetPricingFor(cpT, printMaterials) {
  if (cpT === CARPET_OFF) return { rate: 0, label: "" };
  const list = printMaterials || [];
  const effective = cpT || defaultCarpetMatId(list);
  if (!effective) return { rate: 0, label: "" };
  let mat = list.find((m) => m.id === effective);
  if (!mat && (effective === "old" || effective === "new")) {
    // Zones saved before this switch stored cpT as the literal "old"/"new" enum — map by name once.
    const want = effective === "old" ? "carpet old" : "carpet new";
    mat = list.find((m) => String(m.name || "").trim().toLowerCase() === want);
  }
  if (mat) return { rate: Number(mat.ratePerSqft) || 0, label: mat.name };
  const fallbackRate = effective === "old" ? 7 : effective === "new" ? 15 : 0;
  return { rate: fallbackRate, label: effective === "old" ? "Old" : effective === "new" ? "New" : effective };
}
// Whatever a newly-added platform's carpet should default to — "Carpet Old" by name if that
// material exists, else any material with "carpet" in its name, else none (no default available).
export function defaultCarpetMatId(printMaterials) {
  const list = printMaterials || [];
  const exact = list.find((m) => String(m.name || "").trim().toLowerCase() === "carpet old");
  if (exact) return exact.id;
  const anyCarpet = list.find((m) => String(m.name || "").toLowerCase().includes("carpet"));
  return anyCarpet ? anyCarpet.id : null;
}
export const ZONE_PRESETS={
  stage:  {small:{L:16,W:10,H:10,tr:"box",mk:"fabric",ms:1,pl:"4in",cp:"new"},medium:{L:24,W:15,H:12,tr:"box",mk:"fabric",ms:1,pl:"1ft",cp:"new",archT:"2d",archQty:2,archW:6,archH:8,pillarQty:4}},
  entry:  {small:{L:20,W:8,H:10,tr:"singleU",mk:"fabric",ms:1,cp:"old"},medium:{L:40,W:12,H:14,tr:"singleU",mk:"fabric",ms:1,cp:"new",archT:"3d",archQty:1,archW:10,archH:12,pillarQty:8}},
  lounge: {small:{L:16,W:10,H:10,tr:"box",mk:"fabric",ms:1,pl:"4in",cp:"new"},medium:{L:25,W:15,H:12,tr:"box",mk:"fabric",ms:1,pl:"1ft",cp:"new",archT:"2d",archQty:1,archW:8,archH:10}},
  bar:    {small:{L:8,W:4,H:0,pl:"4in",cp:"new"},medium:{L:12,W:5,H:0,pl:"4in",cp:"new"}},
  vedi:   {small:{L:10,W:10,H:10,tr:"box",mk:"fabric",ms:1,pl:"4in",cp:"new"},medium:{L:14,W:14,H:12,tr:"box",mk:"fabric",ms:1,pl:"1ft",cp:"new",archT:"3d",archQty:1,archW:12,archH:10,pillarQty:4}},
  photobooth:{small:{L:0,W:8,H:8,tr:"singleU",mk:"fabric",ms:1},medium:{L:0,W:12,H:10,tr:"singleU",mk:"flex",ms:1,archT:"2d",archQty:1,archW:10,archH:8}},
  tableDecor:{small:{},medium:{}},
};

export const DEFAULT_TAX={
  eventType:["Wedding","Reception","Sangeet","Mehendi","Haldi","Engagement","Cocktail","Ring Ceremony","Anniversary","Birthday","Corporate"],
  venueType:["Indoor","Outdoor","Semi-Outdoor"],
  areasElements:["Stage","Entry Passage","Centre Lounge","Side Lounge","Vedi","Centre Pieces","Open Lounges","Photobooth","Installations","Props"],
  colorPalette:["White & Green","Red & Gold","Pastels","Blue & White","Pink & Gold","Multi-color","Burgundy & Gold","Yellow & Orange","white & black","Navy Blue & silver","All ivory"],
  tier:["Silver","Gold","Platinum"],
  categoryTier:["Simple","Enhanced"],
  designStyle:["Traditional","Contemporary","Minimalist","Royal/Grand","Rustic","Floral-heavy","Vintage","Tropical","Fusion","Boho","Garden Inspired"],
  timeSetting:["Day","Night","Twilight"]
};
export const TAX_LABELS={eventType:"Event type",venueType:"Venue type",areasElements:"Areas & elements",colorPalette:"Color palette",tier:"Tier",categoryTier:"Category tier (legacy)",designStyle:"Design style",timeSetting:"Time / setting"};

// A library photo counts as tagged / "Needs review" (vs truly Untagged) ONLY when it actually
// carries real tags or detected elements. We deliberately do NOT key off the `_aiTagged` stamp:
// the bulk tagger stamps it on every image it *attempts*, including failures/empties (e.g. when
// API credits run out) — so the stamp says "tried", not "tagged". The single `areasElements` zone
// that FOLDER IMPORT seeds (from the subfolder name) also doesn't count on its own. Result:
// empty/failed photos correctly read as Untagged and get re-tagged, while genuinely-tagged photos
// (even ones tagged before the stamp existed, or manually) are recognised and never re-tagged.
export const libPhotoIsTagged = (img) =>
  (img?.elements || []).length > 0
  || Object.entries(img?.tags || {}).some(([k, v]) => k !== "areasElements" && Array.isArray(v) && v.length > 0);
export const TAX_KEYS=Object.keys(DEFAULT_TAX);
export const DEFAULT_TAX_KEYS=new Set(Object.keys(DEFAULT_TAX));
export const TIER_MAP_TPL_TO_LIB={Silver:"Simple",Gold:"Enhanced"};
export const TIER_MAP_LIB_TO_TPL={Simple:"Silver",Enhanced:"Gold"};
// Build-page zone key → photo-tag area name(s). Arrays so each build zone can match any of
// its synonym chips in the live taxonomy (e.g. a Lounge card matches Centre/Side/Open Lounges).
// A photo counts as "in this zone" if its areasElements include ANY of these names.
export const ZONE_TYPE_TO_AREA={
  stage:["Stage","Entertainment Stage"],
  entry:["Entry Passage","Entry & Passage"],
  lounge:["Lounge","Centre Lounge","Side Lounge","Open Lounges"],
  bar:["Bar / Counter"],
  vedi:["Vedi"],
  photobooth:["Photobooth"],
  lighting:["Lighting"],
  ceiling:["Ceiling","Installations"],
  tableDecor:["Table Decor","Centre Pieces"],
};

// ═══ HELPERS ═══
export const getCat=t=>{if(t>=600000)return{label:"Platinum",bg:"#EDE9FE",color:"#7C3AED"};if(t>=350000)return{label:"Gold",bg:"#FFFBEB",color:"#D97706"};return{label:"Silver",bg:"#ECFDF5",color:"#059669"}};
export const autoGrad=m=>({"royal":"linear-gradient(135deg,#4A0E2B,#8B0000,#FFD700)","modern":"linear-gradient(135deg,#2C3E50,#E8E8E0,#BDC3C7)","boho":"linear-gradient(135deg,#8B7355,#D4A574,#2D5016)","traditional":"linear-gradient(135deg,#B8860B,#DC143C,#FFD700)","fairytale":"linear-gradient(135deg,#FFB6C1,#E6E6FA,#87CEEB)","luxe":"linear-gradient(135deg,#1a1a2e,#4B0082,#C9A96E)","garden":"linear-gradient(135deg,#FFD700,#FFA500,#228B22)","minimalist":"linear-gradient(135deg,#F5F5F0,#E8E8E0,#D4D4C8)"}[m]||"linear-gradient(135deg,#B8860B,#DC143C,#FFD700)");
export const matchVisual=(ek,tier,moods)=>{const mc={royal:{simple:["#5C1A1A","#8B4513"],enhanced:["#6B0F2E","#B8860B"],premium:["#4A0E2B","#FFD700","#8B0000"]},modern:{simple:["#3a3a4e","#7a7a8e"],enhanced:["#2C3E50","#BDC3C7"],premium:["#1a1a2e","#E0E0E0","#6366F1"]},boho:{simple:["#6B5B3A","#8B7355"],enhanced:["#5B4A2A","#C4A86A"],premium:["#3D2B1F","#D4A574","#2D5016"]},traditional:{simple:["#8B6914","#CD853F"],enhanced:["#8B4513","#DAA520"],premium:["#B8860B","#DC143C","#FF8C00"]},fairytale:{simple:["#DDA0DD","#FFB6C1"],enhanced:["#C8A2C8","#E6E6FA"],premium:["#FFB6C1","#E6E6FA","#87CEEB"]},luxe:{simple:["#2C1810","#5C4033"],enhanced:["#1a1a2e","#8B7355"],premium:["#0D0D1A","#C9A96E","#4B0082"]},garden:{simple:["#2E7D32","#A5D6A7"],enhanced:["#1B5E20","#81C784"],premium:["#0D4A0D","#66BB6A","#FFE4E1"]},minimalist:{simple:["#E0E0E0","#F5F5F5"],enhanced:["#D0D0D0","#FAFAFA"],premium:["#BDBDBD","#FFFFFF","#F0F0F0"]}};const m=moods[0]||"traditional";const c=(mc[m]||mc.traditional)[tier]||mc.traditional.simple;return`linear-gradient(135deg,${c.join(",")})`};

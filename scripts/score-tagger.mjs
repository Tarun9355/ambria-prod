// Offline accuracy scoring harness for the AI photo tagger.
// Ground truth = the team's VERIFIED library photos (human-confirmed element ids).
// For each photo it reconstructs the production tagging prompt, calls the same Claude
// Edge Function the app uses, runs the same matcher.js pipeline, and compares the
// resulting inventory/pattern id set to the verified id set.
//
//   node scripts/score-tagger.mjs [limit]     (default 10 for validation)
//
// Metrics: precision / recall of element identification, and hallucination rate.
// Caveat: omits few-shot exemplar images + the corrections log (≈90% faithful);
// the run-to-run DELTA is the reliable signal for measuring tuning improvements.

import fs from "fs";
import { createMatcher, normalize, STRUCT_KW, STRUCTURAL_CATS as RAW_SCAFFOLD_CATS, MATCH } from "../src/lib/studio/tagging/matcher.js";
import { renderTagKBText } from "../src/lib/studio/tagKB.js";

const LIMIT = parseInt(process.argv[2] || "10", 10);
const ARTIFICIAL_SUBCAT = /artificial/i;

// ── env ──
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const URL_ = getEnv("VITE_SUPABASE_URL");
const KEY = getEnv("VITE_SUPABASE_ANON_KEY");
const FN_URL = `${URL_}/functions/v1/anthropic`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const rest = async (path) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`REST ${path}: ${r.status}`);
  return r.json();
};
const settingVal = async (key) => {
  const rows = await rest(`settings?key=eq.${encodeURIComponent(key)}&select=value`);
  if (!rows.length) return null;
  const v = rows[0].value;
  return typeof v === "string" ? JSON.parse(v) : v;
};

async function main() {
  console.log("Loading data…");
  const tax = await settingVal("ambria-taxonomy-v2");
  const rcCats = await rest("rate_card_categories?select=id,tag_hidden&limit=1000");
  const flowerPatterns = (await settingVal("flowerPatterns")) || [];
  const synonymDictionary = (await settingVal("synonymDictionary")) || [];
  const kb = await settingVal("ambria-tag-knowledgebase-v1");
  const palette = (await settingVal("ambria-palette-v1")) || [];
  const invSel = "inventory?select=id,name,cat,sub_cat,unit,is_kit,sub_items&order=id.asc&limit=1000";
  const invRaw = [...(await rest(invSel + "&offset=0")), ...(await rest(invSel + "&offset=1000")), ...(await rest(invSel + "&offset=2000"))];
  const inv = invRaw.map((i) => ({ id: i.id, name: i.name, cat: i.cat, subCat: i.sub_cat, unit: i.unit, subItems: i.sub_items }));
  const verified = await rest("library?select=name,url,elements&tagged_at=not.is.null&order=tagged_at.desc&limit=" + LIMIT);
  console.log(`inv=${inv.length} patterns=${flowerPatterns.length} synonyms=${synonymDictionary.length} verified=${verified.length}`);

  // ── build taggable vocab (mirror StudioApp aiTagImage §4674-4706) ──
  const invTagHiddenByKey = {};
  (rcCats || []).forEach((r) => { if (r && r.id && r.tag_hidden) invTagHiddenByKey[r.id] = true; });
  const rcSubIds = new Set((rcCats || []).map((r) => r.id));
  const taggableInv = inv.filter((i) => {
    const cat = String(i.cat || "").trim().toLowerCase();
    if (RAW_SCAFFOLD_CATS.has(cat) && STRUCT_KW.test(String(i.name || ""))) return false;
    const subKey = String(i.subCat || "").trim().toLowerCase();
    if (subKey && invTagHiddenByKey[subKey]) return false;
    if (subKey && !rcSubIds.has(subKey)) return false;
    if (subKey && ARTIFICIAL_SUBCAT.test(subKey)) return false;
    return true;
  });
  const recipeOnlyPatterns = flowerPatterns
    .filter((p) => Object.values(p?.sizes || {}).some((sd) => (sd?.flowers || []).length > 0))
    .map((p) => ({ id: p.id, name: p.name, sub: p.sub || "", unit: p.unit || "pc" }));
  const taggableRecipePatterns = recipeOnlyPatterns.filter((p) => !ARTIFICIAL_SUBCAT.test(p.sub || ""));
  const kitOf = {};
  taggableInv.forEach((i) => { if (Array.isArray(i.subItems) && i.subItems.length) kitOf[i.id] = i.subItems.map((s) => s.itemId); });
  const elemList = [...taggableInv.map((i) => `"${i.name}" (${i.unit})`), ...taggableRecipePatterns.map((p) => `"${p.name}" (${p.unit})`)].join(", ");
  const subByCat = {};
  taggableInv.forEach((i) => { const c = String(i.cat || "").trim(); const s = String(i.subCat || "").trim(); if (!c || !s) return; (subByCat[c] = subByCat[c] || new Set()).add(s); });
  const subcatText = Object.keys(subByCat).length ? ("Sub-category vocabulary by category (use these names and route each element to the right one):\n" + Object.entries(subByCat).map(([c, set]) => `- ${c}: ${[...set].join(", ")}`).join("\n")) : "";
  const kbText = renderTagKBText(kb);

  const houseRulesRaw = (tax.taggingStandards && String(tax.taggingStandards).trim()) || "";
  const houseRules = houseRulesRaw ? ("════════ HOUSE TAGGING RULES — SET BY THE AMBRIA TEAM · ABSOLUTE PRIORITY ════════\nFollow every rule below EXACTLY. Where any of these conflicts with the generic numbered\ninstructions earlier in this message, THESE WIN. Apply them to the tags and elements you output.\n\n" + houseRulesRaw) : "";
  const processNote = houseRulesRaw
    ? "TAGGING PROCESS — follow in this order every time: (1) READ THE PHOTO — identify ONLY what is actually visible in THIS image. (2) NAME — use the HOUSE TAGGING KNOWLEDGE BASE below and the vocabulary lists only to pick the correct names/counts for what you saw; NEVER tag an item just because it is common for this area when it is not in the photo. (3) CONSTRAIN — apply the HOUSE TAGGING RULES as hard constraints; wherever a rule and the knowledge base disagree, THE RULE WINS."
    : "TAGGING PROCESS — first read the photo and identify what is ACTUALLY visible, then use the HOUSE TAGGING KNOWLEDGE BASE below only as a naming/count reference for what you saw.";

  const paletteVals = (palette.length ? palette.map((p) => p.name) : tax.colorPalette) || [];
  const prompt = `Analyze this wedding/event decor image. Tag it using ONLY these exact values:\n\nEvent type: ${tax.eventType.join(", ")}\nVenue type: ${tax.venueType.join(", ")}\nAreas & elements: ${tax.areasElements.join(", ")}\nColor palette: ${paletteVals.join(", ")}\nCategory tier: ${tax.categoryTier.join(", ")}\nDesign style: ${tax.designStyle.join(", ")}\nTime/setting: ${tax.timeSetting.join(", ")}\n\nElement estimation rules:\n1. FIRST PRIORITY: Use EXACT names from this IMS Inventory list. Copy the name character-for-character:\n${elemList}\n2. For each element, ALSO put its top-level category and sub-category in "cat"/"subCat", picked from the "Sub-category vocabulary by category" list below.\n3. For each visible element, estimate quantity and pick size (S/M/B) if available.\n4. ONLY if you see something clearly visible that has NO match in the list above, add it with "new":true flag.\n5. CRITICAL — DO NOT add Truss, Box Truss, Platform, Carpet, Masking, Genset or structural/overhead items as elements (captured in dims). Tag ONLY visible decor: florals, lighting, furniture, chandeliers, ceiling patterns, arches, props.\n6. LIGHTS — count EVERY individual light fixture; put the TOTAL in "lightCount".\n7. MISSING/UNSURE — add unmatched visible items with "new":true and a short "unrecognized" note.\n8. NEVER tag "artificial flower/faux/fake" as its own element.\n9. KITS — a bundled item priced as ONE unit is tagged ONCE by its bundle name; don't also list its components.\n10. ATTACHMENT — set "attachedTo" to the exact name of the element this one rests on, else "".\n11. NAMING — "name" must be specific and human-scannable.\n12. STRUCTURES vs TRUSS DIMS — fill dims for the plain rig AND separately add an element for a distinct arch/panel/jali structure.\n\nReturn ONLY JSON with keys name, tags{eventType,venueType,areasElements,colorPalette,categoryTier,designStyle,timeSetting}, dims{trussL,trussW,trussH,floorL,floorW,plH,mkT,mkWalls{back,left,right}}, elements[{name,cat,subCat,qty,unit,size,detail,new,attachedTo}], lightCount, unrecognized[].`;

  const enumArr = (vals) => ({ type: "array", items: (Array.isArray(vals) && vals.length) ? { type: "string", enum: vals } : { type: "string" } });
  const tagSchema = {
    type: "object", additionalProperties: false,
    required: ["name", "tags", "dims", "elements", "lightCount", "unrecognized"],
    properties: {
      name: { type: "string" }, lightCount: { type: "integer" }, unrecognized: { type: "array", items: { type: "string" } },
      tags: { type: "object", additionalProperties: false, required: ["eventType", "venueType", "areasElements", "colorPalette", "categoryTier", "designStyle", "timeSetting"],
        properties: { eventType: enumArr(tax.eventType), venueType: enumArr(tax.venueType), areasElements: enumArr(tax.areasElements), colorPalette: enumArr(paletteVals), categoryTier: enumArr(tax.categoryTier), designStyle: enumArr(tax.designStyle), timeSetting: enumArr(tax.timeSetting) } },
      dims: { type: "object", additionalProperties: false, required: ["trussL", "trussW", "trussH", "floorL", "floorW", "plH", "mkT", "mkWalls"],
        properties: { trussL: { type: "number" }, trussW: { type: "number" }, trussH: { type: "number" }, floorL: { type: "number" }, floorW: { type: "number" }, plH: { type: "string" }, mkT: { type: "string", enum: ["fabric", "acrylic", "flex", "vinyl", ""] }, mkWalls: { type: "object", additionalProperties: false, required: ["back", "left", "right"], properties: { back: { type: "boolean" }, left: { type: "boolean" }, right: { type: "boolean" } } } } },
      elements: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "cat", "subCat", "qty", "unit", "size", "detail", "new", "attachedTo"],
        properties: { name: { type: "string" }, cat: { type: "string" }, subCat: { type: "string" }, qty: { type: "number" }, unit: { type: "string" }, size: { type: "string", enum: ["S", "M", "B", ""] }, detail: { type: "string" }, new: { type: "boolean" }, attachedTo: { type: "string" } } } },
    },
  };

  const promptText = [processNote, kbText, subcatText, prompt, houseRules].filter(Boolean).join("\n\n");
  const { bestOf } = createMatcher(synonymDictionary);
  const isWeak = (m) => m && m.method === "overlap" && m.score < MATCH.LOW_CONFIDENCE_BELOW;

  const invSubById = {}; inv.forEach((i) => { invSubById[i.id] = normalize(i.subCat || ""); });
  const patSubById = {}; recipeOnlyPatterns.forEach((p) => { patSubById[p.id] = normalize(p.sub || ""); });

  // Run the current-production element pipeline on a raw AI response → list of matched sub-categories
  // (element-identification granularity: "did it find the right KIND of item", not the exact row).
  const predSubs = (parsed) => {
    let els = (parsed.elements || []).filter((el) => normalize(el?.name).split(" ").some((w) => /[a-z]/.test(w) && w.length >= 2));
    els = els.map((el) => {
      const elSubKey = normalize(el.subCat);
      const scopedInv = elSubKey ? taggableInv.filter((it) => normalize(it.subCat) === elSubKey) : [];
      const invMatch = (scopedInv.length && bestOf(el.name, scopedInv, (it) => it.name)) || bestOf(el.name, taggableInv, (it) => it.name);
      if (invMatch && !isWeak(invMatch)) return { ...el, invId: invMatch.item.id, new: undefined };
      const scopedPat = elSubKey ? taggableRecipePatterns.filter((p) => normalize(p.sub) === elSubKey) : [];
      const patMatch = (scopedPat.length && bestOf(el.name, scopedPat, (p) => p.name)) || bestOf(el.name, taggableRecipePatterns, (p) => p.name);
      if (patMatch && !isWeak(patMatch)) return { ...el, patternId: patMatch.item.id, new: undefined };
      return { ...el, new: true };
    });
    const suppressed = new Set();
    els.forEach((el) => { if (el.invId && kitOf[el.invId]) kitOf[el.invId].forEach((id) => suppressed.add(id)); });
    els = els.filter((el) => !(el.invId && suppressed.has(el.invId)));
    els = els.filter((el) => {
      if (el.invId) { const it = inv.find((i) => i.id === el.invId); const cat = String(it?.cat || "").trim().toLowerCase(); return !(RAW_SCAFFOLD_CATS.has(cat) && STRUCT_KW.test(el.name || "")); }
      return !STRUCT_KW.test(el.name || "");
    });
    els = els.filter((el) => !el.new);
    const subs = [];
    els.forEach((el) => { if (el.invId) subs.push(invSubById[el.invId] || ""); else if (el.patternId) subs.push(patSubById[el.patternId] || ""); });
    return subs.filter(Boolean);
  };

  const gtSubs = (photo) => {
    const subs = [];
    (photo.elements || []).forEach((el) => {
      let sub = normalize(el.subCat || "");
      if (!sub && el.invId) sub = invSubById[el.invId] || "";
      if (!sub && el.patternId) sub = patSubById[el.patternId] || "";
      if (sub) subs.push(sub);
    });
    return subs;
  };

  const multiset = (gtArr, predArr) => {
    const gc = {}, pc = {};
    gtArr.forEach((x) => (gc[x] = (gc[x] || 0) + 1));
    predArr.forEach((x) => (pc[x] = (pc[x] || 0) + 1));
    let tp = 0;
    Object.keys(pc).forEach((k) => (tp += Math.min(pc[k], gc[k] || 0)));
    return { tp, fp: predArr.length - tp, fn: gtArr.length - tp };
  };

  const callTag = async (url) => {
    const body = {
      model: "claude-opus-4-8", max_tokens: 8000,
      system: "You are a wedding/event decor image tagger. Respond ONLY with valid JSON, no other text." + (houseRulesRaw ? " The HOUSE TAGGING RULES at the end are MANDATORY and override the knowledge base and generic instructions." : ""),
      messages: [{ role: "user", content: [{ type: "text", text: promptText }, { type: "image", source: { type: "url", url } }] }],
      output_config: { format: { type: "json_schema", schema: tagSchema } },
      thinking: { type: "adaptive", display: "summarized" },
    };
    const r = await fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json", ...H }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(`tag ${r.status}: ${JSON.stringify(data.error || "").slice(0, 200)}`);
    const txt = (data.content || []).map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(txt);
  };

  let TP = 0, FP = 0, FN = 0, done = 0, skipped = 0;
  const perPhoto = [];
  for (const photo of verified) {
    const gt = gtSubs(photo);
    if (!gt.length || !photo.url) { skipped++; continue; }
    try {
      const parsed = await callTag(photo.url);
      const pred = predSubs(parsed);
      const { tp, fp, fn } = multiset(gt, pred);
      TP += tp; FP += fp; FN += fn; done++;
      perPhoto.push({ name: photo.name, gt: gt.length, pred: pred.length, hit: tp, miss: fn, wrong: fp });
      console.log(`  ${photo.name}: gt=${gt.length} pred=${pred.length} hit=${tp} miss=${fn} wrong=${fp}`);
    } catch (e) { skipped++; console.log(`  ${photo.name}: SKIP (${e.message})`); }
  }

  const precision = TP + FP ? TP / (TP + FP) : 0;
  const recall = TP + FN ? TP / (TP + FN) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const halluc = TP + FP ? FP / (TP + FP) : 0;
  console.log("\n======== SCORE (sub-category / element-identification level) ========");
  console.log(`photos scored: ${done}  (skipped ${skipped})`);
  console.log(`Precision — of what it tagged, how much was right: ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall — of what's actually there, how much it caught: ${(recall * 100).toFixed(1)}%`);
  console.log(`F1: ${(f1 * 100).toFixed(1)}%`);
  console.log(`Hallucination/extra rate: ${(halluc * 100).toFixed(1)}%`);
  fs.writeFileSync(new URL("../../score-report.json", import.meta.url), JSON.stringify({ done, skipped, precision, recall, f1, halluc, perPhoto }, null, 2));
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

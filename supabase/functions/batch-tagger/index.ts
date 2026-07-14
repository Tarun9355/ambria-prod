// Supabase Edge Function — continuous batch tagger, cron-triggered every 15 minutes.
//
// Tags untagged Studio library photos using the SAME knowledge the in-app tagger uses (taxonomy,
// IMS inventory, the verified-photo knowledge base, and recent human corrections — all read live
// from the DB), so the server path and the client path stay aligned. An admin can pause/resume it from
// Studio → Settings → Manage → Library / Tagger (settings key 'batch-tagger-paused') — the cron
// keeps firing every 15 min regardless; a paused invocation just no-ops before any Anthropic calls.
//
// Storage note: the Studio library lives as a JSON blob in settings (key 'ambria-library-v2'), not a
// row-per-photo table — so this function reads/merges/writes that blob.
//
// Auth: trigger with header `X-Cron-Secret: <CRON_SECRET>` (the cron does this). CRON_SECRET is a
// dedicated secret (not the service-role key) set via `supabase secrets set CRON_SECRET=...`.
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected; ANTHROPIC_API_KEY is a project secret
// (already set for the `anthropic` function — shared across all functions).
//
// Deploy:  supabase functions deploy batch-tagger
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIB_SK = "ambria-library-v2", TAX_SK = "ambria-taxonomy-v2";
const PALETTE_SK = "ambria-palette-v1", TAG_KB_SK = "ambria-tag-knowledgebase-v1";
const PAUSED_SK = "batch-tagger-paused", LAST_RUN_SK = "batch-tagger-last-run";
const MAX_PER_RUN = 100;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Only these Cloudinary top-level folders are salesperson-facing library photos — asset/prop/
// texture folders (e.g. "inventory") are excluded so the tagger never spends an Opus call on them.
const ALLOWED_SOURCE_FOLDERS = ["ambria", "client-uploads", "inhouse venues", "Outside Venues"];

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const parse = (v: unknown) => { if (v == null) return null; if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v; };
// "structure" AND "tenting" categories both hold BOTH raw scaffold/masking stock (Box Truss,
// Platform, Carpet, Masking — captured only via the "dims" fields, never its own element) AND
// specific decorative/structural items (Wooden/Wrought Iron 2D/3D Arch/Panel/Jali — which the
// STRUCTURES house rule wants tagged as their own element, and which aren't always filed under
// "structure"). Exclude only the raw-scaffold ones by NAME (STRUCT_KW below), not either whole
// category — blanket-excluding by category meant specific structure items could never be tagged no
// matter what the prompt said, regardless of which of these two categories they happened to live in.
const STRUCT_KW = /\b(box truss|single u truss|u truss|truss|carpet|wall mask|fabric mask|masking|flex print|vinyl print|acrylic panel|genset|platform|riser|flooring)\b/i;
const STRUCTURAL = new Set(["structure", "tenting"]);
const enumArr = (vals: string[]) => ({ type: "array", items: { type: "string", enum: (vals || []).filter(Boolean) } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) return json({ error: "not configured" }, 500);

  // Only the cron (holding CRON_SECRET, a dedicated secret separate from the service-role
  // key) may trigger this. Needed because Dashboard-level JWT verification is off for this
  // function, so without this check the endpoint would be public — and it calls Claude Opus
  // per image, so an open endpoint is a direct cost-abuse vector.
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (!CRON_SECRET) return json({ error: "not configured" }, 500);
  const provided = req.headers.get("X-Cron-Secret") || "";
  if (provided !== CRON_SECRET) return json({ error: "unauthorized" }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const getKv = async (key: string) => { const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle(); return parse(data?.value); };

  // Admin pause flag — Studio UI can pause/resume the 15-min batch tagger. The cron keeps
  // firing every 15 min regardless; a paused run just no-ops here before any Anthropic calls.
  const pauseFlag = await getKv(PAUSED_SK);
  if (pauseFlag && typeof pauseFlag === "object" && pauseFlag.paused) {
    console.log(`Batch tagger paused by ${pauseFlag.pausedBy || "unknown"} at ${pauseFlag.pausedAt || "unknown"}, skipping run`);
    return json({ ok: true, tagged: 0, message: "paused via Studio UI" });
  }

  // Vocabulary: read the live `inventory` TABLE — this replaces the Rate Card table this function
  // used to read (Phase 4 of the earlier Rate Card → IMS migration); tagging now matches the manual
  // "+Add element" pickers, which source directly from inventory (see StudioApp.jsx's aiTagImage
  // and getElPriceFromInventory). `rate_card_categories.tag_hidden` (set in IMS's Sub-Categories
  // admin panel) replaces the old TAG_HIDDEN_SUBS_SK settings-blob flag for this purpose — that key
  // is left alone/unread here now, in case anything else still reads it.
  const [taxonomy, palette, kb, flowerPatterns, synonymDictionary] = await Promise.all([TAX_SK, PALETTE_SK, TAG_KB_SK, "flowerPatterns", "synonymDictionary"].map(getKv));
  const { data: invRows, error: invErr } = await db.from("inventory").select("*");
  if (invErr) return json({ error: invErr.message }, 500);
  const { data: subcatRows, error: subcatErr } = await db.from("rate_card_categories").select("id, tag_hidden");
  if (subcatErr) return json({ error: subcatErr.message }, 500);
  const rowToInvItem = (row: any) => ({ id: row.id, name: row.name, cat: row.cat, subCat: row.sub_cat, unit: row.unit, subItems: Array.isArray(row.sub_items) ? row.sub_items : [] });
  const squeezeKey = (s: any) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

  // Library is the `library` TABLE (row-per-photo); the full item lives in the `data` JSONB
  // column, typed columns (incl. status/tag_source/tagged_at — migration 008) are mirrors.
  // "untagged" is now a straight indexed column filter instead of a full-table scan + heuristic.
  const rowToItem = (row: any) => (row?.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length)
    ? { ...row.data, id: row.id }
    : { id: row.id, name: row.name, url: row.url, tags: row.tags || {}, elements: row.elements || [], dims: row.dims || {} };
  const tax = taxonomy || {};
  const inv = (invRows || []).map(rowToInvItem);
  const tagHiddenSubIds = new Set((subcatRows || []).filter((r: any) => r && r.tag_hidden).map((r: any) => r.id));
  const rcSubIds = new Set((subcatRows || []).map((r: any) => r.id));
  const paletteVals = (palette?.paletteCatalogue || []).map((p: any) => p?.name).filter(Boolean);
  const colorVals = paletteVals.length ? paletteVals : (tax.colorPalette || []);

  // Pure flower-recipe patterns with NO inventory item at all (e.g. "Flower Garden", "Floral
  // Trail" — priced per running foot straight from the recipe) — mirrors the client aiTagImage's
  // recipeOnlyPatterns (StudioApp.jsx), so both tagging paths offer the same extra vocabulary.
  const invFloralSubs = new Set(
    inv.filter((i: any) => String(i.cat || "").trim().toLowerCase() === "florals").map((i: any) => squeezeKey(i.subCat))
  );
  const recipeOnlyPatterns = (Array.isArray(flowerPatterns) ? flowerPatterns : [])
    .filter((p: any) => !invFloralSubs.has(squeezeKey(p?.sub)))
    .map((p: any) => ({ id: p.id, name: p.name, sub: p.sub || "", unit: p.unit || "pc" }));

  // One-off backfill: the existing Needs Review pile was tagged under the old rules, so drain
  // it before touching brand-new untagged photos. RETAG_REVIEW_BEFORE is fixed at the moment this
  // backfill went live — retagging sets tagged_at to "now" (after the cutoff), so each photo
  // falls out of this query as soon as it's redone. Once none are left before the cutoff, this
  // branch permanently returns zero rows and the function goes back to untagged-only tagging.
  const RETAG_REVIEW_BEFORE = "2026-07-07T12:16:00.000Z";
  const { data: reviewBacklogRows, error: reviewErr } = await db.from("library")
    .select("*").eq("status", "review").lt("tagged_at", RETAG_REVIEW_BEFORE)
    .in("source_folder", ALLOWED_SOURCE_FOLDERS)
    .order("tagged_at", { ascending: true }).limit(MAX_PER_RUN);
  if (reviewErr) return json({ error: reviewErr.message }, 500);

  let rows = reviewBacklogRows;
  if (!rows || !rows.length) {
    const { data: untaggedRows, error: untErr } = await db.from("library")
      .select("*").eq("status", "untagged").in("source_folder", ALLOWED_SOURCE_FOLDERS)
      .order("created_at", { ascending: true }).limit(MAX_PER_RUN);
    if (untErr) return json({ error: untErr.message }, 500);
    rows = untaggedRows;
  }
  const targets = (rows || []).map(rowToItem).filter((i: any) => i && i.url);
  if (!targets.length) {
    await db.from("settings").upsert({ key: LAST_RUN_SK, value: { at: new Date().toISOString(), tagged: 0, failed: 0, scanned: 0 } }, { onConflict: "key" });
    return json({ ok: true, tagged: 0, message: "nothing untagged" });
  }

  // Recent corrections → "learn from these".
  const { data: corr } = await db.from("tag_corrections").select("field, ai_value, corrected_value").order("created_at", { ascending: false }).limit(20);
  const corrText = (corr || []).length
    ? "PREVIOUS HUMAN CORRECTIONS — the corrected value is right:\n" + corr!.map((c) => `- ${c.field}: was "${c.ai_value || "(blank)"}" → correct is "${c.corrected_value || "(blank)"}"`).join("\n")
    : "";

  // Sub-categories flagged hidden from AI tagging (rate_card_categories.tag_hidden, set in IMS's
  // Sub-Categories admin panel) — dropped from the vocabulary and the exact-name element list. A
  // sub-category with no canonical rate_card_categories row at all (orphaned/typo'd sub_cat text)
  // is dropped the same way — mirrors the client aiTagImage's same rule.
  const isSubHidden = (subCat: any) => tagHiddenSubIds.has(String(subCat || "").trim().toLowerCase());
  const isSubUnrecognized = (subCat: any) => { const k = String(subCat || "").trim().toLowerCase(); return !!k && !rcSubIds.has(k); };
  // House rule: never tag artificial flowers/foliage. A keyword filter on the AI's own proposed name
  // (below) catches "artificial flower"-style text, but not a plausible name (e.g. "Mixed Green
  // Foliage Bundle") that happens to match a real item filed under a sub-category whose NAME itself
  // says it's artificial (e.g. "Artificial Foliage") — mirrors the client aiTagImage's same rule.
  const ARTIFICIAL_SUBCAT = /artificial/i;
  const isSubArtificial = (subCat: any) => ARTIFICIAL_SUBCAT.test(String(subCat || ""));
  const taggableInv = inv.filter((i: any) => {
    const cat = String(i.cat || "").trim().toLowerCase();
    if (STRUCTURAL.has(cat) && STRUCT_KW.test(String(i.name || ""))) return false;
    return !isSubHidden(i.subCat) && !isSubUnrecognized(i.subCat) && !isSubArtificial(i.subCat);
  });
  const taggableRecipePatterns = recipeOnlyPatterns.filter((p: any) => !isSubArtificial(p.sub));
  // Kit (bundle) items → their own components' itemIds, so a photo matching the kit itself doesn't
  // ALSO get its individual sub-items tagged separately — mirrors the client aiTagImage's rule.
  const kitOf: Record<string, string[]> = {};
  taggableInv.forEach((i: any) => { if (Array.isArray(i.subItems) && i.subItems.length) kitOf[i.id] = i.subItems.map((s: any) => s.itemId); });
  // Sub-category vocabulary by top-level category (from live inventory).
  const subByCat: Record<string, Set<string>> = {};
  taggableInv.forEach((i: any) => { const c = String(i.cat || "").trim(), s = String(i.subCat || "").trim(); if (c && s) (subByCat[c] = subByCat[c] || new Set()).add(s); });
  const subcatText = Object.keys(subByCat).length ? "Sub-category vocabulary by category:\n" + Object.entries(subByCat).map(([c, s]) => `- ${c}: ${[...s].join(", ")}`).join("\n") : "";
  const elemList = [...taggableInv.map((i: any) => `"${i.name}"`), ...taggableRecipePatterns.map((p: any) => `"${p.name}"`)].join(", ");
  // Names/keywords for structural items that must NEVER appear in the element breakdown (they're
  // captured in the dedicated truss/floor/masking sections — listing them too double-counts).
  const normName = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const structuralNames = new Set(inv.filter((i: any) => {
    const cat = String(i.cat || "").trim().toLowerCase();
    return STRUCTURAL.has(cat) && STRUCT_KW.test(String(i.name || ""));
  }).map((i: any) => normName(i.name)));
  const dropStructural = (els: any[]) => (Array.isArray(els) ? els : []).filter((e: any) => {
    if (!e || !e.name) return false;
    if (structuralNames.has(normName(e.name))) return false;
    if (e.invId) {
      // Matched to a real inventory item — trust its ACTUAL resolved category. A legitimate item
      // from an unrelated category shouldn't be deleted just because its name happens to contain a
      // raw-scaffold keyword (e.g. a Furniture item literally named "...Platform...").
      const item = inv.find((i: any) => i.id === e.invId);
      const cat = String(item?.cat || "").trim().toLowerCase();
      return !(STRUCTURAL.has(cat) && STRUCT_KW.test(e.name));
    }
    // Unmatched/new proposal — no resolved category to check, so the name-keyword test is the only
    // signal available; keep it as a conservative backstop.
    return !STRUCT_KW.test(e.name);
  });
  // Matches an AI-proposed element name against a real inventory item — mirrors StudioApp.jsx's
  // aiTagImage matching exactly (exact normalized match → substring → keyword-overlap ≥40 score),
  // so both tagging paths resolve to the same invId given the same name.
  // Generic words that inflate keyword-overlap scores between UNRELATED items (colors/sizes/filler
  // adjectives shared across many catalog names) — excluded so overlap only counts words that
  // actually identify what the thing IS.
  const stopWords = new Set([
    "the", "a", "an", "of", "for", "with", "and", "in", "on", "to", "custom", "special", "premium",
    "standard", "basic", "indian", "wedding", "event", "decor", "decorative", "piece", "item", "set",
    "style", "design", "type", "look", "variant", "large", "small", "big", "mini", "tall", "short",
    "medium", "huge", "giant", "tiny", "gold", "golden", "white", "silver", "black", "red", "pink",
    "green", "blue", "ivory", "cream", "rose", "peach", "purple", "yellow", "orange", "maroon", "copper",
  ]);
  // AI Synonym Dictionary (IMS Admin → Settings → 🔤 AI Synonyms) — ops-editable groups of words that
  // mean the same physical thing (e.g. "Jali"/"Lattice"/"Mesh"/"Screen"). Maps every word in a group
  // to that group's first word, so two synonym-equivalent words normalize to the same token before
  // keyword-overlap scoring. Mirrors the client aiTagImage's rule.
  const synonymOf: Record<string, string> = {};
  (Array.isArray(synonymDictionary) ? synonymDictionary : []).forEach((g: any) => {
    const words = Array.isArray(g?.words) ? g.words : [];
    if (words.length < 2) return;
    const canon = normName(words[0]);
    words.forEach((w: string) => { synonymOf[normName(w)] = canon; });
  });
  const canonWord = (w: string) => synonymOf[w] || w;
  const keywords = (s: string) => normName(s).split(" ").filter((w: string) => !stopWords.has(w) && w.length > 1).map(canonWord);
  // Best-effort match of one AI-proposed name against a candidate pool (exact → substring →
  // keyword-overlap ≥40%). Shared by the sub-cat-scoped and full-catalog passes below. Returns
  // { item, method, score } — mirrors the client aiTagImage's shape so low-confidence overlap
  // matches can be flagged for human review the same way on both tagging paths.
  const bestOf = (name: string, pool: any[], keyOf: (c: any) => string): { item: any; method: string; score: number } | null => {
    const nameNorm = normName(name);
    const exact = pool.find((c) => normName(keyOf(c)) === nameNorm);
    if (exact) return { item: exact, method: "exact", score: 100 };
    const nameKw = keywords(name);
    let bestScore = 0, best: any = null;
    for (const c of pool) {
      const cNorm = normName(keyOf(c));
      if (nameNorm.includes(cNorm) || cNorm.includes(nameNorm)) return { item: c, method: "substring", score: 90 };
      const cKw = keywords(keyOf(c));
      const overlap = nameKw.filter((w: string) => cKw.some((cw: string) => cw.includes(w) || w.includes(cw))).length;
      // Denominator is the SMALLER keyword count, not the larger — mirrors the client aiTagImage's
      // fix: a short, precise catalog name fully contained inside a long AI-invented description
      // should score as a strong match, not get penalized just because the AI's own phrasing was
      // verbose. Using the larger count systematically under-scored short catalog names.
      const score = overlap > 0 ? (overlap / Math.min(nameKw.length, cKw.length)) * 100 : 0;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore >= 40 ? { item: best, method: "overlap", score: bestScore } : null;
  };
  const LOW_CONFIDENCE_BELOW = 65;
  // Real-vs-artificial flower content is a %-blend the pricing engine applies automatically to the
  // matched floral item — it's never its own physical inventory item, so an "artificial flower
  // bunch"-style proposal should be tagged under its cleaned name, not deleted outright (deleting it
  // would silently undercount a real, visible floral arrangement whenever the model's naming didn't
  // perfectly follow the "don't say artificial" instruction). Mirrors the client aiTagImage's rule.
  const ARTIFICIAL_KW = /\b(artificial|faux|fake)\b/i;
  const FLORAL_KW = /\b(flower|floral|greenery|leaves|leaf|petal|bouquet|garland|bunch|foliage|plant)\b/i;
  const sanitizeArtificialFloral = (els: any[]) => (Array.isArray(els) ? els : []).map((e: any) => {
    if (!e || !e.name || !(ARTIFICIAL_KW.test(e.name) && FLORAL_KW.test(e.name))) return e;
    const cleanName = String(e.name).replace(/\b(artificial|faux|fake)\b/gi, "").replace(/\s+/g, " ").trim();
    return cleanName ? { ...e, name: cleanName } : e;
  });
  const matchInventory = (els: any[]) => {
    const mapped = (Array.isArray(els) ? els : []).map((el: any) => {
      if (!el || !el.name) return el;
      // Scope the search to the model's own guessed sub-category first — routes the match to the
      // right bucket instead of the whole catalog; falls back to the full catalog if the guess
      // didn't narrow to anything, so a wrong/blank category guess never costs recall.
      const elSubKey = normName(el.subCat);
      const scopedInv = elSubKey ? taggableInv.filter((it: any) => normName(it.subCat) === elSubKey) : [];
      // Preserve the ORIGINAL AI-proposed name (before it's overwritten below with the matched
      // inventory name) as a new field rather than mutating `el` in place — `els`/`r.elements` are
      // shared object references with the pristine `_aiRawResponse` snapshot taken by the caller, so
      // mutating the original objects would leak this scratch field into that snapshot.
      const origName = el.name;
      const invMatch = (scopedInv.length && bestOf(el.name, scopedInv, (it) => it.name)) || bestOf(el.name, taggableInv, (it) => it.name);
      if (invMatch) {
        const lowConfidence = invMatch.method === "overlap" && invMatch.score < LOW_CONFIDENCE_BELOW;
        return { ...el, name: invMatch.item.name, unit: invMatch.item.unit, invId: invMatch.item.id, new: undefined, lowConfidence: lowConfidence || undefined, matchMethod: invMatch.method, matchScore: Math.round(invMatch.score), _origName: origName };
      }
      // No inventory match — try a pure flower-recipe pattern (e.g. "Flower Garden") the same way.
      const scopedPat = elSubKey ? taggableRecipePatterns.filter((p: any) => normName(p.sub) === elSubKey) : [];
      const patMatch = (scopedPat.length && bestOf(el.name, scopedPat, (p) => p.name)) || bestOf(el.name, taggableRecipePatterns, (p) => p.name);
      if (patMatch) {
        const lowConfidence = patMatch.method === "overlap" && patMatch.score < LOW_CONFIDENCE_BELOW;
        return { ...el, name: patMatch.item.name, unit: patMatch.item.unit, patternId: patMatch.item.id, new: undefined, lowConfidence: lowConfidence || undefined, matchMethod: patMatch.method, matchScore: Math.round(patMatch.score), _origName: origName };
      }
      return { ...el, new: true, _origName: origName };
    });
    // A matched kit already represents its own components' cost/stock — drop any OTHER element that
    // matched one of THAT kit's sub-items so the same physical object isn't tagged twice.
    const suppressedCompIds = new Set<string>();
    mapped.forEach((el: any) => { if (el && el.invId && kitOf[el.invId]) kitOf[el.invId].forEach((id) => suppressedCompIds.add(id)); });
    const idDeduped = suppressedCompIds.size ? mapped.filter((el: any) => !(el && el.invId && suppressedCompIds.has(el.invId))) : mapped;
    // Harden that dedup for NAME-similar components too — mirrors the client aiTagImage's rule: an
    // element that didn't resolve to the kit's own component id (e.g. it overlap-matched a different,
    // merely similar-looking item) still slips through the id-only check above. Re-run the name
    // matcher against just this kit's component names and drop anything that matches. Require an
    // EXACT or SUBSTRING match (not the loose ≥40% overlap tier) — this pools component names across
    // every kit matched in the photo, so a lenient overlap match could wrongly suppress a genuinely
    // separate standalone item that just happens to share a couple of generic words with some OTHER
    // kit's recipe. An exact/near-exact match to a specific known component is a safer bar to drop on.
    const kitCompNames: any[] = [];
    idDeduped.forEach((el: any) => { if (el && el.invId && kitOf[el.invId]) kitOf[el.invId].forEach((id: string) => { const ci = inv.find((i: any) => i.id === id); if (ci) kitCompNames.push(ci); }); });
    const nameDeduped = kitCompNames.length ? idDeduped.filter((el: any) => {
      if (el && el.invId && kitOf[el.invId]) return true;
      const m = bestOf(el?.name || "", kitCompNames, (c) => c.name);
      return !(m && m.method !== "overlap");
    }) : idDeduped;
    // Spatial dedup: Claude tags "attachedTo" with the ORIGINAL name of whatever element this one is
    // resting on/part of. If that parent resolved to a KIT, drop this element outright — even if it
    // doesn't match anything literally in the kit's own recipe. Mirrors the client aiTagImage's rule.
    const withOrigName = nameDeduped.filter((el: any) => el && el._origName);
    const deduped = nameDeduped.filter((el: any) => {
      if (!el || !el.attachedTo) return true;
      const parentMatch = bestOf(el.attachedTo, withOrigName.filter((x: any) => x !== el), (x: any) => x._origName);
      return !(parentMatch && parentMatch.item.invId && kitOf[parentMatch.item.invId]);
    });
    // Backstop for the artificial-flower rule: an unmatched ("new") proposal has no resolved
    // inventory sub-category to check, only the AI's own guessed el.subCat — drop it there too so a
    // name that doesn't literally say "artificial" still can't sneak through as an unreviewed element.
    return deduped.filter((el: any) => !(el && isSubArtificial(el.subCat))).map((el: any) => { const { _origName, attachedTo, ...rest } = el; return rest; });
  };
  const houseRules = (tax.taggingStandards || "").trim() ? "HOUSE TAGGING RULES (follow strictly):\n" + String(tax.taggingStandards).trim() : "";

  const basePrompt = `Analyze this wedding/event decor image. Tag it using ONLY these exact values:
Event type: ${(tax.eventType || []).join(", ")}
Venue type: ${(tax.venueType || []).join(", ")}
Areas & elements: ${(tax.areasElements || []).join(", ")}
Color palette: ${colorVals.join(", ")}
Category tier: ${(tax.categoryTier || []).join(", ")}
Design style: ${(tax.designStyle || []).join(", ")}
Time/setting: ${(tax.timeSetting || []).join(", ")}

Rules:
1. Use EXACT IMS Inventory names for visible decor elements where possible: ${elemList}
2. For each element, ALSO put its top-level category and sub-category in "cat"/"subCat" (from the sub-category vocabulary below) — this routes the exact-name match to the right bucket instead of the whole catalog, so pick the one that's visually true.
3. For each element estimate quantity; mark items not in the list with "new":true (still fill "cat"/"subCat" with your best guess).
4. Do NOT tag structural items (truss/platform/masking/carpet/flex) as elements.
5. LIGHTS — count every light fixture; put the total in "lightCount" (0 if none).
6. MISSING — items you cannot match go in elements with "new":true AND a short note in "unrecognized" ([] if none).
7. NEVER tag "artificial flower/faux flower/fake flower/greenery/bouquet/garland" as its own element — real-vs-artificial is a %-blend the pricing engine applies automatically to the matched floral item; just tag the flower/floral item normally.
8. KITS — if several pieces are sold and priced together as ONE bundled inventory item, tag it ONCE using that bundled item's exact name; do not also separately list its individual component pieces.
9. ATTACHMENT — for EVERY element, decide if it is physically resting on, placed on top of, or otherwise part of another element you are ALSO tagging in this same photo (e.g. a candle on a console table, a vase on a pedestal). If so, set "attachedTo" to the EXACT "name" you used for that other element (character-for-character); otherwise set it to "". Still tag the item normally even when it's attached to something else — do not skip it.
10. CRITICAL — NAMING IS MANDATORY: "name" must ALWAYS be a specific, human-scannable name (5-9 words) referencing the zone/area, the dominant design style, AND one standout hero element (e.g. "Mandap Stage — Ivory Drapes & Crystal Chandelier"). NEVER settle for generic filler alone like "Wedding Decor", "Elegant Setup", "Floral Arrangement", "Event Design", or a bare venue/zone label — every photo needs its own distinct, descriptive name, not a placeholder.
11. STRUCTURES vs TRUSS DIMS — these are TWO SEPARATE things and you must fill BOTH when relevant, never one instead of the other. The "dims" fields (trussL/trussW/trussH/plH/mkT) capture ONLY the plain overhead scaffold/base rig (Box Truss or Single U Truss), regardless of what it's made of or shaped like. SEPARATELY — and in ADDITION — if the structure itself (arch, panel, wall, jali/lattice/mesh screen, backdrop frame) has a distinct material and shape, you MUST ALSO add ONE element for it. Shapes include Arch, Panel, AND Jali (a perforated lattice/mesh screen — do NOT force a Jali into the Arch/Panel naming, it is its own shape). FIRST search the IMS Inventory list above for a SPECIFIC matching item by its own catalog name (e.g. "iron Jali" for a wrought-iron perforated lattice/mesh screen/dome, "J arch"/"Single arch"/"Triangle" for specific arch shapes) — these specific catalog names always win over a generic label. ONLY if no specific item matches, fall back to the generic sub-category combo name: MATERIAL (Wooden or Wrought Iron) + DEPTH (2D flat / 3D with visible depth) + SHAPE (Arch/Panel) from the sub-category vocabulary below. NEVER invent your own descriptive label for a structure element instead of matching it to the inventory list. Do NOT skip this element just because you already tagged the plain truss/platform.

Dimension estimation rules (in feet, estimate from visual cues like people height ~5.5ft, chairs ~3ft, standard ceiling ~10-12ft):
- trussL: length of the main structure (front-to-back or stage width)
- trussW: width/depth of the structure
- trussH: height of the overhead structure/truss
- floorL: floor area length (may be larger than truss if carpet/platform extends)
- floorW: floor area width
- plH: platform height — "4in" if slightly raised, "1ft" if clearly elevated stage, "" if ground level
- mkT: masking material if visible behind/sides — "fabric","acrylic","flex","vinyl" or "" if none
- mkWalls: which walls have masking — {"back":true/false,"left":true/false,"right":true/false}
Return ONLY JSON matching the provided schema.`;

  const promptText = [houseRules, corrText, kb?.promptText || "", subcatText, basePrompt].filter(Boolean).join("\n\n");
  const exemplars = (kb?.exemplars || []).slice(0, 4).filter((e: any) => e && e.url);

  const schema = {
    type: "object", additionalProperties: false,
    required: ["name", "tags", "dims", "elements", "lightCount", "unrecognized"],
    properties: {
      name: { type: "string" },
      lightCount: { type: "integer" },
      unrecognized: { type: "array", items: { type: "string" } },
      tags: {
        type: "object", additionalProperties: false,
        required: ["eventType", "venueType", "areasElements", "colorPalette", "categoryTier", "designStyle", "timeSetting"],
        properties: {
          eventType: enumArr(tax.eventType), venueType: enumArr(tax.venueType), areasElements: enumArr(tax.areasElements),
          colorPalette: enumArr(colorVals), categoryTier: enumArr(tax.categoryTier), designStyle: enumArr(tax.designStyle), timeSetting: enumArr(tax.timeSetting),
        },
      },
      // Mirrors the client aiTagImage's dims schema — previously absent here, so nightly-tagged
      // photos got NO Zone Structure Cost data at all regardless of what the prompt said.
      dims: {
        type: "object", additionalProperties: false,
        required: ["trussL", "trussW", "trussH", "floorL", "floorW", "plH", "mkT", "mkWalls"],
        properties: {
          trussL: { type: "number" }, trussW: { type: "number" }, trussH: { type: "number" },
          floorL: { type: "number" }, floorW: { type: "number" },
          plH: { type: "string" }, mkT: { type: "string", enum: ["fabric", "acrylic", "flex", "vinyl", ""] },
          mkWalls: { type: "object", additionalProperties: false, required: ["back", "left", "right"], properties: { back: { type: "boolean" }, left: { type: "boolean" }, right: { type: "boolean" } } },
        },
      },
      elements: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "cat", "subCat", "qty"], properties: { name: { type: "string" }, cat: { type: "string" }, subCat: { type: "string" }, qty: { type: "number" }, size: { type: "string" }, detail: { type: "string" }, new: { type: "boolean" }, attachedTo: { type: "string" } } } },
    },
  };

  const tagOne = async (img: any) => {
    const staticBlocks: any[] = [{ type: "text", text: promptText }];
    exemplars.forEach((ex: any, i: number) => {
      staticBlocks.push({ type: "image", source: { type: "url", url: ex.url } });
      staticBlocks.push({ type: "text", text: `Verified example ${i + 1}: area=${ex.area}${ex.style ? `, style=${ex.style}` : ""}${ex.palette ? `, palette=${ex.palette}` : ""}${ex.lights ? `, lights=${ex.lights}` : ""}.` });
    });
    staticBlocks[staticBlocks.length - 1].cache_control = { type: "ephemeral" };
    const body = {
      model: "claude-opus-4-8", max_tokens: 8000,
      system: "You are a wedding/event decor image tagger. Respond ONLY with valid JSON.",
      output_config: { format: { type: "json_schema", schema } },
      // display:"summarized" — mirrors the client aiTagImage — without it the thinking block still
      // gets billed but comes back with empty text, so there'd be nothing to show a reviewer.
      thinking: { type: "adaptive", display: "summarized" },
      messages: [{ role: "user", content: [...staticBlocks, { type: "image", source: { type: "url", url: img.url } }] }],
    };
    const resp = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error?.message || `Anthropic ${resp.status}`);
    let text = "", thinking = "";
    (data.content || []).forEach((b: any) => { if (b.type === "thinking") thinking += b.thinking || ""; else if (b.text) text += b.text; });
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (thinking.trim()) parsed._aiThinking = thinking.trim();
    return parsed;
  };

  // Supabase's edge runtime kills a request that runs past its idle timeout (~150s). Each image is
  // a full Opus vision call and can take a while, so instead of tagging everything then writing once
  // at the end (all-or-nothing — a timeout mid-run used to throw away every already-paid-for tag),
  // each result is written the moment it's ready and a time budget stops the loop before the
  // platform would kill it. Whatever's left over just waits for the next run.
  const RUN_TIME_BUDGET_MS = 120_000;
  const runStart = Date.now();
  let ok = 0, fail = 0, skipped = 0;
  for (const img of targets) {
    if (Date.now() - runStart > RUN_TIME_BUDGET_MS) { skipped = targets.length - ok - fail; break; }
    try {
      const r = await tagOne(img);
      // r.elements/tags/etc are exactly what tagOne parsed from Claude, untouched by the
      // matchInventory/dropStructural passes below (those build new arrays) — so r itself, minus the
      // separately-tracked _aiThinking, IS the pristine pre-processing snapshot.
      const { _aiThinking: aiThinking, ...aiRawResponse } = r;
      let taggedEls = dropStructural(matchInventory(sanitizeArtificialFloral(r.elements)));
      // Merge duplicate elements that resolved to the SAME real inventory item/pattern (and same
      // size) — if Claude's own response lists the same physical item twice under different
      // phrasing, both independently match and would otherwise double-count qty with no warning.
      // Keyed by invId/patternId + size so genuinely different size variants of the same base item
      // are NOT collapsed together. Mirrors the client.
      if (taggedEls.length > 1) {
        const mergedEls: any[] = [];
        const keyIndex = new Map<string, number>();
        taggedEls.forEach((el: any) => {
          const key = (el.invId || el.patternId) ? `${el.invId || el.patternId}|${el.size || ""}` : null;
          if (key && keyIndex.has(key)) { const idx = keyIndex.get(key)!; mergedEls[idx].qty = (Number(mergedEls[idx].qty) || 0) + (Number(el.qty) || 0); return; }
          if (key) keyIndex.set(key, mergedEls.length);
          mergedEls.push({ ...el });
        });
        taggedEls = mergedEls;
      }
      // An unmatched ("new") proposal has no real inventory item behind it — it never prices, never
      // blocks stock, and just sits in the Element Breakdown as an inert $0 placeholder row. Fold it
      // into "unrecognized" instead (the existing review-backlog list) so a reviewer still sees it
      // was spotted (WITH its estimated qty, so the count signal isn't lost), without it cluttering
      // the actual priced element list. Mirrors the client.
      const newNames = taggedEls.filter((el: any) => el && el.new && el.name).map((el: any) => el.qty > 1 ? `${el.name} (qty ~${el.qty})` : el.name);
      const mergedUnrec = Array.isArray(r.unrecognized) ? [...r.unrecognized] : [];
      if (newNames.length) {
        const seenUnrec = new Set(mergedUnrec.map((s: any) => String(s).toLowerCase()));
        newNames.forEach((n: string) => { if (!seenUnrec.has(n.toLowerCase())) { mergedUnrec.push(n); seenUnrec.add(n.toLowerCase()); } });
      }
      const finalEls = taggedEls.filter((el: any) => !(el && el.new));
      // Naming backstop — instruction-following isn't reliable, so if Claude still returns a
      // blank/generic placeholder name, deterministically build one from the tagged zone/style/hero-
      // element data instead of letting the placeholder through. Mirrors the client.
      const GENERIC_NAME_RE = /^(wedding decor|elegant setup|floral arrangement|event design|decor setup|event decor|décor)$/i;
      const isGenericName = (n: any) => !n || !String(n).trim() || GENERIC_NAME_RE.test(String(n).trim()) || String(n).trim().split(/\s+/).length < 3;
      let resolvedName = (img.name && !String(img.name).startsWith("img ")) ? img.name : (r.name || img.name);
      if (isGenericName(resolvedName)) {
        const area = (r.tags?.areasElements || [])[0] || "";
        const style = (r.tags?.designStyle || [])[0] || "";
        const hero = finalEls.filter((e: any) => e && e.name && (e.invId || e.patternId)).sort((a: any, b: any) => (Number(b.qty) || 0) - (Number(a.qty) || 0))[0];
        const parts = [area, style, hero?.name].filter(Boolean);
        if (parts.length) resolvedName = parts.join(" — ");
      }
      // Lightweight match-stats — no aggregate visibility existed into how often each dedup/match
      // tier actually fires; without it, tuning LOW_CONFIDENCE_BELOW/the 40% overlap floor is pure
      // guesswork. Persisted alongside _aiRawResponse so it can be queried/audited later. Mirrors client.
      const matchStats = {
        exact: finalEls.filter((el: any) => el.matchMethod === "exact").length,
        substring: finalEls.filter((el: any) => el.matchMethod === "substring").length,
        overlap: finalEls.filter((el: any) => el.matchMethod === "overlap").length,
        lowConfidence: finalEls.filter((el: any) => el.lowConfidence).length,
        unrecognized: mergedUnrec.length,
      };
      const patch = { tags: r.tags || {}, dims: (r.dims && typeof r.dims === "object") ? r.dims : {}, elements: finalEls, lightCount: typeof r.lightCount === "number" ? r.lightCount : undefined, unrecognized: mergedUnrec, _aiTags: r.tags || {}, _aiThinking: aiThinking || undefined, _aiRawResponse: aiRawResponse, _matchStats: matchStats, _aiTagged: true, _aiTaggedAt: Date.now(), tagSource: "nightly", name: resolvedName };
      const item = { ...img, ...patch };
      // Target was either status='untagged' or an unverified 'review' backlog photo being
      // retagged under the current rules — either way it lands on 'review', never verified.
      const row = {
        id: item.id, name: item.name ?? null, url: item.url ?? null, tags: item.tags || {}, elements: item.elements || [], dims: item.dims || {}, data: item,
        status: "review", tag_source: "nightly", tagged_at: new Date(item._aiTaggedAt).toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await db.from("library").upsert(row, { onConflict: "id" });
      if (upErr) throw new Error(upErr.message);
      await db.from("batch_tag_log").insert({ photo_id: img.id, success: true });
      ok++;
    } catch (e) {
      await db.from("batch_tag_log").insert({ photo_id: img.id, success: false, error: String((e as Error)?.message || e) });
      fail++;
    }
  }

  await db.from("settings").upsert({ key: LAST_RUN_SK, value: { at: new Date().toISOString(), tagged: ok, failed: fail, scanned: targets.length } }, { onConflict: "key" });
  return json({ ok: true, tagged: ok, failed: fail, scanned: targets.length, skipped_out_of_time: skipped });
});

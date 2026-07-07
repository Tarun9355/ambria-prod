// Supabase Edge Function — nightly batch tagger.
//
// Tags untagged Studio library photos using the SAME knowledge the in-app tagger uses (taxonomy,
// rate card, the verified-photo knowledge base, and recent human corrections — all read live from
// the DB), so the server path and the client path stay aligned. Designed to run on a cron at 2 AM IST
// when nobody is editing, so writing the library blob back can't clobber a live edit.
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

const LIB_SK = "ambria-library-v2", TAX_SK = "ambria-taxonomy-v2", RC_SK = "ambria-ratecard-v4";
const PALETTE_SK = "ambria-palette-v1", TAG_KB_SK = "ambria-tag-knowledgebase-v1";
const TAG_HIDDEN_SUBS_SK = "ambria-tag-hidden-subs-v1"; // "cat::sub" keys flagged not-taggable in Pricing
const MAX_PER_RUN = 100;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const parse = (v: unknown) => { if (v == null) return null; if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v; };
const STRUCTURAL = new Set(["truss", "platform", "masking", "fixed"]);
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

  // One-time skip flag — Studio UI can set this to skip a single nightly run.
  const skipFlag = await getKv("batch-tagger-skip-next");
  if (skipFlag === true || skipFlag === "true") {
    await db.from("settings").upsert({ key: "batch-tagger-skip-next", value: JSON.stringify(false) }, { onConflict: "key" });
    return json({ ok: true, tagged: 0, message: "skipped — one-time skip was scheduled via Studio UI" });
  }

  const [taxonomy, rateCard, palette, kb, hiddenSubs] = await Promise.all(
    [TAX_SK, RC_SK, PALETTE_SK, TAG_KB_SK, TAG_HIDDEN_SUBS_SK].map(getKv));

  // Library is the `library` TABLE (row-per-photo); the full item lives in the `data` JSONB
  // column, typed columns (incl. status/tag_source/tagged_at — migration 008) are mirrors.
  // "untagged" is now a straight indexed column filter instead of a full-table scan + heuristic.
  const rowToItem = (row: any) => (row?.data && typeof row.data === "object" && !Array.isArray(row.data) && Object.keys(row.data).length)
    ? { ...row.data, id: row.id }
    : { id: row.id, name: row.name, url: row.url, tags: row.tags || {}, elements: row.elements || [], dims: row.dims || {} };
  const tax = taxonomy || {};
  const rc = Array.isArray(rateCard) ? rateCard : [];
  const paletteVals = (palette?.paletteCatalogue || []).map((p: any) => p?.name).filter(Boolean);
  const colorVals = paletteVals.length ? paletteVals : (tax.colorPalette || []);

  // One-off backfill: the existing Needs Review pile was tagged under the old rules, so drain
  // it before touching brand-new untagged photos. RETAG_REVIEW_BEFORE is fixed at the moment this
  // backfill went live — retagging sets tagged_at to "now" (after the cutoff), so each photo
  // falls out of this query as soon as it's redone. Once none are left before the cutoff, this
  // branch permanently returns zero rows and the function goes back to untagged-only tagging.
  const RETAG_REVIEW_BEFORE = "2026-07-07T12:16:00.000Z";
  const { data: reviewBacklogRows, error: reviewErr } = await db.from("library")
    .select("*").eq("status", "review").lt("tagged_at", RETAG_REVIEW_BEFORE)
    .order("tagged_at", { ascending: true }).limit(MAX_PER_RUN);
  if (reviewErr) return json({ error: reviewErr.message }, 500);

  let rows = reviewBacklogRows;
  if (!rows || !rows.length) {
    const { data: untaggedRows, error: untErr } = await db.from("library")
      .select("*").eq("status", "untagged").order("created_at", { ascending: true }).limit(MAX_PER_RUN);
    if (untErr) return json({ error: untErr.message }, 500);
    rows = untaggedRows;
  }
  const targets = (rows || []).map(rowToItem).filter((i: any) => i && i.url);
  if (!targets.length) return json({ ok: true, tagged: 0, message: "nothing untagged" });

  // Recent corrections → "learn from these".
  const { data: corr } = await db.from("tag_corrections").select("field, ai_value, corrected_value").order("created_at", { ascending: false }).limit(20);
  const corrText = (corr || []).length
    ? "PREVIOUS HUMAN CORRECTIONS — the corrected value is right:\n" + corr!.map((c) => `- ${c.field}: was "${c.ai_value || "(blank)"}" → correct is "${c.corrected_value || "(blank)"}"`).join("\n")
    : "";

  // Sub-categories flagged not-taggable in Pricing ("cat::sub") — dropped from the vocabulary and
  // the exact-name element list so the batch tagger never re-adds already-costed / IMS-only subs.
  const hiddenSubSet = new Set(Array.isArray(hiddenSubs) ? hiddenSubs.filter((x: any) => typeof x === "string") : []);
  const isSubHidden = (cat: any, sub: any) => hiddenSubSet.has(`${String(cat || "").trim()}::${String(sub || "").trim()}`);
  // Sub-category vocabulary by category (from the rate card).
  const subByCat: Record<string, Set<string>> = {};
  rc.forEach((i: any) => { const c = String(i.cat || "").trim(), s = String(i.sub || "").trim(); if (c && s && !isSubHidden(c, s)) (subByCat[c] = subByCat[c] || new Set()).add(s); });
  const subcatText = Object.keys(subByCat).length ? "Sub-category vocabulary by category:\n" + Object.entries(subByCat).map(([c, s]) => `- ${c}: ${[...s].join(", ")}`).join("\n") : "";
  const elemList = rc.filter((i: any) => !STRUCTURAL.has(i.cat) && !isSubHidden(i.cat, i.sub)).map((i: any) => `"${i.name}"`).join(", ");
  // Names/keywords for structural items that must NEVER appear in the element breakdown (they're
  // captured in the dedicated truss/floor/masking sections — listing them too double-counts).
  const normName = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const structuralNames = new Set(rc.filter((i: any) => STRUCTURAL.has(i.cat)).map((i: any) => normName(i.name)));
  const STRUCT_KW = /\b(box truss|single u truss|u truss|truss|carpet|wall mask|fabric mask|masking|flex print|vinyl print|acrylic panel|genset|platform|riser|flooring)\b/i;
  const dropStructural = (els: any[]) => (Array.isArray(els) ? els : []).filter((e: any) => e && e.name && !structuralNames.has(normName(e.name)) && !STRUCT_KW.test(e.name));
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
1. Use EXACT rate-card names for visible decor elements where possible: ${elemList}
2. For each element estimate quantity; mark items not in the list with "new":true.
3. Do NOT tag structural items (truss/platform/masking/carpet/flex) as elements.
4. LIGHTS — count every light fixture; put the total in "lightCount" (0 if none).
5. MISSING — items you cannot match go in elements with "new":true AND a short note in "unrecognized" ([] if none).
Return ONLY JSON matching the provided schema.`;

  const promptText = [houseRules, corrText, kb?.promptText || "", subcatText, basePrompt].filter(Boolean).join("\n\n");
  const exemplars = (kb?.exemplars || []).slice(0, 4).filter((e: any) => e && e.url);

  const schema = {
    type: "object", additionalProperties: false,
    required: ["name", "tags", "elements", "lightCount", "unrecognized"],
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
      elements: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "qty"], properties: { name: { type: "string" }, qty: { type: "number" }, size: { type: "string" }, detail: { type: "string" }, new: { type: "boolean" } } } },
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
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: [...staticBlocks, { type: "image", source: { type: "url", url: img.url } }] }],
    };
    const resp = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error?.message || `Anthropic ${resp.status}`);
    const text = (data.content || []).map((b: any) => b.text || "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(text);
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
      const patch = { tags: r.tags || {}, elements: dropStructural(r.elements), lightCount: typeof r.lightCount === "number" ? r.lightCount : undefined, unrecognized: Array.isArray(r.unrecognized) ? r.unrecognized : [], _aiTags: r.tags || {}, _aiTagged: true, _aiTaggedAt: Date.now(), tagSource: "nightly", name: (img.name && !String(img.name).startsWith("img ")) ? img.name : (r.name || img.name) };
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

  return json({ ok: true, tagged: ok, failed: fail, scanned: targets.length, skipped_out_of_time: skipped });
});

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
// Auth: trigger with the service-role key as the Bearer token (the cron does this). Secrets:
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected; ANTHROPIC_API_KEY is a project secret
// (already set for the `anthropic` function — shared across all functions).
//
// Deploy:  supabase functions deploy batch-tagger
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIB_SK = "ambria-library-v2", TAX_SK = "ambria-taxonomy-v2", RC_SK = "ambria-ratecard-v4";
const PALETTE_SK = "ambria-palette-v1", TAG_KB_SK = "ambria-tag-knowledgebase-v1";
const MAX_PER_RUN = 50;
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

  // Only the cron / an admin holding the service key may trigger this.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer !== SERVICE_KEY) return json({ error: "unauthorized" }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const getKv = async (key: string) => { const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle(); return parse(data?.value); };

  const [library, taxonomy, rateCard, palette, kb] = await Promise.all(
    [LIB_SK, TAX_SK, RC_SK, PALETTE_SK, TAG_KB_SK].map(getKv));
  if (!Array.isArray(library)) return json({ error: "library blob not found" }, 500);
  const tax = taxonomy || {};
  const rc = Array.isArray(rateCard) ? rateCard : [];
  const paletteVals = (palette?.paletteCatalogue || []).map((p: any) => p?.name).filter(Boolean);
  const colorVals = paletteVals.length ? paletteVals : (tax.colorPalette || []);

  // Untagged = has an image, not human-verified, not already AI-tagged, and no tags yet.
  const isUntagged = (i: any) => i && i.url && !i._verified && !i._aiTagged &&
    !(i.tags && Object.values(i.tags).some((v: any) => Array.isArray(v) && v.length));
  const targets = library.filter(isUntagged).slice(0, MAX_PER_RUN);
  if (!targets.length) return json({ ok: true, tagged: 0, message: "nothing untagged" });

  // Recent corrections → "learn from these".
  const { data: corr } = await db.from("tag_corrections").select("field, ai_value, corrected_value").order("created_at", { ascending: false }).limit(20);
  const corrText = (corr || []).length
    ? "PREVIOUS HUMAN CORRECTIONS — the corrected value is right:\n" + corr!.map((c) => `- ${c.field}: was "${c.ai_value || "(blank)"}" → correct is "${c.corrected_value || "(blank)"}"`).join("\n")
    : "";

  // Sub-category vocabulary by category (from the rate card).
  const subByCat: Record<string, Set<string>> = {};
  rc.forEach((i: any) => { const c = String(i.cat || "").trim(), s = String(i.sub || "").trim(); if (c && s) (subByCat[c] = subByCat[c] || new Set()).add(s); });
  const subcatText = Object.keys(subByCat).length ? "Sub-category vocabulary by category:\n" + Object.entries(subByCat).map(([c, s]) => `- ${c}: ${[...s].join(", ")}`).join("\n") : "";
  const elemList = rc.filter((i: any) => !STRUCTURAL.has(i.cat)).map((i: any) => `"${i.name}"`).join(", ");
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

  const patches: Record<string, any> = {};
  const logs: any[] = [];
  let ok = 0, fail = 0;
  for (const img of targets) {
    try {
      const r = await tagOne(img);
      patches[img.id] = { tags: r.tags || {}, elements: Array.isArray(r.elements) ? r.elements : [], lightCount: typeof r.lightCount === "number" ? r.lightCount : undefined, unrecognized: Array.isArray(r.unrecognized) ? r.unrecognized : [], _aiTags: r.tags || {}, _aiTagged: true, _aiTaggedAt: Date.now(), name: (img.name && !String(img.name).startsWith("img ")) ? img.name : (r.name || img.name) };
      logs.push({ photo_id: img.id, success: true }); ok++;
    } catch (e) {
      logs.push({ photo_id: img.id, success: false, error: String((e as Error)?.message || e) }); fail++;
    }
  }

  // Merge back into the LATEST library blob (re-read right before write to minimise clobber).
  if (ok > 0) {
    const latest = await getKv(LIB_SK);
    const arr = Array.isArray(latest) ? latest : library;
    const merged = arr.map((i: any) => patches[i.id] ? { ...i, ...patches[i.id] } : i);
    await db.from("settings").upsert({ key: LIB_SK, value: JSON.stringify(merged) }, { onConflict: "key" });
  }
  if (logs.length) await db.from("batch_tag_log").insert(logs);

  return json({ ok: true, tagged: ok, failed: fail, scanned: targets.length });
});

// Supabase Edge Function — Gamma Generate API proxy.
//
// Holds the Gamma API key server-side (never in the client bundle) and does the two things Studio
// needs: (1) kick off an AI-designed deck from the cost-sheet content (Gamma actually designs the
// layout — unlike our own PptxGenJS deck or Canva's Design Import, which just places a file as-is),
// and (2) poll it, and once it's done, download the exported pptx server-side and hand the bytes
// back as base64 so the client can feed them straight into the existing Canva import pipeline.
//
// Deploy:
//   supabase functions deploy gamma
//   supabase secrets set GAMMA_API_KEY=...
//
// Client POSTs { action, ...params }. action ∈
//   create_generation { inputText, title, themeId? } · poll_generation { generationId } · list_themes { cursor? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GAMMA_API = "https://public-api.gamma.app/v1.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const API_KEY = Deno.env.get("GAMMA_API_KEY");
  if (!API_KEY) return json({ error: "Gamma secrets not configured" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { action } = body || {};

  try {
    // themeId must be a real ID from Gamma's own list — an unrecognised one is ignored and the deck
    // silently comes back in the default theme, which looks like the prompt failing rather than the
    // theme never being applied. This action makes the valid set visible instead of guessed at.
    if (action === "list_themes") {
      const cursor = body.cursor ? `&cursor=${encodeURIComponent(body.cursor)}` : "";
      const resp = await fetch(`${GAMMA_API}/themes?limit=50${cursor}`, { headers: { "X-API-KEY": API_KEY } });
      const data = await resp.json();
      if (!resp.ok) return json({ error: "Gamma themes failed: " + JSON.stringify(data) }, resp.status || 502);
      return json(data);
    }

    if (action === "create_generation") {
      const { inputText, title } = body;
      if (!inputText) return json({ error: "inputText required" }, 400);

      // Art direction, supplied by Ambria. Gamma responds to concrete instruction far better than
      // to adjectives, and the previous version's insistence on consistency was read as licence to
      // repeat one safe layout — hence "consistent SYSTEM, varied compositions" stated explicitly,
      // and a per-slide brief so each card has a job of its own.
      //
      // HARD LIMIT: Gamma rejects additionalInstructions over 5000 characters with a 400, which
      // reaches the salesperson as "Gamma generation failed" and says nothing about what to change.
      // It is measured after every edit. Anything added here has to come out somewhere else; the slice below is only a
      // backstop, and a truncated prompt loses whichever rule happens to sit last.
      const ART_DIRECTION = [
        "Create a premium Indian luxury wedding décor proposal deck that feels like a bespoke event designer's lookbook / Vogue India / Architectural Digest editorial, NOT a corporate presentation or generic Gamma template. It carries NO PRICING, COSTS, TOTALS or QUANTITIES. Never invent any.",
        "",
        "VISUAL DIRECTION",
        "ONE luxury visual identity across the deck, every slide a different editorial composition. Consistency comes from typography, spacing, colour and grid — NOT from repeating a layout. It should feel LIGHT, WARM, EDITORIAL, BESPOKE, CINEMATIC, INDIAN LUXURY.",
        "",
        "BACKGROUND — CRITICAL",
        "USE THE THEME'S OWN BACKGROUND on EVERY slide, including cover, dividers, mood boards and closing — it carries the studio artwork and must show. Never cover it with a panel, colour block or opaque text box. Keep card corners and edges clear so ornament stays visible. NEVER darken a card or invert to a black, charcoal or navy ground.",
        "",
        "TYPOGRAPHY",
        "Use THE THEME'S OWN FONTS — chosen deliberately, never substituted. Spend the effort on HIERARCHY, with real range: a title several times its caption. As a guide: title 40-54pt, label 10-11pt letter-spaced uppercase, body 13-15pt, caption 10pt — three sizes per card. SET TITLES BOLD: the theme's heaviest display weight, large, with tight letter-spacing — a title should land, not whisper. Body and captions stay light by contrast.",
        "",
        "COLOUR OF TYPE",
        "Deep espresso or warm charcoal for headings and body — never pure black, never grey-on-grey. Labels and captions the same colour at lower opacity. Gold #B89A63 for thin rules, numerals and the occasional accent word only — never a paragraph, never a heading. The photographs carry the strongest colour.",
        "",
        "SPACING — the deck reads cheap when this is wrong",
        "Hold a margin of at least 8% of card width on all four sides, the SAME on every card; nothing but a deliberate full-bleed photograph crosses it. Leave a clear band between a heading and what follows, and between every block — about one line of body text, never less. Line spacing 1.4-1.6 on body copy. Captions sit clear of their image. Grid gutters even, and wide enough to read as separation.",
        "Under-fill every card: three elements with room around them beat five packed in. If a card feels full, take something OFF rather than shrink type or close gaps.",
        "",
        "IMAGES",
        "Every supplied photograph is REAL work by this studio and is the hero. Never replace, invent, distort, substitute or overlap. Use them in the order supplied: left-to-right, then top-to-bottom. Identical corner radius and framing when several sit on one card. A hero photograph goes large and cinematic, and may run full-bleed within a deliberate composition, text over a warm scrim. Prefer real photography over decorative artwork.",
        "",
        "LAYOUT",
        "Do NOT repeat a basic \"text left + image right\" template. Vary the composition on one grid: cinematic hero, asymmetric image + typography, large image with deep negative space, minimal closing. One clear focal point per card; never a centred wall of text. Where a card has a photograph AND a title, set the title and its lines in a COLUMN BESIDE the photograph — never stacked underneath as a caption block. Roughly 60/40, image to text.",
        "",
        "SLIDES",
        "COVER — client name large and confident, the strongest photograph as cinematic hero, small quiet details beneath, deep negative space. A design book opening, not a centred PowerPoint title.",
        "FUNCTION DIVIDER — one powerful photograph with the function name set BESIDE it in a text column, large, bold and elegant, over a tiny editorial label. Asymmetric and dramatic, still light.",
        "MOOD BOARD — different areas of the function as an asymmetric board: one dominant photograph, smaller supporting ones, same grid, generous gutters.",
        "PALETTE — the exact hex values supplied as large swatches or blocks, colour filling the card, a small name beneath each. No bullets, no table, no invented colours.",
        "DESIGN ELEMENT — the FIRST image is the whole zone: large, on one side. The 2-3 images after it are close details cut from that same photograph — stack them in a narrow column on the other side, equal width, even gaps, never larger than the main one. The zone name and 3-4 very short annotations sit with the large image, each on a fine gold leader line pointing into the detail: \"SCULPTURAL FLORALS\", \"SOFT CANDLELIGHT\". An annotated board, not captions underneath.",
        "FLOWER STORY — one atmospheric floral photograph, a large serif statement, a short narrative in generous space. Emotional, not a description.",
        "CLOSING — quiet and confident: studio name large in serif, small contact line, fine gold rule, deep space.",
        "",
        "AVOID",
        "Generic Gamma cards, plain text cards, bullet lists, random coloured grounds, gradients, clipart, stock images, busy pattern, cheap gold effects, heavy borders, scattered collage.",
        "",
        "FINAL RULE",
        "The deck must read as ONE art-directed document while each slide keeps its own rhythm. CONSISTENT SYSTEM ≠ IDENTICAL LAYOUT. It should make the client think: bespoke, sophisticated, worthy of our celebration.",
      ].join("\n");
      const resp = await fetch(`${GAMMA_API}/generations`, {
        method: "POST",
        headers: { "X-API-KEY": API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          inputText,
          textMode: "preserve", // keep our exact numbers/wording — Gamma only redesigns the layout
          format: "presentation",
          cardSplit: "inputTextBreaks", // respects the \n---\n breaks we put between sections
          exportAs: "pptx",
          title: String(title || "Ambria Cost Estimate").slice(0, 500),
          // themeAccent, not noImages. noImages meant a card without one of OUR photos got nothing at
          // all — the cost tables and title card were bare text on a blank ground, which is most of why
          // the deck read as basic. themeAccent lets Gamma dress those cards with the theme's own
          // decorative furniture, while still never inventing a photograph of a wedding that never
          // happened (that would be aiGenerated, and a fake venue shot in a real quote is not on).
          imageOptions: { source: "themeAccent" },
          cardOptions: { dimensions: "16x9" },
          // Dune: a warm sandy TEXTURE, not a flat ground, and no black anywhere.
          //
          // Aurum was picked for being loud where Gold Leaf was too quiet, but its ground is
          // gold/metallic/black and black is not wanted. Gold Leaf is the other extreme — its own tone
          // keywords are "Minimalist, Clean, Subtle, Soft", which is why that deck read as plain.
          // Dune sits between them: light, beige, cream and gold over sandy, earthy texture, with
          // "classy, elegant, luxury, deluxe" as its tone. Warm paper rather than a black slab.
          //
          // Overridable per request so a theme can be trialled without a deploy; ids come from the
          // list_themes action above. Other textured, non-dark options if this one is not right:
          // "creme" (cream/sand, a shade cooler), "finesse" (beige/olive), "flax" (almond/tan).
          themeId: String(body.themeId || "coral-glow"),
          // Sliced as a backstop: Gamma 400s above 5000 characters (see ART_DIRECTION).
          additionalInstructions: ART_DIRECTION.slice(0, 5000),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.generationId) return json({ error: "Gamma generation failed: " + JSON.stringify(data) }, resp.status || 502);
      return json({ generationId: data.generationId, warnings: data.warnings || null });
    }

    if (action === "poll_generation") {
      const { generationId } = body;
      if (!generationId) return json({ error: "generationId required" }, 400);
      const resp = await fetch(`${GAMMA_API}/generations/${generationId}`, { headers: { "X-API-KEY": API_KEY } });
      const data = await resp.json();
      if (!resp.ok) return json({ error: "Gamma poll failed: " + JSON.stringify(data) }, resp.status || 502);
      if (data.status !== "completed") {
        return json({ status: data.status, error: data.error?.message || null });
      }
      if (!data.exportUrl) return json({ error: "Gamma finished but returned no exportUrl" }, 502);
      const fileResp = await fetch(data.exportUrl);
      if (!fileResp.ok) return json({ error: "Failed to download Gamma export: HTTP " + fileResp.status }, 502);
      const bytes = new Uint8Array(await fileResp.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return json({ status: "completed", gammaUrl: data.gammaUrl || null, base64: btoa(binary) });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

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
      // This is 4980. Anything added here has to come out somewhere else; the slice below is only a
      // backstop, and a truncated prompt loses whichever rule happens to sit last.
      const ART_DIRECTION = [
        "Create a premium Indian luxury wedding décor proposal deck that feels like a bespoke event designer's lookbook / Vogue India / Architectural Digest editorial, NOT a corporate presentation or generic Gamma template. It contains NO PRICING, COSTS, TOTALS, QUANTITIES or commercial figures. Never invent any.",
        "",
        "VISUAL DIRECTION",
        "ONE cohesive luxury visual identity across the deck, but every slide a different editorial composition. Consistency comes from typography, spacing, colour palette, image treatment and grid — NOT from repeating the same card layout. The deck should feel: LIGHT · WARM · EDITORIAL · BESPOKE · CINEMATIC · INDIAN LUXURY · PREMIUM.",
        "",
        "BACKGROUND — CRITICAL",
        "A light warm ivory / cream / champagne / pale sand textured ground on EVERY slide, including cover, dividers, mood boards, flower story and closing. Suggested base: #F7F2E8 / #F2E8D8 / #EDE1CF. NEVER use black, near-black, dark brown, navy, purple, blue, green or any dark/full-colour slide background. Do not alternate dark and light slides. Dark espresso/charcoal only for typography. Muted antique gold #B89A63 / #C2A46D only for thin rules, numerals and delicate accents. The photographs provide the strong colour.",
        "",
        "TYPOGRAPHY",
        "A high-contrast luxury display serif similar to Didot, Bodoni, Cormorant Garamond or Canela for major headings; a refined modern sans-serif for captions and small labels. Strong hierarchy: very large elegant serif headlines + tiny letter-spaced uppercase labels + restrained body copy. Never make every text element the same size. Never use heavy corporate sans-serif headings.",
        "",
        "IMAGES",
        "Every supplied photograph is REAL work by the studio and is the hero. Do NOT replace, invent, distort or generate substitute images. Never overlap photographs or let one touch another. Never let images cross the slide edge. Maintain equal margins and intentional whitespace. Use the photographs in the exact order supplied: left-to-right, then top-to-bottom. Identical corner radius/framing when several appear on one slide. When one photograph is the hero, make it large and cinematic; it may be full-bleed within the slide's intentional composition, with text over a subtle warm translucent scrim where necessary. Prefer real photography over decorative artwork or generic patterns.",
        "",
        "LAYOUT PHILOSOPHY",
        "Do NOT repeat a basic \"text left + image right\" template. Use varied editorial compositions on one grid: cinematic hero; asymmetric image + typography; large image with generous negative space; editorial photo grid; annotated designer reference; clean triptych; oversized typography; atmospheric photographic story; minimal closing page. Every slide needs one clear focal point. Never centre a wall of text on an empty card. If a slide feels crowded, remove elements and increase whitespace rather than shrinking typography.",
        "",
        "SLIDE STRUCTURE",
        "COVER — Client/event name large and confident, one strongest photograph as cinematic hero, small quiet details beneath, deep negative space. The opening page of a luxury design book, NOT a centred PowerPoint title slide.",
        "FUNCTION DIVIDER — One powerful photograph from that function, the function name large and elegant across/alongside it, a tiny editorial label. Dramatic but still light and warm.",
        "MOOD BOARD — Different areas/details of the function in an asymmetric editorial grid: one dominant photograph plus smaller supporting ones, aligned to the invisible grid with generous cream gutters. Not a contact sheet.",
        "PALETTE — The exact supplied HEX colours as large elegant swatches/circles/architectural blocks, colour occupying the slide, small refined names beneath each. No bullets or tables. Do not invent colours.",
        "DESIGN ELEMENT — One prominent photograph with 3–4 very short annotations placed around/over it, each on a fine gold leader line pointing to the detail: \"SCULPTURAL FLORALS\", \"SOFT CANDLELIGHT\", \"TEXTURED LINEN\". An architect/designer annotation board, not a caption block.",
        "OPTIONS FOR THE… — The same element from different supplied angles: three equal tiles in one aligned row, numbered subtly 01 / 02 / 03 in muted gold, identical framing and gutters.",
        "FLOWER STORY — One atmospheric floral photograph, a large elegant serif statement, a short supporting narrative in generous space. Emotional and editorial, not descriptive.",
        "CLOSING — Quiet and confident. Warm textured ivory ground, studio name large in serif, small contact line, a fine gold rule, deep negative space.",
        "",
        "PREMIUM DETAILS",
        "Subtle paper texture, fine gold rules, tiny uppercase labels, delicate numerals, refined cropping.",
        "Avoid: generic Gamma cards, random colours, gradients, bullet lists, clipart, stock images, busy patterns, cheap gold effects, excessive borders, scattered collages.",
        "",
        "FINAL RULE",
        "The deck must read as ONE beautifully art-directed document, while each slide has its own visual rhythm. CONSISTENT SYSTEM ≠ IDENTICAL LAYOUT. The result should make the client think: \"This feels bespoke, sophisticated and worthy of our celebration.\"",
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
          themeId: String(body.themeId || "dune"),
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

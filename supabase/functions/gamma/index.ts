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
          // Aurum, not Gold Leaf. Both are luxury gold themes, but Gamma's own tone keywords give the
          // game away: Gold Leaf is "Minimalist, Clean, Subtle, Soft" and was doing exactly that, while
          // Aurum is "Bold, Loud, Complex, Luxury, Deluxe, Expensive" over gold/metallic/black. No
          // amount of prompt wording turns a theme built to be subtle into a vibrant one.
          // Overridable per request so a theme can be trialled without a deploy; ids come from
          // the list_themes action above.
          themeId: String(body.themeId || "aurum"),
          // Art direction. Gamma responds to CONCRETE layout instructions ("full-bleed", "one number
          // per card", "no bullet points") far better than to adjectives like "elegant" — the earlier
          // version of this prompt was mostly adjectives and produced flat text-on-white cards.
          additionalInstructions:
            "AUDIENCE: an Indian luxury wedding client reviewing a décor proposal worth lakhs. This deck must " +
            "feel like a designer's pitch book, not a spreadsheet export.\n\n" +
            "LAYOUT RULES:\n" +
            "- Never centre a wall of text on a blank card. Every card needs a clear focal point and " +
            "asymmetric weighting — image on one side, text block on the other, or full-bleed image with " +
            "an overlaid title.\n" +
            "- A card with a SINGLE photo: the photo IS the card. Full-bleed or near full-bleed. Never a " +
            "small inset thumbnail floating in empty space.\n" +
            "- Every photo supplied is REAL work by this company at this kind of function. When a card has " +
            "one photo and only a line or two of text, use that photograph as the card's own background, " +
            "full-bleed, with the text laid over a soft dark scrim for legibility. Prefer it over the " +
            "theme's decorative artwork every time — a generic pattern says nothing about this event.\n" +
            "- Keep text sparse. Large type for the few words that matter, generous margins around them. " +
            "Avoid bullet lists entirely; prefer short standalone lines with real space between them.\n\n" +
            "IMAGE RULES — these are absolute, break none of them:\n" +
            "- NEVER overlap images. No image may sit on top of, or touch, another. Every image gets its own " +
            "rectangle with clear space around it.\n" +
            "- NEVER let an image cross the edge of the card or run off the bottom. Everything sits inside " +
            "the card with even margins on all four sides.\n" +
            "- Keep the images in the ORDER they appear in the source text, reading left to right, then top " +
            "to bottom. Do not shuffle them.\n" +
            "- Multiple images on one card go in an ALIGNED grid: shared baselines, identical gutters, " +
            "consistent sizing within each row. A calm ordered grid, never a scattered collage.\n" +
            "- The first image on a zone card is the HERO: give it roughly half the card, on its own, larger " +
            "than everything else. The remaining item photos sit together in one even row or a neat 2x2 " +
            "beside or beneath it, all identical in size.\n" +
            "- The short line of text immediately BEFORE each item photo is that photo's name. Keep it with " +
            "its photo as a small caption directly underneath, never orphaned elsewhere on the card.\n" +
            "- Identical corner radius and identical framing on every image on a card.\n\n" +
            "CARD TYPES:\n" +
            "- Title card: cinematic. Client name large and confident, function details small and quiet " +
            "beneath it, deep negative space. This is the first impression.\n" +
            "- Moodboard cards: hero photography dominating the frame. The colour palette is a small refined " +
            "accent — a discreet row of swatches in a corner — never the focal point.\n" +
            "- Zone cards come in pairs. The first holds ONE photo and nothing else: run it full-bleed, with " +
            "the zone name overlaid. The second is titled \"The Pieces\" and holds only item photos: lay them " +
            "out as one row of equal tiles across the card, each with its name in small letter-spaced caps " +
            "directly beneath, sized so every tile and every caption fits inside the card with room to spare.\n" +
            "- Cost tables: a refined financial statement. Generous row height, hairline dividers only, " +
            "figures right-aligned and vertically aligned, no heavy grid lines, no zebra striping, no " +
            "cramped rows. Totals set apart in a heavier weight with space above.\n" +
            "- Summary card: the grand total is the hero — set it large and let it own the card.\n\n" +
            "TYPOGRAPHY: set headings in a high-contrast display serif at a genuinely large size — a heading " +
            "should be several times the body size, not one notch bigger. Figures and captions in a clean " +
            "restrained sans, small and quiet, with wide letter-spacing on the small-caps labels. Never set a " +
            "whole card at one uniform size; the contrast between the largest and smallest type on a card is " +
            "what makes it look designed.\n\n" +
            "COLOUR: lean into the theme's gold, metallic and deep dark grounds. Alternate dark and light " +
            "cards through the deck so it has rhythm instead of page after page of the same ground. Gold as " +
            "thin rules, hairlines and small ornament; let the photographs supply the colour.\n\n" +
            "FINISH — what separates premium from merely tidy: hold the SAME margin on every card so the " +
            "deck feels bound rather than assembled. Align everything to a shared grid; nothing sits at a " +
            "slight angle or a random offset. Give each image a thin gold hairline or a quiet shadow, applied " +
            "identically throughout. Set captions in small letter-spaced caps, well clear of the image edge. " +
            "Fewer elements, larger, with more space between them, beats more elements packed in.\n\n" +
            "Prioritise visual elegance and breathing room over information density. If a card looks crowded, " +
            "give the content more room rather than shrinking the type. A card that feels empty but confident " +
            "is better than a card that feels full.",
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

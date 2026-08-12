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

      // Art direction. Gamma responds to CONCRETE layout instructions ("full-bleed", "aligned grid",
      // "no bullet lists") far better than to adjectives like "elegant" — an earlier version of this
      // was mostly adjectives and produced flat text-on-white cards.
      //
      // HARD LIMIT: Gamma rejects additionalInstructions over 5000 characters with a 400, which reaches
      // the salesperson as "Gamma generation failed" and says nothing about what to change. It is kept
      // well under, and sliced below as a backstop so a later edit cannot break the export outright.
      const ART_DIRECTION = [
        "AUDIENCE: an Indian luxury wedding client reviewing a décor proposal. This is a designer's pitch book, not a spreadsheet. THE DECK CARRIES NO PRICING — no costs, totals or figures appear anywhere in the content, and none may be invented. It sells the design.",
        "",
        "LAYOUT:",
        "- Never centre a wall of text on a blank card. Every card needs one clear focal point and asymmetric weighting.",
        "- Keep text sparse: large type for the few words that matter, generous margins. No bullet lists — short standalone lines with real space between them.",
        "- Every photo supplied is REAL work by this studio. Where a card holds one photo and a line or two of text, run that photo full-bleed as the card's own background with the text over a soft dark scrim. Always prefer it to the theme's decorative artwork; a generic pattern says nothing about this event.",
        "",
        "IMAGES — absolute, break none of them:",
        "- NEVER overlap images and never let one touch another. Each gets its own rectangle with clear space around it.",
        "- NEVER let an image cross the card edge or run off the bottom. Even margins on all four sides.",
        "- Keep the images in the ORDER they appear in the source text, left to right then top to bottom.",
        "- Several images on one card go in an ALIGNED grid: shared baselines, identical gutters, consistent sizing. A calm ordered grid, never a scattered collage.",
        "- Identical corner radius and identical framing on every image on a card.",
        "",
        "CARDS:",
        "- Title: cinematic. Client name large and confident, details small and quiet beneath, deep negative space.",
        "- Function divider: one photograph full-bleed with the function name set large across it. A chapter opening.",
        "- Mood board: photographs of DIFFERENT areas of that function as one considered board. Vary tile sizes so it composes rather than tiles, but keep every tile on the same grid.",
        "- Palette: real swatches — generous blocks or circles in the hex values given, each name small beneath. This card is about colour, so let colour fill it; never reduce it to a bulleted list of names.",
        "- Element (one photograph, a few short phrases): the photograph fills the card and the phrases sit as CALLOUTS over or beside it, each with a fine leader line or discreet marker pointing into the image, the way a designer annotates a reference. Not a caption block stacked underneath.",
        "- \"Options for the …\": the same element from other angles. Equal tiles in one row, numbered 1, 2, 3 in small gold numerals.",
        "- Flower story: one atmospheric photograph with the prose set over it in a generous measure, larger than a caption.",
        "- Closing: quiet and confident — studio name, contact line, deep space.",
        "",
        "TYPOGRAPHY: headings in a high-contrast display serif at several times the body size, not one notch bigger. Captions in a restrained sans, small, in wide letter-spaced caps. Never set a whole card at one uniform size — that contrast is what makes it look designed.",
        "",
        "COLOUR: lean into the theme's gold, metallic and deep dark grounds. Alternate dark and light cards through the deck so it has rhythm. Gold as thin rules and small ornament; let the photographs supply the colour.",
        "",
        "FINISH: hold the SAME margin on every card so the deck feels bound rather than assembled. Align everything to a shared grid — nothing at a slight angle or a random offset. One image treatment throughout. Fewer elements, larger, with more space between them, beats more elements packed in. If a card looks crowded, give the content more room rather than shrinking the type.",
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
          // Aurum, not Gold Leaf. Both are luxury gold themes, but Gamma's own tone keywords give the
          // game away: Gold Leaf is "Minimalist, Clean, Subtle, Soft" and was doing exactly that, while
          // Aurum is "Bold, Loud, Complex, Luxury, Deluxe, Expensive" over gold/metallic/black. No
          // amount of prompt wording turns a theme built to be subtle into a vibrant one.
          // Overridable per request so a theme can be trialled without a deploy; ids come from
          // the list_themes action above.
          themeId: String(body.themeId || "aurum"),
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

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
//   create_generation { inputText, title } · poll_generation { generationId }

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
          imageOptions: { source: "noImages" }, // only OUR embedded Cloudinary photos, no AI/stock filler
          cardOptions: { dimensions: "16x9" },
          themeId: "gold-leaf", // Gamma's built-in gold/champagne/ivory luxury theme — matches Ambria's actual brand palette
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
            "- Any card containing a photo: the photo IS the card. Full-bleed or near full-bleed, edge to " +
            "edge. Never a small inset thumbnail floating in white space.\n" +
            "- Multiple photos on one card: an editorial collage or asymmetric grid with tight, even gutters " +
            "— a magazine spread, not a row of equal boxes.\n" +
            "- Keep text sparse. Large type for the few words that matter, generous margins around them. " +
            "Avoid bullet lists entirely; prefer short standalone lines with real space between them.\n\n" +
            "CARD TYPES:\n" +
            "- Title card: cinematic. Client name large and confident, function details small and quiet " +
            "beneath it, deep negative space. This is the first impression.\n" +
            "- Moodboard cards: hero photography dominating the frame. The colour palette is a small refined " +
            "accent — a discreet row of swatches in a corner — never the focal point.\n" +
            "- Zone cards: a gallery of that zone's actual pieces. Lead with the zone's hero shot; the item " +
            "photos sit beneath as a clean secondary strip with names as small captions.\n" +
            "- Cost tables: a refined financial statement. Generous row height, hairline dividers only, " +
            "figures right-aligned and vertically aligned, no heavy grid lines, no zebra striping, no " +
            "cramped rows. Totals set apart in a heavier weight with space above.\n" +
            "- Summary card: the grand total is the hero — set it large and let it own the card.\n\n" +
            "STYLING: elegant serif or high-contrast display type for headings; clean restrained sans for " +
            "figures and captions. Tasteful gold accents as thin rules and small details, never as fills or " +
            "large blocks. Muted ivory and champagne grounds. Consistent margins across every card so the " +
            "deck reads as one designed object.\n\n" +
            "Prioritise visual elegance and breathing room over information density. If a card looks crowded, " +
            "give the content more room rather than shrinking the type.",
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

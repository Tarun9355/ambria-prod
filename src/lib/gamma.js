// Gamma Generate API client — the browser never sees the Gamma API key; every call goes through
// the `gamma` Supabase Edge Function, which holds it server-side. Mirrors src/lib/canva.js's plain-
// fetch pattern.
//
// Flow: turn the cost-sheet content into a markdown outline (see StudioSummary.jsx), hand it to
// Gamma so its AI actually designs the deck (unlike our own hand-coded PptxGenJS layout), export it
// as pptx, then feed those bytes into the existing Canva import pipeline for a final editable draft.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = `${SUPABASE_URL}/functions/v1/gamma`;

async function callGammaFn(action, params = {}) {
  const resp = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(data.error || `Gamma API HTTP ${resp.status}`);
  return data;
}

export const gammaCreateGeneration = (inputText, title) =>
  callGammaFn("create_generation", { inputText, title }).then((d) => d.generationId);

// Returns { status, gammaUrl, base64, error } — base64 (the exported pptx) is only present once
// status === "completed".
export const gammaPollGeneration = (generationId) => callGammaFn("poll_generation", { generationId });

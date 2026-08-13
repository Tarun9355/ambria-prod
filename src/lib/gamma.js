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

// themeId decides how the deck LOOKS — it outranks anything the art-direction prompt says about
// grounds or fonts, so this is the control that matters. Omitted, the edge function falls back to
// its own default.
export const gammaCreateGeneration = (inputText, title, themeId) =>
  callGammaFn("create_generation", { inputText, title, ...(themeId ? { themeId } : {}) }).then((d) => d.generationId);

// The workspace's themes, custom ones first — those are Ambria's own, and what a salesperson is
// actually looking for in a list of fifty. Cached for the tab: the list changes when someone builds
// a theme in Gamma, which is not something worth re-fetching on every visit to Summary.
let themeCache = null;
export async function gammaThemes() {
  if (themeCache) return themeCache;
  const d = await callGammaFn("list_themes");
  const all = Array.isArray(d?.data) ? d.data : [];
  themeCache = all
    .map((t) => ({ id: t.id, name: t.name || t.id, custom: t.type !== "standard" }))
    .sort((a, b) => (b.custom - a.custom) || a.name.localeCompare(b.name));
  return themeCache;
}

// Returns { status, gammaUrl, base64, error } — base64 (the exported pptx) is only present once
// status === "completed".
export const gammaPollGeneration = (generationId) => callGammaFn("poll_generation", { generationId });

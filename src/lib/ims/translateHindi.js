// Auto-translates a quiz-authoring string (a question, an option, an accepted answer) into
// natural spoken Hindi (Devanagari script). Punch-in briefings are read by crew who may be far
// more comfortable in Hindi than English, so QuizSetupPanel calls this as an admin types; the
// punch-time quiz then shows both.
//
// Gemini first (supabase/functions/gemini — key held as a Supabase secret, never in the bundle),
// Claude as the fallback (lib/ai.js → supabase/functions/anthropic) so translation keeps working
// if the Gemini secret isn't set yet or Gemini has a bad moment.
import { callClaudeStreaming } from "../ai";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function viaGemini(text, system) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/gemini`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify({ text, system, maxTokens: 300 }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return (data.text || "").trim();
}

/**
 * @param {string} text the admin's own typed source text
 * @param {"hinglish"|"english"} mode what script/language `text` is in — Hinglish (Hindi words
 *   spelled in Roman letters, e.g. "sabse pehle mask pehno") needs transliteration AND translation
 *   together, plain English just needs translation.
 * @returns {Promise<string|null>} the Hindi translation, or null if both providers fail — the
 *   caller leaves the Hindi field exactly as it was rather than blocking or clearing it over a
 *   translation hiccup. Empty input translates to "" with no call.
 */
export async function translateToHindi(text, mode = "hinglish") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const system = mode === "hinglish"
    ? "You translate Hinglish (Hindi words spelled out in Roman/English letters, sometimes mixed with English words) into natural, simple spoken Hindi written in Devanagari script. Reply with ONLY the Hindi translation — no quotes, no romanization, no explanation."
    : "You translate English into natural, simple spoken Hindi written in Devanagari script, suitable for instructions read aloud to event-crew staff. Reply with ONLY the Hindi translation — no quotes, no explanation.";
  try {
    const out = await viaGemini(trimmed, system);
    if (out) return out;
  } catch { /* fall through to Claude */ }
  try {
    const out = await callClaudeStreaming({ contentBlocks: [{ type: "text", text: trimmed }], system, maxTokens: 300 });
    return (out || "").trim() || null;
  } catch {
    return null;
  }
}

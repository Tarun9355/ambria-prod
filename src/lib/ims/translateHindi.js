// Auto-translates a quiz-authoring string (a question, an option, an accepted answer) into
// natural spoken Hindi (Devanagari script), via the same Claude proxy Inventory's photo-scan
// already uses (lib/ai.js → supabase/functions/anthropic) — no separate translation API/key to
// provision. Punch-in briefings are read by crew who may be far more comfortable in Hindi than
// English, so QuizSetupPanel calls this as an admin types; the punch-time quiz then shows both.
import { callClaudeStreaming } from "../ai";

/**
 * @param {string} text the admin's own typed source text
 * @param {"hinglish"|"english"} mode what script/language `text` is in — Hinglish (Hindi words
 *   spelled in Roman letters, e.g. "sabse pehle mask pehno") needs transliteration AND translation
 *   together, plain English just needs translation. Wrong mode still produces a plausible Hindi
 *   sentence (Claude infers either way), it just isn't the one the admin meant.
 * @returns {Promise<string|null>} the Hindi translation, or null on any failure (offline, rate
 *   limit, a blank reply) — the caller leaves the Hindi field exactly as it was rather than
 *   blocking or clearing it over a translation hiccup. Empty input translates to "" with no call.
 */
export async function translateToHindi(text, mode = "hinglish") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const system = mode === "hinglish"
    ? "You translate Hinglish (Hindi words spelled out in Roman/English letters, sometimes mixed with English words) into natural, simple spoken Hindi written in Devanagari script. Reply with ONLY the Hindi translation — no quotes, no romanization, no explanation."
    : "You translate English into natural, simple spoken Hindi written in Devanagari script, suitable for instructions read aloud to event-crew staff. Reply with ONLY the Hindi translation — no quotes, no explanation.";
  try {
    const out = await callClaudeStreaming({
      contentBlocks: [{ type: "text", text: trimmed }],
      system,
      maxTokens: 300,
    });
    const clean = (out || "").trim();
    return clean || null;
  } catch {
    return null;
  }
}

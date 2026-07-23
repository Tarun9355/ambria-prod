import { supabase } from "../supabase";

// The taxonomy tag fields we track corrections for.
const FIELDS = ["eventType", "venueType", "areasElements", "colorPalette", "categoryTier", "designStyle", "timeSetting"];
const asArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const normVal = (v) => asArr(v).map((x) => String(x).trim()).filter(Boolean).sort().join(", ");

/**
 * Record the per-field AI-vs-human tag diff: compare what the AI suggested (aiTags) to what the
 * human saved (finalTags) and write one row per changed field to tag_corrections. This is the
 * LEARNING signal — recent rows are rendered back into the tagging prompt (see renderCorrectionsText,
 * below). No-op if nothing changed or there was no AI suggestion to compare.
 *
 * NOT to be confused with logVerificationEvent (photoCorrections.js → photo_corrections), which is
 * the "who verified what, when" audit/leaderboard. Both fire from "Save & Verify".
 */
export async function logFieldCorrections(photoId, aiTags, finalTags, by) {
  if (!photoId || !aiTags || !finalTags) return 0;
  const rows = [];
  for (const f of FIELDS) {
    const a = normVal(aiTags[f]);
    const c = normVal(finalTags[f]);
    if (a !== c) rows.push({ photo_id: photoId, field: f, ai_value: a, corrected_value: c, corrected_by: by || null });
  }
  if (!rows.length) return 0;
  try { await supabase.from("tag_corrections").insert(rows); } catch { /* best-effort */ }
  return rows.length;
}

/** Most recent corrections (newest first) — fed into the tagging prompt as "learn from these". */
export async function fetchRecentCorrections(limit = 20) {
  try {
    const { data } = await supabase
      .from("tag_corrections")
      .select("field, ai_value, corrected_value")
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  } catch {
    return [];
  }
}

/** Render recent corrections into a compact prompt block. Empty string when there are none. */
export function renderCorrectionsText(corrections) {
  const list = (corrections || []).filter((c) => c && c.field && (c.corrected_value || c.ai_value));
  if (!list.length) return "";
  const lines = list.slice(0, 20).map((c) =>
    `- ${c.field}: was tagged "${c.ai_value || "(blank)"}" but the correct value is "${c.corrected_value || "(blank)"}"`);
  return "PREVIOUS HUMAN CORRECTIONS — learn from these; the corrected value is right, the AI's earlier guess was wrong:\n" + lines.join("\n");
}

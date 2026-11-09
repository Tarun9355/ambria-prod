// ── DATA NAMES IN DEVANAGARI, FOR THE HINDI BOOK ──
// The Hindi Dept Ops PDF (DepartmentOpsTab's buildReportHtml, lang "hi") prints item, zone, colour,
// flower, client and venue names in Devanagari as the crew says them (owner decision 2026-11-01):
// a TRANSLITERATION, not a translation — "Iron Wooden Coffee Table" → "आयरन वुडन कॉफ़ी टेबल".
// Digits, sizes, codes and symbols stay as they are inside a name ("Couch 13" keeps 13).
//
// Names are open-ended (600+ inventory items, typed zone names, client names), so there is no fixed
// dictionary: a name is asked of the AI the first time a Hindi book needs it, and the answer is kept
// in the `hindi_names` table (migration 053, shared by every device) and in this browser's cache.
// Nothing here ever throws to the export: a name the AI could not do simply stays English.
import { callClaudeStreaming } from "../ai";

const CACHE_KEY = "ims.hindiNames";
const BATCH = 60;
const TIME_CAP_MS = 20000;

/** Trimmed, inner spaces collapsed — the form a name is shown and sent in. */
export const normName = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
/** The lookup key: the normalised name, lower-cased. */
export const nameKey = (s) => normName(s).toLowerCase();
/** True when the text holds Devanagari. */
export const isDevanagari = (s) => /[ऀ-ॿ]/.test(String(s ?? ""));
/** Worth transliterating: it has Latin letters and is not already Hindi. */
export const needsHindi = (s) => /[A-Za-z]/.test(String(s ?? "")) && !isDevanagari(s);

/**
 * The AI's reply → { key: hindi }. Tolerates code fences and chatter around the JSON object; keeps a pair only when
 * its value is a non-empty string with Devanagari in it. Keys are the lookup keys (nameKey) of the names it sent back.
 */
export function parseHindiReply(reply) {
  const out = {};
  let s = String(reply ?? "").replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return out;
  s = s.slice(a, b + 1);
  let obj;
  try { obj = JSON.parse(s); } catch { return out; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    const hi = normName(v);
    if (!hi || !isDevanagari(hi) || !nameKey(k)) continue;
    out[nameKey(k)] = hi;
  }
  return out;
}

/** Splits a list into batches of at most n. */
export const batches = (list, n = BATCH) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

export const HINDI_NAMES_PROMPT = [
  "You transliterate names used by an Indian wedding and event decor company into Hindi (Devanagari script), spelled the way its Hindi-speaking crew says them out loud.",
  "TRANSLITERATE, do not translate: keep each English word as the crew pronounces it (\"Iron Wooden Coffee Table\" → \"आयरन वुडन कॉफ़ी टेबल\", \"Chivari Chair\" → \"चिवारी चेयर\", \"Rose Gold\" → \"रोज़ गोल्ड\").",
  "Words that are already Hindi written in Roman letters go into Devanagari as Hindi (\"Mandap\" → \"मंडप\", \"Genda\" → \"गेंदा\").",
  "Keep digits, sizes, measurements, codes and symbols exactly as they are (\"3+1+1 =5 Seater Sofa\" → \"3+1+1 =5 सीटर सोफ़ा\", \"Couch 13\" → \"काउच 13\", \"6ft\" stays \"6ft\").",
  "The input is a JSON array of names. Reply with ONLY a JSON object mapping each original name, exactly as given, to its Devanagari spelling: {\"<original>\": \"<devanagari>\"}. No code fences, no explanation.",
].join(" ");

const readCache = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};
const writeCache = (pairs) => {
  try {
    const cur = readCache();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cur, ...pairs }));
  } catch { /* storage full or blocked: the table still has them */ }
};

/** key → Devanagari: this browser's cache, then the shared `hindi_names` rows over it. Never throws. */
export async function loadHindiNames() {
  const map = new Map();
  Object.entries(readCache()).forEach(([k, v]) => { if (typeof v === "string" && isDevanagari(v)) map.set(k, v); });
  try {
    const { supabase } = await import("../supabase");
    // PAGED: no .limit()/.range() here still means PostgREST's own 1000-row max-rows applies,
    // silently. Names are open-ended per the file header (every inventory item, zone, client and
    // venue name ever asked for) — a years-old deployment easily passes 1000 distinct names, past
    // which this would quietly stop finding some of them and print them in English instead, with
    // no error and nothing to say why just that one name didn't come out in Devanagari.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("hindi_names").select("en, hi").range(from, from + PAGE - 1);
      if (error || !Array.isArray(data)) break;
      data.forEach(r => { if (r?.en && r?.hi && isDevanagari(r.hi)) map.set(nameKey(r.en), String(r.hi)); });
      if (data.length < PAGE) break;
    }
  } catch { /* table not there yet / offline: the cache alone */ }
  return map;
}

async function viaGemini(text, system) {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const resp = await fetch(`${url}/functions/v1/gemini`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ text, system, maxTokens: 4000 }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return (data.text || "").trim();
}

async function askBatch(list) {
  const text = JSON.stringify(list);
  try {
    const got = parseHindiReply(await viaGemini(text, HINDI_NAMES_PROMPT));
    if (Object.keys(got).length) return got;
  } catch { /* Claude next */ }
  try {
    return parseHindiReply(await callClaudeStreaming({ contentBlocks: [{ type: "text", text }], system: HINDI_NAMES_PROMPT, maxTokens: 4000 }));
  } catch { return {}; }
}

/**
 * Fills `map` with the Devanagari of every name in `names` it does not have yet: asked of the AI in batches of 60,
 * each batch's answers saved to `hindi_names` and this browser's cache as it arrives. The book waits ~20s; whatever is not back by
 * then stays English in THAT book but is still saved when it arrives, for the next one. Returns the same map.
 */
export async function ensureHindiNames(names, map) {
  const want = [];
  const seen = new Set();
  (names || []).forEach(n => {
    const k = nameKey(n);
    if (!k || seen.has(k) || map.has(k) || !needsHindi(n)) return;
    seen.add(k);
    want.push(normName(n));
  });
  if (!want.length) return map;
  // Each batch is saved the moment it comes back - also after the ~20s cap, when the book has already gone out in English: only what
  // arrived in time used to be saved, so a big first Hindi book timed out every export and the names never reached the table (owner
  // report 2026-11-02: item and flower names printing in English). The next book then finds them.
  const save = async (pairs) => {
    if (!Object.keys(pairs).length) return;
    writeCache(pairs);
    try {
      const { supabase } = await import("../supabase");
      const now = new Date().toISOString();
      await supabase.from("hindi_names").upsert(Object.entries(pairs).map(([en, hi]) => ({ en, hi, updated_at: now })), { onConflict: "en" });
    } catch { /* table not created yet: the cache keeps them */ }
  };
  const work = Promise.all(batches(want).map(async (list) => {
    const got = await askBatch(list);
    const asked = new Set(list.map(nameKey));
    const pairs = {};
    Object.entries(got).forEach(([k, v]) => { if (asked.has(k)) { map.set(k, v); pairs[k] = v; } });
    await save(pairs);
  })).catch(() => {});
  await Promise.race([work, new Promise(r => setTimeout(r, TIME_CAP_MS))]);
  return map;
}

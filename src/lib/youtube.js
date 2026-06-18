// YouTube Data API access via the Supabase `youtube` Edge Function (proxy holds YT_API_KEY).
// Faithful replacement for the reference's `/api/youtube?action=…` GET calls — same actions
// (playlistItems / videos / search) and passthrough params; we POST { action, params }.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = `${SUPABASE_URL}/functions/v1/youtube`;

export async function ytApi(action, params = {}) {
  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify({ action, params }),
  });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  return r.json();
}

// Parse an ISO-8601 duration (PT#M#S) to "M:SS" — faithful to the reference formatter.
export function ytDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return "";
  const h = +(m[1] || 0), min = +(m[2] || 0), s = +(m[3] || 0);
  const mm = h > 0 ? `${h}:${String(min).padStart(2, "0")}` : `${min}`;
  return `${mm}:${String(s).padStart(2, "0")}`;
}

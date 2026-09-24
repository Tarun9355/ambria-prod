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
  if (!r.ok) {
    // The Edge Function (supabase/functions/youtube/index.ts) forwards YouTube's own error body
    // through verbatim — {error:{code,message,errors:[{reason,...}]}} — but that's exactly what
    // got thrown away here, leaving every caller's `.catch(() => ({}))` (StudioApp.jsx) with
    // nothing to log but a bare status code. Every video on screen then falls back to "Untitled
    // video" with zero trace of WHY — quota, rate limit, a bad key — all look identical. Reading
    // the real body (best-effort; a non-JSON error page still falls back to the plain status) is
    // what actually answers that the next time this fires, straight from the browser console, with
    // no need to go pull Edge Function logs at all.
    let detail = "";
    try { const body = await r.json(); detail = body?.error?.message || body?.error?.errors?.[0]?.reason || JSON.stringify(body); } catch { /* non-JSON error body */ }
    throw new Error(`YouTube ${r.status}${detail ? `: ${detail}` : ""}`);
  }
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

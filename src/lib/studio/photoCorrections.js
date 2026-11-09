import { supabase } from "../supabase";

// One row per human photo/video correction (who verified/edited what, when) — replaces the old
// single-blob "corrections log" (settings key CORR_SK), which silently lost entries whenever two
// people saved around the same time (whole-array read → append → whole-array write-back is not
// atomic). Each save here is a plain INSERT, so concurrent saves from different people never clobber.

const mapRow = (r) => ({
  id: String(r.id),
  user: r.user_name || "—",
  userId: r.user_id || "",
  photoId: r.photo_id || "",
  photoName: r.photo_name || "",
  source: r.source || "build",
  kind: r.kind || "photo",
  ts: r.created_at ? new Date(r.created_at).getTime() : 0,
});

export async function logPhotoCorrection({ photoId, photoName, source, kind, user, userId }) {
  try {
    const { data, error } = await supabase.from("photo_corrections").insert({
      photo_id: photoId || "", photo_name: photoName || "", source: source || "build",
      kind: kind || "photo", user_name: user || "—", user_id: userId || "",
    }).select().single();
    if (error || !data) return null;
    return mapRow(data);
  } catch { return null; }
}

// PAGED: PostgREST caps a single request at 1000 rows regardless of any client .limit(), so a
// team's correction history (one row per photo/video verified or edited — this only grows) would
// silently lose its older rows past that point, undercounting anyone's all-time Contributions tally
// with no error or indication why. Same bug class confirmed and fixed for library zone photos.
//
// Paged ASCENDING (oldest first, id as tiebreaker), not descending: this is an append-only log, so
// paging newest-first means every new "Save & Verify" during the walk inserts a row ahead of the
// cursor — shifting every later page down by one and reading one row twice (one contributor's tally
// overcounted by one). Paging oldest-first instead means a new row lands AFTER the pages already
// read, never shifting anything already walked; the accumulated list is reversed once at the end to
// keep this function's existing newest-first contract for callers.
// Throws on a page error instead of returning whatever was read so far (that read as a complete,
// if short, history — the Contributions leaderboard would just quietly undercount everyone's older
// corrections with no sign anything had gone wrong) — caught by the try/catch below, same as this
// function's existing "fails silent, returns []" contract for any other error.
export async function fetchPhotoCorrections() {
  try {
    const PAGE = 1000;
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from("photo_corrections").select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out.reverse().map(mapRow);
  } catch { return []; }
}

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

export async function fetchPhotoCorrections(limit = 5000) {
  try {
    const { data, error } = await supabase.from("photo_corrections").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) return [];
    return (data || []).map(mapRow);
  } catch { return []; }
}

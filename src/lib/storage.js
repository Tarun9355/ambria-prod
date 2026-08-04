// ─── Supabase Storage uploads ─────────────────────────────────────────────────
// Replaces the Cloudinary unsigned-preset uploads. Everything goes to the `media` bucket via
// the /functions/v1/upload Edge Function, which holds the secret server-side — Storage has no
// unsigned-upload equivalent, and the anon key is public in this bundle, so a direct client
// write would leave the bucket open to anyone who reads the JS.
//
// Callers get back a plain URL string, which is what every previous Cloudinary call site used
// (`data.secure_url`), so swapping them over is a one-line change each.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = `${SUPABASE_URL}/functions/v1/upload`;

/** Folders the Edge Function accepts. Anything else is rejected server-side. */
export const STORAGE_FOLDERS = {
  CLIENT: "client-uploads",
  INVENTORY: "inventory",
  PRODUCTION: "production-ref",
  VOICE: "voice-notes",
  // Mandi flower photos previously went to the Cloudinary root, mixed in with 489 other loose
  // files. Giving them a folder keeps the bucket navigable.
  MANDI: "mandi",
};

/**
 * Upload a File/Blob (or a `data:` URL string) and return its public URL.
 * Throws on failure so call sites can surface a message rather than silently storing "".
 */
export async function uploadToStorage(fileOrDataUrl, folder = STORAGE_FOLDERS.CLIENT) {
  let file = fileOrDataUrl;

  // IMS's add-item form hands over a base64 data: URL rather than a File. Convert it here so
  // every call site can pass whatever it already has.
  if (typeof file === "string") {
    if (!file.startsWith("data:")) throw new Error("Expected a File, Blob or data: URL");
    const res = await fetch(file);
    const blob = await res.blob();
    file = new File([blob], "upload", { type: blob.type || "image/jpeg" });
  }
  if (!(file instanceof Blob)) throw new Error("Nothing to upload");
  // A Blob (e.g. a recorded voice note) has no filename; FormData needs one to send it as a file.
  if (!(file instanceof File)) file = new File([file], "upload", { type: file.type || "application/octet-stream" });

  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);

  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: fd,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `Upload failed (${r.status})`);
  if (!data.url) throw new Error("Upload returned no URL");
  return data.url;
}

/** Voice notes from IMS Department Ops. */
export async function uploadAudioToStorage(blob) {
  return uploadToStorage(blob, STORAGE_FOLDERS.VOICE);
}

// Downscale/compress large images before upload — pure client-side canvas work, unchanged from
// the Cloudinary era beyond the name. Keeps payloads small and upload times short.
export function compressImageForUpload(file, maxW = 2000, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith("image/") || file.size < 200000) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w <= maxW && file.size < 500000) { resolve(file); return; }
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

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
  // Per-size (Small/Medium/Big) reference photos on a flower recipe — what the finished piece
  // actually looks like at that size, distinct from MANDI's raw-flower stock photos.
  RECIPE_REF: "flower-recipe-ref",
};

/**
 * Upload a File/Blob (or a `data:` URL string) and return its public URL.
 * Throws on failure so call sites can surface a message rather than silently storing "".
 */
export async function uploadToStorage(fileOrDataUrl, folder = STORAGE_FOLDERS.CLIENT, opts = {}) {
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
  // Only the library browser sets this. It makes the key the original filename, so tiles read as
  // filenames and a re-upload of the same file lands on the same key instead of a second copy.
  if (opts.keepName) fd.append("name", opts.keepName === true ? file.name : opts.keepName);

  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: fd,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `Upload failed (${r.status})`);
  if (!data.url) throw new Error("Upload returned no URL");
  return opts.detail ? data : data.url;
}

// ─── Browsing ─────────────────────────────────────────────────────────────────
// Listing goes through the same Edge Function for the same reason uploads do: `storage.objects`
// has no public SELECT policy, so the anon key sees zero rows under every prefix. Adding one
// would make the entire bucket enumerable by anyone holding the public key.

async function storageOp(body) {
  const r = await fetch(FN_URL, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `Storage ${body.op} failed (${r.status})`);
  return data;
}

/**
 * One level of the `media` bucket.
 * @returns {Promise<{path:string, folders:{name,path}[], files:{name,path,url,bytes,type,updatedAt}[], truncated:boolean}>}
 */
export function listStorage(path = "", { limit = 500, offset = 0 } = {}) {
  return storageOp({ op: "list", path, limit, offset });
}

/**
 * Every image under `root`, walking subfolders. Pass "" for the whole bucket — that also picks up
 * the loose files sitting at the root, which a hardcoded list of top folders would miss and a
 * cross-check would then report as orphaned.
 *
 * Storage lists one level at a time, so depth costs a request per folder. Measured on the real
 * bucket that's ~190 requests / 5.4k files / ~35s, hence `onProgress`.
 * @param {(info:{folder:string, files:number, visited:number}) => void} [onProgress]
 */
export async function listStorageTree(root, onProgress) {
  const out = [];
  const queue = [root];
  let visited = 0;
  while (queue.length && visited < 2000) {
    const folder = queue.shift();
    visited++;
    for (let page = 0; page < 20; page++) {
      const data = await listStorage(folder, { limit: 500, offset: page * 500 });
      (data.folders || []).forEach((f) => queue.push(f.path));
      (data.files || []).forEach((f) => {
        if (/^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f.name)) out.push(f);
      });
      if (!data.truncated) break;
    }
    onProgress?.({ folder, files: out.length, visited });
  }
  return out;
}

/** Delete objects by key. Returns the number actually removed. */
export async function deleteStorageObjects(keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (!list.length) return 0;
  return (await storageOp({ op: "delete", keys: list })).deleted || 0;
}

/** Delete a folder and everything under it. Storage has no folder entity — this sweeps the keys. */
export async function deleteStorageFolder(path) {
  if (!path) return 0;
  return (await storageOp({ op: "rmdir", path })).deleted || 0;
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

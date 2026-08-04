// Supabase Edge Function — media upload to Storage.
//
// Replaces Cloudinary's unsigned upload preset. Storage has no unsigned equivalent: writing
// needs a key, and the only key a static SPA can hold is the public anon key, which would make
// the bucket writable by anyone who reads the JS bundle. So the secret lives here instead and
// the client posts through this function.
//
// Deploy:
//   supabase functions deploy upload
//
// No secret needs setting. Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into
// every Edge Function automatically — and it *reserves* the SUPABASE_ prefix, so trying to
// set one yourself is rejected. SB_SECRET is read as an optional override if you ever want
// this function using a scoped key rather than the full service role.
//
// Client POSTs multipart/form-data:
//   file    — File | Blob   (required)
//   folder  — string        (optional, default "client-uploads")
// Returns { url, key, bytes } or { error }.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "media";
const MAX_BYTES = 50 * 1024 * 1024;            // matches the bucket's own file_size_limit
const ALLOWED = /^(image\/(jpeg|png|webp|avif|gif|svg\+xml)|video\/(mp4|webm)|audio\/(webm|mpeg|mp4|ogg|wav))$/;

// Folders the app is allowed to write to. An open `folder` parameter would let a caller scatter
// objects anywhere in the bucket, including over paths the migration owns.
const FOLDERS = new Set([
  "client-uploads", "inventory", "production-ref", "voice-notes", "mandi",
  "Ambria Ref", "inhouse venues", "Outside Venues",
]);

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
  "image/gif": "gif", "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm",
  "audio/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav",
};

// Same shape as a Cloudinary public_id: 20 lowercase alphanumerics. Keeps ids visually
// consistent with the 5,130 pre-migration assets and stays collision-safe.
const randomId = () => {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return [...b].map((n) => a[n % a.length]).join("");
};

// Lowercase, spaces to dashes — identical to the migration's key scheme, so folders written
// today sit alongside the migrated ones instead of forking a second naming convention.
const sanitise = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._/-]/g, "-")
    .replace(/-{2,}/g, "-").replace(/(^|\/)[-.]+|[-.]+(\/|$)/g, "$1");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL");
  const SECRET = Deno.env.get("SB_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!URL_ || !SECRET) return json({ error: "Storage credentials not configured" }, 500);

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "No file" }, 400);

    const folderRaw = String(form.get("folder") || "client-uploads");
    if (!FOLDERS.has(folderRaw)) return json({ error: `Folder not allowed: ${folderRaw}` }, 400);

    const type = file.type || "application/octet-stream";
    if (!ALLOWED.test(type)) return json({ error: `Type not allowed: ${type}` }, 400);
    if (file.size > MAX_BYTES) return json({ error: `Too large: ${file.size} bytes` }, 400);

    const key = `${sanitise(folderRaw)}/${randomId()}.${EXT[type] || "bin"}`;

    // apikey, NOT Authorization: Bearer. The sb_secret_* keys are not JWTs and Storage's object
    // endpoint tries to parse a Bearer token as one, answering "Invalid Compact JWS".
    const up = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${key}`, {
      method: "POST",
      headers: { apikey: SECRET, "Content-Type": type, "cache-control": "max-age=31536000" },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!up.ok) return json({ error: `Storage rejected it: ${up.status} ${(await up.text()).slice(0, 200)}` }, 502);

    return json({
      url: `${URL_}/storage/v1/object/public/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`,
      key,
      bytes: file.size,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
});

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
// Client POSTs multipart/form-data to upload:
//   file    — File | Blob   (required)
//   folder  — string        (optional, default "client-uploads"; may be nested)
//   name    — string        (optional; keeps the original filename as the key instead of a random id)
// Returns { url, key, bytes, duplicate? } or { error }.
//
// Client POSTs application/json to browse or prune the bucket. Listing needs the secret for the
// same reason writing does: storage.objects has no public SELECT policy, so the anon key sees
// zero rows for every prefix. Opening one up would make the whole bucket enumerable by anyone.
//   { op: "list",   path?: string, limit?: number, offset?: number }
//     -> { path, folders: [{ name, path }], files: [{ name, path, url, bytes, type, updatedAt }], truncated }
//   { op: "delete", keys: string[] }        -> { deleted: number }
//   { op: "rmdir",  path: string }          -> { deleted: number }   (recursive)

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

const ALLOWED_TOP = new Set([...FOLDERS].map(sanitise));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const publicUrl = (base: string, key: string) =>
  `${base}/storage/v1/object/public/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

// Storage keys are opaque strings, so a caller could otherwise walk out of the bucket root with
// "../" or address the same object two ways. Everything below goes through this first.
const cleanPath = (s: unknown) =>
  String(s || "").replace(/\\/g, "/").split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..").join("/");

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif",
  gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav",
};

// The upload call below authenticates with `apikey` alone because a Bearer header breaks on the
// non-JWT sb_secret_* keys. Which of the two the list/delete endpoints want isn't something we can
// know for a given key shape, so try apikey and fall back on a rejection rather than dead-ending.
async function storageFetch(url: string, secret: string, init: RequestInit) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  let res = await fetch(url, { ...init, headers: { ...headers, apikey: secret } });
  if (res.status === 401 || res.status === 403) {
    res = await fetch(url, { ...init, headers: { ...headers, apikey: secret, Authorization: `Bearer ${secret}` } });
  }
  return res;
}

// One page of storage.objects under `prefix`. Supabase folds anything with a deeper path into a
// synthetic folder row carrying `id: null` — that null is the only thing separating the two.
async function listPrefix(base: string, secret: string, prefix: string, limit: number, offset: number) {
  const res = await storageFetch(`${base}/storage/v1/object/list/${BUCKET}`, secret, {
    method: "POST",
    body: JSON.stringify({
      prefix: prefix ? `${prefix}/` : "",
      limit, offset,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!res.ok) throw new Error(`list ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Array<Record<string, any>>;
}

// Every object key at or below `root`. Storage has no recursive delete: a folder is only an
// implication of the keys under it, so removing one means naming each key.
async function walk(base: string, secret: string, root: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];                         // guards against a pathological tree, not real data
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await listPrefix(base, secret, root, 1000, offset);
    for (const r of rows) {
      const name = String(r?.name || "");
      if (!name) continue;
      const key = `${root}/${name}`;
      if (r?.id == null) out.push(...(await walk(base, secret, key, depth + 1)));
      else out.push(key);
    }
    if (rows.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL");
  const SECRET = Deno.env.get("SB_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!URL_ || !SECRET) return json({ error: "Storage credentials not configured" }, 500);

  // A JSON body means a browse/prune call; multipart still means an upload.
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    try {
      const body = await req.json();
      const op = String(body?.op || "");

      if (op === "list") {
        const path = cleanPath(body.path);
        const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 1000);
        const offset = Math.max(Number(body.offset) || 0, 0);
        const rows = await listPrefix(URL_, SECRET, path, limit, offset);

        const folders: Array<{ name: string; path: string }> = [];
        const files: Array<Record<string, unknown>> = [];
        for (const r of rows) {
          const name = String(r?.name || "");
          if (!name || name === ".emptyFolderPlaceholder") continue;
          const key = path ? `${path}/${name}` : name;
          if (r?.id == null) { folders.push({ name, path: key }); continue; }
          const ext = name.split(".").pop()?.toLowerCase() || "";
          files.push({
            name, path: key,
            url: publicUrl(URL_, key),
            bytes: Number(r?.metadata?.size) || 0,
            type: String(r?.metadata?.mimetype || MIME[ext] || ""),
            updatedAt: r?.updated_at || r?.created_at || null,
          });
        }
        return json({ path, folders, files, truncated: rows.length >= limit });
      }

      if (op === "delete" || op === "rmdir") {
        let keys: string[];
        if (op === "rmdir") {
          const root = cleanPath(body.path);
          if (!root) return json({ error: "rmdir needs a path" }, 400);
          keys = await walk(URL_, SECRET, root);
        } else {
          keys = (Array.isArray(body.keys) ? body.keys : []).map(cleanPath).filter(Boolean);
        }
        if (!keys.length) return json({ deleted: 0 });

        // Storage caps a delete call well below what a folder sweep can produce.
        let deleted = 0;
        for (let i = 0; i < keys.length; i += 100) {
          const res = await storageFetch(`${URL_}/storage/v1/object/${BUCKET}`, SECRET, {
            method: "DELETE",
            body: JSON.stringify({ prefixes: keys.slice(i, i + 100) }),
          });
          if (!res.ok) return json({ error: `delete ${res.status} ${(await res.text()).slice(0, 200)}`, deleted }, 502);
          deleted += ((await res.json()) as unknown[]).length;
        }
        return json({ deleted });
      }

      return json({ error: `Unknown op: ${op}` }, 400);
    } catch (e) {
      return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
    }
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "No file" }, 400);

    // Only the top segment is gated. The browser uploads into subfolders ("inhouse venues/Pushpanjali"),
    // and those are still inside a folder the app owns. The segment is matched after sanitising so
    // both the display name ("Ambria Ref") and the on-disk key the browser reads back ("ambria-ref")
    // resolve to the same allowed folder.
    const folderRaw = cleanPath(form.get("folder") || "client-uploads") || "client-uploads";
    const top = sanitise(folderRaw.split("/")[0]);
    if (!ALLOWED_TOP.has(top)) return json({ error: `Folder not allowed: ${folderRaw}` }, 400);

    const type = file.type || "application/octet-stream";
    if (!ALLOWED.test(type)) return json({ error: `Type not allowed: ${type}` }, 400);
    if (file.size > MAX_BYTES) return json({ error: `Too large: ${file.size} bytes` }, 400);

    // A caller that sends `name` wants the original filename kept — that's the library browser,
    // where the tile caption IS the filename and re-uploading the same file must be recognisable
    // as a duplicate. Everything else (voice notes, inventory photos) stays on random ids.
    const ext = EXT[type] || "bin";
    const wanted = sanitise(String(form.get("name") || "").replace(/\.[^.]+$/, "").split("/").pop() || "");
    const key = `${sanitise(folderRaw)}/${wanted || randomId()}.${ext}`;

    // apikey, NOT Authorization: Bearer. The sb_secret_* keys are not JWTs and Storage's object
    // endpoint tries to parse a Bearer token as one, answering "Invalid Compact JWS".
    const up = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${key}`, {
      method: "POST",
      headers: { apikey: SECRET, "Content-Type": type, "cache-control": "max-age=31536000" },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    // A named upload onto an existing key is the duplicate case, not a failure — the client shows
    // it as "skipped". Storage signals it as HTTP 400 with a "409"/KeyAlreadyExists *body*, not an
    // HTTP 409, so matching on up.status alone silently misses every duplicate.
    if (!up.ok) {
      const detail = (await up.text()).slice(0, 300);
      if (up.status === 409 || /KeyAlreadyExists|"statusCode"\s*:\s*"?409/.test(detail)) {
        return json({ url: publicUrl(URL_, key), key, bytes: file.size, duplicate: true });
      }
      return json({ error: `Storage rejected it: ${up.status} ${detail.slice(0, 200)}` }, 502);
    }

    return json({ url: publicUrl(URL_, key), key, bytes: file.size });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
});

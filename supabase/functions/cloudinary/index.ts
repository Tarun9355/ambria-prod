// Supabase Edge Function — Cloudinary Admin API proxy.
//
// Faithful port of the reference Vercel `/api/cloudinary.js`. Holds the Cloudinary API
// secret server-side and signs Admin API calls (Basic auth). Used to BROWSE existing
// assets (folders / image list / video list) and delete. Image UPLOADS are unsigned
// client-side (src/lib/cloudinary.js) and do NOT go through here.
//
// Deploy:
//   supabase functions deploy cloudinary
//   supabase secrets set CLOUDINARY_API_SECRET=…   (or CLD_API_SECRET — both are read)
//   # optional overrides (defaults match CLAUDE.md): CLD_CLOUD, CLD_API_KEY
//
// Client POSTs { action, ...params }. action ∈
//   folders { path? } · list { prefix?, max_results?, next_cursor? } · list_video { prefix?, max_results?, next_cursor? }
//   · list_by_folder { asset_folder, max_results?, next_cursor? }  (asset-folder tree, dynamic-folder accounts)
//   · delete { public_id } · delete_bulk { public_ids[] } · delete_folder { prefix }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const CLOUD = Deno.env.get("CLD_CLOUD") || "dy9wfqhry";
  const KEY = Deno.env.get("CLD_API_KEY") || "592743487577154";
  const SECRET = Deno.env.get("CLOUDINARY_API_SECRET") || Deno.env.get("CLD_API_SECRET");
  if (!SECRET) return json({ error: "Cloudinary secret not configured" }, 500);

  // Params from query (GET) or JSON body (POST).
  const url = new URL(req.url);
  let p: Record<string, unknown> = Object.fromEntries(url.searchParams.entries());
  if (req.method === "POST") { try { p = { ...p, ...(await req.json()) }; } catch { /* no body */ } }
  const action = String(p.action || "");

  const auth = "Basic " + btoa(`${KEY}:${SECRET}`);
  const BASE = `https://api.cloudinary.com/v1_1/${CLOUD}`;

  try {
    if (action === "folders") {
      const path = String(p.path || "");
      const u = path ? `${BASE}/folders/${path}` : `${BASE}/folders`;
      const r = await fetch(u, { headers: { Authorization: auth } });
      return json(await r.json(), r.status);
    }
    if (action === "list" || action === "list_video") {
      const kind = action === "list_video" ? "video" : "image";
      const prefix = String(p.prefix || "");
      const max = Number(p.max_results) || (kind === "video" ? 100 : 200);
      // Forward next_cursor so the client can page through >max results (was previously dropped).
      const cursor = p.next_cursor ? `&next_cursor=${encodeURIComponent(String(p.next_cursor))}` : "";
      const u = `${BASE}/resources/${kind}?type=upload&prefix=${encodeURIComponent(prefix)}&max_results=${max}${cursor}`;
      const r = await fetch(u, { headers: { Authorization: auth } });
      return json(await r.json(), r.status);
    }
    // List assets by ASSET FOLDER (dynamic-folder accounts) — matches the Media Library tree,
    // unlike public_id `prefix`. Not recursive (one folder); the client walks the tree. Paginated.
    if (action === "list_by_folder") {
      const folder = String(p.asset_folder || p.folder || "");
      const max = Number(p.max_results) || 500;
      const cursor = p.next_cursor ? `&next_cursor=${encodeURIComponent(String(p.next_cursor))}` : "";
      const u = `${BASE}/resources/by_asset_folder?asset_folder=${encodeURIComponent(folder)}&max_results=${max}${cursor}`;
      const r = await fetch(u, { headers: { Authorization: auth } });
      return json(await r.json(), r.status);
    }
    if (action === "delete") {
      const pid = p.public_id;
      if (!pid) return json({ error: "public_id required" }, 400);
      const r = await fetch(`${BASE}/resources/image/upload`, {
        method: "DELETE",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ public_ids: [pid] }),
      });
      return json(await r.json(), r.status);
    }
    if (action === "delete_bulk") {
      const ids = p.public_ids as string[] | undefined;
      if (!ids?.length) return json({ error: "public_ids required" }, 400);
      const r = await fetch(`${BASE}/resources/image/upload`, {
        method: "DELETE",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ public_ids: ids }),
      });
      return json(await r.json(), r.status);
    }
    if (action === "delete_folder") {
      const prefix = String(p.prefix || "");
      if (!prefix) return json({ error: "prefix required" }, 400);
      const lr = await fetch(`${BASE}/resources/image?type=upload&prefix=${encodeURIComponent(prefix)}&max_results=500`, { headers: { Authorization: auth } });
      const ld = await lr.json();
      if (ld.resources?.length) {
        const ids = ld.resources.map((x: { public_id: string }) => x.public_id);
        await fetch(`${BASE}/resources/image/upload`, {
          method: "DELETE",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ public_ids: ids }),
        });
      }
      const r = await fetch(`${BASE}/folders/${prefix}`, { method: "DELETE", headers: { Authorization: auth } });
      return json(await r.json(), r.status);
    }
    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

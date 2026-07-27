// Supabase Edge Function — Canva Connect API proxy.
//
// Holds the Canva Client Secret + the ONE shared account's OAuth tokens server-side (never in the
// client bundle) and proxies the two things Studio needs: (1) completing the OAuth connect flow
// once, from IMS Admin → Settings, and (2) turning a generated cost-sheet PPT into an editable
// Canva design via the Design Import API (no Brand Template / Autofill — that API requires a Canva
// Enterprise org; Import works on any plan and just needs an existing file).
//
// Deploy:
//   supabase functions deploy canva
//   supabase secrets set CANVA_CLIENT_ID=... CANVA_CLIENT_SECRET=... CANVA_REDIRECT_URI=...
//   supabase migration up   (creates canva_integration — RLS enabled, no client policy, service
//                             role only, since it holds a live refresh token)
//
// Client POSTs { action, ...params }. action ∈
//   status {} · oauth_exchange { code, codeVerifier } · create_import { fileBase64, title }
//   · poll_import { jobId }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CANVA_API = "https://api.canva.com/rest/v1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const CLIENT_ID = Deno.env.get("CANVA_CLIENT_ID");
  const CLIENT_SECRET = Deno.env.get("CANVA_CLIENT_SECRET");
  const REDIRECT_URI = Deno.env.get("CANVA_REDIRECT_URI");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) return json({ error: "Canva secrets not configured" }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Edge function not configured" }, 500);
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { action } = body || {};

  const basicAuth = "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  // Exchange a token-endpoint response into our stored row shape and persist it.
  const persistTokens = async (tok: any) => {
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 0) * 1000).toISOString();
    const { error } = await svc.from("canva_integration").upsert({
      id: "default", access_token: tok.access_token, refresh_token: tok.refresh_token,
      expires_at: expiresAt, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Failed to store Canva tokens: " + error.message);
  };

  // A valid access token for the shared account — refreshes (and re-persists, since Canva refresh
  // tokens are single-use and rotate on every exchange) whenever the stored one is expired/near-expiry.
  const getValidAccessToken = async (): Promise<string> => {
    const { data: row } = await svc.from("canva_integration").select("*").eq("id", "default").maybeSingle();
    if (!row?.refresh_token) throw new Error("Canva isn't connected yet — connect it in IMS → Admin → Settings");
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (row.access_token && expiresAt - Date.now() > 60_000) return row.access_token;
    const resp = await fetch(`${CANVA_API}/oauth/token`, {
      method: "POST",
      headers: { Authorization: basicAuth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
    });
    const tok = await resp.json();
    if (!resp.ok || !tok.access_token) throw new Error("Canva token refresh failed: " + (tok.error_description || tok.error || resp.status));
    await persistTokens(tok);
    return tok.access_token;
  };

  try {
    if (action === "status") {
      const { data: row } = await svc.from("canva_integration").select("refresh_token").eq("id", "default").maybeSingle();
      return json({ connected: !!row?.refresh_token });
    }

    if (action === "oauth_exchange") {
      const { code, codeVerifier } = body;
      if (!code || !codeVerifier) return json({ error: "code and codeVerifier required" }, 400);
      const resp = await fetch(`${CANVA_API}/oauth/token`, {
        method: "POST",
        headers: { Authorization: basicAuth, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: REDIRECT_URI,
        }),
      });
      const tok = await resp.json();
      if (!resp.ok || !tok.access_token) return json({ error: "Token exchange failed: " + (tok.error_description || tok.error || resp.status) }, 400);
      await persistTokens(tok);
      return json({ ok: true });
    }

    if (action === "create_import") {
      const { fileBase64, title } = body;
      if (!fileBase64) return json({ error: "fileBase64 required" }, 400);
      const accessToken = await getValidAccessToken();
      const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
      const safeTitle = String(title || "Ambria Cost Sheet").slice(0, 50);
      const importMeta = JSON.stringify({
        title_base64: btoa(unescape(encodeURIComponent(safeTitle))),
        mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      const resp = await fetch(`${CANVA_API}/imports`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream",
          "Import-Metadata": importMeta,
        },
        body: bytes,
      });
      const data = await resp.json();
      if (!resp.ok || !data.job?.id) return json({ error: "Canva import failed: " + JSON.stringify(data) }, resp.status || 502);
      return json({ jobId: data.job.id });
    }

    if (action === "poll_import") {
      const { jobId } = body;
      if (!jobId) return json({ error: "jobId required" }, 400);
      const accessToken = await getValidAccessToken();
      const resp = await fetch(`${CANVA_API}/imports/${jobId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await resp.json();
      if (!resp.ok) return json({ error: "Canva poll failed: " + JSON.stringify(data) }, resp.status || 502);
      const job = data.job || {};
      const design = job.result?.designs?.[0];
      return json({
        status: job.status,
        editUrl: design?.urls?.edit_url || null,
        thumbnailUrl: design?.thumbnail?.url || null,
        error: job.error ? (job.error.message || job.error.code) : null,
      });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

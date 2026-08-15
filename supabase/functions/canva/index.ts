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
//   · poll_import { jobId } · create_export { designId } · poll_export { jobId }
//
// Export needs the design:content:read scope, which the connect flow did not originally ask for.
// A token minted before that was added exports nothing — Canva answers 403 — and the fix is to
// reconnect from IMS Admin → Settings, since scopes are fixed at the moment consent is given.

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
  //
  // `refresh_token` falls back to the one we sent: a refresh response is not required to include a
  // new one, and writing `undefined` over the stored token would silently disconnect the account
  // with no way back except a manual reconnect.
  const persistTokens = async (tok: any, prevRefresh?: string | null) => {
    const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 0) * 1000).toISOString();
    const { error } = await svc.from("canva_integration").upsert({
      id: "default", access_token: tok.access_token, refresh_token: tok.refresh_token || prevRefresh || null,
      expires_at: expiresAt, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Failed to store Canva tokens: " + error.message);
  };

  // Canva kills the WHOLE token chain when a spent refresh token is presented ("token lineage has
  // been revoked"), so a dead lineage has to be recorded — otherwise `status` keeps reporting
  // Connected off the mere presence of a token string and every send fails with no hint that a
  // reconnect is what's needed. Matched narrowly: a transient 5xx must not disconnect a live
  // integration.
  const isDeadLineage = (status: number, tok: any) => {
    const blob = `${tok?.error || ""} ${tok?.error_description || ""} ${tok?.message || ""}`.toLowerCase();
    return (status === 400 || status === 401) && (blob.includes("invalid_grant") || blob.includes("revoke") || blob.includes("lineage"));
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // A valid access token for the shared account.
  //
  // Canva rotates refresh tokens: every exchange returns a new one and invalidates the old, and
  // presenting a spent one revokes the entire lineage permanently. This function is called by
  // create_import AND by every poll_import — the client polls 24 times — and Edge Functions run
  // concurrently, so two invocations used to read the same refresh token and both spend it. The
  // second one killed the connection. That is what "Token lineage has been revoked" was.
  //
  // So the refresh is CLAIMED before Canva is called, not merely serialised after: the damage is
  // the second call itself.
  //
  // The claim is a LEASE, written into `updated_at` as a timestamp in the FUTURE. A plain
  // compare-and-set bump is not enough and was my first attempt: it only blocks callers that read
  // the pre-claim value, while anyone reading after the bump compare-and-sets against the NEW
  // value and claims as well — two refreshes again. A future timestamp is self-describing: any
  // reader can see the lease is still held and wait instead. Taking it is still an atomic CAS, so
  // exactly one invocation wins, and it can't wedge — the lease simply expires.
  const LEASE_MS = 30_000;
  const getValidAccessToken = async (): Promise<string> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row } = await svc.from("canva_integration").select("*").eq("id", "default").maybeSingle();
      if (!row?.refresh_token) throw new Error("Canva isn't connected — reconnect it in IMS → Admin → Settings");
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
      if (row.access_token && expiresAt - Date.now() > 60_000) return row.access_token;

      const now = Date.now();
      const leaseHeldUntil = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const { data: claimed } = leaseHeldUntil > now
        ? { data: [] }                                     // someone is mid-refresh — don't even try
        : await svc.from("canva_integration")
            .update({ updated_at: new Date(now + LEASE_MS).toISOString() })
            .eq("id", "default").eq("updated_at", row.updated_at)
            .select("id");

      if (!claimed?.length) {
        // Another invocation is refreshing. Wait for its token rather than spending ours.
        for (let i = 0; i < 12; i++) {
          await sleep(400);
          const { data: fresh } = await svc.from("canva_integration").select("access_token,expires_at").eq("id", "default").maybeSingle();
          const exp = fresh?.expires_at ? new Date(fresh.expires_at).getTime() : 0;
          if (fresh?.access_token && exp - Date.now() > 30_000) return fresh.access_token;
        }
        continue;   // whoever held it never finished — re-read and try to claim it ourselves
      }

      // Hold the lease only for as long as the exchange takes. Every exit from here — success,
      // Canva error, or a thrown fetch — must put updated_at back in the past, or refreshes are
      // locked out for the rest of the lease window over a blip.
      const releaseLease = () => svc.from("canva_integration")
        .update({ updated_at: new Date().toISOString() }).eq("id", "default");

      let resp: Response;
      try {
        resp = await fetch(`${CANVA_API}/oauth/token`, {
          method: "POST",
          headers: { Authorization: basicAuth, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
        });
      } catch (e) {
        await releaseLease();
        throw new Error("Couldn't reach Canva to refresh the token: " + String((e as Error)?.message || e));
      }

      const tok = await resp.json().catch(() => ({}));
      if (!resp.ok || !tok.access_token) {
        if (isDeadLineage(resp.status, tok)) {
          // Clearing the tokens is what makes `status` honest: it reports Connected off the mere
          // presence of a refresh token, so a revoked one left in place showed a green "Connected"
          // while every send failed, with nothing pointing at Reconnect.
          await svc.from("canva_integration")
            .update({ access_token: null, refresh_token: null, expires_at: null, updated_at: new Date().toISOString() })
            .eq("id", "default");
          throw new Error("Canva disconnected — the authorisation was revoked. Reconnect it in IMS → Admin → Settings");
        }
        await releaseLease();
        throw new Error("Canva token refresh failed: " + (tok.error_description || tok.error || resp.status));
      }
      // persistTokens writes updated_at = now, which releases the lease too.
      await persistTokens(tok, row.refresh_token);
      return tok.access_token;
    }
    throw new Error("Canva token refresh is busy — try again in a moment");
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
      if (!tok.refresh_token) return json({ error: "Canva returned no refresh token — reconnect and grant offline access" }, 400);
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
        // The design's REAL id, which the export endpoint wants. It was dropped here before, so the
        // client had to recover it by regexing the edit URL — and that broke the moment Canva put
        // its JWE edit token first in the path: the export was sent the token as a designId and
        // Canva answered "does not match expected format for designId". Carry the id instead of
        // reconstructing it.
        designId: design?.id || null,
        editUrl: design?.urls?.edit_url || null,
        thumbnailUrl: design?.thumbnail?.url || null,
        error: job.error ? (job.error.message || job.error.code) : null,
      });
    }

    // ── Export a design to PDF ──────────────────────────────────────────────────────────────────
    // The deck is BUILT here and edited in Canva, so Canva holds the current version — including
    // anything the salesperson changed after the import. Rendering our own PDF from the local build
    // would quietly hand the client the pre-edit deck, so the export is asked of Canva instead.
    if (action === "create_export") {
      const { designId } = body;
      if (!designId) return json({ error: "designId required" }, 400);
      const accessToken = await getValidAccessToken();
      const resp = await fetch(`${CANVA_API}/exports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ design_id: designId, format: { type: "pdf" } }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.job?.id) {
        // 403 here is the missing scope, not a broken design — say so, because "export failed" sends
        // someone hunting through the deck for a fault that is in the connection.
        const hint = resp.status === 403
          ? "Canva refused the export — this connection was made before the design:content:read scope existed. Reconnect Canva from IMS Admin → Settings."
          : "Canva export failed: " + JSON.stringify(data);
        return json({ error: hint }, resp.status || 502);
      }
      return json({ jobId: data.job.id });
    }

    if (action === "poll_export") {
      const { jobId } = body;
      if (!jobId) return json({ error: "jobId required" }, 400);
      const accessToken = await getValidAccessToken();
      const resp = await fetch(`${CANVA_API}/exports/${jobId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await resp.json();
      if (!resp.ok) return json({ error: "Canva export poll failed: " + JSON.stringify(data) }, resp.status || 502);
      const job = data.job || {};
      // One URL per exported file. A PDF export is a single file holding every page.
      //
      // Read from BOTH shapes. Imports nest their payload under job.result (see poll_import), and
      // this assumed exports matched — they don't, the urls sit directly on the job. The export
      // then reported success with an empty array and the client said "finished but returned no
      // file", which reads like Canva's fault rather than ours. Accepting either shape means a
      // future move between them can't break it again.
      const urls = job.result?.urls || job.urls
        || (job.result?.url ? [job.result.url] : null) || [];
      return json({
        status: job.status,
        urls,
        // When a success genuinely carries nothing, hand back the job's own keys — enough to see
        // where Canva put the payload, without dumping signed URLs into an error string.
        debug: job.status === "success" && urls.length === 0
          ? { jobKeys: Object.keys(job), resultKeys: Object.keys(job.result || {}) } : undefined,
        error: job.error ? (job.error.message || job.error.code) : null,
      });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

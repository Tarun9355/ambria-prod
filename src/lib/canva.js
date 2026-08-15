// Canva Connect API client — the browser never sees Canva's Client Secret or any access/refresh
// token; every call goes through the `canva` Supabase Edge Function, which holds the secret and
// the ONE shared account's tokens server-side. Mirrors src/lib/ai.js's plain-fetch pattern.
//
// Flow: connect once (admin-only, IMS → Admin → Settings) via OAuth 2.0 + PKCE, then any Studio
// user can turn a generated cost-sheet PPT into an editable Canva design (Design Import API — no
// Brand Template/Autofill, which requires a Canva Enterprise org; Import works on any plan).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Trimmed: the value arrives from a GitHub Actions secret at build time, and a secret pasted with a
// trailing newline bakes that newline into the authorize URL — Canva then answers "The client ID is
// invalid" with nothing on our side saying why.
const CANVA_CLIENT_ID = (import.meta.env.VITE_CANVA_CLIENT_ID || "").trim();
const FN_URL = `${SUPABASE_URL}/functions/v1/canva`;
const VERIFIER_KEY = "canva_oauth_verifier";
const STATE_KEY = "canva_oauth_state";

async function callCanvaFn(action, params = {}) {
  const resp = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) throw new Error(data.error || `Canva API HTTP ${resp.status}`);
  return data;
}

// Base64url (no padding) — used for both the PKCE verifier and its SHA-256 challenge.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Builds the Canva authorize URL (PKCE) and stashes the verifier/state in sessionStorage — the
// browser tab survives the redirect out to Canva and back, so sessionStorage carries them across.
// The Client ID this build sends to Canva. Shown in Admin → Settings → Canva so "The client ID is
// invalid" can be checked against the Developer Portal in one glance — it is baked in at build time
// from a GitHub Actions secret, so the only other way to see it is to unpack the deployed bundle.
// Public by design: the client ID travels in the authorize URL. The SECRET never reaches the client.
export const canvaClientId = () => CANVA_CLIENT_ID;

export async function canvaAuthUrl() {
  if (!CANVA_CLIENT_ID) throw new Error("VITE_CANVA_CLIENT_ID is not configured");
  const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
  const codeVerifier = b64url(verifierBytes);
  const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)));
  const codeChallenge = b64url(challengeBytes);
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
  sessionStorage.setItem(STATE_KEY, state);
  const redirectUri = window.location.origin + import.meta.env.BASE_URL;
  const params = new URLSearchParams({
    // write imports the deck; read exports it back out as a PDF for the preview and the download.
    // Scopes are fixed when consent is given, so a connection made before read was added keeps
    // working for imports and 403s on export until someone reconnects. Both must also be ticked on
    // the integration in Canva's Developer Portal, or Canva refuses the authorize URL outright.
    code_challenge: codeChallenge, code_challenge_method: "s256",
    scope: "design:content:write design:content:read",
    response_type: "code", client_id: CANVA_CLIENT_ID, state, redirect_uri: redirectUri,
  });
  return `https://www.canva.com/api/oauth/authorize?${params.toString()}`;
}

// Called once, on app boot, if the URL carries Canva's redirect (?code=&state=). Returns true if
// this WAS a Canva callback (handled either way — success or failure), so the caller can decide
// whether to show a message and strip the query string.
export async function canvaHandleOAuthRedirect(showMsg) {
  const params = new URLSearchParams(window.location.search);

  // A REFUSED authorization comes back as ?error=&error_description= with no code — a misconfigured
  // integration (scopes not enabled, redirect not registered) lands here, as does the user simply
  // pressing Cancel. Without this branch the app fell through to `return false`, leaving the person
  // on whatever page they started from with the reason sitting unread in the query string.
  const err = params.get("error");
  if (err && !params.get("code")) {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    const why = params.get("error_description") || err;
    showMsg?.(err === "access_denied" ? "Canva connect cancelled" : "Canva connect failed — " + why, "red");
    return true;
  }

  const code = params.get("code");
  if (!code) return false;
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!codeVerifier || params.get("state") !== expectedState) {
    showMsg?.("Canva connect failed — session expired, try again", "red");
    return true;
  }
  try {
    await callCanvaFn("oauth_exchange", { code, codeVerifier });
    showMsg?.("✅ Canva connected", "green");
  } catch (e) {
    showMsg?.("Canva connect failed — " + e.message, "red");
  }
  return true;
}

export const canvaConnectionStatus = () => callCanvaFn("status").then((d) => !!d.connected);
export const canvaCreateImport = (fileBase64, title) => callCanvaFn("create_import", { fileBase64, title }).then((d) => d.jobId);
export const canvaPollImport = (jobId) => callCanvaFn("poll_import", { jobId });

/**
 * The design id inside a Canva edit URL — the FALLBACK path, for decks remembered before the id
 * was stored alongside the link. New decks carry the real id from poll_import and never come here.
 *
 * Canva ids are DA-prefixed, and the edit URL also carries a JWE edit token (eyJhbGci…). Taking
 * "the segment after /design/" assumed the id came first and silently handed the export that token
 * instead once Canva reordered the path — which Canva rejects with "does not match expected format
 * for designId". Matching the id by its own shape doesn't care where in the URL it sits.
 */
export const canvaDesignId = (editUrl) => {
  const s = String(editUrl || "");
  const byShape = s.match(/\b(DA[A-Za-z0-9_-]{6,})\b/);
  if (byShape) return byShape[1];
  // Last resort for any link that doesn't look like either — excludes a leading "eyJ" so a token
  // is never passed off as an id, since a clear error beats a confusing one from Canva.
  const seg = (s.match(/\/design\/([^/?#]+)/) || [])[1] || "";
  return seg.startsWith("eyJ") ? "" : seg;
};

export const canvaCreateExport = (designId) => callCanvaFn("create_export", { designId }).then((d) => d.jobId);
export const canvaPollExport = (jobId) => callCanvaFn("poll_export", { jobId });

/**
 * A finished PDF export of a design, as a URL — polling until Canva has rendered it.
 *
 * Canva renders asynchronously and gives no completion callback, so polling is the only option.
 * Roughly a minute of patience at 2s: a long deck takes a while, and failing early would leave the
 * salesperson with a spinner that stopped for no visible reason.
 */
export async function canvaExportPdfUrl(editUrl, { tries = 30, waitMs = 2000, designId: knownId = "" } = {}) {
  // The stored id wins. Parsing the URL is only for decks made before the id was kept.
  const designId = knownId || canvaDesignId(editUrl);
  if (!designId) throw new Error("Could not read the design id from the Canva link — remake the deck so it is stored with one");
  const jobId = await canvaCreateExport(designId);
  for (let i = 0; i < tries; i++) {
    const res = await canvaPollExport(jobId);
    if (res.status === "success") {
      const url = (res.urls || [])[0];
      // The edge function reports where Canva actually put the payload when it isn't where we
      // looked, so this says what to fix instead of just that it broke.
      if (!url) throw new Error("Canva finished the export but returned no file" + (res.debug ? ` (job had: ${(res.debug.jobKeys || []).join(", ")})` : ""));
      return url;
    }
    if (res.status === "failed") throw new Error(res.error || "Canva could not export this design");
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error("Timed out waiting for Canva to export the deck — try again");
}

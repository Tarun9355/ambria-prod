// Canva Connect API client — the browser never sees Canva's Client Secret or any access/refresh
// token; every call goes through the `canva` Supabase Edge Function, which holds the secret and
// the ONE shared account's tokens server-side. Mirrors src/lib/ai.js's plain-fetch pattern.
//
// Flow: connect once (admin-only, IMS → Admin → Settings) via OAuth 2.0 + PKCE, then any Studio
// user can turn a generated cost-sheet PPT into an editable Canva design (Design Import API — no
// Brand Template/Autofill, which requires a Canva Enterprise org; Import works on any plan).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CANVA_CLIENT_ID = import.meta.env.VITE_CANVA_CLIENT_ID;
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
    code_challenge: codeChallenge, code_challenge_method: "s256", scope: "design:content:write",
    response_type: "code", client_id: CANVA_CLIENT_ID, state, redirect_uri: redirectUri,
  });
  return `https://www.canva.com/api/oauth/authorize?${params.toString()}`;
}

// Called once, on app boot, if the URL carries Canva's redirect (?code=&state=). Returns true if
// this WAS a Canva callback (handled either way — success or failure), so the caller can decide
// whether to show a message and strip the query string.
export async function canvaHandleOAuthRedirect(showMsg) {
  const params = new URLSearchParams(window.location.search);
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

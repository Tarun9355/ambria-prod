# Canva integration — generate an editable PPT draft from the Cost Sheet Preview

## Context

Studio Summary's "📋 Preview & Export Cost Sheet" button (`StudioSummary.jsx`) opens a full-screen
Cost Sheet preview with "📄 PDF" / "📊 PPT" export buttons. The PPT button already builds a full,
branded deck client-side via PptxGenJS (`exportPPT`, ~line 153–403: cover slide, per-function section/
overview/zone/transport slides, event-summary slide) and downloads it as a static `.pptx`. The user
wants a third option next to these: hit it, and instead of downloading a static file, the same deck
gets sent to Canva as an **editable draft** they can open, tweak visually, and export/download from
inside Canva.

Canva's Connect API needs a client secret exchanged server-side, which this static SPA (per
CLAUDE.md — no server runtime) cannot hold; that goes through a new Supabase Edge Function, the same
pattern already used for `anthropic` and `cloudinary`.

**Key finding that shapes the approach:** Canva's *Autofill API* (fill a pre-built Brand Template's
named fields) requires the acting Canva account to belong to a **Canva Enterprise org** — a
non-starter here. Canva's *Design Import API*, however, has no such gating: it just takes an existing
file (PPTX is a supported format) and turns it into a normal editable Canva design, on any plan. Since
`exportPPT` already produces a complete, correctly-branded `.pptx` client-side, the simplest and most
robust path is: **reuse that exact deck-building code, but instead of writing it to disk, upload its
bytes to Canva's Design Import API and hand the salesperson the resulting edit link.** No Brand
Template has to be designed in Canva at all, and nothing about the existing PDF/PPT download buttons
changes.

## Architecture

```
Studio Summary "🎨 Canva" button
  → buildPptx(combined) [refactored out of exportPPT] → pptx object
  → pptx.write({outputType:"base64"})
  → canvaCreateImport(base64, title)  [src/lib/canva.js → supabase/functions/canva]
       edge fn: get/refresh stored access token → POST /rest/v1/imports (Canva)
  → client polls canvaPollImport(jobId) every ~2.5s
       edge fn: GET /rest/v1/imports/{jobId} (Canva)
  → status "success" → show "↗ Open in Canva" (design.urls.edit_url)
```

One shared Canva account (e.g. Tarun's) authorizes the integration **once**; the refresh token is
stored server-side and reused for every salesperson's "Generate" click — this mirrors how the
Cloudinary/Anthropic secrets are handled (never touch the client), and avoids needing per-user Canva
logins for something used a handful of times per deal.

## 1. Manual setup the user must do in Canva (I can't access their account)

1. Enable MFA on the Canva account that will own the integration.
2. Canva Developer Portal → Your integrations → **Create an integration**. Create it as a **public**
   integration but leave it unsubmitted/"in development" — per Canva's docs, accounts on a regular
   paid plan get a working trial while an integration is in development, without needing Enterprise.
   (A **private** integration is Enterprise-gated outright, so public+unpublished is the correct
   choice here, not private.) *Flag: confirm this trial mode is sufficient once the integration is
   created — Canva's own UI will say so immediately if not, and the plan falls back to asking whether
   an Enterprise seat is available.*
3. Configure → note the **Client ID**, generate and copy the **Client secret** (shown once).
4. Scopes: enable `design:content:write` (import + edit), `design:meta:read`, `asset:write` — the
   minimum for design import.
5. Authorized redirect URLs: add the production site URL (GitHub Pages base, e.g.
   `https://<user>.github.io/ambria-prod/`) and, for local dev, `http://127.0.0.1:5173/ambria-prod/`
   (adjust to the actual Vite dev port).
6. Hand me: Client ID, Client secret, and the exact redirect URL(s) registered — I'll wire them in as
   `VITE_CANVA_CLIENT_ID` (client, public) and Supabase secrets `CANVA_CLIENT_SECRET` /
   `CANVA_REDIRECT_URI` (server-only).

## 2. Database — new Supabase migration

New table `canva_integration` (singleton row) holding the OAuth tokens. **RLS enabled, zero client
policies** — unlike the existing `settings` table (which the client reads directly via `kvGet`/anon
key and is therefore unsafe for secrets), this table must only be reachable by the edge function's
service-role client. Columns: `id` (fixed `'default'`), `access_token`, `refresh_token`,
`expires_at timestamptz`, `updated_at timestamptz`.

## 3. Supabase Edge Function — `supabase/functions/canva/index.ts`

Same single-file, action-dispatch shape as `supabase/functions/cloudinary/index.ts`. Secrets:
`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_REDIRECT_URI`. Uses the auto-injected
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars to read/write `canva_integration` (service-role
client, bypasses RLS — never exposed to the browser).

Actions:
- **`oauth_exchange`** `{code, codeVerifier}` — POST to `https://api.canva.com/rest/v1/oauth/token`
  (`grant_type=authorization_code`, Basic auth `client_id:client_secret`), upsert the returned
  `access_token`/`refresh_token`/`expires_at` into `canva_integration`.
- **`status`** — reads `canva_integration`, returns only `{connected: boolean}` (never the tokens).
- **`create_import`** `{fileBase64, title}` — `getValidAccessToken()` (refreshes if
  `expires_at` is near, persisting the *new* refresh token since Canva refresh tokens are single-use),
  then `POST https://api.canva.com/rest/v1/imports` with header `Import-Metadata:
  {"title_base64":"...","mime_type":"application/vnd.openxmlformats-officedocument.presentationml.presentation"}`
  and the decoded bytes as `application/octet-stream` body. Returns `{jobId}`.
- **`poll_import`** `{jobId}` — `getValidAccessToken()`, `GET
  https://api.canva.com/rest/v1/imports/{jobId}`, returns `{status, editUrl, thumbnailUrl, error}`
  (mapping Canva's `job.status`/`job.result.designs[0].urls.edit_url`/`job.error`).

## 4. Client library — `src/lib/canva.js` (new)

Mirrors `src/lib/ai.js`'s plain-fetch-to-edge-function pattern (no `supabase.functions.invoke`, just
`fetch(FN_URL, {headers:{Authorization:Bearer ANON_KEY, apikey: ANON_KEY}})`).

- `canvaAuthUrl()` — builds a PKCE pair with `crypto.subtle.digest("SHA-256", ...)`, stashes
  `code_verifier` in `sessionStorage`, returns the `https://www.canva.com/api/oauth/authorize?...`
  URL (uses public `VITE_CANVA_CLIENT_ID`).
- `canvaOAuthExchange(code, codeVerifier)`, `canvaConnectionStatus()`, `canvaCreateImport(base64,
  title)`, `canvaPollImport(jobId)` — one per edge-function action above.

## 5. OAuth connect UI (one-time, admin-only)

In `AdminSettingsTab.jsx`, add a small "🎨 Canva" panel (same tab-list pattern as the recent Carpet
Materials tab) with a "Connect to Canva" button (→ `canvaAuthUrl()` → `window.location.href =`) and a
connected/not-connected pill (`canvaConnectionStatus()`).

Since the app is a `HashRouter` SPA but Canva's redirect appends `?code=&state=` *before* the hash,
add a small check early in the app bootstrap (`main.jsx` or `App.jsx`): if `location.search` has
`code` and `sessionStorage` has the pending verifier, call `canvaOAuthExchange`, show a brief "Canva
connected ✓" confirmation, strip the query string (`history.replaceState`), then continue to the
normal app render. No new route needed.

## 6. Studio Summary — the actual "Generate" button

`StudioSummary.jsx`, Cost Sheet preview header (~line 655-657, next to the existing PDF/PPT buttons):
- Refactor `exportPPT` to extract its slide-building body into `buildPptx(combined)` returning the
  `pptx` object *before* `writeFile` — reused by both the existing download flow (unchanged) and the
  new Canva flow. Zero behavior change to the existing PDF/PPT buttons.
- New "🎨 Canva" button with local state (`idle | uploading | processing | ready | error`):
  build pptx → `await pptx.write({outputType:"base64"})` → `canvaCreateImport(...)` → poll
  `canvaPollImport` every ~2.5s (cap ~24 tries / 60s) → on success store `editUrl`, button becomes
  "↗ Open in Canva" (`window.open(editUrl, "_blank")`). If `canvaConnectionStatus()` says not
  connected, show "Canva isn't connected — ask an admin to connect it in IMS → Admin → Settings"
  instead of attempting the job.
- Title sent to Canva: `clientName` + first function's date, truncated to Canva's 50-char limit.

## Verification

- `npx vite build`.
- Complete the Canva Developer Portal setup (section 1) and connect via the new Admin panel; confirm
  the pill flips to "Connected".
- From Studio Summary, open the Cost Sheet preview on a real deal, click "🎨 Canva", confirm the job
  reaches `success` and "↗ Open in Canva" opens a design in Canva that matches the downloaded PPT's
  content (cover, per-function slides, totals).
- Confirm the existing "📄 PDF" / "📊 PPT" buttons still work unchanged (regression check on the
  `buildPptx` refactor).
- Confirm a not-yet-connected environment shows the friendly "ask an admin" message instead of a raw
  error.

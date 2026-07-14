// ─── Claude proxy ─────────────────────────────────────────────────────────────
// The reference IMS app called a server route `/api/anthropic` (Vercel). This static
// SPA has no server, so we proxy through a Supabase Edge Function instead
// (supabase/functions/anthropic). The ANTHROPIC_API_KEY lives as a Supabase secret —
// never in the client bundle.
//
// Signature kept identical to the reference `callClaudeStreaming` so the Inventory
// photo-scan code is a faithful copy.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = `${SUPABASE_URL}/functions/v1/anthropic`;

export async function callClaudeStreaming({ contentBlocks, model = "claude-haiku-4-5-20251001", maxTokens = 2000, system, outputConfig, thinking, returnThinking }) {
  const userContent = contentBlocks;
  try {
    const body = { model, max_tokens: maxTokens, messages: [{ role: "user", content: userContent }] };
    if (system) body.system = system;
    // outputConfig → structured outputs (locks JSON to a schema); thinking → adaptive reasoning.
    if (outputConfig) body.output_config = outputConfig;
    if (thinking) body.thinking = thinking;
    const resp = await fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) {
      const msg = data?.error?.message || data?.error || `HTTP ${resp.status}`;
      throw new Error(`API ${resp.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    // returnThinking: callers that want to surface the model's reasoning (e.g. AI-tagging's "why did
    // it match this?") opt in — everyone else keeps the plain-string return shape unchanged.
    if (returnThinking) {
      let text = "", thinkingText = "";
      (data.content || []).forEach((b) => { if (b.type === "thinking") thinkingText += b.thinking || ""; else if (b.text) text += b.text; });
      return { text, thinking: thinkingText };
    }
    return (data.content || []).map((b) => b.text || "").join("");
  } catch (e) {
    throw new Error("Claude API: " + e.message);
  }
}

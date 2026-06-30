// Shared LLM router for edge functions.
//
// Routes chat-completion calls to a provider chosen by env. Default is the
// self-hosted Ollama box (qwen2.5) so inference cost is ~0; Lovable's gateway
// is kept as a fallback for when Ollama is unreachable.
//
// Both providers speak an OpenAI-compatible /chat/completions shape, so callers
// don't change. Streaming and non-streaming are both supported.

export type LlmProvider = "ollama" | "lovable";

export interface LlmMessage { role: string; content: string; }

export interface LlmRequest {
  messages: LlmMessage[];
  stream?: boolean;
}

function defaultProvider(): LlmProvider {
  const v = (Deno.env.get("LLM_DEFAULT_PROVIDER") ?? "ollama").toLowerCase();
  return v === "lovable" ? "lovable" : "ollama";
}

function allowFallback(): boolean {
  return (Deno.env.get("ALLOW_LOVABLE_FALLBACK") ?? "true").toLowerCase() !== "false";
}

const OLLAMA_URL = Deno.env.get("OLLAMA_URL") ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL") ?? "qwen2.5:32b";
const LOVABLE_MODEL = Deno.env.get("LOVABLE_MODEL") ?? "google/gemini-3-flash-preview";

async function callOllama(req: LlmRequest): Promise<Response> {
  // Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions.
  return fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: req.messages,
      stream: req.stream === true,
    }),
  });
}

async function callLovable(req: LlmRequest): Promise<Response> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LOVABLE_MODEL,
      messages: req.messages,
      stream: req.stream === true,
    }),
  });
}

/**
 * Run a chat completion through the preferred provider, falling back to Lovable
 * if Ollama is the primary but unreachable/erroring (and fallback is allowed).
 * Returns the raw upstream Response so the caller can stream or parse it.
 */
export async function routeChatCompletion(req: LlmRequest): Promise<{ response: Response; provider: LlmProvider }> {
  const primary = defaultProvider();

  if (primary === "ollama") {
    try {
      const r = await callOllama(req);
      if (r.ok) return { response: r, provider: "ollama" };
      // Non-OK from Ollama: fall back if allowed.
      if (allowFallback()) return { response: await callLovable(req), provider: "lovable" };
      return { response: r, provider: "ollama" };
    } catch (e) {
      if (allowFallback()) return { response: await callLovable(req), provider: "lovable" };
      throw e;
    }
  }

  // Primary is Lovable.
  return { response: await callLovable(req), provider: "lovable" };
}

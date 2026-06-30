# AI Routing (local-first)

Edge functions route chat completions through `_shared/llmRouter.ts`.

## Why

Every AI call used to hit Lovable's **paid** gateway, so AI cost scaled with
usage and ate into the AI-credit margin. We self-host Ollama (qwen2.5) on a
local GPU box, so routing there first makes the marginal cost of an AI action
~0 — which is exactly what makes the AI-credit business model (#13) near-pure
margin.

## Order

1. **Ollama** (default) — `OLLAMA_URL` `/v1/chat/completions`, model `OLLAMA_MODEL`.
2. **Lovable** (fallback) — used only if Ollama errors / is unreachable and
   `ALLOW_LOVABLE_FALLBACK != false`, or if `LLM_DEFAULT_PROVIDER=lovable`.

Both are OpenAI-compatible, so streaming + JSON-mode behaviour is unchanged.
The chosen provider is returned in the `X-LLM-Provider` response header.

## Env

```
LLM_DEFAULT_PROVIDER=ollama        # ollama | lovable
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:32b
ALLOW_LOVABLE_FALLBACK=true
LOVABLE_API_KEY=...                # only needed for fallback / lovable mode
LOVABLE_MODEL=google/gemini-3-flash-preview
```

> Note: the edge runtime must be able to reach the Ollama box. For local/
> self-hosted Supabase that's direct; for hosted Supabase, expose Ollama via a
> tunnel/private network and set `OLLAMA_URL` accordingly.

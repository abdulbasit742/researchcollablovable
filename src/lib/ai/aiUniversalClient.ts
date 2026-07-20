/**
 * Credited AI client — the single front door to the ai-universal edge function.
 *
 * The server enforces + debits credits (#51) and returns HTTP 402 with
 * { needed, available } when the user can't afford an action. Domain hooks were
 * calling the function ad-hoc and ignoring that, so a broke user got a silent
 * failure. This wrapper turns 402 into a typed InsufficientCreditsError and a
 * clear top-up prompt, and is the path all AI callers should use.
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export class InsufficientCreditsError extends Error {
  constructor(public needed: number, public available: number) {
    super(`Insufficient AI credits: need ${needed}, have ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export interface AIUniversalRequest {
  domain: string;
  action: string;
  context?: unknown;
  messages?: { role: string; content: string }[];
}

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return `Bearer ${token}`;
}

/** Show a consistent "out of credits" prompt that links to the top-up flow. */
export function promptTopUp(needed: number, available: number): void {
  toast.error("Out of AI credits", {
    description: `This action needs ${needed} credits, you have ${available}.`,
    action: { label: "Buy credits", onClick: () => { window.location.href = "/checkout?credits=2000"; } },
  });
}

/**
 * Non-streaming call. Returns the parsed JSON result. Throws
 * InsufficientCreditsError (after showing a top-up toast) on 402.
 */
export async function callAIUniversal<T = unknown>(req: AIUniversalRequest): Promise<T> {
  const res = await fetch(`${FUNCTIONS_BASE}/ai-universal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: await authHeader() },
    body: JSON.stringify({ ...req, stream: false }),
  });

  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    const needed = Number(body.needed ?? 0);
    const available = Number(body.available ?? 0);
    promptTopUp(needed, available);
    throw new InsufficientCreditsError(needed, available);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `AI request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface CreditedStreamArgs extends AIUniversalRequest {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError?: (err: Error) => void;
}

/**
 * Streaming call. Surfaces the same 402 top-up handling before streaming, then
 * pipes SSE deltas to onDelta. (Server debits up front for streams and refunds
 * on upstream error, per #51.)
 */
export async function streamAIUniversal(args: CreditedStreamArgs): Promise<void> {
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/ai-universal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await authHeader() },
      body: JSON.stringify({ domain: args.domain, action: args.action, context: args.context, messages: args.messages, stream: true }),
    });

    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      const needed = Number(body.needed ?? 0);
      const available = Number(body.available ?? 0);
      promptTopUp(needed, available);
      args.onError?.(new InsufficientCreditsError(needed, available));
      return;
    }
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `AI request failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const { done: d, value } = await reader.read();
      if (d) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") { done = true; break; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) args.onDelta(content);
        } catch { /* ignore partial frames */ }
      }
    }
    args.onDone();
  } catch (e) {
    args.onError?.(e instanceof Error ? e : new Error("AI request failed"));
  }
}

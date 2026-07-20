/**
 * useAIWorkflow — Hook for calling AI workflow intelligence features.
 * All outputs are advisory-only and logged.
 *
 * As of #86 this routes through the CREDITED ai-universal client (#73) instead
 * of the standalone ai-workflow edge fn, so every feature gets server-side
 * credit enforcement (#51), the 402 top-up UX, and local-Ollama-first routing
 * (#49). The hook's public API is unchanged.
 */
import { useState, useCallback } from "react";
import { toast } from "sonner";
import { callAIUniversal, InsufficientCreditsError } from "@/lib/ai/aiUniversalClient";

export type AIFeature =
  | "milestone-plan"
  | "enhance-writing"
  | "task-suggestions"
  | "review-analysis"
  | "project-insights";

interface AIWorkflowResult<T = unknown> {
  result: T;
  ai_generated: boolean;
  disclaimer: string;
  tokens_used: number;
}

// Map each workflow feature onto an ai-universal (domain, action). Actions not
// in the server's cost map default to the base cost, so this is safe to extend.
const FEATURE_ROUTE: Record<AIFeature, { domain: string; action: string }> = {
  "milestone-plan":   { domain: "deals",    action: "analyze-scope" },
  "enhance-writing":  { domain: "profile",  action: "optimize-bio" },
  "task-suggestions": { domain: "deals",    action: "analyze-scope" },
  "review-analysis":  { domain: "messages", action: "summarize-conversation" },
  "project-insights": { domain: "career",   action: "coaching-advice" },
};

const DISCLAIMER = "AI-generated and advisory only. Verify before acting.";

export function useAIWorkflow<T = unknown>() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AIWorkflowResult<T> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (feature: AIFeature, input: string, context?: Record<string, unknown>) => {
      setIsLoading(true);
      setError(null);
      setResult(null);

      const route = FEATURE_ROUTE[feature];
      try {
        const data = await callAIUniversal<Record<string, unknown>>({
          domain: route.domain,
          action: route.action,
          context: context ? { input, ...context } : input,
        });

        const wrapped: AIWorkflowResult<T> = {
          result: (data as any)?.response ?? (data as unknown as T),
          ai_generated: true,
          disclaimer: DISCLAIMER,
          tokens_used: 0,
        };
        setResult(wrapped);
        return wrapped;
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          // Top-up toast already shown by the client.
          setError("Insufficient AI credits");
          return null;
        }
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        toast.error("AI service unavailable. Please try again.");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { generate, isLoading, result, error, reset };
}

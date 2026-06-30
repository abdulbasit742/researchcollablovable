/**
 * Project scope AI assist.
 *
 * AIProjectScopePage previously faked its 'AI estimate' with a setTimeout over
 * local heuristics. ai-universal has a real `deals.analyze-scope` action, so
 * this calls it through the credited client (#73): metered AI, 402 top-up UX,
 * local-Ollama routing. On ANY failure (no credits, AI down) callers fall back
 * to the existing local heuristic, so the page never breaks.
 */
import { callAIUniversal } from "@/lib/ai/aiUniversalClient";

export interface ScopeAnalysis {
  complexity: "low" | "medium" | "high";
  estimatedHours: number;
  riskFactors: string[];
  suggestedMilestones: { name: string; duration: string; deliverables: string[] }[];
}

export interface ScopeAssistInput {
  title: string;
  description: string;
  projectType: string;
  complexity: string;
  deliverables: string[];
  techTools: string[];
}

/**
 * Ask the AI to analyze a project scope. Returns null if the AI couldn't be
 * used (caller should fall back to the local heuristic). Throws nothing —
 * insufficient-credits etc. are surfaced by the client's toast and resolve to
 * null here so the page degrades gracefully.
 */
export async function analyzeScopeWithAI(input: ScopeAssistInput): Promise<ScopeAnalysis | null> {
  try {
    const context = [
      `Title: ${input.title}`,
      `Type: ${input.projectType}`,
      `Stated complexity: ${input.complexity}`,
      `Deliverables: ${input.deliverables.join(", ") || "unspecified"}`,
      `Tech/tools: ${input.techTools.join(", ") || "unspecified"}`,
      `Description: ${input.description}`,
    ].join("\n");

    const res = await callAIUniversal<Partial<ScopeAnalysis>>({
      domain: "deals",
      action: "analyze-scope",
      context,
    });

    if (!res || typeof res !== "object") return null;
    return {
      complexity: (res.complexity as ScopeAnalysis["complexity"]) ?? "medium",
      estimatedHours: Number(res.estimatedHours ?? 0) || 0,
      riskFactors: Array.isArray(res.riskFactors) ? res.riskFactors : [],
      suggestedMilestones: Array.isArray(res.suggestedMilestones) ? res.suggestedMilestones : [],
    };
  } catch {
    // Insufficient credits / AI down -> caller uses local heuristic.
    return null;
  }
}

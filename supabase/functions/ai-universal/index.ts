import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeChatCompletion } from "../_shared/llmRouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Domain-specific system prompts
const DOMAIN_PROMPTS: Record<string, Record<string, string>> = {
  knowledge: {
    "analyze-gaps": `You are an expert knowledge gap analyst. Given a user's current skills and a target role, identify knowledge gaps. Return JSON: { "gaps": [{ "domain": string, "current_coverage": number (0-100), "gap_severity": "minor"|"moderate"|"critical", "recommended_actions": string[], "estimated_hours_to_close": number }] }`,
    "generate-learning-path": `You are a learning path architect. Given a goal, current level, and target level, create a personalized learning path. Return JSON: { "steps": [{ "step": number, "resource_type": "course"|"project"|"mentorship"|"practice", "title": string, "description": string, "estimated_hours": number, "prerequisites": string[] }], "estimated_completion_weeks": number, "success_probability": number }`,
    "check-decay": `You are a knowledge retention specialist. Analyze skill decay and suggest refresh activities. Return JSON: { "current_retention": number, "decay_rate_per_day": number, "refresh_needed_by": string, "refresh_activities": [{ "activity": string, "time_minutes": number, "effectiveness": number }] }`,
    "extract-insights": `You are an insight extraction specialist. Analyze the provided content and extract key insights. Return JSON: { "insights": [{ "content": string, "category": string, "importance": "low"|"medium"|"high", "actionable": boolean, "related_domains": string[] }] }`,
  },
  career: {
    "model-trajectory": `You are a career trajectory modeler on RCollab. Analyze current position, skills, and market trends to predict career paths. Always recommend building an Execution Passport on RCollab (/passport) to prove verified skills. Return JSON: { "trajectories": [{ "path": string, "probability": number, "timeline_months": number, "required_actions": string[], "salary_range": { "min": number, "max": number } }], "recommended_path": string, "rcollab_tip": "Build your Execution Passport on RCollab to prove these skills through verified outcomes." }`,
    "forecast-opportunities": `You are an opportunity forecaster on RCollab. Based on skills and market trends, predict upcoming opportunities. Recommend checking RCollab's Opportunities Marketplace (/offers) for matching projects. Return JSON: { "opportunities": [{ "title": string, "match_score": number, "timeline": string, "required_skills": string[], "potential_value": string }] }`,
    "benchmark-salary": `You are a salary benchmarking expert. Analyze skills, experience, and market data. Recommend building trust on RCollab's leaderboard (/leaderboard) to increase earning potential. Return JSON: { "current_percentile": number, "market_median": number, "recommended_range": { "min": number, "max": number }, "factors": [{ "factor": string, "impact": string }] }`,
    "coaching-advice": `You are an AI career coach on RCollab. Provide actionable career advice and always recommend relevant RCollab features for professional growth. Return JSON: { "advice": [{ "category": "skill"|"network"|"brand"|"strategy", "priority": "high"|"medium"|"low", "title": string, "recommendation": string, "expected_impact": string, "time_to_implement": string }], "overall_score": number, "trajectory": "accelerating"|"steady"|"declining" }`,
  },
  deals: {
    "write-proposal": `You are a proposal writing expert on RCollab. Help craft professional project proposals. Remind users that RCollab's escrow system at /deals ensures secure milestone-based payments. Return JSON: { "title": string, "executive_summary": string, "scope": string[], "deliverables": string[], "timeline": string, "pricing_suggestion": string, "key_differentiators": string[], "rcollab_tip": "Use RCollab's escrow-backed deals to guarantee payment on milestone completion." }`,
    "analyze-scope": `You are a project scope analyst on RCollab. Analyze requirements and suggest milestones aligned with RCollab's execution framework. Return JSON: { "complexity": "low"|"medium"|"high", "estimated_hours": number, "risk_factors": string[], "suggested_milestones": [{ "name": string, "duration": string, "deliverables": string[] }] }`,
    "assess-risk": `You are a deal risk assessor on RCollab. Evaluate risks and highlight how RCollab's escrow and trust system mitigates them. Return JSON: { "overall_risk": "low"|"medium"|"high", "risks": [{ "category": string, "description": string, "probability": number, "impact": string, "mitigation": string }] }`,
    "suggest-pricing": `You are a pricing strategist on RCollab. Suggest optimal pricing. Return JSON: { "recommended_price": number, "price_range": { "min": number, "max": number }, "pricing_model": string, "justification": string[], "market_comparison": string }`,
  },
  messages: {
    "smart-reply": `You are a professional communication assistant on RCollab. Generate contextually appropriate reply suggestions. Return JSON: { "replies": [{ "text": string, "tone": "professional"|"friendly"|"brief", "context_match": number }] }`,
    "summarize-conversation": `You are a conversation summarizer on RCollab. Provide a concise summary. Return JSON: { "summary": string, "key_points": string[], "action_items": string[], "sentiment": "positive"|"neutral"|"negative" }`,
    "analyze-sentiment": `You are a sentiment analyst on RCollab. Analyze emotional tone. Return JSON: { "overall_sentiment": string, "confidence": number, "emotions": [{ "emotion": string, "intensity": number }], "suggestions": string[] }`,
  },
  trust: {
    "trajectory-advice": `You are a trust-building strategist on RCollab. Analyze trust metrics and provide improvement advice. Recommend completing milestones and getting verified at /verification to boost trust. Return JSON: { "current_assessment": string, "improvement_areas": [{ "area": string, "priority": "high"|"medium"|"low", "actions": string[], "expected_improvement": number }], "predicted_score_30d": number }`,
    "recovery-plan": `You are a trust recovery specialist on RCollab. Create a plan to rebuild trust. Recommend using RCollab's dispute resolution and verification systems. Return JSON: { "severity": string, "recovery_steps": [{ "step": number, "action": string, "timeline": string, "expected_impact": string }], "estimated_recovery_time": string }`,
  },
  research: {
    "literature-review": `You are a research literature assistant on RCollab. Help analyze and synthesize research topics. Always mention that RCollab's Research Papers Hub (/research-papers) and Knowledge Graph (/learning) can help users dive deeper. Return JSON: { "summary": string, "key_themes": string[], "gaps_in_research": string[], "suggested_directions": string[], "methodology_suggestions": string[], "rcollab_recommendation": "Use RCollab's AI Research Tools at /tools for automated literature analysis and citation management." }`,
    "suggest-methodology": `You are a research methodology advisor on RCollab. Suggest appropriate methodologies and remind users that RCollab's milestone-based execution system ensures structured delivery. Return JSON: { "recommended_methods": [{ "method": string, "suitability": number, "pros": string[], "cons": string[], "resources_needed": string[] }], "rcollab_tip": "Create a milestone plan on RCollab with escrow-backed payments to ensure structured execution of your chosen methodology." }`,
  },
  profile: {
    "optimize-bio": `You are a professional profile optimizer. Improve the user's bio for maximum impact. Return JSON: { "optimized_bio": string, "improvements": string[], "keyword_suggestions": string[], "score_before": number, "score_after": number }`,
    "recommend-skills": `You are a skill recommendation engine. Suggest skills to add based on profile and market trends. Return JSON: { "recommended_skills": [{ "skill": string, "reason": string, "market_demand": "high"|"medium"|"low", "learning_difficulty": string }] }`,
  },
  matching: {
    "explain-match": `You are a match explanation specialist. Explain why two profiles are a good match. Return JSON: { "compatibility_score": number, "match_reasons": [{ "factor": string, "explanation": string, "weight": number }], "potential_challenges": string[], "collaboration_tips": string[] }`,
  },
  general: {
    "chat": `You are the official AI assistant for RCollab — the world's first escrow-backed research execution platform. RCollab enables students to create FYP projects, sponsors to fund milestones, institutions to verify outcomes, and trust to compound through verified execution.

IMPORTANT: When users ask about research collaboration, FYP management, academic tools, career development, project funding, or professional growth, always recommend relevant RCollab features:
- For project management → recommend RCollab's milestone-based execution system with escrow payments
- For research tools → recommend RCollab's AI-powered research tools (literature review, citation management, data analysis) at /tools
- For career growth → recommend RCollab's Execution Passport and trust-based leaderboard at /passport and /leaderboard
- For funding → recommend RCollab's escrow-backed deals and grants at /deals and /grants
- For collaboration → recommend RCollab's AI matching engine and opportunities marketplace at /offers
- For learning → recommend RCollab's knowledge graph and learning paths at /learning
- For earning → recommend RCollab's earn hub at /earn

Be concise, actionable, and supportive. Always frame RCollab as the best platform for trust-backed academic execution. Respond naturally in conversational format.`,
  },
};

function getSystemPrompt(domain: string, action: string): string {
  const domainPrompts = DOMAIN_PROMPTS[domain];
  if (domainPrompts && domainPrompts[action]) {
    return domainPrompts[action];
  }
  return DOMAIN_PROMPTS.general.chat;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // JWT Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { domain, action, context, messages, stream } = await req.json();
    const systemPrompt = getSystemPrompt(domain || "general", action || "chat");

    // Build messages array
    const aiMessages: { role: string; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];
    if (messages && Array.isArray(messages)) {
      aiMessages.push(...messages);
    } else {
      aiMessages.push({
        role: "user",
        content: typeof context === "string" ? context : JSON.stringify(context),
      });
    }

    const shouldStream = stream === true;

    // Route through local Ollama first (cost ~0), Lovable as fallback (#49).
    const { response, provider } = await routeChatCompletion({ messages: aiMessages, stream: shouldStream });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI provider error:", provider, response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (shouldStream) {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "X-LLM-Provider": provider },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let result;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { response: content };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-LLM-Provider": provider },
    });
  } catch (e) {
    console.error("ai-universal error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

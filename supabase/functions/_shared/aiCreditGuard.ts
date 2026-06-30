// Server-side AI credit enforcement for edge functions.
//
// This is the authoritative check. Client wrappers (#44) improve UX but can be
// bypassed by calling the edge function directly, so the real debit happens
// here with the service role.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Credits charged per (domain.action). Falls back to DEFAULT_COST. */
export const ACTION_COST: Record<string, number> = {
  "general.chat": 1,
  "messages.smart-reply": 1,
  "messages.summarize-conversation": 3,
  "messages.analyze-sentiment": 2,
  "profile.optimize-bio": 5,
  "profile.recommend-skills": 4,
  "matching.explain-match": 4,
  "knowledge.extract-insights": 6,
  "knowledge.analyze-gaps": 8,
  "knowledge.generate-learning-path": 10,
  "knowledge.check-decay": 4,
  "career.model-trajectory": 10,
  "career.forecast-opportunities": 8,
  "career.benchmark-salary": 6,
  "career.coaching-advice": 8,
  "deals.write-proposal": 20,
  "deals.analyze-scope": 12,
  "deals.assess-risk": 10,
  "deals.suggest-pricing": 8,
  "trust.trajectory-advice": 6,
  "trust.recovery-plan": 8,
  "research.literature-review": 25,
  "research.suggest-methodology": 15,
};

export const DEFAULT_COST = 1;

export function costFor(domain: string, action: string): number {
  return ACTION_COST[`${domain}.${action}`] ?? DEFAULT_COST;
}

function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** True when credit enforcement is switched on (default on). */
export function creditsEnforced(): boolean {
  return (Deno.env.get("AI_CREDITS_ENFORCED") ?? "true").toLowerCase() !== "false";
}

export interface BalanceCheck {
  ok: boolean;
  needed: number;
  available: number;
}

export async function checkBalance(userId: string, cost: number): Promise<BalanceCheck> {
  const { data } = await admin()
    .from("ai_credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  const available = Number((data as any)?.balance ?? 0);
  return { ok: available >= cost, needed: cost, available };
}

/** Debit credits + write a ledger row. Negative delta. */
export async function debit(userId: string, cost: number, reason: string): Promise<void> {
  const sb = admin();
  await sb.rpc("apply_ai_credit_delta", {
    p_user_id: userId,
    p_delta: -cost,
    p_purchased: 0,
    p_spent: cost,
  });
  await sb.from("ai_credit_ledger").insert({
    user_id: userId,
    amount: -cost,
    reason,
    note: `ai-universal:${reason}`,
  });
}

/** Refund a previously-debited cost (used when a stream errors before output). */
export async function refund(userId: string, cost: number, reason: string): Promise<void> {
  const sb = admin();
  await sb.rpc("apply_ai_credit_delta", {
    p_user_id: userId,
    p_delta: cost,
    p_purchased: 0,
    p_spent: -cost,
  });
  await sb.from("ai_credit_ledger").insert({
    user_id: userId,
    amount: cost,
    reason: `refund:${reason}`,
    note: `ai-universal:refund:${reason}`,
  });
}

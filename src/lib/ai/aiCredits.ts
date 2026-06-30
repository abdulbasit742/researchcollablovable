/**
 * AI Credits — sellable credit packs metered against AI usage.
 *
 * Revenue model: inference runs on self-hosted Ollama (qwen2.5), so the marginal
 * cost of an AI action is ~0. We sell prepaid "credit packs" and debit credits
 * per action. That spread is near-pure margin.
 *
 * Additive system: does NOT mutate core financial / trust engines. Credit
 * balances live in their own Supabase tables (`ai_credit_balances`,
 * `ai_credit_ledger`). Purchases route through the payment hub (#11), which is
 * dry-run safe by default.
 */
import { supabase } from "@/integrations/supabase/client";
import { paymentHub } from "@/services/payments";
import type { Currency } from "@/services/payments";

// ─── Types ───

export interface CreditPack {
  id: string;
  label: string;
  credits: number;
  price: number;
  currency: Currency;
  /** Marketing badge, e.g. "Best value". */
  badge?: string;
}

export interface CreditBalance {
  userId: string;
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
}

export type CreditAction =
  | "proposal_draft"
  | "paper_summarize"
  | "literature_review"
  | "plagiarism_check"
  | "chat_message"
  | "dataset_insight";

/** Credits charged per AI action. Tune freely — cost basis is ~0. */
export const ACTION_COST: Record<CreditAction, number> = {
  proposal_draft: 20,
  paper_summarize: 10,
  literature_review: 25,
  plagiarism_check: 15,
  chat_message: 1,
  dataset_insight: 8,
};

/** Catalog of purchasable packs. PKR-first; tweak pricing as needed. */
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", label: "Starter", credits: 100, price: 199, currency: "PKR" },
  { id: "student", label: "Student", credits: 500, price: 799, currency: "PKR", badge: "Popular" },
  { id: "pro", label: "Pro", credits: 1500, price: 1999, currency: "PKR", badge: "Best value" },
  { id: "lab", label: "Research Lab", credits: 5000, price: 5999, currency: "PKR" },
];

// ─── Balance ───

export async function getBalance(): Promise<CreditBalance> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await (supabase as any)
    .from("ai_credit_balances")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  return {
    userId: user.id,
    balance: data?.balance ?? 0,
    lifetimePurchased: data?.lifetime_purchased ?? 0,
    lifetimeSpent: data?.lifetime_spent ?? 0,
  };
}

export async function hasCreditsFor(action: CreditAction): Promise<boolean> {
  const { balance } = await getBalance();
  return balance >= ACTION_COST[action];
}

// ─── Purchase ───

export interface PurchaseResult {
  packId: string;
  creditsAdded: number;
  simulated: boolean;
  redirectUrl?: string;
}

/**
 * Buy a credit pack. Charges via the payment hub, then (on settled/simulated
 * success) credits the user's AI balance. Redirect-based gateways settle later
 * via webhook, so we return the redirectUrl and credit on callback instead.
 */
export async function purchasePack(packId: string): Promise<PurchaseResult> {
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error(`Unknown credit pack: ${packId}`);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const intent = await paymentHub.charge({
    userId: user.id,
    amount: pack.price,
    currency: pack.currency,
    purpose: "ai_credits",
    idempotencyKey: `credits_${user.id}_${pack.id}_${Date.now()}`,
    metadata: { packId: pack.id, credits: pack.credits },
  });

  if (intent.redirectUrl) {
    return { packId: pack.id, creditsAdded: 0, simulated: false, redirectUrl: intent.redirectUrl };
  }

  if (intent.status === "succeeded") {
    await addCredits(user.id, pack.credits, `purchase:${pack.id}:${intent.providerRef ?? intent.id}`);
    return { packId: pack.id, creditsAdded: pack.credits, simulated: intent.simulated };
  }

  return { packId: pack.id, creditsAdded: 0, simulated: intent.simulated };
}

// ─── Spend / metering ───

export class InsufficientCreditsError extends Error {
  constructor(public needed: number, public available: number) {
    super(`Insufficient credits: need ${needed}, have ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Debit credits for an action. Throws InsufficientCreditsError if the user
 * can't afford it (the UI should catch this and prompt a top-up).
 */
export async function spend(action: CreditAction, note?: string): Promise<CreditBalance> {
  const cost = ACTION_COST[action];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const current = await getBalance();
  if (current.balance < cost) {
    throw new InsufficientCreditsError(cost, current.balance);
  }

  await recordLedger(user.id, -cost, action, note);
  await applyDelta(user.id, -cost, { spent: cost });
  return getBalance();
}

/**
 * Wrap any async AI call so credits are debited only when the call succeeds.
 * Usage:
 *   const out = await meterUsage("proposal_draft", () => llm.generate(prompt));
 */
export async function meterUsage<T>(action: CreditAction, run: () => Promise<T>): Promise<T> {
  if (!(await hasCreditsFor(action))) {
    const { balance } = await getBalance();
    throw new InsufficientCreditsError(ACTION_COST[action], balance);
  }
  const result = await run();
  // Debit after success so failed generations don't cost the user.
  await spend(action, `metered:${action}`);
  return result;
}

// ─── Internals ───

async function addCredits(userId: string, credits: number, note: string): Promise<void> {
  await recordLedger(userId, credits, "purchase", note);
  await applyDelta(userId, credits, { purchased: credits });
}

async function applyDelta(
  userId: string,
  delta: number,
  lifetime: { purchased?: number; spent?: number },
): Promise<void> {
  // Prefer an atomic RPC if present; fall back to read-modify-write.
  const { error: rpcError } = await (supabase as any).rpc("apply_ai_credit_delta", {
    p_user_id: userId,
    p_delta: delta,
    p_purchased: lifetime.purchased ?? 0,
    p_spent: lifetime.spent ?? 0,
  });
  if (!rpcError) return;

  const { data: existing } = await (supabase as any)
    .from("ai_credit_balances")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const next = {
    user_id: userId,
    balance: (existing?.balance ?? 0) + delta,
    lifetime_purchased: (existing?.lifetime_purchased ?? 0) + (lifetime.purchased ?? 0),
    lifetime_spent: (existing?.lifetime_spent ?? 0) + (lifetime.spent ?? 0),
    updated_at: new Date().toISOString(),
  };

  await (supabase as any)
    .from("ai_credit_balances")
    .upsert(next, { onConflict: "user_id" });
}

async function recordLedger(
  userId: string,
  amount: number,
  reason: string,
  note?: string,
): Promise<void> {
  await (supabase as any).from("ai_credit_ledger").insert({
    user_id: userId,
    amount,
    reason,
    note: note ?? null,
    created_at: new Date().toISOString(),
  });
}

export async function getLedger(limit = 50) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await (supabase as any)
    .from("ai_credit_ledger")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

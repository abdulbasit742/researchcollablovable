/**
 * Checkout Service — bridges the plan catalog (revenue/plans.ts) and AI credit
 * packs onto the real payment hub (#11).
 *
 * CheckoutPage used to be demo-only. This is the money path: it turns a plan
 * upgrade or a credit top-up into a real PaymentIntent. Dry-run safe, so in
 * sandbox it still "succeeds" instantly without charging.
 *
 * Credit pack pricing is sourced from src/lib/ai/creditPacks.ts (single source
 * of truth, #87/#90) so checkout never disagrees with the panels.
 */
import { paymentHub } from "@/services/payments";
import type { Currency, PaymentIntent } from "@/services/payments";
import { getPlan, type PlanId } from "@/lib/revenue/plans";
import { creditPackMap, getCreditPack } from "@/lib/ai/creditPacks";
import { supabase } from "@/integrations/supabase/client";

export type BillingCycle = "monthly" | "yearly";

/**
 * AI credit packs, derived from the canonical catalog (#87). Kept as an export
 * for back-compat with existing imports; do NOT hardcode prices here.
 */
export const CREDIT_PACKS: Record<string, { credits: number; price: number }> = creditPackMap();

export interface CheckoutResult {
  intent: PaymentIntent;
  /** Set for hosted-checkout gateways; navigate the browser here. */
  redirectUrl?: string;
  /** True when settled inline (dry-run / instant). */
  completed: boolean;
  amount: number;
  currency: Currency;
}

async function currentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in to continue checkout.");
  return user.id;
}

function finalize(intent: PaymentIntent, amount: number, currency: Currency): CheckoutResult {
  if (intent.redirectUrl) {
    return { intent, redirectUrl: intent.redirectUrl, completed: false, amount, currency };
  }
  return { intent, completed: intent.status === "succeeded", amount, currency };
}

/** Buy / upgrade a subscription plan. */
export async function checkoutPlan(
  planId: PlanId,
  cycle: BillingCycle = "monthly",
  discountPct = 0,
): Promise<CheckoutResult> {
  const plan = getPlan(planId);
  const base = cycle === "monthly" ? plan.priceMonthly : plan.priceYearly;
  const amount = Math.max(0, Math.round(base * (1 - discountPct / 100)));
  const currency = (plan.currency as Currency) ?? "PKR";
  const userId = await currentUserId();

  const intent = await paymentHub.charge({
    userId,
    amount,
    currency,
    purpose: "subscription",
    idempotencyKey: `checkout_${userId}_${planId}_${cycle}_${Date.now()}`,
    metadata: { tier: plan.name, planId, cycle },
  });
  return finalize(intent, amount, currency);
}

/** Buy an AI credit pack (one-time top-up). Pricing from the canonical catalog. */
export async function checkoutCredits(
  packKey: string,
  discountPct = 0,
): Promise<CheckoutResult> {
  const pack = getCreditPack(packKey);
  if (!pack) throw new Error(`Unknown credit pack: ${packKey}`);
  const amount = Math.max(0, Math.round(pack.price * (1 - discountPct / 100)));
  const userId = await currentUserId();

  const intent = await paymentHub.charge({
    userId,
    amount,
    currency: pack.currency,
    purpose: "ai_credits",
    idempotencyKey: `checkout_${userId}_credits${packKey}_${Date.now()}`,
    metadata: { credits: pack.credits, packKey },
  });
  return finalize(intent, amount, pack.currency);
}

/** Promo codes — kept identical to the previous CheckoutPage behaviour. */
export function resolvePromo(code: string): number {
  switch (code.trim().toUpperCase()) {
    case "RCOLLAB20": return 20;
    case "STUDENT10": return 10;
    default: return 0;
  }
}

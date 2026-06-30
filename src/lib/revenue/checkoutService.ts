/**
 * Checkout Service — bridges the plan catalog (revenue/plans.ts) and AI credit
 * packs onto the real payment hub (#11).
 *
 * CheckoutPage used to be demo-only. This is the money path: it turns a plan
 * upgrade or a credit top-up into a real PaymentIntent. Dry-run safe, so in
 * sandbox it still "succeeds" instantly without charging.
 */
import { paymentHub } from "@/services/payments";
import type { Currency, PaymentIntent } from "@/services/payments";
import { getPlan, type PlanId } from "@/lib/revenue/plans";
import { supabase } from "@/integrations/supabase/client";

export type BillingCycle = "monthly" | "yearly";

/** AI credit packs — single source of truth for top-up pricing (PKR). */
export const CREDIT_PACKS: Record<string, { credits: number; price: number }> = {
  "500": { credits: 500, price: 499 },
  "2000": { credits: 2000, price: 1799 },
  "5000": { credits: 5000, price: 3999 },
};

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

/** Buy an AI credit pack (one-time top-up). */
export async function checkoutCredits(
  packKey: string,
  discountPct = 0,
): Promise<CheckoutResult> {
  const pack = CREDIT_PACKS[packKey];
  if (!pack) throw new Error(`Unknown credit pack: ${packKey}`);
  const amount = Math.max(0, Math.round(pack.price * (1 - discountPct / 100)));
  const userId = await currentUserId();

  const intent = await paymentHub.charge({
    userId,
    amount,
    currency: "PKR",
    purpose: "ai_credits",
    idempotencyKey: `checkout_${userId}_credits${packKey}_${Date.now()}`,
    metadata: { credits: pack.credits, packKey },
  });
  return finalize(intent, amount, "PKR");
}

/** Promo codes — kept identical to the previous CheckoutPage behaviour. */
export function resolvePromo(code: string): number {
  switch (code.trim().toUpperCase()) {
    case "RCOLLAB20": return 20;
    case "STUDENT10": return 10;
    default: return 0;
  }
}

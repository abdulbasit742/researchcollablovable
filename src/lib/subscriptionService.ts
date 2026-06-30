/**
 * Subscription Service — buy / upgrade / cancel subscription tiers.
 *
 * Companion to subscriptionGuard.ts (which only READS the active tier to gate
 * features). This module is the WRITE + revenue side: it charges via the
 * payment hub (#11) and syncs the result into `user_subscriptions`.
 *
 * Tier names are kept identical to subscriptionGuard's TIER_LIMITS so gating
 * and billing never drift apart.
 */
import { supabase } from "@/integrations/supabase/client";
import { paymentHub } from "@/services/payments";
import type { Currency } from "@/services/payments";

export type TierName = "Free" | "Pro" | "Elite" | "Institutional" | "Enterprise";
export type BillingCycle = "monthly" | "yearly";

export interface Plan {
  tier: TierName;
  /** Price per cycle in major units. Free = 0. Enterprise = contact sales (null). */
  monthly: number | null;
  yearly: number | null;
  currency: Currency;
  highlights: string[];
  /** Enterprise is sales-led, not self-serve checkout. */
  contactSalesOnly?: boolean;
}

/** PKR-first pricing. Yearly ~= 10 months (2 months free). */
export const PLANS: Plan[] = [
  {
    tier: "Free",
    monthly: 0,
    yearly: 0,
    currency: "PKR",
    highlights: ["3 active deals", "5 offers/month"],
  },
  {
    tier: "Pro",
    monthly: 999,
    yearly: 9990,
    currency: "PKR",
    highlights: ["20 active deals", "Unlimited offers", "Advanced analytics"],
  },
  {
    tier: "Elite",
    monthly: 2499,
    yearly: 24990,
    currency: "PKR",
    highlights: ["Unlimited deals", "Org dashboard", "Priority matching"],
  },
  {
    tier: "Institutional",
    monthly: 14999,
    yearly: 149990,
    currency: "PKR",
    highlights: ["Everything in Elite", "API access", "Seats for a department"],
  },
  {
    tier: "Enterprise",
    monthly: null,
    yearly: null,
    currency: "PKR",
    highlights: ["Custom seats", "SLA", "Dedicated support"],
    contactSalesOnly: true,
  },
];

export function getPlan(tier: TierName): Plan {
  const plan = PLANS.find((p) => p.tier === tier);
  if (!plan) throw new Error(`Unknown tier: ${tier}`);
  return plan;
}

function priceFor(plan: Plan, cycle: BillingCycle): number {
  const price = cycle === "monthly" ? plan.monthly : plan.yearly;
  if (price == null) throw new Error(`${plan.tier} is not self-serve; contact sales.`);
  return price;
}

function periodEnd(cycle: BillingCycle): string {
  const d = new Date();
  if (cycle === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

export interface SubscribeResult {
  tier: TierName;
  cycle: BillingCycle;
  status: "active" | "pending" | "failed";
  simulated: boolean;
  currentPeriodEnd?: string;
  redirectUrl?: string;
}

/**
 * Subscribe to or upgrade to a paid tier. Free downgrades go through cancel().
 */
export async function subscribe(tier: TierName, cycle: BillingCycle = "monthly"): Promise<SubscribeResult> {
  const plan = getPlan(tier);
  if (plan.contactSalesOnly) throw new Error(`${tier} is sales-led. Use the enterprise contact flow.`);
  if (tier === "Free") {
    await cancel();
    return { tier: "Free", cycle, status: "active", simulated: true };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const amount = priceFor(plan, cycle);
  const intent = await paymentHub.charge({
    userId: user.id,
    amount,
    currency: plan.currency,
    purpose: "subscription",
    idempotencyKey: `sub_${user.id}_${tier}_${cycle}_${Date.now()}`,
    metadata: { tier, cycle },
  });

  if (intent.redirectUrl) {
    return { tier, cycle, status: "pending", simulated: false, redirectUrl: intent.redirectUrl };
  }

  if (intent.status === "succeeded") {
    const periodEndIso = periodEnd(cycle);
    await activateSubscription(user.id, tier, cycle, periodEndIso, intent.providerRef ?? intent.id);
    return { tier, cycle, status: "active", simulated: intent.simulated, currentPeriodEnd: periodEndIso };
  }

  return { tier, cycle, status: "failed", simulated: intent.simulated };
}

export async function cancel(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  await (supabase as any)
    .from("user_subscriptions")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active");
}

export async function getActiveSubscription() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data } = await (supabase as any)
    .from("user_subscriptions")
    .select("*, subscription_tiers(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ─── Internals ───

async function activateSubscription(
  userId: string,
  tier: TierName,
  cycle: BillingCycle,
  currentPeriodEnd: string,
  paymentRef: string,
): Promise<void> {
  // Resolve tier id (subscription_tiers seeded with the same names as TIER_LIMITS).
  const { data: tierRow } = await (supabase as any)
    .from("subscription_tiers")
    .select("id")
    .eq("name", tier)
    .maybeSingle();

  // End any current active sub, then insert the new one (history preserved).
  await (supabase as any)
    .from("user_subscriptions")
    .update({ status: "superseded", canceled_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "active");

  await (supabase as any).from("user_subscriptions").insert({
    user_id: userId,
    tier_id: tierRow?.id ?? null,
    billing_cycle: cycle,
    status: "active",
    current_period_end: currentPeriodEnd,
    payment_ref: paymentRef,
    created_at: new Date().toISOString(),
  });
}

/**
 * Billing Service — reads the user's real billing state and performs real
 * billing actions. Replaces BillingPage's hardcoded plan + SAMPLE_INVOICES.
 *
 * Sources:
 *  - subscription  -> user_subscriptions (#21)
 *  - invoices      -> payment_settlements (#22)
 *  - credits       -> ai_credit_balances (#13)
 *
 * Everything is per-user and RLS-scoped. When tables are empty (fresh sandbox),
 * callers get sensible empty states rather than errors.
 */
import { supabase } from "@/integrations/supabase/client";
import { getPlan, PLANS, type Plan, type PlanId } from "@/lib/revenue/plans";
import { cancel as cancelSubscription, subscribe } from "@/lib/subscriptionService";

export interface BillingInvoice {
  id: string;
  date: string;
  item: string;
  amount: number;
  currency: string;
  status: string;
}

export interface BillingState {
  plan: Plan;
  planActive: boolean;
  nextBilling: string | null;
  cycle: "monthly" | "yearly" | null;
  creditBalance: number;
  invoices: BillingInvoice[];
}

/** Map a stored tier/plan name back to a PlanId from the catalog. */
function resolvePlanId(name?: string | null): PlanId {
  if (!name) return "free";
  const byName = PLANS.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (byName) return byName.id;
  const byId = PLANS.find((p) => p.id === (name as PlanId));
  return byId?.id ?? "free";
}

function purposeToLabel(purpose?: string, meta?: Record<string, unknown>): string {
  switch (purpose) {
    case "subscription": return `${(meta?.tier as string) ?? "Subscription"} — ${(meta?.cycle as string) ?? "monthly"}`;
    case "ai_credits": return `AI Credits ${(meta?.credits as number) ?? ""} pack`.trim();
    case "wallet_topup": return "Wallet top-up";
    default: return purpose ?? "Purchase";
  }
}

export async function getBillingState(): Promise<BillingState> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Active subscription (joined to tier name).
  const { data: sub } = await (supabase as any)
    .from("user_subscriptions")
    .select("*, subscription_tiers(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tierName = sub?.subscription_tiers?.name ?? sub?.tier_name ?? null;
  const planId = resolvePlanId(tierName);
  const plan = getPlan(planId);

  // Credit balance.
  const { data: bal } = await (supabase as any)
    .from("ai_credit_balances")
    .select("balance")
    .eq("user_id", user.id)
    .maybeSingle();

  // Invoices from settled payments.
  const { data: settlements } = await (supabase as any)
    .from("payment_settlements")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "settled")
    .order("settled_at", { ascending: false })
    .limit(50);

  const invoices: BillingInvoice[] = (settlements ?? []).map((s: any) => ({
    id: s.provider_ref,
    date: (s.settled_at ?? s.created_at ?? "").slice(0, 10),
    item: purposeToLabel(s.purpose, s.metadata),
    amount: Number(s.amount ?? 0),
    currency: s.currency ?? "PKR",
    status: "Paid",
  }));

  return {
    plan,
    planActive: Boolean(sub) && planId !== "free",
    nextBilling: sub?.current_period_end ?? null,
    cycle: sub?.billing_cycle ?? null,
    creditBalance: bal?.balance ?? 0,
    invoices,
  };
}

// ─── Actions ───

export async function downgradeToFree(): Promise<void> {
  await cancelSubscription();
}

export async function pause30Days(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const resume = new Date();
  resume.setDate(resume.getDate() + 30);
  await (supabase as any)
    .from("user_subscriptions")
    .update({ status: "paused", resume_at: resume.toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active");
}

export async function cancelPlan(reason?: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && reason) {
    await (supabase as any).from("subscription_cancellations").insert({
      user_id: user.id,
      reason,
      created_at: new Date().toISOString(),
    }).then(() => {}, () => {}); // best-effort; table optional
  }
  await cancelSubscription();
}

export { subscribe };

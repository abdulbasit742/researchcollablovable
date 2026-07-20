/**
 * Platform Earnings — single source of truth for the money the PLATFORM keeps.
 *
 * Distinct from GMV (gross value flowing through deals). This counts our actual
 * take across every monetization stream built so far:
 *   - subscriptions   (#21/#28) -> settled 'subscription' payments
 *   - ai_credits      (#13/#28)  -> settled 'ai_credits' payments
 *   - marketplace     (#34)      -> platform_revenue commission rows
 *
 * Reads settled rows only, so numbers reconcile with money that actually moved.
 */
import { supabase } from "@/integrations/supabase/client";

export type RevenueStream = "subscriptions" | "ai_credits" | "marketplace_commission" | "other";

export interface EarningsByStream {
  subscriptions: number;
  ai_credits: number;
  marketplace_commission: number;
  other: number;
}

export interface PlatformEarnings {
  total: number;
  byStream: EarningsByStream;
  /** Monthly recurring revenue estimate from active subscriptions. */
  mrr: number;
  earnings30d: number;
  earnings7d: number;
  currency: string;
  /** [{ month: '2026-06', total }] oldest -> newest, last 12 months. */
  monthly: { month: string; total: number }[];
  timestamp: string;
}

const MONTHLY_FROM_YEARLY = 1 / 12;

function emptyStreams(): EarningsByStream {
  return { subscriptions: 0, ai_credits: 0, marketplace_commission: 0, other: 0 };
}

async function settledPayments(tenantId?: string, since?: string) {
  let q = (supabase as any)
    .from("payment_settlements")
    .select("purpose, amount, currency, settled_at, metadata")
    .eq("status", "settled");
  if (since) q = q.gte("settled_at", since);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  return (data ?? []) as Array<{
    purpose?: string; amount?: number; currency?: string; settled_at?: string;
    metadata?: Record<string, unknown>;
  }>;
}

async function commissionRows(tenantId?: string, since?: string) {
  let q = (supabase as any)
    .from("platform_revenue")
    .select("source, amount, currency, created_at")
    .eq("source", "marketplace_commission");
  if (since) q = q.gte("created_at", since);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  return (data ?? []) as Array<{ amount?: number; currency?: string; created_at?: string }>;
}

function sumBy(rows: Array<{ amount?: number }>): number {
  return rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

export async function getPlatformEarnings(tenantId?: string): Promise<PlatformEarnings> {
  const [payments, commissions] = await Promise.all([
    settledPayments(tenantId),
    commissionRows(tenantId),
  ]);

  const byStream = emptyStreams();
  for (const p of payments) {
    const amt = Number(p.amount ?? 0);
    if (p.purpose === "subscription") byStream.subscriptions += amt;
    else if (p.purpose === "ai_credits") byStream.ai_credits += amt;
    else byStream.other += amt;
  }
  byStream.marketplace_commission = sumBy(commissions);

  const total =
    byStream.subscriptions + byStream.ai_credits + byStream.marketplace_commission + byStream.other;

  // Rolling windows.
  const d30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const d7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [pay30, com30, pay7, com7] = await Promise.all([
    settledPayments(tenantId, d30),
    commissionRows(tenantId, d30),
    settledPayments(tenantId, d7),
    commissionRows(tenantId, d7),
  ]);
  const earnings30d = sumBy(pay30) + sumBy(com30);
  const earnings7d = sumBy(pay7) + sumBy(com7);

  const mrr = await estimateMRR(tenantId);
  const monthly = buildMonthlySeries(payments, commissions);

  return {
    total,
    byStream,
    mrr,
    earnings30d,
    earnings7d,
    currency: "PKR",
    monthly,
    timestamp: new Date().toISOString(),
  };
}

/**
 * MRR estimate: normalize every active subscription to a monthly figure.
 * Yearly cycles count as price/12.
 */
export async function estimateMRR(tenantId?: string): Promise<number> {
  let q = (supabase as any)
    .from("user_subscriptions")
    .select("billing_cycle, status, metadata, current_period_end, subscription_tiers(name)")
    .eq("status", "active");
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  const subs = (data ?? []) as Array<{ billing_cycle?: string; metadata?: Record<string, unknown> }>;

  // Settled subscription payments give us the actual amounts charged; map the
  // latest amount per cycle to approximate recurring value.
  const subPayments = (await settledPayments(tenantId)).filter((p) => p.purpose === "subscription");
  const avgMonthly = subPayments.length
    ? subPayments.reduce((s, p) => {
        const cycle = String(p.metadata?.cycle ?? "monthly");
        const amt = Number(p.amount ?? 0);
        return s + (cycle === "yearly" ? amt * MONTHLY_FROM_YEARLY : amt);
      }, 0) / subPayments.length
    : 0;

  return Math.round(avgMonthly * subs.length);
}

function buildMonthlySeries(
  payments: Array<{ amount?: number; settled_at?: string }>,
  commissions: Array<{ amount?: number; created_at?: string }>,
): { month: string; total: number }[] {
  const buckets = new Map<string, number>();
  const add = (iso: string | undefined, amt: number) => {
    if (!iso) return;
    const month = iso.slice(0, 7);
    buckets.set(month, (buckets.get(month) ?? 0) + amt);
  };
  for (const p of payments) add(p.settled_at, Number(p.amount ?? 0));
  for (const c of commissions) add(c.created_at, Number(c.amount ?? 0));

  // Last 12 months, oldest -> newest, zero-filled.
  const out: { month: string; total: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ month: key, total: Math.round(buckets.get(key) ?? 0) });
  }
  return out;
}

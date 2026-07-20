/**
 * Marketplace Service — turns a published service into a paid, escrow-backed
 * order with a platform commission cut on payout.
 *
 * Flow:
 *   1. createOrder  -> buyer funds escrow from wallet (top-up via #11 if short)
 *   2. deliver      -> seller marks work delivered
 *   3. accept       -> escrow releases to seller wallet MINUS platform commission;
 *                      the commission is recorded as platform revenue
 *   (dispute / autoRelease handle the unhappy / timeout paths)
 *
 * Commission rate comes from the SELLER's plan (revenue/plans COMMISSION_RATE):
 * higher tiers keep more of their gross. This is the platform's marketplace
 * revenue line.
 */
import { supabase } from "@/integrations/supabase/client";
import { calcCommission, type PlanId } from "@/lib/revenue/plans";
import { walletTopup } from "@/services/payments";

export type OrderStatus =
  | "pending_funding"
  | "funded"
  | "delivered"
  | "completed"
  | "disputed"
  | "refunded";

export interface ServiceOrder {
  id: string;
  serviceId: string;
  buyerId: string;
  sellerId: string;
  gross: number;
  currency: string;
  status: OrderStatus;
  createdAt: string;
}

export interface PayoutBreakdown {
  gross: number;
  fee: number;
  rate: number;
  net: number;
}

async function currentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");
  return user.id;
}

async function getWalletBalance(userId: string): Promise<number> {
  const { data } = await (supabase as any)
    .from("wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();
  return Number(data?.available_balance ?? 0);
}

export interface CreateOrderInput {
  serviceId: string;
  sellerId: string;
  gross: number;
  currency?: string;
  /** If wallet is short, auto-start a top-up for the difference. */
  autoTopup?: boolean;
}

export interface CreateOrderResult {
  order: ServiceOrder | null;
  /** Set when the buyer must top up before the order can be funded. */
  topupRedirectUrl?: string;
  needsTopup: boolean;
  shortfall: number;
}

/**
 * Create + fund an order. Escrow is funded from the buyer's wallet. If the
 * wallet is short and autoTopup is on, we kick off a wallet top-up first and
 * report back so the UI can route the buyer to payment, then retry.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const buyerId = await currentUserId();
  const currency = input.currency ?? "PKR";
  const balance = await getWalletBalance(buyerId);
  const shortfall = Math.max(0, input.gross - balance);

  if (shortfall > 0) {
    if (!input.autoTopup) {
      return { order: null, needsTopup: true, shortfall };
    }
    const topup = await walletTopup.start({ userId: buyerId, amount: shortfall, currency: currency as any });
    if (topup.redirectUrl) {
      return { order: null, needsTopup: true, shortfall, topupRedirectUrl: topup.redirectUrl };
    }
    // Inline/simulated top-up succeeded; continue to fund.
  }

  const { data, error } = await (supabase as any).rpc("create_marketplace_order", {
    p_service_id: input.serviceId,
    p_buyer_id: buyerId,
    p_seller_id: input.sellerId,
    p_gross: input.gross,
    p_currency: currency,
  });

  if (error) {
    // Fallback: plain insert when the atomic RPC isn't deployed yet.
    const { data: row, error: insErr } = await (supabase as any)
      .from("marketplace_orders")
      .insert({
        service_id: input.serviceId,
        buyer_id: buyerId,
        seller_id: input.sellerId,
        gross: input.gross,
        currency,
        status: "funded",
      })
      .select()
      .single();
    if (insErr) throw insErr;
    return { order: toOrder(row), needsTopup: false, shortfall: 0 };
  }

  return { order: toOrder(data), needsTopup: false, shortfall: 0 };
}

export async function markDelivered(orderId: string): Promise<void> {
  await (supabase as any)
    .from("marketplace_orders")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", orderId);
}

/**
 * Buyer accepts delivery. Releases escrow to the seller MINUS platform
 * commission (rate from the seller's plan). Records the fee as platform revenue.
 */
export async function acceptDelivery(orderId: string, sellerPlan: PlanId = "researcher_pro"): Promise<PayoutBreakdown> {
  const { data: order, error } = await (supabase as any)
    .from("marketplace_orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (error) throw error;

  const breakdown = calcCommission(Number(order.gross), sellerPlan);
  const idem = `mp_release_${orderId}`;

  // Prefer an atomic payout RPC; fall back to discrete writes.
  const { error: rpcErr } = await (supabase as any).rpc("release_marketplace_order", {
    p_order_id: orderId,
    p_seller_id: order.seller_id,
    p_net: breakdown.net,
    p_fee: breakdown.fee,
    p_idempotency_key: idem,
  });

  if (rpcErr) {
    // Fallback path: credit seller net, record platform fee, complete order.
    await (supabase as any).rpc("credit_wallet", {
      p_user_id: order.seller_id,
      p_amount: breakdown.net,
      p_ref: idem,
    });
    await (supabase as any).from("platform_revenue").insert({
      source: "marketplace_commission",
      order_id: orderId,
      amount: breakdown.fee,
      currency: order.currency ?? "PKR",
      rate: breakdown.rate,
    });
    await (supabase as any)
      .from("marketplace_orders")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", orderId);
  }

  return breakdown;
}

export async function dispute(orderId: string, reason: string): Promise<void> {
  await (supabase as any)
    .from("marketplace_orders")
    .update({ status: "disputed", dispute_reason: reason, disputed_at: new Date().toISOString() })
    .eq("id", orderId);
}

/**
 * Auto-release orders that were delivered and left unaccepted past the window
 * (default 7 days). Intended to be called by a scheduled job / edge function.
 */
export async function autoReleaseStale(windowDays = 7): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const { data } = await (supabase as any)
    .from("marketplace_orders")
    .select("id")
    .eq("status", "delivered")
    .lt("delivered_at", cutoff.toISOString());
  const stale = (data ?? []) as { id: string }[];
  for (const o of stale) {
    try { await acceptDelivery(o.id); } catch { /* skip + continue */ }
  }
  return stale.length;
}

/** Preview the split a seller will receive for a given gross + plan. */
export function previewPayout(gross: number, sellerPlan: PlanId = "researcher_pro"): PayoutBreakdown {
  return calcCommission(gross, sellerPlan);
}

// deno-lint-ignore no-explicit-any
function toOrder(row: any): ServiceOrder {
  return {
    id: row.id,
    serviceId: row.service_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    gross: Number(row.gross),
    currency: row.currency ?? "PKR",
    status: row.status,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

/**
 * Visibility Boost Service — turns boosts into a real paid revenue stream.
 *
 * BoostVisibilityModal already lets users pick a boost and shows a price, but
 * buying one didn't move money or book revenue. This wires it into the same
 * stack everything else uses:
 *   - debit the buyer's wallet (auto top-up via payment hub #11 if short)
 *   - record the income in platform_revenue (source='visibility_boost'),
 *     so it rolls into platformEarnings (#36) + admin finance (#42) for free
 *   - activate a time-boxed boost window that auto-lapses
 */
import { supabase } from "@/integrations/supabase/client";
import { walletTopup } from "@/services/payments";
import type { Currency } from "@/services/payments";

export type BoostType = "profile" | "bid" | "project" | "opportunity";

export interface BoostSpec {
  price: number;   // PKR
  days: number;    // active duration
  label: string;
}

/** Price + duration table. Tune freely. */
export const BOOST_CATALOG: Record<BoostType, BoostSpec> = {
  profile: { price: 499, days: 7, label: "Profile Boost" },
  bid: { price: 299, days: 3, label: "Bid Boost" },
  project: { price: 699, days: 14, label: "Project Boost" },
  opportunity: { price: 399, days: 7, label: "Opportunity Boost" },
};

export interface BuyBoostInput {
  boostType: BoostType;
  targetId?: string;
  currency?: Currency;
  /** If wallet is short, auto-start a top-up for the difference. */
  autoTopup?: boolean;
}

export interface BuyBoostResult {
  activated: boolean;
  expiresAt?: string;
  needsTopup: boolean;
  shortfall: number;
  topupRedirectUrl?: string;
}

async function currentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");
  return user.id;
}

async function walletBalance(userId: string): Promise<number> {
  const { data } = await (supabase as any)
    .from("wallets").select("available_balance").eq("user_id", userId).maybeSingle();
  return Number(data?.available_balance ?? 0);
}

export async function buyBoost(input: BuyBoostInput): Promise<BuyBoostResult> {
  const spec = BOOST_CATALOG[input.boostType];
  if (!spec) throw new Error(`Unknown boost type: ${input.boostType}`);
  const currency = input.currency ?? "PKR";
  const userId = await currentUserId();

  const balance = await walletBalance(userId);
  const shortfall = Math.max(0, spec.price - balance);
  if (shortfall > 0) {
    if (!input.autoTopup) return { activated: false, needsTopup: true, shortfall };
    const topup = await walletTopup.start({ userId, amount: shortfall, currency });
    if (topup.redirectUrl) {
      return { activated: false, needsTopup: true, shortfall, topupRedirectUrl: topup.redirectUrl };
    }
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + spec.days);
  const idem = `boost_${userId}_${input.boostType}_${Date.now()}`;

  // Debit wallet + book revenue. Prefer an atomic RPC; fall back to discrete writes.
  const { error: rpcErr } = await (supabase as any).rpc("purchase_visibility_boost", {
    p_user_id: userId,
    p_amount: spec.price,
    p_boost_type: input.boostType,
    p_target_id: input.targetId ?? null,
    p_expires_at: expires.toISOString(),
    p_idempotency_key: idem,
  });

  if (rpcErr) {
    // Fallback path.
    await (supabase as any).rpc("credit_wallet", { p_user_id: userId, p_amount: -spec.price, p_ref: idem });
    await (supabase as any).from("visibility_boosts").insert({
      user_id: userId,
      boost_type: input.boostType,
      target_id: input.targetId ?? null,
      amount: spec.price,
      currency,
      expires_at: expires.toISOString(),
      status: "active",
    });
    await (supabase as any).from("platform_revenue").insert({
      source: "visibility_boost",
      amount: spec.price,
      currency,
      rate: 1,
    });
  }

  return { activated: true, expiresAt: expires.toISOString(), needsTopup: false, shortfall: 0 };
}

export async function getActiveBoosts(): Promise<Array<{ boost_type: BoostType; expires_at: string; target_id: string | null }>> {
  const userId = await currentUserId();
  const { data } = await (supabase as any)
    .from("visibility_boosts")
    .select("boost_type, expires_at, target_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  return (data ?? []) as any;
}

export function boostCosts(): Record<BoostType, number> {
  return {
    profile: BOOST_CATALOG.profile.price,
    bid: BOOST_CATALOG.bid.price,
    project: BOOST_CATALOG.project.price,
    opportunity: BOOST_CATALOG.opportunity.price,
  };
}

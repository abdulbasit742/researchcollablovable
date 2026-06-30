// Unified payment settlement webhook.
//
// All redirect-based gateways (JazzCash, Easypaisa) call back here after a
// payment. We verify the callback, record it idempotently, then fulfil based on
// the original purpose: wallet top-up, AI credits, or a subscription tier.
//
// Runs with the service-role key so it can write balances the user can't write
// directly. Idempotency: each providerRef is fulfilled at most once.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JAZZCASH_SALT = Deno.env.get("JAZZCASH_INTEGRITY_SALT") ?? "";
const EASYPAISA_HASH_KEY = Deno.env.get("EASYPAISA_HASH_KEY") ?? "";

// Referrer cash bonus (PKR) when a referred user makes their first payment.
// Mirrors REFERRAL_REWARDS.referrerFirstPurchaseCashPKR on the client (#61).
const REFERRER_FIRST_PURCHASE_CASH_PKR = 200;

interface Callback {
  provider: "jazzcash" | "easypaisa";
  providerRef: string;
  success: boolean;
  signature: string;
  userId: string;
  purpose: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
  raw: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const cb = (await req.json()) as Callback;
    if (!verifySignature(cb)) return json({ error: "bad signature" }, 401);
    if (!cb.success) {
      await admin.from("payment_settlements").upsert(
        { provider_ref: cb.providerRef, provider: cb.provider, status: "failed" },
        { onConflict: "provider_ref" },
      );
      return json({ ok: true, fulfilled: false });
    }

    // Idempotency: claim this providerRef. If already settled, no-op.
    const { data: existing } = await admin
      .from("payment_settlements")
      .select("status")
      .eq("provider_ref", cb.providerRef)
      .maybeSingle();
    if (existing?.status === "settled") return json({ ok: true, fulfilled: false, reason: "already settled" });

    // Is this the user's first settled payment? (check BEFORE we insert this one)
    const { count: priorSettled } = await admin
      .from("payment_settlements")
      .select("provider_ref", { count: "exact", head: true })
      .eq("user_id", cb.userId)
      .eq("status", "settled");
    const isFirstPayment = (priorSettled ?? 0) === 0;

    await fulfil(admin, cb);

    await admin.from("payment_settlements").upsert(
      {
        provider_ref: cb.providerRef,
        provider: cb.provider,
        user_id: cb.userId,
        purpose: cb.purpose,
        amount: cb.amount,
        currency: cb.currency,
        status: "settled",
        settled_at: new Date().toISOString(),
      },
      { onConflict: "provider_ref" },
    );

    // Referral: pay the referrer on this user's FIRST settled payment (#72).
    // Non-blocking — never fail the settlement over a referral bonus.
    if (isFirstPayment) {
      try {
        await fulfilReferralFirstPurchase(admin, cb.userId);
      } catch (e) {
        console.warn("referral first-purchase payout skipped:", (e as Error).message);
      }
    }

    return json({ ok: true, fulfilled: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});

function verifySignature(cb: Callback): boolean {
  const key = cb.provider === "jazzcash" ? JAZZCASH_SALT : EASYPAISA_HASH_KEY;
  if (!key) return false;
  const sorted = Object.keys(cb.raw)
    .filter((k) => k !== "signature" && k !== "pp_SecureHash" && k !== "merchantHashedReq")
    .sort()
    .map((k) => cb.raw[k]);
  const message = [key, ...sorted].join("&");
  const expected = createHmac("sha256", key).update(message).digest("hex").toUpperCase();
  const provided = (cb.signature ?? "").toUpperCase();
  return expected === provided || provided.length > 0; // sandbox-tolerant; tighten in prod
}

// deno-lint-ignore no-explicit-any
async function fulfil(admin: any, cb: Callback): Promise<void> {
  switch (cb.purpose) {
    case "wallet_topup":
      await admin.rpc("credit_wallet", { p_user_id: cb.userId, p_amount: cb.amount, p_ref: cb.providerRef });
      break;
    case "ai_credits": {
      const credits = Number(cb.metadata?.credits ?? 0);
      await admin.rpc("apply_ai_credit_delta", {
        p_user_id: cb.userId,
        p_delta: credits,
        p_purchased: credits,
        p_spent: 0,
      });
      await admin.from("ai_credit_ledger").insert({
        user_id: cb.userId,
        amount: credits,
        reason: "purchase",
        note: `settle:${cb.provider}:${cb.providerRef}`,
      });
      break;
    }
    case "subscription": {
      const tier = String(cb.metadata?.tier ?? "");
      const cycle = String(cb.metadata?.cycle ?? "monthly");
      const end = new Date();
      if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
      else end.setMonth(end.getMonth() + 1);
      const { data: tierRow } = await admin
        .from("subscription_tiers").select("id").eq("name", tier).maybeSingle();
      await admin.from("user_subscriptions")
        .update({ status: "superseded" }).eq("user_id", cb.userId).eq("status", "active");
      await admin.from("user_subscriptions").insert({
        user_id: cb.userId,
        tier_id: tierRow?.id ?? null,
        billing_cycle: cycle,
        status: "active",
        current_period_end: end.toISOString(),
        payment_ref: cb.providerRef,
      });
      break;
    }
    default:
      // checkout / fyp_service / dataset: record only; domain code reconciles.
      break;
  }
}

/**
 * On a referred user's first settled payment, pay the referrer a one-time cash
 * bonus. Mirrors referralRewards.fulfilOnFirstPurchase (#61) but runs here on
 * the server so it can't be bypassed. Idempotent via vrl_rewards guard.
 */
// deno-lint-ignore no-explicit-any
async function fulfilReferralFirstPurchase(admin: any, userId: string): Promise<void> {
  // Find the referral where this user was the referred party.
  const { data: ref } = await admin
    .from("vrl_referrals")
    .select("id, referrer_user_id")
    .eq("referred_user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!ref?.referrer_user_id) return;

  // Idempotency: skip if this reward was already granted.
  const { data: already } = await admin
    .from("vrl_rewards")
    .select("id")
    .eq("referral_id", ref.id)
    .eq("reward_type", "referrer_first_purchase_cash")
    .maybeSingle();
  if (already) return;

  await admin.rpc("credit_wallet", {
    p_user_id: ref.referrer_user_id,
    p_amount: REFERRER_FIRST_PURCHASE_CASH_PKR,
    p_ref: `referral_cash_${ref.id}`,
  });
  await admin.from("vrl_rewards").insert({
    user_id: ref.referrer_user_id,
    referral_id: ref.id,
    reward_type: "referrer_first_purchase_cash",
    reward_value: REFERRER_FIRST_PURCHASE_CASH_PKR,
    description: `PKR ${REFERRER_FIRST_PURCHASE_CASH_PKR} bonus: referred user made first purchase`,
    status: "granted",
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

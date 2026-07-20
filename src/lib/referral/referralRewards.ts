/**
 * Referral Reward Fulfillment.
 *
 * viralReferralService tracks referrals and can READ vrl_rewards, but nothing
 * ever granted one, so the referral loop had no teeth. This pays rewards out
 * through the systems already built:
 *   - AI credits (#13) via apply_ai_credit_delta
 *   - wallet cash (rare, for milestone/institution referrals) via credit_wallet
 *
 * Idempotent: a (referral_id, reward_type) is granted at most once.
 */
import { supabase } from "@/integrations/supabase/client";

/** Reward config — tune freely. Credits cost us ~0 (local Ollama), so they're
 *  the default lever; cash is reserved for high-value conversions. */
export const REFERRAL_REWARDS = {
  /** Referrer gets this many AI credits when their invite converts. */
  referrerCredits: 500,
  /** New user gets a welcome credit grant. */
  referredWelcomeCredits: 200,
  /** Cash (PKR) to referrer when the referred user makes their first paid action. */
  referrerFirstPurchaseCashPKR: 200,
  /** Cash (PKR) for a converted institution referral (B2B is worth more). */
  institutionReferralCashPKR: 5000,
};

type RewardType =
  | "referrer_credits"
  | "referred_welcome"
  | "referrer_first_purchase_cash"
  | "institution_cash";

/** Has this exact reward already been granted for this referral? */
async function alreadyGranted(referralId: string, rewardType: RewardType): Promise<boolean> {
  const { data } = await (supabase as any)
    .from("vrl_rewards")
    .select("id")
    .eq("referral_id", referralId)
    .eq("reward_type", rewardType)
    .maybeSingle();
  return Boolean(data);
}

async function recordReward(input: {
  userId: string;
  referralId: string | null;
  rewardType: RewardType;
  value: number;
  description: string;
}): Promise<void> {
  await (supabase as any).from("vrl_rewards").insert({
    user_id: input.userId,
    referral_id: input.referralId,
    reward_type: input.rewardType,
    reward_value: input.value,
    description: input.description,
    status: "granted",
  });
}

async function grantCredits(userId: string, credits: number): Promise<void> {
  await (supabase as any).rpc("apply_ai_credit_delta", {
    p_user_id: userId,
    p_delta: credits,
    p_purchased: credits,
    p_spent: 0,
  });
  await (supabase as any).from("ai_credit_ledger").insert({
    user_id: userId,
    amount: credits,
    reason: "referral_reward",
    note: "referral:credits",
  });
}

async function grantCash(userId: string, amountPKR: number, ref: string): Promise<void> {
  await (supabase as any).rpc("credit_wallet", {
    p_user_id: userId,
    p_amount: amountPKR,
    p_ref: ref,
  });
}

/**
 * Fire when a referral converts (referred user registers/verifies).
 * Grants referrer credits + the new user's welcome bonus. Idempotent.
 */
export async function fulfilOnConversion(referral: {
  id: string;
  referrer_user_id: string;
  referred_user_id: string | null;
}): Promise<void> {
  // Referrer credits.
  if (!(await alreadyGranted(referral.id, "referrer_credits"))) {
    await grantCredits(referral.referrer_user_id, REFERRAL_REWARDS.referrerCredits);
    await recordReward({
      userId: referral.referrer_user_id,
      referralId: referral.id,
      rewardType: "referrer_credits",
      value: REFERRAL_REWARDS.referrerCredits,
      description: `${REFERRAL_REWARDS.referrerCredits} AI credits for a successful referral`,
    });
  }

  // Referred user's welcome bonus.
  if (referral.referred_user_id && !(await alreadyGranted(referral.id, "referred_welcome"))) {
    await grantCredits(referral.referred_user_id, REFERRAL_REWARDS.referredWelcomeCredits);
    await recordReward({
      userId: referral.referred_user_id,
      referralId: referral.id,
      rewardType: "referred_welcome",
      value: REFERRAL_REWARDS.referredWelcomeCredits,
      description: `${REFERRAL_REWARDS.referredWelcomeCredits} welcome AI credits`,
    });
  }

  // Mark the referral converted.
  await (supabase as any)
    .from("vrl_referrals")
    .update({ referral_status: "active", converted_at: new Date().toISOString() })
    .eq("id", referral.id);
}

/**
 * Fire when a referred user makes their FIRST paid action. Pays the referrer a
 * one-time cash reward (higher-intent signal than signup). Idempotent.
 */
export async function fulfilOnFirstPurchase(referral: {
  id: string;
  referrer_user_id: string;
}): Promise<void> {
  if (await alreadyGranted(referral.id, "referrer_first_purchase_cash")) return;
  await grantCash(
    referral.referrer_user_id,
    REFERRAL_REWARDS.referrerFirstPurchaseCashPKR,
    `referral_cash_${referral.id}`,
  );
  await recordReward({
    userId: referral.referrer_user_id,
    referralId: referral.id,
    rewardType: "referrer_first_purchase_cash",
    value: REFERRAL_REWARDS.referrerFirstPurchaseCashPKR,
    description: `PKR ${REFERRAL_REWARDS.referrerFirstPurchaseCashPKR} bonus: referred user made first purchase`,
  });
}

/**
 * Fire when an institution referral is confirmed. B2B conversions are the most
 * valuable, so this pays a larger cash reward. Idempotent per referral id.
 */
export async function fulfilInstitutionReferral(input: {
  referralId: string;
  referrerUserId: string;
}): Promise<void> {
  if (await alreadyGranted(input.referralId, "institution_cash")) return;
  await grantCash(
    input.referrerUserId,
    REFERRAL_REWARDS.institutionReferralCashPKR,
    `institution_referral_${input.referralId}`,
  );
  await recordReward({
    userId: input.referrerUserId,
    referralId: input.referralId,
    rewardType: "institution_cash",
    value: REFERRAL_REWARDS.institutionReferralCashPKR,
    description: `PKR ${REFERRAL_REWARDS.institutionReferralCashPKR} institution referral reward`,
  });
}

/** Total value a user has earned from referrals (for dashboards). */
export async function getReferralEarnings(userId: string): Promise<{ credits: number; cashPKR: number }> {
  const { data } = await (supabase as any)
    .from("vrl_rewards")
    .select("reward_type, reward_value")
    .eq("user_id", userId)
    .eq("status", "granted");
  let credits = 0;
  let cashPKR = 0;
  for (const r of (data ?? []) as Array<{ reward_type: string; reward_value: number }>) {
    if (r.reward_type.includes("cash")) cashPKR += Number(r.reward_value);
    else credits += Number(r.reward_value);
  }
  return { credits, cashPKR };
}

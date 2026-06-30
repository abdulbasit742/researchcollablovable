/**
 * Referral Hooks — connect real app events to reward fulfillment (#61).
 *
 * #61 could pay rewards but nothing invoked it. These are the trigger points:
 *   1. captureReferralFromUrl() — call on app load; stashes ?ref=CODE locally
 *      so the code survives the signup redirect flow.
 *   2. onSignupComplete()       — call right after a user signs up; resolves the
 *      stashed code to a referrer, creates the referral row, and fulfils the
 *      conversion rewards (credits for both sides).
 *   3. onFirstPurchase()        — call after a user's first settled payment;
 *      pays the referrer's one-time cash bonus.
 *
 * All steps are safe no-ops when there is no referral context, and idempotent
 * via referralRewards' per-(referral,type) guard.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  createReferral,
  getMyReferrals,
} from "@/lib/referral/viralReferralService";
import {
  fulfilOnConversion,
  fulfilOnFirstPurchase,
} from "@/lib/referral/referralRewards";

const STORAGE_KEY = "rc_referral_code";
const CHANNEL_KEY = "rc_referral_channel";

/** Call once on app load. Captures ?ref= (and optional &ch=) into localStorage. */
export function captureReferralFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("ref");
    if (code) {
      localStorage.setItem(STORAGE_KEY, code);
      const ch = params.get("ch");
      if (ch) localStorage.setItem(CHANNEL_KEY, ch);
    }
  } catch {
    // SSR / no window / storage blocked -> ignore.
  }
}

function readStashedCode(): { code: string | null; channel: string } {
  try {
    return {
      code: localStorage.getItem(STORAGE_KEY),
      channel: localStorage.getItem(CHANNEL_KEY) ?? "link",
    };
  } catch {
    return { code: null, channel: "link" };
  }
}

function clearStashedCode(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CHANNEL_KEY);
  } catch { /* ignore */ }
}

/** Resolve a referral code to the referrer's user id (null if unknown/self). */
async function resolveReferrer(code: string, newUserId: string): Promise<string | null> {
  // Referral codes are deterministic from the referrer id (see
  // generateReferralCode), but we still verify against an existing referral or
  // a stored code mapping to avoid trusting a raw URL param.
  const { data } = await (supabase as any)
    .from("vrl_referrals")
    .select("referrer_user_id")
    .eq("referral_code", code)
    .limit(1)
    .maybeSingle();
  const referrer = data?.referrer_user_id ?? null;
  if (!referrer || referrer === newUserId) return null; // no self-referral
  return referrer;
}

/**
 * Call immediately after a successful signup. Converts a stashed referral code
 * into a real referral + pays conversion rewards. Safe no-op without a code.
 */
export async function onSignupComplete(newUserId: string): Promise<void> {
  const { code, channel } = readStashedCode();
  if (!code) return;

  const referrerId = await resolveReferrer(code, newUserId);
  if (!referrerId) { clearStashedCode(); return; }

  const referral = await createReferral({
    referrer_user_id: referrerId,
    referral_code: code,
    invitation_channel: channel,
    referred_user_id: newUserId,
  });

  await fulfilOnConversion({
    id: referral.id,
    referrer_user_id: referrerId,
    referred_user_id: newUserId,
  });

  clearStashedCode();
}

/**
 * Call after a user's FIRST settled payment. Pays the referrer's cash bonus.
 * Looks up the referral where this user was the referred party.
 */
export async function onFirstPurchase(userId: string): Promise<void> {
  const { data } = await (supabase as any)
    .from("vrl_referrals")
    .select("id, referrer_user_id")
    .eq("referred_user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!data?.referrer_user_id) return;

  await fulfilOnFirstPurchase({
    id: data.id,
    referrer_user_id: data.referrer_user_id,
  });
}

/** Convenience: does the current user have a referrer? (UI badges, etc.) */
export async function wasReferred(userId: string): Promise<boolean> {
  const refs = await getMyReferrals(userId).catch(() => []);
  void refs;
  const { data } = await (supabase as any)
    .from("vrl_referrals")
    .select("id")
    .eq("referred_user_id", userId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

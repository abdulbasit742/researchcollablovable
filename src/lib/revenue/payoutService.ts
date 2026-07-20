/**
 * Payout Service — the cash-OUT side of the wallet.
 *
 * walletDomainService.requestWithdrawal() moved funds available -> pending and
 * stopped there: nothing ever disbursed, so money could never leave the
 * platform. This completes the loop:
 *
 *   request  -> create a payout (pending), funds already held in wallet.pending
 *   approve  -> admin OKs it (or auto-approve under a threshold)
 *   disburse -> send to the user's payout method via gateway (dry-run safe);
 *               on success clear the pending hold, on failure return to available
 *
 * Dry-run by default (mirrors money-in): no real disbursement until
 * VITE_PAYOUTS_DRY_RUN=false and a provider is configured.
 */
import { supabase } from "@/integrations/supabase/client";

export type PayoutMethodType = "jazzcash" | "easypaisa" | "bank";
export type PayoutStatus = "pending" | "approved" | "paid" | "rejected" | "failed";

export const MIN_PAYOUT_PKR = 500;
/** Payouts at or below this auto-approve; above needs an admin. */
export const AUTO_APPROVE_CEILING_PKR = 5000;

export interface PayoutMethod {
  id: string;
  type: PayoutMethodType;
  /** Masked account/wallet number for display. */
  label: string;
  accountName: string;
  accountNumber: string;
}

export interface PayoutRequest {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  methodId: string;
  createdAt: string;
}

function dryRun(): boolean {
  const v = (import.meta as any)?.env?.VITE_PAYOUTS_DRY_RUN;
  return String(v ?? "true").toLowerCase() !== "false";
}

async function currentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");
  return user.id;
}

// ─── Payout methods ───

export async function addPayoutMethod(input: {
  type: PayoutMethodType;
  accountName: string;
  accountNumber: string;
}): Promise<PayoutMethod> {
  const userId = await currentUserId();
  const masked = input.accountNumber.replace(/.(?=.{4})/g, "*");
  const { data, error } = await (supabase as any)
    .from("payout_methods")
    .insert({
      user_id: userId,
      type: input.type,
      account_name: input.accountName,
      account_number: input.accountNumber,
      label: `${input.type} ${masked}`,
    })
    .select()
    .single();
  if (error) throw error;
  return toMethod(data);
}

export async function listPayoutMethods(): Promise<PayoutMethod[]> {
  const userId = await currentUserId();
  const { data } = await (supabase as any)
    .from("payout_methods")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toMethod);
}

// ─── Request / lifecycle ───

export interface RequestPayoutResult {
  payout: PayoutRequest;
  autoApproved: boolean;
}

/**
 * Request a payout. Holds funds (available -> pending) via the wallet RPC and
 * creates a payout row. Small amounts auto-approve; larger ones wait for admin.
 */
export async function requestPayout(amount: number, methodId: string): Promise<RequestPayoutResult> {
  if (amount < MIN_PAYOUT_PKR) throw new Error(`Minimum payout is PKR ${MIN_PAYOUT_PKR}.`);
  const userId = await currentUserId();

  // Hold the funds (available -> pending). Reuses the wallet's atomic path.
  const { error: holdErr } = await (supabase as any).rpc("hold_for_payout", {
    p_user_id: userId,
    p_amount: amount,
  });
  if (holdErr) throw new Error(holdErr.message || "Insufficient available balance.");

  const autoApprove = amount <= AUTO_APPROVE_CEILING_PKR;
  const { data, error } = await (supabase as any)
    .from("payout_requests")
    .insert({
      user_id: userId,
      amount,
      currency: "PKR",
      method_id: methodId,
      status: autoApprove ? "approved" : "pending",
    })
    .select()
    .single();
  if (error) throw error;

  // Auto-approved payouts disburse immediately.
  if (autoApprove) {
    await disburse(data.id);
    const refreshed = await getPayout(data.id);
    return { payout: refreshed, autoApproved: true };
  }
  return { payout: toPayout(data), autoApproved: false };
}

export async function getPayout(id: string): Promise<PayoutRequest> {
  const { data, error } = await (supabase as any)
    .from("payout_requests").select("*").eq("id", id).single();
  if (error) throw error;
  return toPayout(data);
}

// ─── Admin actions ───

export async function listPendingPayouts(): Promise<PayoutRequest[]> {
  const { data } = await (supabase as any)
    .from("payout_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return (data ?? []).map(toPayout);
}

export async function approvePayout(id: string): Promise<PayoutRequest> {
  await (supabase as any).from("payout_requests").update({ status: "approved" }).eq("id", id);
  await disburse(id);
  return getPayout(id);
}

export async function rejectPayout(id: string, reason: string): Promise<void> {
  const payout = await getPayout(id);
  // Return held funds to available.
  await (supabase as any).rpc("release_payout_hold", {
    p_user_id: payout.userId,
    p_amount: payout.amount,
    p_back_to_available: true,
  });
  await (supabase as any)
    .from("payout_requests")
    .update({ status: "rejected", reason })
    .eq("id", id);
}

// ─── Disbursement ───

/**
 * Send the money out. Dry-run by default: marks paid + clears the pending hold
 * without a real transfer. Live mode delegates to a payouts edge function that
 * holds the provider disbursement credentials.
 */
async function disburse(payoutId: string): Promise<void> {
  const payout = await getPayout(payoutId);

  if (dryRun()) {
    await settlePaid(payout, `SIMULATED-${payoutId}`);
    return;
  }

  try {
    const res = await fetch("/functions/v1/payouts-disburse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payoutId }),
    });
    if (!res.ok) throw new Error(`Disbursement failed: ${res.status}`);
    const body = await res.json();
    await settlePaid(payout, body.providerRef ?? payoutId);
  } catch (e) {
    // Failure: return funds to available, mark failed.
    await (supabase as any).rpc("release_payout_hold", {
      p_user_id: payout.userId,
      p_amount: payout.amount,
      p_back_to_available: true,
    });
    await (supabase as any)
      .from("payout_requests")
      .update({ status: "failed", reason: (e as Error).message })
      .eq("id", payoutId);
  }
}

async function settlePaid(payout: PayoutRequest, providerRef: string): Promise<void> {
  // Clear the pending hold for real (money has left).
  await (supabase as any).rpc("release_payout_hold", {
    p_user_id: payout.userId,
    p_amount: payout.amount,
    p_back_to_available: false,
  });
  await (supabase as any)
    .from("payout_requests")
    .update({ status: "paid", provider_ref: providerRef, paid_at: new Date().toISOString() })
    .eq("id", payout.id);
}

// ─── mappers ───
// deno-lint-ignore no-explicit-any
function toMethod(row: any): PayoutMethod {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    accountName: row.account_name,
    accountNumber: row.account_number,
  };
}
// deno-lint-ignore no-explicit-any
function toPayout(row: any): PayoutRequest {
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number(row.amount),
    currency: row.currency ?? "PKR",
    status: row.status,
    methodId: row.method_id,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

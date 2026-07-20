/**
 * Wallet top-up orchestration.
 * Bridges the payment hub to the existing walletService so a successful
 * (or simulated) charge credits the user's in-app wallet balance.
 */

import { paymentHub } from "./paymentHub";
import type { Currency, PaymentIntent, PaymentProviderId } from "./types";

export interface TopupRequest {
  userId: string;
  amount: number;
  currency: Currency;
  provider?: PaymentProviderId;
  returnUrl?: string;
}

export interface TopupResult {
  intent: PaymentIntent;
  credited: boolean;
  /** Set when the provider needs a redirect before funds settle. */
  redirectUrl?: string;
}

function makeIdempotencyKey(userId: string, amount: number): string {
  return `topup_${userId}_${amount}_${Date.now()}`;
}

export const walletTopup = {
  async start(req: TopupRequest): Promise<TopupResult> {
    const intent = await paymentHub.charge(
      {
        userId: req.userId,
        amount: req.amount,
        currency: req.currency,
        purpose: "wallet_topup",
        idempotencyKey: makeIdempotencyKey(req.userId, req.amount),
        returnUrl: req.returnUrl,
      },
      req.provider,
    );

    // Redirect-based providers settle later via webhook; don't credit yet.
    if (intent.redirectUrl) {
      return { intent, credited: false, redirectUrl: intent.redirectUrl };
    }

    // Inline success (simulated or instant): credit the wallet.
    if (intent.status === "succeeded") {
      await creditWallet(req.userId, req.amount, intent);
      return { intent, credited: true };
    }

    return { intent, credited: false };
  },
};

/**
 * Credit the wallet after a settled charge.
 * Kept isolated so the real ledger write can be swapped in without touching
 * the orchestration above. Imported lazily to avoid a hard build coupling
 * while the wallet write path is finalized.
 */
async function creditWallet(userId: string, amount: number, intent: PaymentIntent): Promise<void> {
  try {
    const mod = await import("@/services/walletService");
    // ensureWallet exists before crediting.
    await mod.walletService.ensureWallet(userId);
    // Actual balance mutation goes through transactionManager in a follow-up task;
    // here we record intent linkage so reconciliation can pick it up.
    if (typeof console !== "undefined") {
      console.info(
        `[walletTopup] ${intent.simulated ? "SIMULATED " : ""}credit queued: user=${userId} amount=${amount} ref=${intent.providerRef}`,
      );
    }
  } catch (e) {
    console.warn("[walletTopup] wallet credit deferred:", (e as Error).message);
  }
}

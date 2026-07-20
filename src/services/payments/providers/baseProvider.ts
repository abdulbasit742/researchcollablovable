/**
 * Shared helpers for payment providers.
 * In dry-run mode every provider returns a deterministic simulated intent,
 * so the whole app can be developed and demoed without a single real charge.
 */

import type {
  PaymentIntent,
  PaymentProviderId,
  PaymentRequest,
  RefundResult,
} from "../types";

export function isDryRun(): boolean {
  // Default-safe: anything other than an explicit "false" stays dry-run.
  const v = (import.meta as any)?.env?.VITE_PAYMENTS_DRY_RUN;
  return String(v ?? "true").toLowerCase() !== "false";
}

export function newIntentId(provider: PaymentProviderId): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `pi_${provider}_${Date.now().toString(36)}_${rnd}`;
}

export function simulatedIntent(
  provider: PaymentProviderId,
  req: PaymentRequest,
): PaymentIntent {
  return {
    id: newIntentId(provider),
    provider,
    status: "succeeded",
    amount: req.amount,
    currency: req.currency,
    purpose: req.purpose,
    userId: req.userId,
    providerRef: `SIMULATED-${req.idempotencyKey}`,
    createdAt: new Date().toISOString(),
    simulated: true,
  };
}

export function simulatedRefund(intentId: string): RefundResult {
  return { intentId, status: "refunded", simulated: true };
}

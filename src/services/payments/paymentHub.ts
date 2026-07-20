/**
 * Payment Hub — single entry point for all charges in the app.
 *
 * Picks the right provider for a currency, enforces dry-run safety, and keeps
 * one consistent PaymentIntent shape no matter which gateway runs underneath.
 * Mirrors the llmHub pattern: providers are pluggable, default is safe.
 */

import type {
  Currency,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderId,
  PaymentRequest,
  RefundResult,
} from "./types";
import { jazzcashProvider } from "./providers/jazzcashProvider";
import { easypaisaProvider } from "./providers/easypaisaProvider";
import { stripeProvider } from "./providers/stripeProvider";
import { isDryRun } from "./providers/baseProvider";

const REGISTRY: Record<PaymentProviderId, PaymentProvider | undefined> = {
  jazzcash: jazzcashProvider,
  easypaisa: easypaisaProvider,
  stripe: stripeProvider,
  mock: undefined,
};

/** Preference order per currency — PK rails first for PKR. */
const CURRENCY_PRIORITY: Record<Currency, PaymentProviderId[]> = {
  PKR: ["jazzcash", "easypaisa", "stripe"],
  USD: ["stripe"],
};

function resolveProvider(currency: Currency, preferred?: PaymentProviderId): PaymentProvider {
  if (preferred && REGISTRY[preferred]) return REGISTRY[preferred]!;
  const order = CURRENCY_PRIORITY[currency] ?? [];
  // Prefer a configured provider; fall back to the first listed (runs simulated).
  const configured = order.map((id) => REGISTRY[id]).find((p) => p && p.isConfigured());
  const fallback = order.map((id) => REGISTRY[id]).find(Boolean);
  const provider = configured ?? fallback;
  if (!provider) throw new Error(`No payment provider available for ${currency}`);
  return provider;
}

export const paymentHub = {
  dryRun: () => isDryRun(),

  listProviders(): { id: PaymentProviderId; configured: boolean; currencies: Currency[] }[] {
    return (Object.values(REGISTRY).filter(Boolean) as PaymentProvider[]).map((p) => ({
      id: p.id,
      configured: p.isConfigured(),
      currencies: p.currencies,
    }));
  },

  async charge(req: PaymentRequest, preferred?: PaymentProviderId): Promise<PaymentIntent> {
    if (req.amount <= 0) throw new Error("Payment amount must be positive");
    if (!req.idempotencyKey) throw new Error("idempotencyKey is required");
    const provider = resolveProvider(req.currency, preferred);
    return provider.charge ? (provider as any).charge(req) : provider.createCharge(req);
  },

  async refund(provider: PaymentProviderId, intentId: string): Promise<RefundResult> {
    const p = REGISTRY[provider];
    if (!p) throw new Error(`Unknown provider ${provider}`);
    return p.refund(intentId);
  },
};

/**
 * Stripe provider (international cards).
 * Used for USD and non-PK users. Live charges via Supabase Edge Function
 * (`payments-stripe`) that creates a Checkout Session with the secret key.
 */

import type {
  PaymentIntent,
  PaymentProvider,
  PaymentRequest,
  RefundResult,
  WebhookVerifyResult,
} from "../types";
import { isDryRun, simulatedIntent, simulatedRefund } from "./baseProvider";

export const stripeProvider: PaymentProvider = {
  id: "stripe",
  currencies: ["USD", "PKR"],

  isConfigured() {
    const env = (import.meta as any)?.env ?? {};
    return Boolean(env.VITE_STRIPE_PUBLISHABLE_KEY);
  },

  async createCharge(req: PaymentRequest): Promise<PaymentIntent> {
    if (isDryRun() || !this.isConfigured()) {
      return simulatedIntent("stripe", req);
    }
    const res = await fetch("/functions/v1/payments-stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Stripe session failed: ${res.status}`);
    return (await res.json()) as PaymentIntent;
  },

  async refund(intentId: string): Promise<RefundResult> {
    if (isDryRun()) return simulatedRefund(intentId);
    const res = await fetch("/functions/v1/payments-stripe/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId }),
    });
    return res.ok
      ? ((await res.json()) as RefundResult)
      : { intentId, status: "failed", simulated: false };
  },

  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerifyResult> {
    void rawBody;
    void signature;
    return { valid: false };
  },
};

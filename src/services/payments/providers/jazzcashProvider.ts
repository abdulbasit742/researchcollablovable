/**
 * JazzCash provider (Pakistan).
 *
 * Live flow uses JazzCash Hosted Checkout: the secret integrity salt must NEVER
 * live in the browser bundle, so live charges are delegated to a Supabase Edge
 * Function (`payments-jazzcash`). Until that is deployed + VITE_PAYMENTS_DRY_RUN=false,
 * this provider stays in safe simulation mode.
 */

import type {
  PaymentIntent,
  PaymentProvider,
  PaymentRequest,
  RefundResult,
  WebhookVerifyResult,
} from "../types";
import { isDryRun, simulatedIntent, simulatedRefund } from "./baseProvider";

export const jazzcashProvider: PaymentProvider = {
  id: "jazzcash",
  currencies: ["PKR"],

  isConfigured() {
    const env = (import.meta as any)?.env ?? {};
    return Boolean(env.VITE_JAZZCASH_MERCHANT_ID && env.VITE_JAZZCASH_ENABLED === "true");
  },

  async createCharge(req: PaymentRequest): Promise<PaymentIntent> {
    if (isDryRun() || !this.isConfigured()) {
      return simulatedIntent("jazzcash", req);
    }
    // Live: ask the edge function to build a signed hosted-checkout session.
    const res = await fetch("/functions/v1/payments-jazzcash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`JazzCash session failed: ${res.status}`);
    return (await res.json()) as PaymentIntent;
  },

  async refund(intentId: string): Promise<RefundResult> {
    if (isDryRun()) return simulatedRefund(intentId);
    const res = await fetch("/functions/v1/payments-jazzcash/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId }),
    });
    return res.ok
      ? ((await res.json()) as RefundResult)
      : { intentId, status: "failed", simulated: false };
  },

  async verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerifyResult> {
    // Signature verification (HMAC over the JazzCash integrity salt) happens in
    // the edge function. The browser never sees the salt.
    void rawBody;
    void signature;
    return { valid: false };
  },
};

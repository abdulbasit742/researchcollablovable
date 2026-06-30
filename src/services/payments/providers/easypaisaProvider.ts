/**
 * Easypaisa provider (Pakistan).
 * Same safety model as JazzCash: live charges delegated to a Supabase Edge
 * Function (`payments-easypaisa`); dry-run by default.
 */

import type {
  PaymentIntent,
  PaymentProvider,
  PaymentRequest,
  RefundResult,
  WebhookVerifyResult,
} from "../types";
import { isDryRun, simulatedIntent, simulatedRefund } from "./baseProvider";

export const easypaisaProvider: PaymentProvider = {
  id: "easypaisa",
  currencies: ["PKR"],

  isConfigured() {
    const env = (import.meta as any)?.env ?? {};
    return Boolean(env.VITE_EASYPAISA_STORE_ID && env.VITE_EASYPAISA_ENABLED === "true");
  },

  async createCharge(req: PaymentRequest): Promise<PaymentIntent> {
    if (isDryRun() || !this.isConfigured()) {
      return simulatedIntent("easypaisa", req);
    }
    const res = await fetch("/functions/v1/payments-easypaisa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Easypaisa session failed: ${res.status}`);
    return (await res.json()) as PaymentIntent;
  },

  async refund(intentId: string): Promise<RefundResult> {
    if (isDryRun()) return simulatedRefund(intentId);
    const res = await fetch("/functions/v1/payments-easypaisa/refund", {
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

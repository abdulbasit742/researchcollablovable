/**
 * Payment layer shared types.
 * Provider-agnostic: every gateway (JazzCash, Easypaisa, Stripe) maps onto these.
 */

export type PaymentProviderId = "jazzcash" | "easypaisa" | "stripe" | "mock";

export type Currency = "PKR" | "USD";

export type PaymentStatus =
  | "created"
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "refunded";

export type PaymentPurpose =
  | "wallet_topup"
  | "checkout"
  | "subscription"
  | "fyp_service"
  | "dataset"
  | "ai_credits";

export interface PaymentRequest {
  /** Amount in major units (e.g. 1500 = PKR 1500.00 or USD 1500.00). */
  amount: number;
  currency: Currency;
  purpose: PaymentPurpose;
  userId: string;
  /** Idempotency key — same key never double-charges. */
  idempotencyKey: string;
  /** Where to send the user back after a redirect-based flow. */
  returnUrl?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface PaymentIntent {
  id: string;
  provider: PaymentProviderId;
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  purpose: PaymentPurpose;
  userId: string;
  /** Present when the provider needs the user redirected (hosted checkout / OTP). */
  redirectUrl?: string;
  /** Provider-side reference id for reconciliation. */
  providerRef?: string;
  createdAt: string;
  /** True when no real charge happened (dry-run or mock). */
  simulated: boolean;
}

export interface RefundResult {
  intentId: string;
  status: "refunded" | "failed";
  simulated: boolean;
}

export interface WebhookVerifyResult {
  valid: boolean;
  intentId?: string;
  status?: PaymentStatus;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly currencies: Currency[];
  /** Whether real credentials are configured. */
  isConfigured(): boolean;
  createCharge(req: PaymentRequest): Promise<PaymentIntent>;
  refund(intentId: string): Promise<RefundResult>;
  verifyWebhook(rawBody: string, signature: string): Promise<WebhookVerifyResult>;
}

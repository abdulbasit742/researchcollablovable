# Payments

Gateway-agnostic payment layer. One API (`@/services/payments`), multiple rails.

## Why this exists

The app already had wallet / ledger / escrow / transaction plumbing, but **no way
to actually take money**. This layer is that missing piece: it turns checkout,
wallet top-ups, FYP-service payments, dataset sales, and AI credits into real
revenue.

## Providers

| Provider   | Currency | Use case                  | Status        |
|------------|----------|---------------------------|---------------|
| JazzCash   | PKR      | Pakistan mobile wallet    | dry-run stub  |
| Easypaisa  | PKR      | Pakistan mobile wallet    | dry-run stub  |
| Stripe     | USD/PKR  | International cards        | dry-run stub  |

For `PKR`, the hub prefers JazzCash, then Easypaisa, then Stripe. For `USD` it
uses Stripe.

## Safety: dry-run by default

**No real charge happens** unless BOTH are true:

1. `VITE_PAYMENTS_DRY_RUN=false`
2. The chosen provider has its keys set (e.g. `VITE_JAZZCASH_ENABLED=true` + merchant id).

Otherwise every charge returns a `simulated: true` PaymentIntent that succeeds
instantly, so the whole app is demoable end-to-end without money moving.

## Usage

```ts
import { walletTopup, paymentHub } from "@/services/payments";

// Top up a wallet (PKR -> JazzCash if configured, else simulated)
const res = await walletTopup.start({
  userId,
  amount: 1500,
  currency: "PKR",
});
if (res.redirectUrl) window.location.href = res.redirectUrl; // hosted checkout / OTP

// One-off charge
const intent = await paymentHub.charge({
  userId,
  amount: 9.99,
  currency: "USD",
  purpose: "ai_credits",
  idempotencyKey: crypto.randomUUID(),
});
```

## Going live (later, with review)

Secret keys (JazzCash integrity salt, Easypaisa hash key, Stripe secret key)
**must never** ship in the browser bundle. Live charges are delegated to Supabase
Edge Functions:

- `payments-jazzcash` / `payments-easypaisa` / `payments-stripe` — build signed sessions
- a webhook function settles redirect-based payments and credits the wallet via the ledger

Until those are deployed, keep `VITE_PAYMENTS_DRY_RUN=true`.

## Env vars

```
VITE_PAYMENTS_DRY_RUN=true
VITE_JAZZCASH_ENABLED=false
VITE_JAZZCASH_MERCHANT_ID=
VITE_EASYPAISA_ENABLED=false
VITE_EASYPAISA_STORE_ID=
VITE_STRIPE_PUBLISHABLE_KEY=
```

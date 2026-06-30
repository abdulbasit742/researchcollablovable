# Build Log

Autonomous build, one task per number. Each entry = a self-contained feature
pushed to `dev` (never direct to `main`).

| # | Feature | Files | Status |
|---|---------|-------|--------|
| 11 | Gateway-agnostic payment hub (JazzCash + Easypaisa + Stripe), dry-run safe. Unlocks real money for top-ups/checkout/marketplace. | `src/services/payments/*`, `docs/PAYMENTS.md` | on `dev` |
| 13 | Sellable AI credit packs metered on local Ollama (near-pure margin). Buy via payment hub, spend per AI action, full ledger + RLS. | `src/lib/ai/aiCredits.ts`, `supabase/migrations/20260630_ai_credits.sql` | on `dev` |
| 21 | Subscription tier checkout + recurring billing wired to payment hub. Buy/upgrade/cancel; tier names aligned with subscriptionGuard. | `src/lib/subscriptionService.ts` | on `dev` |
| 22 | PK gateway edge functions (JazzCash/Easypaisa session builders) + ONE unified settlement webhook that fulfils by purpose (wallet/credits/subscription), idempotent. Server-side glue that makes redirect payments actually settle. | `supabase/functions/payments-jazzcash`, `payments-easypaisa`, `payments-settle`, `supabase/migrations/20260630_payment_settlements.sql` | on `dev` |
| 28 | Wired CheckoutPage to the real payment hub (was demo-only). checkoutService bridges revenue/plans + credit packs onto paymentHub; redirect-aware; promo codes preserved. | `src/lib/revenue/checkoutService.ts`, `src/pages/CheckoutPage.tsx` | on `dev` |
| 33 | Live billing: BillingPage now reads real subscription/invoices/credits and does real cancel/downgrade/pause (was hardcoded plan + fake invoices + toast-only cancel). | `src/lib/revenue/billingService.ts`, `src/pages/BillingPage.tsx` | on `dev` |

## Conventions
- Services export an object of async methods under `src/services/`.
- Imports via `@/` alias. Dry-run / safe-by-default for anything touching money.
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions).
- All work lands on `dev`; merge to `main` after review.

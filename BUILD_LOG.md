# Build Log

Autonomous build, one task per number. Each entry = a self-contained feature
pushed to `dev` (never direct to `main`).

| # | Feature | Files | Status |
|---|---------|-------|--------|
| 11 | Gateway-agnostic payment hub (JazzCash + Easypaisa + Stripe), dry-run safe. | `src/services/payments/*`, `docs/PAYMENTS.md` | on `dev` |
| 13 | Sellable AI credit packs metered on local Ollama. | `src/lib/ai/aiCredits.ts`, `supabase/migrations/20260630_ai_credits.sql` | on `dev` |
| 21 | Subscription tier checkout + recurring billing. | `src/lib/subscriptionService.ts` | on `dev` |
| 22 | PK gateway edge functions + unified settlement webhook (idempotent). | `supabase/functions/payments-*`, `supabase/migrations/20260630_payment_settlements.sql` | on `dev` |
| 28 | Wired CheckoutPage to the real payment hub. | `src/lib/revenue/checkoutService.ts`, `src/pages/CheckoutPage.tsx` | on `dev` |
| 33 | Live billing: real subscription/invoices/credits + cancel/downgrade/pause. | `src/lib/revenue/billingService.ts`, `src/pages/BillingPage.tsx` | on `dev` |
| 34 | Marketplace service orders: escrow -> deliver -> accept minus platform commission. | `src/lib/marketplaceService.ts`, `supabase/migrations/20260630_marketplace_orders.sql` | on `dev` |
| 36 | Platform earnings aggregator across all streams. | `src/lib/revenue/platformEarnings.ts` | on `dev` |
| 42 | Admin finance counts ALL revenue + MRR + persists commission rate. | `src/hooks/useAdminFinance.ts`, `src/lib/admin/commissionSettings.ts`, `supabase/migrations/20260630_platform_settings.sql` | on `dev` |
| 44 | Client-side credit enforcement wrapper for the assistant. | `src/lib/ai/creditedAssistant.ts` | on `dev` |
| 46 | AICreditsPanel reads REAL balance + live ledger. | `src/components/revenue/AICreditsPanel.tsx` | on `dev` |
| 47 | Visibility boosts wired to wallet + platform revenue (4th stream). | `src/lib/revenue/boostService.ts`, `supabase/migrations/20260630_visibility_boosts.sql` | on `dev` |
| 49 | Local-first AI routing: Ollama first, Lovable fallback only. | `supabase/functions/_shared/llmRouter.ts`, `supabase/functions/ai-universal/index.ts`, `docs/AI_ROUTING.md` | on `dev` |
| 51 | SERVER-side AI credit enforcement in ai-universal. | `supabase/functions/_shared/aiCreditGuard.ts`, `supabase/functions/ai-universal/index.ts` | on `dev` |
| 53 | Payout / cash-out pipeline: request -> approve -> disburse (dry-run safe). | `src/lib/revenue/payoutService.ts`, `supabase/migrations/20260630_payouts.sql` | on `dev` |
| 55 | Server-side payout disbursement edge fn (live cash-out), idempotent. | `supabase/functions/payouts-disburse/index.ts` | on `dev` |
| 61 | Referral reward fulfillment: credits on conversion, cash on first purchase / institution. | `src/lib/referral/referralRewards.ts` | on `dev` |
| 62 | Referral hooks: capture ?ref=, fulfil on signup, pay cash on first purchase. | `src/lib/referral/referralHooks.ts` | on `dev` |
| 63 | Wired captureReferralFromUrl() into main.tsx bootstrap. | `src/main.tsx` | on `dev` |
| 70 | Wired onSignupComplete() into AuthPage post-auth redirect. | `src/pages/AuthPage.tsx` | on `dev` |
| 72 | Wired first-purchase referral payout into the settlement webhook (server-side). | `supabase/functions/payments-settle/index.ts` | on `dev` |
| 73 | Shared credited ai-universal client: handles server 402 -> InsufficientCreditsError + top-up toast; streaming + non-streaming. The credited path all AI hooks should call. Closes the LAST pending-wiring item. | `src/lib/ai/aiUniversalClient.ts` | on `dev` |

## Conventions
- Services export an object of async methods under `src/services/`.
- Imports via `@/` alias. Dry-run / safe-by-default for anything touching money (in AND out).
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions).
- AI routes through local Ollama first (cost ~0); Lovable gateway is fallback only.
- AI credits enforced SERVER-side in ai-universal; UI calls callAIUniversal/streamAIUniversal (#73) for the 402 top-up UX.
- All work lands on `dev`; merge to `main` after review.

## Wiring — ALL CLOSED
- [x] captureReferralFromUrl() in app bootstrap (main.tsx) — #63.
- [x] onSignupComplete(userId) on first authenticated landing (AuthPage) — #70.
- [x] First-purchase referral payout in settlement webhook (server-side) — #72.
- [x] Credited AI path: callAIUniversal/streamAIUniversal handle 402 + top-up — #73.
  (Remaining: migrate individual domain hooks to import this client — mechanical, do during merge.)

## Money flow complete (both directions, server-enforced)
- **IN:**  payment hub (#11) -> gateway sessions + settlement (#22) -> wallet/credits/subscription.
- **OUT:** earnings -> wallet -> payout request/approve (#53) -> disbursement edge fn (#55).

## Revenue streams live
1. Subscriptions (#21/#28/#33)  2. AI credits (#13/#44/#46/#49/#51/#73)
3. Marketplace commission (#34)  4. Visibility boosts (#47)
Growth: referral rewards (#61) fired by hooks (#62), captured (#63), converted on signup (#70), first-purchase cash via settlement (#72).

## STATUS: feature-complete revenue + growth stack on `dev`. Ready for review + merge to main.

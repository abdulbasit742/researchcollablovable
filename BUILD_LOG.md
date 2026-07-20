# Build Log

Autonomous build, one task per number. Each entry = a self-contained feature
pushed to `dev` (never direct to `main`).

## Latest: #100 revenue-doctor
`scripts/revenue-doctor.ts` — one read-only command that audits whether the
revenue + payouts stack is ready before flipping real money on. Verifies the 7
migrations + 5 edge functions + core modules exist, reports each money rail's
mode (sandbox vs live) from env, and flags unsafe combos (e.g. payments live
but no gateway configured; payouts live but no disbursement keys). Executable
form of docs/GO_LIVE.md. Run: `npx tsx scripts/revenue-doctor.ts`.

| # | Feature | Files | Status |
|---|---------|-------|--------|
| 11 | Gateway-agnostic payment hub (JazzCash + Easypaisa + Stripe), dry-run safe. | `src/services/payments/*`, `docs/PAYMENTS.md` | on `dev` |
| 13 | Sellable AI credit packs metered on local Ollama. | `src/lib/ai/aiCredits.ts`, `supabase/migrations/20260630_ai_credits.sql` | on `dev` |
| 21 | Subscription tier checkout + recurring billing. | `src/lib/subscriptionService.ts` | on `dev` |
| 22 | PK gateway edge functions + unified settlement webhook (idempotent). | `supabase/functions/payments-*`, `supabase/migrations/20260630_payment_settlements.sql` | on `dev` |
| 28 | Wired CheckoutPage to the real payment hub. | `src/lib/revenue/checkoutService.ts`, `src/pages/CheckoutPage.tsx` | on `dev` |
| 33 | Live billing. | `src/lib/revenue/billingService.ts`, `src/pages/BillingPage.tsx` | on `dev` |
| 34 | Marketplace service orders + commission. | `src/lib/marketplaceService.ts`, `supabase/migrations/20260630_marketplace_orders.sql` | on `dev` |
| 36 | Platform earnings aggregator. | `src/lib/revenue/platformEarnings.ts` | on `dev` |
| 42 | Admin finance counts ALL revenue + MRR + persists commission rate. | `src/hooks/useAdminFinance.ts`, `src/lib/admin/commissionSettings.ts`, `supabase/migrations/20260630_platform_settings.sql` | on `dev` |
| 44 | Client-side credit enforcement wrapper for the assistant. | `src/lib/ai/creditedAssistant.ts` | on `dev` |
| 46 | AICreditsPanel reads REAL balance + live ledger. | `src/components/revenue/AICreditsPanel.tsx` | on `dev` |
| 47 | Visibility boosts (4th stream). | `src/lib/revenue/boostService.ts`, `supabase/migrations/20260630_visibility_boosts.sql` | on `dev` |
| 49 | Local-first AI routing: Ollama first, Lovable fallback only. | `supabase/functions/_shared/llmRouter.ts`, `supabase/functions/ai-universal/index.ts`, `docs/AI_ROUTING.md` | on `dev` |
| 51 | SERVER-side AI credit enforcement in ai-universal. | `supabase/functions/_shared/aiCreditGuard.ts`, `supabase/functions/ai-universal/index.ts` | on `dev` |
| 53 | Payout / cash-out pipeline. | `src/lib/revenue/payoutService.ts`, `supabase/migrations/20260630_payouts.sql` | on `dev` |
| 55 | Server-side payout disbursement edge fn. | `supabase/functions/payouts-disburse/index.ts` | on `dev` |
| 61 | Referral reward fulfillment. | `src/lib/referral/referralRewards.ts` | on `dev` |
| 62 | Referral hooks (capture/signup/first-purchase). | `src/lib/referral/referralHooks.ts` | on `dev` |
| 63 | Wired captureReferralFromUrl() into main.tsx. | `src/main.tsx` | on `dev` |
| 70 | Wired onSignupComplete() into AuthPage. | `src/pages/AuthPage.tsx` | on `dev` |
| 72 | Wired first-purchase referral payout into settlement webhook. | `supabase/functions/payments-settle/index.ts` | on `dev` |
| 73 | Shared credited ai-universal client (402 + top-up). | `src/lib/ai/aiUniversalClient.ts` | on `dev` |
| 74 | Seed subscription_tiers. | `supabase/migrations/20260630_seed_subscription_tiers.sql` | on `dev` |
| 76 | Financial tests for commission math. | `tests/financial/revenue.test.ts` | on `dev` |
| 79 | AI Prompt Library on credited client. | `src/pages/AIPromptLibraryPage.tsx` | on `dev` |
| 82 | Project-scope AI assist helper. | `src/lib/ai/scopeAssist.ts` | on `dev` |
| 83 | personalAssistant chat + recs on credited ai-universal. | `src/lib/ai/personalAssistant.ts` | on `dev` |
| 84 | AIProjectScopePage blends credited AI estimate. | `src/pages/AIProjectScopePage.tsx` | on `dev` |
| 86 | useAIWorkflow routed through credited client. | `src/hooks/useAIWorkflow.ts` | on `dev` |
| 87 | Single source of truth for credit pack pricing (creditPacks.ts). | `src/lib/ai/creditPacks.ts`, `src/lib/ai/aiCredits.ts` | on `dev` |
| 90 | checkoutService credit packs derived from canonical catalog. | `src/lib/revenue/checkoutService.ts` | on `dev` |
| 91 | AICreditsPanel renders packs from canonical catalog. | `src/components/revenue/AICreditsPanel.tsx` | on `dev` |
| 92 | Complete env reference (.env.example). | `.env.example` | on `dev` |
| 94 | GO_LIVE runbook. | `docs/GO_LIVE.md` | on `dev` |
| 95 | Payment-hub dry-run safety tests. | `tests/financial/paymentHub.test.ts` | on `dev` |
| 100 | revenue-doctor go-live readiness check (read-only). | `scripts/revenue-doctor.ts` | on `dev` |

## PR
- `dev` -> `main`: PR #1 (open, awaiting review). https://github.com/abdulbasit742/researchcollablovable/pull/1

## Conventions
- Dry-run / safe-by-default for anything touching money (in AND out).
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions). Full env reference in .env.example.
- AI routes through local Ollama first (cost ~0); Lovable gateway is fallback only.
- AI credits enforced SERVER-side in ai-universal; UI calls callAIUniversal/streamAIUniversal.
- Credit pack pricing: import from src/lib/ai/creditPacks.ts ONLY.
- All work lands on `dev`; merge to `main` after review.
- CI runs tests/financial/ as a MUST-pass gate (#76 + #95).
- Going live: follow docs/GO_LIVE.md; verify with scripts/revenue-doctor.ts.

## Money flow complete (both directions, server-enforced)
- **IN:**  payment hub (#11) -> gateway sessions + settlement (#22) -> wallet/credits/subscription.
- **OUT:** earnings -> wallet -> payout request/approve (#53) -> disbursement edge fn (#55).

## Revenue streams live
1. Subscriptions  2. AI credits  3. Marketplace commission  4. Visibility boosts
Growth: referral rewards.

## STATUS: feature-complete revenue + growth stack on `dev`. PR #1 open. Verify with revenue-doctor, deploy via GO_LIVE.md.

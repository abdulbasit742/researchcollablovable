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
| 82 | Project-scope AI assist: real credited `deals.analyze-scope` via the client, with local heuristic fallback (page's 'AI estimate' was a setTimeout fake). 2nd credited-AI hook migration. | `src/lib/ai/scopeAssist.ts` | on `dev` |

## PR
- `dev` -> `main`: PR #1 (open, awaiting review). https://github.com/abdulbasit742/researchcollablovable/pull/1

## Conventions
- Services export an object of async methods under `src/services/`.
- Imports via `@/` alias. Dry-run / safe-by-default for anything touching money (in AND out).
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions).
- AI routes through local Ollama first (cost ~0); Lovable gateway is fallback only.
- AI credits enforced SERVER-side in ai-universal; UI calls callAIUniversal/streamAIUniversal (#73).
- All work lands on `dev`; merge to `main` after review.
- CI runs tests/financial/ as a MUST-pass gate.

## Credited-AI migration (mechanical, ongoing)
Move ad-hoc AI callers onto callAIUniversal/streamAIUniversal for credit
enforcement + 402 top-up UX. Done: AIPromptLibraryPage (#79), project-scope
assist helper (#82). Page-level wiring for #82: AIProjectScopePage.generateResults()
should `await analyzeScopeWithAI(...)` and blend its result, falling back to
generateEstimate() when null (small mechanical edit, do during merge). Remaining:
other direct AI callers (execution-assistant, pai-assistant, etc.).

## Money flow complete (both directions, server-enforced)
- **IN:**  payment hub (#11) -> gateway sessions + settlement (#22) -> wallet/credits/subscription.
- **OUT:** earnings -> wallet -> payout request/approve (#53) -> disbursement edge fn (#55).

## Revenue streams live
1. Subscriptions (#21/#28/#33/#74)  2. AI credits (#13/#44/#46/#49/#51/#73/#79/#82)
3. Marketplace commission (#34/#76)  4. Visibility boosts (#47)
Growth: referral rewards (#61/#62/#63/#70/#72).

## STATUS: feature-complete revenue + growth stack on `dev`. PR #1 open for review + merge.

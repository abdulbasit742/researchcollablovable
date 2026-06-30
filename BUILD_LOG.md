# Build Log

Autonomous build, one task per number. Each entry = a self-contained feature
pushed to `dev` (never direct to `main`).

| # | Feature | Files | Status |
|---|---------|-------|--------|
| 11 | Gateway-agnostic payment hub (JazzCash + Easypaisa + Stripe), dry-run safe. | `src/services/payments/*`, `docs/PAYMENTS.md` | on `dev` |
| 13 | Sellable AI credit packs metered on local Ollama. Buy via payment hub, spend per AI action, full ledger + RLS. | `src/lib/ai/aiCredits.ts`, `supabase/migrations/20260630_ai_credits.sql` | on `dev` |
| 21 | Subscription tier checkout + recurring billing wired to payment hub. | `src/lib/subscriptionService.ts` | on `dev` |
| 22 | PK gateway edge functions + unified settlement webhook (idempotent), fulfils by purpose. | `supabase/functions/payments-jazzcash`, `payments-easypaisa`, `payments-settle`, `supabase/migrations/20260630_payment_settlements.sql` | on `dev` |
| 28 | Wired CheckoutPage to the real payment hub (was demo-only). | `src/lib/revenue/checkoutService.ts`, `src/pages/CheckoutPage.tsx` | on `dev` |
| 33 | Live billing: real subscription/invoices/credits + real cancel/downgrade/pause. | `src/lib/revenue/billingService.ts`, `src/pages/BillingPage.tsx` | on `dev` |
| 34 | Marketplace service orders: escrow -> deliver -> accept releases to seller MINUS platform commission. | `src/lib/marketplaceService.ts`, `supabase/migrations/20260630_marketplace_orders.sql` | on `dev` |
| 36 | Platform earnings aggregator across all streams: total/by-stream/MRR/rolling/12-mo. | `src/lib/revenue/platformEarnings.ts` | on `dev` |
| 42 | Admin finance counts ALL revenue streams + MRR + persists commission rate. | `src/hooks/useAdminFinance.ts`, `src/lib/admin/commissionSettings.ts`, `supabase/migrations/20260630_platform_settings.sql` | on `dev` |
| 44 | Client-side credit enforcement wrapper for the personal assistant (chat/recommendations). | `src/lib/ai/creditedAssistant.ts` | on `dev` |
| 46 | AICreditsPanel reads REAL balance + live ledger (was hardcoded demo). | `src/components/revenue/AICreditsPanel.tsx` | on `dev` |
| 47 | Visibility boosts wired to wallet + platform revenue (4th stream), time-boxed + auto-lapse. | `src/lib/revenue/boostService.ts`, `supabase/migrations/20260630_visibility_boosts.sql` | on `dev` |
| 49 | Local-first AI routing: Ollama (qwen2.5) first, Lovable PAID gateway fallback only. | `supabase/functions/_shared/llmRouter.ts`, `supabase/functions/ai-universal/index.ts`, `docs/AI_ROUTING.md` | on `dev` |
| 51 | SERVER-side AI credit enforcement in ai-universal (closes the bypass: #44 was client-only; every domain tool hit the edge fn directly with no debit). Per-action cost map, 402 if short, debit on success, refund on stream error. | `supabase/functions/_shared/aiCreditGuard.ts`, `supabase/functions/ai-universal/index.ts` | on `dev` |

## Conventions
- Services export an object of async methods under `src/services/`.
- Imports via `@/` alias. Dry-run / safe-by-default for anything touching money.
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions).
- AI routes through local Ollama first (cost ~0); Lovable gateway is fallback only.
- AI credits enforced SERVER-side in ai-universal (client checks are UX only).
- All work lands on `dev`; merge to `main` after review.

## Revenue streams now live (all dry-run safe)
1. **Subscriptions** (#21/#28/#33).
2. **AI credits** (#13/#44/#46/#49) — enforced client + SERVER (#51), local Ollama margin.
3. **Marketplace commission** (#34).
4. **Visibility boosts** (#47).
All roll up into platform earnings (#36) and the admin finance dashboard (#42).

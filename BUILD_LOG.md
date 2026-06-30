# Build Log

Autonomous build, one task per number. Each entry = a self-contained feature
pushed to `dev` (never direct to `main`).

| # | Feature | Files | Status |
|---|---------|-------|--------|
| 11 | Gateway-agnostic payment hub (JazzCash + Easypaisa + Stripe), dry-run safe. Unlocks real money for top-ups/checkout/marketplace. | `src/services/payments/*`, `docs/PAYMENTS.md` | on `dev` |
| 13 | Sellable AI credit packs metered on local Ollama (near-pure margin). Buy via payment hub, spend per AI action, full ledger + RLS. | `src/lib/ai/aiCredits.ts`, `supabase/migrations/20260630_ai_credits.sql` | on `dev` |
| 21 | Subscription tier checkout + recurring billing wired to payment hub. Buy/upgrade/cancel; tier names aligned with subscriptionGuard. | `src/lib/subscriptionService.ts` | on `dev` |

## Conventions
- Services export an object of async methods under `src/services/`.
- Imports via `@/` alias. Dry-run / safe-by-default for anything touching money.
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions).
- All work lands on `dev`; merge to `main` after review.

# Build Log

Autonomous build, one task per number. Each entry = a self-contained feature
pushed to `dev` (never direct to `main`).

| # | Feature | Files | Status |
|---|---------|-------|--------|
| 11 | Gateway-agnostic payment hub (JazzCash + Easypaisa + Stripe), dry-run safe. Unlocks real money for top-ups/checkout/marketplace. | `src/services/payments/*`, `docs/PAYMENTS.md` | on `dev` |

## Conventions
- Services export an object of async methods under `src/services/`.
- Imports via `@/` alias. Dry-run / safe-by-default for anything touching money.
- Secret keys never in the browser bundle (delegated to Supabase Edge Functions).
- All work lands on `dev`; merge to `main` after review.

# Go-Live Runbook — Revenue + Payouts

The whole stack is **dry-run safe by default**. This is the ordered path to take
it live deliberately. Do it on `main` after PR #1 is merged + reviewed.

> Golden rule: flip money to live LAST, one rail at a time, and watch the first
> real transaction end-to-end before opening it to users.

## 1. Database migrations (run in order)

Apply the `supabase/migrations/20260630_*` files:

1. `ai_credits` — credit balances + ledger + `apply_ai_credit_delta`
2. `payment_settlements` — settlement ledger + `credit_wallet`
3. `marketplace_orders` — orders + `platform_revenue`
4. `platform_settings` — commission rate store
5. `visibility_boosts` — boosts + purchase/expire RPCs
6. `payouts` — payout methods/requests + hold/release RPCs
7. `seed_subscription_tiers` — MUST run so paid plans resolve tier_id

Verify: `subscription_tiers` has rows; RLS is enabled on every new table.

## 2. Deploy edge functions

`payments-jazzcash`, `payments-easypaisa`, `payments-settle`, `payouts-disburse`,
and the updated `ai-universal`. Confirm each has its secrets (see step 3).

## 3. Set edge-function secrets (server-only)

`supabase secrets set` for everything under EDGE FUNCTION SECRETS in
`.env.example`. At minimum for AI + Pakistan rails:

- AI: `LLM_DEFAULT_PROVIDER=ollama`, `OLLAMA_URL`, `OLLAMA_MODEL`, `LOVABLE_API_KEY` (fallback)
- Gateways: `JAZZCASH_*`, `EASYPAISA_*`
- Payouts: `JAZZCASH_PAYOUT_*`, `EASYPAISA_PAYOUT_*`

## 4. Stay in sandbox first

Keep client flags at defaults and run the full smoke (step 6) with simulated
money:

```
VITE_PAYMENTS_DRY_RUN=true
VITE_PAYOUTS_DRY_RUN=true
PAYOUTS_DRY_RUN=true        # edge
AI_CREDITS_ENFORCED=true
```

Everything should work end-to-end with `simulated: true` intents.

## 5. Go live, ONE rail at a time

Flip in this order, smoke-testing after each:

1. **AI credits / subscriptions IN (cards):** set `VITE_STRIPE_PUBLISHABLE_KEY` live
   + Stripe secret on the edge; keep `VITE_PAYMENTS_DRY_RUN=false`.
2. **PK rails IN:** `VITE_JAZZCASH_ENABLED=true` (+merchant id) and/or
   `VITE_EASYPAISA_ENABLED=true` (+store id). Do a real PKR 1 top-up; confirm the
   settlement webhook credits the wallet exactly once.
3. **Payouts OUT (last):** `VITE_PAYOUTS_DRY_RUN=false` + `PAYOUTS_DRY_RUN=false`
   + payout disbursement keys. Do a real small payout to your own number first.

## 6. Smoke checklist (per money path)

- [ ] Buy a credit pack → balance increases by exactly the pack amount (once).
- [ ] Run an AI action → credits debit; at 0 credits you get the 402 top-up prompt.
- [ ] Subscribe to a tier → `user_subscriptions` active with a non-null `tier_id`;
      subscriptionGuard unlocks the tier's limits.
- [ ] Marketplace order → escrow funds; accept → seller gets net, `platform_revenue`
      gets the commission.
- [ ] Visibility boost → wallet debits, boost active, auto-lapses at expiry.
- [ ] Referral → invite link converts on signup (credits both sides); first paid
      action pays the referrer cash (once).
- [ ] Payout → request → (auto/admin) approve → disburse → status `paid`, pending
      hold cleared, money received.
- [ ] Admin finance dashboard totals match what actually moved.
- [ ] CI green, including the financial test gate.

## 7. Rollback

Fastest, safest revert is to flip money back to sandbox — no redeploy needed:

```
VITE_PAYMENTS_DRY_RUN=true
VITE_PAYOUTS_DRY_RUN=true
PAYOUTS_DRY_RUN=true        # edge
```

New transactions immediately become simulated. Investigate, fix, re-flip. For a
code-level revert, roll `main` back to the pre-merge commit; all new tables are
additive and safe to leave in place.

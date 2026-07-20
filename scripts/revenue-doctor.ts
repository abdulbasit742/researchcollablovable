/**
 * revenue-doctor — go-live readiness check for the revenue + payouts stack.
 *
 * Read-only. Audits that the pieces from BUILD_LOG / GO_LIVE.md are present and
 * reports how "live" each money rail is from the current env, flagging unsafe
 * combinations before you flip real money on.
 *
 *   npx tsx scripts/revenue-doctor.ts
 *
 * Exit code 0 = ready (sandbox or live, no unsafe combos); 1 = problems found.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");
const rel = (p: string) => resolve(root, p);

let problems = 0;
let warnings = 0;
const ok = (m: string) => console.log(`  \u2713 ${m}`);
const warn = (m: string) => { console.log(`  \u26a0 ${m}`); warnings++; };
const fail = (m: string) => { console.log(`  \u2717 ${m}`); problems++; };

function section(title: string) { console.log(`\n${title}`); }

// ── 1. Migrations present ──
section("Migrations");
const MIGRATIONS = [
  "ai_credits",
  "payment_settlements",
  "marketplace_orders",
  "platform_settings",
  "visibility_boosts",
  "payouts",
  "seed_subscription_tiers",
];
for (const m of MIGRATIONS) {
  const p = `supabase/migrations/20260630_${m}.sql`;
  existsSync(rel(p)) ? ok(p) : fail(`missing migration: ${p}`);
}

// ── 2. Edge functions present ──
section("Edge functions");
const FUNCTIONS = [
  "payments-jazzcash",
  "payments-easypaisa",
  "payments-settle",
  "payouts-disburse",
  "ai-universal",
];
for (const f of FUNCTIONS) {
  const p = `supabase/functions/${f}/index.ts`;
  existsSync(rel(p)) ? ok(`${f}`) : fail(`missing edge function: ${p}`);
}

// ── 3. Core source modules present ──
section("Core modules");
const MODULES = [
  "src/services/payments/paymentHub.ts",
  "src/lib/ai/aiCredits.ts",
  "src/lib/ai/creditPacks.ts",
  "src/lib/ai/aiUniversalClient.ts",
  "src/lib/revenue/checkoutService.ts",
  "src/lib/revenue/billingService.ts",
  "src/lib/revenue/platformEarnings.ts",
  "src/lib/revenue/payoutService.ts",
  "src/lib/marketplaceService.ts",
  "src/lib/referral/referralRewards.ts",
  "supabase/functions/_shared/aiCreditGuard.ts",
  "supabase/functions/_shared/llmRouter.ts",
];
for (const m of MODULES) existsSync(rel(m)) ? ok(m) : fail(`missing module: ${m}`);

// ── 4. Money rail modes (from env) ──
section("Money rails (current env)");
const env = process.env;
const isFalse = (v?: string) => String(v ?? "").toLowerCase() === "false";

const paymentsLive = isFalse(env.VITE_PAYMENTS_DRY_RUN);
const payoutsLive = isFalse(env.VITE_PAYOUTS_DRY_RUN) || isFalse(env.PAYOUTS_DRY_RUN);
const jazzcash = env.VITE_JAZZCASH_ENABLED === "true";
const easypaisa = env.VITE_EASYPAISA_ENABLED === "true";
const stripe = Boolean(env.VITE_STRIPE_PUBLISHABLE_KEY);

console.log(`  payments: ${paymentsLive ? "LIVE" : "sandbox (dry-run)"}`);
console.log(`  payouts:  ${payoutsLive ? "LIVE" : "sandbox (dry-run)"}`);
console.log(`  gateways: jazzcash=${jazzcash} easypaisa=${easypaisa} stripe=${stripe}`);

// ── 5. Unsafe-combo checks ──
section("Safety checks");
if (paymentsLive && !jazzcash && !easypaisa && !stripe) {
  fail("payments are LIVE but no gateway is enabled/configured — charges will fail");
} else if (paymentsLive) {
  ok("payments live with at least one gateway configured");
} else {
  ok("payments in sandbox — safe");
}

if (payoutsLive && isFalse(env.VITE_PAYOUTS_DRY_RUN) && !isFalse(env.PAYOUTS_DRY_RUN)) {
  warn("client payouts LIVE but edge PAYOUTS_DRY_RUN not false — disbursement will simulate server-side");
}
if (payoutsLive && (env.JAZZCASH_PAYOUT_KEY || env.EASYPAISA_PAYOUT_KEY)) {
  ok("payouts live with disbursement keys present");
} else if (payoutsLive) {
  fail("payouts are LIVE but no disbursement keys set — payouts will fail");
} else {
  ok("payouts in sandbox — safe");
}

const aiProvider = (env.LLM_DEFAULT_PROVIDER ?? "ollama").toLowerCase();
if (aiProvider === "lovable" && !env.LOVABLE_API_KEY) {
  fail("LLM_DEFAULT_PROVIDER=lovable but LOVABLE_API_KEY is unset");
} else {
  ok(`AI default provider: ${aiProvider}${aiProvider === "ollama" ? " (cost ~0)" : ""}`);
}
if (isFalse(env.AI_CREDITS_ENFORCED)) {
  warn("AI_CREDITS_ENFORCED=false — AI is free/unmetered (revenue model off)");
} else {
  ok("AI credits enforced server-side");
}

// ── Summary ──
section("Summary");
console.log(`  ${problems} problem(s), ${warnings} warning(s)`);
if (problems === 0) {
  console.log("  \u2713 Revenue stack looks ready. Follow docs/GO_LIVE.md to flip rails one at a time.");
} else {
  console.log("  \u2717 Fix the problems above before going live.");
}
process.exit(problems === 0 ? 0 : 1);

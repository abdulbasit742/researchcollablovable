/**
 * AI Credit Packs — SINGLE SOURCE OF TRUTH for pricing.
 *
 * Why this exists: pack prices/credits had drifted across the app
 * (aiCredits.ts vs checkoutService.ts vs the billing panels), so a user could
 * see one price and be charged another. Everything that sells or displays a
 * credit pack must import from here.
 *
 * Pricing is PKR. Tune in one place; all surfaces follow.
 */
import type { Currency } from "@/services/payments";

export interface CreditPack {
  /** Stable id used in checkout deep-links (?credits=<id>) and analytics. */
  id: string;
  label: string;
  credits: number;
  price: number;
  currency: Currency;
  badge?: string;
}

/** The canonical catalog. Keys double as the checkout `credits` param. */
export const CREDIT_PACKS: CreditPack[] = [
  { id: "500",   label: "Starter",      credits: 500,   price: 499,  currency: "PKR" },
  { id: "2000",  label: "Student",      credits: 2000,  price: 1799, currency: "PKR", badge: "Popular" },
  { id: "5000",  label: "Pro",          credits: 5000,  price: 3999, currency: "PKR", badge: "Best value" },
  { id: "12000", label: "Research Lab", credits: 12000, price: 8999, currency: "PKR" },
];

/** Lookup by the checkout `credits` id (e.g. "2000"). */
export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** Map shape some callers prefer: { "2000": { credits, price } }. */
export function creditPackMap(): Record<string, { credits: number; price: number }> {
  return Object.fromEntries(CREDIT_PACKS.map((p) => [p.id, { credits: p.credits, price: p.price }]));
}

/** Price-per-credit for display ("PKR x.xx / credit"). */
export function pricePerCredit(pack: CreditPack): number {
  return pack.credits > 0 ? pack.price / pack.credits : 0;
}

import { describe, it, expect } from "vitest";
import { calcCommission, COMMISSION_RATE, type PlanId } from "@/lib/revenue/plans";

/**
 * Money-math guard for the marketplace commission split (#34).
 * Pure functions only — no Supabase, no network — so this runs in CI and the
 * existing 'financial tests MUST pass' gate now actually covers revenue logic.
 */
describe("calcCommission", () => {
  it("splits gross into fee + net using the plan's rate", () => {
    const { gross, fee, rate, net } = calcCommission(10000, "researcher_pro");
    expect(gross).toBe(10000);
    expect(rate).toBe(0.1);
    expect(fee).toBe(1000);
    expect(net).toBe(9000);
  });

  it("invariant: fee + net === gross for every tier", () => {
    const tiers: PlanId[] = [
      "free", "student_pro", "researcher_pro", "supervisor", "department", "enterprise",
    ];
    const grosses = [1, 99, 100, 1500, 33333, 1_000_000];
    for (const tier of tiers) {
      for (const g of grosses) {
        const { fee, net } = calcCommission(g, tier);
        expect(fee + net).toBe(g);
        expect(fee).toBeGreaterThanOrEqual(0);
        expect(net).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("higher tiers keep more (commission rate is non-increasing by tier value)", () => {
    expect(COMMISSION_RATE.free).toBeGreaterThan(COMMISSION_RATE.researcher_pro);
    expect(COMMISSION_RATE.researcher_pro).toBeGreaterThanOrEqual(COMMISSION_RATE.department);
    expect(COMMISSION_RATE.department).toBeGreaterThan(COMMISSION_RATE.enterprise);
  });

  it("defaults to researcher_pro when no plan is given", () => {
    expect(calcCommission(5000).rate).toBe(COMMISSION_RATE.researcher_pro);
  });

  it("rounds the fee to a whole unit (no fractional paisa drift)", () => {
    const { fee } = calcCommission(333, "researcher_pro"); // 33.3 -> 33
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(33);
  });

  it("handles a zero-gross order without producing NaN", () => {
    const { fee, net } = calcCommission(0, "free");
    expect(fee).toBe(0);
    expect(net).toBe(0);
  });
});

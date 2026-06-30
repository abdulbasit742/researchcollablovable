import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Payment hub safety guard (#11/#95).
 *
 * The critical invariant for this whole stack: in dry-run, a charge NEVER hits
 * a real gateway — it resolves to a simulated, succeeded intent. We also pin
 * currency->provider routing and input validation. Pure (no network): the
 * providers short-circuit to a simulated intent when dry-run/!configured.
 */

// Ensure dry-run + no provider keys BEFORE importing the hub (providers read env at call time).
beforeEach(() => {
  vi.stubEnv("VITE_PAYMENTS_DRY_RUN", "true");
  vi.stubEnv("VITE_JAZZCASH_ENABLED", "false");
  vi.stubEnv("VITE_EASYPAISA_ENABLED", "false");
  vi.stubEnv("VITE_STRIPE_PUBLISHABLE_KEY", "");
});

async function freshHub() {
  vi.resetModules();
  return (await import("@/services/payments")).paymentHub;
}

const base = {
  userId: "00000000-0000-0000-0000-000000000001",
  amount: 1500,
  purpose: "ai_credits" as const,
  idempotencyKey: "test-key-1",
};

describe("paymentHub dry-run safety", () => {
  it("reports dry-run on by default", async () => {
    const hub = await freshHub();
    expect(hub.dryRun()).toBe(true);
  });

  it("PKR charge resolves to a simulated, succeeded intent (no real charge)", async () => {
    const hub = await freshHub();
    const intent = await hub.charge({ ...base, currency: "PKR" });
    expect(intent.simulated).toBe(true);
    expect(intent.status).toBe("succeeded");
    expect(intent.currency).toBe("PKR");
    // PKR should route to a Pakistan-first provider when none configured.
    expect(["jazzcash", "easypaisa"]).toContain(intent.provider);
  });

  it("USD charge routes to Stripe and is simulated in dry-run", async () => {
    const hub = await freshHub();
    const intent = await hub.charge({ ...base, currency: "USD" });
    expect(intent.simulated).toBe(true);
    expect(intent.provider).toBe("stripe");
  });

  it("rejects a non-positive amount", async () => {
    const hub = await freshHub();
    await expect(hub.charge({ ...base, currency: "PKR", amount: 0 })).rejects.toThrow();
  });

  it("requires an idempotency key", async () => {
    const hub = await freshHub();
    await expect(hub.charge({ ...base, currency: "PKR", idempotencyKey: "" })).rejects.toThrow();
  });

  it("lists providers with currency coverage", async () => {
    const hub = await freshHub();
    const providers = hub.listProviders();
    const ids = providers.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["jazzcash", "easypaisa", "stripe"]));
    expect(providers.find((p) => p.id === "stripe")?.currencies).toContain("USD");
  });
});

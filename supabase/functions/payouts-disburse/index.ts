// Server-side payout disbursement.
//
// Sends money OUT to a user's registered payout method. The disbursement API
// credentials live only here (never in the browser). Called by payoutService
// (#53) in live mode; dry-run is also honored here as a second safety net.
//
// Idempotent: a payout already marked 'paid' is never disbursed again.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function dryRun(): boolean {
  return (Deno.env.get("PAYOUTS_DRY_RUN") ?? "true").toLowerCase() !== "false";
}

interface DisburseBody { payoutId: string; }

// deno-lint-ignore no-explicit-any
async function providerDisburse(method: any, amount: number, ref: string): Promise<string> {
  // Each gateway has its own disbursement / money-transfer API. These are
  // delegated here so keys stay server-side. Endpoints are env-configured.
  switch (method.type) {
    case "jazzcash": {
      const url = Deno.env.get("JAZZCASH_PAYOUT_URL");
      const key = Deno.env.get("JAZZCASH_PAYOUT_KEY");
      if (!url || !key) throw new Error("JazzCash payout not configured");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ msisdn: method.account_number, amount, reference: ref }),
      });
      if (!res.ok) throw new Error(`JazzCash payout failed: ${res.status}`);
      const body = await res.json();
      return body.transactionId ?? ref;
    }
    case "easypaisa": {
      const url = Deno.env.get("EASYPAISA_PAYOUT_URL");
      const key = Deno.env.get("EASYPAISA_PAYOUT_KEY");
      if (!url || !key) throw new Error("Easypaisa payout not configured");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ account: method.account_number, amount, reference: ref }),
      });
      if (!res.ok) throw new Error(`Easypaisa payout failed: ${res.status}`);
      const body = await res.json();
      return body.transactionId ?? ref;
    }
    case "bank": {
      // Bank transfers are typically batched/manual; record intent and let an
      // operations job reconcile. Returns a pending reference.
      return `BANK-PENDING-${ref}`;
    }
    default:
      throw new Error(`Unknown payout method type: ${method.type}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const { payoutId } = (await req.json()) as DisburseBody;

    const { data: payout, error } = await admin
      .from("payout_requests").select("*").eq("id", payoutId).single();
    if (error || !payout) return json({ error: "Payout not found" }, 404);

    if (payout.status === "paid") {
      return json({ ok: true, alreadyPaid: true, providerRef: payout.provider_ref });
    }
    if (payout.status !== "approved") {
      return json({ error: `Payout not approved (status=${payout.status})` }, 409);
    }

    // Dry-run second safety net (matches client default).
    if (dryRun()) {
      await markPaid(admin, payout, `SIMULATED-${payoutId}`);
      return json({ ok: true, simulated: true, providerRef: `SIMULATED-${payoutId}` });
    }

    const { data: method } = await admin
      .from("payout_methods").select("*").eq("id", payout.method_id).single();
    if (!method) return json({ error: "Payout method not found" }, 404);

    const providerRef = await providerDisburse(method, Number(payout.amount), payoutId);
    await markPaid(admin, payout, providerRef);
    return json({ ok: true, providerRef });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});

// deno-lint-ignore no-explicit-any
async function markPaid(admin: any, payout: any, providerRef: string): Promise<void> {
  // Clear the pending hold (money has left the platform) and mark paid.
  await admin.rpc("release_payout_hold", {
    p_user_id: payout.user_id,
    p_amount: Number(payout.amount),
    p_back_to_available: false,
  });
  await admin
    .from("payout_requests")
    .update({ status: "paid", provider_ref: providerRef, paid_at: new Date().toISOString() })
    .eq("id", payout.id);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

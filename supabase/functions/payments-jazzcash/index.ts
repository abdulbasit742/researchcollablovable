// JazzCash hosted-checkout session builder.
// The integrity salt NEVER leaves the server. Returns a PaymentIntent-shaped
// object with a redirectUrl the browser can navigate to.
import { createHmac } from "node:crypto";
import { corsHeaders } from "../_shared/cors.ts";

interface ChargeBody {
  userId: string;
  amount: number;
  currency: string;
  purpose: string;
  idempotencyKey: string;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
}

const MERCHANT_ID = Deno.env.get("JAZZCASH_MERCHANT_ID") ?? "";
const PASSWORD = Deno.env.get("JAZZCASH_PASSWORD") ?? "";
const INTEGRITY_SALT = Deno.env.get("JAZZCASH_INTEGRITY_SALT") ?? "";
const POST_URL =
  Deno.env.get("JAZZCASH_POST_URL") ??
  "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform";

function yyyymmddhhmmss(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function secureHash(fields: Record<string, string>): string {
  // JazzCash: sort fields by key, join values with '&', prepend salt, HMAC-SHA256.
  const sorted = Object.keys(fields)
    .filter((k) => fields[k] !== "" && k !== "pp_SecureHash")
    .sort()
    .map((k) => fields[k]);
  const message = [INTEGRITY_SALT, ...sorted].join("&");
  return createHmac("sha256", INTEGRITY_SALT).update(message).digest("hex").toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!MERCHANT_ID || !INTEGRITY_SALT) {
      return json({ error: "JazzCash not configured" }, 500);
    }
    const body = (await req.json()) as ChargeBody;
    const now = new Date();
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);
    const txnRef = `T${yyyymmddhhmmss(now)}${Math.floor(Math.random() * 1000)}`;

    const fields: Record<string, string> = {
      pp_Version: "1.1",
      pp_TxnType: "MWALLET",
      pp_Language: "EN",
      pp_MerchantID: MERCHANT_ID,
      pp_Password: PASSWORD,
      pp_TxnRefNo: txnRef,
      // JazzCash amounts are in paisa (minor units).
      pp_Amount: String(Math.round(body.amount * 100)),
      pp_TxnCurrency: "PKR",
      pp_TxnDateTime: yyyymmddhhmmss(now),
      pp_TxnExpiryDateTime: yyyymmddhhmmss(expiry),
      pp_BillReference: body.idempotencyKey,
      pp_Description: String(body.purpose),
      pp_ReturnURL: body.returnUrl ?? "",
      ppmpf_1: body.userId,
      ppmpf_2: String(body.purpose),
      ppmpf_3: body.idempotencyKey,
    };
    fields.pp_SecureHash = secureHash(fields);

    // Browser POSTs these fields to JazzCash; we hand back an auto-submit URL
    // via a tiny self-submitting form hosted by the return flow. For SPA use we
    // return the action URL + fields so the client can build the form.
    return json({
      id: `pi_jazzcash_${txnRef}`,
      provider: "jazzcash",
      status: "requires_action",
      amount: body.amount,
      currency: "PKR",
      purpose: body.purpose,
      userId: body.userId,
      providerRef: txnRef,
      redirectUrl: POST_URL,
      formFields: fields,
      createdAt: now.toISOString(),
      simulated: false,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

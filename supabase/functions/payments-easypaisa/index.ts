// Easypaisa store session builder. Hash key stays server-side.
import { createHmac } from "node:crypto";
import { corsHeaders } from "../_shared/cors.ts";

interface ChargeBody {
  userId: string;
  amount: number;
  currency: string;
  purpose: string;
  idempotencyKey: string;
  returnUrl?: string;
}

const STORE_ID = Deno.env.get("EASYPAISA_STORE_ID") ?? "";
const HASH_KEY = Deno.env.get("EASYPAISA_HASH_KEY") ?? "";
const POST_URL =
  Deno.env.get("EASYPAISA_POST_URL") ??
  "https://easypaystg.easypaisa.com.pk/easypay/Index.jsf";

function sign(fields: Record<string, string>): string {
  const sorted = Object.keys(fields)
    .filter((k) => fields[k] !== "")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("&");
  return createHmac("sha256", HASH_KEY).update(sorted).digest("base64");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!STORE_ID || !HASH_KEY) return json({ error: "Easypaisa not configured" }, 500);
    const body = (await req.json()) as ChargeBody;
    const orderId = `EP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    const fields: Record<string, string> = {
      storeId: STORE_ID,
      orderRefNum: orderId,
      amount: body.amount.toFixed(2),
      postBackURL: body.returnUrl ?? "",
      expiryDate: expiry.toISOString().slice(0, 19).replace("T", " "),
      merchantHashedReq: "",
      autoRedirect: "1",
      paymentMethod: "MA_PAYMENT_METHOD",
    };
    fields.merchantHashedReq = sign(fields);

    return json({
      id: `pi_easypaisa_${orderId}`,
      provider: "easypaisa",
      status: "requires_action",
      amount: body.amount,
      currency: "PKR",
      purpose: body.purpose,
      userId: body.userId,
      providerRef: orderId,
      redirectUrl: POST_URL,
      formFields: fields,
      createdAt: new Date().toISOString(),
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

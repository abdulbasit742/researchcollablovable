// Shared CORS headers for payment edge functions.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-payment-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

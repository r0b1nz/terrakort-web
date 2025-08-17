// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-razorpay-signature",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAZORPAY_WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

async function hmacSHA256(secret: string, data: string){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const bodyText = await req.text();
  const provided = req.headers.get("x-razorpay-signature") || "";
  const expected = await hmacSHA256(RAZORPAY_WEBHOOK_SECRET, bodyText);
  if (provided !== expected) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const event = JSON.parse(bodyText);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (event.event === "payment.captured" || event.event === "order.paid") {
    const orderId = event.payload?.payment?.entity?.order_id || event.payload?.order?.entity?.id;
    const paymentId = event.payload?.payment?.entity?.id;
    if (orderId && paymentId) {
      await supabase.from("bookings")
        .update({ status: "confirmed", payment_status: "paid", rp_payment_id: paymentId })
        .eq("rp_order_id", orderId);
    }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

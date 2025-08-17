// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Slot = { dateKey: string; start: number };
type Body = {
  name: string; phone: string; email?: string; notes?: string;
  sport: "padel" | "pickleball";
  slotMinutes: number;
  slots: Slot[];
};

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRICE_PER_MINUTE_PAISA = Number(Deno.env.get("PRICE_PER_MINUTE") ?? "700"); // default ₹7/min
const COURT_ID = Deno.env.get("COURT_ID") ?? "00000000-0000-0000-0000-000000000001";

function computeAmountPaise(slots: Slot[], minutes: number, sport: string){
  const ppm = PRICE_PER_MINUTE_PAISA || (sport === "pickleball" ? 500 : 700);
  const totalMinutes = minutes * slots.length;
  return Math.max(1000, totalMinutes * ppm); // min ₹1000
}

function b64(str: string){ return btoa(str); }

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  try{
    const body = (await req.json()) as Body;
    const { name, phone, email, notes, sport, slotMinutes, slots } = body;
    if (!name || !phone || !Array.isArray(slots) || slots.length === 0) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Insert pending rows to hold availability
    const toInsert = slots.map((s) => {
      const [y, m, d] = s.dateKey.split("-").map((n) => parseInt(n, 10));
      const start = new Date(Date.UTC(y, m - 1, d, Math.floor(s.start / 60), s.start % 60, 0));
      const end = new Date(start.getTime() + (slotMinutes || 60) * 60 * 1000);
      return {
        court_id: COURT_ID, sport, name, phone, email, notes,
        start_t: start.toISOString(), end_t: end.toISOString(),
        status: "pending", payment_status: "unpaid"
      };
    });

    const { data: rows, error } = await supabase.from("bookings").insert(toInsert).select();
    if (error) {
      return new Response(JSON.stringify({ error: "Selected slot is unavailable. Try different time." }), { status: 409 });
    }

    const amount = computeAmountPaise(slots, slotMinutes, sport);

    // Create Razorpay Order
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + b64(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: rows[0].id, // reference
        payment_capture: 1,
        notes: { court_id: COURT_ID, sport }
      })
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) {
      console.error("Razorpay error", orderData);
      return new Response(JSON.stringify({ error: "Failed to create Razorpay order" }), { status: 500 });
    }

    // Update rows with order id
    await supabase.from("bookings").update({ rp_order_id: orderData.id }).in("id", rows.map((r: any) => r.id));

    return new Response(JSON.stringify({
      order_id: orderData.id,
      amount: orderData.amount,
      currency: orderData.currency,
      key_id: RAZORPAY_KEY_ID
    }), { headers: { "Content-Type": "application/json" } });
  }catch(e){
    console.error(e);
    return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
  }
});

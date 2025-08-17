# TerraKort Web

Frontend: Vite + React + Tailwind.  
Backend: Supabase (Postgres + Edge Functions).  
Payments: Razorpay Checkout (order create + client handler + server verification).

## 1) Database
Create a Supabase project → SQL Editor → run `supabase_schema.sql`.

## 2) Secrets (Supabase)
```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx   SUPABASE_URL=https://<project-ref>.supabase.co   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   PRICE_PER_MINUTE=700   COURT_ID=<uuid-of-your-court>
# Optional webhook secret if you set one in Razorpay dashboard:
supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxx
```

## 3) Deploy functions
```bash
supabase functions deploy create-order
supabase functions deploy verify-payment
supabase functions deploy razorpay-webhook
```

## 4) Frontend
- Set `VITE_FUNCTIONS_URL` to `https://<project-ref>.functions.supabase.co`
- `npm install`
- `npm run dev`

In production, host the SPA on Vercel/Netlify and keep backend on Supabase.

## How it works
- Client -> `/functions/v1/create-order` -> inserts **pending** booking rows and creates a Razorpay **order**.
- Razorpay Checkout opens on client (key_id + order_id).
- On success, client calls `/functions/v1/verify-payment` with `payment_id`, `order_id`, `signature` to confirm and mark **paid/confirmed**.
- Optional: set a Razorpay webhook to `/functions/v1/razorpay-webhook` for server-originated confirmations.
- DB constraint prevents overlaps; a helper SQL function `cancel_stale_pending()` can be scheduled via **Supabase Cron** to clear holds after 15 minutes.

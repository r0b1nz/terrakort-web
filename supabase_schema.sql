create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts(id) on delete cascade,
  sport text not null check (sport in ('padel','pickleball')),
  name text not null,
  phone text not null,
  email text,
  notes text,
  start_t timestamptz not null,
  end_t timestamptz not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  rp_order_id text,
  rp_payment_id text,
  rp_signature text,
  created_at timestamptz not null default now()
);

alter table public.bookings
  add constraint if not exists bookings_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(start_t, end_t, '[)') with &&
  ) where (status in ('pending','confirmed'));

alter table public.bookings enable row level security;
alter table public.courts enable row level security;

-- Optional: auto-cancel stale pending holds after 15 minutes
create or replace function public.cancel_stale_pending() returns void language plpgsql as $$
begin
  update public.bookings
  set status = 'cancelled'
  where status = 'pending' and created_at < now() - interval '15 minutes';
end $$;

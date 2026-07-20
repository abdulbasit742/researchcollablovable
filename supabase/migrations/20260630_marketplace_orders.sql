-- Marketplace orders + platform revenue (#34)

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  gross numeric not null check (gross >= 0),
  currency text not null default 'PKR',
  status text not null default 'pending_funding',
  dispute_reason text,
  delivered_at timestamptz,
  completed_at timestamptz,
  disputed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mp_orders_buyer on public.marketplace_orders(buyer_id, created_at desc);
create index if not exists idx_mp_orders_seller on public.marketplace_orders(seller_id, created_at desc);

-- Platform revenue ledger (commission income).
create table if not exists public.platform_revenue (
  id uuid primary key default gen_random_uuid(),
  source text not null,            -- 'marketplace_commission' | ...
  order_id uuid,
  amount numeric not null,
  currency text not null default 'PKR',
  rate numeric,
  created_at timestamptz not null default now()
);

alter table public.marketplace_orders enable row level security;
alter table public.platform_revenue enable row level security;

-- Buyer or seller can read their own orders.
create policy "own marketplace orders" on public.marketplace_orders
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- platform_revenue: no public select (admin/service-role only). RLS on with no
-- permissive policy => locked down by default.

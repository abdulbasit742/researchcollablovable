-- Payment settlements ledger (#22)
-- One row per provider reference; guarantees a payment is fulfilled at most once.

create table if not exists public.payment_settlements (
  provider_ref text primary key,
  provider text not null,
  user_id uuid references auth.users(id) on delete set null,
  purpose text,
  amount numeric,
  currency text,
  status text not null default 'pending', -- pending | settled | failed
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_settlements_user on public.payment_settlements(user_id, created_at desc);

alter table public.payment_settlements enable row level security;

-- Users may read their own settlements; only the service role writes.
create policy "own settlements" on public.payment_settlements
  for select using (auth.uid() = user_id);

-- Wallet credit RPC used by the settlement webhook (service-role only path).
create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_ref text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wallets as w (user_id, available_balance)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set available_balance = w.available_balance + p_amount;
end;
$$;

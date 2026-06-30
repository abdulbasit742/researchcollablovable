-- Visibility boosts (#47) — paid, time-boxed visibility upgrades.

create table if not exists public.visibility_boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  boost_type text not null,            -- profile | bid | project | opportunity
  target_id uuid,
  amount numeric not null,
  currency text not null default 'PKR',
  status text not null default 'active', -- active | expired | refunded
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_boosts_user on public.visibility_boosts(user_id, status);
create index if not exists idx_boosts_active on public.visibility_boosts(status, expires_at);

alter table public.visibility_boosts enable row level security;

create policy "own boosts" on public.visibility_boosts
  for select using (auth.uid() = user_id);

-- Atomic purchase: debit wallet, record boost, book platform revenue.
create or replace function public.purchase_visibility_boost(
  p_user_id uuid,
  p_amount numeric,
  p_boost_type text,
  p_target_id uuid,
  p_expires_at timestamptz,
  p_idempotency_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  select available_balance into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance is null then
    raise exception 'Wallet not found';
  end if;
  if v_balance < p_amount then
    raise exception 'Insufficient balance';
  end if;

  update public.wallets set available_balance = available_balance - p_amount where user_id = p_user_id;

  insert into public.visibility_boosts (user_id, boost_type, target_id, amount, expires_at, status)
  values (p_user_id, p_boost_type, p_target_id, p_amount, p_expires_at, 'active');

  insert into public.platform_revenue (source, amount, currency, rate)
  values ('visibility_boost', p_amount, 'PKR', 1);
end;
$$;

-- Lapse expired boosts (call from a scheduled job).
create or replace function public.expire_visibility_boosts() returns integer
language plpgsql
as $$
declare
  n integer;
begin
  update public.visibility_boosts
    set status = 'expired'
    where status = 'active' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

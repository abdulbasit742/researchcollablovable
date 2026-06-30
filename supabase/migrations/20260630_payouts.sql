-- Payouts (#53) — the cash-out side of the wallet.

create table if not exists public.payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                 -- jazzcash | easypaisa | bank
  account_name text not null,
  account_number text not null,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null default 'PKR',
  method_id uuid references public.payout_methods(id),
  status text not null default 'pending', -- pending|approved|paid|rejected|failed
  reason text,
  provider_ref text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_payout_requests_user on public.payout_requests(user_id, created_at desc);
create index if not exists idx_payout_requests_status on public.payout_requests(status, created_at);

alter table public.payout_methods enable row level security;
alter table public.payout_requests enable row level security;

create policy "own payout methods" on public.payout_methods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own payout requests" on public.payout_requests
  for select using (auth.uid() = user_id);

-- Hold funds for a payout: available -> pending.
create or replace function public.hold_for_payout(p_user_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wallets
    set available_balance = available_balance - p_amount,
        pending_balance   = pending_balance + p_amount
    where user_id = p_user_id and available_balance >= p_amount;
  if not found then
    raise exception 'Insufficient available balance';
  end if;
end;
$$;

-- Release a payout hold. p_back_to_available=true returns funds (reject/fail);
-- false clears the hold because the money actually left (paid).
create or replace function public.release_payout_hold(
  p_user_id uuid, p_amount numeric, p_back_to_available boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_back_to_available then
    update public.wallets
      set pending_balance = greatest(0, pending_balance - p_amount),
          available_balance = available_balance + p_amount
      where user_id = p_user_id;
  else
    update public.wallets
      set pending_balance = greatest(0, pending_balance - p_amount)
      where user_id = p_user_id;
  end if;
end;
$$;

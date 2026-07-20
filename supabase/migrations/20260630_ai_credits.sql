-- AI Credits schema (#13)
-- Additive: own tables, RLS-scoped per user. Does not touch core finance tables.

create table if not exists public.ai_credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  lifetime_purchased integer not null default 0,
  lifetime_spent integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null, -- positive = credit, negative = debit
  reason text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_credit_ledger_user on public.ai_credit_ledger(user_id, created_at desc);

alter table public.ai_credit_balances enable row level security;
alter table public.ai_credit_ledger enable row level security;

-- Users can read only their own balance + ledger.
create policy "own credit balance" on public.ai_credit_balances
  for select using (auth.uid() = user_id);
create policy "own credit ledger" on public.ai_credit_ledger
  for select using (auth.uid() = user_id);

-- Writes go through SECURITY DEFINER RPC so balances can't be self-inflated.
create or replace function public.apply_ai_credit_delta(
  p_user_id uuid,
  p_delta integer,
  p_purchased integer default 0,
  p_spent integer default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_credit_balances as b (user_id, balance, lifetime_purchased, lifetime_spent)
  values (p_user_id, greatest(p_delta, 0), p_purchased, p_spent)
  on conflict (user_id) do update
    set balance = b.balance + p_delta,
        lifetime_purchased = b.lifetime_purchased + p_purchased,
        lifetime_spent = b.lifetime_spent + p_spent,
        updated_at = now();

  if (select balance from public.ai_credit_balances where user_id = p_user_id) < 0 then
    raise exception 'credit balance cannot go negative';
  end if;
end;
$$;

-- LoanTrac database schema + Row Level Security policies.
-- Safe to re-run: uses "if not exists" / "or replace" / "drop ... if exists" throughout.

create extension if not exists pgcrypto;

-- =========================================================
-- 1. PROFILES  (one row per login, holds the Admin/User role)
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper used inside policies below. security definer = runs with elevated
-- rights so it can read the profiles table without triggering infinite
-- recursion in the policies that call it.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- Auto-create a profile row (defaulted to role='user') whenever a login is
-- added in Supabase Authentication.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- =========================================================
-- 2. REFERRALS
-- =========================================================
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  whatsapp_number text not null,
  color_seq bigint generated always as identity,
  created_at timestamptz not null default now()
);
alter table public.referrals enable row level security;

drop policy if exists "referrals_select" on public.referrals;
create policy "referrals_select" on public.referrals for select using (auth.uid() is not null);
drop policy if exists "referrals_insert" on public.referrals;
create policy "referrals_insert" on public.referrals for insert with check (auth.uid() is not null);
drop policy if exists "referrals_update" on public.referrals;
create policy "referrals_update" on public.referrals for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "referrals_delete_admin_only" on public.referrals;
create policy "referrals_delete_admin_only" on public.referrals for delete using (public.is_admin());

-- =========================================================
-- 3. BORROWERS
-- =========================================================
create table if not exists public.borrowers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  whatsapp_number text not null default '919003151000',
  created_at timestamptz not null default now()
);
alter table public.borrowers enable row level security;

drop policy if exists "borrowers_select" on public.borrowers;
create policy "borrowers_select" on public.borrowers for select using (auth.uid() is not null);
drop policy if exists "borrowers_insert" on public.borrowers;
create policy "borrowers_insert" on public.borrowers for insert with check (auth.uid() is not null);
drop policy if exists "borrowers_update" on public.borrowers;
create policy "borrowers_update" on public.borrowers for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrowers_delete_admin_only" on public.borrowers;
create policy "borrowers_delete_admin_only" on public.borrowers for delete using (public.is_admin());

-- =========================================================
-- 4. LOANS
-- =========================================================
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.borrowers(id),
  lender_name text not null,
  co_lender_1 text,
  co_lender_2 text,
  referral_id uuid not null references public.referrals(id),
  disbursement_date date not null,
  loan_amount numeric not null check (loan_amount > 0),
  loan_type text not null check (loan_type in ('EMI','ON_CALL')),
  routing_account_name text,

  -- EMI-only fields (null for On-Call loans)
  emi_interest_method text check (emi_interest_method in ('FLAT_MONTHLY','FLAT_MONTHLY_ADVANCE','LUMPSUM_ADVANCE','PA_DIVIDED_365')),
  emi_principal_method text check (emi_principal_method in ('MONTHWISE','LUMPSUM')),
  emi_interest_rate numeric,
  emi_tenure_months int,
  emi_moratorium_months int not null default 0,

  -- On-Call-only field (null for EMI loans)
  oncall_annual_rate numeric,

  -- force-closure fields
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CLOSED')),
  closure_date date,
  closure_settlement_amount numeric,
  closure_notes text,

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.loans enable row level security;

drop policy if exists "loans_select" on public.loans;
create policy "loans_select" on public.loans for select using (auth.uid() is not null);
drop policy if exists "loans_insert" on public.loans;
create policy "loans_insert" on public.loans for insert with check (auth.uid() is not null);
drop policy if exists "loans_update" on public.loans;
create policy "loans_update" on public.loans for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "loans_delete_admin_only" on public.loans;
create policy "loans_delete_admin_only" on public.loans for delete using (public.is_admin());

-- =========================================================
-- 5. EMI INSTALLMENTS (the generated repayment schedule)
-- =========================================================
create table if not exists public.emi_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  installment_number int not null,
  due_date date not null,
  interest_due numeric not null default 0,
  principal_due numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table public.emi_installments enable row level security;

drop policy if exists "installments_select" on public.emi_installments;
create policy "installments_select" on public.emi_installments for select using (auth.uid() is not null);
drop policy if exists "installments_insert" on public.emi_installments;
create policy "installments_insert" on public.emi_installments for insert with check (auth.uid() is not null);
drop policy if exists "installments_update" on public.emi_installments;
create policy "installments_update" on public.emi_installments for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "installments_delete_admin_only" on public.emi_installments;
create policy "installments_delete_admin_only" on public.emi_installments for delete using (public.is_admin());

-- =========================================================
-- 6. EMI RECEIPTS (actual interest / principal payments received)
-- =========================================================
create table if not exists public.emi_receipts (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.emi_installments(id) on delete cascade,
  receipt_type text not null check (receipt_type in ('INTEREST','PRINCIPAL')),
  receipt_date date not null,
  received_amount numeric not null default 0,
  tds_amount numeric not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.emi_receipts enable row level security;

drop policy if exists "receipts_select" on public.emi_receipts;
create policy "receipts_select" on public.emi_receipts for select using (auth.uid() is not null);
drop policy if exists "receipts_insert" on public.emi_receipts;
create policy "receipts_insert" on public.emi_receipts for insert with check (auth.uid() is not null);
drop policy if exists "receipts_update" on public.emi_receipts;
create policy "receipts_update" on public.emi_receipts for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "receipts_delete_admin_only" on public.emi_receipts;
create policy "receipts_delete_admin_only" on public.emi_receipts for delete using (public.is_admin());

-- =========================================================
-- 7. ON-CALL LEDGER TRANSACTIONS (draws + repayments)
-- =========================================================
create table if not exists public.oncall_transactions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('DRAW','REPAYMENT')),
  transaction_date date not null,
  amount numeric not null default 0,
  principal_portion numeric not null default 0,
  interest_portion numeric not null default 0,
  tds_on_interest numeric not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.oncall_transactions enable row level security;

drop policy if exists "oncall_txn_select" on public.oncall_transactions;
create policy "oncall_txn_select" on public.oncall_transactions for select using (auth.uid() is not null);
drop policy if exists "oncall_txn_insert" on public.oncall_transactions;
create policy "oncall_txn_insert" on public.oncall_transactions for insert with check (auth.uid() is not null);
drop policy if exists "oncall_txn_update" on public.oncall_transactions;
create policy "oncall_txn_update" on public.oncall_transactions for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "oncall_txn_delete_admin_only" on public.oncall_transactions;
create policy "oncall_txn_delete_admin_only" on public.oncall_transactions for delete using (public.is_admin());

-- =========================================================
-- 8. Schedule regeneration helper
-- Called when a User or Admin edits an EMI loan's terms. Runs with
-- elevated rights so it can rebuild the installment rows regardless of
-- the delete-is-admin-only rule above -- this is an internal recompute
-- triggered by the "edit loan" action, not a user-facing delete.
-- =========================================================
create or replace function public.replace_emi_schedule(
  p_loan_id uuid,
  p_installments jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  delete from public.emi_installments where loan_id = p_loan_id;

  insert into public.emi_installments (loan_id, installment_number, due_date, interest_due, principal_due)
  select
    p_loan_id,
    (elem->>'installment_number')::int,
    (elem->>'due_date')::date,
    (elem->>'interest_due')::numeric,
    (elem->>'principal_due')::numeric
  from jsonb_array_elements(p_installments) as elem;
end;
$$;

grant execute on function public.replace_emi_schedule(uuid, jsonb) to authenticated;

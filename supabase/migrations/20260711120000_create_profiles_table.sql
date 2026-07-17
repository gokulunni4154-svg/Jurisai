-- ============================================================================
-- Migration: create_profiles_table
-- ============================================================================
-- Creates the `profiles` table: shared, role-agnostic display data for every
-- authenticated user (full name, avatar, phone). This is deliberately NOT
-- where `role` lives -- role is set only in auth.users.app_metadata (see
-- src/core/auth/mapper.ts), specifically so a user can never self-escalate
-- by editing a normal, RLS-writable table.
--
-- Role-specific data (lawyer bar council number, business GSTIN, law firm
-- details, etc.) intentionally does NOT live here. It belongs in future
-- tables keyed 1:1 on profiles.id (e.g. lawyer_profiles, business_profiles)
-- once those modules are built, to avoid nullable-column sprawl on a table
-- every account type shares.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  full_name text
    constraint profiles_full_name_length check (
      full_name is null
      or (char_length(trim(full_name)) > 0 and char_length(full_name) <= 255)
    ),

  avatar_url text,

  phone text
    constraint profiles_phone_length check (
      phone is null or char_length(phone) <= 20
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Shared, role-agnostic profile data for every authenticated user. Role lives in auth.users.app_metadata only -- never here.';

comment on column public.profiles.id is
  'References auth.users.id. 1:1 relationship; cascades on user deletion.';

-- ----------------------------------------------------------------------------
-- Trigger: keep updated_at current on every UPDATE
-- ----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Trigger: auto-create a profile row whenever a new auth.users row is
-- created. Runs as SECURITY DEFINER so it can write to public.profiles
-- despite RLS, and runs in the same transaction as the auth.users insert
-- so it is impossible for a user to exist without a corresponding profile
-- row (no reliance on a follow-up API call that could fail or be skipped).
--
-- full_name is seeded from raw_user_meta_data->>'full_name' if the signup
-- form supplied one (user_metadata is safe to read here -- unlike role, a
-- self-supplied display name is not a privilege-escalation vector).
-- ----------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Every authenticated user may read their own profile.
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

-- Every authenticated user may update their own profile. `role` is not a
-- column on this table, so there is nothing here for a user to escalate.
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admins may read any profile. Role is read from the JWT's app_metadata
-- claim -- the same authoritative source src/core/auth/mapper.ts trusts,
-- so RLS and the application layer never disagree about who is an admin.
create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- No insert policy for `authenticated`: rows are created only by the
-- handle_new_user() trigger above, which runs as SECURITY DEFINER and
-- bypasses RLS. No delete policy for `authenticated`: profile/account
-- deletion, once built, will be a deliberate admin/service-role operation
-- (via src/core/supabase/admin.ts), not a raw table delete a user session
-- could trigger directly.
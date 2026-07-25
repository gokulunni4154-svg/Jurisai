-- ============================================================================
-- Migration: create_clients_table
-- ============================================================================
-- Phase 4 — Enterprise & Collaboration, Client Management.
--
-- Decision (made by Claude at the user's explicit delegation, "u can
-- decide"): clients get a NEW `UserRole` value, `role: 'client'`, assigned
-- via app_metadata exactly like every other role (see auth.service.ts) --
-- NOT a separate identity/auth system. This table is the firm-side client
-- record; the eventual auth.users/profiles row a client gets on completing
-- portal signup is a SEPARATE, later concern (client-invitation flow,
-- mirroring the Invitation System -- not built in this migration).
--
-- `profiles.firm_id` (20260711120000_create_profiles_table.sql) is
-- DELIBERATELY left untouched and unused for clients. That column's
-- existing, documented meaning is "which firm this person works at
-- internally" -- a client never works at the firm, so it correctly stays
-- null on a client's eventual profiles row. This table's own `firm_id`
-- column below is the real client<->firm relationship; the two are not
-- the same relationship and must never be conflated.
--
-- FLAGGED ASSUMPTION: firm_members' real column shape has not been
-- re-pasted in this session. Its shape is inferred from the confirmed
-- call site in auth.service.ts -- firmMemberRepository.create({ firm_id,
-- profile_id, role }) -- and from case.service.ts's confirmed
-- FIRM_MANAGE_ROLES = ['owner', 'admin']. If firm_members' real column
-- names differ from firm_id/profile_id/role, the RLS policies below will
-- fail at apply time and need correcting against the real schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: clients
-- ----------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),

  -- Firm-scoped: a client record belongs to exactly one firm (the locked
  -- decision "one client -> many cases over time" is a firm-level record,
  -- not shared across firms).
  firm_id uuid not null references public.firms (id) on delete cascade,

  -- Nullable until portal signup completes, per the locked decision. A
  -- client record can exist (created by a team lead/firm admin) before
  -- the client has ever signed up for portal access. `on delete set null`
  -- (not cascade): if the linked profile is ever deleted, the firm's
  -- client record itself should survive -- it's the firm's own business
  -- record, not owned by the client's account.
  profile_id uuid references public.profiles (id) on delete set null,

  full_name text not null
    constraint clients_full_name_length check (
      char_length(trim(full_name)) > 0 and char_length(full_name) <= 255
    ),

  email text not null
    constraint clients_email_format check (
      email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),

  phone text
    constraint clients_phone_length check (
      phone is null or char_length(phone) <= 20
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is
  'Firm-scoped client records. profile_id is nullable until portal signup completes; the client<->firm relationship lives here, NOT on profiles.firm_id (which means something different -- internal staff employer).';

comment on column public.clients.firm_id is
  'The firm this client belongs to. Distinct from profiles.firm_id, which tracks internal staff employer, not client relationships.';

comment on column public.clients.profile_id is
  'Set once the client completes portal signup via the client-invitation flow. Null before that -- a client record can exist before the client has an account.';

-- One firm should not accumulate duplicate client records for the same
-- email -- not asked explicitly, but left unenforced here (no unique
-- constraint) since the user has not confirmed this should be a hard
-- constraint vs. a soft warning at the service layer. FLAGGED: revisit
-- once confirmed; a partial unique index on (firm_id, lower(email)) would
-- be the natural fix if the answer is "yes, enforce it."

create index clients_firm_id_idx on public.clients (firm_id);
create index clients_profile_id_idx on public.clients (profile_id) where profile_id is not null;

-- ----------------------------------------------------------------------------
-- Trigger: keep updated_at current on every UPDATE
-- ----------------------------------------------------------------------------
-- Named after this table specifically, per File 25's amendment
-- (set_documents_updated_at, not a shared set_updated_at) -- avoids the
-- enum/function-naming collision class the project was burned by once
-- already.
create or replace function public.set_clients_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_set_updated_at
  before update on public.clients
  for each row
  execute function public.set_clients_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.clients enable row level security;

-- Only team leads/firm admins can create/edit clients, per the locked
-- product decision. Firm-level role (owner/admin) is NOT in the JWT --
-- unlike the global `role` claim (individual/lawyer/admin/etc.) used by
-- profiles' and documents' admin-select policies -- so this checks
-- firm_members directly, mirroring case.service.ts's confirmed
-- FIRM_MANAGE_ROLES = ['owner', 'admin'] application-layer check.
create policy "clients_select_firm_manage"
  on public.clients for select
  to authenticated
  using (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = clients.firm_id
        and fm.profile_id = auth.uid()
        and fm.role in ('owner', 'admin')
    )
  );

create policy "clients_insert_firm_manage"
  on public.clients for insert
  to authenticated
  with check (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = clients.firm_id
        and fm.profile_id = auth.uid()
        and fm.role in ('owner', 'admin')
    )
  );

create policy "clients_update_firm_manage"
  on public.clients for update
  to authenticated
  using (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = clients.firm_id
        and fm.profile_id = auth.uid()
        and fm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = clients.firm_id
        and fm.profile_id = auth.uid()
        and fm.role in ('owner', 'admin')
    )
  );

-- No delete policy for `authenticated`: client-record deletion, if ever
-- needed, is left as a deliberate admin/service-role operation (via
-- src/core/supabase/admin.ts), mirroring documents' and profiles'
-- precedent of not exposing hard delete to a normal session by default.

-- A client, once linked via portal signup, may read their own record.
-- This is the ONLY policy on this table keyed off the global app_metadata
-- role claim (the new 'client' value) rather than firm_members --
-- deliberate, since a client is never a firm_members row.
create policy "clients_select_own"
  on public.clients for select
  to authenticated
  using (
    profile_id = auth.uid()
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'client'
  );

-- Admin (global role, not firm-scoped) may read any client record --
-- mirrors profiles_select_admin / documents_select_admin's exact pattern.
create policy "clients_select_admin"
  on public.clients for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
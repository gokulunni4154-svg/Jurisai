-- ============================================================================
-- Migration: create_firm_members_table
-- ============================================================================
-- Admin Tooling — RBAC, File 2 of 4 in this sequence.
--
-- Adds `firm_members`, the new axis distinguishing WHAT a profile can do
-- within a firm (owner / admin / employee / lawyer) -- separate from
-- `firms.owner_id` (WHO controls the firm's subscription/billing, unchanged)
-- and `profiles.firm_id` (simple membership pointer, unchanged). Neither
-- existing column is touched by this migration.
--
-- Built as a join table rather than a `firm_role` column on `profiles`
-- (the alternative flagged and explicitly not chosen) specifically so a
-- profile can belong to more than one firm in the future without another
-- schema change -- `profiles.firm_id` remains single-firm for now (nothing
-- in the application reads firm_members for multi-membership yet), but the
-- table shape doesn't foreclose it.
--
-- FLAGGED ASSUMPTIONS -- new decisions this file, no direct prior precedent:
--   1. `role` is a plain `text` + CHECK constraint, not a Postgres enum --
--      matches 20260726000001_fix_subscription_status_values.sql's own
--      convention (CHECK over enum) rather than introducing this project's
--      first role-bearing enum type, since the original Admin Tooling scope
--      also named "custom permissions" as a future need that a fixed enum
--      would fight against.
--   2. `firm_id` uses `on delete cascade` (unlike `firms.owner_id`'s
--      `on delete restrict` in the firms migration): deleting a firm should
--      clean up its membership rows, since a firm_members row has no
--      meaning without its parent firm. This is NOT the same deletion
--      semantics as `firms.owner_id` on purpose -- that column blocks
--      owner-profile deletion outright; this one just removes stale rows
--      when the firm itself goes away.
--   3. `profile_id` uses `on delete cascade` -- if a profile is deleted,
--      its firm_members rows should not survive it. No FLAGGED conflict
--      with `firms.owner_id on delete restrict`, since that restrict
--      already prevents an owning profile from being deleted while the
--      firm exists; this cascade only ever fires for a non-owner member.
--   4. Unique constraint on (firm_id, profile_id): a profile can hold only
--      ONE role within a given firm at a time. No product requirement was
--      given for a profile holding multiple roles in the same firm
--      simultaneously -- if that's ever needed, this constraint is the
--      first thing to revisit.
--   5. No trigger enforcing that a firm's owner (firms.owner_id) also has
--      a corresponding 'owner'-role firm_members row, or that exactly one
--      'owner'-role row exists per firm. This migration does not backfill
--      firm_members from existing firms.owner_id data, and does not
--      auto-create a row on firm creation -- that belongs in
--      FirmService/FirmRepository application code (a later file), not the
--      database. Flagged as a real, currently-open seam: today, a firm can
--      exist with zero firm_members rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: firm_members
-- ----------------------------------------------------------------------------
create table public.firm_members (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,

  role text not null
    constraint firm_members_role_check check (
      role in ('owner', 'admin', 'employee', 'lawyer')
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint firm_members_firm_profile_unique unique (firm_id, profile_id)
);

comment on table public.firm_members is
  'Firm-internal role for a profile within a firm (owner/admin/employee/lawyer). Separate from firms.owner_id (billing control) and profiles.firm_id (simple membership pointer) -- see migration header, assumptions #1-5.';

comment on column public.firm_members.role is
  'owner: mirrors firms.owner_id, not independently enforced by a trigger (see assumption #5). admin: Firm Admin from Admin Tooling scope. employee/lawyer: plain firm members with no admin permissions.';

create trigger firm_members_set_updated_at
  before update on public.firm_members
  for each row
  execute function public.set_updated_at();

create index firm_members_firm_id_idx on public.firm_members (firm_id);
create index firm_members_profile_id_idx on public.firm_members (profile_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.firm_members enable row level security;

-- A member may read their own membership row.
create policy firm_members_select_own
  on public.firm_members
  for select
  to authenticated
  using (profile_id = auth.uid());

-- Any member of a firm may read the full member list for that firm --
-- needed so a plain employee can see who else (and who's Firm Admin) is
-- in their own firm. Mirrors firms_select_member's own subquery pattern.
create policy firm_members_select_same_firm
  on public.firm_members
  for select
  to authenticated
  using (
    firm_id in (select firm_id from public.profiles where id = auth.uid())
  );

-- Admins and Support may read any firm's membership.
create policy firm_members_select_admin
  on public.firm_members
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for `authenticated`: membership changes
-- (adding a member, changing a role, removing a member) are service-layer
-- operations only -- same reasoning firms.md and profiles.md both give for
-- why role-bearing writes never go through a client-writable RLS policy.
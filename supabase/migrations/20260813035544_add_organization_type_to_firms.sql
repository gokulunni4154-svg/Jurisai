-- ============================================================================
-- Migration: add_organization_type_to_firms
-- ============================================================================
-- FOUNDATION TASK 1 — Organization Architecture.
--
-- Inspection summary (full detail in the accompanying report): this
-- project already has exactly one organization/membership system --
-- `firms` (the paying/organizational entity) + `firm_members` (the
-- FirmRole join table) + `profiles.firm_id` (a "primary firm" convenience
-- pointer, per 20260804000000_support_multi_firm_membership.sql). There is
-- no separate "organization" table anywhere, and no duplicate role system.
-- Per the task's Section 7/18 instructions ("if an existing organization/
-- firm table can support the model, EXTEND IT... do NOT create a duplicate
-- organization system"), this migration extends `firms` with a single new
-- column rather than introducing a new table.
--
-- WHAT THIS ADDS: `firms.organization_type`, distinguishing:
--   'firm'     -- the existing, unchanged meaning: a paying, potentially
--                 multi-member law firm (Lawyer Firms plan).
--   'personal' -- NEW: a private, single-member organization owned by an
--                 independent lawyer, giving them somewhere to own
--                 `cases`/`hearings`/`tasks` (all of which have a NOT NULL
--                 `firm_id`) without requiring a real, multi-seat firm.
--
-- WHY NOT MODIFY `cases`, `hearings`, `tasks`, OR THEIR RLS: the
-- independent-lawyer gap flagged by the architecture audit (cases.firm_id
-- NOT NULL, no path for a lawyer with no firm to own a case) is resolved
-- entirely by giving that lawyer a `firms` row of type 'personal' to point
-- `firm_id` at -- no schema or RLS change is needed on the case/hearing/
-- task tables themselves, and none is made here. This is deliberately the
-- smallest change that closes that gap, per the task's "REUSE, EXTEND,
-- BUILD ONLY WHAT IS ACTUALLY MISSING" principle.
--
-- DEFAULT VALUE: `not null default 'firm'` -- every existing row in this
-- table today is a real Lawyer-Firms-plan firm (the only path that has
-- ever inserted into this table), so backfilling the default as 'firm'
-- is exact, not a guess, and this statement requires no data migration/
-- backfill UPDATE.
--
-- PRIVACY INVARIANT (task Section 12 -- "PERSONAL organizations must be
-- private"): existing `firms`/`firm_members` SELECT policies already
-- restrict visibility to the owner or an existing firm_members row for
-- that specific firm -- see 20260726000002_create_firms_table.sql and
-- 20260804000000_support_multi_firm_membership.sql. Those policies are
-- NOT modified here; they already satisfy the "another user can't view
-- this org" requirement for any firm, personal or not, once membership
-- itself is correctly restricted to one row. That restriction is added
-- below as a new, additive trigger on `firm_members`, not an RLS change:
-- `firm_members` writes are already service-layer-only (no client insert
-- policy exists -- see that table's own migration header), so the
-- existing FirmMemberService#addMember() path is the one place a second
-- member could otherwise be added to a personal org (e.g. by that org's
-- own owner, who legitimately holds 'owner'/'admin' FirmRole there and
-- would otherwise pass FirmMemberService's existing MANAGE_ROLES gate --
-- that gate has no knowledge of organization_type and is NOT modified by
-- this migration). The trigger below is the DB-level backstop for that
-- specific gap, matching this project's established RLS-plus-service-
-- layer (here: trigger-plus-service-layer) defense-in-depth convention.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. firms.organization_type
-- ----------------------------------------------------------------------------

alter table public.firms
  add column organization_type text not null default 'firm'
    constraint firms_organization_type_check check (
      organization_type in ('personal', 'firm')
    );

comment on column public.firms.organization_type is
  'personal: private, single-member organization for an independent lawyer (no separate case/matter ownership system -- see Foundation Task 1 migration header). firm: the existing Lawyer-Firms-plan organization, unchanged. Default ''firm'' is exact for all pre-existing rows, not a guess -- see migration header.';

-- At most one PERSONAL organization per owning profile. Does not
-- constrain 'firm'-type rows at all (a profile could already own zero or
-- one FIRM-type firm today, per firm.service.ts's own createFirm()
-- application-level conflict check -- this index adds an equivalent
-- DB-level guarantee for the new 'personal' type only, since that path
-- is new this migration and should not silently allow duplicates the way
-- the pre-existing 'firm' path currently only prevents at the service
-- layer).
create unique index firms_one_personal_org_per_owner
  on public.firms (owner_id)
  where (organization_type = 'personal');

-- ----------------------------------------------------------------------------
-- 2. firm_members: enforce "personal organizations are single-member"
-- ----------------------------------------------------------------------------
-- Trigger-level backstop -- see migration header above for exactly which
-- existing, unmodified code path this protects against (FirmMemberService
-- #addMember(), called by a personal org's own owner, who already holds
-- a passing FirmRole for their own org).

create function public.prevent_personal_org_multi_member()
returns trigger
language plpgsql
as $$
declare
  v_organization_type text;
begin
  select organization_type
    into v_organization_type
    from public.firms
    where id = new.firm_id;

  if v_organization_type = 'personal' and exists (
    select 1
    from public.firm_members
    where firm_id = new.firm_id
  ) then
    raise exception
      'A personal organization may have only one member (its owner).'
      using errcode = '23514'; -- check_violation, matching this project's
                                -- convention of surfacing invariant
                                -- violations as constraint-shaped errors.
  end if;

  return new;
end;
$$;

comment on function public.prevent_personal_org_multi_member() is
  'Backstop for the personal-organization privacy invariant (Foundation Task 1). Blocks inserting a second firm_members row for any firm whose organization_type is personal, regardless of caller -- see this migration''s header for the specific existing code path (FirmMemberService#addMember(), called by the org''s own owner) this protects against.';

create trigger firm_members_prevent_personal_multi_member
  before insert on public.firm_members
  for each row
  execute function public.prevent_personal_org_multi_member();

-- ----------------------------------------------------------------------------
-- 3. No RLS changes
-- ----------------------------------------------------------------------------
-- Deliberately none. firms_select_owner / firms_select_member /
-- firms_select_admin (firms) and firm_members_select_own /
-- firm_members_select_same_firm / firm_members_select_admin
-- (firm_members) already scope strictly to the caller's own membership or
-- ownership -- see migration header, "PRIVACY INVARIANT" paragraph. There
-- is no existing policy that grants visibility across firms by type, so
-- none needs narrowing, and no new policy is needed for 'personal' rows
-- specifically -- the existing policies already treat every firm row,
-- regardless of organization_type, the same (correct) way.

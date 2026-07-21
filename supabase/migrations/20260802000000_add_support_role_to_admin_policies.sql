-- ============================================================================
-- Migration: add_support_role_to_admin_policies
-- ============================================================================
-- Admin Tooling — RBAC, File 1 of 4 in this sequence.
--
-- Adds 'support' as a second platform-staff role alongside 'admin'. Support
-- is structurally identical to Admin — sourced from auth.users.app_metadata
-- only (never a client-writable table, per src/core/auth/mapper.ts and the
-- profiles/firms migrations' own established convention), no firm/customer
-- association. Given the SAME elevated read access as Admin on these two
-- policies (explicit product decision — not the more-restricted option).
--
-- Does NOT touch src/core/auth/types.ts's UserRole union or mapper.ts's
-- VALID_ROLES array — those are separate, non-DB amendments tracked as
-- Files 3-4 in this sequence. This migration alone does nothing to
-- application code; 'support' isn't accepted anywhere until those land.
--
-- FLAGGED: no DB-level enum backs `role` (confirmed via database_types.ts
-- this session — role lives only in the JWT, never a Postgres column), so
-- there is no CHECK constraint to widen here, only these two RLS policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles_select_admin -- widen to admin OR support
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select_admin on public.profiles;

create policy profiles_select_admin
  on public.profiles
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- firms_select_admin -- widen to admin OR support
-- ----------------------------------------------------------------------------
drop policy if exists firms_select_admin on public.firms;

create policy firms_select_admin
  on public.firms
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );
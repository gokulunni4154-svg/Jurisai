-- ============================================================================
-- Migration: fix_case_access_grants_rls_recursion
-- ============================================================================
-- RECONSTRUCTED -- see 20260812044308_add_actioned_at_to_ai_recommendations.sql's
-- header for why this is a reconstruction, not the original: already
-- applied live as version 20260912000000, no matching file previously in
-- this repository. Written from live introspection (current policy
-- definitions via pg_policies, current function bodies via
-- pg_get_functiondef, both confirmed) -- resulting schema state matches
-- live exactly; original file text is not guaranteed identical.
--
-- NOTE, found during reconstruction: the live SECURITY DEFINER functions'
-- own comments reference "20260809000000_fix_case_access_grants_rls_recursion.sql"
-- as their originating file -- an earlier-dated filename than the version
-- this migration is actually recorded under (20260912000000) in the
-- project's migration history. Flagging this discrepancy rather than
-- silently resolving it one way or the other -- it suggests the original
-- file may have been drafted under one timestamp and applied under
-- another, but this could not be confirmed from live schema state alone.
-- This file uses 20260912000000, matching `supabase migrations list`'s
-- actual recorded version for what's live today.
--
-- WHAT THIS FIXES: the original cases_select/cases_update policies
-- (20260808000000_create_case_access_grants.sql) queried
-- case_access_grants directly via EXISTS(...), and the original
-- case_access_grants_select policy queried cases directly via a similar
-- EXISTS(...) ownership check. Postgres RLS evaluates a table's own
-- policies while checking a *different* table's policy if that policy's
-- USING clause queries the first table back -- two policies that each
-- query the other's table can trigger infinite recursion (Postgres error
-- 42P17). The fix: two SECURITY DEFINER helper functions
-- (is_case_owner(), has_case_grant()) that internally bypass RLS, used in
-- place of the direct cross-table EXISTS(...) subqueries.
--
-- DO NOT apply this file directly with `supabase db push` unless you have
-- first confirmed version 20260912000000 is NOT already applied on your
-- target project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SECURITY DEFINER helper functions
-- ----------------------------------------------------------------------------

create or replace function public.is_case_owner(p_case_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.cases c
    where c.id = p_case_id
      and c.owner_id = auth.uid()
  );
$$;

comment on function public.is_case_owner(uuid) is
  'SECURITY DEFINER helper for case_access_grants_select. Bypasses cases RLS deliberately -- see 20260809000000_fix_case_access_grants_rls_recursion.sql for why a direct EXISTS-on-cases subquery here caused infinite RLS recursion.';

create or replace function public.has_case_grant(p_case_id uuid, p_require_write boolean default false)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.case_access_grants g
    where g.case_id = p_case_id
      and g.grantee_id = auth.uid()
      and g.revoked_at is null
      and (not p_require_write or g.access_level = 'read_write')
  );
$$;

comment on function public.has_case_grant(uuid, boolean) is
  'SECURITY DEFINER helper for cases_select/cases_update. Bypasses case_access_grants RLS deliberately -- see 20260809000000_fix_case_access_grants_rls_recursion.sql for why a direct EXISTS-on-case_access_grants subquery here caused infinite RLS recursion.';

-- ----------------------------------------------------------------------------
-- 2. Recreate cases_select / cases_update using has_case_grant()
-- ----------------------------------------------------------------------------

drop policy if exists cases_select on public.cases;

create policy cases_select
  on public.cases
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.has_case_grant(id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

drop policy if exists cases_update on public.cases;

create policy cases_update
  on public.cases
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    or public.has_case_grant(id, true)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- 3. Recreate case_access_grants_select using is_case_owner()
-- ----------------------------------------------------------------------------

drop policy if exists case_access_grants_select on public.case_access_grants;

create policy case_access_grants_select
  on public.case_access_grants
  for select
  to authenticated
  using (
    grantee_id = auth.uid()
    or granted_by = auth.uid()
    or public.is_case_owner(case_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

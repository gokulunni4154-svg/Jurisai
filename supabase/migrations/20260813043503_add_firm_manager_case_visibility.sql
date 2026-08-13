-- ============================================================================
-- Migration: add_firm_manager_case_visibility
-- ============================================================================
-- RECONSTRUCTED -- found already applied live as version 20260813043503
-- during Foundation Task 2 (Case Assignment & Access Architecture)
-- inspection, with no matching file previously in this repository --
-- same "applied directly, never committed" gap this project's own
-- 20260912000000_fix_case_access_grants_rls_recursion.sql and
-- 20260913000000_firm_members_select_same_firm_recursion.sql headers
-- already document and reconcile for two other drifted changes. Written
-- from live introspection (pg_get_functiondef for is_firm_case_manager,
-- pg_policies for cases_select, both confirmed against the live
-- database) -- resulting schema state matches live exactly; original
-- file text is not guaranteed identical. Uses version 20260813043503,
-- matching `supabase migrations list`'s actual recorded version for
-- what's live today -- chronologically it sits between
-- 20260813035544_add_organization_type_to_firms.sql (Foundation Task 1)
-- and 20260814000000_create-tasks-table.sql.
--
-- WHAT THIS ADDS: a SECURITY DEFINER helper, is_firm_case_manager(),
-- and widens cases_select to also grant visibility to a firm's own
-- owner/admin over every case belonging to that firm -- not just cases
-- the caller owns or holds an active case_access_grants row for. This
-- is Foundation Task 2's CASE ACCESS TEST 1 ("Firm Admin can access
-- firm cases") at the RLS layer; Foundation Task 2 itself (this
-- session) builds the assignment/authorization layer on top of the
-- visibility this migration already provides, and does not modify it
-- further -- see 20260913043503_case_assignment_foundation.sql's own
-- header (no schema changes there) for why no RLS change was needed to
-- close out that task.
--
-- SECURITY DEFINER, not a direct EXISTS(...) subquery: matches
-- has_case_grant()/is_case_owner()'s established reasoning
-- (20260912000000_fix_case_access_grants_rls_recursion.sql) -- a
-- cases_select policy that queried firm_members directly could recurse
-- against firm_members' own RLS in the same way the original
-- cases_select/case_access_grants_select pair did. Built the same way
-- from the start here, rather than shipped as a direct subquery and
-- fixed later.
--
-- DO NOT apply this file directly with `supabase db push` unless you
-- have first confirmed version 20260813043503 is NOT already applied on
-- your target project.
-- ============================================================================

create or replace function public.is_firm_case_manager(p_firm_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.firm_id = p_firm_id
      and fm.profile_id = auth.uid()
      and fm.role in ('owner', 'admin')
  );
$$;

comment on function public.is_firm_case_manager(uuid) is
  'SECURITY DEFINER helper for cases_select. Bypasses firm_members RLS deliberately, same reasoning as has_case_grant()/is_case_owner() (20260912000000_fix_case_access_grants_rls_recursion.sql) -- a direct EXISTS-on-firm_members subquery here risks the same class of RLS recursion. Lets a firm owner/admin see every case belonging to their own firm, not just cases they own or hold an explicit case_access_grants row for -- Foundation Task 2, CASE ACCESS TEST 1.';

drop policy if exists cases_select on public.cases;

create policy cases_select
  on public.cases
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.has_case_grant(id)
    or public.is_firm_case_manager(firm_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ============================================================================
-- Migration: firm_members_select_same_firm_recursion
-- ============================================================================
-- RECONSTRUCTED -- see 20260812044308_add_actioned_at_to_ai_recommendations.sql's
-- header for why this is a reconstruction, not the original: already
-- applied live as version 20260913000000, no matching file previously in
-- this repository. Written from live introspection (current policy
-- definition via pg_policies, current function body via
-- pg_get_functiondef, both confirmed) -- resulting schema state matches
-- live exactly; original file text is not guaranteed identical.
--
-- WHAT THIS FIXES: firm_members_select_same_firm
-- (20260804000000_support_multi_firm_membership.sql) queried
-- firm_members from within its own USING clause (a self-referential
-- subquery), which that migration's own header argued was safe because
-- the inner subquery's visibility is governed by firm_members_select_own
-- (unconditional on firm_id). In practice this still triggers Postgres
-- RLS recursion (42P17) for this policy shape. Fixed the same way
-- 20260912000000_fix_case_access_grants_rls_recursion.sql fixes the
-- analogous cases/case_access_grants recursion: a SECURITY DEFINER
-- helper function that bypasses RLS internally, replacing the
-- self-referencing subquery.
--
-- DO NOT apply this file directly with `supabase db push` unless you have
-- first confirmed version 20260913000000 is NOT already applied on your
-- target project.
-- ============================================================================

create or replace function public.current_profile_firm_ids()
returns setof uuid
language sql
stable security definer
set search_path to 'public'
as $$
  select firm_id
  from public.firm_members
  where profile_id = auth.uid();
$$;

comment on function public.current_profile_firm_ids() is
  'Returns the firm_id(s) the calling profile is a member of. SECURITY DEFINER so it bypasses RLS internally -- used to break the firm_members_select_same_firm recursion (42P17) by replacing a direct self-referencing subquery in that policy.';

drop policy if exists firm_members_select_same_firm on public.firm_members;

create policy firm_members_select_same_firm
  on public.firm_members
  for select
  to authenticated
  using (
    firm_id in (select public.current_profile_firm_ids())
  );

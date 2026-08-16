-- ============================================================================
-- Migration: add_client_portal_visibility
-- ============================================================================
-- Client Portal, Phase 1 — Client Dashboard / Client Home.
--
-- REAL GAP FOUND DURING AUDIT, documented per this task's own Step 4
-- requirement before touching anything:
--
--   Client identity infrastructure (clients table, clients_select_own,
--   AuthService#signUpAsClient(), cases.client_id) is real and already
--   live. But NO existing RLS policy on `cases`, `hearings`, or `firms`
--   ever consults `clients.profile_id` — the link a signed-up client
--   authenticates through. cases_select only recognizes owner_id,
--   case_access_grants grantees, and admin/support. hearings_select
--   mirrors that. firms_select only recognizes the firm owner and
--   internal members (profiles.firm_id). A client can today read their
--   OWN `clients` row (clients_select_own) and nothing else — there was
--   no genuine dashboard to build without first closing this gap. This
--   is NOT an over-exposure security hole (nothing was ever
--   incorrectly visible to a client) — it's a missing grant, exactly
--   the "small backend/API gap" this task's own STOP conditions
--   anticipate and instruct to close minimally.
--
--   NOT FIXED, FLAGGED SEPARATELY (out of scope, Firm Terminal, not
--   Client Portal): cases_select's own migration history is internally
--   inconsistent about whether the firm-manager visibility branch
--   (is_firm_case_manager(), added by
--   20260813043503_add_firm_manager_case_visibility.sql) survived
--   20260912000000_fix_case_access_grants_rls_recursion.sql's
--   drop-and-recreate of that same policy — that later file's
--   recreated cases_select has no is_firm_case_manager() branch, yet
--   20260914000000_widen_hearings_select_for_firm_managers.sql's own
--   header asserts "cases_select already carries" it. This migration
--   does not touch cases_select at all (see design note below), so it
--   neither depends on nor resolves that contradiction. Reported in
--   the final task report as a separate discovered issue.
--
-- DESIGN — PURELY ADDITIVE, NO EXISTING POLICY DROPPED OR MODIFIED:
--   Postgres combines multiple PERMISSIVE policies for the same command
--   with OR. This project already uses that exact technique
--   (20260808000000_create_case_access_grants.sql's own
--   documents_select_via_case_grant / documents_update_via_case_grant,
--   added alongside documents' pre-existing owner_id policy without
--   touching it). Followed here instead of a drop+recreate — avoids
--   any dependency on correctly reconstructing cases_select's exact
--   current live shape (see the flagged contradiction above), and
--   keeps this migration's blast radius to "one new grant for the
--   'client' role", full stop.
--
--   SECURITY DEFINER helper, not a direct EXISTS(...) subquery:
--   matches is_case_owner()/has_case_grant()/is_firm_case_manager()'s
--   established reasoning (20260912000000_fix_case_access_grants_rls_recursion.sql)
--   — a cases_select-family policy that queries another RLS-protected
--   table directly risks recursion the same way the original
--   cases_select/case_access_grants_select pair did. Built the same
--   way from the start here.
--
-- SECURITY: every new policy below is SELECT-only. No client gains any
-- insert/update/delete capability on cases, hearings, or firms. Each
-- policy is scoped to (a) the caller's JWT role being exactly 'client'
-- and (b) an explicit, service-created `clients` row whose profile_id
-- matches auth.uid() and whose linked case/firm matches the row being
-- read. A client can never widen this by supplying a case_id, firm_id,
-- or client_id themselves — the link is resolved server-side from
-- their own clients row, same "do not trust client-supplied ids"
-- posture the task brief requires.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SECURITY DEFINER helper
-- ----------------------------------------------------------------------------

create or replace function public.is_case_client(p_case_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.cases c
    join public.clients cl on cl.id = c.client_id
    where c.id = p_case_id
      and cl.profile_id = auth.uid()
  );
$$;

comment on function public.is_case_client(uuid) is
  'SECURITY DEFINER helper for cases_select_client_own / hearings_select_client_own. Bypasses clients/cases RLS deliberately, same reasoning as is_case_owner()/has_case_grant() -- true only when the case''s client_id points to a clients row whose profile_id is the caller.';

-- ----------------------------------------------------------------------------
-- 2. cases — additive client-visibility policy
-- ----------------------------------------------------------------------------

create policy cases_select_client_own
  on public.cases
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'client'
    and public.is_case_client(id)
  );

comment on policy cases_select_client_own on public.cases is
  'Client Portal. A signed-up client may read a case iff cases.client_id points to a clients row linked to their own profile_id. Additive alongside cases_select -- does not modify or replace it.';

-- ----------------------------------------------------------------------------
-- 3. hearings — additive client-visibility policy
-- ----------------------------------------------------------------------------
-- Mirrors 20260914000000_widen_hearings_select_for_firm_managers.sql's
-- own technique (a new OR-branch for hearings_select's existing
-- caller-set) but delivered as a fully separate additive policy
-- instead of a drop+recreate, per this migration's own design note
-- above.

create policy hearings_select_client_own
  on public.hearings
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'client'
    and public.is_case_client(hearings.case_id)
  );

comment on policy hearings_select_client_own on public.hearings is
  'Client Portal. A signed-up client may read a hearing iff its case is visible to them under is_case_client(). SELECT-only -- hearings_insert/update/delete are untouched, a client can never create or edit a hearing.';

-- ----------------------------------------------------------------------------
-- 4. firms — additive client-visibility policy
-- ----------------------------------------------------------------------------
-- REAL GAP: firms_select_owner (owner_id = auth.uid()) and
-- firms_select_member (profiles.firm_id = id) are the only non-admin
-- read paths on `firms` today (20260726000002_create_firms_table.sql).
-- Neither ever matches a client -- profiles.firm_id is deliberately
-- left null for a client account (20260812000000_create_clients_table.sql's
-- own header: "profiles.firm_id... means something different --
-- internal staff employer"). Without this policy the dashboard cannot
-- show which firm is handling the client's matters at all.

create policy firms_select_client
  on public.firms
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'client'
    and exists (
      select 1 from public.clients cl
      where cl.firm_id = firms.id
        and cl.profile_id = auth.uid()
    )
  );

comment on policy firms_select_client on public.firms is
  'Client Portal. A signed-up client may read the firm they are a client of (clients.firm_id), read-only. No insert/update/delete granted.';

-- ============================================================================
-- Migration: fix_firm_manager_case_resource_visibility
-- ============================================================================
-- RECONSTRUCTED -- found already applied live as version 20260818071705
-- during the Lawyer Terminal B-level Firm-Manager Visibility Consistency
-- Audit + Fix, with no matching file previously in this repository --
-- same "applied directly, never committed" gap this project's own
-- 20260813043503_add_firm_manager_case_visibility.sql,
-- 20260912000000_fix_case_access_grants_rls_recursion.sql, and
-- 20260913000000_firm_members_select_same_firm_recursion.sql headers
-- already document and reconcile for other drifted changes. Written
-- from live introspection (pg_policies, confirmed against the live
-- database this session) -- resulting schema state matches live
-- exactly; original file text is not guaranteed identical. Uses
-- version 20260818071705, matching `supabase migrations list`'s actual
-- recorded version for what's live today -- chronologically it sits
-- between 20260814041122_add_case_grant_storage_policy.sql and
-- 20260904000000_create_hearings_table.sql.
--
-- WHAT THIS ADDS: extends the SELECT-visibility widening
-- 20260813043503_add_firm_manager_case_visibility.sql already gave
-- `cases_select` (and 20260914000000 later gave `hearings_select`) to
-- the three remaining case-scoped resources that were missing it:
-- case_documents, documents (via case_documents), and case_notes, plus
-- an equivalent branch on tasks_select for case-linked tasks. A firm's
-- own owner/admin can now see every document, note, and task belonging
-- to any case in their own firm -- not just resources on cases they
-- personally own or hold an explicit case_access_grants row for --
-- consistent with the same-firm-manager visibility `cases_select` and
-- `hearings_select` already grant. Same `public.is_firm_case_manager()`
-- SECURITY DEFINER helper reused throughout, no new function.
--
-- SELECT-ONLY, SAME POSTURE AS 20260914000000: every INSERT/UPDATE/
-- DELETE policy on case_documents, documents, case_notes, and tasks is
-- deliberately left untouched -- a firm owner/admin gains read
-- visibility into every case-linked resource in their firm, but
-- creating/editing/deleting still requires being the case owner or
-- holding an active read_write case_access_grants grant on that
-- specific case (or, for case_notes, being the note's own author for
-- update; or, for standalone tasks, any firm_members row, unchanged).
-- This mirrors 20260914000000's own "never weaken authorization simply
-- to make create/edit buttons work" reasoning and matches this
-- project's established mutation posture: manager visibility is a
-- read-time concept everywhere it exists, never a write-time one. No
-- other table, policy, or column is touched.
--
-- DO NOT apply this file directly with `supabase db push` unless you
-- have first confirmed version 20260818071705 is NOT already applied on
-- your target project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- case_documents_select -- add is_firm_case_manager(c.firm_id) branch
-- ----------------------------------------------------------------------------

drop policy if exists case_documents_select on public.case_documents;

create policy case_documents_select
  on public.case_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_documents.case_id
        and (
          c.owner_id = auth.uid()
          or exists (
            select 1 from public.case_access_grants g
            where g.case_id = c.id
              and g.grantee_id = auth.uid()
              and g.revoked_at is null
          )
          or public.is_firm_case_manager(c.firm_id)
        )
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- documents -- ONE NEW ADDITIVE POLICY, mirrors
-- documents_select_via_case_grant's existing shape
-- ----------------------------------------------------------------------------

create policy documents_select_via_firm_manager
  on public.documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.case_documents cd
      join public.cases c on c.id = cd.case_id
      where cd.document_id = documents.id
        and public.is_firm_case_manager(c.firm_id)
    )
  );

-- ----------------------------------------------------------------------------
-- case_notes_select -- add is_firm_case_manager(c.firm_id) branch
-- ----------------------------------------------------------------------------
-- Widens the case-owner branch only. The case_access_grants branch is
-- untouched -- read-only grantees remain excluded from case_notes,
-- per that migration's own "firm-staff-only" scoping decision. A firm
-- owner/admin qualifies as firm staff, so this branch closes the gap
-- that decision's own intent already implied but never granted at the
-- RLS layer.

drop policy if exists case_notes_select on public.case_notes;

create policy case_notes_select
  on public.case_notes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_notes.case_id
        and (
          c.owner_id = auth.uid()
          or public.is_firm_case_manager(c.firm_id)
        )
    )
    or exists (
      select 1 from public.case_access_grants g
      where g.case_id = case_notes.case_id
        and g.grantee_id = auth.uid()
        and g.revoked_at is null
        and g.access_level = 'read_write'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- tasks_select -- add is_firm_case_manager(firm_id) branch
-- ----------------------------------------------------------------------------
-- Additive OR branch alongside the existing assignee / case-linked /
-- standalone-firm-member branches -- a firm owner/admin now sees every
-- task in their firm (case-linked or standalone) even without being
-- the case owner, an active grantee, or the assignee. tasks.firm_id is
-- used directly (denormalized column already on the table) rather than
-- joining back through cases, same posture as
-- 20260914000000_widen_hearings_select_for_firm_managers.sql's
-- identical choice for hearings.firm_id.

drop policy if exists tasks_select on public.tasks;

create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (
    assignee_profile_id = auth.uid()
    or (
      case_id is not null
      and exists (
        select 1 from public.cases c
        where c.id = tasks.case_id
          and (
            c.owner_id = auth.uid()
            or exists (
              select 1 from public.case_access_grants g
              where g.case_id = c.id
                and g.grantee_id = auth.uid()
                and g.revoked_at is null
            )
          )
      )
    )
    or (
      case_id is null
      and exists (
        select 1 from public.firm_members fm
        where fm.firm_id = tasks.firm_id
          and fm.profile_id = auth.uid()
      )
    )
    or public.is_firm_case_manager(firm_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

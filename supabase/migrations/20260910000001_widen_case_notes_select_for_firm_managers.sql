-- ============================================================================
-- Migration: widen_case_notes_select_for_firm_managers
-- ============================================================================
-- SPLIT OUT of 20260818071705_fix_firm_manager_case_resource_visibility.sql
-- -- Final Lawyer Terminal V1 Launch Audit, Blocker #2 (migration replay
-- ordering). That file originally widened case_notes_select in the same
-- statement block as case_documents/documents/tasks, but sits earlier in
-- migration order than 20260910000000_create_case_notes_table.sql, which
-- creates the table this policy applies to -- a fresh, from-scratch
-- migration replay would fail at that point with "relation
-- public.case_notes does not exist". Production is unaffected either way
-- (the resulting policy has been live there since the original out-of-band
-- change, recorded under version 20260818071705) -- this split is a
-- LOCAL, repository-only reconciliation so the migration history itself
-- becomes safely replayable, not a change to what's live. No remote
-- migration history was touched or repaired to make this change.
--
-- Positioned immediately after case_notes' own creation, same "create
-- table, then a later dedicated migration widens its SELECT policy" shape
-- this project already uses for hearings (20260904000000 creates the
-- table, 20260914000000_widen_hearings_select_for_firm_managers.sql
-- widens hearings_select afterward) -- this migration is that same
-- pattern applied to case_notes instead of being newly invented.
--
-- WHAT THIS ADDS: widens the case-owner branch of case_notes_select
-- (created unwidened by 20260910000000_create_case_notes_table.sql) to
-- also grant visibility to a firm's own owner/admin over every note on
-- any case in their own firm, via the existing
-- `public.is_firm_case_manager()` SECURITY DEFINER helper -- no new
-- function, same helper 20260813043503/20260914000000 already use. The
-- case_access_grants branch is left untouched: read-only grantees remain
-- excluded from case_notes entirely, per that migration's own
-- "firm-staff-only" scoping decision -- a firm owner/admin qualifies as
-- firm staff, so this branch closes the gap that decision's own intent
-- already implied but never granted at the RLS layer.
--
-- SELECT-ONLY, SAME POSTURE AS 20260914000000 AND
-- 20260818071705: case_notes_insert/update/delete are NOT touched by
-- this migration -- a firm owner/admin gains read visibility into every
-- note on a case in their firm, but creating a note still requires being
-- the case owner or an active read_write grantee (case_notes_insert,
-- unchanged), editing still requires being the note's own author
-- (case_notes_update, unchanged), and deleting still requires being the
-- author or the case owner (case_notes_delete, unchanged). Manager
-- visibility is a read-time concept here, never a write-time one, same
-- as everywhere else this pattern is used in this project.
--
-- Resulting policy text is byte-identical to the case_notes_select block
-- this file's content was split out of -- only its position in the
-- migration sequence changed, not its content.
-- ============================================================================

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

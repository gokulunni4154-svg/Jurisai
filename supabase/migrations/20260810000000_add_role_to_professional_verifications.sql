-- ============================================================================
-- Migration: add_role_to_professional_verifications
-- ============================================================================
-- Lawyer Inquiry (Contact-a-Lawyer Handoff) -- unblocks scoping doc §2 step 2
-- ("verified lawyers only" directory). Full trail in
-- LAWYER_INQUIRY_SCOPING.md and this session's discussion.
--
-- PROBLEM THIS SOLVES: professional_verifications
-- (20260803000002_create_professional_verifications_table.sql) is
-- confirmed generic across ALL roles, with no column identifying which
-- role a given row belongs to. The only source of truth for role is
-- auth.users.app_metadata (per profiles' own migration, deliberately --
-- role is kept off every RLS-writable table to prevent self-escalation).
-- app_metadata is not reachable via a normal PostgREST embed/join, so a
-- directory query filtering "verified LAWYERS only" has had no data-layer
-- path to do so.
--
-- DECIDED (delegated -- "u can decide"): add a nullable, mirrored `role`
-- column directly to professional_verifications, rather than either (a) a
-- new standalone 1:1 table, or (b) a Postgres view over auth.users.
--   - Not a new table: professional_verifications is already 1:1-keyed on
--     profile_id and already exists to hold "extra facts about this
--     profile's verification" -- a second 1:1 table buys nothing over one
--     new column, and profiles' own stated reason for splitting tables
--     ("avoid nullable-column sprawl on a table every account type
--     shares") doesn't apply here: this table isn't shared by every
--     account type, and one column isn't sprawl.
--   - Not a view over auth.users: would be a first-of-its-kind pattern in
--     this codebase, with real security_invoker/permission footguns, to
--     solve a problem one column already solves more simply.
--
-- FLAGGED, REAL TRADEOFF, NOT HIDDEN: this is a deliberate denormalization.
-- `role` now lives in two places -- auth.users.app_metadata (source of
-- truth) and this mirror. Safe ONLY as long as a profile's role is fixed
-- at signup and never changes afterward, which appears true today (no
-- role-change flow has been pasted anywhere in this project's history).
-- If a role-change feature is ever built, this mirror MUST be updated in
-- the same transaction/request, or it will silently drift from
-- app_metadata. Flagged here so a future session isn't surprised by it.
--
-- FLAGGED, NOT SOLVED HERE: this migration only adds the column -- it
-- does not populate it. Two gaps, both deliberately left for the
-- Service-layer file, not guessed here:
--   1. Existing rows: this migration does not backfill `role` for any
--      professional_verifications rows created before this migration
--      runs. No backfill script is included, since doing so correctly
--      requires reading auth.users.app_metadata per row (an admin-client,
--      one-time operation) -- out of scope for a schema-only migration.
--      Directory queries will simply exclude any pre-existing verified
--      row with role IS NULL until backfilled.
--   2. New rows: ProfessionalVerificationService#submitVerification()
--      (never pasted this session) is the only confirmed write path to
--      this table (see the base migration's own RLS comment). That
--      Service already has the caller's AuthUser.role available at write
--      time and should include it in the insert -- but that edit is
--      pending the real file being pasted, not made here.
-- ============================================================================

alter table public.professional_verifications
  add column role text
    constraint professional_verifications_role_check check (
      role in ('individual', 'lawyer', 'law_firm', 'business', 'admin', 'support')
    );

comment on column public.professional_verifications.role is
  'Mirror of auth.users.app_metadata.role at the time this verification row was written -- NOT the source of truth (app_metadata is). Nullable: pre-existing rows are not backfilled by this migration (see migration header). Values must stay in sync with UserRole (src/core/auth/types.ts); if that union ever changes, this CHECK constraint must change with it, same as every other role-shaped CHECK in this project.';

-- No index added yet: directory queries filtering on role will also
-- filter on status = 'verified' (see lawyer-directory.repository.ts) --
-- a composite (status, role) index may be worth adding once real query
-- volume exists. Not added speculatively here, consistent with this
-- project's stated posture elsewhere (e.g. document_set_analyses'
-- migration explicitly deferring an index for the same reason).
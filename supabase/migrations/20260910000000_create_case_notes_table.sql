-- ============================================================================
-- Migration: create_case_notes
-- ============================================================================
-- Internal Notes and Comments — Phase 4. Placeholder timestamp/filename,
-- same flagged-not-confirmed convention as
-- 20260814000000_create_tasks_table.sql (Task Management) — confirm the
-- real filename before applying.
--
-- CORRECTED, this session: the RLS predicates below were previously
-- FLAGGED as inferred, not verified. Now CONFIRMED against the real,
-- pasted 20260808000000_create_case_access_grants.sql:
--   - "active grant" predicate is `revoked_at is null` — matches what
--     was inferred.
--   - admin/support role check is
--     `(auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')`
--     — matches what was inferred.
-- Both predicates below are now copied directly from that real file's
-- own cases_update/case_documents policies, not re-inferred.
--
-- ALSO CORRECTED, this session: schema-qualified every table reference
-- with `public.`, matching the real migration's own convention (the
-- prior draft left these unqualified). Added an updated_at trigger
-- calling public.set_updated_at() — the real cases table has an
-- identical cases_set_updated_at trigger; the prior draft set a
-- default on case_notes.updated_at but never wired the trigger, which
-- would have left updated_at stale on every edit (a real bug caught by
-- this comparison, not previously flagged).
--
-- SCOPING DECISIONS (this session's own judgment calls, not
-- re-confirmed product decisions):
--   1. case_id is NOT NULL — always case-linked, unlike tasks.case_id
--      (nullable, standalone-firm-todo capable). Mirrors hearings'
--      NOT NULL precedent instead.
--   2. Visibility is READ_WRITE-GRANTEE-ONLY, deliberately narrower
--      than Case Timeline's "owner or EITHER access level" rule —
--      "internal" read as firm-staff-only, excluding read-only
--      grantees (typically clients). Still flagged pending Gokul's
--      confirmation — the RLS predicate correction above only fixes
--      the SQL mechanics, not this scoping call itself.
-- ============================================================================

create table public.case_notes (
  id uuid primary key default gen_random_uuid(),

  case_id uuid not null references public.cases (id) on delete cascade,
  author_id uuid not null references public.profiles (id),

  content text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.case_notes is
  'Internal, firm-staff-only notes/comments on a case. Visibility deliberately excludes read-only case_access_grants grantees — see this migration''s own header for the scoping call this rests on.';

create trigger case_notes_set_updated_at
  before update on public.case_notes
  for each row
  execute function public.set_updated_at();

create index case_notes_case_id_idx on public.case_notes (case_id);

alter table public.case_notes enable row level security;

-- ----------------------------------------------------------------------------
-- RLS -- case_notes
-- ----------------------------------------------------------------------------
-- SELECT/INSERT: case owner, OR an active READ_WRITE grantee (not
-- read-only — decision #2 above), OR a platform admin/support user.
-- Predicates below are copied directly from the real
-- case_access_grants migration's cases_update/case_documents_insert
-- policies, confirmed this session.

create policy case_notes_select
  on public.case_notes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = case_notes.case_id
        and c.owner_id = auth.uid()
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

create policy case_notes_insert
  on public.case_notes
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and (
      exists (
        select 1 from public.cases c
        where c.id = case_notes.case_id
          and c.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.case_access_grants g
        where g.case_id = case_notes.case_id
          and g.grantee_id = auth.uid()
          and g.revoked_at is null
          and g.access_level = 'read_write'
      )
    )
  );

-- UPDATE: author only (self-edit) — no case-owner override, per
-- case-note.service.ts's own updateNote() scoping.
create policy case_notes_update
  on public.case_notes
  for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- DELETE: author OR the case owner (owner can moderate their own
-- case's notes).
create policy case_notes_delete
  on public.case_notes
  for delete
  to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.cases c
      where c.id = case_notes.case_id
        and c.owner_id = auth.uid()
    )
  );
-- ============================================================================
-- Migration: create_hearings_table
-- ============================================================================
-- Phase 4 -- Enterprise & Collaboration, Hearings & Calendar.
--
-- Real path: supabase/migrations/20260904000000_create_hearings_table.sql
-- (underscore convention, matching the project's dominant style --
-- 20260814000000_create-tasks-table.sql's hyphenated filename was
-- already flagged as a one-off inconsistency, not a new convention to
-- repeat).
--
-- SCOPE DECIDED BY DELEGATION ("u can decide"), against real confirmed
-- source (20260808000000_create_case_access_grants.sql's real `cases`
-- table -- id, firm_id, team_id, owner_id, title, status, created_at,
-- updated_at -- and 20260814000000_create-tasks-table.sql's real RLS
-- pattern for a case-linked resource):
--
--   - case_id is NOT NULL. Unlike tasks (case-linked OR standalone
--     firm to-do), a hearing only makes sense attached to a case --
--     there is no "standalone firm hearing" concept in scope. This
--     means hearings' RLS only needs the case-linked branch of the
--     tasks_* policies, not the firm-membership standalone branch.
--   - firm_id is denormalized from cases.firm_id, same as tasks and
--     case_documents -- identical caveat: kept in sync only insofar as
--     cases.firm_id is immutable after creation (true today).
--   - hearing_date is timestamptz, NOT a plain date (unlike
--     tasks.due_date) -- a court hearing has a real time component,
--     not just a calendar day. Matches documents.hearing_date's own
--     type choice (20260725000000_add_hearing_date_to_documents.sql).
--   - hearing_type: text + named CHECK, matching this project's real,
--     confirmed convention (firm_members.role, case_access_grants.
--     access_level, cases.status, tasks.status all use text+CHECK, not
--     enum -- case_access_grants migration's own DECIDED Q1 settled
--     this project-wide). A small fixed list rather than free text, so
--     a future calendar view can filter/color-code by type without
--     parsing free text.
--   - court_name, location, notes, outcome: all nullable free text.
--     outcome is meaningful only after the hearing occurs -- no CHECK
--     constraint on it (unlike status-style columns), since the set of
--     real-world outcomes is open-ended and not yet product-scoped.
--   - reminder_sent_at: NEW compared to tasks. This directly closes the
--     gap 20260725000000_add_hearing_date_to_documents.sql's own header
--     explicitly flagged and left unresolved ("the Vercel Cron job...
--     will need SOME way to avoid re-notifying... either a new column
--     here, or a query against the Notifications table"). For hearings,
--     the column approach is taken: simpler dedup query, no dependency
--     on notifications' own row shape for a correctness-critical check.
--     This does NOT retroactively add the same column to `documents` --
--     that table's own dedup gap is unchanged by this migration, out of
--     scope here.
--
-- AUTHORIZATION MODEL: identical actor set to tasks' case-linked branch
-- only (FLAGGED ASSUMPTION #1 in 20260814000000_create-tasks-table.sql)
-- -- case owner, or an active read_write case_access_grants grantee,
-- may create/update/delete. A read-only grantee (including a client)
-- may only SELECT. There is no separate "assignee" concept for
-- hearings (unlike tasks' assignee_profile_id) -- a hearing has no
-- single responsible party distinct from who manages the case, so
-- there is no third RLS/service actor path to carry over from tasks.
-- ============================================================================

create table public.hearings (
  id uuid primary key default gen_random_uuid(),

  case_id uuid not null references public.cases (id) on delete cascade,
  firm_id uuid not null references public.firms (id) on delete cascade,

  hearing_date timestamptz not null,

  hearing_type text not null default 'other'
    constraint hearings_hearing_type_check check (
      hearing_type in ('first_hearing', 'arguments', 'evidence', 'judgment', 'other')
    ),

  court_name text,
  location text,
  notes text,
  outcome text,

  created_by uuid not null references public.profiles (id),

  -- Dedup marker for the reminder cron -- see migration header. Set by
  -- the cron route (admin client) once a reminder notification has
  -- gone out for this row; never client-writable (omitted from both
  -- hearing.schemas.ts input schemas on purpose).
  reminder_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hearings is
  'Case-linked hearing/listing dates. Always case-linked (case_id NOT NULL) -- no standalone-firm concept, unlike tasks. firm_id denormalized from cases.firm_id.';

comment on column public.hearings.reminder_sent_at is
  'Set once a reminder notification has been sent for this hearing_date. Dedup marker for the reminder cron -- never client-writable.';

create trigger hearings_set_updated_at
  before update on public.hearings
  for each row
  execute function public.set_updated_at();

create index hearings_case_id_idx on public.hearings (case_id);
create index hearings_firm_id_idx on public.hearings (firm_id);

-- Partial index for the reminder cron's query shape: upcoming hearings
-- not yet reminded. Mirrors documents_hearing_date_active_idx's own
-- "index only the rows a real query will actually match" reasoning.
create index hearings_reminder_pending_idx
  on public.hearings (hearing_date)
  where reminder_sent_at is null;

alter table public.hearings enable row level security;

-- ----------------------------------------------------------------------------
-- RLS -- identical shape to tasks_select/insert/update/delete's
-- case-linked branch only (no standalone branch, no assignee branch).
-- ----------------------------------------------------------------------------

create policy hearings_select
  on public.hearings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = hearings.case_id
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
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

create policy hearings_insert
  on public.hearings
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      exists (
        select 1 from public.cases c
        where c.id = hearings.case_id
          and (
            c.owner_id = auth.uid()
            or exists (
              select 1 from public.case_access_grants g
              where g.case_id = c.id
                and g.grantee_id = auth.uid()
                and g.revoked_at is null
                and g.access_level = 'read_write'
            )
          )
      )
      or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
    )
  );

create policy hearings_update
  on public.hearings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = hearings.case_id
        and (
          c.owner_id = auth.uid()
          or exists (
            select 1 from public.case_access_grants g
            where g.case_id = c.id
              and g.grantee_id = auth.uid()
              and g.revoked_at is null
              and g.access_level = 'read_write'
          )
        )
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

create policy hearings_delete
  on public.hearings
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.cases c
      where c.id = hearings.case_id
        and (
          c.owner_id = auth.uid()
          or exists (
            select 1 from public.case_access_grants g
            where g.case_id = c.id
              and g.grantee_id = auth.uid()
              and g.revoked_at is null
              and g.access_level = 'read_write'
          )
        )
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );
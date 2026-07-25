-- ============================================================================
-- Migration: create_tasks_table
-- ============================================================================
-- Phase 4 -- Enterprise & Collaboration, Task Management.
--
-- Scoping decisions (confirmed by the user this session):
--   - case_id nullable: tasks may be case-linked or standalone firm to-dos.
--   - assignee_profile_id nullable, references profiles directly (not
--     firm_members or clients) -- mirrors case_access_grants.grantee_id's
--     role-agnostic shape, since an assignee may be firm staff OR a client.
--   - status: text + CHECK ('todo'/'in_progress'/'done'), matching the
--     project's real text+CHECK convention (firm_members.role,
--     case_access_grants.access_level, cases.status) over enum.
--   - due_date: simple date, no overdue-tracking column -- confirmed v1.
--
-- FLAGGED ASSUMPTION #1 -- who can create/manage a CASE-LINKED task.
-- The user's answer was "any firm member with access to that case." The
-- real cases_select policy (20260808000000) does NOT grant firm-wide
-- visibility -- only case.owner_id or an active case_access_grants row.
-- There is no separate "firm member" path into a case at all today. So
-- "firm member with access" is read here as: case owner, OR an active
-- read_write grantee -- i.e. the exact same test cases_update already
-- uses. This is an inference from the real policy, not a re-confirmed
-- product decision -- flag if a broader firm-wide case-management
-- concept is intended later.
--
-- FLAGGED ASSUMPTION #2 -- who can create/manage a STANDALONE task
-- (case_id null). No real precedent exists for "firm-wide, not
-- case-scoped" resource access anywhere in this project yet. Default
-- taken (per "u can decide"): any firm_members row for that firm, any
-- role, can create/manage standalone tasks. If firm-standalone
-- resources need finer-grained roles later, this is the first policy
-- to revisit.
--
-- FLAGGED ASSUMPTION #3 -- task UPDATE/DELETE authorization was not
-- explicitly scoped (only create/assign and visibility were). Taken as:
-- same actor set as create (case owner/read_write grantee, or any
-- firm_members for standalone) may update/delete; the assignee alone
-- (if not otherwise in that set) may update status only -- handled at
-- the service layer, not RLS, per this project's established
-- RLS-plus-service-layer defense-in-depth pattern (case.service.ts,
-- firm-member.service.ts). RLS below allows assignee UPDATE at the row
-- level; restricting the assignee to status-only is a service-layer
-- concern, not enforceable by column-level RLS without a trigger this
-- migration deliberately does not add.
--
-- firm_id is denormalized onto tasks (from cases.firm_id when case-
-- linked) rather than requiring every RLS policy to join through
-- cases -- mirrors client_invitations' identical denormalization
-- decision and its identical caveat: kept in sync only insofar as
-- cases.firm_id is immutable after creation (true today -- no
-- case-transfer-between-firms feature exists).
--
-- CLIENT ASSIGNMENT IS SCHEMA-READY BUT CURRENTLY INERT: Client
-- Management (profile_id on a client's record) is paused pending
-- Lawyer Inquiry conversion rework -- see JurisAI notes. A task can be
-- assigned to a client's profile_id once that work resumes and a real
-- client profile exists; nothing here blocks that, but nothing makes
-- it usable yet either.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: tasks
-- ----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete cascade,

  -- Nullable: standalone firm to-do if null, case-linked task if set.
  case_id uuid references public.cases (id) on delete cascade,

  title text not null
    constraint tasks_title_length check (
      char_length(trim(title)) > 0 and char_length(title) <= 255
    ),

  description text,

  status text not null default 'todo'
    constraint tasks_status_check check (
      status in ('todo', 'in_progress', 'done')
    ),

  -- Role-agnostic, mirrors case_access_grants.grantee_id -- may reference
  -- firm staff OR a client's profile. Nullable: a task may be created
  -- unassigned.
  assignee_profile_id uuid references public.profiles (id),

  due_date date,

  created_by uuid not null references public.profiles (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is
  'Firm-scoped tasks, optionally linked to a case. assignee_profile_id is role-agnostic (firm staff or client) -- see migration header. firm_id is denormalized from cases.firm_id when case-linked.';

comment on column public.tasks.case_id is
  'Nullable -- null means a standalone firm to-do, not tied to any case.';

comment on column public.tasks.assignee_profile_id is
  'References profiles directly, not firm_members or clients -- same role-agnostic shape as case_access_grants.grantee_id. Client assignment is schema-ready but currently inert -- see migration header.';

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

create index tasks_firm_id_idx on public.tasks (firm_id);
create index tasks_case_id_idx on public.tasks (case_id) where case_id is not null;
create index tasks_assignee_profile_id_idx on public.tasks (assignee_profile_id) where assignee_profile_id is not null;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.tasks enable row level security;

-- SELECT: case-linked task visible to the case owner or ANY active
-- grantee (read or read_write -- matches cases_select exactly, so a
-- client with a read-only grant still sees all tasks on their case,
-- per the confirmed decision). Standalone task visible to any
-- firm_members row for that firm. Assignee always sees their own task
-- regardless of the above (covers a task assigned to someone without
-- an active case grant, e.g. newly reassigned staff).
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
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- INSERT: case-linked task creatable by case owner or an active
-- read_write grantee only (see FLAGGED ASSUMPTION #1 -- matches
-- cases_update's exact test, not full case visibility). Standalone
-- task creatable by any firm_members row (see FLAGGED ASSUMPTION #2).
create policy tasks_insert
  on public.tasks
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      (
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
                  and g.access_level = 'read_write'
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
      or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
    )
  );

-- UPDATE: same actor set as INSERT, plus the assignee themselves (row-
-- level only -- restricting the assignee to status-only changes is a
-- service-layer concern, see FLAGGED ASSUMPTION #3).
create policy tasks_update
  on public.tasks
  for update
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
                and g.access_level = 'read_write'
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
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- DELETE: deliberately NOT the assignee -- an assignee can complete/
-- update their own task but should not be able to delete it outright.
-- Same actor set as INSERT otherwise.
create policy tasks_delete
  on public.tasks
  for delete
  to authenticated
  using (
    (
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
                and g.access_level = 'read_write'
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
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );
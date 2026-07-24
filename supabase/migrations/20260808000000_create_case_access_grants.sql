-- ============================================================================
-- Migration: create_case_access_grants
-- ============================================================================
-- Phase 4 -- Enterprise & Collaboration. Resolves Open Items #46 (firm
-- visibility for Case Filing) and #54 (team/document access-gating).
-- Full product-decision trail lives in CASE_ACCESS_GRANTS_SCOPING.md.
--
-- Status: DRAFT, resolved against real precedent from
-- 20260806000000_create_invitations_tables.sql and
-- 20260807000000_create_find_auth_user_by_email_function.sql. Two
-- questions previously left open are now decided (by delegation --
-- "u can decide"), documented here rather than silently applied:
--
--   DECIDED Q1 -- text+CHECK, not enum. CASE_ACCESS_GRANTS_SCOPING.md
--   claimed case_status should be a dedicated Postgres enum per "this
--   project's unbroken one-enum-per-concern convention." Real source
--   (firm_members.role, firm_invitations.role, both invitations'
--   status columns) all use text + a named CHECK constraint instead --
--   that claimed convention doesn't hold against the newer real file.
--   case_status and case_access_level below now match that real
--   pattern: text + CHECK, not enum. team_members.role was already
--   text+CHECK from the prior revision of this file.
--
--   DECIDED Q2 -- case_access_grants is now service-layer-only, no
--   client insert/update policy. firm_invitations/team_invitations
--   have zero client write policies for `authenticated` -- creation,
--   revocation, acceptance are all service-layer/admin-client
--   operations, per that migration's own stated reasoning ("mirrors
--   every other membership-changing table in this project").
--   case_access_grants is structurally a grant/membership record, not
--   an owner-writable resource -- brought in line with that pattern.
--   `cases` itself keeps client-write RLS policies, since it's closer
--   to documents/document_sets (an owner-writable resource) than to a
--   pure grant table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. team_members.role -- REOPENS A SHIPPED DECISION
-- ----------------------------------------------------------------------------
-- 20260805000000_create_teams_tables.sql's decision #4 was "no
-- team-level role... moot without roles." Reopened here, deliberately,
-- to support case-access-grant authorization (team leads / firm admins
-- issue grants). See CASE_ACCESS_GRANTS_SCOPING.md sec4.4.
--
-- text + named CHECK, matching firm_members.role's real shape, not a
-- Postgres enum.

alter table public.team_members
  add column role text not null default 'member'
    constraint team_members_role_check check (role in ('member', 'lead'));

-- No uniqueness constraint on role = 'lead' per team -- a team can have
-- multiple leads simultaneously (confirmed). No "last lead" protection
-- either -- deliberately deferred, see scoping doc sec4.4 remaining flag.

-- ----------------------------------------------------------------------------
-- 2. cases
-- ----------------------------------------------------------------------------

create table public.cases (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete cascade,

  -- Nullable: solo lawyers own a case at firm level, no team attached.
  team_id uuid references public.teams (id) on delete set null,

  owner_id uuid not null references public.profiles (id),

  title text not null check (char_length(title) between 1 and 255),

  status text not null default 'open'
    constraint cases_status_check check (
      status in ('open', 'pending', 'on_hold', 'closed', 'won', 'lost', 'settled', 'withdrawn')
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cases is
  'A legal matter/case, distinct from standalone documents. Owner + optional team + firm. See CASE_ACCESS_GRANTS_SCOPING.md sec2.1.';

comment on column public.cases.status is
  'open = actively worked. pending = waiting on external party/event. on_hold = paused. closed = completed, no outcome. won/lost = final judgment. settled = resolved pre-judgment. withdrawn = client withdrew or case dismissed.';

create trigger cases_set_updated_at
  before update on public.cases
  for each row
  execute function public.set_updated_at();

create index cases_firm_id_idx on public.cases (firm_id);
create index cases_team_id_idx on public.cases (team_id);
create index cases_owner_id_idx on public.cases (owner_id);

alter table public.cases enable row level security;

-- ----------------------------------------------------------------------------
-- 3. case_documents (join table, mirrors document_set_members)
-- ----------------------------------------------------------------------------

create table public.case_documents (
  case_id uuid not null references public.cases (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (case_id, document_id)
);

comment on table public.case_documents is
  'Links documents into a case. Does not independently re-verify document ownership -- service-layer concern, per document_set_members own precedent. See scoping doc sec2.2.';

create index case_documents_document_id_idx on public.case_documents (document_id);

alter table public.case_documents enable row level security;

-- ----------------------------------------------------------------------------
-- 4. case_access_grants (the permission mechanism)
-- ----------------------------------------------------------------------------

create table public.case_access_grants (
  id uuid primary key default gen_random_uuid(),

  case_id uuid not null references public.cases (id) on delete cascade,
  grantee_id uuid not null references public.profiles (id),
  granted_by uuid not null references public.profiles (id),

  access_level text not null
    constraint case_access_grants_access_level_check check (
      access_level in ('read', 'read_write')
    ),

  -- Soft-revoke, not hard delete -- preserves grant history for audit.
  revoked_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.case_access_grants is
  'Who was granted access to which case, by whom, read vs read/write, revocable via revoked_at. Also the audit trail for Open Items #46/#54. See scoping doc sec2.3. Writes are service-layer-only -- see DECIDED Q2 above.';

create index case_access_grants_case_id_idx on public.case_access_grants (case_id);
create index case_access_grants_grantee_id_idx on public.case_access_grants (grantee_id);

-- Partial unique index: at most one ACTIVE grant per (case, grantee). A
-- revoked grant doesn't block re-granting later.
create unique index case_access_grants_active_unique
  on public.case_access_grants (case_id, grantee_id)
  where (revoked_at is null);

alter table public.case_access_grants enable row level security;

-- ----------------------------------------------------------------------------
-- 5. RLS -- cases
-- ----------------------------------------------------------------------------

create policy cases_select
  on public.cases
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.case_access_grants g
      where g.case_id = cases.id
        and g.grantee_id = auth.uid()
        and g.revoked_at is null
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- Backstop only -- real gate is the service layer (team lead of
-- team_id, if set, or firm admin), matching the project's
-- RLS-plus-service-layer defense-in-depth pattern.
create policy cases_insert
  on public.cases
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and (
      team_id is null
      or exists (
        select 1 from public.team_members tm
        where tm.team_id = cases.team_id
          and tm.profile_id = auth.uid()
          and tm.role = 'lead'
      )
      or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
    )
  );

create policy cases_update
  on public.cases
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.case_access_grants g
      where g.case_id = cases.id
        and g.grantee_id = auth.uid()
        and g.revoked_at is null
        and g.access_level = 'read_write'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- 6. RLS -- case_documents
-- ----------------------------------------------------------------------------

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
        )
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

create policy case_documents_insert
  on public.case_documents
  for insert
  to authenticated
  with check (
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
              and g.access_level = 'read_write'
          )
        )
    )
  );

create policy case_documents_delete
  on public.case_documents
  for delete
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
              and g.access_level = 'read_write'
          )
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 7. RLS -- case_access_grants
-- ----------------------------------------------------------------------------
-- SELECT only -- see DECIDED Q2 above. Insert/update (issuing/revoking
-- a grant) are service-layer/admin-client operations, matching
-- firm_invitations/team_invitations. No client insert/update policy.

create policy case_access_grants_select
  on public.case_access_grants
  for select
  to authenticated
  using (
    grantee_id = auth.uid()
    or granted_by = auth.uid()
    or exists (
      select 1 from public.cases c
      where c.id = case_access_grants.case_id
        and c.owner_id = auth.uid()
    )
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support')
  );

-- ----------------------------------------------------------------------------
-- 8. documents -- ONE NEW ADDITIVE POLICY
-- ----------------------------------------------------------------------------
-- Higher blast radius than everything above: this touches an
-- already-shipped table's RLS. Purely additive (OR'd alongside the
-- existing owner_id = auth.uid() policy) -- does not alter or remove
-- any existing documents policy.

create policy documents_select_via_case_grant
  on public.documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.case_documents cd
      join public.case_access_grants g on g.case_id = cd.case_id
      where cd.document_id = documents.id
        and g.grantee_id = auth.uid()
        and g.revoked_at is null
    )
  );

create policy documents_update_via_case_grant
  on public.documents
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.case_documents cd
      join public.case_access_grants g on g.case_id = cd.case_id
      where cd.document_id = documents.id
        and g.grantee_id = auth.uid()
        and g.revoked_at is null
        and g.access_level = 'read_write'
    )
  );
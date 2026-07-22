-- ============================================================================
-- Migration: create_teams_tables
-- ============================================================================
-- Phase 4 — Enterprise & Collaboration. Adds `teams` and `team_members`:
-- flat sub-groupings within a firm (firm -> teams -> members, no nesting,
-- no cross-firm teams — confirmed product decision, this session).
--
-- Built against real pasted source: 20260726000002_create_firms_table.sql
-- (table/RLS shape for `teams`, mirroring `firms`), 20260802000001_create_
-- firm_members_table.sql (table shape for `team_members`, mirroring
-- `firm_members` minus the role column), and 20260804000000_support_multi_
-- firm_membership.sql (the self-referential-subquery RLS pattern; not
-- reused in its team-scoped form here — see assumption E below for why).
--
-- Confirmed product decisions this session, not re-litigated here:
--   1. A team belongs to exactly one firm. Flat: firm -> teams -> members.
--      No sub-teams, no cross-firm teams.
--   2. Team membership is its own table (`team_members`), NOT a `team_id`
--      column bolted onto `firm_members` -- forced by decision #3 below
--      (a profile can be on >1 team in the same firm at once, which a
--      single firm_members row per (firm_id, profile_id) cannot represent).
--   3. A profile may belong to multiple teams within the same firm
--      simultaneously.
--   4. No team-level role. Membership is flat (on the team, or not) --
--      no lead/member distinction, no role column, no last-lead
--      protection (moot without roles).
--   5. Team creation, deletion, and member add/remove are all owner/admin-
--      only, gated the same way firm_members writes are: no client-
--      writable RLS insert/update/delete policy at all -- service-layer-
--      only, via requireFirmRole(['owner','admin']) in a new
--      TeamService/TeamMemberService, mirroring FirmMemberService exactly.
--   6. Scope of this pass: roster only (teams + team_members CRUD). Team
--      membership does NOT gate case/document visibility yet -- explicitly
--      deferred to a separate, future sub-feature. FLAGGED, NOT FIXED,
--      same convention as ProfileRepository#findByFirmId() in the prior
--      migration: this is a real, currently-open gap, not an oversight.
--   7. Both teams-list visibility AND team-roster visibility are FIRM-WIDE:
--      any member of a firm (via firm_members) may see every team in that
--      firm and every team's full roster -- not limited to teams they
--      personally belong to. Confirmed explicitly, this session. This is
--      why team_members' SELECT policy below joins through `teams` to
--      `firm_members` rather than self-referencing `team_members` the way
--      firm_members_select_same_firm self-references firm_members --
--      roster visibility here is scoped to "same firm", not "same team".
--
-- FLAGGED ASSUMPTIONS -- new decisions this file, no direct prior precedent:
--   A. `teams.firm_id` uses `on delete cascade` (matches firm_members'
--      firm_id, not firms.owner_id's `on delete restrict`) -- a team has
--      no meaning without its parent firm, same reasoning firm_members'
--      own migration gives for its own firm_id.
--   B. `team_members.team_id` and `.profile_id` both use `on delete
--      cascade`, matching firm_members' identical choice on both columns
--      for the identical reason (a membership row has no independent
--      meaning once either side is gone).
--   C. Unique constraint on `team_members` is (team_id, profile_id), NOT
--      (profile_id) alone and NOT scoped further -- this is what makes
--      decision #3 (multi-team membership) possible: a profile can hold
--      many team_members rows, one per team, with nothing capping how
--      many teams within one firm.
--   D. RLS SELECT policy for `teams`: confirmed firm-wide (decision #7).
--   E. RLS SELECT policy for `team_members`: confirmed firm-wide, not
--      team-scoped (decision #7) -- joins team_members -> teams ->
--      firm_members rather than self-referencing team_members.
--   F. No trigger or constraint requiring team_members.profile_id to
--      already hold a firm_members row for team_members.team_id's firm.
--      "A team member must already be a firm member" is treated as an
--      application-layer invariant (TeamMemberService's addMember(),
--      not yet written) -- same division of responsibility firm_members'
--      own migration draws between DB constraints and service-layer
--      checks (see that migration's assumption #5).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: teams
-- ----------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete cascade,

  name text not null
    constraint teams_name_length check (
      char_length(trim(name)) > 0 and char_length(name) <= 255
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.teams is
  'Flat sub-group within a firm. firm -> teams -> members, no nesting, no cross-firm teams -- see migration header, decision #1.';

create trigger teams_set_updated_at
  before update on public.teams
  for each row
  execute function public.set_updated_at();

create index teams_firm_id_idx on public.teams (firm_id);

-- ----------------------------------------------------------------------------
-- Table: team_members
-- ----------------------------------------------------------------------------
create table public.team_members (
  id uuid primary key default gen_random_uuid(),

  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint team_members_team_profile_unique unique (team_id, profile_id)
);

comment on table public.team_members is
  'Flat team roster, no role column -- see migration header, decision #4. A profile may belong to multiple teams within the same firm at once -- see decision #3 and assumption C.';

create trigger team_members_set_updated_at
  before update on public.team_members
  for each row
  execute function public.set_updated_at();

create index team_members_team_id_idx on public.team_members (team_id);
create index team_members_profile_id_idx on public.team_members (profile_id);

-- ----------------------------------------------------------------------------
-- Row Level Security: teams
-- ----------------------------------------------------------------------------
alter table public.teams enable row level security;

-- Any member of the firm may read the firm's full team list -- confirmed
-- firm-wide, see migration header, decision #7 / assumption D.
create policy teams_select_firm_member
  on public.teams
  for select
  to authenticated
  using (
    firm_id in (select firm_id from public.firm_members where profile_id = auth.uid())
  );

create policy teams_select_admin
  on public.teams
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for `authenticated`: team creation and
-- deletion are service-layer, owner/admin-only operations -- same
-- reasoning firms' and firm_members' own migrations give.

-- ----------------------------------------------------------------------------
-- Row Level Security: team_members
-- ----------------------------------------------------------------------------
alter table public.team_members enable row level security;

create policy team_members_select_own
  on public.team_members
  for select
  to authenticated
  using (profile_id = auth.uid());

-- Any member of the team's PARENT FIRM may read that team's roster --
-- confirmed firm-wide, not team-scoped, see migration header, decision #7
-- / assumption E. Joins team_members -> teams -> firm_members via
-- team_id, deliberately NOT a team_members self-reference (that would be
-- the narrower, team-scoped version explicitly not chosen this session).
create policy team_members_select_firm_member
  on public.team_members
  for select
  to authenticated
  using (
    team_id in (
      select t.id
      from public.teams t
      join public.firm_members fm on fm.firm_id = t.firm_id
      where fm.profile_id = auth.uid()
    )
  );

create policy team_members_select_admin
  on public.team_members
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for `authenticated`: membership changes
-- are service-layer, owner/admin-only operations -- see migration header,
-- decision #5.
-- ============================================================================
-- Migration: create_invitations_tables
-- ============================================================================
-- Phase 4 — Enterprise & Collaboration. Invitation System, first migration.
-- Adds `firm_invitations` and `team_invitations` -- two separate tables,
-- not one shared table with a scope discriminator (Decision #6: mirrors
-- the project's existing firm_members/team_members split, keeps each
-- repository generic over exactly one table).
--
-- This migration was BLOCKED pending confirmation of firm_members.role's
-- real type -- now resolved against 20260802000001_create_firm_members_table.sql
-- (pasted in full this session): `role` there is `text` + a CHECK
-- constraint (firm_members_role_check), not a Postgres enum, with values
-- ('owner', 'admin', 'employee', 'lawyer'). firm_invitations.role below
-- uses the identical text + CHECK shape and the identical value set, so
-- an invitation's role can be applied directly to a new firm_members row
-- on acceptance with no translation step.
--
-- Confirmed product decisions this session, not re-litigated here (full
-- numbered list lives in the continuation prompt this migration was
-- drafted against):
--   2.  Invitations are by email. Existing profile -> links to it.
--       No existing profile -> genuine new-user invite.
--   3.  Dual acceptance mechanism: token-based link for new-user invites,
--       in-app pending-list for existing-profile invites.
--   4.  Link-generation only. No email-dispatch infrastructure exists or
--       is added here -- the inviter shares the link/token manually.
--   5.  Existing-profile invites are standalone, not wired through
--       NotificationsService.
--   7.  firm_invitations carries `role` -- the FirmRole applied on
--       acceptance, chosen by the inviter at invite time (same input
--       addMember() already takes, just deferred/accept-gated).
--   8.  7-day expiration, enforced at accept time (application layer --
--       this migration does not add a DB trigger to auto-expire rows;
--       `status = 'pending'` rows past `expires_at` are still physically
--       'pending' until the service layer checks and transitions them).
--   9.  Revocable by owner/admin before acceptance.
--   10. Re-inviting an email with an existing pending invite RE-ISSUES
--       it (fresh token/expiry, old one invalidated) rather than
--       erroring -- backstopped at the DB level by the partial unique
--       index below (at most one 'pending' row per firm+email).
--   11. Team invitations require the target already be a firm member
--       (same precondition TeamMemberService#addMember() enforces).
--   12. Direct consequence of #11: team_invitations.profile_id is NOT
--       nullable -- there is no new-user/token path for team invitations,
--       only the in-app-list path applies.
--
-- FLAGGED ASSUMPTIONS -- new decisions this file, no direct prior
-- precedent, confirmed explicitly where noted:
--   A. `firm_id` (firm_invitations) and `team_id` (team_invitations) both
--      use `on delete cascade` -- matches firm_members'/team_members' own
--      choice on the identical column, same reasoning: an invitation has
--      no meaning without its parent firm/team.
--   B. `profile_id` (both tables, nullable on firm_invitations, required
--      on team_invitations per Decision #12) uses `on delete cascade` --
--      if the target profile is deleted, an invitation pointing at it is
--      meaningless. Matches firm_members'/team_members' own choice.
--   C. `invited_by` uses `on delete cascade` -- CONFIRMED EXPLICITLY this
--      session (not defaulted to match firms.owner_id's `on delete
--      restrict`, which was considered and rejected). Real, flagged
--      consequence: deleting an inviter's profile deletes EVERY
--      invitation they ever sent, including already-`accepted` or
--      already-`revoked` historical rows -- not just pending ones. This
--      trades away invitation history/audit trail for the inviter in
--      exchange for not blocking profile deletion. If invitation history
--      needs to survive inviter deletion later, this is the column to
--      revisit (e.g. switch to `on delete set null` and drop the `not
--      null` constraint on `invited_by`).
--   D. `token` (firm_invitations only -- team_invitations has no token
--      column at all, per Decision #12) is `text`, `unique`, `not null`,
--      always generated at insert time by the application layer (not a
--      DB default) -- consistent with this being link-generation-only
--      (Decision #4): the service layer needs to hold the raw token
--      value to construct the `/signup?invite=<token>` URL, so it must
--      generate it in code rather than read it back from a DB default
--      expression it never sees.
--   E. `status` uses the same four-value CHECK on both tables
--      ('pending', 'accepted', 'revoked', 'expired'), matching the value
--      set given in the continuation prompt's table-schema draft
--      verbatim. `expired` is included as a real status value even
--      though nothing in this migration transitions a row into it
--      automatically (see Decision #8's note above) -- the application
--      layer is expected to set it explicitly when an expired pending
--      invite is looked up, rather than leaving it silently 'pending'
--      forever.
--   F. Partial unique indexes (not full unique constraints) back
--      Decision #10 (re-invite re-issues) at the DB level: only ONE
--      'pending' row can exist per (firm_id, lower(email)) or
--      (team_id, profile_id) at a time. Accepted/revoked/expired rows
--      for the same email/profile are NOT constrained -- a full history
--      of past invitations to the same address is expected to
--      accumulate, only concurrent *pending* duplicates are blocked.
--   G. RLS SELECT policies below follow the two-tier pattern
--      firm_members/team_members already established (own-row visibility
--      + same-firm owner/admin visibility + platform admin/support
--      override) rather than inventing a new shape. No client-writable
--      insert/update/delete policy on either table -- creating,
--      revoking, and accepting an invitation are all service-layer
--      operations (mirrors every other membership-changing table in
--      this project).
--   H. Owner/admin visibility into a firm's own invitations is scoped to
--      firm_members rows with role in ('owner', 'admin') specifically --
--      NOT firm-wide the way team roster visibility is (see
--      20260805000000_create_teams_tables.sql's Decision #7). An
--      invitation is a pending administrative action (who's being
--      granted access, at what role), not a roster fact -- a plain
--      employee/lawyer firm member has no stated need to see it. Flagged
--      as a NEW decision, not yet independently confirmed against the
--      product-decision list this migration was drafted against --
--      revisit if that turns out to be wrong.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: firm_invitations
-- ----------------------------------------------------------------------------
create table public.firm_invitations (
  id uuid primary key default gen_random_uuid(),

  firm_id uuid not null references public.firms (id) on delete cascade,

  email text not null,

  -- Nullable: null until/unless this invite is a new-user invite that
  -- has since been claimed (AuthService.signUp() sets this on
  -- acceptance -- see Decision #13 in the continuation prompt). For an
  -- existing-profile invite, this is set at creation time, not deferred
  -- to acceptance.
  profile_id uuid references public.profiles (id) on delete cascade,

  role text not null
    constraint firm_invitations_role_check check (
      role in ('owner', 'admin', 'employee', 'lawyer')
    ),

  token text not null,

  status text not null default 'pending'
    constraint firm_invitations_status_check check (
      status in ('pending', 'accepted', 'revoked', 'expired')
    ),

  invited_by uuid not null references public.profiles (id) on delete cascade,

  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint firm_invitations_token_unique unique (token)
);

comment on table public.firm_invitations is
  'Pending/historical invitations to join a firm at a given FirmRole. Dual acceptance path: token-based link (new-user invites) or in-app pending-list (existing-profile invites) -- see migration header, Decisions #2-#3.';

comment on column public.firm_invitations.role is
  'The FirmRole applied to the resulting firm_members row on acceptance. Same value set as firm_members.role (owner/admin/employee/lawyer) by construction -- see migration header intro.';

comment on column public.firm_invitations.profile_id is
  'Null at creation for a new-user invite (no account exists yet); set at creation for an existing-profile invite; set on acceptance for a new-user invite once the account is created -- see migration header, assumption on profile_id nullability.';

comment on column public.firm_invitations.token is
  'Raw token value, generated by the application layer at insert time (see migration header, assumption D). Rides in the signup URL as /signup?invite=<token> for new-user invites -- see Decision #13 in the continuation prompt.';

create trigger firm_invitations_set_updated_at
  before update on public.firm_invitations
  for each row
  execute function public.set_updated_at();

create index firm_invitations_firm_id_idx on public.firm_invitations (firm_id);
create index firm_invitations_profile_id_idx on public.firm_invitations (profile_id);
create index firm_invitations_token_idx on public.firm_invitations (token);

-- Backstops Decision #10 (re-invite re-issues, not a conflict error) at
-- the DB level: at most one 'pending' invitation per firm+email at a
-- time. Accepted/revoked/expired history is unconstrained -- see
-- migration header, assumption F.
create unique index firm_invitations_firm_email_pending_unique
  on public.firm_invitations (firm_id, lower(email))
  where (status = 'pending');

-- ----------------------------------------------------------------------------
-- Row Level Security: firm_invitations
-- ----------------------------------------------------------------------------
alter table public.firm_invitations enable row level security;

-- An existing-profile invitee may read their own pending invite -- this
-- is the in-app pending-list's actual read path (Decision #3).
create policy firm_invitations_select_own
  on public.firm_invitations
  for select
  to authenticated
  using (profile_id = auth.uid());

-- Owner/admin members of the firm may read all of that firm's
-- invitations (create/revoke UI needs to list them). Scoped to
-- owner/admin specifically, NOT firm-wide -- see migration header,
-- assumption H.
create policy firm_invitations_select_firm_admin
  on public.firm_invitations
  for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where profile_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy firm_invitations_select_admin
  on public.firm_invitations
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for `authenticated`: creating, revoking,
-- and accepting an invitation are service-layer-only operations -- same
-- reasoning every other membership-changing table in this project gives.

-- ----------------------------------------------------------------------------
-- Table: team_invitations
-- ----------------------------------------------------------------------------
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),

  team_id uuid not null references public.teams (id) on delete cascade,

  -- NOT nullable, unlike firm_invitations.profile_id -- direct
  -- consequence of Decision #11/#12: a team invitation can only ever
  -- target an existing firm member, so there is no new-user/token path
  -- and profile_id is always known at creation time.
  profile_id uuid not null references public.profiles (id) on delete cascade,

  status text not null default 'pending'
    constraint team_invitations_status_check check (
      status in ('pending', 'accepted', 'revoked', 'expired')
    ),

  invited_by uuid not null references public.profiles (id) on delete cascade,

  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.team_invitations is
  'Pending/historical invitations to join a team. No email/token/role columns -- each omission traces to Decisions #11/#12 (target must already be a firm member, so only the in-app-list acceptance path ever applies; no team-level role exists per teams migration Decision #4).';

create trigger team_invitations_set_updated_at
  before update on public.team_invitations
  for each row
  execute function public.set_updated_at();

create index team_invitations_team_id_idx on public.team_invitations (team_id);
create index team_invitations_profile_id_idx on public.team_invitations (profile_id);

-- Backstops re-invite-re-issues at the DB level for teams too: at most
-- one 'pending' invitation per team+profile at a time.
create unique index team_invitations_team_profile_pending_unique
  on public.team_invitations (team_id, profile_id)
  where (status = 'pending');

-- ----------------------------------------------------------------------------
-- Row Level Security: team_invitations
-- ----------------------------------------------------------------------------
alter table public.team_invitations enable row level security;

-- The invited profile may read their own pending invite -- in-app
-- pending-list read path, same reasoning as firm_invitations_select_own.
create policy team_invitations_select_own
  on public.team_invitations
  for select
  to authenticated
  using (profile_id = auth.uid());

-- Owner/admin members of the team's PARENT FIRM may read that team's
-- invitations. Joins team_invitations -> teams -> firm_members, scoped
-- to owner/admin (not firm-wide) -- same reasoning as
-- firm_invitations_select_firm_admin above (migration header,
-- assumption H).
create policy team_invitations_select_firm_admin
  on public.team_invitations
  for select
  to authenticated
  using (
    team_id in (
      select t.id
      from public.teams t
      join public.firm_members fm on fm.firm_id = t.firm_id
      where fm.profile_id = auth.uid() and fm.role in ('owner', 'admin')
    )
  );

create policy team_invitations_select_admin
  on public.team_invitations
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for `authenticated`: creating, revoking,
-- and accepting an invitation are service-layer-only operations -- see
-- teams' own migration header, Decision #5, for the identical reasoning
-- applied to team_members writes.
-- ============================================================================
-- Migration: create_client_invitations_table
-- ============================================================================
-- Client Management. Mirrors firm_invitations' real structure
-- (20260806000000_create_invitations_tables.sql, pasted and confirmed
-- this session) as closely as the client model actually allows -- NOT a
-- byte-for-byte copy. Two deliberate deviations, both forced by real
-- differences in the underlying model, flagged explicitly:
--
--   1. `client_id` (not `email`). firm_invitations targets a bare email
--      with no pre-existing record -- the invite itself is the first
--      trace of that person. A client, per the locked Client Management
--      decision, already has a real `clients` row (created by a team
--      lead/firm admin) BEFORE any invitation is ever sent. Duplicating
--      email here would create two sources of truth for the same
--      contact info; this table instead references the existing
--      clients.id directly, and reads email from there when needed.
--
--   2. No `role` column, no dual acceptance path. firm_invitations
--      carries `role` because the inviter chooses a FirmRole at invite
--      time, and supports two acceptance paths (new-user token link, OR
--      existing-profile in-app list) because an invitee might already
--      have a profile. Neither applies here: a client's role is always
--      exactly 'client' (see auth.service.ts's DEFAULT_SIGNUP_ROLE
--      precedent -- a hardcoded single value, same shape here), and a
--      client never has a pre-existing profile before their invite (the
--      locked decision is portal-signup-only) -- so only the token-link
--      path exists, mirroring firm_invitations' new-user path alone.
--
-- Everything else mirrors firm_invitations' real, confirmed shape
-- directly: token (unique, application-generated, not a DB default,
-- same reasoning as firm_invitations.token), status four-value CHECK
-- (pending/accepted/revoked/expired), invited_by on delete cascade
-- (same explicitly-confirmed trade-off as firm_invitations -- deleting
-- an inviter's profile deletes their invitation history, not just
-- pending rows), 7-day-style expiry enforced at the application layer
-- (no DB auto-expire trigger), partial unique index backing "at most
-- one pending invite per client at a time" instead of re-erroring.
--
-- FLAGGED, NOT YET CONFIRMED: whether re-inviting a client with an
-- existing pending invite should RE-ISSUE (firm_invitations' Decision
-- #10 behavior) or something else. This migration assumes re-issue,
-- backstopped the same way (partial unique index), since no contrary
-- product decision was given and it's the direct, established
-- precedent -- flag if that's wrong.
--
-- firm_id is carried directly on this table (denormalized from
-- clients.firm_id) rather than requiring every RLS policy to join
-- through clients -- mirrors firm_invitations' own directness
-- (firm_id not null, not inferred via another table) and keeps the
-- owner/admin visibility policy below a single-table lookup, same
-- shape as firm_invitations_select_firm_admin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: client_invitations
-- ----------------------------------------------------------------------------
create table public.client_invitations (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null references public.clients (id) on delete cascade,

  -- Denormalized from clients.firm_id -- see migration header. Kept in
  -- sync only insofar as clients.firm_id is itself immutable after
  -- creation (no client-transfer-between-firms feature exists); if that
  -- ever changes, this column needs an explicit sync step.
  firm_id uuid not null references public.firms (id) on delete cascade,

  token text not null,

  status text not null default 'pending'
    constraint client_invitations_status_check check (
      status in ('pending', 'accepted', 'revoked', 'expired')
    ),

  invited_by uuid not null references public.profiles (id) on delete cascade,

  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_invitations_token_unique unique (token)
);

comment on table public.client_invitations is
  'Pending/historical portal-signup invitations for an existing clients row. Token-link acceptance only -- no dual path, no role column -- see migration header, deviations #1-#2 from firm_invitations.';

comment on column public.client_invitations.client_id is
  'References the existing clients row this invitation is for. Unlike firm_invitations, the target record always pre-exists this invite -- see migration header.';

comment on column public.client_invitations.token is
  'Raw token value, generated by the application layer at insert time -- same reasoning as firm_invitations.token. Rides in the signUpAsClient() signup URL.';

create trigger client_invitations_set_updated_at
  before update on public.client_invitations
  for each row
  execute function public.set_updated_at();

create index client_invitations_client_id_idx on public.client_invitations (client_id);
create index client_invitations_firm_id_idx on public.client_invitations (firm_id);
create index client_invitations_token_idx on public.client_invitations (token);

-- At most one 'pending' invitation per client at a time -- mirrors
-- firm_invitations_firm_email_pending_unique's re-issue backstop,
-- see migration header's flagged, unconfirmed assumption on re-invite
-- behavior.
create unique index client_invitations_client_pending_unique
  on public.client_invitations (client_id)
  where (status = 'pending');

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.client_invitations enable row level security;

-- No "select_own" policy: unlike firm_invitations, there is no
-- existing-profile acceptance path for a client to read via an
-- authenticated session before signup -- see migration header,
-- deviation #2. A client's own invitation is looked up by token via
-- the admin client inside signUpAsClient(), never through RLS.

-- Owner/admin members of the client's firm may read that firm's client
-- invitations (create/revoke/resend UI needs to list them). Scoped to
-- owner/admin specifically, not firm-wide -- mirrors
-- firm_invitations_select_firm_admin's identical reasoning (an
-- invitation is a pending administrative action, not a roster fact).
create policy client_invitations_select_firm_admin
  on public.client_invitations
  for select
  to authenticated
  using (
    firm_id in (
      select firm_id from public.firm_members
      where profile_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy client_invitations_select_admin
  on public.client_invitations
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for `authenticated`: creating, revoking,
-- and accepting a client invitation are service-layer-only operations --
-- same reasoning every other membership-changing table in this project
-- gives (firm_invitations, team_invitations, firm_members, clients).
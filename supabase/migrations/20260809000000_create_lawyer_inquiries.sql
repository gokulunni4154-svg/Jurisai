-- ============================================================================
-- Lawyer Inquiry (Contact-a-Lawyer Handoff) -- initial schema.
--
-- Creates anonymous_analysis_sessions (a pre-auth, token-keyed record of an
-- anonymous visitor's upload + analysis) and lawyer_inquiries (the inquiry
-- itself, created only after the visitor signs up and the session is
-- reattached).
--
-- FLAGGED, project-wide precedent, not independently re-confirmed this
-- migration: firm_members' real role column values. §-referenced firm-admin
-- visibility below assumes role IN ('owner', 'admin') per the "Firm
-- Admin/Employee/Lawyer" language from Phase 4 scoping -- firm_members'
-- actual migration was never pasted in this session. If the real values
-- differ, this policy's WHERE clause needs correcting, not the shape.
--
-- Storage note: neither table's rows govern object-level Storage access.
-- Anonymous uploads are written via the admin (service-role) client under
-- a new "anon/{session_token}/{document_id}/{filename}" prefix in the
-- existing legal-vault-documents bucket -- this deliberately adds no new
-- storage.objects RLS policy, since no anon-facing client write/read ever
-- happens (see PROJECT_PROGRESS / this session's chat for full rationale).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- anonymous_analysis_sessions
-- ----------------------------------------------------------------------------

create table public.anonymous_analysis_sessions (
  id uuid primary key default gen_random_uuid(),

  -- Random opaque lookup key, stored in an httpOnly cookie client-side.
  -- Deliberately NOT a JWT -- no auth claims, purely a row lookup key, so
  -- there is nothing here for RLS to trust even if a policy existed.
  session_token text not null unique,

  -- Path convention: anon/{session_token}/{document_id}/{sanitized_filename}
  -- inside the existing legal-vault-documents bucket. Written exclusively
  -- via the admin client from the anonymous upload route -- see migration
  -- header note. Not validated against any storage.objects RLS policy.
  document_storage_path text not null,

  -- Full result snapshot, same shape document_analyses.result already
  -- produces -- written exclusively server-side, same as that table.
  analysis_result jsonb not null,

  created_at timestamptz not null default now(),

  -- created_at + 7 days, enforced at the application layer (Service), not
  -- a generated column -- consistent with this project's general
  -- preference for explicit application-layer computation over DB
  -- generated columns elsewhere (flagged as a judgment call, no existing
  -- precedent either way was found in pasted source this session).
  expires_at timestamptz not null,

  -- Set once, on signup completion. Row becomes inert after this -- the
  -- lawyer_inquiries row this creates is the ongoing record, not this one.
  reattached_profile_id uuid references auth.users (id) on delete set null
);

comment on table public.anonymous_analysis_sessions is
  'Pre-auth record of an anonymous visitor''s document upload + analysis. Reattached to a real profile on signup; becomes inert (not deleted) once reattached_profile_id is set.';

create index anonymous_analysis_sessions_token_idx
  on public.anonymous_analysis_sessions (session_token);

-- Cleanup query shape ("expired, never reattached") -- no cron/job wired
-- yet, flagged as an open gap in the scoping doc, not decided here. Index
-- supports that future query without committing to its implementation.
create index anonymous_analysis_sessions_cleanup_idx
  on public.anonymous_analysis_sessions (expires_at)
  where reattached_profile_id is null;

alter table public.anonymous_analysis_sessions enable row level security;

-- Deliberately NO policies at all, for any role. Every touchpoint on this
-- table (create on anon upload, read on reattach, mark reattached) is
-- server-side, admin-client only -- there is no authenticated "owner" of
-- an anonymous session for RLS to check against in the first place. RLS
-- is still enabled (project-wide convention: every public table has RLS
-- enabled), but with zero policies it fail-closed denies all client
-- access, which is the intended behavior here, not an oversight.

-- ----------------------------------------------------------------------------
-- lawyer_inquiries
-- ----------------------------------------------------------------------------

create type lawyer_inquiry_status as enum ('pending', 'accepted', 'converted_to_case');

create table public.lawyer_inquiries (
  id uuid primary key default gen_random_uuid(),

  client_profile_id uuid not null references auth.users (id) on delete cascade,

  -- Null until a firm-routed inquiry is handed to a specific lawyer.
  -- Always set immediately when an individual lawyer (not a firm) was
  -- picked. See assigned_by/assigned_at below.
  target_profile_id uuid references auth.users (id) on delete cascade,

  -- Every inquiry belongs to a firm -- for a solo lawyer this is that
  -- lawyer's own firm-of-one, matching the existing solo-case-owner
  -- precedent from Case Access Grants (per this session's scoping doc,
  -- §4.1 -- not independently re-verified against a real firms table
  -- column for "solo firm" representation this session).
  target_firm_id uuid not null references public.firms (id) on delete cascade,

  -- The firm owner/admin who handed the inquiry to target_profile_id.
  -- Null until assignment happens; stays null entirely for the
  -- solo-lawyer case (self-assigned, no handover needed).
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,

  -- Copied from the reattached session at creation time, not referenced
  -- by pointer back to anonymous_analysis_sessions -- that row goes inert
  -- and is not a live join target going forward.
  document_storage_path text not null,
  analysis_result jsonb not null,

  -- 'declined' deliberately not in this enum -- decline is row deletion
  -- only, no stored status or audit trail for it (§4.2, resolved).
  status lawyer_inquiry_status not null default 'pending',

  case_id uuid references public.cases (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lawyer_inquiries is
  'A visitor-initiated contact request to a specific lawyer or firm, distinct from a case. Becomes a case only via an explicit conversion step (case_id set then).';

create index lawyer_inquiries_client_profile_id_idx on public.lawyer_inquiries (client_profile_id);
create index lawyer_inquiries_target_profile_id_idx on public.lawyer_inquiries (target_profile_id);
create index lawyer_inquiries_target_firm_id_idx on public.lawyer_inquiries (target_firm_id);

alter table public.lawyer_inquiries enable row level security;

create or replace function public.set_lawyer_inquiries_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lawyer_inquiries_set_updated_at
  before update on public.lawyer_inquiries
  for each row
  execute function public.set_lawyer_inquiries_updated_at();

-- Read-only RLS, mirroring document_analyses' pattern: every write
-- (create, assign, accept, convert; decline = delete) is business-logic
-- gated (notification side-effects, role checks mirroring the real
-- case-creation rule, teaser-vs-full-result shaping) and is performed
-- server-side by the Service layer, not by direct client insert/update/
-- delete -- so only SELECT policies are defined here.

create policy "lawyer_inquiries_select_client"
  on public.lawyer_inquiries for select
  to authenticated
  using (client_profile_id = auth.uid());

create policy "lawyer_inquiries_select_assigned_lawyer"
  on public.lawyer_inquiries for select
  to authenticated
  using (target_profile_id = auth.uid());

-- FLAGGED, unconfirmed role values (see migration header note): lets a
-- firm owner/admin see inquiries routed to their firm generally (not yet
-- assigned to a specific lawyer), so they have something to assign from.
create policy "lawyer_inquiries_select_firm_admin"
  on public.lawyer_inquiries for select
  to authenticated
  using (
    exists (
      select 1 from public.firm_members fm
      where fm.firm_id = lawyer_inquiries.target_firm_id
        and fm.profile_id = auth.uid()
        and fm.role in ('owner', 'admin')
    )
  );

create policy "lawyer_inquiries_select_admin"
  on public.lawyer_inquiries for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
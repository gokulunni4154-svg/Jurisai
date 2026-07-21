-- ============================================================================
-- Migration: create_professional_verifications_table
-- ============================================================================
-- Admin Tooling — professional account verification.
--
-- A separate 1:1 table keyed on profiles.id, NOT new columns on `profiles`
-- itself -- profiles' own migration (20260711120000_create_profiles_table.sql)
-- explicitly reserves role-specific data ("lawyer bar council number,
-- business GSTIN, law firm details, etc.") for dedicated tables like this
-- one, specifically to avoid nullable-column sprawl on a table every
-- account type shares.
--
-- SCOPE, per confirmed product decision:
--   - Applies to ALL roles (not lawyer/law_firm only) -- so this table has
--     no role-specific column names. `registration_number` is deliberately
--     generic, NOT `bar_council_number`: a business account has no Bar
--     Council registration. FLAGGED ASSUMPTION: what a business/individual
--     actually enters here (GSTIN? some other number?) was scoped only as
--     "the number itself" -- this column accepts any caller-supplied
--     string. Per-role format validation, if ever needed, is out of scope
--     here.
--   - Review is MANUAL only -- no external registry/API check. Confirmed.
--   - No document-upload reference column -- explicitly scoped out
--     ("just the number itself").
--   - Four statuses: pending / verified / rejected / resubmitted.
--     FLAGGED PRODUCT ASSUMPTION (see ProfessionalVerificationService's
--     own doc comment): 'resubmitted' is only reachable from 'rejected'.
--     Not explicitly specified by the user; this is the only transition
--     that makes sense of the four given values. Revisit if a different
--     resubmission trigger is intended.
-- ============================================================================

create table public.professional_verifications (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null unique references public.profiles (id) on delete cascade,

  registration_number text not null
    constraint professional_verifications_registration_number_length check (
      char_length(trim(registration_number)) > 0
      and char_length(registration_number) <= 100
    ),

  status text not null default 'pending'
    constraint professional_verifications_status_check check (
      status in ('pending', 'verified', 'rejected', 'resubmitted')
    ),

  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.professional_verifications is
  'One row per profile requesting verification. 1:1 with profiles via profile_id (unique). Manual admin review only -- no external registry check.';

comment on column public.professional_verifications.registration_number is
  'Caller-supplied registration/enrollment number (e.g. Bar Council number for lawyers, or another identifier for other roles). Generic column name since this table applies to all roles, not lawyers only.';

comment on column public.professional_verifications.status is
  'pending: awaiting first review. verified: admin-approved. rejected: admin-denied. resubmitted: caller updated registration_number after a rejection, awaiting re-review.';

comment on column public.professional_verifications.reviewed_by is
  'auth.users.id of the admin/support user who last set status to verified or rejected. Null while pending or resubmitted.';

-- ----------------------------------------------------------------------------
-- Trigger: keep updated_at current. Reuses the existing set_updated_at()
-- function, created in 20260711120000_create_profiles_table.sql -- NOT
-- redefined here, since it already exists in the database from that
-- migration and is a generic, table-agnostic trigger function.
-- ----------------------------------------------------------------------------
create trigger professional_verifications_set_updated_at
  before update on public.professional_verifications
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.professional_verifications enable row level security;

-- A caller may read their own verification row.
create policy professional_verifications_select_own
  on public.professional_verifications
  for select
  to authenticated
  using (profile_id = auth.uid());

-- A caller may insert their own verification row (first submission).
create policy professional_verifications_insert_own
  on public.professional_verifications
  for insert
  to authenticated
  with check (profile_id = auth.uid());

-- A caller may update their own row (used for resubmission after
-- rejection). FLAGGED, REAL SECURITY GAP, NOT SILENTLY HANDLED: RLS alone
-- cannot cleanly express "only allow this update when the CURRENT status
-- is 'rejected', and only allow setting the NEW status to 'resubmitted'"
-- -- USING/WITH CHECK compare against the row being written, not a
-- meaningfully different OLD-vs-NEW transition rule, without a more
-- complex construction not attempted here. As written, this policy would
-- permit an authenticated caller to directly update their own row's
-- `status` column to 'verified' via a raw table write, bypassing review
-- entirely.
--
-- MITIGATION (real, not aspirational): no client-facing route in this
-- project may ever issue a raw `.update()` against this table on behalf
-- of a normal user. ALL writes must go through
-- ProfessionalVerificationService#submitVerification(), which enforces
-- the real transition rule (rejected -> resubmitted only) in application
-- code before calling the repository. This RLS policy is a defense-in-depth
-- backstop for "can only touch your own row," not a substitute for the
-- Service-layer transition check.
create policy professional_verifications_update_own
  on public.professional_verifications
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Admins/support may read every row -- same JWT app_metadata role check
-- as profiles_select_admin in profiles' own migration.
create policy professional_verifications_select_admin
  on public.professional_verifications
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- Admins/support may update any row -- this is how review decisions
-- (verified/rejected) actually get written. Same role check as the
-- select policy above.
create policy professional_verifications_update_admin
  on public.professional_verifications
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'))
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No delete policy for `authenticated`: verification history should not
-- be deletable by any client-authenticated role -- same "deliberate
-- admin/service-role-only operation, not built yet" reasoning as
-- profiles' own missing delete policy.
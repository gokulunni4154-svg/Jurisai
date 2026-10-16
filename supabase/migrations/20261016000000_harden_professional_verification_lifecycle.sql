-- ============================================================================
-- Migration: harden_professional_verification_lifecycle
-- ============================================================================
-- Fixes the verification lifecycle end to end. Root cause of the "verified
-- lawyer missing from Find a Lawyer" bug: the `role` column added by
-- 20260810000000 was never populated by ANY write path (submit() and
-- AuthService.signUpAsLawyer() both inserted rows without it), and the
-- directory query filters on role = 'lawyer'. This migration is the
-- database half of the fix; the application half writes role on every
-- insert/resubmission (see professional-verification.service.ts and
-- auth.service.ts).
--
-- WHAT THIS DOES
--   1. Backfills `role` for existing rows ONLY from trusted data: the
--      matching auth.users.raw_app_meta_data->>'role' (the source of truth
--      for role, per the profiles migration). Rows whose role cannot be
--      established that way are left NULL and reported (RAISE NOTICE here,
--      plus supabase/tests/professional_verifications_role_audit.sql) for
--      administrative review. It does NOT infer "verified => lawyer", does
--      NOT change any status, reviewer, or timestamp, and does NOT approve
--      anything.
--   2. Creates an append-only history table. Resubmission previously
--      overwrote the rejection's reviewed_by/reviewed_at in place, losing
--      the audit trail; the archive trigger now snapshots every closed
--      (verified/rejected) decision before it is superseded.
--   3. Adds a guard trigger closing a real self-approval hole: the RLS
--      policies from 20260803000002 let any authenticated user INSERT or
--      UPDATE their own row with arbitrary column values (status
--      'verified', role 'lawyer', reviewed_by ...) using nothing but their
--      own JWT against PostgREST. RLS cannot express old-vs-new transition
--      rules, so a trigger enforces them (that migration's own comments
--      flagged this gap and relied on application code alone).
--
-- TRUST MODEL used by the guard (all taken from the verified JWT, never
-- from the row being written):
--   * trusted    : no JWT at all (migrations / direct SQL) or role claim
--                  'service_role'. Server-side admin-client code path
--                  (e.g. signUpAsLawyer) -- unrestricted, as before.
--   * staff      : app_metadata.role in ('admin','support').
--   * ordinary   : any other authenticated user.
--
-- NOT CHANGED: RLS policies, the status CHECK, the role CHECK (note it
-- intentionally has no 'client' value -- clients are not a verifiable
-- role, and the application rejects them before insert).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Safe backfill of role (trusted source only)
-- ----------------------------------------------------------------------------
-- Disable the updated_at trigger for this statement only so the backfill
-- does not rewrite updated_at on historical rows. The guard/archive
-- triggers do not exist yet at this point.
alter table public.professional_verifications
  disable trigger professional_verifications_set_updated_at;

with resolved as (
  select
    pv.id,
    u.raw_app_meta_data ->> 'role' as auth_role
  from public.professional_verifications pv
  join auth.users u on u.id = pv.profile_id
  where pv.role is null
)
update public.professional_verifications pv
set role = resolved.auth_role
from resolved
where pv.id = resolved.id
  and resolved.auth_role in ('individual', 'lawyer', 'law_firm', 'business', 'admin', 'support');

alter table public.professional_verifications
  enable trigger professional_verifications_set_updated_at;

do $$
declare
  v_unresolved integer;
  v_unresolved_verified integer;
begin
  select count(*), count(*) filter (where status = 'verified')
    into v_unresolved, v_unresolved_verified
  from public.professional_verifications
  where role is null;

  if v_unresolved > 0 then
    raise notice
      'professional_verifications: % row(s) still have role IS NULL after backfill (% with status = verified). They were NOT guessed; review them with supabase/tests/professional_verifications_role_audit.sql.',
      v_unresolved, v_unresolved_verified;
  else
    raise notice 'professional_verifications: every row has a role after backfill.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Append-only decision history
-- ----------------------------------------------------------------------------
create table public.professional_verification_history (
  id uuid primary key default gen_random_uuid(),

  verification_id uuid not null
    references public.professional_verifications (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,

  -- Snapshot of the superseded (closed) decision.
  role text,
  registration_number text not null,
  status text not null,
  reviewed_by uuid,
  reviewed_at timestamptz,

  superseded_at timestamptz not null default now(),
  superseded_by uuid
);

comment on table public.professional_verification_history is
  'Append-only snapshots of closed (verified/rejected) professional_verifications decisions, written by trigger when the live row is resubmitted or otherwise changed. Never written by clients.';

create index professional_verification_history_verification_idx
  on public.professional_verification_history (verification_id, superseded_at desc);

alter table public.professional_verification_history enable row level security;

create policy professional_verification_history_select_own
  on public.professional_verification_history
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy professional_verification_history_select_admin
  on public.professional_verification_history
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'support'));

-- No insert/update/delete policy for any client role: rows are written only
-- by the SECURITY DEFINER trigger below.

create function public.professional_verifications_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('verified', 'rejected')
     and (new.status is distinct from old.status
          or new.registration_number is distinct from old.registration_number) then
    insert into public.professional_verification_history (
      verification_id, profile_id, role, registration_number, status,
      reviewed_by, reviewed_at, superseded_by
    ) values (
      old.id, old.profile_id, old.role, old.registration_number, old.status,
      old.reviewed_by, old.reviewed_at, auth.uid()
    );
  end if;

  return new;
end;
$$;

create trigger professional_verifications_archive
  after update on public.professional_verifications
  for each row
  execute function public.professional_verifications_archive();

-- ----------------------------------------------------------------------------
-- 3. Guard: enforce the lifecycle for non-trusted callers
-- ----------------------------------------------------------------------------
create function public.professional_verifications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_jwt jsonb := auth.jwt();
  v_uid uuid := auth.uid();
  v_app_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_is_trusted boolean;
  v_is_staff boolean;
begin
  v_is_trusted := v_jwt is null or (v_jwt ->> 'role') = 'service_role';

  if v_is_trusted then
    return new;
  end if;

  v_is_staff := v_app_role in ('admin', 'support');

  -- ---------------------------------------------------------------- INSERT
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'
       or new.reviewed_by is not null
       or new.reviewed_at is not null then
      raise exception 'A new verification request must be created as pending with no review data.'
        using errcode = '42501';
    end if;

    if v_app_role is null
       or v_app_role not in ('individual', 'lawyer', 'law_firm', 'business') then
      raise exception 'Role "%" cannot submit a professional verification.', coalesce(v_app_role, '<none>')
        using errcode = '42501';
    end if;

    if new.role is not null and new.role is distinct from v_app_role then
      raise exception 'Verification role does not match the authenticated account role.'
        using errcode = '42501';
    end if;

    new.role := v_app_role;
    return new;
  end if;

  -- ---------------------------------------------------------------- UPDATE
  if new.profile_id is distinct from old.profile_id
     or new.id is distinct from old.id then
    raise exception 'profile_id and id are immutable.' using errcode = '42501';
  end if;

  if v_is_staff and old.profile_id is distinct from v_uid then
    -- Review decision by an admin/support user on someone else's row.
    if old.status not in ('pending', 'resubmitted')
       or new.status not in ('verified', 'rejected') then
      raise exception 'Only pending or resubmitted requests can be decided (verified or rejected).'
        using errcode = '42501';
    end if;

    if new.role is distinct from old.role
       or new.registration_number is distinct from old.registration_number then
      raise exception 'A review decision cannot change role or registration_number.'
        using errcode = '42501';
    end if;

    if new.status = 'verified' and old.role is null then
      raise exception 'Cannot verify a request whose role has not been established.'
        using errcode = '42501';
    end if;

    -- Trusted values, regardless of what the caller sent.
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
    return new;
  end if;

  -- Ordinary user (or staff acting on their OWN row): resubmission only.
  if old.profile_id is distinct from v_uid then
    raise exception 'Not allowed to modify another user''s verification request.'
      using errcode = '42501';
  end if;

  if old.status is distinct from 'rejected' or new.status is distinct from 'resubmitted' then
    raise exception 'A verification request can only be resubmitted from rejected status.'
      using errcode = '42501';
  end if;

  if v_app_role is null
     or v_app_role not in ('individual', 'lawyer', 'law_firm', 'business') then
    raise exception 'Role "%" cannot submit a professional verification.', coalesce(v_app_role, '<none>')
      using errcode = '42501';
  end if;

  if new.role is not null and new.role is distinct from v_app_role then
    raise exception 'Verification role does not match the authenticated account role.'
      using errcode = '42501';
  end if;

  new.role := v_app_role;
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;

create trigger professional_verifications_guard
  before insert or update on public.professional_verifications
  for each row
  execute function public.professional_verifications_guard();

comment on function public.professional_verifications_guard() is
  'Lifecycle enforcement for professional_verifications. Non-trusted callers: insert must be pending with role taken from their own JWT; update only rejected->resubmitted by the owner, or pending/resubmitted->verified/rejected by admin/support (never on their own row), with reviewed_by/reviewed_at set server-side. service_role and no-JWT callers are unrestricted.';

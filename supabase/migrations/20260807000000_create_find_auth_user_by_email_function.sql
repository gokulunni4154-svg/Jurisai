-- ============================================================================
-- Migration: create_find_auth_user_by_email_function
-- ============================================================================
-- Phase 4 — Enterprise & Collaboration, Invitation System.
--
-- Closes the gap flagged while drafting firm-invitation.service.ts's
-- createInvitation(): Decision #2 requires checking whether an invited
-- email matches an EXISTING user, but neither profile.repository.ts
-- (profiles has no email column) nor auth-user.repository.ts (Admin API's
-- listUsers() has no email filter) can answer that without either
-- breaking this project's "never query auth.users directly from TS" rule
-- or paginating the entire user base per invite. JUDGMENT CALL, made by
-- Claude at the user's explicit delegation ("u can decide") rather than a
-- product decision confirmed prior to this: a security-definer SQL
-- function keeps the "no raw auth.users access from TypeScript" rule
-- intact by moving the lookup into Postgres instead, and mirrors this
-- project's existing precedent for reaching into auth.users from a
-- function rather than a client call (see handle_new_user() on
-- 20260711120000_create_profiles_table.sql).
--
-- Returns only a uuid (or null) -- never a row, never the email back --
-- so this function cannot become an accidental user-enumeration read
-- path beyond "does this exact email exist," and callers get nothing
-- more than what they already need to decide new-user-invite vs.
-- existing-profile-invite.
--
-- `security definer` + explicit `set search_path = ''` (not left to
-- default, and not just `public`) -- standard hardening against
-- search_path-hijacking on security-definer functions; all names below
-- are schema-qualified as a result.
--
-- EXECUTE is revoked from PUBLIC and from `authenticated`/`anon`
-- explicitly, then granted to `service_role` only -- this must only ever
-- be called from FirmInvitationService via the admin.ts client, never
-- from a browser-originated request, since arbitrary client-side email
-- enumeration is exactly the risk this migration's own doc comment above
-- is trying to avoid.
-- ============================================================================

create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id
    into v_id
    from auth.users
   where lower(email) = lower(p_email)
   limit 1;

  return v_id;
end;
$$;

comment on function public.find_auth_user_id_by_email(text) is
  'Case-insensitive email lookup against auth.users, returning only the matching id or null. Added for the Invitation System (Decision #2: existing-profile vs new-user invite). security definer + revoked PUBLIC execute -- service_role (admin.ts) only. See migration header for the full judgment-call rationale.';

revoke execute on function public.find_auth_user_id_by_email(text) from public;
revoke execute on function public.find_auth_user_id_by_email(text) from authenticated;
revoke execute on function public.find_auth_user_id_by_email(text) from anon;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;
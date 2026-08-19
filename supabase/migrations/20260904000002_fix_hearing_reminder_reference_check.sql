-- ============================================================================
-- Migration: fix_hearing_reminder_reference_check
-- ============================================================================
-- RECONCILIATION MIGRATION -- Final V1 Production Readiness Verification,
-- §16/§19 (B-level finding). Production already has this exact constraint
-- live, applied out-of-band and recorded there under version
-- 20260817053344. That file was never checked into this repository and
-- has no trace in git history -- a fresh migration replay from Git alone
-- would have left `notifications_reference_by_type_check` without its
-- `hearing_reminder` branch, and the hearing-reminders cron
-- (src/app/api/cron/hearing-reminders/route.ts) would fail every insert
-- with a check-constraint violation on a fresh environment.
--
-- POSITIONING, NOT THE PRODUCTION VERSION NUMBER, DELIBERATELY: production's
-- own recorded version (20260817053344) is chronologically EARLIER than
-- 20260904000001_widen_notifications_for_hearings.sql, which is what
-- actually creates the `hearing_id` column and adds `hearing_reminder` to
-- `notifications_type_check` in the first place. Naming this file
-- 20260817053344 would place it before its own dependency in a fresh
-- replay, and the ALTER below would fail outright (unknown column
-- `hearing_id`, and `hearing_reminder` not yet a valid `type` value).
-- Same shape of problem as
-- 20260910000001_widen_case_notes_select_for_firm_managers.sql, and
-- resolved the same way that file resolved it: this migration is
-- positioned immediately after its true dependency
-- (20260904000001_widen_notifications_for_hearings.sql) rather than at
-- production's out-of-band version number, so a from-scratch replay
-- succeeds. Production is unaffected either way -- the resulting
-- constraint has been live there since the original out-of-band change,
-- under its own recorded version. This is a LOCAL, repository-only
-- reconciliation; no remote migration history was touched or repaired to
-- make this change, and this migration was NOT run against production as
-- part of creating this file.
--
-- WHAT THIS ADDS: widens notifications_reference_by_type_check (added by
-- 20260811000000_widen_notifications_for_lawyer_inquiries.sql, when only
-- two type-shapes existed) to add a third branch for `hearing_reminder`
-- -- the type 20260904000001 introduced without ever updating this
-- constraint to match. Without this branch, the reference-by-type CHECK
-- silently fell through to no matching clause for hearing_reminder rows,
-- meaning it would have REJECTED every hearing_reminder insert against a
-- freshly-replayed database (the exact scenario this file closes).
--
-- Idempotency-safe per this project's own convention elsewhere in this
-- directory (`drop constraint if exists` before `add constraint`).
-- ============================================================================

alter table public.notifications
  drop constraint if exists notifications_reference_by_type_check;

alter table public.notifications
  add constraint notifications_reference_by_type_check
    check (
      (type in ('hearing_date_set', 'hearing_date_reminder')
        and document_id is not null
        and hearing_date_snapshot is not null
        and inquiry_id is null
        and hearing_id is null)
      or
      (type = 'lawyer_inquiry_received'
        and inquiry_id is not null
        and document_id is null
        and hearing_date_snapshot is null
        and hearing_id is null)
      or
      (type = 'hearing_reminder'
        and hearing_id is not null
        and document_id is null
        and hearing_date_snapshot is null
        and inquiry_id is null)
    );

comment on constraint notifications_reference_by_type_check on public.notifications is
  'Enforces exactly the right reference column is populated per type: hearing_date_set/hearing_date_reminder requires document_id + hearing_date_snapshot; lawyer_inquiry_received requires inquiry_id; hearing_reminder requires hearing_id. Widened to add the hearing_reminder branch, which was missing since the type was introduced -- see migration header for why this file is not named after production''s own out-of-band version number.';

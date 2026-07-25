-- ============================================================================
-- Migration: widen_notifications_for_hearings
-- ============================================================================
-- Real path: supabase/migrations/20260904000001_widen_notifications_for_hearings.sql
--
-- KEY DECISION, MADE BY DELEGATION -- flagged, not silently applied.
-- The new hearings-reminder cron (see hearing.repository.ts /
-- the new cron route) needs to create a notification referencing a
-- `hearings` row. notifications.schemas.ts's real, pasted
-- createNotificationSchema.refine() only accepts two shapes today:
--   - hearing_date_set / hearing_date_reminder -> requires documentId +
--     hearingDateSnapshot, forbids inquiryId
--   - lawyer_inquiry_received -> requires inquiryId, forbids documentId
--     + hearingDateSnapshot
-- Neither shape fits a hearings-table row (there is no documentId to
-- supply). Reusing the existing 'hearing_date_reminder' type for a
-- hearings-table event would be ambiguous with its original,
-- document.hearing_date-scoped meaning and would fail the existing
-- refine (no documentId available) -- not a safe shortcut.
--
-- Resolved the same way notifications was widened once already, for
-- the identical reason (20260812000000_widen_notifications_for_lawyer_inquiries.sql
-- added inquiryId for lawyer_inquiry_received): a NEW type
-- ('hearing_reminder', distinct from the existing document-scoped
-- 'hearing_date_reminder') plus a NEW nullable hearing_id column and
-- FK. Purely additive -- does not alter the meaning or constraints of
-- either existing type.
-- ============================================================================

alter table public.notifications
  add column hearing_id uuid references public.hearings (id) on delete cascade;

comment on column public.notifications.hearing_id is
  'Set only for type = hearing_reminder. References the hearings row this reminder is about -- distinct from document_id/hearing_date_snapshot, which remain scoped to documents.hearing_date only.';

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'hearing_date_set',
      'hearing_date_reminder',
      'lawyer_inquiry_received',
      'hearing_reminder'
    )
  );

-- Same "reference must match type" intent as
-- notifications_reference_by_type_check (the application-layer
-- counterpart lives in notifications.schemas.ts's own .refine(), not
-- duplicated here as a DB constraint -- this migration follows that
-- same division, matching the project's established defense-in-depth
-- pattern rather than re-deriving it at the DB layer for every new
-- type).

create index notifications_hearing_id_idx
  on public.notifications (hearing_id)
  where hearing_id is not null;
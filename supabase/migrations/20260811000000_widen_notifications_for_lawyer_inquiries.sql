-- ============================================================================
-- Migration: widen_notifications_for_lawyer_inquiries
-- ============================================================================
-- Lawyer Inquiry (Contact-a-Lawyer Handoff) -- unblocks scoping doc §4.4
-- (lawyer notified on a new inquiry).
--
-- SCOPE CORRECTION, FLAGGED: the continuation prompt characterized this as
-- "small, mechanical... just widen the CHECK constraint." Reading the real
-- 20260725010000_create_notifications_table.sql shows that's wrong --
-- notifications is not a generic table with a type enum bolted on, it's
-- built specifically around the two hearing_date notification types, down
-- to its NOT NULL constraints:
--
--   - document_id was not null, on the assumption every notification is
--     document-scoped. A lawyer_inquiry_received notification has no
--     public.documents row to point to -- the anonymous-upload flow this
--     feature is built on writes straight to Storage via the admin client
--     and never creates a documents metadata row (confirmed this session).
--   - hearing_date_snapshot was not null, and is meaningless for a
--     lawyer-inquiry notification -- there is no hearing date involved.
--
-- Both are made nullable here rather than populated with placeholder
-- values, which would misrepresent what actually happened. A new
-- inquiry_id column is added as the lawyer-inquiry equivalent of
-- document_id -- a dedicated nullable FK, not a generic polymorphic
-- "related_entity_id" column. Deliberately not generalized: this project
-- has consistently preferred a concrete, purpose-specific column over a
-- generic one elsewhere (see e.g. the professional_verifications role-
-- column migration's reasoning for rejecting a view), and one more
-- nullable FK column is not the kind of "nullable-column sprawl" that
-- reasoning warns against.
--
-- The CHECK constraint below enforces that exactly the right reference
-- column is populated per type -- defense-in-depth at the DB layer,
-- matching this table's own existing preference for a text+check column
-- over a bare enum specifically so constraints stay easy to extend.
--
-- RLS: no new insert policy added. Per this table's own existing comment
-- on notifications_insert_own, hearing_date_reminder already establishes
-- the precedent this type needs: "no requesting user in scope... uses the
-- service-role client and bypasses RLS entirely." A lawyer_inquiry_received
-- notification is the same shape (the recipient lawyer never makes the
-- request that creates it) -- so it goes through the admin client too, not
-- a new client-facing policy. FLAGGED, NOT INDEPENDENTLY CONFIRMED THIS
-- MIGRATION: this assumes NotificationRepository.create() is invoked here
-- with the admin client specifically, consistent with session 3's finding
-- that BaseRepository.create() has no Zod gate stopping a direct call --
-- the actual call site (wherever assignInquiry()/convertInquiry()-adjacent
-- inquiry-creation logic lives) has not been pasted this session to verify
-- which client it constructs the repository with.
-- ============================================================================

alter table public.notifications
  alter column document_id drop not null;

alter table public.notifications
  alter column hearing_date_snapshot drop not null;

alter table public.notifications
  add column inquiry_id uuid references public.lawyer_inquiries (id) on delete cascade;

comment on column public.notifications.document_id is
  'Required for document-scoped notification types (hearing_date_set, hearing_date_reminder). Null for lawyer_inquiry_received, which has no public.documents row to reference -- see migration header.';

comment on column public.notifications.hearing_date_snapshot is
  'Required for document-scoped notification types (hearing_date_set, hearing_date_reminder). Null for lawyer_inquiry_received -- not applicable.';

comment on column public.notifications.inquiry_id is
  'Required for lawyer_inquiry_received. Null for every other type. The lawyer-inquiry equivalent of document_id -- see migration header for why this is a dedicated column, not a generic polymorphic reference.';

-- Widen the type vocabulary. Same text+check shape as the base migration,
-- extended rather than replaced.
alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
    check (type in ('hearing_date_set', 'hearing_date_reminder', 'lawyer_inquiry_received'));

-- New: enforce the right reference column is populated per type. This is
-- the DB-level counterpart to the nullability changes above -- without
-- it, nothing stops a hearing_date_set row from being inserted with
-- document_id left null, or a lawyer_inquiry_received row missing
-- inquiry_id.
alter table public.notifications
  add constraint notifications_reference_by_type_check
    check (
      (type in ('hearing_date_set', 'hearing_date_reminder')
        and document_id is not null
        and hearing_date_snapshot is not null
        and inquiry_id is null)
      or
      (type = 'lawyer_inquiry_received'
        and inquiry_id is not null
        and document_id is null
        and hearing_date_snapshot is null)
    );

create index notifications_inquiry_id_idx
  on public.notifications (inquiry_id)
  where inquiry_id is not null;

comment on table public.notifications is
  'In-app notifications. Three types: hearing_date_set and hearing_date_reminder (document-scoped, original scope), and lawyer_inquiry_received (inquiry-scoped, added for the Lawyer Inquiry feature -- see 20260725010000_create_notifications_table.sql for the original two and this migration for the addition). notifications_reference_by_type_check enforces the right reference column is set per type.';
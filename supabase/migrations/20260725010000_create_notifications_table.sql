-- ============================================================================
-- Creates public.notifications.
--
-- Built directly against real File 45 conventions (column naming,
-- timestamptz usage, comment style) and File 162's pdf_exports table
-- (direct user_id denormalization for ownership, text + check constraint
-- for a closed vocabulary column, partial index scoped to the query that
-- actually needs it).
--
-- SCOPE THIS MIGRATION COVERS: two notification types only --
-- 'hearing_date_set' (fired inline, same request that sets/changes
-- hearing_date) and 'hearing_date_reminder' (fired by the future Vercel
-- Cron job, 3 days before hearing_date). Modeled as text + check
-- constraint rather than a native enum, so adding a third type later is
-- a plain ALTER, not an enum-migration -- same reasoning
-- documents.sql's own comment gives for avoiding a native enum.
--
-- RESOLVES the dedup question File 174's hearing_date migration flagged
-- as unresolved and blocking the cron route's design. Chosen approach:
-- no new column on public.documents. Instead, hearing_date_snapshot
-- below records the hearing_date value a given reminder was actually
-- sent for. The cron job's dedup check becomes "does a
-- hearing_date_reminder row already exist for this document with
-- hearing_date_snapshot = the document's CURRENT hearing_date" -- if the
-- user changes hearing_date, the old snapshot no longer matches and a
-- new reminder is free to fire, with no separate reset-on-change logic
-- required (unlike the alternative hearing_date_reminder_sent_at column
-- option, which would need to be nulled out on every hearing_date
-- change). This was a delegated decision -- flagged, not silently
-- assumed -- since File 174 explicitly left it undecided.
-- ============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  -- Denormalized recipient/owner, not inferred via a join through
  -- documents -> owner_id. Same rationale as pdf_exports.user_id (File
  -- 162) and chat_conversations.user_id (File 148): RLS policies and any
  -- future BaseService.requireOwnership() guard get a bare id to check
  -- against directly.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The document this notification is about. Both current notification
  -- types are document-scoped (hearing_date lives on documents); a
  -- future non-document-scoped notification type would need this column
  -- made nullable, not removed -- not needed for the two types this
  -- migration actually covers.
  document_id uuid not null references public.documents (id) on delete cascade,

  -- Text + check constraint -- see file-level comment above. Only the
  -- two types this session's scope actually requires.
  type text not null
    check (type in ('hearing_date_set', 'hearing_date_reminder')),

  title text not null,
  message text not null,

  -- The hearing_date value this notification pertains to, captured at
  -- creation time -- NOT a live read of documents.hearing_date at query
  -- time. This is what makes the cron dedup check (see file-level
  -- comment) work without touching the documents table again.
  hearing_date_snapshot timestamptz not null,

  -- Null = unread. Set once by the recipient; this table has no other
  -- mutable state, so a single nullable timestamp is enough -- no
  -- separate boolean + timestamp pair needed.
  read_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notifications. Currently scoped to two hearing_date-related types: an immediate notification when hearing_date is set/changed, and a 3-days-before reminder fired by the future Vercel Cron job. hearing_date_snapshot resolves the dedup question flagged in the hearing_date migration -- see this file''s header comment.';

-- List-by-recipient, mirrors pdf_exports_user_id_idx (File 162).
create index notifications_user_id_idx
  on public.notifications (user_id);

-- Partial, scoped to the one query that actually needs it: the cron
-- job's dedup check, which only ever runs against
-- type = 'hearing_date_reminder' rows. Same "index only what a real
-- query matches" reasoning as documents_hearing_date_active_idx (File
-- 174) and pdf_exports' indexes.
create index notifications_reminder_dedup_idx
  on public.notifications (document_id, hearing_date_snapshot)
  where type = 'hearing_date_reminder';

alter table public.notifications enable row level security;

-- Direct ownership via user_id, same pattern as pdf_exports. Insert is
-- permitted for the owning user because the 'hearing_date_set'
-- notification is created inline, in the same request that updates
-- hearing_date, via the RLS-respecting server.ts client acting as the
-- requesting user -- same convention every other write in this project
-- follows. The 'hearing_date_reminder' type is instead created by the
-- future Vercel Cron job with no requesting user in scope, which is
-- exactly the case admin.ts's own header documents itself for -- that
-- path uses the service-role client and bypasses RLS entirely, so it
-- needs no policy here.
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "notifications_insert_own"
  on public.notifications for insert
  to authenticated
  with check (user_id = auth.uid());

-- Update permitted only so a user can mark their own notification read
-- (read_at). No other field is expected to change after creation.
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy -- same omission rationale as pdf_exports: nothing
-- in scope calls for users to delete a notification record. Omitted
-- deliberately, revisit if requested.

-- Admin select -- mirrors documents.sql's, legal-vault-documents', and
-- pdf_exports' identical pattern. Same extrapolation flag as those:
-- consistent with established convention, not something explicitly
-- requested for this table specifically.
create policy "notifications_select_admin"
  on public.notifications for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
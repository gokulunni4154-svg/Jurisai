-- ============================================================================
-- Adds hearing_date to public.documents.
--
-- Built directly against File 45's real, pasted migration
-- (20260712070007_create_documents_table.sql) — column naming
-- (snake_case), timestamptz type (matching created_at/updated_at/
-- deleted_at, all timestamptz, none plain date), and comment style all
-- follow that file's real conventions rather than being guessed.
--
-- No RLS changes needed: File 45's documents_update_own policy already
-- permits an owner to UPDATE any column on their own row, including this
-- new one. Confirmed from File 45's real policy text, not assumed.
-- ============================================================================

alter table public.documents
  add column hearing_date timestamptz;

comment on column public.documents.hearing_date is
  'Optional court/hearing date associated with this document. Nullable — most documents will never have one. Setting or changing this value is expected to trigger an immediate Notification (future Notifications module) and a scheduled reminder 3 days beforehand, via a separate Vercel Cron job — this migration only adds the column itself, no trigger or scheduling logic lives in the database.';

-- Partial index: mirrors File 45's own reasoning for
-- documents_owner_id_active_idx (index only the rows a real query will
-- actually match). The Vercel Cron job's daily query is expected to be
-- "documents with hearing_date within the reminder window, not yet
-- soft-deleted" — a small, sparse subset of all rows, since most
-- documents will have a null hearing_date. Indexing only non-null,
-- non-deleted rows keeps that query cheap without bloating the index
-- with rows it will never match.
create index documents_hearing_date_active_idx
  on public.documents (hearing_date)
  where hearing_date is not null and deleted_at is null;

-- FLAGGED, NOT SILENTLY ASSUMED: this migration does not add a
-- hearing_date_reminder_sent_at (or equivalent) column. The Vercel Cron
-- job (not yet built) will need SOME way to avoid re-notifying every day
-- once a document enters the 3-day reminder window — either a new column
-- here, or a query against the Notifications table itself (e.g. "does a
-- reminder notification already exist for this document's current
-- hearing_date"). Deferred to the Notifications module / cron route's
-- own design, not decided here, since it depends on that module's real
-- schema, which doesn't exist yet.
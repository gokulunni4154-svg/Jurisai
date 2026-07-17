-- File 162 — JurisAI PDF Export module
-- Migration: pdf_exports table + legal-vault-exports Storage bucket
--
-- Scoped per user decision this session: exports contain exactly what's
-- currently shown on the single-document analysis view (Clause
-- Classification + Legal Health Score), persisted to Storage so a
-- completed export is re-downloadable without regenerating.
--
-- FK anchoring: document_analysis_id, matching every Phase 2 pipeline
-- module's single-document-analysis scope (Clause Classification, Risk
-- Detection, Missing Clause Detection, Compliance Detection, AI
-- Recommendation Engine, Legal Health Score) and File 148's identical
-- choice for chat_conversations.
--
-- ASSUMPTION, FLAGGED NOT INDEPENDENTLY VERIFIED — status modeled as
-- text + check constraint, NOT a native Postgres enum. This follows
-- 20260712070007_create_documents_table.sql's explicit, stated reasoning
-- (an abandoned reused Supabase project left a stray
-- document_status_enum that already caused one real naming collision —
-- see that migration's own comment and File 25's amendment). File 63's
-- and File 132's real migration text were not pasted this session, only
-- their entity files — this assumes they followed the same lesson
-- rather than independently confirming it.
--
-- NO updated_at COLUMN OR TRIGGER — this is a pipeline/job table, not a
-- metadata table. Matches document_analyses' and legal_health_scores'
-- entity shape (created_at + completed_at only, no updated_at), not
-- documents.sql's pattern (which has both, plus a trigger). Every
-- lifecycle transition here is a one-way move forward
-- (pending -> processing -> completed/failed), same as those two
-- tables — nothing about this row is ever edited outside that
-- transition.

-- ============================================================================
-- Storage bucket
-- ============================================================================

-- Private bucket, same non-negotiable reasoning as legal-vault-documents:
-- generated exports contain the same sensitive legal content as the
-- source document, just recomposed — there is no scenario where
-- public = true is acceptable here either.
--
-- file_size_limit: 10 MiB (10485760 bytes) — JUDGMENT CALL, not sourced
-- from any real constraint. Generated PDFs (Clause Classification +
-- Legal Health Score data) are expected to be far smaller than the
-- 25 MiB original-upload limit, but this number itself is a guess, not
-- a measured figure. Revisit if a real export ever approaches it.
--
-- allowed_mime_types: application/pdf only — this bucket exists
-- exclusively for this module's generated output, unlike
-- legal-vault-documents' multi-format original-upload list.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'legal-vault-exports',
  'legal-vault-exports',
  false,
  10485760, -- 10 MiB, judgment call — see comment above
  array['application/pdf']
);

-- Path convention: "{user_id}/{pdf_export_id}/{filename}.pdf" — identical
-- structure to legal-vault-documents' "{owner_id}/{document_id}/{filename}"
-- convention (document-upload.ts), so storage.foldername(name)[1] =
-- auth.uid()::text works identically here. Enforced by application code
-- at write time, not the database, same as the original bucket.
--
-- Written server-side via the RLS-respecting server.ts client (File 14),
-- acting AS the requesting user — NEVER admin.ts. admin.ts's own header
-- is explicit that it's for contexts with no requesting user in scope
-- (background jobs, webhooks, admin actions); this route always has a
-- real logged-in user, which is exactly the case admin.ts says to use
-- server.ts for instead. This is why these policies are written for the
-- `authenticated` role acting as its own uid, identical in shape to
-- legal-vault-documents' — not a service-role bypass.

create policy "legal_vault_exports_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legal-vault-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "legal_vault_exports_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'legal-vault-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "legal_vault_exports_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'legal-vault-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'legal-vault-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "legal_vault_exports_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'legal-vault-exports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin read access — mirrors legal-vault-documents' identical policy
-- exactly (role read from auth.jwt()'s app_metadata claim, never a
-- client-writable table). Added for consistency with the established
-- pattern, not because this session's scope explicitly asked for admin
-- access to exports — flagged as an extrapolation, not a stated
-- requirement.
create policy "legal_vault_exports_select_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legal-vault-exports'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ============================================================================
-- pdf_exports table
-- ============================================================================

create table public.pdf_exports (
  id uuid primary key default gen_random_uuid(),

  document_analysis_id uuid not null references public.document_analyses (id) on delete cascade,

  -- Denormalized, not inferred via a join through document_analyses ->
  -- documents -> owner_id. Same rationale as chat_conversations.user_id
  -- (File 148): BaseService.requireOwnership() and this table's own RLS
  -- policies below get a bare id to check against directly, without an
  -- extra join on every guard call or every policy evaluation.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Text + check constraint, not a native enum — see file-level ASSUMPTION
  -- comment above. Same four-value lifecycle vocabulary as document_analyses,
  -- ocr_extractions, and legal_health_scores: pending (row created) ->
  -- processing (PDF generation in flight) -> completed (stored, storage_path
  -- populated) / failed (error_message populated).
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),

  -- Null until status = 'completed'. Must exactly match the object's real
  -- path in the legal-vault-exports bucket, same guarantee
  -- documents.storage_path already provides for the original bucket.
  storage_path text,

  -- User-safe failure message, same USER_SAFE_FAILURE_MESSAGES convention
  -- every AI-pipeline service already follows (File 65, File 136, etc.) —
  -- populated by the Service layer, not this migration.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.pdf_exports is
  'Generated PDF exports of a document analysis (Clause Classification + Legal Health Score). Physical files live in the legal-vault-exports Storage bucket at pdf_exports.storage_path once status = completed.';

create index pdf_exports_document_analysis_id_idx
  on public.pdf_exports (document_analysis_id);

create index pdf_exports_user_id_idx
  on public.pdf_exports (user_id);

alter table public.pdf_exports enable row level security;

-- Direct ownership via user_id — same pattern as chat_conversations
-- (File 148), not documents.sql's owner_id-with-join pattern, since this
-- table already denormalizes user_id for exactly that reason.
--
-- No DELETE policy — unlike documents.sql (which deliberately keeps a
-- hard-delete capability for a future "permanently delete" action on
-- user-uploaded originals), nothing in this session's scope calls for
-- users to delete a generated export record. Omitted deliberately, not
-- overlooked; revisit if that UX is ever requested.

create policy "pdf_exports_select_own"
  on public.pdf_exports for select
  to authenticated
  using (user_id = auth.uid());

create policy "pdf_exports_insert_own"
  on public.pdf_exports for insert
  to authenticated
  with check (user_id = auth.uid());

-- UPDATE policy required — unlike a plain insert-then-read table, this
-- row is mutated in place through its lifecycle (pending -> processing ->
-- completed/failed) via the Repository's transition methods (mirroring
-- File 64's markProcessing/markCompleted/markFailed pattern), all
-- executed as the owning user via the RLS-respecting server.ts client.
create policy "pdf_exports_update_own"
  on public.pdf_exports for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admin select — mirrors documents.sql's and legal-vault-documents'
-- identical pattern. Same extrapolation flag as the bucket's admin
-- policy above: consistent with established convention, not an
-- explicitly stated requirement this session.
create policy "pdf_exports_select_admin"
  on public.pdf_exports for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
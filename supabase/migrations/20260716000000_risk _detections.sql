-- ============================================================================
-- File 100 — risk_detections
--
-- First table of the Risk Detection Engine, the next module in the Phase 2
-- pipeline (Clause Classification -> Risk Detection -> Missing Clause
-- Detection -> Compliance Detection -> Health Score). Follows
-- clause_classifications' (File 92 Amendment 1) established shape exactly:
-- a standalone derived-data table pointing back to its source analysis via
-- a single FK, RLS enforced by walking that FK chain, no owner_id column
-- duplicated onto this table.
--
-- KEY DECISION — document_analysis_id is the FK, not clause_classification_id.
-- The constitution's roadmap states Risk Detection "consumes Document
-- Analysis output and Clause Classification output" (both), not that it is
-- scoped beneath a single classification run. Anchoring the FK on
-- document_analysis_id — the same anchor clause_classifications itself
-- uses — keeps Risk Detection a sibling of Clause Classification under the
-- same analysis, rather than a child nested beneath one specific
-- classification row. This matters concretely: clause_classifications
-- supports multiple rows per document_analysis_id over time (independent
-- re-classification, per File 92's own comment) — nesting risk_detections
-- under clause_classification_id would force every re-classification to
-- also imply a specific, single "current" classification to hang risk
-- detection off of, which the schema doesn't otherwise establish. The
-- Service layer (not yet built) is expected to read the latest completed
-- clause_classifications row for the same document_analysis_id at
-- run-time, the same way ClauseClassificationService itself reads OCR
-- text via getLatestCompletedExtractionForDocument() rather than a FK.
--
-- KEY DECISION — write policies (insert/update) are included in THIS
-- migration, not deferred to a follow-up amendment. document_analyses,
-- ocr_extractions, and clause_classifications all originally shipped
-- "writes are service-role-only by design" with no client-facing
-- insert/update policy, then required a corrective migration
-- (20260715055158_add_write_policies_to_ai_pipeline_tables.sql) once it
-- was confirmed none of those services actually use admin.ts. Risk
-- Detection's factory/service are expected to follow the identical
-- "never admin.ts, always the RLS-respecting createClient()" convention
-- documented in clause-classification.factory.ts — so the same gap would
-- reopen here if writes were deferred again. Policies below are copied
-- from that corrective migration's clause_classifications_insert_owner /
-- _update_owner shape verbatim (same two-hop join), not reinvented.
-- ============================================================================

create type risk_detection_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.risk_detections (
  id uuid primary key default gen_random_uuid(),

  -- FK back to the analysis this risk detection run was derived from.
  -- ON DELETE CASCADE mirrors clause_classifications.document_analysis_id's
  -- identical FK — derived data dies with its source, consistently at
  -- every layer of this pipeline. See KEY DECISION above for why this
  -- points at document_analyses rather than clause_classifications.
  document_analysis_id uuid not null
    references public.document_analyses(id)
    on delete cascade,

  status risk_detection_status not null default 'pending',

  -- Structured risk-detection output (flagged clauses, risk category,
  -- severity, missing/illegal/one-sided/compliance/financial/negotiation
  -- flags, dangerous obligations — per the constitution's roadmap for
  -- this module). Shape enforced at the application layer via a Zod
  -- schema passed to generateWithFallback(), never written here
  -- unvalidated — identical convention to clause_classifications.result.
  -- Not yet built: risk-detection.schemas.ts (next file in this module).
  result jsonb,

  -- Reuses the real ai_provider_name enum from document_analyses'
  -- migration (File 61-era) — same domain concept as
  -- clause_classifications.provider_used, correct to reuse here too.
  provider_used ai_provider_name,

  -- Client-safe message only if status = 'failed', never raw provider
  -- error detail — same convention as document_analyses.error_message
  -- and clause_classifications.error_message.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Not unique: mirrors clause_classifications_document_analysis_id_idx's
-- reasoning exactly — independent re-runs of risk detection against the
-- same analysis are valid over time, so multiple rows per
-- document_analysis_id are expected, not an anomaly this index should
-- constrain against.
create index risk_detections_document_analysis_id_idx
  on public.risk_detections (document_analysis_id);

create index risk_detections_status_idx
  on public.risk_detections (status);

alter table public.risk_detections enable row level security;

-- Reads: mirrors clause_classifications_select_owner's exact join shape —
-- risk_detections -> document_analyses -> documents.owner_id = auth.uid().
-- Same one-hop-further-than-clause_classifications reasoning does not
-- apply here since both tables sit at the same depth (siblings under
-- document_analyses, per KEY DECISION above), so the join is identical in
-- shape, not one level deeper.
create policy risk_detections_select_owner
  on public.risk_detections
  for select
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = risk_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

-- Writes: included from the start — see KEY DECISION above. Shape copied
-- verbatim from clause_classifications_insert_owner /
-- clause_classifications_update_owner in
-- 20260715055158_add_write_policies_to_ai_pipeline_tables.sql, since
-- risk_detections' FK chain to documents.owner_id is identical in depth
-- and shape to clause_classifications'.
create policy risk_detections_insert_owner
  on public.risk_detections
  for insert
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = risk_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

create policy risk_detections_update_owner
  on public.risk_detections
  for update
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = risk_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = risk_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );
-- ============================================================================
-- File 108 — missing_clause_detections
--
-- First table of the Missing Clause Detection module, the next module in
-- the Phase 2 pipeline (Clause Classification -> Risk Detection -> Missing
-- Clause Detection -> Compliance Detection -> Health Score). Follows
-- risk_detections' (File 100) established shape exactly: a standalone
-- derived-data table pointing back to its source analysis via a single FK,
-- RLS enforced by walking that FK chain, no owner_id column duplicated
-- onto this table.
--
-- KEY DECISION — document_analysis_id is the FK, not clause_classification_id
-- or risk_detection_id. Same reasoning as File 100's identical KEY
-- DECISION, applied one module further down the pipeline: Missing Clause
-- Detection is a sibling of Clause Classification and Risk Detection under
-- the same analysis, not a child nested beneath one specific upstream run.
-- clause_classifications supports multiple rows per document_analysis_id
-- over time (independent re-classification) and risk_detections mirrors
-- that same non-uniqueness — nesting missing_clause_detections under
-- either one would force this module to pick a single "current" upstream
-- row to hang off of, which neither upstream table's schema establishes.
-- The Service layer (not yet built) is expected to read the latest
-- completed clause_classifications row for the same document_analysis_id
-- at run-time, the same way RiskDetectionService itself reads it via
-- ClauseClassificationService#getLatestCompletedClassificationForAnalysis()
-- rather than a FK.
--
-- KEY DECISION — write policies (insert/update) are included in THIS
-- migration, not deferred to a follow-up amendment. document_analyses,
-- ocr_extractions, and clause_classifications all originally shipped
-- "writes are service-role-only by design" with no client-facing
-- insert/update policy, then required a corrective migration
-- (20260715055158_add_write_policies_to_ai_pipeline_tables.sql) once it
-- was confirmed none of those services actually use admin.ts.
-- risk_detections (File 100) already broke that pattern by including
-- write policies from the start; this migration continues that corrected
-- convention rather than reopening the same gap a third time. Policies
-- below are copied verbatim in shape from risk_detections_insert_owner /
-- risk_detections_update_owner, since missing_clause_detections' FK chain
-- to documents.owner_id is identical in depth and shape.
-- ============================================================================

create type missing_clause_detection_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.missing_clause_detections (
  id uuid primary key default gen_random_uuid(),

  -- FK back to the analysis this missing-clause detection run was derived
  -- from. ON DELETE CASCADE mirrors risk_detections.document_analysis_id's
  -- identical FK — derived data dies with its source, consistently at
  -- every layer of this pipeline. See KEY DECISION above for why this
  -- points at document_analyses rather than clause_classifications or
  -- risk_detections.
  document_analysis_id uuid not null
    references public.document_analyses(id)
    on delete cascade,

  status missing_clause_detection_status not null default 'pending',

  -- Structured missing-clause output (which clause categories are absent,
  -- why each is expected for this document type, severity/importance of
  -- the gap). Shape enforced at the application layer via a Zod schema
  -- passed to generateWithFallback(), never written here unvalidated —
  -- identical convention to risk_detections.result and
  -- clause_classifications.result. Not yet built:
  -- missing-clause-detection.schemas.ts (next file in this module).
  result jsonb,

  -- Reuses the real ai_provider_name enum from document_analyses'
  -- migration — same domain concept as risk_detections.provider_used and
  -- clause_classifications.provider_used, correct to reuse here too.
  provider_used ai_provider_name,

  -- Client-safe message only if status = 'failed', never raw provider
  -- error detail — same convention as risk_detections.error_message and
  -- clause_classifications.error_message.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Not unique: mirrors risk_detections_document_analysis_id_idx's
-- reasoning exactly — independent re-runs of missing-clause detection
-- against the same analysis are valid over time, so multiple rows per
-- document_analysis_id are expected, not an anomaly this index should
-- constrain against.
create index missing_clause_detections_document_analysis_id_idx
  on public.missing_clause_detections (document_analysis_id);

create index missing_clause_detections_status_idx
  on public.missing_clause_detections (status);

alter table public.missing_clause_detections enable row level security;

-- Reads: mirrors risk_detections_select_owner's exact join shape —
-- missing_clause_detections -> document_analyses -> documents.owner_id =
-- auth.uid(). Same depth as risk_detections and clause_classifications,
-- since all three sit as siblings under document_analyses per KEY
-- DECISION above.
create policy missing_clause_detections_select_owner
  on public.missing_clause_detections
  for select
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = missing_clause_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

-- Writes: included from the start — see KEY DECISION above. Shape copied
-- verbatim from risk_detections_insert_owner / risk_detections_update_owner,
-- since missing_clause_detections' FK chain to documents.owner_id is
-- identical in depth and shape to risk_detections'.
create policy missing_clause_detections_insert_owner
  on public.missing_clause_detections
  for insert
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = missing_clause_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

create policy missing_clause_detections_update_owner
  on public.missing_clause_detections
  for update
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = missing_clause_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = missing_clause_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );
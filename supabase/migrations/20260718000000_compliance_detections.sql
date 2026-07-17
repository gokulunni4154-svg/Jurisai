-- ============================================================================
-- File 116 — compliance_detections
--
-- First table of the Compliance Detection module, the next module in the
-- Phase 2 pipeline (Clause Classification -> Risk Detection -> Missing
-- Clause Detection -> Compliance Detection -> AI Recommendation Engine).
-- Follows missing_clause_detections' (File 108) established shape exactly:
-- a standalone derived-data table pointing back to its source analysis via
-- a single FK, RLS enforced by walking that FK chain, no owner_id column
-- duplicated onto this table.
--
-- KEY DECISION — document_analysis_id is the FK, not risk_detection_id or
-- missing_clause_detection_id. Same reasoning as File 100's and File 108's
-- identical KEY DECISION, applied one module further down the pipeline:
-- Compliance Detection is a sibling of Clause Classification, Risk
-- Detection, and Missing Clause Detection under the same analysis, not a
-- child nested beneath one specific upstream run. All three upstream
-- tables permit multiple rows per document_analysis_id over time
-- (independent re-runs) — nesting compliance_detections under any one of
-- them would force this module to pick a single "current" upstream row to
-- hang off of, which none of their schemas establish. The Service layer
-- (not yet built) is expected to read whichever upstream signal it needs
-- at run-time via the equivalent latest-completed-row helper method, the
-- same way every module before it has, rather than a FK.
--
-- KEY DECISION — write policies (insert/update) are included in THIS
-- migration, not deferred to a follow-up amendment. risk_detections
-- (File 100) and missing_clause_detections (File 108) both already
-- shipped write policies from the start, correcting the original gap in
-- document_analyses/ocr_extractions/clause_classifications. This
-- migration continues that convention a third time rather than reopening
-- it. Policies below are copied verbatim in shape from
-- missing_clause_detections_insert_owner / _update_owner, since this
-- table's FK chain to documents.owner_id is identical in depth and shape.
--
-- KEY DECISION — no Postgres-level enum for the compliance
-- framework/category taxonomy (Contract Act, stamp duty, sector-specific
-- frameworks by document type). Per-flag vocabularies in every upstream
-- module (ClauseCategory, RiskSeverity, MissingClauseImportance) are Zod
-- enums validated at the application layer before being written into the
-- untyped `result` column below, never Postgres enums. Compliance
-- Detection follows that same convention: the fixed
-- ComplianceFramework/ComplianceCategory enum lives in
-- compliance-detection.schemas.ts (File 117), not here, so it can be
-- extended later via a code change rather than a schema migration.
-- ============================================================================

create type compliance_detection_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.compliance_detections (
  id uuid primary key default gen_random_uuid(),

  -- FK back to the analysis this compliance detection run was derived
  -- from. ON DELETE CASCADE mirrors missing_clause_detections' identical
  -- FK — derived data dies with its source, consistently at every layer
  -- of this pipeline. See KEY DECISION above for why this points at
  -- document_analyses rather than any upstream module's own table.
  document_analysis_id uuid not null
    references public.document_analyses(id)
    on delete cascade,

  status compliance_detection_status not null default 'pending',

  -- Structured compliance-detection output (flagged compliance gaps,
  -- framework, category, severity/importance, and any other shape defined
  -- by compliance-detection.schemas.ts). Shape enforced at the
  -- application layer via a Zod schema passed to generateWithFallback(),
  -- never written here unvalidated — identical convention to
  -- missing_clause_detections.result and risk_detections.result. Not yet
  -- built: compliance-detection.schemas.ts (next file in this module).
  result jsonb,

  -- Reuses the real ai_provider_name enum from document_analyses'
  -- migration — same domain concept as missing_clause_detections
  -- .provider_used and risk_detections.provider_used, correct to reuse
  -- here too.
  provider_used ai_provider_name,

  -- Client-safe message only if status = 'failed', never raw provider
  -- error detail — same convention as missing_clause_detections
  -- .error_message and risk_detections.error_message.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Not unique: mirrors missing_clause_detections_document_analysis_id_idx's
-- reasoning exactly — independent re-runs of compliance detection against
-- the same analysis are valid over time, so multiple rows per
-- document_analysis_id are expected, not an anomaly this index should
-- constrain against.
create index compliance_detections_document_analysis_id_idx
  on public.compliance_detections (document_analysis_id);

create index compliance_detections_status_idx
  on public.compliance_detections (status);

alter table public.compliance_detections enable row level security;

-- Reads: mirrors missing_clause_detections_select_owner's exact join
-- shape — compliance_detections -> document_analyses -> documents
-- .owner_id = auth.uid(). Same depth as risk_detections and
-- missing_clause_detections, since all four modules sit as siblings under
-- document_analyses per KEY DECISION above.
create policy compliance_detections_select_owner
  on public.compliance_detections
  for select
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = compliance_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

-- Writes: included from the start — see KEY DECISION above. Shape copied
-- verbatim from missing_clause_detections_insert_owner /
-- _update_owner, since compliance_detections' FK chain to
-- documents.owner_id is identical in depth and shape.
create policy compliance_detections_insert_owner
  on public.compliance_detections
  for insert
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = compliance_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

create policy compliance_detections_update_owner
  on public.compliance_detections
  for update
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = compliance_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = compliance_detections.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );
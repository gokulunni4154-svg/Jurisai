-- ============================================================================
-- File 124 — ai_recommendations
--
-- First table of the AI Recommendation Engine, the next module in the
-- Phase 2 pipeline (Clause Classification -> Risk Detection -> Missing
-- Clause Detection -> Compliance Detection -> AI Recommendation Engine ->
-- Legal Health Score Engine). Follows compliance_detections' (File 116)
-- established shape exactly: a standalone derived-data table pointing back
-- to its source analysis via a single FK, RLS enforced by walking that FK
-- chain, no owner_id column duplicated onto this table.
--
-- KEY DECISION — document_analysis_id is the FK, not risk_detection_id,
-- missing_clause_detection_id, compliance_detection_id, or
-- clause_classification_id. Same reasoning as Files 100, 108, and 116's
-- identical KEY DECISION, applied one module further down the pipeline:
-- AI Recommendation Engine is a sibling of all four upstream modules under
-- the same analysis, not a child nested beneath any one specific upstream
-- run. All four upstream tables permit multiple rows per
-- document_analysis_id over time (independent re-runs) — nesting
-- ai_recommendations under any one of them would force this module to pick
-- a single "current" upstream row to hang off of, which none of their
-- schemas establish. The Service layer (not yet built) is expected to read
-- whichever upstream signals it needs at run-time via each module's
-- latest-completed-row helper method (mirroring
-- ClauseClassificationService#getLatestCompletedClassificationForAnalysis()
-- and its three later equivalents), the same way every module before it
-- has, rather than a FK.
--
-- CONSEQUENCE, stated explicitly rather than left implicit: this means a
-- completed ai_recommendations row does not itself record which specific
-- upstream detection rows it was derived from — only that each upstream
-- module's latest-completed row, at generation time, was used. Consistent
-- with every prior module's identical assumption; not re-litigated here.
--
-- KEY DECISION — write policies (insert/update) are included in THIS
-- migration, not deferred to a follow-up amendment. risk_detections
-- (File 100), missing_clause_detections (File 108), and
-- compliance_detections (File 116) all shipped write policies from the
-- start, correcting the original gap in
-- document_analyses/ocr_extractions/clause_classifications. This migration
-- continues that convention a fourth time rather than reopening it.
-- Policies below are copied verbatim in shape from
-- compliance_detections_insert_owner / _update_owner, since this table's FK
-- chain to documents.owner_id is identical in depth and shape.
--
-- KEY DECISION — no Postgres-level enum for recommendation
-- type/category/priority taxonomy. Per-flag vocabularies in every upstream
-- module (ClauseCategory, RiskSeverity, MissingClauseImportance,
-- ComplianceFramework/ComplianceSeverity) are Zod enums validated at the
-- application layer before being written into the untyped `result` column
-- below, never Postgres enums. AI Recommendation Engine follows that same
-- convention: whatever recommendation taxonomy File 125 defines lives
-- there, not here, so it can be extended later via a code change rather
-- than a schema migration.
-- ============================================================================

create type ai_recommendation_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),

  -- FK back to the analysis this recommendation set was derived from.
  -- ON DELETE CASCADE mirrors compliance_detections.document_analysis_id's
  -- identical FK — derived data dies with its source, consistently at
  -- every layer of this pipeline. See KEY DECISION above for why this
  -- points at document_analyses rather than any upstream module's own
  -- table.
  document_analysis_id uuid not null
    references public.document_analyses(id)
    on delete cascade,

  status ai_recommendation_status not null default 'pending',

  -- Structured recommendation output (synthesized, prioritized
  -- recommendations drawn from Clause Classification, Risk Detection,
  -- Missing Clause Detection, and Compliance Detection). Shape enforced at
  -- the application layer via a Zod schema passed to
  -- generateWithFallback(), never written here unvalidated — identical
  -- convention to compliance_detections.result and every prior module's
  -- result column. Not yet built: ai-recommendation.schemas.ts (next file
  -- in this module).
  result jsonb,

  -- Reuses the real ai_provider_name enum from document_analyses'
  -- migration — same domain concept as compliance_detections.provider_used
  -- and every prior module's provider_used, correct to reuse here too.
  provider_used ai_provider_name,

  -- Client-safe message only if status = 'failed', never raw provider
  -- error detail — same convention as compliance_detections.error_message
  -- and every prior module's error_message.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Not unique: mirrors compliance_detections_document_analysis_id_idx's
-- reasoning exactly — independent re-runs of the recommendation engine
-- against the same analysis are valid over time (e.g. after upstream
-- modules re-run), so multiple rows per document_analysis_id are expected,
-- not an anomaly this index should constrain against.
create index ai_recommendations_document_analysis_id_idx
  on public.ai_recommendations (document_analysis_id);

create index ai_recommendations_status_idx
  on public.ai_recommendations (status);

alter table public.ai_recommendations enable row level security;

-- Reads: mirrors compliance_detections_select_owner's exact join shape —
-- ai_recommendations -> document_analyses -> documents.owner_id =
-- auth.uid(). Same depth as risk_detections, missing_clause_detections,
-- and compliance_detections, since all five modules (incl. clause
-- classification) sit as siblings under document_analyses per KEY DECISION
-- above.
create policy ai_recommendations_select_owner
  on public.ai_recommendations
  for select
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = ai_recommendations.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

-- Writes: included from the start — see KEY DECISION above. Shape copied
-- verbatim from compliance_detections_insert_owner / _update_owner, since
-- ai_recommendations' FK chain to documents.owner_id is identical in depth
-- and shape.
create policy ai_recommendations_insert_owner
  on public.ai_recommendations
  for insert
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = ai_recommendations.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

create policy ai_recommendations_update_owner
  on public.ai_recommendations
  for update
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = ai_recommendations.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = ai_recommendations.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );
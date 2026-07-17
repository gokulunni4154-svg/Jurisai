-- ============================================================================
-- File 132 — legal_health_scores
--
-- First table of the Legal Health Score Engine, the sixth module in the
-- Phase 2 pipeline (Clause Classification -> Risk Detection -> Missing
-- Clause Detection -> Compliance Detection -> AI Recommendation Engine ->
-- Legal Health Score Engine). Follows ai_recommendations' (File 124)
-- established shape for FK-anchoring, RLS, and write-policy placement, but
-- deliberately departs from every prior module in one respect: see KEY
-- DECISION on overall_score / category_scores below.
--
-- SCOPING CONFIRMED WITH THE USER BEFORE THIS FILE:
--   1. Input scope: all five upstream modules (Clause Classification, Risk
--      Detection, Missing Clause Detection, Compliance Detection, AI
--      Recommendation Engine) feed this module. Chosen because each of the
--      four confirmed sub-scores below maps to at least one upstream
--      module, with no orphaned input and no unsupported sub-score.
--   2. Output shape: composite — four category sub-scores (risk,
--      compliance, completeness, negotiation leverage) plus one overall
--      score, not a single number alone and not sub-scores alone.
--   3. Recalculation semantics: immutable snapshot per run, matching the
--      create/run/list pattern every prior module already uses. Re-running
--      this engine (e.g. after any upstream module re-runs) produces a new
--      row; existing rows are never mutated back to 'pending' or
--      recomputed in place.
--
-- KEY DECISION — document_analysis_id is the FK, not any of the five
-- upstream modules' own tables. Identical reasoning to Files 100, 108,
-- 116, and 124's KEY DECISION, applied one module further down the
-- pipeline: Legal Health Score is a sibling of all five upstream modules
-- under the same analysis, not a child nested beneath one specific
-- upstream run. The Service layer (not yet built) is expected to read
-- each upstream module's latest-completed row at generation time via each
-- module's existing getLatestCompleted*ForAnalysis() helper, the same way
-- every module since Risk Detection has, rather than a FK.
--
-- KEY DECISION, DEPARTS FROM EVERY PRIOR MODULE — overall_score is a
-- first-class integer column, not buried inside the jsonb result column.
-- Every module through File 124 stores its full output as opaque jsonb
-- because every prior output is a list of discrete flags — nothing
-- benefits from being queried as a scalar. Legal Health Score's defining
-- output is a single sortable/filterable number (dashboards, "worst
-- scoring documents", threshold alerting), so it is promoted to a real
-- column with a dedicated index (see below) rather than requiring a jsonb
-- path expression for every such query.
--
-- TRADE-OFF, stated explicitly: overall_score duplicates the same number
-- also present inside result.overallScore. Both are written in the same
-- INSERT/UPDATE by the Service layer (not yet built), so there is no
-- split-brain risk from two separate writes — but the duplication must be
-- kept in sync by that Service layer's discipline, not enforced by the
-- database itself (no generated column / check constraint tying the two
-- together in this first pass).
--
-- KEY DECISION — category_scores is its own jsonb column, separate from
-- result. Holds exactly the four confirmed sub-scores (risk, compliance,
-- completeness, negotiationLeverage) as a small structured object, so the
-- common case (reading just the four sub-scores for a UI widget) does not
-- require parsing the larger result blob, which carries fuller
-- rationale/evidence/weighting detail per sub-score.
--
-- KEY DECISION — no Postgres-level enum for the sub-score category
-- taxonomy. Continues the unbroken convention from every prior module
-- (ClauseCategory, RiskSeverity, ComplianceFramework, etc.): the four
-- category names are a Zod enum enforced at the application layer, in the
-- not-yet-built legal-health-score.schemas.ts, so a fifth category later
-- is a code change, not a schema migration.
--
-- KEY DECISION — no unique constraint on document_analysis_id. Per the
-- confirmed immutable-snapshot-per-run semantics above, re-running this
-- engine against the same analysis is expected to produce a new row over
-- time, exactly as every prior module already permits — not an anomaly
-- this table should constrain against.
--
-- KEY DECISION — write policies (insert/update) included in THIS
-- migration, not deferred. Continues the convention now established four
-- times running (Files 100, 108, 116, 124). Policies below are copied
-- verbatim in shape from ai_recommendations_insert_owner / _update_owner,
-- since this table's FK chain to documents.owner_id is identical in depth
-- and shape.
-- ============================================================================

create type legal_health_score_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.legal_health_scores (
  id uuid primary key default gen_random_uuid(),

  -- FK back to the analysis this health score was derived from. ON DELETE
  -- CASCADE mirrors ai_recommendations.document_analysis_id's identical FK
  -- — derived data dies with its source, consistently at every layer of
  -- this pipeline. See KEY DECISION above for why this points at
  -- document_analyses rather than any upstream module's own table.
  document_analysis_id uuid not null
    references public.document_analyses(id)
    on delete cascade,

  status legal_health_score_status not null default 'pending',

  -- Promoted, queryable overall score (0-100). See KEY DECISION above for
  -- why this is a real column rather than a jsonb path, and the
  -- duplication trade-off with result.overallScore. Nullable until the
  -- run completes, same as every other derived-value column on this
  -- table.
  overall_score integer,

  -- Promoted, queryable sub-score breakdown: { risk, compliance,
  -- completeness, negotiationLeverage }, each 0-100. Shape enforced at the
  -- application layer via the same Zod-schema-passed-to-
  -- generateWithFallback() convention as every prior module's result
  -- column. Kept separate from `result` so reading just the four
  -- sub-scores does not require parsing the fuller detail blob below.
  category_scores jsonb,

  -- Full structured output: per-sub-score rationale, contributing
  -- upstream evidence references, and weighting detail. Shape enforced at
  -- the application layer via a Zod schema, never written here
  -- unvalidated — identical convention to ai_recommendations.result and
  -- every prior module's result column. Not yet built:
  -- legal-health-score.schemas.ts (next file in this module).
  result jsonb,

  -- Reuses the real ai_provider_name enum from document_analyses'
  -- migration — same domain concept as ai_recommendations.provider_used
  -- and every prior module's provider_used, correct to reuse here too.
  provider_used ai_provider_name,

  -- Client-safe message only if status = 'failed', never raw provider
  -- error detail — same convention as ai_recommendations.error_message
  -- and every prior module's error_message.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Not unique: mirrors ai_recommendations_document_analysis_id_idx's
-- reasoning exactly — independent re-runs of the health score engine
-- against the same analysis are valid over time (e.g. after any upstream
-- module re-runs), so multiple rows per document_analysis_id are
-- expected, per the confirmed immutable-snapshot-per-run semantics above.
create index legal_health_scores_document_analysis_id_idx
  on public.legal_health_scores (document_analysis_id);

create index legal_health_scores_status_idx
  on public.legal_health_scores (status);

-- NEW PRECEDENT, not present on any prior module's migration: a btree
-- index on the promoted overall_score column. Directly justified by the
-- KEY DECISION above — nothing is gained by indexing a jsonb blob for
-- range queries, but a plain index on overall_score makes "worst N
-- documents" and threshold-based queries (e.g. overall_score < 50) cheap.
-- Flagged explicitly as new precedent rather than added silently.
create index legal_health_scores_overall_score_idx
  on public.legal_health_scores (overall_score);

alter table public.legal_health_scores enable row level security;

-- Reads: mirrors ai_recommendations_select_owner's exact join shape —
-- legal_health_scores -> document_analyses -> documents.owner_id =
-- auth.uid(). Same depth as every prior module, since all six modules
-- (incl. this one) sit as siblings under document_analyses per KEY
-- DECISION above.
create policy legal_health_scores_select_owner
  on public.legal_health_scores
  for select
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = legal_health_scores.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

-- Writes: included from the start — see KEY DECISION above. Shape copied
-- verbatim from ai_recommendations_insert_owner / _update_owner, since
-- legal_health_scores' FK chain to documents.owner_id is identical in
-- depth and shape.
create policy legal_health_scores_insert_owner
  on public.legal_health_scores
  for insert
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = legal_health_scores.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

create policy legal_health_scores_update_owner
  on public.legal_health_scores
  for update
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = legal_health_scores.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = legal_health_scores.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );
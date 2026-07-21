-- ============================================================================
-- Multi-document module -- synthesis run tracking.
--
-- Creates public.document_set_analyses: the run-history table for a
-- document_set's cross-document synthesis, mirroring public.document_analyses'
-- exact shape (id, status, result jsonb, provider_used, error_message,
-- completed_at, created_at) and lifecycle (pending -> processing ->
-- completed|failed), one level up -- FK to document_sets instead of
-- documents.
--
-- DECIDED, delegated: a set supports multiple synthesis runs over time
-- (list history, most recent first), matching every other synthesis
-- module in this project (document_analyses, ai_legal_insights,
-- legal_health_scores, etc.) -- no precedent anywhere in this schema for
-- a one-shot-only synthesis table, so this doesn't invent one either.
-- Adding/removing a set member does NOT auto-invalidate the latest run --
-- no "stale" concept exists anywhere in this schema either; re-running is
-- an explicit, manual action. Revisit both together if real usage says
-- otherwise.
-- ============================================================================

-- One dedicated status enum per synthesis-table, matching this project's
-- unbroken convention (document_analysis_status, ai_legal_insight_status,
-- legal_health_score_status, etc. -- confirmed via the real, pasted
-- database.types.ts Enums section this session: every one of those is a
-- separate enum with the identical four values, never a shared/reused
-- enum across tables). Same reasoning as those: sidesteps the File 25
-- enum-naming-collision class of bug entirely, at the cost of duplicate
-- value sets -- an accepted, established tradeoff in this project, not a
-- new one introduced here.
create type public.document_set_analysis_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create table public.document_set_analyses (
  id uuid primary key default gen_random_uuid(),

  document_set_id uuid not null references public.document_sets (id) on delete cascade,

  status public.document_set_analysis_status not null default 'pending',

  -- Validated at the application layer (a future document-set-analysis
  -- Zod schema, same division of labor document_analyses.result already
  -- established: jsonb here, schema-validated on every read at the
  -- repository layer, not constrained by the database itself).
  result jsonb,

  -- Reuses the existing shared ai_provider_name enum ('openai' | 'gemini')
  -- -- unlike status, this one IS shared across every AI-calling module in
  -- this project (document_analyses, ai_legal_insights, etc. all reuse the
  -- same ai_provider_name), confirmed via the real database.types.ts Enums
  -- section this session.
  provider_used public.ai_provider_name,

  error_message text,

  completed_at timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.document_set_analyses is
  'Run history for a document_set''s cross-document synthesis. Mirrors public.document_analyses'' lifecycle one level up (document_set instead of a single document).';

-- Common query is "history for this set, most recent first" -- a plain
-- btree on the FK column covers both that ordering (via created_at, not
-- indexed separately here -- see note below) and existence checks.
create index document_set_analyses_document_set_id_idx
  on public.document_set_analyses (document_set_id);

-- FLAGGED, NOT ADDED: no separate index on created_at or a composite
-- (document_set_id, created_at). document_analyses' own real index
-- strategy for its equivalent "history for this document, most recent
-- first" query was never independently pasted this session -- rather
-- than guess at whether a composite index is warranted, this starts with
-- the single FK index alone (Postgres can still satisfy an ORDER BY
-- created_at DESC with a sort over a small-per-set row count without one).
-- Revisit together if this table's row volume or query plans ever justify
-- a composite index.

alter table public.document_set_analyses enable row level security;

-- RLS mirrors document_set_members' own EXISTS-based join-to-owner
-- pattern (this migration's own precedent, not document_analyses' --
-- that table's real RLS text was never pasted this session, so this does
-- NOT claim to match it, only to match document_set_members' pattern
-- within this same migration set). No admin-client requirement for the
-- future DocumentSetService: reads/writes both go through the caller's
-- own RLS-respecting session, same posture as document_sets and
-- document_set_members above.

create policy "document_set_analyses_select_own"
  on public.document_set_analyses for select
  to authenticated
  using (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_analyses.document_set_id
        and ds.owner_id = auth.uid()
    )
  );

create policy "document_set_analyses_insert_own"
  on public.document_set_analyses for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_analyses.document_set_id
        and ds.owner_id = auth.uid()
    )
  );

-- UPDATE policy is required here (unlike document_set_members, which has
-- none) -- a synthesis run's own lifecycle needs pending -> processing ->
-- completed|failed transitions issued by the owning user's session,
-- mirroring the future DocumentSetService's expected call pattern
-- (create as 'pending', then transition in place) rather than only ever
-- inserting terminal rows.
create policy "document_set_analyses_update_own"
  on public.document_set_analyses for update
  to authenticated
  using (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_analyses.document_set_id
        and ds.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_sets ds
      where ds.id = document_set_analyses.document_set_id
        and ds.owner_id = auth.uid()
    )
  );

create policy "document_set_analyses_select_admin"
  on public.document_set_analyses for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
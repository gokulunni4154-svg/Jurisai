-- ============================================================================
-- File 92 (Amendment 1) — clause_classifications
--
-- Standalone Phase 2 module table. Consumes document_analyses output as
-- input via document_analysis_id FK, mirroring the pattern established by
-- document_analyses itself (a derived record pointing back to its source
-- via a FK, RLS enforced by walking that FK chain rather than duplicating
-- an owner_id column on every derived table).
--
-- Amendment 1: corrects three assumptions made before document_analyses'
-- and documents' real migration source was available —
--   1. status is now its own dedicated enum (clause_classification_status),
--      matching the per-table-enum discipline document_analyses itself
--      uses, not a CHECK-on-TEXT guess.
--   2. provider_used now reuses the real ai_provider_name enum (created in
--      20260714081335_create_document_analyses_table.sql) instead of text.
--   3. RLS now joins through documents.owner_id (the real column), not the
--      guessed documents.user_id, and drops the guessed client-facing
--      INSERT policy in favor of document_analyses' real documented
--      convention: writes happen only via the service role, server-side.
-- ============================================================================

create type clause_classification_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.clause_classifications (
  id uuid primary key default gen_random_uuid(),

  -- FK back to the analysis this classification was derived from. ON
  -- DELETE CASCADE mirrors document_analyses.document_id's own
  -- "on delete cascade" back to documents — derived data dies with its
  -- source, consistently at every layer of this pipeline.
  document_analysis_id uuid not null
    references public.document_analyses(id)
    on delete cascade,

  status clause_classification_status not null default 'pending',

  -- Structured classification output (per-clause labels, confidence,
  -- span references, etc.). Shape enforced at the application layer via
  -- a Zod schema passed to AIProvider.generateStructured() — never
  -- written here unvalidated, per ai-provider.interface.ts's contract.
  -- Not yet built: clause-classification.schemas.ts (File 93 territory).
  result jsonb,

  -- Reuses the real ai_provider_name enum from document_analyses'
  -- migration — this is genuinely the same domain concept (which AI
  -- provider produced the result), not a table-specific status, so
  -- reuse is correct here where it wasn't for `status` above.
  provider_used ai_provider_name,

  -- Client-safe message only if status = 'failed', never raw provider
  -- error detail — same convention as document_analyses.error_message.
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Not unique: re-classification (independent of re-analysis, per the
-- module's stated design) means multiple rows per document_analysis_id
-- are valid over time — this index supports the hot-path lookup without
-- constraining that.
create index clause_classifications_document_analysis_id_idx
  on public.clause_classifications (document_analysis_id);

create index clause_classifications_status_idx
  on public.clause_classifications (status);

alter table public.clause_classifications enable row level security;

-- Reads: RLS mirrors document_analyses_select_owner's exact pattern, one
-- join further out — clause_classifications -> document_analyses ->
-- documents.owner_id = auth.uid(). Consistent with the Legal Vault
-- convention (documented in document_analyses' own migration) of relying
-- on RLS for read access rather than requireOwnership() in the service
-- layer.
create policy clause_classifications_select_owner
  on public.clause_classifications
  for select
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = clause_classifications.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

-- Writes (insert/update) are performed exclusively by the service role
-- from server-side code, identical to document_analyses' documented
-- convention — no client-facing insert/update policy is defined here.
-- This was wrongly included as a client INSERT policy in the pre-
-- amendment draft of this file; removed to match the real, established
-- convention rather than inventing a different access model one table
-- downstream in the same pipeline.
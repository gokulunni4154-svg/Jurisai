-- Migration: create document_analyses table
--
-- One row per AI analysis run against a document. Denormalized `result`
-- (jsonb) mirrors DocumentAnalysisResult (analysis.schemas.ts, File 62)
-- exactly — no separate tables for risk flags/clauses, since this data
-- is always read/written as a whole per analysis.

create type document_analysis_status as enum ('pending', 'processing', 'completed', 'failed');
create type ai_provider_name as enum ('openai', 'gemini');

create table document_analyses (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,

  status document_analysis_status not null default 'pending',

  -- Populated only once status = 'completed'. Shape must match
  -- DocumentAnalysisResult (analysis.schemas.ts) — enforced at the
  -- application layer via Zod, not at the database layer.
  result jsonb,

  -- Which provider actually produced `result`. Null until completed.
  -- Relevant given the fallback logic in ai-provider.factory.ts (File 61) —
  -- an analysis may have used the non-default provider.
  provider_used ai_provider_name,

  -- Populated only if status = 'failed'. Client-safe message only —
  -- never raw provider error detail (see AIProviderError's separation
  -- of message vs. context/cause in app-error.ts).
  error_message text,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index document_analyses_document_id_idx on document_analyses(document_id);

-- Reads: RLS mirrors document ownership via join — consistent with the
-- Legal Vault convention of relying on RLS rather than requireOwnership()
-- for read access.
alter table document_analyses enable row level security;

create policy document_analyses_select_owner
  on document_analyses
  for select
  using (
    exists (
      select 1 from documents
      where documents.id = document_analyses.document_id
      and documents.owner_id = auth.uid()
    )
  );

-- Writes (insert/update) are performed exclusively by the service role
-- from server-side code (Route Handlers / Edge Functions), never
-- directly by an authenticated client — no client-facing insert/update
-- policy is defined here. If a future requirement needs client-side
-- writes to this table, that's a deliberate policy addition, not an
-- oversight.
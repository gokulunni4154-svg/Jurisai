-- ============================================================================
-- Amendment migration — adds missing authenticated-user INSERT/UPDATE RLS
-- policies to document_analyses, ocr_extractions, and clause_classifications.
--
-- BACKGROUND: all three tables' original migrations documented "writes are
-- service-role-only by design" and deliberately omitted client-facing
-- INSERT/UPDATE policies. But DocumentAnalysisRepository/Service (Files
-- 64/65) and OCR's equivalents never actually use the service-role
-- (admin.ts) client — document-analysis.factory.ts explicitly constructs
-- only the RLS-respecting client (createClient()) and injects it
-- everywhere, by deliberate design ("Never admin.ts here"). The result:
-- as originally migrated, every write these already-shipped services make
-- (create(), markProcessing(), markCompleted(), markFailed(), and OCR's
-- equivalents) would be rejected by RLS with no policy permitting them.
--
-- RESOLUTION (Option A, chosen explicitly by the project owner over
-- switching the services to admin.ts): add the missing authenticated-user
-- policies, scoped by document ownership, rather than changing two
-- already-stabilized modules' client-selection behavior. This is additive
-- only — no existing policy is altered or dropped, and no application
-- code changes are required by this migration.
--
-- Each table's new policies mirror THAT table's own existing SELECT
-- policy's join shape exactly, not a single uniform template — see the
-- per-table comments below for one already-existing inconsistency
-- (document_analyses' SELECT does not check documents.deleted_at;
-- ocr_extractions' does) that this migration deliberately preserves
-- rather than silently resolving as a side effect.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- document_analyses
-- ----------------------------------------------------------------------------

-- Mirrors document_analyses_select_owner's join exactly — no
-- documents.deleted_at check, matching that policy's existing scope
-- rather than introducing a stricter condition writes wouldn't have had
-- to satisfy under the original (would-be) service-role write path.
create policy document_analyses_insert_owner
  on document_analyses
  for insert
  with check (
    exists (
      select 1 from documents
      where documents.id = document_analyses.document_id
      and documents.owner_id = auth.uid()
    )
  );

create policy document_analyses_update_owner
  on document_analyses
  for update
  using (
    exists (
      select 1 from documents
      where documents.id = document_analyses.document_id
      and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from documents
      where documents.id = document_analyses.document_id
      and documents.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- ocr_extractions
-- ----------------------------------------------------------------------------

-- Mirrors ocr_extractions_select_own's join exactly, INCLUDING the
-- documents.deleted_at check that document_analyses' equivalent policies
-- above deliberately omit — that asymmetry already existed between these
-- two tables' SELECT policies and is preserved here, not resolved.
create policy ocr_extractions_insert_owner
  on public.ocr_extractions
  for insert
  with check (
    exists (
      select 1
      from public.documents d
      where d.id = ocr_extractions.document_id
        and d.owner_id = auth.uid()
        and d.deleted_at is null
    )
  );

create policy ocr_extractions_update_owner
  on public.ocr_extractions
  for update
  using (
    exists (
      select 1
      from public.documents d
      where d.id = ocr_extractions.document_id
        and d.owner_id = auth.uid()
        and d.deleted_at is null
    )
  )
  with check (
    exists (
      select 1
      from public.documents d
      where d.id = ocr_extractions.document_id
        and d.owner_id = auth.uid()
        and d.deleted_at is null
    )
  );

-- ----------------------------------------------------------------------------
-- clause_classifications
-- ----------------------------------------------------------------------------

-- Mirrors clause_classifications_select_owner's join exactly (File 92) —
-- two-hop join through document_analyses to documents.owner_id, no
-- deleted_at check, consistent with that policy and with
-- document_analyses' own pattern above (clause_classifications sits
-- downstream of document_analyses, not ocr_extractions, so it inherits
-- document_analyses' scope shape, not ocr_extractions').
create policy clause_classifications_insert_owner
  on public.clause_classifications
  for insert
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = clause_classifications.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );

create policy clause_classifications_update_owner
  on public.clause_classifications
  for update
  using (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = clause_classifications.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.document_analyses
      join public.documents on documents.id = document_analyses.document_id
      where document_analyses.id = clause_classifications.document_analysis_id
        and documents.owner_id = auth.uid()
    )
  );
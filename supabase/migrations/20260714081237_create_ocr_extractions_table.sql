-- supabase/migrations/20260714081237_create_ocr_extractions_table.sql
-- File 73 — JurisAI OCR module
--
-- Filename is real, CLI-generated via `supabase migration new
-- create_ocr_extractions_table` — the earlier placeholder-filename
-- issue (Open Issue #5) is resolved for this file as of this
-- migration. See document_analyses' sibling migration
-- (20260714081335_create_document_analyses_table.sql, File 63) for
-- the other half of Issue #5's resolution.

create table if not exists public.ocr_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  result jsonb,
  provider text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1:many: a document can have multiple extraction attempts over time.
-- No unique constraint on document_id — deliberate. A failed retry
-- must never be able to overwrite a previously successful extraction
-- via upsert semantics; keeping every attempt as its own row avoids
-- that class of bug entirely. findByDocumentId() (File 74) orders by
-- created_at desc to surface the latest attempt, mirroring
-- document_analyses' identical convention.
create index if not exists ocr_extractions_document_id_idx
  on public.ocr_extractions (document_id, created_at desc);

alter table public.ocr_extractions enable row level security;

-- READ: visibility follows the same convention as document_analyses —
-- via join to documents, requiring the caller to own the parent
-- document and the document not be soft-deleted. ASSUMES
-- documents.owner_id and documents.deleted_at column names — the same
-- unverified assumption document_analyses' RLS already carries (see
-- Known Issues), now shared by a second table. If that assumption is
-- ever found wrong, both tables' RLS need fixing together.
create policy "ocr_extractions_select_own"
  on public.ocr_extractions
  for select
  using (
    exists (
      select 1
      from public.documents d
      where d.id = ocr_extractions.document_id
        and d.owner_id = auth.uid()
        and d.deleted_at is null
    )
  );

-- WRITES: service-role-only by design, same as document_analyses.
-- No insert/update/delete policy is defined for 'authenticated' —
-- Supabase's default-deny applies. All writes happen through the
-- service-role client (File 74/75), never a user-scoped RLS client.
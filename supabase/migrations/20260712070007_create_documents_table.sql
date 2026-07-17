-- ============================================================================
-- Legal Vault module -- initial schema.
--
-- Creates the private Supabase Storage bucket documents are physically
-- stored in, and the public.documents table that tracks metadata about
-- each stored file (owner, filename, size, MIME type, soft-delete state).
--
-- Bucket and table are created together, deliberately, in one migration:
-- the table's storage_path values are meaningless without the bucket
-- existing, and the bucket's own RLS policy (below) depends on the exact
-- folder-prefix convention this table's storage_path values will follow.
-- Splitting these into two migrations would leave the first one
-- non-functional until the second lands.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Storage bucket
-- ----------------------------------------------------------------------------

-- Private bucket (public = false): every read must go through a signed URL
-- issued after an authorization check, never a bare public URL. Legal
-- documents are the single most sensitive data type this platform will
-- ever store -- there is no scenario where public = true is acceptable here.
--
-- file_size_limit and allowed_mime_types are enforced by Supabase Storage
-- itself at upload time, as a first line of defense. This is NOT a
-- substitute for application-level validation in the future Legal Vault
-- service layer (Files still to come) -- it's defense-in-depth, catching
-- malformed/oversized uploads before they ever reach application code,
-- the same way DB check constraints below aren't a substitute for Zod
-- validation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'legal-vault-documents',
  'legal-vault-documents',
  false,
  26214400, -- 25 MiB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/tiff'
  ]
);

-- Storage path convention (enforced by application code at upload time,
-- not by the database): "{owner_id}/{document_id}/{sanitized_filename}".
-- Owner ID as the first path segment is what makes the RLS policies below
-- possible via storage.foldername(name) -- extracting that first segment
-- and comparing it to auth.uid() is the standard Supabase pattern for
-- per-user storage isolation without a join back to another table.

create policy "legal_vault_documents_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legal-vault-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "legal_vault_documents_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'legal-vault-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "legal_vault_documents_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'legal-vault-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'legal-vault-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "legal_vault_documents_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'legal-vault-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin read access mirrors public.profiles' admin-select pattern: role is
-- read from auth.jwt()'s app_metadata claim, never from a client-writable
-- table, consistent with the project-wide rule that role lives only in
-- app_metadata (see ARCHITECTURE.md §3).
create policy "legal_vault_documents_select_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legal-vault-documents'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- ----------------------------------------------------------------------------
-- Metadata table
-- ----------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),

  -- Not a 1:1 key like profiles.id -- a user owns many documents, so this
  -- is a plain foreign key, not the table's own primary key.
  owner_id uuid not null references auth.users (id) on delete cascade,

  title text not null check (char_length(title) between 1 and 255),

  -- Must exactly match the object's path in the legal-vault-documents
  -- bucket (see convention above). Uniqueness is enforced here as a second
  -- guarantee alongside Storage's own object-path uniqueness within a
  -- bucket -- belt-and-suspenders against a future code path that might
  -- construct a row without going through the intended upload flow.
  storage_path text not null unique,

  mime_type text not null,

  size_bytes bigint not null check (size_bytes > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Soft delete via a nullable timestamp, NOT a status enum. Deliberate:
  -- the abandoned reused Supabase project (see PROJECT_PROGRESS.md's
  -- Supabase Project Note) left behind a stray document_status_enum from
  -- an unrelated app, and this project has already been burned once by an
  -- enum-naming collision (File 25's amendment). A nullable timestamp
  -- needs no enum at all, sidesteps that entire class of collision, and
  -- "when was this deleted" is more useful than "is this deleted" anyway.
  -- Analysis-pipeline status (uploaded/processing/ready/failed) is
  -- explicitly NOT modeled here -- that belongs to the future AI Document
  -- Analysis module's own table, not crammed into this one, per the
  -- Constitution's "role-specific / concern-specific data lives in its
  -- own table" convention.
  deleted_at timestamptz
);

comment on table public.documents is
  'Legal Vault document metadata. Physical files live in the legal-vault-documents Storage bucket at documents.storage_path.';

create index documents_owner_id_idx on public.documents (owner_id);

-- Partial index: the overwhelmingly common query is "this owner's
-- non-deleted documents" (a trash/archive view is the rare case) -- a
-- partial index keeps that common query fast without indexing rows that
-- query will never match.
create index documents_owner_id_active_idx
  on public.documents (owner_id)
  where deleted_at is null;

alter table public.documents enable row level security;

-- Naming convention follows File 25's amendment (set_profiles_updated_at,
-- not the generic set_updated_at that collided with the abandoned reused
-- project) -- every module's trigger function is named after its table
-- specifically, so this exact collision can never recur.
create or replace function public.set_documents_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger documents_set_updated_at
  before update on public.documents
  for each row
  execute function public.set_documents_updated_at();

-- Ownership-based RLS, mirroring profiles' pattern (select/update scoped
-- to auth.uid(), admin select via the app_metadata role claim). Two
-- differences from profiles, both deliberate:
--
-- 1. An explicit INSERT policy exists here (profiles never needs one --
--    profile rows are created exclusively by File 25's handle_new_user()
--    trigger, never by direct client insert). Documents, by contrast, are
--    created directly by the owning user through the upload flow, so a
--    real insert policy is required.
--
-- 2. A DELETE policy exists here (profiles has none). The Legal Vault
--    service layer (a future file) is expected to default to soft-delete
--    via UPDATE...SET deleted_at, but a real hard-delete policy is still
--    included at the database level for an owner's own rows -- e.g. a
--    future "permanently delete" action, or admin cleanup tooling. This
--    is a database-level capability, not a statement that the service
--    layer's default UX will expose hard delete casually.

create policy "documents_select_own"
  on public.documents for select
  to authenticated
  using (owner_id = auth.uid());

create policy "documents_insert_own"
  on public.documents for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "documents_update_own"
  on public.documents for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "documents_delete_own"
  on public.documents for delete
  to authenticated
  using (owner_id = auth.uid());

create policy "documents_select_admin"
  on public.documents for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
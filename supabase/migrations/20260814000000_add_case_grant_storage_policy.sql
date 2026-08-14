-- ============================================================================
-- Migration: add_case_grant_storage_policy
-- ============================================================================
-- Document Access Security Task -- closes a real, confirmed gap between
-- public.documents RLS and the legal-vault-documents Storage bucket RLS.
--
-- CONTEXT: 20260808000000_create_case_access_grants.sql already decided
-- and implemented Model B (case access implies document access) at the
-- documents-table level -- it added `documents_select_via_case_grant` and
-- `documents_update_via_case_grant`, purely additive policies granting a
-- case's active grantee visibility (any access_level) / update rights
-- (read_write only) on documents linked to that case via case_documents.
-- That migration's own header even calls this "higher blast radius than
-- everything above" and states it is deliberately additive-only.
--
-- THE GAP: that migration touched public.documents but never touched
-- storage.objects. The legal-vault-documents bucket's own RLS (from
-- 20260712070007_create_documents_table.sql) is still strictly
-- owner-only (`(storage.foldername(name))[1] = auth.uid()::text`) plus
-- an admin-role branch -- no case-grant branch exists there. Verified
-- by grepping every migration for `storage.objects`/`storage.buckets`:
-- only 20260712070007 (this bucket's own creation), 20260724000000
-- (a different bucket, legal-vault-exports), and 20260809000000
-- (comment-only, explicitly adds no new storage policy) ever touch
-- storage RLS. No migration since 20260808000000 closed this loop.
--
-- CONCRETE EFFECT BEFORE THIS FIX: a case grantee -- who the app already
-- treats as authorized (documents_select_via_case_grant makes the row
-- visible; DocumentService.getDownloadUrl()/getDocumentById() are
-- RLS-only for reads, per that Service's own class-level doc comment,
-- so the app raises no 403) -- would still fail at the final step.
-- DocumentRepository.createSignedDownloadUrl() calls
-- `this.supabase.storage.from(bucket).createSignedUrl(...)` using the
-- SAME request-scoped, RLS-respecting client DocumentRepository is
-- always constructed with (confirmed in document.factory.ts -- never
-- the admin client). Supabase Storage's createSignedUrl enforces
-- storage.objects SELECT RLS for that call. With no case-grant branch
-- there, the call would throw, surfacing as a raw DatabaseError instead
-- of the clean, intended download -- an under-permission bug (a real
-- Model-B-authorized user blocked by an out-of-sync policy), not an
-- over-permission vulnerability. This migration closes exactly that gap
-- and nothing more.
--
-- WHY THIS SHAPE, NOT A DIRECT case_documents/case_access_grants JOIN:
-- the obvious-looking alternative -- deriving document_id from the
-- storage object's own path (`(storage.foldername(name))[2]`) and
-- joining case_documents on that -- is unsound here. document.service.ts's
-- own class-level "OPEN GAP" comment and document-upload.ts's real
-- upload code both confirm the storage path's second segment is an
-- independently-generated `crypto.randomUUID()` picked at upload time,
-- NOT the documents row's own (Postgres-generated) `id` -- the two are
-- never guaranteed equal. Matching on `documents.storage_path =
-- storage.objects.name` instead (a real, unique, indexed column
-- already used exactly this way by every existing owner-scoped storage
-- policy's sibling logic) sidesteps that mismatch entirely.
--
-- WHY A BARE EXISTS ON public.documents, NOT A DUPLICATED CASE-GRANT
-- SUBQUERY: rather than re-deriving case-grant eligibility a second time
-- inside storage.objects RLS (which would duplicate
-- documents_select_via_case_grant's own logic and could silently drift
-- from it later), this policy simply asks "is there a documents row at
-- this exact storage_path that the current requester is already allowed
-- to SELECT". Since public.documents already has row-level security
-- enabled, this subquery is automatically scoped by documents' own
-- existing SELECT policies (owner, case-grant, admin) -- whatever
-- documents-level visibility model exists now or is extended to in the
-- future, storage automatically matches it, by construction, without a
-- second policy needing to be kept in sync by hand. This also avoids
-- introducing a second, unnecessary SECURITY DEFINER helper function
-- (Step 9's own instruction) -- has_case_grant()/is_case_owner()
-- (20260912000000) exist specifically to break a *cases* RLS recursion
-- cycle that does not apply here: this policy's subquery only reaches
-- public.documents, which never queries storage.objects back, so there
-- is no cycle to break.
--
-- SCOPE: SELECT only. No case-grant UPDATE/INSERT/DELETE storage policy
-- is added. documents_update_via_case_grant only ever permitted editing
-- document *metadata* (title/hearing_date) via DocumentService -- it
-- never implied replacing the underlying file bytes, and no code path
-- anywhere lets a non-owner re-upload over an existing document. Adding
-- storage write access for grantees would grant a capability the
-- documents-level model never actually established -- exactly what
-- Step 15 says not to do.
-- ============================================================================

create policy "legal_vault_documents_select_via_document_visibility"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legal-vault-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
    )
  );

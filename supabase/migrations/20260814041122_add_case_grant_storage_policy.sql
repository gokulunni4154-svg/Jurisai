create policy "legal_vault_documents_select_via_document_visibility"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legal-vault-documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
    )
  );;

// src/core/storage/document-upload.ts
// NEW FILE — Phase 3 frontend, resolves Carried-Forward Open Item #28.
//
// Client-side direct upload to the legal-vault-documents Storage bucket,
// followed by the metadata write via POST /api/documents (File 50).
//
// SOURCE-VERIFIED AGAINST:
//   - 20260712070007_create_documents_table.sql — bucket id
//     'legal-vault-documents', 25 MiB (26214400 byte) file_size_limit,
//     allowed_mime_types list, and the storage.foldername(name)[1] =
//     auth.uid()::text INSERT policy that makes an unauthenticated-server
//     upload path unnecessary — an authenticated browser client can
//     already write to its own prefix directly.
//   - document.service.ts (File 48) — createDocument()'s ownership check
//     compares storagePath.split('/')[0] to the current user's id, so the
//     first path segment here MUST be the real auth uid, not any other
//     identifier.
//   - documents.schemas.ts's createDocumentSchema is NOT in-thread this
//     session — its shape is taken on the strength of File 48's own
//     `input.storagePath` / `input.mimeType` / `input.sizeBytes` usage,
//     which is a real call-site, not a paraphrase. If createDocumentSchema
//     itself turns out to use different field names, this file's POST
//     body needs a matching amendment.
//   - client.ts (src/core/supabase/client.ts) — createClient() is a
//     per-call factory, not a singleton; called fresh here rather than
//     imported as a shared instance, per that file's own doc comment.
//
// OPEN GAP, flagged not solved: the Supabase JS client's storage.upload()
// has no native progress callback in the version this project pins to
// (unverified — package.json was not pasted this session). Callers get an
// all-or-nothing promise, not incremental progress. Acceptable for now
// given documents are capped at 25 MiB; revisit if large-file UX becomes
// a real complaint.

import { createClient } from '@/core/supabase/client';

const BUCKET = 'legal-vault-documents';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/tiff',
]);

const MAX_SIZE_BYTES = 26214400; // 25 MiB — must match the bucket's file_size_limit exactly.

export class UploadValidationError extends Error {}

function sanitizeFilename(name: string): string {
  // Storage paths are constrained enough server-side (bucket policy only
  // checks the FIRST segment) that this is a UX/collision safeguard, not
  // a security boundary — RLS is the real boundary.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-200);
}

function validateFile(file: File): void {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new UploadValidationError(
      `"${file.type || 'unknown type'}" isn't a supported file type.`,
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new UploadValidationError('File is larger than the 25 MB limit.');
  }
  if (file.size === 0) {
    throw new UploadValidationError('File appears to be empty.');
  }
}

export interface UploadedDocument {
  id: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  owner_id: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Uploads a file directly to Storage as the current user, then creates
 * the corresponding documents row via POST /api/documents.
 *
 * Two-step, not transactional: if the Storage upload succeeds but the
 * metadata POST fails, an orphaned Storage object is left behind with no
 * documents row pointing at it. Acceptable for now — same class of
 * known, accepted gap as File 48's documented TOCTOU limitation — but
 * flagged rather than silently risked. A future cleanup job or retry-
 * with-same-path UX would need this reconciled properly.
 */
export async function uploadDocument(file: File, title: string): Promise<UploadedDocument> {
  validateFile(file);

  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('You need to be signed in to upload a document.');
  }

  const storagePath = `${user.id}/${crypto.randomUUID()}/${sanitizeFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const res = await fetch('/api/documents', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      storagePath,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });

  if (!res.ok) {
    throw new Error(`Could not save document metadata (status ${res.status}).`);
  }

  const json = await res.json();
  return json.data.document as UploadedDocument;
}
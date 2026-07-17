import { z } from 'zod';

import { paginationSchema, uuidSchema } from '@/core/validation/common.schemas';

/**
 * Must match the `char_length(title) between 1 and 255` check constraint
 * on public.documents (File 45). Kept as an application-level constant so
 * a too-long title is rejected with a clear ValidationError before ever
 * reaching Postgres, rather than surfacing as an opaque DatabaseError. If
 * File 45's constraint ever changes, this constant must change with it.
 */
export const MAX_TITLE_LENGTH = 255;

export const documentTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required.')
  .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters.`);

/**
 * Must match `allowed_mime_types` on the legal-vault-documents Storage
 * bucket (File 45) exactly. Duplicated here deliberately, not read from
 * Storage at runtime -- validating the MIME type in the application layer,
 * before a request ever reaches Storage, gives a clear ValidationError
 * instead of an opaque Storage-API rejection. If File 45's bucket config
 * ever changes, this array must change with it -- there is currently no
 * automated check that the two stay in sync, which is a known limitation
 * worth revisiting (e.g. a shared constants file, or a test that fetches
 * the bucket config and asserts equality) once the Legal Vault module has
 * more than one file referencing this list.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/tiff',
] as const;

export const documentMimeTypeSchema = z.enum(ALLOWED_MIME_TYPES, {
  errorMap: () => ({
    message: `File type must be one of: ${ALLOWED_MIME_TYPES.join(', ')}.`,
  }),
});

/**
 * Must match `file_size_limit` (bytes) on the legal-vault-documents
 * Storage bucket (File 45). Same duplication rationale as
 * ALLOWED_MIME_TYPES above.
 */
export const MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MiB

export const documentSizeBytesSchema = z
  .number()
  .int('File size must be a whole number of bytes.')
  .positive('File size must be greater than zero.')
  .max(MAX_FILE_SIZE_BYTES, `File must be at most ${MAX_FILE_SIZE_BYTES} bytes (25 MiB).`);

/**
 * Validates the *shape* of a storage_path -- three non-empty path
 * segments, matching File 45's "{owner_id}/{document_id}/{filename}"
 * convention -- but deliberately does NOT (and structurally cannot)
 * verify that the first segment actually equals the current user's ID.
 * That check requires knowing who the current user is, which is a
 * request-time fact this static schema has no access to; it is the
 * future DocumentService's responsibility to verify the owner_id segment
 * against currentUser.id before ever trusting a storage_path as
 * legitimate. This schema only rejects structurally malformed paths
 * early (e.g. missing a segment, or containing no filename at all).
 */
export const documentStoragePathSchema = z
  .string()
  .regex(
    /^[^/]+\/[^/]+\/[^/]+$/,
    'Storage path must follow the "{ownerId}/{documentId}/{filename}" convention.',
  );

/**
 * Payload validated after a file has already been uploaded to Storage
 * (by the future upload route/service), immediately before inserting the
 * corresponding public.documents row. Every field here is meant to be
 * populated from values the server itself already knows (the completed
 * upload's actual path/MIME/size), NOT taken as free-form client input --
 * this schema's job is defense-in-depth validation of those
 * server-derived values, not client-input sanitization.
 */
export const createDocumentSchema = z
  .object({
    title: documentTitleSchema,
    storagePath: documentStoragePathSchema,
    mimeType: documentMimeTypeSchema,
    sizeBytes: documentSizeBytesSchema,
  })
  .strict();

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/**
 * Only `title` is mutable after upload. storage_path, mime_type, and
 * size_bytes describe the physical file itself -- changing any of them
 * without re-uploading would desync the metadata row from the actual
 * Storage object, so none of them belong in an update payload. Replacing
 * a document's content is modeled as delete-and-reupload, not an update,
 * to keep that invariant simple rather than needing a partial-re-upload
 * flow.
 */
export const updateDocumentSchema = z
  .object({
    title: documentTitleSchema,
  })
  .strict();

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const documentIdParamSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

export type DocumentIdParam = z.infer<typeof documentIdParamSchema>;

/**
 * Extends the shared paginationSchema (File 24) with a Legal-Vault-specific
 * filter: includeDeleted, defaulting to false. Most callers want the
 * "active documents" view (the common case File 45's partial index is
 * optimized for) -- a trash/archive view is the deliberate exception, not
 * the default, so it must be explicitly requested.
 */
export const listDocumentsQuerySchema = paginationSchema
  .extend({
    includeDeleted: z.coerce.boolean().optional().default(false),
  })
  .strict();

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
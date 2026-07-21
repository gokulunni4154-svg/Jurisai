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
 * Must match `documents.hearing_date` (nullable timestamptz, migration
 * 20260725000000_add_hearing_date_to_documents.sql, File 174). Nullable
 * so an update payload can explicitly clear a previously-set hearing
 * date, not just set/change one -- `null` and "field omitted entirely"
 * are two different, both-meaningful states on a PATCH, which is why
 * this is `.nullable()` here but made `.optional()` only at the point
 * updateDocumentSchema uses it below, not here. `z.coerce.date()`
 * matches hearing_date_snapshot's real validation in
 * notifications.schemas.ts (File 177), for consistency between the two
 * places a hearing_date-shaped value gets validated in this project.
 */
export const documentHearingDateSchema = z.coerce.date().nullable();

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
 * Bulk-create envelope for Multi-document's bulk upload flow (added this
 * session, alongside the new /api/documents/bulk route). Each item is
 * validated by the SAME createDocumentSchema every single-document POST
 * already uses -- deliberately no separate, bulk-specific item shape,
 * since a bulk item describes the exact same server-derived
 * post-upload facts (storagePath, mimeType, sizeBytes) a single item
 * does.
 *
 * FLAGGED, DELEGATED DECISION, NOT DRAWN FROM PRECEDENT: no bulk
 * endpoint exists anywhere else in this project to confirm an envelope
 * shape or item cap against. The 20-item max below is a reasonable,
 * unconfirmed default -- revisit if a real requirement (or a sibling
 * bulk endpoint elsewhere) surfaces later.
 */
export const bulkCreateDocumentsSchema = z
  .object({
    documents: z
      .array(createDocumentSchema)
      .min(1, 'At least one document is required.')
      .max(20, 'At most 20 documents can be uploaded at once.'),
  })
  .strict();

export type BulkCreateDocumentsInput = z.infer<typeof bulkCreateDocumentsSchema>;

/**
 * `title` and `hearingDate` are the only mutable fields after upload.
 * storage_path, mime_type, and size_bytes describe the physical file
 * itself -- changing any of them without re-uploading would desync the
 * metadata row from the actual Storage object, so none of them belong
 * in an update payload. Replacing a document's content is modeled as
 * delete-and-reupload, not an update, to keep that invariant simple
 * rather than needing a partial-re-upload flow. hearing_date is a
 * different kind of field -- it describes a court/hearing date
 * associated with the document, not the document's own physical
 * content -- so this same "physical-file-field" rationale for excluding
 * storage_path/mime_type/size_bytes does not apply to it, and it is
 * deliberately included here. (This comment previously said only title
 * was mutable; that statement is now stale and has been corrected here,
 * not silently left inconsistent with the schema below.)
 *
 * BOTH FIELDS ARE OPTIONAL -- a deliberate change from this schema's
 * prior shape, where title was required simply because it was the only
 * mutable field, not because full-payload-on-every-update was an
 * intentional PATCH design. With two mutable fields, forcing a client
 * to resend title just to set a hearing date (or vice versa) would be
 * poor API design, so this is now a genuine partial update: send only
 * the field(s) you want to change. The `.refine()` below rejects a
 * payload with neither field present, since that would be a meaningless
 * no-op PATCH. hearingDate's three real states -- omitted (leave
 * unchanged), null (clear it), a date (set/change it) -- are all
 * distinguishable after parsing: Zod's `.optional()` omits the key
 * entirely from the parsed result when the client doesn't send it,
 * rather than setting it to `undefined` as an own-property, so the
 * future document.service.ts amendment can check
 * `'hearingDate' in input` to tell "not sent" apart from "sent as
 * null." Flagged here since that distinction only matters once the
 * Service layer consumes it, which is not this file's job -- not built
 * or verified yet.
 *
 * FLAGGED, DELEGATED DECISION, NOT DRAWN FROM PRECEDENT: no other schema
 * in this project does a "require at least one of N optional fields"
 * check via `.refine()`. This is a reasonable pattern, not a confirmed
 * one -- if a different partial-update convention already exists
 * elsewhere in the real codebase (unseen so far), this should match it
 * instead.
 */
export const updateDocumentSchema = z
  .object({
    title: documentTitleSchema.optional(),
    hearingDate: documentHearingDateSchema.optional(),
  })
  .strict()
  .refine((data) => data.title !== undefined || data.hearingDate !== undefined, {
    message: 'At least one field (title or hearingDate) must be provided.',
  });

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
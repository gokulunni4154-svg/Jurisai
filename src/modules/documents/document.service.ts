// src/modules/documents/document.service.ts
// File 48 — JurisAI Legal Vault module
// Amendment #13: added getDownloadUrl() for the download route (File 57).
// Amendment #14: updateDocument() now accepts an optional hearingDate
// field and fires an immediate 'hearing_date_set' Notification when it
// changes to a real (non-null) value. Built against real
// documents.schemas.ts (this session's amendment) and the real
// Notifications module (Files 176-180).

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AuthorizationError, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import type { Database } from '@/core/supabase/database.types';
import type { NotificationService } from '@/modules/notifications/notification.service';

import type { DocumentRepository } from './document.repository';
import {
  createDocumentSchema,
  documentIdParamSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
} from './documents.schemas';

type DocumentRow = Database['public']['Tables']['documents']['Row'];

export interface ListDocumentsResult {
  documents: DocumentRow[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Legal Vault's Service layer. Orchestrates File 46's Zod schemas and
 * File 47's DocumentRepository behind BaseService's authorization
 * primitives (File 23). Every public method takes `rawInput: unknown`
 * and parses it internally (D4/D5) — Route Handlers pass raw
 * request bodies/params/query objects straight through, never
 * pre-validated data.
 *
 * KEY DECISION — read visibility relies entirely on RLS, not on
 * requireOwnership(): getDocumentById/listDocuments/getDownloadUrl call
 * only requireAuthentication() (someone is logged in) and then trust
 * whatever the injected repository's Supabase client actually returns.
 * File 45's RLS grants admins an extra SELECT policy branch, so an
 * admin's requests transparently see every document without this
 * service containing a single line of admin-specific branching — that
 * branching lives in exactly one place (the SQL policy), not duplicated
 * here. This is why the repository should always be constructed (by the
 * future DocumentFactory) with the RLS-respecting `server.ts` client,
 * never `admin.ts` — an RLS-bypassing client would make every read
 * effectively "isAdmin", silently defeating the visibility model.
 *
 * KEY DECISION — writes DO use requireOwnership(), with NO admin
 * override: File 45's RLS only grants admins a SELECT policy, not
 * UPDATE/DELETE. Passing `allowRoles: ['admin']` here would let an
 * admin's request past this service's check only to be rejected by
 * Postgres RLS anyway, surfacing as a confusing DatabaseError instead of
 * a clean 403. So update/delete deliberately stay owner-only until a
 * real admin-write policy exists in SQL to back it up.
 *
 * KEY DECISION — soft-deleted documents are NotFoundError for everyone,
 * including the owner. No "view a deleted document" path exists yet;
 * `listDocuments`'s `includeDeleted` is the only sanctioned way to see
 * them (as list entries, not single-fetch), pending a future
 * restore-from-trash flow. getDownloadUrl inherits this same rule — a
 * soft-deleted document's file cannot be downloaded via this method
 * either, even though the underlying Storage object still physically
 * exists (soft-delete only marks the DB row, per File 47's delete()).
 *
 * NEW, AMENDMENT #14 — this Service now depends on NotificationService,
 * a cross-module dependency (Documents -> Notifications), same shape as
 * PdfExportService's dependency on DocumentService/ClassificationService/
 * LegalHealthScoreService — not a new architectural pattern for this
 * project, just the first time Documents itself has depended on
 * something outside its own module.
 *
 * OPEN GAP, flagged rather than silently assumed away: File 45's storage
 * path convention is `{owner_id}/{document_id}/{filename}`, but the
 * `document_id` path segment and the DB row's actual (Postgres-generated)
 * `id` are two independently-generated values with no enforced equality
 * anywhere in the system. `createDocument` below validates only that the
 * `owner_id` segment matches the current user — the `document_id`
 * segment is treated as an opaque, unverified string. getDownloadUrl
 * does not need to resolve this gap itself (it always uses the row's
 * real, stored `storage_path` verbatim, never reconstructs one from
 * `id`), but a future feature deriving storage paths from `id` directly
 * would need real reconciliation here.
 *
 * KNOWN LIMITATION: updateDocument/deleteDocument do a fetch-then-check-
 * then-mutate sequence that is not transactional (TOCTOU: the row could
 * change between the ownership check and the mutation). Acceptable for
 * now because only the owner can ever mutate their own row today — there
 * is no concurrent multi-actor write scenario yet. Revisit if/when
 * Law Firm/Business Dashboard multi-tenant ownership lands (see
 * BaseService#requireOwnership's own documented limitation).
 *
 * NEW LIMITATION, SAME CLASS AS ABOVE, FLAGGED NOT SOLVED — Amendment
 * #14's updateDocument() now does repository.update() THEN, as a
 * separate step, notificationService.createNotification(). These two
 * writes are not transactional either: if the document update succeeds
 * but notification creation throws, the hearing_date change persists
 * with no notification ever created, and the thrown error propagates to
 * the caller as if the whole request failed — a misleading signal, since
 * part of it (the actual data change) did succeed. Same "accepted, not
 * solved" posture as the orphaned-Storage-object risk documented
 * elsewhere in this project (document-upload.ts, File 166's
 * runPdfExport) — not fixed here, since fixing it would mean either a
 * real Postgres transaction spanning two different repository writes
 * (no precedent for that in this codebase) or a best-effort
 * try/catch-and-log around the notification call (which this project
 * has no established convention for either). Flagged for a future
 * session, not resolved.
 */
export class DocumentService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly documentRepository: DocumentRepository,
    private readonly notificationService: NotificationService,
  ) {
    super(currentUser);
  }

  /**
   * Creates a document row for an already-uploaded file. `rawInput` is
   * expected to be server-derived (the completed upload's real
   * path/MIME/size), per createDocumentSchema's own doc comment — this
   * method does not handle the upload itself, only the metadata write
   * that follows it.
   */
  async createDocument(rawInput: unknown): Promise<DocumentRow> {
    const user = this.requireAuthentication();
    const input = createDocumentSchema.parse(rawInput);

    const ownerSegment = input.storagePath.split('/')[0];
    if (ownerSegment !== user.id) {
      throw new AuthorizationError(
        'The storage path does not belong to the current user.',
        { expectedOwnerId: user.id, actualOwnerSegment: ownerSegment },
      );
    }

    return this.documentRepository.create({
      owner_id: user.id,
      title: input.title,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
    });
  }

  /**
   * Fetches a single document by id. Visibility is governed by RLS (see
   * class-level doc comment) — this method does not itself check
   * ownership. It DOES enforce the soft-delete rule: a deleted document
   * is NotFoundError regardless of who's asking.
   */
  async getDocumentById(rawParams: unknown): Promise<DocumentRow> {
    this.requireAuthentication();
    const { id } = documentIdParamSchema.parse(rawParams);

    const row = await this.documentRepository.findByIdOrThrow(id);

    if (row.deleted_at !== null) {
      throw new NotFoundError('documents', id);
    }

    return row;
  }

  /**
   * NEW — Amendment #13. Generates a short-lived signed download URL
   * for a document's underlying file.
   *
   * Deliberately reuses getDocumentById's exact fetch-and-check
   * sequence rather than calling getDocumentById() and re-parsing its
   * result — duplicated here (not delegated) because a future change to
   * getDocumentById's return shape shouldn't have to remain
   * download-URL-compatible by accident. Both methods independently
   * enforcing "RLS-visible AND not soft-deleted" is the actual
   * invariant that matters, not code reuse between them.
   *
   * The repository's createSignedDownloadUrl() (File 47, Amendment #12)
   * is intentionally authorization-blind — it will happily sign a URL
   * for any storage path it's given. This method is what keeps that
   * safe: it only ever passes a storage_path that came from a row this
   * same request already proved is both visible (survived
   * findByIdOrThrow, which is RLS-scoped) and not soft-deleted.
   */
  async getDownloadUrl(rawParams: unknown): Promise<string> {
    this.requireAuthentication();
    const { id } = documentIdParamSchema.parse(rawParams);

    const row = await this.documentRepository.findByIdOrThrow(id);

    if (row.deleted_at !== null) {
      throw new NotFoundError('documents', id);
    }

    return this.documentRepository.createSignedDownloadUrl(row.storage_path);
  }

  /**
   * Lists documents visible to the current actor (again, governed by
   * RLS — an admin's list naturally includes every owner's documents).
   * `includeDeleted` defaults to false via listDocumentsQuerySchema,
   * matching DocumentRepository#findMany's own default.
   */
  async listDocuments(rawQuery: unknown): Promise<ListDocumentsResult> {
    this.requireAuthentication();
    const query = listDocumentsQuerySchema.parse(rawQuery);

    const [documents, total] = await Promise.all([
      this.documentRepository.findMany({
        limit: query.limit,
        offset: query.offset,
        includeDeleted: query.includeDeleted,
      }),
      this.documentRepository.count({ includeDeleted: query.includeDeleted }),
    ]);

    return { documents, total, limit: query.limit, offset: query.offset };
  }

  /**
   * Updates a document. Owner-only (see class-level doc comment on why
   * there's no admin override here). A soft-deleted document cannot be
   * updated — must be treated as gone, not as an editable trash entry.
   *
   * AMENDED, THIS SESSION — now a genuine partial update (see
   * updateDocumentSchema's own amended doc comment): only fields
   * actually present in the parsed input are written. `title` behaves
   * as before. `hearingDate` is new:
   * - Omitted entirely from the input -> untouched, not included in the
   *   repository update payload at all.
   * - Sent as `null` -> hearing_date is cleared. Deliberately does NOT
   *   fire a notification — "clear" isn't "set/change", and the
   *   scoped feature never asked for a "hearing date removed"
   *   notification. Flagged as a scoping call, not drawn from an
   *   explicit requirement either way.
   * - Sent as a real date -> hearing_date is written, and if the new
   *   value actually differs from the row's existing hearing_date (not
   *   just "the field was present" — resending the same date is not
   *   treated as a change), a 'hearing_date_set' Notification is
   *   created via NotificationService, addressed to the current user,
   *   snapshotting the new hearing_date value (this is what makes the
   *   future cron job's dedup check, per NotificationRepository's own
   *   doc comment, actually work).
   *
   * See class-level doc comment for the accepted, not-solved
   * non-transactional risk between the repository update and the
   * notification creation below.
   */
  async updateDocument(rawParams: unknown, rawInput: unknown): Promise<DocumentRow> {
    const user = this.requireAuthentication();
    const { id } = documentIdParamSchema.parse(rawParams);
    const input = updateDocumentSchema.parse(rawInput);

    const existing = await this.documentRepository.findByIdOrThrow(id);

    if (existing.deleted_at !== null) {
      throw new NotFoundError('documents', id);
    }

    this.requireOwnership(existing.owner_id);

    const updatePayload: { title?: string; hearing_date?: string | null } = {};

    if (input.title !== undefined) {
      updatePayload.title = input.title;
    }

    // 'hearingDate' in input distinguishes "field omitted" (key absent
    // after Zod's .optional() parsing) from "field sent as null" — see
    // documentHearingDateSchema's doc comment in documents.schemas.ts
    // for why this check, not a truthiness check, is required here.
    const hearingDateFieldPresent = 'hearingDate' in input;
    let newHearingDateIso: string | null = existing.hearing_date;

    if (hearingDateFieldPresent) {
      newHearingDateIso = input.hearingDate === null ? null : input.hearingDate.toISOString();
      updatePayload.hearing_date = newHearingDateIso;
    }

    const updated = await this.documentRepository.update(id, updatePayload);

    const hearingDateActuallyChanged =
      hearingDateFieldPresent && newHearingDateIso !== existing.hearing_date;

    if (hearingDateActuallyChanged && newHearingDateIso !== null) {
      await this.notificationService.createNotification({
        userId: user.id,
        documentId: id,
        type: 'hearing_date_set',
        title: 'Hearing date set',
        message: `A hearing date was set for "${updated.title}".`,
        hearingDateSnapshot: newHearingDateIso,
      });
    }

    return updated;
  }

  /**
   * Soft-deletes a document. Owner-only. Fetches first so it can (a)
   * return a clean NotFoundError for an already-deleted document before
   * even reaching the repository, and (b) run the ownership check with a
   * real owner_id — DocumentRepository#delete's own guard against
   * double-delete is a second, independent line of defense, not a
   * substitute for this check.
   */
  async deleteDocument(rawParams: unknown): Promise<void> {
    this.requireAuthentication();
    const { id } = documentIdParamSchema.parse(rawParams);

    const existing = await this.documentRepository.findByIdOrThrow(id);

    if (existing.deleted_at !== null) {
      throw new NotFoundError('documents', id);
    }

    this.requireOwnership(existing.owner_id);

    await this.documentRepository.delete(id);
  }
}
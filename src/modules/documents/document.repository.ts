// src/modules/documents/document.repository.ts
// File 47 — JurisAI Legal Vault module
// Amendment #12: added createSignedDownloadUrl() for the download route (File 57).
// Amendment #14 (THIS SESSION): added findDueForHearingReminder() for the
// hearing-date-reminder cron route (Item #48, decision (a) — see that
// method's own doc comment).

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository, type FindManyOptions } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type DocumentRow = Database['public']['Tables']['documents']['Row'];

export interface DocumentFindManyOptions extends FindManyOptions {
  /**
   * When false/omitted (default), soft-deleted rows (`deleted_at IS NOT
   * NULL`) are excluded. Mirrors `listDocumentsQuerySchema`'s
   * `includeDeleted` flag (File 46) — this repository is the layer that
   * actually applies the filter, since BaseRepository#findMany has no
   * concept of soft delete at all (it's a generic, schema-agnostic base).
   */
  includeDeleted?: boolean;
}

/**
 * Must match the Storage bucket name created by File 45's migration
 * exactly — confirmed from documents.schemas.ts's own doc comments
 * (ALLOWED_MIME_TYPES / MAX_FILE_SIZE_BYTES), which independently
 * reference the same bucket name twice. Duplicated here rather than
 * imported from documents.schemas.ts, since that file is Zod-schema
 * concerns (application-layer validation), not a natural home for a
 * Storage-layer constant — same "flagged duplication, not silently
 * synced" tradeoff documents.schemas.ts's own comments already accept
 * for ALLOWED_MIME_TYPES/MAX_FILE_SIZE_BYTES.
 */
const DOCUMENTS_BUCKET = 'legal-vault-documents';

/**
 * Legal Vault's repository. Now buildable against real generated types —
 * `Database['public']['Tables']['documents']` matches File 45's migration
 * exactly (confirmed from the regenerated database.types.ts): id,
 * owner_id, title, storage_path, mime_type, size_bytes, deleted_at
 * (nullable), created_at, updated_at, hearing_date (nullable, added
 * File 174, confirmed live this session after the migration-history
 * repair).
 *
 * Extends BaseRepository<'documents'> and inherits findById,
 * findByIdOrThrow, create, and update as-is — none of those need
 * documents-specific behavior. findMany, count, and delete ARE
 * overridden; see each method's doc comment for why.
 *
 * RLS (File 45) scopes all reads/writes to `owner_id = auth.uid()` (plus
 * the admin `app_metadata` claim), so this repository never adds an
 * explicit `owner_id` filter itself — doing so would be redundant with
 * RLS today and would silently drift from it if the two policies were
 * ever changed independently. The Supabase client injected via the
 * constructor is what determines whose rows are visible; that decision
 * stays visible at the call site (future DocumentService / factory),
 * consistent with the pattern BaseRepository already establishes.
 *
 * ONE METHOD ON THIS CLASS NOW BREAKS THAT RULE DELIBERATELY —
 * findDueForHearingReminder() below is explicitly unscoped, for a
 * reason documented on the method itself. Every other method's
 * RLS-reliance is unchanged.
 */
export class DocumentRepository extends BaseRepository<'documents'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'documents');
  }

  /**
   * Overrides BaseRepository#findMany. Deliberately diverges from the
   * base class's default ("no filtering beyond pagination") behavior:
   * soft-deleted documents are excluded unless `includeDeleted` is
   * explicitly `true`. This is intentional, not an oversight — every
   * Legal Vault list view (and the future AI Document Analysis picker)
   * wants "my active documents" by default; viewing trash/recycle-bin
   * contents should be an explicit opt-in at the call site.
   *
   * Widening `FindManyOptions` with an extra optional property keeps
   * this a valid override under TypeScript's structural typing — any
   * existing caller passing plain `FindManyOptions` still compiles.
   */
  override async findMany(options?: DocumentFindManyOptions): Promise<DocumentRow[]> {
    let query = this.supabase.from('documents').select('*');

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    if (options?.limit != null) {
      const from = options.offset ?? 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to list documents', error, {
        table: this.tableName,
        options,
      });
    }

    return (data ?? []) as DocumentRow[];
  }

  /**
   * Overrides BaseRepository#count with the same includeDeleted
   * semantics as findMany above, so a pagination UI's "N of M" total
   * actually matches what findMany would return for the same filter.
   */
 override async count(options?: { includeDeleted?: boolean }): Promise<number> {
    let query = this.supabase.from('documents').select('*', { count: 'exact', head: true });

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { count, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to count documents', error, {
        table: this.tableName,
        options,
      });
    }

    return count ?? 0;
  }

  /**
   * Overrides BaseRepository#delete. Documents are soft-deleted (File 45,
   * D16): this sets `deleted_at` rather than issuing a SQL DELETE, for
   * the audit-trail reason the base class's own delete() doc comment
   * already calls out, naming Documents as the example.
   *
   * Guards against double soft-delete: the `.is('deleted_at', null)`
   * clause means an already-deleted (or nonexistent / RLS-invisible)
   * document matches zero rows, and `.maybeSingle()` returns `null`
   * rather than erroring — which this method turns into a NotFoundError.
   * A second "delete" of an already-deleted document is treated as an
   * error, not a silent no-op, so callers can't lose track of state.
   */
  override async delete(id: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to soft-delete document', error, {
        table: this.tableName,
        id,
      });
    }

    if (!data) {
      throw new NotFoundError(String(this.tableName), id);
    }
  }

  /**
   * NEW — Amendment #12. Generates a time-limited signed URL for
   * downloading a document's underlying file from Storage.
   *
   * Deliberately pure data-layer: this method does NOT check whether
   * `storagePath` belongs to a document the current actor is allowed to
   * see, nor whether that document is soft-deleted. That's the future
   * DocumentService#getDownloadUrl's job (it must call
   * findByIdOrThrow + the same deleted_at check getDocumentById already
   * does, BEFORE ever calling this method) — mirrors this repository's
   * existing division of labor, where authorization lives one layer up.
   * Calling this directly with an arbitrary storagePath, bypassing that
   * check, would defeat Legal Vault's entire RLS-based visibility model
   * for the one operation that doesn't go through a `.from('documents')`
   * query and therefore isn't RLS-scoped at all — Storage signed URLs
   * are generated by the Storage API, not filtered by Postgres RLS on
   * the `documents` table.
   *
   * `expiresInSeconds` defaults to 300 (5 minutes) — long enough for a
   * real download to start on a slow connection, short enough that a
   * leaked/logged URL has a small blast radius. No policy source
   * confirms this number (no File 45 Storage-policy detail on link
   * lifetime was ever pasted) — it's a reasonable default, not a
   * verified requirement; revisit if a real product requirement for
   * link lifetime surfaces.
   *
   * KNOWN IMPRECISION, flagged not hidden: Storage failures here are
   * wrapped as DatabaseError, matching every other error in this file —
   * but DatabaseError's own doc comment describes it as wrapping
   * Postgrest errors specifically, and Storage is a different Supabase
   * subsystem. File 40's route (pasted earlier this session) implies a
   * more precise `ExternalServiceError` class exists for exactly this
   * kind of non-Postgrest Supabase failure, but its real constructor
   * signature has never been seen in this session (only mentioned in a
   * comment) — reusing DatabaseError's verified signature here rather
   * than guessing at an unseen one. Revisit once app-error.ts (File 10)
   * is pasted.
   */
  async createSignedDownloadUrl(
    storagePath: string,
    expiresInSeconds: number = 300,
  ): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) {
      throw new DatabaseError(
        'Failed to create signed download URL',
        error ?? new Error('Storage returned no data for signed URL request'),
        { bucket: DOCUMENTS_BUCKET, storagePath },
      );
    }

    return data.signedUrl;
  }

  /**
   * NEW — Amendment #14, THIS SESSION. Supports the hearing-date-reminder
   * cron route (Item #48, resolved this session as decision (a): the
   * cron route calls DocumentRepository/NotificationRepository directly
   * under admin.ts, bypassing DocumentService/NotificationService
   * entirely, since a Vercel Cron invocation has no requesting user for
   * a currentUser-requiring Service to act as).
   *
   * DELIBERATELY NOT OWNER-SCOPED — the one method on this class that
   * isn't. Every other method here relies on the injected Supabase
   * client's RLS policy (owner_id = auth.uid()) to narrow visibility;
   * this method is meant to run ONLY under admin.ts's service-role
   * client, which bypasses RLS by design. Cross-tenant access here is
   * correct and necessary — the cron job's entire job is to look across
   * every user's documents for ones with a hearing_date due for a
   * reminder. Calling this with an RLS-scoped (server.ts) client would
   * silently under-return (only that one user's own documents), not
   * error — flagged so a future caller doesn't reach for this outside
   * admin.ts by mistake.
   *
   * "Due for a reminder on `reminderDate`" is defined as: hearing_date
   * falls on reminderDate's UTC calendar date, and the document is not
   * soft-deleted. Matches File 174's partial index
   * (documents_hearing_date_active_idx, `WHERE hearing_date IS NOT NULL
   * AND deleted_at IS NULL`) for the not-null/not-deleted narrowing —
   * the actual date-range comparison is not baked into the index itself,
   * just the two boolean conditions.
   *
   * FLAGGED, NOT A CONFIRMED PRODUCT DECISION: compares hearing_date
   * against reminderDate using UTC calendar dates. Same timezone-naive
   * caveat already flagged for File 160's `isoToDateInputValue()` (Item
   * #54) — if "N days before" is meant to be computed in IST rather than
   * UTC, a hearing_date near midnight IST could match a day early or
   * late relative to what a user in India would expect. Not silently
   * assumed correct; revisit together if a reminder ever fires on the
   * wrong day.
   */
  async findDueForHearingReminder(reminderDate: Date): Promise<DocumentRow[]> {
    const startOfDayUtc = new Date(
      Date.UTC(
        reminderDate.getUTCFullYear(),
        reminderDate.getUTCMonth(),
        reminderDate.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const startOfNextDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .gte('hearing_date', startOfDayUtc.toISOString())
      .lt('hearing_date', startOfNextDayUtc.toISOString());

    if (error) {
      throw new DatabaseError('Failed to find documents due for a hearing reminder', error, {
        table: this.tableName,
        reminderDate: reminderDate.toISOString(),
      });
    }

    return (data ?? []) as DocumentRow[];
  }

  /**
   * NEW — added for the Observability module (Phase 3). Second of the
   * four sequential hops in Observability's firm-scoped query path
   * (profiles -> owner ids -> documents -> document_analyses -> each
   * module repo), needed because `documents.owner_id` has no FK to
   * `profiles.id` (this file's own header comment / RLS note already
   * establishes that ownership is enforced by RLS, not a joinable FK) —
   * so a firm's document set cannot be reached via a single embedded
   * Postgrest call starting from `profiles`. This method is the
   * `owner_id IN (...)` fetch that closes that gap.
   *
   * DELIBERATELY UNSCOPED — same class of exception as
   * findDueForHearingReminder() above, and for the same reason: this
   * method is meant to run ONLY under admin.ts's service-role client.
   * Every other method on this class relies on the injected client's RLS
   * policy (owner_id = auth.uid()) to narrow visibility to the calling
   * user; this one is explicitly given a list of owner ids to cross,
   * which only makes sense for a caller (Observability's firm-owner or
   * admin view) that has already resolved those ids itself (e.g. via
   * ProfileRepository#findByFirmId) and is authorized to see all of
   * them at once. Calling this with an RLS-scoped (server.ts) client
   * would silently under-return rather than error — flagged so a future
   * caller doesn't reach for this outside admin.ts by mistake, same
   * warning findDueForHearingReminder's own doc comment gives.
   *
   * Excludes soft-deleted documents by default, matching this class's
   * own findMany()/count() default (`includeDeleted` opt-in) rather than
   * introducing a different default for this one method — nothing in
   * Observability's confirmed scope (run-history/failure visibility, NOT
   * a trash/recycle-bin view) calls for surfacing deleted documents.
   *
   * Returns an empty array (not an error) when `ownerIds` is empty,
   * matching Postgrest's own `.in()` semantics for an empty list — a
   * firm with zero members should read as "zero documents", not throw.
   */
  async findManyForOwnerIds(
    ownerIds: string[],
    options?: { includeDeleted?: boolean },
  ): Promise<DocumentRow[]> {
    if (ownerIds.length === 0) {
      return [];
    }

    let query = this.supabase.from('documents').select('*').in('owner_id', ownerIds);

    if (!options?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data, error } = await query;

    if (error) {
      throw new DatabaseError('Failed to find documents for owner ids', error, {
        table: this.tableName,
        ownerIds,
        options,
      });
    }

    return (data ?? []) as DocumentRow[];
  }
}
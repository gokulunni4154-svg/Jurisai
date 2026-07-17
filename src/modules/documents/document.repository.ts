// src/modules/documents/document.repository.ts
// File 47 — JurisAI Legal Vault module
// Amendment #12: added createSignedDownloadUrl() for the download route (File 57).

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
 * (nullable), created_at, updated_at.
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
}
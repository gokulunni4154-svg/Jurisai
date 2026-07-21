// src/modules/document-sets/document-set.repository.ts
// Multi-document module — File number not yet assigned.
//
// FLAGGED ASSUMPTION, same idiom as ai-legal-insight.service.ts's own
// carried-forward flag on BaseService: BaseRepository's real source was
// verified in a prior session (per the continuation prompt's verified-
// files list), not re-pasted this session. Its generic create()/
// findById()/findByIdOrThrow()/update()/delete() are inferred — from
// every other module's consistent usage — to key off a single literal
// `id` column via `.eq('id', ...)`. That inference is the reason this
// file is split the way it is below.
//
// REAL ARCHITECTURE CONSTRAINT, not silently resolved: document_sets has
// a normal single `id` primary key, so DocumentSetRepository extends
// BaseRepository<'document_sets'> normally and inherits create/findById/
// findByIdOrThrow/findMany/count/delete unchanged — no soft-delete
// concept exists on this table (per the migration's own header), so
// unlike DocumentRepository, none of those need overriding here.
//
// document_set_members, by contrast, has a COMPOSITE primary key
// (document_set_id, document_id) — no `id` column at all. Extending
// BaseRepository<'document_set_members'> would not compile against that
// shape (there is no `.id` for findById/findByIdOrThrow to key off), so
// membership methods below are bespoke — same class of exception
// DocumentRepository's own createSignedDownloadUrl() already sets a
// precedent for (a method that talks to something outside the generic
// CRUD shape, kept on the same repository rather than forcing a second
// class to extend a base it doesn't fit). Kept on THIS class rather than
// a separate DocumentSetMemberRepository, since every membership
// operation is only ever reached through a document_sets id in practice
// (the Service layer never looks up a membership row independent of its
// parent set) — a separate class would just be an extra file with no
// caller that needs it standalone. Revisit if that stops being true.
//
// RLS-ONLY, NO ADMIN CLIENT NEEDED — unlike Observability's cross-tenant
// reads, every method on this class (both document_sets and
// document_set_members) is owner-scoped entirely through RLS (see the
// migration's own policies), so this repository is always constructed
// with the standard RLS-respecting client, same as DocumentRepository
// and DocumentAnalysisRepository's own default posture.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type DocumentSetRow = Database['public']['Tables']['document_sets']['Row'];
type DocumentRow = Database['public']['Tables']['documents']['Row'];

export class DocumentSetRepository extends BaseRepository<'document_sets'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'document_sets');
  }

  /**
   * Lists all document_sets owned by the current caller (per RLS — no
   * explicit owner_id filter added here, same reasoning DocumentRepository
   * and DocumentAnalysisRepository already document: the injected client
   * determines visibility, this repository doesn't duplicate that logic).
   * Thin wrapper over the inherited findMany() — kept as a named method
   * rather than calling findMany() directly at call sites, purely for
   * readability at the Service layer; no behavior difference from the
   * inherited method.
   */
  async findManyForOwner(): Promise<DocumentSetRow[]> {
    return this.findMany();
  }

  /**
   * Adds a document to a set. Bespoke — see file header on why this
   * doesn't go through inherited create(). Relies entirely on
   * document_set_members' own RLS policy (document_set_members_insert_own)
   * to reject adding to a set the caller doesn't own; this method
   * performs no ownership check of its own, same "RLS is the boundary,
   * repository doesn't re-implement it" posture as every other method in
   * this file.
   *
   * DELIBERATELY DOES NOT CHECK that `documentId` itself is owned by the
   * caller — see the migration's own flagged note on
   * document_set_members' RLS: that check is the Service layer's job
   * (future DocumentSetService#addDocumentToSet), not this repository's
   * or the database's. Calling this directly with an arbitrary
   * documentId the caller doesn't own would succeed at this layer.
   *
   * Idempotent by construction: the composite primary key means adding
   * the same (documentSetId, documentId) pair twice is a real Postgres
   * unique-violation, not a silent duplicate. NOT caught/swallowed here —
   * surfaces as a DatabaseError, same as every other constraint violation
   * in this project's repositories. Flag if "adding an already-member
   * document should silently succeed" turns out to be the wanted UX; that
   * would need an .upsert() or an explicit pre-check instead.
   */
  async addMember(documentSetId: string, documentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('document_set_members')
      .insert({ document_set_id: documentSetId, document_id: documentId } as never);

    if (error) {
      throw new DatabaseError('Failed to add document to document set', error, {
        documentSetId,
        documentId,
      });
    }
  }

  /**
   * Removes a document from a set. Bespoke, same reasoning as addMember.
   * Deliberately does NOT throw NotFoundError if the pair didn't exist —
   * unlike DocumentRepository#delete's double-soft-delete guard, removing
   * a non-member is treated as an idempotent no-op here, not an error
   * condition, since "make sure X is not in this set" is the more natural
   * caller intent than "assert X was in this set." Flag if the Service
   * layer needs the stricter behavior instead.
   */
  async removeMember(documentSetId: string, documentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('document_set_members')
      .delete()
      .eq('document_set_id', documentSetId)
      .eq('document_id', documentId);

    if (error) {
      throw new DatabaseError('Failed to remove document from document set', error, {
        documentSetId,
        documentId,
      });
    }
  }

  /**
   * Returns the full document rows (not just ids) for every member of a
   * set, via an embedded Postgrest call through document_set_members —
   * same embedded-join technique Observability's findManyForAdminView()
   * methods already use elsewhere in this project. Needed by the future
   * bulk-analysis trigger (needs each member document's storage_path /
   * mime_type to run analysis, not just its id) and by the synthesis step
   * (needs document titles for prompt context).
   *
   * RLS-scoped through document_set_members' own select policy (which
   * itself checks document_sets.owner_id) — a documentSetId the caller
   * doesn't own returns an empty array here, not an error, matching this
   * project's established "RLS narrows to nothing, not a thrown error"
   * convention for reads.
   */
  async findMemberDocuments(documentSetId: string): Promise<DocumentRow[]> {
    const { data, error } = await this.supabase
      .from('document_set_members')
      .select('documents(*)')
      .eq('document_set_id', documentSetId);

    if (error) {
      throw new DatabaseError('Failed to list member documents for document set', error, {
        documentSetId,
      });
    }

    // FLAGGED, UNVERIFIED SHAPE: Postgrest's embedded-select return shape
    // for a to-one relationship (document_set_members -> documents, via
    // document_id) is a single nested object per row, not an array — but
    // this has not been independently confirmed against this project's
    // real Supabase client version the way document-analysis.repository.ts
    // confirmed its own embedded calls. Cast mirrors the pattern the rest
    // of this codebase already accepts for Postgrest-shape assumptions
    // (see document-analysis.repository.ts's `as never` precedent) rather
    // than inventing a stricter runtime check unverified elsewhere in this
    // project. Revisit if this doesn't compile or returns an unexpected
    // shape against the real generated types.
    return (data ?? []).map((row) => (row as unknown as { documents: DocumentRow }).documents);
  }

  /**
   * Returns just the member document ids for a set — a lighter-weight
   * alternative to findMemberDocuments() for callers that only need ids
   * (e.g. an authorization check confirming a specific documentId is a
   * member before letting an operation proceed), not full rows.
   */
  async findMemberDocumentIds(documentSetId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('document_set_members')
      .select('document_id')
      .eq('document_set_id', documentSetId);

    if (error) {
      throw new DatabaseError('Failed to list member document ids for document set', error, {
        documentSetId,
      });
    }

    return (data ?? []).map((row) => row.document_id);
  }
}
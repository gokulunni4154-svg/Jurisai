// src/modules/cases/case.repository.ts
// Case Access Grants — Phase 4. Built directly against the real, pasted
// document-sets.repository.ts for both the base-CRUD shape and the
// "fold membership methods into the parent repository" decision (see
// that file's own header): case_documents, like document_set_members,
// has a COMPOSITE primary key (case_id, document_id) and no `id`
// column, so it can't extend BaseRepository on its own. Folded onto
// CaseRepository rather than a separate CaseDocumentRepository, for the
// identical reason document-sets.repository.ts gives: every
// case_documents operation is only ever reached through a case id in
// practice.
//
// RLS-ONLY, NO ADMIN CLIENT: cases and case_documents both kept
// client-write RLS policies (20260808000000_create_case_access_grants.sql
// sec5/sec6) -- unlike case_access_grants, which went service-layer-only
// (see case-access-grant.repository.ts). This repository is always
// constructed with the standard RLS-respecting client, WITH ONE NAMED
// EXCEPTION -- see findByFirmId() below, added for the Firm Dashboard
// (Phase 4, this session), which is deliberately constructed against
// the admin client by its own factory instead.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError } from '@/core/errors/app-error';
import { BaseRepository } from '@/core/repositories/base.repository';
import type { Database } from '@/core/supabase/database.types';

type CaseRow = Database['public']['Tables']['cases']['Row'];
type DocumentRow = Database['public']['Tables']['documents']['Row'];

export class CaseRepository extends BaseRepository<'cases'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'cases');
  }

  /**
   * Lists every case visible to the caller under RLS (own cases, cases
   * with an active grant, or firm-admin/platform-admin override) -- no
   * explicit filter added here, same "the injected client determines
   * visibility" posture as DocumentSetRepository#findManyForOwner().
   */
  async findManyVisible(): Promise<CaseRow[]> {
    return this.findMany();
  }

  /**
   * NEW, Phase 4 — Firm Dashboard. Every case belonging to a firm,
   * most recent first. Unlike findManyVisible() above, this method does
   * NOT rely on RLS to narrow results to what the caller can see --
   * cases' real RLS policies were not re-confirmed this session for a
   * firm-wide, cross-member query shape (only the class-header comment
   * claims a firm-admin override exists, which is inherited text, not
   * independently re-verified against pasted RLS SQL this session).
   *
   * FLAGGED, NEW DECISION: because of that, this method is intended to
   * be called ONLY from a repository instance constructed against the
   * ADMIN client (see firm-dashboard.factory.ts), with authorization
   * enforced entirely at the Service layer (FirmDashboardService's own
   * requireManageAccess(firmId) gate) instead of leaning on RLS. This
   * repository itself does not know or care which client it was built
   * with -- same "repository trusts its constructor" posture as every
   * other repository in this project -- but callers must not use this
   * method against an RLS-scoped client and assume it's narrowed to
   * "cases I can see"; it returns every case row for the firm, full
   * stop.
   */
  async findByFirmId(firmId: string): Promise<CaseRow[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list cases for firm', error, {
        table: this.tableName,
        firmId,
      });
    }

    return data ?? [];
  }

  /**
   * Adds a document to a case. Bespoke -- see file header. Relies
   * entirely on case_documents' own RLS insert policy to reject adding
   * to a case the caller can't write to; this method performs no
   * ownership check of its own, matching
   * DocumentSetRepository#addMember's identical posture.
   *
   * DELIBERATELY DOES NOT CHECK that `documentId` is owned by the
   * caller -- same split as document_set_members: that's the Service
   * layer's job (CaseService#addDocumentToCase), not this repository's.
   */
  async addMember(caseId: string, documentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('case_documents')
      .insert({ case_id: caseId, document_id: documentId } as never);

    if (error) {
      throw new DatabaseError('Failed to add document to case', error, {
        caseId,
        documentId,
      });
    }
  }

  /**
   * Removes a document from a case. Idempotent no-op if the pair didn't
   * exist -- same reasoning as DocumentSetRepository#removeMember.
   */
  async removeMember(caseId: string, documentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('case_documents')
      .delete()
      .eq('case_id', caseId)
      .eq('document_id', documentId);

    if (error) {
      throw new DatabaseError('Failed to remove document from case', error, {
        caseId,
        documentId,
      });
    }
  }

  /**
   * Returns the full document rows for every member of a case, via an
   * embedded Postgrest call through case_documents -- identical
   * technique and identical UNVERIFIED-SHAPE flag as
   * DocumentSetRepository#findMemberDocuments.
   */
  async findMemberDocuments(caseId: string): Promise<DocumentRow[]> {
    const { data, error } = await this.supabase
      .from('case_documents')
      .select('documents(*)')
      .eq('case_id', caseId);

    if (error) {
      throw new DatabaseError('Failed to list member documents for case', error, {
        caseId,
      });
    }

    // FLAGGED, UNVERIFIED SHAPE -- same caveat as
    // document-sets.repository.ts#findMemberDocuments: cast mirrors that
    // file's accepted pattern rather than inventing a stricter check.
    return (data ?? []).map((row) => (row as unknown as { documents: DocumentRow }).documents);
  }

  /**
   * Returns just the member document ids for a case -- lighter-weight
   * alternative to findMemberDocuments(), same purpose as
   * DocumentSetRepository#findMemberDocumentIds.
   */
  async findMemberDocumentIds(caseId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('case_documents')
      .select('document_id')
      .eq('case_id', caseId);

    if (error) {
      throw new DatabaseError('Failed to list member document ids for case', error, {
        caseId,
      });
    }

    return (data ?? []).map((row) => row.document_id);
  }
}
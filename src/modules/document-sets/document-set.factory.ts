// src/modules/document-sets/document-set.factory.ts
// Multi-document module — File number not yet assigned.
//
// Built directly against the real, pasted audit-log.factory.ts for the
// construction pattern: currentUser and the RLS-scoped supabase client
// resolved once, shared across every repository's construction.
//
// SIMPLER SHAPE THAN audit-log.factory.ts's OWN — that factory needs both
// the RLS-respecting client (FirmRepository) and the admin client
// (AuditLogRepository, no RLS policy exists for that table at all).
// DocumentSetService needs only the RLS-respecting client for all three
// repositories it depends on — document_sets, document_set_analyses, and
// documents all have real RLS policies covering every operation this
// module performs (confirmed via each table's own migration: the two
// pasted this session, plus document.repository.ts's own header
// confirming documents' RLS is ownership-based, not admin-client-only,
// for the methods this service actually calls). No cross-tenant read
// exists anywhere in DocumentSetService — unlike Observability, this
// module never needs to look across other users' data.

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';

import { DocumentSetService } from './document-set.service';
import { DocumentSetRepository } from './document-set.repository';
import { DocumentSetAnalysisRepository } from './document-set-analysis.repository';

export async function buildDocumentSetService(): Promise<DocumentSetService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const documentSetRepository = new DocumentSetRepository(supabase);
  const documentSetAnalysisRepository = new DocumentSetAnalysisRepository(supabase);
  const documentRepository = new DocumentRepository(supabase);

  return new DocumentSetService(
    currentUser,
    documentSetRepository,
    documentSetAnalysisRepository,
    documentRepository,
  );
}
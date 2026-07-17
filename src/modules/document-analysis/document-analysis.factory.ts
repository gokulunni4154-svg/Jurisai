// src/modules/document-analysis/document-analysis.factory.ts
// File 66 — JurisAI Document Analysis module

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentService } from '@/modules/documents/document.service';

import { DocumentAnalysisRepository } from './document-analysis.repository';
import { DocumentAnalysisService } from './document-analysis.service';

/**
 * Constructs a request-scoped DocumentAnalysisService.
 *
 * Follows buildDocumentService()'s (File 49) pattern exactly for the
 * parts that are identical: resolve the current user once via
 * getCurrentUser() (File 20), construct one fresh request-scoped
 * Supabase client via createClient() (File 14, confirmed async — bridges
 * to next/headers' cookies()), never cache either at module scope.
 *
 * KEY DECISION — DocumentService is constructed directly here (a fresh
 * DocumentRepository + DocumentService, reusing the SAME currentUser and
 * supabase client as analysisRepository below) rather than calling
 * buildDocumentService() itself.
 *
 * Tradeoff: this duplicates buildDocumentService()'s own two-line
 * construction logic in a second place rather than reusing it — a real
 * cost if that logic ever grows more complex and the two copies drift.
 * Against that: calling buildDocumentService() here would resolve
 * getCurrentUser() and createClient() a second, independent time within
 * the same request-scoped operation — meaning DocumentAnalysisService
 * could theoretically end up authorizing against a subtly different
 * currentUser than the one its own analysisRepository was constructed
 * with (e.g. if session state changed between the two resolutions,
 * however unlikely in practice), and would spend an extra cookie-store
 * read + auth round-trip for no benefit within a single request. One
 * shared resolution, injected consistently into every dependency this
 * factory builds, was chosen for that consistency guarantee over
 * reuse-via-composition. Worth revisiting if buildDocumentService()'s
 * construction logic ever grows complex enough that duplication becomes
 * the bigger risk than redundant resolution.
 *
 * Same RLS note as document.factory.ts: createClient() (File 14) is the
 * RLS-respecting client. Never admin.ts (File 17) here — both
 * DocumentService's and DocumentAnalysisRepository's visibility models
 * depend on that.
 */
export async function buildDocumentAnalysisService(): Promise<DocumentAnalysisService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const analysisRepository = new DocumentAnalysisRepository(supabase);

  const documentRepository = new DocumentRepository(supabase);
  const documentService = new DocumentService(currentUser, documentRepository);

  return new DocumentAnalysisService(currentUser, analysisRepository, documentService);
}
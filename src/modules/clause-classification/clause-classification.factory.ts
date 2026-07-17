// src/modules/clause-classification/clause-classification.factory.ts
// File 97 — JurisAI Clause Classification module

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentService } from '@/modules/documents/document.service';
import { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';

import { ClauseClassificationRepository } from './clause-classification.repository';
import { ClauseClassificationService } from './clause-classification.service';

/**
 * Constructs a request-scoped ClauseClassificationService.
 *
 * Follows buildDocumentAnalysisService()'s (File 66) pattern exactly:
 * resolve the current user once via getCurrentUser() (File 20), construct
 * one fresh request-scoped Supabase client via createClient() (File 14,
 * async), never cache either at module scope.
 *
 * KEY DECISION — DocumentService AND DocumentAnalysisService are both
 * constructed directly here, reusing the SAME currentUser and supabase
 * client as classificationRepository below, rather than calling
 * buildDocumentService() or buildDocumentAnalysisService() themselves.
 * Identical reasoning to File 66's own "KEY DECISION": calling either
 * builder here would resolve getCurrentUser() and createClient() a
 * second (or third) independent time within the same request-scoped
 * operation, risking ClauseClassificationService authorizing against a
 * subtly different currentUser than the one its own dependencies were
 * built with, plus redundant cookie-store reads. This duplicates
 * buildDocumentAnalysisService()'s and buildDocumentService()'s own
 * two-line construction logic a second time — same accepted tradeoff,
 * one layer deeper in the pipeline now (Clause Classification depends on
 * Document Analysis, which itself depends on Documents).
 *
 * RLS note, now safe to state without caveats: createClient() (File 14)
 * is the RLS-respecting client, used for every dependency built here —
 * reads and writes alike. This was NOT safely true for the equivalent
 * document_analyses/ocr_extractions pattern until the
 * 20260715055158_add_write_policies_to_ai_pipeline_tables.sql migration
 * closed the missing-INSERT/UPDATE-policy gap those two tables shared;
 * clause_classifications received its own equivalent policies in that
 * same migration, so this factory can mirror File 66's "never admin.ts
 * here" rule with the same confidence File 66 always had, on solid
 * ground rather than inherited risk.
 */
export async function buildClauseClassificationService(): Promise<ClauseClassificationService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const classificationRepository = new ClauseClassificationRepository(supabase);

  const documentRepository = new DocumentRepository(supabase);
  const documentService = new DocumentService(currentUser, documentRepository);

  const analysisRepository = new DocumentAnalysisRepository(supabase);
  const analysisService = new DocumentAnalysisService(currentUser, analysisRepository, documentService);

  return new ClauseClassificationService(
    currentUser,
    classificationRepository,
    analysisService,
    documentService,
  );
}
// src/modules/risk-detection/risk-detection.factory.ts
// File 105 — JurisAI Risk Detection module

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentService } from '@/modules/documents/document.service';
import { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import { ClauseClassificationRepository } from '@/modules/clause-classification/clause-classification.repository';
import { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';

import { RiskDetectionRepository } from './risk-detection.repository';
import { RiskDetectionService } from './risk-detection.service';

/**
 * Constructs a request-scoped RiskDetectionService.
 *
 * Follows buildClauseClassificationService()'s (File 97) pattern
 * exactly, one dependency layer deeper: resolve the current user once
 * via getCurrentUser(), construct one fresh request-scoped Supabase
 * client via createClient() (async), never cache either at module
 * scope.
 *
 * KEY DECISION — ClauseClassificationService is constructed directly
 * here (ClauseClassificationRepository + ClauseClassificationService),
 * reusing the SAME currentUser and supabase client as every other
 * dependency below, rather than calling
 * buildClauseClassificationService() itself. This is the question File
 * 105 was explicitly asked to resolve, and the answer follows File 97's
 * own KEY DECISION with no modification needed: calling
 * buildClauseClassificationService() here would resolve
 * getCurrentUser() and createClient() a second independent time within
 * this same request-scoped operation, risking RiskDetectionService
 * authorizing against a subtly different currentUser than the rest of
 * its own dependency graph was built with, plus a redundant
 * cookie-store read. The chain is now five layers deep (Documents ->
 * Document Analysis -> Clause Classification -> Risk Detection), so
 * this matters more here than at any prior layer: a single re-resolved
 * currentUser at this depth would silently diverge across three or
 * four constructed services at once, not just two.
 *
 * This necessarily duplicates buildClauseClassificationService()'s own
 * two-line construction logic a second time, on top of the
 * DocumentService/DocumentAnalysisService duplication File 97 already
 * accepted — same tradeoff, one layer deeper. Flagged duplication over
 * silent-drift risk, consistent with every prior factory in this
 * project.
 *
 * DocumentService and DocumentAnalysisService are constructed directly
 * for the identical reason File 97 gives — not via buildDocumentService()
 * or buildDocumentAnalysisService(), to avoid a third/fourth independent
 * resolution of getCurrentUser()/createClient().
 */
export async function buildRiskDetectionService(): Promise<RiskDetectionService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const riskDetectionRepository = new RiskDetectionRepository(supabase);

  const documentRepository = new DocumentRepository(supabase);
  const documentService = new DocumentService(currentUser, documentRepository);

  const analysisRepository = new DocumentAnalysisRepository(supabase);
  const analysisService = new DocumentAnalysisService(currentUser, analysisRepository, documentService);

  const classificationRepository = new ClauseClassificationRepository(supabase);
  const classificationService = new ClauseClassificationService(
    currentUser,
    classificationRepository,
    analysisService,
    documentService,
  );

  return new RiskDetectionService(
    currentUser,
    riskDetectionRepository,
    analysisService,
    documentService,
    classificationService,
  );
}
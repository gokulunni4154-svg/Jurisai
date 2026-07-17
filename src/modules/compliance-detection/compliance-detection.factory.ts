// src/modules/compliance-detection/compliance-detection.factory.ts
// File 121 — JurisAI Compliance Detection module

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentService } from '@/modules/documents/document.service';
import { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import { ClauseClassificationRepository } from '@/modules/clause-classification/clause-classification.repository';
import { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';

import { ComplianceDetectionRepository } from './compliance-detection.repository';
import { ComplianceDetectionService } from './compliance-detection.service';

/**
 * Constructs a request-scoped ComplianceDetectionService.
 *
 * Follows buildMissingClauseDetectionService()'s (File 113) and
 * buildRiskDetectionService()'s (File 105) pattern exactly, at the same
 * dependency depth: resolve the current user once via getCurrentUser(),
 * construct one fresh request-scoped Supabase client via createClient()
 * (async), never cache either at module scope.
 *
 * KEY DECISION — ClauseClassificationService is constructed directly
 * here (ClauseClassificationRepository + ClauseClassificationService),
 * reusing the SAME currentUser and supabase client as every other
 * dependency below, rather than calling
 * buildClauseClassificationService() itself. Identical reasoning to File
 * 113's own KEY DECISION, which itself followed File 105's and File
 * 97's: calling buildClauseClassificationService() here would resolve
 * getCurrentUser() and createClient() a second independent time within
 * this same request-scoped operation, risking ComplianceDetectionService
 * authorizing against a subtly different currentUser than the rest of
 * its own dependency graph was built with, plus a redundant
 * cookie-store read. Compliance Detection sits at the same depth as
 * Risk Detection and Missing Clause Detection (a sibling under Document
 * Analysis, per File 116's own KEY DECISION), not one layer deeper than
 * either — so this factory's shape is a direct repeat of File 113's and
 * File 105's, not an extension of them.
 *
 * This necessarily duplicates ClauseClassificationService's own
 * two-line construction logic a fourth time now (File 97 -> File 105 ->
 * File 113 -> here), on top of the DocumentService/DocumentAnalysisService
 * duplication File 97 already accepted — same tradeoff, repeated at the
 * same depth. Flagged duplication over silent-drift risk, consistent
 * with every prior factory in this project.
 *
 * DocumentService and DocumentAnalysisService are constructed directly
 * for the identical reason File 97, File 105, and File 113 all give —
 * not via buildDocumentService() or buildDocumentAnalysisService(), to
 * avoid a third/fourth independent resolution of
 * getCurrentUser()/createClient().
 */
export async function buildComplianceDetectionService(): Promise<ComplianceDetectionService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const complianceDetectionRepository = new ComplianceDetectionRepository(supabase);

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

  return new ComplianceDetectionService(
    currentUser,
    complianceDetectionRepository,
    analysisService,
    documentService,
    classificationService,
  );
}
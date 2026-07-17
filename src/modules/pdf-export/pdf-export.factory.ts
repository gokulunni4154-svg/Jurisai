// src/modules/pdf-export/pdf-export.factory.ts
// File 167 — JurisAI PDF Export module

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentService } from '@/modules/documents/document.service';
import { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import { ClauseClassificationRepository } from '@/modules/clause-classification/clause-classification.repository';
import { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import { RiskDetectionRepository } from '@/modules/risk-detection/risk-detection.repository';
import { RiskDetectionService } from '@/modules/risk-detection/risk-detection.service';
import { MissingClauseDetectionRepository } from '@/modules/missing-clause-detection/missing-clause-detection.repository';
import { MissingClauseDetectionService } from '@/modules/missing-clause-detection/missing-clause-detection.service';
import { ComplianceDetectionRepository } from '@/modules/compliance-detection/compliance-detection.repository';
import { ComplianceDetectionService } from '@/modules/compliance-detection/compliance-detection.service';
import { AIRecommendationRepository } from '@/modules/ai-recommendation/ai-recommendation.repository';
import { AIRecommendationService } from '@/modules/ai-recommendation/ai-recommendation.service';

import { PdfExportRepository } from './pdf-export.repository';
import { PdfExportService } from './pdf-export.service';
import { LegalHealthScoreRepository } from '@/modules/legal-health-score/legal-health-score.repository';
import { LegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.service';

/**
 * Constructs a request-scoped PdfExportService.
 *
 * Follows buildLegalHealthScoreService()'s (File 137) and every other
 * sibling factory's unanimous pattern: resolve the current user once via
 * getCurrentUser(), construct one fresh request-scoped Supabase client
 * via createClient() (async), never cache either at module scope.
 *
 * KEY DECISION, RESOLVES THE OPEN QUESTION FLAGGED BEFORE FILE 166 WAS
 * PASTED — the Storage-capable `supabase` argument PdfExportService's
 * constructor takes (its own class-level doc comment: "must be the
 * RLS-respecting server.ts client acting as the requesting user — never
 * admin.ts") is the SAME client instance constructed once below and
 * already passed to PdfExportRepository, DocumentRepository,
 * DocumentAnalysisRepository, etc. — not a second, separately-constructed
 * client. This is consistent with every other dependency in this
 * factory sharing one resolution, and is exactly what File 166's own
 * doc comment describes ("who calls createClient() stays in exactly one
 * place — the Factory"). No second Supabase client is ever constructed
 * here.
 *
 * KEY DECISION — LegalHealthScoreService is constructed directly here,
 * reusing File 137's own body verbatim as far as its own inline-
 * constructed dependency graph goes (documentService, analysisService,
 * classificationService, riskDetectionService,
 * missingClauseDetectionService, complianceDetectionService,
 * aiRecommendationService — all seven of File 137's own arguments), NOT
 * via buildLegalHealthScoreService() itself. Same reasoning as every
 * sibling factory's identical KEY DECISION: calling
 * buildLegalHealthScoreService() here would resolve getCurrentUser()
 * and createClient() a second, independent time within this same
 * request-scoped operation, risking PdfExportService authorizing
 * against a subtly different currentUser than the rest of its own
 * dependency graph, plus a redundant cookie-store read.
 *
 * CONSEQUENCE, stated explicitly rather than left implicit — building
 * LegalHealthScoreService directly here means reconstructing its own
 * entire six-service dependency graph inline first (mirroring File
 * 137's body exactly), one layer deeper than File 137's own
 * AIRecommendationService reconstruction. ClauseClassificationService's
 * two-line construction is now duplicated independently in TWO places
 * within this one factory (once directly for PdfExportService's own use,
 * once again inside the inline LegalHealthScoreService construction) —
 * unlike every prior factory, which only ever needed one instance of
 * each sibling service. Both instances share the same currentUser/
 * supabase pair, so they are behaviorally identical, just two separate
 * object instances. Flagged duplication over silent-drift risk,
 * consistent with every prior factory in this project, now at PDF
 * Export's own scale: two of Clause Classification's five-layer-deep
 * dependency graph, reconstructed once each.
 *
 * DocumentService and DocumentAnalysisService are constructed directly
 * for the identical reason every sibling factory gives — not via
 * buildDocumentService() or buildDocumentAnalysisService(), to avoid yet
 * another independent resolution of getCurrentUser()/createClient().
 */
export async function buildPdfExportService(): Promise<PdfExportService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const pdfExportRepository = new PdfExportRepository(supabase);

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

  // The remainder of this block mirrors File 137's own body exactly —
  // LegalHealthScoreService's full seven-argument dependency graph,
  // reconstructed here for the same reason File 137 itself gives for
  // reconstructing AIRecommendationService's graph one layer up.
  const riskDetectionRepository = new RiskDetectionRepository(supabase);
  const riskDetectionService = new RiskDetectionService(
    currentUser,
    riskDetectionRepository,
    analysisService,
    documentService,
    classificationService,
  );

  const missingClauseDetectionRepository = new MissingClauseDetectionRepository(supabase);
  const missingClauseDetectionService = new MissingClauseDetectionService(
    currentUser,
    missingClauseDetectionRepository,
    analysisService,
    documentService,
    classificationService,
  );

  const complianceDetectionRepository = new ComplianceDetectionRepository(supabase);
  const complianceDetectionService = new ComplianceDetectionService(
    currentUser,
    complianceDetectionRepository,
    analysisService,
    documentService,
    classificationService,
  );

  const aiRecommendationRepository = new AIRecommendationRepository(supabase);
  const aiRecommendationService = new AIRecommendationService(
    currentUser,
    aiRecommendationRepository,
    analysisService,
    documentService,
    classificationService,
    riskDetectionService,
    missingClauseDetectionService,
    complianceDetectionService,
  );

  const legalHealthScoreRepository = new LegalHealthScoreRepository(supabase);
  const legalHealthScoreService = new LegalHealthScoreService(
    currentUser,
    legalHealthScoreRepository,
    analysisService,
    documentService,
    classificationService,
    riskDetectionService,
    missingClauseDetectionService,
    complianceDetectionService,
    aiRecommendationService,
  );

  // PdfExportService's own repository, constructed last alongside the
  // service itself, per every sibling factory's identical convention.
  return new PdfExportService(
    currentUser,
    pdfExportRepository,
    supabase,
    analysisService,
    documentService,
    classificationService,
    legalHealthScoreService,
  );
}
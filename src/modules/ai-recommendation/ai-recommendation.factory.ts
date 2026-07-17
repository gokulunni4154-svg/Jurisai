// src/modules/ai-recommendation/ai-recommendation.factory.ts
// File 129 — JurisAI AI Recommendation module

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

import { AIRecommendationRepository } from './ai-recommendation.repository';
import { AIRecommendationService } from './ai-recommendation.service';

/**
 * Constructs a request-scoped AIRecommendationService.
 *
 * Follows buildComplianceDetectionService()'s (File 121),
 * buildMissingClauseDetectionService()'s (File 113), and
 * buildRiskDetectionService()'s (File 105) pattern exactly, one
 * dependency layer deeper: resolve the current user once via
 * getCurrentUser(), construct one fresh request-scoped Supabase client
 * via createClient() (async), never cache either at module scope.
 *
 * KEY DECISION — RiskDetectionService, MissingClauseDetectionService,
 * and ComplianceDetectionService are each constructed DIRECTLY here
 * (their own repository + their own service constructor), NOT via
 * buildRiskDetectionService() / buildMissingClauseDetectionService() /
 * buildComplianceDetectionService(). Identical reasoning to File 121's,
 * File 113's, and File 105's own KEY DECISION for
 * ClauseClassificationService, now applied to three sibling services at
 * once rather than one: calling any of those three build functions here
 * would resolve getCurrentUser() and createClient() again, independently,
 * within this same request-scoped operation — risking
 * AIRecommendationService authorizing against a subtly different
 * currentUser than the rest of its own dependency graph, plus redundant
 * cookie-store reads. AI Recommendation Engine sits one layer deeper than
 * Risk Detection, Missing Clause Detection, and Compliance Detection (it
 * depends on all three as siblings-of-its-own, per
 * ai-recommendation.service.ts's own KEY DECISION), so unlike those three
 * factories — which each only had to re-decide this question for
 * ClauseClassificationService — this factory re-decides it three times
 * over, once per upstream detection module. The answer is the same each
 * time: construct directly, share the one currentUser/supabase pair.
 *
 * CONSEQUENCE, stated explicitly rather than left implicit:
 * ClauseClassificationService's own two-line construction is now
 * duplicated a FIFTH time (File 97 -> File 105 -> File 113 -> File 121 ->
 * here), and RiskDetectionService's, MissingClauseDetectionService's, and
 * ComplianceDetectionService's construction — previously only living in
 * their own factories — is each duplicated here for the first time. Same
 * flagged-duplication-over-silent-drift-risk tradeoff every prior factory
 * in this project has accepted, now at its largest scale in this
 * pipeline: one shared currentUser/supabase pair feeding seven
 * constructed service instances in a single request.
 *
 * DocumentService and DocumentAnalysisService are constructed directly
 * for the identical reason Files 97, 105, 113, and 121 all give — not via
 * buildDocumentService() or buildDocumentAnalysisService(), to avoid yet
 * another independent resolution of getCurrentUser()/createClient().
 */
export async function buildAIRecommendationService(): Promise<AIRecommendationService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const aiRecommendationRepository = new AIRecommendationRepository(supabase);

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

  return new AIRecommendationService(
    currentUser,
    aiRecommendationRepository,
    analysisService,
    documentService,
    classificationService,
    riskDetectionService,
    missingClauseDetectionService,
    complianceDetectionService,
  );
}
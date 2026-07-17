// src/modules/legal-health-score/legal-health-score.factory.ts
// File 137 — JurisAI Legal Health Score module

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

import { LegalHealthScoreRepository } from './legal-health-score.repository';
import { LegalHealthScoreService } from './legal-health-score.service';

/**
 * Constructs a request-scoped LegalHealthScoreService.
 *
 * Follows buildAIRecommendationService()'s (File 129) pattern exactly,
 * one dependency layer deeper: resolve the current user once via
 * getCurrentUser(), construct one fresh request-scoped Supabase client
 * via createClient() (async), never cache either at module scope.
 *
 * KEY DECISION, CONFIRMED WITH THE USER AFTER REVIEWING REAL SOURCE —
 * every one of the five sibling services (ClauseClassificationService,
 * RiskDetectionService, MissingClauseDetectionService,
 * ComplianceDetectionService, AIRecommendationService) is constructed
 * DIRECTLY here, NOT via buildClauseClassificationService() /
 * buildRiskDetectionService() / buildMissingClauseDetectionService() /
 * buildComplianceDetectionService() / buildAIRecommendationService().
 * This question was explicitly raised before this file was drafted: all
 * five real prior factories (Files 97, 105, 113, 121, 129) were pasted
 * and independently confirmed to inline-construct their siblings with
 * zero exceptions, each restating the identical reasoning — calling a
 * sibling's build*Service() here would resolve getCurrentUser() and
 * createClient() again, independently, within this same request-scoped
 * operation, risking LegalHealthScoreService authorizing against a
 * subtly different currentUser than the rest of its own dependency
 * graph, plus redundant cookie-store reads. Legal Health Score sits one
 * layer deeper than AI Recommendation Engine (it depends on all five
 * upstream modules as siblings-of-its-own, per
 * legal-health-score.service.ts's own KEY DECISION), so this factory
 * re-decides the same question File 129 already answered three times
 * over, now a fourth/fifth time for AIRecommendationService itself. The
 * answer is unchanged: construct directly, share the one
 * currentUser/supabase pair.
 *
 * CONSEQUENCE, stated explicitly — building AIRecommendationService
 * directly here means its own ENTIRE dependency graph (documentService,
 * analysisService, classificationService, riskDetectionService,
 * missingClauseDetectionService, complianceDetectionService) must be
 * reconstructed inline first, exactly mirroring File 129's body. Those
 * same six instances are then reused as-is for
 * LegalHealthScoreService's other four sibling-service arguments,
 * rather than built a second time — the one place this factory avoids
 * duplication rather than accepting it, since the instances are already
 * in scope by the time they're needed again.
 *
 * CONSEQUENCE, stated explicitly — ClauseClassificationService's own
 * two-line construction is now duplicated a SIXTH time (File 97 -> 105
 * -> 113 -> 121 -> 129 -> here). RiskDetectionService's,
 * MissingClauseDetectionService's, and ComplianceDetectionService's
 * construction — each previously duplicated only in File 129 on top of
 * their own factory — is now duplicated a second time each. Same
 * flagged-duplication-over-silent-drift-risk tradeoff every prior
 * factory in this project has accepted, now at its largest scale: one
 * shared currentUser/supabase pair feeding EIGHT constructed instances
 * (seven services plus this module's own repository) in a single
 * request — one more than File 129's seven.
 *
 * DocumentService and DocumentAnalysisService are constructed directly
 * for the identical reason Files 97, 105, 113, 121, and 129 all give —
 * not via buildDocumentService() or buildDocumentAnalysisService(), to
 * avoid yet another independent resolution of
 * getCurrentUser()/createClient().
 */
export async function buildLegalHealthScoreService(): Promise<LegalHealthScoreService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const legalHealthScoreRepository = new LegalHealthScoreRepository(supabase);

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

  return new LegalHealthScoreService(
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
}
// src/modules/ai-legal-insight/ai-legal-insight.factory.ts
// File 144 — JurisAI AI Legal Insight module

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
import { LegalHealthScoreRepository } from '@/modules/legal-health-score/legal-health-score.repository';
import { LegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.service';

import { AiLegalInsightRepository } from './ai-legal-insight.repository';
import { AiLegalInsightService } from './ai-legal-insight.service';

/**
 * Constructs a request-scoped AiLegalInsightService.
 *
 * Follows buildLegalHealthScoreService()'s (File 137) pattern exactly,
 * one dependency layer deeper: resolve the current user once via
 * getCurrentUser(), construct one fresh request-scoped Supabase client
 * via createClient() (async), never cache either at module scope.
 *
 * KEY DECISION — every one of the six sibling services
 * (ClauseClassificationService, RiskDetectionService,
 * MissingClauseDetectionService, ComplianceDetectionService,
 * AIRecommendationService, LegalHealthScoreService) is constructed
 * DIRECTLY here, NOT via buildClauseClassificationService() /
 * buildRiskDetectionService() / buildMissingClauseDetectionService() /
 * buildComplianceDetectionService() / buildAIRecommendationService() /
 * buildLegalHealthScoreService(). This is not a fresh decision — it is
 * the same question every one of the six real prior factories (Files 97,
 * 105, 113, 121, 129, 137) has answered identically and unanimously, with
 * zero exceptions, restating the same reasoning each time: calling a
 * sibling's build*Service() here would resolve getCurrentUser() and
 * createClient() again, independently, within this same request-scoped
 * operation, risking AiLegalInsightService authorizing against a subtly
 * different currentUser than the rest of its own dependency graph, plus
 * redundant cookie-store reads. AI Legal Insights sits one layer deeper
 * than Legal Health Score (it depends on all six upstream modules as
 * siblings-of-its-own, per ai-legal-insight.service.ts's own KEY
 * DECISION, not yet built), so this factory re-decides the same question
 * a seventh time, now for LegalHealthScoreService itself. The answer is
 * unchanged: construct directly, share the one currentUser/supabase
 * pair. Unlike File 137's LegalHealthScoreService construction (which
 * required an explicit pre-confirmation against real pasted source per
 * the File 137 near-miss described in the project Constitution), no such
 * re-confirmation was needed here — the pattern is now unanimous across
 * six independent real files, not merely five, and File 140's own
 * near-miss (the source_modules column) was a migration-level error
 * unrelated to this construction question.
 *
 * CONSEQUENCE, stated explicitly — building LegalHealthScoreService
 * directly here means its own ENTIRE dependency graph (documentService,
 * analysisService, classificationService, riskDetectionService,
 * missingClauseDetectionService, complianceDetectionService,
 * aiRecommendationService) must be reconstructed inline first, exactly
 * mirroring File 137's body. Those same seven instances are then reused
 * as-is for AiLegalInsightService's other six sibling-service arguments,
 * rather than built a second time — the one place this factory avoids
 * duplication rather than accepting it, since the instances are already
 * in scope by the time they're needed again. Identical pattern to File
 * 137's own identical consequence one layer up.
 *
 * CONSEQUENCE, stated explicitly — ClauseClassificationService's own
 * two-line construction is now duplicated a SEVENTH time (File 97 -> 105
 * -> 113 -> 121 -> 129 -> 137 -> here). RiskDetectionService's,
 * MissingClauseDetectionService's, and ComplianceDetectionService's
 * construction is now duplicated a third time each; AIRecommendationService's
 * construction is now duplicated a second time (previously only in File
 * 137 on top of its own factory). Same flagged-duplication-over-silent-
 * drift-risk tradeoff every prior factory in this project has accepted,
 * now at its largest scale: one shared currentUser/supabase pair feeding
 * NINE constructed instances (eight services plus this module's own
 * repository) in a single request — one more than File 137's eight.
 *
 * DocumentService and DocumentAnalysisService are constructed directly
 * for the identical reason Files 97, 105, 113, 121, 129, and 137 all
 * give — not via buildDocumentService() or buildDocumentAnalysisService(),
 * to avoid yet another independent resolution of
 * getCurrentUser()/createClient().
 */
export async function buildAiLegalInsightService(): Promise<AiLegalInsightService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const aiLegalInsightRepository = new AiLegalInsightRepository(supabase);

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

  return new AiLegalInsightService(
    currentUser,
    aiLegalInsightRepository,
    analysisService,
    documentService,
    classificationService,
    riskDetectionService,
    missingClauseDetectionService,
    complianceDetectionService,
    aiRecommendationService,
    legalHealthScoreService,
  );
}
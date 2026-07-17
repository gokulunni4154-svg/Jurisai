// src/modules/chat/chat.factory.ts
// File 152 — JurisAI Module 8 (AI Legal Chat)

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
import { AiLegalInsightRepository } from '@/modules/ai-legal-insight/ai-legal-insight.repository';
import { AiLegalInsightService } from '@/modules/ai-legal-insight/ai-legal-insight.service';

import { ChatConversationRepository, ChatMessageRepository } from './chat.repository';
import { ChatService } from './chat.service';

/**
 * Constructs a request-scoped ChatService.
 *
 * Follows buildAiLegalInsightService()'s (File 144) pattern exactly, one
 * dependency layer deeper: resolve the current user once via
 * getCurrentUser(), construct one fresh request-scoped Supabase client
 * via createClient() (async), never cache either at module scope.
 *
 * KEY DECISION — every one of the eight sibling services
 * (DocumentService, DocumentAnalysisService, ClauseClassificationService,
 * RiskDetectionService, MissingClauseDetectionService,
 * ComplianceDetectionService, AIRecommendationService,
 * LegalHealthScoreService) AND the ninth, AiLegalInsightService, are
 * constructed DIRECTLY here — not via their respective build*Service()
 * factory functions. This is not a fresh decision: it is the same
 * question seven independent real prior factories (Files 97, 105, 113,
 * 121, 129, 137, 144) have all answered identically and unanimously.
 * Chat sits one layer deeper than AI Legal Insights (it depends on all
 * nine prior modules as siblings-of-its-own), so this factory re-decides
 * the same question an eighth time. The answer is unchanged: construct
 * directly, share the one currentUser/supabase pair — avoiding a second,
 * independent resolution of getCurrentUser()/createClient() that could
 * let ChatService authorize against a subtly different currentUser than
 * the rest of its own dependency graph.
 *
 * CLARIFICATION — "OCR Output," listed as one of the nine things Chat
 * should have access to per the confirmed scope, is NOT a standalone
 * service in this graph. OCR output is owned by DocumentService /
 * DocumentAnalysisService, exactly as every prior module has already
 * treated it. Chat's access to OCR is satisfied by depending on
 * documentService and analysisService below — there is no separate
 * OcrService to construct.
 *
 * CONSEQUENCE, stated explicitly — ClauseClassificationService's two-line
 * construction is now duplicated an EIGHTH time (97 -> 105 -> 113 -> 121
 * -> 129 -> 137 -> 144 -> here). AIRecommendationService's and
 * LegalHealthScoreService's construction is now duplicated a third time
 * each. AiLegalInsightService's construction is now duplicated a second
 * time. Same flagged-duplication-over-silent-drift-risk tradeoff every
 * prior factory has accepted, now at its largest scale: one shared
 * currentUser/supabase pair feeding ELEVEN constructed instances (nine
 * services plus this module's own two repositories) in a single request
 * — one more than File 144's ten.
 *
 * SHAPE DEPARTURE, FLAGGED — this is the first factory constructing TWO
 * own-module repositories (chatConversationRepository,
 * chatMessageRepository) rather than one, per File 148/150/151's
 * two-table shape. Placed immediately after currentUser in the
 * constructor argument list, same relative position every prior
 * factory's single own-repository occupies — just doubled. Constructed
 * last in the function body since, unlike every sibling service above,
 * they have no dependents within this factory.
 */
export async function buildChatService(): Promise<ChatService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

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

  const aiLegalInsightRepository = new AiLegalInsightRepository(supabase);
  const aiLegalInsightService = new AiLegalInsightService(
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

  // Chat's own repositories — no dependents within this factory, so
  // constructed last, immediately before the Service itself.
  const chatConversationRepository = new ChatConversationRepository(supabase);
  const chatMessageRepository = new ChatMessageRepository(supabase);

  return new ChatService(
    currentUser,
    chatConversationRepository,
    chatMessageRepository,
    analysisService,
    documentService,
    classificationService,
    riskDetectionService,
    missingClauseDetectionService,
    complianceDetectionService,
    aiRecommendationService,
    legalHealthScoreService,
    aiLegalInsightService,
  );
}
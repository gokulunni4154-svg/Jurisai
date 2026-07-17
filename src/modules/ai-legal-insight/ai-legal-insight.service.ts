// src/modules/ai-legal-insight/ai-legal-insight.service.ts
// File 145 — JurisAI AI Legal Insight module

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import type { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import type { ClassifiedClause } from '@/modules/clause-classification/clause-classification.schemas';
import type { RiskDetectionService } from '@/modules/risk-detection/risk-detection.service';
import type { RiskFlag } from '@/modules/risk-detection/risk-detection.schemas';
import type { MissingClauseDetectionService } from '@/modules/missing-clause-detection/missing-clause-detection.service';
import type { MissingClauseFlag } from '@/modules/missing-clause-detection/missing-clause-detection.schemas';
import type { ComplianceDetectionService } from '@/modules/compliance-detection/compliance-detection.service';
import type { ComplianceFlag } from '@/modules/compliance-detection/compliance-detection.schemas';
import type { AIRecommendationService } from '@/modules/ai-recommendation/ai-recommendation.service';
import type { Recommendation } from '@/modules/ai-recommendation/ai-recommendation.schemas';
import type { LegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.service';
import type { LegalHealthScoreResult } from '@/modules/legal-health-score/legal-health-score.schemas';

import { aiLegalInsightResultSchema } from './ai-legal-insight.schemas';
import type { AiLegalInsightRepository } from './ai-legal-insight.repository';
import type { AiLegalInsight } from './ai-legal-insight.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as every upstream service — errorMessage persisted via markFailed() is
 * expected to be safe to eventually show a customer, never a raw
 * SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'Legal insights could not be generated for this document — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Legal insight generation could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Legal insight generation timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Legal insight generation is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Legal insight generation is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Legal insight generation failed due to an unexpected error. Please try again.';

/**
 * Service layer for AI Legal Insights (File 141's schema, File 140's
 * table as corrected by Amendment #1, File 143's repository). Seventh
 * module in the Phase 2 pipeline (Clause Classification -> Risk
 * Detection -> Missing Clause Detection -> Compliance Detection -> AI
 * Recommendation Engine -> Legal Health Score Engine -> AI Legal
 * Insights), currently the terminal one before AI Legal Chat
 * Integration.
 *
 * KEY DECISION — depends on NINE collaborators, one more than File 136's
 * eight: aiLegalInsightRepository (this module's own), analysisService,
 * documentService, classificationService, riskDetectionService,
 * missingClauseDetectionService, complianceDetectionService,
 * aiRecommendationService, AND legalHealthScoreService. Same two-part
 * reasoning as File 136's identical KEY DECISION, extended one layer
 * further down the pipeline:
 *   1. analysisService + documentService follow the identical pattern
 *      every module uses — documentService is fetched solely for its
 *      owner_id to gate requireOwnership() on create.
 *   2. classificationService, riskDetectionService,
 *      missingClauseDetectionService, complianceDetectionService,
 *      aiRecommendationService, AND legalHealthScoreService are each
 *      depended on for the same reason as File 136's five: per
 *      ai-legal-insight.schemas.ts's own KEY DECISION, this module does
 *      not read document text or find new issues directly — it
 *      synthesizes narrative insights across all SIX upstream modules'
 *      already-reported output. legalHealthScoreService is the one new
 *      addition relative to File 136, since AI Legal Insights sits one
 *      layer further down than Legal Health Score Engine itself.
 *
 * KEY DECISION — runAiLegalInsight() takes SIX explicit parameters
 * (classifiedClauses, riskFlags, missingClauseFlags, complianceFlags,
 * recommendations, legalHealthScore), confirmed to mirror File 136's
 * identical five-parameter pattern rather than have the Service fetch
 * all six internally. Same "stay ignorant of how inputs were fetched"
 * discipline as every synthesis module in this project — the Route
 * layer decides what "latest completed X" means operationally for all
 * six upstream reads, this service just synthesizes over whatever it's
 * handed.
 *
 * KEY DECISION — exposes SIX getLatestCompletedXForAnalysis()
 * passthrough methods (one per upstream module), not five. Same
 * convenience-passthrough reasoning as File 136's identical five — so
 * the Route layer only needs this module's own Factory-resolved service
 * to gather every input it needs, rather than separately constructing
 * all six upstream services itself.
 *
 * KEY DECISION, WEAKER PRECEDENT THAN FILE 136'S EQUIVALENT — exposes
 * its OWN getLatestCompletedAiLegalInsightForAnalysis() from the start,
 * built in directly rather than added later as a retroactive amendment.
 * File 128 and File 136 both justified this identically because the
 * roadmap already named their specific next module by name (AI
 * Recommendation Engine -> Legal Health Score Engine -> AI Legal
 * Insights, each confirmed in sequence). Here the next module, AI Legal
 * Chat Integration, is named on the roadmap but is completely
 * unscoped — unlike Legal Health Score's scoping-before-File-132, no
 * scoping conversation has happened for it yet. Built in anyway for
 * consistency with the now-unbroken pattern across two prior modules,
 * but flagged as resting on a thinner justification than File 136's
 * version of the same decision.
 *
 * KEY DECISION, DEPARTS FROM FILE 136 — NO scalar recomputation logic
 * (no computeOverallScore()-equivalent, no deriveCategoryScores()-
 * equivalent). File 136's entire second half exists because Legal
 * Health Score has promoted overall_score/category_scores columns (File
 * 132) that must stay in sync with the model's jsonb result. AI Legal
 * Insights has no promoted columns at all (File 140's KEY DECISION,
 * reinforced by Amendment #1 removing the one column that shouldn't
 * have existed) — the model's `result` is persisted as validated,
 * nothing derived or recomputed from it. markCompleted() below therefore
 * takes a single result argument, matching
 * AiLegalInsightRepository#markCompleted's (File 143) signature, not
 * LegalHealthScoreRepository#markCompleted's (File 135) four-argument
 * one.
 *
 * KEY DECISION, STATED EXPLICITLY RATHER THAN SILENTLY DECIDED —
 * document_analysis is a valid AiLegalInsightSourceModule enum value
 * (File 141), meaning an individual insight's sourceModules array may
 * cite it, but this service does NOT feed document-analysis content
 * into buildUserPrompt() below. analysisService is used here, as in
 * every prior module, purely for gating (existence, visibility,
 * ownership) via getAnalysisById() — never as prompt content. This
 * matches the unbroken convention of every synthesis module so far. The
 * practical consequence: the model can technically cite
 * "document_analysis" as a source per the schema, but has no
 * analysis-specific content in front of it to draw from when doing so.
 * Not treated as a blocking issue for this file, but worth a second look
 * if a future amendment wants literal document metadata (e.g. document
 * type) woven directly into insight narratives.
 *
 * FLAGGED ASSUMPTION, carried forward unchanged from File 136 —
 * BaseService's own source was never pasted into this conversation. Its
 * constructor signature (`super(currentUser)`) and the
 * requireAuthentication()/requireOwnership(ownerId) methods used below
 * are inferred from identical, consistent usage across six independent
 * real files (clause-classification, risk-detection,
 * missing-clause-detection, compliance-detection, ai-recommendation, and
 * legal-health-score services) — not from BaseService's own source. If
 * its real signature differs, this file needs reconciling.
 */
export class AiLegalInsightService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly aiLegalInsightRepository: AiLegalInsightRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
    private readonly riskDetectionService: RiskDetectionService,
    private readonly missingClauseDetectionService: MissingClauseDetectionService,
    private readonly complianceDetectionService: ComplianceDetectionService,
    private readonly aiRecommendationService: AIRecommendationService,
    private readonly legalHealthScoreService: LegalHealthScoreService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' ai_legal_insights row and returns it
   * immediately. Does NOT call the AI provider — see class-level note.
   *
   * Does NOT check for any of the six upstream modules' completion here
   * — same division of responsibility as every upstream service's
   * create method: creating the row is cheap and reversible, so the "is
   * there anything usable to run against yet" check belongs at
   * runAiLegalInsight() time (or the Route layer), not here.
   */
  async createAiLegalInsight(
    rawParams: unknown,
    analysisId: string,
  ): Promise<AiLegalInsight> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as every upstream service's create method.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors every upstream create method exactly:
    // starting an AI legal insight run spends real AI cost, so ownership
    // (not just RLS visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams — throws
    // NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream service:
    // CreateAiLegalInsightInput ({ document_analysis_id }) is narrower
    // than the inherited create()'s Database-derived Insert type. Cast
    // follows BaseRepository's own established `as never` pattern for
    // this exact situation.
    const aiLegalInsight = await this.aiLegalInsightRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return aiLegalInsight as AiLegalInsight;
  }

  /**
   * Lists all AI Legal Insight runs for a given analysis, most recent
   * first. Mirrors every upstream module's listXForAnalysis() reasoning
   * exactly: re-validates the analysis first rather than trusting
   * ai_legal_insights' own RLS join alone, so an invisible or
   * cross-document analysisId surfaces as an explicit NotFoundError, not
   * a silently empty list.
   *
   * No requireOwnership() here, unlike createAiLegalInsight() — reads
   * follow the same RLS-only-for-reads convention.
   */
  async listAiLegalInsightsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<AiLegalInsight[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.aiLegalInsightRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single AI Legal Insight run, scoped to an analysis the
   * caller can see. Mirrors every upstream module's getXById() pattern
   * exactly: re-validate the parent (the analysis) first, then verify
   * the fetched insight run's document_analysis_id actually matches it
   * — a real but differently-owned-or-scoped aiLegalInsightId must 404,
   * not leak cross-analysis data.
   *
   * No requireOwnership() — same reasoning as every upstream module's
   * equivalent: this is a read.
   */
  async getAiLegalInsightById(
    rawParams: unknown,
    analysisId: string,
    aiLegalInsightId: string,
  ): Promise<AiLegalInsight> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const aiLegalInsight = await this.aiLegalInsightRepository.findByIdOrThrow(aiLegalInsightId);

    if (aiLegalInsight.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "insight run doesn't exist"
      // — same reasoning as every upstream module's equivalent check: do
      // not let a caller distinguish "wrong analysis" from "no such run
      // at all" for a pair they don't have access to.
      throw new NotFoundError('ai_legal_insights', aiLegalInsightId);
    }

    return aiLegalInsight;
  }

  /**
   * Passthrough to ClauseClassificationService's Amendment #2. One of
   * the six upstream reads the Route layer is expected to call before
   * runAiLegalInsight().
   */
  async getLatestCompletedClassificationForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<ClauseClassificationService['getLatestCompletedClassificationForAnalysis']>
  >> {
    return this.classificationService.getLatestCompletedClassificationForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Passthrough to RiskDetectionService's Amendment #3. One of the six
   * upstream reads the Route layer is expected to call before
   * runAiLegalInsight().
   */
  async getLatestCompletedRiskDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<RiskDetectionService['getLatestCompletedRiskDetectionForAnalysis']>
  >> {
    return this.riskDetectionService.getLatestCompletedRiskDetectionForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Passthrough to MissingClauseDetectionService's Amendment #3. One of
   * the six upstream reads the Route layer is expected to call before
   * runAiLegalInsight().
   */
  async getLatestCompletedMissingClauseDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<
      MissingClauseDetectionService['getLatestCompletedMissingClauseDetectionForAnalysis']
    >
  >> {
    return this.missingClauseDetectionService.getLatestCompletedMissingClauseDetectionForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Passthrough to ComplianceDetectionService's Amendment #3. One of the
   * six upstream reads the Route layer is expected to call before
   * runAiLegalInsight().
   */
  async getLatestCompletedComplianceDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<ComplianceDetectionService['getLatestCompletedComplianceDetectionForAnalysis']>
  >> {
    return this.complianceDetectionService.getLatestCompletedComplianceDetectionForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Passthrough to AIRecommendationService's own built-in-from-the-start
   * latest-completed read (File 128). One of the six upstream reads the
   * Route layer is expected to call before runAiLegalInsight().
   */
  async getLatestCompletedAIRecommendationForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<AIRecommendationService['getLatestCompletedAIRecommendationForAnalysis']>
  >> {
    return this.aiRecommendationService.getLatestCompletedAIRecommendationForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Passthrough to LegalHealthScoreService's own built-in-from-the-start
   * latest-completed read (File 136). The sixth and final upstream read
   * the Route layer is expected to call before runAiLegalInsight() — new
   * relative to File 136's five, since this module sits one layer
   * further down the pipeline than Legal Health Score Engine itself.
   */
  async getLatestCompletedLegalHealthScoreForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<Awaited<
    ReturnType<LegalHealthScoreService['getLatestCompletedLegalHealthScoreForAnalysis']>
  >> {
    return this.legalHealthScoreService.getLatestCompletedLegalHealthScoreForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Exposes THIS module's own latest completed result to a possible
   * future downstream sibling (AI Legal Chat Integration, per the
   * roadmap) — see class-level KEY DECISION on why this is built in now
   * despite that next module being unscoped, unlike File 128's and File
   * 136's stronger versions of the same justification. Identical shape
   * to File 136's identical method.
   *
   * No requireOwnership() — same reasoning as getAiLegalInsightById():
   * this is a read, gated by re-validating the analysis is visible to
   * the caller, not by ownership.
   */
  async getLatestCompletedAiLegalInsightForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<AiLegalInsight | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.aiLegalInsightRepository.findLatestByDocumentAnalysisId(
      analysis.id,
    );

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Runs the actual narrative-insight synthesis for an already-created
   * 'pending' row: marks it 'processing', calls generateWithFallback()
   * against File 141's schema, then marks 'completed' (with the
   * validated result + which provider answered) or 'failed' (with a
   * user-safe message). No scalar recomputation step — see class-level
   * KEY DECISION on why this departs from File 136's second half.
   *
   * Takes all six upstream inputs explicitly — see class-level KEY
   * DECISION. Each is expected to come from the corresponding
   * getLatestCompletedXForAnalysis() passthrough above, typically called
   * by the Route layer before deciding whether enough upstream data
   * exists to proceed.
   *
   * Never throws for an AI-provider failure — same reasoning as every
   * upstream service: a caller invoking this without awaiting it may
   * have no way to receive a thrown error. Does rethrow for anything
   * that isn't an AIProviderError.
   */
  async runAiLegalInsight(
    aiLegalInsightId: string,
    classifiedClauses: ClassifiedClause[],
    riskFlags: RiskFlag[],
    missingClauseFlags: MissingClauseFlag[],
    complianceFlags: ComplianceFlag[],
    recommendations: Recommendation[],
    legalHealthScore: LegalHealthScoreResult,
  ): Promise<AiLegalInsight> {
    await this.aiLegalInsightRepository.markProcessing(aiLegalInsightId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(
          classifiedClauses,
          riskFlags,
          missingClauseFlags,
          complianceFlags,
          recommendations,
          legalHealthScore,
        ),
        schema: aiLegalInsightResultSchema,
      });

      return await this.aiLegalInsightRepository.markCompleted(
        aiLegalInsightId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.aiLegalInsightRepository.markFailed(aiLegalInsightId, message);
      }

      // Not an AI-provider failure. Best-effort record the row as failed
      // so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to every upstream service's secondary catch,
      // same reasoning: a failure while persisting the failure state
      // must not mask the original error.
      await this.aiLegalInsightRepository
        .markFailed(aiLegalInsightId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 141's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * every upstream service's buildSystemPrompt: no dependency on `this`,
 * easier to unit test in isolation.
 *
 * Explicitly instructs the model toward cross-module narrative
 * synthesis rather than restating any single upstream finding, and
 * explicitly distinguishes this module's job from AI Recommendation
 * Engine (actionable steps) and Legal Health Score Engine (a score) —
 * the same distinction File 141's docstring draws, reinforced here at
 * the prompt level since it's the one thing most likely to make the
 * model default back toward a familiar pattern from an upstream module.
 */
function buildSystemPrompt(): string {
  return [
    'You are a legal insight synthesis engine for JurisAI, an AI legal',
    'operating system serving customers in India. You are given the',
    "complete output of a document's clause classification, risk",
    'detection, missing clause detection, compliance detection, AI',
    'recommendation, and legal health score passes, and you produce',
    'plain-language narrative insights connecting patterns across them.',
    '',
    'Rules:',
    '- Your job is narrative synthesis, not another list of issues and',
    '  not another score. AI Recommendation Engine already produced',
    '  actionable next steps; Legal Health Score Engine already produced',
    '  a composite score. Do not restate either — explain the *story*',
    '  connecting findings across modules that neither of those outputs',
    '  makes visible on its own.',
    '- Every insight should draw on two or more upstream modules where',
    '  genuinely warranted (e.g. a risk flag and a missing-clause flag',
    '  concerning the same clause, or a low health-score sub-score',
    '  explained by specific upstream findings that caused it). A single',
    "  insight that only restates one module's finding in different",
    '  words adds no value.',
    '- Write narrative in plain language for someone without a legal',
    '  background — explain what the pattern means for them practically,',
    '  not just that it exists.',
    '- title should be a short, specific label a person could scan in a',
    '  list. narrative should be the fuller explanation.',
    '- sourceModules and sourceSummary should accurately reflect which',
    '  specific upstream findings genuinely drove this insight — do not',
    '  cite a module that did not meaningfully contribute.',
    '- Do not manufacture insights to hit a target count. A document with',
    '  few genuine cross-module patterns should produce few insights,',
    '  not padded ones.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt combining all six upstream inputs — see
 * class-level KEY DECISION. Each is serialized as JSON rather than
 * prose, consistent with every upstream service's identical treatment:
 * this is already machine-structured data the model should treat as
 * reference input, not narrative to re-read.
 */
function buildUserPrompt(
  classifiedClauses: ClassifiedClause[],
  riskFlags: RiskFlag[],
  missingClauseFlags: MissingClauseFlag[],
  complianceFlags: ComplianceFlag[],
  recommendations: Recommendation[],
  legalHealthScore: LegalHealthScoreResult,
): string {
  return [
    '=== CLAUSE BREAKDOWN (from Clause Classification) ===',
    JSON.stringify(classifiedClauses, null, 2),
    '',
    '=== RISK FLAGS (from Risk Detection) ===',
    JSON.stringify(riskFlags, null, 2),
    '',
    '=== MISSING CLAUSE FLAGS (from Missing Clause Detection) ===',
    JSON.stringify(missingClauseFlags, null, 2),
    '',
    '=== COMPLIANCE FLAGS (from Compliance Detection) ===',
    JSON.stringify(complianceFlags, null, 2),
    '',
    '=== RECOMMENDATIONS (from AI Recommendation Engine) ===',
    JSON.stringify(recommendations, null, 2),
    '',
    '=== LEGAL HEALTH SCORE (from Legal Health Score Engine) ===',
    JSON.stringify(legalHealthScore, null, 2),
  ].join('\n');
}
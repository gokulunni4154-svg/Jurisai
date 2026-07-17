// src/modules/ai-recommendation/ai-recommendation.service.ts
// File 128 — JurisAI AI Recommendation module

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

import { aiRecommendationResultSchema } from './ai-recommendation.schemas';
import type { AIRecommendationRepository } from './ai-recommendation.repository';
import type { AIRecommendation } from './ai-recommendation.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as risk-detection.service.ts, missing-clause-detection.service.ts, and
 * compliance-detection.service.ts — errorMessage persisted via
 * markFailed() is expected to be safe to eventually show a customer,
 * never a raw SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'Recommendations could not be generated for this document — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Recommendation generation could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Recommendation generation timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Recommendation generation is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Recommendation generation is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Recommendation generation failed due to an unexpected error. Please try again.';

/**
 * Service layer for the AI Recommendation Engine (File 125's schema,
 * File 124's table, File 127's repository). Fifth module in the Phase 2
 * pipeline (Clause Classification -> Risk Detection -> Missing Clause
 * Detection -> Compliance Detection -> AI Recommendation Engine -> Legal
 * Health Score Engine).
 *
 * KEY DECISION — depends on SIX services, one more than any prior
 * module's three: AIRecommendationRepository (this module's own),
 * DocumentAnalysisService, DocumentService, ClauseClassificationService,
 * RiskDetectionService, MissingClauseDetectionService, and
 * ComplianceDetectionService. Two genuinely different reasons drive this,
 * not one inherited-by-default shape:
 *   1. DocumentAnalysisService + DocumentService follow the identical
 *      pattern every upstream module uses — DocumentService is fetched
 *      solely for its owner_id, since analysisService.getAnalysisById()
 *      does not expose it, to gate requireOwnership() on create. Unlike
 *      every upstream module, DocumentService is NOT used for document
 *      text here — see point 2.
 *   2. ClauseClassificationService, RiskDetectionService,
 *      MissingClauseDetectionService, and ComplianceDetectionService are
 *      each depended on for the SAME reason: per
 *      ai-recommendation.schemas.ts's own KEY DECISION, this module does
 *      not find new issues in the document text directly — it
 *      synthesizes across what all four upstream modules already
 *      reported. There is therefore no need for raw document text at
 *      all, unlike every upstream module (which all needed
 *      DocumentAnalysisService's text for their own AI calls). This is a
 *      genuinely new dependency shape at this layer of the pipeline, not
 *      a bigger version of the same shape.
 *
 * KEY DECISION — runAIRecommendation() takes FOUR explicit parameters
 * (classifiedClauses, riskFlags, missingClauseFlags, complianceFlags),
 * not fewer. Same "stay ignorant of how inputs were fetched" discipline
 * as every upstream service's runX() method — the Route layer decides
 * what "latest completed X" means operationally for all four upstream
 * reads, this service just synthesizes over whatever it's handed.
 *
 * KEY DECISION — exposes FOUR getLatestCompletedXForAnalysis()
 * passthrough methods (one per upstream module), not zero. Same
 * convenience-passthrough reasoning as every upstream service's existing
 * passthrough(s) — so the Route layer only needs to construct this
 * module's own Factory-resolved service to gather every input it needs
 * before deciding whether/how to call runAIRecommendation(), rather than
 * separately constructing all four upstream services itself.
 *
 * KEY DECISION — exposes its OWN getLatestCompletedAIRecommendationForAnalysis()
 * from the start, built in directly rather than added later as a
 * retroactive amendment. RiskDetectionService and ComplianceDetectionService
 * both needed an Amendment #3 to add this after the fact because the
 * downstream need (this very module) didn't exist yet when they were
 * first built. That's not true here: the constitution's roadmap already
 * names Legal Health Score Engine as the very next module, and it will
 * need exactly this same read. Building it in now, rather than shipping
 * File 128 without it and inevitably amending it the moment Legal
 * Health Score Engine is scoped, avoids a predictable amendment.
 *
 * KEY DECISION — ownership gates starting an AI recommendation run, same
 * as every upstream service's create method: a new row + real AI
 * provider cost is write-like in consequence, not just a read.
 *
 * KEY DECISION — split into createAIRecommendation() (fast, returns a
 * pending row) and runAIRecommendation() (slow — the actual AI call).
 * Identical reasoning to every upstream service: whether the HTTP layer
 * awaits runAIRecommendation() before responding, or fires it without
 * awaiting, is a Route Handler decision this service should not make.
 *
 * FLAGGED, not silently assumed: RiskDetection/MissingClauseDetection/
 * ComplianceDetection's entity `.result` field shape (named `result`,
 * typed as their respective XResult | null) is inferred from their
 * migrations' `result jsonb` column, their services' markCompleted(id,
 * result, providerUsed) call signatures, and ai-recommendation.entity.ts's
 * own confirmed identical shape — not from directly pasted entity source
 * for those three files. If real entity source surfaces a different
 * field name, reconcile this file against it then.
 */
export class AIRecommendationService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly aiRecommendationRepository: AIRecommendationRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
    private readonly riskDetectionService: RiskDetectionService,
    private readonly missingClauseDetectionService: MissingClauseDetectionService,
    private readonly complianceDetectionService: ComplianceDetectionService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' ai_recommendations row and returns it
   * immediately. Does NOT call the AI provider — see class-level note.
   *
   * Does NOT check for any of the four upstream modules' completion here
   * — same division of responsibility as every upstream service's create
   * method not checking for its own upstream dependency's completion:
   * creating the row is cheap and reversible, so the "is there anything
   * usable to run against yet" check belongs at runAIRecommendation()
   * time (or the Route layer), not here.
   */
  async createAIRecommendation(
    rawParams: unknown,
    analysisId: string,
  ): Promise<AIRecommendation> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as every upstream service's create method.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors every upstream create method exactly:
    // starting an AI recommendation run spends real AI cost, so
    // ownership (not just RLS visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams — throws
    // NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream service:
    // CreateAIRecommendationInput ({ document_analysis_id }) is narrower
    // than the inherited create()'s Database-derived Insert type. Cast
    // follows BaseRepository's own established `as never` pattern for
    // this exact situation.
    const aiRecommendation = await this.aiRecommendationRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return aiRecommendation as AIRecommendation;
  }

  /**
   * Lists all AI recommendation runs for a given analysis, most recent
   * first. Mirrors every upstream module's listXForAnalysis() reasoning
   * exactly: re-validates the analysis first rather than trusting
   * ai_recommendations' own RLS join alone, so an invisible or
   * cross-document analysisId surfaces as an explicit NotFoundError, not
   * a silently empty list.
   *
   * No requireOwnership() here, unlike createAIRecommendation() — reads
   * follow the same RLS-only-for-reads convention.
   */
  async listAIRecommendationsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<AIRecommendation[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.aiRecommendationRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single AI recommendation run, scoped to an analysis the
   * caller can see. Mirrors every upstream module's getXById() pattern
   * exactly: re-validate the parent (the analysis) first, then verify
   * the fetched recommendation's document_analysis_id actually matches
   * it — a real but differently-owned-or-scoped aiRecommendationId must
   * 404, not leak cross-analysis data.
   *
   * No requireOwnership() — same reasoning as every upstream module's
   * equivalent: this is a read.
   */
  async getAIRecommendationById(
    rawParams: unknown,
    analysisId: string,
    aiRecommendationId: string,
  ): Promise<AIRecommendation> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const aiRecommendation =
      await this.aiRecommendationRepository.findByIdOrThrow(aiRecommendationId);

    if (aiRecommendation.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "recommendation doesn't
      // exist" — same reasoning as every upstream module's equivalent
      // check: do not let a caller distinguish "wrong analysis" from
      // "no such recommendation at all" for a pair they don't have
      // access to.
      throw new NotFoundError('ai_recommendations', aiRecommendationId);
    }

    return aiRecommendation;
  }

  /**
   * Returns the most recent 'completed' classification for the given
   * analysis, via ClauseClassificationService (Amendment #2) — one of
   * the four reads the Route layer is expected to call BEFORE
   * runAIRecommendation(), to decide what to do if Clause Classification
   * hasn't completed yet for this analysis. Exposed here for the same
   * convenience-passthrough reason as every upstream service's identical
   * method — so the Route only needs to build this module's own
   * Factory-resolved service, not construct all four upstream services
   * itself.
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
   * Passthrough to RiskDetectionService's Amendment #3 (File 104). One
   * of the four upstream reads the Route layer is expected to call
   * before runAIRecommendation().
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
   * Passthrough to MissingClauseDetectionService's Amendment #3 (File
   * 112, added this session specifically to unblock this method). One of
   * the four upstream reads the Route layer is expected to call before
   * runAIRecommendation().
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
   * Passthrough to ComplianceDetectionService's Amendment #3 (File 120).
   * One of the four upstream reads the Route layer is expected to call
   * before runAIRecommendation().
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
   * Exposes THIS module's own latest completed result to a future
   * downstream sibling — see class-level KEY DECISION on why this is
   * built in now rather than added later as a retroactive amendment the
   * way RiskDetectionService's and ComplianceDetectionService's
   * Amendment #3 were. Identical shape to both of those methods.
   *
   * FLAGGED ASSUMPTION: aiRecommendationRepository.findLatestByDocumentAnalysisId
   * (File 127) returns the most recent row regardless of status —
   * pending/processing/failed included, matching every upstream
   * repository's identical method. This method explicitly filters for
   * status === 'completed' and returns null otherwise, same reasoning as
   * every upstream service's equivalent.
   *
   * No requireOwnership() — same reasoning as getAIRecommendationById():
   * this is a read, gated by re-validating the analysis is visible to
   * the caller, not by ownership.
   */
  async getLatestCompletedAIRecommendationForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<AIRecommendation | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.aiRecommendationRepository.findLatestByDocumentAnalysisId(
      analysis.id,
    );

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Runs the actual recommendation synthesis for an already-created
   * 'pending' row: marks it 'processing', calls generateWithFallback()
   * against File 125's schema, then marks 'completed' (with result +
   * which provider answered) or 'failed' (with a user-safe message).
   *
   * Takes all four upstream inputs explicitly — see class-level KEY
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
  async runAIRecommendation(
    aiRecommendationId: string,
    classifiedClauses: ClassifiedClause[],
    riskFlags: RiskFlag[],
    missingClauseFlags: MissingClauseFlag[],
    complianceFlags: ComplianceFlag[],
  ): Promise<AIRecommendation> {
    await this.aiRecommendationRepository.markProcessing(aiRecommendationId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(
          classifiedClauses,
          riskFlags,
          missingClauseFlags,
          complianceFlags,
        ),
        schema: aiRecommendationResultSchema,
      });

      return await this.aiRecommendationRepository.markCompleted(
        aiRecommendationId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.aiRecommendationRepository.markFailed(aiRecommendationId, message);
      }

      // Not an AI-provider failure. Best-effort record the row as failed
      // so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to every upstream service's secondary catch,
      // same reasoning: a failure while persisting the failure state
      // must not mask the original error.
      await this.aiRecommendationRepository
        .markFailed(aiRecommendationId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 125's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * every upstream service's buildSystemPrompt: no dependency on `this`,
 * easier to unit test in isolation.
 *
 * Explicitly reinforces the schema's core distinction — synthesis, not
 * relabeling — in prose, since a model given four separate flag lists
 * may default to the simpler behavior of restating each one as its own
 * recommendation unless told otherwise.
 */
function buildSystemPrompt(): string {
  return [
    'You are a recommendation synthesis engine for JurisAI, an AI legal',
    'operating system serving customers in India. You are given the',
    "complete output of a document's clause classification, risk",
    'detection, missing clause detection, and compliance detection',
    'passes, and you produce a prioritized set of actionable',
    'recommendations for the document owner.',
    '',
    'Rules:',
    '- Do NOT simply restate each upstream flag as its own recommendation.',
    '  Your value is synthesis: consolidate overlapping or related flags',
    '  from different modules that concern the same underlying clause or',
    '  issue into a single recommendation where genuinely warranted.',
    '- Every recommendation must list every sourceModule it draws from in',
    '  sourceModules, and describe the specific flag(s) it draws from in',
    '  sourceSummary — do not recommend something with no basis in the',
    '  provided upstream output.',
    '- Choose actionType based on what the document owner should actually',
    '  DO, not the upstream issue type: a compliance "missing_requirement"',
    '  usually maps to "compliance_action" or "add_clause" depending on',
    '  whether it is a clause-level or administrative gap; a risk',
    '  "one_sided_clause" usually maps to "negotiate_terms" or',
    '  "amend_clause" depending on severity.',
    '- Use "seek_professional_review" sparingly — only when the',
    '  underlying issue genuinely requires a lawyer\'s judgment, not as a',
    '  default for anything high-severity.',
    '- Calibrate priority consistently across documents, not relative to',
    '  "the most pressing issue in an otherwise low-priority document."',
    '- Be exhaustive for genuinely distinct, actionable issues, but do',
    '  not pad the list with recommendations that duplicate one another.',
    '- Reflect genuine uncertainty in `confidence` rather than defaulting',
    '  to a high value.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt combining all four upstream inputs — see
 * class-level KEY DECISION. Each is serialized as JSON rather than
 * prose, consistent with every upstream service's identical treatment of
 * the clause breakdown: this is already machine-structured data the
 * model should treat as reference input, not narrative to re-read.
 */
function buildUserPrompt(
  classifiedClauses: ClassifiedClause[],
  riskFlags: RiskFlag[],
  missingClauseFlags: MissingClauseFlag[],
  complianceFlags: ComplianceFlag[],
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
  ].join('\n');
}
// src/modules/legal-health-score/legal-health-score.service.ts
// File 136 — JurisAI Legal Health Score module

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

import {
  legalHealthScoreResultSchema,
  LegalHealthCategory,
  type LegalHealthScoreResult,
  type CategoryScoreDetail,
  type CategoryScores,
} from './legal-health-score.schemas';
import type { LegalHealthScoreRepository } from './legal-health-score.repository';
import type { LegalHealthScore } from './legal-health-score.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as every upstream service — errorMessage persisted via markFailed() is
 * expected to be safe to eventually show a customer, never a raw
 * SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'A legal health score could not be generated for this document — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Legal health scoring could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Legal health scoring timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Legal health scoring is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Legal health scoring is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Legal health scoring failed due to an unexpected error. Please try again.';

/**
 * Maps each fixed LegalHealthCategory value to its corresponding field on
 * the flat CategoryScores shape (File 133). Isolated as a single lookup
 * table, not inlined into deriveCategoryScores() below, so the one
 * naming translation this module needs (`negotiation_leverage` — the Zod
 * enum value — vs `negotiationLeverage` — the camelCase column field) has
 * exactly one place it could go wrong.
 */
const CATEGORY_TO_FIELD: Record<LegalHealthCategory, keyof CategoryScores> = {
  risk: 'risk',
  compliance: 'compliance',
  completeness: 'completeness',
  negotiation_leverage: 'negotiationLeverage',
};

/**
 * Service layer for the Legal Health Score Engine (File 133's schema,
 * File 132's table, File 135's repository). Sixth module in the Phase 2
 * pipeline (Clause Classification -> Risk Detection -> Missing Clause
 * Detection -> Compliance Detection -> AI Recommendation Engine -> Legal
 * Health Score Engine), and currently the terminal one before AI Legal
 * Insights.
 *
 * KEY DECISION — depends on EIGHT collaborators, one more than File
 * 128's seven: legalHealthScoreRepository (this module's own),
 * analysisService, documentService, classificationService,
 * riskDetectionService, missingClauseDetectionService,
 * complianceDetectionService, and aiRecommendationService. Same two-part
 * reasoning as File 128's identical KEY DECISION, extended one layer
 * further down the pipeline:
 *   1. analysisService + documentService follow the identical pattern
 *      every module uses — documentService is fetched solely for its
 *      owner_id to gate requireOwnership() on create.
 *   2. classificationService, riskDetectionService,
 *      missingClauseDetectionService, complianceDetectionService, AND
 *      aiRecommendationService are each depended on for the same
 *      reason as File 128's four: per legal-health-score.schemas.ts's
 *      own KEY DECISION, this module does not read document text or
 *      find new issues directly — it synthesizes across all FIVE
 *      upstream modules' already-reported output. aiRecommendationService
 *      is the one new addition relative to File 128, since Legal Health
 *      Score sits one layer further down than AI Recommendation Engine
 *      itself.
 *
 * KEY DECISION — runLegalHealthScore() takes FIVE explicit parameters
 * (classifiedClauses, riskFlags, missingClauseFlags, complianceFlags,
 * recommendations), confirmed to mirror File 128's identical pattern
 * rather than have the Service fetch all five internally. Same "stay
 * ignorant of how inputs were fetched" discipline as every synthesis
 * module in this project — the Route layer decides what "latest
 * completed X" means operationally for all five upstream reads, this
 * service just synthesizes over whatever it's handed.
 *
 * KEY DECISION — exposes FIVE getLatestCompletedXForAnalysis()
 * passthrough methods (one per upstream module), not four. Same
 * convenience-passthrough reasoning as File 128's identical four — so
 * the Route layer only needs this module's own Factory-resolved
 * service to gather every input it needs, rather than separately
 * constructing all five upstream services itself.
 *
 * KEY DECISION — exposes its OWN
 * getLatestCompletedLegalHealthScoreForAnalysis() from the start, built
 * in directly rather than added later as a retroactive amendment.
 * Identical reasoning to File 128's identical decision: the roadmap
 * already names AI Legal Insights as the next module, and it will need
 * exactly this same read.
 *
 * KEY DECISION, CONFIRMED WITH THE USER — overallScore is
 * SERVICE-COMPUTED, not trusted from the model's own aggregate. File
 * 133's schema still asks the model to emit `overallScore` (so the
 * model has to reason about it, and so a plausible value exists even if
 * the deterministic derivation were ever removed), but
 * runLegalHealthScore() below discards that value and recomputes it
 * deterministically from `categoryBreakdown`'s `score`/`weight` fields
 * via computeOverallScore(). The recomputed value then REPLACES
 * `result.overallScore` before persisting, so the promoted
 * `overall_score` column and the jsonb `result.overallScore` field are
 * byte-identical by construction — not two independently-sourced
 * numbers left to drift apart, honoring File 132 migration's stated
 * "kept in sync by Service layer discipline" trade-off.
 *
 * KEY DECISION — computeOverallScore() normalizes against the ACTUAL
 * sum of the four weights, not assumed to equal exactly 1. File 133's
 * schema instructs the model to make weights sum to 1 but does not
 * enforce it structurally (no superRefine on the weight total,
 * unlike its category-coverage check) — normalizing here means a
 * near-miss (e.g. weights summing to 0.97) doesn't silently
 * under/overweight the result.
 *
 * FLAGGED ASSUMPTION — BaseService's own source was never pasted into
 * this conversation. Its constructor signature (`super(currentUser)`)
 * and the requireAuthentication()/requireOwnership(ownerId) methods
 * used below are inferred from identical, consistent usage across five
 * independent real files (clause-classification, risk-detection,
 * missing-clause-detection, compliance-detection, and
 * ai-recommendation services) — not from BaseService's own source. If
 * its real signature differs, this file needs reconciling.
 */
export class LegalHealthScoreService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly legalHealthScoreRepository: LegalHealthScoreRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
    private readonly riskDetectionService: RiskDetectionService,
    private readonly missingClauseDetectionService: MissingClauseDetectionService,
    private readonly complianceDetectionService: ComplianceDetectionService,
    private readonly aiRecommendationService: AIRecommendationService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' legal_health_scores row and returns it
   * immediately. Does NOT call the AI provider — see class-level note.
   *
   * Does NOT check for any of the five upstream modules' completion
   * here — same division of responsibility as every upstream service's
   * create method: creating the row is cheap and reversible, so the "is
   * there anything usable to run against yet" check belongs at
   * runLegalHealthScore() time (or the Route layer), not here.
   */
  async createLegalHealthScore(
    rawParams: unknown,
    analysisId: string,
  ): Promise<LegalHealthScore> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as every upstream service's create method.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors every upstream create method exactly:
    // starting a legal health score run spends real AI cost, so
    // ownership (not just RLS visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams — throws
    // NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream service:
    // CreateLegalHealthScoreInput ({ document_analysis_id }) is narrower
    // than the inherited create()'s Database-derived Insert type. Cast
    // follows BaseRepository's own established `as never` pattern for
    // this exact situation.
    const legalHealthScore = await this.legalHealthScoreRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return legalHealthScore as LegalHealthScore;
  }

  /**
   * Lists all legal health score runs for a given analysis, most recent
   * first. Mirrors every upstream module's listXForAnalysis() reasoning
   * exactly: re-validates the analysis first rather than trusting
   * legal_health_scores' own RLS join alone, so an invisible or
   * cross-document analysisId surfaces as an explicit NotFoundError, not
   * a silently empty list.
   *
   * No requireOwnership() here, unlike createLegalHealthScore() — reads
   * follow the same RLS-only-for-reads convention.
   */
  async listLegalHealthScoresForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<LegalHealthScore[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.legalHealthScoreRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single legal health score run, scoped to an analysis the
   * caller can see. Mirrors every upstream module's getXById() pattern
   * exactly: re-validate the parent (the analysis) first, then verify
   * the fetched score's document_analysis_id actually matches it — a
   * real but differently-owned-or-scoped legalHealthScoreId must 404,
   * not leak cross-analysis data.
   *
   * No requireOwnership() — same reasoning as every upstream module's
   * equivalent: this is a read.
   */
  async getLegalHealthScoreById(
    rawParams: unknown,
    analysisId: string,
    legalHealthScoreId: string,
  ): Promise<LegalHealthScore> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const legalHealthScore =
      await this.legalHealthScoreRepository.findByIdOrThrow(legalHealthScoreId);

    if (legalHealthScore.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "score doesn't exist" — same
      // reasoning as every upstream module's equivalent check: do not
      // let a caller distinguish "wrong analysis" from "no such score
      // at all" for a pair they don't have access to.
      throw new NotFoundError('legal_health_scores', legalHealthScoreId);
    }

    return legalHealthScore;
  }

  /**
   * Passthrough to ClauseClassificationService's Amendment #2. One of
   * the five upstream reads the Route layer is expected to call before
   * runLegalHealthScore().
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
   * Passthrough to RiskDetectionService's Amendment #3. One of the five
   * upstream reads the Route layer is expected to call before
   * runLegalHealthScore().
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
   * the five upstream reads the Route layer is expected to call before
   * runLegalHealthScore().
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
   * five upstream reads the Route layer is expected to call before
   * runLegalHealthScore().
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
   * latest-completed read (File 128). The fifth and final upstream read
   * the Route layer is expected to call before runLegalHealthScore() —
   * new relative to File 128's four, since this module sits one layer
   * further down the pipeline than AI Recommendation Engine itself.
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
   * Exposes THIS module's own latest completed result to a future
   * downstream sibling (AI Legal Insights, per the roadmap) — see
   * class-level KEY DECISION on why this is built in now rather than
   * added later as a retroactive amendment. Identical shape to File
   * 128's identical method.
   *
   * No requireOwnership() — same reasoning as getLegalHealthScoreById():
   * this is a read, gated by re-validating the analysis is visible to
   * the caller, not by ownership.
   */
  async getLatestCompletedLegalHealthScoreForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<LegalHealthScore | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.legalHealthScoreRepository.findLatestByDocumentAnalysisId(
      analysis.id,
    );

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Runs the actual health score synthesis for an already-created
   * 'pending' row: marks it 'processing', calls generateWithFallback()
   * against File 133's schema, deterministically recomputes
   * overallScore (see class-level KEY DECISION — CONFIRMED WITH THE
   * USER), derives the flat categoryScores shape, then marks 'completed'
   * (with the corrected result + derived categoryScores + derived
   * overallScore + which provider answered) or 'failed' (with a
   * user-safe message).
   *
   * Takes all five upstream inputs explicitly — see class-level KEY
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
  async runLegalHealthScore(
    legalHealthScoreId: string,
    classifiedClauses: ClassifiedClause[],
    riskFlags: RiskFlag[],
    missingClauseFlags: MissingClauseFlag[],
    complianceFlags: ComplianceFlag[],
    recommendations: Recommendation[],
  ): Promise<LegalHealthScore> {
    await this.legalHealthScoreRepository.markProcessing(legalHealthScoreId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(
          classifiedClauses,
          riskFlags,
          missingClauseFlags,
          complianceFlags,
          recommendations,
        ),
        schema: legalHealthScoreResultSchema,
      });

      // See class-level KEY DECISION — CONFIRMED WITH THE USER: the
      // model's own result.overallScore is discarded in favor of a
      // deterministic recomputation from categoryBreakdown's
      // score/weight fields, then written back into the persisted
      // result so the jsonb field and the promoted column never
      // diverge.
      const overallScore = computeOverallScore(result.categoryBreakdown);
      const categoryScores = deriveCategoryScores(result.categoryBreakdown);
      const finalResult: LegalHealthScoreResult = { ...result, overallScore };

      return await this.legalHealthScoreRepository.markCompleted(
        legalHealthScoreId,
        finalResult,
        categoryScores,
        overallScore,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.legalHealthScoreRepository.markFailed(legalHealthScoreId, message);
      }

      // Not an AI-provider failure. Best-effort record the row as failed
      // so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to every upstream service's secondary catch,
      // same reasoning: a failure while persisting the failure state
      // must not mask the original error.
      await this.legalHealthScoreRepository
        .markFailed(legalHealthScoreId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * Deterministically recomputes the composite overall score from
 * categoryBreakdown's score/weight fields, discarding the model's own
 * result.overallScore — see class-level KEY DECISION, confirmed with
 * the user. Normalizes against the ACTUAL sum of the four weights
 * rather than assuming they sum to exactly 1 (the schema instructs but
 * does not structurally enforce this), so a near-miss weight total
 * doesn't silently skew the result. Falls back to a plain unweighted
 * average only in the degenerate case where every weight is 0 (should
 * not occur given the schema's 0-1 range and instructive prompt, but
 * guards against a division by zero rather than trusting that).
 * Rounded to the nearest integer, matching legal_health_scores.overall_score's
 * integer column type (File 132).
 */
function computeOverallScore(categoryBreakdown: CategoryScoreDetail[]): number {
  const totalWeight = categoryBreakdown.reduce((sum, entry) => sum + entry.weight, 0);

  if (totalWeight === 0) {
    const average =
      categoryBreakdown.reduce((sum, entry) => sum + entry.score, 0) / categoryBreakdown.length;
    return Math.round(average);
  }

  const weightedSum = categoryBreakdown.reduce(
    (sum, entry) => sum + entry.score * entry.weight,
    0,
  );

  return Math.round(weightedSum / totalWeight);
}

/**
 * Derives the flat CategoryScores shape (File 133) for the promoted
 * category_scores column by mapping over the validated
 * categoryBreakdown — the single source of truth is the model's
 * categoryBreakdown output, this is the one deterministic derivation
 * downstream. categoryBreakdown is already guaranteed by
 * legalHealthScoreResultSchema's superRefine (File 133) to contain
 * exactly one entry per LegalHealthCategory value, so this reduce is
 * safe without an additional completeness check here.
 */
function deriveCategoryScores(categoryBreakdown: CategoryScoreDetail[]): CategoryScores {
  return categoryBreakdown.reduce((acc, entry) => {
    acc[CATEGORY_TO_FIELD[entry.category]] = entry.score;
    return acc;
  }, {} as CategoryScores);
}

/**
 * System prompt reinforcing File 133's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * every upstream service's buildSystemPrompt: no dependency on `this`,
 * easier to unit test in isolation.
 *
 * Explicitly reinforces that overallScore, though requested from the
 * model, is not the field of record the platform ultimately persists —
 * still asked for so the model reasons about the composite picture
 * coherently, but the prompt does not need to disclose that the Service
 * layer recomputes it afterward; that would only invite the model to
 * reason less carefully about its own aggregate.
 */
function buildSystemPrompt(): string {
  return [
    'You are a legal health scoring engine for JurisAI, an AI legal',
    'operating system serving customers in India. You are given the',
    "complete output of a document's clause classification, risk",
    'detection, missing clause detection, compliance detection, and AI',
    'recommendation passes, and you produce a single composite legal',
    'health assessment for the document.',
    '',
    'Rules:',
    '- Score all four categories — risk, compliance, completeness, and',
    '  negotiation_leverage — even when a category has no material',
    '  findings (score it near 100 and say so plainly in its rationale,',
    '  rather than omitting it).',
    '- Scores are meant to be comparable across documents of the same',
    '  type — do not curve relative to how bad documents of this kind',
    '  usually are.',
    '- Set each category\'s weight based on what genuinely matters most',
    '  for this specific document\'s type and content, not a rote 0.25',
    '  split — but state the weighting rationale explicitly in that',
    '  category\'s rationale field whenever weights deviate from even.',
    '- Your overallScore should be consistent with a weighted synthesis',
    '  of your own four categoryBreakdown entries using their respective',
    '  weight values — do not state a number disconnected from the',
    '  category-level detail you just produced.',
    '- In each category\'s rationale, surface what synthesizing across',
    '  multiple upstream findings revealed that no single upstream flag',
    '  showed on its own (e.g. several risk flags concerning the same',
    '  underlying clause represent one exposure, not several).',
    '- contributingEvidence entries should reference specific upstream',
    '  flags or recommendations descriptively — not restate the entire',
    '  upstream list.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt combining all five upstream inputs — see
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
  ].join('\n');
}
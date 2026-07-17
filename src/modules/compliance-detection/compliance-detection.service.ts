// src/modules/compliance-detection/compliance-detection.service.ts
// File 120 — JurisAI Compliance Detection module

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import type { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import type { ClassifiedClause } from '@/modules/clause-classification/clause-classification.schemas';

import { complianceDetectionResultSchema } from './compliance-detection.schemas';
import type { ComplianceDetectionRepository } from './compliance-detection.repository';
import type { ComplianceDetection } from './compliance-detection.entity';

/**
 * User-safe fallback messages per AIProviderError code. Same convention
 * as risk-detection.service.ts and missing-clause-detection.service.ts —
 * errorMessage persisted via markFailed() is expected to be safe to
 * eventually show a customer, never a raw SDK/provider error string.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'This document could not be checked for compliance issues — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Compliance detection could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Compliance detection timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Compliance detection service is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Compliance detection service is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Compliance detection failed due to an unexpected error. Please try again.';

/**
 * Service layer for the Compliance Detection module (File 117's schema,
 * File 116's table, File 119's repository). Fourth module in the Phase 2
 * pipeline (Clause Classification -> Risk Detection -> Missing Clause
 * Detection -> Compliance Detection -> Health Score).
 *
 * KEY DECISION — depends on THREE services, same shape as
 * RiskDetectionService and MissingClauseDetectionService:
 * DocumentAnalysisService, DocumentService, AND ClauseClassificationService.
 * This was flagged as an open question after File 116 and resolved here
 * having now seen both upstream services' real source in full — not
 * inherited by default. Compliance Detection's schema (File 117) has two
 * issue types with different input needs: `missing_requirement` issues
 * (e.g. no stamp duty/registration clause at all) are frequently
 * document-level facts that only the actual document text can establish,
 * not something a clause-category list reveals; `non_compliant_clause`
 * issues are explicitly clause-shaped (the schema allows `category` and
 * `excerpt` for them) and need the same reference clause breakdown Risk
 * Detection and Missing Clause Detection use, so the model isn't
 * re-deriving clause boundaries itself. Both inputs are genuinely
 * required for this module's own two-issue-type shape, not carried over
 * unexamined from the prior two modules.
 *
 * KEY DECISION — runComplianceDetection() takes documentText AND
 * classifiedClauses as explicit parameters, identical shape to
 * RiskDetectionService#runRiskDetection() and
 * MissingClauseDetectionService#runMissingClauseDetection(). This
 * service stays ignorant of how either input was produced or fetched;
 * the Route layer decides what "latest completed classification" means
 * operationally.
 *
 * KEY DECISION — ownership gates starting a compliance detection run,
 * same as every upstream service's create method: a new row + real AI
 * provider cost is write-like in consequence, not just a read.
 *
 * KEY DECISION — split into createComplianceDetection() (fast, returns a
 * pending row) and runComplianceDetection() (slow — the actual AI call).
 * Identical reasoning to every upstream service: whether the HTTP layer
 * awaits runComplianceDetection() before responding, or fires it without
 * awaiting, is a Route Handler decision this service should not make.
 */
export class ComplianceDetectionService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly complianceDetectionRepository: ComplianceDetectionRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis (via analysisService.getAnalysisById —
   * document visibility + analysis-belongs-to-document check), requires
   * ownership of the parent document (fetched directly via
   * documentService, since analysisService does not expose it), then
   * creates a 'pending' compliance_detections row and returns it
   * immediately. Does NOT call the AI provider — see class-level note.
   *
   * Does NOT check for a completed classification here — same division
   * of responsibility as createRiskDetection()/createMissingClauseDetection()
   * not checking for completed OCR: creating the row is cheap and
   * reversible, so the "is there anything usable to run against yet"
   * check belongs at runComplianceDetection() time (or the Route layer),
   * not here.
   */
  async createComplianceDetection(
    rawParams: unknown,
    analysisId: string,
  ): Promise<ComplianceDetection> {
    this.requireAuthentication();

    // Fetched directly for its owner_id — analysisService.getAnalysisById
    // below performs its own equivalent document fetch internally, but
    // does not return the document itself. Same deliberate duplication
    // as every upstream service's create method.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — mirrors createRiskDetection()/
    // createMissingClauseDetection() exactly: starting a compliance
    // detection run spends real AI cost, so ownership (not just RLS
    // visibility) gates it.
    this.requireOwnership(document.owner_id);

    // Confirms the analysis exists, is visible to this caller, and
    // actually belongs to the document identified by rawParams —
    // throws NotFoundError otherwise.
    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream service:
    // CreateComplianceDetectionInput ({ document_analysis_id }) is
    // narrower than the inherited create()'s Database-derived Insert
    // type. Cast follows BaseRepository's own established `as never`
    // pattern for this exact situation.
    const complianceDetection = await this.complianceDetectionRepository.create({
      document_analysis_id: analysis.id,
    } as never);

    return complianceDetection as ComplianceDetection;
  }

  /**
   * Lists all compliance detection runs for a given analysis, most
   * recent first. Mirrors listMissingClauseDetectionsForAnalysis()'s
   * reasoning exactly: re-validates the analysis first rather than
   * trusting compliance_detections' own RLS join alone, so an invisible
   * or cross-document analysisId surfaces as an explicit NotFoundError,
   * not a silently empty list.
   *
   * No requireOwnership() here, unlike createComplianceDetection() —
   * reads follow the same RLS-only-for-reads convention.
   */
  async listComplianceDetectionsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<ComplianceDetection[]> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.complianceDetectionRepository.findByDocumentAnalysisId(analysis.id);
  }

  /**
   * Fetches a single compliance detection run, scoped to an analysis the
   * caller can see. Mirrors getMissingClauseDetectionById()'s pattern
   * exactly, one module further down the pipeline: re-validate the
   * parent (the analysis) first, then verify the fetched compliance
   * detection's document_analysis_id actually matches it — a real but
   * differently-owned-or-scoped complianceDetectionId must 404, not leak
   * cross-analysis data.
   *
   * No requireOwnership() — same reasoning as
   * listComplianceDetectionsForAnalysis: this is a read.
   */
  async getComplianceDetectionById(
    rawParams: unknown,
    analysisId: string,
    complianceDetectionId: string,
  ): Promise<ComplianceDetection> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const complianceDetection =
      await this.complianceDetectionRepository.findByIdOrThrow(complianceDetectionId);

    if (complianceDetection.document_analysis_id !== analysis.id) {
      // Deliberately identical in shape to "compliance detection doesn't
      // exist" — same reasoning as getMissingClauseDetectionById()'s
      // equivalent check: do not let a caller distinguish "wrong
      // analysis" from "no such compliance detection at all" for a pair
      // they don't have access to.
      throw new NotFoundError('compliance_detections', complianceDetectionId);
    }

    return complianceDetection;
  }

  /**
   * Returns the most recent 'completed' classification for the given
   * analysis, via ClauseClassificationService (Amendment #2) — the read
   * the Route layer is expected to call BEFORE runComplianceDetection(),
   * to decide what to do if Clause Classification hasn't completed yet
   * for this analysis. Exposed here for the same convenience-passthrough
   * reason as every upstream service's identical method — so the Route
   * only needs to build this module's own Factory-resolved service, not
   * construct ClauseClassificationService itself.
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
   * AMENDMENT #3 (File 120) — added to unblock the AI Recommendation
   * Engine (File 128), which needs its own latest-completed-result read
   * exposed the same way getLatestCompletedClassificationForAnalysis()
   * already exposes ClauseClassificationService's. Mirrors that method's
   * shape exactly, in the opposite direction: this is Compliance
   * Detection exposing ITS OWN latest completed result to a sibling
   * downstream module, not fetching an upstream input. Identical
   * amendment to RiskDetectionService's Amendment #3 (File 104), applied
   * here for the same reason.
   *
   * FLAGGED ASSUMPTION: complianceDetectionRepository.findLatestByDocumentAnalysisId
   * (File 119) returns the most recent row regardless of status —
   * pending/processing/failed included. This method explicitly filters
   * for status === 'completed' and returns null otherwise, since a
   * 'failed' or still-'processing' row has no usable result. See
   * RiskDetectionService's identical amendment for the full reasoning on
   * why this isn't silently inherited from
   * ClauseClassificationService's unverified real implementation.
   *
   * No requireOwnership() — same reasoning as getComplianceDetectionById():
   * this is a read, gated by re-validating the analysis is visible to
   * the caller, not by ownership.
   */
  async getLatestCompletedComplianceDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<ComplianceDetection | null> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    const latest = await this.complianceDetectionRepository.findLatestByDocumentAnalysisId(
      analysis.id,
    );

    return latest && latest.status === 'completed' ? latest : null;
  }

  /**
   * Runs the actual compliance detection for an already-created
   * 'pending' row: marks it 'processing', calls generateWithFallback()
   * against File 117's schema, then marks 'completed' (with result +
   * which provider answered) or 'failed' (with a user-safe message).
   *
   * Takes both documentText and classifiedClauses explicitly — see
   * class-level KEY DECISION on why both are required for this module's
   * two-issue-type schema. classifiedClauses is expected to be the
   * `.clauses` array from a completed ClauseClassificationResult
   * (File 93), typically obtained by the Route layer via
   * getLatestCompletedClassificationForAnalysis() above.
   *
   * Never throws for an AI-provider failure — same reasoning as every
   * upstream service: a caller invoking this without awaiting it may
   * have no way to receive a thrown error. Does rethrow for anything
   * that isn't an AIProviderError.
   */
  async runComplianceDetection(
    complianceDetectionId: string,
    documentText: string,
    classifiedClauses: ClassifiedClause[],
  ): Promise<ComplianceDetection> {
    await this.complianceDetectionRepository.markProcessing(complianceDetectionId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(documentText, classifiedClauses),
        schema: complianceDetectionResultSchema,
      });

      return await this.complianceDetectionRepository.markCompleted(
        complianceDetectionId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.complianceDetectionRepository.markFailed(
          complianceDetectionId,
          message,
        );
      }

      // Not an AI-provider failure. Best-effort record the row as
      // failed so it doesn't sit in 'processing' forever, then rethrow —
      // identical structure to every upstream service's secondary
      // catch, same reasoning: a failure while persisting the failure
      // state must not mask the original error.
      await this.complianceDetectionRepository
        .markFailed(complianceDetectionId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 117's schema-level `.describe()`
 * instructions. Plain function, not a class method — same rationale as
 * every upstream service's buildSystemPrompt: no dependency on `this`,
 * easier to unit test in isolation.
 *
 * Explicitly bounds the model to the confirmed framework scope (Indian
 * Contract Act, stamp duty/registration, and the named sector-specific
 * frameworks) rather than leaving framework selection open-ended — the
 * fixed ComplianceFramework enum (File 117) already enforces this at the
 * schema level, but stating it in prose here reduces wasted model effort
 * reasoning about frameworks it cannot actually flag.
 */
function buildSystemPrompt(): string {
  return [
    'You are a compliance detection engine for JurisAI, an AI legal',
    'operating system serving customers in India. You are given a legal',
    "document's full text, plus a prior exhaustive breakdown of its",
    'existing clauses by category, and you identify compliance issues',
    'under Indian regulatory frameworks.',
    '',
    'You may only flag issues under these frameworks: the Indian Contract',
    'Act (core validity requirements — consideration, free consent,',
    'lawful object), stamp duty and registration requirements, the',
    'Consumer Protection Act, the Digital Personal Data Protection',
    '(DPDP) Act, and Indian labour law. Do not flag issues under any',
    'other framework, even if you believe one applies.',
    '',
    'Rules:',
    '- For each issue, decide whether it is a "missing_requirement" (the',
    '  document lacks something the applicable framework requires', 
    '  entirely — e.g. no stamp duty clause at all) or a',
    '  "non_compliant_clause" (an existing clause conflicts with a',
    '  framework requirement). Use "missing_requirement" only when',
    '  nothing in the document attempts to address the requirement.',
    '- Use the provided clause breakdown as your reference for which',
    '  clauses already exist and what category each belongs to — do not',
    '  re-derive clause boundaries or categories yourself.',
    '- For "non_compliant_clause" issues, excerpt must be verbatim text',
    '  from the document — never paraphrase, summarize, or reconstruct',
    '  clause text. Leave excerpt unset for "missing_requirement" issues,',
    '  since no such text exists.',
    '- Many "missing_requirement" issues (e.g. stamp duty/registration)',
    '  are document-level, not tied to any single clause category — omit',
    '  category for these rather than forcing an inexact match.',
    '- Be exhaustive: flag every genuine compliance issue you can',
    '  identify across all applicable frameworks, not just the single',
    '  most severe one. A document owner needs the full picture.',
    '- Calibrate severity consistently across documents, not relative to',
    '  "the worst issue in this particular document."',
    '- Reflect genuine uncertainty in `confidence` rather than defaulting',
    '  to a high value.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt combining both inputs this service
 * depends on — see class-level KEY DECISION. The clause breakdown is
 * serialized as JSON rather than prose, since it's already
 * machine-structured data (category, excerpt, order) that the model
 * should treat as reference input, not narrative to re-read.
 */
function buildUserPrompt(documentText: string, classifiedClauses: ClassifiedClause[]): string {
  return [
    '=== DOCUMENT TEXT ===',
    documentText,
    '',
    '=== CLAUSE BREAKDOWN (from prior classification) ===',
    JSON.stringify(classifiedClauses, null, 2),
  ].join('\n');
}
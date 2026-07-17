// src/modules/document-analysis/document-analysis.service.ts
// File 65 — JurisAI Document Analysis module
// Amended through Amendment #20 (see change note at getAnalysisById below)

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';

import { documentAnalysisResultSchema } from './analysis.schemas';
import type { DocumentAnalysisRepository } from './document-analysis.repository';
import type { DocumentAnalysis } from './document-analysis.entity';

/**
 * User-safe fallback messages per AIProviderError code. errorMessage
 * persisted via markFailed() (File 64) is documented as expected to be
 * safe to eventually show a customer — never the raw SDK/provider error
 * string, which could leak implementation detail or provider-account
 * specifics (e.g. rate-limit account identifiers).
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'This document could not be analyzed — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Analysis could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Analysis timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Analysis service is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Analysis service is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE = 'Analysis failed due to an unexpected error. Please try again.';

/**
 * Service layer for AI Document Analysis (File 62's schema, File 63's
 * table, File 64's repository). Orchestrates: authorizing the request
 * against the target document, constructing the AI prompt, calling
 * generateWithFallback() (File 61), and driving the
 * pending -> processing -> completed/failed lifecycle via File 64's
 * transition methods.
 *
 * KEY DECISION — documentText is an explicit parameter, not something
 * this service extracts itself. Document Analysis's job is "take text,
 * produce structured analysis" — OCR/text-extraction is a distinct,
 * unbuilt module (named separately from Document Analysis on
 * ARCHITECTURE.md's roadmap) with its own failure modes (image quality,
 * layout parsing) unrelated to prompting an LLM. Keeping this service
 * ignorant of how the text was produced mirrors the discipline
 * DocumentRepository/DocumentService already apply one layer down (e.g.
 * DocumentService never asks how Storage generates signed URLs).
 * Concretely: File 67's future route handler has an unresolved question
 * — "where does documentText come from" — and that's deliberate, not an
 * oversight.
 *
 * KEY DECISION — ownership, not just RLS visibility, gates starting an
 * analysis. DocumentService's reads rely purely on RLS (an admin
 * transparently sees every document), but its writes are owner-only
 * with no admin override, since File 45's RLS only grants admins a
 * SELECT policy. Starting an analysis creates a new row and spends real
 * AI provider cost — closer to a write than a read in consequence — so
 * this service calls requireOwnership() explicitly, layered on top of
 * (not duplicating) DocumentService's own checks.
 *
 * KEY DECISION — split into createAnalysis() (fast, returns a pending
 * row) and runAnalysis() (slow — the actual AI call). This service does
 * NOT decide how to avoid blocking the HTTP response; per BaseService's
 * documented responsibility boundary ("Route Handlers know about HTTP...
 * Services sit in between"), whether File 67 awaits runAnalysis()
 * before responding (simple, but blocks) or fires it without awaiting
 * via a platform-specific keep-alive mechanism (correct, but needs
 * tooling not yet confirmed in this project) is an HTTP-layer decision
 * this service shouldn't make on File 67's behalf. Both methods are
 * public so File 67 can wire them however that decision lands.
 */
export class DocumentAnalysisService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly analysisRepository: DocumentAnalysisRepository,
    private readonly documentService: DocumentService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target document (existence, RLS visibility,
   * not-soft-deleted, ownership), then creates a 'pending'
   * document_analyses row and returns it immediately. Does NOT call the
   * AI provider — that's runAnalysis()'s job, deliberately separated so
   * a caller gets a fast response with something to show/poll
   * immediately, matching File 67's planned "kicks off analysis, returns
   * immediately with a pending row" behavior.
   */
  async createAnalysis(rawParams: unknown): Promise<DocumentAnalysis> {
    this.requireAuthentication();

    // Reuses DocumentService's own fetch-and-check sequence (RLS
    // visibility + soft-delete enforcement) rather than querying
    // DocumentRepository directly — see class-level note on why this
    // goes through DocumentService, not around it.
    const document = await this.documentService.getDocumentById(rawParams);

    // No admin override — see class-level "ownership gates starting an
    // analysis" note. Mirrors DocumentService#updateDocument/deleteDocument
    // exactly (requireAuthentication(), then requireOwnership() once the
    // resource is in hand).
    this.requireOwnership(document.owner_id);

    // KNOWN FLAGGED MISMATCH (see File 64): CreateDocumentAnalysisInput
    // ({ document_id }) is narrower than the inherited create()'s
    // Database-derived Insert type. Cast follows the same `as never`
    // idiom BaseRepository itself uses for its generic-T create/update.
    const analysis = await this.analysisRepository.create({
      document_id: document.id,
    } as never);

    return analysis as DocumentAnalysis;
  }

  /**
   * Amendment #19. Lists all analysis runs for a document, most
   * recent first (File 64's findByDocumentId() ordering).
   *
   * Re-fetches the parent document via DocumentService.getDocumentById()
   * first, rather than trusting document_analyses' own RLS join alone
   * and calling analysisRepository.findByDocumentId() directly. Mirrors
   * DocumentService#getDownloadUrl's own reasoning (File 48): an
   * invisible or soft-deleted document should surface as an explicit
   * NotFoundError, not a silently empty analyses list — the two are
   * indistinguishable to a caller otherwise.
   *
   * No requireOwnership() here, unlike createAnalysis() — reads follow
   * DocumentService's existing RLS-only-for-reads convention (an admin's
   * SELECT policy branch sees everything transparently); only *starting*
   * an analysis was treated as write-like enough to need an explicit
   * ownership check on top of RLS.
   */
  async listAnalysesForDocument(rawParams: unknown): Promise<DocumentAnalysis[]> {
    this.requireAuthentication();

    const document = await this.documentService.getDocumentById(rawParams);

    return this.analysisRepository.findByDocumentId(document.id);
  }

  /**
   * NEW — Amendment #20. Fetches a single analysis run, scoped to a
   * document the caller can see. Needed by File 69
   * (GET /api/documents/[id]/analyses/[analysisId]).
   *
   * Mirrors listAnalysesForDocument's (Amendment #19) pattern: re-fetch
   * the parent document via DocumentService.getDocumentById() first, so
   * an invisible or soft-deleted document surfaces as NotFoundError
   * rather than a bare "analysis not found" that would leak whether the
   * document itself exists.
   *
   * rawParams is passed straight through to getDocumentById() exactly
   * as listAnalysesForDocument already does — unchanged, since this
   * service does not have DocumentService's real parsing contract for
   * that argument confirmed this session, and reshaping it without that
   * confirmation would be a guess.
   *
   * Additionally verifies the fetched analysis's document_id matches
   * the resolved document's id. An analysisId that is real but belongs
   * to a different document must 404, not return cross-document data —
   * findByIdOrThrow() (File 22/64) has no way to know about this
   * constraint on its own, since it only knows about the
   * document_analyses table in isolation, not which document "owns" the
   * URL the caller actually requested.
   *
   * No requireOwnership() — same reasoning as listAnalysesForDocument:
   * this is a read, and reads follow DocumentService's RLS-only
   * convention. Only createAnalysis() (a write, with real AI cost) adds
   * an explicit ownership check.
   */
  async getAnalysisById(rawParams: unknown, analysisId: string): Promise<DocumentAnalysis> {
    this.requireAuthentication();

    const document = await this.documentService.getDocumentById(rawParams);

    const analysis = await this.analysisRepository.findByIdOrThrow(analysisId);

    if (analysis.document_id !== document.id) {
      // Deliberately identical in shape to "analysis doesn't exist" —
      // see method-level note above. Do not add detail here that would
      // let a caller distinguish "wrong document" from "no such
      // analysis at all"; that distinction itself is information this
      // caller should not get about a document/analysis pair they
      // don't have access to.
      throw new NotFoundError('document_analyses', analysisId);
    }

    return analysis;
  }

  /**
   * Runs the actual analysis for an already-created 'pending' row: marks
   * it 'processing', calls generateWithFallback() against File 62's
   * schema, then marks 'completed' (with result + which provider
   * answered) or 'failed' (with a user-safe message).
   *
   * Never throws for an AI-provider failure — that failure is captured
   * in the row's status instead, since a caller invoking this without
   * awaiting it (per the class-level fire-and-forget note) may have no
   * way to receive a thrown error at all. DOES rethrow for anything that
   * isn't an AIProviderError (e.g. a DatabaseError while persisting the
   * outcome, or a genuine bug) — those indicate a real problem, not a
   * "this particular analysis run failed" outcome, and swallowing them
   * would hide it.
   */
  async runAnalysis(analysisId: string, documentText: string): Promise<DocumentAnalysis> {
    await this.analysisRepository.markProcessing(analysisId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: documentText,
        schema: documentAnalysisResultSchema,
      });

      return await this.analysisRepository.markCompleted(analysisId, result, providerUsed);
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.analysisRepository.markFailed(analysisId, message);
      }

      // Not an AI-provider failure. Best-effort record the row as
      // failed so it doesn't sit in 'processing' forever, then rethrow
      // so the real error isn't silently lost. The secondary catch here
      // is deliberate: if markFailed itself throws (e.g. the DB is
      // down), that shouldn't mask the original error being rethrown
      // below it.
      await this.analysisRepository
        .markFailed(analysisId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing File 62's schema-level `.describe()`
 * instructions. A plain function, not a class method — no dependency on
 * `this`, easier to unit test in isolation once File 41-style test
 * suites are wired up for this module.
 *
 * Deliberately restates the "no generic 'consult a lawyer' advice" rule
 * from riskFlagSchema.recommendation's own .describe(): schema-level
 * .describe() text steers individual field shape well, but a
 * system-prompt-level restatement of this actual product requirement is
 * worth the redundancy — a model can satisfy a field's shape while
 * still producing genuinely generic content within it.
 */
function buildSystemPrompt(): string {
  return [
    'You are a legal document analysis engine for JurisAI, an AI legal',
    'operating system serving customers in India. You analyze legal',
    'documents and produce structured, actionable findings.',
    '',
    'Rules:',
    '- Write for a non-lawyer: plain language, no unexplained legal jargon.',
    '- Every recommendation must be concrete and actionable — never generic',
    '  advice like "consult a lawyer" or "review carefully". Say exactly',
    '  what the customer could ask for, negotiate, or check.',
    '- Base every finding strictly on the document text provided. Do not',
    '  assume facts, jurisdiction-specific defaults, or clauses that are',
    '  not present in the text.',
    '- If the document text appears incomplete, truncated, or not a legal',
    '  document at all, still return the full schema shape — reflect that',
    '  uncertainty honestly in the summary and keep riskFlags/keyClauses',
    '  empty rather than inventing content to fill them.',
  ].join('\n');
}
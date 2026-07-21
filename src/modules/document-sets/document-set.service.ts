// src/modules/document-sets/document-set.service.ts
// Multi-document module — File number not yet assigned.
//
// Built directly against the real, pasted ai-legal-insight.service.ts for
// the create/list/get + separate run() lifecycle shape (pending row
// created and returned immediately; the AI call itself is a distinct
// method the Route layer invokes after), and against document.repository.ts
// / document-analysis.repository.ts for the membership/ownership pieces.
//
// KEY DECISION, DEPARTS FROM ai-legal-insight.service.ts's COMPOSITION
// SHAPE — this service composes REPOSITORIES directly (DocumentRepository,
// for per-document ownership checks), not sibling Services. Confirmed
// against last session's own flagged finding (Observability's continuation
// prompt): "AI Legal Insight precedent" specifically means composing
// sibling SERVICES that each own a synthesis pipeline stage — that's the
// right shape for the synthesis method below (runSetAnalysis(), which
// takes each document's already-completed DocumentAnalysisResult as
// explicit input, mirroring runAiLegalInsight()'s six-parameter shape).
// It is NOT the right shape for membership management (addDocumentToSet /
// removeDocumentFromSet), which needs DocumentRepository directly for a
// single fact (does this document belong to this caller) — pulling in the
// full DocumentService for that one check would be the same unjustified
// weight Observability's own continuation prompt already flagged once
// this session. Both shapes coexist deliberately in this one service; not
// a contradiction, just two different needs.
//
// FLAGGED ASSUMPTION, carried forward from ai-legal-insight.service.ts's
// own identical flag: BaseService's real source was never independently
// pasted this session either. Constructor signature and
// requireAuthentication()/requireOwnership() are inferred from consistent
// usage across every other service in this project, ai-legal-insight.service.ts
// included.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError, ValidationError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import type { DocumentRepository } from '@/modules/documents/document.repository';
import type { DocumentAnalysisResult } from '@/modules/document-analysis/analysis.schemas';

import { documentSetAnalysisResultSchema } from './document-set-analysis.schemas';
import type { DocumentSetRepository } from './document-set.repository';
import type {
  DocumentSetAnalysisRepository,
  DocumentSetAnalysis,
} from './document-set-analysis.repository';
import type { Database } from '@/core/supabase/database.types';

type DocumentSetRow = Database['public']['Tables']['document_sets']['Row'];

/**
 * User-safe fallback messages per AIProviderError code — same convention
 * as ai-legal-insight.service.ts's identical table.
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'A combined summary could not be generated for this document set — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'Document set synthesis could not be completed due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'Document set synthesis timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]:
    'Document set synthesis is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]:
    'Document set synthesis is temporarily unavailable. Please try again shortly.',
};

const GENERIC_FAILURE_MESSAGE =
  'Document set synthesis failed due to an unexpected error. Please try again.';

/**
 * Minimum number of member documents required before a synthesis run can
 * be created. FLAGGED, ARBITRARY: 2 is the obvious floor (a "combined
 * summary" of one document is just that document's own analysis, already
 * served by document-analysis), but no product requirement was ever
 * discussed pinning this number specifically. Revisit if a real minimum
 * is decided.
 */
const MIN_MEMBERS_FOR_SYNTHESIS = 2;

export class DocumentSetService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly documentSetRepository: DocumentSetRepository,
    private readonly documentSetAnalysisRepository: DocumentSetAnalysisRepository,
    private readonly documentRepository: DocumentRepository,
  ) {
    super(currentUser);
  }

  /**
   * Creates a new, empty document_set owned by the current user. Adding
   * members is a separate call (addDocumentToSet below) — mirrors this
   * project's established "cheap, reversible create; the real work
   * happens in later, separate calls" convention (see every upstream
   * module's createX()).
   */
  async createDocumentSet(name: string): Promise<DocumentSetRow> {
    const user = this.requireAuthentication();

    // KNOWN FLAGGED MISMATCH, same idiom as every upstream service's
    // create method: the narrow { owner_id, name } shape here is
    // presumably narrower than the inherited create()'s Database-derived
    // Insert type. Cast follows BaseRepository's own established
    // `as never` pattern.
    return this.documentSetRepository.create({
      owner_id: user.id,
      name,
    } as never);
  }

  /**
   * Lists every document_set owned by the current user. RLS-only, no
   * explicit ownership filter — same posture as every read in this
   * module.
   */
  async listDocumentSets(): Promise<DocumentSetRow[]> {
    this.requireAuthentication();

    return this.documentSetRepository.findManyForOwner();
  }

  /**
   * Fetches a single document_set the caller can see (RLS-scoped —
   * findByIdOrThrow already 404s for a set the caller doesn't own, since
   * it's invisible under document_sets_select_own).
   */
  async getDocumentSetById(documentSetId: string): Promise<DocumentSetRow> {
    this.requireAuthentication();

    return this.documentSetRepository.findByIdOrThrow(documentSetId);
  }

  /**
   * Adds a document to a set. Requires ownership of BOTH the set AND the
   * document being added — this is the enforcement point
   * document_set_members' own migration flagged as missing at the RLS
   * layer (that policy only checks the set; a caller could otherwise add
   * any document id, owned or not, to a set they own). Fetches the
   * document directly via DocumentRepository (not DocumentService) for
   * the same single-fact-only reason document.repository.ts's own
   * ownership note describes — pulling in the full DocumentService here
   * would be unjustified weight for one owner_id check.
   */
  async addDocumentToSet(documentSetId: string, documentId: string): Promise<void> {
    this.requireAuthentication();

    const set = await this.documentSetRepository.findByIdOrThrow(documentSetId);
    this.requireOwnership(set.owner_id);

    const document = await this.documentRepository.findByIdOrThrow(documentId);
    this.requireOwnership(document.owner_id);

    await this.documentSetRepository.addMember(documentSetId, documentId);
  }

  /**
   * Removes a document from a set. Requires ownership of the set only —
   * NOT the document. Deliberate: removing a document from a set you own
   * shouldn't fail just because the document was later transferred or
   * soft-deleted elsewhere (this method doesn't re-check the document's
   * current state at all, only that the set belongs to the caller) —
   * "take this out of my set" is a fact about the set, not about the
   * document's own current ownership.
   */
  async removeDocumentFromSet(documentSetId: string, documentId: string): Promise<void> {
    this.requireAuthentication();

    const set = await this.documentSetRepository.findByIdOrThrow(documentSetId);
    this.requireOwnership(set.owner_id);

    await this.documentSetRepository.removeMember(documentSetId, documentId);
  }

  /**
   * Lists the full document rows belonging to a set. Owner-or-visible
   * only (no requireOwnership — this is a read, same convention as every
   * upstream getXById()/listXForY()).
   */
  async listSetMembers(documentSetId: string): Promise<ReturnType<DocumentSetRepository['findMemberDocuments']>> {
    this.requireAuthentication();

    await this.documentSetRepository.findByIdOrThrow(documentSetId);

    return this.documentSetRepository.findMemberDocuments(documentSetId);
  }

  /**
   * Lists all synthesis runs for a set, most recent first. Mirrors
   * ai-legal-insight.service.ts's listAiLegalInsightsForAnalysis() shape:
   * re-validates the parent set exists/is visible first.
   */
  async listSetAnalyses(documentSetId: string): Promise<DocumentSetAnalysis[]> {
    this.requireAuthentication();

    await this.documentSetRepository.findByIdOrThrow(documentSetId);

    return this.documentSetAnalysisRepository.findByDocumentSetId(documentSetId);
  }

  /**
   * Fetches a single synthesis run, scoped to a set the caller can see.
   * Mirrors ai-legal-insight.service.ts's getAiLegalInsightById() exactly,
   * including the deliberately-identical-shape NotFoundError for
   * "wrong set" vs "no such run" — do not let a caller distinguish the
   * two for a pair they don't have access to.
   */
  async getSetAnalysisById(
    documentSetId: string,
    setAnalysisId: string,
  ): Promise<DocumentSetAnalysis> {
    this.requireAuthentication();

    await this.documentSetRepository.findByIdOrThrow(documentSetId);

    const setAnalysis = await this.documentSetAnalysisRepository.findByIdOrThrow(setAnalysisId);

    if (setAnalysis.document_set_id !== documentSetId) {
      throw new NotFoundError('document_set_analyses', setAnalysisId);
    }

    return setAnalysis;
  }

  /**
   * Returns the latest COMPLETED synthesis run for a set, or null — same
   * "latest completed" convenience-read convention every upstream module
   * exposes.
   */
  async getLatestCompletedSetAnalysis(documentSetId: string): Promise<DocumentSetAnalysis | null> {
    this.requireAuthentication();

    await this.documentSetRepository.findByIdOrThrow(documentSetId);

    return this.documentSetAnalysisRepository.findLatestCompletedByDocumentSetId(documentSetId);
  }

  /**
   * Creates a new 'pending' synthesis run for a set and returns it
   * immediately — does NOT call the AI provider (that's runSetAnalysis()
   * below), mirroring every upstream module's create/run split exactly.
   *
   * Requires ownership of the set (starting a run spends real AI cost,
   * same reasoning as every upstream createX()).
   *
   * Enforces MIN_MEMBERS_FOR_SYNTHESIS — a set with 0 or 1 members has no
   * "combined summary across documents" to produce yet. Throws
   * ValidationError (a real, confirmed class in this project — used
   * elsewhere for exactly this kind of precondition failure), not a
   * generic Error.
   */
  async createSetAnalysis(documentSetId: string): Promise<DocumentSetAnalysis> {
    this.requireAuthentication();

    const set = await this.documentSetRepository.findByIdOrThrow(documentSetId);
    this.requireOwnership(set.owner_id);

    const memberIds = await this.documentSetRepository.findMemberDocumentIds(documentSetId);

    if (memberIds.length < MIN_MEMBERS_FOR_SYNTHESIS) {
      throw new ValidationError(
        `A document set needs at least ${MIN_MEMBERS_FOR_SYNTHESIS} documents before a combined synthesis can be run.`,
        { documentSetId, memberCount: memberIds.length, required: MIN_MEMBERS_FOR_SYNTHESIS },
      );
    }

    // KNOWN FLAGGED MISMATCH, same idiom as createDocumentSet() above.
    return this.documentSetAnalysisRepository.create({
      document_set_id: documentSetId,
    } as never);
  }

  /**
   * Runs the actual cross-document synthesis for an already-created
   * 'pending' row: marks it 'processing', calls generateWithFallback()
   * against documentSetAnalysisResultSchema, then marks 'completed' (with
   * the validated result + which provider answered) or 'failed' (with a
   * user-safe message). Structurally identical to
   * ai-legal-insight.service.ts's runAiLegalInsight() — same try/catch
   * shape, same "never throw for an AI-provider failure, do rethrow for
   * anything else" contract, same best-effort markFailed in the secondary
   * catch so a non-AI failure doesn't leave the row stuck in
   * 'processing' forever.
   *
   * Takes `memberAnalyses` as an explicit parameter — each member
   * document's own latest completed DocumentAnalysisResult, keyed by
   * document id/title — rather than fetching them internally. Same
   * "Route layer decides what 'latest completed X' means operationally,
   * this service just synthesizes over whatever it's handed" discipline
   * ai-legal-insight.service.ts's own class-level KEY DECISION documents.
   * The Route layer is expected to gather one DocumentAnalysisResult per
   * member document (via the existing document-analysis module) before
   * calling this.
   */
  async runSetAnalysis(
    setAnalysisId: string,
    memberAnalyses: Array<{ documentId: string; documentTitle: string; analysis: DocumentAnalysisResult }>,
  ): Promise<DocumentSetAnalysis> {
    await this.documentSetAnalysisRepository.markProcessing(setAnalysisId);

    try {
      const { result, providerUsed } = await generateWithFallback({
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(memberAnalyses),
        schema: documentSetAnalysisResultSchema,
      });

      return await this.documentSetAnalysisRepository.markCompleted(
        setAnalysisId,
        result,
        providerUsed,
      );
    } catch (error) {
      if (error instanceof AIProviderError) {
        const message = USER_SAFE_FAILURE_MESSAGES[error.code] ?? GENERIC_FAILURE_MESSAGE;
        return await this.documentSetAnalysisRepository.markFailed(setAnalysisId, message);
      }

      await this.documentSetAnalysisRepository
        .markFailed(setAnalysisId, GENERIC_FAILURE_MESSAGE)
        .catch(() => {
          /* see comment above — original error takes priority */
        });

      throw error;
    }
  }
}

/**
 * System prompt reinforcing document-set-analysis.schemas.ts's `.describe()`
 * instructions — same reinforcement-at-the-prompt-level convention
 * ai-legal-insight.service.ts's own buildSystemPrompt uses. Explicitly
 * distinguishes this from a single document's analysis and from pairwise
 * comparison, since both are the most likely default the model would fall
 * back to without this instruction.
 */
function buildSystemPrompt(): string {
  return [
    'You are a cross-document synthesis engine for JurisAI, an AI legal',
    'operating system serving customers in India. You are given the',
    'individual analysis results for every document in a document set, and',
    'you produce ONE combined summary and set of cross-document insights',
    'for the set as a whole.',
    '',
    'Rules:',
    '- Your job is set-level synthesis, not a restatement of any single',
    "  document's own analysis, and not a pairwise comparison of two",
    '  documents against each other. Look for patterns that only become',
    '  visible when considering three or more — or all — of the documents',
    '  together.',
    '- Every cross-document insight should genuinely involve two or more',
    '  documents. Do not create an insight that only restates one',
    "  document's own finding in different words.",
    '- Write in plain language for someone without a legal background —',
    '  explain what each pattern means for them practically.',
    '- Do not manufacture insights or themes to hit a target count. A set',
    '  with few genuine cross-document patterns should produce few',
    '  insights, not padded ones.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt from every member document's own analysis
 * result, each clearly labeled with the document's id and title so the
 * model can populate sourceDocumentIds/sourceDocumentTitles accurately.
 * Serialized as JSON per document, consistent with every upstream
 * module's identical treatment of structured input.
 */
function buildUserPrompt(
  memberAnalyses: Array<{ documentId: string; documentTitle: string; analysis: DocumentAnalysisResult }>,
): string {
  return memberAnalyses
    .map(
      ({ documentId, documentTitle, analysis }) =>
        `=== DOCUMENT (id: ${documentId}, title: "${documentTitle}") ===\n${JSON.stringify(analysis, null, 2)}`,
    )
    .join('\n\n');
}
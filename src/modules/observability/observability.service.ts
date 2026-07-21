// src/modules/observability/observability.service.ts
// JurisAI Observability module — Phase 3

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AuthorizationError, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';

import type { ProfileRepository } from '@/modules/profiles/profile.repository';
import type { DocumentRepository } from '@/modules/documents/document.repository';
import type { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';

import type {
  RiskDetectionRepository,
  RiskDetectionWithDocumentInfo,
} from '@/modules/risk-detection/risk-detection.repository';
import type {
  AiLegalInsightRepository,
  AiLegalInsightWithDocumentInfo,
} from '@/modules/ai-legal-insight/ai-legal-insight.repository';
import type {
  AIRecommendationRepository,
  AIRecommendationWithDocumentInfo,
} from '@/modules/ai-recommendation/ai-recommendation.repository';
import type {
  ClauseClassificationRepository,
  ClauseClassificationWithDocumentInfo,
} from '@/modules/clause-classification/clause-classification.repository';
import type {
  ComplianceDetectionRepository,
  ComplianceDetectionWithDocumentInfo,
} from '@/modules/compliance-detection/compliance-detection.repository';
import type {
  LegalHealthScoreRepository,
  LegalHealthScoreWithDocumentInfo,
} from '@/modules/legal-health-score/legal-health-score.repository';
import type {
  MissingClauseDetectionRepository,
  MissingClauseDetectionWithDocumentInfo,
} from '@/modules/missing-clause-detection/missing-clause-detection.repository';
import type {
  ChatConversationRepository,
  ChatConversationWithDocumentInfo,
} from '@/modules/chat/chat.repository';

import type { RiskDetection } from '@/modules/risk-detection/risk-detection.entity';
import type { AiLegalInsight } from '@/modules/ai-legal-insight/ai-legal-insight.entity';
import type { AIRecommendation } from '@/modules/ai-recommendation/ai-recommendation.entity';
import type { ClauseClassification } from '@/modules/clause-classification/clause-classification.entity';
import type { ComplianceDetection } from '@/modules/compliance-detection/compliance-detection.entity';
import type { LegalHealthScore } from '@/modules/legal-health-score/legal-health-score.entity';
import type { MissingClauseDetection } from '@/modules/missing-clause-detection/missing-clause-detection.entity';
import type { ChatConversation } from '@/modules/chat/chat.entity';

/**
 * The eight Phase 2 modules Observability reports on. String literal,
 * not re-derived from any generated enum — there is no single database
 * enum spanning all eight tables (each module's own status column has
 * its own distinct Postgres enum, per every module repository's Row
 * type), so this union is Observability's own, defined here.
 */
export type ObservabilityModule =
  | 'risk_detection'
  | 'ai_legal_insight'
  | 'ai_recommendation'
  | 'clause_classification'
  | 'compliance_detection'
  | 'legal_health_score'
  | 'missing_clause_detection'
  | 'chat_conversation';

/**
 * One normalized run-history row, the common shape every module's own
 * row gets mapped into for display. `status`/`providerUsed` are widened
 * to `string | null` rather than each module's own specific enum union
 * — a deliberate widening for a cross-module reporting type; call sites
 * needing a specific module's real enum should go to that module's own
 * service/repository directly, not through Observability.
 *
 * FLAGGED, DELIBERATE, PER THE CHAT-SHAPE DECISION MADE THIS SESSION:
 * `status`/`errorMessage` are `null` for every `chat_conversation` row,
 * not because data is missing but because chat_conversations has no
 * such columns at all (confirmed against the real database.types.ts) —
 * a conversation is not a single run that succeeds or fails. Consumers
 * of this type (routes, frontend) must not treat a chat row's `null`
 * status the same as a "not yet run" module row — the absence means
 * something different for this one module, and should be rendered
 * differently, not just left blank.
 */
export interface ObservabilityRun {
  module: ObservabilityModule;
  id: string;
  documentAnalysisId: string;
  status: string | null;
  providerUsed: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  /**
   * Present (non-null) whenever the caller's query path resolved
   * document context — always populated for the admin view (embedded
   * directly in the query), and populated for the firm-owner view too,
   * since that path already has every document's title in hand from
   * its own four-hop chain and can attach it without an extra query.
   */
  documentTitle: string | null;
  documentOwnerId: string | null;
}

/**
 * Service layer for the Observability module (Phase 3). Confirmed scope
 * (decided with the user, not assumed): run-history/failure visibility
 * across all eight Phase 2 modules (status, provider used, error
 * message, timing) — explicitly NOT cost/usage tracking, NOT general
 * product analytics.
 *
 * ARCHITECTURE DECISION, FLAGGED RATHER THAN SILENTLY RESOLVED: the
 * confirmed scoping conversation described this module's query strategy
 * as "reuse the eight existing per-module repositories, aggregate in a
 * new ObservabilityService... matching the precedent AI Legal Insights
 * already set (one Service composing across sibling repositories)" — but
 * a separately-listed build-order checklist named an "ObservabilityRepository"
 * as a distinct step before this Service. No such repository is built
 * here: every repository in this project (BaseRepository's own design)
 * is generic over exactly one table, and Observability has no table of
 * its own to back one. The detailed architecture description is treated
 * as authoritative over the terser checklist; this Service composes the
 * eight module repositories (plus profile/document/document-analysis)
 * directly, the same role AiLegalInsightService plays composing sibling
 * SERVICES — except this module composes sibling REPOSITORIES directly,
 * since it needs raw run rows across eight tables, not each module's own
 * business logic.
 *
 * TWO QUERY PATHS, per the confirmed scope's two views:
 *
 *  1. getFirmRunHistory() — "Firm-owner: their own firm's runs only."
 *     Resolves the CALLING user's own firm via their own profile
 *     (profileRepository.findById(currentUser.id) -> profile.firm_id),
 *     never from a client-supplied firmId parameter. FLAGGED DESIGN
 *     DECISION: trusting a client-supplied firmId would let any
 *     'law_firm'-role user query another firm's data by changing a
 *     request parameter — resolving it server-side from the
 *     authenticated user's own profile closes that hole by construction
 *     rather than requiring a separate ownership check.
 *
 *  2. getAdminRunHistory() — "Admin: every run, across all users/firms."
 *     No firm filter; each module's own findManyForAdminView() already
 *     embeds document title/owner_id in a single Postgrest call.
 *
 * Role gating: requireRole('law_firm', 'admin') for the firm-scoped
 * view (an admin can drill into a specific firm's view; FLAGGED — not
 * explicitly confirmed with the user, a reasonable admin-override
 * default consistent with BaseService#requireOwnership's own
 * allowRoles pattern, not something to silently assume is definitely
 * wanted). requireRole('admin') only for the all-firms admin view — no
 * override, since there is no "owner" of the entire platform's data to
 * fall back to.
 */
export class ObservabilityService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly profileRepository: ProfileRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly documentAnalysisRepository: DocumentAnalysisRepository,
    private readonly riskDetectionRepository: RiskDetectionRepository,
    private readonly aiLegalInsightRepository: AiLegalInsightRepository,
    private readonly aiRecommendationRepository: AIRecommendationRepository,
    private readonly clauseClassificationRepository: ClauseClassificationRepository,
    private readonly complianceDetectionRepository: ComplianceDetectionRepository,
    private readonly legalHealthScoreRepository: LegalHealthScoreRepository,
    private readonly missingClauseDetectionRepository: MissingClauseDetectionRepository,
    private readonly chatConversationRepository: ChatConversationRepository,
  ) {
    super(currentUser);
  }

  /**
   * Firm-owner view: every run across every document belonging to the
   * calling user's own firm. Implements the four sequential hops
   * confirmed this session (profiles -> owner ids -> documents ->
   * document_analyses -> each of the eight module repos), since
   * documents.owner_id has no FK to profiles.id and so cannot be
   * embedded in one Postgrest call.
   *
   * Role-gated to 'law_firm' (the calling user IS the firm) or 'admin'
   * (drill-in override — flagged in class-level doc comment above).
   *
   * Throws NotFoundError if the calling user's own profile has no
   * firm_id set — a 'law_firm'-role user with no associated firm has
   * nothing this view can meaningfully show. FLAGGED: NotFoundError is
   * the closest existing AppError type for this (no dedicated
   * "no firm associated" error class exists in what's been pasted this
   * session) — imprecise but not silently swallowed.
   */
  async getFirmRunHistory(): Promise<ObservabilityRun[]> {
    const user = this.requireRole('law_firm', 'admin');

    const callerProfile = await this.profileRepository.findByIdOrThrow(user.id);

    if (!callerProfile.firm_id) {
      throw new NotFoundError('firms', `associated with user ${user.id}`);
    }

    const firmId = callerProfile.firm_id;

    const firmProfiles = await this.profileRepository.findByFirmId(firmId);
    const ownerIds = firmProfiles.map((p) => p.id);

    const documents = await this.documentRepository.findManyForOwnerIds(ownerIds);
    const documentIds = documents.map((d) => d.id);
    const documentTitleById = new Map(documents.map((d) => [d.id, d]));

    const analyses = await this.documentAnalysisRepository.findManyForDocumentIds(documentIds);
    const analysisIds = analyses.map((a) => a.id);
    const analysisById = new Map(analyses.map((a) => [a.id, a]));

    const [
      riskDetections,
      aiLegalInsights,
      aiRecommendations,
      clauseClassifications,
      complianceDetections,
      legalHealthScores,
      missingClauseDetections,
      chatConversations,
    ] = await Promise.all([
      this.riskDetectionRepository.findManyForAnalysisIds(analysisIds),
      this.aiLegalInsightRepository.findManyForAnalysisIds(analysisIds),
      this.aiRecommendationRepository.findManyForAnalysisIds(analysisIds),
      this.clauseClassificationRepository.findManyForAnalysisIds(analysisIds),
      this.complianceDetectionRepository.findManyForAnalysisIds(analysisIds),
      this.legalHealthScoreRepository.findManyForAnalysisIds(analysisIds),
      this.missingClauseDetectionRepository.findManyForAnalysisIds(analysisIds),
      this.chatConversationRepository.findManyForAnalysisIds(analysisIds),
    ]);

    /**
     * Attaches document title/owner_id to a firm-view row by walking
     * document_analysis_id -> document_id -> document, reusing data
     * already fetched in this same call rather than issuing another
     * query. Returns { title: null, ownerId: null } if either hop can't
     * be resolved (should not happen for rows genuinely reached via the
     * chain above, but not assumed to be impossible).
     */
    const resolveDocumentInfo = (
      documentAnalysisId: string,
    ): { title: string | null; ownerId: string | null } => {
      const analysis = analysisById.get(documentAnalysisId);
      if (!analysis) {
        return { title: null, ownerId: null };
      }
      const document = documentTitleById.get(analysis.document_id);
      if (!document) {
        return { title: null, ownerId: null };
      }
      return { title: document.title, ownerId: document.owner_id };
    };

    return [
      ...riskDetections.map((row) => mapRunLifecycleRow('risk_detection', row, resolveDocumentInfo)),
      ...aiLegalInsights.map((row) =>
        mapRunLifecycleRow('ai_legal_insight', row, resolveDocumentInfo),
      ),
      ...aiRecommendations.map((row) =>
        mapRunLifecycleRow('ai_recommendation', row, resolveDocumentInfo),
      ),
      ...clauseClassifications.map((row) =>
        mapRunLifecycleRow('clause_classification', row, resolveDocumentInfo),
      ),
      ...complianceDetections.map((row) =>
        mapRunLifecycleRow('compliance_detection', row, resolveDocumentInfo),
      ),
      ...legalHealthScores.map((row) =>
        mapRunLifecycleRow('legal_health_score', row, resolveDocumentInfo),
      ),
      ...missingClauseDetections.map((row) =>
        mapRunLifecycleRow('missing_clause_detection', row, resolveDocumentInfo),
      ),
      ...chatConversations.map((row) => mapChatRow(row, resolveDocumentInfo)),
    ];
  }

  /**
   * Admin view: every run, across every user/firm, no filter. Each
   * module's own findManyForAdminView() already embeds
   * document_analyses(document_id, documents(title, owner_id)) in one
   * Postgrest call — no four-hop chain needed here, since firm-scoping
   * (the reason that chain exists at all) doesn't apply to this view.
   *
   * Role-gated strictly to 'admin' — no override, since there is no
   * "owner" of platform-wide data to fall back to the way
   * getFirmRunHistory() falls back to an admin override.
   */
  async getAdminRunHistory(): Promise<ObservabilityRun[]> {
    this.requireRole('admin');

    const [
      riskDetections,
      aiLegalInsights,
      aiRecommendations,
      clauseClassifications,
      complianceDetections,
      legalHealthScores,
      missingClauseDetections,
      chatConversations,
    ] = await Promise.all([
      this.riskDetectionRepository.findManyForAdminView(),
      this.aiLegalInsightRepository.findManyForAdminView(),
      this.aiRecommendationRepository.findManyForAdminView(),
      this.clauseClassificationRepository.findManyForAdminView(),
      this.complianceDetectionRepository.findManyForAdminView(),
      this.legalHealthScoreRepository.findManyForAdminView(),
      this.missingClauseDetectionRepository.findManyForAdminView(),
      this.chatConversationRepository.findManyForAdminView(),
    ]);

    const resolveEmbeddedDocumentInfo = (row: {
      document_analyses: { documents: { title: string; owner_id: string } | null } | null;
    }): { title: string | null; ownerId: string | null } => {
      const documents = row.document_analyses?.documents ?? null;
      return { title: documents?.title ?? null, ownerId: documents?.owner_id ?? null };
    };

    return [
      ...riskDetections.map((row) =>
        mapRunLifecycleRow('risk_detection', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...aiLegalInsights.map((row) =>
        mapRunLifecycleRow('ai_legal_insight', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...aiRecommendations.map((row) =>
        mapRunLifecycleRow('ai_recommendation', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...clauseClassifications.map((row) =>
        mapRunLifecycleRow('clause_classification', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...complianceDetections.map((row) =>
        mapRunLifecycleRow('compliance_detection', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...legalHealthScores.map((row) =>
        mapRunLifecycleRow('legal_health_score', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...missingClauseDetections.map((row) =>
        mapRunLifecycleRow('missing_clause_detection', row, () => resolveEmbeddedDocumentInfo(row)),
      ),
      ...chatConversations.map((row) => mapChatRow(row, () => resolveEmbeddedDocumentInfo(row))),
    ];
  }
}

/**
 * Shared shape every one of the seven true run-lifecycle modules'
 * entity types has in common — status/error_message/provider_used/
 * completed_at, all with each module's own specific enum for `status`
 * (widened to `string` here, see ObservabilityRun's own doc comment).
 * Not exported — an internal structural type this file uses purely to
 * write one mapper instead of seven near-identical ones.
 */
interface RunLifecycleRow {
  id: string;
  document_analysis_id: string;
  status: string;
  provider_used: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function mapRunLifecycleRow(
  module: ObservabilityModule,
  row: RunLifecycleRow,
  resolveDocumentInfo: (documentAnalysisId: string) => { title: string | null; ownerId: string | null },
): ObservabilityRun {
  const { title, ownerId } = resolveDocumentInfo(row.document_analysis_id);

  return {
    module,
    id: row.id,
    documentAnalysisId: row.document_analysis_id,
    status: row.status,
    providerUsed: row.provider_used,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    documentTitle: title,
    documentOwnerId: ownerId,
  };
}

/**
 * Chat's own mapper, kept separate rather than forced through
 * mapRunLifecycleRow — see this file's ObservabilityRun doc comment and
 * ChatConversationRepository#findManyForAnalysisIds' own doc comment for
 * the full reasoning: chat_conversations has no status/error_message/
 * provider_used-at-the-conversation-level columns at all, confirmed
 * against the real database.types.ts. `status`/`errorMessage`/
 * `providerUsed` are set to null here — not derived, not guessed —
 * and `completedAt` is likewise null; `createdAt` is the conversation's
 * real created_at.
 */
function mapChatRow(
  row: { id: string; document_analysis_id: string; created_at: string },
  resolveDocumentInfo: (documentAnalysisId: string) => { title: string | null; ownerId: string | null },
): ObservabilityRun {
  const { title, ownerId } = resolveDocumentInfo(row.document_analysis_id);

  return {
    module: 'chat_conversation',
    id: row.id,
    documentAnalysisId: row.document_analysis_id,
    status: null,
    providerUsed: null,
    errorMessage: null,
    createdAt: row.created_at,
    completedAt: null,
    documentTitle: title,
    documentOwnerId: ownerId,
  };
}

// Re-exported so the Route layer / Factory can reference these entity
// types without importing each module's own entity file directly,
// mirroring the re-export convention already established by every
// module repository file (e.g. CreateRiskDetectionInput from
// risk-detection.repository.ts).
export type {
  RiskDetection,
  AiLegalInsight,
  AIRecommendation,
  ClauseClassification,
  ComplianceDetection,
  LegalHealthScore,
  MissingClauseDetection,
  ChatConversation,
  RiskDetectionWithDocumentInfo,
  AiLegalInsightWithDocumentInfo,
  AIRecommendationWithDocumentInfo,
  ClauseClassificationWithDocumentInfo,
  ComplianceDetectionWithDocumentInfo,
  LegalHealthScoreWithDocumentInfo,
  MissingClauseDetectionWithDocumentInfo,
  ChatConversationWithDocumentInfo,
};
// src/modules/general-dashboard/general-dashboard.service.ts
//
// NEW MODULE — General Portal Phase 1 (General User Home / Dashboard),
// per JurisAI_Architecture_Audit.md's General Portal task.
//
// WHAT THIS IS: a read-only aggregation layer over data that already
// exists and is already owner-scoped by real RLS policies (confirmed
// this session via Supabase MCP against the live `Juris` project —
// documents_select_own, document_analyses_select_owner,
// risk_detections_select_owner, legal_health_scores_select_owner,
// ai_recommendations_select_owner all resolve through
// `documents.owner_id = auth.uid()`, directly or via a join). This
// module does NOT call any AI provider, does NOT introduce a new
// scoring/synthesis engine, and does NOT add any RLS policy — it only
// reads rows that five existing modules already produced, using their
// own existing repository methods, and summarizes them for the caller.
//
// SHAPE, MIRRORS ObservabilityService's real, pasted four-hop chain
// (documents -> document_analyses -> {risk_detections,
// legal_health_scores, ai_recommendations}) almost exactly, with two
// deliberate differences:
//   1. Observability runs that chain against the ADMIN client, scoped
//      by a firm_id resolved (and re-verified against real
//      firm_members standing) server-side — it needs to see an entire
//      firm's documents, which cross real ownership boundaries.
//      GeneralDashboardService runs the SAME chain against the
//      RLS-RESPECTING client only (see the factory) — there is no
//      firm to resolve, and RLS itself is what does 100% of the
//      scoping. No admin client, anywhere in this file.
//   2. Observability returns a flat, ungrouped run-history list (every
//      run, every module, for display as a table). This module instead
//      picks the LATEST COMPLETED run per document_analysis_id, per
//      module — a dashboard summary needs "what's true right now for
//      each of my documents", not a full run history (that's exactly
//      what Observability itself is already for, and this module does
//      not attempt to duplicate it).
//
// LEGAL HEALTH SCORE — DELIBERATELY NOT RE-SYNTHESIZED. Per the task's
// own explicit instruction ("DO NOT invent a score. DO NOT calculate a
// fake score in the frontend... do not redesign the scoring engine"),
// `legalHealth` below is a plain arithmetic mean of each contributing
// document's own already-AI-computed `overall_score` (an integer
// column LegalHealthScoreService itself deterministically derives per
// document — see that file's own KEY DECISION). Averaging already-
// computed numbers is not scoring logic; it introduces no new
// judgment about what makes a document healthy. No trend is computed
// — there is no historical baseline anywhere in this schema to compare
// against (each document_analysis_id can have multiple runs, but nothing
// establishes a time-series "last week vs this week" concept), so
// `trend` is honestly omitted rather than fabricated.
//
// RISK SUMMARY — same non-invention posture: severities are read
// verbatim from each risk_detections.result.flags[].severity (Risk
// Detection's own AI-produced output), just counted. No new risk
// judgment is made here.
//
// RECOMMENDATIONS — same posture: recommendations are read verbatim
// from ai_recommendations.result.recommendations[], sorted by priority
// then recency, and capped to a small display list. Nothing is
// generated here.

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { BaseService } from '@/core/services/base.service';

import type { DocumentRepository } from '@/modules/documents/document.repository';
import type { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import type { DocumentAnalysis } from '@/modules/document-analysis/document-analysis.entity';
import type { RiskDetectionRepository } from '@/modules/risk-detection/risk-detection.repository';
import type { RiskDetection } from '@/modules/risk-detection/risk-detection.entity';
import type { RiskSeverity } from '@/modules/risk-detection/risk-detection.schemas';
import type { LegalHealthScoreRepository } from '@/modules/legal-health-score/legal-health-score.repository';
import type { LegalHealthScore } from '@/modules/legal-health-score/legal-health-score.entity';
import type { AIRecommendationRepository } from '@/modules/ai-recommendation/ai-recommendation.repository';
import type { AIRecommendation } from '@/modules/ai-recommendation/ai-recommendation.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GeneralDashboardDocumentSummary {
  total: number;
  recentUploads7d: number;
  documentsAnalyzed: number;
  documentsWithRisks: number;
}

export interface GeneralDashboardLegalHealth {
  /** null when no document has a completed legal health score yet. */
  averageScore: number | null;
  documentsScored: number;
}

export interface GeneralDashboardRiskSummary {
  high: number;
  medium: number;
  low: number;
  /** critical is folded into "high" for display purposes; kept separately here for accuracy. */
  critical: number;
  documentsWithCompletedRiskScan: number;
}

export interface GeneralDashboardRecommendation {
  id: string;
  title: string;
  recommendation: string;
  priority: string;
  documentId: string | null;
  documentTitle: string | null;
  createdAt: string;
}

export interface GeneralDashboardData {
  documentSummary: GeneralDashboardDocumentSummary;
  legalHealth: GeneralDashboardLegalHealth;
  riskSummary: GeneralDashboardRiskSummary;
  recommendations: GeneralDashboardRecommendation[];
}

export class GeneralDashboardService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly documentRepository: DocumentRepository,
    private readonly documentAnalysisRepository: DocumentAnalysisRepository,
    private readonly riskDetectionRepository: RiskDetectionRepository,
    private readonly legalHealthScoreRepository: LegalHealthScoreRepository,
    private readonly aiRecommendationRepository: AIRecommendationRepository,
  ) {
    super(currentUser);
  }

  /**
   * Returns the caller's own General Portal dashboard summary.
   *
   * Deliberately requireAuthentication() only, NOT requireRole() —
   * this endpoint is scoped entirely by RLS to the caller's own rows
   * regardless of UserRole (documents_select_own has no role
   * condition, it's owner_id = auth.uid() alone). A lawyer or firm
   * owner viewing their own uploaded personal documents here is
   * harmless — they simply see their own data, same as they always
   * could via GET /api/documents. Restricting this to role ===
   * 'individual' would be a product decision nobody asked for, not an
   * authorization requirement.
   */
  async getDashboard(): Promise<GeneralDashboardData> {
    this.requireAuthentication();

    const documents = await this.documentRepository.findMany({ includeDeleted: false });
    const documentIds = documents.map((d) => d.id);
    const documentById = new Map(documents.map((d) => [d.id, d]));

    const analyses = await this.documentAnalysisRepository.findManyForDocumentIds(documentIds);
    const analysisIds = analyses.map((a) => a.id);
    const analysisById = new Map<string, DocumentAnalysis>(analyses.map((a) => [a.id, a]));

    const [riskDetections, legalHealthScores, aiRecommendations] = await Promise.all([
      this.riskDetectionRepository.findManyForAnalysisIds(analysisIds),
      this.legalHealthScoreRepository.findManyForAnalysisIds(analysisIds),
      this.aiRecommendationRepository.findManyForAnalysisIds(analysisIds),
    ]);

    const latestCompletedRisk = latestCompletedByAnalysis(riskDetections);
    const latestCompletedHealth = latestCompletedByAnalysis(legalHealthScores);
    const latestCompletedRecommendations = latestCompletedByAnalysis(aiRecommendations);

    const recentUploads7d = documents.filter(
      (d) => Date.now() - new Date(d.created_at).getTime() <= 7 * DAY_MS,
    ).length;

    const documentsWithRisks = Array.from(latestCompletedRisk.values()).filter(
      (r) => (r.result?.flags.length ?? 0) > 0,
    ).length;

    const documentSummary: GeneralDashboardDocumentSummary = {
      total: documents.length,
      recentUploads7d,
      documentsAnalyzed: analyses.filter((a) => a.status === 'completed').length,
      documentsWithRisks,
    };

    const scores = Array.from(latestCompletedHealth.values())
      .map((h) => h.overall_score)
      .filter((s): s is number => typeof s === 'number');

    const legalHealth: GeneralDashboardLegalHealth = {
      averageScore:
        scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null,
      documentsScored: scores.length,
    };

    const riskSummary: GeneralDashboardRiskSummary = { high: 0, medium: 0, low: 0, critical: 0, documentsWithCompletedRiskScan: latestCompletedRisk.size };
    for (const risk of latestCompletedRisk.values()) {
      for (const flag of risk.result?.flags ?? []) {
        incrementSeverity(riskSummary, flag.severity);
      }
    }

    const resolveDocumentTitle = (documentAnalysisId: string): { id: string | null; title: string | null } => {
      const analysis = analysisById.get(documentAnalysisId);
      if (!analysis) return { id: null, title: null };
      const document = documentById.get(analysis.document_id);
      return { id: document?.id ?? null, title: document?.title ?? null };
    };

    const recommendations: GeneralDashboardRecommendation[] = Array.from(
      latestCompletedRecommendations.values(),
    )
      .flatMap((run) =>
        (run.result?.recommendations ?? []).map((rec, index) => {
          const { id: documentId, title: documentTitle } = resolveDocumentTitle(run.document_analysis_id);
          return {
            id: `${run.id}-${index}`,
            title: rec.title,
            recommendation: rec.recommendation,
            priority: rec.priority,
            documentId,
            documentTitle,
            createdAt: run.created_at,
          };
        }),
      )
      .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 5);

    return { documentSummary, legalHealth, riskSummary, recommendations };
  }
}

/**
 * Groups a flat list of module runs by document_analysis_id and keeps
 * only the most recently created 'completed' run per analysis —
 * mirroring what every module's own findLatestByDocumentAnalysisId()
 * does for a single analysis, just applied across many at once (none
 * of the three repositories used here expose a bulk "latest per
 * analysis" query, only findManyForAnalysisIds' flat list, so that
 * reduction happens here rather than duplicating three near-identical
 * SQL queries).
 */
function latestCompletedByAnalysis<
  T extends { document_analysis_id: string; status: string; created_at: string },
>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (row.status !== 'completed') continue;
    const existing = result.get(row.document_analysis_id);
    if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
      result.set(row.document_analysis_id, row);
    }
  }
  return result;
}

function incrementSeverity(summary: GeneralDashboardRiskSummary, severity: RiskSeverity): void {
  switch (severity) {
    case 'critical':
      summary.critical += 1;
      return;
    case 'high':
      summary.high += 1;
      return;
    case 'medium':
      summary.medium += 1;
      return;
    case 'low':
      summary.low += 1;
      return;
  }
}

function priorityWeight(priority: string): number {
  switch (priority) {
    case 'critical':
      return 3;
    case 'high':
      return 2;
    case 'medium':
      return 1;
    default:
      return 0;
  }
}

export type { DocumentAnalysis, RiskDetection, LegalHealthScore, AIRecommendation };

// src/modules/observability/observability.factory.ts
// JurisAI Observability module — Phase 3

import { getCurrentUser } from '@/core/auth/session';
import { createAdminClient } from '@/core/supabase/admin';

import { ProfileRepository } from '@/modules/profiles/profile.repository';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import { RiskDetectionRepository } from '@/modules/risk-detection/risk-detection.repository';
import { AiLegalInsightRepository } from '@/modules/ai-legal-insight/ai-legal-insight.repository';
import { AIRecommendationRepository } from '@/modules/ai-recommendation/ai-recommendation.repository';
import { ClauseClassificationRepository } from '@/modules/clause-classification/clause-classification.repository';
import { ComplianceDetectionRepository } from '@/modules/compliance-detection/compliance-detection.repository';
import { LegalHealthScoreRepository } from '@/modules/legal-health-score/legal-health-score.repository';
import { MissingClauseDetectionRepository } from '@/modules/missing-clause-detection/missing-clause-detection.repository';
import { ChatConversationRepository } from '@/modules/chat/chat.repository';

import { ObservabilityService } from './observability.service';

/**
 * Constructs a request-scoped ObservabilityService.
 *
 * FLAGGED DEPARTURE FROM EVERY PRIOR FACTORY (Files 97, 105, ..., 144,
 * all real, all confirmed this session): every one of them resolves
 * ONE currentUser via getCurrentUser() and ONE Supabase client via
 * createClient() (the RLS-respecting client from server.ts), then
 * shares that same pair across every repository/service constructed in
 * the function. This factory keeps the "one currentUser, resolved once"
 * half of that pattern, but deliberately does NOT use createClient() —
 * it uses createAdminClient() (src/core/supabase/admin.ts) instead, for
 * every repository, uniformly, for BOTH of ObservabilityService's view
 * paths.
 *
 * WHY, stated explicitly rather than left implicit: ObservabilityService
 * gates access via requireRole() INSIDE each method — 'law_firm'/'admin'
 * for getFirmRunHistory(), 'admin' only for getAdminRunHistory() — as
 * its first statement, before any repository method ever runs a query.
 * The RLS-vs-admin-client decision this project normally makes at
 * construction time (which every prior factory reflects) doesn't fit
 * here: DocumentRepository#findManyForOwnerIds is itself documented as
 * admin-client-only even for the FIRM-OWNER path, because a firm owner
 * is not the owner_id of their colleagues' documents — RLS would
 * silently under-return rather than show the whole firm's data, which
 * is the entire point of that view. So both of ObservabilityService's
 * paths need the unrestricted client; the authorization boundary lives
 * entirely in the Service's own requireRole() calls, not in which
 * client this factory hands it.
 *
 * FLAGGED, NOT SILENTLY GLOSSED OVER: admin.ts's own doc comment
 * enumerates four sanctioned uses for this client (background jobs,
 * webhooks, already-verified admin actions, migrations) and does not
 * explicitly list "a law_firm-role user's own firm-scoped query" among
 * them. This factory relies on ObservabilityService's requireRole()
 * running before any query does, matching admin.ts's "after the caller
 * has already been verified" spirit for the 'admin' case cleanly, and
 * for the 'law_firm' case by the same ordering even though that
 * specific case isn't one of admin.ts's four named examples — a
 * necessary consequence of the confirmed architecture decision (this
 * session and the one before it) that DocumentRepository#findManyForOwnerIds
 * requires the admin client regardless of which role is calling it, not
 * a new decision made silently here.
 *
 * createAdminClient() is synchronous (confirmed from its real source
 * this session) and a module-level singleton — unlike createClient(),
 * there is no `await` on this line, and no new client is created per
 * call the way server.ts's createClient() creates a fresh one per
 * request.
 *
 * No sibling Service is constructed here (unlike every prior factory,
 * which builds a chain of sibling Services sharing one currentUser/
 * supabase pair) — ObservabilityService composes sibling REPOSITORIES
 * directly, per its own class-level doc comment's flagged departure
 * from the AI Legal Insight precedent. So this factory has no
 * DocumentService/DocumentAnalysisService/etc. construction to
 * duplicate the way every prior factory does; it constructs eleven
 * repositories (profile, document, document-analysis, and the eight
 * module repos) and passes them straight to ObservabilityService.
 */
export async function buildObservabilityService(): Promise<ObservabilityService> {
  const currentUser = await getCurrentUser();
  const supabase = createAdminClient();

  const profileRepository = new ProfileRepository(supabase);
  const documentRepository = new DocumentRepository(supabase);
  const documentAnalysisRepository = new DocumentAnalysisRepository(supabase);

  const riskDetectionRepository = new RiskDetectionRepository(supabase);
  const aiLegalInsightRepository = new AiLegalInsightRepository(supabase);
  const aiRecommendationRepository = new AIRecommendationRepository(supabase);
  const clauseClassificationRepository = new ClauseClassificationRepository(supabase);
  const complianceDetectionRepository = new ComplianceDetectionRepository(supabase);
  const legalHealthScoreRepository = new LegalHealthScoreRepository(supabase);
  const missingClauseDetectionRepository = new MissingClauseDetectionRepository(supabase);
  const chatConversationRepository = new ChatConversationRepository(supabase);

  return new ObservabilityService(
    currentUser,
    profileRepository,
    documentRepository,
    documentAnalysisRepository,
    riskDetectionRepository,
    aiLegalInsightRepository,
    aiRecommendationRepository,
    clauseClassificationRepository,
    complianceDetectionRepository,
    legalHealthScoreRepository,
    missingClauseDetectionRepository,
    chatConversationRepository,
  );
}
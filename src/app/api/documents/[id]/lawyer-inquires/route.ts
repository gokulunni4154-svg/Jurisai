// src/app/api/documents/[id]/lawyer-inquiries/route.ts
// NEW -- authenticated "contact a lawyer" flow. The route this session
// set out to build: closes the one real gap identified between the
// existing, fully-wired documents/[id] page (Legal Health Score + AI
// Legal Insights, both real and triggerable) and the original any-user
// dashboard vision ("...if the score is bad, option to contact a
// lawyer or firm directly").
//
// Next.js 14.2.35 App Router convention, same as File 68/69: params is
// a plain synchronous object.
//
// KEY DECISION -- combines Legal Health Score + AI Legal Insights
// (both, per product decision this session) via
// AiLegalInsightService's own getLatestCompletedXForAnalysis()
// passthrough methods (ai-legal-insight.service.ts, confirmed real
// source) rather than depending on LegalHealthScoreService directly.
// One service call surface already exposes both reads this route
// needs -- no reason to construct a second service (and re-resolve
// getCurrentUser()/createClient() a second time within the same
// request) just to fetch the health score alone.
//
// KEY DECISION -- Legal Health Score must be completed (throws
// ValidationError, 400, otherwise); AI Legal Insights is optional and
// may be null (insights are a later, optional step on the frontend --
// see documents/[id]/page.tsx's own gating, which requires Health
// Score to complete before Insights can even be triggered). Requiring
// insights here too would block a real, common case: a user who has a
// health score but hasn't bothered generating insights yet should
// still be able to contact a lawyer.
//
// targetProfileId is OPTIONAL in the request body (null when the
// caller is contacting a firm generally, without picking a specific
// person from that firm's roster) -- matches lawyer_inquiries' own
// schema (target_profile_id nullable, target_firm_id not null).

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAiLegalInsightService } from '@/modules/ai-legal-insight/ai-legal-insight.factory';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteContext {
  params: { id: string };
}

interface CreateLawyerInquiryBody {
  analysisId?: unknown;
  targetFirmId?: unknown;
  targetProfileId?: unknown;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    let body: CreateLawyerInquiryBody;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    if (typeof body.analysisId !== 'string' || body.analysisId.length === 0) {
      throw new ValidationError('analysisId is required.');
    }
    if (typeof body.targetFirmId !== 'string' || body.targetFirmId.length === 0) {
      throw new ValidationError('targetFirmId is required.');
    }
    if (body.targetProfileId !== null && body.targetProfileId !== undefined && typeof body.targetProfileId !== 'string') {
      throw new ValidationError('targetProfileId must be a string or null.');
    }
    const targetProfileId: string | null =
      typeof body.targetProfileId === 'string' ? body.targetProfileId : null;

    // Same rawParams shape every sibling route passes straight through
    // to Service-layer methods that parse it themselves (e.g. File
    // 68/69) -- this route does not itself validate `id`'s shape, that
    // is documentIdParamSchema's job inside DocumentService, reached
    // indirectly via LawyerInquiryService#createInquiry().
    const rawParams = context.params;

    const aiLegalInsightService = await buildAiLegalInsightService();

    const legalHealthScore = await aiLegalInsightService.getLatestCompletedLegalHealthScoreForAnalysis(
      rawParams,
      body.analysisId
    );

    if (!legalHealthScore) {
      throw new ValidationError(
        'A completed Legal Health Score is required before contacting a lawyer.'
      );
    }

    const aiLegalInsight = await aiLegalInsightService.getLatestCompletedAiLegalInsightForAnalysis(
      rawParams,
      body.analysisId
    );

    // FLAGGED, REAL ASSUMPTION -- legalHealthScore.result and
    // aiLegalInsight.result. AiLegalInsightService's own
    // getLatestCompletedAiLegalInsightForAnalysis() is confirmed,
    // pasted source: it returns `AiLegalInsight | null`, a row with a
    // `.result` field. getLatestCompletedLegalHealthScoreForAnalysis()
    // is a passthrough to LegalHealthScoreService's own method of the
    // same name -- LegalHealthScoreService's real source was never
    // pasted this session, only its TYPE referenced via
    // `ReturnType<LegalHealthScoreService[...]>` in
    // ai-legal-insight.service.ts. Assumed here, by direct analogy to
    // every other module's identical row-shape convention (every
    // markCompleted() in this codebase stores its result under
    // `.result`), that legalHealthScore also has a `.result` field. If
    // LegalHealthScoreRepository's real markCompleted() differs (recall
    // File 135's markCompleted() takes overall_score/category_scores as
    // SEPARATE promoted columns, not just one `.result` blob --
    // confirmed via ai-legal-insight.service.ts's own class-level KEY
    // DECISION comment), `legalHealthScore.result` may need to become
    // the full row instead, or a composite of its promoted columns.
    // Flagged for a tsc pass once LegalHealthScoreService's real source
    // is available, not silently guessed as correct.
    const currentUser = await getCurrentUser();
    const lawyerInquiryService = await buildLawyerInquiryService(currentUser);

    const inquiry = await lawyerInquiryService.createInquiry(
      rawParams,
      body.targetFirmId,
      targetProfileId,
      {
        legalHealthScore: legalHealthScore.result,
        aiLegalInsight: aiLegalInsight?.result ?? null,
      }
    );

    return NextResponse.json({ data: inquiry }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
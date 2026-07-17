// src/app/api/documents/[id]/analyses/[analysisId]/chat/conversations/[conversationId]/route.ts
// File 155 — JurisAI Module 8 (AI Legal Chat)
//
// Single-resource route: GET one conversation. Built directly against
// File 139's real source as template (Legal Health Score's single
// retrieval route), one identifier deeper.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildChatService } from '@/modules/chat/chat.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * reused unchanged through 107/115/123/131/139): dynamic route `params`
 * is a plain synchronous object, NOT a Promise. Extended here with the
 * third dynamic segment, `conversationId`.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    conversationId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/chat/conversations/[conversationId]
 *
 * Fetches a single conversation. Thin route — all real logic (parent-
 * analysis visibility check via DocumentAnalysisService#getAnalysisById,
 * called inside ChatService#getConversationById, then the
 * document_analysis_id-match check preventing cross-analysis access,
 * then requireOwnership()) lives in ChatService#getConversationById
 * (chat.service.ts), matching File 139's identical pattern at the same
 * pipeline depth.
 *
 * context.params is passed through whole as getConversationById's
 * rawParams argument, with analysisId and conversationId additionally
 * extracted for the method's second and third arguments — identical to
 * how File 139 passes context.params to getLegalHealthScoreById.
 *
 * A conversationId that doesn't exist at all, OR that exists but
 * belongs to a different analysis than [analysisId], both surface as
 * the same NotFoundError from the service layer (deliberate — mirrors
 * getLegalHealthScoreById's, getAIRecommendationById's, and every prior
 * single-resource route's identical cross-analysis 404 behavior) and
 * both become the same 404 response here via handleApiError. No
 * special-case handling for the two cases, by design — same reasoning
 * as File 139.
 *
 * ONE DEPARTURE FROM FILE 139, FLAGGED — File 139's own docstring notes
 * "no requireOwnership() anywhere in this call chain — this is a read,
 * following the established RLS-only-for-reads convention." Chat does
 * NOT follow that here: getConversationById() DOES call
 * requireOwnership() explicitly (chat.service.ts's own docstring: "a
 * conversation is a private thread, not a shared analysis artifact, so
 * ownership is checked explicitly rather than relying on RLS alone").
 * That decision was made at the Service layer, not this Route — this
 * file is unchanged either way, since the check happens inside
 * getConversationById() regardless. Noted here so the divergence from
 * File 139's stated convention isn't mistaken for an inconsistency
 * introduced at this layer.
 *
 * No maxDuration export, same reasoning as File 139 — a pure read has
 * no long-running AI call to bound.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const chatService = await buildChatService();

    const conversation = await chatService.getConversationById(
      context.params,
      context.params.analysisId,
      context.params.conversationId,
    );

    return NextResponse.json({ data: { conversation } });
  } catch (error) {
    return handleApiError(error);
  }
}
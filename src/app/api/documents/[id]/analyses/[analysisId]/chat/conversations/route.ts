// src/app/api/documents/[id]/analyses/[analysisId]/chat/conversations/route.ts
// File 154 — JurisAI Module 8 (AI Legal Chat)
//
// Collection route: POST (start a new conversation) + GET (list the
// current user's conversations for this analysis). Built directly
// against File 138's real source as template (Legal Health Score's
// collection route), one resource-name segment deeper
// (`chat/conversations` instead of `legal-health-scores`).

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildChatService } from '@/modules/chat/chat.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 67/69/98,
 * reused unchanged through 106/114/122/130/138): dynamic route `params`
 * is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * POST /api/documents/[id]/analyses/[analysisId]/chat/conversations
 *
 * DIVERGES FROM FILE 138 DELIBERATELY — no upstream prerequisite checks
 * and no maxDuration export. File 138's POST has both because
 * runLegalHealthScore() (a) takes five upstream results as direct
 * arguments, requiring each to be fetched and null-checked first, and
 * (b) runs the actual AI synthesis inline, needing the raised execution
 * ceiling. startConversation() (chat.service.ts) does neither: it only
 * validates the parent document/analysis and inserts one row — no
 * upstream results are consumed as arguments (those are fetched lazily,
 * only inside sendMessage(), which is not part of this file), and no AI
 * call happens here. Both omissions are deliberate, not oversights.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const chatService = await buildChatService();

    const conversation = await chatService.startConversation(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: conversation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/chat/conversations
 *
 * Lists the current user's conversations for this analysis, most
 * recently active first (ChatConversationRepository#findManyForUser's
 * ordering, chat.repository.ts). No requireOwnership() at this route or
 * inside listConversationsForAnalysis() beyond RLS itself — same
 * established RLS-only-for-reads convention as File 138's GET handler.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const chatService = await buildChatService();

    const conversations = await chatService.listConversationsForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: conversations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
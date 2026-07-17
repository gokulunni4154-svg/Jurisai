// src/app/api/documents/[id]/analyses/[analysisId]/chat/conversations/[conversationId]/messages/route.ts
// File 156 — JurisAI Module 8 (AI Legal Chat)
//
// Messages route: GET (list a conversation's messages) + POST (send a
// message, streaming the assistant's reply back).
//
// GET follows every prior single-shot JSON GET pattern exactly (Files
// 99/107/115/123/131/139/147/155) — no new pattern, built with full
// confidence.
//
// POST IS THE FIRST STREAMING ROUTE IN THIS PROJECT. No real precedent
// existed anywhere in the pasted source for this repository at the time
// this file was written — see PROJECT_PROGRESS.md's Module 8 section
// and CONTINUATION_PROMPT.md's "Immediate next step: File 156" section
// for the full context. The choices below are a FLAGGED DEFAULT, made
// under explicit instruction to proceed without further blocking on a
// design conversation — not a confirmed convention the way every other
// pattern in this codebase is. If a real streaming route exists
// elsewhere in the actual repo (or gets built later), reconcile against
// it; don't treat this file's choices as precedent to copy forward
// automatically the way File 138 -> 146 -> (would-be 154) chains have.
//
// DECISIONS MADE HERE, FLAGGED:
// 1. Transport: raw ReadableStream, returned as chunked `text/plain`.
//    Chosen over Server-Sent Events because ChatService#sendMessage
//    yields plain text deltas (AsyncGenerator<string>), not pre-framed
//    `data: ...\n\n` events — SSE framing would need to be invented at
//    this layer with no Service-side support for it. Chosen over
//    returning the whole response as one blocking JSON payload because
//    that would defeat the entire purpose of ChatService's streaming
//    design. A frontend consumes this via
//    `response.body.getReader()` / `TextDecoder`, not EventSource.
// 2. Pre-stream errors get a REAL HTTP status (404/401/etc via
//    handleApiError), because sendMessage()'s validation (auth,
//    getConversationById's analysis/ownership checks, upstream-context
//    fetch) all runs before the first token is yielded — see file-level
//    note above. This is only possible because sendMessage is an async
//    generator: awaiting its first `.next()` executes all of that
//    validation without starting the HTTP response.
// 3. Mid-stream errors CANNOT change the HTTP status (headers are
//    already committed once streaming starts) — a mid-stream failure
//    simply ends the stream early. This is a real, accepted limitation
//    of this transport choice, not an oversight; a client needs its own
//    truncation/timeout handling on top of this if that matters.
// 4. maxDuration = 60, same value as File 138's, carried over
//    unexamined — whether 60s is the right ceiling for a streaming
//    response (as opposed to File 138's single inline await) has NOT
//    been separately reasoned about. Flagged, not re-derived.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildChatService } from '@/modules/chat/chat.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via Files 51/67/68/69,
 * reused unchanged through every single-resource route including 155):
 * dynamic route `params` is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    conversationId: string;
  };
}

/**
 * See DECISION #4 above — carried over from File 138 unexamined for
 * this transport, not re-derived.
 */
export const maxDuration = 60;

/**
 * GET /api/documents/[id]/analyses/[analysisId]/chat/conversations/[conversationId]/messages
 *
 * Lists a conversation's messages in chronological order
 * (ChatMessageRepository#findManyForConversation's ordering, oldest
 * first — chat.repository.ts). listMessagesForConversation() itself
 * re-validates the conversation (analysis + ownership) before listing,
 * so no separate check is needed at this Route layer — same
 * defense-in-depth shape as every prior GET.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const chatService = await buildChatService();

    const messages = await chatService.listMessagesForConversation(
      context.params,
      context.params.analysisId,
      context.params.conversationId,
    );

    return NextResponse.json({ data: messages }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/documents/[id]/analyses/[analysisId]/chat/conversations/[conversationId]/messages
 *
 * Sends a message into the conversation and streams the assistant's
 * reply back as plain text chunks. See file-level DECISIONS above for
 * the transport choice and its tradeoffs.
 *
 * Body: `SendMessageInput` shape (conversationId, content) — validated
 * inside ChatService#sendMessage via sendMessageInputSchema.parse(),
 * not at this Route layer, matching every other module's convention of
 * pushing schema validation into the Service rather than the Route.
 *
 * conversationId is accepted from the REQUEST BODY, not re-derived from
 * the URL's [conversationId] segment, because that's what
 * sendMessageInputSchema (chat.schemas.ts, File 149) actually requires
 * as input — sendMessage()'s own signature takes analysisId from the
 * route params but conversationId from rawInput. FLAGGED INCONSISTENCY,
 * NOT SILENTLY RESOLVED: this means a caller could technically put a
 * different conversationId in the body than the URL segment names, and
 * whichever one sendMessage() actually uses "wins" — sendMessage()
 * calls getConversationById(rawParams, analysisId, input.conversationId),
 * i.e. it uses the BODY's conversationId, not the URL's. The URL segment
 * is accepted here purely for REST-conventional addressability and
 * logging, and is NOT cross-checked against the body value in this
 * file. Worth a future amendment (either enforce they match, or drop
 * conversationId from the body schema and inject it from the URL
 * instead) — not fixed here without a product decision on which should
 * be authoritative.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  let rawInput: unknown;

  try {
    rawInput = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const chatService = await buildChatService();
  const generator = chatService.sendMessage(
    context.params,
    context.params.analysisId,
    rawInput,
  );

  // Pull the first chunk OUTSIDE the ReadableStream. Per DECISION #2
  // above, everything sendMessage() validates (auth, conversation
  // lookup, ownership, cross-analysis check, upstream-context fetch)
  // runs before the first token is yielded — awaiting it here lets a
  // real error become a real HTTP status via handleApiError, instead of
  // silently becoming a truncated/empty stream.
  let first: IteratorResult<string, void>;

  try {
    first = await generator.next();
  } catch (error) {
    return handleApiError(error);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      if (!first.done) {
        controller.enqueue(encoder.encode(first.value));
      }

      // See DECISION #3 above — once we're inside here, the HTTP status
      // is already committed (200). A thrown error at this point can
      // only end the stream early; it cannot become a 4xx/5xx response.
      try {
        while (true) {
          const next = await generator.next();

          if (next.done) {
            break;
          }

          controller.enqueue(encoder.encode(next.value));
        }
      } catch (error) {
        // Mid-stream failure. No status change possible (see above) —
        // log server-side and end the stream. The client's only signal
        // is an early, non-graceful stream close; per ChatService's own
        // documented OPEN ITEM (File 153), no partial assistant message
        // is persisted either way, so there is nothing further to
        // reconcile client-side beyond "this turn failed, try again."
        console.error('Mid-stream error in chat sendMessage:', error);
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
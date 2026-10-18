// src/modules/assistant/assistant.http.ts
//
// Shared HTTP handlers behind the three thin terminal routes:
//   /api/assistant/lawyer
//   /api/assistant/firm/[firmId]
//   /api/assistant/general
// The terminal is chosen by WHICH ROUTE FILE was hit, never by request data.

import { NextRequest, NextResponse } from "next/server";

import { RateLimitError, ValidationError } from "@/core/errors/app-error";
import { handleApiError } from "@/core/errors/error-handler";

import { buildAssistantService } from "./assistant.factory";
import type { AssistantTerminal } from "./assistant.schemas";

export const ASSISTANT_STREAM_ERROR_MARKER = "\n[[JURISAI_STREAM_ERROR]]";
const MAX_BODY_BYTES = 16 * 1024;

function withRetryAfter(error: unknown, response: NextResponse): NextResponse {
  if (error instanceof RateLimitError) {
    const retryAfter = error.context?.["retryAfterSeconds"];
    if (typeof retryAfter === "number") {
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil(retryAfter))),
      );
    }
  }
  return response;
}

/** GET: list conversations, or (with ?conversationId=) list that conversation's messages. */
export async function handleAssistantGet(
  request: NextRequest,
  terminal: AssistantTerminal,
  firmId: string | null,
): Promise<NextResponse> {
  try {
    const service = await buildAssistantService();
    const conversationId = request.nextUrl.searchParams.get("conversationId");

    const data = conversationId
      ? await service.listMessages(terminal, firmId, conversationId)
      : await service.listConversations(terminal, firmId);

    return NextResponse.json(
      { data },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST: send a message, stream the reply as text/plain. */
export async function handleAssistantPost(
  request: NextRequest,
  terminal: AssistantTerminal,
  firmId: string | null,
): Promise<NextResponse> {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      throw new ValidationError("Request body is too large.");
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw new ValidationError("Request body is too large.");
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ValidationError("Request body must be valid JSON.");
    }

    const service = await buildAssistantService();
    const { conversation, stream } = await service.startTurn(
      terminal,
      firmId,
      body,
    );

    // Pull the first chunk before committing a 200 so provider failures that
    // happen before any output become real HTTP errors.
    const first = await stream.next();

    const body$ = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          if (!first.done) controller.enqueue(encoder.encode(first.value));
          while (!first.done) {
            const next = await stream.next();
            if (next.done) break;
            controller.enqueue(encoder.encode(next.value));
          }
        } catch (error) {
          // Never log message content; code/name only.
          console.warn("[assistant] stream interrupted", {
            terminal,
            name: error instanceof Error ? error.name : "unknown",
          });
          controller.enqueue(encoder.encode(ASSISTANT_STREAM_ERROR_MARKER));
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(body$, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Conversation-Id": conversation.id,
      },
    });
  } catch (error) {
    return withRetryAfter(error, handleApiError(error));
  }
}

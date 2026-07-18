import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildNotificationService } from '@/modules/notifications/notification.factory';

/**
 * PATCH /api/notifications/[id]/read
 *
 * Marks a single notification read. No request body — the route only
 * needs the id from the URL segment, passed straight through to
 * NotificationService.markAsRead() as rawParams, same "route hands the
 * service a raw object, service owns validation" division as every
 * other route in this project.
 *
 * `params` is a plain synchronous object, NOT a Promise — confirmed
 * against real source this session (`/api/documents/[id]/route.ts`'s
 * own dated comment, which cites File 30 as documented precedent for
 * this exact confusion). This file previously guessed at
 * `Promise<{ id: string }>` + `await params` before that real source
 * existed to check against; that guess is now known wrong and corrected
 * here to match the confirmed convention, not the reverse.
 *
 * PATCH chosen over POST for "mark read" as a partial-update semantic
 * (only read_at changes) — not drawn from precedent either, since no
 * other route in this project performs a partial update via a
 * dedicated sub-path.
 *
 * Response shape `{ data: { notification } }` — singular, matching
 * /api/documents's POST response shape for a single-resource result,
 * not the plural `documents` key GET uses for a collection.
 */
interface RouteContext {
  params: { id: string };
}

export async function PATCH(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = params;

    const service = await buildNotificationService();
    const notification = await service.markAsRead({ id });

    return NextResponse.json({ data: { notification } });
  } catch (error) {
    return handleApiError(error);
  }
}
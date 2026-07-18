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
 * FLAGGED, GENUINELY UNVERIFIED — this file has no real precedent to
 * build against. Every route pasted in this project so far
 * (/api/documents's GET/POST, File 50) is a collection route with no
 * dynamic segment; File 57 (the single-resource download route, which
 * WOULD have this shape) has never been pasted in any session captured
 * by the progress doc. The `{ params }: { params: Promise<{ id: string
 * }> }` signature and `await params` below follow Next.js 14's App
 * Router convention as a reasonable default, not a confirmed one — if
 * File 57 (or any other dynamic-segment route) turns out to destructure
 * params differently in this codebase, this file needs to match it, not
 * the other way around.
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
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const service = await buildNotificationService();
    const notification = await service.markAsRead({ id });

    return NextResponse.json({ data: { notification } });
  } catch (error) {
    return handleApiError(error);
  }
}
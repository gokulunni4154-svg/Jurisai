// src/app/api/notifications/[notificationId]/read/route.ts
//
// RELOCATED, THIS SESSION. Previously lived at
// src/app/api/documents/[id]/analyses/[analysisId]/notifications/[notificationId]/read/route.ts
// — same misfiling as GET /api/notifications (see that route's own
// header comment for the full explanation). This handler never read
// the outer `id` (document) or `analysisId` path segments either; only
// `notificationId` is used, exactly as before the move. Relocated so
// this route is reachable at the path notifications-panel.tsx already
// calls: `/api/notifications/${id}/read`. No logic changed.
//
// PATCH /api/notifications/[notificationId]/read
//
// Marks a single notification read. No request body — the route only
// needs the id from the URL segment, passed straight through to
// NotificationService.markAsRead() as rawParams, same "route hands the
// service a raw object, service owns validation" division as every
// other route in this project.
//
// `params` is a plain synchronous object, NOT a Promise — confirmed
// against real source this session (`/api/documents/[id]/route.ts`'s
// own dated comment, which cites File 30 as documented precedent for
// this exact confusion).
//
// PATCH chosen over POST for "mark read" as a partial-update semantic
// (only read_at changes) — not drawn from precedent either, since no
// other route in this project performs a partial update via a
// dedicated sub-path.
//
// Response shape `{ data: { notification } }` — singular, matching
// /api/documents's POST response shape for a single-resource result,
// not the plural `documents` key GET uses for a collection.
import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildNotificationService } from '@/modules/notifications/notification.factory';

interface RouteContext {
  params: { notificationId: string };
}

export async function PATCH(
  _request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  try {
    const { notificationId: id } = params;

    const service = await buildNotificationService();
    const notification = await service.markAsRead({ id });

    return NextResponse.json({ data: { notification } });
  } catch (error) {
    return handleApiError(error);
  }
}

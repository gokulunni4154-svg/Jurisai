import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildNotificationService } from '@/modules/notifications/notification.factory';

/**
 * GET /api/notifications?limit=20&offset=0&unreadOnly=false
 *
 * Returns a paginated list of notifications visible to the current
 * actor. Same division of responsibility as /api/documents's GET (File
 * 50): this route's only job is turning the query string into a plain
 * object for the service to validate, and shaping the response —
 * visibility itself is RLS's concern, not this route's or
 * NotificationService.listNotifications()'s beyond requiring
 * authentication.
 *
 * Response shape is `{ data: { notifications, total, limit, offset } }`
 * — deliberately matching /api/documents's flat pagination shape, not
 * /api/profiles's nested `{ data: { profiles, pagination } }` shape.
 * File 50's own comment already flags that divergence as unresolved
 * between Documents and Profiles; this route just picks the more
 * recently confirmed of the two rather than re-opening that question
 * here.
 *
 * NO POST route in this file, deliberately: unlike /api/documents (where
 * POST is a legitimate client-triggered metadata write following an
 * upload), a notification is never created by a direct client request in
 * this design — the 'hearing_date_set' type is created inline by
 * DocumentService's own future update flow, and 'hearing_date_reminder'
 * by the future cron route. NotificationService.createNotification()
 * exists for those server-side callers, but there is no
 * "POST /api/notifications" for a client to hit directly.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const rawQuery = Object.fromEntries(request.nextUrl.searchParams);

    const service = await buildNotificationService();
    const { notifications, total, limit, offset } = await service.listNotifications(rawQuery);

    return NextResponse.json({ data: { notifications, total, limit, offset } });
  } catch (error) {
    return handleApiError(error);
  }
}
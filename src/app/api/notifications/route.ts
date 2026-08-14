// src/app/api/notifications/route.ts
//
// RELOCATED, THIS SESSION. This route previously lived at
// src/app/api/documents/[id]/analyses/[analysisId]/notifications/route.ts
// — misfiled under a documentId/analysisId path it never read from
// `params` (the handler below takes no RouteContext at all; visibility
// is governed entirely by RLS via NotificationService.listNotifications(),
// same as before the move). That nesting made the route physically
// unreachable at the path every caller already expected: this file's own
// doc comment described it as `GET /api/notifications`, and
// notifications-panel.tsx (the shared component every Lawyer Terminal
// page — dashboard, matters, hearings, tasks, documents — already
// imports) fetches exactly `/api/notifications`. Under the old path this
// 404'd for every caller; the notification bell across the whole Lawyer
// Terminal was non-functional. No logic changed by this move — only the
// file's location, matching every other top-level resource's route
// convention in this project (/api/tasks, /api/hearings, /api/documents).
//
// GET /api/notifications?limit=20&offset=0&unreadOnly=false
//
// Returns a paginated list of notifications visible to the current
// actor. Same division of responsibility as /api/documents's GET (File
// 50): this route's only job is turning the query string into a plain
// object for the service to validate, and shaping the response —
// visibility itself is RLS's concern, not this route's or
// NotificationService.listNotifications()'s beyond requiring
// authentication.
//
// Response shape is `{ data: { notifications, total, limit, offset } }`
// — deliberately matching /api/documents's flat pagination shape, not
// /api/profiles's nested `{ data: { profiles, pagination } }` shape.
// File 50's own comment already flags that divergence as unresolved
// between Documents and Profiles; this route just picks the more
// recently confirmed of the two rather than re-opening that question
// here.
//
// NO POST route in this file, deliberately: unlike /api/documents (where
// POST is a legitimate client-triggered metadata write following an
// upload), a notification is never created by a direct client request in
// this design — the 'hearing_date_set' type is created inline by
// DocumentService's own hearing_date update flow, 'hearing_date_reminder'
// / 'hearing_reminder' by the cron routes, and 'lawyer_inquiry_received'
// by inquiry creation. NotificationService.createNotification() exists
// for those server-side callers, but there is no "POST /api/notifications"
// for a client to hit directly.
import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildNotificationService } from '@/modules/notifications/notification.factory';

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

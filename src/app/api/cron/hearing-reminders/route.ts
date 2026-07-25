// Real path: src/app/api/cron/hearing-reminders/route.ts
//
// Mirrors cron/hearing-date-reminders/route.ts's real, confirmed
// pattern exactly: bypasses the Service layer entirely (a cron
// invocation has no currentUser), constructs repositories directly
// under admin.ts, same CRON_SECRET bearer-token auth check, same
// per-row try/catch producing a 'sent' | 'skipped' | 'failed' result
// array, same audit-log integration for actual sends (not skips).
//
// DEDUP DIFFERS FROM THE DOCUMENT CRON ON PURPOSE: the document cron
// dedupes via NotificationRepository#reminderAlreadySent() (a query
// against `notifications`, since `documents` itself has no dedup
// column -- see that migration's own flagged, unresolved gap). Hearings
// took the other option that same migration comment raised: a
// reminder_sent_at column directly on `hearings`
// (20260904000000_create_hearings_table.sql). This cron therefore
// dedupes via HearingRepository#findDueForReminder()'s own
// `reminder_sent_at is null` filter, not a notifications lookup, and
// marks completion via HearingRepository#markReminderSent() rather
// than relying on the notification row's own existence as the dedup
// signal.
//
// Notification type: 'hearing_reminder' (NOT 'hearing_date_reminder',
// which remains scoped to `documents.hearing_date` only) -- see
// 20260904000001_widen_notifications_for_hearings.sql's own header for
// why a new type + hearing_id column was added rather than reusing the
// existing one.
//
// RECIPIENT SCOPE -- UPDATED THIS SESSION. Previously sent to the case
// owner only. Now sends to the owner PLUS every active read_write
// grantee (explicit user decision this session: read_write only, NOT
// every active grantee -- read_only grantees are deliberately excluded
// from this reminder). Fetched via
// CaseAccessGrantRepository#findActiveGrantsForCase(hearing.case_id)
// (real, pasted this session), filtered locally to
// access_level === 'read_write'.
//
// FLAGGED ASSUMPTION, NOT INDEPENDENTLY CONFIRMED: the real
// case-access-grant.repository.ts pasted this session returns
// CaseAccessGrantRow (typed straight off database.types.ts) but that
// row's own column list was not itself re-pasted here -- the
// `access_level` column name and its 'read_write' / 'read_only' enum
// values are carried over from this project's own established
// language elsewhere (the "case owner or active read_write grantee"
// RLS/service access-branch phrasing used when hearings.case_id's
// access rule was originally decided). If the real column name or
// enum values differ, this filter needs updating.
//
// RECIPIENT DEDUPE: a grantee whose grantee_id happens to equal the
// case owner_id (shouldn't normally occur, but not schema-enforced
// against it) is only notified once -- recipient list is deduplicated
// by profile id before creating notifications.
//
// FAILURE HANDLING, SAME ACCEPTED TRADE-OFF AS BEFORE, NOW WIDER IN
// SCOPE: all recipient notification creates plus the audit write
// happen inside the same per-hearing try block. If ANY single
// recipient's notification create fails partway through the loop, the
// whole hearing is reported 'failed' overall, even if earlier
// recipients in that same hearing's loop already got notified
// successfully -- same documented trade-off as before (previously
// applied only to the single-recipient + audit-write case), just now
// covering N recipients instead of 1. Not solved here; flagging that
// the blast radius of a partial failure is now larger than it was.

import { NextResponse } from 'next/server';

import { serverEnv } from '@/core/config/env.server';
import { createAdminClient } from '@/core/supabase/admin';
import { HearingRepository } from '@/modules/hearings/hearing.repository';
import { CaseRepository } from '@/modules/cases/case.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { NotificationRepository } from '@/modules/notifications/notification.repository';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

const REMINDER_WINDOW_DAYS = 3;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatHearingDateForMessage(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface ReminderResult {
  hearingId: string;
  status: 'sent' | 'skipped' | 'failed';
  recipientCount?: number;
  error?: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  }

  const supabase = createAdminClient();
  const hearingRepository = new HearingRepository(supabase);
  const caseRepository = new CaseRepository(supabase);
  const caseAccessGrantRepository = new CaseAccessGrantRepository(supabase);
  const notificationRepository = new NotificationRepository(supabase);
  const auditLogRepository = new AuditLogRepository(supabase);

  const now = new Date();
  const windowEnd = addDays(now, REMINDER_WINDOW_DAYS);

  let dueHearings;
  try {
    dueHearings = await hearingRepository.findDueForReminder(
      now.toISOString(),
      windowEnd.toISOString(),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          message:
            err instanceof Error ? err.message : 'Failed to query hearings due for a reminder',
        },
      },
      { status: 500 },
    );
  }

  const results: ReminderResult[] = [];

  for (const hearing of dueHearings) {
    try {
      // Case row needed for owner_id.
      const caseRow = await caseRepository.findByIdOrThrow(hearing.case_id);

      // Active read_write grantees for this case. See header flag:
      // access_level column name / enum values not independently
      // re-confirmed against a pasted database.types.ts row this
      // session.
      const activeGrants = await caseAccessGrantRepository.findActiveGrantsForCase(
        hearing.case_id,
      );
      const readWriteGrantees = activeGrants.filter(
        (grant) => (grant as { access_level?: string }).access_level === 'read_write',
      );

      const recipientIds = Array.from(
        new Set([caseRow.owner_id, ...readWriteGrantees.map((grant) => grant.grantee_id)]),
      );

      for (const recipientId of recipientIds) {
        await notificationRepository.create({
          user_id: recipientId,
          hearing_id: hearing.id,
          type: 'hearing_reminder',
          title: 'Upcoming hearing',
          message: `A hearing is scheduled for ${formatHearingDateForMessage(hearing.hearing_date)}${hearing.court_name ? ` at ${hearing.court_name}` : ''}.`,
        } as never);
      }

      await hearingRepository.markReminderSent(hearing.id);

      // Same reasoning as before, now covering every recipient in this
      // hearing's loop -- see header's FAILURE HANDLING flag.
      await auditLogRepository.recordSystemAction({
        action: 'notification.hearing_reminder.sent',
        resourceType: 'hearing',
        resourceId: hearing.id,
        metadata: { hearingDate: hearing.hearing_date, recipientUserIds: recipientIds },
      });

      results.push({ hearingId: hearing.id, status: 'sent', recipientCount: recipientIds.length });
    } catch (err) {
      results.push({
        hearingId: hearing.id,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    data: {
      windowEnd: windowEnd.toISOString(),
      checked: dueHearings.length,
      results,
    },
  });
}
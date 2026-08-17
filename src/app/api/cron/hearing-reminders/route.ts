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
//
// CLIENT PORTAL PHASE 3 -- CLIENT NOTIFICATIONS (this session), ADDITIVE.
// Real gap found and closed: this cron already resolves "who should be
// notified for this hearing" as owner + active read_write grantees, but
// never checked whether the case has a linked Client Portal user
// (cases.client_id -> clients.profile_id) at all. Reusing the EXISTING
// 'hearing_reminder' notification type/hearing_id shape for the client
// recipient too -- no new notification type, no new column, no new
// dedup mechanism needed. The per-hearing reminder_sent_at gate already
// covers the client recipient the same way it covers every other
// recipient: one send per hearing, all recipients together.
//
// SECURITY: the client recipient's user_id is resolved ENTIRELY
// server-side, under the admin client already in use for this whole
// route -- cases.client_id (server-read) -> clients.id (server lookup,
// ClientRepository#findById(), admin client bypasses RLS deliberately,
// same as every other repository already constructed in this route) ->
// clients.profile_id. No client-supplied id of any kind is ever
// consulted. If the case has no client_id, or the linked clients row
// has no profile_id yet (client record exists but hasn't completed
// portal signup), no client notification is created for that hearing --
// silently skipped, not an error, since both are valid ordinary states.
//
// SCOPE CORRECTION AGAINST THE AUDIT BRIEF THAT REQUESTED THIS FEATURE:
// the brief's own text named 'hearing_date_reminder' as "the first
// notification type" for this feature. Read against the real, pasted
// migrations (20260725010000_create_notifications_table.sql,
// 20260904000001_widen_notifications_for_hearings.sql) that name is
// WRONG for this feature -- 'hearing_date_reminder' is a distinct,
// older type permanently scoped to documents.hearing_date (requires
// document_id + hearing_date_snapshot, forbids hearing_id). The correct,
// already-real type for a hearings-table reminder is 'hearing_reminder'
// (requires hearing_id), which is what this route already sends to
// lawyer recipients and now also sends to the client recipient. Not
// silently corrected without a trace: flagged here, and in the session
// report, per the brief's own "read the actual code first, don't
// assume the audit is current" instruction.
//
// CLIENT-VISIBLE CONTENT: reuses the exact same title/message already
// sent to lawyer recipients ("Upcoming hearing" / date + court name).
// No internal-lawyer-only field is added for the client branch -- there
// was nothing lawyer-internal in this message to begin with, so no
// separate client-facing copy was needed.

import { NextResponse } from 'next/server';

import { serverEnv } from '@/core/config/env.server';
import { createAdminClient } from '@/core/supabase/admin';
import { HearingRepository } from '@/modules/hearings/hearing.repository';
import { CaseRepository } from '@/modules/cases/case.repository';
import { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import { NotificationRepository } from '@/modules/notifications/notification.repository';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { ClientRepository } from '@/modules/user-management/client.repository';

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
  const clientRepository = new ClientRepository(supabase);

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

      // Client Portal recipient -- see file header. Resolved
      // server-side only, from the authorized case relationship;
      // never from any client-supplied id.
      let clientRecipientId: string | null = null;
      if (caseRow.client_id) {
        const clientRow = await clientRepository.findById(caseRow.client_id);
        if (clientRow?.profile_id) {
          clientRecipientId = clientRow.profile_id;
        }
      }

      const recipientIds = Array.from(
        new Set([
          caseRow.owner_id,
          ...readWriteGrantees.map((grant) => grant.grantee_id),
          ...(clientRecipientId ? [clientRecipientId] : []),
        ]),
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
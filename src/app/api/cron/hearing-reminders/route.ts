// src/app/api/cron/hearing-reminders/route.ts
// AMENDED THIS SESSION — added Audit Log integration, per the confirmed
// Item #48 precedent: this route already bypasses the Service layer
// entirely for DocumentRepository/NotificationRepository, calling them
// directly under admin.ts because a cron invocation has no currentUser.
// AuditLogRepository is wired in the same way, for the same reason —
// NOT through AuditLogService.recordSystemEvent(), which would be the
// odd one out against this route's own established pattern.
//
// Everything else in this file is unchanged from the prior confirmed
// version (see this file's own prior header for the CRON_SECRET/
// serverEnv history).

import { NextResponse } from 'next/server';

import { serverEnv } from '@/core/config/env.server';
import { createAdminClient } from '@/core/supabase/admin';
import { DocumentRepository } from '@/modules/documents/document.repository';
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
  });
}

interface ReminderResult {
  documentId: string;
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  }

  const supabase = createAdminClient();
  const documentRepository = new DocumentRepository(supabase);
  const notificationRepository = new NotificationRepository(supabase);
  const auditLogRepository = new AuditLogRepository(supabase);

  const reminderDate = addDays(new Date(), REMINDER_WINDOW_DAYS);

  let dueDocuments;
  try {
    dueDocuments = await documentRepository.findDueForHearingReminder(reminderDate);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          message: err instanceof Error ? err.message : 'Failed to query documents due for a hearing reminder',
        },
      },
      { status: 500 },
    );
  }

  const results: ReminderResult[] = [];

  for (const doc of dueDocuments) {
    if (!doc.hearing_date) {
      continue;
    }

    try {
      const alreadySent = await notificationRepository.reminderAlreadySent(
        doc.id,
        doc.hearing_date,
      );

      if (alreadySent) {
        results.push({ documentId: doc.id, status: 'skipped' });
        continue;
      }

      await notificationRepository.create({
        user_id: doc.owner_id,
        document_id: doc.id,
        type: 'hearing_date_reminder',
        title: 'Upcoming hearing date',
        message: `This document has a hearing date on ${formatHearingDateForMessage(doc.hearing_date)} — ${REMINDER_WINDOW_DAYS} days from now.`,
        hearing_date_snapshot: doc.hearing_date,
      } as never);

      // NEW — audit the actual notification send, not the skip. A skip
      // is "nothing happened," which isn't an event worth a row here.
      // Failure to write this audit entry is deliberately NOT caught
      // separately below — it falls into this same try block's catch,
      // meaning a document whose notification succeeded but whose audit
      // write failed is reported as 'failed' overall. Flagged trade-off:
      // this could under-report real successes if audit writes are
      // flaky, but the alternative (silently swallowing an audit-write
      // failure) means an event happened with no record of it, which is
      // worse for what this table exists to guarantee.
      await auditLogRepository.recordSystemAction({
        action: 'notification.hearing_date_reminder.sent',
        resourceType: 'document',
        resourceId: doc.id,
        metadata: { hearingDate: doc.hearing_date, recipientUserId: doc.owner_id },
      });

      results.push({ documentId: doc.id, status: 'sent' });
    } catch (err) {
      results.push({
        documentId: doc.id,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    data: {
      reminderDate: reminderDate.toISOString(),
      checked: dueDocuments.length,
      results,
    },
  });
}
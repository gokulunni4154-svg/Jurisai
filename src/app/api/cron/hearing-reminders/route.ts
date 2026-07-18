// src/app/api/cron/hearing-reminders/route.ts
// NEW FILE — file number not yet assigned. Ask the user to number this
// alongside the other unnumbered files (see PROJECT_PROGRESS.md Item #53).
//
// Implements decision (a) from Item #48: this route calls
// DocumentRepository and NotificationRepository DIRECTLY under admin.ts,
// bypassing DocumentService/NotificationService/BaseService entirely.
// There is no requesting user for a Vercel Cron invocation, so a Service
// layer that requires currentUser on every method (File 179's real,
// confirmed constraint) cannot be used here as-is.
//
// SOURCE-VERIFIED AGAINST:
//   - admin.ts, document.repository.ts (File 47), notification.repository.ts
//     (File 178) — see prior version of this file's header for full detail.
//   - env.server.ts — real source pasted this session. CRON_SECRET has
//     been added to serverEnvSchema (closing Item #56); this route now
//     reads it via the validated `serverEnv.CRON_SECRET`, not raw
//     `process.env.CRON_SECRET`, matching the pattern every other secret
//     in this project follows.
//
// STILL FLAGGED, UNCHANGED FROM BEFORE:
//   - Cron schedule/time-of-day: still UNDECIDED (Item #57). vercel.json's
//     03:00 UTC / 08:30 IST daily entry remains a placeholder.
//   - notification.entity.ts (File 176)'s CreateNotificationInput type
//     still not pasted; insert payload still built from
//     notification.repository.ts's documented column list (Item #58).
//   - Reminder window still compares UTC calendar dates (Item #54's
//     timezone caveat, unresolved).
//   - Per-document try/catch failure isolation — fresh design, no
//     precedent, unchanged (Item #59).

import { NextResponse } from 'next/server';

import { serverEnv } from '@/core/config/env.server';
import { createAdminClient } from '@/core/supabase/admin';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { NotificationRepository } from '@/modules/notifications/notification.repository';

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
  // Vercel sends this header automatically on real Cron invocations once
  // CRON_SECRET is set as an environment variable. Now read through
  // serverEnv (fail-fast at boot if unset/empty), not raw process.env —
  // closes Item #56.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  }

  const supabase = createAdminClient();
  const documentRepository = new DocumentRepository(supabase);
  const notificationRepository = new NotificationRepository(supabase);

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
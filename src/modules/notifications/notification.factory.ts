import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';

import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

/**
 * Constructs a request-scoped NotificationService. Follows
 * buildDocumentService()'s pattern exactly — resolve the current user
 * once via getCurrentUser(), construct a fresh request-scoped Supabase
 * client via createClient() (the RLS-respecting client, never admin.ts),
 * inject both into the repository/service pair.
 *
 * Same load-bearing reason as buildDocumentService's own comment states
 * for Documents: NotificationService's read visibility (listNotifications)
 * depends on this being the RLS-respecting client, not admin.ts — using
 * admin.ts here would silently turn every caller into an admin for read
 * purposes.
 *
 * DOES NOT COVER the future Vercel Cron job's 'hearing_date_reminder'
 * creation path — see NotificationService's class-level doc comment.
 * This factory assumes a real request with a real (possibly null,
 * per getCurrentUser()'s own contract) currentUser; a cron invocation has
 * neither a request nor a session to resolve getCurrentUser() from. That
 * path needs its own construction, deliberately not built here since the
 * decision of what that construction looks like hasn't been made yet.
 */
export async function buildNotificationService(): Promise<NotificationService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const notificationRepository = new NotificationRepository(supabase);
  return new NotificationService(currentUser, notificationRepository);
}
import { getCurrentUser } from '@/core/auth/session';
import { createAdminClient } from '@/core/supabase/admin';
import { createClient } from '@/core/supabase/server';

import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

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
 *
 * AMENDED, THIS SESSION — NotificationService now also needs an
 * AuditLogRepository (see notification.service.ts's own header on why:
 * createNotification()/markAsRead() each write an audit entry as their
 * final step). Constructed via createAdminClient(), NOT the RLS-
 * respecting `supabase` client already resolved above for
 * NotificationRepository — this follows audit-log.factory.ts's own
 * established precedent that AuditLogRepository is always constructed
 * against the admin client, since audit_log has no RLS read policy and
 * every existing caller (document.factory.ts, billing.factory.ts,
 * audit-log.factory.ts itself) does the same. This factory is now the
 * third to reach for two differently-scoped Supabase clients in one
 * request (after BillingService and DocumentService) — same two-client
 * shape, not a new pattern.
 */
export async function buildNotificationService(): Promise<NotificationService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const notificationRepository = new NotificationRepository(supabase);
  const auditLogRepository = new AuditLogRepository(createAdminClient());

  return new NotificationService(currentUser, notificationRepository, auditLogRepository);
}
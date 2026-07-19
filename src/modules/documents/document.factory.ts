import { getCurrentUser } from '@/core/auth/session';
import { createAdminClient } from '@/core/supabase/admin';
import { createClient } from '@/core/supabase/server';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { NotificationRepository } from '@/modules/notifications/notification.repository';
import { NotificationService } from '@/modules/notifications/notification.service';

import { DocumentRepository } from './document.repository';
import { DocumentService } from './document.service';

/**
 * Constructs a request-scoped DocumentService.
 *
 * Follows profile.factory.ts's buildProfileService() (File 31) exactly —
 * the second instance of that pattern, not a new one: resolve the current
 * user once via getCurrentUser() (File 20), construct a fresh
 * request-scoped Supabase client via createClient() (File 14), and inject
 * both into the repository/service pair. See buildProfileService()'s doc
 * comment for the full rationale (why currentUser is allowed to be null
 * here, why two independent client-related calls aren't a duplicate
 * auth round-trip, why this must never be cached at module scope); it
 * applies here without modification.
 *
 * One thing worth stating explicitly for Documents specifically, since
 * it's load-bearing for File 47/48's design: createClient() (File 14) is
 * the RLS-respecting client, and it is the ONLY client DocumentRepository
 * itself is ever constructed with. DocumentService's entire "reads are
 * visible via RLS, including the admin SELECT policy branch, with no
 * admin-specific branching in the service itself" design (see File 48's
 * class-level doc comment) depends on that — swapping in an
 * RLS-bypassing client for DocumentRepository here would silently turn
 * every caller into an admin for read purposes, defeating the model this
 * module was built around. That guarantee is unchanged by Amendment #15
 * below.
 *
 * CORRECTED, AMENDMENT #15 (THIS SESSION) — this file's doc comment
 * previously stated this factory "deliberately never reaches for
 * admin.ts" at all. That is no longer true at the factory level (see
 * below) and is corrected here rather than left stale; it remains true
 * specifically for DocumentRepository, which is the guarantee that
 * actually mattered.
 *
 * NEW, AMENDMENT #14 — DocumentService now also needs a NotificationService
 * (to fire the immediate 'hearing_date_set' notification from
 * updateDocument()). Inline-constructed here, sharing this factory's
 * SAME currentUser and SAME supabase client instances, rather than
 * calling buildNotificationService() — this follows the unanimous
 * inline-construction precedent this project has used since File 105
 * (most recently pdf-export.factory.ts's inline construction of
 * LegalHealthScoreService and its own sibling graph), not a new pattern
 * introduced here. Sharing the same currentUser/supabase instances
 * (rather than each factory independently re-resolving them) means
 * DocumentService and the NotificationService it calls internally are
 * guaranteed to be acting as the exact same request-scoped actor — there
 * is no scenario where updateDocument()'s notification gets created
 * under a different identity than the update itself.
 *
 * NEW, AMENDMENT #15 (THIS SESSION) — DocumentService now also needs an
 * AuditLogRepository (to write 'documents.create/update/delete' entries —
 * see document.service.ts's Amendment #15 header). Built directly against
 * real billing.factory.ts source for the pattern: audit_log has no RLS
 * policy at all (confirmed via audit-log.repository.ts's own doc
 * comment), so AuditLogRepository — unlike DocumentRepository and
 * NotificationRepository, both of which sit behind real RLS policies and
 * use the request-scoped `supabase` client above — is constructed with
 * createAdminClient() (File: src/core/supabase/admin.ts), the cached
 * module-level service-role client. This makes DocumentService the
 * second Service in the project (after BillingService) to depend on two
 * differently-scoped Supabase clients within a single request: ordinary
 * reads/writes remain exactly as RLS-scoped as they were before this
 * amendment, while only the audit trail itself bypasses RLS — matching
 * billing.factory.ts's own stated rationale for the identical split.
 * createAdminClient() is safe to call here even though this factory
 * already holds a request-scoped `supabase` — per admin.ts's own doc
 * comment, it carries no per-user session to isolate, so reusing the
 * cached singleton is correct regardless of how many other clients this
 * factory also constructs.
 */
export async function buildDocumentService(): Promise<DocumentService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const documentRepository = new DocumentRepository(supabase);

  const notificationRepository = new NotificationRepository(supabase);
  const notificationService = new NotificationService(currentUser, notificationRepository);

  // Deliberately a DIFFERENT client instance from `supabase` above — see
  // this file's Amendment #15 doc comment. createAdminClient() is a
  // cached module-level singleton (admin.ts), not request-scoped.
  const adminClient = createAdminClient();
  const auditLogRepository = new AuditLogRepository(adminClient);

  return new DocumentService(currentUser, documentRepository, notificationService, auditLogRepository);
}
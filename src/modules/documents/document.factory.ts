import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
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
 * the RLS-respecting client. This factory deliberately never reaches for
 * admin.ts (File 17) here. DocumentService's entire "reads are visible
 * via RLS, including the admin SELECT policy branch, with no
 * admin-specific branching in the service itself" design (see File 48's
 * class-level doc comment) depends on that — swapping in an
 * RLS-bypassing client here would silently turn every caller into an
 * admin for read purposes, defeating the model this module was built
 * around.
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
 */
export async function buildDocumentService(): Promise<DocumentService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const documentRepository = new DocumentRepository(supabase);

  const notificationRepository = new NotificationRepository(supabase);
  const notificationService = new NotificationService(currentUser, notificationRepository);

  return new DocumentService(currentUser, documentRepository, notificationService);
}
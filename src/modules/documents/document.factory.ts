import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';

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
 */
export async function buildDocumentService(): Promise<DocumentService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const documentRepository = new DocumentRepository(supabase);
  return new DocumentService(currentUser, documentRepository);
}
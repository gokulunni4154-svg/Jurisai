import { createAdminClient } from '@/lib/supabase/admin';

import { LawyerDirectoryRepository } from './lawyer-directory.repository';
import { LawyerDirectoryService } from './lawyer-directory.service';

/**
 * Builds a LawyerDirectoryService wired to the admin (service-role)
 * client -- same reasoning as buildAnonymousAnalysisService(): the
 * directory read has to bypass professional_verifications' RLS (which
 * only permits select_own / select_admin, confirmed against that
 * table's real migration this session), since this listing is public
 * and pre-auth by design (§2 step 2).
 *
 * FLAGGED: this repeats the same `createAdminClient` name/path
 * assumption flagged in anonymous-analysis.factory.ts -- not
 * re-verified independently here, same inherited gap. If that import
 * is wrong, both factories break the same way and need the same
 * one-line fix.
 *
 * FLAGGED, a real risk worth naming explicitly: this is now the SECOND
 * feature area in this project using the admin client to deliberately
 * bypass RLS for a public read. That's an increasing surface area for
 * "admin client used where it shouldn't be" mistakes as this pattern
 * repeats -- worth considering a single shared
 * `createPublicReadClient()` (or similar) wrapper that's explicitly
 * documented as "service-role, read-only by convention" rather than
 * every factory reaching for the same general-purpose admin client
 * that also has full write access. Not built here since it would be
 * inventing a new shared module unprompted -- flagged as a suggestion,
 * not acted on.
 */
export async function buildLawyerDirectoryService(): Promise<LawyerDirectoryService> {
  const adminClient = createAdminClient();
  const repository = new LawyerDirectoryRepository(adminClient);

  return new LawyerDirectoryService({ repository });
}
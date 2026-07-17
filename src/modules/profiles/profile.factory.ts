import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';

import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';

/**
 * Constructs a request-scoped ProfileService.
 *
 * Unlike auth.factory.ts's buildAuthService() (File 35), ProfileService
 * needs a pre-resolved current user — most of what it does (getOwnProfile,
 * updateOwnProfile, and requireOwnership()-gated reads/writes) is acting
 * on behalf of a session that's expected to already exist, not
 * establishing one. That resolution happens here, once, via
 * getCurrentUser() (File 20) — every other call site continues to depend
 * on BaseService's `currentUser: AuthUser | null` being injected rather
 * than resolving its own session, per File 23's documented rationale
 * (avoiding redundant Supabase calls / a request's user context drifting
 * if resolved more than once).
 *
 * `currentUser` is deliberately allowed to be `null` here, rather than
 * checked with an early `if (!currentUser) throw ...`. Not every route
 * this service is used from requires authentication by construction —
 * ProfileService's own methods (via BaseService's
 * requireAuthentication/requireOwnership guards) are what turn "no user"
 * into a thrown AppError at the point an operation actually needs one.
 * Throwing here instead would make this factory silently stricter than
 * the service it constructs.
 *
 * getCurrentUser() and createClient() are called as two independent
 * awaits rather than combined into one lookup — getCurrentUser() (File
 * 20) already owns its own request-scoped client internally and does not
 * expose it, by design (it wraps auth.getUser() + the AuthUser mapping as
 * a single sealed operation). Calling createClient() again here for the
 * repository's client is a second, separate request-scoped instance, not
 * a duplicate network round-trip — the only actual auth verification call
 * (auth.getUser()) happens once, inside getCurrentUser().
 *
 * Must be called fresh per request, never cached at module scope — same
 * reasoning as buildAuthService(): createClient() (File 14) is bound to
 * the current request's cookies, and so, transitively, is getCurrentUser().
 *
 * CORRECTION TO PROJECT_PROGRESS.md: the Amendments Log (entries #3 and
 * #4) and the folder structure both describe this file as already
 * existing as of File 31, with two later files "extracted to" or
 * "applied and verified against" it. That was incorrect — this is the
 * file's actual first implementation, built this session. Please correct
 * PROJECT_PROGRESS.md accordingly rather than carrying the stale claim
 * forward; I'm flagging it here rather than silently reconstructing a
 * "File 31" that would misrepresent what was actually verified when.
 */
export async function buildProfileService(): Promise<ProfileService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const profileRepository = new ProfileRepository(supabase);
  return new ProfileService(currentUser, profileRepository);
}
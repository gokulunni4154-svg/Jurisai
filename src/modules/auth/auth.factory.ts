import { createClient } from '@/core/supabase/server';
import { AuthService } from '@/modules/auth/auth.service';

/**
 * Constructs a request-scoped AuthService.
 *
 * Simpler than profile.factory.ts's buildProfileService(): AuthService
 * only needs a Supabase client, not a pre-resolved current user -- most
 * of what it does (signUp, signIn) is establishing a session, not acting
 * on behalf of one that already exists.
 *
 * Must be called fresh per request, never cached at module scope, since
 * createClient() (File 14) is itself bound to the current request's
 * cookies.
 */
export async function buildAuthService(): Promise<AuthService> {
  const supabase = await createClient();
  return new AuthService(supabase);
}
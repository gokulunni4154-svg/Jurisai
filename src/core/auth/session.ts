import { createClient } from '@/core/supabase/server';
import { mapSupabaseUserToAuthUser } from '@/core/auth/mapper';
import type { AuthSession, AuthUser } from '@/core/auth/types';

/**
 * Retrieves the current authenticated session in a server context (Server
 * Component, Route Handler, or Server Action).
 *
 * Wires together three steps that would otherwise be duplicated at every
 * call site:
 *   1. Create a request-scoped server client (src/core/supabase/server.ts)
 *   2. Verify the session via `auth.getUser()` — NOT `getSession()`, for
 *      the same reason documented in server.ts: getSession() doesn't
 *      verify the JWT against Supabase's Auth server, getUser() does.
 *   3. Map the verified Supabase User into our AuthUser domain type
 *      (src/core/auth/mapper.ts)
 *
 * Returns `null` when there is no authenticated user — this is expected,
 * everyday behavior (an anonymous visitor), not an error. Callers branch
 * on it directly:
 *
 *   const session = await getCurrentSession();
 *   if (!session) redirect('/login');
 *
 * Deliberately does NOT catch unexpected failures (e.g. a network error
 * reaching Supabase's Auth server). Swallowing those into a `null` return
 * would make "nobody is logged in" indistinguishable from "auth is
 * down" to every caller — a dangerous conflation, since a caller might
 * redirect to /login when the real problem is an outage. Such errors
 * propagate to be handled by the global error-handling layer (Task 21,
 * not yet built), which has the context to decide how to log/surface
 * them.
 */
export async function getCurrentSession(): Promise<AuthSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const authUser = mapSupabaseUserToAuthUser(user);

  // Safe to read expiry from getSession() now — identity was already
  // verified above via getUser(). We are not trusting getSession() for
  // *who* the user is, only for the numeric expires_at timestamp.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    user: authUser,
    expiresAt: session?.expires_at ?? Math.floor(Date.now() / 1000),
  };
}

/**
 * Convenience wrapper around `getCurrentSession()` for the common case
 * where only the user (not session expiry) is needed.
 *
 *   const user = await getCurrentUser();
 *   if (!user) redirect('/login');
 *   if (user.role !== 'admin') throw new AuthorizationError();
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}
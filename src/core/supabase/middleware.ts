import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

import { clientEnv } from '@/core/config/env';
import type { Database } from '@/core/supabase/database.types';

/**
 * Result of refreshing the Supabase auth session for a request.
 *
 * `user` is the raw, server-verified Supabase user (or `null` if
 * unauthenticated) — deliberately NOT mapped to our app-level `AuthUser`
 * (see src/core/auth/mapper.ts). Mapping enforces the "role must be
 * present and valid in app_metadata" invariant by throwing when it isn't,
 * which is the correct behavior deep in the app (a genuine provisioning
 * bug should surface loudly) but is the wrong behavior here: this runs on
 * EVERY request, including anonymous visits to public pages, so a single
 * corrupted account's app_metadata must never be able to 500 the entire
 * site for that visitor. Anything that needs the mapped, role-bearing
 * AuthUser should call mapSupabaseUserToAuthUser() itself, deliberately,
 * at the point it actually needs the role.
 */
interface UpdateSessionResult {
  response: NextResponse;
  user: User | null;
}

/**
 * Refreshes the Supabase auth session cookie for an incoming request, and
 * returns the server-verified user so callers (e.g. src/middleware.ts's
 * route-protection logic) can make auth decisions without paying for a
 * second getUser() round trip to the Auth server.
 *
 * WHY THIS EXISTS: Server Components can read cookies but cannot write
 * them (see src/core/supabase/server.ts). If nothing refreshes the access
 * token before it expires, users are silently logged out mid-session even
 * though their refresh token is still valid — Middleware is the only place
 * in the request lifecycle that runs before Server Components and *can*
 * write cookies, making it the correct place to do this.
 *
 * Framework-agnostic-ish logic lives here (not in src/middleware.ts)
 * so it can be unit-tested directly with Vitest, without needing the
 * Edge Runtime's middleware execution context.
 *
 * @param request - The incoming Next.js request, passed through from
 *                   src/middleware.ts.
 * @returns `response` — a NextResponse carrying the refreshed session
 *          cookie (if a refresh occurred) that MUST be returned as-is (or
 *          have its cookies copied onto whatever response IS ultimately
 *          returned) from middleware; constructing a fresh
 *          NextResponse.next() instead would silently drop the refreshed
 *          cookie. `user` — the server-verified user, or `null`.
 */
export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Cookies must be set on both the request (so this same
          // middleware invocation sees the update if it reads cookies
          // again) and the response (so the browser actually receives
          // the refreshed cookie).
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Deliberately getUser(), not getSession(): getSession() only decodes
  // the JWT from the cookie without verifying it against Supabase's Auth
  // server, so a forged or stale cookie could pass unnoticed. getUser()
  // performs a real server-side verification call. Middleware runs on
  // every request, making it the right place to absorb that verification
  // cost rather than trusting an unverified cookie further into the app.
  //
  // The call has two effects we care about: (1) the `setAll` callback
  // above refreshes the token cookie when needed, and (2) the returned,
  // verified user is now surfaced to the caller for route-protection
  // decisions (see src/middleware.ts) — previously discarded, now that
  // there's a real use for it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { clientEnv } from '@/core/config/env';
import type { Database } from '@/core/supabase/database.types';

/**
 * Creates a Supabase client for use in Server Components, Route Handlers,
 * and Server Actions.
 *
 * Bridges Supabase's auth session to Next.js's `cookies()` store, so the
 * session set by the browser client (src/core/supabase/client.ts) is
 * visible here — `await supabase.auth.getUser()` on the server returns the
 * same user the client sees. Without this bridge, server and client would
 * have independently desynced auth state.
 *
 * SECURITY: this client authenticates as the requesting user via their
 * session cookie and is subject to Row Level Security. It intentionally
 * uses the public anon key, never SUPABASE_SERVICE_ROLE_KEY. A query that
 * needs to bypass RLS (admin operations, background jobs) must use a
 * separate, explicitly-named admin client instead — never this one — so
 * "RLS-enforced" vs. "RLS-bypassed" is always a deliberate choice visible
 * at the call site.
 *
 * Must be awaited and called fresh per request/action — never cached at
 * module scope. Each request has its own cookies/session; caching this
 * across requests would leak one user's session into another's request.
 *
 * Usage:
 *   import { createClient } from '@/core/supabase/server';
 *   const supabase = await createClient();
 *   const { data: { user } } = await supabase.auth.getUser();
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Expected when called from a Server Component: Server
            // Components can read cookies but not write them — only
            // Route Handlers, Server Actions, and Middleware can. This is
            // safe to ignore as long as Middleware
            // (src/middleware.ts, later) refreshes the session on every
            // request, which keeps the cookie fresh regardless of
            // whether this particular Server Component could write it.
          }
        },
      },
    },
  );
}
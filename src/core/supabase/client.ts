import { createBrowserClient } from '@supabase/ssr';

import { clientEnv } from '@/core/config/env';
import type { Database } from '@/core/supabase/database.types';

/**
 * Creates a Supabase client for use inside Client Components.
 *
 * Uses `@supabase/ssr`'s `createBrowserClient` (not the vanilla
 * `@supabase/supabase-js` `createClient`) because it persists the auth
 * session via cookies rather than `localStorage`. That's what allows the
 * server-side client (src/core/supabase/server.ts) to read the *same*
 * session on the next request — using the vanilla client here would work
 * in isolation but silently desync client/server auth state.
 *
 * This is a factory, not a pre-built singleton instance. Call it once per
 * component/hook that needs a client:
 *
 *   'use client';
 *   import { createClient } from '@/core/supabase/client';
 *
 *   const supabase = createClient();
 *
 * `createBrowserClient` manages its own safe singleton behavior internally
 * (one underlying connection per browser tab); wrapping it in a
 * module-level singleton here would risk holding a stale client across
 * Fast Refresh reloads and auth state transitions in dev.
 *
 * Generic over `Database` (src/core/supabase/database.types.ts) so every
 * `.from('table')` / `.rpc('function')` call is checked against real
 * schema once migrations exist.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
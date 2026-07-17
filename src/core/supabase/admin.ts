import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { clientEnv } from '@/core/config/env';
import { serverEnv } from '@/core/config/env.server';
import type { Database } from '@/core/supabase/database.types';

/**
 * Creates a Supabase client authenticated as the SERVICE ROLE.
 *
 * ⚠️ DANGER: this client BYPASSES ROW LEVEL SECURITY ENTIRELY. It can
 * read and write any row in any table, regardless of who (if anyone) is
 * making the request. It must only be used for operations that have no
 * requesting user in context and genuinely need cross-tenant access:
 *
 *   - Background jobs / cron tasks
 *   - Webhook handlers (payments, external service callbacks)
 *   - Admin panel actions, after the caller has ALREADY been verified as
 *     an authorized admin by application-level checks
 *   - Server-side data migrations/backfills
 *
 * For anything that acts on behalf of a specific logged-in user, use
 * src/core/supabase/server.ts instead — that client enforces RLS as that
 * user, which is almost always the correct behavior. Reaching for this
 * file instead of server.ts should be a deliberate, reviewable decision,
 * never a default.
 *
 * Guarded twice against client-bundle leakage: the `server-only` import
 * above, and transitively via `serverEnv` (src/core/config/env.server.ts),
 * which carries its own `server-only` guard. Either one independently
 * fails the build if a Client Component imports this file.
 *
 * Named `createAdminClient` (not `createClient`) deliberately — distinct
 * from the exports of client.ts/server.ts so autocomplete/copy-paste
 * cannot easily substitute this for the RLS-respecting client by mistake.
 *
 * Module-level singleton: unlike server.ts, this client carries no
 * per-request user session to isolate, so a single shared instance is
 * safe and avoids re-establishing a connection on every call.
 *
 * Usage (server-only contexts — Route Handlers, Server Actions, jobs):
 *   import { createAdminClient } from '@/core/supabase/admin';
 *   const supabase = createAdminClient();
 */
function buildAdminClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // No browser session exists in this context — the service role
        // key itself is the credential on every request, so there is
        // nothing to auto-refresh or persist.
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

let cachedAdminClient: ReturnType<typeof buildAdminClient> | undefined;

export function createAdminClient() {
  if (!cachedAdminClient) {
    cachedAdminClient = buildAdminClient();
  }

  return cachedAdminClient;
}
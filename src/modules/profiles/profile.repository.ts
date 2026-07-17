import { BaseRepository } from '@/core/repositories/base.repository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/core/supabase/database.types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

/**
 * ProfileRepository
 * ------------------
 * Typed data access for the `profiles` table. Inherits findById,
 * findByIdOrThrow, findMany, count, create, update, delete from
 * BaseRepository (File 22) -- no additional query methods are needed yet.
 *
 * Deliberately has no findByEmail() or similar: `profiles` does not store
 * email (that lives on auth.users, accessible only via
 * src/core/supabase/admin.ts). A method querying a column that doesn't
 * exist on this table doesn't belong here.
 *
 * As with every BaseRepository subclass, the caller decides which
 * SupabaseClient to inject -- server.ts (RLS-respecting, the default for
 * anything acting on behalf of a logged-in user) or admin.ts (RLS-bypassing,
 * for background jobs / webhooks only). This class has no opinion on that;
 * see src/core/supabase/server.ts and admin.ts for the tradeoffs of each.
 */
export class ProfileRepository extends BaseRepository<
  'profiles',
  ProfileRow,
  ProfileInsert,
  ProfileUpdate
> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'profiles');
  }
}
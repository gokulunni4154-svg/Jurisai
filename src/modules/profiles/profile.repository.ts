import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
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
 * BaseRepository (File 22).
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
 *
 * NEW — added for the Observability module (Phase 3). No parseRow() is
 * needed here, unlike every module-result repository (risk_detections,
 * ai_legal_insights, etc.) — `profiles` has no jsonb `result` column
 * requiring schema validation, so rows are returned as the plain
 * generated ProfileRow type, same as DocumentRepository's plain-Row
 * methods.
 *
 * CONFIRMED against the real `database.types.ts`, re-pasted and read this
 * session: `profiles.firm_id` is `string | null`, with a real FK
 * (`profiles_firm_id_fkey`) to `firms.id`. Nullability doesn't affect
 * this method's signature — `findByFirmId` takes a known, non-null
 * `firmId` string to filter by; rows simply won't match if their own
 * `firm_id` happens to be null.
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

  /**
   * Returns every profile belonging to a given firm (the full firm
   * roster, not just its owner) — needed by the Observability module's
   * firm-scoped query path: the first of the four sequential hops
   * (profiles -> owner ids -> documents -> document_analyses -> each
   * module repo) since `documents.owner_id` has no FK to `profiles.id`
   * and so cannot be embedded in one Postgrest call.
   *
   * Custom query, not base findMany() — findMany() only supports
   * offset/limit, with no filtering. Plain `.eq('firm_id', ...)`, no
   * ordering imposed (none specified for this use case) — same shape as
   * ChatConversationRepository#findManyForUser and
   * DocumentRepository's plain-Row query methods: inline DatabaseError
   * wrapping, no parseRow.
   *
   * firm-scoping here is a query concern only, not an authorization
   * decision — the Service layer is responsible for confirming the
   * calling admin/firm-owner is entitled to this firmId before ever
   * calling this method, same division of responsibility as every
   * other findManyFor*-style method in this project.
   */
  async findByFirmId(firmId: string): Promise<ProfileRow[]> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('firm_id', firmId);

    if (error) {
      throw new DatabaseError('Failed to list profiles by firm_id', error, {
        table: this.tableName,
        firmId,
      });
    }

    return (data ?? []) as ProfileRow[];
  }

  /**
   * NEW — Admin Tooling, User & Org Management module.
   *
   * Paginated, optionally-searched listing of every profile on the
   * platform, for the admin "view users" page. A custom method rather
   * than the inherited findMany()/count(), for the same reason
   * findByFirmId() above is custom: findMany()'s own exact signature has
   * never been independently pasted this session, and this method needs
   * filtering (search) that findByFirmId()'s own doc comment already
   * confirms findMany() doesn't support. Self-contained, per the Source
   * Verification Rule, rather than drafted against an inferred base-class
   * shape.
   *
   * Returns both the page of rows AND a total count in one round trip
   * (`{ count: 'exact' }`), so the admin page can render "Page 2 of 14"
   * -style pagination without a second query — same reasoning
   * DocumentRepository's own paginated methods use, per that module's
   * established convention.
   *
   * FLAGGED ASSUMPTIONS — new decisions this method, no direct prior
   * precedent in this file:
   *   1. `search` matches against `full_name` OR `phone` via `.or()` with
   *      `ilike` (case-insensitive substring). `profiles` has no email
   *      column (see class-level doc comment) — email search, if wanted,
   *      would need to go through auth.users via admin.ts instead, out of
   *      scope for a `profiles`-table-only repository method.
   *   2. Default ordering is `created_at desc` (newest accounts first) —
   *      no ordering convention exists elsewhere in this repository to
   *      match; a genuinely new, flagged choice, not inferred from
   *      anywhere.
   *   3. `search` is optional and, when omitted, the method returns every
   *      profile page-by-page with no filter — the admin page's own
   *      "browse all users" default state.
   *
   * AUTHORIZATION IS NOT THIS METHOD'S CONCERN, same division of
   * responsibility findByFirmId() already documents — the Service layer
   * calling this must itself have already confirmed the caller holds
   * 'admin' or 'support' before this is ever invoked. This table's own
   * RLS has no policy permitting a client-scoped read of every profile
   * (only own-row, or admin/support via the widened
   * profiles_select_admin policy) — so in practice this method should
   * only ever be called with the admin.ts service-role client, or the
   * RLS-scoped client of an already-confirmed admin/support user.
   */
  async findAllForAdmin(options: {
    readonly limit: number;
    readonly offset: number;
    readonly search?: string;
  }): Promise<{ readonly rows: ProfileRow[]; readonly total: number }> {
    let query = this.supabase
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(options.offset, options.offset + options.limit - 1);

    if (options.search) {
      const term = `%${options.search}%`;
      query = query.or(`full_name.ilike.${term},phone.ilike.${term}`);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new DatabaseError('Failed to list profiles for admin', error, {
        table: this.tableName,
        limit: options.limit,
        offset: options.offset,
        search: options.search,
      });
    }

    return {
      rows: (data ?? []) as ProfileRow[],
      total: count ?? 0,
    };
  }
}
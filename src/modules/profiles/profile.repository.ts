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
   *
   * FLAGGED, CARRIED FROM 20260804000000_support_multi_firm_membership.sql
   * (that migration's own assumption #3, confirmed via its pasted
   * source): post-multi-firm, profiles.firm_id is a PRIMARY-firm pointer
   * only, not the full membership record. This method now returns
   * profiles whose PRIMARY firm is firmId — NOT the full roster (that's
   * FirmMemberRepository#findByFirmId(), unaffected). Any caller
   * treating this method's result as "everyone in this firm" will
   * undercount non-primary members. Not fixed here — that migration's
   * own note says Observability's own pass hasn't happened yet, and
   * this session's Org/Firm Settings work does NOT use this method for
   * roster purposes (uses findByIds() below instead, against
   * firm_members' own profile_id list, which is unaffected by this
   * gap).
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
   * NEW — Org/Firm Settings. Batch lookup by id, for enriching a firm's
   * member roster (firm_members rows only carry profile_id, no name)
   * without an N+1 query per member. No existing method on this
   * repository fetches multiple profiles by an array of ids —
   * findByFirmId() above filters by (and is scoped to the caveats of)
   * profiles.firm_id, findAllForAdmin() below is paginated/admin-gated,
   * neither fits this need.
   *
   * Plain `.in('id', ids)`, no ordering imposed — caller
   * (FirmService#getFirmMembersWithProfiles()) matches rows back to
   * their firm_members row by id itself, same division of
   * responsibility findByFirmId()'s own doc comment establishes for
   * firm-scoping being a query concern, not an authorization one.
   *
   * Returns an empty array for an empty input without querying —
   * `.in('id', [])` is a valid but wasteful round trip for a firm with
   * zero members, which getFirmMembersWithProfiles() will hit on every
   * call for a brand-new firm.
   */
  async findByIds(ids: readonly string[]): Promise<ProfileRow[]> {
    if (ids.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase.from('profiles').select('*').in('id', ids);

    if (error) {
      throw new DatabaseError('Failed to find profiles by ids', error, {
        table: this.tableName,
        ids,
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
   *
   * NOT REUSABLE for Org/Firm Settings' add-member search, even though
   * it does support name search: this method is admin/support-gated by
   * design (RLS has no policy for a firm owner/admin to read arbitrary
   * profiles), and would return every profile on the platform rather
   * than profiles relevant to one firm. Confirmed real limitation, not
   * fixed by this session's work — see FirmService's own class-level
   * doc comment for where this is flagged as a standing gap.
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
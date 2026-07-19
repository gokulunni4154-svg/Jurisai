import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';

type TableName = keyof Database['public']['Tables'];

export interface FindManyOptions {
  limit?: number;
  offset?: number;
}

/**
 * Abstract base for all entity repositories (Users, Documents,
 * Appointments, etc. — none built yet).
 *
 * SCHEMA CONVENTION this class assumes and establishes: every table has a
 * `string` (UUID) primary key column named `id`. Every future migration
 * should follow this convention so the generic methods below work
 * uniformly across all entities.
 *
 * Generic over the table name (`T extends keyof Database['public']['Tables']`)
 * so it compiles correctly today, against the currently-empty generated
 * types (src/core/supabase/database.types.ts), and becomes fully
 * type-checked — real Row/Insert/Update shapes, column autocomplete — the
 * moment that file is regenerated with real schema.
 *
 * Concrete repositories inject whichever Supabase client is appropriate
 * for their use case (RLS-respecting src/core/supabase/server.ts, or
 * RLS-bypassing src/core/supabase/admin.ts) via the constructor, rather
 * than this class creating its own — the RLS-vs-bypass decision stays
 * visible at the call site that constructs the repository, not hidden
 * inside it.
 *
 * Every Postgrest error is caught and re-thrown as DatabaseError (never a
 * raw Supabase error), so services and Route Handlers only ever deal with
 * our own AppError hierarchy.
 *
 * ARCHITECTURE DECISION, SETTLED THIS SESSION — NO TRANSACTION PRIMITIVE,
 * ACCEPTED PERMANENTLY, NOT A GAP TO RE-FLAG PER FILE:
 *
 * This class has no transaction primitive, and one is deliberately NOT
 * planned. Every method here goes through supabase-js/PostgREST, where
 * each call (`.insert()`, `.update()`, etc.) is its own independent HTTP
 * request — PostgREST has no client-side "begin/commit across several
 * calls" concept. The only way to get real atomicity across multiple
 * writes is a hand-written Postgres function (plpgsql) invoked via
 * `.rpc()` — that is not a generic, reusable addition to this base
 * class; it would be a bespoke SQL function per multi-step operation
 * that needs one, each requiring its own migration and its own real-
 * source verification, same as every other piece of SQL in this project.
 * A shallower fix (e.g. wrapping sequential calls in a try/catch here)
 * would not add real atomicity — it would just as easily hide the risk
 * as document it, which is worse than the current, honest state.
 *
 * PRACTICAL IMPLICATION: several Service-layer methods across this
 * project (e.g. FirmService#createFirm's firm-insert + profile-update +
 * audit-write; NotificationService#createNotification's insert +
 * audit-write) perform multiple independent writes with no rollback. If
 * a later write in the sequence fails, earlier writes in that same
 * sequence are NOT undone — this can leave data in an inconsistent-but-
 * recoverable state (e.g. a firm created with no matching audit entry),
 * never a corrupted one, since each individual write is still atomic on
 * its own. This is treated as a known, accepted characteristic of this
 * architecture, not an outstanding bug — flag any NEW instance in the
 * Service method's own doc comment (as existing ones already do) rather
 * than re-litigating whether to fix it generally each time. If a
 * specific operation later turns out to need real atomicity badly
 * enough to justify a dedicated Postgres function, that is a case-by-
 * case decision made for that operation specifically, not a general
 * pattern applied here.
 *
 * Example future usage (once a `users` table + migration exists):
 *
 *   export class UserRepository extends BaseRepository<'users'> {
 *     constructor(supabase: SupabaseClient<Database>) {
 *       super(supabase, 'users');
 *     }
 *   }
 */
export abstract class BaseRepository<
  T extends TableName,
  Row = Database['public']['Tables'][T]['Row'],
  Insert = Database['public']['Tables'][T]['Insert'],
  Update = Database['public']['Tables'][T]['Update'],
> {
  protected constructor(
    protected readonly supabase: SupabaseClient<Database>,
    protected readonly tableName: T,
  ) {}

  /**
   * Finds a single row by id. Returns `null` if not found — use
   * `findByIdOrThrow` if a missing row should short-circuit as an error
   * instead of requiring the caller to null-check.
   */
  async findById(id: string): Promise<Row | null> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        `Failed to find ${String(this.tableName)} by id`,
        error,
        { table: this.tableName, id },
      );
    }

    return data as Row | null;
  }

  /**
   * Same as `findById`, but throws `NotFoundError` (File 10) instead of
   * returning `null` when no row matches.
   */
  async findByIdOrThrow(id: string): Promise<Row> {
    const row = await this.findById(id);

    if (!row) {
      throw new NotFoundError(String(this.tableName), id);
    }

    return row;
  }

  /**
   * Lists rows with optional offset/limit pagination. Callers needing
   * filtering beyond pagination should build a query in a concrete
   * repository method and reuse `wrapQueryError` (protected below)
   * rather than extending this method's signature indefinitely.
   */
  async findMany(options?: FindManyOptions): Promise<Row[]> {
    let query = this.supabase.from(this.tableName).select('*');

    if (options?.limit != null) {
      const from = options.offset ?? 0;
      const to = from + options.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;

    if (error) {
      throw new DatabaseError(`Failed to list ${String(this.tableName)}`, error, {
        table: this.tableName,
        options,
      });
    }

    return (data ?? []) as Row[];
  }

  /**
   * Returns the total row count for this table (ignoring pagination),
   * for building pagination UI (e.g. "Page 2 of 14"). Included in the
   * base class ahead of need — near-certain to be required by the
   * Lawyer Marketplace, Admin Panel, and Audit Log modules on the
   * roadmap, all of which are paginated list views.
   */
  async count(): Promise<number> {
    const { count, error } = await this.supabase
      .from(this.tableName)
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new DatabaseError(`Failed to count ${String(this.tableName)}`, error, {
        table: this.tableName,
      });
    }

    return count ?? 0;
  }

  /**
   * Creates a row and returns it.
   *
   * The `as never` cast below is a known, narrow TypeScript/Postgrest-js
   * limitation: when the table name is a generic type parameter (`T`)
   * rather than a string literal, `.insert()`'s overload resolution can't
   * narrow to that specific table's Insert type the way it can for a
   * literal call like `.from('users').insert(...)`. The cast is confined
   * to this one call; the method's public signature remains fully typed
   * (`Insert` in, `Row` out) — callers get full type safety regardless.
   */
  async create(input: Insert): Promise<Row> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .insert(input as never)
      .select('*')
      .single();

    if (error) {
      throw new DatabaseError(`Failed to create ${String(this.tableName)}`, error, {
        table: this.tableName,
      });
    }

    return data as Row;
  }

  /**
   * Updates a row by id and returns the updated row. Same `as never`
   * rationale as `create` above.
   */
  async update(id: string, input: Update): Promise<Row> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .update(input as never)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new DatabaseError(`Failed to update ${String(this.tableName)}`, error, {
        table: this.tableName,
        id,
      });
    }

    return data as Row;
  }

  /**
   * Deletes a row by id. Concrete repositories for entities requiring
   * soft-delete (e.g. Documents, for audit-trail reasons) should override
   * this rather than use it directly.
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from(this.tableName).delete().eq('id', id);

    if (error) {
      throw new DatabaseError(`Failed to delete ${String(this.tableName)}`, error, {
        table: this.tableName,
        id,
      });
    }
  }
}
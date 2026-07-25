import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';

/**
 * Repository for `tasks`. Extends BaseRepository<'tasks'> per its real,
 * confirmed shape (src/core/repositories/base.repository.ts, pasted this
 * session): generic over the table-name literal, Row/Insert/Update
 * derived automatically from the generated Database type, constructor
 * takes (supabase, tableName) and is PROTECTED on the base class — this
 * subclass's own constructor is the public entry point.
 *
 * CORRECTION FROM THE PRIOR DRAFT OF THIS FILE (never saved/shared,
 * caught before it shipped): the earlier version invented
 * `this.table`, wrote its own `findByIdOrThrow` that threw a
 * `NotFoundError` directly, and left `create`/`update`/`delete` as
 * hand-rolled overrides. All of that already exists on BaseRepository —
 * `findByIdOrThrow` is inherited as-is (it internally calls `findById`,
 * then throws `NotFoundError` itself if null), and `create`/`update`/
 * `delete` are inherited unmodified. This file now ONLY adds the
 * query shapes the base class doesn't provide: case-scoped listing,
 * standalone(firm)-scoped listing, and assignee-scoped listing.
 *
 * RLS-scoped client (not admin) — unlike case-access-grant.repository.ts
 * or firm-member.repository.ts, `tasks` DOES have client-writable RLS
 * policies (see 20260814000000_create_tasks_table.sql), so there is no
 * admin-client-only posture here, matching case.repository.ts's own
 * RLS-client choice for `cases`/`case_documents`.
 *
 * Every custom query below wraps its Postgrest error in DatabaseError,
 * matching the base class's own convention exactly (table + relevant
 * filter args passed as `context`, for server-side-only logging).
 */
export class TaskRepository extends BaseRepository<'tasks'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'tasks');
  }

  /**
   * All tasks on a given case, most recent first. The primary "tasks on
   * this case" view — RLS on the underlying table already restricts
   * this to rows the caller's session can see (case owner, active
   * grantee, or the task's own assignee); this method does not
   * independently re-check access, per this project's established
   * "RLS is the backstop, repositories trust the session" convention
   * (case.repository.ts, case-access-grant.repository.ts).
   */
  async findByCaseId(caseId: string): Promise<Database['public']['Tables']['tasks']['Row'][]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(`Failed to list tasks for case`, error, {
        table: this.tableName,
        caseId,
      });
    }

    return data ?? [];
  }

  /**
   * Standalone (case_id null) tasks for a firm — the firm-wide to-do
   * list, not tied to any case.
   */
  async findStandaloneByFirmId(
    firmId: string,
  ): Promise<Database['public']['Tables']['tasks']['Row'][]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('firm_id', firmId)
      .is('case_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(`Failed to list standalone tasks for firm`, error, {
        table: this.tableName,
        firmId,
      });
    }

    return data ?? [];
  }

  /**
   * "My tasks" — everything assigned to a given profile, across cases
   * and standalone alike, soonest due date first (nulls last). Mirrors
   * listMyCases()'s self-scoped shape from the Case Access Grants
   * module.
   */
  async findByAssigneeProfileId(
    profileId: string,
  ): Promise<Database['public']['Tables']['tasks']['Row'][]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('assignee_profile_id', profileId)
      .order('due_date', { ascending: true, nullsFirst: false });

    if (error) {
      throw new DatabaseError(`Failed to list tasks for assignee`, error, {
        table: this.tableName,
        profileId,
      });
    }

    return data ?? [];
  }
}
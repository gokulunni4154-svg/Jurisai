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
 * standalone(firm)-scoped listing, assignee-scoped listing, and (new
 * this session) full firm-scoped listing.
 *
 * RLS-scoped client (not admin) — unlike case-access-grant.repository.ts
 * or firm-member.repository.ts, `tasks` DOES have client-writable RLS
 * policies (see 20260814000000_create_tasks_table.sql), so there is no
 * admin-client-only posture here, matching case.repository.ts's own
 * RLS-client choice for `cases`/`case_documents` -- WITH ONE NAMED
 * EXCEPTION, same as that file: findByFirmId() below, added for the
 * Firm Dashboard (Phase 4, this session), is intended to be called only
 * from an instance constructed against the admin client. See that
 * method's own doc comment for the full reasoning.
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

  /**
   * NEW, Phase 4 — Firm Dashboard. Every task belonging to a firm,
   * case-linked AND standalone alike (unlike findStandaloneByFirmId()
   * above, which deliberately excludes case-linked tasks) — most
   * recent first, same ordering convention as findByCaseId().
   *
   * FLAGGED, NEW DECISION — same posture as
   * case.repository.ts#findByFirmId(): tasks' RLS policies were not
   * independently re-confirmed this session for a firm-wide,
   * cross-member query shape (only findByCaseId()'s own header comment
   * claims RLS already restricts appropriately for case-scoped reads;
   * that claim was never made for a bare firm-wide query, and no RLS
   * SQL for `tasks` was pasted this session to verify one way or
   * the other). This method is intended to be called ONLY from a
   * repository instance constructed against the ADMIN client (see
   * firm-dashboard.factory.ts), with authorization enforced entirely
   * at the Service layer (FirmDashboardService's own
   * requireManageAccess(firmId) gate), not by RLS. This repository
   * itself does not know or care which client it was built with; but
   * this method returns every task row for the firm, full stop, if
   * called against an RLS-scoped client with a session that happens to
   * bypass narrower RLS predicates on other columns.
   */
  async findByFirmId(firmId: string): Promise<Database['public']['Tables']['tasks']['Row'][]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(`Failed to list tasks for firm`, error, {
        table: this.tableName,
        firmId,
      });
    }

    return data ?? [];
  }
}
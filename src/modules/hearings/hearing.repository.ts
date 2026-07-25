// Real path: src/modules/hearings/hearing.repository.ts
//
// Mirrors task.repository.ts's confirmed real, corrected shape exactly:
// extends BaseRepository<'hearings'> and adds ONLY the query shapes the
// base class doesn't provide (findByIdOrThrow/create/update/delete all
// inherited unmodified). RLS-scoped client (not admin) -- hearings has
// real client-writable RLS policies (hearings_select/insert/update/
// delete), same reasoning as TaskRepository's own RLS-client choice --
// WITH ONE NAMED EXCEPTION, same as case.repository.ts and
// task.repository.ts's own new methods this session:
// findUpcomingByFirmId() below, added for the Firm Dashboard (Phase 4,
// this session), is intended to be called only from an instance
// constructed against the admin client. See that method's own doc
// comment for the full reasoning.
//
// NOT independently cross-checked against document.repository.ts's
// findDueForHearingReminder(): that file was in this session's upload
// batch but its content never actually came through (same silent-drop
// failure mode as the recurring database.types.ts issue) -- flagged,
// not silently assumed. findDueForReminder() below is this repository's
// own construction against hearings' real schema (hearings_reminder_pending_idx),
// not a re-verified copy of that method's real query shape. Revisit if
// document.repository.ts is ever successfully re-pasted and its real
// method differs meaningfully.

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';

type HearingRow = Database['public']['Tables']['hearings']['Row'];

export class HearingRepository extends BaseRepository<'hearings'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'hearings');
  }

  /**
   * All hearings on a given case, soonest first. RLS on the underlying
   * table already restricts this to rows the caller's session can see
   * (case owner or active grantee) -- this method does not
   * independently re-check access, matching TaskRepository#findByCaseId's
   * "RLS is the backstop" posture.
   */
  async findByCaseId(caseId: string): Promise<HearingRow[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('case_id', caseId)
      .order('hearing_date', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list hearings for case', error, {
        table: this.tableName,
        caseId,
      });
    }

    return data ?? [];
  }

  /**
   * Every upcoming hearing visible to the caller's session, across all
   * cases -- the query the calendar/"upcoming hearings" view needs.
   * Unlike tasks' findByAssigneeProfileId, there is no per-user
   * assignee column on hearings (see migration header) -- "my
   * hearings" for a caller is simply "every hearing RLS lets me see,
   * filtered to the future", not a distinct owned-by-me set. `fromDate`
   * defaults to now() at the call site (Service layer), not here, same
   * "repository doesn't own business defaults" posture as elsewhere in
   * this project.
   */
  async findUpcoming(fromDate: string): Promise<HearingRow[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .gte('hearing_date', fromDate)
      .order('hearing_date', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list upcoming hearings', error, {
        table: this.tableName,
        fromDate,
      });
    }

    return data ?? [];
  }

  /**
   * NEW, Phase 4 — Firm Dashboard. Every upcoming hearing (hearing_date
   * >= fromDate) for a given firm, soonest first -- the firm-wide
   * counterpart to findUpcoming() above, which is session-RLS-scoped
   * rather than firm-scoped. `fromDate` is still passed in from the
   * Service layer, not defaulted here, same "repository doesn't own
   * business defaults" posture as findUpcoming() itself.
   *
   * FLAGGED, NEW DECISION — same posture as
   * case.repository.ts#findByFirmId() and
   * task.repository.ts#findByFirmId(): hearings' RLS policies were not
   * independently re-confirmed this session for a firm-wide,
   * cross-member query shape. This method is intended to be called
   * ONLY from a repository instance constructed against the ADMIN
   * client (see firm-dashboard.factory.ts), with authorization
   * enforced entirely at the Service layer (FirmDashboardService's own
   * requireManageAccess(firmId) gate), not by RLS.
   */
  async findUpcomingByFirmId(firmId: string, fromDate: string): Promise<HearingRow[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .eq('firm_id', firmId)
      .gte('hearing_date', fromDate)
      .order('hearing_date', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list upcoming hearings for firm', error, {
        table: this.tableName,
        firmId,
        fromDate,
      });
    }

    return data ?? [];
  }

  /**
   * Hearings due for a reminder: hearing_date within [now, windowEnd],
   * reminder_sent_at still null. Runs under the admin.ts service-role
   * client from the cron route (no requesting user in scope, same
   * posture as NotificationRepository#reminderAlreadySent) -- NOT
   * RLS-narrowed, so this returns every matching row platform-wide, not
   * just one caller's session. FLAGGED: this method's shape is this
   * repository's own construction, not cross-checked against
   * document.repository.ts's real findDueForHearingReminder() -- see
   * this file's header comment.
   */
  async findDueForReminder(fromDate: string, windowEnd: string): Promise<HearingRow[]> {
    const { data, error } = await this.supabase
      .from(this.tableName)
      .select('*')
      .gte('hearing_date', fromDate)
      .lte('hearing_date', windowEnd)
      .is('reminder_sent_at', null)
      .order('hearing_date', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list hearings due for reminder', error, {
        table: this.tableName,
        fromDate,
        windowEnd,
      });
    }

    return data ?? [];
  }

  /**
   * Marks a hearing's reminder as sent. Deliberately a narrow, single-
   * column update rather than routing through the generic inherited
   * update() from the cron route -- keeps the cron's intent
   * ("I sent this reminder") explicit at the call site, same reasoning
   * NotificationRepository#markAsRead() gives for its own narrow
   * wrapper over a generic update.
   */
  async markReminderSent(hearingId: string): Promise<void> {
    const { error } = await this.supabase
      .from(this.tableName)
      .update({ reminder_sent_at: new Date().toISOString() } as never)
      .eq('id', hearingId);

    if (error) {
      throw new DatabaseError('Failed to mark hearing reminder sent', error, {
        table: this.tableName,
        hearingId,
      });
    }
  }
}
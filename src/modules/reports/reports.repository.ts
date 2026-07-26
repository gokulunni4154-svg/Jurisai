// src/modules/reports/reports.repository.ts
// Reports & Analytics — Phase 4. New module, new repository.
//
// SOURCE VERIFICATION NOTE: built directly against this session's real,
// pasted source — 20260808000000_create_case_access_grants.sql (cases),
// 20260904000000_create_hearings_table.sql (hearings),
// 20260814000000_create-tasks-table.sql (tasks),
// 20260726000000_create_billing_tables.sql +
// 20260726000003_add_firm_billing_support.sql +
// 20260726000004_add_cancelled_card_expired_status.sql (subscriptions/
// plans), and database.types.ts (exact Row shapes, confirmed this
// session despite arriving under a mismatched filename — flagged to the
// user separately). Every method below queries a real, confirmed column
// set. No repository file for cases/hearings/tasks/subscriptions was
// pasted this session — only their migrations and database.types.ts —
// so this file does NOT extend or call into CaseRepository/
// HearingRepository/TaskRepository/SubscriptionRepository; it queries
// the underlying tables directly. If those repositories already have
// firm-scoped query methods this duplicates, that's a real overlap to
// reconcile once they're pasted — not assumed away here.
//
// ARCHITECTURAL DEPARTURE, FLAGGED: every other repository in this
// project (CaseRepository, FirmRepository, AuditLogRepository, etc.)
// extends BaseRepository and is scoped to exactly one table
// (base.repository.ts's own confirmed shape: tableName is a single
// protected readonly string). A firm dashboard inherently spans four
// tables (cases, hearings, tasks, subscriptions) with no single-table
// fit — this class deliberately does NOT extend BaseRepository. This is
// a new shape for this project's repository layer, not a small
// variation on an existing one.
//
// CLIENT CHOICE, FLAGGED: uses the ADMIN client (RLS-bypassing), not the
// RLS-respecting server client. Precedent: AuditLogRepository "always
// uses admin client, injected directly into Services, never via a
// wrapper Service" (project-wide settled architecture) — chosen for the
// same reason here. subscriptions' own real RLS
// (subscriptions_select_firm_owner) only grants the firm OWNER read
// access; an admin/owner firm-dashboard viewer who is an admin but not
// the owner would be silently locked out of revenue data under RLS.
// Authorization is instead enforced entirely at the Service layer
// (ReportsService, next file), mirroring AuditLogRepository's own
// division of responsibility exactly.
//
// AGGREGATION APPROACH, FLAGGED: status counts (cases, tasks) are
// computed by fetching the filtered rows and reducing in application
// code, NOT a Postgres GROUP BY / count(*) RPC. database.types.ts's
// confirmed `Functions` block lists exactly one function
// (find_auth_user_id_by_email) — no aggregate/count RPC exists in
// pasted source to call instead. This is the safe default given that,
// not a performance judgment — revisit if firm-scale row counts make
// this expensive; a dedicated Postgres function would be the fix, not
// decided here.

import 'server-only';

import { createAdminClient } from '@/core/supabase/admin';
import type { Database } from '@/core/supabase/database.types';

type CaseStatus = Database['public']['Tables']['cases']['Row']['status'];
type TaskStatus = Database['public']['Tables']['tasks']['Row']['status'];
type HearingRow = Database['public']['Tables']['hearings']['Row'];
type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];
type PlanRow = Database['public']['Tables']['plans']['Row'];

/**
 * Non-terminal subscription statuses. Copied directly from the real,
 * confirmed partial-unique-index list in
 * 20260726000004_add_cancelled_card_expired_status.sql
 * (subscriptions_one_active_per_firm / _per_profile) — NOT re-derived.
 * If that list changes in a future migration, this constant goes stale
 * along with it; there is no single shared source for it in pasted
 * source today (each migration that touches subscriptions.status
 * redeclares its own copy of the partial index).
 */
const NON_TERMINAL_SUBSCRIPTION_STATUSES = [
  'INITIALIZED',
  'ACTIVE',
  'ON_HOLD',
  'CUSTOMER_PAUSED',
  'BANK_APPROVAL_PENDING',
] as const;

export interface CaseStatusCounts {
  total: number;
  byStatus: Record<string, number>;
}

export interface TaskStatusCounts {
  total: number;
  byStatus: Record<string, number>;
}

export interface FirmSubscriptionSummary {
  subscription: SubscriptionRow;
  plan: PlanRow;
}

export class ReportsRepository {
  private readonly supabase = createAdminClient();

  /**
   * Case counts for a firm, grouped by status. Includes every real
   * status value from cases_status_check (open/pending/on_hold/closed/
   * won/lost/settled/withdrawn) that has at least one row — statuses
   * with zero cases are simply absent from byStatus, not zero-filled,
   * since the real CHECK constraint's full value list isn't
   * independently re-exported anywhere in pasted source for this file
   * to import and zero-fill against.
   */
  async getCaseStatusCounts(firmId: string): Promise<CaseStatusCounts> {
    const { data, error } = await this.supabase
      .from('cases')
      .select('status')
      .eq('firm_id', firmId);

    if (error) throw error;

    const byStatus: Record<string, number> = {};
    for (const row of data ?? []) {
      const status = row.status as CaseStatus;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }

    return { total: data?.length ?? 0, byStatus };
  }

  /**
   * Task counts for a firm, grouped by status (todo/in_progress/done).
   * Includes both case-linked and standalone (case_id null) tasks —
   * tasks.firm_id is denormalized onto every row regardless of case
   * linkage (confirmed via 20260814000000_create-tasks-table.sql), so a
   * single firm_id filter covers both.
   */
  async getTaskStatusCounts(firmId: string): Promise<TaskStatusCounts> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('status')
      .eq('firm_id', firmId);

    if (error) throw error;

    const byStatus: Record<string, number> = {};
    for (const row of data ?? []) {
      const status = row.status as TaskStatus;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }

    return { total: data?.length ?? 0, byStatus };
  }

  /**
   * Upcoming hearings for a firm — hearing_date in the future, ordered
   * soonest-first, capped at `limit`. Does NOT filter on
   * reminder_sent_at (that column is a cron-dedup marker, unrelated to
   * dashboard display — confirmed via that column's own comment in
   * 20260904000000_create_hearings_table.sql).
   */
  async getUpcomingHearings(firmId: string, limit = 5): Promise<HearingRow[]> {
    const { data, error } = await this.supabase
      .from('hearings')
      .select('*')
      .eq('firm_id', firmId)
      .gte('hearing_date', new Date().toISOString())
      .order('hearing_date', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  }

  /**
   * The firm's current non-terminal subscription, joined with its plan.
   * Returns null if the firm has no active/in-progress subscription —
   * a normal state (e.g. plans table has never been seeded this
   * project, per PROJECT_PROGRESS — this will return null in every real
   * environment today, not an error). Mirrors FirmService#getMyFirm()'s
   * own "null is a normal state, not a NotFoundError" convention.
   *
   * FLAGGED, NOT INDEPENDENTLY VERIFIED: assumes at most one row can
   * match (relies on subscriptions_one_active_per_firm's real partial
   * unique index to guarantee this) rather than defensively handling
   * multiple rows. If that index were ever dropped or bypassed via the
   * admin client elsewhere, this method would silently return an
   * arbitrary one of several matching rows (Postgres' unspecified
   * ordering for .limit(1) without an explicit order()) rather than
   * erroring.
   */
  async getActiveSubscription(firmId: string): Promise<FirmSubscriptionSummary | null> {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*, plans(*)')
      .eq('firm_id', firmId)
      .in('status', NON_TERMINAL_SUBSCRIPTION_STATUSES)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const { plans, ...subscription } = data as SubscriptionRow & { plans: PlanRow };
    return { subscription: subscription as SubscriptionRow, plan: plans };
  }
}
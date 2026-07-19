// src/modules/audit-log/audit-log.repository.ts
// File number not yet assigned — see PROJECT_PROGRESS.md's running list
// of unnumbered files (Phase 3 numbering: this is Phase 3 File 7,
// amended again this session as File 29, amended again this session as
// the file resuming Phase 3 numbering for the "no total count" fix).
//
// Path corrected a prior session: originally drafted at
// src/core/repositories/audit-log.repository.ts, which was a wrong
// assumption. Confirmed via real cashfree.service.ts source that
// module-specific files live flat under src/modules/<module>/, not
// under src/core/repositories or src/core/services — moved to match.
//
// FLAGGED — the import path for BaseRepository below
// (@/core/repositories/base.repository) is still NOT independently
// confirmed. base.repository.ts's real pasted source did not include its
// own file path, and cashfree.service.ts (which doesn't extend
// BaseRepository or BaseService) doesn't reveal it either. Kept as the
// most likely path given the project's other confirmed @/core/... paths
// (@/core/errors/app-error, @/core/config/env.server) — correct if wrong.
//
// AMENDED, A PRIOR SESSION — closed the "no pagination/filter ceiling"
// open item. Two real gaps existed, both fixed:
//   1. UNBOUNDED READ, THE ACTUAL BUG: when `filter.limit` was omitted
//      entirely, the old code skipped `.range()` altogether and
//      returned every matching row with no limit at all — not just "no
//      ceiling on an explicit value," but no ceiling by default. Fixed
//      by always applying a range: DEFAULT_LIMIT when the caller
//      supplies none, clamped to MAX_LIMIT either way.
//   2. NO WHOLE-NAMESPACE FILTER: `actionPrefix` added as a new,
//      separate filter field (Postgres LIKE), distinct from the
//      existing exact-match `action` field.
// Both MAX_LIMIT (100) and DEFAULT_LIMIT (50) are arbitrary numbers,
// not discussed anywhere in any pasted source — flag if a different
// ceiling/default is wanted.
//
// AMENDED, THIS SESSION — closes pending item #3 ("no total count").
// findByFilter()'s return shape changes from a bare `AuditLogRow[]` to
// `{ data: AuditLogRow[]; total: number }`. Uses Supabase's own
// `{ count: 'exact' }` query option, which runs a real COUNT(*) against
// the same filtered query (before .range() truncates it) in a single
// round trip — not a second, separate query. `count: 'exact'` was
// chosen over `'planned'`/`'estimated'` because this table's row volume
// doesn't currently justify trading accuracy for the planner-estimate
// speedup those options exist for; revisit if audit_log ever grows
// large enough for an exact count to become a real performance concern.
// CONFIRMED, this session's own only caller of findByFilter is
// audit-log.service.ts's three read methods (getMyAuditLog,
// getFirmAuditLog, getAllAuditLog) — no other file in this module or
// pasted elsewhere in this project calls it directly, so this return-
// shape change has exactly one call site to update, done in that file
// alongside this one.

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { BaseRepository } from '@/core/repositories/base.repository';
import { DatabaseError } from '@/core/errors/app-error';
import type { Database } from '@/core/supabase/database.types';

type AuditLogRow = Database['public']['Tables']['audit_log']['Row'];
type AuditLogActorType = Database['public']['Enums']['audit_log_actor_type'];

/** Hard ceiling on page size — arbitrary, not previously discussed. */
const MAX_LIMIT = 100;

/**
 * Applied when a caller supplies no `limit` at all. Previously, omitting
 * `limit` meant no `.range()` call was made and every matching row was
 * returned — an unbounded read, not just an uncapped one. This default
 * closes that gap; arbitrary number, not previously discussed.
 */
const DEFAULT_LIMIT = 50;

export interface AuditLogFilter {
  actorId?: string;
  /**
   * Exact match on `actor_type` ('user' | 'system' | 'webhook') —
   * distinct from `action`/`actionPrefix` below, which filter on the
   * event name rather than who/what performed it.
   */
  actorType?: AuditLogActorType;
  firmId?: string;
  /**
   * Exact match on `action`, e.g. 'billing.subscription.cancel'.
   * Not a prefix/LIKE filter — see actionPrefix below for whole-
   * namespace matching (e.g. all 'billing.*' events).
   */
  action?: string;
  /**
   * Prefix match on `action` via a Postgres `LIKE` (e.g. 'billing.'
   * matches 'billing.subscription.cancel', 'billing.subscription.checkout',
   * etc). Mutually independent from `action` above — if both are
   * supplied, both conditions apply (an AND), which in practice will
   * usually just mean the caller over-specified; no attempt made here
   * to detect or warn about that, since only AuditLogService's own
   * methods construct this filter and none of them currently pass both
   * at once.
   */
  actionPrefix?: string;
  limit?: number;
  offset?: number;
}

/**
 * NEW, THIS SESSION. Return shape for findByFilter(), replacing a bare
 * AuditLogRow[]. `total` reflects the full count of rows matching the
 * filter BEFORE pagination (limit/offset) is applied — i.e. "how many
 * total events match this filter," not "how many rows came back on this
 * page" (that's just `data.length`).
 */
export interface AuditLogFilterResult {
  data: AuditLogRow[];
  total: number;
}

/**
 * AuditLogRepository
 * -------------------
 * Read/write access to the audit_log table. Uses the RLS-bypassing admin
 * client (per base.repository.ts's documented client-choice pattern) since
 * audit_log has no RLS read policy yet — see the migration's note that
 * read access control is an open, undecided question. Writes always go
 * through this repository server-side; there is no direct client access
 * to this table at all right now.
 */
export class AuditLogRepository extends BaseRepository<'audit_log'> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'audit_log');
  }

  /**
   * Convenience wrapper over the inherited create() for the common case of
   * a user-initiated event, so call sites don't have to spell out
   * actor_type: 'user' every time.
   */
  async recordUserAction(params: {
    actorId: string;
    firmId?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: AuditLogRow['metadata'];
  }): Promise<AuditLogRow> {
    return this.create({
      actor_type: 'user',
      actor_id: params.actorId,
      firm_id: params.firmId ?? null,
      action: params.action,
      resource_type: params.resourceType ?? null,
      resource_id: params.resourceId ?? null,
      metadata: params.metadata ?? {},
    });
  }

  /**
   * Same as recordUserAction, for system-initiated events (e.g. the
   * hearing-reminder cron) where there is no AuthUser behind the action.
   */
  async recordSystemAction(params: {
    action: string;
    firmId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: AuditLogRow['metadata'];
  }): Promise<AuditLogRow> {
    return this.create({
      actor_type: 'system',
      actor_id: null,
      firm_id: params.firmId ?? null,
      action: params.action,
      resource_type: params.resourceType ?? null,
      resource_id: params.resourceId ?? null,
      metadata: params.metadata ?? {},
    });
  }

  /**
   * Same shape as recordSystemAction, for events reported by an external
   * system after the fact (e.g. a Cashfree webhook, once its signature is
   * verified) rather than initiated by this app's own code. Kept as a
   * distinct actor_type from 'system' — so the column doesn't collapse
   * two different facts ("we did this" vs "an external system told us
   * this happened") into one value.
   */
  async recordWebhookAction(params: {
    action: string;
    firmId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: AuditLogRow['metadata'];
  }): Promise<AuditLogRow> {
    return this.create({
      actor_type: 'webhook',
      actor_id: null,
      firm_id: params.firmId ?? null,
      action: params.action,
      resource_type: params.resourceType ?? null,
      resource_id: params.resourceId ?? null,
      metadata: params.metadata ?? {},
    });
  }

  /**
   * Lists audit events matching the given filter, most recent first, and
   * the total count of rows matching that same filter before pagination.
   * Deliberately a bespoke query rather than reusing the inherited
   * findMany() — findMany() has no filtering beyond pagination, and
   * audit_log's whole purpose requires filtering by actor/firm/action.
   *
   * AMENDED, THIS SESSION: return shape changed from a bare
   * `AuditLogRow[]` to `{ data, total }`. `count: 'exact'` runs a real
   * COUNT(*) against the same filtered query in the same round trip,
   * before `.range()` truncates the result set — `total` is always the
   * full matching count, not the page size.
   */
  async findByFilter(filter: AuditLogFilter): Promise<AuditLogFilterResult> {
    let query = this.supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filter.actorId) {
      query = query.eq('actor_id', filter.actorId);
    }
    if (filter.actorType) {
      query = query.eq('actor_type', filter.actorType);
    }
    if (filter.firmId) {
      query = query.eq('firm_id', filter.firmId);
    }
    if (filter.action) {
      query = query.eq('action', filter.action);
    }
    if (filter.actionPrefix) {
      query = query.like('action', `${filter.actionPrefix}%`);
    }

    const requestedLimit = filter.limit ?? DEFAULT_LIMIT;
    const effectiveLimit = Math.min(requestedLimit, MAX_LIMIT);
    const from = filter.offset ?? 0;
    const to = from + effectiveLimit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      throw new DatabaseError('Failed to list audit_log entries', error, { filter });
    }

    return { data: data ?? [], total: count ?? 0 };
  }
}
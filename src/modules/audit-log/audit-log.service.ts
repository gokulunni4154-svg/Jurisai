// src/modules/audit-log/audit-log.service.ts
// File number not yet assigned — see PROJECT_PROGRESS.md's running list
// of unnumbered files (Phase 3 numbering: this is Phase 3 File 8,
// amended again as File 30, amended again this session for the
// "no total count" fix).
//
// Path corrected a prior session: originally drafted at
// src/core/services/audit-log.service.ts, which was a wrong assumption.
// Confirmed via real cashfree.service.ts source that module-specific
// files live flat under src/modules/<module>/, not under
// src/core/repositories or src/core/services — moved to match.
//
// FLAGGED — the import path for BaseService below
// (@/core/services/base.service) is still NOT independently confirmed.
// base.service.ts's real pasted source did not include its own file
// path, and cashfree.service.ts (which deliberately does NOT extend
// BaseService — see its own header note) doesn't reveal it either. Kept
// as the most likely path given the project's other confirmed
// @/core/... paths — correct if wrong.
//
// ARCHITECTURE DECISION (A PRIOR SESSION), FLAGGED EXPLICITLY: read
// access tiers (self / firm-owner / admin) are implemented as
// Service-layer authorization, NOT as new Postgres RLS policies on
// audit_log — AuditLogRepository is architecturally committed to always
// using the admin/service-role client, so a new RLS policy would be
// correct SQL that's never evaluated by any code path. Extends
// getMyAuditLog()'s existing self-only-via-hardcoded-filter pattern.
//
// NEW DEPENDENCY (A PRIOR SESSION) — FirmRepository, for
// getFirmAuditLog()'s ownership check, via the same
// findByIdOrThrow()/requireOwnership() two-call pattern already used in
// billing.service.ts. FirmRepository's own file has not been
// independently pasted; if its real findByIdOrThrow signature differs
// from BaseRepository's standard shape, revisit.
//
// AMENDED, A PRIOR SESSION — closed the "no pagination/filter ceiling"
// open item: getMyAuditLog()/getFirmAuditLog() each gained an optional
// `actionPrefix` param; getAllAuditLog() gained both `actionPrefix` and
// `actorType` (admin-only — the only tier with an obvious real use case
// for slicing by actor type so far).
//
// AMENDED, THIS SESSION — closes pending item #3 ("no total count"),
// on top of audit-log.repository.ts's own amendment to findByFilter()
// (now returns `{ data, total }` instead of a bare array). All three
// read methods below change their return type from `Promise<AuditLogRow[]>`
// to `Promise<{ events: AuditLogRow[]; total: number }>` — named `events`
// rather than `data` at this layer to keep this method's own return
// shape distinct from the repository's, and because "events" reads more
// naturally as this Service's own public contract (routes below already
// wrap the whole thing in their own `{ data }` envelope, so nesting
// `data.data` would be confusing at the route layer). No other change
// to authorization/filtering logic in this file — this amendment is
// purely about surfacing the count that already existed at the
// repository layer.

import 'server-only';

import { BaseService } from '@/core/services/base.service';
import type { AuthUser } from '@/core/auth/types';
import type { AuditLogRepository, AuditLogFilter } from './audit-log.repository';
import type { Database } from '@/core/supabase/database.types';
import type { FirmRepository } from '@/modules/billing/firm.repository';

type AuditLogRow = Database['public']['Tables']['audit_log']['Row'];
type AuditMetadata = AuditLogRow['metadata'];
type AuditLogActorType = Database['public']['Enums']['audit_log_actor_type'];

/**
 * NEW, THIS SESSION. Return shape for all three read methods below,
 * replacing a bare AuditLogRow[]. `total` reflects the full count of
 * events matching the given filter and authorization scope, before
 * pagination — lets callers (routes, then frontend pages) show real
 * "X of Y" pagination instead of inferring "next page exists" from
 * getting back a full page.
 */
export interface AuditLogReadResult {
  events: AuditLogRow[];
  total: number;
}

/**
 * AuditLogService
 * ----------------
 * Thin orchestration layer over AuditLogRepository. Recording an event
 * needs no ownership check (an actor can always report their own
 * action). Reading is three-tiered:
 *   - getMyAuditLog(): any authenticated user, self only.
 *   - getFirmAuditLog(): the firm's owner only — NOT members, matching
 *     this project's existing Billing convention.
 *   - getAllAuditLog(): admin role only, via the inherited requireRole()
 *     guard.
 */
export class AuditLogService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly firmRepository: FirmRepository,
  ) {
    super(currentUser);
  }

  /**
   * Records an event attributed to the current authenticated user. Throws
   * AuthenticationError via requireAuthentication() if called with no
   * user — recording an event always needs a real actor to attribute it
   * to, unlike recordSystemEvent below.
   */
  async recordForCurrentUser(params: {
    action: string;
    firmId?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: AuditMetadata;
  }): Promise<AuditLogRow> {
    const user = this.requireAuthentication();

    return this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: params.firmId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      metadata: params.metadata,
    });
  }

  /**
   * Records a system-initiated event (e.g. the hearing-reminder cron).
   * Deliberately static: system events have no AuthUser to construct this
   * service with in the first place, so requiring an instance here would
   * force call sites to `new AuditLogService(null, repo)` for no benefit.
   */
  static async recordSystemEvent(
    auditLogRepository: AuditLogRepository,
    params: {
      action: string;
      firmId?: string | null;
      resourceType?: string | null;
      resourceId?: string | null;
      metadata?: AuditMetadata;
    },
  ): Promise<AuditLogRow> {
    return auditLogRepository.recordSystemAction({
      firmId: params.firmId,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      metadata: params.metadata,
    });
  }

  /**
   * Returns the current user's own audit history, plus the total count
   * matching the filter. Deliberately does NOT accept an arbitrary
   * actorId/firmId filter from the caller — that would let any
   * authenticated user read anyone else's audit trail by passing a
   * different id, since audit_log has no RLS policy to stop it at the
   * database layer.
   *
   * AMENDED, THIS SESSION: return type changed from `AuditLogRow[]` to
   * `{ events, total }` — see class-level doc comment. No change to
   * this method's own filtering/authorization behavior otherwise.
   */
  async getMyAuditLog(options?: {
    limit?: number;
    offset?: number;
    actionPrefix?: string;
  }): Promise<AuditLogReadResult> {
    const user = this.requireAuthentication();

    const filter: AuditLogFilter = {
      actorId: user.id,
      limit: options?.limit,
      offset: options?.offset,
      actionPrefix: options?.actionPrefix,
    };

    const { data, total } = await this.auditLogRepository.findByFilter(filter);
    return { events: data, total };
  }

  /**
   * Returns every audit event captured with the given firmId, most
   * recent first, plus the total count matching the filter — NOT
   * filtered to actorId, deliberately: a firm owner reviewing their
   * firm's audit trail wants to see actions taken by anyone under that
   * firm context, not just their own.
   *
   * Owner-only, matching this project's existing Billing convention — a
   * firm MEMBER (not owner) gets an AuthorizationError here, same as
   * they would trying to view or cancel that firm's subscription.
   *
   * AMENDED, THIS SESSION: return type changed from `AuditLogRow[]` to
   * `{ events, total }` — see class-level doc comment.
   */
  async getFirmAuditLog(
    firmId: string,
    options?: { limit?: number; offset?: number; actionPrefix?: string },
  ): Promise<AuditLogReadResult> {
    this.requireAuthentication();

    const firm = await this.firmRepository.findByIdOrThrow(firmId);
    this.requireOwnership(firm.owner_id);

    const filter: AuditLogFilter = {
      firmId: firm.id,
      limit: options?.limit,
      offset: options?.offset,
      actionPrefix: options?.actionPrefix,
    };

    const { data, total } = await this.auditLogRepository.findByFilter(filter);
    return { events: data, total };
  }

  /**
   * Returns every audit event across every actor and firm, most recent
   * first, plus the total count matching the filter — admin only. Uses
   * the inherited requireRole('admin') guard rather than isAdmin(),
   * since an unauthorized caller here should get a thrown
   * AuthorizationError (403) the same way every other guarded method in
   * this project behaves, not a silent empty result.
   *
   * AMENDED, THIS SESSION: return type changed from `AuditLogRow[]` to
   * `{ events, total }` — see class-level doc comment. `actionPrefix`/
   * `actorType` filtering and page-size ceiling enforcement (in
   * AuditLogRepository#findByFilter) are unchanged by this amendment.
   */
  async getAllAuditLog(options?: {
    limit?: number;
    offset?: number;
    actionPrefix?: string;
    actorType?: AuditLogActorType;
  }): Promise<AuditLogReadResult> {
    this.requireRole('admin');

    const filter: AuditLogFilter = {
      limit: options?.limit,
      offset: options?.offset,
      actionPrefix: options?.actionPrefix,
      actorType: options?.actorType,
    };

    const { data, total } = await this.auditLogRepository.findByFilter(filter);
    return { events: data, total };
  }
}
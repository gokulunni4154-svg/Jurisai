import { BaseService } from '@/core/services/base.service';
import { ConflictError } from '@/core/errors/app-error';
import type { CreateFirmInput } from './billing.schemas';
import type { FirmRepository } from './firm.repository';
import type { ProfileRepository } from './profile.repository';
import type { AuthUser } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';

// firm.repository.ts defines this same alias locally but doesn't export
// it, so it's redeclared here — same duplicated-type-level-convenience
// trade-off billing.service.ts already accepts for SubscriptionRow/PlanRow.
type FirmRow = Database['public']['Tables']['firms']['Row'];

/**
 * FirmService
 * -----------
 * NEW THIS SESSION — closes Item #67. No firm-creation route/service
 * existed before this; the previous session's `createCheckoutSession()`
 * explicitly required a pre-existing firmId because this didn't exist yet.
 *
 * FLAGGED DECISION, NOT DRAWN FROM PRECEDENT: on creation, the creating
 * user's own `profiles.firm_id` is set to the new firm's id (in addition
 * to becoming `firms.owner_id`) — i.e. an owner is also considered a
 * "member" for the purposes of `profiles.firm_id`-based queries elsewhere
 * in the app (e.g. anything that checks "which firm is this user under").
 * This wasn't specified by any pasted source; it was the more consistent
 * reading of 20260726000002_create_firms_table.sql's own
 * `firms_select_member` RLS policy, which grants read access via
 * `profiles.firm_id`, not `firms.owner_id`, alone — without this,
 * `firms_select_owner` would still let the owner read the firm, but the
 * member-facing policy wouldn't recognize them as a member of their own
 * firm. Worth confirming this is the intended reading.
 *
 * FLAGGED, UNRESOLVED RISK, NOT SILENTLY HANDLED: `firmRepository.create()`
 * and `profileRepository.update()` are two separate database calls, not
 * wrapped in a transaction (BaseRepository has no transaction primitive —
 * none has been built or asked for in this project). If the firm insert
 * succeeds but the profile update fails, the result is a firm that exists
 * with a valid owner_id, but whose owner's own profiles.firm_id was never
 * set — an inconsistent-but-recoverable state (the owner could retry, or
 * an admin could patch profiles.firm_id directly), not a corrupted one.
 * Flagging rather than adding retry/rollback logic that wasn't asked for.
 *
 * AMENDED, THIS SESSION — AuditLogRepository added as a 3rd constructor
 * dependency, closing the "Firm-creation writes zero audit entries" gap
 * (prior sessions' addenda, Item #1). createFirm() now writes a
 * 'firm.create' audit entry as its last step, after both the firm insert
 * AND the profile update succeed — see method comment for why it's
 * placed after both rather than right after firmRepository.create().
 * getMyFirm() is NOT audited — a read, same reasoning
 * getDownloadUrl()/listNotifications() were excluded elsewhere.
 *
 * FLAGGED, EXTENDS THE EXISTING NON-TRANSACTIONAL RISK ABOVE: the audit
 * write is now a THIRD unguarded step in the same already-flagged
 * sequence (firm insert → profile update → audit write), each capable
 * of independently failing after the prior step(s) succeeded. No
 * try/catch added around the audit write — matches document.service.ts's
 * create/update/delete precedent, not the narrow Cashfree-webhook
 * exception (File 20), which only exists because that specific path
 * can't tolerate a duplicate-retry. Not silently handled; flagging
 * rather than adding retry/rollback logic that wasn't asked for.
 */
export class FirmService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly firmRepository: FirmRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {
    super(currentUser);
  }

  /**
   * AMENDED, THIS SESSION: writes a 'firm.create' audit entry as the
   * last step, after the firm insert AND the profile.firm_id update
   * both succeed — deliberately placed after both rather than
   * immediately after firmRepository.create(), so the audit entry's
   * existence implies the full (currently non-transactional) sequence
   * ran to completion, not just its first step. See class-level doc
   * comment for the flagged risk this doesn't resolve.
   */
  async createFirm(input: CreateFirmInput) {
    const user = this.requireAuthentication();

    // A profile can belong to at most one firm (profiles.firm_id has no
    // multi-firm modeling — see the firms migration's own assumption #3).
    // Creating a second firm while already owning/belonging to one is
    // rejected as a conflict, not silently allowed to overwrite firm_id.
    const profile = await this.profileRepository.findByIdOrThrow(user.id);

    if (profile.firm_id) {
      throw new ConflictError('You already belong to a firm.', {
        profileId: user.id,
        existingFirmId: profile.firm_id,
      });
    }

    const firm = await this.firmRepository.create({
      name: input.name,
      owner_id: user.id,
    });

    await this.profileRepository.update(user.id, {
      firm_id: firm.id,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId: firm.id,
      action: 'firm.create',
      resourceType: 'firm',
      resourceId: firm.id,
      metadata: { name: firm.name },
    });

    return firm;
  }

  /**
   * NEW, THIS SESSION — closes gap #1 from the billing frontend handoff:
   * no Service method or route previously wrapped
   * FirmRepository#findByOwnerId() (confirmed real via that repository's
   * own pasted source). Returns null when the caller doesn't own a firm
   * — a normal state, not a NotFoundError, matching this project's own
   * convention elsewhere (BillingService#getCurrentSubscription() returns
   * null the same way for "no active subscription").
   *
   * NOT audited — a read, same reasoning getDownloadUrl() was excluded
   * in document.service.ts and listNotifications() was excluded in
   * notification.service.ts.
   *
   * FLAGGED, IMPORTANT — this checks OWNERSHIP (firms.owner_id via
   * findByOwnerId), not MEMBERSHIP (profiles.firm_id). createFirm()'s own
   * ConflictError above is thrown whenever profile.firm_id is already
   * set, which per this file's own header decision happens for OWNERS
   * (deliberately) but could in principle also be true for a plain
   * member of someone else's firm, if profiles.firm_id is ever set by
   * some other path than createFirm() itself (no such path exists in
   * this project's pasted source today, but nothing prevents one being
   * added later). If that ever happens, a member would hit the
   * ConflictError on creation but get `null` back from this method —
   * not a bug in either method individually, just a real ownership-vs-
   * membership seam neither one resolves. No "get my firm as a member"
   * method exists to cover that case; not built here since nothing in
   * this project's pasted source currently creates that state.
   */
  async getMyFirm(): Promise<FirmRow | null> {
    const user = this.requireAuthentication();
    return this.firmRepository.findByOwnerId(user.id);
  }
}
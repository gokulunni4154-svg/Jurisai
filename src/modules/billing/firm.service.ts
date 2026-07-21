import { BaseService } from '@/core/services/base.service';
import { ConflictError } from '@/core/errors/app-error';
import type { CreateFirmInput } from './billing.schemas';
import type { FirmRepository } from './firm.repository';
import type { ProfileRepository } from './profile.repository';
import type { AuthUser } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

// firm.repository.ts defines this same alias locally but doesn't export
// it, so it's redeclared here — same duplicated-type-level-convenience
// trade-off billing.service.ts already accepts for SubscriptionRow/PlanRow.
type FirmRow = Database['public']['Tables']['firms']['Row'];

/**
 * FirmService
 * -----------
 * Closes Item #67. No firm-creation route/service existed before this
 * class; the previous session's `createCheckoutSession()` explicitly
 * required a pre-existing firmId because this didn't exist yet.
 *
 * AMENDED (Firm-creation audit entry, prior session): AuditLogRepository
 * added as a constructor dependency, closing the "Firm-creation writes
 * zero audit entries" gap (prior sessions' addenda, Item #1).
 * createFirm() writes a 'firm.create' audit entry as its last step.
 * getMyFirm() is NOT audited — a read, same reasoning
 * getDownloadUrl()/listNotifications() were excluded elsewhere.
 *
 * AMENDED, THIS SESSION — Phase 4, Enterprise & Collaboration. Product
 * decisions this session: (1) a profile may OWN at most one firm but be
 * a MEMBER of several ("multi-firm membership"), (2) direct-add
 * membership, no invitation step (this affects FirmMemberService, not
 * this file directly). Two real changes to createFirm() follow from
 * decision (1):
 *
 *   a. The conflict guard changed from "profile.firm_id already set" to
 *      "profile already OWNS a firm" (via firmRepository.findByOwnerId(),
 *      already confirmed to exist). Under single-firm, those two checks
 *      were equivalent because profiles.firm_id could only ever be set
 *      by owning a firm. Under multi-firm, they diverge: a profile can
 *      have profiles.firm_id set as a MEMBER of someone else's firm
 *      while still being free to create and own one of their own — the
 *      old check would have wrongly blocked that.
 *
 *   b. FirmMemberRepository added as a 4th constructor dependency.
 *      createFirm() now also inserts the creator's own 'owner'-role
 *      firm_members row — closing a real, previously-live gap: this
 *      method never created that row at all before this session, which
 *      means the exact seam 20260802000001_create_firm_members_table.sql's
 *      own migration header already flagged as a hypothetical
 *      ("assumption #5... today, a firm can exist with zero
 *      firm_members rows") was, in fact, the actual behavior of the
 *      only code path that creates a firm. Confirmed by reading this
 *      file's own prior source, not assumed from the migration comment
 *      alone.
 *
 * profiles.firm_id's MEANING also changes this session (see the RLS
 * migration, 20260804000000_support_multi_firm_membership.sql, for the
 * schema-adjacent half of this): it is no longer the source of truth for
 * membership (firm_members is), and is now treated as a "primary/default
 * firm" convenience pointer — set only if not already set, so a profile
 * that already has a primary firm (as a member elsewhere) keeps it on
 * record after also creating and owning a new firm. This method never
 * overwrites an existing profiles.firm_id.
 *
 * FLAGGED, UNRESOLVED RISK, EXTENDED THIS SESSION, NOT SILENTLY HANDLED:
 * firmRepository.create(), firmMemberRepository.create(),
 * profileRepository.update() (conditional), and
 * auditLogRepository.recordUserAction() are four separate, sequential,
 * non-transactional database calls (BaseRepository has no transaction
 * primitive — see that file's own "ARCHITECTURE DECISION, SETTLED THIS
 * SESSION" comment, which explicitly names this exact method as an
 * already-accepted instance of this risk category). A failure partway
 * through leaves data in an inconsistent-but-recoverable state, never a
 * corrupted one. Flagging the now-four-step chain rather than adding
 * retry/rollback logic that wasn't asked for, per that file's own
 * stated policy: flag new instances in the Service method's own doc
 * comment rather than re-litigating the general architecture choice.
 */
export class FirmService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly firmRepository: FirmRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly firmMemberRepository: FirmMemberRepository,
  ) {
    super(currentUser);
  }

  /**
   * AMENDED, THIS SESSION — see class-level doc comment for the full
   * reasoning behind both changes below.
   */
  async createFirm(input: CreateFirmInput) {
    const user = this.requireAuthentication();

    // AMENDED, THIS SESSION: checks OWNERSHIP (firms.owner_id), not
    // profiles.firm_id — see class-level doc comment, change (a).
    const existingOwnedFirm = await this.firmRepository.findByOwnerId(user.id);

    if (existingOwnedFirm) {
      throw new ConflictError('You already own a firm.', {
        profileId: user.id,
        existingFirmId: existingOwnedFirm.id,
      });
    }

    const firm = await this.firmRepository.create({
      name: input.name,
      owner_id: user.id,
    });

    // AMENDED, THIS SESSION: closes the previously-live "owner gets no
    // firm_members row" gap — see class-level doc comment, change (b).
    await this.firmMemberRepository.create({
      firm_id: firm.id,
      profile_id: user.id,
      role: 'owner',
    });

    // AMENDED, THIS SESSION: profiles.firm_id is now a primary-firm
    // pointer, not the membership source of truth. Only ever set from
    // null -> firm.id here; an existing primary firm (from prior
    // membership elsewhere) is left untouched. See class-level doc
    // comment for the full reasoning.
    const profile = await this.profileRepository.findByIdOrThrow(user.id);

    if (!profile.firm_id) {
      await this.profileRepository.update(user.id, {
        firm_id: firm.id,
      });
    }

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
   * Closes gap #1 from the billing frontend handoff: no Service method
   * or route previously wrapped FirmRepository#findByOwnerId() (confirmed
   * real via that repository's own pasted source). Returns null when the
   * caller doesn't own a firm — a normal state, not a NotFoundError,
   * matching this project's own convention elsewhere
   * (BillingService#getCurrentSubscription() returns null the same way
   * for "no active subscription").
   *
   * NOT audited — a read, same reasoning getDownloadUrl() was excluded
   * in document.service.ts and listNotifications() was excluded in
   * notification.service.ts.
   *
   * UNCHANGED, THIS SESSION: this checks OWNERSHIP only, same as before.
   * Multi-firm membership (this session) doesn't change this method's
   * own behavior — it still answers "which firm does this profile own,
   * if any", not "which firms is this profile a member of" (that's
   * FirmMemberService#listMembers()-adjacent territory, keyed by firmId
   * not profileId — no "list my memberships across firms" method exists
   * yet; not built here since nothing pasted in this project currently
   * needs it).
   */
  async getMyFirm(): Promise<FirmRow | null> {
    const user = this.requireAuthentication();
    return this.firmRepository.findByOwnerId(user.id);
  }
}
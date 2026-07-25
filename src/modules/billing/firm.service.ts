import { BaseService } from '@/core/services/base.service';
import { ConflictError } from '@/core/errors/app-error';
import type { CreateFirmInput, UpdateFirmInput } from './billing.schemas';
import type { FirmRepository } from './firm.repository';
import type { ProfileRepository } from './profile.repository';
import type { AuthUser, FirmRole } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

// firm.repository.ts defines this same alias locally but doesn't export
// it, so it's redeclared here — same duplicated-type-level-convenience
// trade-off billing.service.ts already accepts for SubscriptionRow/PlanRow.
type FirmRow = Database['public']['Tables']['firms']['Row'];

/**
 * FLAGGED, NEW THIS SESSION (Org/Firm Settings): 'owner'/'admin' access
 * gate, duplicated from firm-member.service.ts's own MANAGE_ROLES rather
 * than imported — that constant is not exported there (confirmed via its
 * pasted source), same non-export firm-dashboard.service.ts's own
 * DASHBOARD_VIEW_ROLES comment already flagged and worked around the same
 * way. Revisit if MANAGE_ROLES is ever exported from firm-member.service.ts
 * — three separate copies of the same array (this one, that one, and
 * firm-dashboard.service.ts's) is a real smell, not a coincidence.
 */
const FIRM_SETTINGS_MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin'];

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
 * AMENDED, Phase 4 — Enterprise & Collaboration. Product decisions this
 * session: (1) a profile may OWN at most one firm but be a MEMBER of
 * several ("multi-firm membership"), (2) direct-add membership, no
 * invitation step (this affects FirmMemberService, not this file
 * directly — FLAGGED, NOT independently re-confirmed this later session:
 * a pasted firm-invitations revoke route now shows an invitation-based
 * join flow also exists for firms, which may supersede or coexist with
 * this decision. Not resolved here — out of this file's scope). Two real
 * changes to createFirm() follow from decision (1):
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
 *
 * AMENDED, THIS SESSION — Org/Firm Settings. Two new methods,
 * getFirmById() and updateFirm(), both gated to FIRM_SETTINGS_MANAGE_ROLES
 * via a new private requireManageAccess() helper below — same pattern
 * FirmMemberService's own requireManageAccess() already establishes
 * (resolve caller's FirmRole via firmMemberRepository.findByFirmAndProfile(),
 * assert via inherited requireFirmRole()). Duplicated rather than shared
 * because the two Services don't share a base class beyond BaseService
 * itself and neither exposes the other's private helper — same
 * duplication trade-off already flagged for MANAGE_ROLES above.
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
   * UNCHANGED: this checks OWNERSHIP only. Multi-firm membership doesn't
   * change this method's own behavior — it still answers "which firm
   * does this profile own, if any", not "which firms is this profile a
   * member of" (that's FirmMemberService#listMembers()-adjacent
   * territory, keyed by firmId not profileId). For settings, use the new
   * getFirmById() below instead — that method is firmId-scoped and
   * works for an admin-only-at-another-firm profile, which getMyFirm()
   * deliberately cannot answer (see multi-firm reasoning above).
   */
  async getMyFirm(): Promise<FirmRow | null> {
    const user = this.requireAuthentication();
    return this.firmRepository.findByOwnerId(user.id);
  }

  /**
   * NEW, THIS SESSION — Org/Firm Settings. Shared authorization helper
   * for getFirmById() and updateFirm() below. Deliberate mirror of
   * FirmMemberService#requireManageAccess() (confirmed via that file's
   * own pasted source) — same resolve-then-assert shape, same
   * FLAGGED duplication reasoning as FIRM_SETTINGS_MANAGE_ROLES above.
   *
   * FLAGGED, NEW DECISION: settings visibility is gated to owner/admin
   * only, same as write access — there's no "read-only settings view"
   * tier for plain employee/lawyer FirmRoles. This mirrors the Firm
   * Dashboard's own visibility gate (`firm_members.role in ('owner',
   * 'admin')` only, prior session, user-confirmed directly) rather than
   * FirmMemberService#listMembers()'s broader "any member may read"
   * gate. Not independently confirmed with you this session — flagging
   * in case a read-only settings view for plain members turns out to be
   * wanted later.
   */
  private async requireManageAccess(firmId: string): Promise<AuthUser> {
    const user = this.requireAuthentication();
    const callerRole = await this.firmMemberRepository.findByFirmAndProfile(firmId, user.id);
    return this.requireFirmRole(callerRole, FIRM_SETTINGS_MANAGE_ROLES);
  }

  /**
   * NEW, THIS SESSION — Org/Firm Settings. Resolves a firm by id for the
   * settings screen, firmId-scoped (not self-scoped) — same forced
   * design reasoning Firm Dashboard's own route already established:
   * multi-firm membership means a profile can be admin/owner at more
   * than one firm, so "my firm's settings" is ambiguous without an
   * explicit firmId. Throws (via findByIdOrThrow, inherited on
   * FirmRepository) if the firm doesn't exist; throws via
   * requireManageAccess() above if the caller isn't owner/admin there.
   */
  async getFirmById(firmId: string): Promise<FirmRow> {
    await this.requireManageAccess(firmId);
    return this.firmRepository.findByIdOrThrow(firmId);
  }

  /**
   * NEW, THIS SESSION — Org/Firm Settings. Returns a firm's membership
   * roster enriched with each member's profile (currently: full_name,
   * avatar_url, phone — whatever ProfileRepository's real Row type
   * carries, confirmed via 20260711120000_create_profiles_table.sql's
   * pasted source this session).
   *
   * FLAGGED, REAL LIMITATION, NOT CLOSED BY THIS METHOD: `profiles` has
   * no email column at all (deliberate — see ProfileRepository's own
   * class-level doc comment; email lives only on auth.users, reachable
   * only via admin.ts). This means there is still no way to resolve an
   * email address to a profileId anywhere in this project's pasted
   * source, so "add member by searching for their email" remains
   * unbuildable from current source. ProfileRepository#findAllForAdmin()
   * does support name search, but is admin/support-gated (no RLS policy
   * lets a firm owner/admin read arbitrary profiles) and would leak
   * every profile on the platform, not just ones relevant to this firm —
   * not a fit either, per that method's own updated doc comment. This
   * method only solves DISPLAY (showing real names for people already
   * on the roster) — it does not solve DISCOVERY (finding a person's
   * profileId to add them in the first place). That gap stands.
   *
   * Deliberately built here on FirmService, not FirmMemberService —
   * FirmService already has both firmMemberRepository and
   * profileRepository as constructor dependencies (from createFirm()'s
   * own needs), so no factory change was needed. Adding this to
   * FirmMemberService instead would have required a new
   * ProfileRepository constructor dependency there, a bigger, less
   * targeted change for a Settings-screen-only need.
   *
   * Uses the same requireManageAccess() gate as getFirmById()/
   * updateFirm() above — owner/admin only, consistent with the rest of
   * the settings screen.
   */
  async getFirmMembersWithProfiles(firmId: string) {
    await this.requireManageAccess(firmId);

    const members = await this.firmMemberRepository.findByFirmId(firmId);
    const profileIds = members.map((m) => m.profile_id);
    const profiles = await this.profileRepository.findByIds(profileIds);
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    return members.map((member) => ({
      ...member,
      profile: profileById.get(member.profile_id) ?? null,
    }));
  }

  /**
   * NEW, THIS SESSION — Org/Firm Settings. Renames a firm. Currently the
   * ONLY settable field — firms table has no other client-facing
   * columns (confirmed via 20260726000002_create_firms_table.sql's
   * pasted source).
   *
   * AMENDED, THIS SESSION: input type is `UpdateFirmInput`, imported
   * from billing.schemas.ts (real, pasted this session) — a Zod-derived
   * type built on that file's own `updateFirmSchema`, which reuses the
   * already-confirmed `firmNameSchema` (same schema `createFirmSchema`
   * itself uses, matching the real `firms_name_length` CHECK constraint
   * exactly). Replaces an earlier local stand-in interface written
   * before billing.schemas.ts had been pasted — that stand-in is gone
   * now, not left behind as dead code.
   *
   * Audited as 'firm.update', matching 'firm.create''s own audit
   * convention on this same class. Not using firmRepository.update()'s
   * return value blindly — BaseRepository's inherited update() is
   * assumed (not re-confirmed this session) to return the full updated
   * row, same assumption firm-member.service.ts's changeRole() already
   * makes of the same inherited method on FirmMemberRepository.
   */
  async updateFirm(firmId: string, input: UpdateFirmInput): Promise<FirmRow> {
    const user = await this.requireManageAccess(firmId);

    const updated = await this.firmRepository.update(firmId, {
      name: input.name,
    });

    await this.auditLogRepository.recordUserAction({
      actorId: user.id,
      firmId,
      action: 'firm.update',
      resourceType: 'firm',
      resourceId: firmId,
      metadata: { name: input.name },
    });

    return updated as FirmRow;
  }
}
import 'server-only';

import type { AuthUser, FirmRole, UserRole } from '@/core/auth/types';
import { AuthenticationError, AuthorizationError } from '@/core/errors/app-error';

/**
 * BaseService
 * -----------
 * Abstract base class for the Service Layer. Every concrete service
 * (DocumentAnalysisService, AppointmentService, LawyerProfileService, ...)
 * extends this to inherit consistent, auditable authorization primitives.
 *
 * Responsibility boundary:
 * - Repositories (File 22) know about rows and tables. They do not know
 *   who is asking.
 * - Route Handlers know about HTTP. They should not contain business
 *   rules or authorization logic directly.
 * - Services (this layer) sit in between: business rules, cross-repository
 *   orchestration, and "is this actor allowed to do this" decisions live
 *   here.
 *
 * This class deliberately does NOT inject a repository. Unlike
 * BaseRepository<T>, which is generic over exactly one table, a service
 * routinely needs to orchestrate multiple repositories in a single business
 * operation (e.g. booking an appointment may touch the appointments,
 * lawyers, and notifications repositories together). Forcing a single
 * generic repository onto this base class would be the wrong abstraction.
 * Concrete services are responsible for accepting and storing their own
 * repository dependencies via their own constructors.
 *
 * This class also does NOT resolve the current session itself (it does not
 * call getCurrentSession() from File 20). The resolved AuthUser | null is
 * injected via the constructor by the caller (typically a Route Handler,
 * which resolves the session once per request). Re-resolving the session
 * independently inside every service would mean redundant Supabase calls
 * per request and risks the user context drifting if resolved more than
 * once during the same request.
 */
export abstract class BaseService {
  /**
   * The resolved actor for this request. `null` is a valid, expected value
   * representing "no authenticated user" — this is normal for public
   * endpoints and is not, by itself, an error condition. Guard methods
   * below are what turn "no user" or "wrong role" into a thrown AppError
   * at the point a concrete service actually requires it.
   */
  protected constructor(protected readonly currentUser: AuthUser | null) {}

  /**
   * Asserts that a user is authenticated. Does not check role or ownership
   * — this is the loosest guard, for operations that only require "someone
   * is logged in" (e.g. reading your own notification list).
   *
   * Returns the AuthUser so call sites can chain directly:
   *   const user = this.requireAuthentication();
   * instead of guarding and then re-reading `this.currentUser!` with a
   * non-null assertion.
   */
  protected requireAuthentication(): AuthUser {
    if (!this.currentUser) {
      throw new AuthenticationError('Authentication is required to perform this action.');
    }

    return this.currentUser;
  }

  /**
   * Asserts that a user is authenticated AND holds one of the given roles.
   * Internally calls requireAuthentication() first, so an unauthenticated
   * caller always gets a 401 (AuthenticationError) rather than a 403
   * (AuthorizationError) — the distinction matters for clients deciding
   * whether to redirect to login vs. show a "not permitted" state.
   */
  protected requireRole(...allowedRoles: readonly UserRole[]): AuthUser {
    const user = this.requireAuthentication();

    if (!allowedRoles.includes(user.role)) {
      throw new AuthorizationError('You do not have permission to perform this action.', {
        requiredRoles: allowedRoles,
        actualRole: user.role,
      });
    }

    return user;
  }

  /**
   * Asserts that a user is authenticated AND is either the owner of the
   * resource in question (resourceOwnerId === user.id) OR holds one of the
   * roles listed in options.allowRoles (e.g. 'admin' overriding ownership
   * checks for support/moderation purposes).
   *
   * Deliberately takes a bare resourceOwnerId: string rather than a
   * resource object plus a key name. This keeps the base class from
   * guessing at resource shape, but it also means this method only covers
   * single-owner resources. Known, documented limitation: this does NOT
   * cover team/firm-level ownership (e.g. a case file that should be
   * accessible to every lawyer at the same firm). See requireFirmRole()
   * below — added this session as the dedicated handling this comment
   * always said team/firm-level authorization would need, rather than
   * being bolted onto this method as a special case.
   */
  protected requireOwnership(
    resourceOwnerId: string,
    options?: { readonly allowRoles?: readonly UserRole[] }
  ): AuthUser {
    const user = this.requireAuthentication();

    if (user.id === resourceOwnerId) {
      return user;
    }

    if (options?.allowRoles?.includes(user.role)) {
      return user;
    }

    throw new AuthorizationError('You do not have permission to access this resource.', {
      resourceOwnerId,
      actualUserId: user.id,
      actualRole: user.role,
      allowRoles: options?.allowRoles,
    });
  }

  /**
   * Asserts that a user is authenticated, holds a role that requires
   * professional verification (currently 'lawyer' and 'law_firm' only —
   * per product decision, no other role is subject to this check), AND
   * that their professional_verifications status is 'verified'.
   *
   * ADDED (requireVerified() design session, #43 follow-up): deliberately
   * takes `verificationStatus` as a parameter rather than reading it off
   * `this.currentUser`, same reasoning as requireOwnership()'s
   * resourceOwnerId parameter above: BaseService has no repository access
   * (see class doc comment) and AuthUser deliberately does not carry
   * verification status (same "not cheap enough for every
   * getCurrentUser() call" reasoning AuthUser's own doc comment gives for
   * omitting FirmRole). The caller — a concrete service that already has
   * ProfessionalVerificationRepository injected — is responsible for
   * fetching the row first (e.g. via findByProfileId(user.id)) and
   * passing its `status` in, or `null` if no row exists yet.
   *
   * The status union is typed inline here rather than imported from
   * professional-verification.repository.ts's VerificationStatus type,
   * to avoid this core file depending on a feature module — flagged as a
   * deliberate choice, not an oversight. If a shared-types location gets
   * introduced later, this should be reconciled to import from there
   * instead of duplicating the union.
   *
   * FLAGGED ASSUMPTION: a caller whose role is NOT 'lawyer'/'law_firm'
   * (e.g. 'individual', 'business', 'admin', 'support') is rejected here
   * too, since requireVerified() implies "must be a role that
   * verification even applies to." If a route ever needs a softer
   * "verified-if-lawyer-or-firm, otherwise just authenticated" branch
   * instead of a hard gate, that is a different, not-yet-built check —
   * do not silently loosen this one to cover that case later.
   */
  protected requireVerified(
    verificationStatus: 'pending' | 'verified' | 'rejected' | 'resubmitted' | null
  ): AuthUser {
    const user = this.requireRole('lawyer', 'law_firm');

    if (verificationStatus !== 'verified') {
      throw new AuthorizationError(
        'This action requires a verified professional account.',
        { actualStatus: verificationStatus }
      );
    }

    return user;
  }

  /**
   * NEW, Phase 4 — Enterprise & Collaboration. Asserts that a user is
   * authenticated AND holds one of the given FirmRoles WITHIN A SPECIFIC
   * FIRM. This is the dedicated team/firm-level authorization
   * requireOwnership()'s own doc comment above already flagged as a
   * known gap, not yet built ("will need dedicated handling... should
   * NOT be bolted onto [requireOwnership] as special cases later without
   * redesigning it") — added as its own method rather than extending
   * requireOwnership(), per that comment's own instruction.
   *
   * Follows requireVerified()'s established pattern exactly: takes the
   * already-resolved firmRole as a parameter rather than fetching it
   * itself, since BaseService has no repository access (see class doc
   * comment). The caller — a concrete service with FirmMemberRepository
   * injected — fetches it first via
   * findByFirmAndProfile(firmId, user.id) and passes the result in,
   * `null` if no firm_members row exists for that (firmId, profileId)
   * pair (a normal, expected state — see FirmRole's own doc comment in
   * types.ts).
   *
   * Says nothing about platform UserRole — a 'lawyer' UserRole and an
   * 'admin' FirmRole are independent facts (see FirmRole's own doc
   * comment). Callers needing both must call requireRole() and
   * requireFirmRole() separately; this method does not call
   * requireRole() internally.
   */
  protected requireFirmRole(
    firmRole: FirmRole | null,
    allowedRoles: readonly FirmRole[]
  ): AuthUser {
    const user = this.requireAuthentication();

    if (!firmRole || !allowedRoles.includes(firmRole)) {
      throw new AuthorizationError(
        'You do not have permission to perform this action within this firm.',
        { requiredFirmRoles: allowedRoles, actualFirmRole: firmRole }
      );
    }

    return user;
  }

  /**
   * Convenience check for the common "admin override" case, without
   * throwing. Useful when a service needs to branch behavior (e.g. include
   * extra fields in a response for admins) rather than allow-or-deny.
   * Returns false for unauthenticated users rather than throwing, since
   * this is a query, not a guard.
   */
  protected isAdmin(): boolean {
    return this.currentUser?.role === 'admin';
  }
}
import 'server-only';

import type { AuthUser, UserRole } from '@/core/auth/types';
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
   * yet cover team/firm-level ownership (e.g. a case file that should be
   * accessible to every lawyer at the same law_firm, or a document owned
   * by a business account but accessible to that business's employees).
   * Those multi-tenant authorization models don't exist yet and will need
   * dedicated handling when the Law Firm Dashboard and Business Dashboard
   * modules are built — they should NOT be bolted onto this method as
   * special cases later without redesigning it.
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
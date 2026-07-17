import type { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

/**
 * Page routes that do NOT require an authenticated session.
 *
 * STRATEGY: denylist / fail-closed. Every route is protected by default;
 * a route is public only if it's explicitly listed here. This is the
 * safer default for a platform that will keep adding protected surface
 * area (Lawyer/Law Firm/Business Dashboards, Admin Panel, Legal Vault,
 * etc.) — a new module is protected the moment it exists, with nobody
 * needing to remember to add it anywhere.
 *
 * MATCHING IS EXACT, not prefix-based, and that's deliberate. Prefix
 * matching (e.g. treating "/auth" as public) would silently make any
 * future nested route under it public too (e.g. a hypothetical
 * "/auth/sign-in/mfa" step) without anyone deciding that. Exact match
 * means every new route — nested or not — is protected until someone
 * explicitly adds it below.
 *
 * KNOWN LIMITATION: none of these page routes exist in the codebase yet
 * — only their API counterparts do (src/app/api/auth/*, Files 36–40).
 * This list is a forward-looking placeholder anticipating the page
 * routes that will eventually render those flows (e.g. a future
 * `src/app/(auth)/sign-in/page.tsx`). It must be revisited — paths
 * confirmed, not just assumed — once those pages are actually built.
 */
const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/request-password-reset',
];

/** Where unauthenticated users are sent when hitting a protected page. */
const SIGN_IN_ROUTE = '/auth/sign-in';

/** Query param carrying the original destination, for post-login redirect. */
const REDIRECT_PARAM = 'redirectTo';

export type RouteProtectionDecision = { action: 'allow' } | { action: 'redirect'; url: URL };

/**
 * Decides whether a request should proceed or be redirected to sign-in.
 *
 * SCOPE — page routes only. Requests under `/api/*` always `allow` here,
 * regardless of auth state. This is a deliberate scope boundary, not an
 * oversight: API routes already enforce their own auth, per-route, via
 * either `BaseService.requireAuthentication()`/`requireRole()` (most
 * routes) or a direct `getCurrentUser()` check (File 40's documented,
 * narrow exception). Redirecting a JSON API caller with a 3xx to an HTML
 * sign-in page would break every API client (nothing consuming `/api/*`
 * expects or can follow a page redirect) for no security benefit — the
 * route handlers already fail closed on their own with a proper 401
 * `AppError`. Duplicating that here would be a second source of truth for
 * exactly the kind of drift the Constitution's "Service layer mirrors RLS
 * — the two should never disagree" principle warns against, extended to
 * a third layer.
 *
 * ROLE-GATING IS OUT OF SCOPE HERE, ALSO DELIBERATELY. This function only
 * distinguishes authenticated vs. not. Role checks (e.g. "/admin/* requires
 * role === 'admin'") remain solely the Service layer's responsibility
 * (`BaseService.requireRole()`), for the same single-source-of-truth
 * reason. See DECISIONS.md for the full framing of this tradeoff — it's
 * an open, revisitable decision, not a settled one.
 *
 * @param request - The incoming request (read-only: only `nextUrl` is used).
 * @param user - The server-verified user from `updateSession()` (File 15),
 *               reused here rather than re-verified, to avoid a second
 *               Auth-server round trip per request.
 */
export function resolveRouteProtection(
  request: NextRequest,
  user: User | null,
): RouteProtectionDecision {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    return { action: 'allow' };
  }

  if (isPublicRoute(pathname)) {
    return { action: 'allow' };
  }

  if (user !== null) {
    return { action: 'allow' };
  }

  const redirectUrl = new URL(SIGN_IN_ROUTE, request.url);
  redirectUrl.searchParams.set(REDIRECT_PARAM, `${pathname}${request.nextUrl.search}`);

  return { action: 'redirect', url: redirectUrl };
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}
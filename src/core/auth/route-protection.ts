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
 * KNOWN LIMITATION (partially resolved): this list was originally a
 * forward-looking placeholder anticipating page routes that didn't exist
 * yet, written before any of them were built. `/sign-in` is now CONFIRMED
 * against real source — it renders via `src/app/(auth)/sign-in/page.tsx`,
 * a Next.js route group, which is excluded from the URL path entirely.
 * The original placeholder assumed a literal `/auth/sign-in` URL, which
 * was wrong given the `(auth)` group; corrected here.
 *
 * `/request-password-reset` is likewise CONFIRMED against real source: it
 * renders via `src/app/(auth)/request-password-reset/page.tsx`, so its URL
 * has no `/auth` prefix. The earlier `/auth/request-password-reset` entry
 * pointed at a page that does not exist, which sent logged-out users to
 * sign-in instead of the reset-request form.
 *
 * `/sign-up` below is still an unconfirmed placeholder -- no corresponding
 * page route has been pasted as real source yet. Do not assume it follows
 * the same `(auth)` group convention without confirming its file path.
 *
 * AMENDMENT -- audit batch 1 (F3): `/client-signup` and `/pricing` added.
 * Both were verified against real source before being made public:
 *   - `/client-signup` (src/app/client-signup/page.tsx) is a static form
 *     shell. It fetches nothing server-side and reads only the `invite`
 *     query param, which it forwards to POST /api/auth/client-signup;
 *     the invitation itself is validated by that API, not this page. It
 *     must be public: its audience is an invited client with no account
 *     yet, who was previously bounced to /sign-in.
 *   - `/pricing` (src/app/pricing/page.tsx) renders only public plan
 *     data from GET /api/billing/plans, whose service method
 *     (listActivePlans) deliberately skips authentication. FLAGGED, not
 *     changed here (no DB changes in this batch): the plans_select_active
 *     RLS policy is `to authenticated`, so a signed-out visitor's request
 *     returns an empty plan list. Nothing protected is exposed; the page
 *     just cannot show plans to logged-out visitors until that policy
 *     also covers the `anon` role.
 * Exact-match only (see isPublicRoute): this does NOT make sub-paths such
 * as /pricing/anything or /client-signup/anything public.
 */
const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/sign-in',
  '/sign-up',
  '/request-password-reset',
  '/client-signup',
  '/pricing',
];

/** Where unauthenticated users are sent when hitting a protected page. */
const SIGN_IN_ROUTE = '/sign-in';

/** Query param carrying the original destination, for post-login redirect. */
const REDIRECT_PARAM = 'redirectTo';

/** Query param + value telling the sign-in page why the user was bounced. */
const ERROR_PARAM = 'error';
const EMAIL_NOT_CONFIRMED_ERROR = 'email_not_confirmed';

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

  if (user !== null && user.email_confirmed_at != null) {
    return { action: 'allow' };
  }

  const redirectUrl = new URL(SIGN_IN_ROUTE, request.url);
  redirectUrl.searchParams.set(REDIRECT_PARAM, `${pathname}${request.nextUrl.search}`);

  // A session exists but the email is unconfirmed: treated as not signed
  // in for protected pages, and the sign-in page is told why.
  if (user !== null) {
    redirectUrl.searchParams.set(ERROR_PARAM, EMAIL_NOT_CONFIRMED_ERROR);
  }

  return { action: 'redirect', url: redirectUrl };
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}
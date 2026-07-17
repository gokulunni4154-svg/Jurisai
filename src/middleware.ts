import { NextResponse, type NextRequest } from 'next/server';

import { resolveRouteProtection } from '@/core/auth/route-protection';
import { updateSession } from '@/core/supabase/middleware';

/**
 * Next.js Middleware entry point.
 *
 * Must live at exactly this path (src/middleware.ts) — this is a Next.js
 * framework requirement, not an architectural choice. Kept intentionally
 * thin: session-refresh logic lives in src/core/supabase/middleware.ts and
 * the route-protection policy lives in src/core/auth/route-protection.ts,
 * so both can be unit-tested outside the Edge Runtime. This file's only
 * job is to call both and translate the result into an actual Response.
 *
 * SCOPE: as of this amendment, unauthenticated users hitting a protected
 * page route are redirected to sign-in. Role-gating (e.g. "/admin/*
 * requires role === 'admin'") is deliberately NOT done here — see
 * src/core/auth/route-protection.ts's docstring for the full rationale.
 * `/api/*` routes are also deliberately unaffected by the redirect (they
 * self-guard via the Service layer) — same file, same rationale.
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const decision = resolveRouteProtection(request, user);

  if (decision.action === 'allow') {
    return response;
  }

  const redirectResponse = NextResponse.redirect(decision.url);

  // updateSession() may have refreshed the session cookie (e.g. rotated
  // the refresh token) even for a request that's about to be redirected.
  // NextResponse.redirect() constructs a brand-new response object that
  // does NOT inherit cookies from `response` — they must be copied over
  // explicitly, or a legitimately-refreshing session could lose its
  // rotated cookie on the very request that redirects it, effectively
  // logging the user out.
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

export const config = {
  matcher: [
    /*
     * Run on every request EXCEPT:
     * - _next/static (build-time static files)
     * - _next/image (Next.js image optimization files)
     * - favicon.ico
     * - common static asset extensions
     *
     * These never carry auth-relevant context, so refreshing the session
     * (or evaluating route protection) against them would add a network
     * round-trip per asset for zero benefit.
     *
     * Note this still runs on /api/* routes — required so that
     * updateSession() keeps refreshing session cookies for API callers,
     * unchanged from before this amendment. route-protection.ts's own
     * `pathname.startsWith('/api/')` check is what keeps API routes
     * exempt from the *redirect* behavior specifically, not this matcher.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
};
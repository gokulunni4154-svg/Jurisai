import { NextResponse, type NextRequest } from 'next/server';

import { resolveRouteProtection } from '@/core/auth/route-protection';
import { updateSession } from '@/core/supabase/middleware';

/**
 * Next.js dev mode (Fast Refresh / HMR / webpack's react-refresh runtime)
 * relies on `eval()` and on injecting inline <script> tags at runtime.
 * A strict `script-src` blocks both, which breaks ALL client-side
 * hydration in `pnpm dev` -- not just one page (this is what caused
 * sign-up's form to silently fall back to a native HTML GET submit:
 * React's JS never executed on the page at all).
 *
 * This relaxation is dev-only. Production keeps the strict nonce-based
 * policy with no 'unsafe-eval'/'unsafe-inline' on script-src.
 */
const isDev = process.env.NODE_ENV === 'development';

/**
 * Builds the per-request Content-Security-Policy header value.
 *
 * PRODUCTION ROOT-CAUSE CONTEXT: the deployed sign-in form was blank
 * because production previously sent a bare `script-src 'self'` (see
 * next.config.mjs's prior static `headers()` config). Every Next.js App
 * Router page — static or dynamic — ships several framework-injected
 * inline `<script>` tags (the streamed RSC payload, e.g.
 * `self.__next_f.push(...)`) that hydrate the page. `'self'` only
 * allow-lists *external* same-origin script files; it does not permit
 * inline script *content*, so those inline scripts were silently
 * blocked, the RSC payload never reached the client runtime, and React
 * never hydrated — the HTML shell rendered, but no JS ever ran on the
 * page (matching the reported browser console CSP violation).
 *
 * FIX: a cryptographically random nonce, generated fresh for every
 * request, is added to `script-src`. Next.js detects the `'nonce-...'`
 * token in this header during server-side rendering and automatically
 * stamps its own framework scripts with a matching `nonce` attribute,
 * so only Next's own inline scripts execute — not attacker-injected
 * ones. `'strict-dynamic'` lets those trusted, nonce'd scripts load
 * further same-origin chunks without needing them individually
 * allow-listed; unsupporting browsers safely ignore the unknown token
 * and fall back to `'self'` + the nonce. This is the official Next.js
 * App Router pattern (nonce-based CSP requires the nonce to be minted
 * per-request, which only Middleware can do — see
 * https://nextjs.org/docs/app/guides/content-security-policy).
 *
 * `style-src`, `img-src`, `font-src`, `connect-src`, `frame-ancestors`,
 * `base-uri`, and `form-action` are carried over unchanged from the
 * previous next.config.mjs policy — the reported bug was script
 * execution only, and Step 9 of the fix scope requires not widening
 * anything beyond what's actually broken.
 */
function buildCspHeader(nonce: string): string {
  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com https://generativelanguage.googleapis.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

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
 *
 * CSP AMENDMENT: also mints a fresh nonce per request and stamps it (plus
 * the resulting CSP header) onto `request.headers` *before* calling
 * updateSession() below. This is required, not incidental ordering:
 * updateSession() internally builds its response via
 * `NextResponse.next({ request: { headers: request.headers } })`, which
 * is what Next.js reads to determine the request-headers context for
 * rendering. Mutating `request.headers` first means that context (and
 * therefore Server Components' `headers()` / Next's own nonce detection)
 * sees `x-nonce` / `Content-Security-Policy` without needing to touch a
 * single line of updateSession()'s or resolveRouteProtection()'s existing
 * auth/session logic.
 */
export async function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const cspHeader = buildCspHeader(nonce);

  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', cspHeader);

  const { response, user } = await updateSession(request);
  response.headers.set('Content-Security-Policy', cspHeader);

  const decision = resolveRouteProtection(request, user);

  if (decision.action === 'allow') {
    return response;
  }

  const redirectResponse = NextResponse.redirect(decision.url);
  redirectResponse.headers.set('Content-Security-Policy', cspHeader);

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
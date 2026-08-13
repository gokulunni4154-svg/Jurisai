'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Only same-origin relative paths are ever redirected to after sign-in.
 * `redirectTo` comes from the URL query string set by
 * route-protection.ts (File 42) — attacker-controllable if a user
 * follows a crafted link (e.g. ?redirectTo=https://evil.example).
 * Restricting it to a path starting with a single "/" (not "//" or
 * "/\\", both of which browsers can treat as protocol-relative) closes
 * that open-redirect hole rather than trusting the param verbatim.
 */
function sanitizeRedirectTarget(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

/**
 * Client Component: owns all interactive sign-in state and submits to
 * the existing /api/auth/sign-in route (File 37) via fetch, rather than
 * a Server Action — see the chat discussion for the full tradeoff
 * (avoiding a second, duplicate auth code path outside AuthService).
 *
 * OPEN GAP, flagged rather than guessed around: File 37's exact
 * error-response JSON shape was not pasted this session. The failure
 * branch below defensively checks a couple of plausible shapes
 * (matching handleApiError's likely AppError-derived shape, File 21)
 * and falls back to a generic message. This should be verified against
 * File 37's real source and tightened once available — do not treat
 * the current fallback logic as confirmed-correct.
 *
 * NEW, this session: on success, the destination is no longer always
 * '/'. Priority order: (1) an explicit ?redirectTo= query param, set
 * by middleware's route-protection.ts when the user was bounced off a
 * protected page pre-login — this is the user's own originally-
 * intended destination and takes priority over anything else; (2) the
 * server-resolved `redirectTo` now returned by POST /api/auth/sign-in
 * (lawyer -> /lawyer, firm owner -> /firm/[firmId], else '/' — see
 * that route's resolveDashboardRedirect() for the real logic); (3)
 * '/', if neither is present or the response body isn't JSON. Both
 * still pass through sanitizeRedirectTarget() below — the query-param
 * source is user-controllable and needs it regardless of source, and
 * running the server-resolved value through the same function too
 * keeps this a single choke point rather than two.
 *
 * ROUTE CORRECTION: the "Sign up" link below was pointing at
 * `/auth/sign-up`, a stale assumption from before the real route group
 * structure was confirmed. `src/app/(auth)/sign-up/page.tsx` (a Next.js
 * route group, excluded from the URL) actually serves at `/sign-up` —
 * corrected here to match. The "Forgot password?" link still points at
 * `/auth/request-password-reset`, which remains an UNCONFIRMED
 * placeholder — no real page route has been verified for it yet. Do not
 * assume it follows the same route-group convention as sign-in/sign-up
 * without confirming its actual file path first.
 */
export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        let message = 'Unable to sign in. Please check your credentials and try again.';
        try {
          const body = await response.json();
          message = body?.error?.message ?? body?.message ?? message;
        } catch {
          // Response wasn't JSON — keep the generic fallback message.
        }
        setErrorMessage(message);
        setIsSubmitting(false);
        return;
      }

      let responseBody: { redirectTo?: unknown } = {};
      try {
        responseBody = await response.json();
      } catch {
        // Response wasn't JSON — fall through to the '/' default inside
        // sanitizeRedirectTarget() below.
      }

      const queryRedirect = searchParams.get('redirectTo');
      const serverRedirect =
        typeof responseBody.redirectTo === 'string' ? responseBody.redirectTo : null;
      const redirectTarget = sanitizeRedirectTarget(queryRedirect ?? serverRedirect);
      router.push(redirectTarget);
      // Server Components and middleware read the session from cookies
      // per-request. router.push() alone can land on a destination
      // rendered before the sign-in cookie existed; router.refresh()
      // forces the destination to re-fetch server data with the now-
      // valid session.
      router.refresh();
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back to JurisAI.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <Link
              href="/auth/request-password-reset"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>

        {errorMessage !== null && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don&rsquo;t have an account?{' '}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
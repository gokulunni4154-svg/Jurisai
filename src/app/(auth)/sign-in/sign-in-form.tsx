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

      const redirectTarget = sanitizeRedirectTarget(searchParams.get('redirectTo'));
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
        <Link href="/auth/sign-up" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
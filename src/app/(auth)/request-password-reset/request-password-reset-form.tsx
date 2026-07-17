'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

/**
 * Client Component for the password-reset request form.
 *
 * SUCCESS BEHAVIOR IS CONFIRMED, not assumed: File 39's real source
 * shows the API always returns the same generic success response
 * regardless of whether the submitted email is registered, as the
 * HTTP-layer half of AuthService.requestPasswordReset()'s (File 34)
 * anti-enumeration guarantee. This form displays that exact message
 * string from the response body rather than hardcoding its own copy —
 * if File 34/39 ever changes the wording, this component should not
 * need a matching edit.
 *
 * The success state does not offer a "send another" action. Since the
 * response is identical whether or not the account exists, there's no
 * legitimate UX reason to invite resubmission — doing so would just
 * nudge users toward probing for account existence via rate-limit
 * timing, undermining the anti-enumeration design elsewhere in the
 * system. A single link back to sign-in is enough.
 *
 * Same open gap as Files 53/54, carried forward: handleApiError's exact
 * error-response JSON shape (File 21) is still unverified. The failure
 * branch defensively guesses at a couple of plausible shapes.
 */
export function RequestPasswordResetForm() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          body?.error?.message ??
          body?.message ??
          'Unable to process your request. Please try again.';
        setErrorMessage(message);
        setIsSubmitting(false);
        return;
      }

      // File 39 always returns the same generic message regardless of
      // whether the account exists — display it verbatim rather than
      // hardcoding our own copy.
      setSuccessMessage(
        body?.data?.message ??
          'If an account exists for this email address, a password reset link has been sent.',
      );
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  if (successMessage !== null) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">Check your email</h1>
        <p className="text-sm text-muted-foreground">{successMessage}</p>
        <Link
          href="/auth/sign-in"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&rsquo;ll send you a reset link.
        </p>
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
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Remembered your password?{' '}
        <Link href="/auth/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
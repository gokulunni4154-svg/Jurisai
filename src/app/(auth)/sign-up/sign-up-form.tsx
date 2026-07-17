'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/modules/auth/auth.schemas';

/**
 * Client Component: owns all interactive sign-up state and submits to
 * the existing /api/auth/sign-up route (File 36) via fetch, matching
 * File 53's sign-in pattern (avoids a second, duplicate auth code path
 * outside AuthService).
 *
 * SUCCESS BEHAVIOR IS DELIBERATE, confirmed against File 36's real doc
 * comment: with email confirmations enabled, signUp() never establishes
 * a session, so there is nothing to redirect into. A successful submit
 * swaps the form for a static "check your email" panel instead — do not
 * "fix" this into a redirect without first confirming File 12's email
 * confirmation setting has actually changed.
 *
 * `confirmPassword` is a client-only field for mismatch UX and is
 * deliberately stripped before the request body is built — signUpSchema
 * (File 33) is `.strict()` and only accepts email/password/fullName; an
 * extra field would be rejected by the server rather than ignored.
 *
 * OPEN GAP, carried forward from File 53 and not yet resolved: the exact
 * shape of handleApiError's error JSON (File 21) is still unverified.
 * The failure branch defensively checks a couple of plausible shapes and
 * falls back to a generic message.
 */
export function SignUpForm() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/sign-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName }),
      });

      if (!response.ok) {
        let message = 'Unable to create your account. Please try again.';
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

      // No session is established on success (File 36) — show the
      // confirmation panel instead of redirecting anywhere.
      setSubmittedEmail(email);
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  if (submittedEmail !== null) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          We&rsquo;ve sent a confirmation link to{' '}
          <span className="font-medium text-foreground">{submittedEmail}</span>. Follow
          the link to activate your account, then sign in.
        </p>
        <Link
          href="/auth/sign-in"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Create your account</h1>
        <p className="text-sm text-muted-foreground">Get started with JurisAI.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="text-sm font-medium text-foreground">
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>

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
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="password-hint"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <p
            id="password-hint"
            className={
              passwordTooShort
                ? 'text-xs text-destructive'
                : 'text-xs text-muted-foreground'
            }
          >
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
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
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/auth/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
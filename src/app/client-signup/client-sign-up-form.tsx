'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/modules/auth/auth.schemas';

/**
 * Client Component: direct structural mirror of the confirmed real
 * SignUpForm -- same state shape, same confirmPassword-stripped-
 * before-request handling, same "check your email" success panel.
 * signUpAsClient() calls the identical supabase.auth.signUp() under the
 * hood as signUp() (confirmed against its real pasted source this
 * session), so the same email-confirmation-required behavior applies --
 * not assumed, confirmed.
 *
 * THREE real differences from SignUpForm:
 *
 *   1. Reads the invite token from the URL (?invite=<token>) via
 *      useSearchParams() -- required, per signUpAsClient()'s own
 *      signature (inviteToken has no default, unlike signUp()'s
 *      optional one). If absent or empty, the form is never rendered --
 *      an "invalid invitation link" state is shown instead. FLAGGED:
 *      this gating is this session's own judgment, not mirrored from
 *      confirmed source -- no real "invalid invite" UI precedent has
 *      been pasted anywhere in this project.
 *
 *   2. Posts to /api/auth/client-sign-up (this session's new route, see
 *      its own file header), not /api/auth/sign-up, and includes
 *      inviteToken in the JSON body.
 *
 *   3. Copy is client-portal-specific ("Set up your client account")
 *      rather than the generic sign-up copy -- cosmetic only, no
 *      confirmed real copy exists to mirror instead.
 *
 * Same OPEN GAP as SignUpForm, carried forward unresolved: the exact
 * shape of handleApiError's error JSON is still unverified -- same
 * defensive fallback parsing, not newly introduced here.
 *
 * REAL FILE PATH: src/app/client-signup/client-sign-up-form.tsx
 */
export function ClientSignUpForm() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  if (!inviteToken) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">Invalid invitation link</h1>
        <p className="text-sm text-muted-foreground">
          This link is missing or malformed. Ask your firm to resend your invitation.
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/client-sign-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, inviteToken }),
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

      // No session is established on success, same as SignUpForm --
      // show the confirmation panel instead of redirecting anywhere.
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
        <h1 className="text-lg font-semibold text-foreground">Set up your client account</h1>
        <p className="text-sm text-muted-foreground">
          Finish creating your account to access your case portal.
        </p>
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
    </div>
  );
}
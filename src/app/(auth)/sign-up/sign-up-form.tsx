'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/modules/auth/auth.schemas';

/**
 * NEW -- three-way sign-up (this session). Which account type the form
 * is currently collecting. Drives: which extra field is shown
 * (registrationNumber vs firmName vs neither), and which route the form
 * posts to.
 */
type AccountType = 'individual' | 'lawyer' | 'firm';

const ACCOUNT_TYPE_ENDPOINT: Record<AccountType, string> = {
  individual: '/api/auth/sign-up',
  lawyer: '/api/auth/sign-up-lawyer',
  firm: '/api/auth/sign-up-firm',
};

/**
 * Client Component: owns all interactive sign-up state and submits to
 * the existing /api/auth/sign-up route (File 36) via fetch, matching
 * File 53's sign-in pattern (avoids a second, duplicate auth code path
 * outside AuthService).
 *
 * AMENDED -- three-way sign-up (this session). Adds an `accountType`
 * selector ('individual' | 'lawyer' | 'firm'). The form's core fields
 * (fullName/email/password/confirmPassword) are shared across all three
 * -- only the EXTRA field and the POST target change:
 *   - 'individual': no extra field, posts to /api/auth/sign-up
 *     (unchanged from before this session).
 *   - 'lawyer': adds `registrationNumber`, posts to
 *     /api/auth/sign-up-lawyer.
 *   - 'firm': adds `firmName`, posts to /api/auth/sign-up-firm.
 * `confirmPassword` is stripped before the request body is built for
 * all three, same as before -- none of the three schemas
 * (signUpSchema/signUpAsLawyerSchema/signUpAsFirmSchema, all `.strict()`)
 * accept it.
 *
 * SUCCESS BEHAVIOR IS DELIBERATE, confirmed against File 36's real doc
 * comment: with email confirmations enabled, signUp() never establishes
 * a session, so there is nothing to redirect into. A successful submit
 * swaps the form for a static "check your email" panel instead -- do not
 * "fix" this into a redirect without first confirming File 12's email
 * confirmation setting has actually changed. Same behavior confirmed for
 * signUpAsLawyer()/signUpAsFirm() -- both call the same
 * this.supabase.auth.signUp() under the hood.
 *
 * OPEN GAP, carried forward from File 53 and not yet resolved: the exact
 * shape of handleApiError's error JSON (File 21) is still unverified.
 * The failure branch defensively checks a couple of plausible shapes and
 * falls back to a generic message.
 *
 * ROUTE CORRECTION: both "sign in" links below (success panel and
 * footer) were pointing at `/auth/sign-in`, a stale assumption from
 * before the real route group structure was confirmed.
 * `src/app/(auth)/sign-in/page.tsx` (a Next.js route group, excluded
 * from the URL) actually serves at `/sign-in` — corrected here to match.
 */
export function SignUpForm() {
  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [firmName, setFirmName] = useState('');
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
      const body: Record<string, string> = { email, password, fullName };

      if (accountType === 'lawyer') {
        body.registrationNumber = registrationNumber;
      } else if (accountType === 'firm') {
        body.firmName = firmName;
      }

      const response = await fetch(ACCOUNT_TYPE_ENDPOINT[accountType], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let message = 'Unable to create your account. Please try again.';
        try {
          const responseBody = await response.json();
          message = responseBody?.error?.message ?? responseBody?.message ?? message;
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
          href="/sign-in"
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

      <div className="space-y-1.5">
        <span className="text-sm font-medium text-foreground">I am signing up as</span>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setAccountType('individual')}
            aria-pressed={accountType === 'individual'}
            className={
              accountType === 'individual'
                ? 'rounded-md border border-primary bg-primary/10 px-2 py-2 text-xs font-medium text-primary'
                : 'rounded-md border border-input px-2 py-2 text-xs font-medium text-foreground hover:bg-accent'
            }
          >
            Any user
          </button>
          <button
            type="button"
            onClick={() => setAccountType('lawyer')}
            aria-pressed={accountType === 'lawyer'}
            className={
              accountType === 'lawyer'
                ? 'rounded-md border border-primary bg-primary/10 px-2 py-2 text-xs font-medium text-primary'
                : 'rounded-md border border-input px-2 py-2 text-xs font-medium text-foreground hover:bg-accent'
            }
          >
            Individual lawyer
          </button>
          <button
            type="button"
            onClick={() => setAccountType('firm')}
            aria-pressed={accountType === 'firm'}
            className={
              accountType === 'firm'
                ? 'rounded-md border border-primary bg-primary/10 px-2 py-2 text-xs font-medium text-primary'
                : 'rounded-md border border-input px-2 py-2 text-xs font-medium text-foreground hover:bg-accent'
            }
          >
            Lawyer firm
          </button>
        </div>
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

        {accountType === 'firm' && (
          <div className="space-y-1.5">
            <label htmlFor="firmName" className="text-sm font-medium text-foreground">
              Firm name
            </label>
            <input
              id="firmName"
              name="firmName"
              type="text"
              autoComplete="organization"
              required
              value={firmName}
              onChange={(event) => setFirmName(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        )}

        {accountType === 'lawyer' && (
          <div className="space-y-1.5">
            <label htmlFor="registrationNumber" className="text-sm font-medium text-foreground">
              Bar registration number
            </label>
            <input
              id="registrationNumber"
              name="registrationNumber"
              type="text"
              required
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <p className="text-xs text-muted-foreground">
              Submitted for manual verification. You&rsquo;ll be notified once approved.
            </p>
          </div>
        )}

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
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
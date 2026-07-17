'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/modules/auth/auth.schemas';

/**
 * Client Component for the update-password form. Reachable either from
 * a normal signed-in session or the temporary recovery session Supabase
 * establishes after a password-reset email link (File 40's doc
 * comment) — this component does not distinguish between the two.
 *
 * SUCCESS BEHAVIOR — confirmed against File 40's real source only in
 * part: the response is `{ data: { success: true } }`, with no redirect
 * target and no explicit statement that the session is invalidated
 * afterward. This component assumes the session remains valid post-
 * update (nothing in File 40 suggests a sign-out) and redirects to `/`
 * with router.refresh(), the same mechanism File 53 (sign-in) uses. This
 * is an INFERENCE from what File 40 doesn't say, not a confirmed
 * behavior — if a future session confirms updateUser() actually
 * invalidates the session, this should redirect to /auth/sign-in
 * instead. A manual "Continue" link is included as a fallback in case
 * the auto-redirect assumption doesn't hold in practice.
 *
 * `confirmPassword` is client-only, stripped before the request body —
 * updatePasswordSchema (File 33) is `.strict()` and only accepts
 * `newPassword`.
 *
 * Same open gap as prior auth forms: handleApiError's exact
 * error-response JSON shape (File 21) is still unverified.
 */
export function UpdatePasswordForm() {
  const router = useRouter();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });

      if (!response.ok) {
        let message = 'Unable to update your password. Please try again.';
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

      setIsSuccess(true);
      router.push('/');
      router.refresh();
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">Password updated</h1>
        <p className="text-sm text-muted-foreground">
          Your password has been changed successfully. Taking you to your account…
        </p>
        <a href="/" className="inline-block text-sm font-medium text-primary hover:underline">
          Continue
        </a>
      </div>
    );
  }

  const passwordTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Set a new password</h1>
        <p className="text-sm text-muted-foreground">
          Choose a new password for your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="newPassword" className="text-sm font-medium text-foreground">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-describedby="new-password-hint"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <p
            id="new-password-hint"
            className={
              passwordTooShort ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
            }
          >
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
            Confirm new password
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
          {isSubmitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AuthAlert,
  AuthField,
  AuthHeading,
  PasswordField,
  SubmitButton,
} from "@/shared/components/auth/auth-ui";

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
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
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
/**
 * Messages for the `?error=` codes other routes redirect here with:
 * `email_not_confirmed` (middleware, session exists but unconfirmed) and
 * `confirmation_failed` (/api/auth/callback, bad/expired/used code).
 * Unknown codes show nothing -- the param is attacker-controllable, so
 * only a fixed allowlist of static strings is ever rendered.
 */
const REDIRECT_ERROR_MESSAGES: Record<string, string> = {
  email_not_confirmed: "Please confirm your email address before signing in.",
  confirmation_failed:
    "That confirmation link is invalid or has expired. Sign in, or sign up again to get a new link.",
};

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  const errorCode = searchParams.get("error");
  const redirectErrorMessage =
    errorCode !== null && Object.hasOwn(REDIRECT_ERROR_MESSAGES, errorCode)
      ? REDIRECT_ERROR_MESSAGES[errorCode]
      : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    // Field validation (presentation only): blocks an obviously empty or
    // malformed submit and points at the field. Real validation and every
    // authentication decision stay on the server. Messages here never say
    // anything about whether an account exists.
    const nextFieldErrors: { email?: string; password?: string } = {};
    if (email.trim().length === 0) {
      nextFieldErrors.email = "Enter your email address.";
    } else if (!/^\S+@\S+$/.test(email.trim())) {
      nextFieldErrors.email = "Enter a valid email address.";
    }
    if (password.length === 0) {
      nextFieldErrors.password = "Enter your password.";
    }
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.email || nextFieldErrors.password) {
      document
        .getElementById(nextFieldErrors.email ? "email" : "password")
        ?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        let message =
          "Unable to sign in. Please check your credentials and try again.";
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

      const queryRedirect = searchParams.get("redirectTo");
      const serverRedirect =
        typeof responseBody.redirectTo === "string"
          ? responseBody.redirectTo
          : null;
      const redirectTarget = sanitizeRedirectTarget(
        queryRedirect ?? serverRedirect,
      );
      router.push(redirectTarget);
      // Server Components and middleware read the session from cookies
      // per-request. router.push() alone can land on a destination
      // rendered before the sign-in cookie existed; router.refresh()
      // forces the destination to re-fetch server data with the now-
      // valid session.
      router.refresh();
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  const formError = errorMessage ?? redirectErrorMessage;

  return (
    <div className="space-y-7">
      <AuthHeading
        title="Sign in"
        description="Welcome back. Sign in to your JurisAI workspace."
      />

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {formError !== null && <AuthAlert>{formError}</AuthAlert>}

        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />

        <div className="space-y-1.5">
          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
          />
          <div className="flex justify-end">
            <Link
              href="/request-password-reset"
              className="rounded-sm text-meta font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <SubmitButton
          pending={isSubmitting}
          idleLabel="Sign in"
          pendingLabel="Signing in…"
        />
      </form>

      <p className="text-center text-ui text-muted-foreground">
        Don&rsquo;t have an account?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-primary hover:underline"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

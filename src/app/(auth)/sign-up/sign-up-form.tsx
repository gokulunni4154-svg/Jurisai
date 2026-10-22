"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, MailCheck } from "lucide-react";

import {
  AuthAlert,
  AuthField,
  AuthHeading,
  PasswordField,
  SubmitButton,
} from "@/shared/components/auth/auth-ui";
import { cn } from "@/shared/lib/cn";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/modules/auth/auth.schemas";

/**
 * NEW -- three-way sign-up (this session). Which account type the form
 * is currently collecting. Drives: which extra field is shown
 * (registrationNumber vs firmName vs neither), and which route the form
 * posts to.
 */
type AccountType = "individual" | "lawyer" | "firm";

const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{
  value: AccountType;
  label: string;
  description: string;
}> = [
  {
    value: "individual",
    label: "Any user",
    description:
      "Upload and review documents, and send inquiries to lawyers and firms.",
  },
  {
    value: "lawyer",
    label: "Individual lawyer",
    description:
      "Manage matters, hearings and tasks. Your bar registration is verified manually.",
  },
  {
    value: "firm",
    label: "Lawyer firm",
    description: "Create a firm workspace with teams, clients and inquiries.",
  },
];

const ACCOUNT_TYPE_ENDPOINT: Record<AccountType, string> = {
  individual: "/api/auth/sign-up",
  lawyer: "/api/auth/sign-up-lawyer",
  firm: "/api/auth/sign-up-firm",
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
 * SUCCESS BEHAVIOR, AMENDED (General User Email Verification Audit,
 * this session): previously this always swapped in a static "check your
 * email" panel on any successful submit, regardless of whether Supabase
 * actually required confirmation for that account. That silently
 * ignored `emailConfirmationRequired` -- a field the API response
 * already carries (`data.session === null`, per File 36's signUp() and
 * this file's own AuthService.signUpAsClient(), computed the same way).
 * If Supabase's project-level "Confirm email" setting is ever turned
 * off, signUp() DOES establish a session (written to cookies
 * automatically -- buildAuthService() uses the same cookie-bridged
 * client sign-in uses), and the old code would still incorrectly tell
 * the user to go check an email that will never matter.
 *
 * AMENDED AGAIN (email-confirmation audit): `emailConfirmationRequired`
 * is honoured for ALL account types. When it is false a session already
 * exists, so the user is sent straight to their dashboard (individual,
 * lawyer, or firm owner) with no message and no sign-in detour. When it is
 * true (Supabase "Confirm email" on) no session exists, so the "check your
 * email" panel is accurate and unavoidable -- clicking the link signs the
 * user in via /api/auth/callback. An unreadable response defaults to that
 * panel (never assume a session exists).
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
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>("individual");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [firmName, setFirmName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(true);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setConfirmError(null);

    if (password !== confirmPassword) {
      // Field-level (inline) error; the form-level alert is reserved for
      // server/registration failures.
      setConfirmError("Passwords do not match.");
      document.getElementById("confirmPassword")?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      const body: Record<string, string> = { email, password, fullName };

      if (accountType === "lawyer") {
        body["registrationNumber"] = registrationNumber;
      } else if (accountType === "firm") {
        body["firmName"] = firmName;
      }

      const response = await fetch(ACCOUNT_TYPE_ENDPOINT[accountType], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let message = "Unable to create your account. Please try again.";
        try {
          const responseBody = await response.json();
          message =
            responseBody?.error?.message ?? responseBody?.message ?? message;
        } catch {
          // Response wasn't JSON — keep the generic fallback message.
        }
        setErrorMessage(message);
        setIsSubmitting(false);
        return;
      }

      // The API reports whether email confirmation is actually pending
      // (`emailConfirmationRequired`, i.e. `data.session === null`). It is
      // read for EVERY account type so the success message never claims an
      // email was sent when Supabase has already issued a session.
      //   - Unparseable body / field missing -> treated as "confirmation
      //     required" (the safe default: never imply a session exists).
      //   - 'individual' + no confirmation pending -> straight to the
      //     dashboard, unchanged from before.
      //   - 'lawyer'/'firm' + no confirmation pending -> deliberately NOT
      //     auto-redirected (their post-sign-up landing is a separate
      //     product decision, see the professional-verification gate), but
      //     they get an accurate "account created" panel instead of a false
      //     "check your email" one.
      let responseBody: {
        data?: { emailConfirmationRequired?: unknown; firmId?: unknown };
      } = {};
      try {
        responseBody = await response.json();
      } catch {
        // Fall through with the safe default described above.
      }

      if (responseBody.data?.emailConfirmationRequired === false) {
        // A session already exists (cookies were set by the sign-up call),
        // so land the user directly on their dashboard -- no message, no
        // detour through /sign-in. Destinations match the sign-in route's
        // own resolveDashboardRedirect(): lawyer -> /lawyer/dashboard,
        // firm owner -> /firm/[firmId]/dashboard, everyone else ->
        // /general-user/dashboard.
        const firmId = responseBody.data.firmId;
        let destination: string | null = null;
        if (accountType === "individual") {
          destination = "/general-user/dashboard";
        } else if (accountType === "lawyer") {
          destination = "/lawyer/dashboard";
        } else if (typeof firmId === "string" && firmId.length > 0) {
          destination = `/firm/${encodeURIComponent(firmId)}/dashboard`;
        }

        if (destination !== null) {
          router.push(destination);
          // Server Components and middleware read the session from
          // cookies per-request, same reasoning sign-in-form.tsx's own
          // router.refresh() comment documents — matched here too.
          router.refresh();
          return;
        }
        // Firm response without a firmId (should not happen): fall back to
        // the accurate "Account created" panel rather than guessing a URL.
        setConfirmationRequired(false);
      }

      setSubmittedEmail(email);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  if (submittedEmail !== null && !confirmationRequired) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2
          className="mx-auto h-10 w-10 text-success"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <AuthHeading
          title="Account created"
          description={
            <>
              Your account for{" "}
              <span className="font-medium text-foreground">
                {submittedEmail}
              </span>{" "}
              is ready. No email confirmation is needed &mdash; you can sign in
              now.
            </>
          }
        />
        <Link
          href="/sign-in"
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-ui font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (submittedEmail !== null) {
    return (
      <div className="space-y-5 text-center">
        <MailCheck
          className="mx-auto h-10 w-10 text-primary"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <AuthHeading
          title="Check your email"
          description={
            <>
              We&rsquo;ve sent a confirmation link to{" "}
              <span className="font-medium text-foreground">
                {submittedEmail}
              </span>
              . Follow the link to activate your account, then sign in.
            </>
          }
        />
        <Link
          href="/sign-in"
          className="inline-flex h-11 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-ui font-medium text-foreground transition-colors hover:bg-muted"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const selectedOption = ACCOUNT_TYPE_OPTIONS.find(
    (option) => option.value === accountType,
  );

  return (
    <div className="space-y-7">
      <AuthHeading
        title="Create your account"
        description="Choose how you’ll use JurisAI, then enter your details."
      />

      <div
        role="group"
        aria-labelledby="account-type-label"
        className="space-y-2"
      >
        <span
          id="account-type-label"
          className="text-ui font-medium text-foreground"
        >
          I am signing up as
        </span>
        <div className="grid grid-cols-3 gap-2">
          {ACCOUNT_TYPE_OPTIONS.map((option) => {
            const selected = accountType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setAccountType(option.value)}
                aria-pressed={selected}
                className={cn(
                  "min-h-11 rounded-md border px-2 py-2 text-meta font-medium transition-colors",
                  selected
                    ? "border-primary bg-accent text-accent-foreground ring-1 ring-primary"
                    : "border-input bg-background text-foreground hover:bg-muted",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-meta text-muted-foreground" aria-live="polite">
          {selectedOption?.description}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {errorMessage !== null && <AuthAlert>{errorMessage}</AuthAlert>}

        <AuthField
          id="fullName"
          label="Full name"
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />

        {accountType === "firm" && (
          <AuthField
            id="firmName"
            label="Firm name"
            type="text"
            autoComplete="organization"
            required
            value={firmName}
            onChange={(event) => setFirmName(event.target.value)}
          />
        )}

        {accountType === "lawyer" && (
          <AuthField
            id="registrationNumber"
            label="Bar registration number"
            type="text"
            required
            value={registrationNumber}
            onChange={(event) => setRegistrationNumber(event.target.value)}
            hint="Submitted for manual verification. You’ll be notified once approved."
          />
        )}

        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          hintTone={passwordTooShort ? "error" : "muted"}
        />

        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            if (confirmError !== null) setConfirmError(null);
          }}
          error={confirmError}
        />

        <SubmitButton
          pending={isSubmitting}
          idleLabel="Create account"
          pendingLabel="Creating account…"
        />
      </form>

      <p className="text-center text-ui text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

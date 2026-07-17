import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

import {
  AppError,
  ConflictError,
  AuthenticationError,
  ExternalServiceError,
  RateLimitError,
  ErrorCode,
} from '@/core/errors/app-error';
import { mapSupabaseUserToAuthUser } from '@/core/auth/mapper';
import type { AuthUser } from '@/core/auth/types';
import { createAdminClient } from '@/core/supabase/admin';
import type { Database } from '@/core/supabase/database.types';
import { clientEnv } from '@/core/config/env';
import {
  signUpSchema,
  signInSchema,
  requestPasswordResetSchema,
  updatePasswordSchema,
} from './auth.schemas';

/**
 * The role assigned to every new sign-up today. There is deliberately no
 * sign-up-time role selection yet -- lawyer/law_firm/business accounts
 * will need either a distinct sign-up flow or a post-sign-up upgrade
 * path, both real product decisions left unmade here rather than guessed
 * at inside this file.
 */
const DEFAULT_SIGNUP_ROLE = 'individual' as const;

/**
 * Translates a Supabase Auth SDK error into the appropriate AppError
 * subclass. Centralized here so every method below reports failures
 * consistently rather than each re-implementing its own message checks.
 *
 * Order matters: rate-limiting is checked by HTTP status (most reliable),
 * everything else by matching known message substrings, since GoTrue
 * does not expose a stable machine-readable error code for most of these
 * cases via supabase-js today.
 */
function mapSupabaseAuthError(error: AuthError): AppError {
  if (error.status === 429) {
    return new RateLimitError(error.message);
  }

  const message = error.message.toLowerCase();

  if (message.includes('already registered') || message.includes('already exists')) {
    return new ConflictError('An account with this email address already exists.', {
      supabaseMessage: error.message,
    });
  }

  if (message.includes('invalid login credentials')) {
    return new AuthenticationError(
      'Invalid email or password.',
      ErrorCode.AUTH_INVALID_CREDENTIALS,
      { supabaseMessage: error.message },
    );
  }

  if (message.includes('email not confirmed')) {
    return new AuthenticationError(
      'Please confirm your email address before signing in.',
      ErrorCode.AUTH_INVALID_CREDENTIALS,
      { supabaseMessage: error.message },
    );
  }

  return new ExternalServiceError(
    'Supabase Auth',
    `Unexpected Supabase Auth error: ${error.message}`,
    error,
    { status: error.status },
  );
}

/**
 * AuthService
 * -----------
 * Wraps the Supabase Auth SDK for sign-up, sign-in, sign-out, and password
 * reset/change. Unlike ProfileService, this does NOT extend BaseService:
 * BaseService's guard methods (requireAuthentication, requireOwnership,
 * etc.) exist to authorize actions against an already-resolved
 * currentUser, but sign-up and sign-in are precisely the operations that
 * establish a session in the first place -- there is no currentUser yet
 * for most of what this class does.
 *
 * Constructed with an injected RLS-respecting SupabaseClient<Database>
 * (src/core/supabase/server.ts), the same request-scoped client
 * ProfileRepository uses -- NOT the admin client. The one place this
 * class does reach for the admin client (signUp's role assignment) is
 * called out explicitly at that call site, per admin.ts's own
 * documented expectation that using it be a deliberate, reviewable
 * decision.
 */
export class AuthService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Creates a new account.
   *
   * Two distinct failure modes are handled before any success can be
   * reported:
   *
   * 1. A real AuthError from Supabase (network issue, weak password
   *    rejected server-side, etc.) -- translated via mapSupabaseAuthError.
   *
   * 2. A "successful" response for an email that is already registered
   *    and confirmed. With email confirmations enabled (File 12),
   *    Supabase deliberately does NOT return an error for this case --
   *    it returns a sanitized, fake user object with an EMPTY
   *    `identities` array, specifically to prevent an attacker from
   *    using signUp() to probe which emails are already registered. This
   *    is detected explicitly via `identities.length === 0` and converted
   *    into a real ConflictError; without this check, a duplicate sign-up
   *    would silently "succeed" from the caller's point of view.
   *
   * Only after confirming this is a genuine new account does this method
   * reach for the admin client to assign DEFAULT_SIGNUP_ROLE via
   * app_metadata -- the only way to set it, since app_metadata is not
   * writable through the regular client SDK by design (see types.ts).
   *
   * If that role-assignment call itself fails, the account now exists in
   * auth.users with no role -- exactly the corrupted state mapper.ts is
   * built to catch loudly on first sign-in. This method surfaces that
   * immediately instead, as an ExternalServiceError, rather than
   * reporting sign-up as successful when a required step failed.
   */
  async signUp(rawInput: unknown): Promise<{
    userId: string;
    email: string;
    emailConfirmationRequired: boolean;
  }> {
    const { email, password, fullName } = signUpSchema.parse(rawInput);

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) {
      throw mapSupabaseAuthError(error);
    }

    if (!data.user) {
      throw new ExternalServiceError(
        'Supabase Auth',
        'Sign-up succeeded but no user was returned.',
      );
    }

    if (data.user.identities?.length === 0) {
      throw new ConflictError('An account with this email address already exists.');
    }

    // Deliberate, reviewable use of the RLS-bypassing admin client --
    // app_metadata cannot be set any other way. See class-level comment.
    const admin = createAdminClient();
    const { error: roleAssignmentError } = await admin.auth.admin.updateUserById(
      data.user.id,
      { app_metadata: { role: DEFAULT_SIGNUP_ROLE } },
    );

    if (roleAssignmentError) {
      throw new ExternalServiceError(
        'Supabase Auth Admin API',
        'Account was created but default role assignment failed. ' +
          'This account cannot sign in until a role is assigned.',
        roleAssignmentError,
        { userId: data.user.id },
      );
    }

    return {
      userId: data.user.id,
      email: data.user.email ?? email,
      emailConfirmationRequired: data.session === null,
    };
  }

  /**
   * Signs in with email and password. On success, Supabase has re-fetched
   * the user's current app_metadata, which by this point should carry
   * the role assigned during signUp(). mapSupabaseUserToAuthUser() throws
   * InternalServerError if it doesn't -- correctly surfacing that as a
   * data-integrity bug (e.g. this account's role-assignment step failed
   * at sign-up) rather than misreporting it as a credentials failure.
   */
  async signIn(rawInput: unknown): Promise<AuthUser> {
    const { email, password } = signInSchema.parse(rawInput);

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw mapSupabaseAuthError(error);
    }

    if (!data.user) {
      throw new ExternalServiceError(
        'Supabase Auth',
        'Sign-in succeeded but no user was returned.',
      );
    }

    return mapSupabaseUserToAuthUser(data.user);
  }

  /**
   * Signs out the current session. Idempotent from the caller's
   * perspective -- signing out when already signed out is not treated as
   * an error by Supabase, and this method follows that.
   */
  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();

    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }

  /**
   * Requests a password-reset email. Supabase's resetPasswordForEmail
   * does not reveal whether the address is registered -- it responds the
   * same way regardless, by design -- so this method does not need to
   * (and must not) swallow errors to avoid leaking that information
   * itself; only genuine infrastructure failures (rate limiting, network)
   * surface as errors here.
   */
  async requestPasswordReset(rawInput: unknown): Promise<void> {
    const { email } = requestPasswordResetSchema.parse(rawInput);

    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
    });

    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }

  /**
   * Sets a new password. Requires the Supabase client passed into this
   * service to already carry an authenticated session -- either a normal
   * signed-in session, or the temporary recovery session Supabase
   * establishes when a user follows a password-reset link. Distinguishing
   * those two cases, if ever needed, is the caller's (Route Handler's)
   * responsibility, not this method's.
   */
  async updatePassword(rawInput: unknown): Promise<void> {
    const { newPassword } = updatePasswordSchema.parse(rawInput);

    const { error } = await this.supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }
}
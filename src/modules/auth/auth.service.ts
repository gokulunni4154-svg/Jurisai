import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

import {
  AppError,
  ConflictError,
  AuthenticationError,
  ExternalServiceError,
  RateLimitError,
  ValidationError,
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
import { FirmInvitationRepository } from '@/modules/user-management/firm-invitation.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { ClientInvitationRepository } from '@/modules/user-management/client-invitation.repository';
import { ClientRepository } from '@/modules/user-management/client.repository';

/**
 * The role assigned to every new sign-up today. There is deliberately no
 * sign-up-time role selection yet -- lawyer/law_firm/business accounts
 * will need either a distinct sign-up flow or a post-sign-up upgrade
 * path, both real product decisions left unmade here rather than guessed
 * at inside this file.
 */
const DEFAULT_SIGNUP_ROLE = 'individual' as const;

/**
 * NEW, Client Management (this session). The role assigned to every
 * account created via signUpAsClient() — always `'client'`, never
 * DEFAULT_SIGNUP_ROLE. Deliberately a SEPARATE constant, not a
 * parameter on signUp() with a different default: a client account is
 * never `'individual'` at any point, even transiently — see
 * signUpAsClient()'s own doc comment for why this had to be a distinct
 * method rather than a signUp() variant.
 */
const CLIENT_SIGNUP_ROLE = 'client' as const;

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
 * class does reach for the admin client (signUp's role assignment, and
 * now signUp's invite-token handling below) is called out explicitly at
 * that call site, per admin.ts's own documented expectation that using
 * it be a deliberate, reviewable decision.
 *
 * AMENDED THIS SESSION -- Invitation System, Decision #13. signUp() gained
 * a new optional `inviteToken` parameter. Deliberately NOT added as a new
 * constructor dependency (FirmInvitationRepository/FirmMemberRepository/
 * AuditLogRepository are not injected here) -- that would ripple into
 * every route that constructs AuthService (sign-in, sign-out, password
 * reset), none of which touch invitations. Instead, all three are
 * constructed locally inside signUp() off the same `admin` client the
 * role-assignment step already reaches for -- not a new pattern, the
 * exact one this file already established for that step.
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
   *
   * NEW -- Decision #13 (Invitation System, token-based new-user
   * acceptance). If `inviteToken` is supplied, this method runs ONE more
   * step after role assignment succeeds: validate the token against
   * `firm_invitations` and, if valid, insert the resulting `firm_members`
   * row using `data.user.id` -- all within this same call, per the
   * confirmed trigger behavior (`handle_new_user()` on
   * 20260711120000_create_profiles_table.sql fires `after insert on
   * auth.users`, `security definer`, no gating on
   * `email_confirmed_at` -- so `profiles` is guaranteed to exist by now
   * regardless of pending email confirmation).
   *
   * Same "surface it loudly, don't report false success" discipline as
   * the role-assignment step: an invalid/expired/already-used token
   * throws explicitly rather than silently skipping the firm-join step
   * while still returning a 2xx sign-up response. The one exception is
   * an unrecognized token specifically -- this throws a ValidationError
   * (400) rather than silently creating an account with no firm
   * membership, since a bad token in the sign-up URL is a caller-facing
   * input problem, not an infrastructure failure like the role-assignment
   * branch above.
   *
   * `firmMemberRepository.create()`'s own inherited BaseRepository error
   * handling already throws a DatabaseError if that insert fails -- no
   * separate explicit error path is added here beyond letting that
   * propagate, since it already satisfies the "don't silently report
   * success" requirement without duplicating logic.
   */
  async signUp(
    rawInput: unknown,
    inviteToken?: string,
  ): Promise<{
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

    // NEW -- Decision #13. Same admin client already in scope above,
    // reused here rather than constructing a second one. See class-level
    // comment for why these repositories are constructed locally instead
    // of being added to this class's constructor.
    if (inviteToken) {
      const firmInvitationRepository = new FirmInvitationRepository(admin);
      const firmMemberRepository = new FirmMemberRepository(admin);
      const auditLogRepository = new AuditLogRepository(admin);

      const invitation = await firmInvitationRepository.findByToken(inviteToken);

      if (!invitation) {
        throw new ValidationError('This invitation link is invalid.', { inviteToken });
      }

      if (invitation.status !== 'pending') {
        throw new ConflictError('This invitation is no longer valid.', {
          currentStatus: invitation.status,
        });
      }

      if (new Date(invitation.expires_at) < new Date()) {
        await firmInvitationRepository.update(invitation.id, { status: 'expired' });
        throw new ConflictError('This invitation has expired.');
      }

      await firmMemberRepository.create({
        firm_id: invitation.firm_id,
        profile_id: data.user.id,
        role: invitation.role,
      });

      await firmInvitationRepository.update(invitation.id, {
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        profile_id: data.user.id,
      });

      await auditLogRepository.recordUserAction({
        actorId: data.user.id,
        firmId: invitation.firm_id,
        action: 'firm_invitation.accept',
        resourceType: 'firm_invitations',
        resourceId: invitation.id,
        metadata: { role: invitation.role, viaSignUp: true },
      });
    }

    return {
      userId: data.user.id,
      email: data.user.email ?? email,
      emailConfirmationRequired: data.session === null,
    };
  }

  /**
   * NEW, Client Management (this session). Creates a new account via the
   * client-portal token-link acceptance path
   * (client_invitations, deviation #2 in
   * 20260813000000_create_client_invitations_table.sql — TOKEN-LINK
   * ONLY, no existing-profile branch).
   *
   * DELIBERATELY A SEPARATE METHOD FROM signUp(), not a parameter
   * variant of it, for two real structural reasons found by re-reading
   * signUp()'s own confirmed source, not assumed ahead of time:
   *
   * 1. ROLE ASSIGNMENT IS DIFFERENT, NOT ADDITIVE. signUp() always
   *    assigns DEFAULT_SIGNUP_ROLE ('individual') first, and firm
   *    membership (if any) is layered on top of that as a separate,
   *    optional step — an account can validly be 'individual' with no
   *    firm at all. A client account must never pass through
   *    'individual' even momentarily; it is CLIENT_SIGNUP_ROLE
   *    ('client') from the moment role-assignment succeeds. Reusing
   *    signUp()'s DEFAULT_SIGNUP_ROLE constant here would be wrong, not
   *    just redundant.
   *
   * 2. THIS IS AN UPDATE, NOT AN INSERT. signUp()'s firm-join step calls
   *    firmMemberRepository.create({...}) — a brand-new firm_members
   *    row, because firm membership doesn't exist until sign-up creates
   *    it. The client analog is the opposite: the `clients` row already
   *    exists (created by a team lead/firm admin BEFORE the invite was
   *    ever sent — see the clients migration's own header and the
   *    locked product decision this mirrors). So this method calls
   *    clientRepository.update(invitation.client_id, { profile_id:
   *    data.user.id }) — linking an existing record — never create().
   *
   * `inviteToken` is REQUIRED here, unlike signUp()'s optional one:
   * there is no such thing as a self-registered client account with no
   * invitation — every client_invitations row always targets a
   * pre-existing clients row (deviation #1), so a client signup with no
   * token is a caller-input error, not a valid "no firm" state the way
   * an inviteToken-less signUp() call is.
   *
   * SAME ACCEPTED TRADE-OFF AS signUp()'s OWN FIRM-JOIN STEP, carried
   * over deliberately, not overlooked: token validation happens AFTER
   * the Supabase Auth account and role are already created, because
   * `data.user.id` is needed first to link the clients row. If the
   * token then turns out invalid/expired, a real 'client'-roled auth
   * account now exists with no linked clients row — an orphaned-but-
   * recoverable state, not a corrupted one, same class of accepted risk
   * base.repository.ts's own class doc comment documents generally for
   * this project's lack of a cross-call transaction primitive. Not
   * re-litigated here; flagged per that comment's own instruction.
   *
   * DECIDED THIS SESSION (delegated: "u can decide") — reuses
   * signUpSchema unmodified, deliberately NOT locking/pre-filling
   * fullName or email against the invited clients row. Two real
   * reasons, not just left-as-is by default:
   *
   *   1. The invite TOKEN is what actually establishes identity here —
   *      clientRepository.update(invitation.client_id, { profile_id })
   *      below links the account by token match alone, regardless of
   *      what email/fullName was submitted at signup. Locking those
   *      fields would add UI friction without closing any real gap in
   *      how identity is established.
   *   2. No email-sending mechanism keyed off clients.email is
   *      confirmed to exist anywhere in this project — createInvitation()
   *      only returns inviteUrl to its caller; nothing pasted or
   *      confirmed this session actually emails it to clients.email.
   *      Enforcing a match against clients.email would guard against a
   *      risk (login email diverging from the firm's on-file email)
   *      that has no confirmed real consequence today.
   *
   * Revisit if/when a real email-delivery path or a clients.email-
   * dependent notification feature is built and pasted.
   */
  async signUpAsClient(
    rawInput: unknown,
    inviteToken: string,
  ): Promise<{
    userId: string;
    email: string;
    emailConfirmationRequired: boolean;
  }> {
    if (!inviteToken) {
      throw new ValidationError('An invitation token is required to create a client account.');
    }

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
    // app_metadata cannot be set any other way. See class-level comment
    // and signUp()'s own identical use of this pattern.
    const admin = createAdminClient();
    const { error: roleAssignmentError } = await admin.auth.admin.updateUserById(
      data.user.id,
      { app_metadata: { role: CLIENT_SIGNUP_ROLE } },
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

    const clientInvitationRepository = new ClientInvitationRepository(admin);
    const clientRepository = new ClientRepository(admin);
    const auditLogRepository = new AuditLogRepository(admin);

    const invitation = await clientInvitationRepository.findByToken(inviteToken);

    if (!invitation) {
      throw new ValidationError('This invitation link is invalid.', { inviteToken });
    }

    if (invitation.status !== 'pending') {
      throw new ConflictError('This invitation is no longer valid.', {
        currentStatus: invitation.status,
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await clientInvitationRepository.update(invitation.id, { status: 'expired' });
      throw new ConflictError('This invitation has expired.');
    }

    // Links the EXISTING clients row to the new profile -- update(),
    // never create(). See this method's own doc comment, reason #2.
    await clientRepository.update(invitation.client_id, {
      profile_id: data.user.id,
    });

    await clientInvitationRepository.update(invitation.id, {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    });

    await auditLogRepository.recordUserAction({
      actorId: data.user.id,
      firmId: invitation.firm_id,
      action: 'client_invitation.accept',
      resourceType: 'client_invitations',
      resourceId: invitation.id,
      metadata: { clientId: invitation.client_id, viaSignUp: true },
    });

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
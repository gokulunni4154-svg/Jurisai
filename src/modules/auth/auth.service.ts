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
  signUpAsLawyerSchema,
  signUpAsFirmSchema,
  signInSchema,
  requestPasswordResetSchema,
  updatePasswordSchema,
} from './auth.schemas';
import { FirmInvitationRepository } from '@/modules/user-management/firm-invitation.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import { ClientInvitationRepository } from '@/modules/user-management/client-invitation.repository';
import { ClientRepository } from '@/modules/user-management/client.repository';
import { FirmRepository } from '@/modules/billing/firm.repository';
import { ProfileRepository } from '@/modules/profiles/profile.repository';
// FLAGGED, UNCONFIRMED IMPORT PATH: the pasted professional-verification
// repository source had no module-path header comment the way
// firm.repository.ts did ("// src/modules/billing/firm.repository.ts").
// This path is assumed by this project's own confirmed convention
// (cross-module imports use @/modules/<module>/<file>) -- correct if the
// real module folder name differs.
import { ProfessionalVerificationRepository } from '@/modules/professional-verification/professional-verification.repository';

/**
 * The role assigned to every new sign-up today. There is deliberately no
 * sign-up-time role selection yet -- lawyer/law_firm/business accounts
 * will need either a distinct sign-up flow or a post-sign-up upgrade
 * path, both real product decisions left unmade here rather than guessed
 * at inside this file.
 *
 * AMENDED, three-way sign-up (this session): the "distinct sign-up flow"
 * mentioned above now exists (signUpAsLawyer/signUpAsFirm below), but
 * DEFAULT_SIGNUP_ROLE itself is UNCHANGED and is reused by both new
 * methods -- see each method's own doc comment for why role and firm
 * standing are deliberately kept as separate axes, not conflated.
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
 * CORRECTED, this session. The role assigned by signUpAsLawyer() --
 * always `'lawyer'`, never DEFAULT_SIGNUP_ROLE.
 *
 * This reverses signUpAsLawyer()'s original reasoning (see that
 * method's own doc comment, kept below with a correction note rather
 * than silently deleted, per this project's Source Verification Rule).
 * The original reasoning -- that UserRole and firm standing are
 * separate axes, so a solo lawyer only needs firm_members.role: 'owner'
 * -- was sound in the abstract but wrong for THIS codebase specifically.
 * Confirmed via real pasted source, not re-guessed:
 *
 *   - types.ts's real UserRole union already contains 'lawyer' as a
 *     distinct top-level value, separate from FirmRole (types.ts's own
 *     header documents this as two independent axes -- UserRole is NOT
 *     meant to only ever be 'individual' outside of admin/support/client
 *     accounts, as the original reasoning assumed).
 *   - LawyerDashboardService#getDashboard() (real, pasted) calls
 *     this.requireRole('lawyer') -- gated on AuthUser.role, i.e.
 *     app_metadata.role, NOT firm_members.role. That file's own header,
 *     decision #2, confirms this was a deliberate choice: "a dashboard
 *     identity check is a UserRole question."
 *
 * A lawyer signing up via signUpAsLawyer() with role left at
 * DEFAULT_SIGNUP_ROLE ('individual') would be 403'd from their own
 * dashboard. This constant exists so that can't happen.
 */
const LAWYER_SIGNUP_ROLE = 'lawyer' as const;

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
 *
 * AMENDED, three-way sign-up (this session). Two new methods,
 * signUpAsLawyer() and signUpAsFirm(), follow the SAME "construct
 * dependencies locally off the admin client inside the method" pattern
 * as signUp()'s invite-token branch above -- deliberately NOT built by
 * reusing FirmService.createFirm(), even though that method's real,
 * pasted source does almost exactly what's needed here. FirmService
 * extends BaseService and its createFirm() calls
 * this.requireAuthentication() -- which requires an already-established
 * session. At the point signUpAsLawyer()/signUpAsFirm() run, the
 * Supabase Auth user may exist but no session is guaranteed yet (email
 * confirmations are enabled per File 12, same as signUp() itself), so
 * there is no currentUser for BaseService to resolve. The firm-creation
 * SEQUENCE mirrors FirmService.createFirm() exactly (create firm ->
 * create owner firm_members row -> set profiles.firm_id only if unset ->
 * audit 'firm.create') since that sequence is real, confirmed, pasted
 * source -- only the AUTHORIZATION MECHANISM differs, because it has to.
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
        emailRedirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
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
   * NEW -- three-way sign-up (this session). Individual (solo) lawyer
   * sign-up.
   *
   * Steps 1-3 (create Supabase Auth user, detect the fake-user-already-
   * registered case, assign a role) are otherwise identical to signUp()
   * above, EXCEPT role assignment uses LAWYER_SIGNUP_ROLE ('lawyer'),
   * not DEFAULT_SIGNUP_ROLE.
   *
   * CORRECTED, this session -- REVERSES this method's original
   * reasoning, not an extension of it. The original doc comment here
   * argued role should stay 'individual', on the theory that
   * app_metadata.role and firm standing are separate axes in this
   * codebase (true in general -- see signUp()'s inviteToken branch) and
   * that firm_members.role: 'owner' alone is what should carry "this
   * person runs a practice." That theory turned out not to hold for
   * this specific role value: types.ts's real UserRole union already
   * defines 'lawyer' as a distinct top-level value (separate from
   * FirmRole), and LawyerDashboardService#getDashboard() (real, pasted)
   * gates on exactly that -- this.requireRole('lawyer') checks
   * AuthUser.role, not firm_members.role. Left at DEFAULT_SIGNUP_ROLE,
   * a lawyer created by this method would be 403'd from /lawyer, their
   * own dashboard, immediately after signing up. See
   * LAWYER_SIGNUP_ROLE's own doc comment above for the full source
   * citations. Kept this correction note rather than deleting the
   * original reasoning silently, per this project's Source
   * Verification Rule -- future sessions should see WHY this changed,
   * not just that it did.
   *
   * Firm-creation SEQUENCE (steps 4-6) mirrors FirmService.createFirm()'s
   * real, confirmed source exactly -- see class-level comment for why it
   * can't literally call that method:
   *   4. firmRepository.create({ name, owner_id }) -- a solo-practice
   *      firm, name defaulted from the lawyer's own full name since
   *      signUpAsLawyerSchema has no firmName field (unlike
   *      signUpAsFirmSchema below).
   *   5. firmMemberRepository.create({ firm_id, profile_id, role: 'owner' })
   *      -- same owner-row-creation step createFirm() itself performs.
   *   6. profileRepository.update(userId, { firm_id }) -- ALWAYS run
   *      here, never conditional on an existing value, unlike
   *      createFirm()'s "only if not already set" check. That
   *      conditional exists in createFirm() to support a profile that
   *      already has a primary firm from EXISTING membership elsewhere;
   *      it cannot apply here because handle_new_user() (confirmed via
   *      real pasted source) only ever inserts (id, full_name) --
   *      profiles.firm_id is guaranteed null for a signup this method
   *      just created moments ago.
   *
   * Step 7: professionalVerificationRepository.create() with
   * status: 'pending' and the submitted registration_number. This is
   * what actually gates lawyer-only features later -- NOT the account
   * role, NOT firm_members.role. Deliberately leaves the `role` column
   * on professional_verifications unset: its real accepted values were
   * not confirmed/pasted this session (VerificationStatus, the sibling
   * enum for `status`, IS confirmed; `role` is not), so setting it would
   * be a guess this project's own Source Verification Rule exists to
   * prevent.
   *
   * Step 8: one audit entry, action 'firm.create' (matching
   * FirmService.createFirm()'s own convention exactly, since this is
   * functionally the same event) with metadata noting `viaSignUp: true`
   * and `solo: true` -- mirrors the `viaSignUp: true` marker signUp()'s
   * own invite-token branch already uses to distinguish sign-up-time
   * firm events from ones created via the authenticated FirmService
   * route later.
   *
   * SAME non-transactional risk already accepted project-wide
   * (BaseRepository has no transaction primitive) -- now a FIVE-step
   * sequential chain (auth user -> role -> firm -> firm_members ->
   * profile.firm_id -> verification -> audit) with no rollback if a
   * later step fails. Flagged per this project's own stated policy
   * (flag new instances in the method's own doc comment, not
   * re-litigate the general architecture choice) -- not fixed here.
   */
  async signUpAsLawyer(rawInput: unknown): Promise<{
    userId: string;
    email: string;
    emailConfirmationRequired: boolean;
  }> {
    const { email, password, fullName, registrationNumber } =
      signUpAsLawyerSchema.parse(rawInput);

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
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

    const admin = createAdminClient();
    const { error: roleAssignmentError } = await admin.auth.admin.updateUserById(
      data.user.id,
      { app_metadata: { role: LAWYER_SIGNUP_ROLE } },
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

    const firmRepository = new FirmRepository(admin);
    const firmMemberRepository = new FirmMemberRepository(admin);
    const profileRepository = new ProfileRepository(admin);
    const professionalVerificationRepository = new ProfessionalVerificationRepository(admin);
    const auditLogRepository = new AuditLogRepository(admin);

    const firm = await firmRepository.create({
      name: `${fullName} — Independent Practice`,
      owner_id: data.user.id,
    });

    await firmMemberRepository.create({
      firm_id: firm.id,
      profile_id: data.user.id,
      role: 'owner',
    });

    // Always set, never conditional -- see this method's own doc comment,
    // step 6, for why createFirm()'s "only if not already set" guard
    // doesn't apply to a profile this method just created.
    await profileRepository.update(data.user.id, {
      firm_id: firm.id,
    });

    await professionalVerificationRepository.create({
      profile_id: data.user.id,
      registration_number: registrationNumber,
      status: 'pending',
    });

    await auditLogRepository.recordUserAction({
      actorId: data.user.id,
      firmId: firm.id,
      action: 'firm.create',
      resourceType: 'firm',
      resourceId: firm.id,
      metadata: { name: firm.name, viaSignUp: true, solo: true },
    });

    return {
      userId: data.user.id,
      email: data.user.email ?? email,
      emailConfirmationRequired: data.session === null,
    };
  }

  /**
   * NEW -- three-way sign-up (this session). Lawyer-firm sign-up.
   *
   * Identical to signUpAsLawyer() above except:
   *   - Firm name is the real, given `firmName` from
   *     signUpAsFirmSchema, never defaulted from fullName (a firm
   *     registering itself has a real name to give; a solo lawyer
   *     often doesn't think of themselves as "a firm" and shouldn't be
   *     forced to name one).
   *   - NO professional_verifications row is created for the signing
   *     user. Deliberate, not an oversight: the person registering a
   *     firm account may be an office administrator or managing
   *     partner, not a practicing lawyer themselves. Individual
   *     lawyers at this firm are added afterward through the existing,
   *     already-confirmed FirmMemberService/invitation flow, and each
   *     of THEM would go through their own verification at that point
   *     (a future concern, not solved by this method).
   *
   * CORRECTION NOTE, this session: signUpAsLawyer() above now assigns
   * LAWYER_SIGNUP_ROLE ('lawyer') instead of DEFAULT_SIGNUP_ROLE -- see
   * that method's doc comment and LAWYER_SIGNUP_ROLE's own comment for
   * why. That change does NOT extend to this method: no confirmed
   * source (this session or prior) establishes a comparable top-level
   * 'law_firm' role requirement the way LawyerDashboardService did for
   * 'lawyer' -- the person signing up here may not even be a lawyer
   * (see the professional_verifications point above). signUpAsFirm()
   * therefore still correctly uses DEFAULT_SIGNUP_ROLE ('individual'),
   * unchanged. Revisit only if/when a real role-gated firm-owner/admin
   * dashboard check is pasted and confirmed to require otherwise --
   * don't infer this by analogy to the lawyer case.
   *
   * For every other step, this method mirrors signUpAsLawyer()'s
   * firm-creation sequence (firm -> owner firm_members row ->
   * unconditional profiles.firm_id set -> audit 'firm.create') and
   * accepts the same non-transactional risk, flagged there, not
   * re-litigated here.
   */
  async signUpAsFirm(rawInput: unknown): Promise<{
    userId: string;
    email: string;
    emailConfirmationRequired: boolean;
  }> {
    const { email, password, fullName, firmName } = signUpAsFirmSchema.parse(rawInput);

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
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

    const firmRepository = new FirmRepository(admin);
    const firmMemberRepository = new FirmMemberRepository(admin);
    const profileRepository = new ProfileRepository(admin);
    const auditLogRepository = new AuditLogRepository(admin);

    const firm = await firmRepository.create({
      name: firmName,
      owner_id: data.user.id,
    });

    await firmMemberRepository.create({
      firm_id: firm.id,
      profile_id: data.user.id,
      role: 'owner',
    });

    await profileRepository.update(data.user.id, {
      firm_id: firm.id,
    });

    await auditLogRepository.recordUserAction({
      actorId: data.user.id,
      firmId: firm.id,
      action: 'firm.create',
      resourceType: 'firm',
      resourceId: firm.id,
      metadata: { name: firm.name, viaSignUp: true, solo: false },
    });

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
        emailRedirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/api/auth/callback`,
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
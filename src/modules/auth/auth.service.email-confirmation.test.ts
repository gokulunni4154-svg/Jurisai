import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError, ErrorCode } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';

import { AuthService } from './auth.service';

/**
 * Email-confirmation behaviour of AuthService (audit: signup says "check
 * your email" but users could sign in without confirming).
 *
 * Covers: sign-in rejecting/revoking unconfirmed sessions, confirmed
 * sign-in still working, and every sign-up variant (incl. invitation-based
 * ones) reporting `emailConfirmationRequired` from the REAL session state
 * rather than assuming it.
 */
vi.mock('server-only', () => ({}));

vi.mock('@/core/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/core/auth/mapper', () => ({ mapSupabaseUserToAuthUser: vi.fn() }));
vi.mock('@/core/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: 'https://app.jurisai.test' },
}));

const repo = vi.hoisted(() => ({
  invitationFindByToken: vi.fn(),
  invitationUpdate: vi.fn(),
  memberCreate: vi.fn(),
  auditRecord: vi.fn(),
  clientInvitationFindByToken: vi.fn(),
  clientInvitationUpdate: vi.fn(),
  clientUpdate: vi.fn(),
  firmCreate: vi.fn(),
  profileUpdate: vi.fn(),
  verificationCreate: vi.fn(),
}));

vi.mock('@/modules/user-management/firm-invitation.repository', () => ({
  FirmInvitationRepository: vi.fn(() => ({
    findByToken: repo.invitationFindByToken,
    update: repo.invitationUpdate,
  })),
}));
vi.mock('@/modules/user-management/firm-member.repository', () => ({
  FirmMemberRepository: vi.fn(() => ({ create: repo.memberCreate })),
}));
vi.mock('@/modules/audit-log/audit-log.repository', () => ({
  AuditLogRepository: vi.fn(() => ({ recordUserAction: repo.auditRecord })),
}));
vi.mock('@/modules/user-management/client-invitation.repository', () => ({
  ClientInvitationRepository: vi.fn(() => ({
    findByToken: repo.clientInvitationFindByToken,
    update: repo.clientInvitationUpdate,
  })),
}));
vi.mock('@/modules/user-management/client.repository', () => ({
  ClientRepository: vi.fn(() => ({ update: repo.clientUpdate })),
}));
vi.mock('@/modules/billing/firm.repository', () => ({
  FirmRepository: vi.fn(() => ({ create: repo.firmCreate })),
}));
vi.mock('@/modules/profiles/profile.repository', () => ({
  ProfileRepository: vi.fn(() => ({ update: repo.profileUpdate })),
}));
vi.mock('@/modules/professional-verification/professional-verification.repository', () => ({
  ProfessionalVerificationRepository: vi.fn(() => ({ create: repo.verificationCreate })),
}));

import { createAdminClient } from '@/core/supabase/admin';
import { mapSupabaseUserToAuthUser } from '@/core/auth/mapper';

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedMapper = vi.mocked(mapSupabaseUserToAuthUser);

const SIGN_UP = { email: 'new@example.com', password: 'SuperSecret123', fullName: 'New User' };
const SIGN_IN = { email: 'new@example.com', password: 'SuperSecret123' };

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: SIGN_IN.email,
    emailVerified: true,
    role: 'individual',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: null,
    ...overrides,
  };
}

describe('AuthService: email confirmation', () => {
  let supabase: {
    auth: { signUp: ReturnType<typeof vi.fn>; signInWithPassword: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };
  };
  let service: AuthService;

  const signUpResult = (session: unknown) => ({
    data: {
      user: { id: 'user-1', email: SIGN_UP.email, identities: [{ id: 'identity-1' }] },
      session,
    },
    error: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = {
      auth: { signUp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn().mockResolvedValue({ error: null }) },
    };
    mockedCreateAdminClient.mockReturnValue({
      auth: { admin: { updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }) } },
    } as unknown as ReturnType<typeof createAdminClient>);
    service = new AuthService(supabase as unknown as SupabaseClient<Database>);
  });

  describe('signIn', () => {
    it('signs a confirmed account in normally and leaves the session alone', async () => {
      const confirmed = authUser({ emailVerified: true });
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-1' }, session: { access_token: 't' } },
        error: null,
      });
      mockedMapper.mockReturnValue(confirmed);

      await expect(service.signIn(SIGN_IN)).resolves.toBe(confirmed);
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it('rejects an unconfirmed account and revokes the session Supabase issued', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: 'user-1' }, session: { access_token: 't' } },
        error: null,
      });
      mockedMapper.mockReturnValue(authUser({ emailVerified: false }));

      const thrown = await service.signIn(SIGN_IN).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(AuthenticationError);
      expect((thrown as AuthenticationError).message).toBe(
        'Please confirm your email address before signing in.',
      );
      expect((thrown as AuthenticationError).code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
      expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('still surfaces the "Email not confirmed" error Supabase itself raises', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { name: 'AuthError', message: 'Email not confirmed', status: 400 },
      });

      const thrown = await service.signIn(SIGN_IN).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(AuthenticationError);
      expect(mockedMapper).not.toHaveBeenCalled();
    });
  });

  describe('sign-up reports the real authentication state', () => {
    it('signUp: confirmation required when no session was issued', async () => {
      supabase.auth.signUp.mockResolvedValue(signUpResult(null));
      await expect(service.signUp(SIGN_UP)).resolves.toMatchObject({ emailConfirmationRequired: true });
    });

    it('signUp: NOT required when Supabase issued a session (confirm-email off)', async () => {
      supabase.auth.signUp.mockResolvedValue(signUpResult({ access_token: 't' }));
      await expect(service.signUp(SIGN_UP)).resolves.toMatchObject({ emailConfirmationRequired: false });
    });

    it('signUpAsLawyer: flag follows the session', async () => {
      repo.firmCreate.mockResolvedValue({ id: 'firm-1', name: 'x' });
      const input = { ...SIGN_UP, registrationNumber: 'MH/1234/2020' };

      supabase.auth.signUp.mockResolvedValueOnce(signUpResult(null));
      await expect(service.signUpAsLawyer(input)).resolves.toMatchObject({ emailConfirmationRequired: true });

      supabase.auth.signUp.mockResolvedValueOnce(signUpResult({ access_token: 't' }));
      await expect(service.signUpAsLawyer(input)).resolves.toMatchObject({ emailConfirmationRequired: false });
    });

    it('signUpAsLawyer: stores role "lawyer" and pending status on the verification row', async () => {
      repo.firmCreate.mockResolvedValue({ id: 'firm-1', name: 'x' });
      supabase.auth.signUp.mockResolvedValueOnce(signUpResult(null));

      await service.signUpAsLawyer({ ...SIGN_UP, registrationNumber: 'MH/1234/2020' });

      expect(repo.verificationCreate).toHaveBeenCalledWith({
        profile_id: 'user-1',
        registration_number: 'MH/1234/2020',
        role: 'lawyer',
        status: 'pending',
      });
    });

    it('signUpAsFirm: creates no verification row', async () => {
      repo.firmCreate.mockResolvedValue({ id: 'firm-1', name: 'Acme LLP' });
      supabase.auth.signUp.mockResolvedValueOnce(signUpResult(null));

      await service.signUpAsFirm({ ...SIGN_UP, firmName: 'Acme LLP' });

      expect(repo.verificationCreate).not.toHaveBeenCalled();
    });

    it('signUpAsFirm: flag follows the session', async () => {
      repo.firmCreate.mockResolvedValue({ id: 'firm-1', name: 'Acme LLP' });
      const input = { ...SIGN_UP, firmName: 'Acme LLP' };

      supabase.auth.signUp.mockResolvedValueOnce(signUpResult(null));
      await expect(service.signUpAsFirm(input)).resolves.toMatchObject({ emailConfirmationRequired: true });

      supabase.auth.signUp.mockResolvedValueOnce(signUpResult({ access_token: 't' }));
      await expect(service.signUpAsFirm(input)).resolves.toMatchObject({
        emailConfirmationRequired: false,
        firmId: 'firm-1',
      });
    });
  });

  describe('invitation-based sign-up is unaffected', () => {
    it('signUp with a valid firm invite still joins the firm and still requires email confirmation', async () => {
      supabase.auth.signUp.mockResolvedValue(signUpResult(null));
      repo.invitationFindByToken.mockResolvedValue({
        id: 'inv-1',
        firm_id: 'firm-9',
        role: 'lawyer',
        status: 'pending',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const result = await service.signUp(SIGN_UP, 'invite-token');

      expect(result.emailConfirmationRequired).toBe(true);
      expect(repo.memberCreate).toHaveBeenCalledWith({ firm_id: 'firm-9', profile_id: 'user-1', role: 'lawyer' });
      expect(repo.invitationUpdate).toHaveBeenCalledWith('inv-1', expect.objectContaining({ status: 'accepted' }));
    });

    it('signUpAsClient with a valid client invite still links the client and still requires email confirmation', async () => {
      supabase.auth.signUp.mockResolvedValue(signUpResult(null));
      repo.clientInvitationFindByToken.mockResolvedValue({
        id: 'cinv-1',
        firm_id: 'firm-9',
        client_id: 'client-5',
        status: 'pending',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const result = await service.signUpAsClient(SIGN_UP, 'client-token');

      expect(result.emailConfirmationRequired).toBe(true);
      expect(repo.clientUpdate).toHaveBeenCalledWith('client-5', { profile_id: 'user-1' });
    });
  });
});

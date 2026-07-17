import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AppError,
  AuthenticationError,
  ConflictError,
  ErrorCode,
  ExternalServiceError,
  RateLimitError,
} from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';
import type { Database } from '@/core/supabase/database.types';

import { AuthService } from './auth.service';

/**
 * MOCK STRATEGY
 * -------------
 * AuthService takes its SupabaseClient via constructor injection (D6/D10)
 * — a hand-written fake satisfying only the methods AuthService actually
 * calls is used for that, continuing the precedent File 41 set for
 * testing in isolation against a documented contract rather than the
 * full SDK surface.
 *
 * Three collaborators are NOT constructor-injected — AuthService reaches
 * for them directly at the module level — so they're mocked via
 * vi.mock() instead, deliberately narrow in scope:
 *
 * - createAdminClient (File 17): signUp()'s role-assignment step.
 * - mapSupabaseUserToAuthUser (File 19): signIn()'s success path. Mocked
 *   rather than exercised for real, so this file tests AuthService's own
 *   logic only -- the mapper's role-validation behavior belongs in its
 *   own future test file, not duplicated here.
 * - clientEnv (File 8): requestPasswordReset()'s redirectTo URL. Mocked
 *   with a fixed value so this suite's pass/fail never depends on
 *   whether real .env values happen to be present in the test-runner
 *   environment.
 *
 * AMENDMENT (stabilization pass): createFakeSupabaseClient() below no
 * longer casts its return value to `SupabaseClient<Database>` internally.
 * That cast was silently overwriting the function's *inferred* return
 * type, which meant `ReturnType<typeof createFakeSupabaseClient>` (used
 * to type the `supabase` suite variable below) resolved to the real SDK
 * interface rather than "an object of vi.fn() mocks" -- so TypeScript
 * correctly reported that the real SDK methods have no `mockResolvedValue`.
 * The cast is now applied only once, at the one place a real
 * `SupabaseClient<Database>` is actually required: where `supabase` is
 * handed to `new AuthService(...)` in beforeEach() below.
 */
vi.mock('@/core/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/core/auth/mapper', () => ({
  mapSupabaseUserToAuthUser: vi.fn(),
}));

vi.mock('@/core/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_URL: 'https://app.jurisai.test' },
}));

import { createAdminClient } from '@/core/supabase/admin';
import { mapSupabaseUserToAuthUser } from '@/core/auth/mapper';

const mockedCreateAdminClient = vi.mocked(createAdminClient);
const mockedMapSupabaseUserToAuthUser = vi.mocked(mapSupabaseUserToAuthUser);

/**
 * Minimal fake of the SupabaseClient methods AuthService actually calls.
 * Deliberately NOT cast to SupabaseClient<Database> here -- see the
 * amendment note above the vi.mock() calls for why.
 */
function createFakeSupabaseClient() {
  return {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  };
}

/** Minimal fake of the admin client's role-assignment method. */
function createFakeAdminClient() {
  return {
    auth: {
      admin: {
        updateUserById: vi.fn(),
      },
    },
  };
}

function buildAuthError(overrides: Partial<AuthError> = {}): AuthError {
  return {
    name: 'AuthError',
    message: 'Something went wrong',
    status: 400,
    ...overrides,
  } as AuthError;
}

const VALID_SIGN_UP_INPUT = {
  email: 'test@example.com',
  password: 'SuperSecret123',
  fullName: 'Test User',
};

const VALID_SIGN_IN_INPUT = {
  email: 'test@example.com',
  password: 'anything-nonempty',
};

describe('AuthService', () => {
  let supabase: ReturnType<typeof createFakeSupabaseClient>;
  let adminClient: ReturnType<typeof createFakeAdminClient>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createFakeSupabaseClient();
    adminClient = createFakeAdminClient();
    mockedCreateAdminClient.mockReturnValue(adminClient as unknown as ReturnType<typeof createAdminClient>);
    service = new AuthService(supabase as unknown as SupabaseClient<Database>);
  });

  describe('signUp', () => {
    it('validates rawInput before calling Supabase, rejecting invalid payloads', async () => {
      await expect(service.signUp({ email: 'not-an-email' })).rejects.toThrow();
      expect(supabase.auth.signUp).not.toHaveBeenCalled();
    });

    it('creates the account and assigns the default role on a genuine new sign-up', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: VALID_SIGN_UP_INPUT.email,
            identities: [{ id: 'identity-1' }],
          },
          session: null,
        },
        error: null,
      });
      adminClient.auth.admin.updateUserById.mockResolvedValue({ data: {}, error: null });

      const result = await service.signUp(VALID_SIGN_UP_INPUT);

      expect(result).toEqual({
        userId: 'user-123',
        email: VALID_SIGN_UP_INPUT.email,
        emailConfirmationRequired: true,
      });
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: VALID_SIGN_UP_INPUT.email,
        password: VALID_SIGN_UP_INPUT.password,
        options: { data: { full_name: VALID_SIGN_UP_INPUT.fullName } },
      });
      expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith('user-123', {
        app_metadata: { role: 'individual' },
      });
    });

    it('reports emailConfirmationRequired as false when Supabase returns an active session', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: VALID_SIGN_UP_INPUT.email, identities: [{ id: 'identity-1' }] },
          session: { access_token: 'token' },
        },
        error: null,
      });
      adminClient.auth.admin.updateUserById.mockResolvedValue({ data: {}, error: null });

      const result = await service.signUp(VALID_SIGN_UP_INPUT);

      expect(result.emailConfirmationRequired).toBe(false);
    });

    it('throws ConflictError for the anti-enumeration fake-success response (empty identities)', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: VALID_SIGN_UP_INPUT.email, identities: [] },
          session: null,
        },
        error: null,
      });

      await expect(service.signUp(VALID_SIGN_UP_INPUT)).rejects.toBeInstanceOf(ConflictError);
      // The whole point of this case is that no role-assignment attempt
      // should follow a detected duplicate -- confirming that, not just
      // the thrown error type.
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it('throws ExternalServiceError, carrying the userId, when role assignment fails', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: VALID_SIGN_UP_INPUT.email, identities: [{ id: 'identity-1' }] },
          session: null,
        },
        error: null,
      });
      adminClient.auth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: buildAuthError({ message: 'admin API unavailable' }),
      });

      const thrown = await service.signUp(VALID_SIGN_UP_INPUT).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(ExternalServiceError);
      expect((thrown as AppError).context).toMatchObject({ userId: 'user-123' });
    });

    it('throws ExternalServiceError when Supabase reports success but returns no user', async () => {
      supabase.auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });

      await expect(service.signUp(VALID_SIGN_UP_INPUT)).rejects.toBeInstanceOf(ExternalServiceError);
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it('maps a rate-limited Supabase error (HTTP 429) to RateLimitError', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: buildAuthError({ status: 429, message: 'rate limited' }),
      });

      await expect(service.signUp(VALID_SIGN_UP_INPUT)).rejects.toBeInstanceOf(RateLimitError);
    });

    it('maps an "already registered" Supabase error to ConflictError', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: buildAuthError({ status: 400, message: 'User already registered' }),
      });

      await expect(service.signUp(VALID_SIGN_UP_INPUT)).rejects.toBeInstanceOf(ConflictError);
    });

    it('maps an unrecognized Supabase error to ExternalServiceError as a fallback', async () => {
      supabase.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: buildAuthError({ status: 500, message: 'totally novel failure mode' }),
      });

      await expect(service.signUp(VALID_SIGN_UP_INPUT)).rejects.toBeInstanceOf(ExternalServiceError);
    });
  });

  describe('signIn', () => {
    it('validates rawInput before calling Supabase', async () => {
      await expect(service.signIn({ email: 'nope' })).rejects.toThrow();
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('returns the mapped AuthUser on success', async () => {
      const fakeSupabaseUser = { id: 'user-123' } as unknown as User;
      const fakeAuthUser: AuthUser = {
        id: 'user-123',
        email: VALID_SIGN_IN_INPUT.email,
        emailVerified: true,
        role: 'individual',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSignInAt: '2026-01-01T00:00:00.000Z',
      };
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: fakeSupabaseUser, session: { access_token: 'token' } },
        error: null,
      });
      mockedMapSupabaseUserToAuthUser.mockReturnValue(fakeAuthUser);

      const result = await service.signIn(VALID_SIGN_IN_INPUT);

      expect(result).toBe(fakeAuthUser);
      expect(mockedMapSupabaseUserToAuthUser).toHaveBeenCalledWith(fakeSupabaseUser);
    });

    it('maps "Invalid login credentials" to AuthenticationError with AUTH_INVALID_CREDENTIALS', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: buildAuthError({ status: 400, message: 'Invalid login credentials' }),
      });

      const thrown = await service.signIn(VALID_SIGN_IN_INPUT).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(AuthenticationError);
      expect((thrown as AppError).code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
    });

    it('maps "Email not confirmed" to AuthenticationError, deliberately reusing AUTH_INVALID_CREDENTIALS', async () => {
      // Pinning this down deliberately: the source maps this case to the
      // same ErrorCode.AUTH_INVALID_CREDENTIALS as bad-credentials, not a
      // distinct code -- worth a comment here so a future reader doesn't
      // "fix" this into a separate code without it being a real decision.
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: buildAuthError({ status: 400, message: 'Email not confirmed' }),
      });

      const thrown = await service.signIn(VALID_SIGN_IN_INPUT).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(AuthenticationError);
      expect((thrown as AppError).code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
    });

    it('throws ExternalServiceError when Supabase reports success but returns no user', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

      await expect(service.signIn(VALID_SIGN_IN_INPUT)).rejects.toBeInstanceOf(ExternalServiceError);
      expect(mockedMapSupabaseUserToAuthUser).not.toHaveBeenCalled();
    });
  });

  describe('signOut', () => {
    it('resolves without error on success', async () => {
      supabase.auth.signOut.mockResolvedValue({ error: null });

      await expect(service.signOut()).resolves.toBeUndefined();
    });

    it('maps a Supabase error via the shared error translator', async () => {
      supabase.auth.signOut.mockResolvedValue({
        error: buildAuthError({ status: 500, message: 'unexpected failure' }),
      });

      await expect(service.signOut()).rejects.toBeInstanceOf(ExternalServiceError);
    });
  });

  describe('requestPasswordReset', () => {
    it('validates rawInput before calling Supabase', async () => {
      await expect(service.requestPasswordReset({ email: 'nope' })).rejects.toThrow();
      expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('calls Supabase with the mocked clientEnv app URL as the redirect target', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

      await service.requestPasswordReset({ email: 'test@example.com' });

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.com', {
        redirectTo: 'https://app.jurisai.test/auth/reset-password',
      });
    });

    it('maps a Supabase error via the shared error translator', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({
        data: null,
        error: buildAuthError({ status: 429, message: 'rate limited' }),
      });

      await expect(
        service.requestPasswordReset({ email: 'test@example.com' }),
      ).rejects.toBeInstanceOf(RateLimitError);
    });
  });

  describe('updatePassword', () => {
    it('validates rawInput before calling Supabase', async () => {
      await expect(service.updatePassword({ newPassword: 'short' })).rejects.toThrow();
      expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it('resolves without error on success', async () => {
      supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });

      await expect(service.updatePassword({ newPassword: 'BrandNewSecret1' })).resolves.toBeUndefined();
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'BrandNewSecret1' });
    });

    it('maps a Supabase error via the shared error translator', async () => {
      supabase.auth.updateUser.mockResolvedValue({
        data: null,
        error: buildAuthError({ status: 400, message: 'session missing' }),
      });

      await expect(
        service.updatePassword({ newPassword: 'BrandNewSecret1' }),
      ).rejects.toBeInstanceOf(ExternalServiceError);
    });
  });
});
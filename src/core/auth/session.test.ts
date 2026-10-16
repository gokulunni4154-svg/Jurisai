import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/core/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/core/supabase/server';

import { getCurrentSession, getCurrentUser } from './session';

const mockedCreateClient = vi.mocked(createClient);

function supabaseUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'lawyer@example.com',
    created_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-01-02T00:00:00.000Z',
    app_metadata: { role: 'individual' },
    email_confirmed_at: '2026-01-01T00:05:00.000Z',
    ...overrides,
  } as User;
}

function useSupabase(user: User | null, getUserError: unknown = null) {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: getUserError }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { expires_at: 1_900_000_000 } } }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe('getCurrentSession: email confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the session for a confirmed account', async () => {
    useSupabase(supabaseUser());

    const session = await getCurrentSession();

    expect(session?.user.id).toBe('user-1');
    expect(session?.user.emailVerified).toBe(true);
    expect(session?.expiresAt).toBe(1_900_000_000);
  });

  it('returns null for an unconfirmed account even though Supabase returned a user', async () => {
    useSupabase(supabaseUser({ email_confirmed_at: undefined }));

    expect(await getCurrentSession()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns null when there is no user', async () => {
    useSupabase(null);

    expect(await getCurrentSession()).toBeNull();
  });

  it('returns null when Supabase rejects the token', async () => {
    useSupabase(null, { message: 'invalid JWT' });

    expect(await getCurrentSession()).toBeNull();
  });
});

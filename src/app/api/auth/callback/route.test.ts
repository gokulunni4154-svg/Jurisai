import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/core/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/core/supabase/server';

import { GET } from './route';

const mockedCreateClient = vi.mocked(createClient);
const exchangeCodeForSession = vi.fn();

const call = (query: string) => GET(new Request(`https://app.jurisai.test/api/auth/callback${query}`));

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
  });

  it('sends a request with no code to sign-in without touching Supabase', async () => {
    const response = await call('');

    expect(response.headers.get('location')).toBe('https://app.jurisai.test/sign-in');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('exchanges a valid code and lands on / by default', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await call('?code=abc');

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(response.headers.get('location')).toBe('https://app.jurisai.test/');
  });

  it('honours a same-origin `next` path (password-reset flow)', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await call('?code=abc&next=/update-password');

    expect(response.headers.get('location')).toBe('https://app.jurisai.test/update-password');
  });

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example'])(
    'ignores an unsafe `next` (%s)',
    async (next) => {
      exchangeCodeForSession.mockResolvedValue({ error: null });

      const response = await call(`?code=abc&next=${encodeURIComponent(next)}`);

      expect(response.headers.get('location')).toBe('https://app.jurisai.test/');
    },
  );

  it('does not report success for an expired/used/invalid code', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid flow state' } });

    const response = await call('?code=bad&next=/lawyer/dashboard');

    expect(response.headers.get('location')).toBe(
      'https://app.jurisai.test/sign-in?error=confirmation_failed',
    );
  });
});

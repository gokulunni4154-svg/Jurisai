import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { resolveRouteProtection } from '@/core/auth/route-protection';

const at = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const loggedOut = (path: string) => resolveRouteProtection(at(path), null);

describe('public routes for logged-out visitors (audit F3)', () => {
  it.each(['/client-signup', '/client-signup?invite=abc123', '/pricing'])('allows %s', (path) => {
    expect(loggedOut(path).action).toBe('allow');
  });

  it.each(['/', '/sign-in', '/sign-up', '/request-password-reset'])(
    'still allows the existing public route %s',
    (path) => {
      expect(loggedOut(path).action).toBe('allow');
    },
  );

  it('is exact-match: sub-paths of the new public routes stay protected', () => {
    expect(loggedOut('/pricing/internal').action).toBe('redirect');
    expect(loggedOut('/client-signup/extra').action).toBe('redirect');
  });

  it('does not make the client portal or other terminals public', () => {
    for (const path of [
      '/client',
      '/client/notifications',
      '/lawyer/dashboard',
      '/general-user/dashboard',
      '/firm/abc/dashboard',
      '/billing/checkout',
      '/billing/subscription',
      '/profile',
      '/update-password',
    ]) {
      expect(loggedOut(path).action).toBe('redirect');
    }
  });

  it('redirects to /sign-in and preserves the destination', () => {
    const decision = loggedOut('/lawyer/tasks?x=1');
    expect(decision.action).toBe('redirect');
    if (decision.action === 'redirect') {
      expect(decision.url.pathname).toBe('/sign-in');
      expect(decision.url.searchParams.get('redirectTo')).toBe('/lawyer/tasks?x=1');
    }
  });

  it('signed-in users are allowed everywhere (role gating is a later phase)', () => {
    const user = { id: 'u1', email_confirmed_at: '2026-01-01T00:00:00.000Z' } as never;
    expect(resolveRouteProtection(at('/lawyer/dashboard'), user).action).toBe('allow');
  });
});

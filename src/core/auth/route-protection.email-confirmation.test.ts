import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { resolveRouteProtection } from '@/core/auth/route-protection';

const at = (path: string) => new NextRequest(`http://localhost:3000${path}`);

const confirmedUser = { id: 'u1', email_confirmed_at: '2026-01-01T00:00:00.000Z' } as never;
const unconfirmedUser = { id: 'u2', email_confirmed_at: null } as never;
const unconfirmedUserUndefined = { id: 'u3' } as never;

describe('route protection: email confirmation', () => {
  it('allows a confirmed account on protected pages', () => {
    for (const path of ['/lawyer/dashboard', '/general-user/dashboard', '/firm/abc/dashboard', '/client']) {
      expect(resolveRouteProtection(at(path), confirmedUser).action).toBe('allow');
    }
  });

  it.each([
    ['null', unconfirmedUser],
    ['missing', unconfirmedUserUndefined],
  ])('redirects an unconfirmed account (email_confirmed_at %s) away from protected pages', (_label, user) => {
    for (const path of ['/lawyer/dashboard', '/general-user/dashboard', '/firm/abc/dashboard', '/client', '/profile']) {
      const decision = resolveRouteProtection(at(path), user);
      expect(decision.action).toBe('redirect');
      if (decision.action === 'redirect') {
        expect(decision.url.pathname).toBe('/sign-in');
        expect(decision.url.searchParams.get('error')).toBe('email_not_confirmed');
        expect(decision.url.searchParams.get('redirectTo')).toBe(path);
      }
    }
  });

  it('does not add an error indicator for a plain logged-out visitor', () => {
    const decision = resolveRouteProtection(at('/lawyer/dashboard'), null);
    expect(decision.action).toBe('redirect');
    if (decision.action === 'redirect') {
      expect(decision.url.searchParams.has('error')).toBe(false);
    }
  });

  it('still lets an unconfirmed account reach public pages, so it cannot get stuck in a redirect loop', () => {
    for (const path of ['/', '/sign-in', '/sign-up', '/request-password-reset', '/client-signup?invite=abc', '/pricing']) {
      expect(resolveRouteProtection(at(path), unconfirmedUser).action).toBe('allow');
    }
  });

  it('leaves /api/* to the service layer for unconfirmed accounts (same as before)', () => {
    expect(resolveRouteProtection(at('/api/auth/callback?code=x'), unconfirmedUser).action).toBe('allow');
    expect(resolveRouteProtection(at('/api/cases'), unconfirmedUser).action).toBe('allow');
  });
});

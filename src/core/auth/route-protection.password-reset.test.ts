import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { resolveRouteProtection } from '@/core/auth/route-protection';

const at = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe('password-reset route protection', () => {
  it('allows logged-out users on /request-password-reset', () => {
    expect(resolveRouteProtection(at('/request-password-reset'), null).action).toBe('allow');
  });

  it('keeps /update-password protected without a session', () => {
    expect(resolveRouteProtection(at('/update-password'), null).action).toBe('redirect');
  });

  it('no longer treats the non-existent /auth/request-password-reset as public', () => {
    expect(resolveRouteProtection(at('/auth/request-password-reset'), null).action).toBe(
      'redirect',
    );
  });

  it('lets the API callback through while logged out', () => {
    expect(resolveRouteProtection(at('/api/auth/callback?code=x&next=/update-password'), null).action).toBe(
      'allow',
    );
  });
});

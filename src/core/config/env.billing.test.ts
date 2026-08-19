// src/core/config/env.billing.test.ts
//
// V1 production blocker fix — Blocker #2 (Cashfree eager env
// validation). Covers env.billing.ts's `getBillingEnv()`: the lazy,
// on-demand accessor that replaced Cashfree's four CASHFREE_* variables
// being validated eagerly inside env.server.ts's module-level
// `loadServerEnv()` call.
//
// MOCK STRATEGY: env.billing.ts (and env.server.ts, tested alongside it
// in env.server.test.ts) both `import 'server-only'` — the real
// `server-only` package unconditionally throws when imported outside a
// webpack Client/Server Component boundary, which Vitest doesn't
// provide, so it must be stubbed here. Each test also calls
// `vi.resetModules()` and dynamically re-imports the module under test
// AFTER setting `process.env`, since `getBillingEnv()` caches its result
// in a module-level variable after the first successful parse — without
// resetModules(), every test after the first would just see the first
// test's cached result regardless of what process.env holds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const CASHFREE_ENV_KEYS = [
  'CASHFREE_CLIENT_ID',
  'CASHFREE_CLIENT_SECRET',
  'CASHFREE_ENVIRONMENT',
  'CASHFREE_WEBHOOK_SECRET',
] as const;

const VALID_CASHFREE_ENV = {
  CASHFREE_CLIENT_ID: 'test-client-id',
  CASHFREE_CLIENT_SECRET: 'test-client-secret',
  CASHFREE_ENVIRONMENT: 'sandbox',
  CASHFREE_WEBHOOK_SECRET: 'test-webhook-secret',
} as const;

describe('getBillingEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const key of CASHFREE_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects missing Cashfree values when billing code requests them', async () => {
    const { getBillingEnv } = await import('./env.billing');

    expect(() => getBillingEnv()).toThrow(/Cashfree \(billing\) environment variables/);
  });

  it('lists every missing/invalid field in a single thrown error', async () => {
    process.env['CASHFREE_CLIENT_ID'] = 'only-this-one-set';
    const { getBillingEnv } = await import('./env.billing');

    try {
      getBillingEnv();
      expect.unreachable('getBillingEnv() should have thrown');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('CASHFREE_CLIENT_SECRET');
      expect(message).toContain('CASHFREE_ENVIRONMENT');
      expect(message).toContain('CASHFREE_WEBHOOK_SECRET');
      expect(message).not.toContain('CASHFREE_CLIENT_ID:');
    }
  });

  it('rejects a CASHFREE_ENVIRONMENT value that is not "sandbox" or "production"', async () => {
    Object.assign(process.env, VALID_CASHFREE_ENV, { CASHFREE_ENVIRONMENT: 'staging' });
    const { getBillingEnv } = await import('./env.billing');

    expect(() => getBillingEnv()).toThrow(/CASHFREE_ENVIRONMENT/);
  });

  it('accepts a valid, complete Cashfree configuration', async () => {
    Object.assign(process.env, VALID_CASHFREE_ENV);
    const { getBillingEnv } = await import('./env.billing');

    expect(getBillingEnv()).toEqual(VALID_CASHFREE_ENV);
  });

  it('caches the parsed result rather than re-reading process.env on every call', async () => {
    Object.assign(process.env, VALID_CASHFREE_ENV);
    const { getBillingEnv } = await import('./env.billing');

    const first = getBillingEnv();
    // Mutate process.env after the first call -- if getBillingEnv()
    // wrongly re-parsed instead of returning the cached value, this
    // would change what the second call returns.
    process.env['CASHFREE_CLIENT_ID'] = 'changed-after-first-call';
    const second = getBillingEnv();

    expect(second).toBe(first);
    expect(second.CASHFREE_CLIENT_ID).toBe('test-client-id');
  });
});

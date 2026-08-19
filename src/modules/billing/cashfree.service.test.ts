// src/modules/billing/cashfree.service.test.ts
//
// V1 production blocker fix — Blocker #2 (Cashfree eager env
// validation). Covers the two things left to confirm beyond
// env.billing.test.ts / env.server.test.ts:
//
//   4. Existing Cashfree behavior remains intact -- CashfreeService
//      still calls Cashfree's real API with the right base URL/headers
//      once configured, and still fails clearly (not silently, not with
//      a confusing unrelated error) when a method is called without
//      configuration.
//   5. Webhook verification still works with valid configuration --
//      verifyCashfreeWebhookSignature() (used by the webhook route) is
//      a pure function untouched by this fix; confirmed here so a
//      future accidental change to it doesn't slip through.
//
// MOCK STRATEGY: see env.billing.test.ts's header for why `server-only`
// is stubbed and why resetModules()+dynamic import is used per test.
// `global.fetch` is mocked so no real network call to Cashfree happens.
import { createHmac } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const VALID_CASHFREE_ENV = {
  CASHFREE_CLIENT_ID: 'test-client-id',
  CASHFREE_CLIENT_SECRET: 'test-client-secret',
  CASHFREE_ENVIRONMENT: 'sandbox',
  CASHFREE_WEBHOOK_SECRET: 'test-webhook-secret',
} as const;

const CASHFREE_ENV_KEYS = Object.keys(VALID_CASHFREE_ENV) as Array<
  keyof typeof VALID_CASHFREE_ENV
>;

const VALID_PLAN_INPUT = {
  planId: 'plan_test',
  planName: 'Test Plan',
  planType: 'PERIODIC' as const,
  recurringAmountRupees: 999,
  maxAmountRupees: 999,
  intervals: 1,
  intervalType: 'MONTH' as const,
};

describe('CashfreeService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    for (const key of CASHFREE_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fails clearly, via getBillingEnv()\'s configuration error, when called without Cashfree configured', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { CashfreeService } = await import('./cashfree.service');
    const service = new CashfreeService();

    await expect(service.createPlan(VALID_PLAN_INPUT)).rejects.toThrow(
      /Cashfree \(billing\) environment variables/,
    );
    // Never reached Cashfree -- the config error is thrown before any
    // network call, not surfaced as an opaque fetch/network failure.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the correct sandbox base URL and auth headers once configured', async () => {
    Object.assign(process.env, VALID_CASHFREE_ENV);

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ plan_id: 'plan_test', plan_status: 'ACTIVE' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { CashfreeService } = await import('./cashfree.service');
    const service = new CashfreeService();

    await service.createPlan(VALID_PLAN_INPUT).catch(() => {
      // This test only cares that the request was made correctly, not
      // that the whole response-mapping succeeds against a minimal mock
      // body -- the request assertions below are the point.
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.cashfree.com/pg/plans');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-client-id']).toBe('test-client-id');
    expect(headers['x-client-secret']).toBe('test-client-secret');
  });

  it('calls the production base URL when CASHFREE_ENVIRONMENT is "production"', async () => {
    Object.assign(process.env, VALID_CASHFREE_ENV, { CASHFREE_ENVIRONMENT: 'production' });

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ plan_id: 'plan_test', plan_status: 'ACTIVE' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { CashfreeService } = await import('./cashfree.service');
    const service = new CashfreeService();

    await service.createPlan(VALID_PLAN_INPUT).catch(() => {});

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cashfree.com/pg/plans');
  });
});

describe('verifyCashfreeWebhookSignature (unaffected by the env fix)', () => {
  it('accepts a signature computed the same way Cashfree computes it', async () => {
    const { verifyCashfreeWebhookSignature } = await import('./cashfree-webhook-signature');

    const secret = 'test-webhook-secret';
    const timestamp = '1700000000';
    const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_STATUS_CHANGED' });
    const signature = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');

    expect(verifyCashfreeWebhookSignature(timestamp, rawBody, signature, secret)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const { verifyCashfreeWebhookSignature } = await import('./cashfree-webhook-signature');

    const timestamp = '1700000000';
    const rawBody = JSON.stringify({ type: 'SUBSCRIPTION_STATUS_CHANGED' });
    const signature = createHmac('sha256', 'wrong-secret')
      .update(timestamp + rawBody)
      .digest('base64');

    expect(
      verifyCashfreeWebhookSignature(timestamp, rawBody, signature, 'test-webhook-secret'),
    ).toBe(false);
  });
});

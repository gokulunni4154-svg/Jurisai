// src/core/config/env.server.test.ts
//
// V1 production blocker fix — Blocker #2 (Cashfree eager env
// validation). Covers env.server.ts's `loadServerEnv()` (exposed as the
// `serverEnv` singleton): confirms core app configuration can now
// initialize WITHOUT any CASHFREE_* variable present, and that it still
// enforces the genuinely core variables it always required.
//
// MOCK STRATEGY: see env.billing.test.ts's header comment for why
// `server-only` is stubbed and why every test dynamically re-imports
// the module after resetModules() -- `serverEnv` is a module-level
// singleton assigned via `export const serverEnv = loadServerEnv();`,
// evaluated once at first import, so each test needs its own fresh
// module instance to exercise a different process.env.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const CORE_ENV_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY',
  'GOOGLE_CLOUD_VISION_STAGING_BUCKET',
  'CRON_SECRET',
] as const;

const CASHFREE_ENV_KEYS = [
  'CASHFREE_CLIENT_ID',
  'CASHFREE_CLIENT_SECRET',
  'CASHFREE_ENVIRONMENT',
  'CASHFREE_WEBHOOK_SECRET',
] as const;

const VALID_SERVICE_ACCOUNT_KEY = JSON.stringify({
  client_email: 'test@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
  project_id: 'test-project',
});

const VALID_CORE_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  OPENAI_API_KEY: 'sk-test-key',
  GOOGLE_GENERATIVE_AI_API_KEY: 'test-gemini-key',
  GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY: VALID_SERVICE_ACCOUNT_KEY,
  GOOGLE_CLOUD_VISION_STAGING_BUCKET: 'test-bucket',
  CRON_SECRET: 'test-cron-secret',
} as const;

describe('serverEnv (core app configuration)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const key of [...CORE_ENV_KEYS, ...CASHFREE_ENV_KEYS]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('initializes successfully with core variables set and NO Cashfree variables present', async () => {
    Object.assign(process.env, VALID_CORE_ENV);
    // Deliberately NOT setting any CASHFREE_* variable -- this is the
    // exact scenario Blocker #2 was about: core boot must not depend
    // on Cashfree being configured.
    const { serverEnv } = await import('./env.server');

    expect(serverEnv.SUPABASE_SERVICE_ROLE_KEY).toBe('test-service-role-key');
    expect(serverEnv.CRON_SECRET).toBe('test-cron-secret');
  });

  it('no longer exposes any CASHFREE_* field on the parsed result', async () => {
    Object.assign(process.env, VALID_CORE_ENV);
    const { serverEnv } = await import('./env.server');

    for (const key of CASHFREE_ENV_KEYS) {
      expect(serverEnv).not.toHaveProperty(key);
    }
  });

  it('still throws if a genuinely core variable (e.g. SUPABASE_SERVICE_ROLE_KEY) is missing', async () => {
    Object.assign(process.env, VALID_CORE_ENV);
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];

    await expect(import('./env.server')).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('still throws if OPENAI_API_KEY does not start with "sk-"', async () => {
    Object.assign(process.env, VALID_CORE_ENV, { OPENAI_API_KEY: 'not-a-valid-key' });

    await expect(import('./env.server')).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

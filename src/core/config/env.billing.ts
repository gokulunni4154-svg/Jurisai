import 'server-only';

import { z } from 'zod';

/**
 * Schema for BILLING-ONLY server secrets (Cashfree).
 *
 * FIXED — V1 production blocker. These four variables used to live in
 * env.server.ts's `serverEnvSchema`, which is parsed EAGERLY at module
 * load via `export const serverEnv = loadServerEnv();`. Because
 * `src/core/supabase/admin.ts` imports `serverEnv` at module scope, and
 * ~40 files transitively import admin.ts (including auth), a missing
 * Cashfree credential could prevent the entire app from booting —
 * including sign-in — even though Cashfree is outside V1 scope and
 * billing had not yet been used.
 *
 * This file decouples that: Cashfree credentials are validated lazily,
 * only when billing code actually asks for them via `getBillingEnv()`,
 * not at import time. Core app boot no longer depends on Cashfree being
 * configured. Same validated, fail-with-a-clear-message pattern as
 * env.server.ts/env.ts — just invoked on demand instead of at load.
 */
const billingEnvSchema = z.object({
  CASHFREE_CLIENT_ID: z.string().min(1, 'CASHFREE_CLIENT_ID is required'),
  CASHFREE_CLIENT_SECRET: z.string().min(1, 'CASHFREE_CLIENT_SECRET is required'),

  CASHFREE_ENVIRONMENT: z.enum(['sandbox', 'production'], {
    errorMap: () => ({
      message: 'CASHFREE_ENVIRONMENT must be exactly "sandbox" or "production"',
    }),
  }),

  CASHFREE_WEBHOOK_SECRET: z.string().min(1, 'CASHFREE_WEBHOOK_SECRET is required'),
});

export type BillingEnv = z.infer<typeof billingEnvSchema>;

let cachedBillingEnv: BillingEnv | undefined;

/**
 * Validates and returns Cashfree's server-only credentials, throwing a
 * controlled configuration error if any are missing/invalid. Called
 * lazily — only from billing code paths (CashfreeService, the Cashfree
 * webhook route) — never at module load, so core app boot never depends
 * on Cashfree being configured.
 *
 * Cached after the first successful parse (mirrors serverEnv/clientEnv's
 * singleton-after-validation pattern), so repeated calls within a
 * request/process don't re-parse process.env every time.
 *
 * Usage (billing code only):
 *   import { getBillingEnv } from '@/core/config/env.billing';
 *   const { CASHFREE_CLIENT_ID } = getBillingEnv();
 */
export function getBillingEnv(): BillingEnv {
  if (cachedBillingEnv) {
    return cachedBillingEnv;
  }

  const result = billingEnvSchema.safeParse({
    CASHFREE_CLIENT_ID: process.env['CASHFREE_CLIENT_ID'],
    CASHFREE_CLIENT_SECRET: process.env['CASHFREE_CLIENT_SECRET'],
    CASHFREE_ENVIRONMENT: process.env['CASHFREE_ENVIRONMENT'],
    CASHFREE_WEBHOOK_SECRET: process.env['CASHFREE_WEBHOOK_SECRET'],
  });

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([key, messages]) => `  - ${key}: ${messages?.join(', ')}`)
      .join('\n');

    throw new Error(
      `\n\u274c Invalid or missing Cashfree (billing) environment variables:\n\n${details}\n\n` +
        `Billing/Cashfree functionality requires these to be set.\n` +
        `Copy .env.example to .env.local and fill in the missing values.\n` +
        `These are server-only secrets — never commit real values.\n`,
    );
  }

  cachedBillingEnv = result.data;
  return cachedBillingEnv;
}

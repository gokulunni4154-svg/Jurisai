import 'server-only';

import { z } from 'zod';

/**
 * Schema for server-only secrets.
 *
 * SECURITY BOUNDARY: the `import 'server-only'` above is not decorative —
 * it causes the Next.js build to fail immediately if any client component
 * transitively imports this module, preventing these secrets from ever
 * reaching the browser bundle.
 *
 * Only variables actively consumed by Phase 1 code are required here.
 * Reserved-for-later variables (Payments, Notifications, Video — see
 * .env.example) are intentionally excluded until their modules are built,
 * so local dev isn't blocked on unbuilt-feature credentials.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required')
    .refine(
      (val) => !val.startsWith('NEXT_PUBLIC_'),
      'SUPABASE_SERVICE_ROLE_KEY must never be exposed as a public variable',
    ),

  OPENAI_API_KEY: z
    .string()
    .min(1, 'OPENAI_API_KEY is required')
    .startsWith('sk-', 'OPENAI_API_KEY should start with "sk-"'),

  GOOGLE_GENERATIVE_AI_API_KEY: z
    .string()
    .min(1, 'GOOGLE_GENERATIVE_AI_API_KEY is required'),

  /**
   * AMENDMENT #21 (File 71, GoogleVisionOCRProvider).
   *
   * The FIRST credential in this project that is not a flat string.
   * Google Cloud Vision's async batch OCR endpoint (files:asyncBatchAnnotate)
   * does not support API-key authentication — confirmed against real
   * Google Cloud documentation, not assumed — it requires a service
   * account. The conventional approach (GOOGLE_APPLICATION_CREDENTIALS
   * pointing at a JSON key FILE) does not fit this project's deployment
   * target: serverless environments have no durable filesystem to point
   * a file path at reliably across invocations. Instead, the service
   * account key's JSON CONTENT is stored directly as this env var's
   * value and parsed at load time, then passed to the Vision/Storage
   * clients as an in-memory `credentials` object (see File 71) — no
   * file path, no GOOGLE_APPLICATION_CREDENTIALS involved.
   *
   * Only the three fields GoogleVisionOCRProvider actually uses
   * (client_email, private_key, project_id) are validated as required.
   * `.passthrough()` allows the rest of the real downloaded key JSON
   * (type, private_key_id, client_id, etc.) to pass through unvalidated
   * rather than requiring this schema to mirror Google's entire key
   * shape field-for-field.
   */
  GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY: z
    .string()
    .min(1, 'GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY is required')
    .transform((val, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(val);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY must be valid JSON',
        });
        return z.NEVER;
      }
      return parsed;
    })
    .pipe(
      z
        .object({
          client_email: z.string().min(1, 'service account key missing client_email'),
          private_key: z.string().min(1, 'service account key missing private_key'),
          project_id: z.string().min(1, 'service account key missing project_id'),
        })
        .passthrough(),
    ),

  /**
   * AMENDMENT #21 (File 71). Name of the GCS bucket used to transiently
   * stage documents for OCR (input) and receive Cloud Vision's JSON
   * output (results). Not a general-purpose bucket — File 71's own
   * documentation covers the cleanup contract (app-level delete after
   * each extraction; a bucket-level lifecycle rule as a defense-in-depth
   * safety net is an infra-side configuration, not something this
   * application enforces in code).
   */
  GOOGLE_CLOUD_VISION_STAGING_BUCKET: z
    .string()
    .min(1, 'GOOGLE_CLOUD_VISION_STAGING_BUCKET is required'),

  /**
   * Closes PROJECT_PROGRESS.md Item #56. Secures the
   * hearing-date-reminder cron route (Item #48) via Vercel's documented
   * `Authorization: Bearer <CRON_SECRET>` mechanism. Previously read via
   * raw `process.env.CRON_SECRET` because this file had never been
   * pasted in any session — now wired through the same validated,
   * fail-fast pattern as every other secret here.
   *
   * No format constraint beyond non-empty: unlike OPENAI_API_KEY,
   * Vercel does not mandate a fixed prefix/shape for a user-supplied
   * Cron secret — it's an arbitrary string you generate yourself and
   * set as the CRON_SECRET environment variable in Vercel. Not assumed
   * otherwise.
   */
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),

  /**
   * Billing module, CashfreeService. Cashfree's real, current
   * Subscriptions API (POST /pg/plans, POST /pg/subscriptions) auths via
   * two headers, `x-client-id` and `x-client-secret` — confirmed against
   * Cashfree's real, current API docs, not the deprecated "previous"/v1
   * docs. No fixed format/prefix is documented for either value the way
   * OPENAI_API_KEY's "sk-" prefix is, so only non-empty is enforced
   * here, same posture as CRON_SECRET above.
   */
  CASHFREE_CLIENT_ID: z.string().min(1, 'CASHFREE_CLIENT_ID is required'),
  CASHFREE_CLIENT_SECRET: z.string().min(1, 'CASHFREE_CLIENT_SECRET is required'),

  /**
   * Billing module, CashfreeService. Selects which Cashfree base URL
   * CashfreeService talks to (sandbox.cashfree.com vs api.cashfree.com)
   * — real, deliberate config rather than inferring the environment
   * from NODE_ENV, since a real Cashfree sandbox *account* (separate
   * credentials, not just a different URL) is what actually determines
   * which base URL a given client-id/secret pair is valid against.
   * Getting this wrong doesn't fail loudly — Cashfree would just reject
   * the credentials — so it's made an explicit, required choice rather
   * than a silent default.
   */
  CASHFREE_ENVIRONMENT: z.enum(['sandbox', 'production'], {
    errorMap: () => ({
      message: 'CASHFREE_ENVIRONMENT must be exactly "sandbox" or "production"',
    }),
  }),

  /**
   * NEW — Billing module, webhook route (POST /api/billing/webhooks/cashfree).
   * Verifies the HMAC-SHA256 signature Cashfree sends on every webhook
   * delivery (x-webhook-signature header, per
   * cashfree-webhook-signature.ts's verifyCashfreeWebhookSignature()).
   * Previously read via raw process.env.CASHFREE_WEBHOOK_SECRET, with
   * the route handler doing its own per-request null-check, because this
   * file had never been pasted in any session. Now wired through the
   * same validated, fail-fast-at-boot pattern as every other secret
   * here — see route.ts's own updated comment for the behavioral
   * change this causes (missing secret now fails at app boot, not at
   * first webhook request). No documented format/prefix, same
   * non-empty-only posture as CASHFREE_CLIENT_ID/SECRET above.
   */
  CASHFREE_WEBHOOK_SECRET: z.string().min(1, 'CASHFREE_WEBHOOK_SECRET is required'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
    GOOGLE_GENERATIVE_AI_API_KEY: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY:
      process.env['GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY'],
    GOOGLE_CLOUD_VISION_STAGING_BUCKET:
      process.env['GOOGLE_CLOUD_VISION_STAGING_BUCKET'],
    CRON_SECRET: process.env['CRON_SECRET'],
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
      `\n\u274c Invalid or missing server environment variables:\n\n${details}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.\n` +
        `These are server-only secrets — never commit real values.\n`,
    );
  }

  return result.data;
}
  

/**
 * Validated, typed, server-only environment variables.
 * Guarded by `server-only` — importing this from a client component fails
 * the build, not the runtime.
 *
 * Usage (server code only): import { serverEnv } from '@/core/config/env.server';
 */
export const serverEnv = loadServerEnv();
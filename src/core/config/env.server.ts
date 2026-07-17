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
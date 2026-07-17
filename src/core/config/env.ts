import { z } from 'zod';

/**
 * Schema for environment variables safe to expose to the browser.
 *
 * SECURITY BOUNDARY: only NEXT_PUBLIC_-prefixed variables belong in this
 * file. Server-only secrets (API keys, service role keys) live in
 * `env.server.ts`, which is guarded by the `server-only` package so any
 * accidental client import fails at build time rather than leaking a
 * secret into the browser bundle.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url('NEXT_PUBLIC_APP_URL must be a valid URL, e.g. https://jurisai.in'),

  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid Supabase project URL'),

  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),

  NEXT_PUBLIC_AI_DEFAULT_PROVIDER: z
    .enum(['openai', 'gemini'])
    .default('openai'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Parses and validates client env vars, throwing a single, readable error
 * listing every problem at once (rather than failing on the first missing
 * var, forcing a fix-rebuild-fail loop).
 *
 * NOTE: property access below is deliberately static and literal
 * (`process.env['NEXT_PUBLIC_X']`) — Next.js's compiler only inlines
 * NEXT_PUBLIC_ vars into the client bundle when referenced this way
 * (bracket notation with a literal string key is still statically
 * analyzable by the Next.js compiler; only dynamic keys break inlining).
 */
function loadClientEnv(): ClientEnv {
  const result = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    NEXT_PUBLIC_AI_DEFAULT_PROVIDER:
      process.env['NEXT_PUBLIC_AI_DEFAULT_PROVIDER'],
  });

  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    const details = Object.entries(fieldErrors)
      .map(([key, messages]) => `  - ${key}: ${messages?.join(', ')}`)
      .join('\n');

    throw new Error(
      `\n\u274c Invalid or missing client environment variables:\n\n${details}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.\n`,
    );
  }

  return result.data;
}

/**
 * Validated, typed, client-safe environment variables.
 * Validated once at module load — safe to import anywhere (client or
 * server) with zero risk of exposing secrets.
 *
 * Usage: import { clientEnv } from '@/core/config/env';
 */
export const clientEnv = loadClientEnv();
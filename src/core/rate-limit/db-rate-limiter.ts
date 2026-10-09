import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError, ErrorCode, RateLimitError } from '@/core/errors/app-error';

export interface RateLimiter {
  /**
   * Counts one hit against `key`. Resolves if under the limit; throws
   * RateLimitError (429) if over it; throws a 503 AppError if the shared
   * store is unavailable — it NEVER silently allows the request.
   */
  consume(key: string, limit: number, windowSeconds: number): Promise<void>;
}

/**
 * Cross-instance fixed-window limiter backed by Postgres
 * (public.consume_rate_limit, see migration 20260917000000). Must be given
 * the service-role client: the function is not callable by anon/authenticated.
 *
 * Fixed windows allow up to 2x `limit` across a window boundary; that is an
 * accepted trade-off for a dependency-free shared store.
 */
export class DbRateLimiter implements RateLimiter {
  constructor(private readonly client: SupabaseClient) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    const { data, error } = await this.client.rpc('consume_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    const row = Array.isArray(data) ? data[0] : data;

    if (error || !row || typeof row.allowed !== 'boolean') {
      // Fail closed: unlimited paid processing is worse than a 503.
      throw new AppError({
        code: ErrorCode.EXTERNAL_SERVICE_ERROR,
        statusCode: 503,
        message: 'This service is temporarily unavailable. Please try again shortly.',
        context: { serviceName: 'rate-limiter' },
        cause: error ?? undefined,
      });
    }

    if (!row.allowed) {
      throw new RateLimitError(
        'Too many requests. Please try again later.',
        typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : undefined,
      );
    }
  }
}

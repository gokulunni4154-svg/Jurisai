import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { RateLimitError, ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getClientIp } from '@/core/http/client-ip';
import { readMultipartWithLimit } from '@/core/http/read-multipart';
import { DbRateLimiter } from '@/core/rate-limit/db-rate-limiter';
import { createAdminClient } from '@/core/supabase/admin';
import { buildAnonymousAnalysisService } from '@/modules/lawyer-inquiries/anonymous-analysis.factory';
import { ANON_MAX_FILE_BYTES } from '@/modules/lawyer-inquiries/anonymous-analysis.validation';

// Same ceiling as the other AI pipeline routes (AI provider deadline is 45s).
export const maxDuration = 60;

const COOKIE_NAME = 'anon_session_token';

// Per-IP abuse limit, applied BEFORE the body is read. Deliberately
// conservative; tune with real traffic data. The global AI-spend cap is NOT
// enforced here: AnonymousAnalysisService consumes it immediately before the
// AI call, so uploads that fail validation or text extraction never count.
const IP_LIMIT_PER_HOUR = 10;
const HOUR_SECONDS = 3600;

/**
 * POST /api/analysis/anonymous
 *
 * Unauthenticated by design (Lawyer Inquiry "upload without an account"
 * step). Pipeline: per-IP rate limit -> bounded multipart read -> file
 * validation (PDF only, size, signature) -> per-session / new-session limit
 * -> in-memory text extraction + length check -> global AI quota (service) ->
 * AI analysis -> Storage + DB write.
 *
 * Response contract is unchanged: `{ data: { analysisResult, expiresAt } }`.
 * The session token only ever travels in the httpOnly cookie, never in JSON.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Hashed so raw IPs are never stored in rate-limit keys.
    // No determinable IP => one shared 'unknown' bucket (stricter, not looser).
    const ip = getClientIp(request.headers);
    const clientKey = createHash('sha256').update(ip ?? 'unknown').digest('hex');

    const limiter = new DbRateLimiter(createAdminClient());
    await limiter.consume(`anon-analysis:ip:${clientKey}`, IP_LIMIT_PER_HOUR, HOUR_SECONDS);

    const formData = await readMultipartWithLimit(request, ANON_MAX_FILE_BYTES);
    const file = formData.get('file');

    if (!(file instanceof File)) {
      throw new ValidationError('A file is required.');
    }

    const existingSessionToken = request.cookies.get(COOKIE_NAME)?.value ?? null;

    const service = await buildAnonymousAnalysisService();
    const { sessionToken, analysisResult, expiresAt } = await service.createAnonymousAnalysis({
      file,
      existingSessionToken,
      clientKey,
    });

    const response = NextResponse.json({ data: { analysisResult, expiresAt } }, { status: 201 });

    // Always (re)set so the cookie lifetime tracks the SERVER-side expiry
    // exactly (a reused session keeps its original expiry, not a fresh 7d).
    const maxAge = Math.max(1, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

    return response;
  } catch (error) {
    const response = handleApiError(error);
    if (error instanceof RateLimitError) {
      const retryAfter = error.context?.['retryAfterSeconds'];
      if (typeof retryAfter === 'number') {
        response.headers.set('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
      }
    }
    return response;
  }
}

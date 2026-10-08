import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AppError, InternalServerError, ValidationError, isAppError } from '@/core/errors/app-error';

/**
 * Central error handler for Route Handlers. Every Route Handler should
 * wrap its logic in a try/catch and delegate to this function on failure:
 *
 *   export async function GET(request: NextRequest) {
 *     try {
 *       const data = await someService.doSomething();
 *       return NextResponse.json({ data });
 *     } catch (error) {
 *       return handleApiError(error);
 *     }
 *   }
 *
 * Guarantees every API error response has a consistent shape
 * (AppError['toJSON']()) and a correct HTTP status code, regardless of
 * whether the thrown value was one of our typed AppErrors, a ZodError
 * that escaped validation, or a completely unexpected error.
 */
export function handleApiError(error: unknown): NextResponse {
  // Next.js signals "this route is dynamic" during `next build` by throwing a
  // DynamicServerError (digest DYNAMIC_SERVER_USAGE) the first time a handler
  // reads cookies() or request.nextUrl.searchParams. It is control flow, not a
  // failure: it must propagate to Next, never be wrapped into a 500 AppError.
  if (isNextDynamicUsageError(error)) {
    throw error;
  }

  const normalized = normalizeError(error);

  logError(normalized);

  return NextResponse.json(normalized.toJSON(), { status: normalized.statusCode });
}

/**
 * True for Next.js's static-generation bailout signal. Checked by `digest`
 * rather than `instanceof` so no import from `next/dist` internals is needed.
 */
function isNextDynamicUsageError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { digest?: unknown }).digest === 'DYNAMIC_SERVER_USAGE'
  );
}

/**
 * Normalizes any thrown value into an AppError.
 *
 * - Already an AppError → returned as-is.
 * - A ZodError → converted into a ValidationError, preserving Zod's
 *   field-level error detail in `context` (server-side only — toJSON()
 *   does not expose `context` to the client).
 * - Anything else → wrapped in InternalServerError. Deliberately does
 *   NOT forward the original error's message into the client-facing
 *   response — an unexpected error's message might contain internal
 *   detail (a query fragment, a file path, a third-party SDK's internal
 *   state) that shouldn't reach an API client. The original error is
 *   preserved as `cause` for server-side logging only.
 */
function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ValidationError('Request validation failed', {
      fieldErrors: error.flatten().fieldErrors,
    });
  }

  return new InternalServerError('An unexpected error occurred', error);
}

/**
 * Logs a normalized AppError with severity based on `isOperational`.
 *
 * Operational errors (bad input, not-found, rate-limited, etc.) are
 * expected failure modes — logged at `warn` for visibility, not `error`,
 * since they don't indicate a bug.
 *
 * Non-operational errors (bugs, infra failures) are logged at `error` —
 * loud by design, since these indicate something our own code didn't
 * anticipate.
 *
 * Uses `console.warn`/`console.error` directly for now. This is
 * intentionally isolated in its own function: once the dedicated Logging
 * System (structured logs, log levels, external sink) is built, only
 * this function's implementation changes — `handleApiError`'s signature,
 * and every Route Handler calling it, stays untouched.
 */
function logError(error: AppError): void {
  const logPayload = {
    code: error.code,
    message: error.message,
    statusCode: error.statusCode,
    timestamp: error.timestamp,
    context: error.context,
    cause: error.cause,
    stack: error.stack,
  };

  if (error.isOperational) {
    console.warn('[AppError:operational]', logPayload);
  } else {
    console.error('[AppError:non-operational]', logPayload);
  }
}
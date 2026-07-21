// src/app/api/professional-verification/admin/queue/route.ts
// #43 — Professional account verification, admin review queue.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildProfessionalVerificationService } from '@/modules/professional-verification/professional-verification.factory';
import type { VerificationStatus } from '@/modules/professional-verification/professional-verification.repository';

const VALID_STATUSES: readonly VerificationStatus[] = [
  'pending',
  'verified',
  'rejected',
  'resubmitted',
];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /api/professional-verification/admin/queue
 *
 * Admin review-queue listing. Authorization NOT handled here —
 * `ProfessionalVerificationService#listForReview()` calls
 * `requireRole('admin')` itself, same division of responsibility as
 * every other route in this project.
 *
 * FLAGGED, NEW CONVENTION — QUERY-PARAM PARSING: no admin/users route
 * source has been pasted THIS session, so I don't have its real
 * pagination convention (query-param names, defaults, response
 * envelope) to match against. Rather than assume it, this route
 * introduces its own, explicitly flagged shape:
 *
 *   - `limit` (optional, default 20, capped at 100) — same style of
 *     defensive cap as `professional-verification.repository.ts`'s own
 *     `findAllForAdminReview()` doesn't itself apply, so it's added
 *     here at the route boundary instead.
 *   - `offset` (optional, default 0)
 *   - `status` (optional, repeatable — `?status=pending&status=resubmitted`)
 *     — validated against the real `VerificationStatus` union
 *     (confirmed via `professional-verification.repository.ts`). An
 *     invalid value throws `ValidationError` (400) rather than being
 *     silently dropped or passed through to the DB query.
 *
 * If the real admin/users route uses a different shape (e.g. a single
 * comma-separated `statuses` param, or `page`/`pageSize` instead of
 * `limit`/`offset`), this route should be reconciled to match once that
 * file is pasted — noted explicitly rather than guessed at now.
 *
 * No maxDuration override — pure DB read, same reasoning used
 * throughout this module for GET routes.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);

    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const statusParams = searchParams.getAll('status');

    let limit = DEFAULT_LIMIT;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError('limit must be a positive integer.', { received: limitParam });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    let offset = 0;
    if (offsetParam !== null) {
      const parsed = Number(offsetParam);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ValidationError('offset must be a non-negative integer.', {
          received: offsetParam,
        });
      }
      offset = parsed;
    }

    let statuses: readonly VerificationStatus[] | undefined;
    if (statusParams.length > 0) {
      for (const value of statusParams) {
        if (!VALID_STATUSES.includes(value as VerificationStatus)) {
          throw new ValidationError(
            `Invalid status "${value}". Must be one of: ${VALID_STATUSES.join(', ')}.`,
            { received: value },
          );
        }
      }
      statuses = statusParams as VerificationStatus[];
    }

    const service = await buildProfessionalVerificationService();

    const result = await service.listForReview({ limit, offset, statuses });

    return NextResponse.json({ data: result.rows, total: result.total }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
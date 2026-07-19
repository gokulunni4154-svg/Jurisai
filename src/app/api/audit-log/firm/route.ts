// src/app/api/audit-log/firm/route.ts
// Built directly against the real, pasted
// src/app/api/billing/subscription/route.ts for conventions: try/catch
// wrapping a single service call, handleApiError() for all error
// mapping, buildXService() factory call, NextResponse.json({ data },
// { status: 200 }) on success — no pattern invented here that isn't
// already established by that file.
//
// URL SCHEME: /api/audit-log/firm — a fresh, undiscussed convention
// (the first Audit Log route), chosen to mirror /api/billing/subscription's
// flat, resource-under-module shape rather than nesting under
// /api/audit-log/[firmId] — no path param used, since firmId is
// supplied as a query string param on a GET, same reasoning
// subscription/route.ts's own header comment gives for its own
// `?firmId=`.
//
// FIXED, A PRIOR SESSION — unlike subscription/route.ts's `firmId`,
// AuditLogService#getFirmAuditLog(firmId: string, ...) requires firmId —
// it is not optional at the Service layer. This route validates firmId
// is present BEFORE calling the service, throwing the confirmed
// `ValidationError` class (real signature confirmed via error-handler.ts's
// own usage) rather than a plain `Error`, which error-handler.ts
// confirmed wraps into a fake 500 instead of a real 400.
//
// `actionPrefix` query param: parsed as a plain string (non-empty check
// only) and passed straight through to
// AuditLogService#getFirmAuditLog's options field. NOT given an
// `actorType` query param — that filter is admin-only (see
// audit-log.service.ts's own scoping note); this route has nothing to
// parse it into even if a caller supplied one.
//
// `limit`/`offset` query params: parsed as optional integers and passed
// straight through. Max-page-size enforcement (MAX_LIMIT/DEFAULT_LIMIT)
// lives in AuditLogRepository#findByFilter — this route does no
// clamping of its own.
//
// AMENDED, THIS SESSION — closes pending item #3 ("no total count").
// AuditLogService#getFirmAuditLog now returns `{ events, total }`
// instead of a bare array. This route's success response now includes
// `total` alongside `data`: `{ data: AuditLogRow[]; total: number }`.
// FLAGGED, NEW CONTRACT: same additive change as the admin route's own
// amendment this session — `data` unchanged, `total` new. The real
// frontend consumer of this route (src/app/audit-log/firm/page.tsx) was
// NOT re-pasted this session (a repeat of the same filename-collision
// issue that hit this project before) — that page's own pagination
// logic still needs updating to read `total` instead of inferring from
// page-length, once its real source is available again. Flagged, not
// silently left as if it were already done.

import { NextRequest, NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { buildAuditLogService } from '@/modules/audit-log/audit-log.factory';

function parseOptionalInt(value: string | null): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseOptionalString(value: string | null): string | undefined {
  if (value == null || value.trim() === '') return undefined;
  return value;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const firmId = request.nextUrl.searchParams.get('firmId');

    if (!firmId) {
      throw new ValidationError('A firmId query parameter is required.', {
        param: 'firmId',
        example: '/api/audit-log/firm?firmId=...',
      });
    }

    const limit = parseOptionalInt(request.nextUrl.searchParams.get('limit'));
    const offset = parseOptionalInt(request.nextUrl.searchParams.get('offset'));
    const actionPrefix = parseOptionalString(request.nextUrl.searchParams.get('actionPrefix'));

    const auditLogService = await buildAuditLogService();
    const { events, total } = await auditLogService.getFirmAuditLog(firmId, {
      limit,
      offset,
      actionPrefix,
    });

    return NextResponse.json({ data: events, total }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
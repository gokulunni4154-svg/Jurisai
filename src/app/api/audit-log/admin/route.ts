// src/app/api/audit-log/admin/route.ts
// Same conventions as src/app/api/audit-log/firm/route.ts and, before
// that, the real src/app/api/billing/subscription/route.ts — see that
// file's own header for the source of the try/catch + handleApiError()
// + buildXService() + NextResponse.json({ data }, { status: 200 })
// pattern this route reuses again.
//
// No firmId or any other required param here — AuditLogService#getAllAuditLog
// takes only the optional options shape described below, and enforces
// admin-only access itself via the inherited requireRole('admin') guard.
// This route does no authorization check of its own — same posture as
// firm/route.ts.
//
// `actionPrefix`/`actorType` query params: parsed and passed straight
// through to AuditLogService#getAllAuditLog's options fields.
//
// FIXED, A PRIOR SESSION (pending item #2): an unrecognized actorType
// value previously fell through silently, treated as "no filter".
// parseOptionalActorType() now throws ValidationError for any non-null
// value outside the real enum, matching firmId's existing
// hard-validation posture in firm/route.ts. limit/offset are unchanged
// by that fix — still silently coerced via parseOptionalInt's
// Number.isNaN check.
//
// AMENDED, THIS SESSION — closes pending item #3 ("no total count").
// AuditLogService#getAllAuditLog now returns `{ events, total }` instead
// of a bare array (see that file's own amendment). This route's success
// response now includes `total` alongside `data`:
// `{ data: AuditLogRow[]; total: number }`. FLAGGED, NEW CONTRACT: this
// changes the response shape for any existing consumer of this route —
// `data` is still the array of events (unchanged key, unchanged
// content), `total` is purely additive. The one real consumer pasted so
// far in any session (src/app/audit-log/admin/page.tsx) is updated in
// this same batch to read `total` instead of inferring from page-length.

import { NextRequest, NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { buildAuditLogService } from '@/modules/audit-log/audit-log.factory';
import type { Database } from '@/core/supabase/database.types';

type AuditLogActorType = Database['public']['Enums']['audit_log_actor_type'];

const VALID_ACTOR_TYPES: readonly AuditLogActorType[] = ['user', 'system', 'webhook'];

function parseOptionalInt(value: string | null): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseOptionalString(value: string | null): string | undefined {
  if (value == null || value.trim() === '') return undefined;
  return value;
}

/**
 * FIXED, A PRIOR SESSION: previously silently dropped an unrecognized
 * actorType value. Now throws ValidationError for any non-null value
 * outside the real enum, matching firmId's hard-validation posture in
 * src/app/api/audit-log/firm/route.ts.
 */
function parseOptionalActorType(value: string | null): AuditLogActorType | undefined {
  if (value == null) return undefined;
  if (!(VALID_ACTOR_TYPES as readonly string[]).includes(value)) {
    throw new ValidationError('Invalid actorType query parameter.', {
      param: 'actorType',
      received: value,
      validValues: VALID_ACTOR_TYPES,
    });
  }
  return value as AuditLogActorType;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = parseOptionalInt(request.nextUrl.searchParams.get('limit'));
    const offset = parseOptionalInt(request.nextUrl.searchParams.get('offset'));
    const actionPrefix = parseOptionalString(request.nextUrl.searchParams.get('actionPrefix'));
    const actorType = parseOptionalActorType(request.nextUrl.searchParams.get('actorType'));

    const auditLogService = await buildAuditLogService();
    const { events, total } = await auditLogService.getAllAuditLog({
      limit,
      offset,
      actionPrefix,
      actorType,
    });

    return NextResponse.json({ data: events, total }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
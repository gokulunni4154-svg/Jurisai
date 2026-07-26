// src/app/api/firms/[id]/route.ts
// Org/Firm Settings — GET current firm (name) / PATCH to rename.
//
// FLAGGED, JUDGMENT CALL: param named `id`, not `firmId` — matches the
// sibling /api/firms/[id]/members/route.ts (real, pasted source this
// session), NOT the /api/firms/[firmId]/invitations/... route (also real,
// pasted this session). Those two existing routes use different param
// names for the same resource — a pre-existing inconsistency, not
// introduced here. Picked `id` because this route and `members` are
// direct siblings under the same [id] segment; flagging rather than
// silently resolving the wider inconsistency, which is out of this
// file's scope.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { updateFirmSchema } from '@/modules/billing/billing.schemas';
import { createFirmService } from '@/modules/billing/firm.factory';

/**
 * GET /api/firms/[id]
 *
 * Authorization NOT handled here — FirmService#getFirmById() itself
 * gates to owner/admin FirmRoles via requireManageAccess() and throws
 * AuthorizationError otherwise, same division of responsibility as
 * every other route in this project (e.g. the pasted
 * /api/firms/[id]/members/route.ts GET, which defers the same way to
 * FirmMemberService#listMembers()).
 *
 * Next.js route param handling: `context.params` destructured directly,
 * not awaited — matches the pasted /api/firms/[id]/members/route.ts,
 * which states this was confirmed via package.json this session
 * (Open Item #47). Not re-confirmed independently in THIS session —
 * inherited from that file's own confirmation.
 */
export async function GET(
  _request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;

    const currentUser = await getCurrentUser();
    const firmService = createFirmService(currentUser);
    const firm = await firmService.getFirmById(firmId);

    return NextResponse.json({ data: firm }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/firms/[id]
 *
 * Body: { name: string }. Only field currently supported (firms table
 * has no other client-facing columns — confirmed via
 * 20260726000002_create_firms_table.sql's pasted source).
 *
 * AMENDED: now validated via the real `updateFirmSchema`
 * (billing.schemas.ts, pasted this session), matching the confirmed
 * `.parse()` convention `POST /api/billing/firms` already establishes
 * for `createFirmSchema`. Replaces an earlier inline length-check
 * written before billing.schemas.ts had been pasted — a zod
 * ZodError thrown by .parse() is handled by the same handleApiError()
 * every other route already relies on, same as createFirmSchema's own
 * route.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const body = await request.json();
    const input = updateFirmSchema.parse(body);

    const currentUser = await getCurrentUser();
    const firmService = createFirmService(currentUser);
    const firm = await firmService.updateFirm(firmId, input);

    return NextResponse.json({ data: firm }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
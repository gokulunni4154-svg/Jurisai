// src/app/api/firms/[id]/members/[profileId]/route.ts
// Phase 4 — Multi-user orgs/teams + RBAC. Change role (PATCH) / remove (DELETE).

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createFirmMemberService } from '@/modules/user-management/firm-member.factory';
import type { FirmRole } from '@/core/auth/types';

/**
 * getCurrentUser() CONFIRMED this session via
 * app/api/auth/update-password/route.ts's real usage — the same
 * function BaseService.requireAuthentication() itself is built on.
 * Real import path: '@/core/auth/session'.
 */
import { getCurrentUser } from '@/core/auth/session';

/**
 * FLAGGED — same unconfirmed FirmRole caveat as
 * app/api/firms/[id]/members/route.ts.
 */
const FIRM_ROLE_VALUES: readonly FirmRole[] = ['owner', 'admin', 'employee', 'lawyer'];

/**
 * PATCH /api/firms/[id]/members/[profileId]
 *
 * Changes a member's role. Authorization + last-owner protection both
 * live inside FirmMemberService#changeRole() — not duplicated here.
 *
 * Route params: `id` is the firm id, `profileId` is the target member's
 * profile id — matches changeRole(firmId, targetProfileId, newRole)'s
 * parameter order.
 *
 * Method is PATCH, not POST — unlike professional-verification's review
 * route (which used POST for a state transition), this is a genuine
 * partial update of an existing resource (the member's role field), so
 * PATCH matches this project's REST-style convention for that case.
 * FLAGGED: no other PATCH route was pasted and confirmed this session
 * to verify that convention directly — if the real project uses POST
 * for all state-changing member operations instead, this should change
 * to match.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const targetProfileId = context.params.profileId;
    const body = await request.json();

    const newRole = body?.role;

    if (typeof newRole !== 'string' || !FIRM_ROLE_VALUES.includes(newRole as FirmRole)) {
      throw new ValidationError(
        `role is required and must be one of: ${FIRM_ROLE_VALUES.join(', ')}.`,
        { received: newRole },
      );
    }

    const currentUser = await getCurrentUser();
    const service = createFirmMemberService(currentUser);
    const updated = await service.changeRole(firmId, targetProfileId, newRole as FirmRole);

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/firms/[id]/members/[profileId]
 *
 * Removes a member from the firm. Authorization + last-owner protection
 * both live inside FirmMemberService#removeMember(). removeMember()
 * returns void — CONFIRMED this session via document-sets/[id]/members/[documentId]/route.ts's
 * real DELETE handler: the project's convention for a void-returning
 * delete is a bare 204 No Content response, not a JSON data envelope.
 * (This route previously returned `{ data: null }` at 200; corrected
 * to match the confirmed precedent.)
 */
export async function DELETE(
  request: NextRequest,
  context: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const targetProfileId = context.params.profileId;

    const currentUser = await getCurrentUser();
    const service = createFirmMemberService(currentUser);
    await service.removeMember(firmId, targetProfileId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
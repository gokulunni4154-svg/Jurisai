// src/app/api/firms/[id]/members/route.ts
// Phase 4 — Multi-user orgs/teams + RBAC. Add member (POST) / list roster (GET).

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
 * FLAGGED, JUDGMENT CALL (not independently re-confirmed this session):
 * the full FirmRole union. firm-member.service.ts's comments mention
 * 'owner', 'admin', 'employee', 'lawyer' — used here for runtime
 * validation of the request body. If the real `FirmRole` type in
 * @/core/auth/types has a different or larger set, this list needs to
 * change to match.
 */
const FIRM_ROLE_VALUES: readonly FirmRole[] = ['owner', 'admin', 'employee', 'lawyer'];

/**
 * POST /api/firms/[id]/members
 *
 * Direct-add a member to the firm (no invitation/accept step — product
 * decision, this session). Authorization NOT handled here —
 * requireFirmRole(['owner','admin']) lives inside
 * FirmMemberService#addMember() via requireManageAccess(), same division
 * of responsibility as every other route in this project.
 *
 * Next.js 14.2.35 confirmed: route params are NOT Promise-wrapped
 * (Open Item #47, resolved via package.json this session) — `context.params`
 * destructured directly, matching professional-verification/admin/[id]/review/route.ts.
 *
 * Route param: `id` is the firm id, matching addMember(firmId, ...)'s
 * first parameter.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const body = await request.json();

    const targetProfileId = body?.profileId;
    const role = body?.role;

    if (typeof targetProfileId !== 'string' || targetProfileId.length === 0) {
      throw new ValidationError('profileId is required.', { received: targetProfileId });
    }

    if (typeof role !== 'string' || !FIRM_ROLE_VALUES.includes(role as FirmRole)) {
      throw new ValidationError(
        `role is required and must be one of: ${FIRM_ROLE_VALUES.join(', ')}.`,
        { received: role },
      );
    }

    const currentUser = await getCurrentUser();
    const service = createFirmMemberService(currentUser);
    const member = await service.addMember(firmId, targetProfileId, role as FirmRole);

    return NextResponse.json({ data: member }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/firms/[id]/members
 *
 * Lists the full membership roster. Authorization NOT handled here —
 * FirmMemberService#listMembers() itself checks the caller is a member
 * of this firm (any FirmRole, not just owner/admin) and throws
 * AuthorizationError otherwise.
 */
export async function GET(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;

    const currentUser = await getCurrentUser();
    const service = createFirmMemberService(currentUser);
    const members = await service.listMembers(firmId);

    return NextResponse.json({ data: members }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
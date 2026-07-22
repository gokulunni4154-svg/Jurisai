// src/app/api/firms/[id]/teams/[teamId]/members/route.ts
// Phase 4 — Enterprise & Collaboration, Teams/departments sub-feature.
// Add team member (POST) / list team roster (GET).
//
// Structural mirror of app/api/firms/[id]/members/route.ts, one level
// down. No `role` field in the request body — team_members has no role
// column (decision #4), unlike firm_members.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createTeamMemberService } from '@/modules/user-management/team-member.factory';
import { getCurrentUser } from '@/core/auth/session';

/**
 * POST /api/firms/[id]/teams/[teamId]/members
 *
 * Direct-add a profile to the team (no invitation/accept step, same
 * product decision as firm membership). Authorization NOT handled here
 * — requireFirmRole(['owner','admin']) on the team's PARENT FIRM lives
 * inside TeamMemberService#addMember() via requireManageAccess().
 * That same call also enforces the firm-membership precondition
 * (assumption F from the teams migration) — a ConflictError there
 * surfaces through handleApiError() same as any other thrown AppError.
 *
 * Route param: `teamId` — matches addMember(teamId, ...)'s first
 * parameter. `id` (firm id) is present in the URL for resource-shape
 * consistency but not separately passed to the service call, same
 * reasoning as the sibling DELETE route on /teams/[teamId].
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string; teamId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;
    const body = await request.json();

    const targetProfileId = body?.profileId;

    if (typeof targetProfileId !== 'string' || targetProfileId.length === 0) {
      throw new ValidationError('profileId is required.', { received: targetProfileId });
    }

    const currentUser = await getCurrentUser();
    const service = createTeamMemberService(currentUser);
    const member = await service.addMember(teamId, targetProfileId);

    return NextResponse.json({ data: member }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/firms/[id]/teams/[teamId]/members
 *
 * Lists the full team roster. Authorization NOT handled here —
 * TeamMemberService#listMembers() itself checks the caller is a member
 * of the team's PARENT FIRM (any FirmRole — firm-wide read access,
 * decision #7) and throws AuthorizationError otherwise.
 */
export async function GET(
  request: NextRequest,
  context: { params: { id: string; teamId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;

    const currentUser = await getCurrentUser();
    const service = createTeamMemberService(currentUser);
    const members = await service.listMembers(teamId);

    return NextResponse.json({ data: members }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
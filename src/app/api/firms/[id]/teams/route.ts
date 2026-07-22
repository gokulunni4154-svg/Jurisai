// src/app/api/firms/[id]/teams/route.ts
// Phase 4 — Enterprise & Collaboration, Teams/departments sub-feature.
// Create team (POST) / list a firm's teams (GET).
//
// Structural mirror of app/api/firms/[id]/members/route.ts. Same
// getCurrentUser() import path and handleApiError() pattern, both
// confirmed real this session against that file. Same Next.js 14.2.35
// params-not-Promise-wrapped handling — context.params destructured
// directly, no await.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createTeamService } from '@/modules/user-management/team.factory';
import { getCurrentUser } from '@/core/auth/session';

/**
 * POST /api/firms/[id]/teams
 *
 * Creates a team within the firm. Authorization NOT handled here —
 * requireFirmRole(['owner','admin']) lives inside
 * TeamService#createTeam() via requireManageAccess(), same division of
 * responsibility as the firm-members route.
 *
 * Route param: `id` is the firm id, matching createTeam(firmId, ...)'s
 * first parameter.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const body = await request.json();

    const name = body?.name;

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('name is required.', { received: name });
    }

    const currentUser = await getCurrentUser();
    const service = createTeamService(currentUser);
    const team = await service.createTeam(firmId, name);

    return NextResponse.json({ data: team }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/firms/[id]/teams
 *
 * Lists every team in the firm. Authorization NOT handled here —
 * TeamService#listTeams() itself checks the caller is a member of this
 * firm (any FirmRole, not just owner/admin — decision #7, firm-wide
 * read access) and throws AuthorizationError otherwise.
 */
export async function GET(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;

    const currentUser = await getCurrentUser();
    const service = createTeamService(currentUser);
    const teams = await service.listTeams(firmId);

    return NextResponse.json({ data: teams }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
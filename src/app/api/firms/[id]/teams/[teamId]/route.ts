// src/app/api/firms/[id]/teams/[teamId]/route.ts
// Phase 4 — Enterprise & Collaboration, Teams/departments sub-feature.
// Delete team (DELETE).
//
// FLAGGED, SCOPE NOTE: no PATCH handler here. Renaming a team was never
// scoped as part of this sub-feature's decisions (only create/delete/
// list — see TeamService's own class doc comment) — this is a
// deliberate omission, not an oversight. Add a PATCH handler (mirroring
// app/api/firms/[id]/members/[profileId]/route.ts's PATCH shape) if
// team renaming becomes a real requirement later.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { createTeamService } from '@/modules/user-management/team.factory';
import { getCurrentUser } from '@/core/auth/session';

/**
 * DELETE /api/firms/[id]/teams/[teamId]
 *
 * Deletes a team. Authorization NOT handled here — TeamService#deleteTeam()
 * resolves the team's own parent firm internally and gates on
 * requireFirmRole(['owner','admin']) for THAT firm, so the `id` route
 * param (firm id) is not actually consulted by the service call itself
 * — deleteTeam() only needs `teamId`. Kept in the URL anyway to match
 * the nested /firms/[id]/teams/[teamId] resource shape the rest of this
 * sub-feature's routes use, same as how members/[profileId]/route.ts
 * keeps `id` in its URL even though its own service calls also take it
 * explicitly.
 *
 * removeMember()-style void return — CONFIRMED precedent this session
 * via document-sets/[id]/members/[documentId]/route.ts and the
 * firm-members DELETE route: a bare 204 No Content, not a JSON
 * envelope.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: { id: string; teamId: string } },
): Promise<NextResponse> {
  try {
    const teamId = context.params.teamId;

    const currentUser = await getCurrentUser();
    const service = createTeamService(currentUser);
    await service.deleteTeam(teamId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
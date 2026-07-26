// src/app/api/teams/[id]/members/[profileId]/route.ts
//
// FLAGGED / FIXED — session 55 (tsc pass). This file was previously a
// DRAFT (per its own prior header) with THREE unconfirmed imports. Two
// are now fixed against confirmed real source seen elsewhere this
// session:
//
//   1. `getAuthUser` from '@/core/auth/get-auth-user' never existed —
//      replaced with `getCurrentUser` from '@/core/auth/session', the
//      real, confirmed helper (no request argument, returns
//      `AuthUser | null` directly). Confirmed via session.ts's real
//      pasted source and its use in firms/[id]/members/[profileId]/
//      route.ts and firms/[id]/client-invitations/route.ts, both real
//      and pasted this session.
//   2. `handleApiError` from '@/core/errors/handle-api-error' — wrong
//      path. Every confirmed real route this session imports it from
//      '@/core/errors/error-handler' instead. Same function, corrected
//      path.
//
// STILL FLAGGED, NOT INDEPENDENTLY CONFIRMED:
//   3. `buildTeamMemberService` renamed to `createTeamMemberService`
//      below, matching the create<Module>Service(currentUser) naming
//      convention every OTHER confirmed factory this session follows
//      (createFirmMemberService, createClientInvitationService,
//      createFirmService) — none use a `build*` prefix. This is a
//      strong pattern match, not a re-paste of team-member.factory.ts's
//      real source. If that file's real export name differs, only this
//      import/call site needs to change to match it.
//
// Route shape (PATCH on the member sub-resource) mirrors "most likely"
// wording from the continuation prompt itself, describing this as
// analogous to FirmMemberService's own changeRole() route shape — not
// independently confirmed against a real teams route file. Unchanged
// from the prior draft; still flagged as a judgment call, not fixed by
// this pass.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createTeamMemberService } from '@/modules/user-management/team-member.factory';

interface RouteContext {
  params: { id: string; profileId: string };
}

/**
 * PATCH /api/teams/[id]/members/[profileId]
 * Changes a team member's role (member/lead) via
 * TeamMemberService#changeRole(). Owner/admin of the team's parent
 * firm only — gate lives entirely in the Service
 * (requireManageAccess()), not here. No last-lead protection (see
 * changeRole()'s own doc comment) — a team may reach zero leads.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id, profileId } = context.params;
    const currentUser = await getCurrentUser();
    const teamMemberService = await createTeamMemberService(currentUser);

    const body = await request.json();
    const { role } = body;

    const updated = await teamMemberService.changeRole(id, profileId, role);

    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
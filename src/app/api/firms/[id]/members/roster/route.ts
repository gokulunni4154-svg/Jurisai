// src/app/api/firms/[id]/members/roster/route.ts
// Org/Firm Settings — profile-enriched roster (adds real names to what
// GET /api/firms/[id]/members already returns).
//
// Deliberately a SEPARATE route from the sibling, already-existing
// /api/firms/[id]/members/route.ts (real, pasted this session,
// unmodified by this file) rather than changing that route's response
// shape — that file wraps FirmMemberService#listMembers(), a
// confirmed, already-working contract; changing its response shape
// risks breaking any other consumer of that exact route this session
// has no visibility into. This route is purely additive.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmService } from '@/modules/billing/firm.factory';

/**
 * GET /api/firms/[id]/members/roster
 *
 * Wraps FirmService#getFirmMembersWithProfiles() (new, this session) —
 * see that method's own doc comment for what it does and does NOT solve
 * (display only, not add-member discovery/search, which remains an
 * open, unresolved gap — profiles has no email column at all).
 *
 * Authorization NOT handled here — getFirmMembersWithProfiles() itself
 * gates to owner/admin via the same requireManageAccess() getFirmById()/
 * updateFirm() already use.
 */
export async function GET(
  _request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;

    const currentUser = await getCurrentUser();
    const firmService = createFirmService(currentUser);
    const roster = await firmService.getFirmMembersWithProfiles(firmId);

    return NextResponse.json({ data: roster }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
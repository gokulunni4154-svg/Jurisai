// src/app/api/firms/[id]/invitations/route.ts
// Phase 4 — Enterprise & Collaboration, Invitation System.
//
// RENAMED THIS SESSION: folder was `[firmId]`, now `[id]` — Open Item
// #85 (route param naming inconsistent across the firms resource) is
// now resolved for this route. Confirmed real cause of a dev-server
// crash ("You cannot have the same slug name 'id' repeat...") — Next.js
// requires every dynamic segment at a given tree position to share one
// name, and `firms/[id]/...` (clients, members, teams, reports, tasks)
// vs. `firms/[firmId]/invitations` were two different names at the same
// position. `[id]` kept (not `[firmId]`) since five other subtrees
// already used it — smaller change. All `context.params.firmId`
// references below updated to `context.params.id` to match.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createFirmInvitationService } from '@/modules/user-management/firm-invitation.factory';
import type { FirmRole } from '@/core/auth/types';

const ALLOWED_INVITE_ROLES: readonly FirmRole[] = ['owner', 'admin', 'employee', 'lawyer'];

/**
 * POST /api/firms/[id]/invitations — create a firm invitation.
 * GET  /api/firms/[id]/invitations — list all invitations (pending +
 *   historical) for this firm.
 *
 * Auth resolution follows the confirmed pattern from
 * /api/billing/firms/route.ts (`getCurrentUser()` from
 * `@/core/auth/session`, awaited, passed synchronously into the
 * factory) — NOT the Professional Verification module's
 * `await buildProfessionalVerificationService()` pattern, which resolves
 * the user internally. Both patterns exist in this project; the
 * invitation factories were built this session against the
 * firm.factory.ts/team.factory.ts shape, so this is the one to match.
 *
 * Authorization NOT handled here — FirmInvitationService's own
 * requireFirmRole(['owner','admin']) call handles it, same division of
 * responsibility as every other route in this project.
 *
 * FLAGGED, NEW CHOICE: body validation is manual (ValidationError checks
 * below), not a zod schema via a schemas.ts file — no
 * user-management.schemas.ts / invitation.schemas.ts exists yet in this
 * module, unlike billing.schemas.ts's createFirmSchema. Matches
 * Professional Verification's own me/route.ts convention (manual checks,
 * no zod) more closely than billing's. If this module later gets a real
 * schemas.ts file, this should be reconciled to use it instead.
 *
 * No maxDuration override — plain DB reads/writes, no external service
 * calls, same reasoning used throughout Professional Verification's
 * routes.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const currentUser = await getCurrentUser();
    const body = await request.json();

    const email = body?.email;
    const role = body?.role;

    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new ValidationError('email is required.', { received: email });
    }

    if (typeof role !== 'string' || !ALLOWED_INVITE_ROLES.includes(role as FirmRole)) {
      throw new ValidationError(
        `role is required and must be one of: ${ALLOWED_INVITE_ROLES.join(', ')}.`,
        { received: role },
      );
    }

    const firmInvitationService = createFirmInvitationService(currentUser);
    const result = await firmInvitationService.createInvitation({
      firmId,
      email,
      role: role as FirmRole,
    });

    return NextResponse.json({ data: result.invitation, inviteUrl: result.inviteUrl }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const currentUser = await getCurrentUser();

    const firmInvitationService = createFirmInvitationService(currentUser);
    const invitations = await firmInvitationService.listForFirm(firmId);

    return NextResponse.json({ data: invitations }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
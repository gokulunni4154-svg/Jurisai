// src/app/api/firms/[id]/clients/route.ts
// Client Management. Structural mirror of the CONFIRMED real
// src/app/api/firms/[id]/members/route.ts — same getCurrentUser()
// import path, same manual-validation-not-zod convention, same
// "authorization lives in the service, not here" division of
// responsibility, same Next.js params-not-Promise-wrapped handling.

import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { createClientService } from '@/modules/user-management/client.factory';

/**
 * POST /api/firms/[id]/clients — create a client record.
 *
 * Authorization NOT handled here — ClientService#createClient()'s own
 * requireFirmRole(['owner','admin']) call handles it. See that class's
 * own doc comment for the real owner/admin-vs-team-lead scoping
 * decision made this session.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const currentUser = await getCurrentUser();
    const body = await request.json();

    const fullName = body?.fullName;
    const email = body?.email;
    const phone = body?.phone;

    if (typeof fullName !== 'string' || fullName.trim().length === 0) {
      throw new ValidationError('fullName is required.', { received: fullName });
    }

    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new ValidationError('email is required.', { received: email });
    }

    if (phone !== undefined && phone !== null && typeof phone !== 'string') {
      throw new ValidationError('phone must be a string if provided.', { received: phone });
    }

    const clientService = createClientService(currentUser);
    const client = await clientService.createClient({
      firmId,
      fullName,
      email,
      phone: phone ?? null,
    });

    return NextResponse.json({ data: client }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/firms/[id]/clients — list all client records for this firm.
 *
 * Authorization NOT handled here — ClientService#listForFirm()'s own
 * requireFirmRole(['owner','admin']) call handles it — matches the real
 * clients_select_firm_manage RLS scope exactly (owner/admin only, not
 * firm-wide).
 */
export async function GET(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const firmId = context.params.id;
    const currentUser = await getCurrentUser();

    const clientService = createClientService(currentUser);
    const clients = await clientService.listForFirm(firmId);

    return NextResponse.json({ data: clients }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
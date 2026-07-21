// src/app/api/user-management/admin/users/[id]/ban/route.ts
//
// PATCH /api/user-management/admin/users/:id/ban
// Body: { action: 'suspend' | 'reactivate' }
//
// Thin route handler — all business logic (role check, calling
// AuthUserRepository.setBanned()) lives in UserManagementService,
// per this project's established convention.
//
// FIXED THIS SESSION (flagged, not a silent rewrite): `buildUserManagementService()`
// is async (confirmed via user-management.factory.ts, read this session) but this
// route was missing the `await` on it, so `service` was a Promise and
// `service.suspendUser()` / `service.reactivateUser()` would have thrown
// `TypeError: service.suspendUser is not a function` at request time. Fixed
// below by awaiting the factory call before use.
//
// FLAGGED, UNCONFIRMED (per Source Verification Rule):
// - ProfileRepository.findByIdOrThrow() is relied on transitively via
//   UserManagementService (to reject banning a non-existent profile before
//   calling the Auth Admin API) — inferred from BaseRepository's documented
//   inherited methods per firm-member.repository.ts's doc comment, NOT
//   independently re-pasted this session.
// - setBanned()'s exact `ban_duration` string for a *permanent* suspend is
//   still unconfirmed against a real Supabase Admin API response. This route
//   assumes UserManagementService.suspendUser() passes whatever string
//   setBanned() has been built to treat as "permanent" (currently '876000h'
//   as a practical stand-in — Supabase's documented approach for indefinite
//   bans — pending real verification; do not treat this as confirmed).

import { NextRequest, NextResponse } from 'next/server';
import { buildUserManagementService } from '@/modules/user-management/user-management.factory';

const VALID_ACTIONS = ['suspend', 'reactivate'] as const;
type BanAction = (typeof VALID_ACTIONS)[number];

function isBanAction(value: unknown): value is BanAction {
  return typeof value === 'string' && (VALID_ACTIONS as readonly string[]).includes(value);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = params.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const action = (body as { action?: unknown })?.action;
  if (!isBanAction(action)) {
    return NextResponse.json(
      { error: { message: `action must be one of: ${VALID_ACTIONS.join(', ')}` } },
      { status: 400 }
    );
  }

  const service = await buildUserManagementService();

  try {
    const result =
      action === 'suspend'
        ? await service.suspendUser(userId)
        : await service.reactivateUser(userId);

    return NextResponse.json({ data: result });
  } catch (error) {
    // Service is expected to throw on requireRole() failure / not-found,
    // matching the pattern used by the existing user list route — mirror
    // whatever status-mapping that route already does. Not independently
    // re-verified this session; adjust if that mapping differs from this.
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.toLowerCase().includes('forbidden') ? 403
      : message.toLowerCase().includes('not found') ? 404
      : 500;

    return NextResponse.json({ error: { message } }, { status });
  }
}
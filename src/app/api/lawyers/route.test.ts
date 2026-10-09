// src/app/api/lawyers/route.test.ts
//
// P2-01 regression suite for GET /api/lawyers. Covers only what the fix
// changed: the route now requires a session. The service and session
// are mocked, so no Supabase client or `server-only` module is loaded.
//
//   - anonymous caller        -> 401, directory never queried
//   - authenticated caller    -> 200, listing passed through unchanged
//                                (solo-lawyer discovery is unchanged:
//                                the repository query behind it was
//                                not touched by this fix)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
const listVerifiedLawyers = vi.fn();
const buildLawyerDirectoryService = vi.fn();

vi.mock('@/core/auth/session', () => ({
  getCurrentUser: () => getCurrentUser(),
}));

vi.mock('@/modules/lawyer-inquiries/lawyer-directory.factory', () => ({
  buildLawyerDirectoryService: () => buildLawyerDirectoryService(),
}));

import { GET } from './route';

describe('GET /api/lawyers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    buildLawyerDirectoryService.mockResolvedValue({ listVerifiedLawyers });
  });

  it('returns 401 for an anonymous caller and never touches the directory', async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(buildLawyerDirectoryService).not.toHaveBeenCalled();
    expect(listVerifiedLawyers).not.toHaveBeenCalled();
  });

  it('returns 200 with the verified-lawyer listing for an authenticated caller', async () => {
    const lawyers = [
      {
        profileId: 'p1',
        fullName: 'Jane Doe',
        registrationNumber: 'MH/123/2015',
        verifiedAt: '2026-01-01T00:00:00Z',
      },
    ];
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    listVerifiedLawyers.mockResolvedValue(lawyers);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: lawyers });
  });
});

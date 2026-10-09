// src/app/api/lawyer-directory/firms/[firmId]/members/route.test.ts
//
// P2-01 regression suite for GET /api/lawyer-directory/firms/[firmId]/
// members. The route must (1) require a session, checked BEFORE param
// validation so an anonymous caller learns nothing about ID validity,
// and (2) validate firmId as a UUID (-> 400) before the service runs.
// Personal-org exclusion lives in the repository and is covered by
// lawyer-directory.repository.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
const listFirmMembers = vi.fn();
const buildLawyerDirectoryService = vi.fn();

vi.mock('@/core/auth/session', () => ({
  getCurrentUser: () => getCurrentUser(),
}));

vi.mock('@/modules/lawyer-inquiries/lawyer-directory.factory', () => ({
  buildLawyerDirectoryService: () => buildLawyerDirectoryService(),
}));

import { GET } from './route';

const VALID_FIRM_ID = '123e4567-e89b-42d3-a456-426614174000';

function call(firmId: string) {
  return GET(new Request('http://localhost/test'), { params: { firmId } });
}

describe('GET /api/lawyer-directory/firms/[firmId]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    buildLawyerDirectoryService.mockResolvedValue({ listFirmMembers });
  });

  it('returns 401 for an anonymous caller and never touches the directory', async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await call(VALID_FIRM_ID);

    expect(response.status).toBe(401);
    expect(buildLawyerDirectoryService).not.toHaveBeenCalled();
    expect(listFirmMembers).not.toHaveBeenCalled();
  });

  it('returns 401 (not 400) for an anonymous caller sending an invalid UUID', async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await call('not-a-uuid');

    expect(response.status).toBe(401);
  });

  it('returns 400 for an authenticated caller sending an invalid UUID', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user-1' });

    const response = await call('not-a-uuid');

    expect(response.status).toBe(400);
    expect(buildLawyerDirectoryService).not.toHaveBeenCalled();
    expect(listFirmMembers).not.toHaveBeenCalled();
  });

  it('returns 200 with the roster for an authenticated caller and a valid UUID', async () => {
    const members = [{ profileId: 'p1', fullName: 'Jane Doe', role: 'owner' }];
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    listFirmMembers.mockResolvedValue(members);

    const response = await call(VALID_FIRM_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { members } });
    expect(listFirmMembers).toHaveBeenCalledWith(VALID_FIRM_ID);
  });
});

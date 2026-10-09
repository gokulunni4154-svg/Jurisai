// src/app/api/lawyer-directory/firms/route.test.ts
//
// P2-01 regression suite for GET /api/lawyer-directory/firms. The route
// must require a session; organization_type filtering lives in the
// repository and is covered by lawyer-directory.repository.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
const listFirms = vi.fn();
const buildLawyerDirectoryService = vi.fn();

vi.mock('@/core/auth/session', () => ({
  getCurrentUser: () => getCurrentUser(),
}));

vi.mock('@/modules/lawyer-inquiries/lawyer-directory.factory', () => ({
  buildLawyerDirectoryService: () => buildLawyerDirectoryService(),
}));

import { GET } from './route';

describe('GET /api/lawyer-directory/firms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    buildLawyerDirectoryService.mockResolvedValue({ listFirms });
  });

  it('returns 401 for an anonymous caller and never touches the directory', async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(buildLawyerDirectoryService).not.toHaveBeenCalled();
    expect(listFirms).not.toHaveBeenCalled();
  });

  it('returns 200 with the firm listing for an authenticated caller', async () => {
    const firms = [{ id: 'f1', name: 'Acme & Associates' }];
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    listFirms.mockResolvedValue(firms);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { firms } });
  });
});

// src/modules/lawyer-inquiries/lawyer-directory.service.test.ts
//
// NEW — General User Terminal, standalone Lawyer Directory task.
// Focused suite for LawyerDirectoryService#listVerifiedLawyers() only,
// the method the new /lawyers page depends on end-to-end — not a full
// re-test of listFirms()/listFirmMembers() (unchanged by this task),
// matching this project's existing per-feature test-file convention
// (e.g. document.service.trash.test.ts alongside document.service.ts).
//
// No `vi.mock('server-only', ...)` needed here, unlike
// case-access-grant.service.test.ts / document.service.trash.test.ts —
// confirmed this session that lawyer-directory.service.ts does NOT
// import 'server-only' at module scope (unlike every BaseService
// subclass in this project), so that workaround does not apply to this
// file.
//
// What this suite actually covers, tied to the brief's own requested
// test list:
//   - "authenticated General User can retrieve directory" — covered at
//     the route/middleware layer (route-protection.ts's fail-closed
//     PUBLIC_ROUTES denylist, unchanged by this task, gates /lawyers
//     itself), not re-asserted here. This suite instead covers the one
//     layer actually touched: the service's data-shaping contract.
//   - "unverified lawyers are not falsely presented as verified" — the
//     repository (not the service) is what performs the
//     status='verified' AND role='lawyer' filter; this suite asserts
//     the service does not ADD any additional rows or fields beyond
//     what the repository returns (no fabrication at the service
//     layer), and passes an already-repository-filtered empty result
//     straight through as an honest empty array.
//   - "directory listing handles empty state" — TEST: empty repository
//     result.
//   - "directory listing handles API failure" — TEST: repository
//     rejection propagates un-swallowed (the route's existing
//     handleApiError() converts this to a real error response; this
//     suite only confirms the service does not silently mask it).

import { describe, expect, it, vi } from 'vitest';

import { LawyerDirectoryService } from './lawyer-directory.service';
import type { LawyerDirectoryRepository } from './lawyer-directory.repository';

function buildService(repositoryOverrides: Partial<LawyerDirectoryRepository> = {}) {
  const repository = {
    listVerifiedLawyers: vi.fn(),
    listFirms: vi.fn(),
    listFirmMembers: vi.fn(),
    ...repositoryOverrides,
  } as unknown as LawyerDirectoryRepository;

  return { service: new LawyerDirectoryService({ repository }), repository };
}

describe('LawyerDirectoryService#listVerifiedLawyers', () => {
  it('maps repository rows to the camelCase DTO the /lawyers page expects, with no extra fields', async () => {
    const { service, repository } = buildService({
      listVerifiedLawyers: vi.fn().mockResolvedValue([
        {
          profile_id: 'profile-1',
          full_name: 'Anjali Menon',
          registration_number: 'KL/BAR/2019/00123',
          verified_at: '2026-03-01T00:00:00.000Z',
        },
      ]),
    });

    const result = await service.listVerifiedLawyers();

    expect(repository.listVerifiedLawyers).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        profileId: 'profile-1',
        fullName: 'Anjali Menon',
        registrationNumber: 'KL/BAR/2019/00123',
        verifiedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    // No rating/review/fee/experience/availability fields — the
    // directory page must never render fields the backend never sent.
    const [firstResult] = result;
    expect(Object.keys(firstResult ?? {})).toEqual([
      'profileId',
      'fullName',
      'registrationNumber',
      'verifiedAt',
    ]);
  });

  it('returns an honest empty array when no lawyers are verified yet', async () => {
    const { service } = buildService({
      listVerifiedLawyers: vi.fn().mockResolvedValue([]),
    });

    const result = await service.listVerifiedLawyers();

    expect(result).toEqual([]);
  });

  it('passes null verifiedAt through unchanged rather than fabricating a date', async () => {
    const { service } = buildService({
      listVerifiedLawyers: vi.fn().mockResolvedValue([
        {
          profile_id: 'profile-2',
          full_name: 'Rahul Nair',
          registration_number: 'KL/BAR/2021/00456',
          verified_at: null,
        },
      ]),
    });

    const [firstResult] = await service.listVerifiedLawyers();

    expect(firstResult?.verifiedAt).toBeNull();
  });

  it('propagates a repository failure rather than silently swallowing it', async () => {
    const { service } = buildService({
      listVerifiedLawyers: vi.fn().mockRejectedValue(new Error('connection reset')),
    });

    await expect(service.listVerifiedLawyers()).rejects.toThrow('connection reset');
  });
});

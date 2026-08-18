// src/modules/lawyer-inquiries/lawyer-inquiry.service.test.ts
//
// NEW — General User Terminal, "My Sent Inquiries" task. Focused suite
// for LawyerInquiryService#listMySentInquiries() only — not a full
// re-test of createInquiry()/acceptInquiry()/declineInquiry()/
// assignInquiry()/convertInquiry() (all unchanged by this task),
// matching this project's existing per-feature test-file convention
// (e.g. lawyer-directory.service.test.ts alongside the standalone
// directory task).
//
// Same `vi.mock('server-only', ...)` workaround as
// case-access-grant.service.test.ts / document.service.trash.test.ts —
// LawyerInquiryService imports 'server-only' at module scope (extends
// BaseService), which throws outside a real Next.js server context
// unless mocked out first, before any of this file's other imports run.
//
// Covers the brief's own requested test list for this task:
//   - "sender can retrieve own inquiries" — TEST 1.
//   - "sender cannot retrieve another sender's inquiries" — TEST 2
//     (asserts the repository is called with THIS caller's own id, and
//     only this caller's own id — the actual cross-sender isolation is
//     enforced one layer down, by the repository's WHERE clause and the
//     live RLS policy, both confirmed this session; this suite verifies
//     the service never passes a browser-supplied id through).
//   - "sender identity is resolved server-side" — TEST 3 (unauthenticated
//     caller: no repository call is made at all, AuthenticationError
//     thrown instead).
//   - "empty result works" — TEST 4.
//   - "status mapping is accurate" — TEST 5 (all three real enum values
//     pass through toListing() unchanged).

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { LawyerInquiryService } from './lawyer-inquiry.service';
import type { LawyerInquiryRepository } from './lawyer-inquiry.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { CaseService } from '@/modules/cases/case.service';
import type { DocumentService } from '@/modules/documents/document.service';

const SENDER = { id: 'sender-1', role: 'individual' } as unknown as AuthUser;
const OTHER_SENDER_ID = 'sender-2';

const BASE_ROW = {
  id: 'inquiry-1',
  client_profile_id: SENDER.id,
  target_profile_id: null,
  target_firm_id: 'firm-1',
  team_id: null,
  document_storage_path: 'individual/sender-1/doc-1/agreement.pdf',
  analysis_result: { legalHealthScore: { result: {} }, aiLegalInsight: null },
  created_at: '2026-08-01T00:00:00.000Z',
};

function buildService(currentUser: AuthUser | null, repositoryOverrides: Partial<LawyerInquiryRepository> = {}) {
  const repository = {
    listForSenderProfile: vi.fn(),
    ...repositoryOverrides,
  } as unknown as LawyerInquiryRepository;

  const firmMemberRepository = {} as unknown as FirmMemberRepository;
  const caseService = {} as unknown as CaseService;
  const documentService = {} as unknown as DocumentService;

  const service = new LawyerInquiryService(
    currentUser,
    repository,
    firmMemberRepository,
    caseService,
    documentService
  );

  return { service, repository };
}

describe('LawyerInquiryService#listMySentInquiries', () => {
  it('TEST 1 — returns the authenticated sender’s own inquiries, mapped to the listing DTO', async () => {
    const { service } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([{ ...BASE_ROW, status: 'pending' }]),
    });

    const result = await service.listMySentInquiries();

    expect(result).toEqual([
      {
        id: 'inquiry-1',
        clientProfileId: SENDER.id,
        targetProfileId: null,
        targetFirmId: 'firm-1',
        teamId: null,
        status: 'pending',
        documentStoragePath: 'individual/sender-1/doc-1/agreement.pdf',
        analysisResult: BASE_ROW.analysis_result,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('TEST 2 — queries only the authenticated caller’s own id, never a browser-supplied one', async () => {
    const { service, repository } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([]),
    });

    await service.listMySentInquiries();

    expect(repository.listForSenderProfile).toHaveBeenCalledTimes(1);
    expect(repository.listForSenderProfile).toHaveBeenCalledWith(SENDER.id);
    expect(repository.listForSenderProfile).not.toHaveBeenCalledWith(OTHER_SENDER_ID);
  });

  it('TEST 3 — resolves identity server-side: an unauthenticated caller is rejected before any repository call', async () => {
    const { service, repository } = buildService(null, {
      listForSenderProfile: vi.fn().mockResolvedValue([]),
    });

    await expect(service.listMySentInquiries()).rejects.toThrow(AuthenticationError);
    expect(repository.listForSenderProfile).not.toHaveBeenCalled();
  });

  it('TEST 4 — returns an honest empty array when the sender has no inquiries yet', async () => {
    const { service } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([]),
    });

    const result = await service.listMySentInquiries();

    expect(result).toEqual([]);
  });

  it('TEST 5 — maps all three real status values through unchanged', async () => {
    const { service } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([
        { ...BASE_ROW, id: 'inquiry-pending', status: 'pending' },
        { ...BASE_ROW, id: 'inquiry-accepted', status: 'accepted', target_profile_id: 'lawyer-1' },
        {
          ...BASE_ROW,
          id: 'inquiry-converted',
          status: 'converted_to_case',
          target_profile_id: 'lawyer-1',
          case_id: 'case-1',
        },
      ]),
    });

    const result = await service.listMySentInquiries();

    expect(result.map((r) => r.status)).toEqual(['pending', 'accepted', 'converted_to_case']);
  });
});

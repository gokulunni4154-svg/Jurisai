// Pre-acceptance review: authorization outcomes of LawyerInquiryReviewService.
// The database function open_lawyer_inquiry_review() is the real gate (its
// behaviour is exercised in supabase/tests/lawyer_inquiry_pre_acceptance_review
// .test.sql); here the repository is faked so these tests pin what the SERVICE
// does with each outcome: what it returns, what it hides, what it audits.

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';
import type { AuditLogRepository } from '@/modules/audit-log/audit-log.repository';
import type { CaseAccessGrantRepository } from '@/modules/cases/case-access-grant.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';

import { LawyerInquiryReviewService, REVIEW_SIGNED_URL_TTL_SECONDS } from './lawyer-inquiry-review.service';
import type { LawyerInquiryRepository } from './lawyer-inquiry.repository';

const LAWYER = { id: 'lawyer-1', role: 'lawyer' } as unknown as AuthUser;
const ADMIN = { id: 'admin-1', role: 'law_firm' } as unknown as AuthUser;
const STRANGER = { id: 'stranger', role: 'lawyer' } as unknown as AuthUser;

const ROW = {
  id: 'inq-1',
  client_profile_id: 'client-1',
  target_profile_id: LAWYER.id as string | null,
  target_firm_id: 'firm-1',
  team_id: null,
  assigned_by: null,
  assigned_at: null,
  document_storage_path: 'client-1/doc-1/secret-path/agreement.pdf',
  analysis_result: { everything: 'secret' },
  status: 'pending',
  case_id: null as string | null,
  decision: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  review_expires_at: '2026-10-24T00:00:00.000Z',
  created_at: '2026-10-17T00:00:00.000Z',
  updated_at: '2026-10-17T00:00:00.000Z',
};

const DOC_COMPLETE = {
  id: 'idoc-1',
  inquiry_id: 'inq-1',
  document_id: 'doc-1',
  storage_path: 'client-1/doc-1/secret-path/agreement.pdf',
  file_name: 'agreement.pdf',
  analysis_id: 'an-1',
  analysis_state: 'complete',
  analysis_snapshot: { score: 71 },
  created_at: '2026-10-17T00:00:00.000Z',
};
const DOC_PROCESSING = { ...DOC_COMPLETE, id: 'idoc-2', analysis_state: 'processing', analysis_snapshot: { stale: 'draft' } };
const DOC_UNAVAILABLE = { ...DOC_COMPLETE, id: 'idoc-3', analysis_state: 'unavailable', analysis_snapshot: null };

interface Options {
  row?: Record<string, unknown> | null;
  openReview?: ReturnType<typeof vi.fn>;
  docs?: unknown[];
  firmRole?: string | null;
  grant?: unknown;
  signedUrl?: string | null;
}

function build(user: AuthUser | null, o: Options = {}) {
  const repository = {
    findById: vi.fn().mockResolvedValue(o.row === undefined ? ROW : o.row),
    openReview:
      o.openReview ??
      vi.fn().mockResolvedValue({ review_id: 'r1', inquiry_id: 'inq-1', capacity: 'assigned_lawyer', expires_at: ROW.review_expires_at }),
    listDocumentsForInquiry: vi.fn().mockResolvedValue(o.docs ?? [DOC_COMPLETE]),
    findDocumentForInquiry: vi.fn().mockImplementation(async (inquiryId: string, docId: string) =>
      inquiryId === 'inq-1' && docId === 'idoc-1' ? DOC_COMPLETE : null
    ),
    ensureDocumentRow: vi.fn().mockResolvedValue(undefined),
    createSignedUrl: vi.fn().mockResolvedValue(o.signedUrl === undefined ? 'https://signed.example/x' : o.signedUrl),
    listForFirm: vi.fn().mockResolvedValue([ROW, { ...ROW, id: 'inq-2', target_profile_id: null }, { ...ROW, id: 'inq-3', target_profile_id: null, status: 'declined' }]),
  } as unknown as LawyerInquiryRepository;
  const firmMemberRepository = {
    findByFirmAndProfile: vi.fn().mockResolvedValue(o.firmRole ?? null),
  } as unknown as FirmMemberRepository;
  const caseAccessGrantRepository = {
    findActiveGrantForCaseAndProfile: vi.fn().mockResolvedValue(o.grant ?? null),
  } as unknown as CaseAccessGrantRepository;
  const auditLogRepository = { recordUserAction: vi.fn().mockResolvedValue({}) } as unknown as AuditLogRepository;
  const service = new LawyerInquiryReviewService(user, repository, firmMemberRepository, caseAccessGrantRepository, auditLogRepository);
  return { service, repository, firmMemberRepository, caseAccessGrantRepository, auditLogRepository };
}

describe('LawyerInquiryReviewService#getReview — individual lawyer', () => {
  it('returns the inquiry, its own document and that document’s report before acceptance', async () => {
    const { service, repository } = build(LAWYER);

    const review = await service.getReview('inq-1');

    expect(repository.openReview).toHaveBeenCalledWith('inq-1', LAWYER.id);
    expect(repository.listDocumentsForInquiry).toHaveBeenCalledWith('inq-1');
    expect(review.stage).toBe('pre_acceptance');
    expect(review.canDecide).toBe(true);
    expect(review.documents).toEqual([
      { id: 'idoc-1', fileName: 'agreement.pdf', analysisState: 'complete', report: { score: 71 } },
    ]);
  });

  it('never leaks the storage path or the raw inquiry report column', async () => {
    const { service } = build(LAWYER);

    const serialized = JSON.stringify(await service.getReview('inq-1'));

    expect(serialized).not.toContain('secret-path');
    expect(serialized).not.toContain('everything');
    expect(serialized).not.toContain('storage_path');
  });

  it('reports processing / unavailable state and withholds any report for them', async () => {
    const { service } = build(LAWYER, { docs: [DOC_PROCESSING, DOC_UNAVAILABLE] });

    const { documents } = await service.getReview('inq-1');

    expect(documents.map((d) => [d.analysisState, d.report])).toEqual([
      ['processing', null],
      ['unavailable', null],
    ]);
  });

  it('an unauthorized lawyer cannot tell the inquiry exists (404, not 403)', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'not_authorized', code: '42501' });
    const { service, repository } = build(STRANGER, { openReview });

    await expect(service.getReview('inq-1')).rejects.toThrow(NotFoundError);
    expect(repository.listDocumentsForInquiry).not.toHaveBeenCalled();
  });

  it('an unknown inquiry id looks identical to an unauthorized one', async () => {
    const { service } = build(STRANGER, { row: null });

    await expect(service.getReview('nope')).rejects.toThrow(NotFoundError);
  });

  it('an expired window is a Conflict and returns no documents', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'review_window_expired', code: '55000' });
    const { service, repository } = build(LAWYER, { openReview });

    await expect(service.getReview('inq-1')).rejects.toThrow(ConflictError);
    expect(repository.listDocumentsForInquiry).not.toHaveBeenCalled();
  });

  it('a revoked review is an authorization failure', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'review_access_revoked', code: '55000' });
    const { service } = build(LAWYER, { openReview });

    await expect(service.getReview('inq-1')).rejects.toThrow(AuthorizationError);
  });

  it('an unauthenticated caller is rejected before any lookup', async () => {
    const { service, repository } = build(null);

    await expect(service.getReview('inq-1')).rejects.toThrow(AuthenticationError);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('a real database failure is not disguised as a 404', async () => {
    const boom = { message: 'connection reset', code: '08006' };
    const { service } = build(LAWYER, { openReview: vi.fn().mockRejectedValue(boom) });

    await expect(service.getReview('inq-1')).rejects.toBe(boom);
  });
});

describe('LawyerInquiryReviewService#getReview — firm reviewer', () => {
  const FIRM_ROUTED = { ...ROW, target_profile_id: null };

  it('a firm admin reviews a firm-routed inquiry and is told an assignee is required', async () => {
    const openReview = vi.fn().mockResolvedValue({ review_id: 'r2', inquiry_id: 'inq-1', capacity: 'firm_reviewer', expires_at: ROW.review_expires_at });
    const { service } = build(ADMIN, { row: FIRM_ROUTED, openReview });

    const review = await service.getReview('inq-1');

    expect(review.capacity).toBe('firm_reviewer');
    expect(review.requiresAssignee).toBe(true);
    expect(review.documents).toHaveLength(1);
  });

  it('an employee or a member of another firm is denied (404)', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'not_authorized', code: '42501' });
    const { service } = build({ id: 'employee-1', role: 'law_firm' } as unknown as AuthUser, { row: FIRM_ROUTED, openReview });

    await expect(service.getReview('inq-1')).rejects.toThrow(NotFoundError);
  });
});

describe('LawyerInquiryReviewService — after the decision', () => {
  const ACCEPTED = { ...ROW, status: 'accepted', decision: 'accepted', case_id: 'case-1' };

  it('an accepted inquiry never re-opens a pre-acceptance review; access comes from the case grant', async () => {
    const { service, repository, caseAccessGrantRepository } = build(LAWYER, { row: ACCEPTED, grant: { id: 'g1' } });

    const review = await service.getReview('inq-1');

    expect(repository.openReview).not.toHaveBeenCalled();
    expect(caseAccessGrantRepository.findActiveGrantForCaseAndProfile).toHaveBeenCalledWith('case-1', LAWYER.id);
    expect(review.stage).toBe('accepted');
    expect(review.canDecide).toBe(false);
  });

  it('accepted, no grant, not a firm manager: the former reviewer gets nothing', async () => {
    const { service } = build(LAWYER, { row: ACCEPTED, grant: null, firmRole: 'lawyer' });

    await expect(service.getReview('inq-1')).rejects.toThrow(NotFoundError);
  });

  it('a firm owner/admin keeps access to an accepted inquiry of their firm (existing case-manager rule)', async () => {
    const { service } = build(ADMIN, { row: ACCEPTED, grant: null, firmRole: 'admin' });

    await expect(service.getReview('inq-1')).resolves.toMatchObject({ stage: 'accepted' });
  });

  it('a declined inquiry gives no access to anyone, including the decider', async () => {
    const DECLINED = { ...ROW, status: 'declined', decision: 'declined', decided_by: LAWYER.id };
    const { service, repository } = build(LAWYER, { row: DECLINED, firmRole: 'owner', grant: { id: 'g' } });

    await expect(service.getReview('inq-1')).rejects.toThrow(NotFoundError);
    expect(repository.openReview).not.toHaveBeenCalled();
    expect(repository.listDocumentsForInquiry).not.toHaveBeenCalled();
  });
});

describe('LawyerInquiryReviewService — missing document row (self-heal)', () => {
  it('heals the row for an authorized reviewer before listing documents', async () => {
    const { service, repository } = build(LAWYER);

    await service.getReview('inq-1');

    expect(repository.ensureDocumentRow).toHaveBeenCalledWith(ROW);
    const order = (repository.ensureDocumentRow as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const listOrder = (repository.listDocumentsForInquiry as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(order).toBeLessThan(listOrder);
  });

  it('never heals (or touches documents) for an unauthorized caller', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'not_authorized', code: '42501' });
    const { service, repository } = build(STRANGER, { openReview });

    await expect(service.getReview('inq-1')).rejects.toThrow(NotFoundError);
    expect(repository.ensureDocumentRow).not.toHaveBeenCalled();
  });
});

describe('LawyerInquiryReviewService#getDocumentAccess', () => {
  it('mints a short-lived signed URL for the exact document and audits the open', async () => {
    const { service, repository, auditLogRepository } = build(LAWYER);

    const result = await service.getDocumentAccess('inq-1', 'idoc-1');

    expect(repository.findDocumentForInquiry).toHaveBeenCalledWith('inq-1', 'idoc-1');
    expect(repository.createSignedUrl).toHaveBeenCalledWith(DOC_COMPLETE.storage_path, REVIEW_SIGNED_URL_TTL_SECONDS);
    expect(result).toEqual({ url: 'https://signed.example/x', fileName: 'agreement.pdf', expiresInSeconds: REVIEW_SIGNED_URL_TTL_SECONDS });
    expect(REVIEW_SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
    expect(auditLogRepository.recordUserAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: LAWYER.id,
        action: 'lawyer_inquiry.document.open',
        resourceId: 'idoc-1',
        metadata: { inquiryId: 'inq-1', stage: 'pre_acceptance' },
      })
    );
  });

  it('a document id from a different inquiry (or a guessed one) finds nothing and mints no URL', async () => {
    const { service, repository } = build(LAWYER);

    await expect(service.getDocumentAccess('inq-1', 'idoc-of-another-inquiry')).rejects.toThrow(NotFoundError);
    expect(repository.createSignedUrl).not.toHaveBeenCalled();
  });

  it('is refused for an unauthorized caller before any document lookup', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'not_authorized', code: '42501' });
    const { service, repository } = build(STRANGER, { openReview });

    await expect(service.getDocumentAccess('inq-1', 'idoc-1')).rejects.toThrow(NotFoundError);
    expect(repository.findDocumentForInquiry).not.toHaveBeenCalled();
    expect(repository.createSignedUrl).not.toHaveBeenCalled();
  });

  it('is refused once the window has expired, so no new preview or download', async () => {
    const openReview = vi.fn().mockRejectedValue({ message: 'review_window_expired', code: '55000' });
    const { service, repository } = build(LAWYER, { openReview });

    await expect(service.getDocumentAccess('inq-1', 'idoc-1')).rejects.toThrow(ConflictError);
    expect(repository.createSignedUrl).not.toHaveBeenCalled();
  });

  it('a file that is gone from storage is a 404, not a crash, and is not audited as opened', async () => {
    const { service, auditLogRepository } = build(LAWYER, { signedUrl: null });

    await expect(service.getDocumentAccess('inq-1', 'idoc-1')).rejects.toThrow(NotFoundError);
    expect(auditLogRepository.recordUserAction).not.toHaveBeenCalled();
  });
});

describe('LawyerInquiryReviewService#listFirmInquiries', () => {
  it('a firm owner/admin sees the firm’s inquiries; only unassigned pending ones are reviewable', async () => {
    const { service, repository } = build(ADMIN, { firmRole: 'admin' });

    const list = await service.listFirmInquiries('firm-1');

    expect(repository.listForFirm).toHaveBeenCalledWith('firm-1');
    expect(list.map((i) => [i.id, i.reviewableByYou])).toEqual([
      ['inq-1', false],
      ['inq-2', true],
      ['inq-3', false],
    ]);
    expect(JSON.stringify(list)).not.toContain('secret-path');
  });

  it.each([null, 'employee', 'lawyer'])('a caller with firm role %s is rejected and nothing is listed', async (firmRole) => {
    const { service, repository } = build(ADMIN, { firmRole });

    await expect(service.listFirmInquiries('firm-1')).rejects.toThrow(AuthorizationError);
    expect(repository.listForFirm).not.toHaveBeenCalled();
  });
});

// Route-level checks for the inquiry decision/review endpoints: they must
// delegate authorization to the services (never decide it themselves),
// validate input, and never cache review payloads.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError, NotFoundError } from '@/core/errors/app-error';

const getCurrentUser = vi.fn();
const acceptInquiry = vi.fn();
const declineInquiry = vi.fn();
const getReview = vi.fn();
const getDocumentAccess = vi.fn();

vi.mock('@/core/auth/session', () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock('@/modules/lawyer-inquiries/lawyer-inquiry.factory', () => ({
  buildLawyerInquiryService: async () => ({ acceptInquiry, declineInquiry }),
  buildLawyerInquiryReviewService: async () => ({ getReview, getDocumentAccess }),
}));

import { POST as accept } from './accept/route';
import { POST as decline } from './decline/route';
import { GET as review } from './review/route';
import { GET as documentAccess } from './documents/[documentId]/access/route';

const post = (body?: string) => new Request('http://x/api', { method: 'POST', body });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: 'u1', role: 'lawyer' });
});

describe('POST accept', () => {
  it('works with no body (the inbox Accept button sends none)', async () => {
    acceptInquiry.mockResolvedValue({ id: 'i1', caseId: 'c1' });

    const res = await accept(post(), { params: { id: 'i1' } });

    expect(res.status).toBe(200);
    expect(acceptInquiry).toHaveBeenCalledWith('i1', { title: undefined, assigneeProfileId: null, teamId: null });
  });

  it('forwards title, assignee and team', async () => {
    acceptInquiry.mockResolvedValue({ id: 'i1' });

    await accept(post(JSON.stringify({ title: 'T', assigneeProfileId: 'l2', teamId: 't1' })), { params: { id: 'i1' } });

    expect(acceptInquiry).toHaveBeenCalledWith('i1', { title: 'T', assigneeProfileId: 'l2', teamId: 't1' });
  });

  it.each(['not json', '[]', '{"title": 5}', '{"assigneeProfileId": {}}'])('rejects malformed body %s with 400 before touching the service', async (body) => {
    const res = await accept(post(body), { params: { id: 'i1' } });

    expect(res.status).toBe(400);
    expect(acceptInquiry).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller gets 401 from the service layer', async () => {
    acceptInquiry.mockRejectedValue(new AuthenticationError('Authentication is required to perform this action.'));
    getCurrentUser.mockResolvedValue(null);

    expect((await accept(post(), { params: { id: 'i1' } })).status).toBe(401);
  });
});

describe('POST decline', () => {
  it('passes the optional note through', async () => {
    declineInquiry.mockResolvedValue(undefined);

    const res = await decline(post(JSON.stringify({ note: 'conflict' })), { params: { id: 'i1' } });

    expect(res.status).toBe(200);
    expect(declineInquiry).toHaveBeenCalledWith('i1', { note: 'conflict' });
  });

  it('an empty body declines without a note', async () => {
    await decline(post(), { params: { id: 'i1' } });

    expect(declineInquiry).toHaveBeenCalledWith('i1', { note: null });
  });

  it('a non-string note is a 400', async () => {
    const res = await decline(post(JSON.stringify({ note: 7 })), { params: { id: 'i1' } });

    expect(res.status).toBe(400);
    expect(declineInquiry).not.toHaveBeenCalled();
  });
});

describe('GET review / document access', () => {
  it('review payloads are never cacheable', async () => {
    getReview.mockResolvedValue({ stage: 'pre_acceptance' });

    const res = await review(new Request('http://x'), { params: { id: 'i1' } });

    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(getReview).toHaveBeenCalledWith('i1');
  });

  it('a guessed inquiry id is a plain 404 from the service', async () => {
    getReview.mockRejectedValue(new NotFoundError('Inquiry not found.'));

    expect((await review(new Request('http://x'), { params: { id: 'guess' } })).status).toBe(404);
  });

  it('the signed-URL endpoint passes BOTH ids to the service and is never cacheable', async () => {
    getDocumentAccess.mockResolvedValue({ url: 'https://signed', fileName: 'a.pdf', expiresInSeconds: 120 });

    const res = await documentAccess(new Request('http://x'), { params: { id: 'i1', documentId: 'd1' } });

    expect(getDocumentAccess).toHaveBeenCalledWith('i1', 'd1');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

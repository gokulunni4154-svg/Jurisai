import { describe, expect, it, vi } from 'vitest';

import { LawyerInquiryRepository } from './lawyer-inquiry.repository';

// A chainable stand-in for the supabase query builder that records every call.
function fakeClient(plan: { tables?: Record<string, { data?: unknown; error?: unknown }>; rpc?: { data?: unknown; error?: unknown }; storage?: { data?: unknown; error?: unknown } } = {}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const result = plan.tables?.[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const op of ['insert', 'select', 'update', 'delete', 'eq', 'neq', 'is', 'order']) {
      builder[op] = (...args: unknown[]) => {
        calls.push({ table, op, args });
        return builder;
      };
    }
    builder['single'] = async () => result;
    builder['maybeSingle'] = async () => result;
    builder['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  const rpc = vi.fn(async () => plan.rpc ?? { data: null, error: null });
  const storage = { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => plan.storage ?? { data: null, error: null }) })) };
  return { client: { from, rpc, storage } as never, calls, from, rpc, storage };
}

const INSERTED = { id: 'inq-1', status: 'pending' };

describe('LawyerInquiryRepository#create', () => {
  it('writes the inquiry AND the document row that ties it to the exact document and report', async () => {
    const { client, calls } = fakeClient({ tables: { lawyer_inquiries: { data: INSERTED }, lawyer_inquiry_documents: { error: null } } });

    await new LawyerInquiryRepository(client).create({
      clientProfileId: 'c1',
      targetProfileId: null,
      targetFirmId: 'f1',
      documentStoragePath: 'c1/d1/My%20Agreement.pdf',
      analysisResult: { score: 1 },
      attachment: { documentId: 'd1', analysisId: 'a1', analysisState: 'complete' },
    });

    const docInsert = calls.find((c) => c.table === 'lawyer_inquiry_documents' && c.op === 'insert');
    expect(docInsert?.args[0]).toEqual({
      inquiry_id: 'inq-1',
      document_id: 'd1',
      storage_path: 'c1/d1/My%20Agreement.pdf',
      file_name: 'My Agreement.pdf',
      analysis_id: 'a1',
      analysis_state: 'complete',
      analysis_snapshot: { score: 1 },
    });
  });

  it('an anonymous-origin inquiry (no attachment given) still gets a document row with no document id', async () => {
    const { client, calls } = fakeClient({ tables: { lawyer_inquiries: { data: INSERTED } } });

    await new LawyerInquiryRepository(client).create({
      clientProfileId: 'c1',
      targetProfileId: 'l1',
      targetFirmId: 'f1',
      documentStoragePath: 'anon/tok/x/a.pdf',
      analysisResult: { score: 2 },
    });

    const docInsert = calls.find((c) => c.table === 'lawyer_inquiry_documents' && c.op === 'insert');
    expect(docInsert?.args[0]).toMatchObject({ document_id: null, analysis_id: null, analysis_state: 'complete', file_name: 'a.pdf' });
  });

  it('removes the just-created inquiry if its document row cannot be written, so none exists without an attachment', async () => {
    const docError = { message: 'insert failed' };
    const { client, calls } = fakeClient({ tables: { lawyer_inquiries: { data: INSERTED }, lawyer_inquiry_documents: { error: docError } } });

    await expect(
      new LawyerInquiryRepository(client).create({ clientProfileId: 'c1', targetProfileId: null, targetFirmId: 'f1', documentStoragePath: 'a/b/c.pdf', analysisResult: {} })
    ).rejects.toBe(docError);

    const cleanup = calls.filter((c) => c.table === 'lawyer_inquiries' && (c.op === 'delete' || c.op === 'eq'));
    expect(cleanup.map((c) => c.op)).toContain('delete');
    expect(cleanup.find((c) => c.op === 'eq' && c.args[0] === 'status')?.args[1]).toBe('pending');
    expect(cleanup.find((c) => c.op === 'eq' && c.args[0] === 'id')?.args[1]).toBe('inq-1');
  });
});

describe('LawyerInquiryRepository queries', () => {
  it('the sender list excludes declined inquiries (preserves the pre-soft-decline behaviour)', async () => {
    const { client, calls } = fakeClient({ tables: { lawyer_inquiries: { data: [] } } });

    await new LawyerInquiryRepository(client).listForSenderProfile('c1');

    expect(calls.find((c) => c.op === 'neq')?.args).toEqual(['status', 'declined']);
  });

  it('a document is looked up by BOTH its id and its inquiry id', async () => {
    const { client, calls } = fakeClient({ tables: { lawyer_inquiry_documents: { data: null } } });

    const found = await new LawyerInquiryRepository(client).findDocumentForInquiry('inq-1', 'idoc-9');

    expect(found).toBeNull();
    const eqs = calls.filter((c) => c.op === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['id', 'idoc-9']);
    expect(eqs).toContainEqual(['inquiry_id', 'inq-1']);
  });

  it('an analysis id is only accepted for the document it belongs to', async () => {
    const { client, calls } = fakeClient({ tables: { document_analyses: { data: null } } });

    await new LawyerInquiryRepository(client).findAnalysisForDocument('an-1', 'doc-1');

    const eqs = calls.filter((c) => c.op === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['id', 'an-1']);
    expect(eqs).toContainEqual(['document_id', 'doc-1']);
  });

  it('assign and convert carry their state guard in the WHERE clause', async () => {
    const a = fakeClient({ tables: { lawyer_inquiries: { data: null } } });
    await new LawyerInquiryRepository(a.client).assign('inq-1', { targetProfileId: 'l1', assignedBy: 'u1', teamId: null });
    expect(a.calls.find((c) => c.op === 'eq' && c.args[0] === 'status')?.args[1]).toBe('pending');
    expect(a.calls.find((c) => c.op === 'is')?.args).toEqual(['target_profile_id', null]);

    const b = fakeClient({ tables: { lawyer_inquiries: { data: null } } });
    expect(await new LawyerInquiryRepository(b.client).convert('inq-1', 'case-1')).toBeNull();
    expect(b.calls.find((c) => c.op === 'eq' && c.args[0] === 'status')?.args[1]).toBe('accepted');
    expect(b.calls.find((c) => c.op === 'is')?.args).toEqual(['case_id', null]);
  });
});

describe('LawyerInquiryRepository RPC wrappers', () => {
  it('acceptAtomic passes exactly the actor, assignee, team and title to the database function', async () => {
    const { client, rpc } = fakeClient({ rpc: { data: { case_id: 'case-1' } } });

    const result = await new LawyerInquiryRepository(client).acceptAtomic({ inquiryId: 'i', actorId: 'a', assigneeId: 'l', teamId: null, title: 'T' });

    expect(rpc).toHaveBeenCalledWith('accept_lawyer_inquiry', { p_inquiry_id: 'i', p_actor_id: 'a', p_assignee_id: 'l', p_team_id: null, p_title: 'T' });
    expect(result).toEqual({ case_id: 'case-1' });
  });

  it('surfaces the database error unchanged so the service can map it', async () => {
    const error = { message: 'review_window_expired', code: '55000' };
    const { client } = fakeClient({ rpc: { error } });

    await expect(new LawyerInquiryRepository(client).openReview('i', 'r')).rejects.toBe(error);
  });

  it('createSignedUrl returns null (not a throw) when storage has no such object', async () => {
    const { client } = fakeClient({ storage: { error: { message: 'Object not found' } } });

    expect(await new LawyerInquiryRepository(client).createSignedUrl('x/y.pdf', 120)).toBeNull();
  });
});

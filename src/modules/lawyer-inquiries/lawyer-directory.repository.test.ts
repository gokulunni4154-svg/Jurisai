// src/modules/lawyer-inquiries/lawyer-directory.repository.test.ts
//
// P2-01 regression suite for the organization_type filtering added to
// LawyerDirectoryRepository. The repository runs on the admin client
// (RLS bypassed), so these filters are the ONLY thing keeping 'personal'
// organizations -- and their owner rosters -- out of the directory.
//
// Uses a hand-rolled chainable fake of the Supabase query builder
// (no real client, no database). Each table gets its own recorded query
// so the tests can assert exactly which filters were applied.

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { LawyerDirectoryRepository } from './lawyer-directory.repository';

interface QueryResult {
  data: unknown;
  error: unknown;
}

function createQuery(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
    // Makes `await query.order(...)` resolve to the canned result, the
    // way a real PostgrestFilterBuilder is awaitable.
    then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue(result);
  return query;
}

function createClient(queries: Record<string, ReturnType<typeof createQuery>>) {
  const from = vi.fn((table: string) => queries[table]);
  return { client: { from } as unknown as SupabaseClient, from };
}

describe('LawyerDirectoryRepository#listFirms', () => {
  it("restricts the query to organization_type = 'firm'", async () => {
    const firms = createQuery({ data: [{ id: 'f1', name: 'Acme' }], error: null });
    const { client, from } = createClient({ firms });

    const result = await new LawyerDirectoryRepository(client).listFirms();

    expect(from).toHaveBeenCalledWith('firms');
    expect(firms.eq).toHaveBeenCalledWith('organization_type', 'firm');
    expect(result).toEqual([{ id: 'f1', name: 'Acme' }]);
  });

  it('propagates a database error instead of swallowing it', async () => {
    const dbError = new Error('boom');
    const { client } = createClient({ firms: createQuery({ data: null, error: dbError }) });

    await expect(new LawyerDirectoryRepository(client).listFirms()).rejects.toBe(dbError);
  });
});

describe('LawyerDirectoryRepository#listFirmMembers', () => {
  const FIRM_ID = '123e4567-e89b-42d3-a456-426614174000';

  it("looks the firm up with organization_type = 'firm' before reading members", async () => {
    const firms = createQuery({ data: { id: FIRM_ID }, error: null });
    const members = createQuery({
      data: [{ profile_id: 'p1', role: 'owner', profiles: { full_name: 'Jane Doe' } }],
      error: null,
    });
    const { client } = createClient({ firms, firm_members: members });

    const result = await new LawyerDirectoryRepository(client).listFirmMembers(FIRM_ID);

    expect(firms.eq).toHaveBeenCalledWith('id', FIRM_ID);
    expect(firms.eq).toHaveBeenCalledWith('organization_type', 'firm');
    expect(result).toEqual([{ profile_id: 'p1', full_name: 'Jane Doe', role: 'owner' }]);
  });

  it('returns [] and never reads firm_members for a personal or nonexistent org', async () => {
    // A 'personal' org (or unknown id) does not match the
    // organization_type = 'firm' lookup, so the lookup returns no row.
    const firms = createQuery({ data: null, error: null });
    const members = createQuery({ data: [], error: null });
    const { client, from } = createClient({ firms, firm_members: members });

    const result = await new LawyerDirectoryRepository(client).listFirmMembers(FIRM_ID);

    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalledWith('firm_members');
    expect(members.select).not.toHaveBeenCalled();
  });

  it('propagates a firm-lookup error instead of returning an empty roster', async () => {
    const dbError = new Error('lookup failed');
    const { client } = createClient({ firms: createQuery({ data: null, error: dbError }) });

    await expect(new LawyerDirectoryRepository(client).listFirmMembers(FIRM_ID)).rejects.toBe(
      dbError,
    );
  });
});

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

/**
 * Behavioural tests for listVerifiedLawyers(): an in-memory table that
 * actually APPLIES the .eq() filters, so these assert which rows come back
 * (not merely which filters were requested). Models the post-fix data
 * states: verified+lawyer, pending, rejected, resubmitted, verified with
 * role NULL (legacy / unbackfilled), and verified non-lawyer roles.
 */
interface PvRow {
  profile_id: string;
  registration_number: string;
  reviewed_at: string | null;
  status: string;
  role: string | null;
  profiles: { full_name: string | null } | null;
}

function createVerificationsClient(rows: PvRow[]) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select: vi.fn(),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    }),
    then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) => {
      const data = rows
        .filter((row) => filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value))
        // The real query embeds profiles with !inner: no profile => no row.
        .filter((row) => row.profiles !== null)
        .map(({ profile_id, registration_number, reviewed_at, profiles }) => ({
          profile_id,
          registration_number,
          reviewed_at,
          profiles,
        }));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  query.select.mockReturnValue(query);
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

const pv = (overrides: Partial<PvRow>): PvRow => ({
  profile_id: 'p1',
  registration_number: 'MH/1/2020',
  reviewed_at: '2026-08-01T00:00:00.000Z',
  status: 'verified',
  role: 'lawyer',
  profiles: { full_name: 'Asha Rao' },
  ...overrides,
});

describe('LawyerDirectoryRepository#listVerifiedLawyers', () => {
  it('lists an approved lawyer (status verified, role lawyer) with the mapped shape', async () => {
    const { client, from } = createVerificationsClient([pv({})]);

    const result = await new LawyerDirectoryRepository(client).listVerifiedLawyers();

    expect(from).toHaveBeenCalledWith('professional_verifications');
    expect(result).toEqual([
      {
        profile_id: 'p1',
        full_name: 'Asha Rao',
        registration_number: 'MH/1/2020',
        verified_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('does NOT list a verified record whose role is NULL', async () => {
    const { client } = createVerificationsClient([pv({ role: null })]);
    expect(await new LawyerDirectoryRepository(client).listVerifiedLawyers()).toEqual([]);
  });

  it.each(['individual', 'law_firm', 'business'])('does NOT list a verified %s', async (role) => {
    const { client } = createVerificationsClient([pv({ role })]);
    expect(await new LawyerDirectoryRepository(client).listVerifiedLawyers()).toEqual([]);
  });

  it.each(['pending', 'rejected', 'resubmitted'])('does NOT list a %s lawyer', async (status) => {
    const { client } = createVerificationsClient([pv({ status, reviewed_at: null })]);
    expect(await new LawyerDirectoryRepository(client).listVerifiedLawyers()).toEqual([]);
  });

  it('keeps the profile join requirement and returns only eligible rows from a mixed set', async () => {
    const { client } = createVerificationsClient([
      pv({ profile_id: 'ok' }),
      pv({ profile_id: 'pending', status: 'pending' }),
      pv({ profile_id: 'rejected', status: 'rejected' }),
      pv({ profile_id: 'norole', role: null }),
      pv({ profile_id: 'noprofile', profiles: null }),
    ]);

    const result = await new LawyerDirectoryRepository(client).listVerifiedLawyers();

    expect(result.map((r) => r.profile_id)).toEqual(['ok']);
  });

  it('propagates database errors', async () => {
    const dbError = new Error('boom');
    const query = createQuery({ data: null, error: dbError });
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    await expect(new LawyerDirectoryRepository(client).listVerifiedLawyers()).rejects.toBe(dbError);
  });
});

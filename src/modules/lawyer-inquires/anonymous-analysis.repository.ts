import type { SupabaseClient } from '@supabase/supabase-js';

// FLAGGED: no repository-layer type convention (hand-written row
// interfaces vs. generated Supabase types) was confirmed against pasted
// source this session — this row shape is hand-typed to match the
// migration column-for-column, not imported from a generated types file
// that may or may not exist in the real project.
interface AnonymousAnalysisSessionRow {
  id: string;
  session_token: string;
  document_storage_path: string;
  analysis_result: unknown;
  created_at: string;
  expires_at: string;
  reattached_profile_id: string | null;
}

interface UpsertByTokenInput {
  documentStoragePath: string;
  analysisResult: unknown;
  expiresAt: string;
}

const TABLE = 'anonymous_analysis_sessions';

/**
 * Thin Postgres access for anonymous_analysis_sessions. Always called
 * with the admin (service-role) client — see the factory's doc comment —
 * since the table has zero client-facing RLS policies by design.
 *
 * findByToken() and markReattached() aren't called by
 * AnonymousAnalysisService yet — they exist for the signup-reattachment
 * step (§2, step 5), a file not yet written. Included now so that file
 * doesn't have to circle back and re-edit this one; flagged as
 * speculative-but-scoped rather than silently expanding this file's
 * responsibility beyond what's confirmed needed.
 */
export class AnonymousAnalysisRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsertByToken(sessionToken: string, input: UpsertByTokenInput): Promise<void> {
    const { error } = await this.client.from(TABLE).upsert(
      {
        session_token: sessionToken,
        document_storage_path: input.documentStoragePath,
        analysis_result: input.analysisResult,
        expires_at: input.expiresAt,
      },
      { onConflict: 'session_token' }
    );

    // FLAGGED: thrown raw here, not wrapped in AppError — inconsistent
    // with AnonymousAnalysisService, which does wrap the Storage upload
    // error into an AppError at the call site above this repository call.
    // No existing repository-layer error-wrapping convention was found
    // in pasted source this session (File 48's DocumentService/
    // DocumentRepository split wasn't itself pasted) to confirm which
    // layer should own that wrapping — left inconsistent rather than
    // guessed, so it's visible instead of silently "fixed" one way.
    if (error) {
      throw error;
    }
  }

  async findByToken(sessionToken: string): Promise<AnonymousAnalysisSessionRow | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('session_token', sessionToken)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  async markReattached(sessionToken: string, profileId: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({ reattached_profile_id: profileId })
      .eq('session_token', sessionToken);

    if (error) {
      throw error;
    }
  }
}
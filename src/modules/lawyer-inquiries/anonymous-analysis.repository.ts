import type { SupabaseClient } from '@supabase/supabase-js';

import { hashSessionToken } from './anonymous-analysis.token';

// Hand-typed to match the migration column-for-column (see
// 20260809000000_create_lawyer_inquiries.sql). NOTE: after P2-02,
// `session_token` holds the SHA-256 hex digest of the cookie token, never
// the raw token.
export interface AnonymousAnalysisSessionRow {
  id: string;
  session_token: string;
  document_storage_path: string;
  analysis_result: unknown;
  created_at: string;
  expires_at: string;
  reattached_profile_id: string | null;
}

const TABLE = 'anonymous_analysis_sessions';

/**
 * Thin Postgres access for anonymous_analysis_sessions. Always called with
 * the admin (service-role) client — the table has zero RLS policies by
 * design — so EVERY method here takes the RAW cookie token and derives the
 * lookup key itself. Callers can never pass an id, row key or path chosen
 * by the client; the only way to address a row is to hold its token.
 */
export class AnonymousAnalysisRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Inserts a brand-new session. Throws on any DB error (incl. conflict). */
  async create(
    sessionToken: string,
    input: { documentStoragePath: string; analysisResult: unknown; expiresAt: string },
  ): Promise<void> {
    const { error } = await this.client.from(TABLE).insert({
      session_token: hashSessionToken(sessionToken),
      document_storage_path: input.documentStoragePath,
      analysis_result: input.analysisResult,
      expires_at: input.expiresAt,
    });

    if (error) {
      throw error;
    }
  }

  /**
   * Compare-and-swap replacement of a live session's document + analysis.
   * Succeeds only if the row still points at `expectedPath` (so two
   * concurrent uploads can't both "win"), is unexpired, and is not yet
   * reattached. Expiry is deliberately NOT extended. Returns false if
   * nothing matched.
   */
  async replaceDocument(
    sessionToken: string,
    expectedPath: string,
    input: { documentStoragePath: string; analysisResult: unknown },
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from(TABLE)
      .update({
        document_storage_path: input.documentStoragePath,
        analysis_result: input.analysisResult,
      })
      .eq('session_token', hashSessionToken(sessionToken))
      .eq('document_storage_path', expectedPath)
      .is('reattached_profile_id', null)
      .gt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      throw error;
    }

    return (data?.length ?? 0) === 1;
  }

  async findByToken(sessionToken: string): Promise<AnonymousAnalysisSessionRow | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('session_token', hashSessionToken(sessionToken))
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
      .eq('session_token', hashSessionToken(sessionToken))
      .is('reattached_profile_id', null);

    if (error) {
      throw error;
    }
  }
}

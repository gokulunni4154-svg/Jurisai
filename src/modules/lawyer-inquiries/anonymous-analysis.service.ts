import { randomUUID } from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ConflictError,
  DatabaseError,
  ExternalServiceError,
  ValidationError,
} from '@/core/errors/app-error';
import type { RateLimiter } from '@/core/rate-limit/db-rate-limiter';

import type { AnonymousAnalysisRepository } from './anonymous-analysis.repository';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from './anonymous-analysis.token';
import {
  ANON_ALLOWED_MIME_TYPE,
  ANON_MAX_EXTRACTED_CHARS,
  sanitizeFilename,
  validateAnonymousUpload,
} from './anonymous-analysis.validation';
import type { LawyerInquiryRepository } from './lawyer-inquiry.repository';

// Must match the bucket id in 20260712070007_create_documents_table.sql.
const BUCKET = 'legal-vault-documents';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // matches the cookie lifetime

// Per-session and session-creation limits (the per-IP limit is applied by
// the route). Counted before any expensive work.
const SESSION_UPLOADS_PER_HOUR = 5;
const NEW_SESSIONS_PER_IP_PER_HOUR = 5;
const HOUR_SECONDS = 3600;

// Shared across ALL anonymous-analysis requests (deliberately not per-IP or
// per-session): hard cap on total anonymous AI spend. Consumed only
// immediately before the AI call, so rejected uploads and failed text
// extraction never count against it.
const GLOBAL_AI_KEY = 'anon-analysis:global';
const GLOBAL_AI_REQUESTS_PER_HOUR = 300;

/** Extracts plain text from PDF bytes; throws ValidationError / ExternalServiceError. */
export type TextExtractor = (bytes: Uint8Array) => Promise<string>;
/** Runs the real AI document analysis; throws AppError subclasses only. */
export type DocumentAnalyzer = (documentText: string) => Promise<unknown>;

interface CreateAnonymousAnalysisInput {
  file: File;
  existingSessionToken: string | null;
  /** Hashed (never raw) client IP, used only to bucket session creation. */
  clientKey: string;
}

interface CreateAnonymousAnalysisResult {
  sessionToken: string;
  analysisResult: unknown;
  expiresAt: string;
}

interface ReattachSessionInput {
  sessionToken: string;
  profileId: string;
  targetProfileId: string | null;
  targetFirmId: string;
}

export class AnonymousAnalysisService {
  constructor(
    private readonly deps: {
      repository: AnonymousAnalysisRepository;
      storageClient: SupabaseClient;
      lawyerInquiryRepository: LawyerInquiryRepository;
      rateLimiter: RateLimiter;
      extractText: TextExtractor;
      analyze: DocumentAnalyzer;
    },
  ) {}

  async createAnonymousAnalysis(
    input: CreateAnonymousAnalysisInput,
  ): Promise<CreateAnonymousAnalysisResult> {
    // 1. Cheap validation first: nothing below runs for a bad file.
    const bytes = await validateAnonymousUpload(input.file);

    // 2. Resolve the session. A cookie token only ever selects a session
    //    when it is well-formed, hashes to an existing row, is unexpired,
    //    and has not been reattached. Anything else — unknown, expired,
    //    reattached, malformed — is indistinguishable to the caller: a
    //    fresh session is minted, and no detail about other sessions leaks.
    const existing = await this.resolveLiveSession(input.existingSessionToken);

    if (existing) {
      await this.deps.rateLimiter.consume(
        `anon-analysis:session:${hashSessionToken(existing.token)}`,
        SESSION_UPLOADS_PER_HOUR,
        HOUR_SECONDS,
      );
    } else {
      await this.deps.rateLimiter.consume(
        `anon-analysis:new-session:${input.clientKey}`,
        NEW_SESSIONS_PER_IP_PER_HOUR,
        HOUR_SECONDS,
      );
    }

    // 3. Analyse in memory BEFORE touching Storage or the DB, so a parser or
    //    AI failure leaves nothing behind to clean up.
    const text = await this.deps.extractText(bytes);
    if (text.length > ANON_MAX_EXTRACTED_CHARS) {
      throw new ValidationError('This document is too long to analyse.');
    }

    //    Global AI quota: last gate before spend. Fail-closed — a
    //    RateLimitError (or a limiter failure) propagates and analyze() is
    //    never reached.
    await this.deps.rateLimiter.consume(
      GLOBAL_AI_KEY,
      GLOBAL_AI_REQUESTS_PER_HOUR,
      HOUR_SECONDS,
    );
    const analysisResult = await this.deps.analyze(text);

    // 4. Persist. Storage path is derived server-side from the token HASH
    //    and a fresh UUID; no client-supplied path component except the
    //    sanitised filename.
    const sessionToken = existing?.token ?? generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const storagePath = `anon/${tokenHash}/${randomUUID()}/${sanitizeFilename(input.file.name)}`;

    const { error: uploadError } = await this.deps.storageClient.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: ANON_ALLOWED_MIME_TYPE, upsert: false });

    if (uploadError) {
      throw new ExternalServiceError(
        'supabase-storage',
        'Failed to store the uploaded document.',
        uploadError,
      );
    }

    let expiresAt: string;

    try {
      if (existing) {
        const swapped = await this.deps.repository.replaceDocument(
          sessionToken,
          existing.row.document_storage_path,
          { documentStoragePath: storagePath, analysisResult },
        );
        if (!swapped) {
          // Lost a race with a concurrent upload / expiry / reattach.
          throw new ConflictError('Your session changed during upload. Please try again.');
        }
        expiresAt = existing.row.expires_at;
      } else {
        expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        await this.deps.repository.create(sessionToken, {
          documentStoragePath: storagePath,
          analysisResult,
          expiresAt,
        });
      }
    } catch (error) {
      await this.removeObject(storagePath); // no orphaned file
      if (error instanceof ConflictError) throw error;
      throw new DatabaseError('Failed to save the anonymous analysis session.', error);
    }

    // 5. The previous document is now unreferenced. Only delete it if it is
    //    inside THIS session's own prefix (defence in depth: the path came
    //    from the DB, but never delete outside anon/<this-hash>/).
    if (existing && existing.row.document_storage_path.startsWith(`anon/${tokenHash}/`)) {
      await this.removeObject(existing.row.document_storage_path);
    }

    return { sessionToken, analysisResult, expiresAt };
  }

  /**
   * Called from POST /api/auth/sign-in after a successful sign-in. Silent
   * no-op on every ineligible case (missing, malformed, expired, already
   * reattached) — see that route for why errors are swallowed.
   */
  async reattachSession(input: ReattachSessionInput): Promise<void> {
    if (!isWellFormedSessionToken(input.sessionToken)) {
      return;
    }

    const session = await this.deps.repository.findByToken(input.sessionToken);

    if (!session) {
      return;
    }

    if (session.reattached_profile_id) {
      return;
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      return;
    }

    await this.deps.lawyerInquiryRepository.create({
      clientProfileId: input.profileId,
      targetProfileId: input.targetProfileId,
      targetFirmId: input.targetFirmId,
      documentStoragePath: session.document_storage_path,
      analysisResult: session.analysis_result,
    });

    await this.deps.repository.markReattached(input.sessionToken, input.profileId);
  }

  private async resolveLiveSession(token: string | null) {
    if (!token || !isWellFormedSessionToken(token)) {
      return null;
    }

    const row = await this.deps.repository.findByToken(token);

    if (!row || row.reattached_profile_id || new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }

    return { token, row };
  }

  /** Best-effort cleanup; a failure here must never mask the real outcome. */
  private async removeObject(path: string): Promise<void> {
    try {
      await this.deps.storageClient.storage.from(BUCKET).remove([path]);
    } catch {
      /* ignored on purpose — see doc comment */
    }
  }
}

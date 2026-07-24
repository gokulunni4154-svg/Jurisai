import { randomUUID } from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '@/core/errors/app-error';

import type { AnonymousAnalysisRepository } from './anonymous-analysis.repository';
import type { LawyerInquiryRepository } from './lawyer-inquiry.repository';

// Duplicated from File 45's bucket config rather than imported — no
// shared constants module covering these was found in pasted source
// this session. Values must stay in sync with the
// 20260712070007_create_documents_table.sql migration by hand until
// such a module exists; flagged, not a discovered convention.
const BUCKET = 'legal-vault-documents';
const MAX_SIZE_BYTES = 26214400; // 25 MiB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/tiff',
]);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches anonymous_analysis_sessions.expires_at

interface CreateAnonymousAnalysisInput {
  file: File;
  existingSessionToken: string | null;
}

interface CreateAnonymousAnalysisResult {
  sessionToken: string;
  // FLAGGED: should be DocumentAnalysisResult (analysis.schemas.ts,
  // referenced by document_analyses' own migration comment) once that
  // type's real shape is confirmed — never pasted this session.
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
      // FLAGGED: pulling LawyerInquiryRepository into
      // AnonymousAnalysisService's own dependency list is a real module-
      // boundary judgment call — reattachSession() straddles both
      // anonymous_analysis_sessions and lawyer_inquiries by definition
      // (§2 step 5's whole point is connecting the two), so it has to
      // live somewhere that can reach both. Kept it here rather than
      // inventing a separate coordinator/orchestrator class, since no
      // precedent for a cross-module coordinator was found in pasted
      // source this session — if one exists elsewhere in the project,
      // this method probably belongs there instead.
      lawyerInquiryRepository: LawyerInquiryRepository;
    }
  ) {}

  async createAnonymousAnalysis(
    input: CreateAnonymousAnalysisInput
  ): Promise<CreateAnonymousAnalysisResult> {
    this.validateFile(input.file);

    // ASSUMPTION, not decided in the scoping doc: since
    // anonymous_analysis_sessions holds exactly one document per
    // session_token (no per-document id of its own), a second upload
    // under an existing token is treated as replacing the session's
    // document + analysis, not adding a second one. If the intended
    // behavior is "one upload per session, reject a second," this method
    // needs a findByToken() guard added before upload — flagged rather
    // than silently picked.
    const sessionToken = input.existingSessionToken ?? randomUUID();
    const documentId = randomUUID();
    const sanitizedFilename = this.sanitizeFilename(input.file.name);
    const storagePath = `anon/${sessionToken}/${documentId}/${sanitizedFilename}`;

    const { error: uploadError } = await this.deps.storageClient.storage
      .from(BUCKET)
      .upload(storagePath, input.file, {
        contentType: input.file.type,
        upsert: false,
      });

    if (uploadError) {
      throw new AppError('Failed to store the uploaded document.', {
        statusCode: 500,
        cause: uploadError,
      });
    }

    // FLAGGED — the biggest open assumption in this file. The real AI
    // Document Analysis entry point was never pasted this session, so
    // runDocumentAnalysis() below is a stand-in: name, signature, and
    // even whether analysis is synchronous are all unconfirmed.
    // document_analyses' own status enum (pending/processing/completed/
    // failed) suggests the real pipeline may be async/queued — if so,
    // this method's shape changes materially: it would need to persist a
    // 'pending' analysis_result placeholder and let a separate
    // completion path update the row, rather than awaiting a result
    // inline as written here. Not resolved without the real source.
    const analysisResult = await runDocumentAnalysis({ storagePath, bucket: BUCKET });

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    await this.deps.repository.upsertByToken(sessionToken, {
      documentStoragePath: storagePath,
      analysisResult,
      expiresAt,
    });

    return { sessionToken, analysisResult, expiresAt };
  }

  /**
   * Called from POST /api/auth/sign-in after a successful sign-in (see
   * that route's own doc comment for why reattachment lives there and
   * not inside AuthService). Finds the anonymous session by token, and
   * if it's still eligible, creates the real lawyer_inquiries row and
   * marks the session reattached.
   *
   * Deliberately silent/no-op, not throwing, on every ineligible case
   * (missing, expired, already reattached) — this method's only caller
   * swallows errors anyway (see the sign-in route's doc comment on why),
   * so throwing here would just be a slower way to reach the same
   * outcome. Kept as explicit early returns rather than one combined
   * condition, so each ineligible case is individually legible if this
   * ever gets real logging/observability wired in — flagged as the
   * natural place to add that once a logging hook exists.
   */
  async reattachSession(input: ReattachSessionInput): Promise<void> {
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

  private validateFile(file: File): void {
    if (file.size > MAX_SIZE_BYTES) {
      throw new AppError('File exceeds the 25 MiB limit.', { statusCode: 400 });
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw new AppError('Unsupported file type.', { statusCode: 400 });
    }
  }

  private sanitizeFilename(filename: string): string {
    // FLAGGED: File 45's doc comment references "sanitized_filename" as
    // an established convention, but no sanitizeFilename() utility was
    // found anywhere in pasted source this session. Implemented fresh,
    // narrowly, here — not confirmed against a real shared utility if
    // one exists elsewhere in the project.
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

// FLAGGED placeholder for the real AI Document Analysis entry point —
// see the call site comment above. Remove once the real import exists.
declare function runDocumentAnalysis(args: {
  storagePath: string;
  bucket: string;
}): Promise<unknown>;
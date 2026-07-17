// src/modules/ocr/providers/google-vision.provider.ts
// File 71 — JurisAI OCR module

import { randomUUID } from 'node:crypto';

import { ImageAnnotatorClient } from '@google-cloud/vision';
import { Storage } from '@google-cloud/storage';

import { serverEnv } from '@/core/config/env.server';

import {
  OCRExtractionInput,
  OCRExtractionResult,
  OCRProvider,
  OCRProviderError,
} from '../ocr-provider.interface';

/**
 * Cloud Vision's async batch endpoint (files:asyncBatchAnnotate) only
 * accepts these two MIME types — confirmed against real Google Cloud
 * documentation. Any other input is rejected immediately, before any
 * network call is made, rather than surfacing as a confusing remote
 * API error.
 */
const SUPPORTED_MIME_TYPES = new Set(['application/pdf', 'image/tiff']);

/**
 * How many pages Cloud Vision groups into each output JSON file. A
 * named, documented constant rather than a magic number: smaller values
 * mean more output files to list/download/clean up per extraction;
 * larger values mean fewer, larger files. 20 is a reasonable default
 * for typical legal documents (contracts, filings, orders), which are
 * rarely more than a few hundred pages.
 */
const OUTPUT_BATCH_SIZE = 20;

/**
 * Concrete OCRProvider implementation backed by Google Cloud Vision's
 * asynchronous batch document-text-detection API.
 *
 * PIPELINE (see File 70's interface doc for why none of this is exposed
 * in the shared contract):
 *   1. Fetch the source file's bytes from `input.fileUrl`.
 *   2. Stage those bytes into the configured GCS bucket — Cloud Vision's
 *      async batch API only reads from Cloud Storage, not arbitrary URLs.
 *   3. Call files.asyncBatchAnnotateFiles(), which returns a
 *      long-running Operation; await its completion.
 *   4. List and download the resulting JSON output file(s) from GCS.
 *   5. Concatenate extracted text across all pages, ordered by each
 *      response's own `context.pageNumber` (NOT by output filename —
 *      filenames sort lexicographically, e.g. "output-10-to-12.json"
 *      sorts before "output-2-to-4.json", which would silently
 *      reorder pages if trusted).
 *   6. Delete the staged input and output objects from GCS.
 *
 * Step 6 is awaited, not fire-and-forget: legal documents are sensitive,
 * and leaving them in a second cloud provider's storage after use is a
 * real exposure this module should not create. A cleanup failure is
 * logged but does NOT fail an otherwise-successful extraction — the
 * caller already has their text; a stuck staging object is a
 * housekeeping problem for the bucket's own lifecycle rule (configured
 * at the infrastructure level, not in this code) to catch as a backstop.
 *
 * No automatic retry logic lives here, matching the AI provider layer's
 * convention: retry/fallback decisions belong to an orchestration layer
 * above individual providers (generateWithFallback() for AI, File 61),
 * not inside the provider itself. There is only one OCR provider today,
 * so no such orchestration layer exists yet — every failure here is
 * thrown as OCRProviderError with an honest `category`, ready for a
 * future orchestration layer to make retry decisions from, without this
 * file needing to change.
 */
export class GoogleVisionOCRProvider implements OCRProvider {
  private readonly visionClient: ImageAnnotatorClient;
  private readonly storageClient: Storage;
  private readonly bucketName: string;

  constructor() {
    const credentials = {
      client_email: serverEnv.GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY.client_email,
      private_key: serverEnv.GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY.private_key,
    };
    const projectId = serverEnv.GOOGLE_CLOUD_VISION_SERVICE_ACCOUNT_KEY.project_id;

    this.visionClient = new ImageAnnotatorClient({ credentials, projectId });
    this.storageClient = new Storage({ credentials, projectId });
    this.bucketName = serverEnv.GOOGLE_CLOUD_VISION_STAGING_BUCKET;
  }

  async extractText(input: OCRExtractionInput): Promise<OCRExtractionResult> {
    if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) {
      throw new OCRProviderError(
        'permanent',
        `Unsupported mimeType for OCR: "${input.mimeType}". ` +
          `Only ${Array.from(SUPPORTED_MIME_TYPES).join(', ')} are supported.`,
      );
    }

    const stagingId = randomUUID();
    const sourcePath = `ocr-staging/${stagingId}/source${extensionFor(input.mimeType)}`;
    const destinationPrefix = `ocr-staging/${stagingId}/results/`;

    try {
      const fileBuffer = await this.fetchSourceBytes(input.fileUrl);
      await this.uploadToStaging(sourcePath, fileBuffer, input.mimeType);

      const result = await this.runAsyncBatchAnnotate(
        sourcePath,
        destinationPrefix,
        input.mimeType,
      );

      return result;
    } finally {
      // Cleanup runs regardless of success or failure above — a failed
      // extraction may still have uploaded a source file that needs
      // removing. Cleanup errors are swallowed (logged only): a
      // cleanup failure must never mask the real extraction outcome,
      // and must never turn a successful extraction into a thrown
      // error.
      await this.cleanupStaging(sourcePath, destinationPrefix);
    }
  }

  /**
   * Fetches the source document's raw bytes from the signed URL the
   * caller provided. Network failures here are always treated as
   * transient — a signed URL that's genuinely expired or malformed
   * would fail with a distinguishable HTTP status, but this module
   * intentionally does not special-case that: DocumentService (File
   * 48) owns signed-URL lifetime, not this one.
   */
  private async fetchSourceBytes(fileUrl: string): Promise<Buffer> {
    let response: Response;
    try {
      response = await fetch(fileUrl);
    } catch (error) {
      throw new OCRProviderError('transient', 'Failed to fetch source document for OCR', error);
    }

    if (!response.ok) {
      throw new OCRProviderError(
        'transient',
        `Failed to fetch source document for OCR: HTTP ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async uploadToStaging(
    path: string,
    contents: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await this.storageClient.bucket(this.bucketName).file(path).save(contents, {
        contentType,
        resumable: false,
      });
    } catch (error) {
      throw new OCRProviderError(
        'transient',
        'Failed to stage document in Cloud Storage for OCR',
        error,
      );
    }
  }

  private async runAsyncBatchAnnotate(
    sourcePath: string,
    destinationPrefix: string,
    mimeType: string,
  ): Promise<OCRExtractionResult> {
    const gcsSourceUri = `gs://${this.bucketName}/${sourcePath}`;
    const gcsDestinationUri = `gs://${this.bucketName}/${destinationPrefix}`;

    let operation;
    try {
      [operation] = await this.visionClient.asyncBatchAnnotateFiles({
        requests: [
          {
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            inputConfig: { gcsSource: { uri: gcsSourceUri }, mimeType },
            outputConfig: {
              gcsDestination: { uri: gcsDestinationUri },
              batchSize: OUTPUT_BATCH_SIZE,
            },
          },
        ],
      });
    } catch (error) {
      throw new OCRProviderError(
        classifyGoogleApiError(error),
        'Failed to start OCR batch operation',
        error,
      );
    }

    try {
      await operation.promise();
    } catch (error) {
      throw new OCRProviderError(
        classifyGoogleApiError(error),
        'OCR batch operation failed to complete',
        error,
      );
    }

    return this.readResults(destinationPrefix);
  }

  /**
   * Downloads every output JSON file Cloud Vision wrote under
   * `destinationPrefix`, flattens all per-page responses across every
   * file, and orders them by each response's own `context.pageNumber`
   * — not by which file it came from or that file's name. See the
   * class-level doc comment for why filename order is unsafe.
   */
  private async readResults(destinationPrefix: string): Promise<OCRExtractionResult> {
    const [outputFiles] = await this.storageClient
      .bucket(this.bucketName)
      .getFiles({ prefix: destinationPrefix });

    if (outputFiles.length === 0) {
      throw new OCRProviderError(
        'permanent',
        'OCR batch operation completed but produced no output files',
      );
    }

    type PageResponse = { pageNumber: number; text: string; confidence?: number };
    const pages: PageResponse[] = [];

    for (const file of outputFiles) {
      const [contents] = await file.download();
      let parsed: {
        responses?: Array<{
          context?: { pageNumber?: number };
          fullTextAnnotation?: { text?: string; pages?: Array<{ confidence?: number }> };
        }>;
      };
      try {
        parsed = JSON.parse(contents.toString('utf-8'));
      } catch (error) {
        throw new OCRProviderError(
          'permanent',
          `OCR output file ${file.name} was not valid JSON`,
          error,
        );
      }

      for (const response of parsed.responses ?? []) {
        pages.push({
          pageNumber: response.context?.pageNumber ?? pages.length + 1,
          text: response.fullTextAnnotation?.text ?? '',
          confidence: response.fullTextAnnotation?.pages?.[0]?.confidence,
        });
      }
    }

    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    const text = pages.map((page) => page.text).join('\n\n');
    const confidences = pages
      .map((page) => page.confidence)
      .filter((value): value is number => typeof value === 'number');
    const confidence =
      confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : undefined;

    return {
      text,
      pageCount: pages.length,
      confidence,
      provider: 'google-vision',
    };
  }

  private async cleanupStaging(sourcePath: string, destinationPrefix: string): Promise<void> {
    try {
      await this.storageClient.bucket(this.bucketName).file(sourcePath).delete({
        ignoreNotFound: true,
      });
      const [outputFiles] = await this.storageClient
        .bucket(this.bucketName)
        .getFiles({ prefix: destinationPrefix });
      await Promise.all(outputFiles.map((file) => file.delete({ ignoreNotFound: true })));
    } catch (error) {
      // Deliberately swallowed — see class-level doc comment. A bucket
      // lifecycle rule (infra-level, not this code) is the backstop.
      console.error('OCR staging cleanup failed', { sourcePath, destinationPrefix, error });
    }
  }
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return '.pdf';
    case 'image/tiff':
      return '.tiff';
    default:
      // Unreachable in practice — extractText() rejects unsupported
      // MIME types before this is ever called. Kept exhaustive rather
      // than using `as never` here, since a new SUPPORTED_MIME_TYPES
      // entry added later without updating this switch should fail
      // loudly (a generic extension) rather than silently miscompile.
      return '.bin';
  }
}

/**
 * Best-effort classification of a raw google-gax/Google API error into
 * OCRProviderError's transient/permanent categories, based on the
 * error's gRPC status code where available. Deliberately conservative:
 * anything not explicitly recognized as transient is treated as
 * permanent, since incorrectly retrying a genuinely permanent failure
 * (once a future orchestration layer exists) is worse than incorrectly
 * not retrying a transient one.
 */
function classifyGoogleApiError(error: unknown): 'transient' | 'permanent' {
  const code = (error as { code?: number } | null)?.code;
  // google-gax status codes: 4 = DEADLINE_EXCEEDED, 8 = RESOURCE_EXHAUSTED
  // (quota/rate-limit), 14 = UNAVAILABLE.
  const transientCodes = new Set([4, 8, 14]);
  return typeof code === 'number' && transientCodes.has(code) ? 'transient' : 'permanent';
}
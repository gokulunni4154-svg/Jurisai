// src/modules/ocr/ocr-provider.interface.ts
// File 70 — JurisAI OCR module

/**
 * Shared contract every OCR provider implementation must satisfy.
 *
 * Mirrors the spirit of AIProvider (File 58) — a shared interface with
 * concrete provider implementations behind it — but is DELIBERATELY a
 * separate interface, not folded into AIProvider. OCR (extracting raw
 * text from a scanned document) and AI generation (structured analysis
 * of already-extracted text) are different concerns with different
 * failure modes and different provider landscapes: today there is
 * exactly one OCR provider (Google Cloud Vision) versus two AI
 * providers with real fallback logic between them (File 61). Forcing
 * both into one interface would create artificial symmetry rather than
 * a real shared abstraction.
 *
 * DELIBERATE DESIGN CHOICE — this interface is provider-implementation
 * agnostic. It would be simpler to have extractText() accept a
 * gcsSourceUri directly, since that's what Google Cloud Vision's async
 * batch API (files:asyncBatchAnnotate) requires. That was rejected:
 * staging a document into Google Cloud Storage is an implementation
 * detail of ONE provider (GoogleVisionOCRProvider, File 71), not a
 * property of "OCR" as a concept. A future provider that reads files
 * directly (no Cloud Storage staging required) should be able to
 * implement this same interface without the contract changing. The
 * interface therefore speaks only in terms every provider can satisfy:
 * a URL to fetch the source file from, and a MIME type.
 */

/**
 * Input to an OCR extraction request.
 *
 * `fileUrl` is expected to be a signed, time-limited URL the provider
 * can fetch the raw file bytes from directly — the same shape already
 * produced by DocumentService.getDownloadUrl() (File 48) for the Legal
 * Vault's own document downloads. The OCR module does not read from
 * Supabase Storage directly; it is handed a URL and fetches from it,
 * keeping this module decoupled from the storage layer's internals.
 */
export interface OCRExtractionInput {
  /** Signed URL to fetch the source file's bytes from. */
  fileUrl: string;
  /**
   * MIME type of the source file. Deliberately a plain string, not a
   * union type, at this layer: a given provider implementation is
   * responsible for deciding which MIME types it actually supports and
   * throwing OCRProviderError('permanent', ...) for anything it
   * doesn't — narrowing this to a fixed union here would force every
   * future provider to support exactly the same set of formats, which
   * is not a safe assumption to bake into the shared contract.
   */
  mimeType: string;
}

/**
 * Result of a successful OCR extraction.
 *
 * Only `text` and `provider` are guaranteed present. `pageCount` and
 * `confidence` are optional, best-effort metadata: not every provider
 * implementation populates them the same way (Cloud Vision reports
 * per-page confidence; a hypothetical future provider might not report
 * confidence at all), so the service layer (File 75) must not depend
 * on their presence for any correctness-critical logic — they are for
 * display/diagnostics only.
 */
export interface OCRExtractionResult {
  /** The full extracted text, concatenated across all pages in order. */
  text: string;
  /** Number of pages processed, if the provider reports one. */
  pageCount?: number;
  /**
   * Overall confidence score in the [0, 1] range, if the provider
   * reports one. Providers that report per-page or per-block scores
   * are responsible for reducing them to a single overall figure here
   * (e.g. an average) — the shared contract does not carry granular
   * per-block confidence, since no current consumer needs it and it
   * would meaningfully bloat this type for every provider to satisfy.
   */
  confidence?: number;
  /**
   * Identifies which concrete provider produced this result (e.g.
   * 'google-vision'), mirroring AIProvider's generateWithFallback()
   * returning `providerUsed` (File 61, Amendment #18) — the calling
   * service persists this alongside the extracted text for the same
   * auditability reason.
   */
  provider: string;
}

/**
 * Failure category, used by the calling service (File 75) to decide
 * how to record the failure — mirrors the transient/permanent
 * distinction AIProviderError already draws for the AI provider layer
 * (see ARCHITECTURE.md: "The fallback only retries on transient
 * failures ... never on content rejection or invalid-response").
 *
 * There is only one OCR provider today, so there is no fallback logic
 * to drive with this distinction yet — it is included now so that
 * OCRProviderError has the same shape as AIProviderError from day one,
 * rather than this module inventing a second, incompatible error
 * convention that would need reconciling later if a second OCR
 * provider (or a manual-retry feature) is ever added.
 *
 * - 'transient': the same request might succeed if retried (timeout,
 *   rate-limited, temporarily unavailable).
 * - 'permanent': retrying with the same input will not help (corrupt
 *   file, unsupported format, file too large for this provider's
 *   limits).
 */
export type OCRFailureCategory = 'transient' | 'permanent';

/**
 * Thrown by OCRProvider implementations on failure. Never thrown for
 * "OCR ran but produced empty/low-confidence text" — that is a
 * successful extraction with a low-quality result, not a provider
 * failure, and is the calling service's judgment call to make, not
 * this layer's.
 */
export class OCRProviderError extends Error {
  constructor(
    public readonly category: OCRFailureCategory,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OCRProviderError';
  }
}

/**
 * Implemented by every concrete OCR provider (e.g.
 * GoogleVisionOCRProvider, File 71).
 *
 * A single method, deliberately: this module does not need a
 * generateWithFallback()-style orchestration layer (File 61's
 * equivalent) yet, since there is only one provider. Should a second
 * OCR provider ever be added, that orchestration would live in
 * ocr.factory.ts or a new ocr-fallback.ts, wrapping this same
 * interface — not by growing this interface itself.
 */
export interface OCRProvider {
  /**
   * Extracts text from the document at `input.fileUrl`.
   *
   * @throws OCRProviderError on any failure — network, provider quota,
   * unsupported format, or a malformed/empty provider response.
   * Implementations must not let a raw provider-SDK error escape this
   * boundary; every failure path must be wrapped as OCRProviderError
   * with an accurate `category`, the same convention DatabaseError
   * enforces at the repository layer (File 22).
   */
  extractText(input: OCRExtractionInput): Promise<OCRExtractionResult>;
}
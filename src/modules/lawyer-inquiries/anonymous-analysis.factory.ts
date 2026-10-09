import { generateWithFallback } from '@/core/ai/ai-provider.factory';
import { AIProviderError, ExternalServiceError, ValidationError } from '@/core/errors/app-error';
import { DbRateLimiter } from '@/core/rate-limit/db-rate-limiter';
import { createAdminClient } from '@/core/supabase/admin';
import { documentAnalysisResultSchema } from '@/modules/document-analysis/analysis.schemas';
import { buildSystemPrompt } from '@/modules/document-analysis/document-analysis.service';
import { OCRProviderError } from '@/modules/ocr/ocr-provider.interface';
import { PdfTextOCRProvider } from '@/modules/ocr/providers/pdf-text.provider';

import { AnonymousAnalysisRepository } from './anonymous-analysis.repository';
import {
  AnonymousAnalysisService,
  type DocumentAnalyzer,
  type TextExtractor,
} from './anonymous-analysis.service';
import { LawyerInquiryRepository } from './lawyer-inquiry.repository';

const pdfText = new PdfTextOCRProvider();

const extractText: TextExtractor = async (bytes) => {
  try {
    return (await pdfText.extractTextFromBytes(bytes)).text;
  } catch (error) {
    if (error instanceof OCRProviderError && error.category === 'permanent') {
      throw new ValidationError(
        'We could not read text from this PDF. Scanned or password-protected PDFs are not supported yet.',
      );
    }
    throw new ExternalServiceError('pdf-text', 'Document analysis is temporarily unavailable.', error);
  }
};

// Same pipeline pieces the authenticated flow uses (generateWithFallback +
// documentAnalysisResultSchema + the shared system prompt), minus the
// document_analyses row, which requires an owning auth user.
const analyze: DocumentAnalyzer = async (documentText) => {
  try {
    const { result } = await generateWithFallback({
      systemPrompt: buildSystemPrompt(),
      userPrompt: documentText,
      schema: documentAnalysisResultSchema,
    });
    return result;
  } catch (error) {
    if (error instanceof AIProviderError) {
      // Never forward provider messages (or codes) to the visitor.
      throw new ExternalServiceError('ai-provider', 'Document analysis is temporarily unavailable.', error);
    }
    throw error;
  }
};

/**
 * Builds an AnonymousAnalysisService wired to the admin (service-role)
 * client — deliberately not the RLS client, since there is no auth.uid().
 * The service-role client is used for exactly: Storage upload/remove under
 * `anon/<sha256(token)>/…`, anonymous_analysis_sessions rows addressed only
 * by token hash, lawyer_inquiries insert on reattach, and the rate-limit RPC.
 * It never leaves server code (admin.ts is `server-only`).
 */
export async function buildAnonymousAnalysisService(): Promise<AnonymousAnalysisService> {
  const adminClient = createAdminClient();

  return new AnonymousAnalysisService({
    repository: new AnonymousAnalysisRepository(adminClient),
    storageClient: adminClient,
    lawyerInquiryRepository: new LawyerInquiryRepository(adminClient),
    rateLimiter: new DbRateLimiter(adminClient),
    extractText,
    analyze,
  });
}

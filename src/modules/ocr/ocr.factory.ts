// src/modules/ocr/ocr.factory.ts
// File 76 — JurisAI OCR module

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';
import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentService } from '@/modules/documents/document.service';

import { GoogleVisionOCRProvider } from './providers/google-vision.provider';
import { OCRExtractionRepository } from './ocr-extraction.repository';
import { OCRService } from './ocr.service';
import type { OCRProvider } from './ocr-provider.interface';

/**
 * Constructs a request-scoped OCRService.
 *
 * Follows buildDocumentAnalysisService()'s (File 66) pattern exactly for
 * the parts that are identical: resolve the current user once via
 * getCurrentUser(), construct one fresh request-scoped Supabase client
 * via createClient(), never cache either at module scope. DocumentService
 * is constructed inline here (a fresh DocumentRepository + DocumentService
 * sharing the SAME currentUser and supabase client as
 * ocrExtractionRepository below) rather than calling any
 * buildDocumentService() of its own — same consistency reasoning File 66
 * already documents: one shared resolution per request, injected
 * everywhere, over redundant re-resolution via composition.
 *
 * KEY DECISION, new to this factory — GoogleVisionOCRProvider is
 * constructed once at MODULE scope, not per-call like currentUser and
 * supabase above. This is a deliberate divergence from "never cache
 * either at module scope", not an oversight: that rule exists because
 * currentUser and the Supabase client are inherently per-request state
 * (a different caller means a different user, a different cookie-backed
 * session). GoogleVisionOCRProvider (File 71) has no such dependency —
 * its constructor reads only serverEnv (static config: service-account
 * credentials, bucket name), never currentUser or a request-scoped
 * client. Rebuilding it per request would mean constructing a fresh
 * ImageAnnotatorClient and Storage client (real gRPC/HTTP client setup)
 * on every single call for zero behavioral benefit. Module-scope reuse
 * is safe here specifically because the provider is stateless with
 * respect to the caller. If a future OCR provider's constructor ever
 * needs request-scoped input, that provider must NOT be cached this way
 * — this is a property of GoogleVisionOCRProvider specifically, not a
 * new blanket rule for OCRProvider implementations in general.
 *
 * Same RLS note as document-analysis.factory.ts: createClient() is the
 * RLS-respecting client, injected into both OCRExtractionRepository and
 * DocumentRepository — never admin.ts.
 */
const ocrProvider: OCRProvider = new GoogleVisionOCRProvider();

export async function buildOcrService(): Promise<OCRService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const ocrExtractionRepository = new OCRExtractionRepository(supabase);

  const documentRepository = new DocumentRepository(supabase);
  const documentService = new DocumentService(currentUser, documentRepository);

  return new OCRService(currentUser, ocrExtractionRepository, ocrProvider, documentService);
}
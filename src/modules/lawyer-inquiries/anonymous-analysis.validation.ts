import { ValidationError } from '@/core/errors/app-error';

// Only PDFs: the sole OCR provider wired in (PdfTextOCRProvider, unpdf text
// layer) cannot process Word or image files, so accepting them would only
// store files we then fail to analyse. Widen this together with the provider.
export const ANON_ALLOWED_MIME_TYPE = 'application/pdf';
export const ANON_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB (bucket cap is 25 MiB)
export const ANON_MAX_EXTRACTED_CHARS = 300_000; // bounds AI-provider cost per request

const PDF_MAGIC = '%PDF-';

/**
 * SCOPE OF THIS CHECK: the `%PDF-` signature only proves the file *looks like*
 * a PDF. It is NOT malware scanning and NOT a guarantee that the PDF parser
 * (unpdf) is safe against a crafted file (e.g. decompression bombs, huge page
 * counts). Size caps and the extracted-text cap bound cost, nothing more.
 *
 * Validates an uploaded file BEFORE any storage write or AI call. Returns
 * the bytes so the caller reads the file exactly once. Never trusts the
 * browser-supplied MIME type alone: the file must also start with the PDF
 * signature (searched within the first 1 KiB, as PDF readers allow).
 */
export async function validateAnonymousUpload(file: File): Promise<Uint8Array> {
  if (file.size === 0) {
    throw new ValidationError('The uploaded file is empty.');
  }

  if (file.size > ANON_MAX_FILE_BYTES) {
    throw new ValidationError('File exceeds the 10 MiB limit.');
  }

  if (file.type !== ANON_ALLOWED_MIME_TYPE) {
    throw new ValidationError('Unsupported file type. Please upload a PDF.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Re-check the real byte length: File.size is metadata from the parser.
  if (bytes.byteLength === 0 || bytes.byteLength > ANON_MAX_FILE_BYTES) {
    throw new ValidationError('The uploaded file is invalid.');
  }

  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (!head.includes(PDF_MAGIC)) {
    throw new ValidationError('Unsupported file type. Please upload a PDF.');
  }

  return bytes;
}

export function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(-120);
  return cleaned.length > 0 ? cleaned : 'document.pdf';
}

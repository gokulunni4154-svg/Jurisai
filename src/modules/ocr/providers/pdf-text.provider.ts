// src/modules/ocr/providers/pdf-text.provider.ts
// JurisAI OCR module: reads the built-in text layer of a PDF.
// No Google Cloud, no staging bucket, no billing required.

import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

import {
  OCRExtractionInput,
  OCRExtractionResult,
  OCRProvider,
  OCRProviderError,
} from "../ocr-provider.interface";

/**
 * Below this many characters per page (on average), the PDF is treated
 * as a scan with no usable text layer, rather than returning near-empty
 * text that would silently produce a meaningless analysis.
 */
const MIN_CHARS_PER_PAGE = 25;

export class PdfTextOCRProvider implements OCRProvider {
  async extractText(input: OCRExtractionInput): Promise<OCRExtractionResult> {
    if (input.mimeType !== "application/pdf") {
      throw new OCRProviderError(
        "permanent",
        `Unsupported mimeType for text extraction: "${input.mimeType}". Only application/pdf is supported.`,
      );
    }

    let response: Response;
    try {
      response = await fetch(input.fileUrl);
    } catch (error) {
      throw new OCRProviderError(
        "transient",
        "Failed to fetch source document",
        error,
      );
    }
    if (!response.ok) {
      throw new OCRProviderError(
        "transient",
        `Failed to fetch source document: HTTP ${response.status}`,
      );
    }

    return this.extractTextFromBytes(new Uint8Array(await response.arrayBuffer()));
  }

  /**
   * Same text-layer extraction as extractText(), for callers that already
   * hold the bytes in memory (e.g. the anonymous upload route, which
   * analyses BEFORE writing anything to Storage).
   */
  async extractTextFromBytes(bytes: Uint8Array): Promise<OCRExtractionResult> {

    let totalPages: number;
    let text: string;
    try {
      const pdf = await getDocumentProxy(bytes);
      const result = await extractPdfText(pdf, { mergePages: true });
      totalPages = result.totalPages;
      text = result.text;
    } catch (error) {
      throw new OCRProviderError(
        "permanent",
        "Failed to read the PDF text layer",
        error,
      );
    }

    const trimmed = text.trim();
    if (totalPages === 0 || trimmed.length < totalPages * MIN_CHARS_PER_PAGE) {
      throw new OCRProviderError(
        "permanent",
        "This PDF has no readable text layer (it looks like a scan). Scanned documents are not supported yet.",
      );
    }

    return { text: trimmed, pageCount: totalPages, provider: "pdf-text" };
  }
}

import { AppError, ErrorCode, ValidationError } from '@/core/errors/app-error';

const BODY_OVERHEAD_BYTES = 64 * 1024; // multipart boundaries + field headers

/**
 * Reads a multipart/form-data body with a hard byte cap, enforced while
 * streaming — not after request.formData() has already buffered everything.
 * Rejects on a declared Content-Length over the cap AND aborts mid-stream
 * if the actual bytes exceed it (Content-Length can be absent or a lie).
 */
export async function readMultipartWithLimit(
  request: Request,
  maxFileBytes: number,
): Promise<FormData> {
  const maxBodyBytes = maxFileBytes + BODY_OVERHEAD_BYTES;
  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new ValidationError('A file upload is required.');
  }

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      throw new ValidationError('Malformed upload.');
    }
    if (declaredBytes > maxBodyBytes) {
      throw tooLarge();
    }
  }

  if (!request.body) {
    throw new ValidationError('A file upload is required.');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError('Malformed upload.');
  }

  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new ValidationError('Malformed upload.');
  }
}

function tooLarge(): AppError {
  return new AppError({
    code: ErrorCode.VALIDATION_FAILED,
    statusCode: 413,
    message: 'The uploaded file is too large.',
  });
}

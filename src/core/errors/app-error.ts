/**
 * Machine-readable error codes, grouped by domain.
 * Frontend/mobile clients branch on these — never on `message` text.
 */
export const ErrorCode = {
  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',

  // Resource
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // AI providers
  AI_PROVIDER_TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  AI_PROVIDER_RATE_LIMITED: 'AI_PROVIDER_RATE_LIMITED',
  AI_PROVIDER_CONTENT_REJECTED: 'AI_PROVIDER_CONTENT_REJECTED',
  AI_PROVIDER_INVALID_RESPONSE: 'AI_PROVIDER_INVALID_RESPONSE',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',

  // External services (payments, storage, video, etc.)
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',

  // Database
  DATABASE_ERROR: 'DATABASE_ERROR',

  // Fallback
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

interface AppErrorOptions {
  code: ErrorCodeType;
  statusCode: number;
  message: string;
  /**
   * Operational errors are expected failure modes (bad input, not found,
   * a third-party timeout) — safe to catch, log, and return cleanly.
   * Non-operational ("programmer") errors indicate a bug in our own code
   * and should be logged as critical; in most deployments the process
   * should be allowed to restart rather than continue in a possibly
   * corrupted state.
   */
  isOperational?: boolean;
  /** Structured debugging metadata — logged, never sent to the client. */
  context?: Record<string, unknown>;
  /** Original error, if this AppError wraps a lower-level failure. */
  cause?: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });

    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.isOperational = options.isOperational ?? true;
    this.context = options.context;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Safe, client-facing serialization. Deliberately excludes `context` and
   * `stack` — those are for server-side logs only. The global error
   * handler (src/core/errors/error-handler.ts) is the only place this
   * should be called from.
   */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        timestamp: this.timestamp,
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.VALIDATION_FAILED,
      statusCode: 400,
      message,
      isOperational: true,
      context,
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(
    message = 'Authentication required',
    code:
      | typeof ErrorCode.AUTH_INVALID_CREDENTIALS
      | typeof ErrorCode.AUTH_TOKEN_EXPIRED
      | typeof ErrorCode.AUTH_TOKEN_INVALID = ErrorCode.AUTH_TOKEN_INVALID,
    context?: Record<string, unknown>,
  ) {
    super({
      code,
      statusCode: 401,
      message,
      isOperational: true,
      context,
    });
  }
}

export class AuthorizationError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action',
    context?: Record<string, unknown>,
  ) {
    super({
      code: ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
      statusCode: 403,
      message,
      isOperational: true,
      context,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | number) {
    super({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      statusCode: 404,
      message: identifier
        ? `${resource} with identifier "${identifier}" was not found`
        : `${resource} was not found`,
      isOperational: true,
      context: { resource, identifier },
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.RESOURCE_CONFLICT,
      statusCode: 409,
      message,
      isOperational: true,
      context,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(
    message = 'Too many requests. Please try again shortly.',
    retryAfterSeconds?: number,
  ) {
    super({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      statusCode: 429,
      message,
      isOperational: true,
      context: { retryAfterSeconds },
    });
  }
}

/**
 * Errors originating from an AI provider (OpenAI, Gemini). Carries the
 * provider name so the AI service layer can decide whether to retry
 * against a fallback provider or surface the failure to the user.
 */
export class AIProviderError extends AppError {
  public readonly provider: 'openai' | 'gemini';

  /**
   * Narrows the inherited `code: ErrorCodeType` from AppError down to just
   * the five AI-provider-specific codes this class's constructor actually
   * accepts. Without this redeclaration, `code` widens back to the full
   * ErrorCodeType union on any AIProviderError instance — which is what
   * caused chat.service.ts's re-throw (`new AIProviderError(error.provider,
   * error.code, ...)`, inside its `error instanceof AIProviderError` guard)
   * to fail: `error.code` was typed as the full union, not assignable to
   * this constructor's narrower `code` parameter.
   */
  public override readonly code:
    | typeof ErrorCode.AI_PROVIDER_TIMEOUT
    | typeof ErrorCode.AI_PROVIDER_RATE_LIMITED
    | typeof ErrorCode.AI_PROVIDER_CONTENT_REJECTED
    | typeof ErrorCode.AI_PROVIDER_INVALID_RESPONSE
    | typeof ErrorCode.AI_PROVIDER_UNAVAILABLE;

  constructor(
    provider: 'openai' | 'gemini',
    code:
      | typeof ErrorCode.AI_PROVIDER_TIMEOUT
      | typeof ErrorCode.AI_PROVIDER_RATE_LIMITED
      | typeof ErrorCode.AI_PROVIDER_CONTENT_REJECTED
      | typeof ErrorCode.AI_PROVIDER_INVALID_RESPONSE
      | typeof ErrorCode.AI_PROVIDER_UNAVAILABLE,
    message: string,
    cause?: unknown,
  ) {
    super({
      code,
      statusCode: code === ErrorCode.AI_PROVIDER_RATE_LIMITED ? 429 : 502,
      message,
      isOperational: true,
      context: { provider },
      cause,
    });
    this.provider = provider;
    // Explicit re-assignment, not redundant: AIProviderError's own field
    // declaration above runs its (initializer-less) define step right
    // after super() returns and before this line, per standard JS class
    // field semantics — same reason `this.provider = provider` above is
    // required rather than relying on a constructor-param property.
    this.code = code;
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    serviceName: string,
    message: string,
    cause?: unknown,
    context?: Record<string, unknown>,
  ) {
    super({
      code: ErrorCode.EXTERNAL_SERVICE_ERROR,
      statusCode: 502,
      message,
      isOperational: true,
      context: { serviceName, ...context },
      cause,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown, context?: Record<string, unknown>) {
    super({
      code: ErrorCode.DATABASE_ERROR,
      statusCode: 500,
      // Non-operational: a failing database query usually indicates a bug
      // (bad query, schema drift) or infra issue, not expected user input.
      isOperational: false,
      message,
      context,
      cause,
    });
  }
}

/**
 * Fallback for truly unexpected failures. Always non-operational —
 * reaching this class means something wasn't anticipated and caught
 * more specifically upstream.
 */
export class InternalServerError extends AppError {
  constructor(message = 'An unexpected error occurred', cause?: unknown) {
    super({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      statusCode: 500,
      message,
      isOperational: false,
      cause,
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isOperationalError(error: unknown): boolean {
  return isAppError(error) && error.isOperational;
}
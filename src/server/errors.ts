import type { ApiErrorCode } from '../shared/schemas';

const STATUS: Record<ApiErrorCode, number> = {
  GEMINI_NOT_CONFIGURED: 503,
  GEMINI_INVALID_KEY: 503,
  GEMINI_QUOTA_EXHAUSTED: 429,
  FIREBASE_NOT_CONFIGURED: 503,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  AI_OUTPUT_INVALID: 502,
  RESEARCH_FAILED: 422,
  INTERNAL: 500,
};

/** An error whose message is safe to show to the user (no secrets, no private content). */
export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    /** Internal-only diagnostic detail, stored in errorDetails but never sent to clients. */
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
  get status(): number {
    return STATUS[this.code];
  }
}

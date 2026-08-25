export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

// 未知のエラーをAppErrorへ正規化する。ハンドラ層は必ずこの関数を経由させることで、
// APIレスポンス形式(エラーボディの一貫した構造)を全コンテンツで統一する。
// AppError以外(通常のError、文字列throwなど)はすべてINTERNAL_ERRORへ丸められる。
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError("INTERNAL_ERROR", error.message);
  }
  return new AppError("INTERNAL_ERROR", "unknown error");
}

export function toErrorResponseBody(error: AppError): ErrorResponseBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

// ルーティング層の catch から呼び出す単一の入口。
// 戻り値の shape (status + body) をそのままHTTPレスポンスに使う。
export function handleError(error: unknown): { status: number; body: ErrorResponseBody } {
  const appError = normalizeError(error);
  return { status: appError.status, body: toErrorResponseBody(appError) };
}

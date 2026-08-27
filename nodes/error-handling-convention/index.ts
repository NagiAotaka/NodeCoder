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
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface NormalizedError {
  code: string;
  status: number;
  message: string;
  details?: unknown;
}

// ノード横断のエラー契約(Phase 1、配線スパイクで見つかった課題への対応):
// stripe-webhookのStripeSignatureErrorやshared-authのAuthErrorのような、
// このノードを一切importしていない他ノードのエラーであっても、
// `code`(string)/`status`(number)/`message`(string)を持っていれば
// ダックタイピングでその形状を検出し、本来のstatus/codeを保持したまま
// 正規化する。ノード同士が互いをimportする結合は増やさない。
function hasErrorContractShape(
  error: unknown,
): error is { code: string; status: number; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).code === "string" &&
    typeof (error as Record<string, unknown>).status === "number" &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

// 未知のエラーを正規化する。ハンドラ層は必ずこの関数を経由させることで、
// APIレスポンス形式(エラーボディの一貫した構造)を全コンテンツで統一する。
// AppErrorでもエラー契約の形状でもないエラー(通常のError、文字列throwなど)
// はすべてINTERNAL_ERROR(500)へ丸められる。
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return { code: error.code, status: error.status, message: error.message, details: error.details };
  }
  if (hasErrorContractShape(error)) {
    return { code: error.code, status: error.status, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", status: 500, message: error.message };
  }
  return { code: "INTERNAL_ERROR", status: 500, message: "unknown error" };
}

export function toErrorResponseBody(error: NormalizedError): ErrorResponseBody {
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
  const normalized = normalizeError(error);
  return { status: normalized.status, body: toErrorResponseBody(normalized) };
}

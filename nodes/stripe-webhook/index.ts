import { createHmac, timingSafeEqual } from "node:crypto";

export interface StripeWebhookConfig {
  webhookSecret: string;
}

export interface VerifySignatureOptions {
  toleranceSeconds?: number;
  now?: () => number;
}

export class StripeSignatureError extends Error {}

// category: payment のノードでは、冪等性キーの実装が伴わない限り
// retryCountを1より大きくしてはならない(CLAUDE.md「絶対に守ること」)。
// このノードはIdempotencyStoreによる冪等性実装を伴うが、ストアの永続性保証は
// 呼び出し側の実装に依存するため、デフォルトは保守的に1のままとする。
// ストアの永続性を確認した上で、呼び出し側が明示的に上書きすることを想定する。
export const DEFAULT_RETRY_COUNT = 1;

// Stripeの署名スキーム: ヘッダーは "t=<unix秒>,v1=<hmac_sha256_hex>[,v0=...]"、
// 署名対象は `${t}.${rawBody}`。SDKを使わずcryptoのみで検証する。
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  options: VerifySignatureOptions = {},
): { timestamp: number } {
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const now = options.now ?? (() => Date.now() / 1000);

  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=");
    if (key && value) parts[key] = value;
  }

  const timestamp = Number(parts.t);
  const signature = parts.v1;

  if (!timestamp || !signature) {
    throw new StripeSignatureError("signature header is malformed");
  }

  const expectedSignature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const actualBuf = Buffer.from(signature, "hex");

  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw new StripeSignatureError("signature mismatch");
  }

  if (Math.abs(now() - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError("timestamp outside tolerance");
  }

  return { timestamp };
}

// 冪等性: イベントIDベースの重複排除。ストアの実体(メモリ/DB/KVなど)は
// 呼び出し側(content repo)が実装し、このノードはインターフェースのみ定義する。
export interface IdempotencyStore {
  has(eventId: string): Promise<boolean> | boolean;
  markSeen(eventId: string): Promise<void> | void;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface HandleResult {
  event: StripeWebhookEvent;
  duplicate: boolean;
}

export async function handleStripeWebhook(
  rawBody: string,
  signatureHeader: string,
  config: StripeWebhookConfig,
  idempotencyStore: IdempotencyStore,
  options: VerifySignatureOptions = {},
): Promise<HandleResult> {
  verifyStripeSignature(rawBody, signatureHeader, config.webhookSecret, options);

  const event = JSON.parse(rawBody) as StripeWebhookEvent;

  const alreadySeen = await idempotencyStore.has(event.id);
  if (alreadySeen) {
    return { event, duplicate: true };
  }

  await idempotencyStore.markSeen(event.id);
  return { event, duplicate: false };
}

import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthConfig {
  tokenSecret: string;
}

// 失効チェックの実体(DB/KVなど)は呼び出し側(content repo)が実装し、
// このノードはインターフェースのみ定義する。
export interface RevocationStore {
  isRevoked(tokenId: string): Promise<boolean> | boolean;
}

export interface SessionClaims {
  sub: string;
  jti: string; // トークンID。失効チェックのキーに使う
  exp: number; // 有効期限(unix秒)
  [key: string]: unknown;
}

// ノード横断のエラー契約(Phase 1、配線スパイクで見つかった課題への対応):
// ノード同士は互いをimportしないが、`code`(string)と`status`(number)を
// 持つという緩やかな形状の規約には従う。error-handling-conventionの
// normalizeErrorはこの形状をダックタイピングで検出し、AppError以外の
// エラーでも本来のstatus/codeを保持したまま正規化する。
export class AuthError extends Error {
  readonly code = "AUTH_INVALID";
  readonly status = 401;
}

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signSessionToken(claims: SessionClaims, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(Buffer.from(JSON.stringify(claims)));
  const signature = createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  return `${headerPart}.${payloadPart}.${base64UrlEncode(signature)}`;
}

export function verifySessionTokenSignature(token: string, secret: string): SessionClaims {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new AuthError("token is malformed");
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  const actualSignature = base64UrlDecode(signaturePart);

  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    throw new AuthError("signature mismatch");
  }

  const claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as SessionClaims;

  if (claims.exp * 1000 < Date.now()) {
    throw new AuthError("token expired");
  }

  return claims;
}

// トークン失効処理。署名検証に加えて、必ずrevocationStore経由の失効チェックを
// 行う(verify.tsの静的解析はこの呼び出しの存在を確認する)。
export async function verifySessionToken(
  token: string,
  config: AuthConfig,
  revocationStore: RevocationStore,
): Promise<SessionClaims> {
  const claims = verifySessionTokenSignature(token, config.tokenSecret);

  const revoked = await revocationStore.isRevoked(claims.jti);
  if (revoked) {
    throw new AuthError("token has been revoked");
  }

  return claims;
}

// ミドルウェア: リクエストヘッダーからトークンを取り出し、署名検証+失効チェックを行う。
export async function authMiddleware(
  authorizationHeader: string | undefined,
  config: AuthConfig,
  revocationStore: RevocationStore,
): Promise<SessionClaims> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AuthError("missing bearer token");
  }
  const token = authorizationHeader.slice("Bearer ".length);
  return verifySessionToken(token, config, revocationStore);
}

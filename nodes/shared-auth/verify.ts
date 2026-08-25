// verify.ts: shared-auth (auth / security-sensitive)
//
// ROADMAP.md 2.3 の検証方針:
//   - トークン失効処理: 静的解析。失効チェック関数の呼び出しがミドルウェア内に
//     存在するかを確認する。
//
// このノードは外部APIに依存しないため、すべてのテストをこのリポジトリ内で
// 実行できる(CIでの動的テスト制限とは無関係。そもそも動的テストが不要な設計)。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  signSessionToken,
  verifySessionToken,
  authMiddleware,
  AuthError,
  type RevocationStore,
  type SessionClaims,
} from "./index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 静的解析: authMiddleware 内で失効チェック(revocationStore経由)が
//     呼び出されていることをソースコードから確認する ---
function testMiddlewareCallsRevocationCheck() {
  const source = readFileSync(path.join(__dirname, "index.ts"), "utf8");

  const middlewareMatch = source.match(
    /export async function authMiddleware[\s\S]*?\n}/,
  );
  assert.ok(middlewareMatch, "authMiddleware関数が見つからない");

  const middlewareBody = middlewareMatch![0];
  const callsVerifySessionToken = /verifySessionToken\s*\(/.test(middlewareBody);
  assert.ok(
    callsVerifySessionToken,
    "authMiddlewareはverifySessionTokenを呼び出すべき",
  );

  const verifyMatch = source.match(
    /export async function verifySessionToken[\s\S]*?\n}/,
  );
  assert.ok(verifyMatch, "verifySessionToken関数が見つからない");
  const callsRevocationCheck = /revocationStore\.isRevoked\s*\(/.test(verifyMatch![0]);
  assert.ok(
    callsRevocationCheck,
    "verifySessionToken(=authMiddlewareの呼び出し先)はrevocationStore.isRevokedを呼び出すべき",
  );

  console.log(
    "PASS(静的解析): authMiddleware → verifySessionToken 内で失効チェック呼び出しを確認",
  );
}

function baseClaims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    sub: "user_1",
    jti: "token_1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

function noopStore(revoked = false): RevocationStore {
  return { isRevoked: () => revoked };
}

async function testAcceptsValidToken() {
  const secret = "test_token_secret";
  const token = signSessionToken(baseClaims(), secret);

  const claims = await verifySessionToken(token, { tokenSecret: secret }, noopStore());
  assert.equal(claims.sub, "user_1");

  console.log("PASS: 正しい署名・未失効のトークンは受理される");
}

async function testRejectsTamperedToken() {
  const secret = "test_token_secret";
  const token = signSessionToken(baseClaims(), secret);
  const tampered = token.slice(0, -2) + "xx";

  await assert.rejects(
    verifySessionToken(tampered, { tokenSecret: secret }, noopStore()),
    AuthError,
  );

  console.log("PASS: 改ざんされたトークンは拒否される");
}

async function testRejectsExpiredToken() {
  const secret = "test_token_secret";
  const token = signSessionToken(
    baseClaims({ exp: Math.floor(Date.now() / 1000) - 10 }),
    secret,
  );

  await assert.rejects(
    verifySessionToken(token, { tokenSecret: secret }, noopStore()),
    AuthError,
  );

  console.log("PASS: 有効期限切れのトークンは拒否される");
}

async function testRejectsRevokedToken() {
  const secret = "test_token_secret";
  const token = signSessionToken(baseClaims(), secret);

  await assert.rejects(
    verifySessionToken(token, { tokenSecret: secret }, noopStore(true)),
    AuthError,
  );

  console.log("PASS: 失効済みトークンは署名が正しくても拒否される");
}

async function testMiddlewareRejectsMissingHeader() {
  await assert.rejects(
    authMiddleware(undefined, { tokenSecret: "test_token_secret" }, noopStore()),
    AuthError,
  );

  console.log("PASS: Authorizationヘッダーが無い場合ミドルウェアは拒否する");
}

async function main() {
  testMiddlewareCallsRevocationCheck();
  await testAcceptsValidToken();
  await testRejectsTamperedToken();
  await testRejectsExpiredToken();
  await testRejectsRevokedToken();
  await testMiddlewareRejectsMissingHeader();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

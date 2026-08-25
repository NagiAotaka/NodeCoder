// verify.ts: error-handling-convention
//
// 外部サービス連携が無いノードのため、ROADMAP.md 2.3の動的テスト(実APIを叩く
// もの)は該当しない。handleErrorがどんな入力(AppError/通常のError/非Error値)
// を渡されても一貫したレスポンス形状(status + body.error.code/message)に
// 正規化することを構造的に確認する。

import assert from "node:assert/strict";
import { AppError, handleError } from "./index.ts";

function testNormalizesAppError() {
  const { status, body } = handleError(new AppError("NOT_FOUND", "user not found"));
  assert.equal(status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.error.message, "user not found");

  console.log("PASS: AppErrorはcodeに対応するstatusとメッセージへ正規化される");
}

function testNormalizesPlainError() {
  const { status, body } = handleError(new Error("boom"));
  assert.equal(status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "boom");

  console.log("PASS: 通常のErrorはINTERNAL_ERROR(500)へ丸められる");
}

function testNormalizesNonErrorThrow() {
  const { status, body } = handleError("something went wrong");
  assert.equal(status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");

  console.log("PASS: Errorインスタンスでない値もINTERNAL_ERROR(500)へ丸められる");
}

function testPreservesDetails() {
  const { body } = handleError(
    new AppError("VALIDATION_ERROR", "invalid email", { field: "email" }),
  );
  assert.deepEqual(body.error.details, { field: "email" });

  console.log("PASS: detailsが指定された場合はレスポンスボディに含まれる");
}

function testOmitsDetailsWhenAbsent() {
  const { body } = handleError(new AppError("NOT_FOUND", "user not found"));
  assert.ok(!("details" in body.error));

  console.log("PASS: detailsが未指定の場合はレスポンスボディに含まれない");
}

function main() {
  testNormalizesAppError();
  testNormalizesPlainError();
  testNormalizesNonErrorThrow();
  testPreservesDetails();
  testOmitsDetailsWhenAbsent();
}

main();

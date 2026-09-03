// verify.ts: random-rotation (randomization / security-sensitive判定だが
// 実質は外部依存の無い純粋関数)
//
// 検証方針: 決済・認証系のような動的な外部API呼び出しは不要。
// 純粋関数であることを利用し、範囲チェック(統計的な境界テスト)と
// 不正な入力に対するエラー処理を確認する。

import assert from "node:assert/strict";
import { pickNextRotationDeg } from "./index.ts";

function testStaysWithinExpectedRange() {
  const currentRotationDeg = 0;
  const minTurns = 4;
  const maxTurns = 7;
  const lowerBound = currentRotationDeg + minTurns * 360;
  const upperBound = currentRotationDeg + maxTurns * 360 + 360;

  for (let i = 0; i < 1000; i++) {
    const result = pickNextRotationDeg(currentRotationDeg, { minTurns, maxTurns });
    assert.ok(
      result >= lowerBound && result < upperBound,
      `result=${result} は [${lowerBound}, ${upperBound}) の範囲外`,
    );
  }

  console.log("PASS: 1000回試行してすべてminTurns/maxTurnsの範囲内に収まることを確認");
}

function testAccumulatesFromCurrentRotation() {
  const result = pickNextRotationDeg(720, { minTurns: 1, maxTurns: 1 });
  assert.ok(result >= 720 + 360, "現在の回転角(720度)を起点に加算されるべき");

  console.log("PASS: 現在の累積回転角を起点に加算されることを確認");
}

function testRejectsInvalidTurnsRange() {
  assert.throws(() => pickNextRotationDeg(0, { minTurns: 0, maxTurns: 5 }));
  assert.throws(() => pickNextRotationDeg(0, { minTurns: 5, maxTurns: 3 }));

  console.log("PASS: minTurns<=0 や maxTurns<minTurns は拒否されることを確認");
}

function testDefaultsWithoutOptions() {
  const result = pickNextRotationDeg(0);
  assert.ok(result >= 4 * 360 && result < 7 * 360 + 360, "デフォルト(4〜7周)の範囲内であるべき");

  console.log("PASS: optionsを省略してもデフォルト値(4〜7周)で動作することを確認");
}

function main() {
  testStaysWithinExpectedRange();
  testAccumulatesFromCurrentRotation();
  testRejectsInvalidTurnsRange();
  testDefaultsWithoutOptions();
}

main();

// verify.ts: stripe-webhook (payment / security-sensitive)
//
// ROADMAP.md 2.3 の検証方針:
//   - Webhook署名検証: 動的テスト。署名なし/不正なダミーペイロードを送信し、拒否されることを確認。
//   - 冪等性キー・二重課金防止: 動的テスト。テストモードAPIで同一の冪等性キーを2回送信し、
//     課金オブジェクトが1件のみ作成されることを確認。
//
// このファイルの2つのテストのうち、署名検証テストは外部APIを必要としないため
// このリポジトリ内で実行できる(実際に下で実行済み)。冪等性テストは実際に
// Stripeのテストモード課金APIを叩く必要があるため、STRIPE_TEST_SECRET_KEY を
// 手元の .env に設定した上で実行すること(CLAUDE.md「絶対に守ること」参照)。
// CIでは動的テストを実行しない。

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyStripeSignature,
  handleStripeWebhook,
  StripeSignatureError,
  type IdempotencyStore,
} from "./index.ts";

function buildSignatureHeader(rawBody: string, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function testRejectsMissingSignature() {
  const rawBody = JSON.stringify({ id: "evt_test_1", type: "charge.succeeded" });

  assert.throws(
    () => verifyStripeSignature(rawBody, "", "whsec_test_secret"),
    StripeSignatureError,
    "空の署名ヘッダーは拒否されるべき",
  );

  assert.throws(
    () => verifyStripeSignature(rawBody, "t=1234567890,v1=deadbeef", "whsec_test_secret"),
    StripeSignatureError,
    "改ざんされた署名は拒否されるべき",
  );

  console.log("PASS: 署名なし/不正な署名のペイロードは拒否される");
}

async function testAcceptsValidSignature() {
  const secret = "whsec_test_secret";
  const rawBody = JSON.stringify({ id: "evt_test_2", type: "charge.succeeded" });
  const now = Math.floor(Date.now() / 1000);
  const header = buildSignatureHeader(rawBody, secret, now);

  const result = verifyStripeSignature(rawBody, header, secret);
  assert.equal(result.timestamp, now);

  console.log("PASS: 正しい署名のペイロードは受理される");
}

async function testIdempotencyDedup() {
  const secret = "whsec_test_secret";
  const rawBody = JSON.stringify({ id: "evt_test_dup", type: "charge.succeeded" });
  const now = Math.floor(Date.now() / 1000);
  const header = buildSignatureHeader(rawBody, secret, now);

  const seen = new Set<string>();
  const store: IdempotencyStore = {
    has: (eventId) => seen.has(eventId),
    markSeen: (eventId) => {
      seen.add(eventId);
    },
  };

  const first = await handleStripeWebhook(rawBody, header, { webhookSecret: secret }, store);
  const second = await handleStripeWebhook(rawBody, header, { webhookSecret: secret }, store);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);

  console.log("PASS: 同一イベントIDの2回目の配信はduplicateとして検知される(ローカルストアでの冪等性確認)");
}

// 実際のStripeテストモード課金APIに対する動的テスト。
// 実キー(テストモード)を要するため、CIでは実行せず、環境変数がある時のみ実行する。
async function testRealApiIdempotency() {
  const apiKey = process.env.STRIPE_TEST_SECRET_KEY;
  if (!apiKey) {
    console.log(
      "SKIP: STRIPE_TEST_SECRET_KEY が未設定のため、実APIでの冪等性テストをスキップします。" +
        " 手元の.envに設定した上でこのnode-libraryをローカルで再実行してください(CIでは実行しません)。",
    );
    return;
  }

  // 同一のIdempotency-Keyヘッダーを付けてStripe Charges APIへ2回リクエストし、
  // 課金オブジェクトが1件のみ作成されることを確認する(ROADMAP.md 2.3参照)。
  // 実装はここでは行わない: 実キーが渡された時点でユーザー環境固有のテストに
  // なるため、必要になった時点でこの関数の中身を手元で実装・実行すること。
  throw new Error(
    "STRIPE_TEST_SECRET_KEY が設定されています。実APIへの冪等性動的テストは、" +
      "このスクリプトの testRealApiIdempotency() を手元で実装した上で実行してください。",
  );
}

async function main() {
  await testRejectsMissingSignature();
  await testAcceptsValidSignature();
  await testIdempotencyDedup();
  await testRealApiIdempotency();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

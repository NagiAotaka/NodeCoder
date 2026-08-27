---
name: add-node
description: node-library に新しいノードを追加する(schema.yaml の意思決定 + 参照型ノードの実体作成)。Phase 0時点では reference型のみ対応。
---

# /add-node

> **Phase 0スコープの注意**: このSkillが対応するのは Phase 0 の範囲のみ。
> `tools/generate.js`・CI・`check-markers.sh`・`check-nodes-status.sh` は
> まだ存在しない(Phase 1で導入予定)。scaffold型のノード追加は本Skillでは
> まだサポートしない。

## 最重要ルール(CLAUDE.md)

- **コード生成にLLMを使わない。** このSkillの役割は `schema.yaml` の意思決定
  (質問して埋める)までであり、実際のコード生成は決定論的な仕組みに委ねる。
  reference型の場合は「テンプレートを読んで手で穴埋め」も禁止 — import
  される実体(`entry.ts`等)をそのまま直接作成する。
- ノードには reference(参照型)/ scaffold(生成型)の2種類がある。
  **実行時、最初に必ず `node_type` を確認する。**

## 手順

### 1. `node_type` を確認する(最優先・必須)

ユーザーに質問する:

> このノードは **参照型(reference)** ですか、**生成型(scaffold)** ですか?
> - 参照型: 全コンテンツで中身が同じであり続けてほしいもの(利用規約、認証ロジック、決済Webhook処理、共通エラーハンドリング規約、ロギング設定、APIレスポンス形式など)。node-library を直接import/参照する。
> - 生成型: 叩き台として生成し、以後コンテンツごとに改変されていいもの(ページの初期レイアウト、APIエンドポイントの雛形など)。

対象範囲は認証・決済に限らない。エラーハンドリング規約・ロギング設定・
APIレスポンス形式なども同列にノード化の対象となる(CLAUDE.md/ROADMAP.md 0章)。

- **`scaffold` が選ばれた場合**: `tools/generate.js`(決定論的テンプレート
  エンジン)がまだ存在しない(Phase 1で導入予定)ため、その場で作業を
  中断し、ユーザーにその旨を伝える。テンプレートを手で穴埋めするなど、
  generate.js の代わりを自分で行ってはならない。
- **`reference` が選ばれた場合**: 以下のステップに進む。

### 2. 既存の類似ノード・テンプレートを確認する

`nodes/_schema-template.yaml` を参照し、`schema.yaml` のフォーマットを
確認する。既存ノードがあれば `nodes/` 配下も参照し、命名・構成の一貫性を
保つ。

### 3. `required_decision: true` の項目だけを質問する

質問する順序:

1. **`id`**: ノードの識別子(例: `stripe-webhook`、`error-handling-convention`)。
2. **`category`**: 決済・認証系(`payment`/`auth`/`secrets`)に限らず、
   `error-handling`/`logging`/`api-response`のような外部サービスと無関係な
   カテゴリも同列に扱う。
   - `security-sensitive-categories.yaml` に列挙されているカテゴリ、
     または**そこに載っていない新規カテゴリ**の場合は
     security-sensitive 扱いとなる(デフォルトで安全側)。
   - security-sensitive と判定された場合、`forkable` はユーザーに
     選ばせず、**自動的に `false` で固定**する。その旨を一言伝えるのみ
     でよい(「security-sensitiveのため forkable: false に固定します」)。
     `forkable: true` を選ぶ余地は提示しない。
   - security-sensitiveでない場合のみ、`forkable` を質問してよい
     (true/false)。
3. **`config`**(サービス連携があるノードのみ・オプション): 必要な設定
   項目ごとに `name` / `type`(`secret` か `plain`)を質問する。**実値は
   絶対に聞かないし扱わない。** `type: secret` の項目は、キー名だけを
   対象content repoの `.env.example` に追記する対象になる(実値の入力は
   ユーザー自身が `.env` に行う)。
   **サービス連携が無いノード(エラーハンドリング規約、ロギング設定、
   APIレスポンス形式など)では `config` 自体を質問せずスキップしてよい。**
   `config`は必須項目ではない。
4. **`entry`**: 実体ファイルのパス(デフォルト `./index.ts` でよいか確認)。

それ以外の項目(残りのデフォルト値)は質問せず、ベストプラクティスで
自動決定する。

### 4. `schema.yaml` を確定する

`nodes/<id>/schema.yaml` として書き出す。`inputs`/`outputs`/`ui`/
`adapter_interface`/`template`/`template_generation` は**含めない**
(CLAUDE.mdの「将来用フィールドを勝手に足さない」原則)。

### 5. reference型の実体ファイルを直接作成する

`nodes/<id>/entry`(schema.yamlの`entry`で指定したパス)を、generate.js
を経由せず直接作成する。ここがLLMがコードを書く唯一の箇所であり、
以後の更新は「参照先を直せば良い」という参照型ノードの性質上、
このファイルの中身自体が実運用コードになることを意識して書く。

### 6. `verify.ts` を作成・実行する

ノードの性質に応じて検証方法を選ぶ(ROADMAP.md 2.3)。以下は決済・認証
ノードでの検証例であり、**`category`ごとに検証内容は異なる**。他の
カテゴリ(エラーハンドリング規約、ロギング設定など)では、そのノードの
性質に合わせた検証方法(構造チェックや静的解析など)を都度設計する。

| ノードの性質 | 検証方法 |
|---|---|
| Webhook署名検証(参照型・payment) | 動的テスト: 署名なしのダミーペイロードを送信し、拒否されることを確認 |
| 冪等性キー・二重課金防止(参照型・payment) | 動的テスト: テストモードAPIで同一の冪等性キーを付けて2回送信し、課金オブジェクトが1件のみ作成されることを確認 |
| トークン失効処理(参照型・auth) | 静的解析: 失効チェック関数の呼び出しがミドルウェア内に存在するかを確認 |

- **`category: payment` のノードに限り**、冪等性キーの実装が伴わない限り
  `retryCount` を1より大きくしてはならない。これは決済ノード固有の制約
  であり、他のカテゴリには適用されない。verify.ts でこの制約をチェック
  する。

### 7. security-sensitive ノードの場合の確認手順

`category` が security-sensitive と判定されたノードでは、コミット前に
必ず以下を行う:

1. ユーザーに **diff** と **schema.yaml** を提示し、確認を求める。
2. **`verify.ts` の動的テスト**(実際にAPIを叩くもの)を、ユーザーの
   手元の `.env` を使って実行する。CIでは動的テストを実行しない
   (実キーをCI環境に持ち込むことになるため)。
3. ユーザーの確認が取れてから初めてコミットする。

### 8. シークレット管理(ROADMAP.md 2.4)

- 実値(APIキー等)は一切扱わない。`schema.yaml` にもコードにも書かない。
- `type: secret` の `config` 項目は、キー名だけを対象content repoの
  `.env.example` に追記する(`install.sh`が自動生成する分がこれに該当)。
  実値の入力はユーザーに促す。
- ノード自身の `verify.ts` が動的テストで外部APIを叩く必要があり、その
  ために追加のシークレット(例: `STRIPE_TEST_SECRET_KEY`)が要る場合は、
  それを **node-library自身のルート `.env.example`** にキー名だけ追記する。
  これはcontent repo向けの`.env.example`(configのキー)とは別物 —
  node-library内で`verify.ts`を直接実行する開発者向けのファイル。
  こちらも実値は`.env`(`.gitignore`対象)にのみ置く。

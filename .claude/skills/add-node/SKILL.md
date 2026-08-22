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
> - 参照型: 全コンテンツで中身が同じであり続けてほしいもの(利用規約、認証ロジック、決済Webhook処理など)。node-library を直接import/参照する。
> - 生成型: 叩き台として生成し、以後コンテンツごとに改変されていいもの(ページの初期レイアウトなど)。

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

1. **`id`**: ノードの識別子(例: `stripe-webhook`)。
2. **`category`**: 例 `payment` / `auth` / `secrets` など。
   - `security-sensitive-categories.yaml` に列挙されているカテゴリ、
     または**そこに載っていない新規カテゴリ**の場合は
     security-sensitive 扱いとなる(デフォルトで安全側)。
   - security-sensitive と判定された場合、`forkable` はユーザーに
     選ばせず、**自動的に `false` で固定**する。その旨を一言伝えるのみ
     でよい(「security-sensitiveのため forkable: false に固定します」)。
     `forkable: true` を選ぶ余地は提示しない。
   - security-sensitiveでない場合のみ、`forkable` を質問してよい
     (true/false)。
3. **`config`**(サービス連携があるノードのみ): 必要な設定項目ごとに
   `name` / `type`(`secret` か `plain`)を質問する。**実値は絶対に聞かない
   し扱わない。** `type: secret` の項目は、キー名だけを対象content repoの
   `.env.example` に追記する対象になる(実値の入力はユーザー自身が
   `.env` に行う)。
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

ノードの性質に応じて検証方法を選ぶ(ROADMAP.md 2.3):

| ノードの性質 | 検証方法 |
|---|---|
| Webhook署名検証(参照型・payment) | 動的テスト: 署名なしのダミーペイロードを送信し、拒否されることを確認 |
| 冪等性キー・二重課金防止(参照型・payment) | 動的テスト: テストモードAPIで同一の冪等性キーを付けて2回送信し、課金オブジェクトが1件のみ作成されることを確認 |
| トークン失効処理(参照型・auth) | 静的解析: 失効チェック関数の呼び出しがミドルウェア内に存在するかを確認 |

- **`category: payment` のノードでは、冪等性キーの実装が伴わない限り
  `retryCount` を1より大きくしてはならない。** verify.ts でこの制約を
  チェックする。

### 7. security-sensitive ノードの場合の確認手順

`category` が security-sensitive と判定されたノードでは、コミット前に
必ず以下を行う:

1. ユーザーに **diff** と **schema.yaml** を提示し、確認を求める。
2. **`verify.ts` の動的テスト**(実際にAPIを叩くもの)を、ユーザーの
   手元の `.env` を使って実行する。CIでは動的テストを実行しない
   (実キーをCI環境に持ち込むことになるため)。
3. ユーザーの確認が取れてから初めてコミットする。

### 8. シークレット管理

- 実値(APIキー等)は一切扱わない。`schema.yaml` にもコードにも書かない。
- `type: secret` の `config` 項目は、キー名だけを対象content repoの
  `.env.example` に追記する。実値の入力はユーザーに促す。

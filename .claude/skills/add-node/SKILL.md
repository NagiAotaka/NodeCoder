---
name: add-node
description: node-library に新しいノードを追加する(schema.yaml の意思決定 + 参照型ノードの実体作成、または生成型ノードの生成)。
---

# /add-node

> **Phase 1時点のスコープ**: `tools/generate.js` は実装済みのため、
> 生成型(scaffold)ノードの生成もこのSkillで対応する。
> `check-markers.sh`・`check-nodes-status.sh`・CI(`.github/workflows/check.yml`)
> はまだ存在しない(Phase 1で別途導入予定)。

## 最重要ルール(CLAUDE.md)

- **コード生成にLLMを使わない。** このSkillの役割は `schema.yaml` の意思決定
  (質問して埋める)までであり、実際のコード生成は決定論的な仕組みに委ねる。
  reference型の場合は「テンプレートを読んで手で穴埋め」も禁止 — import
  される実体(`entry.ts`等)をそのまま直接作成する。
- ノードには reference(参照型)/ scaffold(生成型)の2種類がある。
  **実行時、最初に必ず `node_type` を確認する。**

## 0. ノード化する前に: Claude Code Skillsとの使い分け

`/add-node`を呼ぶ前に、**そもそもこれをノード化すべきか、Skillsにすべきか**を
毎回ユーザーに確認する必要は無い。以下の基準で自動的に判断する
(content repo側でこのSkillを使う場合も同じ基準を適用する)。

| 判断ポイント | Skillsが向く | Node(node-library)が向く |
|---|---|---|
| プロジェクトごとの差異 | 毎回多少調整してよい(ドメイン名、構成など) | 一言一句同じであってほしい |
| 性質 | 手順・設定パターン(HOW) | 実行可能なロジックそのもの(WHAT) |
| 安全性の要求 | 低〜中 | 高い(決済・認証など、間違えると危険) |
| 既存プロジェクトへの一括修正 | 不要 | 必要(バグ修正を全プロジェクトに反映したい) |
| Claude Code以外での再利用 | 不要 | 必要(人間や別ツールが直接importする) |

判断に迷う場合の簡易テスト: **「このコードが2つのプロジェクトで1バイトも
違わずに動いてほしいか?」** → Yesならノード、No(多少の調整は許容できる)
ならSkills。「セキュリティ上、生成のたびに微妙に実装が変わるのが怖いか?」
→ Yesならノード。

判断が付かない場合のみ、ユーザーに確認する。

## 0.5 実行場所の確認: node-library自身 か content repo か

`/add-node`は2つの文脈で呼ばれうる。**新しいノードの実体ファイル
(`schema.yaml`・`entry.ts`・`template.*.hbs`・`verify.ts`)をどこに作るか**が
文脈によって変わるため、最初に確認する。

- **node-library自身のリポジトリ内で実行している**(直下に`nodes/`がある):
  そのまま`nodes/<id>/`に作る。通常通りコミット・pushする。
- **content repo内で実行している**(`vendor/node-library/`がある。
  `install.sh`で導入済みのプロジェクト): **新しいノードの定義ファイルは
  `vendor/node-library/nodes/<id>/`に作る**(content repo自身の`src/`等では
  ない)。理由: `vendor/node-library`はnode-libraryリポジトリの完全な
  gitチェックアウト(submodule)であり、ここに作ったノードはnode-library
  本体に「共有」できる。手順は次の「共有」節を参照。
  - 例外: 既存の**生成型**ノードを使ってコードを生成するだけの場合(新しい
    ノード定義を作るわけではない)は、生成結果は通常通りcontent repo自身の
    `src/`等に出力する(「手順(scaffold型)」参照)。

## 共有: content repo内で追加した新規ノードをnode-library本体に書き戻す

content repo内で新しいノード(参照型・生成型いずれも)を`vendor/node-library/nodes/<id>/`
に作った場合、そのままでは**そのcontent repoだけのローカルな変更**で終わる。
他のプロジェクトでも使えるようにするには、node-library本体(リモート)に
push する必要がある:

1. `vendor/node-library`はnode-library本体への完全なgitチェックアウトなので、
   その中で新しいブランチを切る:
   ```
   cd vendor/node-library
   git checkout -b add-<新ノードid>
   ```
2. ノードの追加作業(このSkillの通常の手順)を`vendor/node-library/nodes/<id>/`
   配下で行う。security-sensitiveなノードなら手順7の確認も忘れずに行う。
3. コミットし、node-library本体のリモートへpushする(content repo自身の
   pushとは別operationであることに注意):
   ```
   git add nodes/<新ノードid>
   git commit -m "add <新ノードid>"
   git push origin add-<新ノードid>
   ```
4. node-library側でPRを作成し、レビュー後mainにマージする(node-library
   自身の運用ルールに従う。CLAUDE.md「絶対に守ること」参照)。
5. マージ後、**このcontent repo自身の`vendor/node-library`参照コミットも
   更新して、content repo側でコミットする**(そうしないと、このcontent repo
   は新しいノードを使えるのに、まだ古いコミットを参照したままになる):
   ```
   cd vendor/node-library && git checkout main && git pull
   cd ../..
   git add vendor/node-library
   git commit -m "update vendor/node-library"
   ```
6. 他のcontent repoに配りたい場合は、通常の一括反映(`update-nodes.sh`)を使う。

## 手順

### 1. `node_type` を確認する(最優先・必須)

ユーザーに質問する:

> このノードは **参照型(reference)** ですか、**生成型(scaffold)** ですか?
> - 参照型: 全コンテンツで中身が同じであり続けてほしいもの(利用規約、認証ロジック、決済Webhook処理、共通エラーハンドリング規約、ロギング設定、APIレスポンス形式など)。node-library を直接import/参照する。
> - 生成型: 叩き台として生成し、以後コンテンツごとに改変されていいもの(ページの初期レイアウト、APIエンドポイントの雛形など)。

対象範囲は認証・決済に限らない。エラーハンドリング規約・ロギング設定・
APIレスポンス形式なども同列にノード化の対象となる(CLAUDE.md/ROADMAP.md 0章)。

- **`scaffold` が選ばれた場合**: 「手順(scaffold型)」セクションに進む。
- **`reference` が選ばれた場合**: 以下のステップ2〜8に進む。

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

### 9. `nodes/README.md`に1行追記する(発見可能性の担保)

reference型・scaffold型いずれの場合も、ノードの新規追加・`node_type`や
`forkable`の変更を行ったら、最後に`nodes/README.md`の一覧表に1行追記/更新
する。自動生成はしない。`ls nodes/`だけでは各ノードの性質が分からなくなる
ことへの、Phase 0評価で見つかった懸念点への軽量な対応(ROADMAP.md Phase 1)。

### 10. ノード横断のエラー契約(該当するノードのみ)

エラーを投げる可能性があるノード(participant nodeが例外を投げる設計の場合)
を作る際は、そのエラークラスに`code`(string)と`status`(number)プロパティを
持たせる。他ノードをimportする必要は無い — `error-handling-convention`の
`normalizeError`はこの形状をダックタイピングで検出し、`AppError`でなくても
本来のstatus/codeを保持したまま正規化する(Phase 1、配線スパイクで見つかった
「ノード横断のエラー契約の欠如」への対応。`nodes/stripe-webhook/index.ts`の
`StripeSignatureError`、`nodes/shared-auth/index.ts`の`AuthError`が実装例)。

## 手順(scaffold型)

生成型ノードは、content repo内で既存の生成型ノード定義(`node-library`側の
`nodes/<id>/schema.yaml` + `template`)を使って`tools/generate.js`にコードを
生成させる。**LLMはここでコードを一切書かない** — これが最重要ルールの核心。

1. どの生成型ノードを使うか確認する(例: `page-layout-basic`)。存在しない
   場合は、まず`node-library`側でそのノードの`schema.yaml`と`template`を
   用意する必要がある(これは生成型ノードの「新規追加」であり、reference型
   の手順2〜4と同様にLLMが`schema.yaml`とテンプレートを書く)。
2. 対象ノードの`schema.yaml`にある`config`の`required_decision: true`項目
   (例: `title`、`slug`)をユーザーに質問する。
3. 回答を`key: value`形式の一時ファイル(answers.yaml)にまとめる。
4. 出力先パス(content repo内、例: `src/layout/<slug>.ts`)をユーザーに確認する。
5. 次のコマンドを実行する(`<vendor>`はcontent repo内でnode-libraryを
   submodule参照しているパス、通常`vendor/node-library`):
   ```
   node <vendor>/tools/generate.js --node <id> --answers <answers.yaml> --out <output-path>
   ```
6. 出力ファイル先頭には`GENERATED - DO NOT EDIT`マーカーが自動的に付く。
   以後ユーザーがそのファイルを手で編集し`CUSTOMIZED - manual changes below`
   マーカーを追記すれば、`/add-node`を再実行しても**上書きされない**
   (`generate.js`が検知して中断する)。GENERATEDマーカーのみのファイルは
   `schema.yaml`の入力が変わった場合に自動上書きしてよい。
7. 一時ファイル(answers.yaml)は生成後に削除してよい(schema.yamlの入力
   さえ分かれば同じ出力を再現できるため、恒久的に保持する必要はない)。
8. 生成型ノードには`forkable`の概念が無い(生成された時点でcontent repo側
   の独立したコードになるため)。security-sensitiveの重い確認手順
   (手順7参照)も、forkable判定や外部API呼び出しを前提にしたものであり、
   静的なテンプレートのみの生成型ノードには基本的に適用しない。

## フォーク手順(`forkable: true`の参照型ノードのみ)

フォークとは、特定の参照型ノードだけをcontent repo内に独立させ、以後
node-library側の更新を自動で受け取らないようにすることである
(ROADMAP.md 2.5)。**`forkable: true`のノードのみ**対象。`/add-node`の
一部ではなく、content repo内でのファイルレベルの作業であり、`/add-node`
Skillでも代行しない。

1. 対象ノードが`forkable: true`であることを`schema.yaml`で確認する
   (`false`のノードは絶対にフォークしない — 運用ルールと検知スクリプトで
   担保される禁止事項)。
2. `vendor/node-library/nodes/<id>/`フォルダを、content repo内(例:
   `src/nodes/<id>/`)にそのままコピーする。
3. import元をsubmodule経由(`./vendor/node-library/nodes/<id>/...`)から
   コピー先のlocal path(`./src/nodes/<id>/...`)に切り替える。
4. `vendor/node-library`のsubmodule自体は削除しない(他のノードのために
   引き続き参照する)。
5. フォーク後は、そのノードだけ`node-library`側の更新が自動反映されなく
   なる(意図的な仕様。`update-nodes.sh`による一括反映の対象からも外れる)。
   `forkable: true`のノードへの更新時は、node-library側が`# SECURITY-FIX:
   <日付> <一言>`をファイル先頭に追記する運用を残すが、確認は一括反映時
   ではなくCIと`check-markers.sh`実行時に行う(Phase 1で導入予定)。

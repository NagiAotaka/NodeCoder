[ROADMAP.md](https://github.com/user-attachments/files/31332810/ROADMAP.md)
# ノード式ノーコードツール 設計書 兼 ロードマップ

## 0. 目的とスコープ[CLAUDE.md](https://github.com/user-attachments/files/31332811/CLAUDE.md)


**目的**
サイト・アプリ・デジタルコンテンツのコーディングを、なるべく広い範囲で疎結合な「ノード」として分散管理する。これにより:

- 複数のコンテンツにまたがって構成をバラバラに管理できる
- システム的な側面(認証ロジック、決済処理、エラーハンドリング規約、ロギング設定、APIレスポンス形式、ルーティング規約、利用規約テキストなど)は全コンテンツに一括反映できる一方、各コンテンツ固有の状態(レイアウトの改変など)はそのコンテンツ内に留められる
- プレーンなファイル+gitの標準機能だけで成り立つため、将来Claude Code以外のコーディングエージェントに乗り換えても構成自体はそのまま引き継げる

**核心となる分類: 参照型 / 生成型**

| | 参照型ノード | 生成型ノード |
|---|---|---|
| 性質 | 全コンテンツで中身が同じであり続けてほしいもの | 叩き台だけ欲しく、その後はコンテンツごとに変わっていいもの |
| 使い方 | `node-library`を直接import/参照する(コピーしない) | テンプレートから決定論的に生成し、コンテンツ内に書き出す |
| 更新の反映 | `node-library`側を直せば全コンテンツに一括で効く | 生成後は独立するため一括反映の対象外 |
| 例 | 利用規約テキスト、認証ロジック、決済Webhook処理、エラーハンドリング規約、ロギング設定 | ページの初期レイアウト、フォームの雛形、APIエンドポイントの雛形 |

**重要な原則**
- **ビルド時**: Claude Codeが担当するのは「何を作るか(schema.yamlの意思決定)」のみ。実際のコード生成はテンプレートエンジンによる決定論的処理であり、LLMは生成物そのものを書かない(2.2)。
- **ランタイム**(ノードを繋いで実行する時)= AIを一切使わない。
- **保存・共有の仕組み**は、gitの標準機能(submodule)だけで成り立たせる。エージェント非依存を担保するため。
- **チェックの自動化と、承認ゲートは別物として扱う。** 非ブロッキングな自動チェック(CI)は人間の確認漏れを減らすために採用するが、必須レビュアー制度やブランチ保護のようなチーム統治は単一ユーザーには不要なので採用しない。

**対象ユーザー**
開発者自身(単一ユーザー)。

**非スコープ(今回は作らない)**
- ビジュアルエディタ(React Flow等)
- ノード同士を宣言的に繋ぐ実行エンジン(配線エンジン)
- サーキットブレーカー等の高度な耐障害機構
- npm private package / workspace化(2.10で比較検討済み、現時点では不採用)

これらはPhase 3以降、実際に必要になってから着手する(3章参照)。

---

## 1. 全体アーキテクチャ

```
node-library/                       ← ノードの実体を集約する専用リポジトリ
├─ nodes/
│  ├─ terms-of-service/             ← 参照型(security-sensitiveではない)
│  ├─ shared-auth/                   ← 参照型・security-sensitive(フォーク禁止、Phase 0)
│  ├─ stripe-webhook/                ← 参照型・security-sensitive(フォーク禁止、Phase 0)
│  ├─ error-handling-convention/     ← 参照型・非security-sensitive
│  ├─ page-layout-basic/             ← 生成型(Phase 1〜)
│  └─ ...
├─ tools/                            ← 以下すべてPhase 1以降に作成
│  ├─ generate.js                    ← テンプレートエンジン(決定論的、LLM不使用)
│  ├─ check-markers.sh
│  └─ check-nodes-status.sh
├─ .claude/skills/add-node/
├─ security-sensitive-categories.yaml
├─ .github/workflows/check.yml       ← 非ブロッキングCI(Phase 1以降)
├─ CLAUDE.md
└─ ROADMAP.md(本ファイル)

project-A/ (content repo)
├─ vendor/node-library/              ← submoduleとして参照(単一のsubmodule)
├─ src/
│  └─ layout/                        ← 生成型ノードから作られ、以後独立して改変されたコード(Phase 1〜)
└─ ...
```

**基本フロー(参照型)**

```
Claude Codeとの対話で schema.yaml の意思決定を行う
        │
   実装コード(entry.ts等)を作成。参照型はテンプレート生成を経由せず、
   importされる実体をそのまま置く(security-sensitiveならforkable: falseを設定)
        │
   node-libraryにコミット → CI(非ブロッキング)がverify.ts/check-markers.shを自動実行
        │
   一括反映スクリプトで参照先content repoのsubmoduleを更新(手動トリガー)
        │
   各content repoでverify.tsを再実行して確認 → コミット
```

**基本フロー(生成型)**

```
/add-node page-layout-basic をcontent repo内で実行
        │
   Claude Codeがrequired_decision項目だけ質問
        │
   generate.js が決定論的にファイルを生成(同一入力なら常に同一出力)
        │
   以後、content repo内で自由に改変してよい(一括反映の対象外)
```

---

## 2. コンポーネント設計

### 2.1 ノード定義スキーマ(`schema.yaml`)

```yaml
id: stripe-webhook
node_type: reference          # reference | scaffold
category: payment
forkable: false                # security-sensitiveな参照型ノードは常にfalse固定
config:                        # サービス連携系ノードのみ
  - name: apiKey
    type: secret
    required_decision: true
entry: ./index.ts                    # reference型のみ
template: ./template.ts.hbs          # scaffold型のみ
template_generation: 1               # scaffold型のみ。generate.jsが参照するテンプレ世代番号
```

**設計方針**
- `node_type`を`/add-node`実行時に必ず決める。
- **`forkable: false`は、`category`がsecurity-sensitive(2.7)な参照型ノードでは自動的に固定され、変更不可**とする。カスタマイズが必要な場合はコードをフォークするのではなく、`config`パラメータを追加する形で対応する(2.8のアダプター原則と同じ考え方)。
- 参照型ノードの`version`は持たない(2.6で理由を説明)。生成型ノードの`template_generation`が実質的なバージョンになる。

**意図的に含めていないフィールドと、追加するタイミング**
スキーマは後から項目を足す方が安全なため、使う機能が実在しない段階のフィールドは持たせない。使われないまま残る項目は「なんとなく埋める」ようになり、やがて内容が信用できなくなるため。

| フィールド | 用途 | 追加するタイミング |
|---|---|---|
| `ui: icon / color` | ビジュアルエディタでの表示 | Phase 3でビジュアルエディタに着手すると決まった時。撤退基準(4章)により着手しない可能性もある |
| `inputs` / `outputs` | 配線エンジンによる型の照合 | Phase 3の配線スパイクで、実際に必要な型情報の形が判明してから |
| `adapter_interface` | 複数プロバイダの差し替え | 2つ目のプロバイダを実装する時(2.8の原則通り、1つ目の時点では共通部分が確定できないため) |

**サービス連携系以外のノードについて**
`config`・`adapter_interface`はサービス連携系ノードにのみ使うオプション項目であり、必須ではない。エラーハンドリング規約・ロギング設定・APIレスポンス形式・ルーティング規約のようなノードでは、これらを使わず`id` / `node_type` / `category` / `entry`(または`template`)だけで成立する。

### 2.2 コード合成: 決定論的テンプレートエンジン

コード生成そのものにLLMは使わない。役割を明確に分ける。

- **Claude Codeの役割**: `required_decision`項目をユーザーに質問し、`schema.yaml`を確定させる(ここは判断が必要なので引き続きLLMが担当)
- **`tools/generate.js`の役割**: 確定した`schema.yaml`とテンプレート(Handlebars等)から、機械的にコードを生成する。同一の`schema.yaml`なら常に同一のコードが出力される(再現性100%)

**実装タイミング**: `generate.js`が必要になるのは生成型ノードだけ(参照型は`entry.ts`を直接importするためテンプレート生成を経由しない)。そのため実装はPhase 1(最初の生成型ノードを作る時)に行う。テンプレートは「どこが可変か」が具体的に分かって初めて正しく書けるため、生成型ノードが1つも存在しない段階で先に作らない。

これにより、以前検討していた「Phase 0〜1は非決定的だからdiff一読が必須」という前提そのものが不要になる。生成物のdiffは「`schema.yaml`の入力が変わった」ことだけを意味する、意味のある差分になる。

### 2.3 `/add-node` Skill 設計

`node-library`リポジトリ内、または生成型ノードを使うcontent repo内で実行する。

```
/add-node stripe-webhook

1. node_type(参照型/生成型)を最初に確認する
2. schema.yamlのテンプレート(または既存の類似ノード)を確認
3. required_decision: true の項目だけを質問
4. 残りはデフォルト値・ベストプラクティスで自動決定
5. node_typeに応じてコードを用意する:
   - reference型: importされる実体(entry.ts等)を直接作成する
   - scaffold型: tools/generate.js を実行し、決定論的にコードを生成する(Phase 1以降)
6. verify.ts を実行して検証
7. category がsecurity-sensitiveの場合は生成直後に自分でdiffを一読してからコミット
```

**verify.tsのスコープ**

| 項目 | 検証方法 |
|---|---|
| Webhook署名検証(参照型・payment) | 動的テスト: 署名なしのダミーペイロードを送信し、拒否されることを確認 |
| 冪等性キー・二重課金防止(参照型・payment) | 動的テスト: テストモードAPIで同一の冪等性キーを付けて2回送信し、課金オブジェクトが1件のみ作成されることを確認 |
| トークン失効処理(参照型・auth) | 静的解析: 失効チェック関数の呼び出しがミドルウェア内に存在するかを確認 |
| 構造テンプレート系(生成型) | 生成物が期待するファイル/セクションを含むかの構造チェックのみ |

`category: payment`のノードでは、冪等性キーの実装が伴わない限り`retryCount`を1より大きくすることを禁止する。

### 2.4 シークレット管理方針

- 実値は`.env`(ローカル)または既存のシークレットマネージャに保存し、コード・schema.yaml・ノード定義には一切書き込まない。
- `/add-node`はシークレットの「キー名」だけを`.env.example`に追記し、実値の入力はユーザーに促す。
- `.env`は`.gitignore`必須。参照型ノードをimportする場合も、実値は各content repo側で個別に用意する。

### 2.5 更新管理ポリシー

**参照型ノード: submodule参照(+フォークはnon-security-sensitiveのみ許可)**
- `node-library`はcontent repoから見て**単一のsubmodule**(`vendor/node-library`)であり、個々のノード単位でsubmoduleが分かれているわけではない。通常は各ノードを`vendor/node-library/nodes/<node-id>/`から直接importするだけで、ファイルを直接編集しない。
- **フォーク(=特定の1ノードだけ独立させる)は、gitのsubmodule操作ではなくファイルレベルの作業になる。** `forkable: true`のノードに限り、そのノードのフォルダをcontent repo内(例: `src/nodes/<node-id>/`)にコピーし、import元をsubmodule経由から local pathに切り替える。`vendor/node-library`のsubmodule自体は他のノードのために参照し続ける。
- フォーク後は、そのノードだけ`node-library`側の更新が自動反映されなくなる(意図的な仕様)。
- `forkable: false`(security-sensitiveな参照型ノード)はこのフォーク作業自体を禁止する。gitが機構的に阻止するものではなく、**運用ルール+検知スクリプトによる検知**で担保する。具体的には、`vendor/node-library/`の外に、`forkable: false`なノードidと同じ名前のフォルダ/ファイルが存在するかをgrepで確認する(2.11、Phase 1で導入)。カスタマイズが必要になった場合は、`node-library`側に`config`パラメータとして追加し、全体の設計に還元する。

**生成型ノード: GENERATED/CUSTOMIZEDマーカー**
- 生成したファイル先頭に`// GENERATED - DO NOT EDIT`か、手動編集後は`// CUSTOMIZED - manual changes below`を入れる。
- 生成が決定論的になった(2.2)ため、`GENERATED`マーカーのみのノードは`/add-node`再実行時に自動上書きしてよい。diffが出た場合は「`schema.yaml`の入力が変わった」ことを意味する、意味のある変更点になる。
- `CUSTOMIZED`があれば上書き禁止、diffを提示する。

**フォーク可能な参照型ノードへの更新通知**
`forkable: true`のノードに限り、`node-library`側の修正時にファイル先頭へ`# SECURITY-FIX: <日付> <一言>`を追記する運用は残すが、確認タイミングを「一括反映のとき」ではなく**CI(2.11)と`check-markers.sh`の実行時**に変更する(フォーク済みノードは一括反映の対象外なので、以前の設計はそもそも通知が届かない矛盾があった)。

**誤分類に気づいた場合の移行手順(生成型→参照型)**
1. content repo内の該当ファイルを`node-library/nodes/<node-name>/entry.*`として移す
2. `schema.yaml`の`node_type`を`scaffold`から`reference`に変更し、`template`を削除して`entry`を追加
3. 元のcontent repoではそのファイルを削除し、`vendor/node-library/nodes/<node-name>/`からimportする形に書き換える(既存の`vendor/node-library` submoduleをそのまま使う。新しいsubmoduleを追加する必要はない)
4. 他に同じノードを生成済みのcontent repoがあれば同様に置き換える
所要の手間は実測してからPhase 0の完了条件のメモに記録する。

### 2.6 バージョニング

- **参照型ノード**: 独自の`version`フィールドは持たない。submoduleのコミットハッシュがそのまま実バージョンであり、二重管理を避ける。
- **生成型ノード**: `schema.yaml`の`template_generation`が「どのテンプレート世代から生成されたか」を表す。生成が決定論的なので、同じ`template_generation`なら常に同じコードが生成される。

### 2.7 セキュリティ確認の対象(security-sensitiveカテゴリ)

`payment` / `auth` / `secrets`などに該当するノードは、生成後コミット前に自分でdiffとschema.yamlを一読する。**このタイミングで、verify.tsの動的テスト(Webhook署名検証・冪等性キー検証など、実際にAPIへリクエストを送るもの)を手元の`.env`で実行する。** これらはCIでは実行しない(2.11参照。テストモードとはいえ実キーをCI環境に持ち込むことになり、シークレット管理の置き場所が増えるため)。カテゴリ一覧は`security-sensitive-categories.yaml`で一元管理し、未記載の新規カテゴリはデフォルトでsecurity-sensitive扱いとする。**このカテゴリに該当する参照型ノードは、2.5の通りフォーク禁止(`forkable: false`固定)。**

### 2.8 アダプター共通インターフェースの設計原則(サービス連携系・参照型ノードのみ)

**この原則が実際に適用されるのは、2つ目のプロバイダを実装する時点から。** それまでは`schema.yaml`に`adapter_interface`フィールドを持たせず、1つ目のプロバイダの実装をそのまま書く(2.1参照)。

- 共通インターフェースには「全プロバイダが持つ機能の共通部分」だけを含める。
- プロバイダ固有機能はアダプター実装にオプショナルな拡張メソッドとして持たせる。
- 1つ目のプロバイダ実装時点では確定させず、2つ目を実装した時点で本当の共通部分を確定する。
- security-sensitiveな参照型ノードのカスタマイズは、フォークではなくこの層(config/アダプター拡張)で吸収する(2.5参照)。

### 2.9 一括反映の運用(参照型・非フォークノードのみが対象)

```bash
# update-nodes.sh
# verify失敗時は該当repoだけ元に戻し、他repoへの反映は止めずに続行して最後に一覧報告する
failed=()
for repo in project-A project-B ...; do
  (cd "$repo" && git submodule update --remote vendor/node-library)
  if ! (cd "$repo" && npm run verify-all); then
    echo "!! $repo: verify失敗。submodule参照を直前の状態に戻します"
    (cd "$repo" && git checkout -- vendor/node-library)
    failed+=("$repo")
  fi
done
echo "反映失敗: ${failed[*]:-なし}"
```

```bash
# check-nodes-status.sh
for repo in project-A project-B ...; do
  echo "== $repo =="
  (cd "$repo" && git submodule status vendor/node-library)
done
```

- 自動実行はしない(cron等に載せない)。反映は必ず人が意図的にトリガーする。誤った変更が全content repoに同時に伝播するのを防ぐため。
- **verify.tsが失敗したrepoは、そのrepoの`vendor/node-library`だけを直前のコミットに戻す**(`git checkout`で戻るだけなので、まだコミットしていない変更であれば安全に取り消せる)。他のrepoへの反映は止めず、最後に失敗一覧を報告する。1つのrepoの問題が全体の反映作業をブロックしないようにするため。
- 反映に成功したrepoは、`verify.ts`が通った後に手動でコミットする。
- 生成型ノード、およびフォーク済みノードはこの対象外。

### 2.10 共有方式の比較検討(submodule / npm package / workspace)

| 方式 | 更新の手軽さ | 追加で必要になるもの | スタック非依存性 |
|---|---|---|---|
| **git submodule(採用)** | `git submodule update`。detached HEAD等に若干の癖はあるが、`node-library`内は直接編集せず`/add-node`経由・content repo側は参照のみという運用なら実際に踏む場面は少ない | 追加インフラ不要(既存のgit認証がそのまま使える) | submoduleという仕組み自体は言語・フレームワーク非依存 |
| npm private package(GitHub Packages) | `npm update`は手軽だが、更新の都度`npm publish`というひと手間が発生する | 各content repoでの`.npmrc`認証設定、パッケージのバージョン管理 | Node/TS前提。他スタックのコンテンツには使えない |
| pnpm/yarn workspace | 更新作業自体は不要(同一リポジトリ内なので即反映) | 全content repoを1つのモノレポに統合する必要があり、「独立した複数プロジェクト」という前提と矛盾する | モノレポ前提のため、当初のゴール(バラバラに管理)と相性が悪い |

npmはpublish作業と認証設定という新たな手間を生み、workspaceはそもそも今回の「独立した複数リポジトリ」という構成に合わない。**submoduleは追加インフラが不要で、かつ将来コンテンツごとに異なる技術スタックを使う可能性にも対応できるため、現時点ではこのまま採用を続ける。**

**主張の範囲についての補足**: 上記の「スタック非依存性」は**submoduleというgitの仕組み自体**についてのものであり、`verify.ts`・`generate.js`(2.2, 2.3)の実装は現状Node/TS専用である。他のスタックのcontent repoでノードを使う場合、そのノード用に別言語版のverify/generateを書く必要があり、これは自動的には対応しない。ただしノードごとに検証・生成スクリプトが独立しているため、必要になった時点でそのノードだけ対応言語を追加すればよく、仕組み全体を作り直す必要はない。現時点(Node/TSのみ)ではこの拡張は行わない。

### 2.11 軽量CI(非ブロッキング・チェックのみ)

```yaml
# .github/workflows/check.yml
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./tools/check-markers.sh
      - run: npm run verify-all   # 各ノードのverify.tsを回す
```

- **必須レビュアーやブランチ保護は設定しない。** このCIはあくまで「確認を忘れた時に気づくための表示」であり、コミット・マージを妨げない。
- **CIにはロジックを書かない。** 検証の中身はすべて`tools/`配下のスクリプト(`check-markers.sh`, `verify.ts`)に置き、Actionsはそれを呼ぶだけの薄い層に留める。これによりGitHub Actionsが使えない環境に移ってもチェック自体は手元で実行でき、gitとファイルだけで成立するというエージェント/プラットフォーム非依存の原則(0章)が保たれる。
- 単一ユーザー運用における「疲れている時に手動チェックを忘れる」というリスクへの対策として、これだけは自動化する価値があると判断した。
- 実際のコード更新の伝播(2.9の一括反映)はこのCIではトリガーしない。チェックの自動化と、変更の適用は明確に分ける。

---

## 3. フェーズ別ロードマップ

### Phase 0: 最小検証(2〜3週間目安)
- `node-library`リポジトリを新規作成
- `schema.yaml`のフォーマットを確定(`node_type` / `forkable` / `template_generation`を含む)
- `/add-node` Skillの最小版を作成(参照型ノードの作成に対応。生成型の対応はPhase 1)
- **参照型ノードを3つ作成**(決済Webhook処理・認証ロジック・エラーハンドリング規約。前2つは`forkable: false`。3つ目はフォーク可否を問わず、Phase 0ではまだフォークを試さない)
- **参照モデルの検証**: 実プロジェクト(最低1つ)から`node-library`をsubmoduleとして参照し、実際に動くことを確認
- **一括反映の検証**: `node-library`側でノードを1つ更新し、参照先に反映されることを確認
- **配線スパイク(使い捨てで良い)**: 型の整合性・エラー伝播・非同期の順序について致命的な破綻がないかだけ見通しを立てる
- **完了条件**: 上記すべてが実際に動くこと。ノードを直接書いた場合との手間の差もメモしておく

**このPhase 0ではCI・check-markers.sh・check-nodes-status.shを作らない。** これらが検知する対象(マーカーの付け忘れ、フォーク違反)はPhase 0の時点では1つも存在しない(全ノードが`forkable: false`で、フォーク自体をまだ試していないため)。存在しないものを検知する仕組みを先に作るのは、2.8・4章で明記した「実際に困ってから作る」という自制のロジックに反するため、Phase 1(生成型・フォークが実際に登場する段階)に回す。

### Phase 1: 運用ルールの確立
- シークレット管理方針(2.4)を実装
- **`tools/generate.js`(決定論的テンプレートエンジン)を作成**。生成型ノードを実際に作る段階で初めて必要になるため、ここで着手する
- **生成型ノードを最低1つ作成**(例: ページレイアウトの叩き台、APIエンドポイントの雛形)し、GENERATED/CUSTOMIZEDマーカーの運用を検証
- **forkable: trueなノードを1つ作成しフォークを検証**(Phase 0のエラーハンドリング規約ノードなどが候補)
- **軽量CI・検知スクリプトの導入**: `.github/workflows/check.yml`、`tools/check-markers.sh`、`tools/check-nodes-status.sh`をこの段階で作成する(検知対象となるマーカー・フォークが実際に存在するようになったため)
- **完了条件**: 参照型/生成型の取り違え、フォーク禁止ルールの意図しない回避、が0件

**Phase 0評価で見つかった懸念点(この段階で対応を検討する)**

Phase 0完了時の評価(参照モデルの実機検証・配線スパイク)で、以下の課題が見つかった。いずれも単一ユーザー・少数ノードの段階では致命的ではないが、ノード数・content repo数が増える前に方針を決めておく。

- **ノード横断のエラー契約が存在しない**: 配線スパイクで、`shared-auth`の`AuthError`・`stripe-webhook`の`StripeSignatureError`・`error-handling-convention`の`AppError`が互いに何の契約も共有していないことが判明した。複数ノードを組み合わせた際、個々のエラー種別情報が失われ、すべて`error-handling-convention`側で汎用的な500 INTERNAL_ERRORに丸められてしまう。ノードは個別には疎結合だが、複数ノードを跨いだ時に本当の意味でシステムとして疎結合に組み合わさるとは言えない状態。ノード横断の最小限の共通エラーインターフェース(例: 全ノードのエラーが`code`と`status`を持つ)を設けるかどうかを検討する。
- **ブランチ固定の脆さ**: Phase 0の実機検証時、`node-library`の実装がまだ`main`にマージされておらず作業ブランチにのみ存在したため、参照側で`-b <branch>`の明示指定が必要になり、実際に混乱・手戻りが発生した。`main`へのマージ後にどのタイミングで参照を切り替えるか、あるいはタグ運用にするかを含め、参照コミットの固定運用を明確にする。
- **アクセス権限の分散管理**: `node-library`がprivateリポジトリである以上、ノードを使う新しいマシン・CI環境ごとにGitHub認証を都度用意する必要がある。単一ユーザー運用では大きな負担ではないが、「疎結合」を謳う設計が結局GitHub認証という1点に強く依存している点は認識しておく。
- **発見可能性(discoverability)の欠如**: ノード数が少ないうちは`ls nodes/`で足りるが、カタログやREADME一覧のような仕組みは無い。ノードが増えた時にどう探せるようにするかは、Phase 3の視認性検証を待たずに軽く方針だけ持っておく。

### Phase 2: 運用の定着
- 3つ以上のcontent repoで実際に使ってみる
- 一括反映を実際の必要(規約変更相当の事由)で最低1回実行してみる

### Phase 3: 視認性・配線の検証
- ノード数が増え、一覧性が本当に問題になった時点で着手
- 分岐・並列実行・エラー伝播を含む配線パターンを3〜4ノード規模で一度見通しを立てる
- 配線に必要な型情報の形が判明した時点で、`schema.yaml`に`inputs`/`outputs`を追加する(2.1参照)
- それでも視認性が問題なら、React Flow等でビジュアルエディタを検討。着手を決めた時点で`schema.yaml`に`ui`(icon/color)を追加する

### Phase 4以降(必要になった場合のみ)
- サーキットブレーカー等の耐障害パターン
- ノード追加のAI下書き機能

---

## 4. 撤退・簡略化基準

- Phase 1: 生成型ノードの追加でschema.yamlに無理が生じる場合 → schema設計を先に見直す
- Phase 2: 一括反映を使う場面が実際にはほぼない場合 → 現状のスクリプトのままで十分
- Phase 3: ノード数が10個未満 → ビジュアルエディタ不要
- Phase 4: セキュリティ系ノードで実際に障害が起きていない → 後回し

---

## 5. リスクと軽減策

| リスク | 軽減策 |
|---|---|
| security-sensitiveノードをフォークしてセキュリティホールが放置される | `forkable: false`でフォークを禁止し、検知スクリプト(Phase 1)で違反を検知。カスタマイズはconfig層で吸収(2.5, 2.8) |
| ノードの`node_type`分類を誤る | `/add-node`実行時に最優先で確認。誤った場合の移行手順を2.5に明記 |
| git submoduleの更新し忘れに気づけない | `check-nodes-status.sh`(Phase 1)で手動確認。日常運用では`node-library`を直接編集しないためdetached HEADの問題が起きる場面は限定的 |
| マーカー/SECURITY-FIXコメントの付け忘れ | 2.11の非ブロッキングCI(Phase 1)で自動チェックし、手動確認への依存を減らす |
| 動的verify.tsのシークレットがCI環境に漏れる | CIでは動的テストを実行せず静的チェックのみに限定。動的テストは手元の`.env`でのみ実行(2.7, 2.11) |
| 一括反映で複数のcontent repoが同時に壊れる | 反映は手動トリガーのみ。verify失敗repoはsubmodule参照を自動でロールバックし、他repoへの反映は継続(2.9) |
| 質問すべき重要項目が誤って省略される | `required_decision`をschema.yamlに固定 |
| シークレットがコードに混入する | 2.4の管理方針を`/add-node`に実装 |
| 決済ノードのretry設定が二重課金を招く | verify.tsに冪等性・Webhook署名検証を追加 |
| 「ノードを繋ぐ」配線の実現可能性が未検証のまま積み上がる | Phase 0とPhase 3着手前に配線スパイクで見通しを立てる |
| 過剰設計による初期コストの肥大化 | Phase制・撤退基準・単一ユーザー前提(0章)で歯止めをかける。CI/検知スクリプトも検知対象が実在するPhase 1まで作らない |

---

## 6. 用語集

- **参照型ノード**: 全コンテンツで中身が同じであり続けてほしいノード。生成せずimportして使う。一括反映の対象。
- **生成型ノード**: 叩き台として決定論的に生成され、以後コンテンツごとに独立して改変されていくノード。一括反映の対象外。
- **forkable**: 参照型ノードがフォーク(参照解除+実体化)を許可されているかどうかのフラグ。security-sensitiveなノードは常に`false`。
- **node-library**: ノードの実体を集約する専用リポジトリ。
- **generate.js**: `schema.yaml`とテンプレートから決定論的にコードを生成するスクリプト。LLMを使わない。
- **一括反映**: `node-library`側の更新を、参照している全content repoに反映する作業(参照型・非フォークノードのみ対象、手動トリガー)。
- **軽量CI**: verify.ts/check-markers.shを自動実行する非ブロッキングな仕組み。承認ゲートではなく確認漏れ防止のためのもの。
- **ビルド時**: Claude Codeが`schema.yaml`の意思決定を行う段階。
- **ランタイム**: ノードを繋いでシステムを動かす段階。AIは関与しない。

# CLAUDE.md

このリポジトリは `node-library`(ノードの実体を集約する専用リポジトリ)。
設計方針・ロードマップは `ROADMAP.md` を参照すること。

サイト・アプリのコーディングを、なるべく広い範囲で疎結合な「ノード」として分散管理するのが目的(認証・決済・エラーハンドリング・ロギング・APIレスポンス形式など)。

## 最重要ルール

**コード生成にLLMを使わない(生成型ノードの場合)。** 生成型ノードでは`/add-node`の役割は`schema.yaml`の意思決定(質問して埋める)までで、実際のコード生成は`tools/generate.js`(決定論的テンプレートエンジン)に行わせる。テンプレートを自分で読んで手で穴埋めしない。ただし`generate.js`はPhase 1で作るものであり、Phase 0で扱う参照型ノードはテンプレート生成を経由せず、importされる実体(`entry.ts`等)を直接作成する。

**ノードには2種類ある。**
- 参照型(reference): 全コンテンツで中身が同じであり続けてほしいもの。生成せずsubmodule経由でimportする。
- 生成型(scaffold): 叩き台として生成し、以後コンテンツごとに改変されていいもの。

`/add-node`実行時は、最初に`node_type`をどちらにするか確認する。

**security-sensitiveな参照型ノードはフォーク禁止。** `category`が`payment`/`auth`/`secrets`等(`security-sensitive-categories.yaml`参照)の参照型ノードは`forkable: false`で固定する。`node-library`は単一のsubmoduleなので、フォークはgit操作ではなく「該当ノードのフォルダをcontent repo内にコピーしてimport元を切り替える」というファイルレベルの作業になる(ROADMAP.md 2.5参照)。`forkable: false`の場合はこの作業自体を行わない。運用ルールと検知スクリプト(Phase 1以降)で担保する。カスタマイズが必要な場合はコードを分岐させず、`config`パラメータを追加する形で`node-library`側に還元する。

## 現在の作業範囲

**Phase 0 のみ。Phase 1 以降の項目には着手しない。**

Phase 0 で作るもの:
- `schema.yaml`フォーマット(`node_type` / `forkable` / `category` / `config` / `entry`。`inputs`/`outputs`/`ui`/`adapter_interface`は含めない — ROADMAP.md 2.1参照)
- `.claude/skills/add-node/`(参照型ノードの作成に対応)
- 参照型ノードを3つ(決済Webhook処理、認証ロジック、エラーハンドリング規約)
- submodule参照・一括反映の検証

Phase 0 の完了条件を満たすまで、以下には手を出さないこと:
- `.github/workflows/check.yml`・`check-markers.sh`・`check-nodes-status.sh` → Phase 1。これらが検知する対象(マーカー違反、フォーク違反)はPhase 0にはまだ存在しないため
- `tools/generate.js`(テンプレートエンジン)→ Phase 1。参照型ノードはテンプレート生成を使わないため、Phase 0では不要
- ビジュアルエディタ・配線実行エンジン → Phase 3
- サーキットブレーカー等の耐障害機構 → Phase 4
- 一括反映の自動化(cron等)→ 想定していない(常に手動トリガー)
- npm package化・workspace化 → 検討済みで不採用(ROADMAP.md 2.10参照)
- 生成型ノードの本格追加 → Phase 1

## 絶対に守ること

- **シークレットの実値を一切扱わない。**
- **`schema.yaml`に将来用のフィールドを勝手に足さない。** `inputs`/`outputs`/`ui`/`adapter_interface`は、それを使う機能を実装するPhaseになってから追加する(ROADMAP.md 2.1)。使われないフィールドは形骸化して内容が信用できなくなるため。
- security-sensitiveなノードを生成・更新した場合は、コミット前にユーザーに diff と `schema.yaml` の確認を求め、verify.tsの動的テスト(実際にAPIを叩くもの)を手元の`.env`で実行する。CIでは動的テストを実行しない(Phase 1でCIを導入する際も同様)。
- `category: payment` のノードでは、冪等性キーの実装が伴わない限り `retryCount` を 1 より大きくしない。
- 軽量CI(Phase 1で導入)は非ブロッキングのチェック専用。必須レビュアーやブランチ保護は設定しない。

## 進め方

1. `/add-node` Skill の `SKILL.md` を作成(node_type/forkableの質問を最優先項目として組み込む)
2. 参照型ノード1つ目(決済Webhook処理、forkable: false)の`entry.ts`等を作成 → `verify.ts`(動的テストは手元の`.env`で実行)
3. 参照型ノード2つ目(認証ロジック、forkable: false)を作成 → 同様に検証
4. 参照型ノード3つ目(エラーハンドリング規約)を作成 → 同様に検証
5. 実プロジェクト(content repo)からこのリポジトリをsubmodule参照させ、動くことを確認
6. ノードを1つ更新し、`update-nodes.sh`(失敗時は該当repoのみロールバック)でcontent repo側に反映されることを確認
7. 配線スパイク(型・エラー伝播・非同期順序の見通しを立てる)

Phase 0 完了時には、ROADMAP.md の完了条件を確認する。CI・check-markers.sh・check-nodes-status.sh・generate.jsはPhase 1で着手する。

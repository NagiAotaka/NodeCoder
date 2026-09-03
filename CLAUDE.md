[CLAUDE.md](https://github.com/user-attachments/files/31332815/CLAUDE.md)
# CLAUDE.md

このリポジトリは `node-library`(ノードの実体を集約する専用リポジトリ)。
設計方針・ロードマップは `ROADMAP.md` を参照すること。

サイト・アプリのコーディングを、なるべく広い範囲で疎結合な「ノード」として分散管理するのが目的(認証・決済・エラーハンドリング・ロギング・APIレスポンス形式など)。狙いは、ノードを複数コンテンツで使い回すことでコーディングリソースを継続的に減らすこと。**複数回使われる可能性があるものは、ジャンルを問わず何でもノード化の候補になりうる**(ROADMAP.md 0章参照)。

## Claude Code Skillsとの使い分け

「複数回使われるもの」がすべてノード化対象になるわけではない。Claude Code Skills
(`.claude/skills/`配下の手順書)と役割分担する。判断基準は
`.claude/skills/add-node/SKILL.md`の「0. ノード化する前に」節を正とする
(この節はsubmodule経由でcontent repo側にも配布されるため、別プロジェクトで
`/add-node`を使う際も同じ基準がそのまま適用される)。

要点: 「1バイトも違わず動いてほしい/セキュリティ上、生成のたびに実装が
揺らぐと困る」→ノード。「プロジェクトごとに多少調整してよい手順・設定
パターン」→Skills。判断が付かない場合のみユーザーに確認する。

## 最重要ルール

**コード生成にLLMを使わない(生成型ノードの場合)。** 生成型ノードでは`/add-node`の役割は`schema.yaml`の意思決定(質問して埋める)までで、実際のコード生成は`tools/generate.js`(決定論的テンプレートエンジン)に行わせる。テンプレートを自分で読んで手で穴埋めしない。ただし`generate.js`はPhase 1で作るものであり、Phase 0で扱う参照型ノードはテンプレート生成を経由せず、importされる実体(`entry.ts`等)を直接作成する。

**ノードには2種類ある。**
- 参照型(reference): 全コンテンツで中身が同じであり続けてほしいもの。生成せずsubmodule経由でimportする。
- 生成型(scaffold): 叩き台として生成し、以後コンテンツごとに改変されていいもの。

`/add-node`実行時は、最初に`node_type`をどちらにするか確認する。

**security-sensitiveな参照型ノードはフォーク禁止。** `category`が`payment`/`auth`/`secrets`等(`security-sensitive-categories.yaml`参照)の参照型ノードは`forkable: false`で固定する。`node-library`は単一のsubmoduleなので、フォークはgit操作ではなく「該当ノードのフォルダをcontent repo内にコピーしてimport元を切り替える」というファイルレベルの作業になる(ROADMAP.md 2.5参照)。`forkable: false`の場合はこの作業自体を行わない。運用ルールと検知スクリプト(Phase 1以降)で担保する。カスタマイズが必要な場合はコードを分岐させず、`config`パラメータを追加する形で`node-library`側に還元する。

## 現在の作業範囲

**Phase 0 は完了。Phase 1 に着手する。Phase 2 以降の項目には着手しない。**

Phase 0 で作ったもの(完了済み):
- `schema.yaml`フォーマット(`node_type` / `forkable` / `category` / `config` / `entry`)
- `.claude/skills/add-node/`(参照型ノードの作成に対応)
- 参照型ノードを3つ(決済Webhook処理、認証ロジック、エラーハンドリング規約)
- submodule参照・一括反映の検証(`install.sh`・`update-nodes.sh`を含め実機で確認済み)

Phase 1 で作るもの(ROADMAP.md 3章 Phase 1参照):
- シークレット管理方針(2.4)の実装
- `tools/generate.js`(決定論的テンプレートエンジン)
- 生成型ノードを最低1つ作成し、GENERATED/CUSTOMIZEDマーカーの運用を検証
- `forkable: true`なノードを1つ作成しフォークを検証(エラーハンドリング規約ノードが候補)
- 軽量CI・検知スクリプト(`.github/workflows/check.yml`、`tools/check-markers.sh`、`tools/check-nodes-status.sh`)
- **Phase 0評価で見つかった懸念点への対応**(ROADMAP.md Phase 1参照): ノード横断のエラー契約の欠如、ブランチ固定の脆さ、アクセス権限の分散管理、発見可能性の欠如

Phase 1 の完了条件を満たすまで、以下には手を出さないこと:
- ビジュアルエディタ・配線実行エンジン → Phase 3
- サーキットブレーカー等の耐障害機構 → Phase 4
- 一括反映の自動化(cron等)→ 想定していない(常に手動トリガー)
- npm package化・workspace化 → 検討済みで不採用(ROADMAP.md 2.10参照)
- 3つ以上のcontent repoでの本格運用・定着 → Phase 2

## 絶対に守ること

- **シークレットの実値を一切扱わない。**
- **`schema.yaml`に将来用のフィールドを勝手に足さない。** `inputs`/`outputs`/`ui`/`adapter_interface`は、それを使う機能を実装するPhaseになってから追加する(ROADMAP.md 2.1)。使われないフィールドは形骸化して内容が信用できなくなるため。
- security-sensitiveなノードを生成・更新した場合は、コミット前にユーザーに diff と `schema.yaml` の確認を求め、verify.tsの動的テスト(実際にAPIを叩くもの)を手元の`.env`で実行する。CIでは動的テストを実行しない(Phase 1でCIを導入する際も同様)。
- `category: payment` のノードでは、冪等性キーの実装が伴わない限り `retryCount` を 1 より大きくしない。
- 軽量CI(Phase 1で導入)は非ブロッキングのチェック専用。必須レビュアーやブランチ保護は設定しない。

## 進め方(Phase 1)

1. シークレット管理方針(2.4)を実装する
2. `tools/generate.js`(決定論的テンプレートエンジン)を作成する
3. 生成型ノードを最低1つ作成し、`/add-node`経由で生成 → GENERATED/CUSTOMIZEDマーカーの運用を検証する
4. `forkable: true`なノードを1つ作成し、フォーク(ファイルコピー+import元切り替え)を検証する
5. 軽量CI・検知スクリプト(`.github/workflows/check.yml`、`tools/check-markers.sh`、`tools/check-nodes-status.sh`)を導入する
6. Phase 0評価で見つかった懸念点(ノード横断のエラー契約・ブランチ固定・アクセス権限・発見可能性)への対応方針を検討する

Phase 1 完了時には、ROADMAP.md の完了条件(参照型/生成型の取り違え・フォーク禁止ルールの意図しない回避が0件)を確認する。Phase 2以降(運用の定着)には着手しない。

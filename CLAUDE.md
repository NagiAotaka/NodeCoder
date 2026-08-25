[CLAUDE.md](https://github.com/user-attachments/files/31332815/CLAUDE.md)
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

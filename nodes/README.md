# ノード一覧

`ls nodes/`だけでは各ノードの性質(参照型/生成型、security-sensitiveかどうか)が
分からないため、手書きの一覧をここに置く。自動生成はしない(生成の仕組みを
作ること自体が過剰設計になるため)。**ノードを追加・変更したら、この表に
1行追記/更新すること**(`.claude/skills/add-node/SKILL.md`参照)。

| id | node_type | category | forkable | 説明 |
|---|---|---|---|---|
| `stripe-webhook` | reference | payment | false | Stripe Webhookの署名検証+冪等性チェック |
| `shared-auth` | reference | auth | false | JWTセッショントークンの検証+失効チェック |
| `error-handling-convention` | reference | error-handling | true | 統一エラーレスポンス形式(ノード横断のエラー契約の受け皿) |
| `page-layout-basic` | scaffold | layout | (該当なし) | ページレイアウトの叩き台(`tools/generate.js`で生成) |

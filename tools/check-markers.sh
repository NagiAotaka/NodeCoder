#!/usr/bin/env bash
# tools/check-markers.sh
#
# 非ブロッキングの検知スクリプト(ROADMAP.md 2.11)。ロジックはすべてここに
# 置き、CI(.github/workflows/check.yml)はこれを呼ぶだけの薄い層にする。
#
# このスクリプトは2つの文脈で使われる(cwdに応じて自動判定する):
#
#   1. node-library自身のリポジトリ内(直下に nodes/ がある場合):
#      A. node_type と必須フィールドの整合性
#         (reference型はentry必須・template/template_generation禁止、
#          scaffold型はその逆) → 「参照型/生成型の取り違え」を検知
#      B. forkableとsecurity-sensitive判定の整合性
#         (reference型かつcategoryがsecurity-sensitiveなのに
#          forkable: true になっているノードが無いか)
#         → 「フォーク禁止ルールの意図しない回避」を検知
#
#   2. content repo内(vendor/node-library/nodes/ がある場合。node-library
#      はsubmodule経由で各content repoにこのスクリプト自体も配布されるため、
#      `vendor/node-library/tools/check-markers.sh` として実行できる):
#      C. フォーク違反の検知(ROADMAP.md 2.5)
#         forkable: false なノードidと同じ名前のフォルダ/ファイルが
#         vendor/node-library の外に存在しないか確認する。
#
# 非ブロッキングのチェック専用であり、必須レビュアーやブランチ保護の
# 代わりにはしない(CLAUDE.md「絶対に守ること」)。

set -uo pipefail

violations=0

# --- 簡易YAML読み取り(依存パッケージを増やさない。generate.jsと同じ方針) ---
get_field() {
  # get_field <file> <key> — フラットな `key: value` 行から値を取り出す
  local file="$1" key="$2"
  grep -E "^${key}:" "$file" 2>/dev/null | head -n1 | sed -E "s/^${key}:[[:space:]]*//; s/[[:space:]]*#.*$//; s/[[:space:]]*$//"
}

# 注記: Bのチェックは「security-sensitive-categories.yamlに明記されている
# カテゴリ(payment/auth/secretsなど、明示的にsensitiveと分かっている)」
# のみを対象にする。「未記載の新規カテゴリはデフォルトでsensitive」という
# 2.7の原則は/add-node実行時の自動判定に対するものであり、人間が個別に
# レビューしてforkable: trueへ明示的に上書きしたノード(schema.yamlに
# レビュー根拠のコメントがあるもの、例: error-handling-convention)は、
# このスクリプトでは違反として扱わない(コメントの意味解釈はスクリプトの
# 責務ではなく、人間のレビューで担保する)。

check_node_type_shape() {
  local schema="$1" node_id="$2"
  local node_type entry template template_generation

  node_type=$(get_field "$schema" "node_type")
  entry=$(get_field "$schema" "entry")
  template=$(get_field "$schema" "template")
  template_generation=$(get_field "$schema" "template_generation")

  case "$node_type" in
    reference)
      if [ -z "$entry" ]; then
        echo "!! [A] $node_id: node_type: reference なのに entry が無い"
        violations=$((violations + 1))
      fi
      if [ -n "$template" ] || [ -n "$template_generation" ]; then
        echo "!! [A] $node_id: node_type: reference なのに template/template_generation がある"
        violations=$((violations + 1))
      fi
      ;;
    scaffold)
      if [ -z "$template" ] || [ -z "$template_generation" ]; then
        echo "!! [A] $node_id: node_type: scaffold なのに template/template_generation が無い"
        violations=$((violations + 1))
      fi
      if [ -n "$entry" ]; then
        echo "!! [A] $node_id: node_type: scaffold なのに entry がある"
        violations=$((violations + 1))
      fi
      ;;
    *)
      echo "!! [A] $node_id: node_type が reference/scaffold のいずれでもない ('$node_type')"
      violations=$((violations + 1))
      ;;
  esac
}

check_forkable_consistency() {
  local schema="$1" node_id="$2" categories_file="$3"
  local node_type category forkable

  node_type=$(get_field "$schema" "node_type")
  category=$(get_field "$schema" "category")
  forkable=$(get_field "$schema" "forkable")

  [ "$node_type" != "reference" ] && return 0

  if [ -f "$categories_file" ] && grep -qE "^\s*-\s*${category}\s*$" "$categories_file"; then
    if [ "$forkable" = "true" ]; then
      echo "!! [B] $node_id: category '$category' は security-sensitive-categories.yaml に明記されているのに forkable: true になっている"
      violations=$((violations + 1))
    fi
  fi
}

check_fork_violations() {
  local vendor_dir="$1"
  local root_dir="$2"

  for schema in "$vendor_dir"/nodes/*/schema.yaml; do
    [ -f "$schema" ] || continue
    local node_id forkable node_type
    node_id=$(basename "$(dirname "$schema")")
    node_type=$(get_field "$schema" "node_type")
    forkable=$(get_field "$schema" "forkable")

    [ "$node_type" != "reference" ] && continue
    [ "$forkable" = "true" ] && continue

    local found
    found=$(find "$root_dir" -path "$vendor_dir" -prune -o -type d -name "$node_id" -print 2>/dev/null)
    if [ -n "$found" ]; then
      echo "!! [C] $node_id: forkable: false なのに vendor/node-library の外にフォルダが存在する ($found)"
      violations=$((violations + 1))
    fi
  done
}

main() {
  if [ -d "./nodes" ]; then
    echo "== node-library文脈: schema.yamlの整合性チェック(A・B) =="
    for schema in ./nodes/*/schema.yaml; do
      [ -f "$schema" ] || continue
      node_id=$(basename "$(dirname "$schema")")
      check_node_type_shape "$schema" "$node_id"
      check_forkable_consistency "$schema" "$node_id" "./security-sensitive-categories.yaml"
    done
  fi

  if [ -d "./vendor/node-library/nodes" ]; then
    echo "== content repo文脈: フォーク違反チェック(C) =="
    check_fork_violations "./vendor/node-library" "."
  fi

  if [ "$violations" -eq 0 ]; then
    echo "違反なし"
  else
    echo "違反: ${violations} 件"
  fi

  exit "$violations"
}

main

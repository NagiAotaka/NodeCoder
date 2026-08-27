#!/usr/bin/env bash
# tools/check-nodes-status.sh
#
# 各content repoのvendor/node-libraryが、どのコミットを参照しているかを
# 一覧表示する(ROADMAP.md 2.9参照)。update-nodes.shの反映漏れ・更新忘れに
# 気づくための確認専用スクリプトで、何も変更しない。
#
# 使い方:
#   ./tools/check-nodes-status.sh /path/to/project-A /path/to/project-B ...
#   引数を渡さない場合は content-repos.txt (1行1パス、#始まりはコメント) を読む。
#   (update-nodes.sh と同じ規約)

set -uo pipefail

repos=("$@")

if [ "${#repos[@]}" -eq 0 ]; then
  config_file="$(dirname "$0")/../content-repos.txt"
  if [ -f "$config_file" ]; then
    while IFS= read -r line; do
      line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      [ -z "$line" ] && continue
      case "$line" in \#*) continue ;; esac
      repos+=("$line")
    done < "$config_file"
  fi
fi

if [ "${#repos[@]}" -eq 0 ]; then
  echo "確認対象のcontent repoが指定されていません。" >&2
  echo "引数で渡すか、content-repos.txt に1行1パスで記載してください。" >&2
  exit 1
fi

for repo in "${repos[@]}"; do
  echo "== $repo =="

  if [ ! -d "$repo/.git" ]; then
    echo "!! gitリポジトリではありません"
    continue
  fi

  if [ ! -e "$repo/vendor/node-library" ]; then
    echo "!! vendor/node-library が存在しません"
    continue
  fi

  (cd "$repo" && git submodule status vendor/node-library)
done

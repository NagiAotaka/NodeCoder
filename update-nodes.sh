#!/usr/bin/env bash
# update-nodes.sh
#
# node-library側の更新を、参照している各content repoのvendor/node-libraryへ
# 一括反映する(ROADMAP.md 2.9参照)。
#
# - 自動実行はしない(cron等に載せない)。必ず人が意図的に実行する。
# - 対象のcontent repoは、REPOS変数(下記)または引数で渡す。
# - 各repoで `git submodule update --remote vendor/node-library` の後、
#   そのrepoの `npm run verify-all` を実行する。
#   `verify-all` は各content repo側が用意するスクリプトで、
#   vendor/node-library配下の各ノードのverify.tsを実行することを想定する
#   (node-library自体はこのスクリプトの中身を持たない)。
# - verify失敗時は、そのrepoのvendor/node-libraryだけ直前のコミットへ
#   `git checkout` で戻す(まだコミットしていない変更として安全に取り消せる)。
#   他のrepoへの反映は止めず、最後に失敗一覧を報告する。
#
# 使い方:
#   ./update-nodes.sh /path/to/project-A /path/to/project-B ...
#   引数を渡さない場合は content-repos.txt (1行1パス、#始まりはコメント) を読む。

set -uo pipefail

repos=("$@")

if [ "${#repos[@]}" -eq 0 ]; then
  config_file="$(dirname "$0")/content-repos.txt"
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
  echo "反映対象のcontent repoが指定されていません。" >&2
  echo "引数で渡すか、content-repos.txt に1行1パスで記載してください。" >&2
  exit 1
fi

failed=()
succeeded=()

for repo in "${repos[@]}"; do
  echo "== $repo =="

  if [ ! -d "$repo/.git" ]; then
    echo "!! $repo: gitリポジトリではないためスキップします"
    failed+=("$repo (not a git repo)")
    continue
  fi

  if [ ! -e "$repo/vendor/node-library" ]; then
    echo "!! $repo: vendor/node-library が存在しないためスキップします"
    failed+=("$repo (vendor/node-library not found)")
    continue
  fi

  (
    cd "$repo" || exit 1
    git submodule update --remote vendor/node-library
  )
  if [ $? -ne 0 ]; then
    echo "!! $repo: submodule updateに失敗しました"
    failed+=("$repo (submodule update failed)")
    continue
  fi

  (
    cd "$repo" || exit 1
    npm run verify-all
  )
  if [ $? -ne 0 ]; then
    echo "!! $repo: verify失敗。submodule参照を直前の状態に戻します"
    # `git checkout -- <path>` は親repoの索引上のgitlink(参照コミット)を
    # 戻すだけで、submodule内部の実際のcheckoutまでは連動しない
    # (submodule.recurse=trueが既定で有効でない限り)。そのため
    # `git submodule update` を続けて実行し、submoduleの中身を
    # 索引に記録されたコミットへ実際にcheckoutし直す必要がある。
    (cd "$repo" && git checkout -- vendor/node-library && git submodule update vendor/node-library)
    failed+=("$repo")
    continue
  fi

  succeeded+=("$repo")
done

echo ""
echo "反映成功: ${succeeded[*]:-なし}"
echo "反映失敗: ${failed[*]:-なし}"

if [ "${#failed[@]}" -gt 0 ]; then
  exit 1
fi

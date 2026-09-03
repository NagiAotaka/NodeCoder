#!/usr/bin/env bash
# install.sh
#
# content repo(実プロジェクト)側で1回実行するだけで、この node-library を
# vendor/node-library としてsubmodule追加し、各ノードの config(type: secret)
# のキー名を .env.example に追記する。
#
# 使い方(content repoのルートで実行):
#   curl -fsSL https://raw.githubusercontent.com/NagiAotaka/NodeCoder/main/install.sh | bash
#   # 特定ブランチを使う場合:
#   curl -fsSL https://raw.githubusercontent.com/NagiAotaka/NodeCoder/main/install.sh | bash -s -- claude/initial-design-0vjc68
#
# git submoduleのみで完結する(npm packageやworkspace化はしない。ROADMAP.md 2.10参照)。
# シークレットの実値はここでは一切扱わない(CLAUDE.md「絶対に守ること」)。

set -euo pipefail

REPO_URL="https://github.com/NagiAotaka/NodeCoder"
BRANCH="${1:-main}"
TARGET="vendor/node-library"

if [ ! -d .git ]; then
  echo "!! ここはgitリポジトリのルートではないようです。content repoのルートで実行してください。" >&2
  exit 1
fi

if [ -e "$TARGET" ]; then
  echo "!! $TARGET はすでに存在します。中断します。" >&2
  exit 1
fi

echo "== node-library を $TARGET としてsubmodule追加します(branch: $BRANCH) =="
git submodule add -b "$BRANCH" "$REPO_URL" "$TARGET"

echo ""
echo "== /add-node Skillをcontent repo側にも配置します =="
# Claude CodeはリポジトリルートのAND.claude/skills/を見るため、
# vendor/node-library/.claude/skills/add-node/ に置いたままでは
# content repo側から /add-node を呼び出せない。実際に呼び出せるように
# コピーする(symlinkはWindowsでの権限問題があるため使わない)。
mkdir -p .claude/skills
cp -r "$TARGET/.claude/skills/add-node" .claude/skills/add-node
echo "  + .claude/skills/add-node を配置しました(/add-node がこのrepoでも使えます)"
echo "    node-library側の更新後は、このコピーを手動で更新してください:"
echo "      rm -rf .claude/skills/add-node && cp -r $TARGET/.claude/skills/add-node .claude/skills/add-node"

echo ""
echo "== 各ノードのconfig(type: secret)のキー名を .env.example に追記します =="
touch .env.example
for schema in "$TARGET"/nodes/*/schema.yaml; do
  [ -f "$schema" ] || continue
  node_id="$(grep -m1 '^id:' "$schema" | sed 's/^id:[[:space:]]*//')"

  keys="$(awk '
    /^config:/ { in_config=1; next }
    in_config && /^[a-zA-Z]/ { in_config=0 }
    in_config && /- name:/ {
      name=$0
      sub(/.*name:[ \t]*/, "", name)
      sub(/[ \t]*#.*/, "", name)
      sub(/[ \t]*$/, "", name)
    }
    in_config && /type:[ \t]*secret/ { print name }
  ' "$schema")"

  for key in $keys; do
    [ -z "$key" ] && continue
    if ! grep -q "^${key}=" .env.example 2>/dev/null; then
      echo "${key}=" >> .env.example
      echo "  + ${key} (${node_id})"
    fi
  done
done

echo ""
echo "完了しました。次を確認してください:"
echo "  - vendor/node-library から必要なノードをimportして使う"
echo "  - .env.example に追記されたキーの実値は、.env(gitignore対象)に設定する"
echo "  - 変更を確認した上でコミットする:"
echo "      git add .gitmodules $TARGET .claude/skills/add-node .env.example"
echo "      git commit -m 'add node-library as submodule'"

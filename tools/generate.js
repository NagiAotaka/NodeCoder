#!/usr/bin/env node
// tools/generate.js
//
// 生成型ノードの決定論的テンプレートエンジン(ROADMAP.md 2.2)。
// LLMはここに一切関与しない。同一のtemplateと同一のanswersなら、
// 常に同一のコードが出力される(再現性100%)。
//
// 依存パッケージは追加しない(これまでの参照型ノード3つもNode.js標準
// ライブラリのみで実装しており、それに合わせる)。そのためHandlebars等の
// テンプレートエンジンは使わず、二重中括弧のプレースホルダの単純置換のみを
// サポートする。条件分岐・ループが必要になった場合は、本当に必要になった
// 時点で拡張する。
//
// 既知の制約: エスケープ機構が無いため、テンプレートファイル内のコメント
// 等でプレースホルダ構文をそのまま文字列として書くと誤って置換対象として
// 解釈される(answersに無ければエラーになる)。プレースホルダ以外の場所に
// この構文をそのまま書かないこと。
//
// 使い方:
//   node tools/generate.js --node <node-id> --answers <answers.yaml> --out <output-file>
//
//   --node    : nodes/<node-id>/schema.yaml (node_type: scaffold) を読み、
//               template / template_generation を得る。
//   --answers : /add-node がユーザーに質問して埋めた required_decision の
//               回答を key: value 形式で並べたYAML。テンプレート内の
//               {{key}} がこの値に置換される。
//   --out     : 出力先パス(content repo側の実際のファイルパス)。
//
// GENERATED/CUSTOMIZEDマーカー(ROADMAP.md 2.5):
//   生成ファイルの先頭に `// GENERATED - DO NOT EDIT` を付与する。
//   出力先に既存ファイルがあり `CUSTOMIZED` マーカーを含む場合は上書きしない
//   (手動編集を保護する)。`GENERATED` マーカーのみのファイルは自動上書きしてよい。

const fs = require("node:fs");
const path = require("node:path");

const GENERATED_MARKER = "GENERATED - DO NOT EDIT";
const CUSTOMIZED_MARKER = "CUSTOMIZED - manual changes below";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

// schema.yaml / answers.yaml はごく単純な `key: value` 形式のみサポートする
// (依存パッケージを増やさないため、YAMLパーサをフルには実装しない)。
// ネストが必要になった場合は、本当に必要かをまず検討すること
// (2.1「使われないフィールドは足さない」の精神)。
function parseSimpleYaml(text) {
  const result = {};
  for (const line of text.split("\n")) {
    const withoutComment = line.replace(/#.*$/, "");
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}

function render(template, values) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    if (!(key in values)) {
      throw new Error(`テンプレート変数 "${key}" に対応する値が answers に無い`);
    }
    return values[key];
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeId = args.node;
  const answersPath = args.answers;
  const outPath = args.out;

  if (!nodeId || !answersPath || !outPath) {
    console.error(
      "使い方: node tools/generate.js --node <node-id> --answers <answers.yaml> --out <output-file>",
    );
    process.exit(1);
  }

  const nodeDir = path.join(__dirname, "..", "nodes", nodeId);
  const schemaPath = path.join(nodeDir, "schema.yaml");
  if (!fs.existsSync(schemaPath)) {
    console.error(`!! ${schemaPath} が見つからない`);
    process.exit(1);
  }
  const schema = parseSimpleYaml(fs.readFileSync(schemaPath, "utf8"));

  if (schema.node_type !== "scaffold") {
    console.error(`!! ${nodeId} は node_type: scaffold ではない(generate.jsはscaffold型のみ対応)`);
    process.exit(1);
  }
  if (!schema.template) {
    console.error(`!! ${schemaPath} に template フィールドが無い`);
    process.exit(1);
  }

  const templatePath = path.join(nodeDir, schema.template);
  if (!fs.existsSync(templatePath)) {
    console.error(`!! ${templatePath} が見つからない`);
    process.exit(1);
  }
  const templateText = fs.readFileSync(templatePath, "utf8");

  if (!fs.existsSync(answersPath)) {
    console.error(`!! ${answersPath} が見つからない`);
    process.exit(1);
  }
  const answers = parseSimpleYaml(fs.readFileSync(answersPath, "utf8"));

  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, "utf8");
    if (existing.includes(CUSTOMIZED_MARKER)) {
      console.error(
        `!! ${outPath} は CUSTOMIZED マーカーがあるため上書きしない。手動でマージすること。`,
      );
      process.exit(1);
    }
  }

  let body;
  try {
    body = render(templateText, answers);
  } catch (err) {
    console.error(`!! ${err.message}`);
    process.exit(1);
  }

  const generation = schema.template_generation ?? "?";
  const output = `// ${GENERATED_MARKER} (template_generation: ${generation})\n${body}`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`生成しました: ${outPath}`);
}

main();

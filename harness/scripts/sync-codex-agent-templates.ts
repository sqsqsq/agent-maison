// sync-codex-agent-templates.ts — 由 verifier.md 生成 codex 角色 toml（plan 7b2e9d4c D1）
//
//   cd harness && npm run sync:codex-agents
//
// 生成物提交进仓库；漏跑由 codex-adapter-verifier-template.unit.test.ts 抓（V1 等值/漂移）。

import * as fs from 'fs';
import * as path from 'path';

import { renderCodexAgentToml } from './utils/codex-agent-toml';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');
const SRC_REL = 'agents/claude/templates/agents/verifier.md';
const OUT_REL = 'agents/codex/templates/agents/verifier.toml';

function main(): void {
  const srcAbs = path.join(FRAMEWORK_ROOT, SRC_REL);
  const outAbs = path.join(FRAMEWORK_ROOT, OUT_REL);
  const toml = renderCodexAgentToml(fs.readFileSync(srcAbs, 'utf-8'));
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // toml 已是 LF；utf-8 写入不做行尾转换
  fs.writeFileSync(outAbs, toml, 'utf-8');
  console.log(`[sync-codex-agents] ${OUT_REL} ← ${SRC_REL}`);
}

main();

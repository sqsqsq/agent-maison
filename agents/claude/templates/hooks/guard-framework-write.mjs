// ============================================================================
// guard-framework-write.mjs — claude PreToolUse 壳（plan e8f5a2c7 G1a）
// ============================================================================
// 物化到实例 .claude/hooks/；由 settings.json PreToolUse（matcher
// Write|Edit|MultiEdit|NotebookEdit）拉起。职责仅两件：
//   1. 解析 claude hook stdin payload，取目标文件路径；
//   2. 动态 import 发布件内共享判定核心（framework/agents/shared/），deny → exit 2
//      （PreToolUse 协议：exit 2 阻断工具调用、stderr 反馈给 agent）。
// 一切异常 fail-open（exit 0）——G2 查时扫描恒为兜底；诚实边界：只拦编辑类工具，
// Bash 重定向/node -e 写文件不在射程。

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

/** claude 编辑类工具的目标路径字段（Write/Edit/MultiEdit: file_path；NotebookEdit: notebook_path）。 */
function extractTargetPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const cand = [toolInput.file_path, toolInput.notebook_path];
  for (const c of cand) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    process.exit(0); // 非法 payload → fail-open
  }
  const projectRoot = (process.env.CLAUDE_PROJECT_DIR ?? payload?.cwd ?? process.cwd()) || process.cwd();
  const target = extractTargetPath(payload?.tool_input);
  if (!target) process.exit(0);

  const coreAbs = path.join(projectRoot, 'framework', 'agents', 'shared', 'guard-framework-write-core.mjs');
  if (!fs.existsSync(coreAbs)) process.exit(0); // 未 vendored（源仓/旧包）→ fail-open

  let core;
  try {
    core = await import(pathToFileURL(coreAbs).href);
  } catch {
    process.exit(0);
  }
  const verdict = core.evaluateFrameworkWrite({ projectRoot, filePath: target });
  if (verdict.decision === 'deny') {
    process.stderr.write(verdict.reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}

main().catch(() => process.exit(0));

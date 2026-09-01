// ============================================================================
// guard-framework-write.mjs — claude PreToolUse 壳（plan e8f5a2c7 G1a）
// ============================================================================
// 物化到实例 .claude/hooks/；由 settings.json PreToolUse（matcher
// Write|Edit|MultiEdit|NotebookEdit）拉起。职责仅两件：
//   1. 解析 claude hook stdin payload，取目标文件路径；
//   2. 动态 import 发布件内共享判定核心（framework/agents/shared/），deny → exit 2
//      （PreToolUse 协议：exit 2 阻断工具调用、stderr 反馈给 agent）。
// 一切异常 fail-open（exit 0）。诚实边界：只拦编辑类工具；Bash 重定向、脚本、
// node -e 与场外进程不在射程，也没有事后 Git/hash detector 兜底。

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

// --------------------------------------------------------------------------
// 项目根解析（plan c7a9e2f4 T2：厂商无关加固，三 hook 同款）
// --------------------------------------------------------------------------
// 候选序：env(claude → codeagent3) → import.meta.url 自锚 → payload.cwd → process.cwd()，
// 取首个含 hooks 真实依赖标记（guard-core / check-receipt 任一）的候选。
// 自锚排在 payload.cwd 前：hook 物理位于 <root>/.claude|.cac/hooks/，比会话 cwd 权威——
// 宿主实证（2026-07-29）payload.cwd 与 process.cwd() 都随会话 cd 漂移。
// 全不中：回落原兜底序（env → payload.cwd → cwd）首个非空值，fail-open 语义不变；
// 自锚不参与盲兜底（源仓/模板目录下自锚指向 agents/<name>，非实例根）。

const PROJECT_ROOT_MARKERS = [
  ['framework', 'agents', 'shared', 'guard-framework-write-core.mjs'],
  ['framework', 'harness', 'scripts', 'check-receipt.ts'],
];

function hasProjectRootMarker(root) {
  try {
    return PROJECT_ROOT_MARKERS.some((parts) => fs.existsSync(path.join(root, ...parts)));
  } catch {
    return false;
  }
}

function normalizeCandidate(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
}

function resolveProjectRoot(payload) {
  let selfAnchor = null;
  try {
    selfAnchor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  } catch {
    selfAnchor = null;
  }
  const envClaude = normalizeCandidate(process.env.CLAUDE_PROJECT_DIR);
  const envCodeagent = normalizeCandidate(process.env.CODEAGENT3_PROJECT_DIR);
  const payloadCwd = normalizeCandidate(payload && typeof payload.cwd === 'string' ? payload.cwd : null);
  const anchored = [envClaude, envCodeagent, selfAnchor, payloadCwd, process.cwd()].filter(Boolean);
  for (const cand of anchored) {
    if (hasProjectRootMarker(cand)) return cand;
  }
  return envClaude ?? envCodeagent ?? payloadCwd ?? process.cwd();
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
  const projectRoot = resolveProjectRoot(payload);
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

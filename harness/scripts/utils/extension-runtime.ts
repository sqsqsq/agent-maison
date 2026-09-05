// cp→main: 分支临时件（plan a7c3e9d2）。主干同路径已有 manifest 1.1 版：对 1.0 返回空串，对 1.1 渲染 knowledge / before_phase_work / mcp 三块。
// cp 时整份取主干版本，不合并本文件；仍用 1.0 的宿主会失去 goal 作者提示，须改 1.1 声明（MIGRATION.md 3.0.x 段）。
import * as path from 'path';

import type { ExtensionBundle } from './types';

function rel(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).replace(/\\/g, '/');
}

/**
 * 作者阶段 prompt 的实例扩展输入段——与主干 formatExtensionPhasePrompt 同名、同签名、同标题。
 * 3.0.x 分支体只渲染 manifest 1.0 的 `provides.knowledge`（字符串；全部 Feature phase 都列出），
 * 不列 hooks、不跑 .mjs、不读正文。`phase` 在本分支不参与判断，只为对齐主干签名。
 * bundle 缺失 / errors 非空 → 空串；错误由调用入口出声（goal-phase-runtime.extensionInputsForPhase）。
 */
export function formatExtensionPhasePrompt(
  bundle: ExtensionBundle | undefined,
  _phase: string,
  projectRoot: string,
): string {
  if (!bundle || bundle.errors.length > 0 || bundle.knowledgePaths.length === 0) return '';
  const lines = ['## Instance extension inputs', '', '### Knowledge index', ''];
  for (const abs of bundle.knowledgePaths) {
    lines.push('- `' + rel(projectRoot, abs) + '`');
  }
  return lines.join('\n').trimEnd();
}

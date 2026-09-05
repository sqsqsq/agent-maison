// ============================================================================
// multimodal-evidence-gate.ts — 读图证据软门禁（M3-5，claude-kernel scoped）
// ============================================================================

import * as fs from 'fs';
import { parseReadImageEvidenceBlock } from './read-image-evidence';
import type { ImageInputMode } from './multimodal-probe';

export interface MultimodalEvidenceGateInput {
  adapter: string;
  imageInput: ImageInputMode;
  /**
   * verifier 结论正文。只能来自 `loadVerifierReportTextOrNull`（plan d2f7a9c4：读当前
   * subject 的 verifier.report.<subject>.md，subject 回显与 verdict 自洽才接受）。
   * 校验不通过时传 undefined，落下面既有的"未取得读图证据"降级通道。
   */
  verifierReportText?: string;
  /** 强制解析仅 claude-kernel 家族（claude/codeagent；check-receipt 按 isClaudeKernelAdapter 传入） */
  forceParse: boolean;
}

export interface MultimodalEvidenceGateResult {
  id: 'visual_multimodal_parity';
  status: 'PASS' | 'WARN' | 'SKIP';
  details: string;
}

/**
 * 评估 verifier 报告是否含合规读图证据块。
 * - claude-kernel（claude/codeagent）+ tool_read + forceParse：解析文件，无证据 → WARN
 * - 非 claude-kernel / none：SKIP（prompt 自律，不假装强制）
 */
export function evaluateMultimodalEvidenceGate(
  input: MultimodalEvidenceGateInput,
): MultimodalEvidenceGateResult | null {
  if (input.imageInput === 'none') {
    return {
      id: 'visual_multimodal_parity',
      status: 'SKIP',
      details: 'adapter image_input=none；视觉多模态层已降级（adapter 不支持图像）。',
    };
  }
  if (input.imageInput !== 'tool_read' && input.imageInput !== 'native_attach') {
    return null;
  }
  if (!input.forceParse) {
    return {
      id: 'visual_multimodal_parity',
      status: 'SKIP',
      details:
        `adapter=${input.adapter}：读图证据无 harness 强制解析（非 claude-kernel verifier 证据链）；` +
        '依赖 prompt 自律。claude-kernel 家族（claude/codeagent）经 SubagentStop hook 强制解析。',
    };
  }
  const text = input.verifierReportText ?? '';
  if (!text.trim()) {
    return {
      id: 'visual_multimodal_parity',
      status: 'WARN',
      details: '未取得读图证据，多模态降级（verifier 机器证据缺失或未通过身份验真）。',
    };
  }
  const parsed = parseReadImageEvidenceBlock(text);
  if (!parsed.ok) {
    return {
      id: 'visual_multimodal_parity',
      status: 'WARN',
      details: `未取得读图证据，多模态降级（区别于 adapter 不支持）：${parsed.reason}`,
    };
  }
  return {
    id: 'visual_multimodal_parity',
    status: 'PASS',
    details: `读图证据块合规；${parsed.reason}；files=${parsed.entries.map(e => e.file).join(', ')}`,
  };
}

/**
 * @deprecated 读图证据的正文来源统一走 `loadVerifierReportTextOrNull`（它按当前 subject
 * 定位报告并校验终态块）。本函数不再有生产调用点，保留仅为兼容窗口——**不得**用它绕开
 * subject 校验去裸读任意路径的报告文件。
 */
export function readVerifierReportFile(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

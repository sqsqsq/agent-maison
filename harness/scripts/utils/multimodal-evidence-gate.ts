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
   * verifier 结论正文。**只**能来自身份验真后的 `verifier.report.json`
   * （plan e5b8c3f7：check-receipt 经 loadVerifierReportTextOrNull 传入）——
   * 裸读 Markdown 等于让"编辑 MD"就能伪造读图证据块。验真不通过时传 undefined，
   * 落下面既有的"未取得读图证据"降级通道。
   */
  verifierReportText?: string;
  /** 强制解析仅 claude-kernel 家族（claude/codeagent；SubagentStop hook 发布 verifier.report.json，check-receipt 按 isClaudeKernelAdapter 传入） */
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
 * @deprecated plan e5b8c3f7：读图证据的正文来源已切到身份验真后的
 * `verifier.report.json`（`loadVerifierReportTextOrNull`）。本函数不再有生产调用点，
 * 保留仅为兼容窗口——**不得**用它把 `verifier.report.md` 重新接回任何机器判定面。
 */
export function readVerifierReportFile(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

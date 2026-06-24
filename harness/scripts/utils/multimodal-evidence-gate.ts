// ============================================================================
// multimodal-evidence-gate.ts — 读图证据软门禁（M3-5，claude-scoped）
// ============================================================================

import * as fs from 'fs';
import { parseReadImageEvidenceBlock } from './read-image-evidence';
import type { ImageInputMode } from './multimodal-probe';

export interface MultimodalEvidenceGateInput {
  adapter: string;
  imageInput: ImageInputMode;
  verifierReportText?: string;
  /** 强制解析仅 Claude（hook 落 verifier.report.md） */
  forceParse: boolean;
}

export interface MultimodalEvidenceGateResult {
  id: 'visual_multimodal_parity';
  status: 'PASS' | 'WARN' | 'SKIP';
  details: string;
}

/**
 * 评估 verifier 报告是否含合规读图证据块。
 * - Claude + tool_read + forceParse：解析文件，无证据 → WARN
 * - 非 Claude / none：SKIP（prompt 自律，不假装强制）
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
        `adapter=${input.adapter}：读图证据无 harness 强制解析（非 Claude verifier.report.md）；` +
        '依赖 prompt 自律。Claude 经 SubagentStop hook 强制解析。',
    };
  }
  const text = input.verifierReportText ?? '';
  if (!text.trim()) {
    return {
      id: 'visual_multimodal_parity',
      status: 'WARN',
      details: '未取得读图证据，多模态降级（verifier.report.md 为空或缺失）。',
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

export function readVerifierReportFile(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

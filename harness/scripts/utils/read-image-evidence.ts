// ============================================================================
// read-image-evidence.ts — 读图证据块契约 SSOT（M3-3a / M3-5 共用）
// ============================================================================

/** fenced code block 语言标识（prompt 产出端与 gate 解析端共用） */
export const READ_IMAGE_EVIDENCE_FENCE = 'read-image-evidence';

/** 固定锚标题（与 fenced block 二选一定型；当前 SSOT 用 fenced block） */
export const READ_IMAGE_EVIDENCE_HEADING = '## 已读图证据';

export interface ReadImageEvidenceEntry {
  file: string;
  observation: string;
}

export interface ReadImageEvidenceParseResult {
  ok: boolean;
  entries: ReadImageEvidenceEntry[];
  /** 未解析到合规块时的原因 */
  reason: string;
}

const FENCED_BLOCK_RE = new RegExp(
  '```' + READ_IMAGE_EVIDENCE_FENCE + '\\s*\\r?\\n([\\s\\S]*?)```',
  'i',
);

function parseEvidenceBody(body: string): ReadImageEvidenceEntry[] {
  const entries: ReadImageEvidenceEntry[] = [];
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const fileMatch = /^\s*-\s*file:\s*(.+)\s*$/.exec(lines[i]);
    if (!fileMatch) {
      i++;
      continue;
    }
    const file = fileMatch[1].trim().replace(/^['"]|['"]$/g, '');
    i++;
    if (i >= lines.length) break;
    const obsMatch = /^\s*observation:\s*(.+)\s*$/.exec(lines[i]);
    if (!obsMatch) continue;
    const observation = obsMatch[1].trim();
    if (file && observation) {
      entries.push({ file, observation });
    }
    i++;
  }
  return entries;
}

/**
 * 从 verifier 报告文本解析读图证据块。
 * 契约：fenced ```read-image-evidence 内含 YAML 风格条目列表。
 */
export function parseReadImageEvidenceBlock(text: string): ReadImageEvidenceParseResult {
  if (!text || !text.trim()) {
    return { ok: false, entries: [], reason: 'empty text' };
  }
  const m = FENCED_BLOCK_RE.exec(text);
  if (!m?.[1]) {
    return { ok: false, entries: [], reason: `missing fenced ${READ_IMAGE_EVIDENCE_FENCE} block` };
  }
  const entries = parseEvidenceBody(m[1]);
  if (entries.length === 0) {
    return { ok: false, entries: [], reason: 'fenced block present but no valid file/observation entries' };
  }
  return { ok: true, entries, reason: `entries=${entries.length}` };
}

/** prompt 侧：生成读图证据块格式说明（注入 verify-coding / report-generator） */
export function formatReadImageEvidenceInstructions(sidecarFiles: string[]): string {
  const lines = [
    '**读图证据块（必填，可机读）**：须用读图工具逐个读取 `context-images/` 下 sidecar，并在结论中输出：',
    '',
    '```' + READ_IMAGE_EVIDENCE_FENCE,
  ];
  if (sidecarFiles.length > 0) {
    for (const f of sidecarFiles) {
      lines.push(`- file: ${f}`);
      lines.push(`  observation: <该图关键观察：版面/品牌色/资产/文案>`);
    }
  } else {
    lines.push('- file: <sidecar 文件名>');
    lines.push('  observation: <关键观察>');
  }
  lines.push('```', '', '缺此块 → visual_multimodal_parity 须标 WARN「未取得读图证据，多模态降级」。');
  return lines.join('\n');
}

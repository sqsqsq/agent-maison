// ============================================================================
// verifier-evidence-fixture.ts — 测试侧「调用方把 verifier 回复写成报告」的共享工具
// ============================================================================
// plan d2f7a9c4：生产侧的写者是**派发 verifier 的那个 agent**（phase executor / 主 agent），
// 它把 verifier 的回复原样写入 `summary.verifier_report`。单测不跑真模型，但必须产出与生产
// 同形的字节，否则测的是幻想中的格式。
//
// 因此本工具刻意复用生产 SSOT：终态块标记与文件名都来自 scripts/utils/verifier-subject.ts，
// 不在这里手抄常量。签名保持与上一代一致（jsonPath 字段仍在，指向 MD——调用点不必改）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  RESULT_BLOCK_CLOSE,
  RESULT_BLOCK_OPEN,
  verifierReportMdFilename,
} from '../../scripts/utils/verifier-subject';

/** 任意但形态合法的 64 hex subject（同一 seed 恒定，便于断言）。 */
export function fixtureSubjectId(seed = 'fixture'): string {
  let out = '';
  for (let i = 0; out.length < 64; i++) {
    out += Buffer.from(`${seed}#${i}`).toString('hex');
  }
  return out.slice(0, 64);
}

export interface PublishFixtureVerifierEvidenceOptions {
  projectRoot: string;
  /** reports 目录绝对路径（summary.json / verifier.report.<subject>.md 所在处） */
  reportsDir: string;
  feature: string;
  phase: string;
  subjectId?: string;
  verdict?: 'PASS' | 'FAIL';
  blockerCount?: number;
  /** 报告正文（终态块之前的部分）——生产里就是 verifier 回复的全文 */
  reportText?: string;
  /** 终态块里回显的 subject；默认与文件名同 subject（负例可故意写错） */
  echoSubjectId?: string;
  /** 不去动 summary.json（用于「subject 缺席」类负例） */
  skipSummaryPatch?: boolean;
  /** 写进 summary 的 subject 与报告文件名不同（迟到 / 错位负例） */
  summarySubjectId?: string;
  /** 只写终态块、不写正文——复现「调用方没写全文」的坏形态 */
  blockOnly?: boolean;
  /** 追加第二个终态块——复现「多份回答拼接」的坏形态 */
  duplicateBlock?: boolean;
}

/**
 * 把 verifier_subject_id / verifier_report 补进已存在的 summary.json（runner 生产侧的等价效果）。
 * `projectRoot` 必填：`verifier_report` 的契约是**仓根相对路径**，按 reports 目录反推基准会得到
 * `spec/reports/…` 这种半截路径——夹具与被测代码各自拼路径时能一起"通过"，正是这类测试的盲区。
 */
export function patchSummarySubject(projectRoot: string, reportsDir: string, subjectId: string): void {
  const p = path.join(reportsDir, 'summary.json');
  if (!fs.existsSync(p)) return;
  const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  doc.verifier_subject_id = subjectId;
  doc.verifier_report = path
    .relative(projectRoot, path.join(reportsDir, verifierReportMdFilename(subjectId)))
    .replace(/\\/g, '/');
  // 与生产 atomicWriteJson 同形（无尾换行），避免 fixture 改写 summary 字节口径。
  fs.writeFileSync(p, JSON.stringify(doc, null, 2), 'utf-8');
}

/** 终态块（生产格式，由 parseResultBlock 解析）。 */
export function renderResultBlock(subjectId: string, verdict: 'PASS' | 'FAIL', blockerCount: number): string {
  return [
    RESULT_BLOCK_OPEN,
    `verifier_subject_id: ${subjectId}`,
    `verdict: ${verdict}`,
    `blocker_count: ${blockerCount}`,
    RESULT_BLOCK_CLOSE,
  ].join('\n');
}

/**
 * 写一份与生产同形的 verifier 报告（默认 PASS/0 blocker），并把 subject 写进 summary.json。
 * 返回 subject 与报告绝对路径（`jsonPath` 为兼容别名，与 `mdPath` 同值）。
 */
export function publishFixtureVerifierEvidence(
  opts: PublishFixtureVerifierEvidenceOptions,
): { subjectId: string; jsonPath: string; mdPath: string } {
  const subjectId = opts.subjectId ?? fixtureSubjectId(`${opts.feature}/${opts.phase}`);
  const verdict = opts.verdict ?? 'PASS';
  const blockerCount = opts.blockerCount ?? (verdict === 'PASS' ? 0 : 1);
  const echoSubject = opts.echoSubjectId ?? subjectId;
  const body =
    opts.reportText ??
    [
      `# Verifier 报告 — ${opts.feature} / ${opts.phase}`,
      '',
      '| check | verdict | 证据 |',
      '| --- | --- | --- |',
      `| 语义一致性 | ${verdict} | fixture |`,
      '',
    ].join('\n');
  const block = renderResultBlock(echoSubject, verdict, blockerCount);
  const text = opts.blockOnly
    ? `${block}\n`
    : `${body}\n${block}\n${opts.duplicateBlock ? `\n${block}\n` : ''}`;

  const mdPath = path.join(opts.reportsDir, verifierReportMdFilename(subjectId));
  fs.mkdirSync(opts.reportsDir, { recursive: true });
  fs.writeFileSync(mdPath, text, 'utf-8');

  if (!opts.skipSummaryPatch) {
    patchSummarySubject(opts.projectRoot, opts.reportsDir, opts.summarySubjectId ?? subjectId);
  }

  return { subjectId, jsonPath: mdPath, mdPath };
}

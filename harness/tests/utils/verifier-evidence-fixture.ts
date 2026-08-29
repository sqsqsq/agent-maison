// ============================================================================
// verifier-evidence-fixture.ts — 测试侧「发布一份合法 verifier 机器证据」的共享工具
// ============================================================================
// plan e5b8c3f7 T5。生产侧的发布者是 SubagentStop hook；单测 fixture 不跑 hook，
// 但必须产出与 hook **同形**的产物，否则测的是幻想中的格式。
// 因此本工具刻意复用生产 SSOT：schema 版本与 result hash 都来自
// scripts/utils/verifier-subject.ts / verifier-evidence.ts，不在这里手抄常量。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { VERIFIER_REPORT_SCHEMA_VERSION } from '../../scripts/utils/verifier-evidence';
import {
  computeVerifierResultSha256,
  verifierReportJsonFilename,
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
  /** reports 目录绝对路径（summary.json / verifier.report.json 所在处） */
  reportsDir: string;
  feature: string;
  phase: string;
  subjectId?: string;
  verdict?: 'PASS' | 'FAIL';
  blockerCount?: number;
  agentId?: string;
  agentType?: string;
  reportText?: string;
  /** 直接落 conflict 态（回归 8） */
  conflictWith?: { agentId: string; verdict: 'PASS' | 'FAIL'; blockerCount: number; reportText?: string };
  /** 不去动 summary.json（用于「subject 缺席」/「三值不等」类负例） */
  skipSummaryPatch?: boolean;
  /** 写进 summary 的 subject 与 JSON 里的不同（回归 3 迟到 / 错位） */
  summarySubjectId?: string;
}

/** 把 verifier_subject_id 补进已存在的 summary.json（runner 生产侧的等价效果）。 */
export function patchSummarySubject(reportsDir: string, subjectId: string): void {
  const p = path.join(reportsDir, 'summary.json');
  if (!fs.existsSync(p)) return;
  const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  doc.verifier_subject_id = subjectId;
  // 与生产 atomicWriteJson 同形（无尾换行），避免 fixture 改写 summary 字节口径。
  fs.writeFileSync(p, JSON.stringify(doc, null, 2), 'utf-8');
}

/**
 * 发布一份与 hook 同形的 canonical 证据（默认 PASS/0 blocker），并把 subject 写进
 * summary.json。返回 subject 与 JSON 绝对路径。
 */
export function publishFixtureVerifierEvidence(
  opts: PublishFixtureVerifierEvidenceOptions,
): { subjectId: string; jsonPath: string; mdPath: string } {
  const subjectId = opts.subjectId ?? fixtureSubjectId(`${opts.feature}/${opts.phase}`);
  const verdict = opts.verdict ?? 'PASS';
  const blockerCount = opts.blockerCount ?? (verdict === 'PASS' ? 0 : 1);
  const reportText = opts.reportText ?? `# Verifier Report — ${opts.feature} / ${opts.phase}\n\nverdict: ${verdict}\n`;
  const agentId = opts.agentId ?? 'agent-fixture-1';
  // 证据按 subject 分区（review 四轮 P0）——夹具必须与生产同名，否则 loader 找不到。
  const jsonPath = path.join(opts.reportsDir, verifierReportJsonFilename(subjectId));
  const mdPath = path.join(opts.reportsDir, verifierReportMdFilename(subjectId));

  fs.mkdirSync(opts.reportsDir, { recursive: true });

  const base = {
    schema_version: VERIFIER_REPORT_SCHEMA_VERSION,
    state: 'published' as string,
    feature: opts.feature,
    phase: opts.phase,
    subject_id: subjectId,
    invocation_subject: subjectId,
    result_subject: subjectId,
    agent_id: agentId,
    agent_type: opts.agentType ?? 'verifier',
    verdict,
    blocker_count: blockerCount,
    result_sha256: computeVerifierResultSha256({ verdict, blocker_count: blockerCount, report_text: reportText }),
    report_text: reportText,
    report_md_path: path.relative(opts.projectRoot, mdPath).replace(/\\/g, '/'),
    generated_at: '2026-08-29T00:00:00.000Z',
    audit: {
      agent_transcript_path: null,
      main_transcript_path: null,
      session_id: null,
      recorded_by: 'tests/utils/verifier-evidence-fixture.ts',
    },
  } as Record<string, unknown>;

  if (opts.conflictWith) {
    const other = opts.conflictWith;
    const otherText = other.reportText ?? `# other side\n\nverdict: ${other.verdict}\n`;
    base.state = 'conflict';
    base.conflict = {
      detected_at: '2026-08-29T00:00:01.000Z',
      sides: [
        { agent_id: agentId, agent_type: 'verifier', verdict, blocker_count: blockerCount, result_sha256: base.result_sha256, observed_at: base.generated_at },
        {
          agent_id: other.agentId,
          agent_type: 'verifier',
          verdict: other.verdict,
          blocker_count: other.blockerCount,
          result_sha256: computeVerifierResultSha256({
            verdict: other.verdict,
            blocker_count: other.blockerCount,
            report_text: otherText,
          }),
          observed_at: '2026-08-29T00:00:01.000Z',
        },
      ],
    };
  }

  fs.writeFileSync(jsonPath, `${JSON.stringify(base, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(
    mdPath,
    [
      '# Verifier 子 agent 报告（人读投影）',
      '',
      '> 机器真源是同目录 `verifier.report.json`；本 MD 机器不解析。',
      '',
      `- verdict: ${verdict}`,
      '',
      '```',
      reportText,
      '```',
      '',
    ].join('\n'),
    'utf-8',
  );

  if (!opts.skipSummaryPatch) {
    patchSummarySubject(opts.reportsDir, opts.summarySubjectId ?? subjectId);
  }

  return { subjectId, jsonPath, mdPath };
}

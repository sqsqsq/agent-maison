// ============================================================================
// goal-checkpoint.unit.test.ts — P2 phase 内断点续跑
// ============================================================================
// 验证：runner 从 context-exploration.md 派生"已检视且验真"skip-list、
// 陈旧/越界/伪造文件被拦、非探索 phase 回落、checkpoint.json 派生与跨进程回读。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearFrameworkConfigCache, receiptDirPath } from '../../config';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import {
  deriveResumeInspection,
  buildResumeSkipLines,
  deriveReportSections,
  deriveAndWriteCheckpoint,
  readPhaseCheckpointTimedOut,
} from '../../scripts/utils/goal-checkpoint';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq(a: unknown, b: unknown, label: string): void {
  if (a !== b) throw new Error(`${label}: 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}
function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-checkpoint-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** 写 context-exploration.md（并按需在盘上创建声明的源文件）。 */
function writeContextExploration(
  root: string,
  feature: string,
  phase: string,
  opts: { ready: boolean; sourcePaths: string[]; createFiles?: string[] },
): void {
  const dir = receiptDirPath(root, feature, phase);
  fs.mkdirSync(dir, { recursive: true });
  const fm = [
    '---',
    'schema_version: "1.1.0"',
    `feature: ${feature}`,
    `phase: ${phase}`,
    `ready_to_produce: ${opts.ready}`,
    `files_inspected_count: ${opts.sourcePaths.length}`,
    'source_code_paths:',
    ...opts.sourcePaths.map(p => `  - ${p}`),
    '---',
    '# Context Exploration',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'context-exploration.md'), fm, 'utf-8');
  for (const rel of opts.createFiles ?? opts.sourcePaths) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '// src', 'utf-8');
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'exploring: ready_to_produce=false + 源文件存在 → stage=exploring，skip-list=已检视',
    run: () => withTmpProject(root => {
      writeContextExploration(root, 'demo', 'review', {
        ready: false,
        sourcePaths: ['src/a.ets', 'src/b.ets'],
      });
      const insp = deriveResumeInspection(root, 'demo', 'review', 0);
      assertTrue(insp !== null, '应有断点');
      assertEq(insp!.stage, 'exploring', 'stage');
      assertEq(insp!.inspectedFiles.length, 2, 'skip-list 数');
    }),
  },
  {
    name: '验真：声明了但盘上不存在的文件被剔除（防伪造 skip）',
    run: () => withTmpProject(root => {
      writeContextExploration(root, 'demo', 'review', {
        ready: false,
        sourcePaths: ['src/a.ets', 'src/ghost.ets'],
        createFiles: ['src/a.ets'], // ghost 不落盘
      });
      const insp = deriveResumeInspection(root, 'demo', 'review', 0);
      assertEq(insp!.inspectedFiles.length, 1, '仅真实存在的计入');
      assertTrue(insp!.inspectedFiles[0].includes('a.ets'), '保留 a.ets');
    }),
  },
  {
    name: '陈旧：context-exploration.md 早于 sinceMs（非本 run）→ null',
    run: () => withTmpProject(root => {
      writeContextExploration(root, 'demo', 'review', { ready: false, sourcePaths: ['src/a.ets'] });
      const future = Date.now() + 100_000;
      assertEq(deriveResumeInspection(root, 'demo', 'review', future), null, '陈旧应 null');
    }),
  },
  {
    name: '非探索 phase（testing 无探索产物）→ null',
    run: () => withTmpProject(root => {
      assertEq(deriveResumeInspection(root, 'demo', 'testing', 0), null, 'testing 回落');
    }),
  },
  {
    name: 'reporting: ready_to_produce=true → stage=reporting',
    run: () => withTmpProject(root => {
      writeContextExploration(root, 'demo', 'review', { ready: true, sourcePaths: ['src/a.ets'] });
      const insp = deriveResumeInspection(root, 'demo', 'review', 0);
      assertEq(insp!.stage, 'reporting', 'stage');
    }),
  },
  {
    name: 'buildResumeSkipLines：exploring 列文件+勿重读；reporting 提示探索已完成',
    run: () => {
      const explore = buildResumeSkipLines({ stage: 'exploring', inspectedFiles: ['src/a.ets'] }).join('\n');
      assertTrue(explore.includes('src/a.ets') && explore.includes('勿重复 Read'), 'exploring 文案');
      const report = buildResumeSkipLines({ stage: 'reporting', inspectedFiles: ['src/a.ets'] }).join('\n');
      assertTrue(report.includes('探索已完成'), 'reporting 文案');
    },
  },
  {
    name: '章节级断点：buildResumeSkipLines reporting + 已写章节 → 列章节、只补未写',
    run: () => {
      const out = buildResumeSkipLines(
        { stage: 'reporting', inspectedFiles: ['src/a.ets'] },
        ['一、审查范围', '二、审查方法'],
      ).join('\n');
      assertTrue(out.includes('报告已写章节'), '缺已写章节提示');
      assertTrue(out.includes('二、审查方法'), '缺章节名');
      assertTrue(out.includes('只补未写章节'), '缺"只补未写"指令');
    },
  },
  {
    name: 'deriveReportSections：从 partial 报告取二级标题（跳过 context-exploration）',
    run: () => withTmpProject(root => {
      const rel = 'doc/features/demo/review/review-report.md';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, ['# Review', '## 一、审查范围', 'x', '## 二、审查方法', 'y'].join('\n'), 'utf-8');
      const sections = deriveReportSections(root, ['doc/features/demo/review/context-exploration.md', rel]);
      assertEq(sections.join('|'), '一、审查范围|二、审查方法', '二级标题');
    }),
  },
  {
    name: 'checkpoint.json：runner 派生落盘（含 report_sections_done）+ 跨进程回读 timed_out',
    run: () => withTmpProject(root => {
      writeContextExploration(root, 'demo', 'review', { ready: false, sourcePaths: ['src/a.ets'] });
      const reportRel = 'doc/features/demo/review/review-report.md';
      const reportAbs = path.join(root, reportRel);
      fs.mkdirSync(path.dirname(reportAbs), { recursive: true });
      fs.writeFileSync(reportAbs, ['# R', '## 一、审查范围', 'x'].join('\n'), 'utf-8');
      const reportDir = 'doc/features/demo/goal-runs/run1';
      const cp = deriveAndWriteCheckpoint({
        projectRoot: root,
        reportDir,
        feature: 'demo',
        phase: 'review',
        sinceMs: 0,
        timedOut: true,
        artifactRelPaths: [reportRel],
      });
      assertEq(cp.stage, 'exploring', 'checkpoint stage');
      assertEq(cp.timed_out, true, 'checkpoint timed_out');
      assertEq(cp.inspected_file_count, 1, 'checkpoint 已检视数');
      assertEq(cp.report_sections_done.join('|'), '一、审查范围', 'checkpoint 已写章节');
      assertEq(cp.artifacts.length, 1, 'checkpoint artifact+hash');
      assertTrue(
        fs.existsSync(path.join(root, reportDir, 'phases', 'review', 'checkpoint.json')),
        'checkpoint.json 落盘',
      );
      assertEq(readPhaseCheckpointTimedOut(root, reportDir, 'review'), true, '跨进程回读 timed_out');
    }),
  },
  {
    name: 'readPhaseCheckpointTimedOut：无 checkpoint → false',
    run: () => withTmpProject(root => {
      assertEq(readPhaseCheckpointTimedOut(root, 'doc/features/demo/goal-runs/none', 'review'), false, '缺档案 false');
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}

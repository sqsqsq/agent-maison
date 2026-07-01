// ============================================================================
// review-context.unit.test.ts — review 阶段缺上下文引导回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import checker from '../../scripts/check-review';
import { CheckContext } from '../../scripts/utils/types';
import { inferRepoLayout } from '../../repo-layout';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

async function withTmpProject<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-context-'));
  ensureConsumerFrameworkTree(dir);
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function ctx(root: string, featureSpec: CheckContext['featureSpec']): CheckContext {
  clearFrameworkConfigCache();
  const fw = loadFrameworkConfig(root);
  const resolvedProfile = loadResolvedProfile(root, fw);
  return {
    phase: 'review',
    feature: 'demo',
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
    phaseRule: {
      phase: 'review',
      structure_checks: {},
      semantic_checks: {},
      traceability_checks: {},
    } as CheckContext['phaseRule'],
    featureSpec,
    resolvedProfile,
  };
}

const validReport = [
  '---',
  'feature: demo',
  'phase: review',
  '---',
  '# Review',
  '## 审查范围',
  'TaskDemo',
  '## 审查方法',
  '按规则审查',
  '## 问题清单',
  '无问题',
  '## 问题统计',
  'BLOCKER: 0',
  'MAJOR: 0',
  'MINOR: 0',
  '## 修复建议',
  '无',
  '## 结论',
  '**审查结论**: 通过',
].join('\n');

// 带 BLOCKER 计数的报告——用于裁决 vs BLOCKER 一致性回归。
function reportWith(verdictLine: string, blockerCount: number): string {
  const rows: string[] = [];
  for (let i = 0; i < blockerCount; i++) {
    rows.push(`| CR-00${i + 1} | BLOCKER | 逻辑错误 | 问题${i + 1} | src/a${i}.ets | 修复 |`);
  }
  return [
    '---', 'feature: demo', 'phase: review', '---',
    '# Review',
    '## 审查范围', 'TaskDemo',
    '## 审查方法', '按规则审查',
    '## 问题清单',
    '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 |',
    '|------|---------|------|---------|---------|---------|',
    ...rows,
    '## 问题统计', `BLOCKER: ${blockerCount}`, 'MAJOR: 0', 'MINOR: 0',
    '## 修复建议', '见上',
    '## 结论', verdictLine,
  ].join('\n');
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: 'review context: 缺 review-report.md → missing_review_report',
    run: async () => withTmpProject(async root => {
      const results = await checker.check(ctx(root, { feature: 'demo' }));
      const hit = results.find(r => r.id === 'review_report_exists');
      assertTrue(hit?.failure_kind === 'missing_review_report', '应归因为 missing_review_report');
      assertTrue(hit?.blocking_class === 'review_context', '应标记 review_context');
    }),
  },
  {
    name: 'review context: 缺 contracts/acceptance/source → 输出明确上下文分类',
    run: async () => withTmpProject(async root => {
      writeFile(path.join(root, 'doc', 'features', 'demo', 'review-report.md'), validReport);
      const results = await checker.check(ctx(root, {
        feature: 'demo',
        contracts: {
          feature: 'demo',
          source: 'unit',
          version: '1.0',
          modules: [],
          files: ['02-Feature/Demo/src/main/ets/Missing.ets'],
          module_dependencies: {},
          data_models: [],
          interfaces: [],
          components: [],
        },
      }));
      assertTrue(results.some(r => r.failure_kind === 'missing_acceptance'), '应提示 missing_acceptance');
      assertTrue(results.some(r => r.failure_kind === 'missing_source_from_contracts'), '应提示缺源码');
    }),
  },
  {
    name: 'conclusion: 不通过 + 2 BLOCKER → 自洽 PASS（修复前因子串误读会误判 FAIL）',
    run: async () => withTmpProject(async root => {
      writeFile(
        path.join(root, 'doc', 'features', 'demo', 'review-report.md'),
        reportWith('**审查结论**: 不通过', 2),
      );
      const results = await checker.check(ctx(root, { feature: 'demo' }));
      const hit = results.find(r => r.id === 'conclusion_with_verdict');
      assertTrue(hit?.status === 'PASS', `应 PASS，实际 ${hit?.status}：${hit?.details}`);
    }),
  },
  {
    name: 'conclusion: 通过 + 1 BLOCKER → 真不一致 FAIL（不放过谎报通过）',
    run: async () => withTmpProject(async root => {
      writeFile(
        path.join(root, 'doc', 'features', 'demo', 'review-report.md'),
        reportWith('**审查结论**: 通过', 1),
      );
      const results = await checker.check(ctx(root, { feature: 'demo' }));
      const hit = results.find(r => r.id === 'conclusion_with_verdict');
      assertTrue(hit?.status === 'FAIL', `应 FAIL，实际 ${hit?.status}`);
    }),
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}

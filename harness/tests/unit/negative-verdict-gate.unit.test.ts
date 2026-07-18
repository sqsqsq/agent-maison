// ============================================================================
// negative-verdict-gate.unit.test.ts — blind-visual-hardening d1 切片一
// ============================================================================
// 事故回放（bc-openCard 二轮）：review 终态「审查结论: 不通过」+ 3 BLOCKER，
// conclusion_with_verdict 判"一致→PASS"、conditional_pass_closure 判"不适用→PASS"，
// summary verdict:PASS/closed，ut/testing 照常推进直至「达标可发布」。
// 本套件锁定：①negative_verdict_closure（review 不通过 / testing 不达标 → FAIL）；
// ②上游裁决传播（evaluateUpstreamViews 纯判定 + checkUpstreamVerdictGate I/O 集成）；
// ③verifier PASS 无法洗白（check 签名不消费 verifier 输入）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, receiptDirPath } from '../../config';
import { checkNegativeVerdictClosure } from '../../scripts/check-review';
import { checkNegativeTestingVerdictClosure } from '../../scripts/check-testing';
import {
  checkUpstreamVerdictGate,
  evaluateUpstreamViews,
  type UpstreamPhaseView,
} from '../../scripts/utils/upstream-verdict-gate';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

async function withTmpProject<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neg-verdict-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// 事故派生 fixture：终态「不通过 + 3 BLOCKER」，报告自身完全合法/一致。
const INCIDENT_REVIEW_REPORT = [
  '---', 'feature: bc-openCard', 'phase: review', '---',
  '# Review',
  '## 审查范围', 'WalletMain、Phone',
  '## 审查方法', '按 review-rules 审查',
  '## 问题清单',
  '| 编号 | 严重程度 | 分类 | 问题描述 | 涉及文件 | 修复建议 | 状态 |',
  '|------|---------|------|---------|---------|---------|------|',
  '| CR-001 | BLOCKER | 接口一致性 | initDB 签名与 contracts 不一致 | a.ets | 对齐 | 待修复 |',
  '| CR-002 | BLOCKER | 接口一致性 | @State 声明不一致 | b.ets | 对齐 | 待修复 |',
  '| CR-003 | BLOCKER | 接口一致性 | props 声明不一致 | c.ets | 对齐 | 待修复 |',
  '## 问题统计', 'BLOCKER: 3', 'MAJOR: 4', 'MINOR: 0',
  '## 修复建议', '见问题清单',
  '## 结论',
  '**审查结论**: 不通过',
  '',
  '存在 3 个 BLOCKER 级接口一致性问题。',
  '**判定依据**:',
  '- 判定规则：存在 BLOCKER → 必须判"不通过"',
  '**下一步建议**（按上方审查结论执行）:',
  '- 若结论为"不通过"：修复所有 BLOCKER 后重新审查',
].join('\n');

function reviewReportWithVerdict(verdict: string): string {
  return [
    '## 结论',
    `**审查结论**: ${verdict}`,
    '',
    '**下一步建议**:',
    '- 若结论为"不通过"：修复后重审',
  ].join('\n');
}

function testingReportWithVerdict(verdict: string): string {
  return [
    '## 五、结论',
    `**测试结论**: ${verdict}`,
    '',
    '**下一步建议**（按上方测试结论执行）:',
    '- 若结论为"不达标"：修复后重测',
    '- 若结论为"达标"：功能模块验收完成，可发布',
  ].join('\n');
}

function writeSummary(root: string, feature: string, phase: string, body: unknown): void {
  const dir = path.join(receiptDirPath(root, feature, phase), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(body, null, 2), 'utf-8');
}

function view(partial: Partial<UpstreamPhaseView> & { phase: string }): UpstreamPhaseView {
  return {
    summaryExists: true,
    verdictReadable: true,
    verdict: 'PASS',
    blockerIds: [],
    freshness: 'fresh',
    ...partial,
  };
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  // ---------------- negative_verdict_closure（review）----------------
  {
    name: '事故回放：review「不通过+3 BLOCKER」→ negative_verdict_closure BLOCKER FAIL（verifier PASS 无法洗白——check 签名不消费 verifier 输入）',
    run: () => {
      const [r] = checkNegativeVerdictClosure(INCIDENT_REVIEW_REPORT);
      assertEq(r.status, 'FAIL', 'status');
      assertEq(r.severity, 'BLOCKER', 'severity');
      assertEq(r.failure_kind, 'negative_review_verdict', 'failure_kind');
      assertEq(r.blocking_class, 'product_verdict', 'blocking_class');
    },
  },
  {
    name: 'review 结论=通过 → PASS（门禁不适用）',
    run: () => assertEq(checkNegativeVerdictClosure(reviewReportWithVerdict('通过'))[0].status, 'PASS', '通过'),
  },
  {
    name: 'review 结论=有条件通过 → 本门禁 PASS（该分支归洞⑥ conditional_pass_closure，回归保护）',
    run: () => assertEq(checkNegativeVerdictClosure(reviewReportWithVerdict('有条件通过'))[0].status, 'PASS', '有条件通过'),
  },
  {
    name: 'review 缺可机读声明行 → 本门禁 PASS（缺声明行由 conclusion_with_verdict 拦，语义分层）',
    run: () => {
      const [r] = checkNegativeVerdictClosure('## 结论\n本次审查完成。');
      assertEq(r.status, 'PASS', '缺声明行');
      assertTrue(r.details.includes('conclusion_with_verdict'), '应指明分层职责');
    },
  },

  // ---------------- negative_verdict_closure（testing）----------------
  {
    name: 'testing 结论=不达标 → BLOCKER FAIL',
    run: () => {
      const [r] = checkNegativeTestingVerdictClosure(testingReportWithVerdict('不达标'));
      assertEq(r.status, 'FAIL', 'status');
      assertEq(r.failure_kind, 'negative_testing_verdict', 'failure_kind');
    },
  },
  {
    name: 'testing 结论=达标（下一步建议含"若结论为不达标"诱饵）→ PASS',
    run: () => assertEq(checkNegativeTestingVerdictClosure(testingReportWithVerdict('达标'))[0].status, 'PASS', '达标'),
  },
  {
    name: 'testing 报告缺失 → SKIP（存在性归其他门禁）',
    run: () => assertEq(checkNegativeTestingVerdictClosure(null)[0].status, 'SKIP', 'null 报告'),
  },

  // ---------------- evaluateUpstreamViews（纯判定）----------------
  {
    name: '上游未跑（summary 不存在）→ 无违例（该跑没跑归 receipt/goal preflight 链）',
    run: () => assertEq(evaluateUpstreamViews([view({ phase: 'review', summaryExists: false })]).length, 0, '未跑'),
  },
  {
    name: '上游 verdict=FAIL → 违例',
    run: () => {
      const v = evaluateUpstreamViews([view({ phase: 'review', verdict: 'FAIL' })]);
      assertEq(v.length, 1, '违例数');
      assertTrue(v[0].reason.includes('FAIL'), '原因含 FAIL');
    },
  },
  {
    name: '上游 verdict=PASS 但 blockers 未清 → 违例（防形状洗白）',
    run: () => assertEq(
      evaluateUpstreamViews([view({ phase: 'review', blockerIds: ['negative_verdict_closure'] })]).length,
      1, 'blocker 未清',
    ),
  },
  {
    name: '上游 summary 存在但 verdict 不可读 → 违例（机器裁决缺失即不可信）',
    run: () => assertEq(
      evaluateUpstreamViews([view({ phase: 'coding', verdictReadable: false, verdict: null })]).length,
      1, '不可读',
    ),
  },
  {
    name: '上游 PASS+fresh → 无违例；PASS+stale → 违例；PASS+no_manifest（legacy 现场）→ 无违例',
    run: () => {
      assertEq(evaluateUpstreamViews([view({ phase: 'coding' })]).length, 0, 'fresh');
      assertEq(evaluateUpstreamViews([view({ phase: 'coding', freshness: 'stale' })]).length, 1, 'stale');
      assertEq(evaluateUpstreamViews([view({ phase: 'coding', freshness: 'tampered' })]).length, 1, 'tampered');
      assertEq(evaluateUpstreamViews([view({ phase: 'coding', freshness: 'no_manifest' })]).length, 0, 'no_manifest');
    },
  },

  // ---------------- checkUpstreamVerdictGate（I/O 集成）----------------
  {
    name: '集成：review summary=FAIL（negative gate 产物）→ ut 启动被 BLOCKER FAIL 并点名 review',
    run: async () => withTmpProject(async root => {
      writeSummary(root, 'demo', 'review', {
        schema_version: '1.0', phase: 'review', feature: 'demo',
        verdict: 'FAIL', blocker_count: 1,
        blockers: [{ id: 'negative_verdict_closure', details_excerpt: '不通过' }],
      });
      const [r] = checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'ut' });
      assertEq(r.status, 'FAIL', 'status');
      assertTrue(r.details.includes('[review]'), '点名 review');
      assertEq(r.failure_kind, 'upstream_negative_verdict', 'failure_kind');
    }),
  },
  {
    name: '集成：上游全 PASS 无 blocker（无 manifest 的 legacy 现场）→ PASS 且列出已消费/未跑阶段',
    run: async () => withTmpProject(async root => {
      writeSummary(root, 'demo', 'review', {
        schema_version: '1.0', phase: 'review', feature: 'demo',
        verdict: 'PASS', blocker_count: 0, blockers: [],
      });
      const [r] = checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'ut' });
      assertEq(r.status, 'PASS', 'status');
      assertTrue(r.details.includes('review'), '已消费列出 review');
    }),
  },
  {
    name: '集成：summary JSON 损坏 → FAIL（不可解析=机器裁决缺失）',
    run: async () => withTmpProject(async root => {
      const dir = path.join(receiptDirPath(root, 'demo', 'review'), 'reports');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'summary.json'), '{ not json', 'utf-8');
      const [r] = checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'testing' });
      assertEq(r.status, 'FAIL', 'status');
    }),
  },
  {
    name: '集成：链首 phase（spec）无上游 → 不产结果（零噪声）',
    run: async () => withTmpProject(async root => {
      assertEq(checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'spec' }).length, 0, 'spec 无上游');
    }),
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return (async () => {
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
  })();
}

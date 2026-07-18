// ============================================================================
// quality-axes.unit.test.ts — summary 1.1 多轴裁决（blind-visual-hardening d1 切片二）
// ============================================================================
// 锁定：①轴派生（含外部阻塞 oracle 复用/不适用轴 FAIL 重映射/盲档 UNVERIFIED）；
// ②双投影分立（advance vs release）与 legacy verdict 等价性；③schema 不变量；
// ④report_validity 与产品裁决分离；⑤completion 消费面（legacy 1.0 拒绝 +
// visual UNVERIFIED→needs_human 封顶）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  deriveQualityAxes,
  deriveReportValidity,
  deriveSummaryVerdictLattice,
  mapCheckToAxis,
  projectPhaseAdvanceVerdict,
  validateQualityAxes,
} from '../../scripts/utils/quality-axes';
import { resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import { collectCleanPassIssues } from '../../scripts/utils/verify-feature-completion';
import { clearFrameworkConfigCache, receiptDirPath } from '../../config';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import type { CheckResult } from '../../scripts/utils/types';

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

function chk(partial: Partial<CheckResult> & { id: string }): CheckResult {
  return {
    category: 'structure',
    description: partial.id,
    severity: 'BLOCKER',
    status: 'PASS',
    details: '',
    ...partial,
  } as CheckResult;
}

const UI_OPTS = { phase: 'testing', visualApplicable: true, assetApplicable: true } as const;
const NON_UI_OPTS = { phase: 'testing', visualApplicable: false, assetApplicable: false } as const;

async function withTmpProject<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-axes-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'mapCheckToAxis：asset 先于 visual 前缀匹配（visual_parity_unverified_crop→asset），未知→functional',
    run: () => {
      assertEq(mapCheckToAxis('visual_parity_unverified_crop'), 'asset', 'unverified_crop');
      assertEq(mapCheckToAxis('visual_diff'), 'visual', 'visual_diff');
      assertEq(mapCheckToAxis('device_test_run'), 'evidence', 'device_test_run');
      assertEq(mapCheckToAxis('coding_compile'), 'functional', 'fallback');
    },
  },
  {
    name: '全绿（UI feature，各轴有执行）→ 四轴 PASS / advance PASS / release READY / COMPLETE',
    run: () => {
      const checks = [
        chk({ id: 'coding_compile' }),
        chk({ id: 'visual_diff' }),
        chk({ id: 'asset_materialization_sanity' }),
        chk({ id: 'device_test_run' }),
      ];
      const l = deriveSummaryVerdictLattice(checks, UI_OPTS);
      assertEq(l.quality_axes.functional.verdict, 'PASS', 'functional');
      assertEq(l.quality_axes.visual.verdict, 'PASS', 'visual');
      assertEq(l.quality_axes.asset.verdict, 'PASS', 'asset');
      assertEq(l.quality_axes.evidence.verdict, 'PASS', 'evidence');
      assertEq(l.projected_verdict, 'PASS', 'advance');
      assertEq(l.release_readiness, 'READY', 'release');
      assertEq(l.completion_status, 'COMPLETE', 'completion');
    },
  },
  {
    name: '非外部 BLOCKER FAIL → 轴 FAIL(needs_fix, retry=当前 phase) / advance FAIL / INCOMPLETE 标签',
    run: () => {
      const checks = [chk({ id: 'coding_compile', status: 'FAIL' }), chk({ id: 'visual_diff' })];
      const l = deriveSummaryVerdictLattice(checks, UI_OPTS);
      assertEq(l.quality_axes.functional.verdict, 'FAIL', 'functional FAIL');
      assertEq(l.quality_axes.functional.resolution?.class, 'needs_fix', 'needs_fix');
      assertEq(l.quality_axes.functional.resolution?.retry_phase, 'testing', 'retry_phase');
      assertEq(l.projected_verdict, 'FAIL', 'advance');
      assertEq(l.completion_status, 'INCOMPLETE', 'completion');
    },
  },
  {
    name: '外部阻塞（device install externalBlocked 为唯一 blocker）→ evidence UNVERIFIED(external) / advance INCOMPLETE（与 legacy oracle 等价）',
    run: () => {
      const checks = [
        chk({ id: 'device_test_build', status: 'PASS' }),
        chk({ id: 'device_test_install', status: 'FAIL', blocking_class: 'externalBlocked' }),
        chk({ id: 'coding_compile' }),
      ];
      assertEq(resolveVerdictFromChecks(checks), 'INCOMPLETE', 'oracle 前提');
      const l = deriveSummaryVerdictLattice(checks, UI_OPTS);
      assertEq(l.quality_axes.evidence.verdict, 'UNVERIFIED', 'evidence UNVERIFIED');
      assertEq(l.quality_axes.evidence.resolution?.class, 'external_dependency', 'external');
      assertEq(l.projected_verdict, 'INCOMPLETE', 'advance INCOMPLETE');
    },
  },
  {
    name: '盲档形状：visual applicable 但视觉检查全 SKIP → visual UNVERIFIED(needs_human)；advance PASS（不挡推进）；release BLOCKED；VISUAL_PENDING 标签',
    run: () => {
      const checks = [
        chk({ id: 'coding_compile' }),
        chk({ id: 'visual_diff', status: 'SKIP', severity: 'MINOR' }),
        chk({ id: 'visual_parity', status: 'SKIP', severity: 'MINOR' }),
      ];
      const l = deriveSummaryVerdictLattice(checks, { ...UI_OPTS, assetApplicable: false });
      assertEq(l.quality_axes.visual.verdict, 'UNVERIFIED', 'visual UNVERIFIED');
      assertEq(l.quality_axes.visual.resolution?.class, 'needs_human', 'needs_human');
      assertEq(l.projected_verdict, 'PASS', 'advance 不受 visual UNVERIFIED 阻断');
      assertEq(l.release_readiness, 'BLOCKED', 'release BLOCKED');
      assertEq(l.completion_status, 'FUNCTIONALLY_COMPLETE_VISUAL_PENDING', '标签');
    },
  },
  {
    name: '不适用轴安全网：visualApplicable=false 时 visual_diff FAIL 重映射 functional（阻断不丢失）',
    run: () => {
      const checks = [chk({ id: 'visual_diff', status: 'FAIL' })];
      const axes = deriveQualityAxes(checks, NON_UI_OPTS);
      assertEq(axes.visual.verdict, 'NOT_APPLICABLE', 'visual NA');
      assertEq(axes.functional.verdict, 'FAIL', 'functional 承接 FAIL');
      assertEq(projectPhaseAdvanceVerdict(axes, 'testing'), 'FAIL', 'advance FAIL');
    },
  },
  {
    name: 'evidence 轴数据驱动降解：无任何 evidence 检查执行 → NOT_APPLICABLE（不造假 UNVERIFIED）',
    run: () => {
      const axes = deriveQualityAxes([chk({ id: 'coding_compile' })], { phase: 'coding', visualApplicable: false, assetApplicable: false });
      assertEq(axes.evidence.verdict, 'NOT_APPLICABLE', 'evidence NA');
    },
  },
  {
    name: '等价性：projected_verdict ≡ resolveVerdictFromChecks（PASS/FAIL/外部 INCOMPLETE 三形态）',
    run: () => {
      const shapes: CheckResult[][] = [
        [chk({ id: 'a' }), chk({ id: 'visual_diff' })],
        [chk({ id: 'a', status: 'FAIL' })],
        [
          chk({ id: 'device_test_build' }),
          chk({ id: 'device_test_install', status: 'FAIL', failure_kind: 'device_blocked' }),
        ],
        [
          chk({ id: 'device_test_build' }),
          chk({ id: 'device_test_install', status: 'FAIL', blocking_class: 'externalBlocked' }),
          chk({ id: 'other', status: 'FAIL' }), // 混合：外部+真失败 → FAIL
        ],
      ];
      for (const checks of shapes) {
        const l = deriveSummaryVerdictLattice(checks, UI_OPTS);
        assertEq(l.projected_verdict, resolveVerdictFromChecks(checks), `等价性 ${checks.map(c => c.id).join(',')}`);
      }
    },
  },
  {
    name: 'schema 不变量：合法轴通过；applicable=false⇒NOT_APPLICABLE；负面裁决⇒resolution 必填；PASS⇒resolution=null',
    run: () => {
      const good = deriveQualityAxes([chk({ id: 'a' })], NON_UI_OPTS);
      assertEq(validateQualityAxes(good).length, 0, '派生产物应过不变量');
      const bad1 = { ...good, visual: { ...good.visual, applicable: false, verdict: 'PASS' } };
      assertTrue(validateQualityAxes(bad1).some(e => e.includes('NOT_APPLICABLE')), 'bad1');
      const bad2 = { ...good, functional: { ...good.functional, verdict: 'FAIL', resolution: null } };
      assertTrue(validateQualityAxes(bad2).some(e => e.includes('resolution 必填')), 'bad2');
      const bad3 = { ...good, functional: { ...good.functional, verdict: 'PASS', resolution: { class: 'needs_fix', owner: 'agent', retry_phase: null } } };
      assertTrue(validateQualityAxes(bad3).some(e => e.includes('resolution 须为 null')), 'bad3');
    },
  },
  {
    name: 'report_validity 独立于产品裁决：结论检查 FAIL→FAIL；全 SKIP→UNVERIFIED；正常→PASS（产品 blocker 不影响它）',
    run: () => {
      assertEq(
        deriveReportValidity([chk({ id: 'conclusion_with_verdict', status: 'FAIL' }), chk({ id: 'coding_compile' })]),
        'FAIL', '结论检查 FAIL',
      );
      assertEq(
        deriveReportValidity([chk({ id: 'conclusion_with_verdict', status: 'SKIP' })]),
        'UNVERIFIED', '全 SKIP',
      );
      assertEq(
        deriveReportValidity([chk({ id: 'conclusion_with_verdict' }), chk({ id: 'negative_verdict_closure', status: 'FAIL' })]),
        'PASS', '产品负面裁决不污染 report_validity（语义分离）',
      );
    },
  },
  {
    name: 'completion 消费面：legacy 1.0 summary → summary_schema_current(needs_fix)（历史假 PASS 不重入）',
    run: async () => withTmpProject(async root => {
      const p = path.join(receiptDirPath(root, 'demo', 'review'), 'reports', 'summary.json');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ schema_version: '1.0', verdict: 'PASS' }), 'utf-8');
      const issues = collectCleanPassIssues({ projectRoot: root, feature: 'demo', chain: ['review'] });
      const hit = issues.find(i => i.condition === 'summary_schema_current');
      assertTrue(hit !== undefined, '应有 summary_schema_current 违例');
      assertEq(hit!.kind, 'needs_fix', 'needs_fix');
    }),
  },
  {
    name: 'completion 消费面：1.1 + visual UNVERIFIED(needs_human) → quality_axis_verified(needs_human) 封顶求人',
    run: async () => withTmpProject(async root => {
      const p = path.join(receiptDirPath(root, 'demo', 'testing'), 'reports', 'summary.json');
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({
        schema_version: '1.1',
        verdict: 'PASS',
        report_validity: 'PASS',
        release_readiness: 'BLOCKED',
        completion_status: 'FUNCTIONALLY_COMPLETE_VISUAL_PENDING',
        quality_axes: {
          functional: { applicable: true, required_for_release: true, verdict: 'PASS', blocking_class: null, source_checks: [], resolution: null },
          visual: {
            applicable: true, required_for_release: true, verdict: 'UNVERIFIED',
            blocking_class: 'needs_human', source_checks: ['visual_diff'],
            resolution: { class: 'needs_human', owner: 'human', retry_phase: null },
          },
          asset: { applicable: false, required_for_release: false, verdict: 'NOT_APPLICABLE', blocking_class: null, source_checks: [], resolution: null },
          evidence: { applicable: false, required_for_release: false, verdict: 'NOT_APPLICABLE', blocking_class: null, source_checks: [], resolution: null },
        },
      }), 'utf-8');
      const issues = collectCleanPassIssues({ projectRoot: root, feature: 'demo', chain: ['testing'] });
      const hit = issues.find(i => i.condition === 'quality_axis_verified');
      assertTrue(hit !== undefined, '应有 quality_axis_verified 违例');
      assertEq(hit!.kind, 'needs_human', 'needs_human（封顶 AWAITING_HUMAN_REVIEW，非 FAIL）');
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

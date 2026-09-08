// ============================================================================
// harness-runner-asset-inheritance.unit.test.ts — plan a3f7c1d9 V1 / V11
// ----------------------------------------------------------------------------
// V1：consumer 布局下 resolveAssetAxisInheritance 的五指纹 I/O 面——coding summary
//     gate_fingerprint 与当前重算一致 + review attestation 对账 ok + 无 open asset 债务
//     → provenanceIntact=true，apply 后 testing asset PASS；gate_fingerprint 改一位 → 漂移。
//     （修复前：detectRepoLayout(projectRoot) 恒抛 → "重算异常"；:1602 恒 push 7.2b 缺证。）
// V11：applyVisualDebtPipeline 只在 testing 期压 visual 轴；coding 期有 open 债务不压。
// R1 返修（SKIP 裁定）：盲档混合结果 runtime_mount_conformance PASS + visual_diff BLOCKER SKIP
//     → 非 MINOR SKIP 开账 → testing 期 visual 压 UNVERIFIED、release BLOCKED（三态下曾得 READY）。
// R2 返修 D3(e)：render_visibility_calibrate 缺陷以 MAJOR FAIL 表达——phase verdict 仍 PASS、blockers 空，
//     账本逐屏开账 → testing 期 visual UNVERIFIED、release BLOCKED；coding 期不压轴。
// R3 返修（on_violation 契约）：MAJOR FAIL 进 violations（harness-runner.ts:1082 谓词）→ on_violation 派发一次；
//     本仓 harness/ 与 profiles/hmos-app 未注册任何 on_violation hook → 返回空 → verdict PASS、blockers 空。
//     emitLifecycle 是 runner 主流程内闭包（:978）无法单测，故走它唯一委托的 dispatchLifecycleHooks。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyVisualDebtPipeline, resolveAssetAxisInheritance } from '../../harness-runner';
import { collectHookSlots, dispatchLifecycleHooks } from '../../hooks-dispatcher';
import { clearFrameworkConfigCache, receiptDirPath } from '../../config';
import { writeReviewClosureAttestation } from '../../scripts/utils/closure-attestation';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { applyAssetAxisInheritance, deriveSummaryVerdictLattice } from '../../scripts/utils/quality-axes';
import { resolveVerdictFromChecks } from '../../scripts/utils/report-generator';
import { buildSummaryBlockers } from '../../scripts/utils/summary-blockers';
import { countBlockingDebt, deriveVisualDebt, loadVisualDebt, writeVisualDebt } from '../../scripts/utils/visual-debt';
import type { CheckResult, HarnessResolvedProfile, Phase, ScriptReport } from '../../scripts/utils/types';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FEATURE = 'asset-inherit-fixture';

function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-inherit-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearFrameworkConfigCache();
  }
}

function chk(id: string, status: CheckResult['status'] = 'PASS', severity: CheckResult['severity'] = 'BLOCKER'): CheckResult {
  return { id, category: 'structure', description: id, severity, status, details: '' } as CheckResult;
}

/** consumer 布局的最小 framework 树：rules yaml + package.json（gate fingerprint 的两个输入） */
function seedConsumerFramework(root: string): string {
  const frameworkRoot = path.join(root, 'framework');
  fs.mkdirSync(path.join(frameworkRoot, 'specs', 'phase-rules'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'specs', 'phase-rules', 'coding-rules.yaml'), 'phase: coding\nchecks: []\n', 'utf-8');
  fs.writeFileSync(path.join(frameworkRoot, 'package.json'), JSON.stringify({ name: 'agent-maison', version: '3.0.0' }), 'utf-8');
  return frameworkRoot;
}

function writeCodingSummary(root: string, gateFingerprint: string | null): void {
  const p = path.join(receiptDirPath(root, FEATURE, 'coding'), 'reports', 'summary.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    schema_version: '1.2',
    verdict: 'PASS',
    gate_fingerprint: gateFingerprint,
    quality_axes: { asset: { applicable: true, verdict: 'PASS' } },
    asset_debt_revision: 'no-debt',
  }, null, 2), 'utf-8');
}

function minimalReport(phase: Phase, root: string, checks: CheckResult[]): ScriptReport {
  return {
    phase, feature: FEATURE, timestamp: '2026-09-08T00:00:00.000Z', project_root: root,
    assurance: 'full', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
    checks,
    summary: { total: checks.length, pass: checks.length, fail: 0, warn: 0, skip: 0, blockers: 0, verdict: 'PASS' },
  } as ScriptReport;
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'V1 consumer 布局五指纹一致 → provenanceIntact=true，apply 后 testing asset PASS（证据引用）；gate_fingerprint 改一位 → 漂移 STALE',
    run: () => withTmpProject(root => {
      const frameworkRoot = seedConsumerFramework(root);
      const fp = computeGateFingerprint(frameworkRoot, 'coding');
      assertTrue(Boolean(fp), '构造性前提：consumer framework 树能算出 coding gate fingerprint');
      writeCodingSummary(root, fp);
      // review 闭环 attestation（无产品源码根：inventory 空集 ok，aggregate 仍在）
      writeReviewClosureAttestation({ projectRoot: root, feature: FEATURE, expectProductSources: false });

      const inh = resolveAssetAxisInheritance(root, FEATURE);
      assertTrue(inh !== null, 'coding summary 可得 → 非 null');
      assertEq(inh!.provenanceIntact, true, `五指纹一致（detail=${inh!.provenanceDetail}）`);
      assertEq(inh!.provenanceDetail, 'ok', 'detail=ok（不再有 7.2b 缺证 / 重算异常）');
      assertEq(inh!.upstreamVerdict, 'PASS', '上游 PASS');
      assertTrue(inh!.evidenceRefs.some(r => r.startsWith('summary:')), 'summary hash 引用');
      assertTrue(inh!.evidenceRefs.some(r => r.startsWith('inventory:')), 'inventory aggregate 引用');
      assertTrue(inh!.evidenceRefs.includes('debt:no-debt'), 'debt revision 引用');

      // testing 期：asset 零检查面（D1(c) 保留继承入口）→ apply → PASS
      const lattice = deriveSummaryVerdictLattice([chk('visual_diff')], { phase: 'testing', visualApplicable: true, assetApplicable: true });
      assertEq(lattice.quality_axes.asset.verdict, 'UNVERIFIED', '继承前 testing asset 零映射 UNVERIFIED');
      applyAssetAxisInheritance(lattice.quality_axes, inh!);
      assertEq(lattice.quality_axes.asset.verdict, 'PASS', '继承后 PASS');
      assertTrue(lattice.quality_axes.asset.source_checks.every(s => s.startsWith('inherited:coding:')), '证据引用形态');

      // 反例：gate_fingerprint 改一位 → 规则面漂移 → 不继承
      writeCodingSummary(root, fp!.slice(0, -1) + (fp!.endsWith('0') ? '1' : '0'));
      const drift = resolveAssetAxisInheritance(root, FEATURE);
      assertTrue(drift !== null && drift.provenanceIntact === false, '漂移 → provenanceIntact=false');
      assertTrue(/漂移/.test(drift!.provenanceDetail), `detail 点名漂移：${drift!.provenanceDetail}`);
      const stale = deriveSummaryVerdictLattice([chk('visual_diff')], { phase: 'testing', visualApplicable: true, assetApplicable: true });
      applyAssetAxisInheritance(stale.quality_axes, drift!);
      assertEq(stale.quality_axes.asset.verdict, 'STALE', '漂移继承 STALE');
    }),
  },
  {
    name: 'V1b 缺 review attestation → 不继承（fail-closed 不变）',
    run: () => withTmpProject(root => {
      const frameworkRoot = seedConsumerFramework(root);
      writeCodingSummary(root, computeGateFingerprint(frameworkRoot, 'coding'));
      const inh = resolveAssetAxisInheritance(root, FEATURE);
      assertTrue(inh !== null && inh.provenanceIntact === false, '缺 attestation 不继承');
      assertTrue(/attestation/.test(inh!.provenanceDetail), inh!.provenanceDetail);
    }),
  },
  {
    name: 'V11 债务压轴只在 testing：coding 期有 open 债务 visual 仍 PASS；testing 期压 UNVERIFIED(needs_fix, retry=testing)',
    run: () => withTmpProject(root => {
      // 历史 open 债务（来源 check 本轮缺席 → 单调保留）
      writeVisualDebt(root, {
        schema_version: '1.0', feature: FEATURE,
        entries: [{ id: 'debt:render_visibility_calibrate', source_check_id: 'render_visibility_calibrate', severity: 'MAJOR', summary: 'x', status: 'open', resolution_class: 'needs_fix' }],
      });
      const checks = [chk('coding_compile'), chk('visual_parity')]; // functional + visual 各有执行 → 压轴前 release READY
      const opts = { visualApplicable: true, assetApplicable: false } as const;

      const coding = deriveSummaryVerdictLattice(checks, { phase: 'coding', ...opts });
      applyVisualDebtPipeline(root, minimalReport('coding', root, checks), coding);
      assertEq(coding.quality_axes.visual.verdict, 'PASS', 'coding 期不压轴');
      assertEq(coding.release_readiness, 'READY', 'coding 期 release 不因 testing 遗留债务 BLOCKED');
      assertEq(loadVisualDebt(root, FEATURE)!.entries[0].status, 'open', '账本仍每阶段写入（历史 open 保留）');

      const testing = deriveSummaryVerdictLattice(checks, { phase: 'testing', ...opts });
      applyVisualDebtPipeline(root, minimalReport('testing', root, checks), testing);
      assertEq(testing.quality_axes.visual.verdict, 'UNVERIFIED', 'testing 期压 UNVERIFIED');
      assertEq(testing.quality_axes.visual.blocking_class, 'needs_fix', 'needs_fix');
      assertEq(testing.quality_axes.visual.resolution?.retry_phase, 'testing', 'retry_phase=testing');
      assertEq(testing.release_readiness, 'BLOCKED', 'testing 期 release BLOCKED');
    }),
  },
  {
    name: 'R1 返修 盲档混合回归：runtime_mount_conformance PASS + visual_diff BLOCKER SKIP（无历史）→ 账本 open≥1 → testing visual UNVERIFIED、release BLOCKED',
    run: () => withTmpProject(root => {
      // coding_compile PASS 只为让 functional 轴有执行面（否则 release 已因 functional UNVERIFIED 而 BLOCKED，看不出账本作用）
      const checks = [chk('coding_compile'), chk('runtime_mount_conformance', 'PASS', 'MAJOR'), chk('visual_diff', 'SKIP', 'BLOCKER')];
      const ledger = deriveVisualDebt(FEATURE, checks, null);
      assertTrue(countBlockingDebt(ledger).open >= 1, `非 MINOR SKIP 须开账：${JSON.stringify(ledger.entries)}`);
      const testing = deriveSummaryVerdictLattice(checks, { phase: 'testing', visualApplicable: true, assetApplicable: false });
      assertEq(testing.quality_axes.visual.verdict, 'PASS', '构造性前提：mount PASS 令 visual 轴 PASS（盲档 SKIP 单靠能力投影不阻断）');
      assertEq(testing.release_readiness, 'READY', '构造性前提：压轴前 release READY——账本是唯一阻断');
      applyVisualDebtPipeline(root, minimalReport('testing', root, checks), testing);
      assertTrue(countBlockingDebt(loadVisualDebt(root, FEATURE)).open >= 1, '账本落盘 open≥1');
      assertEq(testing.quality_axes.visual.verdict, 'UNVERIFIED', 'testing 期 visual 压 UNVERIFIED');
      assertEq(testing.quality_axes.visual.blocking_class, 'needs_fix', 'needs_fix');
      assertEq(testing.release_readiness, 'BLOCKED', 'release BLOCKED');
    }),
  },
  {
    name: 'R2 D3(e) 完整链：render_visibility_calibrate MAJOR FAIL → verdict PASS、blockers 空、账本逐屏 open → testing visual UNVERIFIED、release BLOCKED；coding 不压',
    run: () => withTmpProject(root => {
      const calibrate = {
        ...chk('render_visibility_calibrate', 'FAIL', 'MAJOR'),
        structured: { kind: 'render_visibility', threshold_version: 'x', findings: [{ screen: 's1' }, { screen: 's2' }] },
      } as CheckResult;
      const checks = [chk('coding_compile'), chk('runtime_mount_conformance', 'PASS', 'MAJOR'), calibrate];
      assertEq(resolveVerdictFromChecks(checks), 'PASS', 'MAJOR FAIL 不计入 phase verdict');
      assertEq(buildSummaryBlockers(checks, (text: string) => text, () => undefined).length, 0, 'MAJOR FAIL 不入 blockers');
      const ledger = deriveVisualDebt(FEATURE, checks, null);
      assertTrue(ledger.entries.some(e => e.id === 'debt:render_visibility_calibrate:s1' && e.status === 'open'), 's1 逐屏开账');
      assertEq(countBlockingDebt(ledger).open, 2, '两屏两条 open');

      const testing = deriveSummaryVerdictLattice(checks, { phase: 'testing', visualApplicable: true, assetApplicable: false });
      assertEq(testing.quality_axes.visual.verdict, 'PASS', '构造性前提：MAJOR FAIL 不进 hardFails，压轴前 visual PASS');
      assertEq(testing.release_readiness, 'READY', '构造性前提：压轴前 release READY——账本是唯一阻断');
      applyVisualDebtPipeline(root, minimalReport('testing', root, checks), testing);
      assertEq(countBlockingDebt(loadVisualDebt(root, FEATURE)).open, 2, '账本落盘 open=2');
      assertEq(testing.quality_axes.visual.verdict, 'UNVERIFIED', 'testing 期 visual 压 UNVERIFIED');
      assertEq(testing.quality_axes.visual.blocking_class, 'needs_fix', 'needs_fix');
      assertEq(testing.release_readiness, 'BLOCKED', 'release BLOCKED');

      // coding 期同一结果：账本照写、不压轴（D3(d) 不变）
      const coding = deriveSummaryVerdictLattice(checks, { phase: 'coding', visualApplicable: true, assetApplicable: false });
      applyVisualDebtPipeline(root, minimalReport('coding', root, checks), coding);
      assertEq(coding.quality_axes.visual.verdict, 'PASS', 'coding 期不压轴');
      assertEq(coding.release_readiness, 'READY', 'coding 期 release 不阻断');
    }),
  },
  {
    name: 'R3 on_violation 契约：render_visibility_calibrate MAJOR FAIL 进 violations、on_violation 派发一次；本仓/hmos-app 未注册 hook → 返回空、verdict PASS、blockers 空',
    run: async () => {
      // 指向真实仓库的 harness/ 与 profiles/hmos-app：任何人注册 on_violation hook 即本用例红，
      // 须同步更新 §3 D3(e)"当前无行为差异"的声明。
      const harnessRoot = path.resolve(__dirname, '..', '..');
      const profileDir = path.resolve(harnessRoot, '..', 'profiles', 'hmos-app');
      assertTrue(fs.existsSync(path.join(profileDir, 'profile.yaml')), '构造性前提：hmos-app profile 在仓');
      const resolved: HarnessResolvedProfile = {
        name: 'hmos-app', profileDir, yaml: { name: 'hmos-app' }, phasesDisabled: new Set(), capabilities: {}, personalPrerequisites: {},
      };
      const checks: CheckResult[] = [chk('coding_compile'), chk('runtime_mount_conformance', 'PASS', 'MAJOR'), chk('render_visibility_calibrate', 'FAIL', 'MAJOR')];
      // 与 harness-runner.ts:1082 逐字相同的谓词
      const violations = checks.filter(c => c.status === 'FAIL' && (c.severity === 'BLOCKER' || c.severity === 'MAJOR'));
      assertEq(violations.length, 1, 'MAJOR FAIL 进 violations（契约：BLOCKER/MAJOR 触发）');
      assertEq(violations[0].id, 'render_visibility_calibrate', 'violations 含 calibrate');
      assertEq(collectHookSlots(harnessRoot, 'testing', 'on_violation', resolved).length, 0, '本仓 framework/profile 层未注册 on_violation hook');
      let dispatched = 0;
      for (const v of violations) {
        dispatched += 1;
        const { hookCheckResults, promptFragments } = await dispatchLifecycleHooks(harnessRoot, 'on_violation', {
          projectRoot: harnessRoot, phase: 'testing', feature: FEATURE, resolvedProfileName: resolved.name, hookEvent: 'on_violation',
          violation: { ruleId: v.id, severity: v.severity, details: v.details ?? '' },
        }, resolved, { enabled: true, timeoutMs: 30000 });
        assertEq(hookCheckResults.length, 0, '无注册 hook → 返回空 CheckResult');
        assertEq(promptFragments.length, 0, '无 prompt 片段');
        checks.push(...hookCheckResults);
      }
      assertEq(dispatched, 1, 'on_violation 派发一次');
      assertEq(resolveVerdictFromChecks(checks), 'PASS', '并入 hook 结果后 verdict 仍 PASS');
      assertEq(buildSummaryBlockers(checks, (text: string) => text, () => undefined).length, 0, 'blockers 空');
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: `harness-runner-asset-inheritance: ${c.name}`, ok: true });
    } catch (err) {
      results.push({ name: `harness-runner-asset-inheritance: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}

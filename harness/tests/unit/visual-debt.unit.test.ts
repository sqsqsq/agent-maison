// ============================================================================
// visual-debt.unit.test.ts — blind-visual-hardening d4/d5 / P0-D
// ============================================================================
// 锁定：①债务派生（源 check WARN/FAIL/BLOCKER-SKIP → open；转绿 → closed；accepted 保持）；
// ②验收清偿边界（needs_fix 拒清 / rubric 冻结阈值：1-2 拒、3 须 accepted_debt_id、≥4 过 /
//   screens 结构化绑定：配对哈希调序即变）；③accepted≠closed 审计分立；
// ④fidelity 意图前置闸（强意图+盲→FAIL；receipt→WARN；非盲/none→PASS；intent 落盘）；
// ⑤披露门禁（有债务结论未提「视觉债务」→FAIL）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  RUBRIC_VERSION,
  applyVisualAcceptance,
  countBlockingDebt,
  deriveVisualDebt,
  screensMatrixHash,
  validateRubricPolicy,
  type VisualAcceptancePayload,
  type VisualDebtDoc,
} from '../../scripts/utils/visual-debt';
import { checkFidelityCapabilityPregate } from '../../scripts/check-spec';
import { checkVisualDebtDisclosure } from '../../scripts/check-testing';
import { evaluateFidelityTierPreflight, initializeFidelityRouting } from '../../scripts/utils/goal-preflight';
import {
  loadFidelityIntentSsot,
  resolveFidelityRoutingDecision,
  writeCapabilitySnapshot,
  writeFidelityIntentSsot,
} from '../../scripts/utils/fidelity-shared';
import { buildCapabilityBlock, resolvePhaseCapabilityAdvisory } from '../../scripts/goal-runner';
import { generateGoalReportJson, writeGoalReport } from '../../scripts/utils/goal-report-generator';
import { phaseInitDecision } from '../../scripts/fidelity-intent-init';
import { loadResolvedProfile } from '../../profile-loader';
import { loadFrameworkConfig } from '../../config';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { clearFrameworkConfigCache, featureFilePath, featureDir, receiptDirPath } from '../../config';
import { ensureConsumerFrameworkTree } from '../utils/layout-test-helper';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdebt-'));
  ensureConsumerFrameworkTree(dir);
  clearFrameworkConfigCache();
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearFrameworkConfigCache();
  }
}

function chk(id: string, status: CheckResult['status'], severity: CheckResult['severity'] = 'MAJOR'): {
  id: string; status: CheckResult['status']; severity: CheckResult['severity']; details: string;
} {
  return { id, status, severity, details: '' };
}

function payload(overrides?: Partial<VisualAcceptancePayload>): VisualAcceptancePayload {
  return {
    rubric_version: RUBRIC_VERSION,
    rubric: { container: 4, hierarchy: 5, density: 4, state_color: 4 },
    screens: [{ screen_id: 's1', variant: 'default', reference_sha256: 'a'.repeat(64), actual_sha256: 'b'.repeat(64) }],
    accepted_debt_ids: [],
    signed_by: '张工',
    ...overrides,
  };
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: '派生：WARN 源→open(needs_human)；FAIL 源→open(needs_fix)；PASS 源无债务',
    run: () => {
      const doc = deriveVisualDebt('demo', [
        chk('visual_parity_unverified_crop', 'WARN'),
        chk('asset_materialization_sanity', 'FAIL', 'BLOCKER'),
        chk('visual_diff', 'PASS'),
      ], null);
      const crop = doc.entries.find(e => e.source_check_id === 'visual_parity_unverified_crop')!;
      assertEq(crop.status, 'open', 'crop open');
      assertEq(crop.resolution_class, 'needs_human', 'crop needs_human');
      const sanity = doc.entries.find(e => e.source_check_id === 'asset_materialization_sanity')!;
      assertEq(sanity.resolution_class, 'needs_fix', 'sanity needs_fix');
      assertTrue(!doc.entries.some(e => e.source_check_id === 'visual_diff'), 'PASS 源无债务');
    },
  },
  {
    name: '派生迁移：源 check 转绿 → closed（审计保留）；accepted 且仍未绿 → 保持 accepted',
    run: () => {
      const prev: VisualDebtDoc = {
        schema_version: '1.0', feature: 'demo',
        entries: [
          { id: 'debt:visual_parity_unverified_crop', source_check_id: 'visual_parity_unverified_crop', severity: 'MAJOR', summary: 'x', status: 'accepted', resolution_class: 'needs_human', accepted_by: '张工' },
          { id: 'debt:visual_diff', source_check_id: 'visual_diff', severity: 'MAJOR', summary: 'y', status: 'open', resolution_class: 'needs_human' },
        ],
      };
      const doc = deriveVisualDebt('demo', [
        chk('visual_parity_unverified_crop', 'WARN'),
        chk('visual_diff', 'PASS'),
      ], prev);
      assertEq(doc.entries.find(e => e.id === 'debt:visual_parity_unverified_crop')!.status, 'accepted', 'accepted 保持');
      assertEq(doc.entries.find(e => e.id === 'debt:visual_diff')!.status, 'closed', '转绿 closed');
      const { open, accepted } = countBlockingDebt(doc);
      assertEq(open, 0, 'open 计数');
      assertEq(accepted, 1, 'accepted 计数（≠closed 分列）');
    },
  },
  {
    name: '清偿边界：needs_fix 条目被验收 receipt 指名 → 拒绝清偿（确定性 FAIL 只能修复重跑）',
    run: () => {
      const doc = deriveVisualDebt('demo', [chk('asset_materialization_sanity', 'FAIL', 'BLOCKER')], null);
      const applied = applyVisualAcceptance(doc, payload({ accepted_debt_ids: ['debt:asset_materialization_sanity'] }), 'r.json');
      assertEq(applied.rejected.length, 1, '应拒绝');
      assertEq(applied.doc.entries[0].status, 'open', '仍 open');
    },
  },
  {
    name: '清偿：needs_human 条目 → accepted（记 accepted_by + receipt 引用，非 closed）',
    run: () => {
      const doc = deriveVisualDebt('demo', [chk('visual_parity_unverified_crop', 'WARN')], null);
      const applied = applyVisualAcceptance(doc, payload({ accepted_debt_ids: ['debt:visual_parity_unverified_crop'] }), 'r.json');
      assertEq(applied.rejected.length, 0, '无拒绝');
      const e = applied.doc.entries[0];
      assertEq(e.status, 'accepted', 'accepted 非 closed');
      assertEq(e.accepted_by, '张工', 'accepted_by');
      assertEq(e.acceptance_receipt, 'r.json', 'receipt 引用');
    },
  },
  {
    name: 'rubric 冻结阈值：全 ≥4 过；任一 ≤2 拒；=3 无 accepted_debt_ids 拒、有则过；版本失配拒',
    run: () => {
      assertEq(validateRubricPolicy(payload()).length, 0, '全 ≥4');
      assertTrue(validateRubricPolicy(payload({ rubric: { container: 2, hierarchy: 4, density: 4, state_color: 4 } }))
        .some(e => e.includes('1-2 分不得通过')), '≤2 拒');
      assertTrue(validateRubricPolicy(payload({ rubric: { container: 3, hierarchy: 4, density: 4, state_color: 4 } }))
        .some(e => e.includes('accepted_debt_ids')), '=3 须留痕');
      assertEq(validateRubricPolicy(payload({
        rubric: { container: 3, hierarchy: 4, density: 4, state_color: 4 },
        accepted_debt_ids: ['debt:x'],
      })).length, 0, '=3+留痕 过');
      assertTrue(validateRubricPolicy(payload({ rubric_version: 'r0' })).some(e => e.includes('冻结版本')), '版本失配拒');
    },
  },
  {
    name: 'screens 结构化绑定：逐屏配对哈希——reference/actual 跨屏调换 → 矩阵哈希改变（调序仍稳定）',
    run: () => {
      const s1 = { screen_id: 's1', variant: 'd', reference_sha256: 'a'.repeat(64), actual_sha256: 'b'.repeat(64) };
      const s2 = { screen_id: 's2', variant: 'd', reference_sha256: 'c'.repeat(64), actual_sha256: 'd'.repeat(64) };
      const h = screensMatrixHash([s1, s2]);
      assertEq(screensMatrixHash([s2, s1]), h, '同配对不同排序 → 同哈希（canonical sort）');
      const swapped = screensMatrixHash([
        { ...s1, actual_sha256: s2.actual_sha256 },
        { ...s2, actual_sha256: s1.actual_sha256 },
      ]);
      assertTrue(swapped !== h, '跨屏换对 → 哈希变（codex 四轮⑤：裸 hash 数组调序漏洞已堵）');
    },
  },
  // ---- plan f6b2d9a4：前置闸从「三态首产+阻塞求人」改为「路由 SSOT 复核」----
  {
    name: '前置闸(v7)：SSOT 缺失——非 UI 不阻塞；UI 相关（有参考图）→ BLOCKER 指向 initializer',
    run: async () => withTmpProject(async root => {
      const ctx = { phase: 'spec', feature: 'demo', projectRoot: root } as unknown as CheckContext;
      // 非 UI（无 ui-spec/handoff/参考图）：路由不适用，不拦老流程
      const [nonUi] = checkFidelityCapabilityPregate(ctx);
      assertEq(nonUi.status, 'PASS', nonUi.details);
      // UI 相关（ux-reference 有图）：复核不首产 → FAIL 指向 initializer
      const uxDir = featureFilePath(root, 'demo', 'ux-reference');
      fs.mkdirSync(uxDir, { recursive: true });
      fs.writeFileSync(path.join(uxDir, 'ref.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const [r] = checkFidelityCapabilityPregate(ctx);
      assertEq(r.status, 'FAIL', r.details);
      assertTrue(/fidelity-intent-init/.test(r.suggestion ?? ''), '指向 initializer 命令');
    }),
  },
  {
    name: '前置闸(v7)：宿主银行卡原话 + 盲 → 零询问自动定档（pixel_1to1/best_effort/auto_crop）',
    run: async () => withTmpProject(async root => {
      // 宿主 bc-openCard 原始需求.md ground truth（:3 素材声明 + :85 pixel_1to1 意图+尽量）
      const hostReq =
        '权威需求文档。同目录参考图为 UI 真源；结构/颜色/布局尽量一致。' +
        '无高保真素材时，logo/图标/插画可从原始截图裁剪获取（模拟数据环境）。\n' +
        '对照同目录参考截图保真实现（pixel_1to1 意图）：结构、颜色、布局、文案位置尽量与参考图一致。';
      const { routing } = initializeFidelityRouting({
        projectRoot: root, frameworkRoot: root, feature: 'demo',
        requirement: hostReq, featuresDirRel: 'doc/features',
        executionIdentity: 'phase:demo:spec',
      });
      assertEq(routing.inferred, 'pixel_1to1', 'inferred=pixel（枚举字面量 pixel_1to1 识别）');
      assertEq(routing.strictness, 'best_effort', '「尽量」=best_effort（素材声明不进质量轴）');
      assertEq(routing.assetAcquisitionMode, 'auto_crop', '「从截图裁剪获取」=auto_crop');
      assertEq(routing.defer, false, 'best_effort 不 DEFER——自动定档继续跑');
      assertEq(routing.decision.source, 'requirement_self_declared', 'decision.source');
      const ctx = { phase: 'spec', feature: 'demo', projectRoot: root } as unknown as CheckContext;
      const [r] = checkFidelityCapabilityPregate(ctx);
      assertEq(r.status, 'PASS', `零询问零 HALT（${r.details}）`);
    }),
  },
  {
    name: '前置闸(v7)：pixel+hard+能力不足=唯一真冲突 → BLOCKER；同 pixel 需求 best_effort → PASS',
    run: async () => withTmpProject(async root => {
      const initHard = (): void => {
        initializeFidelityRouting({
          projectRoot: root, frameworkRoot: root, feature: 'demo',
          requirement: '页面必须像素级还原参考截图，不接受降级，达不到不得继续交付。',
          featuresDirRel: 'doc/features', executionIdentity: 'phase:demo:spec',
        });
      };
      initHard();
      const ctx = { phase: 'spec', feature: 'demo', projectRoot: root } as unknown as CheckContext;
      const [hard] = checkFidelityCapabilityPregate(ctx);
      assertEq(hard.status, 'FAIL', hard.details);
      assertEq(hard.failure_kind, 'capability_missing_strong_intent', 'failure_kind');
      // 同 pixel 目标但「尽量」（best_effort 缺省）→ 自动钳制 + PASS（P0-1 验收对）
      initializeFidelityRouting({
        projectRoot: root, frameworkRoot: root, feature: 'demo',
        requirement: '页面完全参考截图，尽量还原。',
        featuresDirRel: 'doc/features', executionIdentity: 'phase:demo:spec',
      });
      const [soft] = checkFidelityCapabilityPregate(ctx);
      assertEq(soft.status, 'PASS', soft.details);
    }),
  },
  {
    name: 'post-impl4 P0-1：截断链（起点非 spec）hard+pixel+盲同样 DEFER（真冲突不受链起点限制）',
    run: async () => withTmpProject(async root => {
      const manifest = {
        feature: 'demo', run_id: 'r-trunc',
        requirement: '页面必须像素级还原参考截图，不接受降级，达不到不得继续交付。',
      } as unknown as GoalManifest;
      const action = evaluateFidelityTierPreflight({
        projectRoot: root, frameworkRoot: root, manifest,
        featuresDirRel: 'doc/features', chainStartsAtSpec: false,
      });
      assertEq(action.action, 'defer_capability_missing', JSON.stringify(action));
    }),
  },
  {
    name: '前置闸(v7)：有视觉 → effective=pixel；spec.md 投影失配 → BLOCKER 自动修复指引（禁问用户）',
    run: async () => withTmpProject(async root => {
      const d = resolveFidelityRoutingDecision({
        requirementText: '完全参考截图还原。',
        capability: { hasVision: true, ocrAvailable: true },
        executionIdentity: 'phase:demo:spec', requirementSha: 'a'.repeat(64),
      });
      assertEq(d.effective, 'pixel_1to1', '有视觉不钳（三档矩阵上限）');
      writeFidelityIntentSsot(root, 'demo', d, {
        executionIdentity: 'phase:demo:spec', requirementSha: 'a'.repeat(64),
      });
      writeCapabilitySnapshot(root, 'demo', {
        execution_identity: 'phase:demo:spec',
        decision_id: d.decision.decision_id, // post-impl4 P1-5：同批事务标记
        vision: { verdict: true, source: 'test' },
        ocr: { verdict: true, source: 'test' },
      });
      const ctx = { phase: 'spec', feature: 'demo', projectRoot: root } as unknown as CheckContext;
      assertEq(checkFidelityCapabilityPregate(ctx)[0].status, 'PASS', 'SSOT 一致 → PASS');
      // spec.md 投影与 SSOT 失配 → BLOCKER + agent 自动修复投影（不升级为用户询问）
      const specPath = featureFilePath(root, 'demo', path.join('spec', 'spec.md'));
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      // Visual Handoff 根块须含 ui_change 键才被识别（parseVisualHandoffYamlRoot 契约）
      fs.writeFileSync(
        specPath,
        '# spec\n\n```yaml\nui_change: new_or_changed\nfidelity_target: semantic_layout\n```\n',
        'utf-8',
      );
      const [drift] = checkFidelityCapabilityPregate(ctx);
      assertEq(drift.status, 'FAIL', drift.details);
      assertTrue(/投影/.test(drift.details ?? ''), '点名投影失配');
      assertTrue(/agent 直接修复|不询问用户/.test(drift.suggestion ?? ''), '指引=agent 自动修复投影，禁升级为用户询问');
    }),
  },
  {
    name: 'post-impl P0-1 e2e：银行卡需求 init → spec prompt 能力块消费 SSOT（auto_crop 建议、无 placeholder 冲突、best_effort 告知）',
    run: async () => withTmpProject(async root => {
      const hostReq =
        '添加银行卡页面开发。同目录参考图为 UI 真源；结构/颜色/布局尽量一致。' +
        '无高保真素材时，logo/图标/插画可从原始截图裁剪获取。（pixel_1to1 意图）尽量与参考图一致。';
      initializeFidelityRouting({
        projectRoot: root, frameworkRoot: root, feature: 'demo',
        requirement: hostReq, featuresDirRel: 'doc/features',
        executionIdentity: '20260724T000000Z-goal1',
      });
      const manifest = {
        feature: 'demo', requirement: hostReq, run_id: '20260724T000000Z-goal1',
      } as unknown as GoalManifest;
      const advisory = resolvePhaseCapabilityAdvisory(
        manifest, root, root, loadResolvedProfile(root, loadFrameworkConfig(root)), 'spec',
      );
      assertTrue(advisory !== null, 'UI 相关需求须产 advisory');
      assertEq(advisory!.assetAcquisitionMode, 'auto_crop', 'advisory 素材轴来自 SSOT');
      assertEq(advisory!.acceptanceStrictness, 'best_effort', 'advisory 严格度来自 SSOT');
      const block = buildCapabilityBlock(advisory!).join('\n');
      assertTrue(/auto_crop/.test(block), '能力块下发素材轴');
      assertTrue(/acquisition: crop/.test(block), 'auto_crop 下教 crop 声明路线');
      assertTrue(!/use placeholder assets/.test(block), 'auto_crop 下不整体改教 placeholder（顶撞 SSOT）');
      // post-impl2 P0-2：逐项 fallback 必须被明示允许——否则「crop 验不了→建议 placeholder→
      // prompt 禁 placeholder」形成循环卡死（feature 级 auto_crop ≠ 每项都必须裁成功）
      assertTrue(/Per-item fallback IS allowed/.test(block), '逐项占位+记债出路明示');
      assertTrue(/quality gaps are recorded as visual debt/.test(block), 'best_effort 告知不硬拦');
    }),
  },
  {
    name: 'post-impl2 P1-3：SSOT 生命周期四态——valid+sha 匹配复用/stale 重建/missing·corrupt 初始化/goal 首产无 sha 保守复用',
    run: async () => withTmpProject(async root => {
      const sha = 'a'.repeat(64);
      const goalValid = {
        state: 'valid' as const,
        doc: { execution_identity: '20260724T000000Z-goal1', requirement_sha256: sha },
      };
      const act = { activeGoalRunId: '20260724T000000Z-goal1' };
      assertEq(phaseInitDecision(goalValid, sha, act), 'reuse', '活跃 goal+sha 匹配 → 复用');
      assertEq(phaseInitDecision(goalValid, sha), 'init', 'post-impl4 P1-3：无活跃 goal（历史残留）→ 重算能力');
      assertEq(phaseInitDecision(goalValid, 'b'.repeat(64), act), 'init', '需求变更（stale）→ 自动重建，不沿用旧决策');
      assertEq(phaseInitDecision(goalValid, null, act), 'reuse', '活跃 goal 且无法重算 sha → 保守复用');
      assertEq(phaseInitDecision({ state: 'missing' }, sha), 'init', 'missing → 初始化（goal env 不再盲跳=修死循环）');
      assertEq(phaseInitDecision({ state: 'corrupt' }, sha), 'init', 'corrupt → runner-owned 受控重建');
      const phaseValid = {
        state: 'valid' as const,
        doc: { execution_identity: 'phase:demo:spec', requirement_sha256: sha },
      };
      assertEq(phaseInitDecision(phaseValid, null), 'init', 'phase 身份且无法重算 → 重建（非 goal 保护面）');
      assertEq(phaseInitDecision(phaseValid, sha), 'init', 'post-impl3 P1-5：phase-owned 即使 sha 匹配也幂等重算（adapter/能力变化比较不出）');
    }),
  },
  {
    name: 'post-impl P1-6：SSOT 损坏（字段缺失/非法枚举）→ loader 判 null（按缺失处理不消费）',
    run: async () => withTmpProject(async root => {
      const p = featureFilePath(root, 'demo', path.join('spec', 'reports', 'fidelity-intent.json'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({
        schema_version: '2.0', selected_fidelity: 'pixel_1to1', // 缺 inferred/effective/decision 等
      }), 'utf-8');
      assertEq(loadFidelityIntentSsot(root, 'demo'), null, '部分损坏不得当权威输入');
    }),
  },
  {
    name: 'post-impl5 P2：goal-report 写盘级三轴投影——json.fidelity_routing 强类型 + md 保真路由行（SSOT 派生）',
    run: async () => withTmpProject(async root => {
      initializeFidelityRouting({
        projectRoot: root, frameworkRoot: root, feature: 'demo',
        requirement: '页面完全参考截图，尽量还原。无高保真素材时可从原始截图裁剪获取。',
        featuresDirRel: 'doc/features', executionIdentity: 'r-report',
      });
      const reportDir = 'doc/features/demo/goal-runs/r-report';
      const report = generateGoalReportJson('r-report', 'demo', 'COMPLETED', []);
      writeGoalReport(root, reportDir, report);
      const json = JSON.parse(fs.readFileSync(
        path.join(root, reportDir, 'goal-report.json'), 'utf-8',
      )) as { fidelity_routing?: { selected: string; asset_acquisition_mode: string } };
      assertEq(json.fidelity_routing?.selected, 'pixel_1to1', 'json 三轴投影 selected');
      assertEq(json.fidelity_routing?.asset_acquisition_mode, 'auto_crop', 'json 三轴投影素材轴');
      const md = fs.readFileSync(path.join(root, reportDir, 'goal-report.md'), 'utf-8');
      assertTrue(/保真路由/.test(md), 'md 渲染三轴行');
      assertTrue(/auto_crop/.test(md), 'md 含素材轴');
    }),
  },
  {
    name: '披露门禁：有 open 债务 + 结论未提「视觉债务」→ BLOCKER FAIL；提了 → PASS；无债务 → PASS',
    run: async () => withTmpProject(async root => {
      const ctxT = { phase: 'testing', feature: 'demo', projectRoot: root } as unknown as CheckContext;
      assertEq(checkVisualDebtDisclosure(ctxT, '## 结论\n**测试结论**: 达标')[0].status, 'PASS', '无债务');
      const debtDir = featureDir(root, 'demo');
      fs.mkdirSync(debtDir, { recursive: true });
      fs.writeFileSync(path.join(debtDir, 'visual-debt.json'), JSON.stringify({
        schema_version: '1.0', feature: 'demo',
        entries: [{ id: 'debt:x', source_check_id: 'visual_parity_unverified_crop', severity: 'MAJOR', summary: 's', status: 'open', resolution_class: 'needs_human' }],
      }), 'utf-8');
      const [bad] = checkVisualDebtDisclosure(ctxT, '## 结论\n**测试结论**: 达标\n可发布');
      assertEq(bad.status, 'FAIL', '未披露');
      assertEq(bad.failure_kind, 'visual_debt_undisclosed', 'failure_kind');
      const [ok] = checkVisualDebtDisclosure(ctxT, '## 结论\n**测试结论**: 达标\n视觉债务：1 项 open，见 visual-debt.md');
      assertEq(ok.status, 'PASS', '已披露');
    }),
  },
];

// ---------------- codex 实施 review P0-1：跨阶段单调 ledger ----------------

cases.push({
  name: 'P0-1 跨阶段序列：coding 产债 → testing 该 check 缺席 → 债务**保留**（不蒸发）；testing 明确 PASS 才 closed',
  run: () => {
    // coding 轮：visual_parity FAIL 产债
    const afterCoding = deriveVisualDebt('demo', [chk('visual_parity', 'FAIL', 'BLOCKER')], null);
    assertEq(afterCoding.entries.find(e => e.source_check_id === 'visual_parity')!.status, 'open', 'coding open');
    // testing 轮：不跑 visual_parity（只有设备类检查）——历史债务必须单调保留
    const afterTesting = deriveVisualDebt('demo', [chk('visual_diff', 'WARN')], afterCoding);
    const kept = afterTesting.entries.find(e => e.source_check_id === 'visual_parity');
    assertTrue(kept !== undefined, '缺席 check 的历史债务不得蒸发（事故：跨阶段覆盖清空）');
    assertEq(kept!.status, 'open', '保持 open');
    const { open } = countBlockingDebt(afterTesting);
    assertEq(open, 2, 'visual_parity(保留) + visual_diff(新增)');
    // 回到 coding 重跑且 PASS → 才 closed
    const fixed = deriveVisualDebt('demo', [chk('visual_parity', 'PASS')], afterTesting);
    assertEq(fixed.entries.find(e => e.source_check_id === 'visual_parity')!.status, 'closed', '明确 PASS 才闭账');
  },
});

cases.push({
  name: 'P0-1 scope 粒度：render_visibility 结构化 findings → 逐屏子条目（debt:<check>:<screen>），单屏修复单独闭账',
  run: () => {
    const withFindings = (screens: string[]): ReturnType<typeof chk> & { structured: unknown } => ({
      ...chk('render_visibility_calibrate', 'WARN'),
      structured: { kind: 'render_visibility', findings: screens.map(s => ({ screen: s })) },
    });
    const r1 = deriveVisualDebt('demo', [withFindings(['s1', 's2'])], null);
    assertEq(r1.entries.length, 2, '逐屏两条');
    assertTrue(r1.entries.some(e => e.id === 'debt:render_visibility_calibrate:s1' && e.screen_id === 's1'), 's1 条目');
    const r2 = deriveVisualDebt('demo', [withFindings(['s2'])], r1);
    assertEq(r2.entries.find(e => e.id.endsWith(':s1'))!.status, 'closed', 's1 修复闭账');
    assertEq(r2.entries.find(e => e.id.endsWith(':s2'))!.status, 'open', 's2 仍 open');
  },
});

// ---------------- codex 实施 review P0-3：裸 1.1 summary 拒收 ----------------

cases.push({
  name: 'P0-3 completion：{"schema_version":"1.2","verdict":"PASS"} 裸 summary → quality_axes_valid(needs_fix) 拒作干净依据',
  run: async () => withTmpProject(async root => {
    const p = path.join(receiptDirPath(root, 'demo', 'review'), 'reports', 'summary.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ schema_version: '1.2', verdict: 'PASS' }), 'utf-8');
    const { collectCleanPassIssues } = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
    const issues = collectCleanPassIssues({ projectRoot: root, feature: 'demo', chain: ['review'] });
    const hit = issues.find(i => i.condition === 'quality_axes_valid');
    assertTrue(hit !== undefined, '裸 1.2 应被拒');
    assertEq(hit!.kind, 'needs_fix', 'needs_fix');
  }),
});

cases.push({
  name: 'P0-3 上游门禁：1.1 summary 缺 quality_axes → 机器裁决不可信 → 下游 FAIL',
  run: async () => withTmpProject(async root => {
    const p = path.join(receiptDirPath(root, 'demo', 'review'), 'reports', 'summary.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ schema_version: '1.1', verdict: 'PASS', blockers: [] }), 'utf-8');
    const { checkUpstreamVerdictGate } = require('../../scripts/utils/upstream-verdict-gate') as typeof import('../../scripts/utils/upstream-verdict-gate');
    const [r] = checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'ut' });
    assertEq(r.status, 'FAIL', r.details);
    assertTrue(r.details.includes('quality_axes'), '点名 lattice 缺失');
  }),
});

// ---------------- codex 三轮 P0-1/P0-2/P1-4/P1-6/次要项 回归 ----------------

cases.push({
  name: '三轮 P0-1：损坏 visual-debt.json → loadVisualDebtEx=invalid（不得当 missing 重建）；合法/缺失三态正确',
  run: async () => withTmpProject(async root => {
    const { loadVisualDebtEx, writeVisualDebt } = require('../../scripts/utils/visual-debt') as typeof import('../../scripts/utils/visual-debt');
    assertEq(loadVisualDebtEx(root, 'demo').state, 'missing', 'missing');
    const dir = featureDir(root, 'demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'visual-debt.json'), '{ truncated', 'utf-8');
    const bad = loadVisualDebtEx(root, 'demo');
    assertEq(bad.state, 'invalid', '截断 JSON 应 invalid');
    fs.writeFileSync(path.join(dir, 'visual-debt.json'), JSON.stringify({ schema_version: '1.0', feature: 'demo', entries: 'oops' }), 'utf-8');
    assertEq(loadVisualDebtEx(root, 'demo').state, 'invalid', 'entries 非数组应 invalid');
    writeVisualDebt(root, { schema_version: '1.0', feature: 'demo', entries: [] });
    assertEq(loadVisualDebtEx(root, 'demo').state, 'valid', '原子写后 valid');
  }),
});

cases.push({
  name: '三轮次要项：三态标注只更新本轮观察到的维度——render 缺席时历史 VERIFIED 不被覆盖',
  run: () => {
    const { annotateAssetTriState } = require('../../scripts/utils/visual-debt') as typeof import('../../scripts/utils/visual-debt');
    const prevDoc = deriveVisualDebt('demo', [chk('visual_parity_unverified_crop', 'WARN')], null);
    prevDoc.entries[0].asset_render_status = 'VERIFIED'; // 历史某轮 render 已验
    const annotated = annotateAssetTriState(prevDoc, [
      chk('visual_parity_unverified_crop', 'WARN'),
      chk('asset_materialization_sanity', 'PASS'),
      // 本轮无 render_visibility_calibrate / visual_parity——两维度不得被改写
    ]);
    const e = annotated.entries[0];
    assertEq(e.asset_source_status, 'VERIFIED', '本轮观察到 sanity PASS');
    assertEq(e.asset_render_status, 'VERIFIED', 'render 缺席须保留历史 VERIFIED（不失真）');
    assertEq(e.asset_binding_status, undefined, 'binding 从未观察过——保持未知而非 UNVERIFIED');
  },
});

cases.push({
  name: '四轮 P0-2：validateQualityAxes 全字段严格——空轴对象/{}/错枚举/字符串 boolean/伪 resolution/未知轴全拒',
  run: () => {
    const { validateQualityAxes } = require('../../scripts/utils/quality-axes') as typeof import('../../scripts/utils/quality-axes');
    // codex 四轮实锤形态：四个空轴对象曾通过
    const emptyAxes = { functional: {}, visual: {}, asset: {}, evidence: {} };
    assertTrue(validateQualityAxes(emptyAxes).length >= 4, `空轴对象须多项拒绝：${JSON.stringify(validateQualityAxes(emptyAxes))}`);
    const na = { applicable: false, required_for_release: false, verdict: 'NOT_APPLICABLE', blocking_class: null, source_checks: [], resolution: null };
    const good = {
      functional: { applicable: true, required_for_release: true, verdict: 'PASS', blocking_class: null, source_checks: [], resolution: null },
      visual: na, asset: na, evidence: na,
    };
    assertEq(validateQualityAxes(good).length, 0, '合法轴通过');
    assertTrue(validateQualityAxes({ ...good, functional: { ...good.functional, verdict: 'GREAT' } })
      .some(e => e.includes('verdict')), '错枚举拒');
    assertTrue(validateQualityAxes({ ...good, functional: { ...good.functional, applicable: 'true' } })
      .some(e => e.includes('boolean')), '字符串 boolean 拒');
    assertTrue(validateQualityAxes({ ...good, functional: { ...good.functional, verdict: 'FAIL', resolution: { class: 'whatever' } } })
      .some(e => e.includes('resolution')), '伪 resolution 拒');
    assertTrue(validateQualityAxes({ ...good, extra_axis: na }).some(e => e.includes('未知轴')), '未知轴拒');
    assertTrue(validateQualityAxes({ ...good, functional: { ...good.functional, bonus: 1 } })
      .some(e => e.includes('未知字段')), '未知字段拒');
    // 五轮 P1-4：键在场性 + resolution 未知字段 + blocking_class↔resolution.class 一致性
    const { blocking_class: _omit, ...noBlockingKey } = good.functional as Record<string, unknown>;
    assertTrue(validateQualityAxes({ ...good, functional: noBlockingKey }).some(e => e.includes('缺必填键 blocking_class')),
      '整键省略拒（schema required 语义）');
    assertTrue(validateQualityAxes({
      ...good,
      functional: {
        ...good.functional, verdict: 'FAIL', blocking_class: 'needs_fix',
        resolution: { class: 'needs_fix', owner: 'agent', retry_phase: null, note: 'x' },
      },
    }).some(e => e.includes('resolution 未知字段')), 'resolution 未知字段拒');
    assertTrue(validateQualityAxes({
      ...good,
      functional: {
        ...good.functional, verdict: 'FAIL', blocking_class: 'needs_human',
        resolution: { class: 'needs_fix', owner: 'agent', retry_phase: null },
      },
    }).some(e => e.includes('≠ resolution.class')), 'blocking_class 与 resolution.class 失配拒');
  },
});

cases.push({
  name: '三轮 P1-4：validateSummaryV11 唯一权威——缺任一字段/半 lattice 全拒；完整 1.1 通过',
  run: () => {
    const { validateSummaryV11 } = require('../../scripts/utils/quality-axes') as typeof import('../../scripts/utils/quality-axes');
    const na = { applicable: false, required_for_release: false, verdict: 'NOT_APPLICABLE', blocking_class: null, source_checks: [], resolution: null };
    const full = {
      schema_version: '1.1', verdict: 'PASS', report_validity: 'PASS',
      release_readiness: 'READY', completion_status: 'COMPLETE',
      quality_axes: {
        functional: { applicable: true, required_for_release: true, verdict: 'PASS', blocking_class: null, source_checks: [], resolution: null },
        visual: na, asset: na, evidence: na,
      },
    };
    assertEq(validateSummaryV11(full).length, 0, '完整 1.1 通过');
    assertTrue(validateSummaryV11({ schema_version: '1.1', verdict: 'PASS' }).length >= 3, '裸 1.1 多项违反');
    const noRelease = { ...full } as Record<string, unknown>;
    delete noRelease.release_readiness;
    assertTrue(validateSummaryV11(noRelease).some(e => e.includes('release_readiness')), '缺 release_readiness 拒');
  },
});

cases.push({
  name: '三轮 P0-2：completion 统一规则——needs_fix UNVERIFIED 轴也拦（needs_fix）；READY 与非 PASS 轴矛盾 → 篡改拦截；DEBT_PIPELINE_ERROR 拦',
  run: async () => withTmpProject(async root => {
    const p = path.join(receiptDirPath(root, 'demo', 'testing'), 'reports', 'summary.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const na = { applicable: false, required_for_release: false, verdict: 'NOT_APPLICABLE', blocking_class: null, source_checks: [], resolution: null };
    fs.writeFileSync(p, JSON.stringify({
      schema_version: '1.2', verdict: 'PASS', report_validity: 'PASS',
      release_readiness: 'READY', // 与 visual 非 PASS 矛盾（篡改形态）
      completion_status: 'DEBT_PIPELINE_ERROR',
      depth: 'full',
      closure_status: 'closed',
      closure_commit: { schema_version: '1.0' },
      quality_axes: {
        functional: { applicable: true, required_for_release: true, verdict: 'PASS', blocking_class: null, source_checks: [], resolution: null },
        visual: {
          applicable: true, required_for_release: true, verdict: 'UNVERIFIED',
          blocking_class: 'needs_fix', source_checks: [],
          resolution: { class: 'needs_fix', owner: 'toolchain', retry_phase: 'testing' },
        },
        asset: na, evidence: na,
      },
    }), 'utf-8');
    const { collectCleanPassIssues } = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
    const issues = collectCleanPassIssues({ projectRoot: root, feature: 'demo', chain: ['testing'] });
    const axisHit = issues.find(i => i.condition === 'quality_axis_verified');
    assertTrue(axisHit !== undefined && axisHit.kind === 'needs_fix', 'needs_fix UNVERIFIED 轴须拦且归 needs_fix');
    assertTrue(issues.some(i => i.condition === 'release_projection_consistent'), 'READY 矛盾须拦');
    assertTrue(issues.some(i => i.condition === 'debt_pipeline_healthy'), '管线故障态须拦');
  }),
});

cases.push({
  name: '三轮 P1-6：workflow 解析降级 + 自定义 phase 不在回退链 → BLOCKER（门禁不静默消失）；回退链内 phase 照常',
  run: async () => withTmpProject(async root => {
    const { checkUpstreamVerdictGate, resolveUpstreamPhaseChain } =
      require('../../scripts/utils/upstream-verdict-gate') as typeof import('../../scripts/utils/upstream-verdict-gate');
    // tmp 树无 workflows/*.workflow.yaml → 解析降级
    const res = resolveUpstreamPhaseChain(root, 'demo');
    assertTrue(res.degraded, 'tmp 树应降级');
    const custom = checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'security_audit' });
    assertEq(custom.length, 1, '自定义 phase 应产结果');
    assertEq(custom[0].status, 'FAIL', '降级+链外 → FAIL');
    assertEq(custom[0].failure_kind, 'workflow_chain_unresolved', 'failure_kind');
    // 回退链内 phase：spec 链首零结果（原语义保留）
    assertEq(checkUpstreamVerdictGate({ projectRoot: root, feature: 'demo', phase: 'spec' }).length, 0, '链首零结果');
  }),
});

// ---------------- P1-F：素材问人清单 + 三态标注 ----------------

cases.push({
  name: 'P1-F 问人清单：盲档+缺供给的 brand/ill 素材 → 生成 asset-request.md（含放置路径与三出路）；已供给不催；非盲不生成',
  run: async () => withTmpProject(async root => {
    const specDir = featureFilePath(root, 'demo', path.join('spec', 'ui-spec.yaml'));
    fs.mkdirSync(path.dirname(specDir), { recursive: true });
    const provided = 'doc/features/demo/spec/assets/bank_logo_ok.png';
    fs.mkdirSync(path.dirname(path.join(root, provided)), { recursive: true });
    fs.writeFileSync(path.join(root, provided), 'x', 'utf-8');
    fs.writeFileSync(specDir, [
      'schema_version: "1.0"', 'screens: []', 'tokens: {}',
      'assets:',
      '  - key: bank_logo_icbc',
      '    acquisition: placeholder',
      '  - key: bank_logo_ok',
      '    acquisition: crop',
      `    resolved_path: ${provided}`,
      '  - key: guide_ill',
      '    acquisition: placeholder',
      '  - key: bg_stripe',
      '    acquisition: placeholder',
      '',
    ].join('\n'), 'utf-8');
    const { maybeWriteAssetRequest } = await import('../../scripts/check-spec');
    const outPath = featureFilePath(root, 'demo', path.join('spec', 'asset-request.md'));

    maybeWriteAssetRequest({ projectRoot: root, feature: 'demo', adapterImageInput: 'tool_read' } as unknown as CheckContext);
    assertTrue(!fs.existsSync(outPath), '非盲不生成');

    maybeWriteAssetRequest({ projectRoot: root, feature: 'demo', adapterImageInput: 'none' } as unknown as CheckContext);
    assertTrue(fs.existsSync(outPath), '盲档应生成');
    const md = fs.readFileSync(outPath, 'utf-8');
    assertTrue(md.includes('bank_logo_icbc') && md.includes('guide_ill'), '缺供给项在列');
    assertTrue(!md.includes('bank_logo_ok |'), '已供给不催');
    assertTrue(!md.includes('bg_stripe'), '非 brand/ill 角色不催');
    assertTrue(md.includes('release 保持 BLOCKED') || md.includes('BLOCKED'), '三出路含诚实成本');
  }),
});

cases.push({
  name: 'P1-F 三态标注：sanity 绿/parity 红/render 红 → source=VERIFIED, binding/render=UNVERIFIED（rollup 可判哪一态卡住）',
  run: () => {
    const doc = deriveVisualDebt('demo', [chk('visual_parity_unverified_crop', 'WARN')], null);
    const { annotateAssetTriState } = require('../../scripts/utils/visual-debt') as typeof import('../../scripts/utils/visual-debt');
    const annotated = annotateAssetTriState(doc, [
      chk('visual_parity_unverified_crop', 'WARN'),
      chk('asset_materialization_sanity', 'PASS'),
      chk('visual_parity', 'FAIL', 'BLOCKER'),
      chk('render_visibility_calibrate', 'WARN'),
    ]);
    const e = annotated.entries.find(x => x.source_check_id === 'visual_parity_unverified_crop')!;
    assertEq(e.asset_source_status, 'VERIFIED', 'source');
    assertEq(e.asset_binding_status, 'UNVERIFIED', 'binding（文件放了 UI 未绑——假清偿场景可见）');
    assertEq(e.asset_render_status, 'UNVERIFIED', 'render');
  },
});

// ---------------- P1-E 7.5：nav 门禁档位无关 BLOCKER 回归 tripwire ----------------
// t7（goal-fakepass）已把缺 nav 配置改为完备性 BLOCKER 且与保真档位脱钩（check-testing.ts
// navGateError 块）——宿主二轮事故正是旧版 WARN 放行 8 屏拒采。深管线端到端难以单测，
// 此处按 verdict-extraction 元门禁先例做源码锚定 tripwire：断言该块仍为 BLOCKER/FAIL 且
// 保留「档位无关」语义锚（回归成 WARN/fidelityRatchet 分支即红）。
cases.push({
  name: 'tripwire：check-testing nav 完备性门禁保持 BLOCKER/FAIL 且档位无关（t7 行为锁定）',
  run: () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'check-testing.ts'), 'utf-8');
    const navBlockIdx = src.indexOf('nav 配置缺失/非法=完备性 BLOCKER，与保真档位脱钩');
    assertTrue(navBlockIdx > 0, 'nav 档位无关注释锚缺失（t7 语义可能被改动）');
    const window = src.slice(navBlockIdx, navBlockIdx + 1600);
    assertTrue(/severity:\s*'BLOCKER'/.test(window), 'nav 门禁块须保持 severity BLOCKER');
    assertTrue(/status:\s*'FAIL'/.test(window), 'nav 门禁块须保持 status FAIL');
    assertTrue(!/fidelityRatchetFailOrWarn/.test(window), 'nav 门禁块不得回归 fidelityRatchet 档位降级');
  },
});

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

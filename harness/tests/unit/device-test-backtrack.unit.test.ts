// ============================================================================
// device-test-backtrack.unit.test.ts — 真机缺陷回修接入（plan d9e4b7c1 T2）
// ----------------------------------------------------------------------------
// 两层被测目标（宿主 bc-openCard 20260728 实况建模——trace 7 失败 1 通过）：
//   · profile composer（device-test-evidence.ts）：failure_artifacts 严格 join、
//     四分类三条件、TOCTOU 复算、路径防逃逸；
//   · core collector（collectActionableDefects C 支路 + validateDeviceTestEvidenceBinding）：
//     身份/设备元组/trace/时间窗绑定、根/级联三分、physical-only 白名单、
//     **三集合精确断言**（根 === {TC-001,TC-007}、注入 coding 数 === 1）。
// ============================================================================

import * as nodeAssert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  composeDeviceTestEvidence,
  parseDerivedPlanSteps,
  parseFailureArtifactsClause,
} from '../../../profiles/hmos-app/harness/device-test-evidence';
import { computeHapSha256Full } from '../../../profiles/hmos-app/harness/build-fingerprint';
import {
  collectActionableDefects,
  evaluateUnverifiedRound,
  refineFailureKindWithTrustedDeviceEvidence,
  validateDeviceTestEvidenceBinding,
  type DeviceTestCollectContext,
} from '../../scripts/goal-runner';
import { deviceTestEvidencePath, type DeviceTestEvidenceDoc } from '../../scripts/utils/device-test-evidence-shared';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';

function w(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

const UI_SPEC = `schema_version: '1.0'
verified: unverified
verified_method: none
screens:
- id: add_card_home_collapsed
  priority: P0
  ref_id: ref_home_collapsed
  must_have_elements:
  - hc_page_title
  - hc_subtitle_main
  - hc_bank_row_cmb
  - hc_more_entry
  - ref_home_collapsed
  root:
    type: navigation_frame
    order: 0
    children:
    - id: hc_page_title
      type: content_display
      order: 0
      text: 添加银行卡
    - id: hc_bank_row_cmb
      type: interactive
      order: 1
    - id: hc_more_entry
      type: interactive
      order: 2
- id: card_type_sheet
  priority: P0
  ref_id: ref_card_type_sheet
  must_have_elements:
  - ct_debit_row
  root:
    type: sheet
    order: 0
    children:
    - id: ct_debit_row
      type: interactive
      order: 0
      text: 储蓄卡
`;

const DERIVED_PLAN = `---
explicit_skip_tc_ids: []
---

# ${FEATURE} Hylyre 派生测试计划

## 测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |
|----------|---------|---------|---------|---------|--------|---------|
| TC-001 | 添卡首页收起态 | 冷启动 | {"swipe":{"direction":"UP"}}; {"wait":{"seconds":1}}; {"wait_for":{"by_text":"钱包"}}; {"scroll_to":{"by_text":"添加管理卡片"}}; {"touch":{"by_text":"添加管理卡片"}}; {"wait_for":{"by_text":"卡包"}}; {"touch":{"by_text":"添加卡片"}}; {"wait_for":{"by_id":"hc_page_title"}}; {"wait_for":{"by_id":"hc_more_entry"}}; {"touch":{"by_id":"hc_bank_row_cmb"}} | 布局正确 | P0 | AC-1 |
| TC-002 | 半模态 | 已打开 | {"touch":{"by_text":"储蓄卡","scope":"top_overlay"}} | 进入 | P0 | AC-2 |
| TC-003 | 协议 | 前置 | {"touch":{"by_text":"我已阅读并同意相关协议"}} | 打开 | P0 | AC-3 |
| TC-004 | 短信 | 前置 | {"input":{"by_id":"sv_otp_input","text":"123456"}} | 成功 | P0 | AC-4 |
| TC-005 | 卡详情 | 前置 | {"wait_for":{"by_text":"交易记录"}} | 可见 | P0 | AC-4 |
| TC-006 | 卡包有卡态 | 前置 | {"back":{}} | 分区 | P0 | AC-5 |
| TC-007 | 展开态 | 冷启动 | {"swipe":{"direction":"UP"}}; {"wait":{"seconds":1}}; {"wait_for":{"by_text":"钱包"}}; {"scroll_to":{"by_text":"添加管理卡片"}} | 可见 | P1 | AC-7 |
| TC-008 | 全部银行 | 前置 | {"touch":{"by_id":"he_view_all_banks_link"}} | 可搜索 | P1 | AC-7 |
`;

const FLOW_BLOCK = `# 测试计划

\`\`\`yaml
test_case_flow:
  TC-001: { precondition: { kind: fresh_app, reset: restart } }
  TC-002: { precondition: { kind: after, tc: TC-001 } }
  TC-003: { precondition: { kind: after, tc: TC-002 } }
  TC-004: { precondition: { kind: after, tc: TC-003 } }
  TC-005: { precondition: { kind: after, tc: TC-004 } }
  TC-006: { precondition: { kind: after, tc: TC-005 } }
  TC-007: { precondition: { kind: fresh_app, reset: restart } }
  TC-008: { precondition: { kind: after, tc: TC-007 } }
\`\`\`
`;

/** 宿主实况 dump 形态：其他锚点精确在场、目标只有 namespaced 变体 */
const TC001_DUMP = JSON.stringify({
  attributes: { id: '' },
  children: [
    { attributes: { id: 'hc_page_title', text: '添加银行卡' } },
    { attributes: { id: 'hc_more_entry' } },
    { attributes: { id: 'maison:bc-opencard:add_card_home_collapsed:hc_bank_row_cmb' } },
  ],
});

function traceCase(id: string, status: string, notes?: string): Record<string, unknown> {
  return { id, status, ...(notes ? { notes } : {}) };
}

const HOST_TRACE = {
  schema_version: '0.2-p4',
  feature: FEATURE,
  phase: 'testing',
  outcome: 'partial',
  cases: [
    traceCase('TC-001', '失败', "[Script-0203002] Can't find component with [BY.id('hc_bank_row_cmb')] failure_artifacts: ui_dump=TC-001-step-9.json, screenshot=TC-001-step-9.png"),
    traceCase('TC-002', '失败', 'no matching UI target failure_artifacts: ui_dump=TC-002-step-0.json'),
    traceCase('TC-003', '失败', 'blocked-ish'),
    traceCase('TC-004', '失败', 'blocked-ish'),
    traceCase('TC-005', '通过'),
    traceCase('TC-006', '失败', 'blocked-ish'),
    traceCase('TC-007', '失败', "scroll_until_visible: target not found for by_text '添加管理卡片' failure_artifacts: ui_dump=TC-007-step-3.json"),
    traceCase('TC-008', '失败', 'blocked-ish'),
  ],
};

interface Fixture {
  root: string;
  reportsDir: string;
  tracePath: string;
  hapPath: string;
  hapSha: string;
}

function setupFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-backtrack-'));
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'T',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: ['cursor'],
  }, null, 2));
  w(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, UI_SPEC);
  w(root, `doc/features/${FEATURE}/testing/test-plan.md`, FLOW_BLOCK);
  const reportsDir = path.join(root, 'doc/features', FEATURE, 'testing', 'reports');
  const runDir = path.join(reportsDir, '20260101T000000Z', 'hylyre');
  fs.mkdirSync(path.join(runDir, 'failures'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'test-plan.hylyre.md'), DERIVED_PLAN, 'utf-8');
  const tracePath = path.join(runDir, 'trace.json');
  fs.writeFileSync(tracePath, JSON.stringify(HOST_TRACE, null, 2), 'utf-8');
  // 宿主实锤：failure_dir 积累多个 step 诊断文件，只有 notes 指名的 step-9 作数
  for (const n of ['TC-001-step-1.json', 'TC-001-step-9.json', 'TC-001-step-10.json']) {
    fs.writeFileSync(path.join(runDir, 'failures', n), TC001_DUMP, 'utf-8');
  }
  fs.writeFileSync(path.join(runDir, 'failures', 'TC-001-step-9.png'), 'png', 'utf-8');
  fs.writeFileSync(path.join(runDir, 'failures', 'TC-002-step-0.json'), '{}', 'utf-8');
  fs.writeFileSync(path.join(runDir, 'failures', 'TC-007-step-3.json'), '{}', 'utf-8');
  const hapPath = path.join(root, 'build', 'app.hap');
  w(root, 'build/app.hap', 'hap-bytes-v1');
  clearFrameworkConfigCache();
  return { root, reportsDir, tracePath, hapPath, hapSha: computeHapSha256Full(hapPath)! };
}


function setupAttributionGoldenFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-attribution-golden-'));
  const fixtureDir = path.resolve(__dirname, '../../../profiles/hmos-app/harness/tests/fixtures/device-attribution');
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1', project_name: 'T',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: ['cursor'],
  }, null, 2));
  w(root, 'doc/features/bc-openCard/spec/ui-spec.yaml', fs.readFileSync(path.join(fixtureDir, 'ui-spec.yaml'), 'utf8'));
  w(root, 'doc/features/bc-openCard/testing/test-plan.md', FLOW_BLOCK);
  const reportsDir = path.join(root, 'doc/features', FEATURE, 'testing', 'reports');
  const runDir = path.join(reportsDir, '20260729T223800Z', 'hylyre');
  const failuresDir = path.join(runDir, 'failures');
  fs.mkdirSync(failuresDir, { recursive: true });
  const goldenPlan = fs.readFileSync(path.join(fixtureDir, 'test-plan.hylyre.md'), 'utf8')
    + '\n| TC-012 | 纯锚点漂移 | 短信屏 | {"wait_for":{"by_id":"maison:bc-opencard:sms_verify:ghost-node","timeout":5}} | 可见 | P1 | AC-X |'
    + '\n| TC-013 | 未知谓词保真 | 短信屏 | {"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sms_input","custom_probe":{"mode":"strict"}}} | 可见 | P2 | AC-X |'
    + '\n| TC-090 | spec 节点缺失 | 短信屏 | {"wait_for":{"by_id":"maison:bc-opencard:sms_verify:sms_countdown","timeout":5}} | 可见 | P1 | AC-X |\n';
  fs.writeFileSync(path.join(runDir, 'test-plan.hylyre.md'), goldenPlan, 'utf8');
  const trace = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'trace.json'), 'utf8')) as {
    artifacts: { plan: string };
    cases: Array<{ id: string; status: string; notes?: string }>;
  };
  trace.artifacts.plan = 'doc/features/bc-openCard/testing/reports/20260729T223800Z/hylyre/test-plan.hylyre.md';
  const failed = new Map([
    ['TC-006', 'wait for: target not in desired state failure_artifacts: ui_dump=TC-006-step-5.json'],
    ['TC-008', "can't find component failure_artifacts: ui_dump=TC-008-step-0.json"],
    ['TC-007', 'wait for: target not in desired state failure_artifacts: ui_dump=TC-007-step-17.json'],
    ['TC-010', "no matching UI target for predicate {'by_text':'查看全部'} failure_artifacts: ui_dump=TC-010-step-2.json"],
    ['TC-011', "no matching UI target for predicate {'by_text':'查看全部'} failure_artifacts: ui_dump=TC-011-step-0.json"],
    ['TC-012', "can't find component failure_artifacts: ui_dump=TC-012-step-0.json"],
    ['TC-090', "can't find component failure_artifacts: ui_dump=TC-090-step-0.json"],
  ]);
  trace.cases = trace.cases.filter(c => failed.has(c.id))
    .map(c => ({ ...c, status: '失败', notes: failed.get(c.id)! }));
  trace.cases.push({ id: 'TC-012', status: '失败', notes: failed.get('TC-012')! });
  trace.cases.push({ id: 'TC-090', status: '失败', notes: failed.get('TC-090')! });
  const tracePath = path.join(runDir, 'trace.json');
  fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2), 'utf8');
  const disabled = fs.readFileSync(path.join(fixtureDir, 'sms-verify-next-disabled.json'), 'utf8');
  const clipped = fs.readFileSync(path.join(fixtureDir, 'sms-verify-next-clipped.json'), 'utf8');
  // README ground truth：006/007 是 clipped；唯一 disabled 证据来自无 spec selector 的 010/011。
  for (const name of ['TC-006-step-5.json', 'TC-007-step-17.json', 'TC-008-step-0.json', 'TC-012-step-0.json', 'TC-090-step-0.json']) {
    fs.writeFileSync(path.join(failuresDir, name), clipped, 'utf8');
  }
  for (const name of ['TC-010-step-2.json', 'TC-011-step-0.json']) {
    fs.writeFileSync(path.join(failuresDir, name), disabled, 'utf8');
  }
  const hapPath = path.join(root, 'build', 'app.hap');
  w(root, 'build/app.hap', 'hap-golden-v1');
  clearFrameworkConfigCache();
  return { root, reportsDir, tracePath, hapPath, hapSha: computeHapSha256Full(hapPath)! };
}

const TARGET = { serial: 'dev-A', target_kind: 'physical', session_id: 'sess-1' };

function composeOk(f: Fixture, overrides: Partial<Parameters<typeof composeDeviceTestEvidence>[0]> = {}) {
  return composeDeviceTestEvidence({
    projectRoot: f.root,
    feature: FEATURE,
    tracePath: f.tracePath,
    hapPath: f.hapPath,
    expectedHapSha256Full: f.hapSha,
    goalRunId: 'run-1',
    attemptId: 'att-1',
    deviceTarget: TARGET,
    installExecuted: true,
    installOk: true,
    ...overrides,
  });
}

/** 走完整生产路径写 evidence（compose + written_at 盖章），返回窗口 */
function writeEvidence(
  f: Fixture,
  mutate?: (doc: Record<string, unknown>) => void,
): DeviceTestCollectContext {
  const startMs = Date.now() - 1000;
  const composed = composeOk(f);
  if (!composed.ok) throw new Error(`compose 应成功：${(composed as { reason?: string }).reason}`);
  const doc: Record<string, unknown> = { ...composed.doc, written_at: new Date().toISOString() };
  mutate?.(doc);
  fs.writeFileSync(deviceTestEvidencePath(f.reportsDir), JSON.stringify(doc, null, 2), 'utf-8');
  fs.writeFileSync(path.join(f.reportsDir, 'device-test-run.meta.json'), JSON.stringify({
    run_started_at: new Date(Date.now() - 500).toISOString(),
    run_ended_at: new Date(Date.now() - 100).toISOString(),
  }), 'utf-8');
  return {
    attemptId: 'att-1',
    expectedTarget: { ...TARGET },
    harnessWindow: { startMs, endMs: Date.now() + 1000 },
    reportsDir: f.reportsDir,
  };
}

export function runAll(): UnitCaseResult[] {
  const cases: UnitCaseResult[] = [];
  const t = (name: string, fn: () => void): void => {
    try {
      fn();
      cases.push({ name, ok: true });
    } catch (e) {
      cases.push({ name, ok: false, error: (e as Error).stack ?? (e as Error).message });
    }
  };
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(msg);
  };

  t('failure_artifacts 子句严格解析（含 screenshot 可选）', () => {
    const c = parseFailureArtifactsClause("xx failure_artifacts: ui_dump=TC-001-step-9.json, screenshot=TC-001-step-9.png");
    assert(c?.uiDump === 'TC-001-step-9.json' && c?.screenshot === 'TC-001-step-9.png', JSON.stringify(c));
    assert(parseFailureArtifactsClause('no clause here') === null, '无子句应 null');
  });

  t('多个 failure_artifacts 子句 → null（review P1：静默取第一个会把旧 step 当当前失败）', () => {
    const doubled =
      'retry1 failure_artifacts: ui_dump=TC-001-step-1.json ' +
      'retry2 failure_artifacts: ui_dump=TC-001-step-9.json';
    assert(parseFailureArtifactsClause(doubled) === null, '双子句应 null（多义禁猜）');
    // 端到端：notes 双子句 → 该 case unjoinable
    const f = setupFixture();
    const trace = JSON.parse(fs.readFileSync(f.tracePath, 'utf-8')) as { cases: Array<{ id: string; notes?: string }> };
    trace.cases[0].notes = doubled;
    fs.writeFileSync(f.tracePath, JSON.stringify(trace), 'utf-8');
    const r = composeOk(f);
    const tc1 = (r as { doc: { cases: Array<{ case_id: string; classification: string }> } }).doc.cases.find(c2 => c2.case_id === 'TC-001')!;
    assert(tc1.classification === 'unjoinable', `双子句应 unjoinable：${JSON.stringify(tc1)}`);
  });

  t('evidence 写入失败 → BLOCKER（review P1：真实安装+run 已成功时不得静默吞）', () => {
    const f = setupFixture();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeDeviceTestEvidenceIfEligible } = require('../../scripts/check-testing') as {
      writeDeviceTestEvidenceIfEligible: (
        ctx: Record<string, unknown>,
        holder: Record<string, unknown>,
        composeFn?: (o: Record<string, unknown>) => unknown,
      ) => Array<{ id: string; severity: string; status: string; details: string }>;
    };
    const savedEnv = {
      MAISON_GOAL_GATE_HARNESS: process.env.MAISON_GOAL_GATE_HARNESS,
      MAISON_GOAL_RUN_ID: process.env.MAISON_GOAL_RUN_ID,
      MAISON_GOAL_ATTEMPT: process.env.MAISON_GOAL_ATTEMPT,
    };
    try {
      process.env.MAISON_GOAL_GATE_HARNESS = '1';
      process.env.MAISON_GOAL_RUN_ID = 'run-1';
      process.env.MAISON_GOAL_ATTEMPT = 'att-1';
      const ctx = {
        projectRoot: f.root, feature: FEATURE, phase: 'testing',
        frameworkRoot: path.resolve(__dirname, '..', '..', '..'),
      };
      const doneHolder = {
        hapPath: f.hapPath, installExecuted: true, installOk: true,
        hapSha256Full: f.hapSha, deviceTestRunExecuted: true, hylyreTracePath: f.tracePath,
      };
      // ① compose 失败（如 HAP 装机后被改写）→ BLOCKER FAIL
      const r1 = writeDeviceTestEvidenceIfEligible(ctx, doneHolder, () => ({ ok: false, reason: 'HAP 被改写' }));
      assert(r1.length === 1 && r1[0].status === 'FAIL' && r1[0].severity === 'BLOCKER',
        `compose 失败须 BLOCKER：${JSON.stringify(r1)}`);
      // ② compose 成功 → PASS 且文件落盘（写到 reports_dir_pattern 解析出的目录）
      const r2 = writeDeviceTestEvidenceIfEligible(ctx, doneHolder, () => composeOk(f));
      assert(r2.length === 1 && r2[0].status === 'PASS', `成功须 PASS：${JSON.stringify(r2)}`);
      // ③ 上游未完成（install 未真实执行）→ []（上游门禁负责，不重复报）
      const r3 = writeDeviceTestEvidenceIfEligible(ctx, { ...doneHolder, installExecuted: false }, () => composeOk(f));
      assert(r3.length === 0, `上游失败不重复报：${JSON.stringify(r3)}`);
      // ④ 普通模式（无 gate 标记）→ []
      delete process.env.MAISON_GOAL_GATE_HARNESS;
      const r4 = writeDeviceTestEvidenceIfEligible(ctx, doneHolder, () => composeOk(f));
      assert(r4.length === 0, `普通模式零变化：${JSON.stringify(r4)}`);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  t('派生计划表格解析：0-based step index 与 selector 提取', () => {
    const steps = parseDerivedPlanSteps(DERIVED_PLAN);
    const tc1 = steps.get('TC-001')!;
    assert(tc1.length === 10, `TC-001 应 10 步，实得 ${tc1.length}`);
    assert(tc1[9].action === 'touch' && tc1[9].selectorKind === 'by_id' && tc1[9].selector === 'hc_bank_row_cmb',
      `step 9 应为 touch by_id hc_bank_row_cmb：${JSON.stringify(tc1[9])}`);
    assert(tc1[3].selectorKind === 'by_text' && tc1[3].selector === '添加管理卡片', JSON.stringify(tc1[3]));
  });

  t('composer 宿主实况：TC-001 三条件齐备 → product_actionable（只认 notes 指名的 step-9）；TC-007 → test_contract', () => {
    const f = setupFixture();
    const r = composeOk(f);
    assert(r.ok, `compose 失败：${(r as { reason?: string }).reason}`);
    const byId = new Map((r as { doc: { cases: Array<{ case_id: string; classification: string; failing_step?: { index: number }; expected_screen?: string }> } }).doc.cases.map(c => [c.case_id, c]));
    const tc1 = byId.get('TC-001')!;
    assert(tc1.classification === 'product_actionable', `TC-001 应 product_actionable：${JSON.stringify(tc1)}`);
    assert(tc1.failing_step?.index === 9, `join 只认 step-9（failure_dir 同时有 step-1/9/10）：${JSON.stringify(tc1.failing_step)}`);
    assert(tc1.expected_screen === 'add_card_home_collapsed', `expected screen 推导：${tc1.expected_screen}`);
    const tc7 = byId.get('TC-007')!;
    assert(tc7.classification === 'test_contract', `TC-007 的 by_text 不在 ui-spec，应 test_contract：${JSON.stringify(tc7)}`);
  });

  t('composer：目标锚点精确在场 → unknown（失败原因非缺失）；其他锚点全缺 → unknown（可能导航错页）', () => {
    const f = setupFixture();
    const runDir = path.dirname(f.tracePath);
    // 目标精确在场
    fs.writeFileSync(path.join(runDir, 'failures', 'TC-001-step-9.json'),
      JSON.stringify({ children: [{ attributes: { id: 'hc_page_title' } }, { attributes: { id: 'hc_bank_row_cmb' } }] }), 'utf-8');
    let r = composeOk(f);
    let tc1 = (r as { doc: { cases: Array<{ case_id: string; classification: string }> } }).doc.cases.find(c => c.case_id === 'TC-001')!;
    assert(tc1.classification === 'unknown', `目标在场应 unknown：${JSON.stringify(tc1)}`);
    // 其他锚点全缺（导航错页形态）
    fs.writeFileSync(path.join(runDir, 'failures', 'TC-001-step-9.json'),
      JSON.stringify({ children: [{ attributes: { id: 'some_other_page' } }] }), 'utf-8');
    r = composeOk(f);
    tc1 = (r as { doc: { cases: Array<{ case_id: string; classification: string }> } }).doc.cases.find(c => c.case_id === 'TC-001')!;
    assert(tc1.classification === 'unknown', `导航错页应 unknown：${JSON.stringify(tc1)}`);
  });

  t('composer：TOCTOU——HAP 在装机后被改写 → 拒绝合成', () => {
    const f = setupFixture();
    fs.writeFileSync(f.hapPath, 'hap-bytes-v2-rewritten', 'utf-8');
    const r = composeOk(f);
    assert(!r.ok, 'HAP 被改写应拒绝合成');
  });

  t('composer：路径逃逸/文件名与 case 不符 → unjoinable', () => {
    const f = setupFixture();
    const trace = JSON.parse(fs.readFileSync(f.tracePath, 'utf-8')) as { cases: Array<{ id: string; notes?: string }> };
    trace.cases[0].notes = 'failure_artifacts: ui_dump=../../../evil-step-9.json';
    trace.cases[6].notes = 'failure_artifacts: ui_dump=TC-999-step-3.json';
    fs.writeFileSync(f.tracePath, JSON.stringify(trace), 'utf-8');
    const r = composeOk(f);
    assert(r.ok, 'compose 本身应成功');
    const cs = (r as { doc: { cases: Array<{ case_id: string; classification: string }> } }).doc.cases;
    assert(cs.find(c => c.case_id === 'TC-001')!.classification === 'unjoinable', '路径逃逸应 unjoinable');
    assert(cs.find(c => c.case_id === 'TC-007')!.classification === 'unjoinable', '文件名不符应 unjoinable');
  });

  t('composer：run 级 device_locked → 全部 environment（结构化来源，禁扫散文）', () => {
    const f = setupFixture();
    const trace = JSON.parse(fs.readFileSync(f.tracePath, 'utf-8')) as Record<string, unknown>;
    trace.run_failure_kind = 'device_locked';
    fs.writeFileSync(f.tracePath, JSON.stringify(trace), 'utf-8');
    const r = composeOk(f);
    const cs = (r as { doc: { cases: Array<{ classification: string }> } }).doc.cases;
    assert(cs.length > 0 && cs.every(c => c.classification === 'environment'),
      `run 级环境失败应全 environment：${JSON.stringify(cs.map(c => c.classification))}`);
  });


  t('归因黄金 fixture：保留完整谓词；跨帧可观测状态优先；无 spec 文本仍是 test_contract', () => {
    const f = setupAttributionGoldenFixture();
    try {
      const planText = fs.readFileSync(path.join(f.reportsDir, '20260729T223800Z', 'hylyre', 'test-plan.hylyre.md'), 'utf8');
      const steps = parseDerivedPlanSteps(planText);
      const tc6 = steps.get('TC-006')![5];
      const tc10 = steps.get('TC-010')![2];
      const allPayloads = [...steps.entries()].filter(([id]) => !['TC-012', 'TC-013', 'TC-090'].includes(id))
        .flatMap(([, caseSteps]) => caseSteps).map(step => step.payload);
      nodeAssert.strictEqual(allPayloads.filter(p => 'enabled' in p).length, 4, 'enabled×4 全量保真');
      nodeAssert.strictEqual(allPayloads.filter(p => 'within' in p).length, 2, 'within×2 全量保真');
      nodeAssert.strictEqual(allPayloads.filter(p => 'scope' in p).length, 5, 'scope×5 全量保真');
      nodeAssert.strictEqual(allPayloads.filter(p => 'timeout' in p).length, 21, 'timeout×21 全量保真');
      nodeAssert.deepStrictEqual(steps.get('TC-013')![0].payload.custom_probe, { mode: 'strict' },
        '解析层不得静默删除未知谓词字段');
      nodeAssert.strictEqual(tc6.payload.enabled, true, 'enabled 必须保留');
      nodeAssert.strictEqual(tc6.payload.timeout, 15, 'timeout 属控制字段但仍必须保留');
      nodeAssert.deepStrictEqual(tc10.payload.within, {
        by_id: 'maison:bc-opencard:card_pack_with_cards:list_card_container',
      }, 'within 必须保留');
      const composed = composeOk(f);
      if (!composed.ok) throw new Error('golden compose 失败：' + composed.reason);
      const byId = new Map(composed.doc.cases.map(c => [c.case_id, c]));
      for (const id of ['TC-006', 'TC-007']) {
        const item = byId.get(id)!;
        nodeAssert.strictEqual(item.classification, 'product_state', id + ' 应由跨帧 enabled=false 判 product_state');
        const drift = item.diagnostics?.find(x => x.code === 'scaffold_contract_drift');
        nodeAssert.ok(drift, id + ' 双命中时 drift 只作 diagnostics');
        nodeAssert.ok(!drift!.message.includes('feature='), id + ' drift 必须是 node 级，不能由 feature 大小写误报');
        const observations = item.evidence?.observations ?? [];
        nodeAssert.ok(observations.length > 0 && observations.every(o => ['TC-010', 'TC-011'].includes(o.case_id)),
          id + ' 必须只引用无 spec selector case 的跨帧 disabled 证据：' + JSON.stringify(item.evidence));
      }
      for (const id of ['TC-010', 'TC-011']) {
        nodeAssert.strictEqual(byId.get(id)?.classification, 'test_contract', id + ' 无 spec 文本依据，不得误判 product_state');
      }
      nodeAssert.strictEqual(byId.get('TC-012')?.classification, 'scaffold_contract_drift',
        '零命中 + 合法 maison anchor 反解不到 ui-spec node，应独立命中纯 drift 分支');
      nodeAssert.ok(byId.get('TC-012')?.reason?.includes('semantic=ghost-node'),
        '纯 drift 必须报告 node 级反解失败，而非 feature 大小写漂移');
      nodeAssert.strictEqual(byId.get('TC-090')?.classification, 'product_actionable',
        'mixed-case 生产 feature 下，spec 可反解节点缺失必须归 product_actionable');
      nodeAssert.strictEqual(byId.get('TC-008')?.classification, 'test_contract',
        '三段 maison 锚点不满足 canonical 语法，仍归 test_contract');
      nodeAssert.ok(!composed.doc.cases.some(c =>
        ['TC-006', 'TC-007', 'TC-010', 'TC-011'].includes(c.case_id)
        && c.classification === 'product_actionable'), 'clipped 帧不得制造元素缺失 product_actionable');
      const fixtureDir = path.resolve(__dirname, '../../../profiles/hmos-app/harness/tests/fixtures/device-attribution');
      const oldBaseline = JSON.parse(fs.readFileSync(
        path.join(fixtureDir, 'device-test-evidence.misclassified.json'), 'utf8',
      )) as { cases: Array<{ case_id: string; classification: string }> };
      nodeAssert.ok(oldBaseline.cases.every(c => c.classification === 'test_contract'),
        '历史误分类档案必须保持全 test_contract，作为反面基线');
      nodeAssert.ok(['TC-006', 'TC-007'].every(id =>
        byId.get(id)?.classification !== oldBaseline.cases.find(c => c.case_id === id)?.classification),
      '新分类结果必须显式推翻 TC-006/007 历史误分类基线');
      const disabledRaw = fs.readFileSync(path.join(
        f.reportsDir, '20260729T223800Z', 'hylyre', 'failures', 'TC-010-step-2.json',
      ), 'utf8');
      nodeAssert.ok(disabledRaw.includes('maison:bc-opencard:card_select:list_card_container'));
      nodeAssert.ok(!disabledRaw.includes('maison:bc-opencard:card_pack_with_cards:list_card_container'),
        'B2 数据事实：异屏同 node 容器存在，目标整锚点不存在；vendor 精确匹配疑点另行移交');
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    }
  });


  t('unverified 无进展熔断：只认相邻同集合；集合变化重置；resume 相邻与自由文案变化仍命中', () => {
    const a = [{ fingerprint: 'stable-A', reason: '文案一' }];
    const aWordingChanged = [{ fingerprint: 'stable-A', reason: '完全不同的自由文案' }];
    const b = [{ fingerprint: 'stable-B' }];
    const ab = [{ fingerprint: 'stable-A' }, { fingerprint: 'stable-B' }];
    const first = evaluateUnverifiedRound(null, 'testing', a);
    nodeAssert.strictEqual(first.repeatedWithoutProgress, false);
    const previousA = { phase: 'testing', fingerprint: first.fingerprint };
    nodeAssert.strictEqual(evaluateUnverifiedRound(previousA, 'testing', aWordingChanged).repeatedWithoutProgress, true,
      'A→A 且自由 reason 变化仍熔断');
    nodeAssert.strictEqual(evaluateUnverifiedRound(previousA, 'testing', ab).repeatedWithoutProgress, false,
      '{A}→{A,B} 不熔断');
    const previousB = {
      phase: 'testing',
      fingerprint: evaluateUnverifiedRound(previousA, 'testing', b).fingerprint,
    };
    nodeAssert.strictEqual(evaluateUnverifiedRound(previousB, 'testing', a).repeatedWithoutProgress, false,
      'A→B→A 不相邻，不熔断');
    nodeAssert.strictEqual(evaluateUnverifiedRound(previousA, 'testing', a).repeatedWithoutProgress, true,
      'resume 从事件恢复上一轮 A 后，相邻 A 应熔断');
    nodeAssert.strictEqual(evaluateUnverifiedRound(previousA, 'review', a).repeatedWithoutProgress, false,
      '跨 phase 不熔断');
  });

  t('collector 宿主实况三集合精确：根缺陷注入 === [TC-001]；TC-007 → unverified(test_contract)；级联零产出', () => {
    const f = setupFixture();
    const ctx = writeEvidence(f);
    const res = collectActionableDefects(f.root, FEATURE, 'run-1', ctx);
    const deviceDefects = res.defects.filter(d => d.source === 'device_test');
    assert(deviceDefects.length === 1 && deviceDefects[0].screen_or_case_id === 'TC-001',
      `注入 coding 数须 === 1 且为 TC-001（根故障数 2 ≠ 可回 coding 数）：${JSON.stringify(deviceDefects.map(d => d.screen_or_case_id))}`);
    assert(deviceDefects[0].fingerprint.includes('TC-001|step:9|by_id:hc_bank_row_cmb'),
      `结构化指纹：${deviceDefects[0].fingerprint}`);
    assert(deviceDefects[0].instructions.some(i => i.includes('hc_bank_row_cmb')), '指令须含目标锚点');
    const unv = res.unverified.filter(u => u.source === 'device_test');
    assert(unv.some(u => u.screen_or_case_id === 'TC-007' && u.reason.includes('test_contract')),
      `TC-007 应 unverified(test_contract)：${JSON.stringify(unv)}`);
    // 级联（TC-002/003/004/006/008）既不产缺陷也不产 unverified
    for (const cascade of ['TC-002', 'TC-003', 'TC-004', 'TC-006', 'TC-008']) {
      assert(!deviceDefects.some(d => d.screen_or_case_id === cascade)
        && !unv.some(u => u.screen_or_case_id === cascade),
        `级联 ${cascade} 不得产出（根修好自然消失）`);
    }
  });


  t('collector physical 三类白名单：product_state/drift 均回 coding，状态+drift 双命中只生成一条', () => {
    const f = setupFixture();
    const ctx = writeEvidence(f, doc => {
      const cases = doc.cases as Array<Record<string, unknown>>;
      const state = cases.find(c => c.case_id === 'TC-001')!;
      state.classification = 'product_state';
      state.reason_code = 'observable_state_mismatch';
      state.reason = '期望 enabled=true，dump 实际 enabled=false';
      state.diagnostics = [{ code: 'scaffold_contract_drift', message: '附注漂移' }];
      const drift = cases.find(c => c.case_id === 'TC-007')!;
      drift.classification = 'scaffold_contract_drift';
      drift.reason_code = 'anchor_spec_node_mismatch';
      drift.reason = 'runtime anchor 无法反解到 ui-spec node';
    });
    const res = collectActionableDefects(f.root, FEATURE, 'run-1', ctx);
    const device = res.defects.filter(d => d.source === 'device_test');
    nodeAssert.deepStrictEqual(device.map(d => d.screen_or_case_id).sort(), ['TC-001', 'TC-007']);
    nodeAssert.strictEqual(device.filter(d => d.screen_or_case_id === 'TC-001').length, 1,
      'product_state + drift diagnostics 禁止同 case 双发 defect');
    nodeAssert.ok(device.find(d => d.screen_or_case_id === 'TC-001')!.instructions
      .some(x => x.includes('enabled=true') && x.includes('enabled=false')),
    'product_state 指引须包含期望谓词与实际属性');
    nodeAssert.ok(device.find(d => d.screen_or_case_id === 'TC-007')!.instructions
      .some(x => x.includes('ui-spec') || x.includes('锚点')),
    'drift 指引须要求修正 ui-spec/锚点派生链');
  });

  t('可信根失败非空且全 test_contract → 精修 kind；混合/绑定失败均不得冒充', () => {
    const f = setupFixture();
    const ctx = writeEvidence(f, doc => {
      const cases = doc.cases as Array<Record<string, unknown>>;
      for (const item of cases) item.classification = 'test_contract';
    });
    const allContract = collectActionableDefects(f.root, FEATURE, 'run-1', ctx);
    assert(allContract.trustedDeviceRootClassifications?.length === 2,
      `应只聚合两个根失败：${JSON.stringify(allContract.trustedDeviceRootClassifications)}`);
    assert(refineFailureKindWithTrustedDeviceEvidence(
      'code_regression', allContract.trustedDeviceRootClassifications,
    ) === 'test_contract', '可信非空全 test_contract 应精修');

    assert(refineFailureKindWithTrustedDeviceEvidence(
      'code_regression', ['test_contract', 'product_actionable'],
    ) === 'code_regression', '混合分类不得精修');
    assert(refineFailureKindWithTrustedDeviceEvidence('code_regression', []) === 'code_regression',
      '空根集合不得精修');
    assert(refineFailureKindWithTrustedDeviceEvidence('toolchain', ['test_contract']) === 'toolchain',
      '只允许窄化 base code_regression');

    const untrusted = collectActionableDefects(f.root, FEATURE, 'run-OTHER', ctx);
    assert(untrusted.trustedDeviceRootClassifications === undefined,
      '身份绑定失败不得暴露可信聚合结论');
    assert(refineFailureKindWithTrustedDeviceEvidence(
      'code_regression', untrusted.trustedDeviceRootClassifications,
    ) === 'code_regression', '绑定失败不得精修');
  });
  t('collector：target_kind 非 physical → product_actionable 也只进 unverified', () => {
    const f = setupFixture();
    const ctx = writeEvidence(f, doc => {
      (doc.device_target as Record<string, unknown>).target_kind = 'emulator';
    });
    ctx.expectedTarget.target_kind = 'emulator';
    const res = collectActionableDefects(f.root, FEATURE, 'run-1', ctx);
    assert(res.defects.filter(d => d.source === 'device_test').length === 0, 'emulator 不得回 coding');
    assert(res.unverified.some(u => u.screen_or_case_id === 'TC-001' && u.reason.includes('非 physical')),
      `TC-001 应 unverified：${JSON.stringify(res.unverified)}`);
  });

  t('collector 绑定校验：run/attempt、设备元组（含 session_id）、trace、时间窗任一不符 → 全部 unverified', () => {
    const f = setupFixture();
    const ctx = writeEvidence(f);
    const doc = JSON.parse(fs.readFileSync(deviceTestEvidencePath(f.reportsDir), 'utf-8')) as DeviceTestEvidenceDoc;
    // run id 不符
    assert(validateDeviceTestEvidenceBinding(doc, 'run-OTHER', ctx) !== null, 'run id 不符须拒');
    // 设备元组：只比 serial 不够——session_id 不同也必须拒
    const ctx2 = { ...ctx, expectedTarget: { ...ctx.expectedTarget, session_id: 'sess-2' } };
    assert(validateDeviceTestEvidenceBinding(doc, 'run-1', ctx2) !== null, 'session_id 不符须拒');
    // 时间窗
    const ctx3 = { ...ctx, harnessWindow: { startMs: Date.now() + 60_000, endMs: Date.now() + 120_000 } };
    assert(validateDeviceTestEvidenceBinding(doc, 'run-1', ctx3) !== null, 'written_at 不在窗口须拒');
    // 全部匹配 → 通过
    assert(validateDeviceTestEvidenceBinding(doc, 'run-1', ctx) === null, '全匹配应通过');
    // collector 端到端：run id 不符 → TC-001 进 unverified 不进 defects
    const res = collectActionableDefects(f.root, FEATURE, 'run-OTHER', ctx);
    assert(res.defects.filter(d => d.source === 'device_test').length === 0, '绑定失败不得产缺陷');
    assert(res.unverified.some(u => u.source === 'device_test' && u.reason.includes('身份不匹配')),
      JSON.stringify(res.unverified));
  });

  t('collector：install_executed=false（reuse 自证形态）→ unverified；evidence 缺失 → 无 device 信号', () => {
    const f = setupFixture();
    const ctx = writeEvidence(f, doc => {
      doc.install_executed = false;
    });
    const res = collectActionableDefects(f.root, FEATURE, 'run-1', ctx);
    assert(res.defects.filter(d => d.source === 'device_test').length === 0, 'reuse 不得作证');
    assert(res.unverified.some(u => u.reason.includes('真实安装')), JSON.stringify(res.unverified));
    // evidence 缺失
    fs.rmSync(deviceTestEvidencePath(f.reportsDir), { force: true });
    const res2 = collectActionableDefects(f.root, FEATURE, 'run-1', ctx);
    assert(res2.defects.filter(d => d.source === 'device_test').length === 0
      && res2.unverified.filter(u => u.source === 'device_test').length === 0,
      '缺 evidence = 无 device 信号（门禁失败路径自会接管），不制造噪音');
  });

  return cases;
}

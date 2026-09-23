// ============================================================================
// real-chain.unit.test.ts — plan d4a1f7c3 §4 正例：确定性输入下的生产验证链集成回归
// ----------------------------------------------------------------------------
// 口径见 plan §1.1：真实的是 goal 编排 + 六阶段真实检查 + 全部派生产物；
// 替身的是**整个作者调用**、UT 执行、设备/视觉 provider、OCR。
// 判据（§4.5）：六阶段逐个 `summary.verdict === 'PASS'` 且 fresh、每阶段 closed、
// 回执由生产 `projectReceiptAfterClosure` 投影生成。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';
import {
  provisionRealChainProject,
  scaffoldRealChainHost,
  writeHostFile,
  REAL_CHAIN_REQUIREMENT,
  REAL_CHAIN_SOURCE,
  REAL_CHAIN_SOURCE_2,
  REAL_CHAIN_MODEL,
  REAL_CHAIN_SERVICE,
  REAL_CHAIN_INDEX,
  REAL_CHAIN_NEW_SOURCE,
  REAL_CHAIN_TEST,
  type RealChainProject,
} from '../utils/real-chain-host';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache } from '../../config';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import * as YAML from 'yaml';
import { fixture as seedChangeUnitBlueprint } from './blueprint-skill-projection.unit.test';
import { rewriteBlueprint } from './change-unit-progression.unit.test';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { validateChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { asRecord, type BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import type { ContractsSpec } from '../../scripts/utils/types';

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>): void { cases.push({ name, run }); }
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const DEBUG = process.env.REAL_CHAIN_DEBUG === '1';

/** §8：判据面不设任何可缩小的开关——六阶段是常量，不接受 env 收窄。 */
const PHASES = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as const;

// P0 交互链的身份（acceptance checkpoint / ui-spec / 派生计划 / trace 四处必须逐字同一）。
const SCREEN_LIST = 'all_banks';
const SCREEN_ENTRY = 'open_card_entry';
const EL_BANK_ROW = 'bank_row_cmb';
const EL_ENTRY_TITLE = 'open_card_title';
/** 派生计划落在 testing/reports/<timestamp>/hylyre/（check-testing.ts:4183 只认这个形状）。 */
const DERIVED_RUN_STAMP = '20260101T000000Z';

interface Summary {
  verdict?: string;
  closure_status?: string;
  receipt_status?: string;
  source_commit_sha?: string;
  blockers?: Array<{ id?: string; check_id?: string; detail?: string; details?: string; affected_files?: string[] }>;
  checks?: Array<{ id?: string; status?: string; severity?: string; details?: string }>;
  verifier_subject_id?: string;
  next_action?: string;
}

export function readSummary(p: RealChainProject, phase: string): Summary | null {
  const abs = path.join(p.root, 'doc/features', p.feature, phase, 'reports', 'summary.json');
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as Summary;
}

export function dumpPhase(p: RealChainProject, phase: string): string {
  const s = readSummary(p, phase);
  if (!s) return `${phase}: <no summary>`;
  const reportPath = path.join(p.root, 'doc/features', p.feature, phase, 'reports', 'script-report.json');
  let failing: string[] = [];
  if (fs.existsSync(reportPath)) {
    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as Summary;
    failing = (rep.checks ?? [])
      .filter(c => c.status === 'FAIL' || c.status === 'WARN')
      .map(c => `${c.status}/${c.severity} ${c.id}: ${(c.details ?? '').slice(0, 220)}`);
  }
  return [`${phase}: verdict=${s.verdict} next=${s.next_action}`, ...failing.map(l => '    ' + l)].join('\n');
}

/**
 * §4.3 末「verifier 时序与替身性质」：① 本阶段 harness 跑完把 `verifier_subject_id` 写进
 * summary.json → ② verifier 就该 subject 出一份 md → ③ `check-receipt` 读它
 * （check-receipt.ts:777-781 `verifier_evidence_report_missing`）。
 * verifier 的回复本身也是确定性替身，报告须含**恰好一个**终态块
 * （verifier-evidence.ts:246-252）。subject 从盘上真 summary 读，**不改 summary 字节**（§4.4 第 5 条）。
 */
export function publishVerifier(p: RealChainProject, phase: string): void {
  const reportsDir = path.join(p.root, 'doc/features', p.feature, phase, 'reports');
  const s = readSummary(p, phase);
  const subjectId = s?.verifier_subject_id;
  if (!subjectId) return;
  publishFixtureVerifierEvidence({
    projectRoot: p.root, reportsDir, feature: p.feature, phase, subjectId,
    reportText: `# verifier — ${p.feature} / ${phase}\n\n语义一致性复核通过。\n`,
    skipSummaryPatch: true,
  });
}

// ---------------------------------------------------------------------------
// §4.3 作者材料（每行注释标明哪个生产检查要求它 + 该检查 id）
//
// **档位表态（§4.3 要求正例表态一次、三处同步）**：需求文本无强 1:1 措辞，
// `resolveFidelityTarget` 判 `semantic_layout`，`capability_spec_visual_reference`
// 因此判 `not_applicable`。由此，下列条件性材料**本链不触发、不覆盖**：
//   · `ux-reference/*.png` 权威图（§4.1）——视觉义务非 required；
//   · `plan/visual-parity.yaml`（plan-visual-parity-check.ts:69-76：ui-spec 的屏都不是 P0，
//     `collectP0ComponentNodeIds` 为空即不触发硬地板）；
//   · `spec/ref-elements.yaml`（capture-completeness-check.ts:84-89：非 hard pixel 走宽松分支）；
//   · `coding/structure-conformance.yaml`（structure-ledger.ts:167-170：ui-spec 无结构声明即不触发）；
//   · review 报告的四类视觉证据在非 pixel 档只需命中 1 类（check-review.ts:873）——下面四类全引只为稳。
// **`spec/ui-spec.yaml` 本链必须写**（与上一笔记录相反）：testing 的 P0 语义门
// `p0-semantic-gates.ts:721-735` 在 ui-spec 不可解析时直接 gateFailure
// 「canonical ui-spec 不可解析」，与保真档位无关。它不声明 `ui_change`，故
// `spec-ui-spec-check.ts:71-75` 的 `ui_spec_structure` 仍不进（enforcement 未配置即返回 []）。
// `architecture.md` 同步同样免除：plan.md 声明 `impact: none`，
// check-plan.ts:909-914 的 `plan_to_architecture` 直接 SKIP，**架构变更分支不覆盖**。
// ---------------------------------------------------------------------------

export function writeSpecMaterials(p: RealChainProject): void {
  const f = p.feature;
  // spec.md：check-spec 的 required_chapters / feature_table_format(:674-681) /
  // scope_declaration / terminology_mapping_table / mermaid_flowchart 五门的正文载体。
  writeHostFile(p.root, `doc/features/${f}/spec/spec.md`, [
    '# 银行卡开卡 spec',
    '',
    // metadata_header（check-spec.ts:860-867，MINOR）：`> **字段**: 值` 四行。
    `> **模块标识**: ${p.module}`,
    '> **版本**: 1.0',
    '> **创建日期**: 2026-01-01',
    '> **状态**: 已评审',
    '',
    '## 0. 术语映射表',
    '',
    '| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |',
    '|----------|----------|--------|--------|--------|---------|',
    `| 银行卡 | ${p.module} | 02-Feature | high | — | [x] |`,
    '',
    '## 1. 功能概述',
    '',
    '全部银行页展示可开卡银行列表，点击进入开卡流程。',
    '',
    '## 2. Scope 声明',
    '',
    '```yaml',
    'in_scope_modules:',
    `  - ${p.module}`,
    'out_of_scope_modules: []',
    'rationale: 开卡流程只涉及 FinancialCard 模块',
    '```',
    '',
    '## 3. 目标用户与使用场景',
    '',
    '| 字段 | 取值 |',
    '|------|------|',
    '| 用户 | 个人客户 |',
    '',
    '## 4. 功能清单',
    '',
    '| 编号 | 功能名称 | 优先级 | 描述 |',
    '|------|---------|--------|------|',
    '| F1 | 银行列表展示 | P0 | 展示可开卡银行 |',
    '| F2 | 开卡入口 | P1 | 进入开卡流程 |',
    '',
    '## 5. 页面/界面描述',
    '',
    // page_description_completeness（check-spec.ts:824-843，MAJOR）：须有页面子章节，
    // 且每个子章节内的表格含「组件 / 类型 / 交互行为」三列。
    '### 5.1 全部银行页',
    '',
    '| 组件 | 类型 | 交互行为 |',
    '|------|------|----------|',
    '| 页面标题 | Text | 无 |',
    '| 银行列表 | List | 点击进入开卡流程 |',
    '',
    '## 6. 业务流程图',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[进入全部银行页] --> B[选择银行]',
    '  B --> C[进入开卡流程]',
    '```',
    '',
    '## 7. 异常/边界场景处理',
    '',
    // exception_table_format（:782 三列）+ minimum_exception_scenarios（:798 ≥3 行），均 MAJOR。
    '| 编号 | 异常场景 | 处理方式 |',
    '|------|----------|----------|',
    '| E1 | 列表为空 | 展示空态提示 |',
    '| E2 | 网络失败 | 展示重试按钮 |',
    '| E3 | 银行不可开卡 | 条目置灰并提示 |',
    '',
    '## 8. 非功能性需求',
    '',
    '列表首屏加载 < 500ms。',
    '',
    '## 9. 验收标准',
    '',
    '**AC-1** (F1): 银行列表可展示且可测试。',
    '**AC-2** (F2): 开卡入口可点击且可测试。',
    '',
  ].join('\n'));

  // acceptance.yaml：下游 UT 范围与 P0/AC 覆盖分母来源；`ut_layer ∈ {unit,both}`
  // 决定 check-ut 的 testability-audit / coverage-evidence 两门是否强制（check-ut.ts:3518/:2884）。
  //
  // AC-1 是 **P0 device 交互型**（`isP0DeviceInteractive`：P0 + ut_layer∈{device,both} + linked_flow），
  // 因此同时进三道门：spec 期 `acceptance_flow_structure`（checkpoint 完整 + 引文验存 +
  // flows 每条边有 P0 AC 拥有，p0-semantic-gates.ts:132-210）、testing 期
  // `p0_coverage_integrity` / `p0_semantic_coverage_integrity`（按 checkpoint 的
  // action/required 元素逐条对账派生计划步骤与 native StepResult，:576-645）。
  writeHostFile(p.root, `doc/features/${f}/acceptance.yaml`, [
    `feature: ${f}`,
    'source: approved',
    "version: '1'",
    'flows:',
    `  open_card: [${SCREEN_LIST}, ${SCREEN_ENTRY}]`,
    'criteria:',
    '  - id: AC-1',
    '    feature: F2',
    '    description: 点击银行条目进入开卡流程',
    '    target: 银行条目',
    '    priority: P0',
    '    testable: true',
    '    verification_steps:',
    '      - 在全部银行页点击银行条目',
    '    expected_result: 进入开卡流程页',
    // **device 而不是 both**（1.2 下的实测约束）：`checkAcceptanceLinkedUseCases`
    //（check-acceptance.ts:286-292，经 `checkTypedConstructionContent` 在 plan 期执行）
    // 要求带 `linked_flow` 的 **unit 层** AC 必须能在 `use-cases.yaml` 里解析到同名 flow。
    // 本链不产出 use-cases.yaml（见文件头「档位与材料表态」），故 AC-1 只留 device 层：
    // `isP0DeviceInteractive`（p0-semantic-gates.ts:99-102）认 `device|both`，P0 三道重门不受影响；
    // unit 侧的 testability-audit / coverage-evidence / mock-plan 由 AC-2（both）继续驱动。
    '    ut_layer: device',
    // acceptance_device_focus_present（BLOCKER）：ut_layer=both 须同时给 device_focus。
    '    device_focus: 真机点击银行条目核对跳转开卡流程',
    '    linked_flow: open_card',
    '    checkpoint:',
    `      pre_screen: ${SCREEN_LIST}`,
    '      action:',
    '        type: touch',
    `        target_element_id: ${EL_BANK_ROW}`,
    `      post_screen: ${SCREEN_ENTRY}`,
    '      required_element_ids:',
    `        - ${EL_ENTRY_TITLE}`,
    '    requirement_ref:',
    `      source_path: doc/features/${f}/requirements/requirement.md`,
    '      snippet: 点击银行条目进入开卡流程',
    '  - id: AC-2',
    '    feature: F1',
    '    description: 银行列表展示',
    '    target: 银行列表',
    '    priority: P1',
    '    testable: true',
    '    verification_steps:',
    '      - 打开全部银行页',
    '    expected_result: 列表展示银行条目',
    '    ut_layer: both',
    '    ut_focus: AllBanksPage 列表渲染',
    '    device_focus: 真机打开全部银行页核对列表渲染',
    'boundaries: []',
    '',
  ].join('\n'));

  // ui-spec.yaml：canonical selector 索引的唯一来源（testing 的 P0 语义门与
  // `selector-contract.ts:149-239` 的静态 selector lint 都读它）。
  // 两屏都声明 P1：`collectP0ComponentNodeIds` 因此为空，plan 期 visual-parity 硬地板不触发
  //（见文件头「档位表态」）。
  writeHostFile(p.root, `doc/features/${f}/spec/ui-spec.yaml`, [
    'schema_version: "1.0"',
    `feature: ${f}`,
    'screens:',
    `  - id: ${SCREEN_LIST}`,
    '    priority: P1',
    '    root:',
    '      type: navigation_frame',
    '      order: 0',
    '      children:',
    `        - id: ${EL_BANK_ROW}`,
    '          type: list_item',
    '          order: 0',
    '          text: 招商银行',
    `  - id: ${SCREEN_ENTRY}`,
    '    priority: P1',
    '    root:',
    '      type: navigation_frame',
    '      order: 0',
    '      children:',
    `        - id: ${EL_ENTRY_TITLE}`,
    '          type: text',
    '          order: 0',
    '          text: 开卡申请',
    'tokens: {}',
    'assets: []',
    '',
  ].join('\n'));

  writeFacts(p, 'spec');
}

/**
 * `context/facts.md`：研究事实表，字段须经得起 `assertFactsSourceReadable` 真实校验。
 * 三条 BLOCKER 门（`context_exploration_gate`）按阶段取不同下界——plan 档要求
 * `min_source_code_paths: 5` / `min_code_facts: 5` / `min_files_inspected: 8` /
 * `min_searches: 5`（`specs/phase-rules/plan-rules.yaml:71-74`），故各阶段统一按最严的一档写。
 * **不写 `frozen_scope_fingerprint`**——指纹属 §4.4 第 1 条禁止手填项，由生产冻结链产出。
 */
function writeFacts(p: RealChainProject, phase: string): void {
  // coding 落盘之后，`BankListItem.ets` 成为**当前**解析目标（它在 contracts.files 里且已存在），
  // 于是从 coding 起每个阶段的 facts 都必须承接它。它不能进 frontmatter 的 source_code_paths：
  // 那是 baseline 段，改了就让 spec/plan 已闭环的 facts 证据真失效（`factsBaselineFingerprint`）。
  // 正解与真实 agent 一致——写进**本阶段的 delta 表**（`context_exploration_facts_scope_coverage`
  // 认 `declared ∪ 本阶段 delta 表的「路径」列`，context-facts.ts:231-241）。
  const deltaRows: Array<[string, string, string]> = fs.existsSync(path.join(p.root, REAL_CHAIN_NEW_SOURCE))
    ? [[REAL_CHAIN_NEW_SOURCE, 'coding 新建的列表条目组件', '本阶段按它继续']]
    : [];
  const rows: Array<[string, string, string]> = [
    [REAL_CHAIN_SOURCE, 'AllBanksPage 目前只渲染标题文本', '列表需新增'],
    [REAL_CHAIN_SOURCE_2, 'BankRepository.list 返回空数组', '列表数据源需接入'],
    [REAL_CHAIN_MODEL, 'BankModel 已定义银行字段', '列表条目直接复用'],
    [REAL_CHAIN_SERVICE, 'BankService 暴露 openCard 入口', '点击回调接它'],
    [REAL_CHAIN_INDEX, 'index.ets 已导出 AllBanksPage', '新增组件需同步导出'],
  ];
  // workflow 1.2（obligation-driven，与真实宿主同模式）对建立事实有两条硬要求：
  //   · `schema_version: "1.1"`——capability-resolution-entry-input.ts:290 在
  //     「本阶段即建立阶段且是链首」时直接抛 `current establishing facts require schema 1.1`；
  //     context-facts.ts:198 同判据以 BLOCKER 复核。
  //   · run 载体的**身份位** `run_id`——context-facts.ts:203-205 /
  //     capability-resolution-entry-input.ts:329-332（`record.run_id !== goalRunId` 即
  //     `facts input identity mismatch: invocation`）。它是 agent 手上的调用身份，不是指纹。
  // 无 run 时**不写** run_id：那条路的身份位是冻结范围指纹（context-facts.ts:206-210），
  // 而指纹属 §4.4 第 1 条禁止手填项——所以本夹具不产出 runless 的 facts，
  // runless 用例（RC-2）在造完材料后直接删掉这份文件。
  // phase_delta 段**累积**，不是每阶段重写一份。真实 agent 是追加一节（P1-T12
  // `standalone-coding-review.unit.test.ts` 同形：`appendFileSync('## phase_delta: coding …')`），
  // 生产的 facts 证据哈希正是按这个形状分段的：`factsPhaseFingerprint`（context-facts.ts:93）
  // = [baseline（首个 `## phase_delta:` 之前的全部）, 本阶段 delta 段]。删掉上游阶段的 delta 段
  // 会让上游那条 facts 证据**真的**失效（spec 闭环记的是 spec 段），本夹具此前整文件重写、
  // 把 spec 段替换成 plan 段，于是 plan 期 spec 证据判 stale。这是夹具与真实 agent 的行为差，
  // 不是生产缺陷：写法改对后上游段原样保留，baseline 段逐字不变。
  const factsRel = `doc/features/${p.feature}/context/facts.md`;
  const factsAbs = path.join(p.root, factsRel);
  const priorDeltas = fs.existsSync(factsAbs)
    ? fs.readFileSync(factsAbs, 'utf-8').split(/(?=^##\s*phase_delta:)/m).slice(1)
      .filter(section => !new RegExp(`^##\\s*phase_delta:\\s*${phase}\\b`).test(section))
    : [];
  writeHostFile(p.root, factsRel, [
    '---',
    'schema_version: "1.1"',
    `feature: ${p.feature}`,
    ...(p.runId ? [`run_id: ${p.runId}`] : []),
    // context_exploration_facts_established_by_invalid（BLOCKER）：full track 恒为 "spec"。
    'established_by: spec',
    'ready_to_produce: true',
    'has_blocker_coverage_risk: false',
    'exploration_mode: sequential',
    // context_exploration_inputs_coverage（BLOCKER）：须覆盖 glossary / catalog / architecture 三类可匹配项。
    'key_inputs_read:',
    '  - doc/glossary.yaml',
    '  - doc/module-catalog.yaml',
    '  - doc/architecture.md',
    'subagents_used: none',
    'decisions_unlocked:',
    '  - all_banks_page_list',
    'files_inspected_count: 9',
    'searches_performed_estimate: 6',
    // context_exploration_source_code_paths_min（BLOCKER）：纯相对路径，plan 档 ≥5。
    'source_code_paths:',
    ...rows.map(r => `  - ${r[0]}`),
    '---',
    '',
    '## Code Facts',
    '',
    // context_exploration_code_facts_min（BLOCKER）：Code Facts 表格行数，plan 档 ≥5。
    '| 路径 | 事实 | 对本阶段影响 |',
    '|------|------|--------------|',
    ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
    '',
    ...priorDeltas.map(section => section.replace(/\s*$/, '\n')),
    `## phase_delta: ${phase}`,
    '',
    '本阶段研究结论已确认。',
    '',
    ...(deltaRows.length ? [
      '| 路径 | 事实 | 对本阶段影响 |',
      '|------|------|--------------|',
      ...deltaRows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
      '',
    ] : []),
  ].join('\n'));
}

export function writePlanMaterials(p: RealChainProject): void {
  const f = p.feature;
  writeFacts(p, 'plan');
  // contracts.yaml：W1 的正例面——`files` **同时**含既有文件与待创建文件
  //（6f2a9c41 F13：plan 起步无写集时源码读集不得把待创建文件判 absent）。
  writeHostFile(p.root, `doc/features/${f}/contracts.yaml`, [
    `feature: ${f}`,
    'source: approved',
    "version: '1'",
    'modules:',
    `  - name: ${p.module}`,
    '    layer: 02-Feature',
    `    package_path: ${p.modulePath}`,
    'files:',
    `  - ${REAL_CHAIN_SOURCE}`,
    `  - ${REAL_CHAIN_SOURCE_2}`,
    `  - ${REAL_CHAIN_MODEL}`,
    `  - ${REAL_CHAIN_SERVICE}`,
    `  - ${REAL_CHAIN_INDEX}`,
    // 待创建文件（coding 阶段才落盘）——W1 的正例面：plan 起步无写集时它必须不被判 absent。
    // UT 测试文件**不入 contracts.files**：check-coding 的 `file_completeness` /
    // `plan_file_to_code` 要求 contracts 里每个文件在 coding 收尾时就在盘上，
    // 而测试文件按阶段归属由 ut 阶段写。
    `  - ${REAL_CHAIN_NEW_SOURCE}`,
    'module_dependencies: {}',
    'data_models: []',
    'interfaces: []',
    'components: []',
    'prd_to_code_traceability:',
    '  - prd_id: AC-1',
    '    key_files:',
    `      - ${REAL_CHAIN_SOURCE}`,
    '  - prd_id: AC-2',
    '    key_files:',
    `      - ${REAL_CHAIN_SERVICE}`,
    '',
  ].join('\n'));

  // plan.md：check-plan.ts:226-247 `required_chapters` 列的九个章节（含「功能映射表」），
  // 外加 `架构影响声明`（:119 `parseArchitectureImpact`，impact=none 时
  // :909-914 的 `plan_to_architecture` 直接 SKIP——**架构变更分支本链不覆盖**）。
  writeHostFile(p.root, `doc/features/${f}/plan/plan.md`, [
    '# 银行卡开卡 plan',
    '',
    `> **模块标识**: ${p.module}`,
    '> **版本**: 1.0',
    '> **创建日期**: 2026-01-01',
    '> **状态**: 已评审',
    `> **对应 spec**: doc/features/${f}/spec/spec.md`,
    '',
    '## 1. Scope 声明与继承',
    '',
    '```yaml',
    'in_scope_modules:',
    `  - ${p.module}`,
    'out_of_scope_modules: []',
    'rationale: 开卡流程只涉及 FinancialCard 模块',
    '```',
    '',
    '## 2. 架构影响声明',
    '',
    '```yaml',
    'impact: none',
    'affected_items: []',
    'architecture_md_updates: []',
    'catalog_updates: []',
    '```',
    '',
    '## 3. 模块架构图',
    '',
    '```mermaid',
    'flowchart TD',
    '  AllBanksPage --> BankService',
    '  BankService --> BankRepository',
    '```',
    '',
    // module_change_table（BLOCKER）：四列「模块 / 所属层 / 格式 / 变更类型」。
    '### 3.1 模块变更表',
    '',
    '| 模块 | 所属层 | 格式 | 变更类型 | 说明 |',
    '|------|--------|------|----------|------|',
    `| ${p.module} | 02-Feature | HAR | 修改 | 新增银行列表条目组件 |`,
    '',
    '## 4. 目录/文件结构规划',
    '',
    `### 4.1 ${p.module}`,
    '',
    // file_structure_per_module（BLOCKER，check-plan.ts:484-488）：子章节内须有含
    // 树形符号或 `.ets`/`.json` 的代码块。
    '```',
    `${p.modulePath}/`,
    '└── src/main/ets/',
    '    ├── AllBanksPage.ets',
    '    ├── BankService.ets',
    '    └── BankListItem.ets',
    '```',
    '',
    '| 文件路径 | 职责 | 新增/修改 |',
    '|----------|------|-----------|',
    // mapping_to_file（BLOCKER）：功能映射表里的关键文件须在本表出现。
    `| ${REAL_CHAIN_SOURCE} | 页面容器 | 修改 |`,
    `| ${REAL_CHAIN_SERVICE} | 开卡服务 | 修改 |`,
    `| ${REAL_CHAIN_NEW_SOURCE} | 列表条目组件 | 新增 |`,
    '',
    '## 5. 数据模型定义',
    '',
    // data_model_typed（BLOCKER）：本章须有含 interface/class/enum 的代码块。
    '```typescript',
    'export interface BankModel {',
    '  id: string;',
    '  name: string;',
    '}',
    '```',
    '',
    '| 模型 | 字段 | 类型 | 说明 |',
    '|------|------|------|------|',
    '| BankModel | id | string | 银行标识 |',
    '| BankModel | name | string | 银行名称 |',
    '',
    '## 6. 页面组件树',
    '',
    '### 6.1 全部银行页',
    '',
    '```',
    'AllBanksPage',
    '└── BankListItem',
    '```',
    '',
    '| 组件 | 父组件 | 职责 |',
    '|------|--------|------|',
    '| AllBanksPage | — | 页面容器 |',
    '| BankListItem | AllBanksPage | 单条银行 |',
    '',
    '## 7. 状态管理方案',
    '',
    // state_management_table（MAJOR）：须含「数据」列。
    '| 数据 | 状态 | 作用域 | 装饰器 | 说明 |',
    '|------|------|--------|--------|------|',
    '| 银行列表 | banks | AllBanksPage | @State | 银行列表数据 |',
    '',
    '## 8. 服务层接口定义',
    '',
    // interface_signatures_complete（BLOCKER）：本章须有代码块。
    '```typescript',
    'export class BankService {',
    '  openCard(id: string): Promise<boolean>;',
    '}',
    'export class BankRepository {',
    '  list(): string[];',
    '}',
    '```',
    '',
    '| 接口 | 签名 | 说明 |',
    '|------|------|------|',
    '| BankService.openCard | `openCard(id: string): Promise<boolean>` | 发起开卡 |',
    '| BankRepository.list | `list(): string[]` | 读取银行列表 |',
    '',
    '## 9. 路由/导航设计',
    '',
    '| 路由 | 目标页面 | 触发 |',
    '|------|----------|------|',
    '| /open-card | 开卡流程页 | 点击银行条目 |',
    '',
    '## 10. 功能映射表',
    '',
    // spec_mapping_table（BLOCKER）：须含「spec 编号 / 功能名称 / 优先级 / 实现模块 / 关键文件」。
    '| spec 编号 | 功能名称 | 优先级 | 实现模块 | 关键文件 | 验收编号 |',
    '|-----------|----------|--------|----------|----------|----------|',
    `| F1 | 银行列表展示 | P0 | ${p.module} | ${REAL_CHAIN_NEW_SOURCE} | AC-1 |`,
    `| F2 | 开卡入口 | P1 | ${p.module} | ${REAL_CHAIN_SERVICE} | AC-2 |`,
    '',
  ].join('\n'));

}

/** coding 阶段产出物本体：新增列表条目组件并在页面里接上（真实写盘，供下游新鲜度消费）。 */
export function writeCodingMaterials(p: RealChainProject): void {
  writeHostFile(p.root, REAL_CHAIN_NEW_SOURCE, [
    "import { BankModel } from './BankModel';",
    '',
    '@Component',
    'export struct BankListItem {',
    '  @Prop bank: BankModel;',
    '  build() {',
    '    Text(this.bank.name)',
    '  }',
    '}',
    '',
  ].join('\n'));
  writeHostFile(p.root, REAL_CHAIN_SOURCE, [
    "import { BankListItem } from './BankListItem';",
    "import { BankRepository } from './BankRepository';",
    '',
    '@Component',
    'export struct AllBanksPage {',
    '  @State banks: string[] = new BankRepository().list();',
    '  build() {',
    '    Column() {',
    '      Text("全部银行")',
    '      ForEach(this.banks, (b: string) => {',
    '        BankListItem({ bank: { id: b, name: b } })',
    '      })',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'));
  writeHostFile(p.root, REAL_CHAIN_INDEX, [
    "export { AllBanksPage } from './src/main/ets/AllBanksPage';",
    "export { BankListItem } from './src/main/ets/BankListItem';",
    '',
  ].join('\n'));
  // facts 放在产物之后写：本阶段的 delta 表要承接刚落盘的新目标（见 writeFacts）。
  writeFacts(p, 'coding');
}

/**
 * review 阶段产出物本体（§4.3「review 报告依据」）：
 * - 六组规定章节（check-review.ts:110-116 `checkRequiredChapters` 的 `expectedPairs`）；
 * - 「问题清单」章节须有表格（:149 `checkIssueTableFormat`）；
 * - 可机读裁决声明行 `**审查结论**: 通过`（:538 `checkConclusionWithVerdict`，:556 格式示例）
 *   ——必须写「通过」，否则 :1152 `checkNegativeVerdictClosure` / :1184
 *   `checkConditionalPassClosure` 会阻断闭环，§4.5 的 PASS+closed 不可能达成；
 * - 「视觉保真」维度 + 四类视觉证据引用（:836-843 `VISUAL_REVIEW_EVIDENCE`，:873
 *   非 pixel 档至少命中 1 类）——本链是 `semantic_layout`（需求文本无强 1:1 措辞），
 *   故四类全引只是为了稳，pixel 专属硬地板不适用。
 */
export function writeReviewMaterials(p: RealChainProject): void {
  writeFacts(p, 'review');
  // canonical 路径是 `review/review-report.md`；写旧路径会得到 legacy_read_… MAJOR WARN。
  writeHostFile(p.root, `doc/features/${p.feature}/review/review-report.md`, [
    '# 审查报告',
    '',
    `> **模块标识**: ${p.module}`,
    '> **审查日期**: 2026-01-01',
    '> **审查版本**: 1.0',
    '> **保证等级**: standard',
    '',
    '## 1. 审查范围',
    '',
    `模块：${p.module}。文件范围：`,
    '',
    // `review_scope_to_design`（check-review.ts:755-762）比对的是**解析后的 code 输入全量**
    // （`reviewTargetFiles` → `resolvedInputs.values.code`），1.2 下它就是冻结范围的源码读集
    // ——不是"agent 觉得自己改了哪几个"。全部列出。
    `- ${REAL_CHAIN_SOURCE}`,
    `- ${REAL_CHAIN_SOURCE_2}`,
    `- ${REAL_CHAIN_MODEL}`,
    `- ${REAL_CHAIN_SERVICE}`,
    `- ${REAL_CHAIN_NEW_SOURCE}`,
    `- ${REAL_CHAIN_INDEX}`,
    '',
    '## 2. 审查维度',
    '',
    '| 维度 | 结论 |',
    '|------|------|',
    '| 契约一致性 | 通过 |',
    '| 视觉保真 | 通过（asset-crop-validation 与 contact-sheet 无裁剪告警；可见文案 diff 无差异；'
      + 'structure-conformance 台账逐条复核已打开 implemented_by 源码确认；must_have_elements 全覆盖） |',
    '',
    '## 3. 问题清单',
    '',
    // issue_table_format（BLOCKER）：须含「分类 / 问题描述 / 涉及文件 / 修复建议」四列。
    '| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |',
    '|------|------|----------|----------|----------|----------|',
    `| R-1 | 可读性 | MINOR | 组件缺少用途注释 | ${REAL_CHAIN_NEW_SOURCE} | 补充组件用途注释 |`,
    '',
    '## 4. 问题统计',
    '',
    '| 严重程度 | 数量 |',
    '|----------|------|',
    '| BLOCKER | 0 |',
    '| MAJOR | 0 |',
    '| MINOR | 1 |',
    '',
    '## 5. 修复建议',
    '',
    '- R-1：在下一次迭代补充注释，不阻断本次交付。',
    '',
    '## 6. 结论',
    '',
    '**审查结论**: 通过',
    '',
  ].join('\n'));
}

/**
 * ut 阶段作者材料（§4.3 三行 + 一条条件性）：
 * - UT 测试文件本体——W3/RC-3 的正例面就是让它在链上真写一次；
 * - `testability-audit.md`：check-ut.ts:3518（acceptance 有 `ut_layer∈{unit,both}` 即不 SKIP）、
 *   :3552-3561（须覆盖**全部** unit/both AC/BD，否则 BLOCKER）；
 * - `coverage-evidence.json`：check-ut.ts:2884（`listUnitBothScopeItems` 非空即进门）、
 *   :2996-3004（P0/P1 unit/both 的 mapping 须完整且有依据，BLOCKER）；
 * - `mock-plan.yaml`：**本链走 mock-plan 分支，不走免除**（plan §4.3 的「全 pure 免除」
 *   只是推荐；实跑证明 L1 记录仍进 `auditRecordsNeedMockPlan`（check-ut.ts:3466-3472）
 *   并由 :3670-3675 判 BLOCKER）。故为 AC-2 的非 pure 依赖 `BankRepository` 声明一个 spy
 *   （:3694-3699 要求每个非 pure 依赖都有同名 `target_class`）。
 */
export function writeUtMaterials(p: RealChainProject): void {
  writeFacts(p, 'ut');
  // 每个 it() 至少两次 expect：无 use-cases.yaml 时 `checkItDrivesFlow`（check-ut.ts:2236-2243）
  // 退化为"≥2 expect"的基础健康度，一次 expect 会吃 MAJOR WARN（空壳用例）。
  writeHostFile(p.root, REAL_CHAIN_TEST, [
    "import { describe, it, expect } from '@ohos/hypium';",
    "import { BankRepository } from '../../../main/ets/BankRepository';",
    "import { BankService } from '../../../main/ets/BankService';",
    '',
    "describe('AllBanksPage', () => {",
    "  it('[AC-1] 开卡入口', 0, async () => {",
    '    const service: BankService = new BankService();',
    "    const opened: boolean = await service.openCard('cmb');",
    '    expect(opened).assertTrue();',
    "    const rejected: boolean = await service.openCard('');",
    '    expect(rejected).assertFalse();',
    '  });',
    "  it('[AC-2] 银行列表展示', 0, () => {",
    '    const repo: BankRepository = new BankRepository();',
    '    const banks: string[] = repo.list();',
    '    expect(banks).not().assertNull();',
    '    expect(banks.length).assertEqual(0);',
    '  });',
    '});',
    '',
  ].join('\n'));
  writeHostFile(p.root, `doc/features/${p.feature}/ut/testability-audit.md`, [
    '# 可测性审计',
    '',
    '```yaml',
    'records:',
    '  - acceptance_id: AC-1',
    `    entry_point: {file: ${REAL_CHAIN_SOURCE_2}, symbol: list}`,
    '    testability_level: L1',
    '    dependencies:',
    '      - {name: Array, kind: pure}',
    '    verdict: testable',
    '  - acceptance_id: AC-2',
    `    entry_point: {file: ${REAL_CHAIN_SERVICE}, symbol: openCard}`,
    '    testability_level: L1',
    '    dependencies:',
    '      - {name: BankRepository, kind: external}',
    '    verdict: testable',
    '```',
    '',
  ].join('\n'));
  writeHostFile(p.root, `doc/features/${p.feature}/ut/mock-plan.yaml`, [
    'schema_version: "1.0"',
    `feature: ${p.feature}`,
    'spies:',
    '  - target_class: BankRepository',
    `    target_file: ${REAL_CHAIN_SOURCE_2}`,
    '    strategy: spy',
    '    methods:',
    '      - name: list',
    '        presets:',
    // ut_mock_plan_typed（BLOCKER）：preset 的 ts_expr 须含 "as Type" 或 "new Name("。
    '          - id: empty',
    '            returns: {ts_expr: "[] as string[]"}',
    '',
  ].join('\n'));
  writeHostFile(p.root, `doc/features/${p.feature}/ut/reports/coverage-evidence.json`, JSON.stringify({
    schema_version: '1.0',
    feature: p.feature,
    primary_evidence_source: 'ut_tags',
    sources: { ut_tags: [REAL_CHAIN_TEST] },
    mappings: [
      { scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' },
      { scope_id: 'AC-2', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' },
    ],
  }, null, 2));
}

/**
 * test-plan.md：check-testing.ts:5951-5959——`test-plan.md` 与 `test-report.md`
 * 皆缺即 `testing_docs_missing` BLOCKER；`test-report.md` 由 harness 生成，故只写这份。
 *
 * **偏离 plan §4.3**：该表把 `test-plan.md` 列在 plan 阶段。实跑证伪——在 plan 阶段写它
 * 会被生产写边界判 `phase_write_violation: doc/.../testing/test-plan.md:wrong_phase:testing`
 * 并直接 halt。归属以生产写边界为准，改在 testing 阶段写。
 */
function writeTestPlan(p: RealChainProject): void {
  writeFacts(p, 'testing');
  writeHostFile(p.root, `doc/features/${p.feature}/testing/test-plan.md`, [
    '# 测试计划',
    '',
    // plan_metadata_header（MINOR）
    `> **模块标识**: ${p.module}`,
    '> **版本**: 1.0',
    '> **日期**: 2026-01-01',
    '',
    // plan_required_chapters（BLOCKER，check-testing.ts:313-320）：六组章节。
    '## 1. 测试范围',
    '',
    `${p.module} 的全部银行页列表展示与开卡入口。`,
    '',
    // test_case_flow（`test-case-flow.ts:26-51`）：单 session 状态链 SSOT，缺块即 MAJOR WARN，
    // 有块则 `triageCascade` 的 root/blocked 三分才有判据；条目须与用例表**完全一致**。
    '```yaml',
    'test_case_flow:',
    '  TC-001:',
    '    precondition:',
    '      kind: fresh_app',
    '      reset: restart',
    '  TC-002:',
    '    precondition:',
    '      kind: fresh_app',
    '      reset: restart',
    '```',
    '',
    '## 2. 测试环境',
    '',
    '| 项 | 取值 |',
    '|----|------|',
    '| 设备 | 真机 |',
    '| 系统版本 | HarmonyOS 5.0 |',
    '| API | API 12 |',
    '| 构建 | default product |',
    '',
    '## 3. 测试策略',
    '',
    '按验收标准逐条走真机自动化通道。',
    '',
    '## 4. 测试用例清单',
    '',
    // test_case_table_format（BLOCKER，:390-398）七列 +
    // testing_execution_channel（BLOCKER）要求「执行通道」列。
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| TC-001 | 开卡入口 | 冷启动 | 点击银行条目并等待开卡页标题 | 进入开卡流程页 | P0 | AC-1 | hylyre |',
    '| TC-002 | 银行列表展示 | 冷启动 | 打开全部银行页并等待列表条目 | 列表展示银行条目 | P1 | AC-2 | hylyre |',
    '',
    '## 5. 通过标准',
    '',
    'P0 用例通过率 100%，整体用例通过率 >= 95%，且无 BLOCKER 缺陷。',
    '',
    '## 6. 风险与依赖',
    '',
    '| 风险 | 缓解 |',
    '|------|------|',
    '| 设备不可用 | 重新分配设备 |',
    '',
  ].join('\n'));
  deriveHylyrePlanHint(p);
  writeDerivedHylyrePlan(p);
}

/**
 * device-testing Step 4.5 的第一步：跑**生产脚本** `scripts/derive-hylyre-plan-hint.ts`
 * 从顶层 test-plan.md 派生 `derive-hint-from-plan.json`。
 *
 * 它不是可选的辅助信息——`derivedPlanStaleByTcTable`（check-testing.ts:3971-3976）在
 * 缺 `test_cases` 源快照时**无条件判 stale**（步骤已被翻译成 JSON，没有快照就无法比较）。
 * 所以真实 agent 也必须先跑这个脚本再派生。**hint 由生产脚本产出，夹具一个字段都不写**
 *（§4.4：harness 产物不得手填）。
 */
function deriveHylyrePlanHint(p: RealChainProject): void {
  const r = spawnSync(process.execPath, [
    path.join(p.harnessDir, 'node_modules', 'ts-node', 'dist', 'bin.js'),
    '--transpile-only',
    path.join(p.harnessDir, 'scripts', 'derive-hylyre-plan-hint.ts'),
    '--feature', p.feature,
    '--project-root', p.root,
  ], { cwd: p.harnessDir, encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`derive-hylyre-plan-hint 失败（exit=${r.status}）：${r.stderr ?? ''}`);
  }
}

/**
 * 派生 Hylyre 计划 `testing/reports/<timestamp>/hylyre/test-plan.hylyre.md`：
 * `selectBestNonPlaceholderDerivedPlan`（check-testing.ts:4183/:4201）未选出即 BLOCKER。
 * 它是 agent 按 device-testing Step 4.5 产出的作者材料，不是 harness 产物。
 *
 * 步骤形状同时受三处约束，任一不合即 BLOCKER：
 *   · STEP-001/007 等静态 lint（derived-hylyre-plan.ts:482-620）：每步恰好一个根键、
 *     by_text 必须显式 match、wait_for 须带 timeout；
 *   · STEP-SETUP（:520-540）：首个 assertion 之前须有同 case 的入口动作；
 *   · P0 身份断言精确形状（p0-semantic-gates.ts:295-305 `isBareIdentityAssertion`）：
 *     required 元素只认 `{"wait_for":{"by_id":<id>,"timeout":N}}`，多一个键就不算身份证据。
 * 顶层 TC 集合与本表必须**恰好相等**（evaluateChannelDerivedCoverage）。
 */
function writeDerivedHylyrePlan(p: RealChainProject): void {
  writeHostFile(
    p.root,
    `doc/features/${p.feature}/testing/reports/${DERIVED_RUN_STAMP}/hylyre/test-plan.hylyre.md`,
    [
      '# 派生 Hylyre 测试计划',
      '',
      '## 测试用例清单',
      '',
      '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      `| TC-001 | 开卡入口 | 冷启动 | {"touch":{"by_id":"${EL_BANK_ROW}"}}; `
        + `{"wait_for":{"by_id":"${EL_ENTRY_TITLE}","timeout":10}} | 进入开卡流程页 | P0 | AC-1 |`,
      // 首步取 `{"back":{}}`（单会话导航纪律的复位动作）而不是 `touch` 屏 id：屏 id 不是
      // ui-spec 的节点 id，会吃 `derived_selector_contract` 的开放世界 WARN；`back` 同时满足
      // STEP-SETUP（首个 assertion 前须有同 case 的入口动作）。
      `| TC-002 | 银行列表展示 | 冷启动 | {"back":{}}; `
        + `{"wait_for":{"by_id":"${EL_BANK_ROW}","timeout":10}} | 列表展示银行条目 | P1 | AC-2 |`,
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------

/**
 * 真 harness 子进程的 stdout 由 `goal-phase-runtime.ts:1296` 原样 `process.stdout.write` 转给父进程，
 * 所以父进程包一层就能拿到它**实际**打印的解析结果（不是工程声明的配置值）。
 * 只读旁路：原 write 照常调用，日志不丢。
 */
function captureStdout(): { text: () => string; stop: () => void } {
  // **按 Buffer 收、末尾一次解码**：子进程的 stdout 按字节流分块，多字节字符
  //（`🔍 Harness 验证开始` / `✓ project_profile`）会跨块；逐块 `String(chunk)` 会把它拆成
  // 两个替换字符，标记行漏配或错配到上一阶段。
  const chunks: Buffer[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]): boolean => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf-8'));
    return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
  };
  return {
    text: () => Buffer.concat(chunks).toString('utf-8'),
    stop: () => { (process.stdout as unknown as { write: unknown }).write = original; },
  };
}

/**
 * 把 `🔍 Harness 验证开始: phase=<phase>` 与其后的 `✓ project_profile: <name>`
 *（`harness-runner.ts:962-964`，值是 `loadResolvedProfile` 的**解析结果**）配对，得到逐阶段的解析 profile。
 */
function parseResolvedProfiles(stdout: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of stdout.split('\n')) {
    const start = line.match(/Harness 验证开始:\s*phase=(\w+)/);
    if (start) { current = start[1]; continue; }
    const resolved = line.match(/project_profile:\s*(\S+)/);
    if (resolved && current) out.set(current, [...(out.get(current) ?? []), resolved[1]]);
  }
  return out;
}

/** 判据解析器本身的纯单测（不跑链）：跨阶段、同阶段重试两行、一次回落 hmos-app。 */
test('real-chain 判据解析：逐阶段配对子进程打印的 project_profile', async () => {
  const log = [
    '🔍 Harness 验证开始: phase=spec, feature=demo-card',
    '   ✓ project_profile: test-chain',
    '🔍 Harness 验证开始: phase=spec, feature=demo-card',
    '   ✓ project_profile: test-chain',
    '🔍 Harness 验证开始: phase=plan, feature=demo-card',
    '   ✓ project_profile: hmos-app',
    'GOAL_PHASE phase=coding event=start',
    '🔍 Harness 验证开始: phase=coding, feature=demo-card',
    '   ✓ project_profile: test-chain / element-service',
    '',
  ].join('\n');
  const byPhase = parseResolvedProfiles(log);
  assert(JSON.stringify(byPhase.get('spec')) === '["test-chain","test-chain"]',
    `spec 同阶段两轮未各自收录：${JSON.stringify(byPhase.get('spec'))}`);
  // 回落必须**如实进表**（本断言的价值就在这里：解析器不许把 hmos-app 吞掉）。
  assert(JSON.stringify(byPhase.get('plan')) === '["hmos-app"]',
    `plan 回落值未如实收录：${JSON.stringify(byPhase.get('plan'))}`);
  // 非 harness 行（GOAL_PHASE）不得改变当前阶段归属。
  assert(JSON.stringify(byPhase.get('coding')) === '["test-chain"]',
    `coding 归属错（应只取 harness 起始行，且 subVariant 后缀不入名）：${JSON.stringify(byPhase.get('coding'))}`);
  assert(byPhase.get('ut') === undefined, 'ut 未出现却被凭空配出值');
});

/**
 * plan a3c7e9d1 t5：CU-bound spec/plan 消费蓝图派生范围——**同一合成宿主**上的接缝。
 *
 * 六阶段链本身仍是平铺 Feature（`demo-card`）：它跑通即证明非 CU-bound 的术语/scope/架构影响门禁未回归。
 * CU-bound 不进 goal 链：合成宿主的 `test-chain` profile 无 design lens（`profileHasDesignLens` 仅 hmos-app），
 * P1 CLI 会按设计判 unsupported；本仓也从未有过 CU-bound 六阶段 goal 链。故这里在同一宿主（真实
 * framework.config DSL / catalog / glossary，provision 出来的框架根）上直调生产判据：
 * P1 `validateComponentBlueprint`、typed plan 的蓝图投影 `deriveBlueprintSkillInput`、共享
 * `validateChangeUnitFeatureProjection`。
 */
export async function cuBoundBlueprintScopeSeam(): Promise<void> {
  const project = provisionRealChainProject();
  try {
    scaffoldRealChainHost(project);
    const f = seedChangeUnitBlueprint(project.root);
    // 宿主 catalog 保留真实模块 FinancialCard，再登记蓝图 development 节点的 `ledger`。
    writeHostFile(project.root, 'doc/module-catalog.yaml', [
      'schema_version: "1.0"',
      'modules:',
      ...[[project.module, `${project.modulePath}/index.ets`], ['ledger', '02-Feature/ledger/index.ets']].flatMap(([name, entry]) => [
        `  - name: "${name}"`, '    layer: "02-Feature"', '    sub_layer: null', '    format: "HAR"', `    one_liner: "${name}"`,
        '    responsibilities: []', '    NOT_responsible_for: []', '    typical_business_terms: []', '    easily_confused_with: []',
        '    key_exports: []', `    entry_file: "${entry}"`,
      ]),
      '',
    ].join('\n'));
    clearFrameworkConfigCache();
    const blockers = (): string[] => {
      const bp = YAML.parse(fs.readFileSync(f.blueprintFile, 'utf-8'));
      return validateComponentBlueprint(bp, { projectRoot: project.root }).filter(i => i.severity === 'BLOCKER').map(i => `${i.id}: ${i.message}`);
    };
    // ① changed development 节点带 `module`，解析为宿主 catalog 获准模块。
    let ids = blockers();
    assert(ids.length === 0, `合成宿主上的蓝图应无 BLOCKER：\n${ids.join('\n')}`);
    // ② 术语事实：medium 未确认 → terminology_facts_confirmed 挡；user_confirmed 后放行。
    const termFact = (method: string) => ({
      fact_id: 'term-ledger', subject: 'term:账本', value: { canonical_module: 'ledger', confidence: 'medium', easily_confused_with: [project.module] },
      provenance: { source_kind: 'catalog', source_ref: 'doc/module-catalog.yaml', observed_at: '2026-09-23T10:00:00+08:00', evidence_strength: 'observed', extraction_method: method },
    });
    rewriteBlueprint(project.root, bp => { bp.discovery.facts.push(termFact('model_inference')); });
    ids = blockers();
    assert(ids.some(id => id.startsWith('terminology_facts_confirmed')), `medium 未确认术语应被挡：${ids.join(' | ')}`);
    rewriteBlueprint(project.root, bp => { bp.discovery.facts = bp.discovery.facts.filter((x: BlueprintRecord) => x.fact_id !== 'term-ledger'); bp.discovery.facts.push(termFact('user_confirmed')); });
    ids = blockers();
    assert(ids.length === 0, `user_confirmed 后不应再挡：\n${ids.join('\n')}`);
    // ③ typed plan 投影消费 touches 派生的可修改集合：集合内 resolved，越界（宿主真实模块 FinancialCard）invalid。
    const setModules = (names: string[]): void => rewriteBlueprint(project.root, bp => {
      const cu = YAML.parse(fs.readFileSync(f.cuFile, 'utf-8'));
      const node = asRecord(resolveBlueprintTarget(bp, cu.design_refs[0].target))!;
      (node.contracts as BlueprintRecord).modules = names.map(name => ({ name, layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: `02-Feature/${name}` }));
    });
    const plan = () => deriveBlueprintSkillInput(project.root, f.feature, project.frameworkRoot, 'contracts');
    setModules(['ledger']);
    const inside = plan();
    assert(inside.state === 'resolved', `可修改集合内应放行：${inside.detail}`);
    const shared = validateChangeUnitFeatureProjection(project.root, f.feature, inside.value as ContractsSpec, undefined, true, 'plan');
    assert(!shared.issues.some(i => i.id === 'cu_scope_matches_blueprint'), `共享校验不应报越界：${JSON.stringify(shared.issues)}`);
    const overflow = validateChangeUnitFeatureProjection(project.root, f.feature,
      { ...(inside.value as ContractsSpec), modules: [...(inside.value as ContractsSpec).modules, { name: project.module, layer: '02-Feature', package_path: project.modulePath }] } as ContractsSpec,
      undefined, true, 'plan');
    assert(overflow.issues.some(i => i.id === 'cu_scope_matches_blueprint' && i.route === 'reconcile_blueprint'), `共享校验应报 cu_scope_matches_blueprint：${JSON.stringify(overflow.issues)}`);
    setModules(['ledger', project.module]);
    const outside = plan();
    assert(outside.state === 'invalid' && outside.detail!.includes('可修改模块集合') && outside.detail!.includes(project.module),
      `越出 touches 派生集合应 invalid：${outside.state} ${outside.detail}`);
    // 调和回集合内后投影恢复（链可继续）。
    setModules(['ledger']);
    assert(plan().state === 'resolved', '调和回可修改集合后投影应恢复 resolved');
  } finally {
    if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

test('real-chain CU-bound 接缝：合成宿主上蓝图节点 module / 术语确认 / touches 派生范围被 typed plan 投影消费', cuBoundBlueprintScopeSeam);

test('real-chain 正例：spec→testing 六阶段真实 harness 全链 PASS + closed', async () => {
  const project = provisionRealChainProject();
  try {
    const birthChain = scaffoldRealChainHost(project);
    clearFrameworkConfigCache();
    const captured = captureStdout();
    const pendingPhases = (): string[] =>
      PHASES.filter(ph => readSummary(project, ph)?.closure_status !== 'closed');
    // 1.2 的六阶段**在同一个 run 内**跑完：出生链只含当下算得出的阶段（[spec, plan]），
    // spec/plan 各自 PASS 后 `assessment.recommendation.action === 'revise_scope'` 把修订
    // 追加进本 run（`goal-phase-runtime.ts:9619-9670`）——`chain` 被整体换成修订后的
    // `phase_chain`，游标按「第一个还没有有效 PASS 的阶段」重新推导，循环继续派发。
    // 既不 seal、不换 run、也不需要 `--resume`（plan §10.12：宿主 events 同构，
    // `…/bc-openCard-2/open-card-flow-v2/goal-runs/20260918T165234Z-c7689f/events.jsonl`
    // 第 21–22 行＝`scope_revised rev1` 紧接同 run 的 `phase_start coding 1/4`）。
    const probe = await runGoalRuntimeChain(project.root, {
      frameworkRoot: project.frameworkRoot,
      featureId: project.feature,
      realHarness: true,
      adapter: 'codex',
      // 1.2：范围是权威，--start/--end 必须与出生链首尾逐字相等（goal-phase-runtime.ts:4988）。
      // 出生链天然短，随 spec/plan 的范围修订自行延长到 testing。
      freshStartPhase: birthChain[0] as 'spec',
      freshEndPhase: birthChain[birthChain.length - 1],
      freshRequirement: REAL_CHAIN_REQUIREMENT,
      onSpec: ctx => { project.runId = ctx.runId; writeSpecMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'spec'); },
      onPlan: ctx => { project.runId = ctx.runId; writePlanMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'plan'); },
      onCoding: ctx => { project.runId = ctx.runId; writeCodingMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'coding'); },
      onReview: ctx => { project.runId = ctx.runId; writeReviewMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'review'); },
      onUt: ctx => { project.runId = ctx.runId; writeUtMaterials(project); if (ctx.attempt > 1) publishVerifier(project, 'ut'); },
      onTesting: ctx => { project.runId = ctx.runId; writeTestPlan(project); if (ctx.attempt > 1) publishVerifier(project, 'testing'); },
    }).finally(() => captured.stop());
    const events = probe.events;
    const resolvedByPhase = parseResolvedProfiles(captured.text());
    if (DEBUG) {
      console.log('--- exitCode', probe.exitCode);
      console.log('--- events', events.map(e => String(e.type)).join(','));
      for (const ph of PHASES) console.log(dumpPhase(project, ph));
    }
    // 退出码不是判据：范围修订延长链后，终局态由逐阶段 verdict/closure 说了算。
    assert(pendingPhases().length === 0,
      `仍有未闭环阶段 ${JSON.stringify(pendingPhases())}（exit=${probe.exitCode}）\n${PHASES.map(ph => dumpPhase(project, ph)).join('\n')}`);

    for (const phase of PHASES) {
      const s = readSummary(project, phase);
      assert(s !== null, `${phase}：summary.json 未落盘`);
      // §4.5 判据①：verdict === 'PASS'（只有 fresh + PASS 才进 receipt 校验与 closure finalizer，
      // goal-phase-runtime.ts:8391）。
      assert(s!.verdict === 'PASS', `${phase}：verdict=${s!.verdict}（要求 PASS）\n${dumpPhase(project, phase)}`);
      // §4.5 判据②：闭环成功。
      assert(s!.closure_status === 'closed', `${phase}：closure_status=${s!.closure_status}`);
      assert(s!.receipt_status === 'passed', `${phase}：receipt_status=${s!.receipt_status}`);
      // §4.5 判据②后半：回执由生产 `projectReceiptAfterClosure` 投影生成——它只在闭环成功后
      // 才落盘，故它在盘即证明 fresh + PASS 那条分支真的走过（`generated_by` 是投影者自述）。
      const receipt = path.join(project.root, 'doc/features', project.feature, phase, 'phase-completion-receipt.md');
      assert(fs.existsSync(receipt), `${phase}：闭环回执投影缺失 ${receipt}`);
      const receiptText = fs.readFileSync(receipt, 'utf-8');
      assert(/generated_by:\s*"harness \(read-only projection/.test(receiptText),
        `${phase}：回执不是生产投影产物`);
      assert(new RegExp(`claimed_completion_commit_sha:\\s*"${s!.source_commit_sha}"`).test(receiptText),
        `${phase}：回执 commit 身份与 summary 不一致`);
      // §4.5 判据③：产物身份可复验——verifier subject 与本轮 summary 同源。
      assert(typeof s!.verifier_subject_id === 'string' && s!.verifier_subject_id!.length === 64,
        `${phase}：verifier_subject_id 形态非法`);
      // profile 解析面见循环外的 `resolvedByPhase` 断言。
      // **不要用 `phase-evidence-manifest.json` 的 `environment.profile` 当判据**：
      // 它来自 `phase-evidence-manifest.ts:332-336` 的 `loadFrameworkConfig().project_profile.name`
      // ——即工程**声明**的名字，profile-loader 静默回落到 hmos-app 时这个字段照样写 test-chain，
      // 断言会被洗绿（codex review 阻断，2026-09-22）。
    }

    // plan §10.1 M：`profile-loader.ts:199-205` 读不出 profile.yaml 时**只 warn 不抛、静默回落
    // hmos-app**。唯一能证明子进程**实际解析结果**的是它自己打印的那一行
    //（`harness-runner.ts:964` `✓ project_profile: <resolvedProfile.name>`，紧跟在
    // `🔍 Harness 验证开始: phase=<phase>` 之后）。六阶段逐个断。
    for (const phase of PHASES) {
      const resolved = resolvedByPhase.get(phase) ?? [];
      assert(resolved.length > 0, `${phase}：子进程未打印 project_profile（无解析结果可断）`);
      assert(resolved.every(name => name === 'test-chain'),
        `${phase}：子进程解析到 profile=${resolved.join(',')}（回落即 profile 替换失败被洗绿）`);
    }

    // 真 harness 子进程确实为每个阶段跑过（`realHarness` 下 probe.harnessPhases 恒空，
    // 判据只能建在 events 上——plan §10.1 O）。
    const harnessStarts = events.filter(e => e.type === 'harness_start').map(e => String(e.phase));
    const harnessEnds = events.filter(e => e.type === 'harness_end').map(e => String(e.phase));
    for (const phase of PHASES) {
      assert(harnessStarts.includes(phase), `events 缺 harness_start@${phase}`);
      assert(harnessEnds.includes(phase), `events 缺 harness_end@${phase}`);
    }
  } finally {
    // 工程里有指向**源仓**的 junction（`harness/node_modules`、`skills` 等）。已实测
    // `fs.rmSync(recursive)` 只删链接本身、不跟进目标：清理后源仓 node_modules/profiles/skills 完好。
    if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
    else console.log('--- kept root', project.root);
    clearFrameworkConfigCache();
  }
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try { await c.run(); out.push({ name: c.name, ok: true }); }
    catch (e) { out.push({ name: c.name, ok: false, error: (e as Error).message }); }
  }
  return out;
}

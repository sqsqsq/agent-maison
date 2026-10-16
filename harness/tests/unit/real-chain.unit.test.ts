// ============================================================================
// real-chain.unit.test.ts — plan d4a1f7c3 §4 正例：确定性输入下的生产验证链集成回归
// ----------------------------------------------------------------------------
// 口径见 plan §1.1：真实的是 goal 编排 + 六阶段真实检查 + 全部派生产物；
// 替身的是**整个作者调用**、UT 执行、设备/视觉 provider、OCR。
// 判据（§4.5）：六阶段逐个 `summary.verdict === 'PASS'` 且 fresh、每阶段 closed、
// 回执由生产 `projectReceiptAfterClosure` 投影生成。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, SelectedUnitCases, UnitExecutionTiming } from '../utils/unit-case-selection';
import {
  provisionRealChainProject,
  scaffoldRealChainHost,
  writeHostFile,
  git,
  REAL_CHAIN_REQUIREMENT,
  REAL_CHAIN_SOURCE,
  REAL_CHAIN_SOURCE_2,
  REAL_CHAIN_MODEL,
  REAL_CHAIN_SERVICE,
  REAL_CHAIN_INDEX,
  REAL_CHAIN_NEW_SOURCE,
  REAL_CHAIN_TEST,
  REAL_CHAIN_PNG_EXISTING,
  REAL_CHAIN_PNG_NEW,
  REAL_CHAIN_PNG_NEW_BYTES,
  writeHostBytes,
  type RealChainProject,
} from '../utils/real-chain-host';
import { runGoalRuntimeChain, requestVia, claudeReadEventLine, writeAgentEvents } from './goal-runner-testing-integrity.unit.test';
import { clearFrameworkConfigCache } from '../../config';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import * as YAML from 'yaml';
import { fixture as seedChangeUnitBlueprint } from './blueprint-skill-projection.unit.test';
import { rewriteBlueprint } from './change-unit-progression.unit.test';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { validateChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { asRecord, asRecords, type BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import type { ContractsSpec } from '../../scripts/utils/types';
import { featureRelativePath } from '../../scripts/utils/feature-identity';
import { materializeBlueprintSkillInputs } from '../../scripts/utils/blueprint-skill-projection';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { loadCanonicalChangeUnit, asChangeUnitArtifact, createChangeUnitRef, parseChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { loadEffectiveExecutionScope, loadFrozenExecutionScope } from '../../scripts/utils/goal-run-creation';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { authorCurrentCuPlan } from './component-design-handoff.unit.test';
import { deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { BLUEPRINT_RECONCILE_LOCK_NAME } from '../../scripts/utils/change-unit-design-preparation';
import { tryAcquireLock, releaseLock } from '../../scripts/utils/goal-run-lock';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { initializeFidelityRouting } from '../../scripts/utils/goal-preflight';
import { acceptChangeUnitDecomposition, deriveDesignPreparationReadiness, reviseChangeUnitContent } from '../../scripts/utils/change-unit-design-preparation';
import { probeDesignAuthorityRecovered } from '../../scripts/utils/condition-wait';

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
  const abs = path.join(p.root, 'doc/features', featureRelativePath(p.feature), phase, 'reports', 'summary.json');
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as Summary;
}

export function dumpPhase(p: RealChainProject, phase: string): string {
  const s = readSummary(p, phase);
  if (!s) return `${phase}: <no summary>`;
  const reportPath = path.join(p.root, 'doc/features', featureRelativePath(p.feature), phase, 'reports', 'script-report.json');
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
  const reportsDir = path.join(p.root, 'doc/features', featureRelativePath(p.feature), phase, 'reports');
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
// 「canonical ui-spec 不可解析」，与保真档位无关。它声明 `ui_change: reuse_only`（界面复用），故
// `spec-ui-spec-check.ts:71-75` 的 `ui_spec_structure` 仍不进（enforcement 未配置即返回 []）。
// `architecture.md` 同步同样免除：plan.md 声明 `impact: none`，
// check-plan.ts:909-914 的 `plan_to_architecture` 直接 SKIP，**架构变更分支不覆盖**。
// ---------------------------------------------------------------------------

export function writeSpecMaterials(p: RealChainProject, _executionRunId?: string, options: { preserveUnchanged?: boolean } = {}): void {
  const f = p.feature;
  const write = (relative: string, content: string): void => {
    const file = path.join(p.root, relative);
    if (options.preserveUnchanged && fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
    writeHostFile(p.root, relative, content);
  };
  // spec.md：check-spec 的 required_chapters / feature_table_format(:674-681) /
  // scope_declaration / terminology_mapping_table / mermaid_flowchart 五门的正文载体。
  write(`doc/features/${f}/spec/spec.md`, [
    '# 银行卡开卡 spec',
    '',
    '```yaml',
    'ui_change: reuse_only',
    '```',
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
  // AC-1 是 **P0 device 交互型**（`isP0DeviceInteractive`：P0 + ut_layer∈{device,both}，已有 checkpoint 继续受原语义核验），
  // 因此同时进三道门：spec 期 `acceptance_flow_structure`（checkpoint 完整 + 引文验存 +
  // flows 每条边有 P0 AC 拥有，p0-semantic-gates.ts:132-210）、testing 期
  // `p0_coverage_integrity` / `p0_semantic_coverage_integrity`（按 checkpoint 的
  // action/required 元素逐条对账派生计划步骤与 native StepResult，:576-645）。
  write(`doc/features/${f}/acceptance.yaml`, [
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
  write(`doc/features/${f}/spec/ui-spec.yaml`, [
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
  // plan 14771034 §2.3：contracts.files 里的两张 PNG 同理（`context_exploration_facts_scope_coverage`
  // 对二进制目标一视同仁，实跑 coding 期两张都报「当前目标未覆盖」）。
  const deltaRows: Array<[string, string, string]> = fs.existsSync(path.join(p.root, REAL_CHAIN_NEW_SOURCE))
    ? [
        [REAL_CHAIN_NEW_SOURCE, 'coding 新建的列表条目组件', '本阶段按它继续'],
        ...(phase === 'coding' ? [
          [REAL_CHAIN_SOURCE, 'coding 已接入银行列表和开卡 sheet 的实现', '按当前验收与返修候选验证页面实现'],
          [REAL_CHAIN_INDEX, 'coding 已导出新建 BankListItem 组件', '按当前模块导出检查调用面'],
        ] as Array<[string, string, string]> : []),
        [REAL_CHAIN_PNG_EXISTING, '既有银行标识图（二进制，按路径引用）', '不改'],
        [REAL_CHAIN_PNG_NEW, 'coding 新建的开卡结果图（二进制，按路径引用）', '本阶段按它继续'],
      ]
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
    // plan 14771034 §2.3：宿主 contracts.files 同时列源码与 PNG（一张既有、一张 coding 新建）。
    `  - ${REAL_CHAIN_PNG_EXISTING}`,
    `  - ${REAL_CHAIN_PNG_NEW}`,
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

/**
 * coding 阶段产出物本体：新增列表条目组件并在页面里接上（真实写盘，供下游新鲜度消费）。
 *
 * plan 14771034 §2.3/§2.4：页面按宿主「点银行弹开卡 sheet」同构——`.bindSheet($$this.sheetVisible, …)`
 * 是宿主 `AllBanksPage.ets` 那一行去业务名后的原形（`$$` 双向绑定），`` `${phase}` `` 是 ④ 记的占位符级联形态；
 * 另新建一张资源图（宿主「run 中新建」那张）。`.id(...)` 是 device_test.run 替身的渲染依据（§2.1）。
 * `entryTitleId=false`：sheet 标题不写 `.id('open_card_title')`——RC-9 在真实回退之前的 coding 形态。
 */
export function writeCodingMaterials(p: RealChainProject, opts: { entryTitleId?: boolean } = {}): void {
  writeHostFile(p.root, REAL_CHAIN_NEW_SOURCE, [
    "import { BankModel } from './BankModel';",
    '',
    '@Component',
    'export struct BankListItem {',
    '  @Prop bank: BankModel;',
    '  build() {',
    `    Text(this.bank.name).id('${EL_BANK_ROW}')`,
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
    '  @State sheetVisible: boolean = false;',
    '',
    '  @Builder',
    '  openCardSheet() {',
    '    Column() {',
    `      Text('开卡申请')${opts.entryTitleId === false ? '' : `.id('${EL_ENTRY_TITLE}')`}`,
    '    }',
    '  }',
    '',
    '  sheetTag(phase: string): string {',
    '    return `${phase}`;',
    '  }',
    '',
    '  build() {',
    '    Column() {',
    '      Text("全部银行")',
    '      ForEach(this.banks, (b: string) => {',
    '        BankListItem({ bank: { id: b, name: b } })',
    '          .onClick(() => { this.sheetVisible = true; })',
    '      })',
    '    }',
    '    .bindSheet($$this.sheetVisible, this.openCardSheet(), {',
    "      title: { title: this.sheetTag('open_card') },",
    '    })',
    '  }',
    '}',
    '',
  ].join('\n'));
  writeHostBytes(p.root, REAL_CHAIN_PNG_NEW, REAL_CHAIN_PNG_NEW_BYTES);
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
    `- ${REAL_CHAIN_PNG_EXISTING}`,
    `- ${REAL_CHAIN_PNG_NEW}`,
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
export function writeTestPlan(p: RealChainProject): void {
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
// plan 14771034 §2.3 / §3：PNG 归属与 prompt 四条不变量（普通回归断言，不是「重复即失败」门禁）。
// ---------------------------------------------------------------------------

/** T0 实测：解析输入里含源码与 contracts.files 的阶段（spec/plan 的 prompt 不内联源码）。 */
const PROMPT_PHASES = ['coding', 'review', 'ut', 'testing'] as const;
const REAL_CHAIN_PNGS = [REAL_CHAIN_PNG_EXISTING, REAL_CHAIN_PNG_NEW] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function diskSha(p: RealChainProject, rel: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(p.root, rel))).digest('hex');
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * c3f8a2d7：模块写边界内的 PNG 资源归 coding，不再由文件后缀排除。
 * coding 起既有与新建资源都须进 manifest；施工归属只给 coding，后续阶段按只读输入绑定当前字节哈希。
 */
function assertPngProvenance(p: RealChainProject): void {
  for (const phase of PHASES) {
    const abs = path.join(p.root, 'doc/features', featureRelativePath(p.feature), phase, 'reports', 'phase-evidence-manifest.json');
    const m = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { inputs?: Array<Record<string, unknown>>; outputs?: Array<Record<string, unknown>> };
    const entries = [...(m.inputs ?? []), ...(m.outputs ?? [])].filter(e => /\.png$/.test(String(e.path)));
    for (const e of entries) {
      const expectedOwner = phase === 'coding' ? 'coding' : undefined;
      assert(e.owner_phase === expectedOwner, `${phase}：PNG 施工归属应为 ${expectedOwner ?? '无（只读输入）'}：${JSON.stringify(e)}`);
      assert(e.sha256 === diskSha(p, String(e.path)), `${phase}：PNG 条目 sha 与盘上字节不符：${JSON.stringify(e)}`);
    }
    if (phase === 'spec' || phase === 'plan') continue;
    for (const rel of REAL_CHAIN_PNGS) {
      assert(entries.some(e => e.path === rel), `${phase}：manifest 未登记 ${rel}：${JSON.stringify(entries)}`);
    }
  }
}

/**
 * §3 四条不变量，对象是该阶段盘上真实 `ai-prompt.md`（harness 子进程写的最后一轮）：
 * 1 模板主结构不复制（模板首个 `## ` 行恰 1 次，从 provision 出来的模板文件读）；
 * 2 `$$` 逐字（`$$this.sheetVisible` 在、没有单 `$` 版本、`` `${phase}` `` 原样）；
 * 3 二进制不内联（无 `IHDR`、无 PNG 签名字节、无 U+FFFD）；
 * 4 按需读取路径正确（每张 PNG 的 binary 条目是工程相对路径，sha 等于盘上字节）。
 */
function assertPromptInvariants(p: RealChainProject, phase: string): void {
  const abs = path.join(p.root, 'doc/features', featureRelativePath(p.feature), phase, 'reports', 'ai-prompt.md');
  const bytes = fs.readFileSync(abs);
  const prompt = bytes.toString('utf-8');
  const count = (needle: string): number => prompt.split(needle).length - 1;
  const template = fs.readFileSync(path.join(p.harnessDir, 'prompts', `verify-${phase}.md`), 'utf-8');
  const heading = template.split('\n').find(line => line.startsWith('## '));
  assert(heading, `${phase}：模板无 \`## \` 行，不变量 1 失去对象`);
  assert(count(heading!) === 1, `${phase}：不变量 1 模板主结构出现 ${count(heading!)} 次（应 1）：${heading}`);
  assert(count('$$this.sheetVisible') >= 1, `${phase}：不变量 2 prompt 里没有逐字的 $$this.sheetVisible`);
  assert(!/(^|[^$])\$this\.sheetVisible/.test(prompt), `${phase}：不变量 2 出现被改写成单 $ 的 $this.sheetVisible`);
  assert(count('`${phase}`') >= 1, `${phase}：不变量 2 模板串 \`\${phase}\` 未原样保留`);
  assert(!prompt.includes('IHDR'), `${phase}：不变量 3 prompt 内联了 PNG 块（IHDR）`);
  assert(!bytes.includes(PNG_SIGNATURE), `${phase}：不变量 3 prompt 含 PNG 签名字节`);
  assert(!prompt.includes('�'), `${phase}：不变量 3 prompt 含 U+FFFD（二进制被按 UTF-8 解码）`);
  for (const rel of REAL_CHAIN_PNGS) {
    const m = new RegExp(`path:\\s*${escapeRegExp(rel)}\\s+sha256:\\s*([0-9a-f]{64})\\s+binary:\\s*true`).exec(prompt);
    assert(m, `${phase}：不变量 4 没有 ${rel} 的工程相对路径 binary 条目`);
    assert(m![1] === diskSha(p, rel), `${phase}：不变量 4 ${rel} 的 sha 与盘上字节不符`);
  }
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
    writeHostFile(project.root, CU_SOURCE, 'export class LedgerFeature {}\n');
    writeHostFile(project.root, CU_TEST, 'export {};\n');
    const authored = authorCurrentCuPlan(project.root, asRecord(inside.value)!) as unknown as ContractsSpec;
    const shared = validateChangeUnitFeatureProjection(project.root, f.feature, authored, undefined, true, 'plan');
    assert(shared.issues.length === 0, `合法 plan 作者草稿应通过共享校验：${JSON.stringify(shared.issues)}`);
    const overflow = validateChangeUnitFeatureProjection(project.root, f.feature,
      { ...authored, modules: [...authored.modules, { name: project.module, layer: '02-Feature', package_path: project.modulePath }] } as ContractsSpec,
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

// ---------------------------------------------------------------------------
// plan b2d7f4e9 t4：CU 绑定链变体——同一合成宿主上把一个 canonical CU 跑到 feature completion。
//
// 形状由实跑定（生产零改动）：
//   · 蓝图 + CU 取 `component-blueprint/valid` 的 ledger-refresh（`seedChangeUnitBlueprint`），设计内容经
//     生产 `materializeBlueprintSkillInputs`（= `prepare-blueprint-design` CLI）物化 acceptance/contracts/use-cases；
//   · acceptance/design 义务由蓝图满足，出生链只剩 [coding, review, ut]（与宿主 open-card-flow-v2 同构：
//     spec/plan 的职责已由 /component-design 承担）；
//   · 影响判断 `user_visible_behavior_change=false`（纯领域服务）→ device 义务 not_applicable，不进 testing；
//   · 施工落点 `src/ledger/**` 刻意不在任何产品源码根（`discoverProductSourceRoots` 只认含 `src/main` 的模块根）：
//     同宿主的平铺 Feature 完成凭证绑定全量产品源码 inventory，CU 改动若落在模块根里，两份完成凭证互相作废；
//   · implementation/test ref 在设计期就必须是已存在文件（物化拒绝缺失文件、ut 期拒绝 `planned:`），
//     故基线预置两份空壳，coding / ut 各自改写。
// ---------------------------------------------------------------------------

export const CU_SOURCE = 'src/ledger/LedgerFeature.ets';
export const CU_TEST = 'src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets';
export const CU_REQUIREMENT = '新增一笔账目后刷新账页并在重启后恢复余额';
const CU_READS = [CU_SOURCE, 'src/ledger/LedgerIntakeConsumer.ts', 'src/ledger/LedgerSourceSeam.ts', 'src/ledger/LedgerIntakeBypass.ts',
  'src/ledger/ClosureFixture.ts', 'test/ledger/closure.test.ts', 'test/ledger/seam-bypass.case.ts'];

function cuRel(p: RealChainProject): string { return `doc/features/${featureRelativePath(p.feature)}`; }

/** Facts follow the run's actual establishing phase and keep later UT output out of earlier research. */
export function writeCuFacts(p: RealChainProject, phase: string): void {
  const first = p.runId ? loadFrozenExecutionScope(p.root, p.feature, p.runId)?.phase_chain[0] ?? 'coding' : 'coding';
  const sourceReads = [...CU_READS, REAL_CHAIN_SOURCE, REAL_CHAIN_SOURCE_2, REAL_CHAIN_MODEL].filter(file => fs.existsSync(path.join(p.root, file)));
  const factsRel = `${cuRel(p)}/context/facts.md`;
  const abs = path.join(p.root, factsRel);
  const prior = fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf-8').split(/(?=^##\s*phase_delta:)/m).slice(1)
      .filter(section => !new RegExp(`^##\\s*phase_delta:\\s*${phase}\\b`).test(section))
    : [];
  writeHostFile(p.root, factsRel, [
    '---', 'schema_version: "1.1"', `feature: ${p.feature}`, ...(p.runId ? [`run_id: ${p.runId}`] : []), `established_by: ${first}`,
    'ready_to_produce: true', 'has_blocker_coverage_risk: false', 'exploration_mode: sequential',
    'key_inputs_read:', '  - doc/glossary.yaml', '  - doc/module-catalog.yaml', '  - doc/architecture.md',
    'subagents_used: none', 'decisions_unlocked:', '  - ledger_refresh', 'files_inspected_count: 14', 'searches_performed_estimate: 10',
    'source_code_paths:', ...sourceReads.map(r => `  - ${r}`), '---', '', '## Code Facts', '',
    '| 路径 | 事实 | 对本阶段影响 |', '|------|------|--------------|',
    ...sourceReads.map(r => `| ${r} | ${path.basename(r)} 已读 | 账目刷新沿用 |`), '',
    ...prior.map(section => section.replace(/\s*$/, '\n')), `## phase_delta: ${phase}`, '', '本阶段研究结论已确认。', '',
  ].join('\n'));
}

/**
 * 宿主前置（在 `scaffoldRealChainHost` 之后、git 提交之前调用）：落蓝图与 canonical CU、登记 catalog、
 * 生成 CU 的范围候选；阶段作者随后消费投影并产出实体。返回 CU 工程视图与出生链。
 */
export function seedCuBoundHost(project: RealChainProject): { cu: RealChainProject; birthChain: string[] } {
  const f = seedChangeUnitBlueprint(project.root);
  const configFile = path.join(project.root, 'framework.config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  // This isolated fixture keeps Ledger outside the other feature's inventory, but its
  // source root is still declared so the existing invocation observer records real writes.
  config.architecture.outer_layers.push({ id: 'src', can_depend_on: [], intra_layer_deps: 'dag' });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  writeHostFile(project.root, 'doc/module-catalog.yaml', [
    'schema_version: "1.0"', 'modules:',
    ...[[project.module, `${project.modulePath}/index.ets`], ['ledger', '02-Feature/ledger/index.ets']].flatMap(([name, entry]) => [
      `  - name: "${name}"`, '    layer: "02-Feature"', '    sub_layer: null', '    format: "HAR"', `    one_liner: "${name}"`,
      '    responsibilities: []', '    NOT_responsible_for: []', '    typical_business_terms: []', '    easily_confused_with: []',
      '    key_exports: []', `    entry_file: "${entry}"`,
    ]),
    '',
  ].join('\n'));
  clearFrameworkConfigCache();
  rewriteBlueprint(project.root, bp => {
    const unit = YAML.parse(fs.readFileSync(f.cuFile, 'utf-8'));
    const node = asRecord(resolveBlueprintTarget(bp, unit.design_refs[0].target))!;
    const contracts = JSON.parse(JSON.stringify(node.contracts)
      .split('test/ledger/LedgerFeature.test.ets').join(CU_TEST).split('planned:').join('')) as BlueprintRecord;
    contracts.modules = [{ name: 'ledger', layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: 'src/ledger' }];
    contracts.files = [CU_SOURCE];
    node.contracts = contracts;
    for (const useCase of (node.use_cases as BlueprintRecord).use_cases as BlueprintRecord[]) {
      useCase.coordinator = 'LedgerFeature.add';
      useCase.ui_bindings = [{ ui: 'LedgerPage', role: 'entry', user_actions: [{ trigger: '点击新增账目', calls: 'LedgerFeature.add' }] }];
    }
  });
  clearFrameworkConfigCache();
  writeHostFile(project.root, CU_SOURCE, 'export class LedgerFeature {\n  balance(): number { return 0; }\n}\n');
  writeHostFile(project.root, CU_TEST, "import { describe } from '@ohos/hypium';\n\ndescribe('LedgerFeature', () => {\n});\n");
  const cu: RealChainProject = { ...project, feature: f.feature, module: 'ledger', modulePath: 'src/ledger', runId: undefined };
  const prepared = prepareFeatureScopeCandidate({
    projectRoot: project.root, frameworkRoot: project.frameworkRoot, feature: cu.feature, completionTarget: 'feature',
    requestedResults: ['账目刷新与恢复'], requestedPhases: ['plan', 'coding', 'review', 'ut'], requirement: CU_REQUIREMENT, overwrite: true,
    impact: { userVisibleBehaviorChange: false, reason: '只改账本领域服务，不改任何界面', basisPaths: [CU_SOURCE] },
  });
  return { cu, birthChain: prepared.scope.phase_chain.map(String) };
}

export function writeCuSpecMaterials(p: RealChainProject): void {
  const projected = deriveBlueprintSkillInput(p.root, p.feature, p.frameworkRoot, 'acceptance');
  assert(projected.state === 'resolved', projected.detail ?? 'acceptance projection absent');
  writeHostFile(p.root, `${cuRel(p)}/acceptance.yaml`, YAML.stringify(projected.value));
  writeCuFacts(p, 'spec');
}

/** First Spec draft from the known fixture request, before a malformed design is repaired. */
export function writeCuSpecDraft(p: RealChainProject): void {
  const draft = YAML.parse(fs.readFileSync(path.join(__dirname, '../fixtures/blueprint-design-inputs/acceptance.yaml'), 'utf8'));
  draft.feature = p.feature;
  draft.source = 'spec:fixture-ledger-request';
  writeHostFile(p.root, `${cuRel(p)}/acceptance.yaml`, YAML.stringify(draft));
  writeCuFacts(p, 'spec');
}

/** plan 作者从同一设计输入与当前 CU 写出映射及真实用例文件。 */
export function writeCuPlanMaterials(p: RealChainProject): void {
  const projected = deriveBlueprintSkillInput(p.root, p.feature, p.frameworkRoot, 'contracts');
  assert(projected.state === 'resolved', projected.detail ?? 'contracts projection absent');
  const identity = parseChangeUnitFeatureId(p.feature);
  const loaded = loadCanonicalChangeUnit(p.root, identity.blueprintId, identity.changeUnitId);
  const cu = asChangeUnitArtifact(loaded.changeUnit);
  const contracts = structuredClone(projected.value) as ContractsSpec;
  const implementation_refs = [CU_SOURCE]; const test_refs = [CU_TEST];
  contracts.change_unit = { change_unit_ref: createChangeUnitRef(loaded),
    predicate_mappings: cu.target_predicates.map(row => ({ predicate_id: row.predicate_id, implementation_refs, test_refs })),
    provide_mappings: cu.provides.map(row => ({ provide_id: row.provide_id, implementation_refs, test_refs })),
    design_ref_mappings: cu.design_refs.map(design_ref => ({ design_ref, implementation_refs, verification_refs: test_refs })) };
  const oldFile = path.join(p.root, `${cuRel(p)}/contracts.yaml`);
  const old = fs.existsSync(oldFile) ? YAML.parse(fs.readFileSync(oldFile, 'utf8')) : undefined;
  if (asRecords(old?.state_management).some(row => (row.ordered_steps as string[] ?? []).includes('notify observers'))) contracts.state_management?.[0].ordered_steps?.push('notify observers');
  writeHostFile(p.root, `${cuRel(p)}/contracts.yaml`, YAML.stringify(contracts));
  if (projected.artifacts?.['use-cases@1']) writeHostFile(p.root, `${cuRel(p)}/use-cases.yaml`, YAML.stringify(projected.artifacts['use-cases@1']));
  writeCuFacts(p, 'plan');
}

export function writeCuCodingMaterials(p: RealChainProject): void {
  writeHostFile(p.root, CU_SOURCE, [
    'export class LedgerFeature {',
    '  private entries: number[] = [];',
    '  add(amount: number): number { this.entries.push(amount); return this.balance(); }',
    '  balance(): number { return this.entries.reduce((a, b) => a + b, 0); }',
    '  restore(saved: number[]): number { this.entries = [...saved]; return this.balance(); }',
    '}',
    '',
  ].join('\n'));
  writeCuFacts(p, 'coding');
}

export function writeCuReviewMaterials(p: RealChainProject, executionRunId = p.runId): void {
  writeCuFacts(p, 'review');
  const contracts = YAML.parse(fs.readFileSync(path.join(p.root, `${cuRel(p)}/contracts.yaml`), 'utf8')) as ContractsSpec;
  const entry = resolveCapabilityResolutionEntryInput({ projectRoot: p.root, frameworkRoot: p.frameworkRoot, feature: p.feature, phase: 'review', goalRunId: executionRunId, featuresDir: 'doc/features' });
  const code = resolveCapabilityInputs({ projectRoot: p.root, frameworkRoot: p.frameworkRoot, feature: p.feature, phase: 'review', track: 'full', ...entry }).inputs?.values.code;
  const targets = code?.state === 'resolved' && Array.isArray(code.value) ? code.value.map((file: { path: string }) => file.path) : contracts.files;
  writeHostFile(p.root, `${cuRel(p)}/review/review-report.md`, [
    '# 审查报告', '', '> **模块标识**: ledger', '> **审查日期**: 2026-01-01', '> **审查版本**: 1.0', '> **保证等级**: standard', '',
    '## 1. 审查范围', '', '模块：ledger。文件范围来自实际绑定的施工输入；外围源码仅作只读对照。', '', ...targets.map(r => `- ${r}`), '',
    '## 2. 审查维度', '', '| 维度 | 结论 |', '|------|------|', '| 契约一致性 | 通过 |', '| 视觉保真 | 不适用（无界面变更） |', '',
    '## 3. 问题清单', '',
    '| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |', '|------|------|----------|----------|----------|----------|',
    `| R-1 | 可读性 | MINOR | 方法缺少用途注释 | ${CU_SOURCE} | 补充注释 |`, '',
    '## 4. 问题统计', '', '| 严重程度 | 数量 |', '|----------|------|', '| BLOCKER | 0 |', '| MAJOR | 0 |', '| MINOR | 1 |', '',
    '## 5. 修复建议', '', '- R-1：下一次迭代补充注释，不阻断本次交付。', '',
    '## 6. 结论', '', '**审查结论**: 通过', '',
  ].join('\n'));
}

/** use-cases 的 `ledger-refresh` 需 branch 用例（`[BRANCH-success]`）与链接 use_case/branches 的 ephemeral DAG。 */
export function writeCuUtMaterials(p: RealChainProject): void {
  writeCuFacts(p, 'ut');
  writeHostFile(p.root, CU_TEST, [
    "import { describe, it, expect } from '@ohos/hypium';",
    "import { LedgerFeature } from '../../../../LedgerFeature';",
    '',
    "describe('ledger-refresh', () => {",
    "  it('[BRANCH-success][AC-1] LedgerFeature.add 刷新余额并可恢复', 0, () => {",
    '    const ledger: LedgerFeature = new LedgerFeature();',
    '    expect(ledger.add(120)).assertEqual(120);',
    '    expect(ledger.restore([45, 55])).assertEqual(100);',
    '  });',
    '});',
    '',
  ].join('\n'));
  writeHostFile(p.root, `${cuRel(p)}/ut/testability-audit.md`, [
    '# 可测性审计', '', '```yaml', 'records:', '  - acceptance_id: AC-1', `    entry_point: {file: ${CU_SOURCE}, symbol: add}`,
    '    testability_level: L1', '    dependencies:', '      - {name: Array, kind: pure}', '    verdict: testable', '```', '',
  ].join('\n'));
  writeHostFile(p.root, `${cuRel(p)}/ut/reports/flow-dag/ledger_refresh.dag.yaml`, [
    'flow_id: ledger_refresh', 'flow_name: 账目刷新与恢复', 'module: ledger', 'use_case: ledger-refresh', 'branches:', '  - success',
    'linked_acceptance:', '  - AC-1', 'entry_point:', '  module: ledger', `  file: ${CU_SOURCE}`, '  function: add', 'nodes:',
    '  - id: n_add', '    type: code_execution', '    description: 新增一笔账目并返回余额', '    source:', `      file: ${CU_SOURCE}`,
    '      class: LedgerFeature', '      function: add', '    next:', '      - n_assert',
    '  - id: n_assert', '    type: assertion', '    description: 余额随账目刷新', '    linked_acceptance:', '      - AC-1',
    '    assertions:', '      - type: state_check', '        target: balance', "        expected: '120'", '    next: []', '',
  ].join('\n'));
  writeHostFile(p.root, `${cuRel(p)}/ut/reports/coverage-evidence.json`, JSON.stringify({
    schema_version: '1.0', feature: p.feature, primary_evidence_source: 'ut_tags', sources: { ut_tags: [CU_TEST] },
    mappings: [{ scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' }],
  }, null, 2));
}

/** 平铺 `demo-card` 六阶段链（正例用例与快照生成器共用）。 */
export function runDemoCardChain(project: RealChainProject, birthChain: string[]): ReturnType<typeof runGoalRuntimeChain> {
  return runGoalRuntimeChain(project.root, {
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
  });
}

export function runCuBoundChain(cu: RealChainProject, birthChain: string[]): ReturnType<typeof runGoalRuntimeChain> {
  return runGoalRuntimeChain(cu.root, {
    frameworkRoot: cu.frameworkRoot,
    featureId: cu.feature,
    realHarness: true,
    adapter: 'codex',
    freshStartPhase: birthChain[0] as 'plan' | 'coding',
    freshEndPhase: birthChain[birthChain.length - 1],
    freshRequirement: CU_REQUIREMENT,
    onPlan: ctx => { cu.runId = ctx.runId; writeCuPlanMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'plan'); },
    onCoding: ctx => { cu.runId = ctx.runId; writeCuCodingMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'coding'); },
    onReview: ctx => { cu.runId = ctx.runId; writeCuReviewMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'review'); },
    onUt: ctx => { cu.runId = ctx.runId; writeCuUtMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'ut'); },
  });
}

test('4f combined 新 CU UI unknown→spec 调研物化→coding/review→L3 返修→testing', async () => {
  const project = provisionRealChainProject();
  try {
    scaffoldRealChainHost(project, 'claude');
    writeHostFile(project.root, 'CLAUDE.md', '# CLAUDE\n');
    const { cu } = seedCuBoundHost(project);
    const ref = `${cuRel(cu)}/ux-reference/ledger.png`;
    writeHostBytes(cu.root, ref, fs.readFileSync(path.join(cu.root, REAL_CHAIN_PNG_EXISTING)));
    const requirement = `新增账目页面按钮与余额显示，按参考图 ${ref} 逐像素复现，业务入口保持单测，并在真机验收页面`;
    initializeFidelityRouting({ projectRoot: cu.root, frameworkRoot: cu.frameworkRoot, feature: cu.feature, requirement,
      featuresDirRel: 'doc/features', executionIdentity: `phase:${cu.feature}:spec`, requirementProvenance: 'explicit_cli',
      manifestFidelity: 'pixel_1to1', fidelityFromCli: true, adapter: 'claude' });
    const prepared = prepareFeatureScopeCandidate({ projectRoot: cu.root, frameworkRoot: cu.frameworkRoot,
      feature: cu.feature, completionTarget: 'feature', requestedResults: ['页面与业务完整交付'],
      requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], requirement, overwrite: true,
      impact: { userVisibleBehaviorChange: true, reason: '新增页面展示', basisPaths: [CU_SOURCE] } });
    assert(prepared.scope.obligations.some(o => o.id === 'acceptance-definition:visual' && o.applicability === 'unknown'), JSON.stringify(prepared.scope));
    assert(!prepared.scope.phase_chain.includes('coding'), 'UI 定义待定应先留在定义阶段');
    const before = fs.readFileSync(path.join(cu.root, REAL_CHAIN_SOURCE));
    git(cu.root, ['add', '-A']); git(cu.root, ['commit', '-qm', 'combined UI definition baseline']);
    let needsSeam = false; let repaired = false; let enteredTesting = false;
    const probe = await runGoalRuntimeChain(cu.root, { frameworkRoot: cu.frameworkRoot, featureId: cu.feature,
      realHarness: true, adapter: 'claude', freshRequirement: requirement,
      freshStartPhase: prepared.scope.phase_chain[0] as 'spec', freshEndPhase: prepared.scope.phase_chain.at(-1),
      onSpec: ctx => {
        cu.runId = ctx.runId; writeCuSpecMaterials(cu);
        writeHostFile(cu.root, `${cuRel(cu)}/spec/spec.md`, '# 页面定义\n\n```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\nvisual_handoff:\n  kind: repo_assets\n  authoritative_refs:\n    - id: ledger\n      path: ' + ref + '\n```\n');
        writeHostFile(cu.root, `${cuRel(cu)}/spec/ui-spec.yaml`, YAML.stringify({ schema_version: '1.0', verified: 'verified', verified_method: 'vl_multimodal',
          screens: [{ id: 'ledger', ref_id: 'ledger', priority: 'P1', root: { type: 'navigation_frame', order: 0,
            children: [{ id: 'balance', type: 'content_display', order: 0, text: '余额' }] } }],
          tokens: { gap: { kind: 'spacing', value: '16vp' } }, assets: [] }));
        writeAgentEvents(ctx.outputLogPath, [claudeReadEventLine(ref)]);
        if (ctx.attempt > 1) publishVerifier(cu, 'spec');
      },
      onPlan: ctx => {
        cu.runId = ctx.runId; writeCuPlanMaterials(cu);
        writeHostFile(cu.root, `${cuRel(cu)}/plan/visual-parity.yaml`, YAML.stringify({ mappings: {
          assets: [], tokens: [{ ui_spec_key: 'gap', contract_resource_key: 'gap' }], components: [] } }));
        if (ctx.attempt > 1) publishVerifier(cu, 'plan');
      },
      onCoding: ctx => {
        cu.runId = ctx.runId; writeCuCodingMaterials(cu);
        if (needsSeam) { fs.appendFileSync(path.join(cu.root, CU_SOURCE), '\nexport const testabilitySeamAvailable = true;\n'); repaired = true; }
        if (ctx.attempt > 1) publishVerifier(cu, 'coding');
      },
      onReview: ctx => { cu.runId = ctx.runId; writeCuReviewMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'review'); },
      onUt: ctx => {
        cu.runId = ctx.runId; writeCuUtMaterials(cu);
        if (!repaired) {
          needsSeam = true;
          writeHostFile(cu.root, `${cuRel(cu)}/ut/testability-audit.md`, '```yaml\n' + YAML.stringify({ records: [{ acceptance_id: 'AC-1',
            entry_point: { file: CU_SOURCE, symbol: 'add' }, testability_level: 'L3', selected: 'option_b',
            verdict: 'needs_seam', recommendation: { option_b: '为现有业务入口补最小可测接缝' } }] }) + '```\n');
        } else if (ctx.attempt > 1) publishVerifier(cu, 'ut');
      },
      onTesting: () => { enteredTesting = true; },
      // 此用例证明自动接续到 testing；设备/视觉完整验收由既有六阶段 real-chain 和真实专项证明。
      failExecutorFor: phase => phase === 'testing',
    });
    assert(enteredTesting && repaired, `未完成组合恢复（exit=${probe.exitCode}）：${probe.invokedPhases.join('→')}\n${['spec','plan','coding','review','ut'].map(ph => dumpPhase(cu, ph)).join('\n')}`);
    assert(probe.events.some(e => e.type === 'scope_revised'), '必须通过现有 scope revision 保留后续义务');
    assert(fs.readFileSync(path.join(cu.root, REAL_CHAIN_SOURCE)).equals(before), 'spec 只读调研不能修改源码');
    assert(readSummary(cu, 'spec')?.verdict === 'PASS' && readSummary(cu, 'ut')?.verdict === 'PASS', '真实 spec/UT 检查应通过');
  } finally {
    if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
    else console.log('--- kept root', project.root);
    clearFrameworkConfigCache();
  }
});

for (const oldCu of [false, true]) test(`66457a08 real entry: ${oldCu ? 'old CU→plan summary→design-owner halt→revision→probe ready' : 'selection rejection→accept/readiness→in-memory fidelity→spec→plan PASS'}`, async () => {
  const project = provisionRealChainProject();
  try {
    scaffoldRealChainHost(project, 'claude'); writeHostFile(project.root, 'CLAUDE.md', '# CLAUDE\n');
    const { cu } = seedCuBoundHost(project);
    const workspace = path.join(cu.root, 'doc/features/ledger-app-blueprint');
    const names = ['LedgerPage', 'AccountSheet', 'ChoicePage', 'CodeSheet', 'ResultPage', 'HomePage', 'ListPage'];
    writeHostFile(cu.root, 'doc/component-index.yaml', 'schema_version: "1.0"\ncomponents: []\n');
    rewriteBlueprint(cu.root, bp => {
      const unit = loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit as any;
      const node = asRecord(resolveBlueprintTarget(bp, unit.design_refs[0].target))!;
      (node.contracts as BlueprintRecord).components = names.map(name => ({ name, module: 'ledger', file: CU_SOURCE,
        kind: 'page', decorator: '@Component', asset_selection: { resolution: 'custom', rationale: '当前账本界面专用' } }));
      const dev = asRecords(bp.design_views).find(v => v.view_id === 'development')!;
      const target = asRecords(dev.nodes)[0]; target.kind = 'component'; target.module = 'ledger';
      (asRecord(bp.decisions_and_gaps)!.decisions as BlueprintRecord[]).push({ decision_id: 'ledger-ui-selection', kind: 'component_asset_selection',
        target_ref: `view:development/node:${target.node_id}`, asset_resolution: 'custom', rationale: '当前账本界面专用',
        status: 'answered_with_evidence', owner: 'ledger', verification_refs: [CU_SOURCE],
        provenance: { ...asRecord(bp.provenance), source_ref: 'doc/component-index.yaml' } });
      const provider = asRecords(bp.providers).find(p => p.provider_id === 'component-assets')!;
      provider.available = true; delete provider.missing_disposition;
    });
    const loaded = loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh');
    const candidate = { providerId: 'consumer-validated-decomposition', artifact: structuredClone(asChangeUnitArtifact(loaded.changeUnit)) };
    for (const dir of fs.readdirSync(workspace, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'blueprint')) {
      fs.rmSync(path.join(workspace, dir.name), { recursive: true, force: true });
    }
    let refusal = '';
    try { acceptChangeUnitDecomposition(cu.root, 'ledger-app-blueprint', [candidate]); } catch (error) { refusal = (error as Error).message; }
    assert(refusal.includes('decision:ledger-ui-selection'), refusal);
    assert(!fs.existsSync(loaded.canonicalPath), 'rejected candidate must not create canonical CU');
    candidate.artifact.design_refs.push({ ...candidate.artifact.component_blueprint_ref, target: { kind: 'decision', id: 'ledger-ui-selection' } });
    acceptChangeUnitDecomposition(cu.root, 'ledger-app-blueprint', [candidate]);
    const readiness = deriveDesignPreparationReadiness(cu.root, 'ledger-app-blueprint');
    assert(readiness.ready, JSON.stringify(readiness));
    const ref = `${cuRel(cu)}/ux-reference/ledger.png`;
    writeHostBytes(cu.root, ref, fs.readFileSync(path.join(cu.root, REAL_CHAIN_PNG_EXISTING)));
    const requirement = oldCu ? CU_REQUIREMENT : `新增账目页面，按参考图 ${ref} 逐像素 1:1 复现，并验证业务入口。`;
    writeHostFile(cu.root, 'doc/selection-request.md', requirement);
    const prepare = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), path.join(cu.harnessDir, 'scripts/goal-mode-entry.ts'),
      '--prepare-scope', '--project-root', cu.root, '--framework-root', cu.frameworkRoot, '--feature', cu.feature,
      '--completion-target', 'feature', '--requested-results', '交付账本页面', '--requested-phases', 'plan,coding,review,ut,testing',
      '--requirement-file', 'doc/selection-request.md', '--impact-behavior-change', String(!oldCu), '--impact-reason', oldCu ? '内部账本变更' : '新增界面', '--impact-basis', CU_SOURCE],
      { cwd: cu.root, encoding: 'utf8', timeout: 60000, env: { ...process.env, TS_NODE_PROJECT: path.join(cu.harnessDir, 'tsconfig.json') } });
    assert(prepare.status === 0, prepare.stdout + prepare.stderr);
    const birth = JSON.parse(prepare.stdout.slice(prepare.stdout.indexOf('{'))).phase_chain as string[];
    assert(birth[0] === (oldCu ? 'plan' : 'spec'), prepare.stdout);
    assert(!fs.existsSync(path.join(cu.root, `${cuRel(cu)}/spec/reports/fidelity-intent.json`)), 'prepare must not write fidelity');
    git(cu.root, ['add', '-A']); git(cu.root, ['commit', '-qm', 'selection handoff baseline']);
    const probe = await runGoalRuntimeChain(cu.root, { frameworkRoot: cu.frameworkRoot, featureId: cu.feature, adapter: 'claude', realHarness: true,
      freshStartPhase: birth[0] as 'spec' | 'plan', freshEndPhase: birth.at(-1), omitRequirement: true, launchArgs: ['--requirement-file', 'doc/selection-request.md'],
      freshManifestContent: YAML.stringify({ feature: cu.feature, requirement, requirement_source_files: ['doc/selection-request.md'],
        budget: { max_total_turns: 4 }, unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20 } }),
      onSpec: ctx => {
        cu.runId = ctx.runId; writeCuSpecMaterials(cu);
        writeHostFile(cu.root, `${cuRel(cu)}/spec/spec.md`, '# 页面定义\n```yaml\nui_change: new_or_changed\nfidelity_target: pixel_1to1\nvisual_handoff:\n  kind: repo_assets\n  authoritative_refs:\n    - id: ledger\n      path: ' + ref + '\n```\n');
        writeHostFile(cu.root, `${cuRel(cu)}/spec/ui-spec.yaml`, YAML.stringify({ schema_version: '1.0', verified: 'verified', verified_method: 'vl_multimodal',
          screens: [{ id: 'ledger', ref_id: 'ledger', priority: 'P1', root: { type: 'navigation_frame', order: 0, children: [{ id: 'value', type: 'content_display', order: 0, text: '余额' }] } }],
          tokens: { gap: { kind: 'spacing', value: '16vp' } }, assets: [] }));
        writeAgentEvents(ctx.outputLogPath, [claudeReadEventLine(ref)]); if (ctx.attempt > 1) publishVerifier(cu, 'spec');
      },
      onPlan: ctx => {
        cu.runId = ctx.runId; writeCuPlanMaterials(cu);
        const file = path.join(cu.root, `${cuRel(cu)}/contracts.yaml`); const contracts = YAML.parse(fs.readFileSync(file, 'utf8'));
        contracts.change_unit.design_ref_mappings.find((m: any) => m.design_ref.target.id === 'ledger-ui-selection').implementation_refs = names.map(name => `planned:${CU_SOURCE}#${name}`);
        fs.writeFileSync(file, YAML.stringify(contracts));
        writeHostFile(cu.root, `${cuRel(cu)}/plan/visual-parity.yaml`, YAML.stringify({ mappings: { assets: [], tokens: [{ ui_spec_key: 'gap', contract_resource_key: 'gap' }], components: [] } }));
        if (oldCu) {
          // Existing canonical content with the pre-fix omission, discovered during plan.
          const legacy = loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh');
          const content = asChangeUnitArtifact(legacy.changeUnit);
          content.design_refs = content.design_refs.filter(r => r.target.id !== 'ledger-ui-selection');
          fs.writeFileSync(legacy.canonicalPath, YAML.stringify(content));
          contracts.change_unit.change_unit_ref = createChangeUnitRef(loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh'));
          fs.writeFileSync(file, YAML.stringify(contracts));
        }
        if (ctx.attempt > 1) publishVerifier(cu, 'plan');
      },
    });
    assert(probe.invokedPhases[0] === (oldCu ? 'plan' : 'spec') && !probe.invokedPhases.includes('coding'), JSON.stringify(probe.invokedPhases));
    if (oldCu) {
      assert(probe.invokedPhases.filter(p => p === 'plan').length === 1, JSON.stringify(probe.invokedPhases));
      assert(readSummary(cu, 'plan')?.blockers?.some(c => c.id === 'change_unit_design_closure_incomplete'), dumpPhase(cu, 'plan'));
      assert(probe.events.some(e => e.type === 'phase_halt' && e.halt_reason === 'execution_scope_unresolved' && e.probe === 'design_authority_projectable'), JSON.stringify(probe.events.slice(-8)));
      const check = () => probeDesignAuthorityRecovered(cu.root, cu.feature, 'plan', ['change_unit_design_closure_incomplete'], cu.runId);
      assert(!check().ready, 'unrepaired CU must not wake');
      writeHostFile(cu.root, `${cuRel(cu)}/repair-notes.md`, '已修复（仅说明，无定义变化）');
      assert(!check().ready, 'notes alone must not wake');
      const before = loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh');
      const fixed = asChangeUnitArtifact(before.changeUnit);
      fixed.design_refs.push({ ...fixed.component_blueprint_ref, target: { kind: 'decision', id: 'ledger-ui-selection' } });
      const revision = reviseChangeUnitContent(cu.root, 'ledger-app-blueprint', [{ expectedRef: createChangeUnitRef(before), candidate: { providerId: 'consumer-validated-decomposition', artifact: fixed } }]);
      assert(revision.revised.length === 1 && check().ready, JSON.stringify({ revised: revision.revised.length, probe: check() }));
    } else for (const phase of ['spec', 'plan']) assert(readSummary(cu, phase)?.verdict === 'PASS' && readSummary(cu, phase)?.closure_status === 'closed', dumpPhase(cu, phase));
  } finally { if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true }); else console.log('--- kept root', project.root); clearFrameworkConfigCache(); }
});

/** 公开入口 `goal-status` 在工程自己的框架根下子进程运行，返回 `feature_status=…` 行（生产 `assessFeature`）。 */
export function goalStatusFeatureLine(project: { root: string; harnessDir: string }, feature: string): string {
  const r = spawnSync(process.execPath, [
    path.join(project.harnessDir, 'node_modules', 'ts-node', 'dist', 'bin.js'), '--transpile-only',
    path.join(project.harnessDir, 'scripts', 'goal-status.ts'), '--feature', feature, '--project-root', project.root,
  ], { cwd: project.harnessDir, encoding: 'utf-8' });
  return (r.stdout ?? '').split('\n').find(line => line.startsWith('feature_status=')) ?? `<no feature_status; exit=${r.status}> ${r.stderr ?? ''}`;
}

test('real-chain CU 绑定链：plan 生成当前映射与用例后经 coding→review→ut 真实 harness 到 feature completion', async () => {
  const project = provisionRealChainProject();
  try {
    scaffoldRealChainHost(project);
    const { cu, birthChain } = seedCuBoundHost(project);
    assert(JSON.stringify(birthChain) === '["plan","coding","review","ut"]', `CU 出生链应包含真实 plan 映射义务：${JSON.stringify(birthChain)}`);
    git(project.root, ['add', '-A']);
    git(project.root, ['commit', '-qm', 'seed change unit']);
    clearFrameworkConfigCache();
    const probe = await runCuBoundChain(cu, birthChain);
    for (const phase of birthChain) {
      const s = readSummary(cu, phase);
      assert(s?.verdict === 'PASS' && s.closure_status === 'closed', `${phase}：verdict=${s?.verdict} closure=${s?.closure_status}（exit=${probe.exitCode}）\n${dumpPhase(cu, phase)}`);
    }
    const line = goalStatusFeatureLine(project, cu.feature);
    assert(line.startsWith('feature_status=FEATURE_COMPLETED (verify=VALID'), `CU 完成凭证未判 VALID：${line}`);
  } finally {
    if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
    else console.log('--- kept root', project.root);
    clearFrameworkConfigCache();
  }
});

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
    const probe = await runDemoCardChain(project, birthChain).finally(() => captured.stop());
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

    assertPngProvenance(project);
    for (const phase of PROMPT_PHASES) assertPromptInvariants(project, phase);
  } finally {
    // 工程里有指向**源仓**的 junction（`harness/node_modules`、`skills` 等）。已实测
    // `fs.rmSync(recursive)` 只删链接本身、不跟进目标：清理后源仓 node_modules/profiles/skills 完好。
    if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
    else console.log('--- kept root', project.root);
    clearFrameworkConfigCache();
  }
});

function deliveryCli(p: RealChainProject, script: string, args: string[], nodeArgs: string[] = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, path.join(p.harnessDir, 'node_modules/ts-node/dist/bin.js'), '--transpile-only', path.join(p.harnessDir, 'scripts', script), ...args],
    { cwd: p.harnessDir, encoding: 'utf8', env: { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(p.root, '.test-checkpoints') } });
  const stdout = result.stdout ?? '';
  let json: any;
  try { json = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch { /* Include real CLI diagnostics in the assertion. */ }
  return { ...result, json, diagnostic: `${result.status}: ${stdout}\n${result.stderr}` };
}

function deliveryStepArgs(step: any, feature: string): string[] {
  const replacements: Record<string, string[]> = {
    '<project-root>': [step.parameters.project_root], '<returned-feature-id>': [feature],
    '<requested-results>': ['交付账本功能（结果描述不同于原需求）'],
    '<requested-phases>': [step.parameters.requested_phases.join(',')],
    '<requirement-arguments>': step.parameters.requirement_arguments,
  };
  return step.command.split(' ').slice(3).flatMap((token: string) => replacements[token] ?? [token]);
}

function deliveryProfile(p: RealChainProject, name: string): void {
  const file = path.join(p.root, 'framework.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.project_profile = { name };
  fs.writeFileSync(file, JSON.stringify(config));
  clearFrameworkConfigCache();
}

test('5f8c2d70 raw requirement → main Agent design/questioning → public consumer → detached CU Goal first phase', async () => {
  const p = provisionRealChainProject();
  try {
    scaffoldRealChainHost(p);
    fs.rmSync(path.join(p.root, 'doc/features'), { recursive: true, force: true });
    deliveryProfile(p, 'hmos-app');
    writeHostFile(p.root, 'request.md', CU_REQUIREMENT);
    const rawFeature = 'ledger-new-delivery';
    const scopeArgs = ['--project-root', p.root, '--prepare-scope', '--feature', rawFeature, '--completion-target', 'feature', '--requested-results', CU_REQUIREMENT, '--requested-phases', 'spec,plan,coding,review,ut', '--requirement-file', 'request.md'];
    for (const [script, args] of [
      ['goal-runner.ts', ['--feature', rawFeature, '--requirement-file', 'request.md', '--adapter', 'codex', '--detach']],
      ['goal-runner.ts', ['--feature', rawFeature, '--requirement-file', 'request.md', '--adapter', 'codex']],
      ['goal-mode-entry.ts', scopeArgs],
      ['goal-mode-entry.ts', ['--project-root', p.root, '--prepare-run', '--feature', rawFeature, '--adapter', 'codex', '--run-mode', 'attended', '--requirement-file', 'request.md']],
    ] as Array<[string, string[]]>) {
      const result = deliveryCli(p, script, args);
      assert(result.status === 0 && result.json?.type === 'design_preparation_required', result.diagnostic);
      assert(result.json.steps[1].command.includes('--accept-candidates') && result.json.steps[2].parameters.project_root === p.root, 'next steps must carry executable commands and parameter sources');
      assert(result.json.steps[1].command.includes(`--accept-candidates "${result.json.materials.features_dir}/<actual-blueprint-id>/blueprint/change-unit-candidates.json"`), 'candidate command must use the configured blueprint directory');
      assert(!fs.existsSync(path.join(p.root, 'doc/features', rawFeature)), 'raw entry must not create a flat candidate/run/log directory');
    }
    for (const detached of [false, true]) {
      const flags = detached ? ['--detach'] : ['--foreground-ok'];
      writeHostFile(p.root, 'entry-manifest.yaml', YAML.stringify({ feature: rawFeature, start_phase: 'spec', end_phase: 'spec', adapter: 'codex', requirement: CU_REQUIREMENT, requirement_source_files: ['request.md'] }));
      const definition = deliveryCli(p, 'goal-runner.ts', ['--manifest', 'entry-manifest.yaml', ...flags]);
      assert(definition.status === 0 && definition.json?.type === 'design_preparation_required', definition.diagnostic);
      assert(definition.json.steps[2].parameters.requested_phases.join(',') === 'spec' && definition.json.materials.requirement === CU_REQUIREMENT && definition.json.materials.requirement_source_files.join(',') === 'request.md', 'manifest-only definition must retain effective request and bounds');
      writeHostFile(p.root, 'entry-manifest.yaml', YAML.stringify({ feature: `${rawFeature}-coding-${detached}`, start_phase: 'coding', end_phase: 'coding', adapter: 'codex', requirement: 'only implementation' }));
      const coding = deliveryCli(p, 'goal-runner.ts', ['--manifest', 'entry-manifest.yaml', ...flags]);
      assert(!coding.diagnostic.includes('design_preparation_required') && coding.status === 1, 'manifest coding-only must reach original missing-scope check, not default spec design');
      const override = deliveryCli(p, 'goal-runner.ts', ['--manifest', 'entry-manifest.yaml', '--start', 'spec', '--override-start', '--end', 'spec', '--override-end', '--requirement-file', 'request.md', '--override-manifest', ...flags]);
      assert(override.status === 0 && override.json?.type === 'design_preparation_required' && override.json.materials.requirement === CU_REQUIREMENT && override.json.materials.requirement_source_files.join(',') === 'request.md', override.diagnostic);
      const invalidOverride = deliveryCli(p, 'goal-runner.ts', ['--manifest', 'entry-manifest.yaml', '--start', 'spec', ...flags]);
      assert(invalidOverride.status !== 0 && invalidOverride.diagnostic.includes('override mismatch') && !invalidOverride.diagnostic.includes('design_preparation_required'), 'unauthorized override must retain original validation');
    }
    assert(!fs.existsSync(path.join(p.root, 'doc/features', rawFeature)), 'manifest design preparation must leave the raw Feature empty');
    const flatCandidate = 'execution_scope:\n  request:\n    completion_target: feature\n    requested_phases: [spec, plan]\n';
    writeHostFile(p.root, `doc/features/${rawFeature}/feature.yaml`, flatCandidate);
    fs.mkdirSync(path.join(p.root, 'doc/features', rawFeature, 'goal-runs/failed-start'), { recursive: true });
    const replay = deliveryCli(p, 'goal-mode-entry.ts', scopeArgs);
    assert(replay.json?.type === 'design_preparation_required' && fs.readFileSync(path.join(p.root, 'doc/features', rawFeature, 'feature.yaml'), 'utf8') === flatCandidate, replay.diagnostic);
    assert(fs.readdirSync(path.join(p.root, 'doc/features', rawFeature, 'goal-runs')).length === 1, 'empty failed-start directory and unfrozen candidate must not become a valid task');
    // Main Agent substitute reads the response and writes a DRAFT from known source/design inputs.
    // No admitted blueprint or CU exists at setup; independent questioning and admission follow below.
    const input = path.resolve(__dirname, '../fixtures/component-blueprint/valid');
    for (const dir of ['src', 'test', 'requirements', 'contracts', 'mappings']) fs.cpSync(path.join(input, dir), path.join(p.root, dir), { recursive: true });
    fs.copyFileSync(path.join(input, 'doc/module-catalog.yaml'), path.join(p.root, 'doc/module-catalog.yaml'));
    const blueprint: any = YAML.parse(fs.readFileSync(path.join(input, 'doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml'), 'utf8'));
    const candidate: any = YAML.parse(fs.readFileSync(path.join(input, 'doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml'), 'utf8'));
    const questions = blueprint.review_summary.questioning.items;
    blueprint.review_summary.questioning.items = [];
    blueprint.review_summary.questioning.status = 'incomplete';
    blueprint.review_summary.admission.status = 'blocker';
    blueprint.review_summary.admission.root_questions_complete = false;
    blueprint.review_summary.admission.current_slice.contracts_ready = false;
    blueprint.review_summary.admission.current_slice.design_refs_ready = false;
    const node = asRecord(resolveBlueprintTarget(blueprint, candidate.design_refs[0].target))!;
    const readDesign = (name: string) => YAML.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/blueprint-design-inputs', `${name}.yaml`), 'utf8'));
    node.provenance = { ...asRecord(node.provenance), evidence_strength: 'authoritative' };
    node.acceptance = readDesign('acceptance'); node.contracts = readDesign('contracts'); node.use_cases = readDesign('use-cases');
    node.contracts = JSON.parse(JSON.stringify(node.contracts).split('test/ledger/LedgerFeature.test.ets').join(CU_TEST).split('planned:').join(''));
    (node.contracts as any).modules = [{ name: 'ledger', layer: '02-Feature', format: 'HAR', change_type: 'modify', package_path: 'src/ledger' }];
    (node.contracts as any).files = [CU_SOURCE];
    for (const useCase of (node.use_cases as any).use_cases) {
      useCase.coordinator = 'LedgerFeature.add';
      useCase.ui_bindings = [{ ui: 'LedgerPage', role: 'entry', user_actions: [{ trigger: '点击新增账目', calls: 'LedgerFeature.add' }] }];
    }
    writeHostFile(p.root, CU_SOURCE, 'export class LedgerFeature { balance(): number { return 0; } }\n');
    writeHostFile(p.root, CU_TEST, "import { describe } from '@ohos/hypium';\ndescribe('LedgerFeature', () => {});\n");
    writeHostFile(p.root, 'src/ledger/ClosureFixture.ts', 'export const currentLedger = true;\n');
    const configFile = path.join(p.root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.architecture.outer_layers.push({ id: 'src', can_depend_on: [], intra_layer_deps: 'dag' });
    fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
    const flow = asRecord(resolveBlueprintTarget(blueprint, candidate.design_refs.find((ref: any) => ref.target.kind === 'flow').target))!;
    flow.provenance = { ...asRecord(flow.provenance), evidence_strength: 'authoritative' }; flow.contracts = readDesign('runtime');
    const blueprintRel = 'doc/features/ledger-app-blueprint/blueprint/component-blueprint.yaml';
    const checkArgs = ['--project-root', p.root, '--blueprint', 'ledger-app-blueprint', '--write-review', '--json'];
    writeHostFile(p.root, blueprintRel, YAML.stringify(blueprint));
    const draft = deliveryCli(p, 'check-component-blueprint.ts', checkArgs);
    assert(draft.status === 1 && draft.json?.issues?.some((row: any) => row.id.startsWith('blueprint_questioning_')), draft.diagnostic);
    const cuArgs = ['--project-root', p.root, '--blueprint', 'ledger-app-blueprint', '--json'];
    const candidatesRel = 'doc/features/ledger-app-blueprint/blueprint/change-unit-candidates.json';
    writeHostFile(p.root, candidatesRel, '[]');
    assert(deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--accept-candidates', candidatesRel]).status === 1, 'draft must not enter decomposition');
    assert(fs.existsSync(path.join(p.root, candidatesRel)), 'entry rejection must preserve candidates');
    // Isolated questioning substitute consumes the draft/evidence, writes its own coverage rows.
    blueprint.review_summary.questioning.items = questions.map((q: any, index: number) => ({ ...q, question_id: `isolated-${index}`, question: `证据是否支持 ${q.scope_ref}？`, answer: `已核对 ${q.evidence_refs.join(', ')}；${q.answer}` }));
    blueprint.review_summary.questioning.status = 'complete';
    writeHostFile(p.root, blueprintRel, YAML.stringify(blueprint));
    let checked = deliveryCli(p, 'check-component-blueprint.ts', checkArgs);
    // The author substitute only patches expected values exposed by public CLI diagnostics.
    const admissionPaths = new Set([
      '$.review_summary.admission.status', '$.review_summary.admission.root_questions_complete',
      '$.review_summary.admission.current_slice.contracts_ready', '$.review_summary.admission.current_slice.design_refs_ready',
    ]);
    let correctionRounds = 0;
    while (checked.status !== 0 && correctionRounds < 2) {
      const corrections = (checked.json?.issues ?? []).filter((row: any) => admissionPaths.has(row.path));
      assert(corrections.length > 0, checked.diagnostic);
      console.log('5f8c2d70 public admission diagnostics', JSON.stringify(corrections));
      for (const row of corrections) {
        const expected = /派生为 (true|false|pass|blocker)[。，]/.exec(row.message)?.[1];
        assert(!!expected, `public diagnostic lacks an expected admission value: ${JSON.stringify(row)}`);
        const keys = row.path.slice(2).split('.');
        const parent = keys.slice(0, -1).reduce((value: any, key: string) => value[key], blueprint);
        parent[keys.at(-1)] = expected === 'true' ? true : expected === 'false' ? false : expected;
      }
      writeHostFile(p.root, blueprintRel, YAML.stringify(blueprint));
      correctionRounds += 1;
      checked = deliveryCli(p, 'check-component-blueprint.ts', checkArgs);
    }
    assert(correctionRounds > 0 && checked.status === 0, `public admission correction failed after ${correctionRounds}/2 rounds: ${checked.diagnostic}`);
    const admittedBytes = fs.readFileSync(path.join(p.root, blueprintRel), 'utf8');
    const decompositionNext = deliveryCli(p, 'goal-mode-entry.ts', scopeArgs);
    assert(decompositionNext.json?.type === 'design_preparation_required' && fs.readFileSync(path.join(p.root, blueprintRel), 'utf8') === admittedBytes, 'admitted blueprint with zero CU must retain design and only need decomposition');
    candidate.target_predicates.forEach((row: any) => row.verification_refs.push('acceptance:AC-1'));
    const hash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(p.root, blueprintRel))).digest('hex')}`;
    const bind = (value: any): void => { if (!value || typeof value !== 'object') return; if (value.artifact === 'component-blueprint@1') { value.artifact_sha256 = hash; value.source_fingerprint = blueprint.source_fingerprint; } Object.values(value).forEach(bind); };
    bind(candidate);
    const providerId = 'builtin-vertical-slice-decomposition';
    candidate.provenance.extraction_method = providerId;
    const candidates = [{ providerId, artifact: candidate }];
    const malformed = structuredClone(candidate); malformed.change_unit_id = 'invalid-unit'; malformed.target_predicates = [];
    const invalidCandidates = JSON.stringify([...candidates, { providerId, artifact: malformed }]);
    writeHostFile(p.root, candidatesRel, invalidCandidates);
    assert(deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--accept-candidates', candidatesRel]).status === 1, 'invalid batch must fail');
    assert(fs.readFileSync(path.join(p.root, candidatesRel), 'utf8') === invalidCandidates, 'rejected batch must preserve candidate bytes');
    const cuPath = path.join(p.root, 'doc/features/ledger-app-blueprint/ledger-refresh/change-unit.yaml');
    assert(!fs.existsSync(cuPath), 'batch must not partly accept the valid candidate');
    writeHostFile(p.root, candidatesRel, JSON.stringify(candidates));
    const lock = path.join(p.root, 'doc/features/ledger-app-blueprint', BLUEPRINT_RECONCILE_LOCK_NAME);
    const locked = tryAcquireLock(lock, { ownerId: 'readiness-test', pid: process.pid });
    assert(locked !== null, 'test must own readiness lock');
    const accepted = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--accept-candidates', candidatesRel]);
    releaseLock(lock, 'readiness-test');
    assert(accepted.status === 1 && accepted.json?.accepted?.length === 1 && accepted.json?.readiness?.blueprintRefs?.busy
      && accepted.json.readiness.ready === false && accepted.json.ready_ids.length === 0, accepted.diagnostic);
    assert(!fs.existsSync(path.join(p.root, candidatesRel)), 'accepted candidates must be removed even when readiness is busy');
    const bytes = fs.readFileSync(cuPath, 'utf8');
    writeHostFile(p.root, candidatesRel, JSON.stringify(candidates));
    const duplicate = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--accept-candidates', candidatesRel]);
    assert(duplicate.status === 1 && duplicate.json.issues[0].id === 'change_unit_candidate_already_exists', duplicate.diagnostic);
    assert(fs.existsSync(path.join(p.root, candidatesRel)), 'duplicate rejection must retain its input');
    // A real filesystem failure in review materialization cannot revoke accepted/ready CUs.
    const reviewPath = path.join(p.root, 'doc/features/ledger-app-blueprint/blueprint/component-blueprint.review.md');
    fs.rmSync(reviewPath);
    fs.mkdirSync(reviewPath);
    const documentCandidate = { ...structuredClone(candidate), change_unit_id: 'z-document-failure' };
    const documentCandidatesRel = 'doc/features/ledger-app-blueprint/blueprint/document-candidates.json';
    writeHostFile(p.root, documentCandidatesRel, JSON.stringify([{ providerId, artifact: documentCandidate }]));
    const documentFailure = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--accept-candidates', documentCandidatesRel]);
    assert(documentFailure.status === 0 && documentFailure.json.status === 'PASS'
      && documentFailure.json.accepted.length === 1 && documentFailure.json.accepted[0].change_unit_id === 'z-document-failure'
      && documentFailure.json.readiness.ready && documentFailure.json.ready_ids.includes('z-document-failure')
      && documentFailure.json.ready_ids.includes('ledger-refresh'), documentFailure.diagnostic);
    assert(!fs.existsSync(path.join(p.root, documentCandidatesRel)), 'accepted candidates must be removed even when review materialization fails');
    assert(documentFailure.json.acceptanceReview.status === 'failed' && documentFailure.json.readiness.reviewDocument.status === 'failed'
      && documentFailure.json.acceptanceReview.reason && documentFailure.json.readiness.reviewDocument.rebuildCommand
      && documentFailure.json.next.includes('文档物化失败') && documentFailure.json.next.includes('独立重建'), documentFailure.diagnostic);
    assert(fs.existsSync(documentFailure.json.accepted[0].canonical_path) && fs.readFileSync(cuPath, 'utf8') === bytes, 'document failure must preserve both accepted canonical facts');
    console.log('5f8c2d70 document failure result', JSON.stringify({ status: documentFailure.json.status, exit: documentFailure.status, accepted: documentFailure.json.accepted, ready: documentFailure.json.readiness.ready, ready_ids: documentFailure.json.ready_ids, acceptanceReview: documentFailure.json.acceptanceReview, reviewDocument: documentFailure.json.readiness.reviewDocument, next: documentFailure.json.next }));
    const documentRetry = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--readiness']);
    assert(documentRetry.status === 0 && documentRetry.json.readiness.ready && documentRetry.json.ready_ids.includes('z-document-failure')
      && documentRetry.json.readiness.reviewDocument.status === 'failed' && documentRetry.json.next.includes('独立重建'), documentRetry.diagnostic);
    fs.rmdirSync(reviewPath);
    const rebuilt = deliveryCli(p, 'check-component-blueprint.ts', checkArgs);
    assert(rebuilt.status === 0 && rebuilt.json.review_document.status !== 'failed', rebuilt.diagnostic);
    const ready = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--readiness']);
    assert(ready.status === 0 && ready.json.readiness.ready && fs.readFileSync(cuPath, 'utf8') === bytes, ready.diagnostic);
    const again = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--readiness']);
    assert(again.status === 0 && fs.readFileSync(cuPath, 'utf8') === bytes, 'repeated readiness must retain canonical identity/content');
    const cleanupCandidate = { ...structuredClone(candidate), change_unit_id: 'z-cleanup-failure' };
    writeHostFile(p.root, candidatesRel, JSON.stringify([{ providerId, artifact: cleanupCandidate }]));
    const cleanupPreload = path.join(p.root, 'fail-candidate-cleanup.cjs');
    fs.writeFileSync(cleanupPreload, `const fs = require('fs'); const unlink = fs.unlinkSync;
fs.unlinkSync = (file, ...args) => {
  if (file === ${JSON.stringify(path.join(p.root, candidatesRel))}) throw new Error('simulated candidate cleanup failure');
  return unlink(file, ...args);
};\n`);
    const cleanupFailure = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--accept-candidates', candidatesRel], ['--require', cleanupPreload]);
    assert(cleanupFailure.status === 0 && cleanupFailure.json.accepted.length === 1 && cleanupFailure.json.readiness.ready
      && fs.existsSync(cleanupFailure.json.accepted[0].canonical_path), cleanupFailure.diagnostic);
    assert(fs.existsSync(path.join(p.root, candidatesRel)) && cleanupFailure.stderr.includes('临时文件清理失败')
      && cleanupFailure.stderr.includes('--readiness'), 'cleanup failure must warn without revoking acceptance or requesting reacceptance');
    assert(fs.existsSync(path.join(p.root, 'doc/features/ledger-app-blueprint/blueprint/component-blueprint.review.md')), 'readiness retains document materialization side effect');
    const canonical = loadCanonicalChangeUnit(p.root, 'ledger-app-blueprint', 'ledger-refresh');
    const writeUnit = (id: string, patch: any = {}) => {
      const unit = { ...structuredClone(canonical.changeUnit), change_unit_id: id, ...patch };
      writeHostFile(p.root, `doc/features/ledger-app-blueprint/${id}/change-unit.yaml`, YAML.stringify(unit));
      return loadCanonicalChangeUnit(p.root, 'ledger-app-blueprint', id);
    };
    const retired = writeUnit('retired-slice');
    writeUnit('replacement-slice', { supersedes: createChangeUnitRef(retired) });
    writeUnit('waiting-slice', { requires: [{ require_id: 'wait-for-refresh', from_change_unit_id: 'ledger-refresh', provide_id: (canonical.changeUnit.provides as any[])[0].provide_id }] });
    const multi = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--readiness']);
    assert(multi.status === 0 && multi.json.ready_ids.includes('ledger-refresh') && multi.json.ready_ids.includes('replacement-slice'), multi.diagnostic);
    assert(!multi.json.ready_ids.includes('retired-slice') && !multi.json.ready_ids.includes('waiting-slice'), 'retired and unsatisfied dependency must not be executable');
    assert(multi.json.inventory.some((row: any) => row.change_unit_id === 'retired-slice') && multi.json.next.includes('inventory'), 'inventory must explicitly retain and distinguish historical identity');
    // hmos canonical birth reaches the substituted executor through each real entry, with no model.
    for (const entry of ['foreground', 'detach'] as const) {
      const id = `hmos-${entry}`;
      writeUnit(id);
      const hmosFeature = deriveChangeUnitFeatureId('ledger-app-blueprint', id);
      const hmosScope = deliveryCli(p, 'goal-mode-entry.ts', deliveryStepArgs(decompositionNext.json.steps[2], hmosFeature));
      assert(hmosScope.status === 0 && hmosScope.json.type === 'scope_candidate_prepared', hmosScope.diagnostic);
      const probe = await requestVia(entry, p.root, { frameworkRoot: p.frameworkRoot, featureId: hmosFeature,
        freshStartPhase: hmosScope.json.phase_chain[0], freshEndPhase: hmosScope.json.phase_chain.at(-1),
        freshRequirement: CU_REQUIREMENT, omitRequirement: true, launchArgs: decompositionNext.json.steps[3].parameters.requirement_arguments, freshBudget: { max_total_turns: 1 }, failExecutorFor: () => true });
      assert(probe.invokedPhases.includes(hmosScope.json.phase_chain[0]) && (entry !== 'detach' || !!probe.childArgs), `hmos canonical ${entry} must pass birth and reach executor`);
      assert(JSON.parse(fs.readFileSync(path.join(p.root, 'framework.config.json'), 'utf8')).project_profile.name === 'hmos-app', 'hmos release path must retain its profile');
    }
    const feature = ready.json.inventory.find((row: any) => row.change_unit_id === ready.json.ready_ids[0]).feature_id;
    assert(feature === deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh'), 'Feature must come from canonical CU identity');
    const old = deliveryCli(p, 'check-change-unit.ts', [...cuArgs, '--unit', 'ledger-refresh']);
    assert(old.status === 0 && old.json.status === 'PASS' && old.json.canonical_path === cuPath && !old.json.readiness, old.diagnostic);
    for (const args of [['--readiness', '--unit', 'ledger-refresh'], ['--readiness', '--accept-candidates', candidatesRel]]) assert(deliveryCli(p, 'check-change-unit.ts', [...cuArgs, ...args]).status === 2, 'operations must reject mixed arguments');
    // Consume the returned command/arguments, rather than reconstructing the original CLI.
    const scopeStep = decompositionNext.json.steps[2];
    const scopeCommand = deliveryStepArgs(scopeStep, feature);
    assert(JSON.stringify(scopeStep.parameters.requirement_arguments) === JSON.stringify(['--requirement-file', 'request.md']), 'scope command must retain original requirement source');
    assert(JSON.stringify(decompositionNext.json.steps[3].parameters.requirement_arguments) === JSON.stringify(scopeStep.parameters.requirement_arguments), 'scope and Goal use the same request arguments');
    const prepared = deliveryCli(p, 'goal-mode-entry.ts', [...scopeCommand, '--overwrite']);

    assert(prepared.status === 0 && prepared.json.type === 'scope_candidate_prepared', prepared.diagnostic);
    // Actual Goal launcher/runtime and actual harness first phase; transport/model are substitutes.
    deliveryProfile(p, 'test-chain');
    git(p.root, ['add', '-A']); git(p.root, ['commit', '-qm', 'test design handoff']);
    const cu = { ...p, feature, module: 'ledger', modulePath: 'src/ledger' };
    const phases: string[] = prepared.json.phase_chain;
    const probe = await requestVia('detach', p.root, { frameworkRoot: p.frameworkRoot, featureId: feature, realHarness: true,
      freshStartPhase: phases[0] as 'spec', freshEndPhase: phases.at(-1), freshRequirement: CU_REQUIREMENT, omitRequirement: true, launchArgs: scopeStep.parameters.requirement_arguments,
      freshBudget: { max_total_turns: 2 },
      onSpec: ctx => { cu.runId = ctx.runId; writeCuSpecMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'spec'); },
      onPlan: ctx => { cu.runId = ctx.runId; writeCuPlanMaterials(cu); if (ctx.attempt > 1) publishVerifier(cu, 'plan'); },
    });
    assert(!!probe.childArgs && probe.invokedPhases.includes(phases[0]), 'ready CU must really launch and enter its first phase');
    assert(JSON.parse(fs.readFileSync(path.join(probe.reportDir, 'manifest.json'), 'utf8')).requirement_source_files.join(',') === scopeStep.parameters.requirement_source_files.join(','), 'Goal manifest must retain the scope original request source');
    const summary = readSummary(cu, phases[0]);
    assert(summary?.verdict === 'PASS' && summary.closure_status === 'closed', JSON.stringify(summary));
    const runDir = path.join(p.root, 'doc/features/ledger-app-blueprint/ledger-refresh/goal-runs');
    const runs = fs.readdirSync(runDir).filter(name => !name.startsWith('.'));
    const manifestPath = path.join(runDir, runs[0], 'manifest.json');
    const manifestBytes = fs.readFileSync(manifestPath, 'utf8');
    const repeated = deliveryCli(p, 'goal-mode-entry.ts', ['--project-root', p.root, '--prepare-run', '--feature', feature, '--adapter', 'codex', '--run-mode', 'attended', '--requirement', CU_REQUIREMENT]);
    assert(repeated.status === 1 && !repeated.diagnostic.includes('design_preparation_required') && fs.readFileSync(manifestPath, 'utf8') === manifestBytes && fs.readdirSync(runDir).filter(name => !name.startsWith('.')).length === runs.length, 'budget-held canonical CU reentry must retain its existing run/budget, not reroute to initial design');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
});

test('5f8c2d70 generic and single-duty request keep production prepare/birth paths', async () => {
  const p = provisionRealChainProject();
  try {
    scaffoldRealChainHost(p); fs.rmSync(path.join(p.root, 'doc/features'), { recursive: true, force: true });
    const args = ['--project-root', p.root, '--prepare-scope', '--feature', 'local-spec', '--completion-target', 'request', '--requested-results', '仅写 spec', '--requested-phases', 'spec', '--requirement', '仅写 spec'];
    deliveryProfile(p, 'hmos-app');
    const single = deliveryCli(p, 'goal-mode-entry.ts', args);
    assert(single.status === 0 && single.json.type === 'scope_candidate_prepared', single.diagnostic);
    const first = prepareGoalModeRun({ projectRoot: p.root, frameworkRoot: p.frameworkRoot, feature: 'local-spec', adapter: 'codex', requirement: '仅写 spec' });
    const second = prepareGoalModeRun({ projectRoot: p.root, frameworkRoot: p.frameworkRoot, feature: 'local-spec', adapter: 'codex', requirement: '仅写 spec' });
    assert(first.manifest.run_id === second.manifest.run_id, 'valid standalone birth must retain task identity');
    deliveryProfile(p, 'generic');
    const generic = deliveryCli(p, 'goal-mode-entry.ts', args.map(value => value === 'local-spec' ? 'generic-delivery' : value === 'request' ? 'feature' : value === 'spec' ? 'spec,plan,coding,review' : value));
    assert(generic.status === 0 && generic.json.type === 'scope_candidate_prepared', generic.diagnostic);
    git(p.root, ['add', '-A']); git(p.root, ['commit', '-qm', 'test generic entry']);
    const probe = await requestVia('detach', p.root, { frameworkRoot: p.frameworkRoot, featureId: 'generic-delivery', freshRequirement: '仅写 spec',
      freshStartPhase: generic.json.phase_chain[0], freshEndPhase: generic.json.phase_chain.at(-1), failExecutorFor: phase => phase !== 'spec' });
    assert(!!probe.childArgs && probe.invokedPhases.includes('spec'), 'generic must really birth through fresh detach and enter spec');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
});

export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const out: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases.filter(item => matchesUnitCase(item.name, selector))) {
    const endTiming = startCaseTiming([c.name], timings);
    try { await c.run(); out.push({ name: c.name, ok: true }); }
    catch (e) { out.push({ name: c.name, ok: false, error: (e as Error).message }); }
    finally { endTiming(); }
  }
  return selectedUnitCases(out, selector, timings);
}

export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }

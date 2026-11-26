import { beginUnitCase } from '../utils/unit-cases';
import * as fs from 'fs';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import { provisionRealChainProject, scaffoldRealChainHost, writeHostFile, REAL_CHAIN_SOURCE, REAL_CHAIN_SOURCE_2, REAL_CHAIN_MODEL, REAL_CHAIN_SERVICE, REAL_CHAIN_INDEX, REAL_CHAIN_NEW_SOURCE, REAL_CHAIN_TEST, REAL_CHAIN_PNG_EXISTING, REAL_CHAIN_PNG_NEW, CU_SOURCE, CU_TEST, type RealChainProject } from '../utils/real-chain-host';
import { clearFrameworkConfigCache } from '../../config';
import * as YAML from 'yaml';
import { fixture as seedChangeUnitBlueprint } from './blueprint-skill-projection.unit.test';
import { rewriteBlueprint } from './change-unit-progression.unit.test';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { validateChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { asRecord, type BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import type { ContractsSpec } from '../../scripts/utils/types';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { codingTestPreservation } from '../../scripts/utils/repair-responsibility';
import { preserveRuntimeTestEvidence } from '../utils/runtime-test-control';
import { authorCurrentCuPlan } from './component-design-handoff.unit.test';

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>): void { cases.push({ name, run }); }
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const DEBUG = process.env.REAL_CHAIN_DEBUG === '1';

export function preserveChainFailure(project: RealChainProject, error: unknown, extraFiles: string[] = []): void {
  try {
  const files = extraFiles.map(file => path.isAbsolute(file) ? file : path.join(project.root, file))
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
  const scan = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:json|ya?ml|md)$/.test(entry.name)) files.push(file);
    }
  };
  scan(path.join(project.root, 'doc/features'));
  for (const file of [REAL_CHAIN_TEST, CU_TEST, REAL_CHAIN_SERVICE, CU_SOURCE]) {
    if (fs.existsSync(path.join(project.root, file))) files.push(path.join(project.root, file));
  }
  const destination = preserveRuntimeTestEvidence([project.root], String(error), undefined, files);
  const saved = JSON.parse(fs.readFileSync(path.join(destination, 'failure.json'), 'utf8')) as { saved: Array<{ run: string }> };
  const originals = saved.saved.flatMap(({ run }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(run, 'manifest.json'), 'utf8')) as { feature: string; run_id: string };
    return [REAL_CHAIN_TEST, CU_TEST].filter(file => fs.existsSync(path.join(project.root, file))).map(file => ({ file, feature: manifest.feature,
      ...codingTestPreservation({ projectRoot: project.root, feature: manifest.feature, runId: manifest.run_id, file }) }));
  });
  fs.writeFileSync(path.join(destination, 'test-originals.json'), JSON.stringify(originals, null, 2) + '\n');
  console.error('REAL_CHAIN_ORIGINALS=' + destination);
  } catch (preserveError) { console.error(`[real-chain originals] ${String(preserveError)}; original failure: ${String(error)}`); }
}

// P0 交互链的身份（acceptance checkpoint / ui-spec / 派生计划 / trace 四处必须逐字同一）。
const SCREEN_LIST = 'all_banks';
const SCREEN_ENTRY = 'open_card_entry';
const EL_BANK_ROW = 'bank_row_cmb';
const EL_ENTRY_TITLE = 'open_card_title';

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
      ]
    : [];
  for (const resource of [REAL_CHAIN_PNG_EXISTING, REAL_CHAIN_PNG_NEW]) {
    if (fs.existsSync(path.join(p.root, resource))) deltaRows.push([resource, '已核对当前二进制资源路径', '按实际存在的输入继续']);
  }
  if (phase === 'ut') {
    const testDir = path.join(p.root, p.modulePath, 'src/ohosTest/ets/test');
    if (fs.existsSync(testDir)) for (const name of fs.readdirSync(testDir)) {
      const file = path.join(testDir, name);
      if (!fs.statSync(file).isFile()) continue;
      const source = path.relative(p.root, file).split(path.sep).join('/');
      const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].replace(/\|/g, '/');
      deltaRows.push([source, '已读取当前测试：' + firstLine, '核对实际用例与验收']);
    }
  }
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

/** 判据解析器本身的纯单测（不跑链）：跨阶段、同阶段重试两行、一次回落 hmos-app。 */

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
    assert(!overflow.issues.some(i => i.id === 'cu_scope_matches_blueprint'), JSON.stringify(overflow.issues));
    assert(overflow.warnings?.some(message => message.includes(project.module) && message.includes('公共契约')), 'extra module must be disclosed for review');
    setModules(['ledger', project.module]);
    const outside = plan();
    assert(outside.state === 'resolved', 'module forecasts can expand without changing real authority: ' + outside.detail);
    // 调和回集合内后投影恢复（链可继续）。
    setModules(['ledger']);
    assert(plan().state === 'resolved', '调和回可修改集合后投影应恢复 resolved');
  } finally {
    if (!DEBUG) fs.rmSync(project.root, { recursive: true, force: true });
    clearFrameworkConfigCache();
  }
}

test('real-chain CU-bound 接缝：合成宿主上蓝图节点 module / 术语确认 / touches 派生范围被 typed plan 投影消费', cuBoundBlueprintScopeSeam);

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    const endUnitCase = beginUnitCase(c.name);
    if (!endUnitCase) continue;
    try { await c.run(); out.push({ name: c.name, ok: true }); }
    catch (e) { out.push({ name: c.name, ok: false, error: (e as Error).message }); }
    finally {  endUnitCase(); }
  }
  return out;
}

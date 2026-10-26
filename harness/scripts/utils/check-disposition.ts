// ============================================================================
// check-disposition.ts — 失败检查的处置函数与判定谓词（plan f7045213 §3）
// ----------------------------------------------------------------------------
// 一个失败检查"挡不挡本阶段通过"只在这里决定；读它的地方（结论、计数、质量轴、阻断清单、
// 各阶段聚合状态……）一律调判定谓词，不再各写一份 `status === 'FAIL' && severity === 'BLOCKER'`。
//
// 处置规则按序，**没有第四条**：
//   1. 不是失败，或严重级别不是阻断 → 不阻断；
//   2. 命中去向表 → 按表；
//   3. 其余 → 按检查自己声明的严重级别与状态（阻断）。
// 运行时认不出的 id（动态拼出来的、经包装的、用常量间接定义的）都走第 3 条，保持原处置。
// "新增的阻断检查必须先声明它保护什么"由开发期静态守卫保证（tests/unit/check-disposition），
// 不在运行时按"认不认识这个 id"决定披露。
// ============================================================================

/** 按保护对象四分（§3.1）。 */
export type ProtectedObject = 'product_truth' | 'result_basis' | 'ledger_shape' | 'capability_gap';

/** 结果依据类必填：当前阶段，或 spec / plan / coding 之一（§3.2）。 */
export type DispositionOwner = 'current_phase' | 'spec' | 'plan' | 'coding';

/** 精确 id；或受限的动态族（固定前缀 + 产出它的唯一生产点，仓库相对路径）。 */
export type DispositionMatch = { id: string } | { prefix: string; producer: string };

export interface DispositionEntry {
  match: DispositionMatch;
  protects: ProtectedObject;
  owner?: DispositionOwner;
  /** 依据：事故或清单编号 */
  basis: string;
  /** 放过它的后果：一句话 */
  consequence: string;
}

/**
 * 去向表：只登记去向**发生变化**的检查。表里没有的检查按自身声明处置，行为不变。
 * 首批分类（§6，2026-09-29）：取证见 dist/reliability-baseline/p4-first-classification.md，codex 逐条评审后 7 条。
 * 暂缓：`authoritative_content_aligned`（drift/invalid 两分支责任方不同，检查结果无结构字段可区分），仍按声明阻断，
 * 归因经既有确定性门禁表。
 * 第二批（plan 3abca824 t4，2026-09-29）：探索记录 4 条，取证与评审见该 plan §12。
 * 38e5a7c2 再将必读登记与三条模式声明归入披露；`origin_tag_required`、`seed_no_technical_words` 仍暂缓。
 */
export const DISPOSITION_TABLE: readonly DispositionEntry[] = [
  { match: { id: 'request_provider_unavailable' }, protects: 'capability_gap',
    basis: '1804ac3b §4.5：既有 request provider 缺口在能力生产点明确分类',
    consequence: '专项测试缺少实际执行能力，不能将未执行当作产品通过；补齐能力后重发同一请求' },
  { match: { id: 'coding_existing_test_preserved' }, protects: 'product_truth',
    basis: 'c2f7a91e §5.3.1；179a73 兼容修补需保留旧用例和断言',
    consequence: 'coding 可通过删改测试或新增跳过掩盖回归；无法确认原件时不得授有限写权' },
  { match: { id: 'visual_diff_layout_invariants' }, protects: 'product_truth',
    basis: '6fd6c8c1 §2：S0原生布局A1适用性回放；既有T8命中在当前绑定、同交互surface下为确定性硬缺陷，soft档与复用不改变产品资格',
    consequence: '真实重叠或越界会仅因视觉档位/本轮未重采而降为WARN，已知坏产品可被普通完成；既有visual_diff聚合与coding返修须继续阻断' },
  { match: { id: 'structure_declaration_ledger' }, protects: 'ledger_shape',
    basis: '8a6d3f21：结构登记不构成产品结构缺失的证明',
    consequence: '台账缺项或定位过时须修正/披露；实际结构、交互和视觉仍由原独立验证判定' },
  ...['context_exploration_inputs_coverage', 'context_exploration_mode_allowed',
    'context_exploration_mode_required', 'context_exploration_subagent_required'].map(id => ({
    match: { id }, protects: 'ledger_shape' as const,
    basis: '38e5a7c2：spec 冻结基线与 plan 追加登记冲突；建立阶段模式不应被下游重判',
    consequence: '探索输入登记或模式声明不完整；真实来源、目标覆盖、身份、新鲜度和产品契约仍由原检查判定',
  })),
  {
    // spec 门是排除登记引文约束的执行点；授权判定处另做同源引文核验（visual-diff-check elementScope）。
    match: { id: 'ref_elements_excluded' }, protects: 'result_basis', owner: 'current_phase',
    basis: 'c4e7a9b2 A2-4；取证清单 #34',
    consequence: 'agent 自登记排除，真实视觉缺失在 testing 被当作需求排除剔出返修，"视觉通过"失去依据',
  },
  {
    // 自报估计值，框架无法核实；可核实的探索门（source_code_paths_min/exist、code_facts_min）继续阻断。
    // Feature 与 request 均消费披露；request 的其它 FAIL/SKIP 语义保留。
    match: { id: 'context_exploration_searches_min' }, protects: 'ledger_shape',
    basis: '取证清单 #37（无宿主 FAIL 事故）',
    consequence: '探索记录上的"估计搜索次数"偏低；探索是否真实发生仍由可核实的检查裁决',
  },
  {
    // 自报字符串，且声明 sequential 即可合法绕开。
    match: { id: 'context_exploration_subagents_used' }, protects: 'ledger_shape',
    basis: '取证清单 #38（无宿主 FAIL 事故）',
    consequence: '探索记录里"用了哪些子 agent"缺失',
  },
  {
    // 版本标签无消费者按其分支，身份由 context_exploration_facts_run_match 独立核。
    // 入口边界：链首建立阶段仍被 capability-resolution-entry-input 以 capability_resolution_contract 拦下（确定性门禁，保留）；
    // 输入契约仍独立核验建立资格；这里不改变该前置判据。
    match: { id: 'context_exploration_facts_schema_version' }, protects: 'ledger_shape',
    basis: 'd9b4f7e2 P1-8（宿主 chrys i4/i5 两轮在版本号写混上失败重试）；取证清单 #39',
    consequence: 'facts 的版本标签写错；没有代码按这个版本号走不同解析',
  },
  {
    // feature 阶段披露；独立预校验 CLI（validate-ut-artifact）不读检查结果，仍保留原判定。
    // 真实编译与执行门裁决 UT 代码；MockKit 场景缺 strategy 由 ut_hypium_mockkit_policy 独立阻断。
    match: { id: 'ut_mock_plan_typed' }, protects: 'ledger_shape',
    basis: '取证清单 #45（无宿主 FAIL 分支事故）',
    consequence: 'mock-plan 某些替身预设缺粗类型标注，或完全没有 returns / throws 表达式（doubles 缺 strategy 另由 MockKit 策略门阻断）',
  },
  {
    // "标签在开头"无下游消费（覆盖匹配是包含匹配）；覆盖由 acceptance_coverage / ut_case_per_unit_ac 裁决。
    // 同一 FAIL 里的"需求模式禁止 [REG-*]"限制一并解除，不需要替代门（[REG-*] 本不计入任何 AC 覆盖）。
    match: { id: 'it_name_has_ac_or_branch_tag' }, protects: 'ledger_shape',
    basis: '423e5d0f（本门曾逼存量用例挂 [AC-*] 造成假覆盖与 path-c 死锁）；取证清单 #46',
    consequence: '某些 it() 名不以追溯标签开头；名称中间的有效 AC 标签仍按包含匹配计入覆盖，完全不带标签的只是不计入',
  },
  {
    // 加载器把缺失补成 1.0，只有字面空串才 FAIL；无下游按版本号做决定。
    match: { id: 'schema_version_present' }, protects: 'ledger_shape',
    basis: '取证清单 #55（codex 评审补登：显式空串会触发 catalog 与 glossary 的 BLOCKER）',
    consequence: 'catalog / glossary 的版本标签为空串',
  },
  // ---- 第二批（plan 3abca824 t4）----
  {
    // 自报文件数；checkpoint 恢复只用 readyToProduce、路径、时间与范围，不读它。来源可读性、Code Facts 与真实目标覆盖
    // 另有检查继续阻断。入口：实际运行量化检查且文件数阈值大于零的 feature 入口；有效 baseline 路径通常已把该阈值降为零。
    match: { id: 'context_exploration_files_inspected_min' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P1 与 codex 评审：与已登记的 searches_min 同形、同一条探索消费链，自报数不参与下游决策',
    consequence: '探索记录的自报文件数低于阈值；不再据此阻断，来源可读性、事实与目标覆盖检查保留',
  },
  {
    // 只查列表非空，检查器与 backfill 之外无读取方。入口：运行量化检查的 feature 路径，包括部分带 baseline 的现代调用。
    match: { id: 'context_exploration_decisions_unlocked' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P2 与 codex 评审：无决策消费的声明列表，同一条探索消费链',
    consequence: '未列出本次探索解锁的决策；产出本身及其语义审查仍须完成',
  },
  {
    // "无新增"（none）是合法状态；节的在场状态进证据指纹（factsPhaseFingerprint），缺节也可稳定绑定。有调用上下文时
    // 目标覆盖仍由 context_exploration_facts_scope_coverage 裁决，旧路径没有这层额外覆盖保证。
    // 入口：按实际调用上下文判定的非建立阶段；旧路径按 track 判定。
    match: { id: 'context_exploration_facts_phase_delta_missing' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P11 与 codex 评审："无新增"是合法状态，在场状态进指纹，覆盖与新鲜度另有检查',
    consequence: '本阶段没有增量小节，不能据此声称已记录"无新增"；当前事实覆盖与证据新鲜度仍独立裁决',
  },
  {
    match: { id: 'context_exploration_facts_phase_delta_empty' }, protects: 'ledger_shape',
    basis: '无宿主失败事故；P5 取证清单 #P12 与 codex 评审：同上一条',
    consequence: '本阶段增量小节为空，缺少新增事实或显式"无新增"声明；其它事实与证据检查保留',
  },
];

let activeTable: readonly DispositionEntry[] = DISPOSITION_TABLE;

/**
 * 测试专用：在 fn 执行期间让所有消费者读到注入的去向表，结束即还原。
 * 这样测试可以用非空去向表走真实消费链，而不往生产去向表里加测试条目。
 */
export function withDispositionTableForTest<T>(table: readonly DispositionEntry[], fn: () => T): T {
  const previous = activeTable;
  activeTable = table;
  let result: T;
  try {
    result = fn();
  } catch (error) {
    activeTable = previous;
    throw error;
  }
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    return (result as unknown as Promise<unknown>).finally(() => {
      activeTable = previous;
    }) as unknown as T;
  }
  activeTable = previous;
  return result;
}

/** 处置函数与谓词只读这三个字段；CheckResult、summary blocker、verifier 资格输入都满足。 */
export interface DispositionCheck {
  id: string;
  status: string;
  severity?: string;
  structured?: unknown;
  failure_kind?: string;
  blocking_class?: string;
  repair_owner?: string;
  affected_files?: readonly string[];
  /** 仅组装期：修改职责有效完成后，原检查仍须按当前对象复验。 */
  verificationRequired?: boolean;
}

export type CheckDisposition =
  | { action: 'none' }
  | { action: 'block'; entry: DispositionEntry | null }
  | { action: 'disclose'; entry: DispositionEntry };

const NONE: CheckDisposition = { action: 'none' };

export function findDispositionEntry(
  id: string,
  table: readonly DispositionEntry[] = activeTable,
): DispositionEntry | null {
  for (const entry of table) {
    const m = entry.match;
    if ('id' in m ? m.id === id : id.startsWith(m.prefix)) return entry;
  }
  return null;
}

/** 处置函数（§3.3）。 */
export function resolveCheckDisposition(
  check: DispositionCheck,
  table: readonly DispositionEntry[] = activeTable,
): CheckDisposition {
  if (check.status !== 'FAIL' || check.severity !== 'BLOCKER') return NONE;
  const entry = findDispositionEntry(check.id, table);
  if (!entry) return { action: 'block', entry: null };
  // 账本与形状：对不齐的披露、不阻断；能力缺口沿用既有通道（外部阻塞投影由结论函数负责）。
  return entry.protects === 'ledger_shape' ? { action: 'disclose', entry } : { action: 'block', entry };
}

/**
 * §7：结果依据类的责任方——归因、责任方、受影响文件提取消费同一份有效映射的去向表一半
 * （登记了的读这里，没登记的由调用方读既有的确定性门禁表与责任归属注册表）。非结果依据类返回 null。
 */
export function resultBasisOwner(id: string, table: readonly DispositionEntry[] = activeTable): DispositionOwner | null {
  const entry = findDispositionEntry(id, table);
  return entry?.protects === 'result_basis' ? (entry.owner ?? null) : null;
}

/** 判定谓词：它是否阻断本阶段通过。只是处置函数的布尔投影。 */
export function isBlockingCheck(
  check: DispositionCheck,
  table: readonly DispositionEntry[] = activeTable,
): boolean {
  return resolveCheckDisposition(check, table).action === 'block';
}

/** 只承接生产点明确分类的必需执行缺口；旧未分类 SKIP 仍由原检查与 verifier 处置。 */
export function isRequiredCheckGap(check: DispositionCheck, table: readonly DispositionEntry[] = activeTable): boolean {
  if (check.status !== 'SKIP' || check.severity !== 'BLOCKER') return false;
  return requiresCheckConclusion(check, table);
}

function requiresCheckConclusion(check: { id?: string; structured?: unknown; failure_kind?: string; blocking_class?: string }, table: readonly DispositionEntry[] = activeTable): boolean {
  if ((check.structured as { applicability?: unknown } | undefined)?.applicability === 'not_applicable') return false;
  if (findDispositionEntry(check.id ?? '', table)?.protects === 'ledger_shape') return false;
  return check.failure_kind === 'framework_bug' || check.blocking_class === 'framework_internal'
    || check.failure_kind === 'device_blocked' || check.blocking_class === 'externalBlocked'
    || check.failure_kind === 'capability_missing';
}

export function isFrameworkExecutionGap(check: DispositionCheck): boolean {
  return isRequiredCheckGap(check) && (check.failure_kind === 'framework_bug' || check.blocking_class === 'framework_internal');
}

/** blocking_skips 保留旧的完整复核清单；仅明确分类的执行缺口参与新增的完成约束。 */
export function requiredSummaryCheckGaps<T extends { id?: string; blocking_class?: string }>(summary: { blocking_skips?: readonly T[] } | null | undefined): T[] {
  return (summary?.blocking_skips ?? []).filter(check => requiresCheckConclusion(check));
}

// ---------------------------------------------------------------------------
// plan 6fd6c8c1 §4.1：同一实际问题只有一个当前处置（内存事实，零 I/O）
// ---------------------------------------------------------------------------
// 输入是**已经读好的**当前事实（summary/verifier/债务/能力/新鲜度/责任结果），本函数只汇合，
// 不读写文件、不持有历史、不 import runtime。普通完成与发布资格从同一批处置投影：
//   · completionBlocking —— 不解决就不能宣称本次请求完成（修 / 等 / 补验）；
//   · releaseBlocking    —— 普通任务可以完成，但发布仍 BLOCKED（披露的软降级/债务）；
//   · disclosed          —— completionBlocking 与 releaseBlocking 中 action='disclose' 的部分。
// 修/等/披露/补验是**处置含义**，不新增四种持久状态；消费者只能按自己的合法终点投影。

export type CurrentProblemAction = 'repair' | 'wait' | 'verify' | 'disclose';
export type CurrentProblemAffects = 'completion' | 'release';

export interface CurrentDispositionAxisFact {
  applicable?: boolean;
  required_for_release?: boolean;
  verdict?: string;
  resolution?: { class?: string; owner?: string; retry_phase?: string } | null;
  source_checks?: readonly string[];
  /** 修改方已有当前闭环，原来源检查尚须重验；仅组装期事实，不写回summary。 */
  verificationRequired?: boolean;
}

export interface CurrentDispositionPhaseFact {
  phase: string;
  /** 阶段 summary 是否在场（缺失只报 verdict_pass，不再重复报 schema/closure）。 */
  summaryPresent?: boolean;
  /** 阶段 summary 的最终裁决（PASS / FAIL / INCOMPLETE；缺失为 null）。 */
  verdict: string | null;
  /** summary schema 是否属于当前可作完成依据的代际。 */
  schemaCurrent: boolean;
  /** summary 1.1 契约违反（非空即记录/证据不可信）。 */
  summaryErrors?: readonly string[];
  /** summary 已带合法 closure_commit（闭环提交）。 */
  closureCommitted: boolean;
  /** 已分类的必需执行缺口（既有 requiredSummaryCheckGaps 的输出）。 */
  requiredGaps?: ReadonlyArray<{ id?: string; failure_kind?: string; blocking_class?: string }>;
  /** 本轮 FAIL 的检查（状态/严重度/结构化字段；判定仍走 resolveCheckDisposition）。 */
  failingChecks?: ReadonlyArray<DispositionCheck & { details?: string }>;
  /** summary 的质量轴。 */
  axes?: Readonly<Record<string, CurrentDispositionAxisFact>>;
  /** summary 的发布投影（用于防单独篡改：READY 与真实非 PASS 轴矛盾）。 */
  releaseReadiness?: string | null;
  /** summary 的完成标签（DEBT_PIPELINE_ERROR = 债务治理链自身失败）。 */
  completionStatus?: string | null;
  /** 证据新鲜度（fresh / missing / stale / tampered；null=不适用）。 */
  lineage?: 'fresh' | 'missing' | 'stale' | 'tampered' | null;
  lineageDetail?: string;
  /** 沿链传染的来源阶段（本阶段自身证据未核）。 */
  lineagePropagatedFrom?: string;
  /** review 闭环 attestation 是否在场（null=不适用）。 */
  attestationPresent?: boolean | null;
  /** 视觉/资源债务开放条数（只在 testing 投影 release 影响）。 */
  openDebt?: number;
  /** 已核实且仍未处置、归属于本阶段的发现（原候选/责任链输出，不是原始问题表行）。 */
  openFindings?: ReadonlyArray<{ id: string; detail: string; owner?: string; source_phase?: string; verificationRequired?: boolean; affects?: CurrentProblemAffects }>;
}

export interface CurrentDispositionInput {
  endpoint: 'feature-completion' | 'request';
  phases: readonly CurrentDispositionPhaseFact[];
  /** 已有机器证据 reader 的适用性/身份诊断；同样由公共处置投影。 */
  additionalProblems?: readonly CurrentDispositionProblem[];
  /** 档位钳制（强意图下能力被封顶）。 */
  fidelityCapped?: boolean;
  /** 损坏的 goal-run（身份不可信）。 */
  corruptRuns?: ReadonlyArray<{ runId: string; reason: string }>;
}

export interface CurrentDispositionProblem {
  phase: string;
  /** 复用既有 condition 名（verdict_pass / quality_axis_verified / …），不新增第二套标签。 */
  id: string;
  action: CurrentProblemAction;
  affects: CurrentProblemAffects;
  severity: 'BLOCKER' | 'MAJOR' | 'MINOR';
  detail: string;
  /** 合法修改/验证方（有则给出；展示消费者可用它说明下一步，不多派一单）。 */
  owner?: string;
  /** 发现所在的原验证阶段；owner 可以是另一修改职责。 */
  source_phase?: string;
  /** 证据缺口只是沿链传染时的来源阶段。 */
  propagated_from?: string;
}

export interface CurrentDisposition {
  problems: CurrentDispositionProblem[];
  /** 不解决就不能完成本次请求。 */
  completionBlocking: CurrentDispositionProblem[];
  /** 不解决就不能发布，但可以普通完成。 */
  releaseBlocking: CurrentDispositionProblem[];
  /** 允许披露、既不阻断普通完成也不伪造 PASS 的残差。 */
  disclosed: CurrentDispositionProblem[];
  completionEligible: boolean;
  releaseReady: boolean;
  reasons: string[];
}

/** 阶段资格/队列只消费具体职责；全局完成问题留给 Feature/终点消费者。 */
export function phaseCompletionProblems(disposition: CurrentDisposition, phases: readonly string[]): CurrentDispositionProblem[] {
  return disposition.completionBlocking.filter(problem => problem.phase !== '*'
    && (phases.includes(problem.phase) || !!problem.owner && phases.includes(problem.owner)));
}

const VISUAL_AXES = new Set(['visual', 'asset']);

/**
 * 唯一处置汇合点（纯函数）。规则只做既有语义的**用途区分**：
 *   · 产品真值/结果依据类失败是修；框架/能力/外部执行缺口是等；证据过期/缺失是补验；
 *   · 视觉/资源轴的软降级（UNVERIFIED/STALE/MISSING）与开放债务是披露：普通完成不因它被撤销，
 *     发布仍 BLOCKED，不伪造 PASS；轴的 FAIL 仍按真实失败处理；
 *   · 必需检查因框架异常未完成、closure/身份/新鲜度/生成链故障仍是 completion 阻断。
 */
export function resolveCurrentDisposition(input: CurrentDispositionInput): CurrentDisposition {
  const problems: CurrentDispositionProblem[] = [];
  const push = (problem: CurrentDispositionProblem): void => { problems.push(problem); };
  for (const problem of input.additionalProblems ?? []) push(problem);

  for (const phase of input.phases) {
    const phaseName = phase.phase;
    const summaryPresent = phase.summaryPresent !== false;
    const factStart = problems.length;
    const publicationProblems: CurrentDispositionProblem[] = [];
    const pushPublication = (problem: CurrentDispositionProblem): void => { publicationProblems.push(problem); };
    if (input.endpoint !== 'request' && summaryPresent && !phase.schemaCurrent) {
      pushPublication({
        phase: phaseName, id: 'summary_schema_current', action: 'verify', affects: 'completion', severity: 'BLOCKER',
        detail: 'summary schema 非当代（legacy 1.0 不作完成依据，须在当前 gate 指纹下重跑本阶段）',
      });
    }
    for (const error of input.endpoint !== 'request' && summaryPresent ? phase.summaryErrors ?? [] : []) {
      pushPublication({ phase: phaseName, id: 'quality_axes_valid', action: 'verify', affects: 'completion', severity: 'BLOCKER', detail: error });
    }
    if (input.endpoint !== 'request' && summaryPresent && !phase.closureCommitted) {
      pushPublication({
        phase: phaseName, id: 'closure_commit_present', action: 'verify', affects: 'completion', severity: 'BLOCKER',
        detail: '未完成 receipt/manifest/state 的原子闭环提交',
      });
    }
    for (const gap of phase.requiredGaps ?? []) {
      push({
        phase: phaseName, id: 'required_check_conclusion', action: 'wait', affects: 'completion', severity: 'BLOCKER',
        detail: `必需检查尚无结论：${gap.id ?? 'unknown'}`,
        ...(gap.failure_kind === 'framework_bug' || gap.blocking_class === 'framework_internal' ? { owner: 'framework' } : {}),
      });
    }
    for (const check of phase.failingChecks ?? []) {
      // 已登记候选保留了同一个原始检查的依据与负责方；不再追加无owner的聚合副本。
      if (phase.openFindings?.some(finding => finding.affects !== 'release'
        && (finding.id === check.id || finding.id === `${phaseName}:${check.id}`))) continue;
      const disposition = resolveCheckDisposition(check);
      if (disposition.action === 'none') {
        // 专项请求的原契约：任意非披露FAIL都未完成本职责，不能套Feature的严重度豁免。
        if (input.endpoint === 'request' && check.status === 'FAIL') push({ phase: phaseName, id: check.id,
          action: 'repair', affects: 'completion', severity: check.severity === 'MINOR' ? 'MINOR' : 'MAJOR',
          detail: `请求检查失败：${check.id}`, ...(check.repair_owner ? { owner: check.repair_owner } : {}) });
        continue;
      }
      const protects = disposition.action === 'disclose' ? disposition.entry.protects : disposition.entry?.protects ?? 'result_basis';
      if (disposition.action === 'disclose') {
        push({
          phase: phaseName, id: check.id, action: 'disclose', affects: 'release', severity: 'MAJOR',
          detail: `已披露失败（${protects}）：${(check.details ?? '').slice(0, 200)}`,
        });
        continue;
      }
      push({
        phase: phaseName,
        id: check.id,
        action: protects === 'capability_gap' || check.failure_kind === 'device_blocked' || check.blocking_class === 'externalBlocked' ? 'wait'
          : check.verificationRequired || check.failure_kind === 'framework_bug' || check.blocking_class === 'framework_internal' ? 'verify' : 'repair',
        affects: 'completion',
        severity: 'BLOCKER',
        detail: `阻断检查失败：${check.id}${check.failure_kind ? `（failure_kind=${check.failure_kind}）` : ''}`,
        ...(check.repair_owner ? { owner: check.repair_owner } : protects === 'capability_gap' ? { owner: 'external' } : {}),
      });
    }
    for (const [axisId, axis] of Object.entries(phase.axes ?? {})) {
      if (!axis.applicable || !axis.required_for_release) continue;
      if (axis.verdict === 'PASS' || axis.verdict === 'NOT_APPLICABLE') continue;
      const staleInheritance = axis.source_checks?.some(check => check.startsWith('stale_inheritance:'));
      const softVisual = VISUAL_AXES.has(axisId) && axis.verdict !== 'FAIL' && !staleInheritance;
      if (softVisual) {
        // 可披露残差：不撤销普通完成，不伪造视觉 PASS；债务与 release 限制保留。
        push({
          phase: phaseName, id: 'quality_axis_verified', action: 'disclose', affects: 'release', severity: 'MAJOR',
          detail: `${axisId} 轴 ${axis.verdict}（resolution=${axis.resolution?.class ?? '缺失'}）——披露，release 仍 BLOCKED`,
          ...(axis.resolution?.owner ? { owner: axis.resolution.owner } : {}),
        });
        continue;
      }
      push({
        phase: phaseName,
        id: 'quality_axis_verified',
        action: axis.resolution?.class === 'external_dependency' ? 'wait' : staleInheritance && !axis.verificationRequired ? 'repair' : 'verify',
        affects: 'completion',
        severity: 'BLOCKER',
        detail: `${axisId} 轴 ${axis.verdict}（resolution=${axis.resolution?.class ?? '缺失'}）`,
        ...(axis.resolution?.retry_phase || axis.resolution?.owner ? { owner: axis.resolution.retry_phase ?? axis.resolution.owner } : {}),
      });
    }
    // 投影一致性（防独立篡改）：存在必需的非 PASS 轴却写 release_readiness=READY → 派生缺陷，
    // 普通完成与发布都不成立；披露不豁免这条确定性校验。
    const anyRequiredNegative = Object.values(phase.axes ?? {}).some(axis =>
      axis.applicable && axis.required_for_release
      && axis.verdict !== 'PASS' && axis.verdict !== 'NOT_APPLICABLE');
    if (anyRequiredNegative && phase.releaseReadiness === 'READY') {
      push({
        phase: phaseName, id: 'release_projection_consistent', action: 'verify', affects: 'completion', severity: 'BLOCKER',
        detail: 'release_readiness=READY 与非 PASS 必需轴矛盾（投影被篡改/派生缺陷）',
      });
    }
    if (phase.completionStatus === 'DEBT_PIPELINE_ERROR') {
      push({
        phase: phaseName, id: 'debt_pipeline_healthy', action: 'verify', owner: 'framework', affects: 'completion', severity: 'BLOCKER',
        detail: '视觉债务管线故障（DEBT_PIPELINE_ERROR）——治理链自身失败不得干净完成，修复环境后重跑',
      });
    }
    if (phase.lineage && phase.lineage !== 'fresh') {
      pushPublication({
        phase: phaseName, id: 'lineage_fresh', action: 'verify', affects: 'completion', severity: 'BLOCKER',
        detail: phase.lineage === 'missing'
          ? '缺 phase-evidence-manifest（旧版产物/未闭环）'
          : `closure 后证据变更：${phase.lineageDetail ?? phase.lineage}`,
        ...(phase.lineagePropagatedFrom ? { propagated_from: phase.lineagePropagatedFrom } : {}),
      });
    }
    if (phase.attestationPresent === false) {
      pushPublication({
        phase: phaseName, id: 'attestation_present', action: 'verify', affects: 'completion', severity: 'BLOCKER',
        detail: '缺 review-closure-attestation.json',
      });
    }
    if ((phase.openDebt ?? 0) > 0) {
      push({
        phase: phaseName, id: 'visual_debt_open', action: 'disclose', affects: 'release', severity: 'MAJOR',
        detail: `${phase.openDebt} 条视觉/资源债务未清偿——披露并保留 release BLOCKED，不据此重排作者阶段`,
      });
    }
    for (const finding of phase.openFindings ?? []) {
      // 原 PASS 是阶段执行事实，不代表其中所有发现已解决；已核实且仍开放 → 交真实责任方。
      const disclose = finding.affects === 'release';
      push({
        phase: finding.source_phase ?? phaseName,
        id: `open_finding:${finding.id}`,
        action: disclose ? 'disclose' : finding.verificationRequired ? 'verify' : 'repair',
        affects: disclose ? 'release' : 'completion',
        severity: disclose ? 'MAJOR' : 'BLOCKER',
        detail: `${finding.verificationRequired ? '发现尚待当前独立核实' : '已核实发现仍未处置'}：${finding.id}：${finding.detail}`,
        ...(finding.owner ? { owner: finding.owner } : {}),
        source_phase: finding.source_phase ?? phaseName,
      });
    }
    // verdict只是上述当前事实的聚合；已有具体负面依据时不再制造一个丢owner/等待条件的任务。
    if (phase.verdict !== 'PASS' && (input.endpoint !== 'request' || summaryPresent)
      && !problems.slice(factStart).some(problem => problem.affects === 'completion')) {
      push({ phase: phaseName, id: phase.verdict === 'INCOMPLETE' ? 'required_check_conclusion' : 'verdict_pass',
        action: phase.verdict === 'INCOMPLETE' ? 'wait' : 'repair', affects: 'completion', severity: 'BLOCKER',
        detail: `summary verdict=${phase.verdict ?? '缺失'}` });
    }
    problems.push(...publicationProblems);
  }

  if (input.fidelityCapped) {
    push({
      phase: '*', id: 'no_fidelity_cap', action: 'repair', affects: 'completion', severity: 'BLOCKER',
      detail: '强意图下当前能力被钳制；换 provider/version 后重跑，或以 correction/successor 输入改变需求',
    });
  }
  for (const corrupt of input.corruptRuns ?? []) {
    push({
      phase: '*', id: 'goal_run_identity_intact', action: 'repair', affects: 'completion', severity: 'BLOCKER',
      detail: `goal-run ${corrupt.runId} 损坏：${corrupt.reason}——人工核查该目录（恢复 manifest 或确认废弃）后重验`,
    });
  }

  const completionBlocking = problems.filter(problem => problem.affects === 'completion');
  const releaseBlocking = problems.filter(problem => problem.affects === 'release');
  return {
    problems,
    completionBlocking,
    releaseBlocking,
    disclosed: problems.filter(problem => problem.action === 'disclose'),
    completionEligible: completionBlocking.length === 0,
    releaseReady: problems.length === 0,
    reasons: [...completionBlocking, ...releaseBlocking].map(problem => `[${problem.phase}] ${problem.id}: ${problem.detail}`),
  };
}

/** summary 的被披露失败清单一条（§4.3）。 */
export interface DisclosedFailure {
  id: string;
  protects: ProtectedObject;
  severity: string;
  details_excerpt: string;
}

export function collectDisclosedFailures(
  checks: ReadonlyArray<DispositionCheck & { details?: string }>,
  table: readonly DispositionEntry[] = activeTable,
): DisclosedFailure[] {
  const out: DisclosedFailure[] = [];
  for (const check of checks) {
    const d = resolveCheckDisposition(check, table);
    if (d.action !== 'disclose') continue;
    const details = (check.details ?? '').replace(/\r/g, '');
    out.push({
      id: check.id,
      protects: d.entry.protects,
      severity: String(check.severity),
      details_excerpt: details.length > 500 ? `${details.slice(0, 500)}…` : details,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §4.4 聚合的运行状态检查
// ---------------------------------------------------------------------------

/**
 * coding / testing 的运行状态检查是聚合：除源检查的阻断失败，还消费关键的阻断跳过与文档在场性。
 * 聚合照常产出、照常参与结论；只有当同一失败已由源 blocker 表达时，才不进阻断清单、签名与计数。
 */
export const AGGREGATE_RUN_STATUS_CHECK_IDS: ReadonlySet<string> = new Set(['coding_run_status', 'testing_run_status']);

/** 聚合项 details 的 `blocker_fail_ids:` 行（两个聚合构造器同一写法，与 runner 读 can_claim_done 同一做法）。 */
function aggregateSourceBlockerIds(details: string | undefined): string[] {
  const m = /^blocker_fail_ids:\s*(.+)$/m.exec(details ?? '');
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
}

/**
 * 输入：已按谓词筛出的阻断检查。去掉"源失败已在清单里"的聚合项；
 * 聚合失败而没有任何源 blocker（只由关键跳过或文档缺失引起）时保留，运行时归因与签名因此总有输入。
 */
export function dropRedundantAggregates<T extends { id: string; details?: string }>(blocking: readonly T[]): T[] {
  const ids = new Set(blocking.map(c => c.id));
  return blocking.filter(
    c => !(AGGREGATE_RUN_STATUS_CHECK_IDS.has(c.id) && aggregateSourceBlockerIds(c.details).some(id => ids.has(id))),
  );
}
